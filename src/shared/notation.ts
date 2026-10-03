/**
 * 传统中文记谱（纯函数，无 DOM / 网络依赖，便于单元测试）。
 *
 * 记谱约定（本模块统一实现）：
 *
 * 1. 纵线编号
 *    - 红方用汉字「一二三四五六七八九」：col 8 → 一、col 0 → 九（自右向左数）。
 *    - 黑方用阿拉伯数字：col 0 → 1、col 8 → 9。
 *    列号数字同时用于「平」的目标列，以及斜走子（马/相/象/仕/士）进退的末段目标列。
 *
 * 2. 格式：`[纵线或前后][棋子名][平/进/退][数]`，连写、不空格。
 *    棋子名沿用界面用字：红 帅仕相马车炮兵 / 黑 将士象马车炮卒。
 *    不使用位置词消歧时，「纵线」直接跟在棋子名之后（如「炮二平五」）；
 *    使用位置词消歧时，位置词前置到棋子名之前（如「前车进一」「后兵平六」）。
 *
 * 3. 平 / 进 / 退
 *    - 平：行不变，末段为目标列号。
 *    - 进 / 退：红方行号减小为「进」、增大为「退」；黑方相反。
 *      · 车/炮/兵/卒/将/帅 的进退末段为移动的行步数（用该方数字体系）；
 *      · 马/相/象/仕/士 的进退末段为目标列号。
 *
 * 4. 消歧
 *    同一纵线上有 ≥2 枚同兵种（车/马/炮/兵/卒）己方棋子时，不使用起始列号，
 *    改用位置词：
 *      - 2 枚 → 前 / 后
 *      - 3 枚 → 前 / 中 / 后
 *      - ≥4 枚 → 最靠前者用「前」、最靠后者用「后」，其余按「从前到后」顺序用该方
 *        数字体系编号（红「二」「三」…、黑「2」「3」…）；此处序号表示
 *        「从前数第几枚」，即从前第 2 枚记作「二」/「2」，第 3 枚记作「三」/「3」，
 *        以此类推。
 *    「前 / 后」方向：以靠近对方底线为「前」（红方行号小者为前；黑方行号大者为前）。
 */

import { Board, Move, PieceType, Pos, ROWS, Side } from './types.js';
import { initBoard, makeMove } from './rules.js';

/** 红方汉字数字（1..9） */
const RED_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 棋子名（沿用界面用字） */
const NAMES: Record<PieceType, { r: string; b: string }> = {
  K: { r: '帅', b: '将' },
  A: { r: '仕', b: '士' },
  B: { r: '相', b: '象' },
  N: { r: '马', b: '马' },
  R: { r: '车', b: '车' },
  C: { r: '炮', b: '炮' },
  P: { r: '兵', b: '卒' },
};

/** 该方数字体系下 1..9 的写法：红用汉字、黑用阿拉伯数字 */
function numeral(s: Side, n: number): string {
  if (n < 1 || n > 9) throw new Error(`记谱数字超出范围: ${n}`);
  return s === 'r' ? RED_DIGITS[n - 1] : String(n);
}

/** 列号 → 该方纵线数字（红 col8→1…col0→9；黑 col0→1…col8→9） */
function fileNumeral(s: Side, col: number): string {
  return s === 'r' ? numeral('r', 9 - col) : numeral('b', col + 1);
}

/** 是否需要「前后」消歧的兵种：车/马/炮/兵/卒 */
function isDisambiguated(t: PieceType): boolean {
  return t === 'R' || t === 'N' || t === 'C' || t === 'P';
}

/** 斜走子（进退末段用目标列号）：马/相/象/仕/士 */
function isDiagonal(t: PieceType): boolean {
  return t === 'N' || t === 'B' || t === 'A';
}

/**
 * 生成「纵线或位置词」部分。
 * @param idx 0 基，从「前」数起第几枚
 * @param total 该纵线同兵种己方棋子总数
 */
function positionWord(s: Side, idx: number, total: number): string {
  if (idx === 0) return '前';
  if (idx === total - 1) return '后';
  if (total === 3 && idx === 1) return '中';
  // ≥4 且非首尾：按「从前数第几枚」用该方数字体系编号
  return numeral(s, idx + 1);
}

/** 取走子前的位置词；无需消歧时返回 null */
function disambiguation(board: Board, col: number, t: PieceType, s: Side, row: number): string | null {
  if (!isDisambiguated(t)) return null;
  const rows: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    const q = board[r][col];
    if (q && q.t === t && q.s === s) rows.push(r);
  }
  if (rows.length < 2) return null;
  // 从前到后：红方行号小者为前，黑方行号大者为前
  rows.sort((a, b) => (s === 'r' ? a - b : b - a));
  const idx = rows.indexOf(row);
  return positionWord(s, idx, rows.length);
}

/**
 * 返回一步的传统中文记谱。
 * @param board 走子前局面
 * @param from 起点 [行, 列]
 * @param to 终点 [行, 列]
 */
export function describeMove(board: Board, from: Pos, to: Pos): string {
  const [fr, fc] = from;
  const [tr, tc] = to;
  const p = board[fr]?.[fc] ?? null;
  if (!p) throw new Error(`起点 (${fr},${fc}) 没有棋子`);

  const s = p.s;
  const name = NAMES[p.t][s];
  const word = disambiguation(board, fc, p.t, s, fr);
  // 消歧时位置词前置（前车…），否则纵线跟在棋子名之后（炮二…）。
  const head = word !== null ? `${word}${name}` : `${name}${fileNumeral(s, fc)}`;

  let action: string;
  let tail: string;
  if (tr === fr) {
    action = '平';
    tail = fileNumeral(s, tc);
  } else {
    const forward = s === 'r' ? tr < fr : tr > fr;
    action = forward ? '进' : '退';
    tail = isDiagonal(p.t) ? fileNumeral(s, tc) : numeral(s, Math.abs(tr - fr));
  }

  return `${head}${action}${tail}`;
}

/**
 * 从标准开局起按序回放，逐步生成记谱。
 * makeMove 原地修改棋盘，故使用同一棋盘顺序应用即可。
 */
export function describeHistory(history: Move[]): string[] {
  const board = initBoard();
  const out: string[] = [];
  for (const mv of history) {
    out.push(describeMove(board, mv.from, mv.to));
    makeMove(board, mv.from, mv.to);
  }
  return out;
}

/** 吃子统计：byRed / byBlack 分别为红方、黑方吃掉的对方棋子（按发生顺序） */
export interface CapturedSummary {
  byRed: PieceType[];
  byBlack: PieceType[];
}

/** 从着法序列回放统计双方吃子（红黑交替，第一步为红方） */
export function capturedPieces(history: Move[]): CapturedSummary {
  const board = initBoard();
  const byRed: PieceType[] = [];
  const byBlack: PieceType[] = [];
  history.forEach((mv, i) => {
    const target = board[mv.to[0]]?.[mv.to[1]] ?? null;
    if (target) {
      // 奇数步为黑方（下标 0 起：偶数下标 = 红方）
      (i % 2 === 0 ? byRed : byBlack).push(target.t);
    }
    makeMove(board, mv.from, mv.to);
  });
  return { byRed, byBlack };
}
