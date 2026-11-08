/**
 * 象棋杀法识别（「将死」不再只显示将死）。
 *
 * 依据终局棋盘（以及可选的最后一步 / 吃子信息）判断这盘棋是被哪一种经典杀法将死的，
 * 返回杀法名、展示名与一句话定义。纯函数、无环境依赖，
 * 服务端（对局记录落库）与渲染层（对局页 / 复盘页）共用同一份实现，结果一致。
 *
 * 判定依据《象棋杀法与局面状态严格判定》，顺序遵循「具体结构优先于泛指结构」，并参考
 * 严格要求建议：先看是否正在被将军（本模块只在「将死」时调用，故恒为被将军）；再看将军
 * 来源数量与子力组合（区分双将、重炮、马后炮等）；最后看关键位置条件（士角、卧槽、
 * 三八线、中路、肋道、底线等）；残局子力背景用于「海底捞月」（限车炮对单车）。
 *
 * 顺序要点：马后炮 / 重炮 / 天地炮 / 闷宫等炮架结构最具体（天地炮排在闷宫之前——真天地炮常同时符合
 * 闷宫的单炮士架条件，但它还要求第二门炮镇中路参与牵制），铁门栓 → 夹车炮为车炮体系由专到泛；「海底捞月」需先于「对面笑」（其封口正是照面）；「列马车」需先于钓鱼马 /
 * 卧槽马（其马常落在三·八位，但列马车是更具体的固定定式：马在钓鱼马位 + 将（帅）在底线五路 + 车在底线贴将且在马口下）；
 * 双车错 / 闷杀 / 双将 / 对面笑属泛指结构靠后；清单外的
 * 「大刀剜心 / 双马饮泉 / 挂角马」作为附加条目压在其后，避免抢占主杀法。
 * 「困毙（欠行）」未被将军，不参与杀法匹配；仅导出 `KUNBI_PATTERN` 供终局展示（绝杀字样 / 杀法框）。
 * v3.8 起展示名（`label`）与杀法名一致，不再追加「杀」字（如「马后炮」而非「马后炮杀」）。
 *
 * 棋盘坐标：10 行 9 列，黑方在上（九宫 0~2 行）、红方在下（九宫 7~9 行）。
 * 红方视角的「对方三、七路」= 列 2 / 6；黑方视角同理。
 */

import {
  boardAfterMove,
  cloneBoard,
  findKing,
  inPalace,
  initBoard,
  makeMove,
  pieceMoves,
  sideHasAnyMove,
} from './rules.js';
import { Board, Move, Piece, PieceType, Pos, Side } from './types.js';

/** 单条杀法条目 */
export interface CheckmatePattern {
  /** 稳定标识（测试与检索用） */
  id: string;
  /** 杀法名（简短，如「马后炮」） */
  name: string;
  /** 终局展示名（v3.8 起与 `name` 一致，只给杀法名本身，不再追加「杀」字） */
  label: string;
  /** 一句话定义（界面提示用） */
  definition: string;
}

/** 杀法识别结果 */
export interface CheckmateInfo {
  /** 识别到的杀法（未识别到具体杀法时为兜底条目「将死」） */
  pattern: CheckmatePattern;
  /** 同时成立的其他杀法名（不含主杀法，按优先级排列） */
  alsoMatched: string[];
  /** 是否识别到具体杀法（false 表示只判定为「将死」） */
  recognized: boolean;
}

/** 兜底条目：未匹配到经典杀法 */
const GENERIC: CheckmatePattern = {
  id: 'generic',
  name: '将死',
  label: '将死',
  definition: '将（帅）被将军且无法解将；本局未匹配到经典杀法名。',
};

/**
 * 困毙（欠行）：将（帅）未被将军，但已无任何合法着法可走。
 * 不参与「将死」的杀法匹配，只作为终局原因（绝杀字样 / 杀法框）的展示条目导出。
 */
export const KUNBI_PATTERN: CheckmatePattern = {
  id: 'kunbi',
  name: '困毙',
  label: '困毙',
  definition: '将（帅）虽未被将军，但已无任何合法着法可走（欠行），按规则判负。',
};

