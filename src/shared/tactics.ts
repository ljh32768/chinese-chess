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
 *    2. 目标点是否被对方保护（「有根」）——把目标点换成**我方真正用来吃子的那枚子**后，
 *       看对方能否回头反吃：将/帅以外的子按伪合法走法（不考虑牵制）判一次；
 *       **将/帅须能「合法」吃回**——吃回后自身不被将军 / 不照面，否则不算根（将守护的子若将不能安全吃回，按无根处理）；
 *    3. 帅 / 将不参与提示（将帅照面由规则的将军判定负责）。
 *
 * 2) 战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）：走子后给出「战术提示」的标签与被威胁的棋子。
 *    纯函数，复用 `shared/rules.ts` 的走法与攻击判定，便于单测；只做**启发式提示**，
 *    不参与任何规则 / 胜负判定。判定口径见 ADR-0007 §3.5.7。
 *    严格判定顺序：**先看是否照将**——照将走「闪将 / 将军抽」分支（只将军 = 闪将；将军 + 捉大子 = 将军抽），
 *    不照将走「串打 / 捉双 / 闪击」分支。
 *    「将军抽」的将军来源可为**直接将军或闪将**，被抽子可为**走子后直接攻击到的大子**，
 *    也可为**被照之将同线后方的大子**（对方应将、将移开该线后即落入照将直线子的攻击口——经典抽将）。
 *    **被抽子须是这一步新造的威胁**——走子前我方就已能获利吃到的子与这步将军无关，不算「抽」。
 *    凡「攻击多子」类战术（将军抽 / 串打 / 捉双）都要求**两者必然失去其一**，且**必须真能获利吃到**：
 *    对方无论怎样应着，都至少有一枚被攻击的子仍会被吃到，而这个「吃到」按**获利口径**
 *    （无根白吃 / 小换大，与吃子提示 `profitableTargets` 一致）成立——
 *    据此排除「被攻击子反吃攻击子」「垫子挡线」「移走炮架」以及**有根且不划算**等可两全的伪战术
 *    （对方弃子反吃即可两全，我方并未得子）。「获利口径」对将军抽 / 串打 / 捉双一视同仁。
 *    「闪击」= **双向双威胁**：挡路子移开后，① 后方强子（车 / 炮）的攻击线显露、新威胁到敌方子；
 *    ② **移开的这枚子自身也带威胁**（走子后捉到、且走子前我方并未攻击的大子）。两条件缺一不可——
 *    只让线、移开的子自身不捉子（如躲子 / 闲走）不判闪击。
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
 * 判断 `enemy` 在 `at` 处的棋子是否「有根」（被己方棋子保护）。
 *
 * 做法：把 `at` 上的敌子换成**我方真正会用来吃它的那枚子**（`byPos`，即最便宜的合法攻击者），
 * 并把该进攻子的原格清空（模拟「它已经吃过去」），再看 `enemy` 能否回头反吃：
 * - 将/帅以外的子：按**伪合法**走法判一次即可（沿用旧口径，不考虑牵制）；
 * - 将/帅：须能**合法**吃回——吃回后自身不能处于被将军状态（送将非法，含照面）。
 *   若将/帅是唯一保护者且吃回会被将军，则该子实为无根。
 *
 * 用「进攻子占位」而不是空格 / 原盘面：空格会让炮被误判为有根（炮吃子需炮架），
 * 原盘面上的己方子会被 `pieceMoves` 当成己方子跳过（误判为无根）；
 * 而把进攻子真正搬到 `at`（而非留在原地），可避免它在「将吃回后是否被将军」的判定里被重复计入。
 */
