import { afterAll, describe, expect, it } from 'vitest';
import { PikafishEngine, findEngine } from '../src/server/pikafish.js';
import { boardAfterMove, initBoard, judgeAfterMove, validateMove } from '../src/shared/rules.js';
import { Board, PieceType, Side } from '../src/shared/types.js';

/** 构造一个只含指定棋子的空棋盘 */
function makeBoard(pieces: Array<[number, number, PieceType, Side]>): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, t, s] of pieces) b[r][c] = { t, s };
  return b;
}

// 真机集成：本机找不到引擎文件时（CI / 其他平台）整组跳过，只保留纯函数单测
const suite = describe.skipIf(!findEngine());

suite('皮卡鱼真机集成（UCI 引擎进程）', () => {
  const engine = new PikafishEngine();

  afterAll(() => engine.dispose());

  it('开局红方：引擎返回规则引擎认可的合法着法', async () => {
    const board = initBoard();
    const result = await engine.bestMove(board, 'r', 2);
    expect(result.source).toBe('pikafish');
    expect(result.move).not.toBeNull();
    expect(validateMove(board, result.move!.from, result.move!.to, 'r')).toBeNull();
  }, 60_000);

  it('一步杀局面：高手档返回将死对方的一步', async () => {
    // 与 tests/ai.test.ts 相同的红方一步杀局面
    const board = makeBoard([
      [9, 4, 'K', 'r'],
      [1, 0, 'R', 'r'],
      [2, 8, 'R', 'r'],
      [5, 4, 'P', 'r'],
      [0, 4, 'K', 'b'],
    ]);
    const result = await engine.bestMove(board, 'r', 4);
    expect(result.move).not.toBeNull();
    const after = boardAfterMove(board, result.move!.from, result.move!.to);
    expect(judgeAfterMove(after, 'b')).toEqual({ winner: 'r', reason: '将死' });
  }, 60_000);

  it('dispose() 后再请求被拒绝（子进程已释放）', async () => {
    const engine2 = new PikafishEngine();
    await engine2.bestMove(initBoard(), 'r', 1);
    engine2.dispose();
    await expect(engine2.bestMove(initBoard(), 'r', 1)).rejects.toThrow();
  }, 60_000);
});
