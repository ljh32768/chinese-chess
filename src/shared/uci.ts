/**
 * 皮卡鱼（Pikafish）/ UCI 协议与项目棋盘之间的换算。
 *
 * 纯函数、无环境依赖（渲染层、服务端、测试共用）：
 * - 棋盘 + 行棋方 ↔ 中国象棋 FEN（皮卡鱼采用标准象棋 FEN：红=大写、黑=小写，行棋方 `w`/`b`）；
 * - 项目坐标 ↔ UCI 方格（文件 a-i = 列 0-8；行号 0-9 = 9 - 项目行）；
 * - 着法 ↔ UCI 着法串（如 `b2e2`），以及引擎 `bestmove` 行解析。
 *
 * 换算约定已用引擎实测校验：初始局面 FEN 与 `b2e2`（炮二平五）一致。
 */

import { Board, COLS, Cell, Move, Piece, PieceType, Pos, ROWS, Side } from './types.js';

/** 项目棋子类型 → FEN 小写字母 */
const PIECE_LETTER: Record<PieceType, string> = {
  K: 'k',
  A: 'a',
  B: 'b',
  N: 'n',
  R: 'r',
  C: 'c',
  P: 'p',
};

/** FEN 字母（小写为准）→ 项目棋子类型 */
const LETTER_PIECE: Record<string, PieceType> = {
  k: 'K',
  a: 'A',
  b: 'B',
  n: 'N',
  r: 'R',
  c: 'C',
  p: 'P',
};

/** 单颗棋子 → FEN 字母：红方大写、黑方小写 */
function pieceLetter(p: Piece): string {
  const l = PIECE_LETTER[p.t];
  return p.s === 'r' ? l.toUpperCase() : l;
}

/**
 * 棋盘 + 行棋方 → 中国象棋 FEN。
 *
 * 第 1 段（摆子）第 1 行对应项目 `board[0]`（黑方底线）。半回合 / 整回合计数恒为 `0 1`：
 * 每次都是全新局面、不携带历史，故不用于重复局面判定。
 */
export function boardToFen(board: Board, side: Side): string {
  const ranks: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let rank = '';
    let empty = 0;
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        rank += String(empty);
        empty = 0;
      }
      rank += pieceLetter(p);
    }
    if (empty > 0) rank += String(empty);
    ranks.push(rank);
  }
  return `${ranks.join('/')} ${side === 'r' ? 'w' : 'b'} - - 0 1`;
}

/**
 * 中国象棋 FEN → 棋盘 + 行棋方。
 * 摆子段或行棋方段非法时返回 null（不抛异常，便于服务端把非法输入当 400 处理）。
 */
export function fenToBoard(fen: string): { board: Board; side: Side } | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const ranks = parts[0].split('/');
  if (ranks.length !== ROWS) return null;

  const board: Board = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    for (const ch of ranks[r]) {
      if (ch >= '1' && ch <= '9') {
        c += Number(ch);
        continue;
      }
      const t = LETTER_PIECE[ch.toLowerCase()];
      if (!t || c >= COLS) return null;
      board[r][c] = { t, s: ch === ch.toUpperCase() ? 'r' : 'b' };
      c += 1;
    }
    if (c !== COLS) return null;
  }

  const turn = parts[1];
  if (turn !== 'w' && turn !== 'b') return null;
  return { board, side: turn === 'w' ? 'r' : 'b' };
}

/** 项目坐标 `[行, 列]` → UCI 方格（如 `[7, 1]` → `b2`） */
export function posToSquare([r, c]: Pos): string {
  return String.fromCharCode('a'.charCodeAt(0) + c) + String(ROWS - 1 - r);
}

/** UCI 方格 → 项目坐标；非法返回 null */
export function squareToPos(sq: string): Pos | null {
  if (sq.length !== 2) return null;
  const c = sq.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(sq[1]);
  if (c < 0 || c >= COLS) return null;
  if (!Number.isInteger(rank) || rank < 0 || rank > ROWS - 1) return null;
  return [ROWS - 1 - rank, c];
}

/** 项目着法 → UCI 着法串（如 `[7,1]→[7,4]` → `b2e2`） */
export function moveToUci(m: Move): string {
  return posToSquare(m.from) + posToSquare(m.to);
}

/** UCI 着法串 → 项目着法；非法返回 null */
export function uciToMove(uci: string): Move | null {
  if (uci.length < 4) return null;
  const from = squareToPos(uci.slice(0, 2));
  const to = squareToPos(uci.slice(2, 4));
  if (!from || !to) return null;
  return { from, to };
}

/**
 * 解析引擎输出的 `bestmove` 行。
 * 形如 `bestmove b2e2 ponder b9c7`；无着法时引擎输出 `bestmove (none)`，此处返回 null。
 */
export function parseBestMove(line: string): Move | null {
  const m = /^\s*bestmove\s+(\S+)/.exec(line);
  if (!m) return null;
  const token = m[1];
  if (token === '(none)' || token === 'none' || token === '0000') return null;
  return uciToMove(token);
}
