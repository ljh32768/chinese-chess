/**
 * 揭棋（暗棋）单元测试：洗子 / 起始兵种 / 翻子 / 抹除 / 引擎与状态机的揭棋行为。
 * 规则依据见 docs/adr/0011-jieqi.md。
 */

import { describe, expect, it } from 'vitest';
import { Board, Piece, PieceType, Pos, Side } from '../src/shared/types.js';
import {
  coveredCount,
  coveredSquares,
  dealBoard,
  isCovered,
  redactBoard,
  revealAt,
  startTypeAt,
} from '../src/shared/jieqi.js';
import { judgeAfterMove, pieceMoves } from '../src/shared/rules.js';
import { Game } from '../src/shared/game.js';

/** 固定 rng（洗牌确定化）：依次返回给定序列，用尽后回落到 0 */
function seqRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++] ?? 0;
}

/** 构造空棋盘并放入棋子 */
function boardWith(pieces: Array<[number, number, Piece]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, p] of pieces) b[r][c] = p;
  return b;
}

const keys = (moves: Pos[]): string[] => moves.map(([r, c]) => `${r},${c}`).sort();

describe('起始兵种（startTypeAt）', () => {
  it('底线：车马相仕帅仕相马车', () => {
    const back: PieceType[] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    for (let c = 0; c < 9; c++) {
      expect(startTypeAt('b', 0, c)).toBe(back[c]);
      expect(startTypeAt('r', 9, c)).toBe(back[c]);
    }
  });

  it('炮位与兵位', () => {
    expect(startTypeAt('b', 2, 1)).toBe('C');
    expect(startTypeAt('b', 2, 7)).toBe('C');
    expect(startTypeAt('r', 7, 1)).toBe('C');
    expect(startTypeAt('r', 7, 7)).toBe('C');
    for (const c of [0, 2, 4, 6, 8]) {
      expect(startTypeAt('b', 3, c)).toBe('P');
      expect(startTypeAt('r', 6, c)).toBe('P');
    }
  });

  it('非起始点返回 null', () => {
    expect(startTypeAt('b', 5, 5)).toBeNull();
    expect(startTypeAt('r', 4, 2)).toBeNull();
    expect(startTypeAt('b', 2, 0)).toBeNull();
    expect(startTypeAt('b', 3, 1)).toBeNull();
    expect(startTypeAt('b', 0, -1)).toBeNull();
  });

  it('每方 15 个暗子位（不含将帅位）', () => {
    for (const s of ['b', 'r'] as Side[]) {
      const sq = coveredSquares(s);
      expect(sq).toHaveLength(15);
      expect(sq.some(([r, c]) => startTypeAt(s, r, c) === 'K')).toBe(false);
      expect(new Set(sq.map(([r, c]) => `${r},${c}`)).size).toBe(15);
    }
  });
});

describe('洗子开局（dealBoard）', () => {
  it('将帅明置原位，其余 15 点皆为暗子', () => {
    const b = dealBoard();
    expect(b[0][4]).toEqual({ t: 'K', s: 'b' });
    expect(b[9][4]).toEqual({ t: 'K', s: 'r' });
    expect(b.flat().filter(Boolean)).toHaveLength(32);
    expect(coveredCount(b, 'b')).toBe(15);
    expect(coveredCount(b, 'r')).toBe(15);
  });

  it('每方真实身份恰为 2仕2相2马2车2炮5兵', () => {
    const b = dealBoard();
    for (const s of ['b', 'r'] as Side[]) {
      const reals = b
        .flat()
        .filter((p): p is Piece => !!p && p.s === s && !!p.hidden)
        .map((p) => p.real!);
      const count: Record<string, number> = {};
      for (const t of reals) count[t] = (count[t] ?? 0) + 1;
      expect(reals).toHaveLength(15);
      expect(count).toEqual({ A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 });
      // 暗子的走法兵种 = 所在起始位置的兵种
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 9; c++) {
          const p = b[r][c];
          if (p?.hidden && p.s === s) expect(p.t).toBe(startTypeAt(s, r, c));
        }
      }
    }
  });

  it('固定 rng 时结果可复现，且与真实身份组合互不相同', () => {
    const a = dealBoard(seqRng([0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6, 0.15, 0.35, 0.55, 0.75, 0.95]));
    const b = dealBoard(seqRng([0.1, 0.7, 0.3, 0.9, 0.5, 0.2, 0.8, 0.4, 0.6, 0.15, 0.35, 0.55, 0.75, 0.95]));
    const reals = (bd: Board) => bd.flat().map((p) => (p?.hidden ? p.real : p?.t));
    expect(reals(a)).toEqual(reals(b));
  });
});

