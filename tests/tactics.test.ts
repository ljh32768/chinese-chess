/**
 * 战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）测试。
 * 纯函数 `detectTactics(before, move, after)`：手工构造局面 → 走子 → 断言命中与「被威胁棋子」；
 * 另含反例（让线被挡 / 目标价值过低 / 非新攻击 / 将死返回空 / 优先级只出 1 条 / 不改动棋盘 / 红黑对称）。
 */

import { describe, expect, it } from 'vitest';
import { detectTactics, TacticHit } from '../src/shared/tactics.js';
import { boardAfterMove, judgeAfterMove } from '../src/shared/rules.js';
import { Board, Move, PieceType, Pos, Side } from '../src/shared/types.js';

/** 空棋盘 */
const empty = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null));

/** 在盘上放一枚棋子 */
const put = (b: Board, r: number, c: number, t: PieceType, s: Side): void => {
  b[r][c] = { t, s };
};

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
    const b = empty();
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
    const b = empty();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r'); // 走开
    put(b, 0, 3, 'N', 'r'); // 仍挡住车照将
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });

  it('红黑对称：黑车照将 → 闪将', () => {
    const b = empty();
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
  it('让开一条线后车攻击敌方车（非将）→ 闪击', () => {
    const b = empty();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 被让线后暴露的敌车
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-attack');
    expect(hits[0].label).toBe('闪击');
    expect(hits[0].threats).toEqual([[0, 6]]);
  });

  it('目标原本已被攻击（非新攻击）→ 不成立', () => {
    const b = empty();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 6, 'R', 'b'); // 车中间无子，走子前就已被攻击
    put(b, 2, 1, 'N', 'r'); // 走一步无关的马
    expect(run(b, [2, 1], [4, 2])).toHaveLength(0);
  });
});

describe('将军抽（check-fork）', () => {
  it('走动的车将军且攻击敌车 → 将军抽车', () => {
    const b = empty();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 8, 'R', 'b');
    const hits = run(b, [1, 0], [1, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[1, 8]]);
  });

  it('被抽的是马时标签为「将军抽马」', () => {
    const b = empty();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 8, 'N', 'b');
    const hits = run(b, [1, 0], [1, 4]);
    expect(hits[0].label).toBe('将军抽马');
  });

  it('抽子按下车 > 炮 > 马 取最高价值标签', () => {
    const b = empty();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 6, 'C', 'b'); // 炮（4.5）——与车同行
    put(b, 3, 4, 'N', 'b'); // 马（4）——与车同列
    const hits = run(b, [1, 0], [1, 4]);
    expect(hits[0].label).toBe('将军抽炮');
    expect(hits[0].threats).toEqual([
      [1, 6],
      [3, 4],
    ]);
  });
});

describe('串打（skewer）', () => {
  it('车在同一直线上前有敌车、后有敌炮 → 串打', () => {
    const b = empty();
    kings(b, [2, 5]);
    put(b, 5, 1, 'R', 'r');
    put(b, 5, 6, 'R', 'b'); // 前
    put(b, 5, 8, 'C', 'b'); // 后（更值得捉）
    const hits = run(b, [5, 1], [5, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
    expect(hits[0].threats).toEqual([
      [5, 6],
      [5, 8],
    ]);
  });

  it('炮借炮架后前有敌车、后有敌马 → 串打', () => {
    const b = empty();
    kings(b, [2, 5]);
    put(b, 7, 4, 'C', 'r'); // 红炮（走到 5,4）
    put(b, 5, 5, 'P', 'r'); // 炮架
    put(b, 5, 6, 'R', 'b'); // 前
    put(b, 5, 8, 'N', 'b'); // 后
    const hits = run(b, [7, 4], [5, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
  });
});

describe('捉双（fork）', () => {
  it('马同时捉住敌车与敌马（不同线路）→ 捉双', () => {
    const b = empty();
    kings(b);
    put(b, 5, 2, 'N', 'r');
    put(b, 2, 3, 'R', 'b');
    put(b, 6, 5, 'N', 'b');
    const hits = run(b, [5, 2], [4, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('fork');
    expect(hits[0].label).toBe('捉双');
    expect(hits[0].threats).toEqual([
      [2, 3],
      [6, 5],
    ]);
  });

  it('只捉到兵 / 象（价值过低）→ 不成立', () => {
    const b = empty();
    kings(b);
    put(b, 5, 2, 'N', 'r');
    put(b, 2, 3, 'P', 'b');
    put(b, 6, 5, 'B', 'b');
    expect(run(b, [5, 2], [4, 4])).toHaveLength(0);
  });
});

describe('优先级与边界', () => {
  it('同一步既闪将又闪击 → 只出优先级更高的「闪将」', () => {
    const b = empty();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 将之后还有一枚敌车（也让线暴露）
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
  });

  it('一步将死（绝杀）→ 不返回任何战术（由正中圆环表达）', () => {
    const b = empty();
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
    const b = empty();
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
