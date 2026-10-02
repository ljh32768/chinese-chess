/** 测试用的 WebSocket 客户端：可等待指定类型的服务端消息。 */

import { WebSocket } from 'ws';
import { ClientMessage, ServerMessage } from '../src/shared/protocol.js';

export class TestClient {
  readonly ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];

  constructor(port: number, path = '/ws') {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    this.ws.on('message', (raw: Buffer) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(raw.toString()) as ServerMessage;
      } catch {
        return;
      }
      const idx = this.waiters.findIndex((w) => w.pred(msg));
      if (idx >= 0) this.waiters.splice(idx, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  open(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  wait(pred: (m: ServerMessage) => boolean, timeout = 3000): Promise<ServerMessage> {
    const idx = this.queue.findIndex(pred);
    if (idx >= 0) return Promise.resolve(this.queue.splice(idx, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待服务端消息超时')), timeout);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  waitType<T extends ServerMessage['type']>(
    type: T,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.wait((m) => m.type === type) as Promise<Extract<ServerMessage, { type: T }>>;
  }

  /** 断言在给定时间内不会再收到该类型消息 */
  async expectNo(type: ServerMessage['type'], ms = 200): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
    const hit = this.queue.some((m) => m.type === type);
    if (hit) throw new Error(`不应收到 ${type} 消息`);
  }

  close(): void {
    this.ws.close();
  }
}