describe('翻子（revealAt）', () => {
  it('翻开后 t 变为真实身份，去掉 hidden / real', () => {
    const b = boardWith([[5, 5, { t: 'P', s: 'r', hidden: true, real: 'R' }]]);
    expect(revealAt(b, [5, 5])).toBe(true);
    expect(b[5][5]).toEqual({ t: 'R', s: 'r' });
    expect(isCovered(b[5][5])).toBe(false);
  });

  it('真实身份为士 / 相时置 free（不再受九宫 / 河界限制）', () => {
    const b = boardWith([
      [5, 5, { t: 'N', s: 'r', hidden: true, real: 'A' }],
      [4, 4, { t: 'C', s: 'b', hidden: true, real: 'B' }],
    ]);
    revealAt(b, [5, 5]);
    revealAt(b, [4, 4]);
    expect(b[5][5]).toEqual({ t: 'A', s: 'r', free: true });
    expect(b[4][4]).toEqual({ t: 'B', s: 'b', free: true });
  });

  it('明子（非暗子）不翻开并返回 false', () => {
    const b = boardWith([[5, 5, { t: 'R', s: 'r' }]]);
    expect(revealAt(b, [5, 5])).toBe(false);
    expect(b[5][5]).toEqual({ t: 'R', s: 'r' });
    expect(revealAt(b, [0, 0])).toBe(false);
  });
});

describe('公开快照抹除（redactBoard）', () => {
  it('抹除全部 real，保留 hidden / t / free，且不改动原棋盘', () => {
    const b = boardWith([
      [0, 0, { t: 'R', s: 'b', hidden: true, real: 'P' }],
      [5, 5, { t: 'A', s: 'r', free: true }],
      [9, 4, { t: 'K', s: 'r' }],
    ]);
    const out = redactBoard(b);
    const flat = out.flat().filter((p): p is Piece => !!p);
    expect(flat).toHaveLength(3);
    expect(flat.every((p) => p.real === undefined)).toBe(true);
    expect(out[0][0]).toEqual({ t: 'R', s: 'b', hidden: true });
    expect(out[5][5]).toEqual({ t: 'A', s: 'r', free: true });
    // 原棋盘不受影响
    expect(b[0][0]!.real).toBe('P');
  });
});

describe('规则引擎的揭棋行为', () => {
  it('暗子按其起始位置兵种行棋（角上车位的暗子像车）', () => {
    const b = boardWith([[0, 0, { t: 'R', s: 'b', hidden: true, real: 'P' }]]);
    // 空盘上车在角点：横 8 + 纵 9 = 17 个落点
    expect(pieceMoves(b, 0, 0)).toHaveLength(17);
  });

  it('翻开的士 / 相（free）可出九宫 / 过河', () => {
    const freeA = boardWith([[5, 5, { t: 'A', s: 'b', free: true }]]);
    const plainA = boardWith([[5, 5, { t: 'A', s: 'b' }]]);
    expect(keys(pieceMoves(freeA, 5, 5))).toEqual(['4,4', '4,6', '6,4', '6,6']);
    expect(pieceMoves(plainA, 5, 5)).toHaveLength(0); // 九宫外无着法

    const freeB = boardWith([[3, 2, { t: 'B', s: 'b', free: true }]]);
    const plainB = boardWith([[3, 2, { t: 'B', s: 'b' }]]);
    expect(keys(pieceMoves(freeB, 3, 2))).toEqual(['1,0', '1,4', '5,0', '5,4']);
    expect(keys(pieceMoves(plainB, 3, 2))).toEqual(['1,0', '1,4']); // 黑象不过河
  });

  it('塞象眼对翻开的相同样生效', () => {
    const b = boardWith([
      [3, 2, { t: 'B', s: 'b', free: true }],
      [4, 3, { t: 'P', s: 'r' }],
    ]);
    expect(keys(pieceMoves(b, 3, 2))).not.toContain('5,4');
  });
});

