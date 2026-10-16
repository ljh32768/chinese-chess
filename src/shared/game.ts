/**
 * 权威对局状态机（服务端房间 / 客户端本地人机对弈共用）。
 * 唯一真实棋盘状态在这里维护，所有走子都必须经过 applyMove 校验。
 *
 * 走子后除了判定将军 / 将死 / 困毙，还会记录局面历史并在同一局面第 3 次出现时做重复局面裁决
 * （长将 / 长捉 / 长打判负，或不变作和），见 [repetition.ts](./repetition.ts)。
 */

import { Board, GameSnapshot, GameStatus, Move, Pos, Side } from './types.js';
import { cloneBoard, initBoard, isInCheck, judgeAfterMove, makeMove, validateMove } from './rules.js';
import { classifyMove, judgeRepetition, MoveNature, positionKey } from './repetition.js';

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

  /** 每个局面的键（下标 i = 第 i 手之后），用于重复局面裁决 */
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
    this.pendingDraw = null;
    this.pendingRestart = null;
    this.pendingUndo = null;
    this.history = [];
    this.past = [];
    this.posKeys = [positionKey(this.board, this.turn)];
    this.moveNatures = [];
    this.deadline = null;
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

    // 记录走子前局面，供悔棋回退与「捉」判定
    this.past.push({
      board: cloneBoard(this.board),
      turn: this.turn,
      moveSeq: this.moveSeq,
      lastMove: this.lastMove,
      check: this.check,
    });
    const before = this.past[this.past.length - 1].board;
    makeMove(this.board, from, to);
    this.history.push({ from: [...from] as Pos, to: [...to] as Pos });
    // 记录本手性质（将 / 捉 / 闲）与走子后的局面键，供重复局面裁决
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

    // 重复局面裁决：同一局面第 3 次出现 —— 长将 / 长捉 / 长打判负，或不变作和
    const ruling = judgeRepetition({ keys: this.posKeys, natures: this.moveNatures });
    if (ruling) {
      this.endGame(ruling.outcome === 'draw' ? null : ruling.loser === 'r' ? 'b' : 'r', ruling.reason);
    }
    return { ok: true };
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
    };
    this.history.pop();
    this.posKeys.pop();
    this.moveNatures.pop();
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
