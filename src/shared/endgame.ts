/**
 * 残局挑战：内置题库 + 「强制将死」求解器（纯 TS，无 DOM / 网络 / Node 依赖）。
 *
 * - 题库：每道残局给出初始局面、玩家执子方与目标步数（玩家自己的着法数以内将死对方）。
 *   局面均为「先手方取胜」的杀局，配套 `findMateMove()` 可给出正解首着（客户端「提示」按钮）。
 * - 求解器：`canForceMate()` / `findMateMove()` 用「我方着法 → 对方所有应着 → 递归」的方式判定
 *   是否存在不论对方如何应对都能在 N 步内将死的强制杀法；对方无着可走（将死或困毙）即算取胜。
 * - 题库由测试逐条校验：确为强制杀（`canForceMate(goalMoves)`）且步数不能再少（`goalMoves` 为最小步数）。
 * - 自检：`checkPuzzle()` / `checkEndgameBank()` 复用同一求解器与规则引擎，对题库逐条核验
 *   局面合法性 / 可解性 / 目标步数是否最少，供界面「自检」与新增题目时排查（纯函数，无副作用）。
 *
 * 棋盘坐标：10 行 9 列，黑方在上（九宫 0~2 行）、红方在下（九宫 7~9 行）。
 */

import { isAttacked, isInCheck, pieceMoves, sideHasAnyMove } from './rules.js';
import { Board, Cell, Move, PieceType, Pos, ROWS, COLS, Side } from './types.js';

/** 难度档位 */
export type EndgameLevel = 'easy' | 'medium' | 'hard';

/** 难度档位中文名（列表分组用） */
export const LEVEL_LABEL: Record<EndgameLevel, string> = {
  easy: '入门',
  medium: '中等',
  hard: '困难',
};

/** 难度档位顺序（列表按此排序） */
export const LEVEL_ORDER: readonly EndgameLevel[] = ['easy', 'medium', 'hard'];

/** 一道残局 */
export interface EndgamePuzzle {
  /** 稳定标识（通关记录按 id 保存） */
  id: string;
  /** 残局名（沿用经典杀法名，如「马后炮」） */
  name: string;
  level: EndgameLevel;
  /** 玩家执子方（残局一律先手方取胜） */
  side: Side;
  /** 目标步数：在 side 的 goalMoves 步以内将死对方 */
  goalMoves: number;
  /** 一句话要点（面板展示） */
  intro: string;
  /** 初始局面：[行, 列, 棋子类型, 阵营] */
  pieces: Array<[number, number, PieceType, Side]>;
}

/**
 * 内置题库（入门 = 一步杀；中等 = 两步杀；困难 = 三步杀）。
 * 局面均为本项目自建（经典基本杀法的标准构图），坐标见文件头；
 * 每条都经测试用求解器校验「可解且步数不能再少」。
 */
