/**
 * AI 引擎端口：服务端与渲染层共用的「取一步着法」抽象。
 *
 * - 首选皮卡鱼（Pikafish）UCI 原生引擎（Node 侧实现见 `src/server/pikafish.ts`）；
 * - 引擎不可用 / 出错时回退纯 TS 的 negamax（`src/shared/ai.ts` `pickMove`），
 *   保证离线（`file://` 页面）、非 Windows、引擎缺失时仍可对弈。
 *
 * 难度沿用既有外部契约 `depth 1..4`（1 入门 / 2 菜鸟 / 3 中级 / 4 高手），
 * 由具体引擎自行映射到自身强度参数（皮卡鱼映射 Skill Level + 思考时限）。
 */

import { pickMove } from './ai.js';
import { Board, Move, Side } from './types.js';

/** 难度档位（1 入门 / 2 菜鸟 / 3 中级 / 4 高手） */
export type EngineLevel = 1 | 2 | 3 | 4;

/** 引擎返回：推荐着法 + 来源（供日志与前端诊断，便于确认是否走了回退） */
export interface EngineResult {
  /** 无合法着法时为 null */
  move: Move | null;
  source: 'pikafish' | 'ts';
}

/** AI 引擎端口 */
export interface EnginePort {
  /** 为 `board` 上要走子的 `side` 选一步合法着法 */
  bestMove(board: Board, side: Side, level: EngineLevel): Promise<EngineResult>;
  /** 释放资源（可选） */
  dispose?(): void;
}

/** 纯 TS 回退引擎：同步搜索包成 Promise（服务于无引擎环境） */
export class LocalEngine implements EnginePort {
  async bestMove(board: Board, side: Side, level: EngineLevel): Promise<EngineResult> {
    const timeLimitMs = level >= 4 ? 900 : 1200;
    const move = pickMove(board, side, { depth: level, timeLimitMs });
    return { move, source: 'ts' };
  }
}

/** 归一化外部传入的难度：缺省 2，非法值钳到 1..4 */
export function normalizeLevel(x: unknown): EngineLevel {
  const raw = typeof x === 'string' ? x.trim() : x;
  if (raw === '' || raw === null || raw === undefined) return 2;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  const f = Math.floor(n);
  if (f <= 1) return 1;
  if (f >= 4) return 4;
  return f as EngineLevel;
}
