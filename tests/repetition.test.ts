import { describe, expect, it } from 'vitest';
import { Board, Pos, Side } from '../src/shared/types.js';
import { boardAfterMove, initBoard } from '../src/shared/rules.js';
import { Game } from '../src/shared/game.js';
import {
  classifyMove,
  judgeRepetition,
  MoveNature,
  positionKey,
  RepetitionHistory,
  REPETITION_TIMES,
} from '../src/shared/repetition.js';

const empty = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null));

/** 组装一段重复历史：键序列 + 每手性质 */
const hist = (keys: string[], natures: Array<[Side, MoveNature]>): RepetitionHistory => ({
  keys,
  natures: natures.map(([side, nature]) => ({ side, nature })),
});

describe('重复局面裁决（纯函数）', () => {
  it('局面键只由棋盘布局与行棋方决定', () => {
    expect(positionKey(initBoard(), 'r')).toBe(positionKey(initBoard(), 'r'));
    expect(positionKey(initBoard(), 'r')).not.toBe(positionKey(initBoard(), 'b'));
    const moved = boardAfterMove(initBoard(), [6, 0], [5, 0]);
    expect(positionKey(moved, 'b')).not.toBe(positionKey(initBoard(), 'b'));
    // 两次相同走子后的局面键一致（与棋盘对象无关）
    expect(positionKey(boardAfterMove(moved, [3, 0], [4, 0]), 'r')).toBe(
      positionKey(boardAfterMove(moved, [3, 0], [4, 0]), 'r'),
    );
  });

  it('classifyMove：走子后对方被将军记为 check', () => {
    const before = empty();
    before[0][4] = { t: 'K', s: 'b' };
    before[9][3] = { t: 'K', s: 'r' };
    before[5][6] = { t: 'R', s: 'r' };
    const after = boardAfterMove(before, [5, 6], [5, 4]); // 车平到 4 路将军
    expect(classifyMove(before, after, 'r')).toBe('check');
  });

  it('classifyMove：新出现的得子威胁记为 chase', () => {
    const before = empty();
    before[0][4] = { t: 'K', s: 'b' };
    before[9][3] = { t: 'K', s: 'r' };
    before[2][1] = { t: 'N', s: 'b' };
    before[4][7] = { t: 'R', s: 'r' };
    const after = boardAfterMove(before, [4, 7], [2, 7]); // 车走到 2 路，捉住无根马
    expect(classifyMove(before, after, 'r')).toBe('chase');
  });

  it('classifyMove：威胁早已存在（同一子仍被吃）不算新的捉，记为 idle', () => {
    const before = empty();
    before[0][4] = { t: 'K', s: 'b' };
    before[9][3] = { t: 'K', s: 'r' };
    before[2][1] = { t: 'N', s: 'b' };
    before[2][7] = { t: 'R', s: 'r' };
    const after = boardAfterMove(before, [2, 7], [2, 6]); // 车沿本行挪一格，仍旧咬住同一匹马
    expect(classifyMove(before, after, 'r')).toBe('idle');
  });

  it('同一局面不足 3 次重复时不裁决', () => {
    expect(
      judgeRepetition(
        hist(
          ['a', 'x', 'a'],
          [
            ['r', 'check'],
            ['b', 'idle'],
          ],
        ),
      ),
    ).toBeNull();
    expect(
      judgeRepetition(
        hist(
          ['a', 'x', 'a', 'x'],
          [
            ['r', 'check'],
            ['b', 'idle'],
            ['r', 'idle'],
          ],
        ),
      ),
    ).toBeNull();
    expect(REPETITION_TIMES).toBe(3);
  });

  it('一方长将、另一方长闲 → 长将方判负', () => {
    const h = hist(
      ['a', 'x', 'a', 'x', 'a'],
      [
        ['r', 'check'],
        ['b', 'idle'],
        ['r', 'check'],
        ['b', 'idle'],
      ],
    );
    expect(judgeRepetition(h)).toEqual({ outcome: 'lose', loser: 'r', reason: '长将判负' });
  });

  it('一方长捉、另一方长闲 → 长捉方判负', () => {
    const h = hist(
      ['a', 'x', 'a', 'x', 'a'],
      [
        ['r', 'chase'],
        ['b', 'idle'],
        ['r', 'chase'],
        ['b', 'idle'],
      ],
    );
    expect(judgeRepetition(h)).toEqual({ outcome: 'lose', loser: 'r', reason: '长捉判负' });
  });

  it('一方将捉混合（每步都是打）、另一方长闲 → 长打方判负', () => {
    const h = hist(
      ['a', 'x', 'a', 'x', 'a'],
      [
        ['b', 'check'],
        ['r', 'idle'],
        ['b', 'chase'],
        ['r', 'idle'],
      ],
    );
    expect(judgeRepetition(h)).toEqual({ outcome: 'lose', loser: 'b', reason: '长打判负' });
  });

  it('双方都是长打 → 不判和，提示「请变招」', () => {
    const h = hist(
      ['a', 'x', 'a', 'x', 'a'],
      [
        ['r', 'check'],
        ['b', 'check'],
        ['r', 'check'],
        ['b', 'chase'],
      ],
    );
    expect(judgeRepetition(h)).toEqual({ outcome: 'hint', reason: '请变招' });
  });

  it('双方都是长闲（重复局面但无人长打）→ 不判和，提示「请变招」', () => {
    const h = hist(
      ['a', 'x', 'a', 'x', 'a'],
      [
        ['r', 'idle'],
        ['b', 'idle'],
        ['r', 'chase'], // 一方只是「一打一闲」不算长打
        ['b', 'idle'],
      ],
    );
    expect(judgeRepetition(h)).toEqual({ outcome: 'hint', reason: '请变招' });
  });

  it('只看最后一次重复循环（更早的循环不影响当前裁决）', () => {
    const h = hist(
      ['a', 'a', 'a', 'x', 'a', 'x', 'a'],
      [
        ['r', 'check'],
        ['b', 'idle'],
        ['r', 'chase'],
        ['b', 'idle'],
        ['r', 'idle'],
        ['b', 'idle'],
      ],
    );
    expect(judgeRepetition(h)).toEqual({ outcome: 'hint', reason: '请变招' });
  });
});

