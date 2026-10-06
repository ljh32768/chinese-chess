/**
 * 局域网主机发现（D1）测试。
 * 覆盖：真实主机探测、关闭端口返回 null、网段扫描聚合与去重。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { HostServer } from '../src/server/host-server.js';
import { DiscoverSocketLike, DiscoveredHost, discoverSubnet, probeHost } from '../src/renderer/discover.js';

/** 用 ws 包真实连接（浏览器里默认用全局 WebSocket） */
const wsFactory = (url: string): DiscoverSocketLike => new WebSocket(url) as unknown as DiscoverSocketLike;

let server: HostServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function startServer(): Promise<HostServer> {
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const candidate = new HostServer({
      port: 20000 + Math.floor(Math.random() * 30000),
      staticDir: null,
      host: '127.0.0.1',
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

/** 假 WebSocket：仅当目标 IP 在命中集合内时回应 pong（声明统一地址） */
class FakeSocket implements DiscoverSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly respond: boolean) {
    queueMicrotask(() => this.onopen?.());
  }

  send(data: string): void {
    if (!this.respond) {
      queueMicrotask(() => this.onerror?.());
      return;
    }
    const t = (JSON.parse(data) as { t: number }).t;
    queueMicrotask(() =>
      this.onmessage?.({
        data: JSON.stringify({ type: 'pong', t, ip: '192.168.9.9', port: 7777 }),
      }),
    );
  }

  close(): void {}
}

describe('局域网主机发现', () => {
  it('probeHost 命中真实主机，返回其自我声明的地址', async () => {
    const s = await startServer();
    // 放宽单地址超时：探测真实 WebSocket 的握手 + pong 往返，并行跑测试时墙钟可能抖动
    const hit = await probeHost('127.0.0.1', s.address.port, { createSocket: wsFactory, timeoutMs: 2000 });
    expect(hit).not.toBeNull();
    expect(hit?.port).toBe(s.address.port);
    expect(hit?.ip).toBeTruthy();
  });

  it('probeHost 对无服务端口返回 null', async () => {
    const hit = await probeHost('127.0.0.1', 9, { createSocket: wsFactory, timeoutMs: 300 });
    expect(hit).toBeNull();
  });

  it('discoverSubnet 扫描网段、按声明地址去重并汇报进度', async () => {
    const responder = new Set(['192.168.9.3', '192.168.9.7']);
    const factory = (url: string): DiscoverSocketLike => {
      const ip = /ws:\/\/([\d.]+):/.exec(url)?.[1] ?? '';
      return new FakeSocket(responder.has(ip));
    };
    const progress: number[] = [];

    const found: DiscoveredHost[] = await discoverSubnet('192.168.9', 7777, {
      createSocket: factory,
      timeoutMs: 50,
      concurrency: 16,
      onProgress: (done) => progress.push(done),
    });

    // 两个地址命中的是同一台主机（声明地址一致），去重后只剩一条
    expect(found).toEqual([{ ip: '192.168.9.9', port: 7777 }]);
    expect(progress).toHaveLength(254);
    expect(progress[progress.length - 1]).toBe(254);
  });
});
