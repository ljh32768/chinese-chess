import { describe, expect, it } from 'vitest';
import { Game } from '../src/shared/game.js';
import { initBoard } from '../src/shared/rules.js';

describe('Game 状态机', () => {
  it('reset 后进入进行中状态，红方先行', () => {
    const g = new Game();
    g.reset('playing');
    expect(g.status).toBe('playing');
    expect(g.turn).toBe('r');
    expect(g.moveSeq).toBe(0);
    expect(g.board).toEqual(initBoard());
  });

  it('合法走子会切换回合并累加 seq', () => {
    const g = new Game();
    g.reset('playing');
    const r = g.applyMove([6, 0], [5, 0], 'r');
    expect(r.ok).toBe(true);
    expect(g.turn).toBe('b');
    expect(g.moveSeq).toBe(1);
    expect(g.lastMove).toEqual({ from: [6, 0], to: [5, 0] });
    expect(g.board[5][0]).toEqual({ t: 'P', s: 'r' });
  });

  it('非本方回合走子会被拒绝', () => {
    const g = new Game();
    g.reset('playing');
    const r = g.applyMove([3, 0], [4, 0], 'b');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('还没轮到你走棋');
    expect(g.moveSeq).toBe(0);
  });

  it('非法走子会被拒绝且棋盘不变', () => {
    const g = new Game();
    g.reset('playing');
    const before = JSON.stringify(g.board);
    const r = g.applyMove([6, 0], [4, 0], 'r'); // 兵一次走两格
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('不符合走法或会送将');
    expect(JSON.stringify(g.board)).toBe(before);
  });

  it('吃子后棋盘更新', () => {
    const g = new Game();
    g.reset('playing');
    // 红车在 (5,0) 沿纵线吃掉 (3,0) 的黑卒
    g.board[5][0] = { t: 'R', s: 'r' };
    const r = g.applyMove([5, 0], [3, 0], 'r');
    expect(r.ok).toBe(true);
    expect(g.board[3][0]).toEqual({ t: 'R', s: 'r' });
    expect(g.board[5][0]).toBeNull();
    expect(g.moveSeq).toBe(1);
  });

  it('标准对局吃子记录 capturedByRed/Black 并随快照下发、悔棋回退', () => {
    const g = new Game();
    g.reset('playing');
    // 红车从 (5,0) 沿纵线吃掉 (3,0) 的黑卒
    g.board[5][0] = { t: 'R', s: 'r' };
    expect(g.applyMove([5, 0], [3, 0], 'r').ok).toBe(true);
    expect(g.capturedByRed).toEqual(['P']);
    expect(g.capturedByBlack).toEqual([]);
    const snap = g.snapshot();
    expect(snap.capturedByRed).toEqual(['P']);
    expect(snap.capturedByBlack).toEqual([]);

    // 黑车从 (0,0) 沿同一列吃掉停在 (3,0) 的红车
    expect(g.applyMove([0, 0], [3, 0], 'b').ok).toBe(true);
    expect(g.capturedByBlack).toEqual(['R']);
    expect(g.snapshot().capturedByBlack).toEqual(['R']);

    // 悔棋同步回退吃子记录
    expect(g.undo()).toBe(true);
    expect(g.capturedByBlack).toEqual([]);
    expect(g.undo()).toBe(true);
    expect(g.capturedByRed).toEqual([]);
  });

  it('认输立即结束对局', () => {
    const g = new Game();
    g.reset('playing');
    g.resign('r');
    expect(g.status).toBe('over');
    expect(g.winner).toBe('b');
    expect(g.reason).toBe('认输');
  });

  it('同意和棋判和', () => {
    const g = new Game();
    g.reset('playing');
    g.acceptDraw();
    expect(g.status).toBe('over');
    expect(g.winner).toBeNull();
    expect(g.reason).toBe('同意和棋');
  });

  it('走子致将死时清空待处理的求和 / 重开请求', () => {
    const g = new Game();
    g.reset('playing');
    // 构造「双车错」一步杀：红方 [2,8] → [0,8] 将死黑方
    g.board = Array.from({ length: 10 }, () => Array(9).fill(null));
    g.board[0][4] = { t: 'K', s: 'b' };
    g.board[9][4] = { t: 'K', s: 'r' };
    g.board[1][0] = { t: 'R', s: 'r' };
    g.board[2][8] = { t: 'R', s: 'r' };
    g.board[5][4] = { t: 'P', s: 'r' }; // 挡住将帅照面
    g.pendingDraw = 'b';
    g.pendingRestart = 'r';

    const r = g.applyMove([2, 8], [0, 8], 'r');
    expect(r.ok).toBe(true);
    expect(g.status).toBe('over');
    expect(g.winner).toBe('r');
    expect(g.reason).toBe('将死');
    expect(g.pendingDraw).toBeNull();
    expect(g.pendingRestart).toBeNull();
  });

  it('对局继续时不清理待处理请求', () => {
    const g = new Game();
    g.reset('playing');
    g.pendingDraw = 'b';
    expect(g.applyMove([6, 0], [5, 0], 'r').ok).toBe(true);
    expect(g.pendingDraw).toBe('b');
  });

  it('悔棋回退一步并恢复之前局面与回合', () => {
    const g = new Game();
    g.reset('playing');
    g.applyMove([6, 0], [5, 0], 'r');
    g.applyMove([3, 0], [4, 0], 'b');
    expect(g.history).toHaveLength(2);
    expect(g.moveSeq).toBe(2);

    expect(g.undo()).toBe(true);
    expect(g.moveSeq).toBe(1);
    expect(g.turn).toBe('b');
    expect(g.history).toHaveLength(1);
    expect(g.board[3][0]).toEqual({ t: 'P', s: 'b' }); // 黑卒回到原位
    expect(g.board[4][0]).toBeNull();

    expect(g.undo()).toBe(true);
    expect(g.moveSeq).toBe(0);
    expect(g.turn).toBe('r');
    expect(g.history).toHaveLength(0);
    expect(g.board).toEqual(initBoard());

    expect(g.undo()).toBe(false); // 没有可悔的棋
  });

  it('未开局 / 已终局时不能悔棋', () => {
    const idle = new Game();
    expect(idle.undo()).toBe(false);

    const g = new Game();
    g.reset('playing');
    g.applyMove([6, 0], [5, 0], 'r');
    g.resign('r');
    expect(g.undo()).toBe(false);
  });

  it('snapshot 包含完整着法序列', () => {
    const g = new Game();
    g.reset('playing');
    g.applyMove([6, 0], [5, 0], 'r');
    expect(g.snapshot().history).toEqual([{ from: [6, 0], to: [5, 0] }]);
  });

  it('未开始时拒绝走子', () => {
    const g = new Game();
    const r = g.applyMove([6, 0], [5, 0], 'r');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('对局未在进行中');
  });

  it('setup 载入自定义残局局面并保持元信息干净', () => {
    const g = new Game();
    g.reset('playing');
    g.applyMove([6, 0], [5, 0], 'r');
    g.pendingDraw = 'b';

    const board = Array.from({ length: 10 }, () => Array(9).fill(null));
    board[0][4] = { t: 'K', s: 'b' };
    board[9][3] = { t: 'K', s: 'r' };
    board[8][0] = { t: 'R', s: 'r' };
    g.setup(board, 'r');

    expect(g.status).toBe('playing');
    expect(g.turn).toBe('r');
    expect(g.moveSeq).toBe(0);
    expect(g.history).toEqual([]);
    expect(g.lastMove).toBeNull();
    expect(g.check).toBe(false);
    expect(g.pendingDraw).toBeNull();
    expect(g.board).toEqual(board);
    // 与传入棋盘解耦：后续走子不影响外部棋盘
    expect(g.applyMove([8, 0], [8, 4], 'r').ok).toBe(true);
    expect(board[8][4]).toBeNull();
  });

  it('setup 载入的局面走子后照常判定终局', () => {
    const g = new Game();
    // 残局局面：红车 [1,0] / [2,8] 对黑将，红方一步将死（车到 [0,8]）
    const board = Array.from({ length: 10 }, () => Array(9).fill(null));
    board[0][4] = { t: 'K', s: 'b' };
    board[9][3] = { t: 'K', s: 'r' };
    board[1][0] = { t: 'R', s: 'r' };
    board[2][8] = { t: 'R', s: 'r' };
    g.setup(board, 'r');
    const r = g.applyMove([2, 8], [0, 8], 'r');
    expect(r.ok).toBe(true);
    expect(g.status).toBe('over');
    expect(g.winner).toBe('r');
    expect(g.reason).toBe('将死');
  });

  it('setup 会标记行棋方被将军的局面', () => {
    const g = new Game();
    const board = Array.from({ length: 10 }, () => Array(9).fill(null));
    board[0][4] = { t: 'K', s: 'b' };
    board[9][3] = { t: 'K', s: 'r' };
    board[5][4] = { t: 'R', s: 'r' };
    g.setup(board, 'b');
    expect(g.check).toBe(true);
    expect(g.turn).toBe('b');
  });

  it('snapshot 反映当前状态', () => {
    const g = new Game();
    g.reset('playing');
    g.applyMove([6, 0], [5, 0], 'r');
    const s = g.snapshot();
    expect(s.turn).toBe('b');
    expect(s.moveSeq).toBe(1);
    expect(s.status).toBe('playing');
    expect(s.lastMove).toEqual({ from: [6, 0], to: [5, 0] });
  });
});
