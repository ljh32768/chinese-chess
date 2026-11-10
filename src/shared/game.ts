/**
 * 权威对局状态机（服务端房间 / 客户端本地人机对弈共用）。
 * 唯一真实棋盘状态在这里维护，所有走子都必须经过 applyMove 校验。
 *
 * 走子后除了判定将军 / 将死 / 困毙，还会记录局面历史：连续「打」（将 / 捉）到第 5 步时
 * **禁走这一手**（返回 `code: 'vary'`，渲染层弹层提示「请变招」；除长将 / 长捉外无棋可走时放行）；
 * 同一局面第 3 次出现且无人单方长打时置 `repetitionHint` 提示「请变招」。任何情况都不判负，
 * 见 [repetition.ts](./repetition.ts)。
 */

import { Board, GameSnapshot, GameStatus, GameVariant, Move, PieceType, Pos, Side } from './types.js';
import {
  boardAfterMove,
  cloneBoard,
  initBoard,
  isInCheck,
  judgeAfterMove,
  legalMoves,
  makeMove,
  validateMove,
} from './rules.js';
import { blocksVaryStep, classifyMove, MoveNature, positionKey, judgeRepetition } from './repetition.js';
import { dealBoard, redactBoard, revealAt } from './jieqi.js';

export interface MoveResult {
  ok: boolean;
  reason?: string;
  /** 失败码：`vary` = 长将 / 长捉第 5 步被拦截（渲染层用弹层提示「请变招」） */
  code?: 'vary';
}

export class Game {
  board: Board = initBoard();
  turn: Side = 'r';
  moveSeq = 0;
  status: GameStatus = 'idle';
  winner: Side | null = null;
  reason = '';
  lastMove: Move | null = null;
  check = false;

  /**
   * 重复局面提示：本手构成三次重复且无人单方长打时置位（不判和，改为提示「请变招」）。
   * 每手走子重新计算（未构成提示则清零），悔棋 / 重开同步清除；随快照下发。
   * 注：连续长将 / 长捉到第 5 步不再置位提示，而是在 `applyMove` 里直接禁走（`code: 'vary'`）。
   */
  repetitionHint = false;

  /** 对局变体：标准象棋 / 揭棋（暗棋）。揭棋下发快照时抹除暗子真实身份 */
  variant: GameVariant = 'xiangqi';

  /** 揭棋：红方 / 黑方已吃掉的子（含被吃暗子翻开后的真实身份） */
  capturedByRed: PieceType[] = [];
  capturedByBlack: PieceType[] = [];

  /** 待处理的求和 / 重开 / 悔棋请求发起方 */
  pendingDraw: Side | null = null;
  pendingRestart: Side | null = null;
  pendingUndo: Side | null = null;

  /** 完整着法序列（棋谱 / 悔棋 / 回放基础） */
  history: Move[] = [];

  /** 本回合截止时间（epoch ms，由主机服务写入）；null 表示不限时 */
  deadline: number | null = null;

  /** 每一步走子前的局面快照（悔棋回退用） */
  private past: Array<{
    board: Board;
    turn: Side;
    moveSeq: number;
    lastMove: Move | null;
    check: boolean;
    capRed: PieceType[];
    capBlack: PieceType[];
  }> = [];

  /** 每个局面的键（下标 i = 第 i 手之后），用于三次重复提示 */
  private posKeys: string[] = [];

  /** 每一手相对走子方的性质（将 / 捉 / 闲），与 history 下标对齐 */
  private moveNatures: Array<{ side: Side; nature: MoveNature }> = [];

  /** 重置为标准开局；status 默认 playing */
  reset(status: GameStatus = 'playing'): void {
    this.board = initBoard();
    this.turn = 'r';
    this.moveSeq = 0;
    this.status = status;
    this.winner = null;
    this.reason = '';
    this.lastMove = null;
    this.check = false;
    this.repetitionHint = false;
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.history = [];
    this.past = [];
    this.posKeys = [positionKey(this.board, this.turn)];
    this.moveNatures = [];
    this.deadline = null;
    this.capturedByRed = [];
    this.capturedByBlack = [];
  }

  /**
   * 揭棋（暗棋）开局：置变体为 `jieqi` 并以洗子局面开始。
   * 真实身份只留在本权威端（服务端 / 本地 AI 宿主），对外由 snapshot() 抹除。
   */
  openJieqi(): void {
    this.variant = 'jieqi';
    this.reset('playing');
    this.board = dealBoard();
    this.check = isInCheck(this.board, this.turn);
  }

