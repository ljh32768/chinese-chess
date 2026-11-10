import { describe, expect, it } from 'vitest';
import { Board, Move, Pos, Side } from '../src/shared/types.js';
import { boardAfterMove, initBoard } from '../src/shared/rules.js';
import { Game } from '../src/shared/game.js';
import { MATE_LINE } from './mate-line.js';
import {
  attackStreak,
  blocksVaryStep,
  CHANGE_HINT_AT,
  classifyMove,
  isVaryStep,
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

/** 连续 `n` 次「打」+ 对方每次「闲」的历史 */
const attackLog = (n: number, nature: MoveNature, side: Side = 'r'): Array<[Side, MoveNature]> => {
  const out: Array<[Side, MoveNature]> = [];
  for (let i = 0; i < n; i++) out.push([side, nature], ['b', 'idle']);
  return out;
};

describe('重复局面判定（纯函数）', () => {
  it('局面键只由棋盘布局与行棋方决定', () => {
    expect(positionKey(initBoard(), 'r')).toBe(positionKey(initBoard(), 'r'));
    expect(positionKey(initBoard(), 'r')).not.toBe(positionKey(initBoard(), 'b'));
    const moved = boardAfterMove(initBoard(), [6, 0], [5, 0]);
    expect(positionKey(moved, 'b')).not.toBe(positionKey(initBoard(), 'b'));
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

  it('连续「打」计数只数该方自己的着法，遇到「闲」即中断', () => {
    const log = attackLog(3, 'check').map(([side, nature]) => ({ side, nature }));
    expect(attackStreak(log, 'r')).toBe(3);
    expect(attackStreak(log, 'b')).toBe(0);
    expect(attackStreak([...log, { side: 'r', nature: 'idle' }], 'r')).toBe(0);
    expect(CHANGE_HINT_AT).toBe(5);
    expect(REPETITION_TIMES).toBe(3);
  });

  it('isVaryStep：第 4 步不拦截，第 5 步（及更后）才拦截，「闲」永不拦截', () => {
    const four = attackLog(4, 'check').map(([side, nature]) => ({ side, nature }));
    expect(isVaryStep(four, 'r', 'check')).toBe(true); // 第 5 步
    expect(isVaryStep(four, 'r', 'chase')).toBe(true); // 将捉混合同样计入
    expect(isVaryStep(four, 'r', 'idle')).toBe(false); // 「闲」不延长「打」
    const three = attackLog(3, 'check').map(([side, nature]) => ({ side, nature }));
    expect(isVaryStep(three, 'r', 'check')).toBe(false); // 第 4 步
    expect(
      isVaryStep(
        attackLog(5, 'check').map(([s, n]) => ({ side: s, nature: n })),
        'r',
        'check',
      ),
    ).toBe(true); // 超过第 5 步仍拦截
  });

  it('blocksVaryStep：第 5 步、局面重复且还有其它着法 → 拦截', () => {
    const log = attackLog(4, 'check').map(([side, nature]) => ({ side, nature }));
    expect(blocksVaryStep(log, 'r', 'check', ['idle'], true)).toBe(true);
    expect(blocksVaryStep(log, 'r', 'check', ['check', 'idle', 'chase'], true)).toBe(true);
  });

  it('blocksVaryStep：第 5 步但除长将 / 长捉外无棋可走 → 放行', () => {
    const log = attackLog(4, 'chase').map(([side, nature]) => ({ side, nature }));
    expect(blocksVaryStep(log, 'r', 'chase', [], true)).toBe(false); // 没有任何其它合法着法
    expect(blocksVaryStep(log, 'r', 'chase', ['check', 'chase'], true)).toBe(false); // 其它着法也都是第 5 步
  });

  it('blocksVaryStep：第 4 步不受影响', () => {
    const log = attackLog(3, 'check').map(([side, nature]) => ({ side, nature }));
    expect(blocksVaryStep(log, 'r', 'check', ['idle'], true)).toBe(false);
  });

  it('blocksVaryStep：局面并未重复（正常进攻的连续将军 / 捉子）→ 不拦截', () => {
    const log = attackLog(4, 'check').map(([side, nature]) => ({ side, nature }));
    expect(blocksVaryStep(log, 'r', 'check', ['idle'], false)).toBe(false);
  });

  it('同一局面不足 3 次重复时不提示', () => {
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
  });

  it('双方都是长打 → 提示「请变招」', () => {
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

  it('双方都不是长打（重复局面）→ 提示「请变招」', () => {
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

  it('一方单方长打但未被拦截（第 4 步三次重复）→ 不提示、不判负', () => {
    const h = hist(
      ['a', 'x', 'a', 'x', 'a'],
      [
        ['r', 'check'],
        ['b', 'idle'],
        ['r', 'check'],
        ['b', 'idle'],
      ],
    );
    expect(judgeRepetition(h)).toBeNull();
  });

  it('只看最后一次重复循环（更早的循环不影响当前提示）', () => {
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

describe('长将 / 长捉拦截（对局状态机集成）', () => {
  /** 长将循环：红车在 4 / 5 路来回将军，黑将左右躲闪 */
  const CHECK_BOARD = (): Board => {
    const b = empty();
    b[0][4] = { t: 'K', s: 'b' };
    b[9][3] = { t: 'K', s: 'r' };
    b[6][4] = { t: 'R', s: 'r' };
    return b;
  };
  const CHECK_SEQ: Array<[Pos, Pos, Side]> = [
    [[6, 4], [5, 4], 'r'], // 1 将军（第 1 步）
    [[0, 4], [0, 5], 'b'], // 2 将躲
    [[5, 4], [5, 5], 'r'], // 3 将军（第 2 步）
    [[0, 5], [0, 4], 'b'], // 4 将回
    [[5, 5], [5, 4], 'r'], // 5 将军（第 3 步）→ 局面第 2 次
    [[0, 4], [0, 5], 'b'], // 6
    [[5, 4], [5, 5], 'r'], // 7 将军（第 4 步）
    [[0, 5], [0, 4], 'b'], // 8 回到开局局面（第 3 次）：不判负、不提示
    [[5, 5], [5, 4], 'r'], // 9 将军（第 5 步）：禁走 + 弹层「请变招」
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
    [[4, 7], [2, 7], 'r'], // 1 捉马（第 1 步）
    [[2, 1], [4, 2], 'b'], // 2 马逃
    [[2, 7], [4, 7], 'r'], // 3 再捉（第 2 步）
    [[4, 2], [2, 1], 'b'], // 4 马回 → 回到开局局面（第 2 次）
    [[4, 7], [2, 7], 'r'], // 5 捉马（第 3 步）
    [[2, 1], [4, 2], 'b'], // 6
    [[2, 7], [4, 7], 'r'], // 7 再捉（第 4 步）
    [[4, 2], [2, 1], 'b'], // 8 → 开局局面第 3 次：不判负、不提示
    [[4, 7], [2, 7], 'r'], // 9 捉马（第 5 步）：禁走 + 弹层「请变招」
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
    [[0, 8], [0, 7], 'b'], // → 开局局面第 3 次：提示「请变招」（不判和）
  ];

  /** 依次走完给定着法 */
  const play = (g: Game, seq: Array<[Pos, Pos, Side]>, upto = seq.length): void => {
    for (const [from, to, side] of seq.slice(0, upto)) {
      expect(g.applyMove(from, to, side).ok, `第 ${from}→${to} 手应当合法`).toBe(true);
    }
  };

  it('长将：第 4 步正常走，第 5 步被禁（code = vary）且不判负', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 8); // 红方第 4 次将军 + 三次重复
    expect(g.status).toBe('playing');
    expect(g.reason).toBe('');
    expect(g.repetitionHint).toBe(false); // 第 4 步：不提示、不判负
    expect(g.moveSeq).toBe(8);

    const banned = g.applyMove([5, 5], [5, 4], 'r'); // 第 5 次将军
    expect(banned.ok).toBe(false);
    expect(banned.code).toBe('vary'); // 渲染层据此用弹层提示「请变招」
    // 这一手没有落子：局面 / 手数 / 行棋方都不变，对局继续
    expect(g.moveSeq).toBe(8);
    expect(g.turn).toBe('r');
    expect(g.history.length).toBe(8);
    expect(g.status).toBe('playing');
    expect(g.winner).toBeNull();
    expect(g.reason).toBe('');
    // 仍然可以直接走其它合法着法
    expect(g.applyMove([5, 5], [4, 5], 'r').ok).toBe(true);
    expect(g.moveSeq).toBe(9);
  });

  it('长捉：第 4 步正常走，第 5 步被禁（code = vary）且不判负', () => {
    const g = new Game();
    g.setup(CHASE_BOARD(), 'r');
    play(g, CHASE_SEQ, 8); // 红方第 4 次捉子 + 三次重复
    expect(g.status).toBe('playing');
    expect(g.repetitionHint).toBe(false);

    const banned = g.applyMove([4, 7], [2, 7], 'r'); // 第 5 次捉子
    expect(banned.ok).toBe(false);
    expect(banned.code).toBe('vary');
    expect(g.moveSeq).toBe(8);
    expect(g.status).toBe('playing');
    expect(g.winner).toBeNull();
    expect(g.applyMove([4, 7], [3, 7], 'r').ok).toBe(true); // 改走别的着法
  });

  it('AI 用 pickVarySafeMove：被拦截时改走其它合法着法', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 8);
    const preferred: Move = { from: [5, 5], to: [5, 4] }; // 第 5 步将军
    expect(g.isVaryBlocked(preferred.from, preferred.to, 'r')).toBe(true);
    const safe = g.pickVarySafeMove('r', preferred);
    expect(safe).not.toEqual(preferred);
    expect(g.applyMove(safe.from, safe.to, 'r').ok).toBe(true);
    expect(g.status).toBe('playing');
  });

  it('双方长闲三次重复 → 提示「请变招」（不判和、继续对局）', () => {
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
    play(g, IDLE_SEQ); // 第 8 手构成第 3 次重复 → 提示「请变招」
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

  it('悔棋会一并回退重复局面计数：第 4 步仍可走，到第 5 步才拦截', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 6); // 红方第 4 步之前
    const fourth = CHECK_SEQ[6]; // 第 7 手：第 4 次将军
    expect(g.applyMove(fourth[0], fourth[1], 'r').ok).toBe(true);
    expect(g.undo()).toBe(true); // 回退第 4 步
    expect(g.applyMove(fourth[0], fourth[1], 'r').ok).toBe(true); // 重放仍允许
    expect(g.status).toBe('playing');
    expect(g.repetitionHint).toBe(false);
    expect(g.moveSeq).toBe(7);
  });

  it('reset / setup 清空重复局面历史，重新开局不会沿用旧计数', () => {
    const g = new Game();
    g.setup(CHECK_BOARD(), 'r');
    play(g, CHECK_SEQ, 8);
    expect(g.status).toBe('playing');
    expect(g.repetitionHint).toBe(false);

    g.setup(CHECK_BOARD(), 'r'); // 重新载入同一局面
    play(g, CHECK_SEQ, 8);
    expect(g.status).toBe('playing');
    expect(g.repetitionHint).toBe(false);
    expect(g.moveSeq).toBe(8);
  });

  it('正常进攻的连续将军（局面不重复）不被误拦截：完整将死线全部可走', () => {
    const g = new Game();
    g.reset('playing');
    for (let i = 0; i < MATE_LINE.length; i++) {
      const side: Side = i % 2 === 0 ? 'r' : 'b';
      expect(g.applyMove(MATE_LINE[i].from, MATE_LINE[i].to, side).ok).toBe(true);
    }
    expect(g.status).toBe('over');
    expect(g.reason).toBe('将死');
  });

  it('普通开局走子不受影响（不误判重复局面、不误拦截）', () => {
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
    expect(g.repetitionHint).toBe(false);
  });
});
