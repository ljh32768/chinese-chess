/**
 * 吃子提示分析（纯函数，无 DOM / 网络依赖，便于单元测试）。
 *
 * 站在某一方（`side`）的视角给出两类位置：
 * - `targets`（绿色）：**可以吃掉的对方棋子**——该子「无根」（不被对方自己的子保护，吃掉后不会被反吃），
 *   或「小换大」（用价值更小的己方子去吃它，即使它有根，一换一后仍净赚）。
 * - `threats`（红色）：**会被对方吃掉的己方棋子**——与上面完全对称（把视角换成对方即可）。
 *
 * 判定只做「一手」的静态估值（本项目提示性功能，非权威判定）：
 * 1. 己方有棋子能**合法**走到目标点（`legalMoves` 已过滤送将 / 照面）；
 * 2. 目标点是否被对方保护用 `isAttacked` 判断（含将帅照面，按伪合法走法，不考虑牵制）；
 * 3. 帅 / 将不参与提示（将帅照面由规则的将军判定负责）。
 */

import { Board, COLS, PieceType, Pos, ROWS, Side } from './types.js';
import { cloneBoard, isAttacked, legalMoves } from './rules.js';

/**
 * 棋子价值（用于「小换大」比较）。
 * 车 9 / 炮 4.5 / 马 4 / 士象 2 / 兵卒 1；帅将给一个极大值兜底（正常不参与提示）。
 */
export const PIECE_VALUE: Record<PieceType, number> = {
  K: 1000,
  R: 9,
  C: 4.5,
  N: 4,
  B: 2,
  A: 2,
  P: 1,
};

/** 吃子提示结果：targets 画绿环（可吃对方），threats 画红环（己方有险） */
export interface CaptureHints {
  /** 可以吃掉的对方棋子位置（绿色） */
  targets: Pos[];
  /** 会被对方吃掉的己方棋子位置（红色） */
  threats: Pos[];
}

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');
const key = ([r, c]: Pos): string => `${r},${c}`;

/**
 * 判断 `side` 在 `at` 处的棋子是否「有根」（被己方棋子保护）。
 * 做法：把该点临时换成一枚对方占位子，再看己方是否有子能吃掉它（即能否回头反吃）。
 * 必须用「对方占位子」而不是空格——空格会让炮被误判为有根（炮吃子需炮架），
 * 而用己方棋子占位（原盘面）则会被 `pieceMoves` 当成己方子直接跳过（误判为无根）。
 */
function isDefended(board: Board, side: Side, at: Pos): boolean {
  const probe = cloneBoard(board);
  probe[at[0]][at[1]] = { t: 'P', s: other(side) };
  return isAttacked(probe, at[0], at[1], side);
}

/**
 * 从 `side` 视角列出「可获利吃掉」的对方棋子位置。
 * 对每个对方棋子（不含将帅）所在点 S：
 * - 己方有子能合法吃到 S（取其中最便宜的一枚），否则跳过；
 * - S 未被对方保护（无根）→ 白吃，计入；
 * - S 有保护但该子价值 > 最便宜攻击者的价值 → 小换大，计入。
 */
export function profitableTargets(board: Board, side: Side): Pos[] {
  const enemy = other(side);
  // 一次性算好该方所有合法着法，记下每个落点最便宜的攻击者价值（避免逐目标重复搜索）
  const cheapest = new Map<string, number>();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p || p.s !== side) continue;
      const value = PIECE_VALUE[p.t];
      for (const to of legalMoves(board, r, c)) {
        const k = key(to);
        const cur = cheapest.get(k);
        if (cur === undefined || value < cur) cheapest.set(k, value);
      }
    }
  }

  const out: Pos[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const target = board[r][c];
      if (!target || target.s !== enemy || target.t === 'K') continue;
      const minAttacker = cheapest.get(key([r, c]));
      if (minAttacker === undefined) continue;
      const defended = isDefended(board, enemy, [r, c]);
      if (!defended || PIECE_VALUE[target.t] > minAttacker) out.push([r, c]);
    }
  }
  return out;
}

/**
 * 从 `side` 视角给出完整吃子提示：
 * - 绿色 `targets` = 该方可以获利吃掉的对方棋子；
 * - 红色 `threats` = 对方可以获利吃掉的该方棋子（对称计算）。
 */
export function captureHints(board: Board, side: Side): CaptureHints {
  return {
    targets: profitableTargets(board, side),
    threats: profitableTargets(board, other(side)),
  };
}
