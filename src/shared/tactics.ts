/**
 * 战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）：走子后给出「战术提示」的标签与被威胁的棋子。
 *
 * 纯函数、无环境依赖（复用 `shared/rules.ts` 的走法与攻击判定），便于单测；
 * 只做**启发式提示**，不参与任何规则 / 胜负判定。判定口径见 ADR-0007 §3.5.7。
 */

import { findKing, isAttacked, pieceMoves, sideHasAnyMove } from './rules.js';
import { Board, Move, Piece, PieceType, Pos, Side } from './types.js';

/** 战术类型 */
export type TacticKind =
  | 'discovered-check' // 闪将
  | 'discovered-attack' // 闪击
  | 'check-fork' // 将军抽（马 / 车 / 炮）
  | 'skewer' // 串打
  | 'fork'; // 捉双

export interface TacticHit {
  kind: TacticKind;
  /** 展示标签（闪将 / 闪击 / 将军抽车 / 串打 / 捉双） */
  label: string;
  /** 发起方关键棋子（文案 / 调试用） */
  actors: Pos[];
  /** 被威胁（画闪电）的敌方棋子 */
  threats: Pos[];
}

/** 子力价值：用于「值得抽 / 值得捉」与判断被捉先后 */
export const VALUE: Record<PieceType, number> = { K: 10000, R: 9, C: 4.5, N: 4, A: 2, B: 2, P: 1 };

/** 值得一捉的子力门槛（马及以上） */
const WORTH_M = VALUE.N;

/** 兵种中文名（将军抽 X 用） */
const PIECE_CN: Record<string, string> = { R: '车', C: '炮', N: '马' };

/** 优先级（数值越小越优先；绝杀由渲染层负责，不在此列） */
const PRIORITY: Record<TacticKind, number> = {
  'discovered-check': 0,
  'check-fork': 1,
  skewer: 2,
  fork: 3,
  'discovered-attack': 4,
};

/** 四个射线方向 */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');
const samePos = (a: Pos, b: Pos): boolean => a[0] === b[0] && a[1] === b[1];
/** 是否为「值得捉」的兵种（马 / 车 / 炮） */
const isWorth = (t: PieceType): boolean => t === 'R' || t === 'C' || t === 'N';

/** 某方棋子（可指定兵种）的位置 + 棋子 */
function piecesOf(board: Board, side: Side, type?: PieceType): Array<{ pos: Pos; piece: Piece }> {
  const res: Array<{ pos: Pos; piece: Piece }> = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const p = board[r][c];
      if (p && p.s === side && (!type || p.t === type)) res.push({ pos: [r, c], piece: p });
    }
  }
  return res;
}

/** 按 `pieceMoves` 给出能吃到 `target` 的 `by` 方棋子位置（不含将帅照面） */
function attackersOf(board: Board, target: Pos, by: Side): Pos[] {
  const res: Pos[] = [];
  for (const { pos } of piecesOf(board, by)) {
    if (attacks(board, pos, target)) res.push(pos);
  }
  return res;
}

/** `from` 处的棋子能否吃到 `target` 格（含炮需炮架，不含将帅照面） */
function attacks(board: Board, from: Pos, target: Pos): boolean {
  return pieceMoves(board, from[0], from[1]).some(([r, c]) => r === target[0] && c === target[1]);
}

/** 同行 / 同列两点之间的格子；不同线返回空数组 */
function betweenCells(a: Pos, b: Pos): Pos[] {
  const res: Pos[] = [];
  if (a[0] === b[0]) {
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    for (let c = lo + 1; c < hi; c++) res.push([a[0], c]);
  } else if (a[1] === b[1]) {
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    for (let r = lo + 1; r < hi; r++) res.push([r, a[1]]);
  }
  return res;
}

/** 「让线」：让开的子（`moveFrom`）位于 `actor` 与 `target` 的连线上 */
function openedLine(actor: Pos, target: Pos, moveFrom: Pos): boolean {
  return betweenCells(actor, target).some((p) => samePos(p, moveFrom));
}

/** 该子是否车 / 炮（只有直线子力存在「让线」） */
function isLinePiece(board: Board, pos: Pos): boolean {
  const p = board[pos[0]]?.[pos[1]];
  return !!p && (p.t === 'R' || p.t === 'C');
}

/**
 * 车 / 炮的「串打」射线：某方向上「前一子之后还有一枚更值得捉的敌子」。
 * 返回每条射线上 [前子, 后子] 的坐标。
 */
