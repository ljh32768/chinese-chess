import { describe, expect, it } from 'vitest';
import {
  cloneBoard,
  findKing,
  initBoard,
  isAttacked,
  isInCheck,
  judgeAfterMove,
  legalMoves,
  makeMove,
  pieceMoves,
  sideHasAnyMove,
  validateMove,
} from '../src/shared/rules.js';
import { Board, PieceType, Side } from '../src/shared/types.js';

/** 构造一个只含指定棋子的空棋盘 */
function makeBoard(pieces: Array<[number, number, PieceType, Side]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, t, s] of pieces) b[r][c] = { t, s };
  return b;
}

/** 把 Pos[] 转成 "r,c" 集合，便于断言 */
const keys = (moves: Array<[number, number]>): string[] => moves.map(([r, c]) => `${r},${c}`).sort();

describe('开局棋盘', () => {
  it('共 32 枚棋子，红黑各 16', () => {
    const b = initBoard();
    const flat = b.flat().filter(Boolean);
    expect(flat).toHaveLength(32);
    expect(flat.filter((p) => p!.s === 'r')).toHaveLength(16);
    expect(flat.filter((p) => p!.s === 'b')).toHaveLength(16);
  });

  it('将帅与九宫位置正确', () => {
    const b = initBoard();
    expect(findKing(b, 'r')).toEqual([9, 4]);
    expect(findKing(b, 'b')).toEqual([0, 4]);
    expect(b[9][3]).toEqual({ t: 'A', s: 'r' });
    expect(b[0][5]).toEqual({ t: 'A', s: 'b' });
    expect(b[7][1]).toEqual({ t: 'C', s: 'r' });
    expect(b[2][7]).toEqual({ t: 'C', s: 'b' });
    expect(b[6][0]).toEqual({ t: 'P', s: 'r' });
    expect(b[3][8]).toEqual({ t: 'P', s: 'b' });
  });
});

describe('单车走法', () => {
  it('空旷棋盘上可走 17 格', () => {
    const b = makeBoard([[4, 4, 'R', 'r']]);
    expect(pieceMoves(b, 4, 4)).toHaveLength(17);
  });

  it('遇到己方棋子被挡住，不能吃', () => {
    const b = makeBoard([
      [4, 4, 'R', 'r'],
      [4, 6, 'P', 'r'],
      [2, 4, 'P', 'r'],
    ]);
    const k = keys(pieceMoves(b, 4, 4));
    expect(k).toContain('4,5');
    expect(k).not.toContain('4,6'); // 己方子
    expect(k).not.toContain('4,7'); // 被挡住
    expect(k).toContain('3,4');
    expect(k).not.toContain('2,4'); // 己方子
    expect(k).not.toContain('1,4'); // 被挡住
  });

  it('可以吃对方棋子', () => {
    const b = makeBoard([
      [4, 4, 'R', 'r'],
      [4, 6, 'P', 'b'],
    ]);
    expect(keys(pieceMoves(b, 4, 4))).toContain('4,6');
  });
});

describe('马走法', () => {
  it('空旷处 8 个落点', () => {
    const b = makeBoard([[4, 4, 'N', 'r']]);
    expect(pieceMoves(b, 4, 4)).toHaveLength(8);
  });

  it('蹩马腿：被挡住的两个方向不能走', () => {
    const b = makeBoard([
      [4, 4, 'N', 'r'],
      [3, 4, 'P', 'r'],
    ]);
    const k = keys(pieceMoves(b, 4, 4));
    expect(k).not.toContain('2,3');
    expect(k).not.toContain('2,5');
    expect(k).toContain('6,3');
    expect(k).toHaveLength(6);
  });
});

