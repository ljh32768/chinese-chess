/**
 * 渲染层 WebSocket 客户端（net.ts）单元测试。
 * 覆盖：连接建立、消息分发、pong 内部消化、心跳发送、pong 超时判定为断线、
 * 主动关闭不触发断线提示、连接失败拒绝。
 * 使用假定时器 + 假 WebSocket，不依赖真实网络。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net } from '../src/renderer/net.js';

/** 假 WebSocket：记录发送内容，支持手动触发 open / message / close */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  /** 收到的消息类型序列 */
  types(): string[] {
    return this.sent.map((raw) => (JSON.parse(raw) as { type: string }).type);
  }
}

const makeNet = () => {
  const onMessage = vi.fn();
  const onClosed = vi.fn();
  const net = new Net({ onMessage, onClosed });
  return { net, onMessage, onClosed };
};

const lastSocket = (): FakeSocket => FakeSocket.instances[FakeSocket.instances.length - 1];

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  // net.ts 在浏览器环境使用 window.setInterval，这里注入假定时器版本
  (globalThis as unknown as { window: unknown }).window = {
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  };
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('渲染层 WebSocket 客户端 Net', () => {
  it('连接建立后 resolve，并转发非心跳消息', async () => {
    const { net, onMessage } = makeNet();
    const promise = net.connect('ws://192.168.1.2:7777/ws');
    const s = lastSocket();
    s.open();
    await expect(promise).resolves.toBeUndefined();
    expect(net.connected).toBe(true);

    s.receive({ type: 'room_joined', roomId: '123456', seat: 'b' });
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'room_joined', roomId: '123456' }),
    );
  });

  it('pong 由内部消化，不转发给上层', async () => {
    const { net, onMessage } = makeNet();
    const promise = net.connect('ws://x/ws');
    const s = lastSocket();
    s.open();
    await promise;

    s.receive({ type: 'pong', t: 1 });
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('心跳每 5s 发送 ping；16s 未收到 pong 判定断线并回调 onClosed', async () => {
    const { net, onClosed } = makeNet();
    const promise = net.connect('ws://x/ws');
    const s = lastSocket();
    s.open();
    await promise;

    vi.advanceTimersByTime(5000);
    expect(s.types()).toContain('ping');

    // 收到 pong 可续命：再过 10s 不应断线
    s.receive({ type: 'pong', t: Date.now() });
    vi.advanceTimersByTime(10000);
    expect(onClosed).not.toHaveBeenCalled();

    // 持续无 pong：超过 16s 阈值后主动关闭并通知断线
    vi.advanceTimersByTime(10000);
    expect(s.readyState).toBe(FakeSocket.CLOSED);
    expect(onClosed).toHaveBeenCalledWith('连接已断开');
  });

  it('主动 close 不触发断线提示', async () => {
    const { net, onClosed } = makeNet();
    const promise = net.connect('ws://x/ws');
    const s = lastSocket();
    s.open();
    await promise;

    net.close();
    expect(s.readyState).toBe(FakeSocket.CLOSED);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('连接失败时 reject', async () => {
    const { net } = makeNet();
    const promise = net.connect('ws://x/ws');
    const s = lastSocket();
    s.onerror?.();
    await expect(promise).rejects.toThrow('无法连接到服务器');
  });
});
