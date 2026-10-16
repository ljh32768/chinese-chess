/**
 * 皮卡鱼（Pikafish）UCI 引擎进程封装（仅 Node 侧可用）。
 *
 * 采用「常驻单进程 + 串行请求队列」：stdin 上不能交错 `position`/`go`，故所有请求排队执行；
 * 空闲一段时间后自动回收进程，下一次请求再惰性拉起（避免每个 Electron 客户端启动即养一个引擎进程）。
 *
 * 引擎文件发现顺序：`PIKAFISH_PATH` 环境变量 → `<root>/dist/engine/`（打包态含 asar.unpacked）
 * → `<root>/Reference/Pikafish皮卡鱼20260925/`。权重 `pikafish.nnue` 与引擎同目录时由引擎自行加载；
 * 仅当显式给出 `PIKAFISH_NNUE` 时才 `setoption name EvalFile`（避免中文安装路径下引擎打不开权重）。
 */

import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineLevel, EnginePort, EngineResult } from '../shared/engine.js';
import { Board, Side } from '../shared/types.js';
import { boardToFen, parseBestMove } from '../shared/uci.js';
import { logDebug, logInfo } from './log.js';

/** 各平台引擎文件名（与 `Reference/Pikafish皮卡鱼20260925` 内的文件一致） */
const ENGINE_FILE: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'Pikafish-Windows-x86-64-universal.exe',
  linux: 'Pikafish-Linux-x86-64-universal',
  darwin: 'Pikafish-MacOS-universal',
};

/** 仓库内引擎参考目录（`.gitignore` 忽略，不入库） */
const REFERENCE_DIR = 'Pikafish皮卡鱼20260925';

/** 难度 → 皮卡鱼强度（`Skill Level` 0-20，越小越弱）+ 每步思考时限 */
const LEVEL_PARAMS: Record<EngineLevel, { skill: number; movetimeMs: number }> = {
  1: { skill: 0, movetimeMs: 120 },
  2: { skill: 3, movetimeMs: 300 },
  3: { skill: 10, movetimeMs: 700 },
  4: { skill: 20, movetimeMs: 1200 },
};

/** 搜索线程数 / 置换表大小（MB） */
const THREADS = 2;
const HASH_MB = 32;
/** 空闲多久后回收引擎进程 */
const IDLE_MS = 60_000;
/** 等待单条 UCI 响应的上限（握手） */
const HANDSHAKE_MS = 15_000;
/** 连续「启动失败」上限，达到后停用皮卡鱼（防止反复 spawn） */
const MAX_START_FAILURES = 5;
/** 并发排队请求上限 */
const MAX_PENDING = 32;

