/**
 * 开局招法识别（红方首着 → 开局名）测试。
 * 覆盖：各经典首着命中、非首着 / 未收录着法 / 空着法返回 null、不改动传入着法。
 */

import { describe, expect, it } from 'vitest';
import { detectOpening } from '../src/renderer/openings.js';
import { describeMove } from '../src/shared/notation.js';
import { initBoard } from '../src/shared/rules.js';
import { Move, Pos } from '../src/shared/types.js';

const mv = (from: Pos, to: Pos): Move => ({ from, to });

describe('开局招法识别 detectOpening', () => {
  const cases: Array<[string, Pos, Pos]> = [
    ['当头炮（中炮）', [7, 7], [7, 4]], // 炮二平五
    ['当头炮（中炮）', [7, 1], [7, 4]], // 炮八平五
    ['起马局（骑马局）', [9, 7], [7, 6]], // 马二进三
    ['起马局（骑马局）', [9, 1], [7, 2]], // 马八进七
    ['飞相局', [9, 6], [7, 4]], // 相三进五
    ['飞相局', [9, 2], [7, 4]], // 相七进五
    ['仙人指路', [6, 2], [5, 2]], // 兵七进一
    ['仙人指路', [6, 6], [5, 6]], // 兵三进一
    ['士角炮', [7, 7], [7, 5]], // 炮二平四
    ['士角炮', [7, 1], [7, 3]], // 炮八平六
    ['过宫炮', [7, 7], [7, 3]], // 炮二平六
    ['过宫炮', [7, 1], [7, 5]], // 炮八平四
  ];

  it('红方各经典首着都能识别出开局名（并按记谱对号入座）', () => {
    for (const [name, from, to] of cases) {
      const history = [mv(from, to)];
      const hint = detectOpening(history);
      // 用记谱反查用例坐标没有写错
      expect(describeMove(initBoard(), from, to)).toBeTruthy();
      expect(hint, `记谱=${describeMove(initBoard(), from, to)}`).toEqual({ name, index: 0 });
    }
  });

  it('未收录的红方首着返回 null', () => {
    expect(detectOpening([mv([6, 8], [5, 8])])).toBeNull(); // 兵一进一
  });

  it('空着法返回 null', () => {
    expect(detectOpening([])).toBeNull();
  });

  it('只取红方首着：其后手不影响识别（index 仍为 0）', () => {
    const history = [mv([7, 7], [7, 4]), mv([0, 7], [2, 6])]; // 炮二平五 + 黑 马8进7
    expect(detectOpening(history)).toEqual({ name: '当头炮（中炮）', index: 0 });
  });

  it('纯函数：不改动传入的着法序列', () => {
    const history = [mv([7, 7], [7, 4])];
    const snap = JSON.stringify(history);
    detectOpening(history);
    expect(JSON.stringify(history)).toBe(snap);
  });
});