/**
 * 杀法库（按识别优先级排列，前者优先）。
 * 同一局面可能同时成立多种杀法，`alsoMatched` 会给出其余成立的杀法名。
 * 末三条为「清单外附加条目」，排在主判定顺序之后，避免抢占主杀法。
 */
export const CHECKMATE_PATTERNS: CheckmatePattern[] = [
  {
    id: 'mahoupao',
    name: '马后炮',
    label: '马后炮',
    definition: '马在前控将、炮在马后借马为炮架将军成杀；马是炮架兼控子，即「马前炮后」。',
  },
  {
    id: 'chongpao',
    name: '重炮',
    label: '重炮',
    definition: '双炮同线叠架：前炮与将（帅）之间恰隔一子作炮架，后炮将军，将（帅）无从躲避。',
  },
  {
    id: 'tiandipao',
    name: '天地炮',
    label: '天地炮',
    definition:
      '一炮镇中路（天炮）牵制对方中士中象，一炮沉对方底线（地炮）牵制底士底象，双炮配合使将（帅）被自家士象堵死；常再由车 / 兵（卒）照将成杀。',
  },
  {
    id: 'mengong',
    name: '闷宫',
    label: '闷宫',
    definition: '单炮借对方士为炮架将军，将（帅）被自家士堵死而无路可走。',
  },
  {
    id: 'tiemenshuan',
    name: '铁门栓',
    label: '铁门栓',
    definition:
      '炮镇中路（将（帅）所在纵线）牵制士象，车或兵（卒）从底线或肋道贴帅（与将（帅）正交相邻）将军，把宫门栓死；也称「铁门闩」。',
  },
  {
    id: 'jiachepao',
    name: '夹车炮',
    label: '夹车炮',
    definition: '双炮一车集于一侧：双炮重叠为架，车配合将军成杀。',
  },
  {
    id: 'haidilaoyue',
    name: '海底捞月',
    label: '海底捞月',
    definition: '车炮对单车的残局取胜法：炮借将（帅）为架沉底攻击对方单车，车贴帅成杀。',
  },
  {
    id: 'liemache',
    name: '列马车',
    label: '列马车',
    definition:
      '马占钓鱼马位（对方三·八 / 七·八位）、将（帅）在底线五路，车沿底线贴将照将且车在马口保护下（将不敢吃车）。',
  },
  {
    id: 'wocaoma',
    name: '卧槽马',
    label: '卧槽马',
    definition: '马占对方下二路象前「卧槽」位（三、七路底线附近），直接控将门一侧，配合它子成杀。',
  },
  {
    id: 'diaoyuma',
    name: '钓鱼马',
    label: '钓鱼马',
    definition: '马占对方三·八或七·八位（卒林线附近）封锁将门，再由车等子力将杀；马是控位子。',
  },
  {
    id: 'cemianhu',
    name: '侧面虎',
    label: '侧面虎',
    definition: '马占对方三、七路卒（兵）位从侧控制将门，由同侧车等子力将死；又称「高钓马」。',
  },
  {
    id: 'bajiaoma',
    name: '八脚马',
    label: '八脚马',
    definition:
      '马占对方九宫的一个士角，将（帅）在斜对的另一个宫角；马控住将（帅）的两条退路，再由其它子力将死；也叫「八角马」「定将马」。',
  },
  {
    id: 'shuangchecuo',
    name: '双车错',
    label: '双车错',
    definition: '双车分占两条不同的横线或纵线，交错将军，将（帅）无法同时躲避；也称「长短车」。',
  },
  {
    id: 'mengsha',
    name: '闷杀',
    label: '闷杀',
    definition:
      '借对方自己的子力堵死将（帅）的逃路（自阻），再用一子将军成杀（不限炮架，范围比「闷宫」广）。',
  },
  {
    id: 'shuangjiang',
    name: '双将',
    label: '双将',
    definition: '两子同时将军，将（帅）顾此失彼；双将是将军形式，常作为杀法组合的组成部分。',
  },
  {
    id: 'bailianjiang',
    name: '对面笑',
    label: '对面笑',
    definition:
      '利用将帅不得在同一路照面的规则：将（帅）走进某格即会照面而被封死，或将军的子正夹在双方将（帅）同一纵线之间、靠照面护住不能被吃；也叫「白脸将」「千里照面」。',
  },
  {
    id: 'daodao-wanxin',
    name: '大刀剜心',
    label: '大刀剜心',
    definition: '车强行吃去对方宫心士（仕）破防成杀，也叫「大胆穿心」「大胆偷心」。（附加条目）',
  },
  {
    id: 'shuangma-yinquan',
    name: '双马饮泉',
    label: '双马饮泉',
    definition: '双马连环配合：一马控将（帅），另一马跳入将军成杀。（附加条目）',
  },
  {
    id: 'guajiaoma',
    name: '挂角马',
    label: '挂角马',
    definition: '马跳至对方九宫宫顶角（靠近河界的两个角）直接将军，迫使将（帅）不安于位。（附加条目）',
  },
  GENERIC,
];