describe('重复局面裁决（对局状态机集成）', () => {
  /** 长将循环：红车在 4 / 5 路来回将军，黑将左右躲闪 */
  const CHECK_BOARD = (): Board => {
    const b = empty();
    b[0][4] = { t: 'K', s: 'b' };
    b[9][3] = { t: 'K', s: 'r' };
    b[6][4] = { t: 'R', s: 'r' };
    return b;
  };
  const CHECK_SEQ: Array<[Pos, Pos, Side]> = [
    [[6, 4], [5, 4], 'r'], // 1 将军
    [[0, 4], [0, 5], 'b'], // 2 将躲
    [[5, 4], [5, 5], 'r'], // 3 将军
    [[0, 5], [0, 4], 'b'], // 4 将回
    [[5, 5], [5, 4], 'r'], // 5 将军 → 局面第 2 次
    [[0, 4], [0, 5], 'b'], // 6
    [[5, 4], [5, 5], 'r'], // 7
    [[0, 5], [0, 4], 'b'], // 8
    [[5, 5], [5, 4], 'r'], // 9 将军 → 局面第 3 次：长将判负
  ];

  /** 长捉循环：红车追捉黑无根马，马在两个落点间往返 */
  const CHASE_BOARD = (): Board => {
    const b = empty();
    b[0][4] = { t: 'K', s: 'b' };
    b[9][3] = { t: 'K', s: 'r' };
    b[2][1] = { t: 'N', s: 'b' };
    b[4][7] = { t: 'R', s: 'r' };
    return b;
  };
  const CHASE_SEQ: Array<[Pos, Pos, Side]> = [
    [[4, 7], [2, 7], 'r'], // 1 捉马
    [[2, 1], [4, 2], 'b'], // 2 马逃
    [[2, 7], [4, 7], 'r'], // 3 再捉
    [[4, 2], [2, 1], 'b'], // 4 马回 → 回到开局局面（第 2 次）
    [[4, 7], [2, 7], 'r'], // 5
    [[2, 1], [4, 2], 'b'], // 6
    [[2, 7], [4, 7], 'r'], // 7
    [[4, 2], [2, 1], 'b'], // 8 → 开局局面第 3 次：长捉判负
  ];

  /** 双方长闲循环：两车各在本方底线上往返 */
  const IDLE_BOARD = (): Board => {
    const b = empty();
    b[0][4] = { t: 'K', s: 'b' };
    b[9][3] = { t: 'K', s: 'r' };
    b[0][7] = { t: 'R', s: 'b' };
    b[9][0] = { t: 'R', s: 'r' };
    return b;
  };
  const IDLE_SEQ: Array<[Pos, Pos, Side]> = [
    [[9, 0], [9, 1], 'r'],
    [[0, 7], [0, 8], 'b'],
    [[9, 1], [9, 0], 'r'],
    [[0, 8], [0, 7], 'b'], // → 回到开局局面（第 2 次）
    [[9, 0], [9, 1], 'r'],
    [[0, 7], [0, 8], 'b'],
    [[9, 1], [9, 0], 'r'],
    [[0, 8], [0, 7], 'b'], // → 开局局面第 3 次：不变作和
  ];

  /** 依次走完给定着法，返回最后一步是否被接受 */
  const play = (g: Game, seq: Array<[Pos, Pos, Side]>, upto = seq.length): void => {
    for (const [from, to, side] of seq.slice(0, upto)) {
      expect(g.applyMove(from, to, side).ok, `第 ${from}→${to} 手应当合法`).toBe(true);
    }
  };

  it('长将三次重复 → 长将方判负', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 8);
    expect(g.status).toBe('playing'); // 第 2 次重复不裁决
    play(g, CHECK_SEQ.slice(8));
    expect(g.status).toBe('over');
    expect(g.winner).toBe('b');
    expect(g.reason).toBe('长将判负');
  });

  it('长捉三次重复 → 长捉方判负', () => {
    const g = new Game();
    g.setup(CHASE_BOARD(), 'r');
    play(g, CHASE_SEQ, 7);
    expect(g.status).toBe('playing');
    play(g, CHASE_SEQ.slice(7));
    expect(g.status).toBe('over');
    expect(g.winner).toBe('b');
    expect(g.reason).toBe('长捉判负');
  });

  it('双方长闲三次重复 → 不判和，提示「请变招」（对局继续）', () => {
    const g = new Game();
    g.setup(IDLE_BOARD(), 'r');
    play(g, IDLE_SEQ, 7);
    expect(g.status).toBe('playing');
    expect(g.repetitionHint).toBe(false); // 第 2 次重复不提示
    play(g, IDLE_SEQ.slice(7));
    expect(g.status).toBe('playing'); // 不判和，继续对局
    expect(g.winner).toBeNull();
    expect(g.reason).toBe('');
    expect(g.repetitionHint).toBe(true);
    expect(g.snapshot().repetitionHint).toBe(true); // 随快照下发，供渲染层提示
  });

  it('提示「请变招」后改成新着法 → repetitionHint 清除', () => {
    const g = new Game();
    g.setup(IDLE_BOARD(), 'r');
    play(g, IDLE_SEQ); // 第 18 手构成第 3 次重复 → 提示「请变招」
    expect(g.repetitionHint).toBe(true);
    expect(g.applyMove([9, 0], [8, 0], 'r').ok).toBe(true); // 换一招
    expect(g.status).toBe('playing');
    expect(g.repetitionHint).toBe(false);
  });

  it('悔棋会一并回退重复局面提示', () => {
    const g = new Game();
    g.setup(IDLE_BOARD(), 'r');
    play(g, IDLE_SEQ);
    expect(g.repetitionHint).toBe(true);
    expect(g.undo()).toBe(true);
    expect(g.repetitionHint).toBe(false);
  });

  it('悔棋会一并回退重复局面计数，不会提前裁决', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 8);
    expect(g.status).toBe('playing');

    expect(g.undo()).toBe(true);
    play(g, CHECK_SEQ.slice(7, 8)); // 重放第 8 手：重复计数仍是 2 次
    expect(g.status).toBe('playing');

    play(g, CHECK_SEQ.slice(8)); // 第 9 手构成第 3 次重复
    expect(g.status).toBe('over');
    expect(g.reason).toBe('长将判负');
  });

  it('reset / setup 清空重复局面历史，重新开局不会沿用旧计数', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 8);
    expect(g.status).toBe('playing');

    g.setup(CHECK_BOARD(), 'r'); // 重新载入同一局面
    play(g, CHECK_SEQ, 8);
    expect(g.status).toBe('playing');
    expect(g.moveSeq).toBe(8);
  });

  it('普通开局走子不受影响（不误判重复局面）', () => {
    const g = new Game();
    g.reset('playing');
    play(g, [
      [[6, 0], [5, 0], 'r'],
      [[3, 0], [4, 0], 'b'],
      [[7, 1], [7, 4], 'r'],
      [[2, 1], [2, 4], 'b'],
    ]);
    expect(g.status).toBe('playing');
    expect(g.reason).toBe('');
  });
});
