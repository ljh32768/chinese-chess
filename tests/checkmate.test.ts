/**
 * 杀法识别测试。
 *
 * 每种经典杀法构造一个终局局面：先验证该局面确实是「将死」（规则引擎判定），
 * 再验证识别出的杀法名，避免「局面本身不是将死却通过了识别」的假阳性。
 */

import { describe, expect, it } from 'vitest';
import {
  CHECKMATE_PATTERNS,
  capturedPieceAt,
  classifyCheckmate,
  classifyCheckmateFromHistory,
} from '../src/shared/checkmate.js';
import { judgeAfterMove, makeMove } from '../src/shared/rules.js';
import { Board, Move, PieceType, Side } from '../src/shared/types.js';

/** 棋子简写：`rK` = 红帅、`bA` = 黑士（s + 大写兵种） */
type Spec = [number, number, string];

/** 由「行, 列, 棋子」列表构造棋盘 */
function boardOf(items: Spec[]): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, spec] of items) {
    b[r][c] = { t: spec[1] as PieceType, s: spec[0] as Side };
  }
  return b;
}

/** 断言该局面确为将死，并识别为指定杀法 */
function expectMate(items: Spec[], mated: Side, id: string): void {
  const board = boardOf(items);
  const judge = judgeAfterMove(board, mated);
  expect(judge?.reason, `局面应被判定为将死（实际 ${JSON.stringify(judge)}）`).toBe('将死');
  const info = classifyCheckmate(board, mated);
  expect(info.pattern.id, `识别结果：${info.pattern.name}`).toBe(id);
  expect(info.recognized).toBe(true);
}

describe('杀法识别：每种杀法一个终局局面', () => {
  it('马后炮：炮借己方马为炮架将军（马前炮后）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [9, 4, 'rK'],
        [2, 4, 'rN'],
        [4, 4, 'rC'],
      ],
      'b',
      'mahoupao',
    );
  });

  it('重炮：双炮同线重叠，后炮借前炮为架', () => {
    expectMate(
      [
        [0, 3, 'bK'],
        [0, 4, 'bN'],
        [9, 4, 'rK'],
        [2, 3, 'rC'],
        [3, 3, 'rC'],
        [3, 4, 'rN'],
      ],
      'b',
      'chongpao',
    );
  });

  it('大刀剜心：车吃去对方宫心士成杀（最后一步吃士）', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [1, 4, 'bA'],
      [0, 3, 'bN'],
      [9, 4, 'rK'],
      [1, 0, 'rR'],
      [1, 5, 'rP'],
    ]);
    // 车（1,0）→（1,4）吃宫心士后成杀
    makeMove(board, [1, 0], [1, 4]);
    expect(judgeAfterMove(board, 'b')?.reason).toBe('将死');
    const info = classifyCheckmate(board, 'b', { lastMove: { from: [1, 0], to: [1, 4] }, captured: 'A' });
    expect(info.pattern.id).toBe('daodao-wanxin');
  });

  it('铁门栓：中炮镇中路，车封住将门', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 4, 'rK'],
        [1, 4, 'rR'],
        [4, 4, 'rC'],
        [2, 2, 'rN'],
      ],
      'b',
      'tiemenshuan',
    );
  });

  it('闷宫：单炮借对方士为炮架，将（帅）被自家士堵死', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [1, 4, 'bA'],
        [9, 4, 'rK'],
        [0, 1, 'rC'],
        [2, 4, 'rN'],
      ],
      'b',
      'mengong',
    );
  });

  it('天地炮：一炮镇中路、一炮沉底，配合车成杀', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [1, 4, 'bA'],
        [9, 4, 'rK'],
        [0, 0, 'rC'],
        [4, 4, 'rC'],
        [0, 8, 'rR'],
      ],
      'b',
      'tiandipao',
    );
  });

  it('夹车炮：双炮重叠作架，车在同侧配合将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [1, 4, 'bA'],
        [9, 4, 'rK'],
        [0, 8, 'rR'],
        [3, 4, 'rC'],
        [4, 4, 'rC'],
      ],
      'b',
      'jiachepao',
    );
  });

  it('双将：两子同时将军（车 + 马）', () => {
    expectMate(
      [
        [1, 4, 'bK'],
        [0, 4, 'bN'],
        [2, 4, 'bN'],
        [9, 3, 'rK'],
        [1, 0, 'rR'],
        [3, 3, 'rN'],
      ],
      'b',
      'shuangjiang',
    );
  });

  it('白脸将：车在将门、借帅力封口（对面笑）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bP'],
        [0, 5, 'bP'],
        [9, 4, 'rK'],
        [1, 4, 'rR'],
      ],
      'b',
      'bailianjiang',
    );
  });

  it('双马饮泉：一马控将、另一马将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 3, 'rK'],
        [1, 2, 'rN'],
        [3, 3, 'rN'],
      ],
      'b',
      'shuangma-yinquan',
    );
  });

  it('卧槽马：马在对方二路三 / 七路交叉点将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 4, 'rK'],
        [1, 2, 'rN'],
        [2, 4, 'rP'],
      ],
      'b',
      'wocaoma',
    );
  });

  it('挂角马：马在对方士角将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 4, 'rK'],
        [2, 3, 'rN'],
        [2, 4, 'rP'],
      ],
      'b',
      'guajiaoma',
    );
  });

  it('钓鱼马：马占三·八 / 七·八位封锁将门，车成杀', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 5, 'bA'],
        [9, 3, 'rK'],
        [0, 0, 'rR'],
        [2, 2, 'rN'],
      ],
      'b',
      'diaoyuma',
    );
  });

  it('侧面虎：马占对方卒（兵）位控将，同侧车成杀', () => {
    expectMate(
      [
        [0, 5, 'bK'],
        [0, 4, 'bN'],
        [9, 4, 'rK'],
        [0, 8, 'rR'],
        [3, 6, 'rN'],
      ],
      'b',
      'cemianhu',
    );
  });

  it('八角马：马封住将（帅）两处以上出路，由车将军成杀', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [9, 3, 'rK'],
        [0, 8, 'rR'],
        [1, 0, 'rR'],
        [2, 4, 'rN'],
      ],
      'b',
      'bajiaoma',
    );
  });

  it('双车错：双车分占两线交错将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [9, 4, 'rK'],
        [1, 0, 'rR'],
        [0, 8, 'rR'],
        [5, 4, 'rP'],
      ],
      'b',
      'shuangchecuo',
    );
  });

  it('海底捞月：车沉底在对方底线发起攻击，己方帅（将）占中', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [9, 4, 'rK'],
        [0, 8, 'rR'],
        [2, 4, 'rP'],
      ],
      'b',
      'haidilaoyue',
    );
  });

  it('闷杀：将（帅）的出路被自家子力堵死', () => {
    expectMate(
      [
        [0, 3, 'bK'],
        [0, 4, 'bN'],
        [1, 3, 'bN'],
        [9, 4, 'rK'],
        [2, 2, 'rN'],
      ],
      'b',
      'mengsha',
    );
  });

  it('未匹配经典杀法时兜底为「将死」，且 recognized 为 false', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [9, 3, 'rK'],
      [0, 8, 'rR'],
      [2, 4, 'rP'],
    ]);
    expect(judgeAfterMove(board, 'b')?.reason).toBe('将死');
    const info = classifyCheckmate(board, 'b');
    expect(info.pattern.id).toBe('generic');
    expect(info.pattern.label).toBe('将死');
    expect(info.recognized).toBe(false);
  });

  it('红方被将死同样可识别（杀法识别不依赖阵营）', () => {
    // 与「马后炮」镜像：黑炮借黑马为架将死红帅
    expectMate(
      [
        [9, 4, 'rK'],
        [0, 4, 'bK'],
        [7, 4, 'bN'],
        [5, 4, 'bC'],
      ],
      'r',
      'mahoupao',
    );
  });
});