  /**
   * 载入自定义初始局面（残局挑战用）：清空对局元信息，换上给定棋盘与行棋方。
   * 与 reset 一样把状态置为 `playing`（残局从指定局面直接开始）。
   */
  setup(board: Board, turn: Side): void {
    this.reset('playing');
    this.board = cloneBoard(board);
    this.turn = turn;
    this.check = isInCheck(this.board, turn);
    this.posKeys = [positionKey(this.board, this.turn)];
  }

  /** 生成当前快照（揭棋下抹除暗子真实身份；始终附带双方吃子记录） */
  snapshot(): GameSnapshot {
    const jieqi = this.variant === 'jieqi';
    const snap: GameSnapshot = {
      board: jieqi ? redactBoard(this.board) : this.board,
      turn: this.turn,
      moveSeq: this.moveSeq,
      status: this.status,
      winner: this.winner,
      reason: this.reason,
      lastMove: this.lastMove,
      check: this.check,
      history: this.history.map((m) => ({ from: [...m.from] as Pos, to: [...m.to] as Pos })),
      deadline: this.deadline,
      // 吃子记录对标准 / 揭棋 / 残局 / 人机一律下发：渲染层据此展示棋盘两侧吃子条，
      // 不再按着法序列从标准开局推导（残局自定义开局下会推出并不存在的「死子」）
      capturedByRed: [...this.capturedByRed],
      capturedByBlack: [...this.capturedByBlack],
    };
    if (jieqi) snap.variant = this.variant;
    if (this.repetitionHint) snap.repetitionHint = true;
    return snap;
  }

  /**
   * 校验并应用一步走子（主机权威）。
   * @param side 发起方阵营
   */
  applyMove(from: Pos, to: Pos, side: Side): MoveResult {
    if (this.status !== 'playing') return { ok: false, reason: '对局未在进行中' };
    if (side !== this.turn) return { ok: false, reason: '还没轮到你走棋' };

    const err = validateMove(this.board, from, to, side);
    if (err) return { ok: false, reason: err };

    // 长将 / 长捉第 5 步：禁走这一手（除这类着法外无棋可走时放行），由渲染层弹层提示「请变招」
    if (this.isVaryBlocked(from, to, side)) {
      return { ok: false, reason: '长将 / 长捉不可持续到第 5 步，请变招', code: 'vary' };
    }

    const target = this.board[to[0]][to[1]];
    // 记录走子前局面，供悔棋回退与「捉」判定
    this.past.push({
      board: cloneBoard(this.board),
      turn: this.turn,
      moveSeq: this.moveSeq,
      lastMove: this.lastMove,
      check: this.check,
      capRed: [...this.capturedByRed],
      capBlack: [...this.capturedByBlack],
    });
    const before = this.past[this.past.length - 1].board;
    makeMove(this.board, from, to);
    // 记录被吃子（标准 / 揭棋 / 残局 / 人机一致）：揭棋暗子取真实身份，其余取当前兵种。
    // 渲染层两侧吃子条直接采用 capturedByRed/Black，故必须对所有变体都记录。
    if (target) {
      (side === 'r' ? this.capturedByRed : this.capturedByBlack).push(target.real ?? target.t);
    }
    // 揭棋：落点的暗子翻开
    if (this.variant === 'jieqi') revealAt(this.board, to);
    this.history.push({ from: [...from] as Pos, to: [...to] as Pos });
    // 记录本手性质（将 / 捉 / 闲）与走子后的局面键，供长将 / 长捉拦截与三次重复提示
    this.moveNatures.push({ side, nature: classifyMove(before, this.board, side) });
    this.lastMove = { from, to };
    this.moveSeq += 1;
    this.turn = side === 'r' ? 'b' : 'r';
    this.posKeys.push(positionKey(this.board, this.turn));

    // 判定将军 / 将死 / 困毙
    const sideToMove = this.turn;
    this.check = isInCheck(this.board, sideToMove);
    const outcome = judgeAfterMove(this.board, sideToMove);
    if (outcome) {
      this.endGame(outcome.winner, outcome.reason);
      return { ok: true };
    }

    // 重复局面提示：长将 / 长捉已在上方拦截；这里只处理「同一局面第 3 次出现且无人单方长打」，
    // 不判和、不判负，置位 repetitionHint（随快照下发，渲染层提示「请变招」），对局继续
    const ruling = judgeRepetition({ keys: this.posKeys, natures: this.moveNatures });
    this.repetitionHint = ruling?.outcome === 'hint';
    return { ok: true };
  }

