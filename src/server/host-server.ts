/**
 * 主机端服务：HTTP 静态资源 + 控制接口 + WebSocket 对局服务。
 *
 * - 主机权威：唯一棋盘状态保存在本进程的 Game 实例中。
 * - 客户端只发送走子意图，由这里校验后广播。
 * - 同一份前端页面既作为主机界面，也可被加入者的浏览器打开。
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMessage, ServerMessage, decode, encode, isValidPos } from '../shared/protocol.js';
import { Side } from '../shared/types.js';
import { Game } from './game.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

/** 虚拟网卡名字特征（WSL / Hyper-V / VirtualBox / VMware / Docker 等） */
const VIRTUAL_IFACE = /vEthernet|WSL|Hyper-?V|VirtualBox|VMware|Docker|Loopback|Tailscale|ZeroTier|VPN|TAP|TUN/i;

/**
 * 从网卡列表中挑选最可能的局域网 IPv4 地址。
 * 优先真实物理网卡的私有网段（192.168 > 10 > 172.16-31），跳过虚拟网卡。
 */
export function pickLanIp(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string | null {
  const candidates: Array<{ ip: string; score: number }> = [];
  for (const [name, infos] of Object.entries(ifaces)) {
    for (const info of infos ?? []) {
      // Node 18+ 的 family 可能是数字 4
      const isV4 = info.family === 'IPv4' || (info.family as unknown as number) === 4;
      if (!isV4 || info.internal) continue;
      let score = 0;
      if (/^192\.168\./.test(info.address)) score += 40;
      else if (/^10\./.test(info.address)) score += 30;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(info.address)) score += 20;
      else score += 10;
      if (VIRTUAL_IFACE.test(name)) score -= 100;
      candidates.push({ ip: info.address, score });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].ip;
}

/** 获取本机局域网 IPv4 地址（找不到则回退 127.0.0.1） */
export function getLanIp(): string {
  return pickLanIp(os.networkInterfaces()) ?? '127.0.0.1';
}

interface Conn {
  ws: WebSocket;
  role: 'host' | 'guest' | null;
  side: Side | null;
  /** 客户端主动发送 leave 后置位：断开时不做宽限等待，按「主动离开」立即清理 */
  leaving?: boolean;
}

export interface HostServerOptions {
  /** 监听端口，0 表示随机端口；默认 7777 */
  port?: number;
  /** 静态资源目录；null 表示不提供静态服务（仅测试用） */
  staticDir?: string | null;
  /** 监听地址，默认 0.0.0.0 */
  host?: string;
  /** 意外断线后的重连宽限期（毫秒）；默认 30000 */
  graceMs?: number;
}

export class HostServer {
  readonly game = new Game();
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private hostConn: Conn | null = null;
  private guestConn: Conn | null = null;
  private hosting = false;
  private port = 0;
  /** 意外断线后的宽限计时器（超时才真正清理席位） */
  private hostGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private guestGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly opts: Required<HostServerOptions>;

  constructor(opts: HostServerOptions = {}) {
    this.opts = {
      port: opts.port ?? 7777,
      staticDir: opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir,
      host: opts.host ?? '0.0.0.0',
      graceMs: opts.graceMs ?? 30000,
    };
  }

  /** 开始监听，返回实际端口 */
  listen(): Promise<number> {
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    this.httpServer = server;
    const wss = new WebSocketServer({ server, path: '/ws' });
    this.wss = wss;
    wss.on('connection', (ws) => this.handleConnection(ws));

    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(this.opts.port, this.opts.host, () => {
        server.off('error', onError);
        const addr = server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        resolve(this.port);
      });
    });
  }

  /** 关闭服务（断开所有连接，并取消宽限计时器） */
  close(): Promise<void> {
    this.cancelHostGrace();
    this.cancelGuestGrace();
    return new Promise((resolve) => {
      for (const c of [this.hostConn, this.guestConn]) c?.ws.close();
      const wss = this.wss;
      const server = this.httpServer;
      this.wss = null;
      this.httpServer = null;
      if (!wss || !server) return resolve();
      wss.close(() => server.close(() => resolve()));
    });
  }

  get address(): { ip: string; port: number } {
    return { ip: getLanIp(), port: this.port };
  }

  isHosting(): boolean {
    return this.hosting;
  }

  /** 开启 / 关闭「创建对局」的等待状态 */
  setHosting(on: boolean): void {
    this.hosting = on;
    if (on) {
      if (this.game.status === 'idle' || this.game.status === 'over') {
        this.game.reset('waiting');
      }
      this.maybeStart();
    } else {
      // 关闭等待：清空加入者，但不影响已进行的对局断开逻辑
      if (this.game.status === 'waiting') this.game.status = 'idle';
    }
  }

  // ---------------------------------------------------------------- HTTP

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === '/api/host-info') {
        return this.sendJson(res, 200, {
          ip: getLanIp(),
          port: this.port,
          hosting: this.hosting,
          hasHost: !!this.hostConn,
          hasGuest: !!this.guestConn,
          state: this.game.snapshot(),
        });
      }
      if (pathname === '/api/host/start') {
        this.setHosting(true);
        return this.sendJson(res, 200, { ip: getLanIp(), port: this.port });
      }
      if (pathname === '/api/host/stop') {
        this.setHosting(false);
        return this.sendJson(res, 200, { ok: true });
      }
      if (pathname.startsWith('/api/')) {
        return this.sendJson(res, 404, { error: 'not found' });
      }
      this.serveStatic(pathname, res);
    } catch (err) {
      this.sendJson(res, 500, { error: String(err) });
    }
  }

  private sendJson(res: http.ServerResponse, code: number, body: unknown): void {
    const data = JSON.stringify(body);
    res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(data);
  }

  /**
   * 静态资源解析：
   * 编译产物目录结构为 dist/renderer/*（页面与脚本）与 dist/shared/*（共享模块），
   * 页面里的 `../shared/rules.js` 会请求到 /shared/rules.js，因此这里以 dist 为根，
   * 找不到时再回退到 dist/renderer。
   */
  private serveStatic(pathname: string, res: http.ServerResponse): void {
    const root = this.opts.staticDir;
    if (!root) {
      res.writeHead(404);
      res.end('static disabled');
      return;
    }
    const rel = pathname === '/' ? 'renderer/index.html' : pathname.replace(/^\/+/, '');
    const rootResolved = path.resolve(root);
    const candidates = [path.resolve(rootResolved, rel), path.resolve(rootResolved, 'renderer', rel)];
    const filePath = candidates.find((p) => isInsideRoot(rootResolved, p) && fs.existsSync(p));

    if (!filePath) {
      // 路径穿越或文件不存在：一律按 404 处理，不回显敏感信息
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    });
  }

  // ----------------------------------------------------------- WebSocket

  private handleConnection(ws: WebSocket): void {
    const conn: Conn = { ws, role: null, side: null };

    ws.on('message', (raw) => {
      try {
        const msg = decode(raw.toString());
        if (!msg) return this.send(ws, { type: 'error', message: '无法解析的消息' });
        this.handleMessage(conn, msg as unknown as ClientMessage);
      } catch (err) {
        this.send(ws, { type: 'error', message: `服务端异常：${String(err)}` });
      }
    });

    ws.on('close', () => this.handleClose(conn));
    ws.on('error', () => this.handleClose(conn));
  }

  private handleMessage(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case 'join':
        return this.handleJoin(conn, msg.role);
      case 'move': {
        if (conn.side === null) return this.send(conn.ws, { type: 'error', message: '尚未加入对局' });
        const from = msg.from;
        const to = msg.to;
        // 坐标必须是整数对；越界由规则引擎按「越界」拒绝
        if (!isValidPos(from) || !isValidPos(to)) {
          return this.send(conn.ws, { type: 'move_rejected', from: from ?? [0, 0], to: to ?? [0, 0], reason: '坐标非法' });
        }
        const result = this.game.applyMove(from, to, conn.side);
        if (!result.ok) {
          return this.send(conn.ws, { type: 'move_rejected', from, to, reason: result.reason ?? '非法走子' });
        }
        const s = this.game.snapshot();
        const applied: ServerMessage = {
          type: 'move_applied',
          seq: s.moveSeq,
          from,
          to,
          board: s.board,
          turn: s.turn,
          check: s.check,
          status: s.status,
          winner: s.winner,
          reason: s.reason,
          lastMove: s.lastMove,
        };
        this.broadcast(applied);
        if (s.status === 'over') {
          this.broadcast({ type: 'game_over', winner: s.winner, reason: s.reason, state: s });
        }
        return;
      }
      case 'resign': {
        if (conn.side === null) return;
        this.game.resign(conn.side);
        const s = this.game.snapshot();
        this.broadcast({ type: 'game_over', winner: s.winner, reason: s.reason, state: s });
        return;
      }
      case 'draw_request': {
        if (conn.side === null || this.game.status !== 'playing') return;
        this.game.pendingDraw = conn.side;
        this.sendTo(conn.side === 'r' ? 'b' : 'r', { type: 'draw_request' });
        return;
      }
      case 'draw_response': {
        if (conn.side === null) return;
        const requester = this.game.pendingDraw;
        if (requester === null || requester === conn.side) return;
        if (msg.accept) {
          this.game.acceptDraw();
          this.broadcast({ type: 'draw_response', accept: true });
          const s = this.game.snapshot();
          this.broadcast({ type: 'game_over', winner: s.winner, reason: s.reason, state: s });
        } else {
          this.game.pendingDraw = null;
          this.sendTo(requester, { type: 'draw_response', accept: false });
        }
        return;
      }
      case 'restart_request': {
        if (conn.side === null || !this.game.canRestart()) return;
        this.game.pendingRestart = conn.side;
        this.sendTo(conn.side === 'r' ? 'b' : 'r', { type: 'restart_request' });
        return;
      }
      case 'restart_response': {
        if (conn.side === null) return;
        const requester = this.game.pendingRestart;
        if (requester === null || requester === conn.side) return;
        this.game.pendingRestart = null;
        if (msg.accept) {
          this.broadcast({ type: 'restart_response', accept: true });
          this.startGame();
        } else {
          this.sendTo(requester, { type: 'restart_response', accept: false });
        }
        return;
      }
      case 'wait_new_opponent': {
        // 仅主机可用：放弃等待断线对手，立即清空席位并回到「等待新对手」
        if (conn.role !== 'host') return;
        if (!this.guestGraceTimer) {
          return this.send(conn.ws, { type: 'error', message: '当前没有等待重连的对手' });
        }
        this.cancelGuestGrace();
        this.dropGuestSeat('已放弃等待对方重连');
        return;
      }
      case 'leave': {
        // 标记为主动离开：断开时不做宽限等待
        conn.leaving = true;
        conn.ws.close();
        return;
      }
      case 'ping': {
        return this.send(conn.ws, { type: 'pong', t: msg.t });
      }
      default:
        return this.send(conn.ws, { type: 'error', message: '未知消息类型' });
    }
  }

  private handleJoin(conn: Conn, role: 'host' | 'guest'): void {
    if (conn.role !== null) {
      return this.send(conn.ws, { type: 'error', message: '你已经加入对局' });
    }
    if (role === 'host') {
      if (this.hostConn && this.hostConn.ws !== conn.ws) {
        return this.send(conn.ws, { type: 'error', message: '主机端已存在' });
      }
      // 宽限期内同阵营重连：保留原对局与回合
      const rejoining = this.game.status === 'playing';
      this.cancelHostGrace();
      conn.role = 'host';
      conn.side = 'r';
      this.hostConn = conn;
      if (!rejoining) this.game.status = this.hosting ? 'waiting' : 'idle';
      this.send(conn.ws, {
        type: 'welcome',
        side: 'r',
        hostIp: getLanIp(),
        port: this.port,
        state: this.game.snapshot(),
      });
      if (rejoining) {
        // 通知加入者主机已回来，并同步最新快照
        this.sendTo('b', { type: 'opponent_joined' });
        this.broadcast({ type: 'state', state: this.game.snapshot() });
      } else if (this.hosting && this.guestConn) {
        this.send(conn.ws, { type: 'opponent_joined' });
      }
      this.maybeStart();
      return;
    }

    // guest
    if (!this.hosting) {
      return this.send(conn.ws, { type: 'error', message: '主机尚未创建对局' });
    }
    if (this.guestConn && this.guestConn.ws !== conn.ws) {
      return this.send(conn.ws, { type: 'error', message: '对局已满，无法加入' });
    }
    // 宽限期内同阵营重连：保留原对局与回合
    const rejoining = this.game.status === 'playing';
    this.cancelGuestGrace();
    conn.role = 'guest';
    conn.side = 'b';
    this.guestConn = conn;
    this.send(conn.ws, {
      type: 'welcome',
      side: 'b',
      hostIp: getLanIp(),
      port: this.port,
      state: this.game.snapshot(),
    });
    this.sendTo('r', { type: 'opponent_joined' });
    if (rejoining) this.broadcast({ type: 'state', state: this.game.snapshot() });
    this.maybeStart();
  }

  private maybeStart(): void {
    if (!this.hosting) return;
    if (!this.hostConn || !this.guestConn) return;
    if (this.game.status !== 'idle' && this.game.status !== 'waiting') return;
    this.startGame();
  }

  private startGame(): void {
    this.game.reset('playing');
    const s = this.game.snapshot();
    this.broadcast({ type: 'start', state: s });
  }

  private handleClose(conn: Conn): void {
    if (conn.role === 'host' && this.hostConn === conn) {
      this.hostConn = null;
      if (conn.leaving || this.game.status !== 'playing') {
        // 主动离开或未在局中：立即清理（原语义）
        this.cancelGuestGrace();
        this.sendTo('b', { type: 'opponent_left', reason: '主机已离开' });
        this.hosting = false;
        if (this.game.status === 'playing') this.game.status = 'idle';
      } else {
        // 意外断线：保留对局与主机席位，宽限期内可重连
        this.startHostGrace();
        this.sendTo('b', { type: 'opponent_away', reason: '主机已断开', graceMs: this.opts.graceMs });
      }
    } else if (conn.role === 'guest' && this.guestConn === conn) {
      this.guestConn = null;
      if (conn.leaving || this.game.status !== 'playing') {
        this.sendTo('r', { type: 'opponent_left', reason: '对手已离开' });
        if (this.game.status === 'playing') {
          this.game.status = this.hosting ? 'waiting' : 'idle';
        }
      } else {
        // 意外断线：保留对局与客方席位，宽限期内可重连
        this.startGuestGrace();
        this.sendTo('r', { type: 'opponent_away', reason: '对手已断开', graceMs: this.opts.graceMs });
      }
    }
  }

  // ------------------------------------------------------- 断线重连宽限

  /** 主机意外断线：启动宽限计时，超时前可重连恢复原局 */
  private startHostGrace(): void {
    this.cancelHostGrace();
    const timer = setTimeout(() => {
      this.hostGraceTimer = null;
      this.expireHostGrace();
    }, this.opts.graceMs);
    timer.unref();
    this.hostGraceTimer = timer;
  }

  private cancelHostGrace(): void {
    if (this.hostGraceTimer) {
      clearTimeout(this.hostGraceTimer);
      this.hostGraceTimer = null;
    }
  }

  /** 主机宽限超时：释放席位，服务回到未开局状态 */
  private expireHostGrace(): void {
    if (this.hostConn) return; // 宽限期内已重连
    this.hosting = false;
    this.game.reset('idle');
    this.sendTo('b', { type: 'opponent_left', reason: '主机已离开' });
  }

  /** 加入者意外断线：启动宽限计时，超时前可重连恢复原局 */
  private startGuestGrace(): void {
    this.cancelGuestGrace();
    const timer = setTimeout(() => {
      this.guestGraceTimer = null;
      this.expireGuestGrace();
    }, this.opts.graceMs);
    timer.unref();
    this.guestGraceTimer = timer;
  }

  private cancelGuestGrace(): void {
    if (this.guestGraceTimer) {
      clearTimeout(this.guestGraceTimer);
      this.guestGraceTimer = null;
    }
  }

  /** 加入者宽限超时：清空席位，主机回到等待新对手 */
  private expireGuestGrace(): void {
    if (this.guestConn) return; // 宽限期内已重连
    this.dropGuestSeat('对手已离开');
  }

  /** 清空客方席位并重置为等待状态（宽限超时 / 主机放弃等待时调用） */
  private dropGuestSeat(reason: string): void {
    this.guestConn = null;
    this.game.reset(this.hosting ? 'waiting' : 'idle');
    this.sendTo('r', { type: 'state', state: this.game.snapshot() });
    this.sendTo('r', { type: 'opponent_left', reason });
  }

  // ------------------------------------------------------------ 发送工具

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
  }

  private sendTo(side: Side, msg: ServerMessage): void {
    const conn = side === 'r' ? this.hostConn : this.guestConn;
    if (conn) this.send(conn.ws, msg);
  }

  private broadcast(msg: ServerMessage): void {
    this.sendTo('r', msg);
    this.sendTo('b', msg);
  }
}

/** 目标路径必须位于 root 内：防 `../` 穿越，也防「dist-evil」类同前缀兄弟目录误判 */
function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function defaultStaticDir(): string {
  // 编译产物：dist/server/host-server.js → 静态根目录为 dist
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}