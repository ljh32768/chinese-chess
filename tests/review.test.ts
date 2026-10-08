/**
 * 对局回顾工具函数测试（复盘局面还原、时间/结果/列表文案）。
 * review.ts 的 DOM 部分由 app 装配，这里只测纯函数。
 */

import { describe, expect, it } from 'vitest';
import {
  formatTime,
  historyUrl,
  recordLine,
  replayBoard,
  resultText,
  sideAt,
} from '../src/renderer/review.js';
import { GameRecordSummary, Move, PlayerRef } from '../src/shared/types.js';

/** 三步着法：红车进一、黑卒进一、红炮平中 */
const MOVES: Move[] = [
  { from: [9, 0], to: [8, 0] },
  { from: [3, 0], to: [4, 0] },
  { from: [7, 1], to: [7, 4] },
];

const player = (name: string, kind: PlayerRef['kind'] = 'account'): PlayerRef => ({
  id: `${kind}:${name}`,
  name,
  kind,
});

const summary = (over: Partial<GameRecordSummary> = {}): GameRecordSummary => ({
  id: '1',
  roomId: '123456',
  startedAt: new Date(2026, 9, 6, 14, 32).getTime(),
  endedAt: new Date(2026, 9, 6, 14, 40).getTime(),
  red: player('alice'),
  black: player('bob'),
  firstMode: 'guess',
  guess: { choice: 'odd', actual: 'even', guestWon: false },
  winner: 'b',
  reason: '认输',
  moveCount: MOVES.length,
  ...over,
});

describe('复盘局面还原 replayBoard', () => {
  it('第 0 步为开局局面', () => {
    const b = replayBoard(MOVES, 0);
    expect(b[9][0]).toEqual({ t: 'R', s: 'r' });
    expect(b[8][0]).toBeNull();
  });

  it('按步数逐步还原（含吃子与空位）', () => {
    const b = replayBoard(MOVES, 1);
    expect(b[9][0]).toBeNull();
    expect(b[8][0]).toEqual({ t: 'R', s: 'r' });

    const b3 = replayBoard(MOVES, MOVES.length);
    expect(b3[7][1]).toBeNull();
    expect(b3[7][4]).toEqual({ t: 'C', s: 'r' });
    expect(b3[4][0]).toEqual({ t: 'P', s: 'b' });
  });

  it('越界步数自动收敛到 0 与总步数', () => {
    expect(replayBoard(MOVES, -5)[9][0]).toEqual({ t: 'R', s: 'r' });
    expect(replayBoard(MOVES, 99)[7][4]).toEqual({ t: 'C', s: 'r' });
  });

  it('行棋方按红先交替：偶数步红方、奇数步黑方', () => {
    expect(sideAt(0)).toBe('r');
    expect(sideAt(1)).toBe('b');
    expect(sideAt(2)).toBe('r');
  });
});

describe('回顾列表文案', () => {
  it('时间格式为 MM-DD HH:mm', () => {
    expect(formatTime(new Date(2026, 9, 6, 14, 32).getTime())).toBe('10-06 14:32');
    expect(formatTime(new Date(2026, 0, 9, 5, 7).getTime())).toBe('01-09 05:07');
  });

  it('结果文案区分红胜 / 黑胜 / 和棋与结束原因', () => {
    expect(resultText({ winner: 'r', reason: '将死' })).toBe('红胜（将死）');
    expect(resultText({ winner: 'b', reason: '超时判负' })).toBe('黑胜（超时判负）');
    expect(resultText({ winner: null, reason: '同意和棋' })).toBe('和棋（同意和棋）');
  });

  it('列表行：红黑方（玩家名） / 取先方式 / 时间 / 胜负', () => {
    const line = recordLine(summary());
    expect(line.vs).toBe('alice（红） vs bob（黑）');
    expect(line.first).toBe('猜先');
    expect(line.time).toBe('10-06 14:32');
    expect(line.result).toBe('黑胜（认输）');
  });

  it('取先方式文案覆盖四种方式，AI 与游客名称原样展示', () => {
    expect(recordLine(summary({ firstMode: 'r' })).first).toBe('房主执红');
    expect(recordLine(summary({ firstMode: 'b' })).first).toBe('房主执黑');
    expect(recordLine(summary({ firstMode: 'random' })).first).toBe('随机黑红');
    expect(recordLine(summary({ red: player('游客AB12', 'guest'), black: player('AI', 'ai') })).vs).toBe(
      '游客AB12（红） vs AI（黑）',
    );
  });
});

describe('对局列表请求路径 historyUrl（全部对局 / 我的历史）', () => {
  it('「全部对局」恒为 /api/history', () => {
    expect(historyUrl('all', 'account:bob')).toBe('/api/history');
    expect(historyUrl('all', '')).toBe('/api/history');
  });

  it('「我的历史」带 user 参数并做 URL 编码（账号 / 游客 id 含冒号）', () => {
    expect(historyUrl('mine', 'account:bob')).toBe('/api/history?user=account%3Abob');
    expect(historyUrl('mine', 'guest:ab12cd34')).toBe('/api/history?user=guest%3Aab12cd34');
  });

  it('未识别身份时退回全部（由界面给出提示）', () => {
    expect(historyUrl('mine', '')).toBe('/api/history');
  });
});
