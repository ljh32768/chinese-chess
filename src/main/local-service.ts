/**
 * 桌面客户端「本机服务」管理（仅 Electron 客户端使用，无头 `--server` 不涉及）。
 *
 * 本机服务 = 本机作为局域网中心服务器（默认端口 27310）：
 * - 安装包注册了计划任务 `LanChessServer`（登录自启）：关闭时停掉正在跑的进程，并在
 *   `<userData>/local-service.json` 写入 enabled=false；登录自启的任务进程读到该偏好会直接退出，
 *   因此不需要管理员权限去改计划任务；
 * - 开发 / 绿色版没有计划任务 → 由客户端内置托管一个 `GameServer`（同端口、数据落 userData）；
 * - 端口已有其它进程提供的服务 → 只展示状态，客户端无法关闭。
 *
 * 停掉 `--server` 进程优先走本机回环的 `/api/local-service/shutdown`（token 落 userData，
 * 客户端与 `--server` 共用）；`schtasks /End` 只作为老版本进程的兜底（可能无权限）。
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { DEFAULT_PORT } from '../shared/defaults.js';
import {
  LOCAL_SERVICE_TASK_NAME,
  LocalServiceController,
  LocalServiceStatus,
} from '../shared/local-service.js';
import { logInfo } from '../server/log.js';
import { GameServer } from '../server/server.js';
import {
  ensureLocalServiceToken,
  localServicePrefPath,
  readLocalServiceEnabled,
  resolveServerDataDir,
} from './server-mode.js';

/** 等待端口状态变化的轮询间隔 / 超时 */
const POLL_MS = 250;
const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 3000;

function readPref(): boolean {
  return readLocalServiceEnabled(app.getPath('userData'));
}

function writePref(enabled: boolean): void {
  const file = localServicePrefPath(app.getPath('userData'));
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ enabled }, null, 2), 'utf8');
  } catch (err) {
    logInfo(`本机服务偏好写入失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 运行一条 Windows 命令（只看退出码；不解析随系统语言变化的文本输出） */
function runProcess(exe: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: 12000 }, (err) =>
      resolve({ ok: !err, error: err ? err.message : undefined }),
    );
  });
}

/** 探测本机端口上是否有局域网象棋服务（/api/server-info） */
async function probeService(port = DEFAULT_PORT, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/server-info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { port?: unknown };
    return typeof data.port === 'number';
  } catch {
    return false;
  }
}

/** 请求本机 `--server` 进程优雅退出（token 与 `--server` 共用；老版本没有该接口时返回 false） */
async function requestShutdown(port = DEFAULT_PORT): Promise<boolean> {
  try {
    const token = ensureLocalServiceToken(app.getPath('userData'));
    const res = await fetch(`http://127.0.0.1:${port}/api/local-service/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 等待端口到达期望状态（true = 在跑，false = 已停） */
async function waitForService(expected: boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeService()) === expected) return true;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return (await probeService()) === expected;
}

/** 本机服务管理器（主进程单例；应用退出时只释放客户端内置托管的服务） */
export class LocalServiceManager implements LocalServiceController {
  /** 客户端内置托管（无计划任务 / 任务无法启动时） */
  private builtin: GameServer | null = null;
  /** 串行化启停操作，避免连点造成并发 */
  private chain: Promise<unknown> = Promise.resolve();

  /** 应用启动时补齐状态：开关关闭则确保服务已停；开启则按需拉起 */
  init(): Promise<void> {
    return this.enqueue(async () => {
      if (process.platform !== 'win32') return;
      if (!readPref()) {
        await this.stopAll();
        return;
      }
      if (await probeService()) return;
      if (await this.taskExists()) {
        await this.startTask();
        if (await waitForService(true, START_TIMEOUT_MS)) return;
      }
      await this.ensureBuiltin();
    });
  }

  status(): Promise<LocalServiceStatus> {
    return this.enqueue(() => this.readStatus());
  }

  setEnabled(enabled: boolean): Promise<LocalServiceStatus> {
    return this.enqueue(() => this.apply(enabled));
  }