const PATTERN = Object.fromEntries(CHECKMATE_PATTERNS.map((p) => [p.id, p])) as Record<
  string,
  CheckmatePattern
>;

// ------------------------------------------------------------ 基础工具

const other = (s: Side): Side => (s === 'r' ? 'b' : 'r');

const samePos = (a: Pos, b: Pos): boolean => a[0] === b[0] && a[1] === b[1];

/** 某方某类棋子的位置列表 */
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

/** 同线（同行 / 同列）两点之间的棋子；两点不同线时返回空数组 */
function between(board: Board, a: Pos, b: Pos): Array<{ pos: Pos; piece: Piece }> {
  const res: Array<{ pos: Pos; piece: Piece }> = [];
  if (a[0] === b[0]) {
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    for (let c = lo + 1; c < hi; c++) {
      const p = board[a[0]][c];
      if (p) res.push({ pos: [a[0], c], piece: p });
    }
  } else if (a[1] === b[1]) {
    const lo = Math.min(a[0], b[0]);
    const hi = Math.max(a[0], b[0]);
    for (let r = lo + 1; r < hi; r++) {
      const p = board[r][a[1]];
      if (p) res.push({ pos: [r, a[1]], piece: p });
    }
  }
  return res;
}

/** 炮的炮架：炮与目标之间唯一的棋子（不唯一或不同线则返回 null） */
function cannonScreen(board: Board, cannon: Pos, target: Pos): { pos: Pos; piece: Piece } | null {
  const mid = between(board, cannon, target);
  return mid.length === 1 ? mid[0] : null;
}

/**
 * pos 处子力能否「吃到」target 格（用于「车在马口」等判定）。
 * 先把 target 格清空再取该子走法——直接对含己方占位子的棋盘取 `pieceMoves` 会跳过该格。
 */
function guardsSquare(board: Board, pos: Pos, target: Pos): boolean {
  const nb = cloneBoard(board);
  nb[target[0]][target[1]] = null;
  return pieceMoves(nb, pos[0], pos[1]).some(([rr, cc]) => rr === target[0] && cc === target[1]);
}

/** 目标格是否被 by 方的棋子攻击（不含将帅照面规则，照面另由 kingsFace 判断） */
function attackedByPiece(board: Board, r: number, c: number, by: Side): boolean {
  return piecesOf(board, by).some(({ pos }) =>
    pieceMoves(board, pos[0], pos[1]).some(([rr, cc]) => rr === r && cc === c),
  );
}

/** 两侧将帅是否同列且中间无子（照面，规则禁止的局面前提） */
function kingsFace(board: Board): boolean {
  const rk = findKing(board, 'r');
  const bk = findKing(board, 'b');
  if (!rk || !bk || rk[1] !== bk[1]) return false;
  return between(board, rk, bk).length === 0;
}

/** 将（帅）未移动时的原位（用于「二路横线」等位置判断） */
function homeRow(side: Side): number {
  return side === 'r' ? 9 : 0;
}

/** 对方（mated 方）的三、七路纵线：红方在下时对应列 2 / 6（黑方同理） */
const SIDE_COLS = [2, 6];

/** 卧槽位：对方二路横线与三、七路交叉点（底象前一格） */
function isWocaomaSquare(pos: Pos, mated: Side): boolean {
  const row = homeRow(mated) + (mated === 'b' ? 1 : -1);
  return pos[0] === row && SIDE_COLS.includes(pos[1]);
}

