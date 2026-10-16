/**
 * 单个房间：多房间服务器里的「一局」。
 *
 * 承载席位、先手方式、猜先、断线宽限、计时读秒、人机对战与终局记录；
 * 权威棋盘状态仍由本房间的 Game 持有（服务器是唯一权威）。
 *
 * 席位模型：房主席 `a`（创建者）与对手席 `b`；AI 模式下 `b.conn === null`。
 * 开赛前 `seat` 是占位值，双方到齐后由 beginFirst() 按先手方式确定。
 */

import { ClientMessage, ServerMessage, isValidPos } from '../shared/protocol.js';
import {
  AI_PLAYER,
  AiHint,
  FIRST_MODE_LABEL,
  FirstMode,
  GameRecord,
  GuessChoice,
  GuessResult,
  PlayerRef,
  Pos,
  RoomMode,
  RoomSummary,
  Side,
} from '../shared/types.js';
import { describeMove } from '../shared/notation.js';
import { classifyCheckmateFromHistory } from '../shared/checkmate.js';
import { initBoard, makeMove } from '../shared/rules.js';
import { Conn, sendTo as wsSend } from './conn.js';
import { Game, MoveResult } from '../shared/game.js';
import { logDebug, logInfo } from './log.js';
import { pickMove } from '../shared/ai.js';

export const sideLabel = (s: Side): string => (s === 'r' ? '红方' : '黑方');
export const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');

/** 先手（红方）归属方式白名单 */
const FIRST_MODES: readonly FirstMode[] = ['r', 'b', 'random', 'guess'];
const isFirstMode = (x: unknown): x is FirstMode => FIRST_MODES.includes(x as FirstMode);
const isGuessChoice = (x: unknown): x is GuessChoice => x === 'odd' || x === 'even';

/** 房间对服务器暴露的依赖（服务器注入，避免房间反向依赖服务器实现） */
export interface RoomDeps {
  /** 服务器自我声明地址（room_joined / pong 用） */
  serverIp(): string;
  port(): number;
  /** 每回合限时（毫秒），0 表示不限时 */
  turnMs: number;
  /** 意外断线后的重连宽限期（毫秒） */
  graceMs: number;
  /** 人机对战 AI 走子延迟（毫秒） */
  aiDelayMs: number;
  /** 终局后无人「再来一局」时销毁房间的等待时长（毫秒） */
  overTtlMs: number;
  /** 观战人数上限 */
  maxSpectators: number;
  /** 终局落库（服务器统一持久化） */
  onRecord(rec: GameRecord): void;
  /** 房间销毁（终局超时 / 空闲回收 / 房主解散 / 服务器停止） */
  onClose(room: Room, reason: string): void;
}

