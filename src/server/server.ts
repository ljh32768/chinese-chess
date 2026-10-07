/**
 * 中心服务器：HTTP 静态资源 + 控制接口 + WebSocket 多房间对局服务。
 *
 * - 权威在服务器：每个房间持有唯一 `Game`，客户端只发送走子「意图」。
 * - 连接与房间解耦：先 `create_room` / `join_room` 进入房间，之后的对局消息属于该房间。
 * - 纯托管：服务器不占任何玩家席位；玩家一律通过浏览器 / Electron 客户端接入。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { ClientMessage, ServerMessage, decode } from '../shared/protocol.js';
import { GameRecord, PlayerRef, RoomMode, RoomSummary, Side } from '../shared/types.js';
import { AccountStore } from './accounts.js';
import { Conn, sendTo as wsSend } from './conn.js';
import { HistoryStore } from './history.js';
import { logDebug, logInfo } from './log.js';
import { hintFor, Room, RoomDeps } from './room.js';

/** 服务器版本（供 /api/server-info 展示） */
export const SERVER_VERSION = '2.0.0';

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav',
};

/** 虚拟网卡名字特征（WSL / Hyper-V / VirtualBox / VMware / Docker 等） */
const VIRTUAL_IFACE =
  /vEthernet|WSL|Hyper-?V|VirtualBox|VMware|Docker|Loopback|Tailscale|ZeroTier|VPN|TAP|TUN/i;

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

export interface GameServerOptions {
  /** 监听端口，0 表示随机端口；默认 7777 */
  port?: number;
  /** 静态资源目录；null 表示不提供静态服务（仅测试用） */
  staticDir?: string | null;
  /** 监听地址，默认 0.0.0.0 */
  host?: string;
  /** 意外断线后的重连宽限期（毫秒）；默认 30000 */
  graceMs?: number;
  /** 每回合限时（毫秒）；0 表示不限时（默认，可用环境变量 LANSCHESS_TURN_MS 覆盖） */
  turnMs?: number;
  /** 人机对战：AI 走子延迟（毫秒），默认 400 */
  aiDelayMs?: number;
  /** 人机对战：AI 搜索深度，默认 2 */
  aiDepth?: number;
  /** 并发房间上限，默认 50 */
  maxRooms?: number;
  /** 单房间观战人数上限，默认 20 */
  maxSpectators?: number;
  /** 房间无在线连接后的回收时长（毫秒），默认 60000 */
  roomIdleMs?: number;
  /** 终局后无人「再来一局」时的房间销毁时长（毫秒），默认 300000 */
  overTtlMs?: number;
  /** 账号与对局记录的持久化目录；null 表示仅内存 */
  dataDir?: string | null;
}

export class GameServer {
  readonly accounts: AccountStore;
  readonly history: HistoryStore;

  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Set<Conn>();
  private port = 0;
  private aiDepth: number;
  private readonly opts: Required<GameServerOptions>;

  constructor(opts: GameServerOptions = {}) {
    this.opts = {
      port: opts.port ?? 7777,
      staticDir: opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir,
      host: opts.host ?? '0.0.0.0',
      graceMs: opts.graceMs ?? 30000,
      turnMs: opts.turnMs ?? (Number(process.env.LANSCHESS_TURN_MS) || 0),
      aiDelayMs: opts.aiDelayMs ?? 400,
      aiDepth: opts.aiDepth ?? 2,
      maxRooms: opts.maxRooms ?? 50,
      maxSpectators: opts.maxSpectators ?? 20,
      roomIdleMs: opts.roomIdleMs ?? 60000,
      overTtlMs: opts.overTtlMs ?? 300000,
      dataDir: opts.dataDir === undefined ? path.resolve(process.cwd(), 'data') : opts.dataDir,
    };
    this.aiDepth = this.opts.aiDepth;
    this.accounts = new AccountStore(this.opts.dataDir);
    this.history = new HistoryStore(this.opts.dataDir);
  }

