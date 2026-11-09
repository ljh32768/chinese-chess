/**
 * 重复局面提示（长将 / 长捉 / 三次重复）——纯函数，无 DOM / 网络依赖，便于单元测试。
 *
 * 依据《中国象棋竞赛规则》「重复局面」条款的精神做可测试的简化实现：
 *
 * 1. **每步性质**（`classifyMove`，相对走子方而言）：
 *    - **将**：走子后对方被将军（优先于「捉」判定）；
 *    - **捉**：走子后新出现「可获利吃掉的对方棋子」（无根白吃 / 小换大，复用 `profitableTargets`），
 *      即这一步制造了新的得子威胁；
 *    - **闲**：其余走子（含兑子、拦、跟等官方规则中不算「打」的走法）。
 * 2. **提示**（`judgeRepetition`）——v3.43 起长将 / 长捉**不再判负**，只提示「请变招」：
 *    - 某一方**连续「打」（将 / 捉）到第 5 步**（`CHANGE_HINT_AT`）→ 提示变招（长将 / 长捉 / 将捉混合）；
 *    - 同一局面（棋盘布局 + 行棋方完全一致）第 3 次出现，且无人单方长打
 *      （双方都是「打」，或双方都不是）→ 提示变招（不判和、不判负，对局继续）。
 *
 * `judgeRepetition` 只返回 `hint` 或 `null`，任何情况下都不会结束对局。
 *
 * 简化说明（与官方规则的差异，均为本项目的可测试取舍）：不实现自然限着；
 * 「捉」只按「一手得子威胁」判定，不细分官方规则中的兑 / 献 / 拦 / 跟等例外；
 * 连续「打」按走子方的着法顺序累计，不要求这些着法一定构成同一局面的循环。
 */

import { Board, Side } from './types.js';
import { isInCheck } from './rules.js';
import { profitableTargets } from './tactics.js';

/** 三次重复：同一局面第几次出现时参与提示判定 */
export const REPETITION_TIMES = 3;

/** 连续「打」（将 / 捉）到第几步即提示「请变招」（长将 / 长捉不再判负） */
export const CHANGE_HINT_AT = 5;

/** 一步走子相对走子方的性质：将 / 捉 / 闲 */
export type MoveNature = 'check' | 'chase' | 'idle';

/** 重复局面提示结果；`null` 表示尚未构成提示，对局照常继续 */
export type RepetitionRuling = { outcome: 'hint'; reason: '请变招' };

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

/**
 * 某一方当前连续「打」（将 / 捉）的步数：
 * 从最后一手往前数**该方自己的**着法，一旦遇到「闲」即中断。
 */
function attackStreak(natures: Array<{ side: Side; nature: MoveNature }>, side: Side): number {
  let n = 0;
  for (let i = natures.length - 1; i >= 0; i--) {
    const m = natures[i];
    if (m.side !== side) continue;
    if (m.nature === 'idle') break;
    n += 1;
  }
  return n;
}

/** 循环内某一方每步都「打」（将或捉）——即官方规则里的「长打」 */
function perpetuallyAttacks(natures: MoveNature[]): boolean {
  return natures.length > 0 && natures.every((n) => n !== 'idle');
}

/**
 * 重复局面提示判定。
 *
 * 1. 任一方的连续「打」步数达到 `CHANGE_HINT_AT`（第 5 步）→ 提示「请变招」（长将 / 长捉不再判负）；
 * 2. 当前局面第 `REPETITION_TIMES` 次出现，且无人单方长打（双方都长打或都不长打）→ 提示「请变招」；
 *    若恰好一方长打但还没到第 5 步，暂不提示（继续走子，到第 5 步再提示）。
 *
 * 任何情况下都不返回判负、不判和，对局照常继续。
 */
export function judgeRepetition(h: RepetitionHistory): RepetitionRuling | null {
  // 1) 连续长将 / 长捉达到第 5 步：提示变招
  if (attackStreak(h.natures, 'r') >= CHANGE_HINT_AT || attackStreak(h.natures, 'b') >= CHANGE_HINT_AT) {
    return { outcome: 'hint', reason: '请变招' };
  }

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
  // 2) 无人单方长打却反复不变（双方都长打 / 都不长打）：不判和，提示双方变招
  if (attacking.r === attacking.b) return { outcome: 'hint', reason: '请变招' };
  return null;
}
