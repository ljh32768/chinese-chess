/**
 * 对局回顾工具函数测试（复盘局面还原、时间/结果/列表文案）。
 * review.ts 的 DOM 部分由 app 装配，这里只测纯函数。
 */

import { describe, expect, it } from 'vitest';
import {
  encodeLinePrefix,
  formatTime,
  historyUrl,
  lineChunkTarget,
  lineEndsGame,
  mateOf,
  recordLine,
  replayBoard,
  resultText,
  sideAt,
  sideName,
  withMoves,
} from '../src/renderer/review.js';
import { initBoard } from '../src/shared/rules.js';
import { GameRecord, GameRecordSummary, MAX_AI_LINE_PLIES, Move, PlayerRef } from '../src/shared/types.js';
import { MATE_LINE } from './mate-line.js';

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

  it('行棋方名称：红方 / 黑方（推荐与试下面板文案共用）', () => {
    expect(sideName('r')).toBe('红方');
    expect(sideName('b')).toBe('黑方');
  });
});

describe('后续变化 / 试下共用的局面推演 withMoves', () => {
  it('在给定局面上试走前若干手，且不改动传入棋盘', () => {
    const base = replayBoard(MOVES, 1); // 红车已进一
    const made: Move[] = [
      { from: [7, 1], to: [7, 4] }, // 红炮平中
      { from: [3, 0], to: [4, 0] }, // 黑卒进一
    ];
    const b = withMoves(base, made, 2);
    expect(b[7][4]).toEqual({ t: 'C', s: 'r' });
    expect(b[4][0]).toEqual({ t: 'P', s: 'b' });
    // base 不受影响（cloneBoard 后推演）
    expect(base[7][4]).toBeNull();
    expect(base[7][1]).toEqual({ t: 'C', s: 'r' });
  });

  it('plies 越界收敛：负数 / 非有限数视作 0，超过长度则全部走完', () => {
    const base = initBoard();
    expect(withMoves(base, MOVES, -1)).toEqual(base);
    expect(withMoves(base, MOVES, Number.NaN)).toEqual(base);
    expect(withMoves(base, MOVES, 99)[7][4]).toEqual({ t: 'C', s: 'r' });
  });
});

describe('AI 推荐变化：分段计算与终局判定', () => {
  it('每次续算 5 手（5 → 10 → 15 …），到上限后不再增加', () => {
    expect(lineChunkTarget(0)).toBe(5);
    expect(lineChunkTarget(5)).toBe(10);
    expect(lineChunkTarget(10)).toBe(15);
    // 非有限数按 0 处理（避免 NaN 传进请求）
    expect(lineChunkTarget(Number.NaN)).toBe(5);
    // 上限：MAX_AI_LINE_PLIES（30）之后不再增加
    expect(lineChunkTarget(MAX_AI_LINE_PLIES)).toBe(MAX_AI_LINE_PLIES);
    expect(lineChunkTarget(MAX_AI_LINE_PLIES + 5)).toBe(MAX_AI_LINE_PLIES);
  });

  it('变化终点判定：走完已算着法后下一方无着可走（绝杀 / 困毙）即到终点', () => {
    // 完整 37 步将死线：走完后黑方被将死 → 终点
    expect(lineEndsGame(initBoard(), MATE_LINE, 'r')).toBe(true);
    // 少走最后一步（36 手）时红方仍有着可走 → 未到终点
    expect(lineEndsGame(initBoard(), MATE_LINE.slice(0, 36), 'r')).toBe(false);
    // 空变化不算终点
    expect(lineEndsGame(initBoard(), [], 'r')).toBe(false);
  });

  it('已算变化编码为 prefix 查询串（续算时原样回传给服务端）', () => {
    expect(encodeLinePrefix(MOVES)).toBe('9,0,8,0|3,0,4,0|7,1,7,4');
    expect(encodeLinePrefix([])).toBe('');
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

  it('结果文案优先展示识别出的杀法（将死不再只显示「将死」）', () => {
    expect(resultText({ winner: 'r', reason: '将死', killMethod: '马后炮' })).toBe('红胜（马后炮）');
    expect(resultText({ winner: 'b', reason: '将死', killMethod: '双车错' })).toBe('黑胜（双车错）');
    // 无杀法字段（旧记录 / 非将死）时退回结束原因
    expect(resultText({ winner: 'r', reason: '将死' })).toBe('红胜（将死）');
    expect(resultText({ winner: 'b', reason: '认输' })).toBe('黑胜（认输）');
  });

  it('复盘杀法识别：按记录着法还原终局并给出具体杀法', () => {
    const rec: GameRecord = {
      ...summary({ winner: 'r', reason: '将死' }),
      id: 'mate-1',
      moveCount: MATE_LINE.length,
      moves: MATE_LINE,
    };
    const mate = mateOf(rec);
    expect(mate?.pattern.label).toBe('夹车炮');
    expect(mate?.pattern.definition.length).toBeGreaterThan(0);
    // 非「将死」结束（认输 / 和棋）不展示杀法
    expect(mateOf({ ...rec, reason: '认输', winner: 'b' })).toBeNull();
    expect(mateOf({ ...rec, reason: '同意和棋', winner: null })).toBeNull();
  });

  it('困毙：复盘同样给出「困毙」终局条目', () => {
    const rec: GameRecord = {
      ...summary({ winner: 'r', reason: '困毙' }),
      id: 'kunbi-1',
      moveCount: 1,
      moves: [{ from: [2, 5], to: [1, 5] }],
    };
    expect(mateOf(rec)?.pattern.label).toBe('困毙');
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
