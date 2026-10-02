/**
 * 主机权威的对局状态机。
 * 唯一真实棋盘状态在这里维护，所有走子都必须经过 applyMove 校验。
 */

import { Board, GameSnapshot, GameStatus, Move, Pos, Side } from '../shared/types.js';
import { initBoard, isInCheck, judgeAfterMove, makeMove, validateMove } from '../shared/rules.js';

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

  /** 待处理的求和 / 重开请求发起方 */
  pendingDraw: Side | null = null;
  pendingRestart: Side | null = null;

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

    makeMove(this.board, from, to);
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
    }
    return { ok: true };
  }

  /** 认输 */
  resign(side: Side): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = side === 'r' ? 'b' : 'r';
    this.reason = '认输';
    this.pendingDraw = null;
    this.pendingRestart = null;
  }

  /** 双方同意和棋 */
  acceptDraw(): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = null;
    this.reason = '同意和棋';
    this.pendingDraw = null;
    this.pendingRestart = null;
  }

  /** 是否可以重开（对局已结束） */
  canRestart(): boolean {
    return this.status === 'over';
  }
}