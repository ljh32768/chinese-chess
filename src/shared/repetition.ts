/**
 * 重复局面裁决（长将 / 长捉 / 三次重复）——纯函数，无 DOM / 网络依赖，便于单元测试。
 *
 * 依据《中国象棋竞赛规则》「重复局面」条款的精神做可测试的简化实现：
 *
 * 1. **三次重复**：同一局面（棋盘布局 + 行棋方完全一致）第 3 次出现即触发裁决（`REPETITION_TIMES`）。
 * 2. **每步性质**（`classifyMove`，相对走子方而言）：
 *    - **将**：走子后对方被将军（优先于「捉」判定）；
 *    - **捉**：走子后新出现「可获利吃掉的对方棋子」（无根白吃 / 小换大，复用 `profitableTargets`），
 *      即这一步制造了新的得子威胁；
 *    - **闲**：其余走子（含兑子、拦、跟等官方规则中不算「打」的走法）。
 * 3. **裁决**（`judgeRepetition`，只看重复循环内各方的每步性质）：
 *    - 一方每步都是「打」（将 / 捉）而另一方不是 → 该方判负
 *      （全为将 = `长将判负`，全为捉 = `长捉判负`，将捉混合 = `长打判负`）；
 *    - 双方都是「打」，或双方都不是 → 不变作和（`重复局面判和`）。
 *
 * 简化说明（与官方规则的差异，均为本项目的可测试取舍）：不实现自然限着；
 * 「捉」只按「一手得子威胁」判定，不细分官方规则中的兑 / 献 / 拦 / 跟等例外。
 */

import { Board, Side } from './types.js';
import { isInCheck } from './rules.js';
import { profitableTargets } from './tactics.js';

/** 触发裁决的重复次数：同一局面第 3 次出现即裁决 */
export const REPETITION_TIMES = 3;

/** 一步走子相对走子方的性质：将 / 捉 / 闲 */
export type MoveNature = 'check' | 'chase' | 'idle';

/** 重复局面裁决结果；`null` 表示尚未构成重复，对局继续 */
export type RepetitionRuling =
  | { outcome: 'draw'; reason: '重复局面判和' }
  | { outcome: 'lose'; loser: Side; reason: '长将判负' | '长捉判负' | '长打判负' };

/** 重复循环的历史：局面键 + 每手性质 */
export interface RepetitionHistory {
  /** 每个局面的键，下标 0 = 开局（或自定义局面），下标 i = 第 i 手走完之后 */
  keys: string[];
  /** 每一手的性质，下标 i 对应第 (i+1) 手 */
  natures: Array<{ side: Side; nature: MoveNature }>;
}

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');
const atKey = ([r, c]: [number, number]): string => `${r},${c}`;

/**
 * 局面键：棋盘布局 + 行棋方。
 * 两次走子后棋盘与行棋方都完全一致，即视为「同一局面」。
 */
export function positionKey(board: Board, turn: Side): string {
  let s = turn;
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const p = board[r][c];
      s += p ? `${p.s}${p.t}` : '.';
    }
  }
  return s;
}

/**
 * 判定一步走子对走子方 `mover` 而言的性质。
 * @param before 走子前局面
 * @param after 走子后局面
 */
export function classifyMove(before: Board, after: Board, mover: Side): MoveNature {
  if (isInCheck(after, other(mover))) return 'check';
  // 「捉」= 这一步让走子方新出现了「可获利吃掉的对方棋子」的威胁
  const had = new Set(profitableTargets(before, mover).map(atKey));
  for (const target of profitableTargets(after, mover)) {
    if (!had.has(atKey(target))) return 'chase';
  }
  return 'idle';
}

/** 循环内某一方每步都「打」（将或捉）——即官方规则里的「长打」 */
function perpetuallyAttacks(natures: MoveNature[]): boolean {
  return natures.length > 0 && natures.every((n) => n !== 'idle');
}

/**
 * 重复局面裁决。
 * 当前局面（`keys` 末尾）第 `REPETITION_TIMES` 次出现时给出判负 / 判和结论，否则返回 `null`。
 *
 * 裁决只看最后一次重复循环（自该局面第 `REPETITION_TIMES-1` 次出现起）内各方的每步性质：
 * 恰好一方「长打」→ 该方判负；双方都「长打」或都不是 → 判和。
 */
export function judgeRepetition(h: RepetitionHistory): RepetitionRuling | null {
  const now = h.keys.length - 1; // 当前局面下标
  if (now < 0) return null;
  const cur = h.keys[now];
  const seen: number[] = [];
  for (let i = 0; i < now; i++) if (h.keys[i] === cur) seen.push(i);
  if (seen.length + 1 < REPETITION_TIMES) return null;
  const from = seen[seen.length - REPETITION_TIMES + 1]; // 循环起点：第 REPETITION_TIMES-1 次出现的下标

  // 循环内的走子（下标 from .. now-1 对应第 from+1 .. now 手）
  const bySide: Record<Side, MoveNature[]> = { r: [], b: [] };
  for (const m of h.natures.slice(from, now)) bySide[m.side].push(m.nature);

  const attacking: Record<Side, boolean> = {
    r: perpetuallyAttacks(bySide.r),
    b: perpetuallyAttacks(bySide.b),
  };
  if (attacking.r === attacking.b) return { outcome: 'draw', reason: '重复局面判和' };

  const loser: Side = attacking.r ? 'r' : 'b';
  const natures = bySide[loser];
  const reason = natures.every((n) => n === 'check')
    ? '长将判负'
    : natures.every((n) => n === 'chase')
      ? '长捉判负'
      : '长打判负';
  return { outcome: 'lose', loser, reason };
}
