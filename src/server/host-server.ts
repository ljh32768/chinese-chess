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
import { ClientMessage, Role, ServerMessage, decode, encode, isValidPos } from '../shared/protocol.js';
import {
  AiHint,
  FIRST_MODE_LABEL,
  FirstMode,
  GameRecord,
  GameRecordSummary,
  GuessChoice,
  GuessResult,
  Pos,
  Side,
} from '../shared/types.js';
import { describeMove } from '../shared/notation.js';
import { initBoard, makeMove } from '../shared/rules.js';
import { Game, MoveResult } from './game.js';
import { logDebug, logInfo } from './log.js';
import { pickMove } from './ai.js';

const sideLabel = (s: Side): string => (s === 'r' ? '红方' : '黑方');
const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');

/** 先手（红方）归属方式白名单 */
const FIRST_MODES: readonly FirstMode[] = ['r', 'b', 'random', 'guess'];
const isFirstMode = (x: unknown): x is FirstMode => FIRST_MODES.includes(x as FirstMode);
const isGuessChoice = (x: unknown): x is GuessChoice => x === 'odd' || x === 'even';

/** 对局记录摘要（剔除着法明细） */
function toSummary(r: GameRecord): GameRecordSummary {
  return {
    id: r.id,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    red: r.red,
    black: r.black,
    firstMode: r.firstMode,
    guess: r.guess,
    winner: r.winner,
    reason: r.reason,
    moveCount: r.moveCount,
  };
}

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

interface Conn {
  ws: WebSocket;
  role: Role | null;
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
  /** 每回合限时（毫秒）；0 表示不限时（默认，可用环境变量 LANSCHESS_TURN_MS 覆盖） */
  turnMs?: number;
  /** 人机对战：AI 走子延迟（毫秒），默认 400 */
  aiDelayMs?: number;
  /** 人机对战：AI 搜索深度，默认 2 */
  aiDepth?: number;
}

export class HostServer {
  readonly game = new Game();
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private hostConn: Conn | null = null;
  private guestConn: Conn | null = null;
  /** 观战者连接（只读，不占红黑席位） */
  private readonly spectators = new Set<Conn>();
  private hosting = false;
  private port = 0;
  /** 意外断线后的宽限计时器（超时才真正清理席位） */
  private hostGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private guestGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** 人机对战：AI 执黑自动走子 */
  private aiEnabled = false;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  /** 计时读秒：本回合超时判负定时器 */
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  /** 主机选择的先手（红方）归属方式；等待阶段可改，开赛时生效 */
  private firstMode: FirstMode = 'r';
  /** 主机席位阵营（随机 / 猜先时开赛前才确定） */
  private hostSide: Side = 'r';
  /** 猜先阶段：'grasp' 等主机抓子 / 'guess' 等客方猜 / null 未进行 */
  private guessStage: 'grasp' | 'guess' | null = null;
  /** 主机抓到的隐藏结果（单 / 双） */
  private pendingGuess: GuessChoice | null = null;
  /** 本局猜先明细（写入对局记录） */
  private lastGuess: GuessResult | null = null;
  /** 对局记录（对局回顾，仅保留最近 maxRecords 局，进程内） */
  private readonly records: GameRecord[] = [];
  private recordSeq = 1;
  private readonly maxRecords = 50;
  /** 当前进行中的对局信息（终局时写入记录） */
  private currentRecord: {
    startedAt: number;
    firstMode: FirstMode;
    guess: GuessResult | null;
    ai: boolean;
  } | null = null;
  private readonly opts: Required<HostServerOptions>;

