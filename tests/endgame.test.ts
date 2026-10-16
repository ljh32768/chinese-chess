/**
 * 残局挑战测试：
 * 1) 题库自洽性：局面合法（双方有将、棋子不重叠）、玩家先行方未被将军、不是「对方已无子可走」的死局面；
 * 2) 可解性：每条残局都能在目标步数内强制取胜，且步数不能再少（由求解器逐条验证）；
 * 3) 正解首着：findMateMove 给出的着法合法，走完仍在杀棋之内；已无解时返回 null；
 * 4) 求解器语义：一步杀 / 多步杀 / 困毙（对方无着可走同样算胜）/ 不修改传入棋盘；
 * 5) 自建残局：保存前自动核验（局面合法性 + 由求解器求出最优步数）、题目构造与本机存档
 *    （解析 / 新增 / 同 id 覆盖 / 删除，均不修改传入数组）、棋盘与棋子表互转；
 * 6) 界面接线：首页入口、残局面板与自建残局编辑器、对局页残局操作行与目标信息块、渲染层调用关系。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_CHECK_MAX,
  CUSTOM_LEVEL,
  EndgameRecord,
  LEVEL_LABEL,
  PUZZLES,
  boardToPieces,
  buildPuzzleBoard,
  canForceMate,
  checkCustomEndgame,
  checkEndgameBank,
  checkPuzzle,
  endgameOutcome,
  findMateMove,
  findPuzzle,
  isOptimalSteps,
  makeCustomEndgame,
  minMateDepth,
  nextPuzzle,
  parseCustomEndgames,
  parseEndgameRecords,
  piecesToBoard,
  recordFail,
  recordWin,
  removeCustomEndgame,
  swapPieceSides,
  upsertCustomEndgame,
} from '../src/shared/endgame.js';
import { isInCheck, legalMoves, makeMove, sideHasAnyMove } from '../src/shared/rules.js';
import { Board, Cell, Move, PieceType, Side } from '../src/shared/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
// 统一为 LF：Windows 检出（core.autocrlf）会把换行变成 CRLF，多行断言不应因此失败
const APP = readFileSync(path.join(ROOT, 'src', 'renderer', 'app.ts'), 'utf8').replace(/\r\n/g, '\n');
const EDITOR = readFileSync(path.join(ROOT, 'src', 'renderer', 'endgame-editor.ts'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');

/** 由棋子表构造棋盘（测试用，等价于 buildPuzzleBoard 的输入形态） */
function board(pieces: Array<[number, number, PieceType, Side]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array<Cell>(9).fill(null));
  for (const [r, c, t, s] of pieces) b[r][c] = { t, s };
  return b;
}

/** 棋盘上的全部合法着法（规则引擎权威实现） */
function movesOf(b: Board, side: Side): Move[] {
  const out: Move[] = [];
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = b[r][c];
      if (!p || p.s !== side) continue;
      for (const [tr, tc] of legalMoves(b, r, c)) out.push({ from: [r, c], to: [tr, tc] });
    }
  }
  return out;
}

/** 最少几步可强制取胜（0 = 在 max 步内无解） */
function mateDepth(b: Board, side: Side, max: number): number {
  for (let d = 1; d <= max; d++) if (canForceMate(b, side, d)) return d;
  return 0;
}

// ---------------------------------------------------------------- 题库

describe('残局题库：数据自洽', () => {
  it('id 唯一，难度按「入门 → 中等 → 困难」排列', () => {
    const ids = PUZZLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const order = { easy: 0, medium: 1, hard: 2 };
    const ranks = PUZZLES.map((p) => order[p.level]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(PUZZLES.length).toBeGreaterThanOrEqual(6);
    expect(PUZZLES.every((p) => p.goalMoves >= 1 && p.goalMoves <= 3)).toBe(true);
    expect(PUZZLES.every((p) => p.intro.length > 0 && LEVEL_LABEL[p.level])).toBe(true);
  });

  it('棋子都在盘内、无重叠，双方各有将/帅', () => {
    for (const p of PUZZLES) {
      const seen = new Set<string>();
      for (const [r, c] of p.pieces) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(10);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(9);
        expect(seen.has(`${r},${c}`)).toBe(false);
        seen.add(`${r},${c}`);
      }
      const b = buildPuzzleBoard(p);
      expect(b.some((row) => row.some((x) => x?.t === 'K' && x.s === 'r'))).toBe(true);
      expect(b.some((row) => row.some((x) => x?.t === 'K' && x.s === 'b'))).toBe(true);
      expect(b[0].length).toBe(9);
      expect(b.length).toBe(10);
    }
  });

  it('开局不是「对方已无子可走」，玩家先行方也未处于被将军状态', () => {
    for (const p of PUZZLES) {
      const b = buildPuzzleBoard(p);
      expect(sideHasAnyMove(b, other(p.side))).toBe(true);
      expect(isInCheck(b, other(p.side))).toBe(false);
      expect(isInCheck(b, p.side)).toBe(false);
      expect(movesOf(b, p.side).length).toBeGreaterThan(0);
    }
  });
});

