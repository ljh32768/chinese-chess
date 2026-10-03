import { describe, expect, it } from 'vitest';
import { boardAfterMove, initBoard, judgeAfterMove, legalMoves } from '../src/shared/rules.js';
import { pickMove } from '../src/server/ai.js';
import { Board, PieceType, Side } from '../src/shared/types.js';

/** 构造一个只含指定棋子的空棋盘 */
function makeBoard(pieces: Array<[number, number, PieceType, Side]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, t, s] of pieces) b[r][c] = { t, s };
  return b;
}

/** 棋盘上某方是否存在合法着法 */
function hasAnyLegalMove(b: Board, s: Side): boolean {
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (p && p.s === s && legalMoves(b, r, c).length > 0) return true;
    }
  }
  return false;
}

describe('AI 一步杀', () => {
  it('红方能在一步内将死黑方', () => {
    const board = makeBoard([
      [9, 4, 'K', 'r'],
      [1, 0, 'R', 'r'],
      [2, 8, 'R', 'r'],
      [5, 4, 'P', 'r'],
      [0, 4, 'K', 'b'],
    ]);
    const move = pickMove(board, 'r', { depth: 2 });
    expect(move).not.toBeNull();
    const after = boardAfterMove(board, move!.from, move!.to);
    expect(judgeAfterMove(after, 'b')).toEqual({ winner: 'r', reason: '将死' });
  });
});

describe('AI 白吃子', () => {
  it('黑方会无代价吃掉红车', () => {
    const board = makeBoard([
      [9, 3, 'K', 'r'],
      [0, 5, 'K', 'b'],
      [4, 3, 'R', 'r'],
      [4, 4, 'R', 'b'],
    ]);
    const move = pickMove(board, 'b', { depth: 2 });
    expect(move).not.toBeNull();
    expect(move!.from).toEqual([4, 4]);
    expect(move!.to).toEqual([4, 3]);
  });
});

describe('AI 无着法', () => {
  it('某方无任何合法着法时返回 null', () => {
    // 黑将被将死，且确认 legalMoves 为空
    const board = makeBoard([
      [0, 4, 'K', 'b'],
      [0, 8, 'R', 'r'],
      [1, 0, 'R', 'r'],
      [9, 3, 'K', 'r'],
    ]);
    expect(hasAnyLegalMove(board, 'b')).toBe(false);
    expect(pickMove(board, 'b')).toBeNull();
  });
});

describe('AI 开局合法性', () => {
  it('返回的着法必须合法，且 depth=2 耗时 < 1500ms', () => {
    const board = initBoard();
    const start = Date.now();
    const move = pickMove(board, 'r', { depth: 2 });
    const elapsed = Date.now() - start;
    console.log('OPENING_DEPTH2_MS:', elapsed);
    expect(move).not.toBeNull();
    const legal = legalMoves(board, move!.from[0], move!.from[1]);
    expect(legal.some(([r, c]) => r === move!.to[0] && c === move!.to[1])).toBe(true);
    expect(elapsed).toBeLessThan(1500);
  });
});
