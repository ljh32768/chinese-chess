/**
 * 浏览器端 WebSocket 客户端：连接、心跳、消息分发。
 */

import { ClientMessage, Role, ServerMessage, decode, encode } from '../shared/protocol.js';
import { FirstMode, GameSnapshot, Side } from '../shared/types.js';

export interface WelcomeInfo {
  /** 分配阵营；观战者为 null */
  side: Side | null;
  hostIp: string;
  port: number;
  state: GameSnapshot;
  /** 主机选择的先手（红方）方式（随机 / 猜先时开赛前才最终确定席位） */
  firstMode: FirstMode;
}

export interface NetHandlers {
  onWelcome(info: WelcomeInfo): void;
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

  /** 建立连接并发送 join；收到 welcome 或错误后 resolve / reject */
  connect(url: string, role: Role): Promise<void> {
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
        ws.send(encode({ type: 'join', role }));
      };

      ws.onmessage = (ev) => {
        const raw = typeof ev.data === 'string' ? ev.data : '';
        const msg = decode(raw) as ServerMessage | null;
        if (!msg) return;

        if (msg.type === 'welcome') {
          settled = true;
          this.lastPongAt = Date.now();
          this.startPing();
          this.handlers.onWelcome({
            side: msg.side,
            hostIp: msg.hostIp,
            port: msg.port,
            state: msg.state,
            firstMode: msg.firstMode,
          });
          resolve();
          return;
        }
        if (msg.type === 'pong') {
          this.lastPongAt = Date.now();
          return;
        }
        if (msg.type === 'error' && !settled) {
          settled = true;
          reject(new Error(msg.message));
          ws.close();
          return;
        }
        this.handlers.onMessage(msg);
      };

      ws.onclose = () => {
        this.stopPing();
        if (!settled) {
          settled = true;
          reject(new Error('无法连接到主机'));
          return;
        }
        if (!this.closing) this.handlers.onClosed('连接已断开');
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('无法连接到主机'));
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
