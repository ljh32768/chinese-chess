import { describe, expect, it } from 'vitest';
import { capturedPieces, describeHistory, describeMove } from '../src/shared/notation.js';
import { initBoard } from '../src/shared/rules.js';
import { Board, Move, PieceType, Side } from '../src/shared/types.js';

/** 构造一个只含指定棋子的空棋盘 */
function makeBoard(pieces: Array<[number, number, PieceType, Side]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, t, s] of pieces) b[r][c] = { t, s };
  return b;
}

describe('开局记谱', () => {
  it('炮二平五：(7,7)→(7,4)', () => {
    expect(describeMove(initBoard(), [7, 7], [7, 4])).toBe('炮二平五');
  });

  it('马八进七：(9,1)→(7,2)', () => {
    expect(describeMove(initBoard(), [9, 1], [7, 2])).toBe('马八进七');
  });

  it('黑方首着 卒3进1：(3,2)→(4,2)', () => {
    // 推导：黑卒在第 3 行第 2 列；黑方纵线 col0=1…col8=9，故 col2→3，
    // 黑方前进为行号增大，故 (3,2)→(4,2) 记作「卒3进1」（步数用阿拉伯数字）。
    expect(describeMove(initBoard(), [3, 2], [4, 2])).toBe('卒3进1');
  });
});

describe('兵/卒 的平、进、退', () => {
  it('兵五平六（红兵平走，末段为目标列）', () => {
    expect(describeMove(makeBoard([[4, 4, 'P', 'r']]), [4, 4], [4, 3])).toBe('兵五平六');
  });

  it('兵五进一（红兵进走，末段为行步数）', () => {
    expect(describeMove(makeBoard([[6, 4, 'P', 'r']]), [6, 4], [5, 4])).toBe('兵五进一');
  });

  it('卒5退1（黑卒退走，末段为行步数）', () => {
    // 黑方前进为行号增大，故 (4,4)→(3,4) 为「退」。
    expect(describeMove(makeBoard([[4, 4, 'P', 'b']]), [4, 4], [3, 4])).toBe('卒5退1');
  });
});

describe('同纵线消歧', () => {
  it('两车同线 → 前车 / 后车', () => {
    const b = makeBoard([
      [5, 0, 'R', 'r'],
      [9, 0, 'R', 'r'],
    ]);
    // 红方行号小者为「前」：(5,0) 为前车
    expect(describeMove(b, [5, 0], [5, 2])).toBe('前车平七');
    expect(describeMove(b, [9, 0], [9, 1])).toBe('后车平八');
  });

  it('两兵同线 → 前兵 / 后兵', () => {
    const b = makeBoard([
      [4, 4, 'P', 'r'],
      [6, 4, 'P', 'r'],
    ]);
    expect(describeMove(b, [4, 4], [4, 3])).toBe('前兵平六');
    expect(describeMove(b, [6, 4], [5, 4])).toBe('后兵进一');
  });
});

describe('仕/相 斜走使用目标列号', () => {
  it('仕四进五：(9,5)→(8,4)', () => {
    expect(describeMove(makeBoard([[9, 5, 'A', 'r']]), [9, 5], [8, 4])).toBe('仕四进五');
  });

  it('相七进五：(9,2)→(7,4)', () => {
    expect(describeMove(makeBoard([[9, 2, 'B', 'r']]), [9, 2], [7, 4])).toBe('相七进五');
  });
});

describe('describeHistory 回放', () => {
  it('三步序列返回 3 条正确记谱', () => {
    const history = [
      { from: [7, 7] as [number, number], to: [7, 4] as [number, number] },
      { from: [0, 7] as [number, number], to: [2, 6] as [number, number] },
      { from: [9, 7] as [number, number], to: [7, 6] as [number, number] },
    ];
    expect(describeHistory(history)).toEqual(['炮二平五', '马8进7', '马二进三']);
  });

  it('空历史返回空数组', () => {
    expect(describeHistory([])).toEqual([]);
  });
});

describe('capturedPieces 吃子统计', () => {
  it('无吃子时两侧为空', () => {
    const history: Move[] = [{ from: [9, 0], to: [8, 0] }];
    expect(capturedPieces(history)).toEqual({ byRed: [], byBlack: [] });
  });

  it('红方吃子计入 byRed，黑方未吃子', () => {
    // 1.红兵进 2.黑卒进 3.红兵吃黑卒（兵/卒吃子与走法相同，均合法）
    const history: Move[] = [
      { from: [6, 4], to: [5, 4] },
      { from: [3, 4], to: [4, 4] },
      { from: [5, 4], to: [4, 4] },
    ];
    expect(capturedPieces(history)).toEqual({ byRed: ['P'], byBlack: [] });
  });

  it('黑方吃子计入 byBlack，红方未吃子', () => {
    // 1.红兵进 2.黑卒进 3.红兵平走 4.黑卒吃红兵
    const history: Move[] = [
      { from: [6, 4], to: [5, 4] },
      { from: [3, 4], to: [4, 4] },
      { from: [6, 2], to: [5, 2] },
      { from: [4, 4], to: [5, 4] },
    ];
    expect(capturedPieces(history)).toEqual({ byRed: [], byBlack: ['P'] });
  });
});
