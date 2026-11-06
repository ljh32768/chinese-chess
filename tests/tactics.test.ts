/**
 * 战术模块测试（纯函数，与 DOM / 网络解耦）。两部分：
 * 1) 吃子提示分析：开局无提示、无根白吃、有根小换大（须净赚 ≥1 分：马换炮 0.5 分不算）、
 *    等价交换不提示、将帅不参与提示、
 *    将守护的子（将不能安全吃回 → 按无根；能安全吃回 → 按有根）、红黑对称（绿色目标 = 对方视角的红色威胁）、纯函数性。
 * 2) 战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）：手工构造局面 → 走子 → 断言命中与「被威胁棋子」；
 *    严格判定顺序先看是否照将——照将走「闪将 / 将军抽」（只将军 = 闪将；将军 + 捉大子 = 将军抽，
 *    将军来源可为闪将、被抽子可含将后同线大子，且被抽子须是本步**新造**的获利威胁——走子前就已能获利吃到的子不算），
 *    不照将走「串打 / 捉双 / 闪击」（闪击须为**双向双威胁**：让线露出的攻击 + 移开的子自身也捉到大子）；
 *    另含反例（让线被挡 / 目标价值过低 / 非新攻击 / 只让线而移子的子不捉子 / 原本就白吃的子后的将军 /
 *    被抽子可蹩马腿两全 / 将死返回空 / 只出 1 条 / 不改动棋盘 / 红黑对称）。
 */

import { describe, expect, it } from 'vitest';
import {
  PIECE_VALUE,
  TacticHit,
  captureHints,
  detectTactics,
  profitableTargets,
} from '../src/shared/tactics.js';
import { boardAfterMove, initBoard, judgeAfterMove } from '../src/shared/rules.js';
import { Board, Move, PieceType, Pos, Side } from '../src/shared/types.js';

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

/**
 * 用户截图局面（v3.10 回归）：红马 (2,2) 照将并咬住 (3,4) 的黑炮，
 * 但该炮受黑马 (1,5) 保护——马 4 换炮 4.5 只差 0.5 分，属于几乎等值的交换。
 */