  /**
   * 长将 / 长捉拦截：本手是该方连续「打」（将 / 捉）的第 5 步、走完的局面与此前重复（形成循环），
   * 且还存在其它不会构成第 5 步的合法着法 → 返回 `true`（禁走）。
   * 例外：若所有合法着法都会构成第 5 步（除长将 / 长捉外无棋可走），或局面并未重复（正常进攻），
   * 返回 `false` 放行。
   */
  isVaryBlocked(from: Pos, to: Pos, side: Side): boolean {
    const after = boardAfterMove(this.board, from, to);
    const nature = classifyMove(this.board, after, side);
    if (nature === 'idle') return false;
    // 只有形成重复循环的连续「打」才算长将 / 长捉：本手走完的局面此前出现过才拦截，
    // 避免把正常进攻中的连续将军 / 捉子（局面一路向前、并未重复）误判为长打
    if (!this.posKeys.includes(positionKey(after, side === 'r' ? 'b' : 'r'))) return false;
    const alternatives: MoveNature[] = [];
    for (let r = 0; r < this.board.length; r++) {
      for (let c = 0; c < this.board[r].length; c++) {
        const p = this.board[r][c];
        if (!p || p.s !== side) continue;
        for (const [tr, tc] of legalMoves(this.board, r, c)) {
          // 排除本手自身
          if (r === from[0] && c === from[1] && tr === to[0] && tc === to[1]) continue;
          alternatives.push(classifyMove(this.board, boardAfterMove(this.board, [r, c], [tr, tc]), side));
        }
      }
    }
    return blocksVaryStep(this.moveNatures, side, nature, alternatives, true);
  }

  /**
   * AI 专用：避开「请变招」拦截——首选着法不被拦截时直接返回；否则改选第一条不被拦截的合法着法。
   * 若所有合法着法都被拦截（例外分支：除长将 / 长捉外无棋可走），返回首选着法（放行）。
   */
  pickVarySafeMove(side: Side, preferred: Move): Move {
    if (!this.isVaryBlocked(preferred.from, preferred.to, side)) return preferred;
    for (let r = 0; r < this.board.length; r++) {
      for (let c = 0; c < this.board[r].length; c++) {
        const p = this.board[r][c];
        if (!p || p.s !== side) continue;
        for (const to of legalMoves(this.board, r, c)) {
          if (!this.isVaryBlocked([r, c], to, side)) return { from: [r, c], to };
        }
      }
    }
    return preferred;
  }

  /** 结算终局：置 over、记录胜方与原因，并清空待处理请求与计时 */
  private endGame(winner: Side | null, reason: string): void {
    this.status = 'over';
    this.winner = winner;
    this.reason = reason;
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.deadline = null;
  }

  /** 悔棋：回退一步（仅对局进行中且有棋可悔）。返回是否成功 */
  undo(): boolean {
    if (this.status !== 'playing' || this.past.length === 0) return false;
    const prev = this.past.pop() as {
      board: Board;
      turn: Side;
      moveSeq: number;
      lastMove: Move | null;
      check: boolean;
      capRed: PieceType[];
      capBlack: PieceType[];
    };
    this.history.pop();
    this.posKeys.pop();
    this.moveNatures.pop();
    this.board = prev.board;
    this.turn = prev.turn;
    this.moveSeq = prev.moveSeq;
    this.lastMove = prev.lastMove;
    this.check = prev.check;
    this.capturedByRed = prev.capRed;
    this.capturedByBlack = prev.capBlack;
    this.repetitionHint = false;
    this.pendingDraw = null;
    this.pendingUndo = null;
    this.deadline = null;
    return true;
  }

  /** 认输 */
  resign(side: Side): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = side === 'r' ? 'b' : 'r';
    this.reason = '认输';
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.deadline = null;
  }

  /** 超时判负（计时读秒） */
  timeout(loser: Side): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = loser === 'r' ? 'b' : 'r';
    this.reason = '超时判负';
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.deadline = null;
  }

  /** 双方同意和棋 */
  acceptDraw(): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = null;
    this.reason = '同意和棋';
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.deadline = null;
  }

  /** 是否可以重开（对局已结束） */
  canRestart(): boolean {
    return this.status === 'over';
  }
}