function isDefended(board: Board, enemy: Side, at: Pos, byPos: Pos): boolean {
  const probe = cloneBoard(board);
  const attacker = probe[byPos[0]][byPos[1]];
  if (!attacker) return false;
  probe[at[0]][at[1]] = attacker; // 进攻子吃掉 at 上的敌子并落于 at
  probe[byPos[0]][byPos[1]] = null; // 进攻子原格清空
  const us = other(enemy);

  // 1) 将/帅以外的子：伪合法能吃到 at 即算「有根」
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = probe[r][c];
      if (!p || p.s !== enemy || p.t === 'K') continue;
      if (pieceMoves(probe, r, c).some(([rr, cc]) => rr === at[0] && cc === at[1])) return true;
    }
  }

  // 2) 将/帅：须能合法吃回（吃回后自身不被将军 / 不照面），否则不算「根」
  const king = findKing(probe, enemy);
  if (king && pieceMoves(probe, king[0], king[1]).some(([rr, cc]) => rr === at[0] && cc === at[1])) {
    const nb = cloneBoard(probe);
    nb[at[0]][at[1]] = nb[king[0]][king[1]];
    nb[king[0]][king[1]] = null;
    if (!isAttacked(nb, at[0], at[1], us)) return true;
  }
  return false;
}

/**
 * 从 `side` 视角列出「可获利吃掉」的对方棋子位置。
 * 对每个对方棋子（不含将帅）所在点 S：
 * - 己方有子能合法吃到 S（取其中最便宜的一枚，并记下它的位置），否则跳过；
 * - S 未被对方保护（无根）→ 白吃，计入；
 * - S 有保护但该子价值 > 最便宜攻击者的价值 → 小换大，计入。
 */