/** 士角位：对方九宫的四个士角 */
function isShijiaoSquare(pos: Pos, mated: Side): boolean {
  const [r, c] = pos;
  if (mated === 'b') return (r === 0 || r === 2) && (c === 3 || c === 5);
  return (r === 7 || r === 9) && (c === 3 || c === 5);
}

/** 宫顶角位：对方九宫靠近河界的两个角（黑方第 2 行、红方第 7 行的三 / 五列） */
function isFrontCorner(pos: Pos, mated: Side): boolean {
  const row = mated === 'b' ? 2 : 7;
  return pos[0] === row && (pos[1] === 3 || pos[1] === 5);
}

/** 钓鱼马位：对方三·八 / 七·八位（红方视角为第 2 行三、七路） */
function isDiaoyumaSquare(pos: Pos, mated: Side): boolean {
  const row = mated === 'b' ? 2 : 7;
  return pos[0] === row && SIDE_COLS.includes(pos[1]);
}

/** 高钓马（侧面虎）位：对方三、七路卒（兵）位 */
function isCemianhuSquare(pos: Pos, mated: Side): boolean {
  const row = mated === 'b' ? 3 : 6;
  return pos[0] === row && SIDE_COLS.includes(pos[1]);
}

/** 宫心（花心）位：对方九宫中心 */
function palaceCenter(mated: Side): Pos {
  return mated === 'b' ? [1, 4] : [8, 4];
}

/** 对方底线行 */
function baseRow(mated: Side): number {
  return mated === 'b' ? 0 : 9;
}

/** 将（帅）走子受阻的原因 */
type EscapeBlock = 'own' | 'attacked' | 'face' | 'free';

interface Escape {
  pos: Pos;
  blocked: EscapeBlock;
  /** blocked === 'own' 时为堵路的自家棋子 */
  piece?: Piece;
}

/** 终局局面分析：将军者、将的出路 */
interface Analysis {
  mated: Side;
  winner: Side;
  king: Pos;
  /** 正在将军的对方棋子 */
  checkers: Array<{ pos: Pos; piece: Piece }>;
  /** 将（帅）在九宫内的相邻格及其受阻原因 */
  escapes: Escape[];
}

function analyze(board: Board, mated: Side): Analysis {
  const winner = other(mated);
  const king = findKing(board, mated) ?? ([0, 0] as Pos);

  const checkers = piecesOf(board, winner).filter(({ pos }) =>
    pieceMoves(board, pos[0], pos[1]).some(([rr, cc]) => samePos([rr, cc], king)),
  );

  const escapes: Escape[] = [];
  for (const [dr, dc] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const rr = king[0] + dr;
    const cc = king[1] + dc;
    if (!inPalace(rr, cc, mated)) continue;
    const target = board[rr][cc];
    if (target && target.s === mated) {
      escapes.push({ pos: [rr, cc], blocked: 'own', piece: target });
      continue;
    }
    // 模拟走子（含吃子）后判断新位置是否被攻击 / 是否会形成将帅照面
    const nb = boardAfterMove(board, king, [rr, cc]);
    if (attackedByPiece(nb, rr, cc, winner)) escapes.push({ pos: [rr, cc], blocked: 'attacked' });
    else if (kingsFace(nb)) escapes.push({ pos: [rr, cc], blocked: 'face' });
    else escapes.push({ pos: [rr, cc], blocked: 'free' });
  }
  return { mated, winner, king, checkers, escapes };
}

// ------------------------------------------------------------ 杀法判定

interface Ctx {
  board: Board;
  an: Analysis;
  lastMove: Move | null;
  captured: PieceType | null;
}

/** 单子将军且为指定兵种 */
function singleChecker(ctx: Ctx, type: PieceType): { pos: Pos; piece: Piece } | null {
  const cs = ctx.an.checkers;
  return cs.length === 1 && cs[0].piece.t === type ? cs[0] : null;
}

/** 某子是否正在将军 */
function isChecker(ctx: Ctx, pos: Pos): boolean {
  return ctx.an.checkers.some((c) => samePos(c.pos, pos));
}

/** 某子是否封住了将（帅）的某个出路（按「将已走到该格」的局面判定，炮需炮架才能吃子） */
function coversEscape(ctx: Ctx, pos: Pos): boolean {
  return ctx.an.escapes.some((e) => {
    if (samePos(e.pos, pos)) return false;
    const nb = boardAfterMove(ctx.board, ctx.an.king, e.pos);
    if (!nb[pos[0]]?.[pos[1]]) return false;
    return pieceMoves(nb, pos[0], pos[1]).some(([rr, cc]) => rr === e.pos[0] && cc === e.pos[1]);
  });
}

