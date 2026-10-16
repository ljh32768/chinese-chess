/**
 * 共享战术模块（纯函数，无 DOM / 网络依赖，便于单元测试）。包含两部分：
 *
 * 1) 吃子提示分析：站在某一方（`side`）的视角给出两类位置：
 *    - `targets`（绿色）：**可以吃掉的对方棋子**——该子「无根」（不被对方自己的子保护，吃掉后不会被反吃），
 *      或「小换大」（用价值更小的己方子去吃它，即使它有根，一换一后仍净赚）。
 *    - `threats`（红色）：**会被对方吃掉的己方棋子**——与上面完全对称（把视角换成对方即可）。
 *
 *    判定只做「一手」的静态估值（本项目提示性功能，非权威判定）：
 *    1. 己方有棋子能**合法**走到目标点（`legalMoves` 已过滤送将 / 照面）；
 *    2. 目标点是否被对方保护用 `isAttacked` 判断（含将帅照面，按伪合法走法，不考虑牵制）；
 *    3. 帅 / 将不参与提示（将帅照面由规则的将军判定负责）。
 *
 * 2) 战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）：走子后给出「战术提示」的标签与被威胁的棋子。
 *    纯函数，复用 `shared/rules.ts` 的走法与攻击判定，便于单测；只做**启发式提示**，
 *    不参与任何规则 / 胜负判定。判定口径见 ADR-0007 §3.5.7。
 *    凡「攻击多子」类战术（将军抽 / 串打 / 捉双）都要求**两者必然失去其一**：对方无论怎样应着，
 *    都至少有一枚被攻击的子仍会被吃到（排除「被攻击子反吃攻击子」「垫子挡线」「移走炮架」等可两全的伪战术）。
 */

import { cloneBoard, findKing, isAttacked, legalMoves, pieceMoves, sideHasAnyMove } from './rules.js';
import { Board, COLS, Move, Piece, PieceType, Pos, ROWS, Side } from './types.js';

/* ============================ 一、吃子提示分析 ============================ */

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

/* ============================== 二、战术识别 ============================== */

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
 * 对方（`opp`）在当前局面下的全部合法应着（每种应着各返回一份局面副本）。
 * 用于「两者必然失去其一」验证：逐个模拟对方的每一种应着。
 */
function repliesOf(board: Board, opp: Side): Board[] {
  const out: Board[] = [];
  for (let r = 0; r < board.length; r++) {
    for (let c = 0; c < board[r].length; c++) {
      const p = board[r][c];
      if (!p || p.s !== opp) continue;
      for (const [tr, tc] of legalMoves(board, r, c)) {
        const nb = cloneBoard(board);
        nb[tr][tc] = nb[r][c];
        nb[r][c] = null;
        out.push(nb);
      }
    }
  }
  return out;
}

/**
 * 「两者必然失去其一」：走子方在 `actor` 处的子，是否能在对方**任意**应着之后，
 * 仍然**获利**吃到 `targets` 中至少一枚（该目标须仍是对方的子）。
 * 获利口径与吃子提示一致：目标「无根」或「小换大」（目标价值 > 攻击子价值）。
 * 据此排除四类「可两全」的伪战术：被攻击子反吃攻击子、垫子挡住射线、移走炮架、
 * 以及**有根**的棋——对方可弃子反吃（等价或不划算）而两全。
 */
function mustLoseOne(board: Board, actor: Pos, targets: Pos[], me: Side): boolean {
  const opp = other(me);
  const mine = board[actor[0]][actor[1]];
  if (!mine || mine.s !== me || !targets.length) return false;
  const replies = repliesOf(board, opp);
  if (!replies.length) return false; // 对方已无着法（将死 / 困毙），交由正中圆环表达
  for (const nb of replies) {
    const still = nb[actor[0]][actor[1]];
    if (!still || still.s !== me) return false; // 攻击子被吃 → 被攻击子全部保住
    const actorValue = VALUE[still.t];
    const hit = targets.some((t) => {
      const tp = nb[t[0]][t[1]];
      if (!tp || tp.s !== opp || !attacks(nb, actor, t)) return false;
      // 有根（受对方保护）且不是「小换大」→ 对方可弃子后被反吃而两全，不计为必失
      return !isDefended(nb, opp, t) || VALUE[tp.t] > actorValue;
    });
    if (!hit) return false;
  }
  return true;
}

/**
 * 车 / 炮的「串打」射线：某方向上「前一子之后还有一枚值得捉的敌子」，
 * 且前 / 后两子都值得捉（马及以上）。返回每条射线上 [前子, 后子] 的坐标。
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
    if (
      front &&
      back &&
      front.piece.s === opp &&
      back.piece.s === opp &&
      isWorth(front.piece.t) &&
      isWorth(back.piece.t)
    ) {
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

  // 将军抽：走动的子本身发出将军，且同时新攻击敌方的马 / 车 / 炮，对方无法两全（必失其一）
  if (oppKing && attacks(after, move.to, oppKing)) {
    const forked = piecesOf(after, opp).filter(
      ({ pos, piece }) => isWorth(piece.t) && attacks(after, move.to, pos),
    );
    if (
      forked.length &&
      mustLoseOne(
        after,
        move.to,
        forked.map((f) => f.pos),
        me,
      )
    ) {
      const best = forked.reduce((a, b) => (VALUE[b.piece.t] > VALUE[a.piece.t] ? b : a));
      hits.push({
        kind: 'check-fork',
        label: `将军抽${PIECE_CN[best.piece.t]}`,
        actors: [move.to],
        threats: forked.map((f) => f.pos),
      });
    }
  }

  // 串打：走动的车 / 炮沿同一条射线攻击两枚值得捉的敌子，且对方无法两全（必失其一）
  if (moved.t === 'R' || moved.t === 'C') {
    const ray = skewerRays(after, move.to, moved.t, opp).find(([front, back]) =>
      mustLoseOne(after, move.to, [front, back], me),
    );
    if (ray) {
      hits.push({ kind: 'skewer', label: '串打', actors: [move.to], threats: ray });
    }
  }

  // 捉双：走动的子同时攻击两枚及以上「值得捉」的敌子（不含将），且对方无法两全（必失其一）
  const valuable = piecesOf(after, opp).filter(
    ({ pos, piece }) => isWorth(piece.t) && attacks(after, move.to, pos),
  );
  if (
    valuable.length >= 2 &&
    mustLoseOne(
      after,
      move.to,
      valuable.map((f) => f.pos),
      me,
    )
  ) {
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