describe('炮走法', () => {
  it('无炮架时按直线走，不能吃子', () => {
    const b = makeBoard([
      [4, 4, 'C', 'r'],
      [4, 6, 'P', 'b'],
    ]);
    const k = keys(pieceMoves(b, 4, 4));
    expect(k).toContain('4,5');
    expect(k).not.toContain('4,6'); // 没有炮架不能吃
    expect(k).not.toContain('4,7');
  });

  it('隔一个炮架可以吃子，且只能吃第一个', () => {
    const b = makeBoard([
      [4, 4, 'C', 'r'],
      [4, 6, 'P', 'r'],
      [4, 8, 'R', 'b'],
    ]);
    const k = keys(pieceMoves(b, 4, 4));
    expect(k).toContain('4,8');
    expect(k).toContain('4,5');
    expect(k).not.toContain('4,6');
    expect(k).not.toContain('4,7');
  });
});

describe('象走法', () => {
  it('走田字且不过河', () => {
    const b = makeBoard([[5, 2, 'B', 'r']]);
    const k = keys(pieceMoves(b, 5, 2));
    expect(k).toEqual(
      keys([
        [7, 0],
        [7, 4],
      ]),
    ); // 向前的两点会过河，被排除
  });

  it('塞象眼不能走', () => {
    const b = makeBoard([
      [9, 2, 'B', 'r'],
      [8, 3, 'P', 'b'],
    ]);
    const k = keys(pieceMoves(b, 9, 2));
    expect(k).not.toContain('7,4');
    expect(k).toContain('7,0');
  });
});

describe('士与将走法', () => {
  it('士只能在九宫内斜走一格', () => {
    const b = makeBoard([[8, 4, 'A', 'r']]);
    expect(keys(pieceMoves(b, 8, 4))).toEqual(
      keys([
        [7, 3],
        [7, 5],
        [9, 3],
        [9, 5],
      ]),
    );
  });

  it('将只能在九宫内直走一格', () => {
    const b = makeBoard([[9, 4, 'K', 'r']]);
    expect(keys(pieceMoves(b, 9, 4))).toEqual(
      keys([
        [8, 4],
        [9, 3],
        [9, 5],
      ]),
    );
  });

  it('将不能走出九宫', () => {
    const b = makeBoard([[1, 3, 'K', 'b']]);
    expect(keys(pieceMoves(b, 1, 3))).toEqual(
      keys([
        [0, 3],
        [2, 3],
        [1, 4],
      ]),
    );
  });
});

describe('兵/卒走法', () => {
  it('未过河只能直走一格', () => {
    const b = makeBoard([[6, 4, 'P', 'r']]);
    expect(keys(pieceMoves(b, 6, 4))).toEqual(['5,4']);
  });

  it('过河后可以横走', () => {
    const b = makeBoard([[4, 4, 'P', 'r']]);
    expect(keys(pieceMoves(b, 4, 4))).toEqual(
      keys([
        [3, 4],
        [4, 3],
        [4, 5],
      ]),
    );
  });

  it('卒过河后同样可以横走，且前进方向相反', () => {
    const b = makeBoard([[5, 4, 'P', 'b']]);
    expect(keys(pieceMoves(b, 5, 4))).toEqual(
      keys([
        [6, 4],
        [5, 3],
        [5, 5],
      ]),
    );
  });
});

describe('将军与将帅照面', () => {
  it('车沿直线攻击将', () => {
    const b = makeBoard([
      [0, 4, 'K', 'b'],
      [9, 3, 'K', 'r'],
      [0, 0, 'R', 'r'],
    ]);
    expect(isAttacked(b, 0, 4, 'r')).toBe(true);
  });

  it('将帅照面视为被将军', () => {
    const b = makeBoard([
      [0, 4, 'K', 'b'],
      [9, 4, 'K', 'r'],
    ]);
    expect(isInCheck(b, 'r')).toBe(true);
    expect(isInCheck(b, 'b')).toBe(true);
  });

  it('中间有子则不照面', () => {
    const b = makeBoard([
      [0, 4, 'K', 'b'],
      [5, 4, 'P', 'r'],
      [9, 4, 'K', 'r'],
    ]);
    expect(isInCheck(b, 'r')).toBe(false);
    expect(isInCheck(b, 'b')).toBe(false);
  });

  it('走子不能造成将帅照面', () => {
    // 红车挡在两将之间：沿同列移动仍然挡住（合法），横走则会照面（非法）
    const b = makeBoard([
      [0, 4, 'K', 'b'],
      [5, 4, 'R', 'r'],
      [9, 4, 'K', 'r'],
    ]);
    const k = keys(legalMoves(b, 5, 4));
    expect(k).not.toContain('5,3');
    expect(k).not.toContain('5,5');
    expect(k).toContain('4,4');
    expect(k).toContain('6,4');
  });
});