  /** 开始监听，返回实际端口 */
  listen(): Promise<number> {
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    this.httpServer = server;
    const wss = new WebSocketServer({ server, path: '/ws' });
    this.wss = wss;
    // 兜底错误监听：避免监听失败（如端口占用）在 ws/http 上以未捕获异常抛出
    server.on('error', (err) => logDebug(`HTTP 服务错误：${err.message}`));
    wss.on('error', (err) => logDebug(`WebSocket 服务错误：${err.message}`));
    wss.on('connection', (ws) => this.handleConnection(ws));

    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(this.opts.port, this.opts.host, () => {
        server.off('error', onError);
        const addr = server.address();
        this.port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        logInfo(`服务器已就绪：http://${getLanIp()}:${this.port}`);
        resolve(this.port);
      });
    });
  }

  /** 关闭服务（销毁所有房间、断开连接并落盘） */
  close(): Promise<void> {
    for (const room of [...this.rooms.values()]) room.close('服务器已关闭');
    this.history.flush();
    logInfo('服务器已关闭');
    return new Promise((resolve) => {
      for (const c of this.conns) c.ws.close();
      this.conns.clear();
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

  /** 房间数（测试与 /api/server-info 用） */
  get roomCount(): number {
    return this.rooms.size;
  }

  /** 按房间号取房间（测试用） */
  room(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** 房间列表（最近创建在前） */
  listRooms(): RoomSummary[] {
    return [...this.rooms.values()].map((r) => r.summary());
  }

  // ---------------------------------------------------------------- HTTP

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === '/api/auth/register' || pathname === '/api/auth/login') {
        void this.handleAuth(pathname.endsWith('register'), req, res);
        return;
      }
      if (pathname === '/api/server-info') {
        return this.sendJson(res, 200, {
          ip: getLanIp(),
          port: this.port,
          version: SERVER_VERSION,
          rooms: this.rooms.size,
          maxRooms: this.opts.maxRooms,
        });
      }
      if (pathname === '/api/rooms') {
        return this.sendJson(res, 200, { rooms: this.listRooms() });
      }
      // 对局回顾：列表（最近在前）与单局明细（含着法，供复盘逐步回放）
      if (pathname === '/api/history') {
        const roomId = url.searchParams.get('roomId');
        const games = roomId ? this.history.list().filter((g) => g.roomId === roomId) : this.history.list();
        return this.sendJson(res, 200, { games });
      }
      if (pathname.startsWith('/api/history/')) {
        const id = pathname.slice('/api/history/'.length);
        const record = this.history.get(id);
        if (!record) return this.sendJson(res, 404, { error: '记录不存在' });
        return this.sendJson(res, 200, record);
      }
      // AI 推荐：按记录 + 步数复原局面，返回该局面行棋方的推荐着法
      if (pathname === '/api/ai/hint') {
        const id = url.searchParams.get('id') ?? '';
        const record = this.history.get(id);
        if (!record) return this.sendJson(res, 404, { error: '记录不存在' });
        const index = Number(url.searchParams.get('index') ?? '0');
        const depth = Number(url.searchParams.get('depth') ?? '2');
        const hint = hintFor(record, index, depth);
        return this.sendJson(res, 200, hint ?? { none: true });
      }
      if (pathname.startsWith('/api/')) {
        return this.sendJson(res, 404, { error: 'not found' });
      }
      this.serveStatic(pathname, res);
    } catch (err) {
      this.sendJson(res, 500, { error: String(err) });
    }
  }

  /** 账号 REST 入口（与 WS 的 register / login 同源） */
  private async handleAuth(
    isRegister: boolean,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      if (req.method !== 'POST') return this.sendJson(res, 405, { error: '仅支持 POST' });
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as { username?: unknown; password?: unknown };
      const result = isRegister
        ? this.accounts.register(body.username, body.password)
        : this.accounts.login(body.username, body.password);
      if (!result.ok) return this.sendJson(res, 400, { error: result.error });
      return this.sendJson(res, 200, { token: result.token, username: result.username });
    } catch {
      this.sendJson(res, 400, { error: '请求体格式不正确' });
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
      logDebug(`静态资源未命中：${pathname}`);
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
    const conn: Conn = { ws, roomId: null, role: null, player: null };
    this.conns.add(conn);
    logDebug('收到新的 WebSocket 连接');

    ws.on('message', (raw) => {
      try {
        const msg = decode(raw.toString());
        if (!msg) {
          logDebug('无法解析的消息');
          return wsSend(conn, { type: 'error', message: '无法解析的消息' });
        }
        this.handleMessage(conn, msg as unknown as ClientMessage);
      } catch (err) {
        logDebug(`服务端异常：${String(err)}`);
        wsSend(conn, { type: 'error', message: `服务端异常：${String(err)}` });
      }
    });

    ws.on('close', () => this.handleClose(conn));
    ws.on('error', () => this.handleClose(conn));
  }

  private handleMessage(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case 'register':
        return this.handleAuthMessage(conn, true, msg.username, msg.password);
      case 'login':
        return this.handleAuthMessage(conn, false, msg.username, msg.password);
      case 'create_room':
        return this.handleCreateRoom(conn, msg);
      case 'join_room':
        return this.handleJoinRoom(conn, msg);
      case 'leave_room':
        return this.handleLeaveRoom(conn);
      case 'list_rooms':
        return wsSend(conn, { type: 'room_list', rooms: this.listRooms() });
      case 'ping':
        return wsSend(conn, { type: 'pong', t: msg.t, ip: getLanIp(), port: this.port });
      default: {
        // 其余消息都属于某个房间
        if (!conn.roomId) return wsSend(conn, { type: 'error', message: '尚未加入房间' });
        const room = this.rooms.get(conn.roomId);
        if (!room) return wsSend(conn, { type: 'error', message: '尚未加入房间' });
        return room.handleMessage(conn, msg);
      }
    }
  }

  private handleAuthMessage(conn: Conn, isRegister: boolean, username: unknown, password: unknown): void {
    const result = isRegister
      ? this.accounts.register(username, password)
      : this.accounts.login(username, password);
    if (!result.ok) return wsSend(conn, { type: 'error', message: result.error });
    conn.player = { id: `account:${result.username}`, name: result.username, kind: 'account' };
    wsSend(conn, { type: 'auth_ok', token: result.token, username: result.username });
  }

  private handleCreateRoom(conn: Conn, msg: Extract<ClientMessage, { type: 'create_room' }>): void {
    if (conn.roomId) return wsSend(conn, { type: 'error', message: '你已在房间中' });
    if (this.rooms.size >= this.opts.maxRooms) {
      return wsSend(conn, { type: 'error', message: '房间数已达上限' });
    }
    const mode: RoomMode = msg.mode === 'ai' ? 'ai' : 'pvp';
    const depth = Number(msg.depth);
    if (mode === 'ai' && Number.isInteger(depth) && depth >= 1 && depth <= 4) this.aiDepth = depth;

    const player = this.identityOf(conn, undefined, msg.token);
    // 口令：空串 / 空白视为不设口令（点击即可加入）
    const rawPassword = typeof msg.password === 'string' ? msg.password.trim() : '';
    const room = new Room(
      this.newRoomId(),
      player,
      mode,
      rawPassword ? rawPassword : null,
      this.aiDepth,
      this.roomDeps(),
    );
    this.rooms.set(room.id, room);
    // 先登记连接归属，再入座：保证房间内广播（start / opponent_joined）不会早于 room_joined
    conn.roomId = room.id;
    conn.role = 'player';
    conn.player = player;
    const joined = room.joinPlayer(conn, player);
    if (joined === 'full') {
      conn.roomId = null;
      conn.role = null;
      room.close('无人入座');
      return wsSend(conn, { type: 'error', message: '房间创建失败' });
    }
    room.cancelIdleTimer();
    this.sendRoomJoined(conn, room, player);
    room.afterJoin(joined === 'rejoined', player.id);
  }

  private handleJoinRoom(conn: Conn, msg: Extract<ClientMessage, { type: 'join_room' }>): void {
    if (conn.roomId) return wsSend(conn, { type: 'error', message: '你已在房间中' });
    const roomId = typeof msg.roomId === 'string' ? msg.roomId.trim() : '';
    const room = this.rooms.get(roomId);
    if (!room) return wsSend(conn, { type: 'error', message: '房间不存在' });

    if (msg.role === 'spectator') {
      const joined = room.joinSpectator(conn);
      if (!joined) return wsSend(conn, { type: 'error', message: '观战人数已满' });
      conn.roomId = roomId;
      conn.role = 'spectator';
      conn.player = null;
      room.cancelIdleTimer();
      return wsSend(conn, this.roomJoinedPayload(room, null, '观众', ''));
    }

    if (room.password !== null && (typeof msg.password !== 'string' || msg.password !== room.password)) {
      return wsSend(conn, { type: 'error', message: '房间口令错误' });
    }

    const player = this.identityOf(conn, msg.playerId, msg.token);
    conn.roomId = roomId;
    conn.role = 'player';
    conn.player = player;
    const result = room.joinPlayer(conn, player);
    if (result === 'full') {
      conn.roomId = null;
      conn.role = null;
      return wsSend(conn, { type: 'error', message: '房间已满' });
    }
    room.cancelIdleTimer();
    this.sendRoomJoined(conn, room, player);
    room.afterJoin(result === 'rejoined', player.id);
  }

  private handleLeaveRoom(conn: Conn): void {
    const room = conn.roomId ? this.rooms.get(conn.roomId) : null;
    if (room) room.leave(conn);
    const roomId = conn.roomId;
    conn.roomId = null;
    conn.role = null;
    const still = roomId ? this.rooms.get(roomId) : null;
    if (still && !still.isClosed && !still.hasLiveConn()) still.armIdleTimer(this.opts.roomIdleMs);
  }

  private sendRoomJoined(conn: Conn, room: Room, player: PlayerRef): void {
    wsSend(conn, this.roomJoinedPayload(room, room.seatOfPlayer(player.id), player.name, player.id));
  }

  private roomJoinedPayload(room: Room, seat: Side | null, name: string, playerId: string): ServerMessage {
    return {
      type: 'room_joined',
      roomId: room.id,
      seat,
      playerId,
      name,
      ownerId: room.ownerId,
      locked: room.password !== null,
      state: room.game.snapshot(),
      firstMode: room.firstModeValue,
      serverIp: getLanIp(),
      port: this.port,
    };
  }

  /**
   * 玩家身份：优先用请求携带的账号 token 解析；其次用本连接已登录的身份；
   * 都没有则沿用客户端带来的游客 id（重连用），否则新建一个游客身份。
   */
  private identityOf(conn: Conn, playerId: unknown, token?: unknown): PlayerRef {
    if (typeof token === 'string' && token) {
      const account = this.accounts.resolve(token);
      if (account) {
        conn.player = account;
        return account;
      }
    }
    if (conn.player?.kind === 'account') return conn.player;
    if (typeof playerId === 'string' && playerId.startsWith('guest:')) {
      const suffix = playerId.slice('guest:'.length);
      if (/^[a-f0-9]{8,}$/i.test(suffix)) {
        return { id: playerId, name: `游客${suffix.slice(-4).toUpperCase()}`, kind: 'guest' };
      }
    }
    const suffix = crypto.randomBytes(4).toString('hex');
    return { id: `guest:${suffix}`, name: `游客${suffix.toUpperCase()}`, kind: 'guest' };
  }

  private handleClose(conn: Conn): void {
    if (!this.conns.delete(conn)) return; // close 与 error 可能都触发
    const roomId = conn.roomId;
    const room = roomId ? this.rooms.get(roomId) : null;
    if (room) room.handleClose(conn);
    conn.roomId = null;
    conn.role = null;
    const still = roomId ? this.rooms.get(roomId) : null;
    if (still && !still.isClosed && !still.hasLiveConn()) still.armIdleTimer(this.opts.roomIdleMs);
  }

  /** 房间销毁回调：清理房间表并把房内连接恢复到「未加入房间」 */
  private onRoomClose = (room: Room, reason: string): void => {
    this.rooms.delete(room.id);
    logDebug(`房间 ${room.id} 已从服务器移除（${reason}）`);
    for (const conn of room.conns()) {
      if (conn.roomId === room.id) {
        conn.roomId = null;
        conn.role = null;
      }
    }
  };

  private roomDeps(): RoomDeps {
    return {
      serverIp: () => getLanIp(),
      port: () => this.port,
      turnMs: this.opts.turnMs,
      graceMs: this.opts.graceMs,
      aiDelayMs: this.opts.aiDelayMs,
      overTtlMs: this.opts.overTtlMs,
      maxSpectators: this.opts.maxSpectators,
      onRecord: (rec: GameRecord) => this.history.add(rec),
      onClose: this.onRoomClose,
    };
  }

  /** 分配一个 6 位数字房间号（在存活房间内唯一） */
  private newRoomId(): string {
    for (let i = 0; i < 500; i++) {
      const id = String(Math.floor(100000 + Math.random() * 900000));
      if (!this.rooms.has(id)) return id;
    }
    // 极端情况下退化为时间戳后 6 位 + 递增，保证不阻塞建房
    return String(Date.now()).slice(-6);
  }
}

/** 读取请求体（限制大小，避免超大请求） */
function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** 目标路径必须位于 root 内：防 `../` 穿越，也防「dist-evil」类同前缀兄弟目录误判 */
function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface ListenResult {
  server: GameServer;
  port: number;
  /** 是否因端口占用回退到随机端口 */
  fallback: boolean;
}

/**
 * 按首选端口启动服务。
 * 端口被占用时：`forcePreferred=false` 回退随机端口；`true`（显式指定端口）则抛出，
 * 由调用方给出友好提示。
 */
export async function listenWithFallback(
  preferred: number,
  forcePreferred = false,
  dataDir?: string | null,
): Promise<ListenResult> {
  const first = new GameServer({ port: preferred, dataDir });
  try {
    return { server: first, port: await first.listen(), fallback: false };
  } catch (err) {
    if (forcePreferred || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
  }
  logInfo(`端口 ${preferred} 被占用，已回退随机端口`);
  const fallbackServer = new GameServer({ port: 0, dataDir });
  return { server: fallbackServer, port: await fallbackServer.listen(), fallback: true };
}

function defaultStaticDir(): string {
  // 编译产物：dist/server/server.js → 静态根目录为 dist
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}