function skewerRays(board: Board, from: Pos, type: PieceType, opp: Side): Pos[][] {
  const rays: Pos[][] = [];
  for (const [dr, dc] of DIRS) {
    // 该射线上由近及远的棋子序列
    const line: Array<{ pos: Pos; piece: Piece }> = [];
    let r = from[0] + dr;
    let c = from[1] + dc;
    while (r >= 0 && r < board.length && c >= 0 && c < board[r].length) {
      const p = board[r][c];
      if (p) line.push({ pos: [r, c], piece: p });
      r += dr;
      c += dc;
    }
    // 车：第一枚即为当前可吃目标（须为敌方）；炮：第一枚是炮架，第二枚才是可吃目标
    const front = type === 'R' ? line[0] : line[1];
    const back = type === 'R' ? line[1] : line[2];
    if (front && back && front.piece.s === opp && back.piece.s === opp && VALUE[back.piece.t] >= WORTH_M) {
      rays.push([front.pos, back.pos]);
    }
  }
  return rays;
}

/**
 * 识别一步走子形成的战术（最多返回 1 条，按优先级）。
 * @param before 走子前局面
 * @param move   该步（`from` / `to`）
 * @param after  走子后局面
 */
export function detectTactics(before: Board, move: Move, after: Board): TacticHit[] {
  const mover = before[move.from[0]]?.[move.from[1]];
  if (!mover) return [];
  const me = mover.s;
  const opp = other(me);
  const moved = after[move.to[0]]?.[move.to[1]];
  if (!moved || moved.s !== me) return [];

  const oppKing = findKing(after, opp);

  // 绝杀（将死）由渲染层的正中圆环表达：对方被将军且已无子可走时不做战术提示
  if (oppKing && isAttacked(after, oppKing[0], oppKing[1], me) && !sideHasAnyMove(after, opp)) return [];

  const hits: TacticHit[] = [];
  const givesCheck = !!oppKing && isAttacked(after, oppKing[0], oppKing[1], me);

  // 闪将：被将军，且存在一个「非走动的子」的 checker 因让线而成将（checker 限车 / 炮）
  if (givesCheck && oppKing) {
    const discovered = attackersOf(after, oppKing, me).some(
      (c) => !samePos(c, move.to) && isLinePiece(after, c) && openedLine(c, oppKing, move.from),
    );
    if (discovered) hits.push({ kind: 'discovered-check', label: '闪将', actors: [], threats: [oppKing] });
  }

  // 将军抽：走动的子本身发出将军，且同时攻击敌方的马 / 车 / 炮
  if (oppKing && attacks(after, move.to, oppKing)) {
    const forked = piecesOf(after, opp).filter(
      ({ pos, piece }) => isWorth(piece.t) && attacks(after, move.to, pos),
    );
    if (forked.length) {
      const best = forked.reduce((a, b) => (VALUE[b.piece.t] > VALUE[a.piece.t] ? b : a));
      hits.push({
        kind: 'check-fork',
        label: `将军抽${PIECE_CN[best.piece.t]}`,
        actors: [move.to],
        threats: forked.map((f) => f.pos),
      });
    }
  }

  // 串打：走动的车 / 炮形成「前子之后还有一枚更值得捉的敌子」
  if (moved.t === 'R' || moved.t === 'C') {
    const rays = skewerRays(after, move.to, moved.t, opp);
    if (rays.length) {
      hits.push({ kind: 'skewer', label: '串打', actors: [move.to], threats: rays.flat() });
    }
  }

  // 捉双：走动的子同时攻击两枚及以上「值得捉」的敌子（不含将）
  const valuable = piecesOf(after, opp).filter(
    ({ pos, piece }) => isWorth(piece.t) && attacks(after, move.to, pos),
  );
  if (valuable.length >= 2) {
    hits.push({ kind: 'fork', label: '捉双', actors: [move.to], threats: valuable.map((f) => f.pos) });
  }

  // 闪击：让线后新威胁到的敌方子（非将），攻击者为非走动的直线子力
  const threats: Pos[] = [];
  const actors: Pos[] = [];
  for (const { pos, piece } of piecesOf(after, opp)) {
    if (piece.t === 'K') continue;
    if (!attackersOf(after, pos, me).length) continue;
    if (attackersOf(before, pos, me).length) continue; // 须为「新攻击」
    const actor = attackersOf(after, pos, me).find(
      (a) => !samePos(a, move.to) && isLinePiece(after, a) && openedLine(a, pos, move.from),
    );
    if (actor) {
      threats.push(pos);
      actors.push(actor);
    }
  }
  if (threats.length) {
    hits.push({ kind: 'discovered-attack', label: '闪击', actors, threats });
  }

  hits.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  return hits.slice(0, 1);
}
