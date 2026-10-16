/**
 * 揭棋（暗棋）：隐藏信息的中国象棋变体（洗子 / 起始兵种 / 翻子 / 公开快照抹除）。
 *
 * 规则要点（详见 docs/adr/0011-jieqi.md）：
 * - 除将帅外，双方各 15 枚棋子在己方 15 个起始点随机背面摆放（暗子），任何人（含棋子主人）都不知道身份；
 * - 暗子首步按「所在起始位置的兵种」走子 / 吃子，走完即翻开露出真实身份，此后按真实身份行棋；
 * - 翻开后的士 / 相不再受九宫 / 河界限制（其余限制如塞象眼照旧）。
 *
 * 表示法：`Piece.t` 始终为「当前生效的走法兵种」（暗子 = 起始兵种），
 * 真实身份藏在 `Piece.real`（仅权威端持有），公开快照经 `redactBoard` 抹除。
 * 纯函数、无 DOM / 网络 / Node 依赖，服务端与浏览器（本地人机）共用。
 */

import { Board, COLS, PieceType, Pos, ROWS, Side } from './types.js';

/** 每方暗子兵种池（15 枚）：2 仕 2 相 2 马 2 车 2 炮 5 兵 */
const PIECE_POOL: readonly PieceType[] = [
  'A',
  'A',
  'B',
  'B',
  'N',
  'N',
  'R',
  'R',
  'C',
  'C',
  'P',
  'P',
  'P',
  'P',
  'P',
];

/** 底线（列 0..8）的兵种顺序 */
const BACK_RANK: readonly PieceType[] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];

/**
 * 某方起始点 (r,c) 对应的兵种；非起始点返回 null。
 * 揭棋暗子「首步按起始位置兵种行棋」，本函数即该映射。
 */
export function startTypeAt(side: Side, r: number, c: number): PieceType | null {
  if (c < 0 || c >= COLS) return null;
  const backRow = side === 'b' ? 0 : 9;
  if (r === backRow) return BACK_RANK[c];
  const cannonRow = side === 'b' ? 2 : 7;
  if (r === cannonRow && (c === 1 || c === 7)) return 'C';
  const pawnRow = side === 'b' ? 3 : 6;
  if (r === pawnRow && c % 2 === 0) return 'P';
  return null;
}

/** 某方 15 个暗子起始点（将帅位除外，按行优先顺序） */
export function coveredSquares(side: Side): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = startTypeAt(side, r, c);
      if (t && t !== 'K') out.push([r, c]);
    }
  }
  return out;
}

/** Fisher-Yates 洗牌（`rng` 可注入以便测试确定化） */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 洗子开局：将 / 帅正面摆在原位，其余 15 个起始点铺随机暗子。
 * 暗子的 `t` 为其起始兵种、`real` 为洗出的真实身份（仅本棋盘持有，下发前需 redactBoard）。
 */
export function dealBoard(rng: () => number = Math.random): Board {
  const b: Board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (const s of ['b', 'r'] as Side[]) {
    const backRow = s === 'b' ? 0 : 9;
    b[backRow][4] = { t: 'K', s };
    const pool = shuffle([...PIECE_POOL], rng);
    coveredSquares(s).forEach(([r, c], i) => {
      b[r][c] = { t: startTypeAt(s, r, c) as PieceType, s, hidden: true, real: pool[i] };
    });
  }
  return b;
}

/** 是否为未翻开的暗子 */
export function isCovered(p: { hidden?: boolean } | null | undefined): boolean {
  return !!p?.hidden;
}

/**
 * 翻开 (r,c) 上的暗子：`t` ← 真实身份，去掉 `hidden` / `real`；
 * 真实身份为士 / 相时置 `free`（此后不受九宫 / 河界限制）。
 * 返回是否翻开（非暗子返回 false）。
 */
export function revealAt(board: Board, [r, c]: Pos): boolean {
  const p = board[r]?.[c];
  if (!p || !p.hidden) return false;
  const real = p.real ?? p.t;
  p.t = real;
  delete p.hidden;
  delete p.real;
  if (real === 'A' || real === 'B') p.free = true;
  return true;
}

/** 公开快照：深拷贝棋盘并抹除全部真实身份（`real`） */
export function redactBoard(board: Board): Board {
  return board.map((row) =>
    row.map((x) => {
      if (!x) return null;
      const copy = { ...x };
      delete copy.real;
      return copy;
    }),
  );
}

/** 某方尚未翻开的暗子数（侧栏展示用） */
export function coveredCount(board: Board, side: Side): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p && p.s === side && p.hidden) n++;
    }
  }
  return n;
}
