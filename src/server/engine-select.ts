/**
 * AI 引擎选择：优先皮卡鱼（Pikafish），不可用时回退纯 TS negamax。
 *
 * `LANSCHESS_ENGINE=off`（或 `PIKAFISH_DISABLE=1`）可强制回退——测试与无引擎环境用。
 */

import { EngineLevel, EnginePort, EngineResult, LocalEngine } from '../shared/engine.js';
import { sideHasAnyMove, validateMove } from '../shared/rules.js';
import { Board, Side } from '../shared/types.js';
import { logInfo } from './log.js';
import { findEngine, PikafishEngine } from './pikafish.js';

/** 主引擎出错 / 着法非法 / 引擎报「无着法」但规则上仍有可走时，回退备用引擎 */
class FallbackEngine implements EnginePort {
  constructor(
    private readonly primary: EnginePort,
    private readonly fallback: EnginePort,
  ) {}

  async bestMove(board: Board, side: Side, level: EngineLevel): Promise<EngineResult> {
    try {
      const r = await this.primary.bestMove(board, side, level);
      if (r.move) {
        // 引擎输出一律经规则引擎复核；非法则视为不可用
        if (validateMove(board, r.move.from, r.move.to, side) === null) return r;
        logInfo('皮卡鱼返回非法着法，回退纯 TS 引擎');
      } else if (!sideHasAnyMove(board, side)) {
        return r;
      } else {
        logInfo('皮卡鱼未给出着法但规则上仍有可走，回退纯 TS 引擎');
      }
    } catch (err) {
      logInfo(`皮卡鱼不可用，回退纯 TS 引擎：${err instanceof Error ? err.message : String(err)}`);
    }
    return this.fallback.bestMove(board, side, level);
  }

  dispose(): void {
    this.primary.dispose?.();
  }
}

/** 是否显式禁用皮卡鱼 */
function engineDisabled(): boolean {
  const v = (process.env.LANSCHESS_ENGINE ?? '').trim().toLowerCase();
  if (v === 'off' || v === '0' || v === 'false') return true;
  return process.env.PIKAFISH_DISABLE === '1';
}

/**
 * 按难度分派引擎：1–4（入门 / 菜鸟 / 中级 / 高手）走**纯 TS**（恢复皮卡鱼接入前的手感，
 * 也保证复盘推荐可复现）；5「棋圣」走**皮卡鱼**（带纯 TS 兜底）。
 */
class LevelRouter implements EnginePort {
  constructor(
    private readonly base: EnginePort,
    private readonly top: EnginePort,
  ) {}

  bestMove(board: Board, side: Side, level: EngineLevel): Promise<EngineResult> {
    return level >= 5 ? this.top.bestMove(board, side, level) : this.base.bestMove(board, side, level);
  }

  dispose(): void {
    this.top.dispose?.();
  }
}

/**
 * 创建 AI 引擎：
 * - 1–4 档恒为纯 TS；5「棋圣」档在有皮卡鱼二进制时走皮卡鱼（并带纯 TS 兜底），
 *   找不到引擎 / 显式禁用时「棋圣」也回退纯 TS。
 */
export function createEngine(): EnginePort {
  if (engineDisabled()) {
    logInfo('AI 引擎：纯 TS（已显式禁用皮卡鱼，棋圣档亦回退纯 TS）');
    return new LocalEngine();
  }
  const loc = findEngine();
  if (!loc) {
    logInfo('AI 引擎：纯 TS（未找到皮卡鱼引擎文件，棋圣档亦回退纯 TS）');
    return new LocalEngine();
  }
  logInfo(`AI 引擎：棋圣档走皮卡鱼（${loc.exe}），其余档位走纯 TS`);
  return new LevelRouter(new LocalEngine(), new FallbackEngine(new PikafishEngine(), new LocalEngine()));
}
