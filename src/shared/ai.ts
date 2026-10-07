/**
 * 中国象棋 AI 引擎（服务端 AI 席位 / 客户端本地人机对弈共用）。
 *
 * 采用负极大值（negamax）+ alpha-beta 剪枝的固定深度搜索：
 * - 叶子评估 = 子力价值 + 简单位置分（兵/卒过河加分），红黑对称。
 * - 走法排序优先吃子（按被吃子力降序），提升剪枝效率。
 * - 某方无合法着法时按将死 / 困毙给极大的负分（相对走子方）。
 * - 迭代加深 + 时间保护：超时回退到已完成的浅层最佳着法。
 *
 * 只依赖纯规则引擎，不依赖 DOM / 网络 / Node，因此可同时运行在服务端与浏览器。
 */

import { Board, COLS, Move, PieceType, Pos, ROWS, Side } from './types.js';
import { cloneBoard, findKing, isAttacked, legalMoves, makeMove, pieceMoves } from './rules.js';

/** 各棋子基础子力价值 */
const PIECE_VALUE: Record<PieceType, number> = {
  K: 100000,
  R: 900,
  N: 400,
  C: 450,
  B: 200,
  A: 200,
  P: 100,
};

/** 将死 / 困毙分数（远大于任何子力差） */
const MATE = 1_000_000;
const INF = Number.POSITIVE_INFINITY;

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');

/** 搜索上下文：统一的截止时间与超时标志 */
interface Ctx {
  deadline: number;
  timedOut: boolean;
}

/**
 * 局面评估：从 red 视角计算分值（红为正、黑为负），再按走子方取符号。
 * 含兵/卒过河位置分，关于 180° 旋转对称。
 */
function evaluate(b: Board, side: Side): number {
  let red = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p) continue;
      let v = PIECE_VALUE[p.t];
      if (p.t === 'P') {
        if (p.s === 'r') {
          if (r <= 4) v += 30 + (4 - r) * 3; // 红兵过河并逐步推进
        } else if (r >= 5) {
          v += 30 + (r - 5) * 3; // 黑卒过河并逐步推进
        }
      }
      red += p.s === 'r' ? v : -v;
    }
  }
  return side === 'r' ? red : -red;
}

/**
 * 生成某方全部「合法」着法（已过滤送将 / 将帅照面）。
 * 就地试走 + isAttacked 还原，避免每次深拷贝棋盘。
 */
function genLegalMoves(b: Board, side: Side): Move[] {
  const res: Move[] = [];
  const opp = other(side);
  const kingPos = findKing(b, side);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p || p.s !== side) continue;
      const isKing = p.t === 'K';
      for (const [tr, tc] of pieceMoves(b, r, c)) {
        const captured = b[tr][tc];
        b[tr][tc] = p;
        b[r][c] = null;
        const kp: Pos | null = isKing ? [tr, tc] : kingPos;
        const bad = !kp || isAttacked(b, kp[0], kp[1], opp);
        b[r][c] = p;
        b[tr][tc] = captured;
        if (!bad) res.push({ from: [r, c], to: [tr, tc] });
      }
    }
  }
  return res;
}

/** 被吃子力分值，用于走法排序 */
function moveScore(b: Board, m: Move): number {
  const p = b[m.to[0]][m.to[1]];
  return p ? PIECE_VALUE[p.t] : 0;
}

/** 优先吃子、按被吃子力降序排序（原地） */
function orderMoves(b: Board, moves: Move[]): void {
  moves.sort((a, x) => moveScore(b, x) - moveScore(b, a));
}

/**
 * 负极大值 + alpha-beta。返回相对 side（走子方）的分数。
 * ply 为距离根节点的深度，用于让「更快将死」获得更高分。
 */
function negamax(
  b: Board,
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  ctx: Ctx,
): number {
  if (ctx.timedOut) return alpha;
  const kp = findKing(b, side);
  if (!kp) return -(MATE - ply); // 己方将/帅已被吃 => 负
  if (depth <= 0) return evaluate(b, side);
  if (Date.now() >= ctx.deadline) {
    ctx.timedOut = true;
    return alpha;
  }

  const moves = genLegalMoves(b, side);
  if (moves.length === 0) return -(MATE - ply); // 将死 / 困毙均判负
  orderMoves(b, moves);

  let best = -INF;
  for (const m of moves) {
    const captured = b[m.to[0]][m.to[1]];
    b[m.to[0]][m.to[1]] = b[m.from[0]][m.from[1]];
    b[m.from[0]][m.from[1]] = null;
    let val: number;
    if (captured && captured.t === 'K') {
      val = MATE - (ply + 1); // 吃到对方将/帅
    } else {
      val = -negamax(b, other(side), depth - 1, -beta, -alpha, ply + 1, ctx);
    }
    b[m.from[0]][m.from[1]] = b[m.to[0]][m.to[1]];
    b[m.to[0]][m.to[1]] = captured;

    if (ctx.timedOut) return best > -INF ? best : alpha;
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta 剪枝
  }
  return best;
}

/**
 * 为指定一方挑选一步着法。
 *
 * @param board 当前棋盘（不被修改）
 * @param side  要走子的一方
 * @param opts  depth（默认 2）、timeLimitMs（默认 1500）
 * @returns 选中的合法着法；无合法着法时返回 null
 */
export function pickMove(
  board: Board,
  side: Side,
  opts?: { depth?: number; timeLimitMs?: number },
): Move | null {
  const maxDepth = Math.max(1, Math.floor(opts?.depth ?? 2));
  const timeLimitMs = opts?.timeLimitMs ?? 1500;
  const ctx: Ctx = { deadline: Date.now() + timeLimitMs, timedOut: false };

  const rootMoves = genLegalMoves(board, side);
  if (rootMoves.length === 0) return null;
  orderMoves(board, rootMoves);

  let best: Move = rootMoves[0];
  let ordered: Move[] = rootMoves;

  // 迭代加深：超时则沿用上一层已完成的结果
  for (let depth = 1; depth <= maxDepth; depth++) {
    let iterBest: Move | null = null;
    let iterScore = -INF;
    let alpha = -INF;
    let completed = true;

    for (const m of ordered) {
      // 第 1 层必定跑完，保证至少有一个合法着法可返回
      if (depth > 1 && Date.now() >= ctx.deadline) {
        completed = false;
        break;
      }
      const nb = cloneBoard(board);
      makeMove(nb, m.from, m.to);
      const val = -negamax(nb, other(side), depth - 1, -INF, -alpha, 1, ctx);
      if (ctx.timedOut) {
        completed = false;
        break;
      }
      if (val > iterScore) {
        iterScore = val;
        iterBest = m;
      }
      if (val > alpha) alpha = val;
    }

    if (completed && iterBest) {
      best = iterBest;
      ordered = [iterBest, ...ordered.filter((x) => x !== iterBest)];
      if (iterScore >= MATE - 100) break; // 已找到必胜杀着
    }
    if (ctx.timedOut) break;
  }

  // 复核：返回的着法必须存在于规则引擎的合法着法中
  const legal = legalMoves(board, best.from[0], best.from[1]);
  if (legal.some(([r, c]) => r === best.to[0] && c === best.to[1])) return best;
  const fallback = genLegalMoves(board, side);
  return fallback.length > 0 ? fallback[0] : null;
}
