/**
 * 纯规则引擎（不依赖 DOM / 网络，便于单元测试）。
 *
 * 覆盖：车、马、炮、象、士、将、卒的走法；不能吃己方；不能送将；将帅照面；
 * 将军、应将（通过过滤送将实现）、将死、困毙。
 *
 * 明确不做（MVP 范围外）：长将、长捉、重复局面、自然限着。
 */

import { Board, COLS, Piece, Pos, ROWS, Side } from './types.js';

/** 坐标是否在棋盘内 */
export function inBoard(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

/** 是否在九宫内（红方在下方 7~9 行，黑方在上方 0~2 行） */
export function inPalace(r: number, c: number, s: Side): boolean {
  if (c < 3 || c > 5) return false;
  return s === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
}

/** 初始化标准开局棋盘 */
export function initBoard(): Board {
  const b: Board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const back: Piece['t'][] = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
  for (let c = 0; c < COLS; c++) {
    b[0][c] = { t: back[c], s: 'b' };
    b[9][c] = { t: back[c], s: 'r' };
  }
  b[2][1] = { t: 'C', s: 'b' };
  b[2][7] = { t: 'C', s: 'b' };
  b[7][1] = { t: 'C', s: 'r' };
  b[7][7] = { t: 'C', s: 'r' };
  for (const c of [0, 2, 4, 6, 8]) {
    b[3][c] = { t: 'P', s: 'b' };
    b[6][c] = { t: 'P', s: 'r' };
  }
  return b;
}

/** 深拷贝棋盘 */
export function cloneBoard(b: Board): Board {
  return b.map((row) => row.map((x) => (x ? { t: x.t, s: x.s } : null)));
}

/**
 * 生成某棋子的「伪合法」走法（只考虑该棋子自身走法，未过滤送将 / 照面）。
 */
export function pieceMoves(b: Board, r: number, c: number): Pos[] {
  const p = b[r][c];
  if (!p) return [];
  const s = p.s;
  const res: Pos[] = [];

  switch (p.t) {
    case 'K':
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inPalace(rr, cc, s)) continue;
        const q = b[rr][cc];
        if (!q || q.s !== s) res.push([rr, cc]);
      }
      break;

    case 'A':
      for (const [dr, dc] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inPalace(rr, cc, s)) continue;
        const q = b[rr][cc];
        if (!q || q.s !== s) res.push([rr, cc]);
      }
      break;

    case 'B':
      for (const [dr, dc] of [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ]) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBoard(rr, cc)) continue;
        if (s === 'r' && rr < 5) continue; // 红相不过河
        if (s === 'b' && rr > 4) continue; // 黑象不过河
        if (b[r + dr / 2][c + dc / 2]) continue; // 塞象眼
        const q = b[rr][cc];
        if (q && q.s === s) continue;
        res.push([rr, cc]);
      }
      break;

    case 'N': {
      const jumps = [
        [-2, -1, -1, 0],
        [-2, 1, -1, 0],
        [2, -1, 1, 0],
        [2, 1, 1, 0],
        [-1, -2, 0, -1],
        [1, -2, 0, -1],
        [-1, 2, 0, 1],
        [1, 2, 0, 1],
      ];
      for (const [dr, dc, br, bc] of jumps) {
        const rr = r + dr;
        const cc = c + dc;
        if (!inBoard(rr, cc)) continue;
        if (b[r + br][c + bc]) continue; // 蹩马腿
        const q = b[rr][cc];
        if (q && q.s === s) continue;
        res.push([rr, cc]);
      }
      break;
    }

    case 'R':
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let rr = r + dr;
        let cc = c + dc;
        while (inBoard(rr, cc)) {
          const q = b[rr][cc];
          if (q) {
            if (q.s !== s) res.push([rr, cc]);
            break;
          }
          res.push([rr, cc]);
          rr += dr;
          cc += dc;
        }
      }
      break;

    case 'C':
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let rr = r + dr;
        let cc = c + dc;
        let jumped = false;
        while (inBoard(rr, cc)) {
          const q = b[rr][cc];
          if (!jumped) {
            if (q) jumped = true;
            else res.push([rr, cc]);
          } else if (q) {
            if (q.s !== s) res.push([rr, cc]);
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
      break;

    case 'P': {
      const fwd = s === 'r' ? -1 : 1;
      const rr = r + fwd;
      if (inBoard(rr, c)) {
        const q = b[rr][c];
        if (!q || q.s !== s) res.push([rr, c]);
      }
      const crossed = s === 'r' ? r <= 4 : r >= 5; // 过河后可横走
      if (crossed) {
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (!inBoard(r, cc)) continue;
          const q = b[r][cc];
          if (!q || q.s !== s) res.push([r, cc]);
        }
      }
      break;
    }
  }
  return res;
}

