/**
 * 残局核验工作线程：在独立线程里跑「强制将死」求解器（默认 50 步上限），
 * 避免在渲染线程里同步求解阻塞界面。编辑器保存时向本线程发出核验请求，
 * 界面显示「核验中…」，求解完成（或超出预算按无杀法处理）后回传结果。
 */
import { CustomCheck, checkCustomEndgame } from '../shared/endgame.js';
import { PieceType, Side } from '../shared/types.js';

/** 核验请求：局面棋子表 + 先手方 + 求解步数上限 */
export interface EndgameCheckRequest {
  pieces: Array<[number, number, PieceType, Side]>;
  side: Side;
  limit: number;
}

/**
 * 工作线程全局对象的最小视图（`DedicatedWorkerGlobalScope` 在 lib.webworker 里，
 * 与项目使用的 DOM lib 互斥，故这里只取用到的两个成员）。
 */
interface WorkerScope {
  onmessage: ((e: MessageEvent<EndgameCheckRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const worker = globalThis as unknown as WorkerScope;

worker.onmessage = (e: MessageEvent<EndgameCheckRequest>): void => {
  const { pieces, side, limit } = e.data;
  let result: CustomCheck;
  try {
    result = checkCustomEndgame(pieces, side, limit);
  } catch {
    // 任何异常都不让线程崩溃：按「未找到杀法」返回
    result = { ok: false, goalMoves: 0, problems: [`无杀法：${limit} 步内无法强制将死对方`] };
  }
  worker.postMessage(result);
};
