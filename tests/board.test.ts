/**
 * 棋盘渲染标记测试（boardMarkup 为纯字符串生成，与 DOM 解耦）。
 * 覆盖：棋子渲染、将帅警示高亮、视角翻转、上一步高亮、合法落点标记。
 */

import { describe, expect, it } from 'vitest';
import { boardMarkup, BoardView } from '../src/renderer/board.js';
import { initBoard } from '../src/shared/rules.js';
import { Board } from '../src/shared/types.js';

/** 空棋盘 */
const emptyBoard = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null));

/** 构造默认视图参数，可用 over 覆盖 */
const view = (over: Partial<BoardView> = {}): BoardView => ({
  board: initBoard(),
  selected: null,
  moves: [],
  lastMove: null,
  flip: false,
  ...over,
});

describe('棋盘渲染标记 boardMarkup', () => {
  it('渲染开局双方棋子与楚河汉界', () => {
    const h = boardMarkup(view());
    expect(h).toContain('帅');
    expect(h).toContain('将');
    expect(h).toContain('楚河');
    expect(h).toContain('汉界');
  });

  it('无将军时不存在警示环', () => {
    expect(boardMarkup(view())).not.toContain('check-king');
  });

  it('红方被将军时在 [9,4] 的帅上绘制警示环', () => {
    const h = boardMarkup(view({ checkKing: [9, 4] }));
    expect(h).toContain('check-king');
    // 视图坐标 (9,4) → x=34+4*56=258，y=34+9*56=538
    expect(h).toContain('cx="258"');
    expect(h).toContain('cy="538"');
  });

  it('黑方视角翻转后警示环坐标随之翻转', () => {
    const h = boardMarkup(view({ checkKing: [0, 3], flip: true }));
    // 逻辑 [0,3] 翻转后视图为 [9,5] → x=34+5*56=314，y=538
    expect(h).toContain('cx="314"');
    expect(h).toContain('cy="538"');
  });

  it('上一步走子显示金色高亮环', () => {
    const h = boardMarkup(view({ lastMove: { from: [6, 0], to: [5, 0] } }));
    expect(h).toContain('#d4a017');
  });

  it('合法落点区分空位小圆点与可吃子环', () => {
    const b = emptyBoard();
    b[5][0] = { t: 'R', s: 'r' };
    b[4][4] = { t: 'P', s: 'b' };
    const h = boardMarkup(view({ board: b, moves: [[4, 0], [4, 4]] }));
    expect(h).toContain('r="7"'); // 空位落点小圆点
    expect(h).toContain('stroke-width="3.2"'); // 可吃子空心环
  });

  it('选中棋子显示金色选中环', () => {
    const h = boardMarkup(view({ selected: [6, 0] }));
    expect(h).toContain('#f0b429');
  });
});