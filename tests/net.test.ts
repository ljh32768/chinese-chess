/**
 * 渲染层 WebSocket 客户端（net.ts）单元测试（C3）。
 * 覆盖：连接握手、心跳发送、pong 超时判定为断线、主动关闭不触发断线提示、error 拒绝。
 * 使用假定时器 + 假 WebSocket，不依赖真实网络。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Net, WelcomeInfo } from '../src/renderer/net.js';

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

const welcome = (): WelcomeInfo => ({
  side: 'b',
  hostIp: '192.168.1.2',
  port: 7777,
  state: {
    board: [],
    turn: 'r',
    moveSeq: 0,
    status: 'waiting',
    winner: null,
    reason: '',
    lastMove: null,
    check: false,
    history: [],
    deadline: null,
  },
});

const makeNet = () => {
  const onWelcome = vi.fn();
  const onMessage = vi.fn();
  const onClosed = vi.fn();
  const net = new Net({ onWelcome, onMessage, onClosed });
  return { net, onWelcome, onMessage, onClosed };
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
  it('连接后发送 join，收到 welcome 后 resolve 并回调', async () => {
    const { net, onWelcome } = makeNet();
    const promise = net.connect('ws://192.168.1.2:7777/ws', 'guest');
    const s = lastSocket();

    s.open();
    expect(s.types()).toEqual(['join']);
    expect(JSON.parse(s.sent[0])).toMatchObject({ type: 'join', role: 'guest' });

    s.receive({ type: 'welcome', ...welcome() });
    await expect(promise).resolves.toBeUndefined();
    expect(onWelcome).toHaveBeenCalledTimes(1);
    expect(onWelcome.mock.calls[0][0]).toMatchObject({ side: 'b', port: 7777 });
  });

  it('心跳每 5s 发送 ping；16s 未收到 pong 判定断线并回调 onClosed', async () => {
    const { net, onClosed } = makeNet();
    const promise = net.connect('ws://x/ws', 'guest');
    const s = lastSocket();
    s.open();
    s.receive({ type: 'welcome', ...welcome() });
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
    const promise = net.connect('ws://x/ws', 'guest');
    const s = lastSocket();
    s.open();
    s.receive({ type: 'welcome', ...welcome() });
    await promise;

    net.close();
    expect(s.readyState).toBe(FakeSocket.CLOSED);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('未完成握手时收到 error 会 reject；其它消息转发给 onMessage', async () => {
    const { net } = makeNet();
    const promise = net.connect('ws://x/ws', 'guest');
    const s = lastSocket();
    s.open();
    s.receive({ type: 'error', message: '主机尚未创建对局' });
    await expect(promise).rejects.toThrow('主机尚未创建对局');

    const { net: net2, onWelcome, onMessage: onMessage2 } = makeNet();
    const promise2 = net2.connect('ws://x/ws', 'guest');
    const s2 = lastSocket();
    s2.open();
    s2.receive({ type: 'welcome', ...welcome() });
    await promise2;
    expect(onWelcome).toHaveBeenCalled();
    s2.receive({ type: 'move_applied', seq: 1 });
    expect(onMessage2).toHaveBeenCalledWith(expect.objectContaining({ type: 'move_applied', seq: 1 }));
  });
});
