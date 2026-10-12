/**
 * 完整对局着法脚本（测试共用）：红方先行，双方轮流，最后一步红方将死黑方。
 *
 * 由 scripts/find-mate.mjs 生成并逐步校验（见该脚本的回放校验输出）；
 * 终局杀法为「夹车炮杀」（双炮重叠控中、车沉底侧翼成杀），
 * 由 fullgame / review / checkmate 相关测试共同校验。
 */

import { Pos } from '../src/shared/types.js';

/** 37 步将死线（索引偶数步为红方、奇数步为黑方） */
export const MATE_LINE: Array<{ from: Pos; to: Pos }> = [
  { from: [7, 1], to: [0, 1] },
  { from: [3, 0], to: [4, 0] },
  { from: [7, 7], to: [0, 7] },
  { from: [4, 0], to: [5, 0] },
  { from: [0, 1], to: [0, 3] },
  { from: [5, 0], to: [5, 1] },
  { from: [0, 3], to: [0, 0] },
  { from: [0, 2], to: [2, 0] },
  { from: [0, 7], to: [0, 5] },
  { from: [5, 1], to: [6, 1] },
  { from: [0, 5], to: [0, 8] },
  { from: [0, 6], to: [2, 8] },
  { from: [0, 8], to: [3, 8] },
  { from: [6, 1], to: [7, 1] },
  { from: [3, 8], to: [3, 4] },
  { from: [7, 1], to: [8, 1] },
  { from: [0, 0], to: [0, 3] },
  { from: [8, 1], to: [8, 0] },
  { from: [9, 0], to: [8, 0] },
  { from: [3, 2], to: [4, 2] },
  { from: [3, 4], to: [1, 4] },
  { from: [4, 2], to: [5, 2] },
  { from: [6, 2], to: [5, 2] },
  { from: [3, 6], to: [4, 6] },
  { from: [1, 4], to: [2, 4] },
  { from: [4, 6], to: [5, 6] },
  { from: [2, 4], to: [2, 0] },
  { from: [5, 6], to: [5, 7] },
  { from: [2, 0], to: [2, 7] },
  { from: [5, 7], to: [6, 7] },
  { from: [0, 3], to: [1, 3] },
  { from: [6, 7], to: [7, 7] },
  { from: [1, 3], to: [1, 4] },
  { from: [7, 7], to: [8, 7] },
  { from: [2, 7], to: [2, 4] },
  { from: [0, 4], to: [0, 5] },
  { from: [8, 0], to: [8, 5] },
];
