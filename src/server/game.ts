/**
 * 主机权威的对局状态机。
 * 唯一真实棋盘状态在这里维护，所有走子都必须经过 applyMove 校验。
 */

import { Board, GameSnapshot, GameStatus, Move, Pos, Side } from '../shared/types.js';
import { cloneBoard, initBoard, isInCheck, judgeAfterMove, makeMove, validateMove } from '../shared/rules.js';

export interface MoveResult {
  ok: boolean;
  reason?: string;
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
  }> = [];

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
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.history = [];
    this.past = [];
    this.deadline = null;
  }

  /** 生成当前快照 */
  snapshot(): GameSnapshot {
    return {
      board: this.board,
      turn: this.turn,
      moveSeq: this.moveSeq,
      status: this.status,
      winner: this.winner,
      reason: this.reason,
      lastMove: this.lastMove,
      check: this.check,
      history: this.history.map((m) => ({ from: [...m.from] as Pos, to: [...m.to] as Pos })),
      deadline: this.deadline,
    };
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

    // 记录走子前局面，供悔棋回退
    this.past.push({
      board: cloneBoard(this.board),
      turn: this.turn,
      moveSeq: this.moveSeq,
      lastMove: this.lastMove,
      check: this.check,
    });
    makeMove(this.board, from, to);
    this.history.push({ from: [...from] as Pos, to: [...to] as Pos });
    this.lastMove = { from, to };
    this.moveSeq += 1;
    this.turn = side === 'r' ? 'b' : 'r';

    // 判定将军 / 将死 / 困毙
    const sideToMove = this.turn;
    this.check = isInCheck(this.board, sideToMove);
    const outcome = judgeAfterMove(this.board, sideToMove);
    if (outcome) {
      this.status = 'over';
      this.winner = outcome.winner;
      this.reason = outcome.reason;
      // 终局清理待处理请求（与 resign / acceptDraw / reset 保持一致）
      this.pendingDraw = null;
      this.pendingRestart = null;
      this.pendingUndo = null;
      this.deadline = null;
    }
    return { ok: true };
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
    };
    this.history.pop();
    this.board = prev.board;
    this.turn = prev.turn;
    this.moveSeq = prev.moveSeq;
    this.lastMove = prev.lastMove;
    this.check = prev.check;
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