/** Electron 打包后 `app.asar/...` → `app.asar.unpacked/...`（asar 内的可执行文件无法 spawn、权重无法读） */
function unpackedPath(p: string): string {
  return p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** 仓库 / 应用根目录：本文件位于 `<root>/dist/server/` 下 */
function rootDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** 当前平台对应的引擎文件名 */
function engineFile(): string {
  return ENGINE_FILE[process.platform] ?? (ENGINE_FILE.win32 as string);
}

/** 引擎位置 */
export interface EngineLocation {
  /** 引擎可执行文件绝对路径 */
  exe: string;
  /** 显式指定的权重文件路径；null 表示由引擎自行在同目录查找 */
  nnue: string | null;
}

/** 按优先级发现可用的引擎文件；找不到返回 null */
export function findEngine(): EngineLocation | null {
  const file = engineFile();
  const nnue = process.env.PIKAFISH_NNUE?.trim() || null;

  const candidates: string[] = [];
  const envExe = process.env.PIKAFISH_PATH?.trim();
  if (envExe) candidates.push(envExe);

  const roots = [rootDir()];
  const resources = process.resourcesPath;
  if (typeof resources === 'string' && resources && resources !== roots[0]) roots.push(resources);
  for (const root of roots) {
    candidates.push(path.join(root, 'dist', 'engine', file));
    candidates.push(path.join(root, 'Reference', REFERENCE_DIR, file));
  }

  for (const raw of candidates) {
    const exe = unpackedPath(raw);
    if (existsSync(exe)) return { exe, nnue };
  }
  return null;
}

/** 等待中的一条 UCI 响应 */
interface Waiter {
  pred: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** 皮卡鱼引擎：惰性启动、串行队列、空闲回收、进程崩溃后自动重启 */
export class PikafishEngine implements EnginePort {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private waiter: Waiter | null = null;
  private lineBuffer = '';
  private idle: NodeJS.Timeout | null = null;
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private startFailures = 0;
  private disposed = false;

  /** 释放引擎（幂等）：终止子进程并清空等待 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  async bestMove(board: Board, side: Side, level: EngineLevel): Promise<EngineResult> {
    if (this.pending >= MAX_PENDING) throw new Error('皮卡鱼请求排队过多');
    this.pending += 1;
    try {
      return await this.enqueue(() => this.query(board, side, level));
    } finally {
      this.pending -= 1;
    }
  }

  /** 串行化：stdin 上不能交错 `position`/`go` */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async query(board: Board, side: Side, level: EngineLevel): Promise<EngineResult> {
    const params = LEVEL_PARAMS[level];
    await this.ensureStarted();
    const proc = this.proc;
    if (!proc) throw new Error('皮卡鱼引擎未就绪');

    this.setOption('Skill Level', String(params.skill));
    proc.stdin.write(`position fen ${boardToFen(board, side)}\n`);
    proc.stdin.write(`go movetime ${params.movetimeMs}\n`);
    const line = await this.readLine((l) => l.startsWith('bestmove'), params.movetimeMs + 5_000);
    this.touchIdle();
    return { move: parseBestMove(line), source: 'pikafish' };
  }

  private ensureStarted(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('引擎已释放'));
    if (this.proc && this.ready) return Promise.resolve();
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async start(): Promise<void> {
    if (this.startFailures >= MAX_START_FAILURES) throw new Error('皮卡鱼反复启动失败，已停用');

    const loc = findEngine();
    if (!loc) throw new Error('未找到皮卡鱼引擎文件');

    // cwd 取引擎所在目录：皮卡鱼会在同目录自动查找 pikafish.nnue
    const proc = spawn(loc.exe, [], { cwd: path.dirname(loc.exe), windowsHide: true });
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr.on('data', (chunk: Buffer | string) => logDebug(`[皮卡鱼] ${String(chunk).trim()}`));
    proc.on('exit', (code) => {
      if (this.proc === proc) this.onExit(code);
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.onExit(null, err);
    });
    proc.stdin.on('error', () => {
      if (this.proc === proc) this.onExit(null);
    });
    proc.unref();

    this.proc = proc;
    this.ready = false;
    this.lineBuffer = '';

    try {
      proc.stdin.write('uci\n');
      await this.readLine((l) => l === 'uciok', HANDSHAKE_MS);
      this.setOption('Threads', String(THREADS));
      this.setOption('Hash', String(HASH_MB));
      if (loc.nnue) this.setOption('EvalFile', loc.nnue);
      proc.stdin.write('isready\n');
      await this.readLine((l) => l === 'readyok', HANDSHAKE_MS);
    } catch (err) {
      this.startFailures += 1;
      this.stop();
      throw err instanceof Error ? err : new Error(String(err));
    }

    this.ready = true;
    this.startFailures = 0;
    logInfo(`皮卡鱼引擎就绪：${loc.exe}`);
  }

  /** 子进程退出 / 启动出错：清状态并让在等的请求失败 */
  private onExit(code: number | null, err?: Error): void {
    this.proc = null;
    this.ready = false;
    this.failWaiter(err ?? new Error(`皮卡鱼进程退出（code ${code}）`));
  }

  /** 停止并（尽力）回收子进程 */
  private stop(): void {
    if (this.idle) {
      clearTimeout(this.idle);
      this.idle = null;
    }
    const proc = this.proc;
    this.proc = null;
    this.ready = false;
    this.failWaiter(new Error('皮卡鱼引擎已停止'));
    if (!proc) return;
    try {
      proc.stdin.write('quit\n');
      proc.stdin.end();
    } catch {
      // 进程可能已退出，忽略
    }
    const killer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // 已退出，忽略
      }
    }, 1_000);
    killer.unref?.();
    proc.once('exit', () => clearTimeout(killer));
  }

  private touchIdle(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_MS);
    this.idle.unref?.();
  }

  private setOption(name: string, value: string): void {
    this.proc?.stdin.write(`setoption name ${name} value ${value}\n`);
  }

  /** 读取到第一条满足 `pred` 的输出行 */
  private readLine(pred: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.timer === timer) this.waiter = null;
        reject(new Error('皮卡鱼响应超时'));
      }, timeoutMs);
      timer.unref?.();
      this.waiter = { pred, resolve, reject, timer };
    });
  }

  private failWaiter(err: Error): void {
    const w = this.waiter;
    if (!w) return;
    this.waiter = null;
    clearTimeout(w.timer);
    w.reject(err);
  }

  private onData(chunk: string): void {
    this.lineBuffer += chunk;
    let idx = this.lineBuffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.lineBuffer.slice(0, idx).replace(/\r$/, '').trim();
      this.lineBuffer = this.lineBuffer.slice(idx + 1);
      if (line) this.dispatch(line);
      idx = this.lineBuffer.indexOf('\n');
    }
  }

  private dispatch(line: string): void {
    const w = this.waiter;
    if (!w || !w.pred(line)) {
      logDebug(`[皮卡鱼] ${line}`);
      return;
    }
    this.waiter = null;
    clearTimeout(w.timer);
    w.resolve(line);
  }
}