export const PUZZLES: EndgamePuzzle[] = [
  {
    id: 'bailianjiang',
    name: '对面笑',
    level: 'easy',
    side: 'r',
    goalMoves: 1,
    intro: '车沉到将的同一纵线上将军：黑将只剩一条横线可走，而这条线正与红帅同线——照面禁着，白脸将杀。',
    pieces: [
      [0, 4, 'K', 'b'],
      [0, 2, 'P', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [8, 0, 'R', 'r'],
    ],
  },
  {
    id: 'wocaoma',
    name: '卧槽马',
    level: 'easy',
    side: 'r',
    goalMoves: 1,
    intro: '马跳卧槽位（对方二路的三、七路交点）将军，过河兵守住将门，黑将被自家士堵死。',
    pieces: [
      [0, 4, 'K', 'b'],
      [0, 3, 'A', 'b'],
      [0, 5, 'A', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [2, 0, 'N', 'r'],
    ],
  },
  {
    id: 'guajiaoma',
    name: '挂角马',
    level: 'easy',
    side: 'r',
    goalMoves: 1,
    intro: '马跳到对方九宫士角将军，过河兵封住将门与中路，黑将左右都是自家士，无路可逃。',
    pieces: [
      [0, 4, 'K', 'b'],
      [0, 3, 'A', 'b'],
      [0, 5, 'A', 'b'],
      [9, 5, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [4, 4, 'N', 'r'],
    ],
  },
  {
    id: 'chongpao',
    name: '重炮',
    level: 'easy',
    side: 'r',
    goalMoves: 1,
    intro: '前炮立于将前作炮架，后炮平到同一纵线将军：双炮重叠，将既躲不开炮线，也够不着前炮。',
    pieces: [
      [0, 4, 'K', 'b'],
      [2, 3, 'P', 'b'],
      [9, 3, 'K', 'r'],
      [1, 5, 'P', 'r'],
      [2, 2, 'N', 'r'],
      [2, 4, 'C', 'r'],
      [6, 0, 'C', 'r'],
    ],
  },
  {
    id: 'shuangchecuo',
    name: '双车错',
    level: 'easy',
    side: 'r',
    goalMoves: 1,
    intro: '双车分占两线：一车沉底将军、一车横封将门，黑将顾此失彼，即「长短车」。',
    pieces: [
      [0, 4, 'K', 'b'],
      [2, 3, 'P', 'b'],
      [9, 3, 'K', 'r'],
      [1, 0, 'R', 'r'],
      [2, 8, 'R', 'r'],
    ],
  },
  {
    id: 'jieshuaifengmen',
    name: '借帅封门',
    level: 'medium',
    side: 'r',
    goalMoves: 2,
    intro: '先用车上到将门将军，逼黑士填在将前；再把红帅平到与将同线——用「照面」封住黑将最后一条退路。',
    pieces: [
      [0, 4, 'K', 'b'],
      [0, 3, 'A', 'b'],
      [0, 5, 'A', 'b'],
      [9, 4, 'K', 'r'],
      [6, 2, 'R', 'r'],
      [7, 4, 'N', 'r'],
    ],
  },
  {
    id: 'chema-chengsha',
    name: '车马成杀',
    level: 'medium',
    side: 'r',
    goalMoves: 2,
    intro: '车沉底将军，黑士被迫填塞；马从低位跳上去，在马后炮的位置封死黑将。',
    pieces: [
      [0, 4, 'K', 'b'],
      [1, 4, 'A', 'b'],
      [9, 3, 'K', 'r'],
      [9, 6, 'R', 'r'],
      [5, 4, 'N', 'r'],
    ],
  },
  {
    id: 'chepao-lengzhao',
    name: '车炮冷着',
    level: 'hard',
    side: 'r',
    goalMoves: 3,
    intro: '车先上到将的底路牵住黑士，再借助红帅占中、车平将门的次序，一步步收紧，三步成杀。',
    pieces: [
      [0, 4, 'K', 'b'],
      [0, 3, 'A', 'b'],
      [9, 3, 'K', 'r'],
      [5, 0, 'R', 'r'],
      [7, 7, 'C', 'r'],
    ],
  },
  {
    id: 'chema-cansha',
    name: '车马残杀',
    level: 'hard',
    side: 'r',
    goalMoves: 3,
    intro: '车在底线来回抽将，把黑将逼上顶线；马在侧翼控住退路，三步之内取将。',
    pieces: [
      [0, 4, 'K', 'b'],
      [2, 5, 'A', 'b'],
      [9, 3, 'K', 'r'],
      [9, 2, 'R', 'r'],
      [7, 7, 'N', 'r'],
    ],
  },
];

/** 按 id 取残局（不存在返回 null） */
export function findPuzzle(id: string): EndgamePuzzle | null {
  return PUZZLES.find((p) => p.id === id) ?? null;
}

/** 列表中 id 的下一关（已是最后一关返回 null） */
export function nextPuzzle(id: string): EndgamePuzzle | null {
  const i = PUZZLES.findIndex((p) => p.id === id);
  return i >= 0 && i + 1 < PUZZLES.length ? PUZZLES[i + 1] : null;
}

/** 由题库条目构造初始棋盘（空格为 null） */
export function buildPuzzleBoard(p: EndgamePuzzle): Board {
  const board: Board = Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
  for (const [r, c, t, s] of p.pieces) board[r][c] = { t, s };
  return board;
}

// ------------------------------------------------------------------ 求解器

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');

/**
 * 生成某方全部合法着法（已过滤送将 / 将帅照面）。
 * 与 ai.ts 同一思路：就地试走 + isAttacked 还原，避免深拷贝棋盘。
 */
function genMoves(b: Board, side: Side): Move[] {
  const res: Move[] = [];
  const opp = other(side);
  const king = findKingPos(b, side);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (!p || p.s !== side) continue;
      const isKing = p.t === 'K';
      for (const [tr, tc] of pieceMoves(b, r, c)) {
        const captured = b[tr][tc];
        b[tr][tc] = p;
        b[r][c] = null;
        const kp: Pos | null = isKing ? [tr, tc] : king;
        const bad = !kp || isAttacked(b, kp[0], kp[1], opp);
        b[r][c] = p;
        b[tr][tc] = captured;
        if (!bad) res.push({ from: [r, c], to: [tr, tc] });
      }
    }
  }
  return res;
}

/** 找将/帅位置（本地实现，避免与 rules 重复导出） */
function findKingPos(b: Board, side: Side): Pos | null {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      if (p && p.t === 'K' && p.s === side) return [r, c];
    }
  }
  return null;
}