  constructor(opts: HostServerOptions = {}) {
    this.opts = {
      port: opts.port ?? 7777,
      staticDir: opts.staticDir === undefined ? defaultStaticDir() : opts.staticDir,
      host: opts.host ?? '0.0.0.0',
      graceMs: opts.graceMs ?? 30000,
      turnMs: opts.turnMs ?? (Number(process.env.LANSCHESS_TURN_MS) || 0),
      aiDelayMs: opts.aiDelayMs ?? 400,
      aiDepth: opts.aiDepth ?? 2,
    };
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
        logInfo(`主机服务已就绪：http://${getLanIp()}:${this.port}`);
        resolve(this.port);
      });
    });
  }

  /** 关闭服务（断开所有连接并取消各类计时器） */
  close(): Promise<void> {
    this.cancelHostGrace();
    this.cancelGuestGrace();
    this.clearAiTimer();
    this.clearTurnTimer();
    logInfo('主机服务已关闭');
    return new Promise((resolve) => {
      for (const c of [this.hostConn, this.guestConn, ...this.spectators]) c?.ws.close();
      this.spectators.clear();
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
      // 人机对战随「停止托管」一并结束
      this.aiEnabled = false;
      this.clearAiTimer();
      this.clearTurnTimer();
      this.abandonGame();
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
          firstMode: this.firstMode,
          state: this.game.snapshot(),
        });
      }
      if (pathname === '/api/host/start') {
        // 新建等待：先手方式回到默认（主机执红），由主机在等待页再选择
        this.firstMode = 'r';
        this.hostSide = 'r';
        this.abandonGame();
        this.setHosting(true);
        return this.sendJson(res, 200, { ip: getLanIp(), port: this.port });
      }
      if (pathname === '/api/host/start-ai') {
        // 人机对战：AI 占黑方席位，对局立即开始
        // 可选 depth 参数指定搜索深度（1-4），对应前端「菜鸟 / 中级 / 高手」
        const depth = Number(url.searchParams.get('depth'));
        if (Number.isInteger(depth) && depth >= 1 && depth <= 4) this.opts.aiDepth = depth;
        this.setHosting(true);
        this.aiEnabled = true;
        this.startAiGame();
        return this.sendJson(res, 200, { ip: getLanIp(), port: this.port, depth: this.opts.aiDepth });
      }
      if (pathname === '/api/host/stop') {
        this.setHosting(false);
        return this.sendJson(res, 200, { ok: true });
      }
      // 对局回顾：列表（最近在前）与单局明细（含着法，供复盘逐步回放）
      if (pathname === '/api/history') {
        return this.sendJson(res, 200, { games: [...this.records].reverse().map(toSummary) });
      }
      if (pathname.startsWith('/api/history/')) {
        const id = pathname.slice('/api/history/'.length);
        const record = this.records.find((r) => r.id === id);
        if (!record) return this.sendJson(res, 404, { error: '记录不存在' });
        return this.sendJson(res, 200, record);
      }
      // AI 推荐：按记录 + 步数复原局面，返回该局面行棋方的推荐着法
      if (pathname === '/api/ai/hint') {
        const id = url.searchParams.get('id') ?? '';
        const record = this.records.find((r) => r.id === id);
        if (!record) return this.sendJson(res, 404, { error: '记录不存在' });
        const index = Number(url.searchParams.get('index') ?? '0');
        const depth = Number(url.searchParams.get('depth') ?? '2');
        const hint = this.hintFor(record, index, depth);
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
    const conn: Conn = { ws, role: null, side: null };
    logDebug('收到新的 WebSocket 连接');

    ws.on('message', (raw) => {
      try {
        const msg = decode(raw.toString());
        if (!msg) {
          logDebug('无法解析的消息');
          return this.send(ws, { type: 'error', message: '无法解析的消息' });
        }
        this.handleMessage(conn, msg as unknown as ClientMessage);
      } catch (err) {
        logDebug(`服务端异常：${String(err)}`);
        this.send(ws, { type: 'error', message: `服务端异常：${String(err)}` });
      }
    });

    ws.on('close', () => this.handleClose(conn));
    ws.on('error', () => this.handleClose(conn));
  }

  private handleMessage(conn: Conn, msg: ClientMessage): void {
    // 观战者只读：仅允许心跳与主动离开
    if (conn.role === 'spectator' && msg.type !== 'ping' && msg.type !== 'leave') {
      return this.send(conn.ws, { type: 'error', message: '观战模式只读' });
    }
    switch (msg.type) {
      case 'join':
        return this.handleJoin(conn, msg.role);
      case 'move': {
        if (conn.side === null) return this.send(conn.ws, { type: 'error', message: '尚未加入对局' });
        const from = msg.from;
        const to = msg.to;
        // 坐标必须是整数对；越界由规则引擎按「越界」拒绝
        if (!isValidPos(from) || !isValidPos(to)) {
          return this.send(conn.ws, {
            type: 'move_rejected',
            from: from ?? [0, 0],
            to: to ?? [0, 0],
            reason: '坐标非法',
          });
        }
        const result = this.applyAndBroadcast(from, to, conn.side);
        if (!result.ok) {
          return this.send(conn.ws, { type: 'move_rejected', from, to, reason: result.reason ?? '非法走子' });
        }
        return;
      }
      case 'resign': {
        if (conn.side === null) return;
        this.game.resign(conn.side);
        logInfo(`认输：${sideLabel(conn.side)}`);
        this.broadcastGameOver();
        return;
      }
      case 'draw_request': {
        if (conn.side === null || this.game.status !== 'playing') return;
        if (this.aiEnabled) {
          logInfo('人机对战：AI 拒绝和棋请求');
          return this.send(conn.ws, { type: 'draw_response', accept: false });
        }
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
          logInfo('和棋：双方同意');
          this.broadcast({ type: 'draw_response', accept: true });
          this.broadcastGameOver();
        } else {
          this.game.pendingDraw = null;
          this.sendTo(requester, { type: 'draw_response', accept: false });
        }
        return;
      }
      case 'restart_request': {
        if (conn.side === null || !this.game.canRestart()) return;
        if (this.aiEnabled) {
          // 人机对战：AI 自动同意重开
          this.broadcast({ type: 'restart_response', accept: true });
          this.startAiGame();
          return;
        }
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
      case 'undo_request': {
        if (conn.side === null || this.game.status !== 'playing') return;
        if (this.game.history.length === 0) {
          return this.send(conn.ws, { type: 'error', message: '当前没有可悔的棋' });
        }
        if (this.aiEnabled) {
          // 人机对战：AI 自动同意悔棋
          this.game.undo();
          this.afterMoveApplied();
          logInfo('人机对战：悔棋（AI 自动同意）');
          this.send(conn.ws, { type: 'undo_response', accept: true });
          this.broadcast({ type: 'state', state: this.game.snapshot() });
          return;
        }
        if (this.game.pendingUndo !== null) {
          return this.send(conn.ws, { type: 'error', message: '悔棋请求已在进行中' });
        }
        if (!this.hostConn || !this.guestConn) {
          return this.send(conn.ws, { type: 'error', message: '对方不在线，无法悔棋' });
        }
        this.game.pendingUndo = conn.side;
        this.sendTo(conn.side === 'r' ? 'b' : 'r', { type: 'undo_request' });
        return;
      }
      case 'undo_response': {
        if (conn.side === null) return;
        const requester = this.game.pendingUndo;
        if (requester === null || requester === conn.side) return;
        if (msg.accept) {
          this.game.pendingUndo = null;
          if (!this.game.undo()) {
            this.sendTo(requester, { type: 'undo_response', accept: false });
            return;
          }
          this.afterMoveApplied();
          logInfo(`悔棋：${sideLabel(requester)} 的请求被同意，回退一步`);
          this.broadcast({ type: 'undo_response', accept: true });
          this.broadcast({ type: 'state', state: this.game.snapshot() });
        } else {
          this.game.pendingUndo = null;
          this.sendTo(requester, { type: 'undo_response', accept: false });
        }
        return;
      }
      case 'choose_first': {
        // 主机在等待页选择先手（红方）归属方式：红 / 黑 / 随机黑红 / 猜先
        if (conn.role !== 'host') {
          return this.send(conn.ws, { type: 'error', message: '只有主机可以选择先手方式' });
        }
        if (this.aiEnabled) return;
        if (this.game.status === 'playing') {
          return this.send(conn.ws, { type: 'error', message: '对局进行中，无法更改先手方式' });
        }
        if (!isFirstMode(msg.mode)) {
          return this.send(conn.ws, { type: 'error', message: '先手方式非法' });
        }
        this.firstMode = msg.mode;
        if (msg.mode === 'r' || msg.mode === 'b') this.hostSide = msg.mode;
        this.guessStage = null; // 更换方式时取消进行中的猜先
        this.pendingGuess = null;
        logInfo(`主机选择先手方式：${FIRST_MODE_LABEL[msg.mode]}`);
        this.maybeStart();
        return;
      }
      case 'guess': {
        // 客方猜先应答：猜中者执红
        if (conn.role !== 'guest') {
          return this.send(conn.ws, { type: 'error', message: '只有加入者可以猜先' });
        }
        if (this.guessStage !== 'guess' || this.pendingGuess === null || this.game.status === 'playing') {
          return this.send(conn.ws, { type: 'error', message: '当前不在猜先阶段' });
        }
        if (!isGuessChoice(msg.choice)) {
          return this.send(conn.ws, { type: 'error', message: '猜先选择非法' });
        }
        const actual = this.pendingGuess;
        const guestWon = msg.choice === actual;
        logInfo(`猜先：加入者猜${msg.choice === 'odd' ? '单' : '双'}，实际${actual === 'odd' ? '单' : '双'}`);
        this.beginFirst('guess', guestWon ? 'b' : 'r', { choice: msg.choice, actual, guestWon });
        return;
      }
      case 'grasp': {
        // 猜先第一步：主机自己抓单 / 抓双（不再由程序随机抓）
        if (conn.role !== 'host') {
          return this.send(conn.ws, { type: 'error', message: '只有主机可以抓子' });
        }
        if (this.guessStage !== 'grasp') {
          return this.send(conn.ws, { type: 'error', message: '当前不在抓子阶段' });
        }
        if (!isGuessChoice(msg.choice)) {
          return this.send(conn.ws, { type: 'error', message: '抓子选择非法' });
        }
        this.pendingGuess = msg.choice;
        this.guessStage = 'guess';
        logInfo(`猜先：主机抓${msg.choice === 'odd' ? '单' : '双'}，等待加入者猜单双`);
        this.sendToSeats({ type: 'guess_request' });
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
        return this.send(conn.ws, { type: 'pong', t: msg.t, ip: getLanIp(), port: this.port });
      }
      default:
        return this.send(conn.ws, { type: 'error', message: '未知消息类型' });
    }
  }

  /** 走子：校验通过后广播 move_applied，终局追加 game_over；返回校验结果 */
  private applyAndBroadcast(from: Pos, to: Pos, side: Side): MoveResult {
    const result = this.game.applyMove(from, to, side);
    if (!result.ok) {
      logDebug(`走子被拒绝：${sideLabel(side)} ${from}→${to}（${result.reason ?? '非法走子'}）`);
      return result;
    }
    this.afterMoveApplied(); // 先武装回合计时，deadline 随后进入广播快照
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
      history: s.history,
      deadline: s.deadline,
    };
    this.broadcast(applied);
    logInfo(`走子：${sideLabel(side)} ${from[0]},${from[1]} → ${to[0]},${to[1]}（第 ${s.moveSeq} 步）`);
    if (s.status === 'over') this.broadcastGameOver();
    return result;
  }

  /** 广播终局并打点（将死 / 困毙 / 认输 / 同意和棋 / 超时判负），同时写入对局回顾记录 */
  private broadcastGameOver(): void {
    const s = this.game.snapshot();
    this.broadcast({ type: 'game_over', winner: s.winner, reason: s.reason, state: s });
    this.saveRecord();
    logInfo(`对局结束：${s.winner === null ? '和棋' : `${sideLabel(s.winner)}胜`}（${s.reason}）`);
  }

  // ---------------------------------------------------- 对局回顾与 AI 推荐

  /** 终局落库：写入内存中的对局记录（同一局只写一次，仅保留最近 maxRecords 局） */
  private saveRecord(): void {
    const cur = this.currentRecord;
    this.currentRecord = null;
    if (!cur) return;
    const s = this.game.snapshot();
    const record: GameRecord = {
      id: String(this.recordSeq++),
      startedAt: cur.startedAt,
      endedAt: Date.now(),
      red: cur.ai ? 'host' : this.hostSide === 'r' ? 'host' : 'guest',
      black: cur.ai ? 'ai' : this.hostSide === 'r' ? 'guest' : 'host',
      firstMode: cur.firstMode,
      guess: cur.guess,
      winner: s.winner,
      reason: s.reason,
      moveCount: s.history.length,
      moves: [...s.history],
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records.shift();
    logInfo(`对局记录 #${record.id} 已保存（${record.moveCount} 步，${record.reason}）`);
  }

  /** 复原记录中的第 index 步局面，返回该局面行棋方的 AI 推荐着法 */
  private hintFor(record: GameRecord, index: number, depth: number): AiHint | null {
    const n = Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, record.moves.length));
    const board = initBoard();
    for (let i = 0; i < n; i++) makeMove(board, record.moves[i].from, record.moves[i].to);
    const side: Side = n % 2 === 0 ? 'r' : 'b';
    const level = Number.isFinite(depth) ? Math.min(4, Math.max(1, Math.floor(depth))) : 2;
    const move = pickMove(board, side, { depth: level, timeLimitMs: 1200 });
    if (!move) return null;
    return { side, from: move.from, to: move.to, text: describeMove(board, move.from, move.to) };
  }

  // ---------------------------------------------------- 人机对战与计时

  /** 开始人机对战：AI 占黑方席位，对局立即开始（红方为人类主机） */
  private startAiGame(): void {
    this.hostSide = 'r';
    this.game.reset('playing');
    this.afterMoveApplied();
    this.dispatchStart();
    this.currentRecord = { startedAt: Date.now(), firstMode: 'r', guess: null, ai: true };
    logInfo('人机对战开始（AI 执黑）');
  }

  /** 走子 / 悔棋后统一处理：刷新回合计时并检查 AI 是否需要走子 */
  private afterMoveApplied(): void {
    this.armTurnTimer();
    this.scheduleAiMove();
  }

  /** 计时读秒：写入本回合截止时间并安排超时判负（turnMs<=0 表示不限时） */
  private armTurnTimer(): void {
    this.clearTurnTimer();
    if (this.opts.turnMs <= 0 || this.game.status !== 'playing') {
      this.game.deadline = null;
      return;
    }
    this.game.deadline = Date.now() + this.opts.turnMs;
    const timer = setTimeout(() => {
      this.turnTimer = null;
      if (this.game.status !== 'playing') return;
      const loser = this.game.turn;
      this.game.timeout(loser);
      logInfo(`计时超时：${sideLabel(loser)} 判负`);
      this.broadcastGameOver();
    }, this.opts.turnMs);
    timer.unref();
    this.turnTimer = timer;
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  /** 人机对战：轮到 AI（黑方）时延迟自动走子 */
  private scheduleAiMove(): void {
    this.clearAiTimer();
    if (!this.aiEnabled || this.game.status !== 'playing' || this.game.turn !== 'b') return;
    const timer = setTimeout(() => {
      this.aiTimer = null;
      if (!this.aiEnabled || this.game.status !== 'playing' || this.game.turn !== 'b') return;
      const move = pickMove(this.game.board, 'b', { depth: this.opts.aiDepth });
      if (!move) return;
      logInfo(`AI 走子：${move.from[0]},${move.from[1]} → ${move.to[0]},${move.to[1]}`);
      this.applyAndBroadcast(move.from, move.to, 'b');
    }, this.opts.aiDelayMs);
    timer.unref();
    this.aiTimer = timer;
  }

  private clearAiTimer(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }

  private handleJoin(conn: Conn, role: Role): void {
    if (conn.role !== null) {
      return this.send(conn.ws, { type: 'error', message: '你已经加入对局' });
    }
    if (role === 'spectator') {
      // 观战者：只读旁观，不占红黑席位，随时可加入
      conn.role = 'spectator';
      conn.side = null;
      this.spectators.add(conn);
      this.send(conn.ws, {
        type: 'welcome',
        side: null,
        hostIp: getLanIp(),
        port: this.port,
        state: this.game.snapshot(),
        firstMode: this.firstMode,
      });
      logInfo(`观战者加入（当前 ${this.spectators.size} 人）`);
      return;
    }
    if (role === 'host') {
      if (this.hostConn && this.hostConn.ws !== conn.ws) {
        return this.send(conn.ws, { type: 'error', message: '主机端已存在' });
      }
      // 宽限期内同阵营重连：保留原对局与回合
      const rejoining = this.game.status === 'playing';
      this.cancelHostGrace();
      conn.role = 'host';
      conn.side = this.hostSide;
      this.hostConn = conn;
      if (!rejoining) this.game.status = this.hosting ? 'waiting' : 'idle';
      this.send(conn.ws, {
        type: 'welcome',
        side: conn.side,
        hostIp: getLanIp(),
        port: this.port,
        state: this.game.snapshot(),
        firstMode: this.firstMode,
      });
      logInfo(`主机连接（${sideLabel(conn.side)}${rejoining ? ' · 重连恢复对局' : ''}）`);
      if (rejoining) {
        // 通知加入者主机已回来，并同步最新快照
        this.sendToOpponent(conn, { type: 'opponent_joined' });
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
    if (this.aiEnabled) {
      return this.send(conn.ws, { type: 'error', message: '人机对局，无法加入' });
    }
    if (this.guestConn && this.guestConn.ws !== conn.ws) {
      return this.send(conn.ws, { type: 'error', message: '对局已满，无法加入' });
    }
    // 宽限期内同阵营重连：保留原对局与回合
    const rejoining = this.game.status === 'playing';
    this.cancelGuestGrace();
    conn.role = 'guest';
    conn.side = other(this.hostSide);
    this.guestConn = conn;
    this.send(conn.ws, {
      type: 'welcome',
      side: conn.side,
      hostIp: getLanIp(),
      port: this.port,
      state: this.game.snapshot(),
      firstMode: this.firstMode,
    });
    logInfo(`加入者连接（${sideLabel(conn.side)}${rejoining ? ' · 重连恢复对局' : ''}）`);
    this.sendToOpponent(conn, { type: 'opponent_joined' });
    if (rejoining) this.broadcast({ type: 'state', state: this.game.snapshot() });
    this.maybeStart();
  }

  private maybeStart(): void {
    if (!this.hosting || this.aiEnabled) return;
    if (!this.hostConn || !this.guestConn) return;
    if (this.game.status !== 'idle' && this.game.status !== 'waiting') return;
    switch (this.firstMode) {
      case 'random': {
        // 随机黑红：开赛时随机决定主机阵营
        const hostSide: Side = Math.random() < 0.5 ? 'r' : 'b';
        this.beginFirst('random', hostSide, null);
        return;
      }
      case 'guess': {
        if (this.guessStage === 'grasp') return; // 已请主机抓子，等待主机应答
        if (this.guessStage === 'guess') {
          // 已抓子：等客方猜（客方重连时补发请求）
          this.sendToSeats({ type: 'guess_request' });
          return;
        }
        this.guessStage = 'grasp';
        logInfo('猜先开始：等待主机抓单 / 抓双');
        if (this.hostConn) this.send(this.hostConn.ws, { type: 'grasp_request' });
        return;
      }
      default: {
        this.beginFirst(this.firstMode, this.firstMode, null);
        return;
      }
    }
  }

  /** 席位确定（红 / 黑 / 随机 / 猜先）：分配阵营、广播结果并开局 */
  private beginFirst(mode: FirstMode, hostSide: Side, guess: GuessResult | null): void {
    this.firstMode = mode;
    this.hostSide = hostSide;
    this.guessStage = null;
    this.pendingGuess = null;
    this.lastGuess = guess;
    if (this.hostConn) this.hostConn.side = hostSide;
    if (this.guestConn) this.guestConn.side = other(hostSide);
    this.broadcast({ type: 'first_result', mode, hostSide, guess });
    logInfo(`席位确定：主机执${hostSide === 'r' ? '红' : '黑'}（${FIRST_MODE_LABEL[mode]}）`);
    this.startGame();
  }

  /** 开局：重置对局并向各连接下发各自阵营 + 记录本局信息 */
  private startGame(): void {
    this.game.reset('playing');
    this.afterMoveApplied(); // 开局即开始回合计时（若启用）
    this.dispatchStart();
    this.currentRecord = {
      startedAt: Date.now(),
      firstMode: this.firstMode,
      guess: this.lastGuess,
      ai: false,
    };
    this.lastGuess = null;
  }

  /** 逐连接下发 start（红黑阵营随席位变化，观战者为 null） */
  private dispatchStart(): void {
    const state = this.game.snapshot();
    if (this.hostConn) this.send(this.hostConn.ws, { type: 'start', state, side: this.hostSide });
    if (this.guestConn) this.send(this.guestConn.ws, { type: 'start', state, side: other(this.hostSide) });
    for (const c of this.spectators) this.send(c.ws, { type: 'start', state, side: null });
  }

  private handleClose(conn: Conn): void {
    if (conn.role === 'host' && this.hostConn === conn) {
      this.hostConn = null;
      if (conn.leaving || this.game.status !== 'playing') {
        // 主动离开或未在局中：立即清理（原语义）
        this.cancelGuestGrace();
        logInfo('主机离开，释放席位');
        this.sendToOpponent(conn, { type: 'opponent_left', reason: '主机已离开' });
        this.abandonGame();
        this.hosting = false;
        if (this.game.status === 'playing') this.game.status = 'idle';
      } else {
        // 意外断线：保留对局与主机席位，宽限期内可重连
        this.startHostGrace();
        this.sendToOpponent(conn, {
          type: 'opponent_away',
          reason: '主机已断开',
          graceMs: this.opts.graceMs,
        });
      }
    } else if (conn.role === 'guest' && this.guestConn === conn) {
      this.guestConn = null;
      if (conn.leaving || this.game.status !== 'playing') {
        logInfo('加入者离开，清空席位');
        this.sendToOpponent(conn, { type: 'opponent_left', reason: '对手已离开' });
        this.abandonGame();
        if (this.game.status === 'playing') {
          this.game.status = this.hosting ? 'waiting' : 'idle';
        }
      } else {
        // 意外断线：保留对局与客方席位，宽限期内可重连
        this.startGuestGrace();
        this.sendToOpponent(conn, {
          type: 'opponent_away',
          reason: '对手已断开',
          graceMs: this.opts.graceMs,
        });
      }
    } else if (conn.role === 'spectator') {
      this.spectators.delete(conn);
      logInfo(`观战者离开（剩余 ${this.spectators.size} 人）`);
    }
  }

  /** 放弃一局（离开 / 宽限超时）：清空进行中记录与猜先状态，避免串到下一局 */
  private abandonGame(): void {
    this.currentRecord = null;
    this.guessStage = null;
    this.pendingGuess = null;
    this.lastGuess = null;
  }

  // ------------------------------------------------------- 断线重连宽限

  /** 主机意外断线：启动宽限计时，超时前可重连恢复原局 */
  private startHostGrace(): void {
    this.cancelHostGrace();
    logInfo(`主机意外断线，等待重连（宽限 ${this.opts.graceMs}ms）`);
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
    logInfo('主机宽限超时，释放席位');
    this.hosting = false;
    this.abandonGame();
    this.game.reset('idle');
    if (this.guestConn) this.send(this.guestConn.ws, { type: 'opponent_left', reason: '主机已离开' });
  }

  /** 加入者意外断线：启动宽限计时，超时前可重连恢复原局 */
  private startGuestGrace(): void {
    this.cancelGuestGrace();
    logInfo(`加入者意外断线，等待重连（宽限 ${this.opts.graceMs}ms）`);
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
    logInfo(`清空加入者席位：${reason}`);
    this.guestConn = null;
    this.abandonGame();
    this.game.reset(this.hosting ? 'waiting' : 'idle');
    if (this.hostConn) this.send(this.hostConn.ws, { type: 'state', state: this.game.snapshot() });
    if (this.hostConn) this.send(this.hostConn.ws, { type: 'opponent_left', reason });
  }

  // ------------------------------------------------------------ 发送工具

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
  }

  /** 按阵营取连接（席位由 firstMode 决定，主机不一定执红） */
  private connOf(side: Side): Conn | null {
    if (this.hostConn?.side === side) return this.hostConn;
    if (this.guestConn?.side === side) return this.guestConn;
    return null;
  }

  private sendTo(side: Side, msg: ServerMessage): void {
    const conn = this.connOf(side);
    if (conn) this.send(conn.ws, msg);
  }

  /** 发给某个席位的对手（不含观战者）；连接可能已从席位上摘除，故按角色判断 */
  private sendToOpponent(conn: Conn, msg: ServerMessage): void {
    const target = conn.role === 'host' ? this.guestConn : this.hostConn;
    if (target) this.send(target.ws, msg);
  }

  /** 发给两个对战席位（不含观战者） */
  private sendToSeats(msg: ServerMessage): void {
    if (this.hostConn) this.send(this.hostConn.ws, msg);
    if (this.guestConn) this.send(this.guestConn.ws, msg);
  }

  private broadcast(msg: ServerMessage): void {
    this.sendToSeats(msg);
    for (const c of this.spectators) this.send(c.ws, msg);
  }
}

/** 目标路径必须位于 root 内：防 `../` 穿越，也防「dist-evil」类同前缀兄弟目录误判 */
function isInsideRoot(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface ListenResult {
  server: HostServer;
  port: number;
  /** 是否因端口占用回退到随机端口 */
  fallback: boolean;
}

/**
 * 按首选端口启动主机服务（C2）。
 * 端口被占用时：`forcePreferred=false` 回退随机端口；`true`（显式指定端口）则抛出，
 * 由调用方给出友好提示。
 */
export async function listenWithFallback(preferred: number, forcePreferred = false): Promise<ListenResult> {
  const first = new HostServer({ port: preferred });
  try {
    return { server: first, port: await first.listen(), fallback: false };
  } catch (err) {
    if (forcePreferred || (err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
  }
  logInfo(`端口 ${preferred} 被占用，已回退随机端口`);
  const fallbackServer = new HostServer({ port: 0 });
  return { server: fallbackServer, port: await fallbackServer.listen(), fallback: true };
}

function defaultStaticDir(): string {
  // 编译产物：dist/server/host-server.js → 静态根目录为 dist
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}
