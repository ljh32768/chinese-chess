import { describe, expect, it } from 'vitest';
import { initBoard } from '../src/shared/rules.js';
import { Board, PieceType, Side } from '../src/shared/types.js';
import {
  boardToFen,
  fenToBoard,
  moveToUci,
  parseBestMove,
  posToSquare,
  squareToPos,
  uciToMove,
} from '../src/shared/uci.js';

/** 初始局面 FEN（已用皮卡鱼 `position fen` + `d` 实测一致） */
const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

/** 构造一个只含指定棋子的空棋盘 */
function makeBoard(pieces: Array<[number, number, PieceType, Side]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, t, s] of pieces) b[r][c] = { t, s };
  return b;
}

describe('UCI 换算：棋盘 ↔ 中国象棋 FEN', () => {
  it('初始局面 FEN 与皮卡鱼实测一致，行棋方随之切换', () => {
    expect(boardToFen(initBoard(), 'r')).toBe(START_FEN);
    expect(boardToFen(initBoard(), 'b')).toBe(START_FEN.replace(' w ', ' b '));
  });

  it('FEN 往返不变式：棋盘与行棋方均可还原', () => {
    const b = makeBoard([
      [9, 4, 'K', 'r'],
      [0, 4, 'K', 'b'],
      [7, 1, 'C', 'r'],
      [2, 7, 'C', 'b'],
      [4, 4, 'P', 'r'],
    ]);
    const round = fenToBoard(boardToFen(b, 'b'));
    expect(round).not.toBeNull();
    expect(round?.side).toBe('b');
    expect(round?.board).toEqual(b);
  });

  it('非法 FEN 返回 null（不抛异常）', () => {
    expect(fenToBoard('')).toBeNull();
    expect(fenToBoard('rnbakabnr/9/1c5c1 w - - 0 1')).toBeNull(); // 行数不足
    expect(fenToBoard('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR x - - 0 1')).toBeNull(); // 行棋方非法
    expect(fenToBoard('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNRR w - - 0 1')).toBeNull(); // 某行棋子数超过 9 列
  });
});

describe('UCI 换算：坐标与着法', () => {
  it('方格换算：b2 ↔ [7,1]，e0 ↔ [9,4]', () => {
    expect(posToSquare([7, 1])).toBe('b2');
    expect(squareToPos('b2')).toEqual([7, 1]);
    expect(posToSquare([9, 4])).toBe('e0');
    expect(squareToPos('e0')).toEqual([9, 4]);
    expect(squareToPos('j9')).toBeNull();
    expect(squareToPos('a')).toBeNull();
  });

  it('着法换算：炮二平五 [7,1]→[7,4] 即 b2e2', () => {
    expect(moveToUci({ from: [7, 1], to: [7, 4] })).toBe('b2e2');
    expect(uciToMove('b2e2')).toEqual({ from: [7, 1], to: [7, 4] });
    expect(uciToMove('zz99')).toBeNull();
  });

  it('解析 bestmove 行：含 ponder、无着法 (none)、非 bestmove 行', () => {
    expect(parseBestMove('bestmove b2e2 ponder b9c7')).toEqual({ from: [7, 1], to: [7, 4] });
    expect(parseBestMove('bestmove h2e2')).toEqual({ from: [7, 7], to: [7, 4] });
    expect(parseBestMove('bestmove (none)')).toBeNull();
    expect(parseBestMove('info depth 12 score cp 6')).toBeNull();
  });
});