  /** 应用退出：只关闭客户端内置的服务；计划任务托管的服务继续常驻 */
  close(): Promise<void> {
    return this.enqueue(() => this.stopBuiltin());
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** 安装包是否注册了本机服务计划任务（`schtasks /Query` 退出码 0 = 存在） */
  private async taskExists(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    return (await runProcess('schtasks.exe', ['/Query', '/TN', LOCAL_SERVICE_TASK_NAME])).ok;
  }

  /** 启动计划任务（可能因权限失败，失败后由内置托管兜底） */
  private async startTask(): Promise<void> {
    const r = await runProcess('schtasks.exe', ['/Run', '/TN', LOCAL_SERVICE_TASK_NAME]);
    if (!r.ok) logInfo(`本机服务计划任务启动失败：${r.error}`);
  }

  /** 停止正在运行的服务：优先本机 shutdown 接口，其次 schtasks /End（老版本兜底） */
  private async stopRunning(): Promise<void> {
    await this.stopBuiltin();
    if (!(await probeService())) return;
    if (await requestShutdown()) return;
    const r = await runProcess('schtasks.exe', ['/End', '/TN', LOCAL_SERVICE_TASK_NAME]);
    if (!r.ok) logInfo(`本机服务停止失败（shutdown 接口与 schtasks 均不可用）：${r.error}`);
  }

  /** 关闭开关时确保所有托管方式都停掉 */
  private async stopAll(): Promise<void> {
    await this.stopRunning();
    await waitForService(false, STOP_TIMEOUT_MS);
  }

  /** 无计划任务时由客户端内置托管同端口服务（数据与 --server 模式一致落 userData） */
  private async ensureBuiltin(): Promise<boolean> {
    if (this.builtin) return true;
    const server = new GameServer({
      port: DEFAULT_PORT,
      host: '0.0.0.0',
      dataDir: resolveServerDataDir(process.env, app.getPath('userData')),
    });
    try {
      await server.listen();
      this.builtin = server;
      logInfo(`本机服务已启动（客户端内置，端口 ${DEFAULT_PORT}）`);
      return true;
    } catch (err) {
      logInfo(`本机服务启动失败：${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private async stopBuiltin(): Promise<void> {
    const server = this.builtin;
    this.builtin = null;
    await server?.close();
  }

  private async readStatus(): Promise<LocalServiceStatus> {
    const wantEnabled = readPref();
    const running = await probeService();
    // 实际在跑时开关显示为开启（停止失败时用户可以直接再点一次重试）
    const enabled = wantEnabled || running;
    if (process.platform !== 'win32') {
      return {
        supported: false,
        enabled,
        running,
        mode: 'builtin',
        port: DEFAULT_PORT,
      };
    }
    const mode: LocalServiceStatus['mode'] = this.builtin
      ? 'builtin'
      : (await this.taskExists())
        ? 'task'
        : running
          ? 'external'
          : 'builtin';
    let message: string | undefined;
    if (!wantEnabled) {
      message = running ? '本机服务未能停止，请重试' : '本机服务已关闭，登录后不再启动';
    } else if (!running) {
      message = '本机服务未运行，请重试开关';
    } else if (mode === 'external') {
      message = '本机服务由其它进程提供，客户端无法关闭';
    }
    return { supported: true, enabled, running, mode, port: DEFAULT_PORT, message };
  }

  private async apply(enabled: boolean): Promise<LocalServiceStatus> {
    writePref(enabled);
    if (process.platform !== 'win32') return this.readStatus();

    if (enabled) {
      if (!(await probeService())) {
        if (await this.taskExists()) {
          await this.startTask();
          await waitForService(true, START_TIMEOUT_MS);
        }
        // 任务不存在 / 启动失败（权限等）：客户端内置托管兜底
        if (!(await probeService())) await this.ensureBuiltin();
      }
      const status = await this.readStatus();
      status.message = status.running
        ? '本机服务已开启（端口 27310）'
        : '本机服务启动失败（端口 27310 可能被占用）';
      return status;
    }

    await this.stopRunning();
    await waitForService(false, STOP_TIMEOUT_MS);
    const status = await this.readStatus();
    if (status.running) {
      status.message =
        status.mode === 'external' ? '本机服务由其它进程提供，客户端无法关闭' : '本机服务未能停止，请重试';
    } else {
      status.message = '本机服务已关闭，登录后不再启动';
    }
    return status;
  }
}