/** 走一步（原地），返回被吃棋子（撤销用） */
function play(b: Board, m: Move): Cell {
  const captured = b[m.to[0]][m.to[1]];
  b[m.to[0]][m.to[1]] = b[m.from[0]][m.from[1]];
  b[m.from[0]][m.from[1]] = null;
  return captured;
}

/** 撤销 play */
function unplay(b: Board, m: Move, captured: Cell): void {
  b[m.from[0]][m.from[1]] = b[m.to[0]][m.to[1]];
  b[m.to[0]][m.to[1]] = captured;
}

/** 局面键（棋盘 + 行棋方 + 剩余步数），用于置换缓存 */
function positionKey(b: Board, side: Side, moves: number): string {
  let s = `${side}${moves}|`;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = b[r][c];
      s += p ? `${p.s}${p.t}` : '.';
    }
  }
  return s;
}

/**
 * 我方（side）能否在自己的 moves 步以内，不论对方如何应对都强制取胜。
 * 对方无着可走（将死或困毙）即判我方胜。
 */
function forceMate(b: Board, side: Side, moves: number, cache: Map<string, boolean>): boolean {
  if (moves <= 0) return false;
  const key = positionKey(b, side, moves);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const opp = other(side);
  let result = false;
  for (const m of genMoves(b, side)) {
    const captured = play(b, m);
    if (genMoves(b, opp).length === 0) {
      result = true; // 对方无着可走：将死或困毙，我方胜
    } else if (moves > 1) {
      // 对方所有应着都必须仍然被我在 moves-1 步内强制将死
      let holds = true;
      for (const reply of genMoves(b, opp)) {
        const cap2 = play(b, reply);
        const stillMate = forceMate(b, side, moves - 1, cache);
        unplay(b, reply, cap2);
        if (!stillMate) {
          holds = false;
          break;
        }
      }
      if (holds) result = true;
    }
    unplay(b, m, captured);
    if (result) break;
  }
  cache.set(key, result);
  return result;
}

/** 该方能否在 moves 步内强制将死对方（moves 为自身着法数，1 表示一步杀） */
export function canForceMate(board: Board, side: Side, moves: number): boolean {
  return forceMate(cloneForSolve(board), side, Math.floor(moves), new Map<string, boolean>());
}