const screenshotBoard = (): Board => {
  const b = emptyBoard();
  put(b, 0, 3, 'K', 'b');
  put(b, 0, 5, 'A', 'b');
  put(b, 1, 4, 'A', 'b');
  put(b, 1, 5, 'N', 'b'); // 黑马：保护 (3,4) 的黑炮
  put(b, 2, 4, 'B', 'b');
  put(b, 3, 4, 'C', 'b'); // 截图里被绿环误标的炮
  put(b, 2, 8, 'B', 'b');
  put(b, 3, 8, 'P', 'b');
  put(b, 5, 0, 'P', 'b');
  put(b, 6, 0, 'P', 'b');
  put(b, 7, 5, 'R', 'b');
  put(b, 8, 4, 'K', 'r');
  put(b, 2, 2, 'N', 'r');
  put(b, 9, 2, 'B', 'r');
  put(b, 6, 8, 'P', 'r');
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

  it('小换大仍须明显获利：红马吃有黑马保护的黑车（4 → 9，净赚 5 分）→ 标绿', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 3, 'N', 'r'); // 红马
    put(b, 3, 2, 'R', 'b'); // 黑车（目标）
    put(b, 1, 1, 'N', 'b'); // 黑马护车（马腿 (2,1) 空）
    expect(profitableTargets(b, 'r')).toEqual([[3, 2]]);
  });

  it('马吃有根炮（4 → 4.5，只差 0.5 分）→ 不算小换大，不标绿（v3.10 截图回归）', () => {
    // 截图局面：红马 (2,2) 能吃到 (3,4) 的黑炮，但该炮有黑马 (1,5) 保护，一换一后几乎等价
    expect(profitableTargets(screenshotBoard(), 'r')).toEqual([]);
    expect(captureHints(screenshotBoard(), 'r').targets).toEqual([]);
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

  it('将守护的子：将吃回后会被将军（送将非法）→ 该子按无根处理，标记绿色', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b'); // 黑将
    put(b, 0, 5, 'N', 'b'); // 目标：黑马（仅被黑将守护）
    put(b, 2, 4, 'N', 'r'); // 红马可跳吃 (0,5)（马腿 (1,4) 空），价值 4 = 黑马 4
    put(b, 0, 8, 'R', 'r'); // 红车同在第 0 行：黑将吃回后落在红车的将军线上 → 吃回非法
    put(b, 9, 3, 'K', 'r');
    expect(profitableTargets(b, 'r')).toEqual([[0, 5]]);
  });

  it('将守护的子：将能安全吃回 → 有根，不标记绿色（等价值一换一不赚）', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b');
    put(b, 0, 5, 'N', 'b');
    put(b, 2, 4, 'N', 'r');
    put(b, 9, 3, 'K', 'r'); // 无其它红子 → 黑将吃回后不被将军
    expect(profitableTargets(b, 'r')).toEqual([]);
  });

  it('将能安全吃回：不会把进攻子的原格误判为「仍在攻击」（有根判定正确）', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b'); // 黑将
    put(b, 1, 4, 'N', 'b'); // 目标：黑马（被黑将守护）
    put(b, 5, 4, 'R', 'r'); // 红车正对 (1,4)：吃过去后红车已被吃，黑将可安全吃回
    put(b, 9, 3, 'K', 'r');
    expect(profitableTargets(b, 'r')).toEqual([]); // 有根且马 4 < 车 9 → 不算小换大
  });

  it('将守护的子（红方视角）：红帅吃回后会被将军 → 红子成为红色威胁', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r'); // 红帅
    put(b, 9, 5, 'N', 'r'); // 红马（仅被红帅守护）
    put(b, 7, 4, 'N', 'b'); // 黑马可跳吃 (9,5)（马腿 (8,4) 空），价值 4 = 红马 4
    put(b, 9, 8, 'R', 'b'); // 黑车同在第 9 行：红帅吃回后落在黑车的将军线上 → 吃回非法
    put(b, 0, 3, 'K', 'b');
    expect(captureHints(b, 'r').threats).toContainEqual([9, 5]);
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

/** 走一步并识别战术（返回识别结果） */
function run(before: Board, from: Pos, to: Pos): TacticHit[] {
  const after = boardAfterMove(before, from, to);
  return detectTactics(before, { from, to } as Move, after);
}

/** 双方将帅（红 7,3 / 黑 0,4 之外由用例另设） */
const kings = (b: Board, blackKing: Pos = [0, 4]): void => {
  put(b, 7, 3, 'K', 'r');
  put(b, blackKing[0], blackKing[1], 'K', 'b');
};

describe('闪将（discovered-check）', () => {
  it('让开一条线后车照将 → 闪将，被威胁者是将', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r'); // 红车
    put(b, 0, 2, 'N', 'r'); // 挡在车与将之间的红马（让开它）
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
    expect(hits[0].label).toBe('闪将');
    expect(hits[0].threats).toEqual([[0, 4]]);
  });

  it('让线被另一枚子挡住 → 不成立', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r'); // 走开
    put(b, 0, 3, 'N', 'r'); // 仍挡住车照将
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });

  it('炮架吃子后仍停在炮与将的连线上（并没有闪开）→ 不判闪将', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 5, 'K', 'b'); // 黑将（九宫内，炮换架后正好被照）
    put(b, 0, 0, 'C', 'r'); // 红炮
    put(b, 0, 1, 'R', 'r'); // 炮架（走动的子）
    put(b, 0, 3, 'N', 'b'); // 炮原先正打着的黑马
    put(b, 1, 3, 'P', 'b'); // 黑方另有子可走，避免被判「将死」提前返回
    // 红车前进吃马到 (0,3)：仍停在炮与黑将之间继续当炮架，炮只是「换架」改照将 → 不是让线
    expect(run(b, [0, 1], [0, 3])).toHaveLength(0);
  });

  it('炮架没动、让开其后方的挡子 → 仍判闪将（炮透过炮架照将）', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 5, 'K', 'b');
    put(b, 0, 0, 'C', 'r'); // 红炮
    put(b, 0, 2, 'P', 'r'); // 炮架（不动）
    put(b, 0, 3, 'N', 'r'); // 让开的子（炮与黑将之间的第二枚）
    expect(run(b, [0, 3], [1, 5]).map((h) => h.kind)).toEqual(['discovered-check']);
  });

  it('红黑对称：黑车照将 → 闪将', () => {
    const b = emptyBoard();
    put(b, 1, 3, 'K', 'b');
    put(b, 9, 4, 'K', 'r');
    put(b, 9, 0, 'R', 'b');
    put(b, 9, 2, 'N', 'b');
    const hits = run(b, [9, 2], [7, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
  });
});