describe('残局题库：可解且步数最少', () => {
  it('每条残局都能在目标步数内强制取胜，且目标步数不能再少', () => {
    for (const p of PUZZLES) {
      const b = buildPuzzleBoard(p);
      const depth = mateDepth(b, p.side, p.goalMoves);
      expect(`${p.id}:${depth}`).toBe(`${p.id}:${p.goalMoves}`);
      if (p.goalMoves > 1) {
        // 少一步就杀不了：目标步数是「最小步数」
        expect(canForceMate(b, p.side, p.goalMoves - 1)).toBe(false);
      }
    }
  });

  it('正解首着合法且走完仍在杀棋之内；不会「随便走哪儿都赢」', () => {
    for (const p of PUZZLES) {
      const b = buildPuzzleBoard(p);
      const mv = findMateMove(b, p.side, p.goalMoves);
      expect(mv).not.toBeNull();
      const legal = legalMoves(b, mv!.from[0], mv!.from[1]).some(
        ([r, c]) => r === mv!.to[0] && c === mv!.to[1],
      );
      expect(legal).toBe(true);

      const after = b.map((row) => row.map((x) => (x ? { t: x.t, s: x.s } : null)));
      makeMove(after, mv!.from, mv!.to);
      // 首着走完仍在杀棋之内：或已直接取胜，或对方任何应着之后都还剩 N-1 步强制杀
      const remains =
        !sideHasAnyMove(after, other(p.side)) ||
        movesOf(after, other(p.side)).every((reply) => {
          const nb = after.map((row) => row.map((x) => (x ? { t: x.t, s: x.s } : null)));
          makeMove(nb, reply.from, reply.to);
          return canForceMate(nb, p.side, p.goalMoves - 1);
        });
      expect(remains).toBe(true);

      // 非退化：至少存在一步走不赢（否则残局变成「随便走」）
      const total = movesOf(b, p.side).length;
      let winning = 0;
      for (const m of movesOf(b, p.side)) {
        const nb = b.map((row) => row.map((x) => (x ? { t: x.t, s: x.s } : null)));
        makeMove(nb, m.from, m.to);
        if (!sideHasAnyMove(nb, other(p.side))) winning++;
        else if (p.goalMoves > 1 && canForceMate(nb, p.side, p.goalMoves - 1)) winning++;
      }
      expect(winning).toBeGreaterThan(0);
      expect(winning).toBeLessThan(total);
    }
  });

  it('buildPuzzleBoard / findPuzzle / nextPuzzle 行为', () => {
    const p = PUZZLES[0];
    const b = buildPuzzleBoard(p);
    expect(b[p.pieces[0][0]][p.pieces[0][1]]).toEqual({ t: p.pieces[0][2], s: p.pieces[0][3] });
    expect(b.flat().filter(Boolean).length).toBe(p.pieces.length);

    expect(findPuzzle(p.id)).toBe(p);
    expect(findPuzzle('not-exist')).toBeNull();
    expect(nextPuzzle(PUZZLES[0].id)).toBe(PUZZLES[1]);
    expect(nextPuzzle(PUZZLES[PUZZLES.length - 1].id)).toBeNull();
    expect(nextPuzzle('not-exist')).toBeNull();
  });
});

// ---------------------------------------------------------------- 题库自检