/** 席位成员：玩家连接 + 身份 + 阵营 + 宽限计时（AI 席位 conn 为 null） */
interface Member {
  conn: Conn | null;
  player: PlayerRef;
  seat: Side;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export class Room {
  readonly id: string;
  readonly ownerId: string;
  readonly mode: RoomMode;
  /** 房间口令；null 表示点击即可加入（房主可在等待阶段修改） */
  private pwd: string | null;
  readonly createdAt = Date.now();
  readonly game = new Game();

  /** 房主席（创建者） */
  private a: Member | null = null;
  /** 对手席（AI 模式 conn 为 null） */
  private b: Member | null = null;
  private readonly spectators = new Set<Conn>();
  /** 被邀请过的玩家 id（房间设口令时可免口令加入） */
  private readonly invited = new Set<string>();

  private readonly aiDepth: number;
  private firstMode: FirstMode = 'r';
  private ownerSide: Side = 'r';
  private guessStage: 'grasp' | 'guess' | null = null;
  private pendingGuess: GuessChoice | null = null;
  private lastGuess: GuessResult | null = null;
  private currentRecord: {
    startedAt: number;
    firstMode: FirstMode;
    guess: GuessResult | null;
    ai: boolean;
  } | null = null;

  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private aiTimer: ReturnType<typeof setTimeout> | null = null;
  private overTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  /** 人机对战是否已启动（首个人类入座后启动一次） */
  private aiStarted = false;

  constructor(
    id: string,
    owner: PlayerRef,
    mode: RoomMode,
    password: string | null,
    aiDepth: number,
    private readonly deps: RoomDeps,
  ) {
    this.id = id;
    this.ownerId = owner.id;
    this.mode = mode;
    this.pwd = password;
    this.aiDepth = aiDepth;
    if (mode === 'ai') {
      // AI 占虚拟黑席：没有连接，不参与宽限
      this.b = { conn: null, player: AI_PLAYER, seat: 'b', graceTimer: null };
    } else {
      // 揭棋房间：与双人房同构，仅开局方式与快照抹除不同
      if (mode === 'jieqi') this.game.variant = 'jieqi';
      // 双人房：创建后即进入「等待对手」状态
      this.game.reset('waiting');
    }
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** 当前先手方式（服务器在 room_joined 中下发） */
  get firstModeValue(): FirstMode {
    return this.firstMode;
  }

  /** 当前房间口令（null 表示点击即可加入） */
  get password(): string | null {
    return this.pwd;
  }

  /** 房主设置 / 取消口令（仅未开局有效）；返回是否生效 */
  setPassword(pw: string | null): boolean {
    if (this.mode === 'ai') return false;
    if (this.game.status === 'playing') return false;
    this.pwd = pw;
    logInfo(`房间 ${this.id}：口令已${pw ? '设置' : '取消'}`);
    return true;
  }

  // ------------------------------------------------------- 邀请（口令豁免）

  /** 记录被邀请者：房间设了口令时，被邀请者可免口令加入 */
  markInvited(playerId: string): void {
    this.invited.add(playerId);
  }

  /** 该玩家是否被本房间邀请过 */
  isInvited(playerId: string): boolean {
    return this.invited.has(playerId);
  }

  /** 邀请已消费（成功加入后调用，避免长期豁免） */
  consumeInvite(playerId: string): void {
    this.invited.delete(playerId);
  }

  /** 是否还有空席位（可邀请为对局玩家） */
  canAcceptPlayer(): boolean {
    return !(this.a && this.b);
  }

  /** 观战席是否还有余位 */
  canAcceptSpectator(): boolean {
    return this.spectators.size < this.deps.maxSpectators;
  }

  /** 房间内的全部连接（席位 + 观战），服务器在销毁时用于清理归属 */
  conns(): Conn[] {
    const out: Conn[] = [];
    if (this.a?.conn) out.push(this.a.conn);
    if (this.b?.conn) out.push(this.b.conn);
    for (const c of this.spectators) out.push(c);
    return out;
  }

  /** 某玩家当前占用的阵营（未入座返回 null） */
  seatOfPlayer(playerId: string): Side | null {
    if (this.a?.player.id === playerId) return this.a.seat;
    if (this.b?.conn && this.b.player.id === playerId) return this.b.seat;
    return null;
  }

  /** 房间内是否有在线连接（服务器据此决定是否启动空闲回收） */
  hasLiveConn(): boolean {
    return !!this.a?.conn || !!this.b?.conn || this.spectators.size > 0;
  }

  /** 房间摘要（房间列表用） */
  summary(): RoomSummary {
    return {
      roomId: this.id,
      players: (this.a?.conn ? 1 : 0) + (this.b?.conn ? 1 : 0),
      status: this.game.status,
      mode: this.mode,
      locked: this.password !== null,
      ownerName: this.a?.player.name ?? '—',
    };
  }

  // ------------------------------------------------------------ 加入 / 离开

  /**
   * 玩家加入（**不**在此触发开局，由服务器下发 room_joined 后再调用 afterJoin）：
   * - 命中已有席位（同一 playerId）→ 视为重连，恢复原局
   * - 否则占用空席位；两席皆满（含 AI 房）返回 'full'
   */
  joinPlayer(conn: Conn, player: PlayerRef): 'joined' | 'rejoined' | 'full' {
    // 先按玩家 id 匹配已有席位（含宽限期内连接已摘除的席位）
    if (this.a && this.a.player.id === player.id) return this.restoreMember(this.a, conn);
    if (this.b && this.b.player.id === player.id) return this.restoreMember(this.b, conn);
    if (this.a && this.b) return 'full';

    if (!this.a) {
      this.a = { conn, player, seat: this.ownerSide, graceTimer: null };
      logInfo(`房间 ${this.id}：房主加入（${player.name}）`);
      return 'joined';
    }
    this.b = { conn, player, seat: other(this.ownerSide), graceTimer: null };
    logInfo(`房间 ${this.id}：对手加入（${player.name}）`);
    wsSend(this.a.conn, { type: 'opponent_joined', player });
    return 'joined';
  }

  /**
   * 服务器在向加入者下发 room_joined **之后**调用：
   * 重连补发状态、双方到齐开局、或启动人机对战。
   */
  afterJoin(rejoined: boolean, playerId: string): void {
    if (this.closed) return;
    // 重连：通知对手并同步最新快照（补发，避免与 room_joined 竞态）
    const m = this.memberOfPlayer(playerId);
    if (rejoined && m) wsSend(this.opponentOf(m)?.conn, { type: 'opponent_joined', player: m.player });
    if (rejoined && this.game.status === 'playing') {
      this.broadcast({ type: 'state', state: this.game.snapshot() });
    }
    if (this.mode === 'ai') {
      if (!this.aiStarted) {
        this.aiStarted = true;
        this.startAiGame();
      }
      return;
    }
    this.maybeStart();
  }

  /** 观战者加入（只读，不占席位） */
  joinSpectator(conn: Conn): boolean {
    if (this.spectators.size >= this.deps.maxSpectators) return false;
    this.spectators.add(conn);
    logInfo(`房间 ${this.id}：观战者加入（当前 ${this.spectators.size} 人）`);
    return true;
  }

  /** 席位重连：保留原对局与回合，取消宽限 */
  private restoreMember(m: Member, conn: Conn): 'rejoined' {
    this.cancelGrace(m);
    m.conn = conn;
    logInfo(
      `房间 ${this.id}：${m === this.a ? '房主' : '对手'}重连${this.game.status === 'playing' ? '（恢复对局）' : ''}`,
    );
    return 'rejoined';
  }

  /** 主动离开房间（不走宽限） */
  leave(conn: Conn): void {
    conn.leaving = true;
    this.handleClose(conn);
  }

  /** 连接断开（意外或主动），由服务器在 socket close 事件中调用 */
  handleClose(conn: Conn): void {
    if (conn.role === 'spectator') {
      this.spectators.delete(conn);
      logInfo(`房间 ${this.id}：观战者离开（剩余 ${this.spectators.size} 人）`);
      return;
    }
    const m = this.memberByConn(conn);
    if (!m) return;
    const isOwner = m === this.a;
    m.conn = null;

    const immediate = !!conn.leaving || this.game.status !== 'playing';
    if (immediate) {
      if (isOwner) {
        // 房主离开：房间失去房主，直接销毁
        this.abandonGame();
        this.close('房主已离开');
      } else {
        this.dropSeatB('对手已离开');
      }
      return;
    }
    // 意外断线：保留席位，宽限期内可重连
    this.startGrace(m, isOwner ? '房主已断开' : '对手已断开');
  }

  /** 清空对手席并回到等待状态（对手离开 / 宽限超时 / 房主放弃等待） */
  private dropSeatB(reason: string): void {
    this.cancelGrace(this.b);
    this.b = null;
    this.abandonGame();
    this.game.reset(this.a ? 'waiting' : 'idle');
    if (this.a?.conn) {
      wsSend(this.a.conn, { type: 'state', state: this.game.snapshot() });
      wsSend(this.a.conn, { type: 'opponent_left', reason });
    }
  }

  /** 放弃一局：清空进行中记录与猜先状态，避免串到下一局 */
  private abandonGame(): void {
    this.currentRecord = null;
    this.guessStage = null;
    this.pendingGuess = null;
    this.lastGuess = null;
    this.clearTurnTimer();
    this.clearAiTimer();
  }

  // ------------------------------------------------------------ 房间消息

  /** 处理房间内的对局消息（create/join/leave/list/ping 由服务器处理） */
  handleMessage(conn: Conn, msg: ClientMessage): void {
    // 观战者只读
    if (conn.role === 'spectator') return this.fail(conn, '观战模式只读');
    const seat = this.seatOf(conn);

    switch (msg.type) {
      case 'move': {
        if (seat === null) return this.fail(conn, '尚未加入对局');
        const { from, to } = msg;
        // 坐标必须是整数对；越界由规则引擎按「越界」拒绝
        if (!isValidPos(from) || !isValidPos(to)) {
          return wsSend(conn, {
            type: 'move_rejected',
            from: from ?? [0, 0],
            to: to ?? [0, 0],
            reason: '坐标非法',
          });
        }
        const result = this.applyAndBroadcast(from, to, seat);
        if (!result.ok) {
          return wsSend(conn, { type: 'move_rejected', from, to, reason: result.reason ?? '非法走子' });
        }
        return;
      }
      case 'resign': {
        if (seat === null) return;
        this.game.resign(seat);
        logInfo(`房间 ${this.id}：认输（${sideLabel(seat)}）`);
        this.broadcastGameOver();
        return;
      }
      case 'draw_request': {
        if (seat === null || this.game.status !== 'playing') return;
        if (this.mode === 'ai') {
          logInfo(`房间 ${this.id}：人机对战 AI 拒绝和棋`);
          return wsSend(conn, { type: 'draw_response', accept: false });
        }
        this.game.pendingDraw = seat;
        this.sendToSeat(other(seat), { type: 'draw_request' });
        return;
      }
      case 'draw_response': {
        if (seat === null) return;
        const requester = this.game.pendingDraw;
        if (requester === null || requester === seat) return;
        if (msg.accept) {
          this.game.acceptDraw();
          logInfo(`房间 ${this.id}：和棋（双方同意）`);
          this.broadcast({ type: 'draw_response', accept: true });
          this.broadcastGameOver();
        } else {
          this.game.pendingDraw = null;
          this.sendToSeat(requester, { type: 'draw_response', accept: false });
        }
        return;
      }
      case 'restart_request': {
        if (seat === null || !this.game.canRestart()) return;
        if (this.mode === 'ai') {
          // 人机对战：AI 自动同意重开
          this.broadcast({ type: 'restart_response', accept: true });
          this.startAiGame();
          return;
        }
        this.game.pendingRestart = seat;
        this.sendToSeat(other(seat), { type: 'restart_request' });
        return;
      }
      case 'restart_response': {
        if (seat === null) return;
        const requester = this.game.pendingRestart;
        if (requester === null || requester === seat) return;
        this.game.pendingRestart = null;
        if (msg.accept) {
          this.broadcast({ type: 'restart_response', accept: true });
          this.startGame();
        } else {
          this.sendToSeat(requester, { type: 'restart_response', accept: false });
        }
        return;
      }
      case 'undo_request': {
        if (seat === null || this.game.status !== 'playing') return;
        if (this.game.history.length === 0) return this.fail(conn, '当前没有可悔的棋');
        if (this.mode === 'ai') {
          // 人机对战：AI 自动同意悔棋
          this.game.undo();
          this.afterMoveApplied();
          logInfo(`房间 ${this.id}：人机对战悔棋（AI 自动同意）`);
          wsSend(conn, { type: 'undo_response', accept: true });
          this.broadcast({ type: 'state', state: this.game.snapshot() });
          return;
        }
        if (this.game.pendingUndo !== null) return this.fail(conn, '悔棋请求已在进行中');
        if (!this.a?.conn || !this.b?.conn) return this.fail(conn, '对方不在线，无法悔棋');
        this.game.pendingUndo = seat;
        this.sendToSeat(other(seat), { type: 'undo_request' });
        return;
      }
      case 'undo_response': {
        if (seat === null) return;
        const requester = this.game.pendingUndo;
        if (requester === null || requester === seat) return;
        if (msg.accept) {
          this.game.pendingUndo = null;
          if (!this.game.undo()) {
            this.sendToSeat(requester, { type: 'undo_response', accept: false });
            return;
          }
          this.afterMoveApplied();
          logInfo(`房间 ${this.id}：悔棋（${sideLabel(requester)} 的请求被同意，回退一步）`);
          this.broadcast({ type: 'undo_response', accept: true });
          this.broadcast({ type: 'state', state: this.game.snapshot() });
        } else {
          this.game.pendingUndo = null;
          this.sendToSeat(requester, { type: 'undo_response', accept: false });
        }
        return;
      }
      case 'choose_first': {
        if (!this.isOwner(conn)) return this.fail(conn, '只有房主可以选择先手方式');
        if (this.mode === 'ai') return;
        if (this.game.status === 'playing') return this.fail(conn, '对局进行中，无法更改先手方式');
        if (!isFirstMode(msg.mode)) return this.fail(conn, '先手方式非法');
        this.firstMode = msg.mode;
        if (msg.mode === 'r' || msg.mode === 'b') this.ownerSide = msg.mode;
        this.guessStage = null; // 更换方式时取消进行中的猜先
        this.pendingGuess = null;
        logInfo(`房间 ${this.id}：房主选择先手方式 ${FIRST_MODE_LABEL[msg.mode]}`);
        this.maybeStart();
        return;
      }
      case 'grasp': {
        if (!this.isOwner(conn)) return this.fail(conn, '只有房主可以抓子');
        if (this.guessStage !== 'grasp') return this.fail(conn, '当前不在抓子阶段');
        if (!isGuessChoice(msg.choice)) return this.fail(conn, '抓子选择非法');
        this.pendingGuess = msg.choice;
        this.guessStage = 'guess';
        logInfo(`房间 ${this.id}：房主抓${msg.choice === 'odd' ? '单' : '双'}，等待对手猜单双`);
        this.sendToSeats({ type: 'guess_request' });
        return;
      }
      case 'guess': {
        if (!this.b?.conn || conn !== this.b.conn) return this.fail(conn, '只有对手可以猜先');
        if (this.guessStage !== 'guess' || this.pendingGuess === null || this.game.status === 'playing') {
          return this.fail(conn, '当前不在猜先阶段');
        }
        if (!isGuessChoice(msg.choice)) return this.fail(conn, '猜先选择非法');
        const actual = this.pendingGuess;
        const guestWon = msg.choice === actual;
        logInfo(
          `房间 ${this.id}：猜先 对手猜${msg.choice === 'odd' ? '单' : '双'}，实际${actual === 'odd' ? '单' : '双'}`,
        );
        this.beginFirst('guess', guestWon ? 'b' : 'r', { choice: msg.choice, actual, guestWon });
        return;
      }
      case 'set_password': {
        if (!this.isOwner(conn)) return this.fail(conn, '只有房主可以设置口令');
        const raw = typeof msg.password === 'string' ? msg.password.trim() : '';
        if (!this.setPassword(raw ? raw : null)) {
          return this.fail(conn, '对局进行中，无法更改口令');
        }
        return;
      }
      case 'wait_new_opponent': {
        if (!this.isOwner(conn)) return;
        if (!this.b?.graceTimer) return this.fail(conn, '当前没有等待重连的对手');
        this.cancelGrace(this.b);
        this.dropSeatB('已放弃等待对方重连');
        return;
      }
      default:
        return this.fail(conn, '未知消息类型');
    }
  }

  // ------------------------------------------------------------ 开局与走子

  private maybeStart(): void {
    if (this.closed || this.mode === 'ai') return;
    if (!this.a?.conn || !this.b?.conn) return;
    if (this.game.status !== 'idle' && this.game.status !== 'waiting') return;
    switch (this.firstMode) {
      case 'random': {
        // 随机黑红：开赛时随机决定房主阵营
        const ownerSide: Side = Math.random() < 0.5 ? 'r' : 'b';
        this.beginFirst('random', ownerSide, null);
        return;
      }
      case 'guess': {
        if (this.guessStage === 'grasp') return; // 已请房主抓子，等待房主应答
        if (this.guessStage === 'guess') {
          // 已抓子：等对手猜（对手重连时补发请求）
          this.sendToSeats({ type: 'guess_request' });
          return;
        }
        this.guessStage = 'grasp';
        logInfo(`房间 ${this.id}：猜先开始，等待房主抓单 / 抓双`);
        wsSend(this.a.conn, { type: 'grasp_request' });
        return;
      }
      default: {
        this.beginFirst(this.firstMode, this.firstMode, null);
        return;
      }
    }
  }

  /** 席位确定（红 / 黑 / 随机 / 猜先）：分配阵营、广播结果并开局 */
  private beginFirst(mode: FirstMode, ownerSide: Side, guess: GuessResult | null): void {
    this.firstMode = mode;
    this.ownerSide = ownerSide;
    this.guessStage = null;
    this.pendingGuess = null;
    this.lastGuess = guess;
    if (this.a) this.a.seat = ownerSide;
    if (this.b) this.b.seat = other(ownerSide);
    this.broadcast({ type: 'first_result', mode, ownerSide, guess });
    logInfo(
      `房间 ${this.id}：席位确定（房主执${ownerSide === 'r' ? '红' : '黑'}，${FIRST_MODE_LABEL[mode]}）`,
    );
    this.startGame();
  }

  /** 开局：重置对局（揭棋为洗子开局）并向各连接下发各自阵营 + 记录本局信息 */
  private startGame(): void {
    this.cancelOverTimer();
    if (this.mode === 'jieqi') this.game.openJieqi();
    else this.game.reset('playing');
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

  /** 开始人机对战：AI 占黑席，对局立即开始（人类执红） */
  private startAiGame(): void {
    this.cancelOverTimer();
    this.ownerSide = 'r';
    if (this.a) this.a.seat = 'r';
    if (this.b) this.b.seat = 'b';
    this.game.reset('playing');
    this.afterMoveApplied();
    this.dispatchStart();
    this.currentRecord = { startedAt: Date.now(), firstMode: 'r', guess: null, ai: true };
    logInfo(`房间 ${this.id}：人机对战开始（AI 执黑）`);
  }

  /** 逐连接下发 start（红黑阵营随席位变化，观战者为 null） */
  private dispatchStart(): void {
    const state = this.game.snapshot();
    if (this.a?.conn) wsSend(this.a.conn, { type: 'start', state, side: this.a.seat });
    if (this.b?.conn) wsSend(this.b.conn, { type: 'start', state, side: this.b.seat });
    for (const c of this.spectators) wsSend(c, { type: 'start', state, side: null });
  }

  /** 走子：校验通过后广播 move_applied，终局追加 game_over；返回校验结果 */
  private applyAndBroadcast(from: Pos, to: Pos, side: Side): MoveResult {
    const result = this.game.applyMove(from, to, side);
    if (!result.ok) {
      logDebug(
        `房间 ${this.id}：走子被拒绝 ${sideLabel(side)} ${from}→${to}（${result.reason ?? '非法走子'}）`,
      );
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
      // 揭棋：随广播下发变体标记与吃子记录（棋盘已在 snapshot 中抹除暗子真实身份）
      ...(s.variant
        ? {
            variant: s.variant,
            capturedByRed: s.capturedByRed,
            capturedByBlack: s.capturedByBlack,
          }
        : {}),
    };
    this.broadcast(applied);
    logInfo(
      `房间 ${this.id}：走子 ${sideLabel(side)} ${from[0]},${from[1]} → ${to[0]},${to[1]}（第 ${s.moveSeq} 步）`,
    );
    if (s.status === 'over') this.broadcastGameOver();
    return result;
  }

  /** 广播终局并打点，写入对局记录并启动「无人再来一局」的销毁倒计时 */
  private broadcastGameOver(): void {
    const s = this.game.snapshot();
    this.broadcast({ type: 'game_over', winner: s.winner, reason: s.reason, state: s });
    this.saveRecord();
    logInfo(
      `房间 ${this.id}：对局结束 ${s.winner === null ? '和棋' : `${sideLabel(s.winner)}胜`}（${s.reason}）`,
    );
    this.armOverTimer();
  }

  /** 终局落库（同一局只写一次；人机对战不计入对局回顾） */
  private saveRecord(): void {
    const cur = this.currentRecord;
    this.currentRecord = null;
    if (!cur) return;
    if (cur.ai) {
      logInfo(`房间 ${this.id}：人机对战不计入对局回顾，跳过落库`);
      return;
    }
    if (this.mode === 'jieqi') {
      // 揭棋初始暗子分布无法由「标准开局 + 着法」复原，本版不落库（见 ADR-0011 §4）
      logInfo(`房间 ${this.id}：揭棋对局不计入对局回顾，跳过落库`);
      return;
    }
    const s = this.game.snapshot();
    const ownerPlayer: PlayerRef = this.a?.player ?? { id: this.ownerId, name: '—', kind: 'guest' };
    const oppPlayer: PlayerRef = this.b?.player ?? AI_PLAYER;
    const ownerIsRed = this.ownerSide === 'r';
    // 将死时识别杀法（如「马后炮杀」），随记录落库供对局回顾展示
    const mate =
      s.reason === '将死' ? classifyCheckmateFromHistory(this.game.board, s.history, s.winner) : null;
    const record: GameRecord = {
      id: `r${this.id}-${cur.startedAt}`,
      roomId: this.id,
      startedAt: cur.startedAt,
      endedAt: Date.now(),
      red: ownerIsRed ? ownerPlayer : oppPlayer,
      black: ownerIsRed ? oppPlayer : ownerPlayer,
      firstMode: cur.firstMode,
      guess: cur.guess,
      winner: s.winner,
      reason: s.reason,
      killMethod: mate?.recognized ? mate.pattern.label : undefined,
      moveCount: s.history.length,
      moves: [...s.history],
    };
    this.deps.onRecord(record);
    logInfo(
      `房间 ${this.id}：对局记录已保存（${record.moveCount} 步，${record.reason}${
        record.killMethod ? ` · ${record.killMethod}` : ''
      }）`,
    );
  }

  // --------------------------------------------------- 人机对战与计时

  /** 走子 / 悔棋 / 开局后统一处理：刷新回合计时并检查 AI 是否需要走子 */
  private afterMoveApplied(): void {
    this.armTurnTimer();
    this.scheduleAiMove();
  }

  /** 计时读秒：写入本回合截止时间并安排超时判负（turnMs<=0 表示不限时） */
  private armTurnTimer(): void {
    this.clearTurnTimer();
    const turnMs = this.deps.turnMs;
    if (turnMs <= 0 || this.game.status !== 'playing') {
      this.game.deadline = null;
      return;
    }
    this.game.deadline = Date.now() + turnMs;
    const timer = setTimeout(() => {
      this.turnTimer = null;
      if (this.game.status !== 'playing') return;
      const loser = this.game.turn;
      this.game.timeout(loser);
      logInfo(`房间 ${this.id}：计时超时，${sideLabel(loser)} 判负`);
      this.broadcastGameOver();
    }, turnMs);
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
    if (this.mode !== 'ai' || this.game.status !== 'playing' || this.game.turn !== 'b') return;
    const timer = setTimeout(() => {
      this.aiTimer = null;
      if (this.game.status !== 'playing' || this.game.turn !== 'b') return;
      const move = pickMove(this.game.board, 'b', { depth: this.aiDepth });
      if (!move) return;
      logInfo(`房间 ${this.id}：AI 走子 ${move.from[0]},${move.from[1]} → ${move.to[0]},${move.to[1]}`);
      this.applyAndBroadcast(move.from, move.to, 'b');
    }, this.deps.aiDelayMs);
    timer.unref();
    this.aiTimer = timer;
  }

  private clearAiTimer(): void {
    if (this.aiTimer) {
      clearTimeout(this.aiTimer);
      this.aiTimer = null;
    }
  }

  // ------------------------------------------------------- 断线宽限

  private startGrace(m: Member, reason: string): void {
    this.cancelGrace(m);
    logInfo(`房间 ${this.id}：${reason}，等待重连（宽限 ${this.deps.graceMs}ms）`);
    const timer = setTimeout(() => {
      m.graceTimer = null;
      this.expireGrace(m);
    }, this.deps.graceMs);
    timer.unref();
    m.graceTimer = timer;
    wsSend(this.opponentOf(m)?.conn, { type: 'opponent_away', reason, graceMs: this.deps.graceMs });
  }

  private cancelGrace(m: Member | null): void {
    if (m?.graceTimer) {
      clearTimeout(m.graceTimer);
      m.graceTimer = null;
    }
  }

  /** 宽限超时：房主席位 → 销毁房间；对手席位 → 清空并回到等待新对手 */
  private expireGrace(m: Member): void {
    if (m.conn) return; // 宽限期内已重连
    logInfo(`房间 ${this.id}：${m === this.a ? '房主' : '对手'}宽限超时`);
    if (m === this.a) {
      this.abandonGame();
      this.close('房主已断开');
    } else {
      this.dropSeatB('对手已离开');
    }
  }

  // ------------------------------------------------- 终局销毁倒计时

  /** 终局后启动销毁倒计时：期间无人「再来一局」则销毁房间 */
  private armOverTimer(): void {
    this.cancelOverTimer();
    if (this.deps.overTtlMs <= 0) return;
    const timer = setTimeout(() => {
      this.overTimer = null;
      logInfo(`房间 ${this.id}：对局结束且无人再来一局，销毁房间`);
      this.close('对局已结束');
    }, this.deps.overTtlMs);
    timer.unref();
    this.overTimer = timer;
  }

  private cancelOverTimer(): void {
    if (this.overTimer) {
      clearTimeout(this.overTimer);
      this.overTimer = null;
    }
  }

  // ------------------------------------------------- 空闲回收（服务器驱动）

  /** 房间内已无在线连接：启动空闲回收倒计时 */
  armIdleTimer(ms: number): void {
    if (this.idleTimer || this.closed) return;
    const timer = setTimeout(() => {
      this.idleTimer = null;
      if (this.hasLiveConn()) return;
      logInfo(`房间 ${this.id}：空闲超时，销毁房间`);
      this.close('房间已闲置');
    }, ms);
    timer.unref();
    this.idleTimer = timer;
  }

  /** 有连接重新加入：取消空闲回收 */
  cancelIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ------------------------------------------------------------ 销毁

  /** 销毁房间：通知房内所有连接，并交回服务器清理房间表与连接归属 */
  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.invited.clear();
    this.cancelGrace(this.a);
    this.cancelGrace(this.b);
    this.clearTurnTimer();
    this.clearAiTimer();
    this.cancelOverTimer();
    this.cancelIdleTimer();
    logInfo(`房间 ${this.id}：已销毁（${reason}）`);
    this.broadcast({ type: 'room_closed', reason });
    this.deps.onClose(this, reason);
  }

  // ------------------------------------------------------------ 工具

  private isOwner(conn: Conn): boolean {
    return !!this.a && this.a.conn === conn;
  }

  private memberByConn(conn: Conn): Member | null {
    if (this.a?.conn === conn) return this.a;
    if (this.b?.conn === conn) return this.b;
    return null;
  }

  private opponentOf(m: Member): Member | null {
    return m === this.a ? this.b : this.a;
  }

  /** 连接对应的阵营（未入座返回 null） */
  private seatOf(conn: Conn): Side | null {
    return this.memberByConn(conn)?.seat ?? null;
  }

  /** 按阵营取成员（房主不一定执红） */
  private memberOf(side: Side): Member | null {
    if (this.a?.seat === side) return this.a;
    if (this.b?.seat === side) return this.b;
    return null;
  }

  /** 按玩家 id 取成员（重连后补发状态用） */
  private memberOfPlayer(playerId: string): Member | null {
    if (this.a?.player.id === playerId) return this.a;
    if (this.b?.player.id === playerId) return this.b;
    return null;
  }

  private sendToSeat(side: Side, msg: ServerMessage): void {
    wsSend(this.memberOf(side)?.conn, msg);
  }

  /** 发给两个对战席位（不含观战者） */
  private sendToSeats(msg: ServerMessage): void {
    wsSend(this.a?.conn, msg);
    wsSend(this.b?.conn, msg);
  }

  private broadcast(msg: ServerMessage): void {
    this.sendToSeats(msg);
    for (const c of this.spectators) wsSend(c, msg);
  }

  private fail(conn: Conn, message: string): void {
    wsSend(conn, { type: 'error', message });
  }
}

/** AI 推荐：按记录 + 步数复原局面，返回该局面行棋方的推荐着法（复盘用） */
export function hintFor(record: GameRecord, index: number, depth: number): AiHint | null {
  const n = Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, record.moves.length));
  const board = initBoard();
  for (let i = 0; i < n; i++) makeMove(board, record.moves[i].from, record.moves[i].to);
  const side: Side = n % 2 === 0 ? 'r' : 'b';
  const level = Number.isFinite(depth) ? Math.min(4, Math.max(1, Math.floor(depth))) : 2;
  const move = pickMove(board, side, { depth: level, timeLimitMs: 1200 });
  if (!move) return null;
  return { side, from: move.from, to: move.to, text: describeMove(board, move.from, move.to) };
}