describe('闪击（discovered-attack）', () => {
  it('让线后车攻击敌车 + 移开的马同时捉炮（双向双威胁）→ 闪击', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 被让线后暴露的敌车
    put(b, 1, 3, 'C', 'b'); // 移开的马跳到 (2,1) 后咬住的敌炮
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-attack');
    expect(hits[0].label).toBe('闪击');
    expect(hits[0].threats).toEqual([
      [0, 6],
      [1, 3],
    ]);
  });

  it('移开的棋子自身不带威胁（只让线）→ 不判闪击', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 被让线后暴露的敌车
    // 马跳到 (2,1) 什么都没捉到：仅车让线，不构成「双向双威胁」
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });

  it('目标原本已被攻击（非新攻击）→ 不成立', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 6, 'R', 'b'); // 车中间无子，走子前就已被攻击
    put(b, 2, 1, 'N', 'r'); // 走一步无关的马
    expect(run(b, [2, 1], [4, 2])).toHaveLength(0);
  });

  it('炮的炮架吃子后仍停在射线上（换架改打后面的子）→ 不判闪击', () => {
    const b = emptyBoard();
    put(b, 7, 3, 'K', 'r');
    put(b, 0, 5, 'K', 'b');
    put(b, 4, 0, 'C', 'r'); // 红炮
    put(b, 4, 2, 'R', 'r'); // 炮架（走动的子）
    put(b, 4, 4, 'R', 'b'); // 炮原先正打着的黑车
    put(b, 4, 6, 'C', 'b'); // 换架后炮「改打」的黑炮
    // 红车吃黑车后仍停在炮与黑炮的连线上（继续当炮架）→ 炮只是换架改打，不是让线
    expect(run(b, [4, 2], [4, 4])).toHaveLength(0);
  });
});

