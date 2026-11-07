/**
 * 桌面客户端「本机服务」开关：
 * 1) 共享纯函数（计划任务名契约 / 偏好缺省值）；
 * 2) 外壳服务的 `/api/local-service` 开关接口与无头 `--server` 的本机 shutdown 接口。
 */

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { GameServer, LocalShutdownControl } from '../src/server/server.js';
import { LocalEngine } from '../src/shared/engine.js';
import {
  LOCAL_SERVICE_TASK_NAME,
  LocalServiceController,
  LocalServiceStatus,
  parseLocalServicePref,
} from '../src/shared/local-service.js';

let server: GameServer | null = null;

/** 随机高位端口启动一个仅测试用的服务（关闭静态资源与落盘） */
async function startServer(
  controller?: LocalServiceController,
  shutdown?: LocalShutdownControl,
): Promise<GameServer> {
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const candidate = new GameServer({
      port: 20000 + Math.floor(Math.random() * 30000),
      staticDir: null,
      host: '127.0.0.1',
      dataDir: null,
      engine: new LocalEngine(),
      localService: controller,
      shutdown,
    });
    try {
      await candidate.listen();
      server = candidate;
      return candidate;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('无法启动测试服务');
}

afterEach(async () => {
  await server?.close();
  server = null;
});

/** 假控制器：记录开关调用并返回对应状态 */
function fakeController(initial: boolean): {
  controller: LocalServiceController;
  calls: boolean[];
} {
  let enabled = initial;
  const calls: boolean[] = [];
  const status = (): LocalServiceStatus => ({
    supported: true,
    enabled,
    running: enabled,
    mode: 'builtin',
    port: 27310,
  });
  return {
    calls,
    controller: {
      status: async () => status(),
      setEnabled: async (next) => {
        calls.push(next);
        enabled = next;
        return status();
      },
    },
  };
}

describe('本机服务纯函数', () => {
  it('计划任务名与安装脚本保持一致', () => {
    const install = readFileSync(new URL('../scripts/install-autostart.ps1', import.meta.url), 'utf8');
    expect(install).toContain(`$TaskName = '${LOCAL_SERVICE_TASK_NAME}'`);
  });

  it('本机服务偏好缺省开启，只有明确 enabled=false 才关闭', () => {
    expect(parseLocalServicePref(null)).toBe(true);
    expect(parseLocalServicePref('')).toBe(true);
    expect(parseLocalServicePref('{')).toBe(true);
    expect(parseLocalServicePref('{"enabled":true}')).toBe(true);
    expect(parseLocalServicePref('{"enabled":false}')).toBe(false);
    expect(parseLocalServicePref('{"enabled":"no"}')).toBe(true);
  });
});

describe('本机服务 HTTP 控制接口', () => {
  it('远端服务器未注入控制器时返回 404', async () => {
    const s = await startServer();
    const res = await fetch(`http://127.0.0.1:${s.address.port}/api/local-service`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it('GET 查询状态，POST 切换开关；非法方法与参数被拒', async () => {
    const fake = fakeController(true);
    const s = await startServer(fake.controller);
    const url = `http://127.0.0.1:${s.address.port}/api/local-service`;

    const initial = await fetch(url);
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ enabled: true, running: true, port: 27310 });

    const off = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ enabled: false, running: false });
    expect(fake.calls).toEqual([false]);

    const on = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(await on.json()).toMatchObject({ enabled: true, running: true });
    expect(fake.calls).toEqual([false, true]);

    // 参数缺失 / 非布尔
    const badBody = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    expect(badBody.status).toBe(400);

    // 不支持的方法
    const put = await fetch(url, { method: 'PUT' });
    expect(put.status).toBe(405);
  });

  it('本机 shutdown 接口：未注入时 404，错误 token 403，正确 token 触发关闭', async () => {
    const plain = await startServer();
    const notFound = await fetch(`http://127.0.0.1:${plain.address.port}/api/local-service/shutdown`, {
      method: 'POST',
      body: '{}',
    });
    expect(notFound.status).toBe(404);
    await plain.close();
    server = null;

    let closed = false;
    const s = await startServer(undefined, {
      token: 'secret-token-for-test',
      run: () => {
        closed = true;
      },
    });
    const url = `http://127.0.0.1:${s.address.port}/api/local-service/shutdown`;
    const post = (body: unknown) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const bad = await post({ token: 'wrong-token' });
    expect(bad.status).toBe(403);
    expect(closed).toBe(false);

    const ok = await post({ token: 'secret-token-for-test' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 120));
    expect(closed).toBe(true);
  });
});