describe('状态机（Game）的揭棋行为', () => {
  it('openJieqi：变体为揭棋、双方各 15 暗子、将帅明置', () => {
    const g = new Game();
    g.openJieqi();
    expect(g.variant).toBe('jieqi');
    expect(g.status).toBe('playing');
    expect(g.turn).toBe('r');
    expect(coveredCount(g.board, 'b')).toBe(15);
    expect(coveredCount(g.board, 'r')).toBe(15);
    expect(g.board[0][4]).toEqual({ t: 'K', s: 'b' });
    expect(g.board[9][4]).toEqual({ t: 'K', s: 'r' });
  });

  it('走子后落点暗子翻开，露出真实身份', () => {
    const g = new Game();
    g.openJieqi();
    const real = g.board[9][0]!.real;
    const res = g.applyMove([9, 0], [8, 0], 'r');
    expect(res.ok).toBe(true);
    expect(isCovered(g.board[8][0])).toBe(false);
    expect(g.board[8][0]!.t).toBe(real);
  });

  it('暗子首步按起始兵种走：兵位暗子不能后退', () => {
    const g = new Game();
    g.openJieqi();
    // (6,0) 是红兵位暗子，只能向前（行号减小）
    const res = g.applyMove([6, 0], [7, 0], 'r');
    expect(res.ok).toBe(false);
    expect(res.reason).toBeTruthy();
    expect(isCovered(g.board[6][0])).toBe(true);
  });

  it('吃子记录真实身份；悔棋连带回退', () => {
    const g = new Game();
    g.variant = 'jieqi';
    g.setup(
      boardWith([
        [0, 4, { t: 'K', s: 'b' }],
        [9, 4, { t: 'K', s: 'r' }],
        [6, 4, { t: 'P', s: 'r' }],
        [5, 0, { t: 'R', s: 'r' }],
        [5, 5, { t: 'P', s: 'b', hidden: true, real: 'N' }],
      ]),
      'r',
    );
    const res = g.applyMove([5, 0], [5, 5], 'r');
    expect(res.ok).toBe(true);
    expect(g.capturedByRed).toEqual(['N']);
    expect(g.capturedByBlack).toEqual([]);
    expect(g.undo()).toBe(true);
    expect(g.capturedByRed).toEqual([]);
    expect(g.board[5][5]).toEqual({ t: 'P', s: 'b', hidden: true, real: 'N' });
  });

  it('快照抹除真实身份，并附带变体与吃子记录', () => {
    const g = new Game();
    g.openJieqi();
    const snap = g.snapshot();
    expect(snap.variant).toBe('jieqi');
    expect(snap.capturedByRed).toEqual([]);
    expect(snap.capturedByBlack).toEqual([]);
    const flat = snap.board.flat().filter((p): p is Piece => !!p);
    expect(flat).toHaveLength(32);
    expect(flat.every((p) => p.real === undefined)).toBe(true);
    // 权威端仍持有真实身份
    expect(g.board.flat().some((p) => !!p?.real)).toBe(true);
  });

  it('标准象棋不受影响：快照不含揭棋字段、棋盘无暗子', () => {
    const g = new Game();
    g.reset('playing');
    const snap = g.snapshot();
    expect(snap.variant).toBeUndefined();
    expect(snap.capturedByRed).toBeUndefined();
    expect(snap.capturedByBlack).toBeUndefined();
    expect(snap.board.flat().some((p) => !!p?.hidden)).toBe(false);
  });

  it('揭棋下同样能判定将死', () => {
    // 红：帅 (9,4)、车 (1,0)/(1,3)/(5,3)/(5,5)、兵 (6,4)（挡住将帅照面）；黑只有将 (0,4)
    // 红走 (1,3)→(1,4) 将军：黑将无路可逃（(0,3)/(0,5) 被 (5,3)/(5,5) 车控，(1,4) 被 (1,0) 车守住）
    const g = new Game();
    g.variant = 'jieqi';
    g.setup(
      boardWith([
        [0, 4, { t: 'K', s: 'b' }],
        [9, 4, { t: 'K', s: 'r' }],
        [1, 0, { t: 'R', s: 'r' }],
        [1, 3, { t: 'R', s: 'r' }],
        [5, 3, { t: 'R', s: 'r' }],
        [5, 5, { t: 'R', s: 'r' }],
        [6, 4, { t: 'P', s: 'r' }],
      ]),
      'r',
    );
    const res = g.applyMove([1, 3], [1, 4], 'r');
    expect(res.ok).toBe(true);
    expect(g.status).toBe('over');
    expect(g.winner).toBe('r');
    expect(g.reason).toBe('将死');
    // 规则引擎在无暗子局面同样给出将死
    expect(judgeAfterMove(g.board, 'b')).toEqual({ winner: 'r', reason: '将死' });
  });
});