describe('残局题库：自检（checkPuzzle / checkEndgameBank）', () => {
  it('内置题库逐条通过自检（局面合法 · 目标步数内可解 · 步数最少）', () => {
    const res = checkEndgameBank();
    expect(res.length).toBe(PUZZLES.length);
    expect(res.map((r) => r.id)).toEqual(PUZZLES.map((p) => p.id));
    for (const r of res) {
      expect(`${r.id}:${r.ok}|${r.problems.join('、')}`).toBe(`${r.id}:true|`);
      expect(r.solvable).toBe(true);
      expect(r.minimal).toBe(true);
      expect(r.problems).toEqual([]);
    }
  });

  it('自检能抓出「缺少将/帅」与「棋子越界 / 重叠」', () => {
    const base = PUZZLES[0];
    const noBlackKing = { ...base, pieces: base.pieces.filter(([, , t, s]) => !(t === 'K' && s === 'b')) };
    const r1 = checkPuzzle(noBlackKing);
    expect(r1.ok).toBe(false);
    expect(r1.problems).toContain('缺少黑将');

    const outOfBounds = {
      ...base,
      pieces: [...base.pieces, [10, 0, 'P', 'b'] as [number, number, PieceType, Side]],
    };
    expect(checkPuzzle(outOfBounds).problems.some((p) => p.startsWith('棋子越界'))).toBe(true);

    const overlapped = {
      ...base,
      pieces: [
        ...base.pieces,
        [base.pieces[0][0], base.pieces[0][1], 'P', 'b'] as [number, number, PieceType, Side],
      ],
    };
    expect(checkPuzzle(overlapped).problems.some((p) => p.startsWith('棋子重叠'))).toBe(true);
  });

  it('自检能抓出「目标步数不可解」与「不是最少步数」', () => {
    // 借帅封门是两步杀：把目标步数改成 1 步即不可解
    const medium = PUZZLES.find((p) => p.id === 'jieshuaifengmen')!;
    const unsolvable = checkPuzzle({ ...medium, goalMoves: 1 });
    expect(unsolvable.ok).toBe(false);
    expect(unsolvable.solvable).toBe(false);
    expect(unsolvable.problems.some((p) => p.includes('无法在 1 步内强制取胜'))).toBe(true);

    // 对面笑是一步杀：把目标步数放宽到 2 步就不是「最少步数」
    const easy = PUZZLES.find((p) => p.id === 'bailianjiang')!;
    const notMinimal = checkPuzzle({ ...easy, goalMoves: 2 });
    expect(notMinimal.solvable).toBe(true);
    expect(notMinimal.minimal).toBe(false);
    expect(notMinimal.ok).toBe(false);
    expect(notMinimal.problems.some((p) => p.includes('不是最少步数'))).toBe(true);
  });

  it('自检能抓出「后手方开局已被将死 / 困毙」', () => {
    // 对面笑的终局构图（红车沉底后黑方无着可走），作为初始局面即「后手方已无子可走」
    const dead = checkPuzzle({
      ...PUZZLES[0],
      pieces: [
        [0, 4, 'K', 'b'],
        [0, 2, 'P', 'b'],
        [9, 3, 'K', 'r'],
        [1, 5, 'P', 'r'],
        [0, 0, 'R', 'r'],
      ],
    });
    expect(dead.ok).toBe(false);
    expect(dead.problems).toContain('后手方开局已被将死 / 困毙');
  });

  it('自检不修改传入的题目', () => {
    const p = PUZZLES[0];
    const before = JSON.stringify(p);
    checkPuzzle(p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

// ---------------------------------------------------------------- 自建残局

describe('自建残局：保存前自动核验（checkCustomEndgame）', () => {
  it('合法且能强制取胜的局面：通过核验并求出最优步数', () => {
    // 直接拿内置题目的局面当自建残局（一步杀 / 两步杀）
    const one = PUZZLES.find((p) => p.id === 'wocaoma')!;
    const r1 = checkCustomEndgame(one.pieces, 'r');
    expect(r1.ok).toBe(true);
    expect(r1.problems).toEqual([]);
    expect(r1.goalMoves).toBe(1);

    const two = PUZZLES.find((p) => p.id === 'jieshuaifengmen')!;
    const r2 = checkCustomEndgame(two.pieces, 'r');
    expect(r2.ok).toBe(true);
    expect(r2.goalMoves).toBe(2);
  });

  it('核验上限默认 4 步：上限内没有强制杀法即不通过', () => {
    // 双方各只有将/帅，外加一颗远处的红兵：红方无法在 4 步内强制将死
    const pieces: Array<[number, number, PieceType, Side]> = [
      [9, 3, 'K', 'r'],
      [0, 4, 'K', 'b'],
      [5, 0, 'P', 'r'],
    ];
    expect(CUSTOM_CHECK_MAX).toBe(4);
    const r = checkCustomEndgame(pieces, 'r');
    expect(r.ok).toBe(false);
    expect(r.goalMoves).toBe(0);
    expect(r.problems).toContain('无法在 4 步内强制取胜');
  });

  it('核验上限可调：两步杀在 1 步上限下不通过', () => {
    const two = PUZZLES.find((p) => p.id === 'jieshuaifengmen')!;
    const r = checkCustomEndgame(two.pieces, 'r', 1);
    expect(r.ok).toBe(false);
    expect(r.goalMoves).toBe(0);
    expect(r.problems).toContain('无法在 1 步内强制取胜');
  });

  it('局面不合法（缺将 / 重叠 / 越界）会被拦下，且不给步数', () => {
    const base = PUZZLES.find((p) => p.id === 'wocaoma')!;
    const noBlackKing = base.pieces.filter(([, , t, s]) => !(t === 'K' && s === 'b'));
    const r1 = checkCustomEndgame(noBlackKing, 'r');
    expect(r1.ok).toBe(false);
    expect(r1.goalMoves).toBe(0);
    expect(r1.problems).toContain('缺少黑将');

    const overlapped: Array<[number, number, PieceType, Side]> = [
      ...base.pieces,
      [base.pieces[0][0], base.pieces[0][1], 'P', 'b'],
    ];
    expect(checkCustomEndgame(overlapped, 'r').problems.some((p) => p.startsWith('棋子重叠'))).toBe(true);

    const outOfBounds: Array<[number, number, PieceType, Side]> = [...base.pieces, [10, 0, 'P', 'b']];
    expect(checkCustomEndgame(outOfBounds, 'r').problems.some((p) => p.startsWith('棋子越界'))).toBe(true);
  });

  it('后手方开局已被将死 / 困毙同样拦下（与题库自检同一套判定）', () => {
    // 对面笑的终局构图（红车已沉底、黑方无着可走）当初始局面
    const dead: Array<[number, number, PieceType, Side]> = [
      [0, 4, 'K', 'b'],
      [0, 2, 'P', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [0, 0, 'R', 'r'],
    ];
    const r = checkCustomEndgame(dead, 'r');
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('后手方开局已被将死 / 困毙');
  });

  it('核验不修改传入的棋子表', () => {
    const p = PUZZLES[0];
    const before = JSON.stringify(p.pieces);
    checkCustomEndgame(p.pieces, p.side);
    expect(JSON.stringify(p.pieces)).toBe(before);
  });
});

describe('自建残局：题目构造与本机存档', () => {
  it('makeCustomEndgame：等级固定为「自建」、含最优步数与要点', () => {
    const pieces: Array<[number, number, PieceType, Side]> = [
      [0, 4, 'K', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [8, 0, 'R', 'r'],
    ];
    const p = makeCustomEndgame('custom-1', '我的残局', 'r', pieces, 1);
    expect(p.id).toBe('custom-1');
    expect(p.name).toBe('我的残局');
    expect(p.level).toBe(CUSTOM_LEVEL);
    expect(LEVEL_LABEL[p.level]).toBe('自建');
    expect(p.side).toBe('r');
    expect(p.goalMoves).toBe(1);
    expect(p.intro).toContain('1 步内可强制将死对方');
    expect(p.pieces).toEqual(pieces);
    expect(buildPuzzleBoard(p)[0][4]).toEqual({ t: 'K', s: 'b' });
    // 题目与传入数组解耦：改题目盘面不会影响调用方
    const board = buildPuzzleBoard(p);
    board[0][4] = null;
    expect(p.pieces).toEqual(pieces);
  });

  it('parseCustomEndgames：损坏数据 / 结构不符的条目一律丢弃', () => {
    expect(parseCustomEndgames(null)).toEqual([]);
    expect(parseCustomEndgames('不是 JSON')).toEqual([]);
    expect(parseCustomEndgames('{"a":1}')).toEqual([]); // 非数组
    const pieces: Array<[number, number, PieceType, Side]> = [
      [0, 4, 'K', 'b'],
      [9, 3, 'K', 'r'],
    ];
    const good = makeCustomEndgame('custom-good', '好题', 'b', pieces, 2);
    const bad = [
      { ...good, id: '' }, // 缺 id
      { ...good, side: 'x' }, // 阵营非法
      { ...good, goalMoves: 0 }, // 步数非法
      { ...good, pieces: [[0, 4, 'K']] }, // 棋子表不是四元组
      { ...good, pieces: [[0, 4, 'Z', 'b']] }, // 棋子类型非法
      { ...good, pieces: [[0.5, 4, 'K', 'b']] }, // 坐标非整数
    ];
    expect(parseCustomEndgames(JSON.stringify([good]))).toEqual([good]);
    expect(parseCustomEndgames(JSON.stringify([good, ...bad]))).toEqual([good]);
  });

  it('upsertCustomEndgame / removeCustomEndgame：新增、同 id 覆盖、删除，且都不修改传入数组', () => {
    const pieces: Array<[number, number, PieceType, Side]> = [
      [0, 4, 'K', 'b'],
      [9, 3, 'K', 'r'],
    ];
    const a = makeCustomEndgame('custom-a', 'A', 'r', pieces, 1);
    const b = makeCustomEndgame('custom-b', 'B', 'r', pieces, 2);
    const list = [a];
    const added = upsertCustomEndgame(list, b);
    expect(added.map((x) => x.id)).toEqual(['custom-a', 'custom-b']);
    expect(list.length).toBe(1); // 原数组不动

    const updated = upsertCustomEndgame(added, makeCustomEndgame('custom-a', 'A2', 'b', pieces, 3));
    expect(updated.map((x) => x.name)).toEqual(['A2', 'B']);
    expect(updated[0].side).toBe('b');
    expect(added[0].name).toBe('A'); // 原数组不动

    expect(removeCustomEndgame(updated, 'custom-a').map((x) => x.id)).toEqual(['custom-b']);
    expect(removeCustomEndgame(updated, 'nope').length).toBe(2);
    expect(updated.length).toBe(2);
  });
});

describe('自建残局：棋盘与棋子表互转（编辑器局面按钮共用）', () => {
  it('boardToPieces / piecesToBoard：往返一致（空位不落子）', () => {
    const board = buildPuzzleBoard(PUZZLES[0]);
    const pieces = boardToPieces(board);
    expect(pieces.length).toBe(PUZZLES[0].pieces.length);
    expect(piecesToBoard(pieces)).toEqual(board);
  });

  it('swapPieceSides：位置不变、阵营对调，且不修改传入数组', () => {
    const pieces: Array<[number, number, PieceType, Side]> = [
      [0, 4, 'K', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
    ];
    expect(swapPieceSides(pieces)).toEqual([
      [0, 4, 'K', 'r'],
      [9, 3, 'K', 'b'],
      [1, 5, 'P', 'b'],
    ]);
    expect(pieces[0][3]).toBe('b'); // 原数组不动
  });
});

// ---------------------------------------------------------------- 本机记录

describe('残局本机记录：完成 / 失败 / 未完成与最优步数', () => {
  it('endgameOutcome：已完成 / 失败 / 未完成（取胜优先于失败）', () => {
    expect(endgameOutcome(undefined)).toBe('todo');
    expect(endgameOutcome({})).toBe('todo');
    expect(endgameOutcome({ fail: true })).toBe('fail');
    expect(endgameOutcome({ win: 3 })).toBe('win');
    expect(endgameOutcome({ win: 3, fail: true })).toBe('win');
  });

  it('isOptimalSteps：取胜步数等于最优步数才算达成（未通关 / 失败不算）', () => {
    expect(isOptimalSteps(undefined, 2)).toBe(false);
    expect(isOptimalSteps({ fail: true }, 2)).toBe(false);
    expect(isOptimalSteps({ win: 3 }, 2)).toBe(false); // 赢过但非最优
    expect(isOptimalSteps({ win: 2 }, 2)).toBe(true);
  });

  it('parseEndgameRecords：兼容旧版数字格式，容忍损坏数据', () => {
    expect(parseEndgameRecords(null)).toEqual({});
    expect(parseEndgameRecords('not json')).toEqual({});
    expect(parseEndgameRecords('{"a":2}')).toEqual({ a: { win: 2 } }); // 旧格式：数字 = 已通关
    expect(parseEndgameRecords('{"a":{"win":3,"fail":true},"b":{"fail":true},"c":"x","d":0}')).toEqual({
      a: { win: 3, fail: true },
      b: { fail: true },
    });
  });

  it('recordWin / recordFail：保留最少步数、失败不覆盖已通关，且不修改传入对象', () => {
    const base: Record<string, EndgameRecord> = {};

    const win5 = recordWin(base, 'p', 5);
    expect(win5).toEqual({ p: { win: 5 } });
    expect(base).toEqual({}); // 纯函数：不改动传入对象

    expect(recordWin(win5, 'p', 3).p.win).toBe(3); // 更快 → 更新
    expect(recordWin(win5, 'p', 8).p.win).toBe(5); // 更慢 → 保留最好

    const failed = recordFail(win5, 'p'); // 已通关的局不再标失败
    expect(failed).toBe(win5);
    expect(recordFail(base, 'q')).toEqual({ q: { fail: true } });

    // 失败后再取胜：失败标记被清除（列表显示绿勾而非红叉）
    expect(recordWin(recordFail(base, 'q'), 'q', 2)).toEqual({ q: { win: 2 } });
  });
});

// ---------------------------------------------------------------- 求解器

describe('强制将死求解器', () => {
  /** 挂角马：红马 [4,4] → [2,3] 一步杀（唯一解） */
  const MATE_IN_1: Array<[number, number, PieceType, Side]> = [
    [0, 4, 'K', 'b'],
    [0, 3, 'A', 'b'],
    [0, 5, 'A', 'b'],
    [9, 5, 'K', 'r'],
    [1, 5, 'P', 'r'],
    [4, 4, 'N', 'r'],
  ];

  it('一步杀：给出唯一正解', () => {
    const b = board(MATE_IN_1);
    expect(canForceMate(b, 'r', 1)).toBe(true);
    expect(findMateMove(b, 'r', 1)).toEqual({ from: [4, 4], to: [2, 3] });
  });

  it('少一个封门子就杀不成（返回 null / false）', () => {
    const b = board(MATE_IN_1.filter(([, , t, s]) => !(t === 'P' && s === 'r')));
    expect(canForceMate(b, 'r', 1)).toBe(false);
    expect(findMateMove(b, 'r', 1)).toBeNull();
    expect(findMateMove(b, 'r', 0)).toBeNull();
  });

  it('多步杀：暂不可杀，但按步数放宽后成立', () => {
    // 借帅封门：先用车将军，再平帅以「照面」封住黑将退路
    const b = board([
      [0, 4, 'K', 'b'],
      [0, 3, 'A', 'b'],
      [0, 5, 'A', 'b'],
      [9, 4, 'K', 'r'],
      [6, 2, 'R', 'r'],
      [7, 4, 'N', 'r'],
    ]);
    expect(canForceMate(b, 'r', 1)).toBe(false);
    expect(canForceMate(b, 'r', 2)).toBe(true);
  });

  it('对方无着可走即算取胜（困毙同将死）', () => {
    // 对面笑：红车 [8,0] → [0,0] 后黑将无着可走（被自己的卒与照面规则困住），黑方并未被将军
    const b = board([
      [0, 4, 'K', 'b'],
      [0, 2, 'P', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [8, 0, 'R', 'r'],
    ]);
    makeMove(b, [8, 0], [0, 0]);
    expect(isInCheck(b, 'b')).toBe(false);
    expect(sideHasAnyMove(b, 'b')).toBe(false);

    const fresh = board([
      [0, 4, 'K', 'b'],
      [0, 2, 'P', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [8, 0, 'R', 'r'],
    ]);
    expect(canForceMate(fresh, 'r', 1)).toBe(true);
  });

  it('求解不修改传入的棋盘', () => {
    const b = board(MATE_IN_1);
    const before = JSON.stringify(b);
    canForceMate(b, 'r', 2);
    findMateMove(b, 'r', 1);
    expect(JSON.stringify(b)).toBe(before);
  });

  it('残局一律由玩家先行（红方），求解器对黑方同样适用', () => {
    // 「对面笑」的 180° 镜像（黑白互换）：黑车一步即可取胜红帅
    const b = board([
      [9, 4, 'K', 'r'],
      [9, 6, 'P', 'r'],
      [0, 5, 'K', 'b'],
      [8, 3, 'P', 'b'],
      [1, 8, 'R', 'b'],
    ]);
    expect(canForceMate(b, 'b', 1)).toBe(true);
    expect(findMateMove(b, 'b', 1)).not.toBeNull();
    expect(legalMoves(b, 1, 8).length).toBeGreaterThan(0);
  });

  it('minMateDepth：给出当前局面的最少取胜步数（超过搜索上限返回 0）', () => {
    // 一步杀
    const one = board(MATE_IN_1);
    expect(minMateDepth(one, 'r', 1)).toBe(1);
    expect(minMateDepth(one, 'r', 3)).toBe(1); // 已是「最少」，放宽上限也返回 1
    expect(minMateDepth(one, 'r', 0)).toBe(0);

    // 借帅封门：两步杀（上限不足时为 0）
    const two = board([
      [0, 4, 'K', 'b'],
      [0, 3, 'A', 'b'],
      [0, 5, 'A', 'b'],
      [9, 4, 'K', 'r'],
      [6, 2, 'R', 'r'],
      [7, 4, 'N', 'r'],
    ]);
    expect(minMateDepth(two, 'r', 1)).toBe(0);
    expect(minMateDepth(two, 'r', 2)).toBe(2);
  });

  it('残局题库：不限步数时，初始局面的最优步数即题库给出的 goalMoves', () => {
    for (const p of PUZZLES) {
      const b = buildPuzzleBoard(p);
      expect(`${p.id}:${minMateDepth(b, p.side, 6)}`).toBe(`${p.id}:${p.goalMoves}`);
    }
  });
});

// ---------------------------------------------------------------- 界面接线

describe('残局挑战：界面接线', () => {
  it('首页挂板新增「残局挑战」入口，与大面板一一对应', () => {
    expect(HTML).toContain('id="btn-endgame"');
    expect(HTML).toContain('残局挑战');
    const boardHtml = HTML.slice(HTML.indexOf('id="menu-board"'), HTML.indexOf('id="menu-create"'));
    expect((boardHtml.match(/<a id="/g) ?? []).length).toBe(6);
    const idx = HTML.indexOf('id="menu-endgame"');
    expect(idx).toBeGreaterThan(-1);
    // 面板自身带大面板样式类
    expect(HTML.slice(HTML.lastIndexOf('<', idx), HTML.indexOf('>', idx))).toContain('panel-lg');
    expect(APP).toContain("'endgame'");
    expect(APP).toContain("$('menu-endgame').hidden = panel !== 'endgame'");
  });

  it('对局页含残局操作行（悔棋 / 提示 / 下一关 / 重来 / 离开）与残局目标信息块', () => {
    for (const id of [
      'actions-endgame',
      'btn-eg-undo',
      'btn-eg-hint',
      'btn-eg-next',
      'btn-eg-restart',
      'btn-eg-leave',
    ]) {
      expect(HTML).toContain(`id="${id}"`);
    }
    for (const id of ['eg-box', 'eg-info']) expect(HTML).toContain(`id="${id}"`);
    expect(APP).toContain("$('actions-play').hidden = over || S.spectator || !!eg");
    expect(APP).toContain("$('actions-endgame').hidden = !eg || over");
  });

  it('残局页面「下一关」按钮：题库还有下一局才显示，点击进入下一局', () => {
    expect(APP).toContain('function endgameNext()');
    expect(APP).toContain('const next = nextPuzzle(eg.puzzle.id)');
    expect(APP).toContain("$('btn-eg-next').addEventListener('click', endgameNext)");
    // 最后一关隐藏（结果弹层另有「下一关」）
    expect(APP).toContain("$<HTMLButtonElement>('btn-eg-next').hidden = !eg || !nextPuzzle(eg.puzzle.id)");
    expect(APP).toContain('已经是最后一关了');
  });

  it('残局面板「自建残局」入口：打开编辑器，保存时自动核验（不再有「自检题库」入口）', () => {
    expect(HTML).toContain('id="btn-eg-create"');
    // 「自检题库」的手动入口已移除：改为保存自建残局时自动核验
    expect(HTML).not.toContain('btn-eg-check');
    expect(APP).not.toContain('checkEndgameBankUI');
    expect(APP).toContain("$('btn-eg-create').addEventListener('click', openEndgameEditor)");
    expect(APP).toContain('function openEndgameEditor()');
    expect(APP).toContain('editor?.open(null)');
    // 保存：自动核验 → 通过才落盘（写本机存档），不通过逐条列出问题
    expect(APP).toContain('function saveCustomEndgame(p: EndgamePuzzle)');
    expect(APP).toContain('upsertCustomEndgame(readCustomEndgames(), p)');
    expect(APP).toContain('function showCustomProblems(name: string, problems: string[])');
    expect(APP).toContain("row.className = 'eg-check-row bad'");
    expect(EDITOR).toContain('checkCustomEndgame(pieces, state.first, CUSTOM_CHECK_MAX)');
    expect(EDITOR).toContain('deps.onInvalid(name, check.problems)');
    expect(EDITOR).toContain(
      'deps.onSave(makeCustomEndgame(state.id, name, state.first, pieces, check.goalMoves))',
    );
  });

  it('自建残局编辑器：棋盘摆子 + 局面面板 + 棋子栏 + 红先/黑先，并并入残局列表', () => {
    // 界面结构：棋盘 / 棋子栏（红黑两排）/ 红先黑先 / 局面面板 / 保存
    for (const id of [
      'screen-endgame-editor',
      'eg-board',
      'eg-pal-red',
      'eg-pal-black',
      'eg-first-r',
      'eg-first-b',
      'eg-reset',
      'eg-clear',
      'eg-swap',
      'eg-name',
      'eg-cancel',
      'eg-save',
    ]) {
      expect(HTML).toContain(`id="${id}"`);
    }
    for (const text of ['初始局面', '清空', '红黑互换', '红先', '黑先']) expect(HTML).toContain(text);
    // 棋子栏两排（红黑各 7 种棋子）、局面按钮走共享层纯函数
    expect(EDITOR).toContain('btn.className = `eg-piece ${s}`');
    expect(EDITOR).toContain('piecesToBoard(swapPieceSides(boardToPieces(board)))');
    expect(EDITOR).toContain('state.board = initBoard()');
    expect(EDITOR).toContain('state.board = emptyBoard()');
    // 落子 / 右键拿走 / 悬停落点提示 / 切屏
    expect(EDITOR).toContain("canvas.addEventListener('click'");
    expect(EDITOR).toContain("canvas.addEventListener('contextmenu'");
    expect(EDITOR).toContain("deps.show('screen-endgame-editor')");
    // app.ts 接线：装配编辑器、自建条目可再次编辑 / 删除、并入列表
    expect(APP).toContain('editor = initEndgameEditor({');
    expect(APP).toContain('editor?.open(p)');
    expect(APP).toContain('removeCustomEndgame(readCustomEndgames(), p.id)');
    expect(APP).toContain('for (const p of readCustomEndgames())');
    expect(APP).toContain('function endgameRow(');
    expect(APP).toContain('function backToEndgamePanel()');
    // 样式契约
    expect(CSS).toContain('.editor-layout');
    expect(CSS).toContain('.eg-piece');
    expect(CSS).toContain('.editor-act');
    expect(CSS).toContain('.eg-item .eg-mini');
  });

  it('渲染层接线：题库局面载入本机状态机、提示用求解器、AI 执玩家的对方、胜负记入本地', () => {
    expect(APP).toContain('buildPuzzleBoard(p)');
    expect(APP).toContain('findMateMove(S.board, S.side,');
    expect(APP).toContain('localGame.setup(');
    expect(APP).toContain('const ENDGAME_AI_DEPTH');
    expect(APP).toContain('ENDGAME_KEY');
    expect(APP).toContain('recordEndgameWin');
    expect(APP).toContain('recordEndgameFail');
    // 残局不依赖服务器：开局时关闭联机连接
    expect(APP).toContain('function startPuzzle(p: EndgamePuzzle)');
    // 残局走子后不再按人机对弈流程处理
    expect(APP).toContain('if (S.endgame) {\n    endgameEvaluate();');
  });

  it('多步残局：未出结果时必须继续调度 AI 应招（否则玩家走完一步就卡住）', () => {
    const body = APP.slice(
      APP.indexOf('function endgameEvaluate()'),
      APP.indexOf('function showEndgameResult()'),
    );
    expect(body).toContain('scheduleLocalAi()');
    // 只在「尚未终局」的分支里继续对局
    const elseBranch = body.slice(
      body.indexOf('} else {'),
      body.indexOf('render();\n  showEndgameResult();'),
    );
    expect(elseBranch).toContain('scheduleLocalAi()');
    expect(elseBranch).toContain('return;');
  });

  it('AI 应招后同样走残局判定（终局能正确收尾）', () => {
    const start = APP.indexOf('function scheduleLocalAi()');
    const ai = APP.slice(start, APP.indexOf('// ----', start));
    expect(ai).toContain('localAiSide()');
    expect(ai).toContain('if (S.endgame) endgameEvaluate();');
  });

  it('残局不限步数：将死即胜，不再按步数判负，并展示最优步数', () => {
    const body = APP.slice(
      APP.indexOf('function endgameEvaluate()'),
      APP.indexOf('function showEndgameResult()'),
    );
    // 只按终局判定，不再有「超出步数」这一失败原因
    expect(body).not.toContain('超出步数');
    expect(body).toContain("if (S.status === 'over')");
    expect(body).toContain('recordEndgameWin(eg.puzzle.id, eg.used)');
    expect(body).toContain('recordEndgameFail(eg.puzzle.id)');
    // 列表与侧栏都把「目标步数」改为「最优步数」
    expect(APP).toContain('最优 ${p.goalMoves} 步');
    expect(APP).toContain('最优：${eg.puzzle.goalMoves} 步');
    // 侧栏角色提示也不再出现「N 步内取胜」的上限写法
    expect(APP).toContain('不限步数 · 最优 ${p.goalMoves} 步');
    expect(APP).not.toContain('${p.goalMoves} 步内取胜');
    // 提示改为求当前局面最快取胜着法
    expect(APP).toContain('minMateDepth(S.board, S.side, ENDGAME_HINT_MAX)');
    expect(APP).toContain('const ENDGAME_HINT_MAX');
  });

  it('残局列表状态标记：绿勾 / 红叉 / 白勾 + 绿（最优）/ 灰（非最优）外圈', () => {
    // 渲染层用纯函数判定状态与是否最优（行为见下方「本机记录」用例）
    expect(APP).toContain('const status = endgameOutcome(rec)');
    expect(APP).toContain('const optimal = isOptimalSteps(rec, p.goalMoves)');
    expect(APP).toContain("mark.className = `eg-mark ${status}${optimal ? ' optimal' : ''}`");
    expect(APP).toContain("mark.textContent = status === 'fail' ? '✗' : '✓'");
    // 样式：绿勾 / 红叉 / 白勾 + 绿圈 / 灰圈
    expect(CSS).toContain('.eg-mark.win');
    expect(CSS).toContain('.eg-mark.fail');
    expect(CSS).toContain('.eg-mark.todo');
    expect(CSS).toContain('.eg-mark.optimal');
    // 旧的「已通关 · N 步」标签已移除
    expect(CSS).not.toContain('.eg-done');
    expect(APP).not.toContain('已通关 · ');
  });

  it('残局样式沿用 v2.4 设计令牌，列表行可聚焦', () => {
    expect(CSS).toContain('.eg-row');
    expect(CSS).toContain('.eg-info');
    expect(CSS).toContain('.eg-row:focus-visible');
    expect(CSS).toContain('.status-box.over.lose');
    // 题库自检结果列表
    expect(CSS).toContain('.eg-check-list');
    expect(CSS).toContain('.eg-check-row.bad');
    expect(CSS).toContain('.eg-check-detail');
  });
});