/**
 * 天地炮的核心「牵制」：炮与将（帅）同线且中间**恰有两枚棋子**——
 * 这两枚子任一移开，另一枚就会成为炮架、让这门炮照将，故二者都被钉死（多为对方的士、象）。
 */
function pinsKingLine(ctx: Ctx, pos: Pos): boolean {
  if (pos[0] !== ctx.an.king[0] && pos[1] !== ctx.an.king[1]) return false;
  return between(ctx.board, pos, ctx.an.king).length === 2;
}

interface Match {
  pattern: CheckmatePattern;
  match: (ctx: Ctx) => boolean;
}

/** 识别顺序 = 数组顺序（前者优先） */
const MATCHERS: Match[] = [
  // 马后炮：单炮将军，炮架为己方马（马兼作炮架与控子）
  {
    pattern: PATTERN.mahoupao,
    match: (ctx) => {
      const c = singleChecker(ctx, 'C');
      if (!c) return false;
      const screen = cannonScreen(ctx.board, c.pos, ctx.an.king);
      return screen?.piece.s === ctx.an.winner && screen.piece.t === 'N' && coversEscape(ctx, screen.pos);
    },
  },
  // 重炮：单炮将军，炮架为己方另一门炮（双炮同线叠架）
  {
    pattern: PATTERN.chongpao,
    match: (ctx) => {
      const c = singleChecker(ctx, 'C');
      if (!c) return false;
      const screen = cannonScreen(ctx.board, c.pos, ctx.an.king);
      return screen?.piece.s === ctx.an.winner && screen.piece.t === 'C';
    },
  },
  // 天地炮：双炮配合——一炮镇中路（第 5 路 / 列 4，牵制中士中象）、一炮沉对方底线（牵制底士底象），
  // 两门炮都须真正参与（照将 / 封住逃路 / 以「炮—两子—将」牵制同线上的防守子），将（帅）被自家子力堵死，
  // 常再由车 / 兵（卒）照将成杀。与「闷宫」（只有一门炮、仅靠自家士自阻）的区别是第二门炮也参与牵制；
  // 故排在闷宫之前——真天地炮常同时符合闷宫的单炮士架条件。
  {
    pattern: PATTERN.tiandipao,
    match: (ctx) => {
      const cannons = piecesOf(ctx.board, ctx.an.winner, 'C');
      if (cannons.length < 2) return false;
      const mid = cannons.filter(({ pos }) => pos[1] === 4); // 镇中路
      const deep = cannons.filter(({ pos }) => pos[0] === baseRow(ctx.an.mated)); // 沉对方底线
      const active = ({ pos }: { pos: Pos }): boolean =>
        isChecker(ctx, pos) || coversEscape(ctx, pos) || pinsKingLine(ctx, pos);
      return mid.some((m) => deep.some((d) => !samePos(m.pos, d.pos) && active(m) && active(d)));
    },
  },
  // 闷宫：单炮借对方士为炮架将军，将（帅）被自家士堵死
  {
    pattern: PATTERN.mengong,
    match: (ctx) => {
      const c = singleChecker(ctx, 'C');
      if (!c) return false;
      const screen = cannonScreen(ctx.board, c.pos, ctx.an.king);
      if (screen?.piece.s !== ctx.an.mated || screen.piece.t !== 'A') return false;
      // 「单炮」口径：只有另一门炮是**成杀所必需**（抽走它以后被将死方就有合法着法解将）时，
      // 才属于双炮配合的天地炮等杀法，不再算闷宫。若它的作用与照将的炮重复（如两门炮都封住
      // 同一个逃路点，抽走它仍是将死），它并不参与杀法，仍按闷宫判定（v3.33 用户截图：
      // 底炮借仕照将、另一门炮封的逃路其实已被照将的炮自己封住）。
      const otherCannonNeeded = piecesOf(ctx.board, ctx.an.winner, 'C').some(({ pos }) => {
        if (samePos(pos, c.pos)) return false;
        const nb = cloneBoard(ctx.board);
        nb[pos[0]][pos[1]] = null;
        return sideHasAnyMove(nb, ctx.an.mated);
      });
      if (otherCannonNeeded) return false;
      const own = ctx.an.escapes.filter((e) => e.blocked === 'own');
      return own.length >= 1 && own.every((e) => e.piece?.t === 'A');
    },
  },
  // 铁门栓：炮镇中路（将（帅）所在纵线，牵制士象），车 / 兵（卒）从底线或肋道**贴帅**（与将（帅）正交相邻）将军，
  // 把宫门「栓死」。旧判据要求将军子正好在将门（正前一格）或与将同纵线，漏掉了车贴帅一侧（底线 / 肋道）的典型构图。
  {
    pattern: PATTERN.tiemenshuan,
    match: (ctx) => {
      const k = ctx.an.king;
      const midCannon = piecesOf(ctx.board, ctx.an.winner, 'C').some(({ pos }) => pos[1] === k[1]);
      if (!midCannon) return false;
      return ctx.an.checkers.some(
        (c) =>
          (c.piece.t === 'R' || c.piece.t === 'P') &&
          Math.abs(c.pos[0] - k[0]) + Math.abs(c.pos[1] - k[1]) === 1,
      );
    },
  },
  // 夹车炮：双炮一车集于一侧，双炮重叠作架且参与攻杀
  {
    pattern: PATTERN.jiachepao,
    match: (ctx) => {
      const cannons = piecesOf(ctx.board, ctx.an.winner, 'C');
      if (cannons.length < 2) return false;
      const cannonBusy = cannons.some(({ pos }) => isChecker(ctx, pos) || coversEscape(ctx, pos));
      if (!cannonBusy) return false;
      const stackedPair = cannons.some((a, i) =>
        cannons.some(
          (b, j) =>
            i !== j &&
            (a.pos[0] === b.pos[0] || a.pos[1] === b.pos[1]) &&
            between(ctx.board, a.pos, b.pos).length === 0,
        ),
      );
      if (!stackedPair) return false;
      return piecesOf(ctx.board, ctx.an.winner, 'R').some(
        ({ pos }) => isChecker(ctx, pos) || coversEscape(ctx, pos),
      );
    },
  },
  // 海底捞月（残局专用）：车炮对单车，炮借将架沉底、车贴帅成杀
  {
    pattern: PATTERN.haidilaoyue,
    match: (ctx) => {
      const winNonKing = piecesOf(ctx.board, ctx.an.winner).filter(({ piece }) => piece.t !== 'K');
      const matedNonKing = piecesOf(ctx.board, ctx.an.mated).filter(({ piece }) => piece.t !== 'K');
      if (winNonKing.length !== 2) return false;
      if (
        winNonKing
          .map(({ piece }) => piece.t)
          .sort()
          .join('') !== 'CR'
      )
        return false; // 车 + 炮
      if (matedNonKing.length !== 1 || matedNonKing[0].piece.t !== 'R') return false; // 单车
      const myKing = findKing(ctx.board, ctx.an.winner);
      if (!myKing || myKing[1] !== 4) return false; // 己方帅（将）占中
      return piecesOf(ctx.board, ctx.an.winner, 'C').some(
        ({ pos }) => pos[0] === baseRow(ctx.an.mated) && (isChecker(ctx, pos) || coversEscape(ctx, pos)),
      );
    },
  },
  // 列马车（立马车 / 勒马车）：固定定式——马在钓鱼马位（对方三·八 / 七·八位）、将（帅）在底线五路，
  // 车沿底线贴将照将且车在马口保护下（将不敢吃车）。马落在其它位置（如三 / 七路卒位）时不构成列马车。
  {
    pattern: PATTERN.liemache,
    match: (ctx) => {
      const k = ctx.an.king;
      if (k[0] !== baseRow(ctx.an.mated) || k[1] !== 4) return false; // 将（帅）在底线五路
      const horses = piecesOf(ctx.board, ctx.an.winner, 'N');
      return piecesOf(ctx.board, ctx.an.winner, 'R').some((r) => {
        if (!isChecker(ctx, r.pos)) return false;
        if (r.pos[0] !== baseRow(ctx.an.mated)) return false; // 车在底线
        if (Math.abs(r.pos[1] - k[1]) !== 1) return false; // 车与将（帅）在底线相邻（贴将）
        return horses.some(
          (n) =>
            isDiaoyumaSquare(n.pos, ctx.an.mated) &&
            guardsSquare(ctx.board, n.pos, r.pos) &&
            coversEscape(ctx, n.pos),
        );
      });
    },
  },
  // 卧槽马：马在对方下二路象前的「卧槽」位（三 / 七路底线附近），控将门一侧
  {
    pattern: PATTERN.wocaoma,
    match: (ctx) =>
      piecesOf(ctx.board, ctx.an.winner, 'N').some(
        ({ pos }) => isWocaomaSquare(pos, ctx.an.mated) && (isChecker(ctx, pos) || coversEscape(ctx, pos)),
      ),
  },
  // 钓鱼马：马占三·八 / 七·八位封锁将门，由其它子力将杀（马是控位子，不直接将军）
  {
    pattern: PATTERN.diaoyuma,
    match: (ctx) =>
      piecesOf(ctx.board, ctx.an.winner, 'N').some(
        ({ pos }) => isDiaoyumaSquare(pos, ctx.an.mated) && !isChecker(ctx, pos) && coversEscape(ctx, pos),
      ),
  },
  // 侧面虎（高钓马）：马在卒林线三 / 七路侧控将门，由同侧车等子力将死
  {
    pattern: PATTERN.cemianhu,
    match: (ctx) => {
      const rookInvolved = piecesOf(ctx.board, ctx.an.winner, 'R').some(
        ({ pos }) => isChecker(ctx, pos) || coversEscape(ctx, pos),
      );
      if (!rookInvolved) return false;
      return piecesOf(ctx.board, ctx.an.winner, 'N').some(
        ({ pos }) => isCemianhuSquare(pos, ctx.an.mated) && coversEscape(ctx, pos),
      );
    },
  },
  // 八脚马（八角马 / 定将马）：马占对方九宫士角，将（帅）在斜对的另一个宫角（隔宫心相望），
  // 马正好控住将（帅）的两条退路，再由其它子力将死（如红马在 (0,3)、黑将在 (2,5)、红车沿二路照将）
  {
    pattern: PATTERN.bajiaoma,
    match: (ctx) =>
      piecesOf(ctx.board, ctx.an.winner, 'N').some(({ pos }) => {
        if (!isShijiaoSquare(pos, ctx.an.mated)) return false;
        if (Math.abs(pos[0] - ctx.an.king[0]) !== 2 || Math.abs(pos[1] - ctx.an.king[1]) !== 2) return false; // 斜对宫角
        return !isChecker(ctx, pos) && coversEscape(ctx, pos);
      }),
  },
  // 双车错：双车分占两条不同的横线 / 纵线，交错将军
  {
    pattern: PATTERN.shuangchecuo,
    match: (ctx) => {
      const rooks = piecesOf(ctx.board, ctx.an.winner, 'R');
      if (rooks.length < 2) return false;
      for (const a of rooks) {
        if (!isChecker(ctx, a.pos)) continue;
        for (const b of rooks) {
          if (samePos(a.pos, b.pos)) continue;
          if (a.pos[0] === b.pos[0] || a.pos[1] === b.pos[1]) continue; // 须两条不同的线
          if (isChecker(ctx, b.pos) || coversEscape(ctx, b.pos)) return true;
        }
      }
      return false;
    },
  },
  // 闷杀：将（帅）的逃路全被自家子力堵死（范围比「闷宫」广，不限炮架）
  {
    pattern: PATTERN.mengsha,
    match: (ctx) => {
      const own = ctx.an.escapes.filter((e) => e.blocked === 'own');
      if (own.length === 0 || own.length !== ctx.an.escapes.length) return false;
      return own.some((e) => e.piece?.t !== 'A');
    },
  },
  // 双将：两子以上同时将军
  {
    pattern: PATTERN.shuangjiang,
    match: (ctx) => ctx.an.checkers.length >= 2,
  },
  // 对面笑（白脸将 / 千里照面）：将（帅）的出路受「将帅照面」规则限制——
  // ① 将（帅）走进某格就会与对方将（帅）同线照面（典型「白脸将」封口）；
  // ② 或将（帅）想吃掉的将军子正夹在双方将（帅）同一纵线之间（「照面子」），靠照面规则护住它不能吃。
  // 若照面只挡住「吃侧面将军子」、双方将（帅）本不在同一纵线（如车贴帅一侧的铁门栓），不算对面笑。
  {
    pattern: PATTERN.bailianjiang,
    match: (ctx) => {
      const myKing = findKing(ctx.board, ctx.an.winner);
      return ctx.an.escapes.some((e) => {
        if (e.blocked !== 'face') return false;
        const checker = ctx.an.checkers.find((c) => samePos(c.pos, e.pos));
        if (!checker) return true; // 走进去照面 → 白脸将封口
        return !!myKing && myKing[1] === ctx.an.king[1]; // 该子夹在双方将（帅）之间才算「照面子」
      });
    },
  },
  // 附加：大刀剜心（车强行吃去对方宫心士破防成杀）
  {
    pattern: PATTERN['daodao-wanxin'],
    match: (ctx) => {
      const mv = ctx.lastMove;
      if (!mv || ctx.captured !== 'A') return false;
      const mover = ctx.board[mv.to[0]]?.[mv.to[1]];
      return (
        !!mover && mover.s === ctx.an.winner && mover.t === 'R' && samePos(mv.to, palaceCenter(ctx.an.mated))
      );
    },
  },
  // 附加：双马饮泉（双马连环配合，一马控将、另一马将军）
  {
    pattern: PATTERN['shuangma-yinquan'],
    match: (ctx) => {
      const horses = piecesOf(ctx.board, ctx.an.winner, 'N');
      if (horses.length < 2) return false;
      return (
        horses.some(({ pos }) => isChecker(ctx, pos)) && horses.some(({ pos }) => coversEscape(ctx, pos))
      );
    },
  },
  // 附加：挂角马（马在对方宫顶角直接将军）
  {
    pattern: PATTERN.guajiaoma,
    match: (ctx) => ctx.an.checkers.some((c) => c.piece.t === 'N' && isFrontCorner(c.pos, ctx.an.mated)),
  },
  // 兜底：将死（未匹配到经典杀法）
  { pattern: GENERIC, match: () => true },
];

