/**
 * 局域网服务器发现。
 *
 * 浏览器无法使用 mDNS / UDP 广播，因此采用「同网段 WebSocket 探测」：
 * 逐个连接 `ws://<ip>:<port>/ws` 后发送 `ping`，收到带服务器自我声明地址的 `pong`
 * 即判定该地址是本游戏服务器；同一服务器经多个地址命中时按声明地址去重。
 */

import { decode, encode, ServerMessage } from '../shared/protocol.js';

export interface DiscoveredServer {
  ip: string;
  port: number;
}

/** 探测所需的最小 WebSocket 接口（便于测试注入） */
export interface DiscoverSocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close(): void;
  send(data: string): void;
}

export type SocketFactory = (url: string) => DiscoverSocketLike;

const defaultSocket: SocketFactory = (url) => new WebSocket(url) as unknown as DiscoverSocketLike;

export interface ProbeOptions {
  /** 单地址探测超时（毫秒），默认 300 */
  timeoutMs?: number;
  createSocket?: SocketFactory;
}

/** 探测单个地址是否为本游戏服务器；是则返回其声明的地址 */
export function probeServer(
  ip: string,
  port: number,
  opts: ProbeOptions = {},
): Promise<DiscoveredServer | null> {
  const timeoutMs = opts.timeoutMs ?? 300;
  const create = opts.createSocket ?? defaultSocket;
  return new Promise((resolve) => {
    let settled = false;
    let socket: DiscoverSocketLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: DiscoveredServer | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* 忽略关闭异常 */
      }
      resolve(result);
    };

    try {
      socket = create(`ws://${ip}:${port}/ws`);
    } catch {
      return resolve(null);
    }
    timer = setTimeout(() => finish(null), timeoutMs);
    socket.onopen = () => {
      try {
        socket?.send(encode({ type: 'ping', t: 0 }));
      } catch {
        finish(null);
      }
    };
    socket.onmessage = (ev) => {
      const msg = decode(typeof ev.data === 'string' ? ev.data : '') as ServerMessage | null;
      if (msg && msg.type === 'pong') {
        const advertisedIp = typeof msg.ip === 'string' && msg.ip ? msg.ip : ip;
        const advertisedPort = typeof msg.port === 'number' && msg.port ? msg.port : port;
        finish({ ip: advertisedIp, port: advertisedPort });
      }
    };
    socket.onerror = () => finish(null);
  });
}

export interface DiscoverOptions extends ProbeOptions {
  /** 并发探测数，默认 24 */
  concurrency?: number;
  /** 进度回调（已完成数 / 总数） */
  onProgress?: (done: number, total: number) => void;
}

/** 扫描 `<prefix>.1` ~ `<prefix>.254` 的同网段服务器（按声明地址去重） */
export async function discoverSubnet(
  prefix: string,
  port: number,
  opts: DiscoverOptions = {},
): Promise<DiscoveredServer[]> {
  const timeoutMs = opts.timeoutMs ?? 400;
  const concurrency = Math.max(1, opts.concurrency ?? 24);
  const ips = Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
  const found = new Map<string, DiscoveredServer>();
  let index = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    while (index < ips.length) {
      const ip = ips[index++];
      const hit = await probeServer(ip, port, { timeoutMs, createSocket: opts.createSocket });
      done += 1;
      opts.onProgress?.(done, ips.length);
      if (hit) {
        const key = `${hit.ip}:${hit.port}`;
        if (!found.has(key)) found.set(key, hit);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return [...found.values()];
}