describe('不能送将', () => {
  it('走子后自己被将军的着法被过滤', () => {
    const b = makeBoard([
      [0, 3, 'K', 'b'],
      [0, 4, 'R', 'b'],
      [8, 4, 'R', 'r'],
      [9, 4, 'K', 'r'],
    ]);
    const k = keys(legalMoves(b, 8, 4));
    expect(k).not.toContain('8,3'); // 移开后会暴露己方将
    expect(k).not.toContain('8,5');
    expect(k).toContain('7,4'); // 沿同列移动仍然挡着，合法
    expect(k).toContain('0,4'); // 吃掉将军的车，合法
  });
});

describe('胜负判定', () => {
  it('将死判负', () => {
    const b = makeBoard([
      [0, 4, 'K', 'b'],
      [0, 8, 'R', 'r'],
      [1, 0, 'R', 'r'],
      [9, 3, 'K', 'r'],
    ]);
    expect(isInCheck(b, 'b')).toBe(true);
    expect(sideHasAnyMove(b, 'b')).toBe(false);
    expect(judgeAfterMove(b, 'b')).toEqual({ winner: 'r', reason: '将死' });
  });

  it('困毙判负', () => {
    // 黑方只剩将，未被将军但无路可走
    const b = makeBoard([
      [0, 4, 'K', 'b'],
      [1, 0, 'R', 'r'],
      [2, 3, 'R', 'r'],
      [2, 5, 'R', 'r'],
      [9, 3, 'K', 'r'],
    ]);
    expect(isInCheck(b, 'b')).toBe(false);
    expect(sideHasAnyMove(b, 'b')).toBe(false);
    expect(judgeAfterMove(b, 'b')).toEqual({ winner: 'r', reason: '困毙' });
  });

  it('仍有合法着法时对局继续', () => {
    const b = initBoard();
    expect(judgeAfterMove(b, 'r')).toBeNull();
    expect(judgeAfterMove(b, 'b')).toBeNull();
  });
});

describe('validateMove', () => {
  it('正常走子合法', () => {
    const b = initBoard();
    expect(validateMove(b, [6, 0], [5, 0], 'r')).toBeNull();
  });

  it('不能走对方的棋子', () => {
    const b = initBoard();
    expect(validateMove(b, [6, 0], [5, 0], 'b')).toBe('这不是你的棋子');
  });

  it('不能吃己方棋子', () => {
    const b = initBoard();
    expect(validateMove(b, [9, 0], [9, 1], 'r')).toBe('不能吃自己的棋子');
  });

  it('不存在的棋子会报错', () => {
    const b = initBoard();
    expect(validateMove(b, [5, 4], [4, 4], 'r')).toBe('起点没有棋子');
  });

  it('不符合走法会被拒绝', () => {
    const b = initBoard();
    expect(validateMove(b, [9, 0], [8, 3], 'r')).toBe('不符合走法或会送将');
  });

  it('越界会被拒绝', () => {
    const b = initBoard();
    expect(validateMove(b, [12, 0], [5, 0], 'r')).toBe('越界');
  });
});

describe('棋盘工具', () => {
  it('cloneBoard 是深拷贝', () => {
    const b = initBoard();
    const nb = cloneBoard(b);
    nb[6][0] = null;
    expect(b[6][0]).not.toBeNull();
  });

  it('makeMove 移动棋子', () => {
    const b = initBoard();
    expect(makeMove(b, [6, 0], [5, 0])).toBe(true);
    expect(b[5][0]).toEqual({ t: 'P', s: 'r' });
    expect(b[6][0]).toBeNull();
  });
});