describe('杀法库与辅助函数', () => {
  it('杀法库条目 id / 名称唯一，且包含兜底条目', () => {
    const ids = CHECKMATE_PATTERNS.map((p) => p.id);
    const names = CHECKMATE_PATTERNS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(ids).toContain('generic');
    for (const p of CHECKMATE_PATTERNS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.definition.length).toBeGreaterThan(0);
    }
  });

  it('同时成立的杀法记入 alsoMatched（铁门栓同时是双将）', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [0, 5, 'bA'],
      [9, 4, 'rK'],
      [1, 4, 'rR'],
      [4, 4, 'rC'],
    ]);
    const info = classifyCheckmate(board, 'b');
    expect(info.pattern.name).toBe('铁门栓');
    expect(info.alsoMatched).toContain('双将');
    expect(info.alsoMatched).not.toContain('铁门栓');
  });

  it('capturedPieceAt：按着法序列推导最后一步吃子（吃卒 / 无吃子）', () => {
    // 红兵 6,0 → 3,0 连续推进并吃掉黑卒；黑马往返各一步凑成双方交替
    const moves: Move[] = [
      { from: [6, 0], to: [5, 0] },
      { from: [0, 1], to: [2, 0] },
      { from: [5, 0], to: [4, 0] },
      { from: [2, 0], to: [0, 1] },
      { from: [4, 0], to: [3, 0] },
    ];
    expect(capturedPieceAt(moves, 4)).toBe('P');
    expect(capturedPieceAt(moves, 0)).toBeNull();
    expect(capturedPieceAt(moves, 99)).toBeNull();
  });

  it('classifyCheckmateFromHistory：和棋与空着法返回 null', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [9, 4, 'rK'],
    ]);
    expect(classifyCheckmateFromHistory(board, [], 'b')).toBeNull();
    expect(classifyCheckmateFromHistory(board, [{ from: [6, 0], to: [5, 0] }], null)).toBeNull();
  });
});