/**
 * 求解正解首着：返回可在 moves 步内强制将死的一步；无解返回 null。
 * 客户端「提示」按剩余步数调用，既能给出正解着法，也能判断玩家是否已走离杀棋。
 */
export function findMateMove(board: Board, side: Side, moves: number): Move | null {
  const b = cloneForSolve(board);
  const n = Math.floor(moves);
  if (n <= 0) return null;
  const cache = new Map<string, boolean>();
  const opp = other(side);
  for (const m of genMoves(b, side)) {
    const captured = play(b, m);
    let ok: boolean;
    if (genMoves(b, opp).length === 0) {
      ok = true;
    } else if (n > 1) {
      ok = true;
      for (const reply of genMoves(b, opp)) {
        const cap2 = play(b, reply);
        const stillMate = forceMate(b, side, n - 1, cache);
        unplay(b, reply, cap2);
        if (!stillMate) {
          ok = false;
          break;
        }
      }
    } else {
      ok = false;
    }
    unplay(b, m, captured);
    if (ok) return m;
  }
  return null;
}

/** 求解不修改调用方棋盘（内部就地试走，故先深拷贝） */
function cloneForSolve(board: Board): Board {
  return board.map((row) => row.map((p) => (p ? { t: p.t, s: p.s } : null)));
}

/**
 * 从当前局面出发，最少几步可强制取胜（返回步数；max 步以内无解返回 0）。
 * 残局不限步数，配合 `findMateMove()` 可在任意局面给出「仍能取胜」的最快着法
 * （`minMateDepth` 返回的步数即该着法所需步数，也是当前局面的最优步数）。
 */
export function minMateDepth(board: Board, side: Side, max: number): number {
  const cap = Math.floor(max);
  for (let d = 1; d <= cap; d++) if (canForceMate(board, side, d)) return d;
  return 0;
}

// ------------------------------------------------------------------ 题库自检

/** 一道残局的自检结果 */
export interface PuzzleCheck {
  id: string;
  name: string;
  level: EndgameLevel;
  /** 自检是否全部通过（problems 为空） */
  ok: boolean;
  /** 是否能在目标步数内强制取胜 */
  solvable: boolean;
  /** 目标步数是否为最少步数（少一步即不可解） */
  minimal: boolean;
  /** 自检发现的问题（空数组表示通过） */
  problems: string[];
}

/**
 * 逐条核验一道残局：局面合法、目标步数内可强制取胜、且步数不能再少。
 * 复用规则引擎 + 求解器，不修改传入数据；新增题目时可用它先自检再入库。
 */
export function checkPuzzle(p: EndgamePuzzle): PuzzleCheck {
  const problems: string[] = [];
  const seen = new Set<string>();
  let redKing = false;
  let blackKing = false;
  // 数据层：越界 / 重叠 / 缺将 / 步数——有问题时不构建棋盘（越界会导致构建失败）
  for (const [r, c, t, s] of p.pieces) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) problems.push(`棋子越界：行 ${r} 列 ${c}`);
    const key = `${r},${c}`;
    if (seen.has(key)) problems.push(`棋子重叠：行 ${r} 列 ${c}`);
    seen.add(key);
    if (t === 'K' && s === 'r') redKing = true;
    if (t === 'K' && s === 'b') blackKing = true;
  }
  if (!redKing) problems.push('缺少红帅');
  if (!blackKing) problems.push('缺少黑将');
  if (p.goalMoves < 1) problems.push('目标步数必须不少于 1 步');
  const base = { id: p.id, name: p.name, level: p.level, solvable: false, minimal: false };
  if (problems.length > 0) return { ...base, ok: false, problems };

  // 规则层：开局双方均未被将军、均未无子可走
  const board = buildPuzzleBoard(p);
  const opp = other(p.side);
  if (isInCheck(board, p.side)) problems.push('先手方开局被将军');
  if (isInCheck(board, opp)) problems.push('后手方开局被将军');
  if (!sideHasAnyMove(board, p.side)) problems.push('先手方开局无子可走');
  if (!sideHasAnyMove(board, opp)) problems.push('后手方开局已被将死 / 困毙');
  if (problems.length > 0) return { ...base, ok: false, problems };

  // 求解层：目标步数内可强制取胜，且步数不能再少，并给出正解首着
  const solvable = canForceMate(board, p.side, p.goalMoves);
  const minimal = solvable && (p.goalMoves === 1 || !canForceMate(board, p.side, p.goalMoves - 1));
  if (!solvable) problems.push(`无法在 ${p.goalMoves} 步内强制取胜`);
  if (solvable && !minimal) problems.push(`目标步数不是最少步数（${p.goalMoves - 1} 步即可取胜）`);
  if (solvable && !findMateMove(board, p.side, p.goalMoves)) problems.push('求解器给不出正解首着');

  return { ...base, solvable, minimal, ok: problems.length === 0, problems };
}