export function profitableTargets(board: Board, side: Side): Pos[] {
  const enemy = other(side);
  // 一次性算好该方所有合法着法，记下每个落点「最便宜的攻击者」的价值与位置（避免逐目标重复搜索）
  const cheapest = new Map<string, { value: number; pos: Pos }>();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p || p.s !== side) continue;
      const value = PIECE_VALUE[p.t];
      for (const to of legalMoves(board, r, c)) {
        const k = key(to);
        const cur = cheapest.get(k);
        if (cur === undefined || value < cur.value) cheapest.set(k, { value, pos: [r, c] });
      }
    }
  }

  const out: Pos[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const target = board[r][c];
      if (!target || target.s !== enemy || target.t === 'K') continue;
      const best = cheapest.get(key([r, c]));
      if (!best) continue;
      // 有根判定须带上「我方会用来吃它的那枚子」，才能正确判断将/帅吃回是否会被将军
      const defended = isDefended(board, enemy, [r, c], best.pos);
      if (!defended || PIECE_VALUE[target.t] > best.value) out.push([r, c]);
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
 * 局面 `board` 中 `side` 当前「可获利吃到」的敌子位置键集合（无根白吃 / 小换大）。
 * 直接复用吃子提示的 `profitableTargets`，保证战术的「能吃到」口径与绿环提示完全一致。
 */
function winnableKeys(board: Board, side: Side): Set<string> {
  return new Set(profitableTargets(board, side).map(key));
}

/**
 * 「两者必然失去其一」且**必能获利吃到**：走子方在 `actor` 处的子，在对方**任意**应着之后，
 * 都至少有一枚 `targets` 中的子「仍被 `actor` 攻击」且「按获利口径真能吃到」
 * （`actor` 吃它无根白吃，或该子价值 > `actor` 价值即小换大）。
 * 据此排除五类「可两全」的伪战术：被攻击子反吃攻击子、垫子挡住射线、移走炮架，
 * 以及**有根且不划算**的棋——对方可弃子反吃（等价甚至赚）而两全，我方并未得子。
 * @param replies 对方全部合法应着局面（调用方一次性算好并复用，见 `detectTactics`）
 */
function mustLoseOne(replies: Board[], actor: Pos, targets: Pos[], me: Side): boolean {
  const opp = other(me);
  if (!targets.length || !replies.length) return false; // 对方已无着法（将死 / 困毙），交由正中圆环表达
  for (const nb of replies) {
    const still = nb[actor[0]][actor[1]];
    if (!still || still.s !== me) return false; // 攻击子被吃 → 被攻击子全部保住
    const actorValue = VALUE[still.t];
    const hit = targets.some((t) => {
      const tp = nb[t[0]][t[1]];
      if (!tp || tp.s !== opp || !attacks(nb, actor, t)) return false;
      // 有根（受对方保护）且不是「小换大」→ 对方弃子反吃即可两全，不计为必失
      return !isDefended(nb, opp, t, actor) || VALUE[tp.t] > actorValue;
    });
    if (!hit) return false;
  }
  return true;
}

/**
 * 将军抽用：`target`（某一位置）在对方**每一种**应着之后都仍能被走子方**获利吃到**
 * （无根白吃 / 小换大，与吃子提示同口径）。
 * 与 `mustLoseOne` 的区别：被抽子可由我方**任意**子吃下（走动的子、被让线的后方子力，
 * 乃至将移开后重新落入攻击口的直线子），不限于某一枚子，故按位置键判定即可。
 * @param wins 与对方各应着局面一一对应的「我方此时可获利吃到的敌子位置键」集合
 */
function unavoidablyLost(wins: Array<Set<string>>, target: Pos): boolean {
  if (!wins.length) return false; // 对方已无着法（将死 / 困毙），交由正中圆环表达
  return wins.every((w) => w.has(key(target)));
}

/**
 * 照将的直线子（车 / 炮）与被照之将同线时，返回将被照之将**同线后方**的第一枚敌方大子（车 / 马 / 炮）。
 * 对方应将、将移开该线后，此子即落入该直线子的攻击口——经典「抽将」（将军抽子）的得子对象。
 * 非同行 / 同列（马 / 兵照将）无「线后」可言，返回 null。
 */
function behindKingVictim(board: Board, checker: Pos, king: Pos, opp: Side): Pos | null {
  if (checker[0] !== king[0] && checker[1] !== king[1]) return null; // 须同行 / 同列
  const dr = Math.sign(king[0] - checker[0]);
  const dc = Math.sign(king[1] - checker[1]);
  let r = king[0] + dr;
  let c = king[1] + dc;
  while (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
    const p = board[r][c];
    if (p) return p.s === opp && isWorth(p.t) ? [r, c] : null;
    r += dr;
    c += dc;
  }
  return null;
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

  // 「两者必然失去其一」验证要逐个模拟对方的每一种合法应着（较贵），只在实际需要时算一次
  let replies: Board[] | null = null;
  const repliesOnce = (): Board[] => replies ?? (replies = repliesOf(after, opp));
  // 每种应着局面下「我方此时可获利吃到的敌子位置键」，与 repliesOnce() 一一对应（将军抽用）
  let wins: Array<Set<string>> | null = null;
  const winsOnce = (): Array<Set<string>> => wins ?? (wins = repliesOnce().map((nb) => winnableKeys(nb, me)));

  // 走子前「可获利吃到的敌子位置键」——将军抽只认**这一步新造**的得子威胁
  let winsBefore: Set<string> | null = null;
  const winsBeforeOnce = (): Set<string> => winsBefore ?? (winsBefore = winnableKeys(before, me));

  // 严格判定顺序：先看是否照将——照将走「闪将 / 将军抽」分支，否则走「串打 / 捉双 / 闪击」分支。
  if (givesCheck && oppKing) {
    // 将军抽（将军抽车 / 马 / 炮）：本着一身二任——将军（直接将军或闪将）+ 同时捉大子，对方必失其一。
    // 被抽子两类：① 走子后直接攻击到的敌方大子（车 / 马 / 炮，攻击者可为走动的子或后方子力）；
    //             ② 被照之将同线后方的大子（将移开后落入照将直线子的攻击口——经典抽将）。
    // 两类都须是**这一步新造**的威胁：走子前就已能获利吃到的子（我方原本就有的攻击）与这步将军无关，
    // 不构成「抽」——否则「本来就白吃着的子 + 任意一步将军」都会被误报成将军抽。
    const candidates: Array<{ pos: Pos; piece: Piece }> = [];
    for (const { pos, piece } of piecesOf(after, opp)) {
      if (!isWorth(piece.t) || !isAttacked(after, pos[0], pos[1], me)) continue;
      if (winsBeforeOnce().has(key(pos))) continue; // 走子前已可获利吃到 → 非本步新威胁
      candidates.push({ pos, piece });
    }
    for (const checker of attackersOf(after, oppKing, me)) {
      if (!isLinePiece(after, checker)) continue; // 只有直线子（车 / 炮）才有「将后同线」
      const victim = behindKingVictim(after, checker, oppKing, opp);
      if (!victim) continue;
      if (winsBeforeOnce().has(key(victim))) continue; // 同上：走子前已可获利吃到 → 非本步新威胁
      const p = after[victim[0]][victim[1]];
      if (p) candidates.push({ pos: victim, piece: p });
    }
    // 去重后逐个验证「对方必失其一」——被抽子须在对方每种应着后都仍能被我方获利吃到
    const w = winsOnce();
    const seen = new Set<string>();
    const lost = candidates.filter(({ pos }) => {
      const k = key(pos);
      if (seen.has(k)) return false;
      seen.add(k);
      return unavoidablyLost(w, pos);
    });
    if (lost.length) {
      const best = lost.reduce((a, b) => (VALUE[b.piece.t] > VALUE[a.piece.t] ? b : a));
      hits.push({
        kind: 'check-fork',
        label: `将军抽${PIECE_CN[best.piece.t]}`,
        actors: [move.to],
        threats: lost.map((c) => c.pos),
      });
    } else {
      // 闪将：只将军、未同时捉大子——存在一个「非走动的子」的 checker 因让线而成将（checker 限车 / 炮）
      const discovered = attackersOf(after, oppKing, me).some(
        (c) => !samePos(c, move.to) && isLinePiece(after, c) && openedLine(c, oppKing, move.from),
      );
      if (discovered) hits.push({ kind: 'discovered-check', label: '闪将', actors: [], threats: [oppKing] });
    }
  } else {
    // 串打：走动的车 / 炮沿同一条射线攻击两枚值得捉的敌子，且对方无法两全（必失其一、且能获利吃到）
    if (moved.t === 'R' || moved.t === 'C') {
      const ray = skewerRays(after, move.to, moved.t, opp).find(([front, back]) =>
        mustLoseOne(repliesOnce(), move.to, [front, back], me),
      );
      if (ray) {
        hits.push({ kind: 'skewer', label: '串打', actors: [move.to], threats: ray });
      }
    }

    // 捉双：走动的子同时攻击两枚及以上「值得捉」的敌子（不含将），且对方无法两全（必失其一、且能获利吃到）
    const valuable = piecesOf(after, opp).filter(
      ({ pos, piece }) => isWorth(piece.t) && attacks(after, move.to, pos),
    );
    if (
      valuable.length >= 2 &&
      mustLoseOne(
        repliesOnce(),
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
    // 闪击 = **双向**双威胁：让线后后方子力显露的攻击之外，「移开的棋子」自身也必须带威胁
    // （走子后捉到的、走子前我方并未攻击的大子）。只让线、移开的子自身什么也不捉（如躲子 / 闲走）
    // 只是单纯让线，不构成闪击。（「将」由闪将分支负责；「献子」等无法静态判定的从略。）
    const moverThreats = threats.length
      ? piecesOf(after, opp).filter(
          ({ pos, piece }) =>
            isWorth(piece.t) && attacks(after, move.to, pos) && attackersOf(before, pos, me).length === 0,
        )
      : [];
    if (moverThreats.length) {
      const all = [...threats];
      for (const { pos } of moverThreats) if (!all.some((t) => samePos(t, pos))) all.push(pos);
      hits.push({ kind: 'discovered-attack', label: '闪击', actors, threats: all });
    }
  }

  hits.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  return hits.slice(0, 1);
}
