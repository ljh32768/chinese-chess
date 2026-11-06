/**
 * 开局招法识别（红方首着 → 开局名）。
 *
 * 纯函数、无 DOM 依赖：从 `initBoard()` 起回放，取**红方首着**的中文记谱
 * （`shared/notation.ts describeMove`）后查表。仅用于「标准开局」的招法提示，
 * 残局（自定义局面）不得使用。详见 ADR-0007 §3.5.7。
 */

import { describeMove } from '../shared/notation.js';
import { initBoard } from '../shared/rules.js';
import { Move } from '../shared/types.js';

/** 开局提示 */
export interface OpeningHint {
  /** 开局名（如「当头炮」；v3.8 起只给名称，不带别名与「开局：」前缀） */
  name: string;
  /** 建立该开局的着法下标（红方首着 = 0） */
  index: number;
}

/**
 * 红方首着记谱 → 开局名。
 * 记谱规则见 `shared/notation.ts`：红方纵线自右向左用汉字编号，
 * 故 (7,7) 的炮是「炮二」、(7,1) 的炮是「炮八」。
 */
const RED_FIRST_OPENINGS: Record<string, string> = {
  炮二平五: '当头炮',
  炮八平五: '当头炮',
  马二进三: '起马局',
  马八进七: '起马局',
  相三进五: '飞相局',
  相七进五: '飞相局',
  兵七进一: '仙人指路',
  兵三进一: '仙人指路',
  炮二平四: '士角炮',
  炮八平六: '士角炮',
  炮二平六: '过宫炮',
  炮八平四: '过宫炮',
};

/**
 * 按着法序列识别开局招法（仅红方首着；无着法或未收录返回 null）。
 * 调用方按「`index === history.length - 1`」判断是否恰为建立该开局的那一步。
 */
export function detectOpening(history: Move[]): OpeningHint | null {
  if (!history.length) return null;
  const first = history[0];
  const board = initBoard();
  const label = describeMove(board, first.from, first.to);
  const name = RED_FIRST_OPENINGS[label];
  return name ? { name, index: 0 } : null;
}
