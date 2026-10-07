/**
 * 浏览器端 WebSocket 客户端：连接、心跳、消息分发。
 *
 * 只负责「连接已建立」与「消息收发」；创建 / 加入房间由调用方在连接后发送
 * `create_room` / `join_room`（见 shared/protocol.ts），因此这里不再有握手角色概念。
 */

import { ClientMessage, ServerMessage, decode, encode } from '../shared/protocol.js';

export interface NetHandlers {
  onMessage(msg: ServerMessage): void;
  /** 非主动关闭（对端断开 / 网络异常） */
  onClosed(reason: string): void;
}

const PING_INTERVAL = 5000;
const PONG_TIMEOUT = 16000;

export class Net {
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private lastPongAt = 0;
  private closing = false;

  constructor(private readonly handlers: NetHandlers) {}

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** 建立连接（open 即 resolve；连接失败 reject） */
  connect(url: string): Promise<void> {
    this.closing = false;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error('地址格式不正确'));
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        settled = true;
        this.lastPongAt = Date.now();
        this.startPing();
        resolve();
      };

      ws.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        const msg = decode(raw) as ServerMessage | null;
        if (!msg) return;
        // 心跳回应由客户端内部消化，不打扰上层
        if (msg.type === 'pong') {
          this.lastPongAt = Date.now();
          return;
        }
        this.handlers.onMessage(msg);
      };

      ws.onclose = () => {
        this.stopPing();
        if (!settled) {
          settled = true;
          reject(new Error('无法连接到服务器'));
          return;
        }
        if (!this.closing) this.handlers.onClosed('连接已断开');
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('无法连接到服务器'));
        }
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  close(): void {
    this.closing = true;
    this.stopPing();
    try {
      this.ws?.close();
    } catch {
      /* 忽略关闭异常 */
    }
    this.ws = null;
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.send({ type: 'ping', t: Date.now() });
      // 长时间没有 pong，视为断线
      if (Date.now() - this.lastPongAt > PONG_TIMEOUT) {
        try {
          this.ws?.close();
        } catch {
          /* 忽略 */
        }
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = 0;
    }
  }
}
