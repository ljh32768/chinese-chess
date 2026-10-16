/**
 * 吃子提示分析测试（纯函数，与 DOM / 网络解耦）。
 * 覆盖：开局无提示、无根白吃、有根小换大、等价交换不提示、将帅不参与提示、
 * 红黑对称（绿色目标 = 对方视角的红色威胁）、纯函数性。
 */

import { describe, expect, it } from 'vitest';
import { PIECE_VALUE, captureHints, profitableTargets } from '../src/shared/tactics.js';
import { initBoard } from '../src/shared/rules.js';
import { Board, PieceType, Side } from '../src/shared/types.js';

/** 空棋盘 */
const emptyBoard = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null));

/** 落子 */
const put = (b: Board, r: number, c: number, t: PieceType, s: Side): void => {
  b[r][c] = { t, s };
};

/** 放双方将帅（不同纵线，避免将帅照面影响走法生成） */
const withKings = (b: Board): Board => {
  put(b, 9, 4, 'K', 'r');
  put(b, 0, 3, 'K', 'b');
  return b;
};

const has = (ps: [number, number][], pos: [number, number]): boolean =>
  ps.some(([r, c]) => r === pos[0] && c === pos[1]);

describe('棋子价值表', () => {
  it('车 > 炮 > 马 > 士象 > 兵卒，帅/将用极大值兜底', () => {
    expect(PIECE_VALUE.R).toBeGreaterThan(PIECE_VALUE.C);
    expect(PIECE_VALUE.C).toBeGreaterThan(PIECE_VALUE.N);
    expect(PIECE_VALUE.N).toBeGreaterThan(PIECE_VALUE.B);
    expect(PIECE_VALUE.B).toBe(PIECE_VALUE.A);
    expect(PIECE_VALUE.B).toBeGreaterThan(PIECE_VALUE.P);
    expect(PIECE_VALUE.K).toBeGreaterThan(PIECE_VALUE.R);
  });
});

describe('开局局面', () => {
  it('双方开局都没有可获利吃子（既无绿环也无红环）', () => {
    const b = initBoard();
    expect(captureHints(b, 'r')).toEqual({ targets: [], threats: [] });
    expect(captureHints(b, 'b')).toEqual({ targets: [], threats: [] });
  });
});

describe('绿色目标：可以吃掉的对方棋子', () => {
  it('无根白吃：红车吃无保护的黑马（黑方无处反吃）', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b');
    const hints = captureHints(b, 'r');
    expect(hints.targets).toEqual([[5, 3]]);
    expect(hints.threats).toEqual([]);
  });

  it('小换大：红兵吃有黑马保护的黑车（价值 1 → 9，交换后净赚）', () => {
    const b = withKings(emptyBoard());
    put(b, 4, 3, 'P', 'r'); // 红兵过河，可向前吃 (3,3)
    put(b, 3, 3, 'R', 'b'); // 黑车
    put(b, 1, 2, 'N', 'b'); // 黑马护车（马腿 (2,2) 空）
    const hints = captureHints(b, 'r');
    // 黑车有根，但价值 9 > 最便宜攻击者（红兵 1）→ 小换大，标记绿色
    expect(hints.targets).toEqual([[3, 3]]);
    // 反过来：红兵无根且被黑车吃 → 对红方是红色威胁
    expect(hints.threats).toEqual([[4, 3]]);
  });

  it('等价交换不提示：有根的黑车与红车同价（一换一不赚）', () => {
    const b = withKings(emptyBoard());
    put(b, 4, 0, 'R', 'b'); // 黑车（目标）
    put(b, 0, 0, 'R', 'b'); // 黑车护它（同纵线，中间无子）
    put(b, 4, 8, 'R', 'r'); // 红车正对黑车
    const targets = profitableTargets(b, 'r');
    expect(targets).toEqual([]); // 价值相等且有根 → 不算小换大
  });

  it('炮不算保护：相邻的黑炮没有炮架，黑马仍算无根（红车可白吃）', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r'); // 红车（价值 9，比马贵）
    put(b, 5, 3, 'N', 'b'); // 黑马（价值 4，无根）
    put(b, 5, 4, 'C', 'b'); // 相邻黑炮：到 (5,3) 之间无炮架，吃不到
    const hints = captureHints(b, 'r');
    // 无根 → 白吃，标记绿色（若误把炮当成「有根」则价值 4 < 9 不会被标出）
    expect(hints.targets).toEqual([[5, 3]]);
  });

  it('炮有炮架时算保护：隔着黑卒的黑炮能反吃，黑马即有根（红车 9 vs 马 4 不赚）', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r'); // 红车 9
    put(b, 5, 3, 'N', 'b'); // 黑马 4（被黑炮保护）
    put(b, 5, 5, 'P', 'b'); // 黑卒：充当炮架（卒不能直接吃到 (5,3)）
    put(b, 5, 6, 'C', 'b'); // 黑炮：隔 (5,5) 的卒可反吃 (5,3)
    expect(profitableTargets(b, 'r')).toEqual([]); // 有根且价值不赚 → 不提示
  });

  it('将/帅不参与提示（可「吃到」对方将帅也不标记）', () => {
    const b = withKings(emptyBoard());
    put(b, 0, 0, 'R', 'r'); // 红车与黑将同在第 0 行且中间无子（黑方被将军）
    expect(profitableTargets(b, 'r')).toEqual([]);
  });
});

describe('红色威胁与对称性', () => {
  it('红方视角的 threats 等于对方视角的 targets', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b');
    put(b, 4, 3, 'P', 'r');
    put(b, 3, 3, 'R', 'b');
    put(b, 1, 2, 'N', 'b');
    expect(captureHints(b, 'r').threats).toEqual(captureHints(b, 'b').targets);
    expect(captureHints(b, 'b').threats).toEqual(captureHints(b, 'r').targets);
  });

  it('黑方视角对称：黑车吃无根的红马', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 3, 'N', 'r');
    put(b, 5, 8, 'R', 'b');
    const hints = captureHints(b, 'b');
    expect(has(hints.targets, [5, 3])).toBe(true);
  });
});

describe('纯函数性', () => {
  it('不改动传入的棋盘', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b');
    const snapshot = JSON.stringify(b);
    captureHints(b, 'r');
    profitableTargets(b, 'b');
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});