/** 找到某方的将/帅位置 */
export function findKing(b: Board, s: Side): Pos | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.t === 'K' && p.s === s) return [r, c];
    }
  }
  return null;
}

/**
 * 判断 (r,c) 是否被 by 方攻击（含将帅照面：目标若是将/帅，则对方将帅同列且中间无子即视为攻击）。
 */
export function isAttacked(b: Board, r: number, c: number, by: Side): boolean {
  const target = b[r][c];
  if (target && target.t === 'K') {
    for (let i = 0; i < ROWS; i++) {
      const p = b[i][c];
      if (p && p.t === 'K' && p.s === by) {
        let blocked = false;
        const lo = Math.min(i, r);
        const hi = Math.max(i, r);
        for (let k = lo + 1; k < hi; k++) {
          if (b[k][c]) {
            blocked = true;
            break;
          }
        }
        if (!blocked) return true;
      }
    }
  }
  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      const p = b[i][j];
      if (!p || p.s !== by) continue;
      for (const [rr, cc] of pieceMoves(b, i, j)) {
        if (rr === r && cc === c) return true;
      }
    }
  }
  return false;
}

/** 某方是否被将军 */
export function isInCheck(b: Board, s: Side): boolean {
  const kp = findKing(b, s);
  if (!kp) return true;
  return isAttacked(b, kp[0], kp[1], s === 'r' ? 'b' : 'r');
}

/** 该方所有棋子的合法着法（已过滤送将 / 照面） */
export function legalMoves(b: Board, r: number, c: number): Pos[] {
  const p = b[r][c];
  if (!p) return [];
  const opp: Side = p.s === 'r' ? 'b' : 'r';
  return pieceMoves(b, r, c).filter(([rr, cc]) => {
    const nb = cloneBoard(b);
    nb[rr][cc] = nb[r][c];
    nb[r][c] = null;
    const kp = findKing(nb, p.s);
    if (!kp) return false;
    return !isAttacked(nb, kp[0], kp[1], opp);
  });
}

/** 在给定棋盘上执行一步（原地修改），返回是否成功 */
export function makeMove(b: Board, from: Pos, to: Pos): boolean {
  const [fr, fc] = from;
  const [tr, tc] = to;
  if (!inBoard(fr, fc) || !inBoard(tr, tc)) return false;
  const p = b[fr][fc];
  if (!p) return false;
  b[tr][tc] = p;
  b[fr][fc] = null;
  return true;
}

/** 模拟一步后的棋盘（不修改原棋盘） */
export function boardAfterMove(b: Board, from: Pos, to: Pos): Board {
  const nb = cloneBoard(b);
  makeMove(nb, from, to);
  return nb;
}

/** 某方是否还有任何合法着法（用于将死 / 困毙判定） */
export function sideHasAnyMove(b: Board, s: Side): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.s === s && legalMoves(b, r, c).length > 0) return true;
    }
  }
  return false;
}

/**
 * 走子后的结局判定。
 * 返回 null 表示对局继续；否则返回 { winner, reason }。
 */
export function judgeAfterMove(
  b: Board,
  sideToMove: Side,
): { winner: Side | null; reason: '将死' | '困毙' } | null {
  const inCheck = isInCheck(b, sideToMove);
  if (sideHasAnyMove(b, sideToMove)) return null;
  // 无子可走：被将军为将死（对方胜），未被将军为困毙（对方胜）
  return { winner: sideToMove === 'r' ? 'b' : 'r', reason: inCheck ? '将死' : '困毙' };
}

/**
 * 校验一步是否合法（主机权威校验入口）。
 * 返回 null 表示合法，否则返回中文原因。
 */
export function validateMove(
  b: Board,
  from: Pos,
  to: Pos,
  expectedSide: Side,
): string | null {
  const [fr, fc] = from;
  const [tr, tc] = to;
  if (!inBoard(fr, fc) || !inBoard(tr, tc)) return '越界';
  const p = b[fr][fc];
  if (!p) return '起点没有棋子';
  if (p.s !== expectedSide) return '这不是你的棋子';
  const target = b[tr][tc];
  if (target && target.s === p.s) return '不能吃自己的棋子';
  if (fr === tr && fc === tc) return '起点与终点相同';
  const ok = legalMoves(b, fr, fc).some(([rr, cc]) => rr === tr && cc === tc);
  if (!ok) return '不符合走法或会送将';
  return null;
}