/**
 * 识别将死杀法。
 * @param board  终局棋盘（被将死一方的将/帅已在盘上）
 * @param mated  被将死的一方
 * @param opts   lastMove 最后一步（用于「大刀剜心」等与入局着法相关的杀法）、
 *               captured 最后一步被吃的棋子类型（可用 `capturedPieceAt` 推导）
 */
export function classifyCheckmate(
  board: Board,
  mated: Side,
  opts: { lastMove?: Move | null; captured?: PieceType | null } = {},
): CheckmateInfo {
  const ctx: Ctx = {
    board,
    an: analyze(board, mated),
    lastMove: opts.lastMove ?? null,
    captured: opts.captured ?? null,
  };
  const matched = MATCHERS.filter((m) => m.match(ctx));
  const primary = matched[0].pattern;
  const alsoMatched = [...new Set(matched.slice(1).map((m) => m.pattern.name))].filter(
    (n) => n !== primary.name && n !== GENERIC.name,
  );
  return { pattern: primary, alsoMatched, recognized: primary.id !== 'generic' };
}

/** 第 index 步（0 起）走子时被吃掉的棋子类型；无吃子返回 null */
export function capturedPieceAt(moves: Move[], index: number): PieceType | null {
  const mv = moves[index];
  if (!mv) return null;
  const board = initBoard();
  for (let i = 0; i < index; i++) makeMove(board, moves[i].from, moves[i].to);
  return board[mv.to[0]]?.[mv.to[1]]?.t ?? null;
}

/**
 * 由终局棋盘 + 完整着法序列识别杀法（对局页 / 复盘页 / 服务端落库共用）。
 * winner 为 null（和棋）时返回 null。
 */
export function classifyCheckmateFromHistory(
  board: Board,
  history: Move[],
  winner: Side | null,
): CheckmateInfo | null {
  if (!winner || history.length === 0) return null;
  const last = history[history.length - 1];
  return classifyCheckmate(board, other(winner), {
    lastMove: last,
    captured: capturedPieceAt(history, history.length - 1),
  });
}