/** 题库整体自检：逐条核验（返回顺序与 PUZZLES 一致） */
export function checkEndgameBank(): PuzzleCheck[] {
  return PUZZLES.map(checkPuzzle);
}

// ------------------------------------------------------------------ 本机记录

/** 单局残局的完成情况：已完成 / 失败 / 未完成 */
export type EndgameOutcome = 'win' | 'fail' | 'todo';

/** 单局残局记录：取胜时的最少步数 / 是否曾失败（被将死 / 困毙） */
export interface EndgameRecord {
  /** 已通关：取胜时的最少步数（未通关为 undefined） */
  win?: number;
  /** 是否曾挑战失败（被将死 / 困毙） */
  fail?: boolean;
}

/** 解析本机残局记录 JSON（兼容旧版「id → 步数」数字格式，视为已通关；损坏数据按空处理） */
export function parseEndgameRecords(raw: string | null): Record<string, EndgameRecord> {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, EndgameRecord> = {};
    for (const [id, v] of Object.entries(data)) {
      if (typeof v === 'number' && v > 0) {
        out[id] = { win: v }; // 旧格式：数字 = 已通关的最少步数
        continue;
      }
      if (v && typeof v === 'object') {
        const o = v as { win?: unknown; fail?: unknown };
        const win = typeof o.win === 'number' && o.win > 0 ? o.win : undefined;
        const fail = o.fail === true;
        if (win !== undefined || fail) out[id] = { win, fail };
      }
    }
    return out;
  } catch {
    return {}; // 损坏数据按「未完成」处理
  }
}

/** 记录一次取胜（保留最少步数，并清除失败标记；不修改传入对象） */
export function recordWin(
  records: Record<string, EndgameRecord>,
  id: string,
  used: number,
): Record<string, EndgameRecord> {
  const best = records[id]?.win;
  return { ...records, [id]: { win: best !== undefined && best < used ? best : used } };
}

/** 记录一次失败（被将死 / 困毙）；已通关的局不再标记失败（不修改传入对象） */
export function recordFail(
  records: Record<string, EndgameRecord>,
  id: string,
): Record<string, EndgameRecord> {
  if (records[id]?.win !== undefined) return records;
  return { ...records, [id]: { fail: true } };
}

/** 完成情况（列表勾叉）：绿勾 = 已完成 / 红叉 = 失败 / 白勾 = 未完成 */
export function endgameOutcome(rec: EndgameRecord | undefined): EndgameOutcome {
  if (rec?.win !== undefined) return 'win';
  if (rec?.fail) return 'fail';
  return 'todo';
}

/** 是否达成最优步数（列表外圈：绿 = 是最优，灰 = 不是最优） */
export function isOptimalSteps(rec: EndgameRecord | undefined, goalMoves: number): boolean {
  return rec?.win !== undefined && rec.win === goalMoves;
}