describe('将军抽（check-fork）', () => {
  it('走动的车将军且新抽到马（马应将后仍无法脱身）→ 将军抽马', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 2, 0, 'R', 'r');
    put(b, 4, 4, 'N', 'b'); // 被抽的马：走子前红车够不到，走子后落到车的 4 路上
    const hits = run(b, [2, 0], [2, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽马');
    expect(hits[0].threats).toEqual([[4, 4]]);
  });

  it('原本就已能获利吃到的敌子：另一子将军后不判将军抽', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b'); // 走子前红车就已白吃这匹马（原本就有的攻击）
    put(b, 4, 6, 'N', 'r'); // 另一子跳去 (2,5) 照将，与被抽的马无关
    expect(run(b, [4, 6], [2, 5])).toHaveLength(0);
  });

  it('同时抽到车与炮、两子皆无救 → 取最高价值标签（车 > 炮）', () => {
    const b = emptyBoard();
    kings(b); // 红帅 (7,3)、黑将 (0,4)
    // 马跳到 (2,5) 照将（马腿 (1,5) 空），同时咬住 (3,7) 的黑车与 (4,4) 的黑炮；
    // 二者既不能反吃马、也够不到马腿 (1,5) 去蹩腿挡将，故皆必失，取最高价值「车」。
    put(b, 4, 6, 'N', 'r');
    put(b, 3, 7, 'R', 'b');
    put(b, 4, 4, 'C', 'b');
    const hits = run(b, [4, 6], [2, 5]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([
      [3, 7],
      [4, 4],
    ]);
  });

  it('被抽子可移去「蹩马腿」同时挡将（对方能两全）→ 只抽得另一子（将军抽炮）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 4, 6, 'N', 'r');
    put(b, 1, 7, 'R', 'b'); // 被抽的车：可横走到马腿 (1,5) 蹩腿挡将，自身脱险
    put(b, 4, 4, 'C', 'b'); // 被抽的炮：无救
    const hits = run(b, [4, 6], [2, 5]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽炮');
    expect(hits[0].threats).toEqual([[4, 4]]);
  });

  it('被抽的炮有根（等价一换一不赚）→ 不判将军抽炮（获利口径）', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b');
    put(b, 9, 5, 'K', 'r'); // 帅不在 4 路，避免黑将左移时照面
    put(b, 2, 0, 'R', 'r'); // 红车走到 (2,4) 沿 4 路照将
    put(b, 2, 7, 'C', 'b'); // 被抽的炮：有根（黑车保护）
    put(b, 5, 7, 'R', 'b'); // 黑车同列保护 (2,7)
    // 红车 9 吃有根的黑炮 4.5 会被反吃 → 不划算，不算「抽」
    expect(run(b, [2, 0], [2, 4])).toHaveLength(0);
  });

  it('将军同时咬住有根炮（马换炮只差 0.5 分）→ 不判将军抽炮（v3.10 截图回归）', () => {
    const before = screenshotBoard();
    before[2][2] = null;
    put(before, 4, 1, 'N', 'r'); // 还原最后一步：红马 (4,1) 跳到 (2,2)
    // 跳到 (2,2) 后照将，同时咬住 (3,4) 的黑炮；但黑炮受黑马 (1,5) 保护，反吃后几乎等价 → 不算「抽」
    expect(run(before, [4, 1], [2, 2])).toHaveLength(0);
  });

  it('闪将（让线车照将）+ 走动的马同时捉车 → 将军抽车（将军来源可为闪将）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r'); // 让线后方车 → 照将
    put(b, 0, 2, 'N', 'r'); // 让开的马：走到 (2,3) 同时咬住 (1,5) 的黑车
    put(b, 1, 5, 'R', 'b');
    const hits = run(b, [0, 2], [2, 3]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[1, 5]]);
  });

  it('经典抽将：走动的车照将、被照之将同线后方的大子在应将后落入攻击口 → 将军抽车', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 2, 0, 'R', 'r'); // 走到 (0,0) 沿第 0 行照将
    put(b, 0, 7, 'R', 'b'); // 被照之将同线后方的大子（将移开该线后即被吃）
    const hits = run(b, [2, 0], [0, 0]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[0, 7]]);
  });

  it('走子只照将、并未同时捉大子 → 仍是闪将（低价值子不算「抽」）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 4, 0, 'P', 'b'); // 马跳到 (2,1) 只咬到一兵（非大子）
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
    expect(hits[0].label).toBe('闪将');
  });

  it('被抽的子可反吃攻击子（对方能两全）→ 不成立', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 8, 'R', 'b'); // 黑车可直取走到 (1,4) 的红车（黑将亦可吃），两子皆保
    expect(run(b, [1, 0], [1, 4])).toHaveLength(0);
  });
});

describe('串打（skewer）', () => {
  it('车在同一射线以前马后马（两子皆无根，对方两全不得）→ 串打', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 5, 'N', 'b'); // 前子：马（无根、与红车相邻，无法反吃）
    put(b, 5, 6, 'N', 'b'); // 后子：马（无根）
    const hits = run(b, [5, 0], [5, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
    expect(hits[0].threats).toEqual([
      [5, 5],
      [5, 6],
    ]);
  });

  it('炮借己方炮架后以前马后马（皆无根）→ 串打', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 1, 'C', 'r'); // 红炮（走到 5,4）
    put(b, 5, 5, 'P', 'r'); // 己方炮架（马无法反吃，对方也移不走）
    put(b, 5, 6, 'N', 'b'); // 前子：马（无根）
    put(b, 5, 7, 'N', 'b'); // 后子：马（无根）
    const hits = run(b, [5, 1], [5, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
  });

  it('前子可反吃攻击子（对方能两全）→ 不成立（不误报串打）', () => {
    const b = emptyBoard();
    kings(b, [2, 5]);
    put(b, 5, 1, 'R', 'r');
    put(b, 5, 6, 'R', 'b'); // 前子：车（可直取走到 (5,4) 的红车）
    put(b, 5, 8, 'C', 'b'); // 后子：炮
    expect(run(b, [5, 1], [5, 4])).toHaveLength(0);
  });

  it('前子有根（受后子保护）且吃它不赚 → 不判串打（获利口径）', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 5, 'N', 'b'); // 前子：马（被后车保护 → 有根）
    put(b, 5, 6, 'R', 'b'); // 后子：车
    // 黑方只要走一步与射线无关的闲棋（如移将）：红车吃前马会被后车反吃（车 9 换马 4），
    // 后车又被前马挡住打不到 → 我方无从获利，故不构成串打（v3.5 起对多子战术统一用获利口径）
    expect(run(b, [5, 0], [5, 4])).toHaveLength(0);
  });
});

describe('捉双（fork）', () => {
  it('马同时捉住两枚敌车（不同线路、对方无法两全）→ 捉双', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 5, 2, 'N', 'r');
    put(b, 2, 3, 'R', 'b'); // 马位可捉到的敌车（车无法反吃马）
    put(b, 6, 3, 'R', 'b'); // 另一路敌车
    const hits = run(b, [5, 2], [4, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('fork');
    expect(hits[0].label).toBe('捉双');
    expect(hits[0].threats).toEqual([
      [2, 3],
      [6, 3],
    ]);
  });

  it('只捉到兵 / 象（价值过低）→ 不成立', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 5, 2, 'N', 'r');
    put(b, 2, 3, 'P', 'b');
    put(b, 6, 5, 'B', 'b');
    expect(run(b, [5, 2], [4, 4])).toHaveLength(0);
  });
});

describe('优先级与边界', () => {
  it('闪将结构 + 被照之将同线后方的大子 → 判为「将军抽车」（抽将优先于单纯闪将）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 让线后不仅照将，将之后还有一枚敌车必失
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[0, 6]]);
  });

  it('一步将死（绝杀）→ 不返回任何战术（由正中圆环表达）', () => {
    const b = emptyBoard();
    put(b, 7, 3, 'K', 'r');
    put(b, 0, 0, 'R', 'r');
    put(b, 2, 8, 'R', 'r');
    put(b, 0, 4, 'K', 'b');
    const after = boardAfterMove(b, [2, 8], [1, 8]);
    // 先用规则引擎确认确为将死
    expect(judgeAfterMove(after, 'b')).toEqual({ winner: 'r', reason: '将死' });
    expect(detectTactics(b, { from: [2, 8], to: [1, 8] }, after)).toHaveLength(0);
  });

  it('纯函数：不改动传入的 before / after 棋盘', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 8, 'R', 'b');
    const after = boardAfterMove(b, [1, 0], [1, 4]);
    const beforeSnap = JSON.stringify(b);
    const afterSnap = JSON.stringify(after);
    detectTactics(b, { from: [1, 0], to: [1, 4] }, after);
    expect(JSON.stringify(b)).toBe(beforeSnap);
    expect(JSON.stringify(after)).toBe(afterSnap);
  });
});
