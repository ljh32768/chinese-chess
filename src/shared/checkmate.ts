/**
 * 象棋杀法识别（「将死」不再只显示将死）。
 *
 * 依据终局棋盘（以及可选的最后一步 / 吃子信息）判断这盘棋是被哪一种经典杀法将死的，
 * 返回杀法名、展示名与一句话定义。纯函数、无环境依赖，
 * 服务端（对局记录落库）与渲染层（对局页 / 复盘页）共用同一份实现，结果一致。
 *
 * 杀法定义参考公开资料：
 * - 维基教科书《中国象棋/基本杀法列表》
 * - 知乎专栏《24 种常见的象棋基本杀法》
 * - 维基百科「铁门闩」「双车错」「卧槽马」「钓鱼马」「挂角马（八角马）」词条
 * - 百度百科「绝杀（象棋术语）」「闷杀」「大刀剜心」词条
 *
 * 棋盘坐标：10 行 9 列，黑方在上（九宫 0~2 行）、红方在下（九宫 7~9 行）。
 * 红方视角的「对方三、七路」= 列 2 / 6；黑方视角同理。
 */

import { boardAfterMove, findKing, inPalace, initBoard, makeMove, pieceMoves } from './rules.js';
import { Board, Move, Piece, PieceType, Pos, Side } from './types.js';

/** 单条杀法条目 */
export interface CheckmatePattern {
  /** 稳定标识（测试与检索用） */
  id: string;
  /** 杀法名（简短，如「马后炮」） */
  name: string;
  /** 终局展示名（如「马后炮杀」，闷杀 / 大刀剜心等本身已含杀意的不再加「杀」） */
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
 * 杀法库（按识别优先级排列，前者优先）。
 * 同一局面可能同时成立多种杀法，`alsoMatched` 会给出其余成立的杀法名。
 * 顺序原则：具体结构（炮架/封门/士角等）优先于泛指结构（闷杀、将死）。
 */
export const CHECKMATE_PATTERNS: CheckmatePattern[] = [
  {
    id: 'mahoupao',
    name: '马后炮',
    label: '马后炮杀',
    definition: '马在前控将、炮在马后借马为炮架将军成杀，即「马前炮后」。',
  },
  {
    id: 'chongpao',
    name: '重炮',
    label: '重炮杀',
    definition: '双炮同线重叠：前炮作炮架、后炮将军，将（帅）无从躲避。',
  },
  {
    id: 'daodao-wanxin',
    name: '大刀剜心',
    label: '大刀剜心',
    definition: '车强行吃去对方宫心士（仕）破防成杀，也叫「大胆穿心」「大胆偷心」。',
  },
  {
    id: 'tiemenshuan',
    name: '铁门栓',
    label: '铁门栓杀',
    definition: '中炮镇住中路，车或兵（卒）封住将门、借己方子力（含帅力）保护成杀，也称「铁门闩」。',
  },
  {
    id: 'mengong',
    name: '闷宫',
    label: '闷宫杀',
    definition: '单炮借对方士为炮架将军，将（帅）被自家士堵死而无路可走。',
  },
  {
    id: 'tiandipao',
    name: '天地炮',
    label: '天地炮杀',
    definition: '一炮镇中路、一炮沉底，配合车、马、兵等子力一举将死。',
  },
  {
    id: 'jiachepao',
    name: '夹车炮',
    label: '夹车炮杀',
    definition: '双炮一车集于一侧：双炮重叠为架，车配合将军成杀。',
  },
  {
    id: 'shuangjiang',
    name: '双将',
    label: '双将杀',
    definition: '两子同时将军，将（帅）顾此失彼；车马同线时即「列马车」双将。',
  },
  {
    id: 'bailianjiang',
    name: '白脸将',
    label: '白脸将杀',
    definition: '利用将帅不能在同一路照面的规则，借帅（将）力封住对方将（帅）的出路，也叫「对面笑」。',
  },
  {
    id: 'shuangma-yinquan',
    name: '双马饮泉',
    label: '双马饮泉',
    definition: '双马连环配合：一马（多在卧槽位）控将，另一马跳入将军成杀。',
  },
  {
    id: 'wocaoma',
    name: '卧槽马',
    label: '卧槽马杀',
    definition: '马跳到对方二路横线与三、七路纵线交叉点（底象前一格）将军，配合车、炮等成杀。',
  },
  {
    id: 'guajiaoma',
    name: '挂角马',
    label: '挂角马杀',
    definition: '马跳至对方九宫士角将军，使将（帅）不安于位，再配合其它子力成杀（亦作「八角马」）。',
  },
  {
    id: 'diaoyuma',
    name: '钓鱼马',
    label: '钓鱼马杀',
    definition: '马占对方三·八或七·八位，同时控制九宫两处要点、封锁将门，与车等配合成杀。',
  },
  {
    id: 'cemianhu',
    name: '侧面虎',
    label: '侧面虎杀',
    definition: '马占对方三、七路卒（兵）位控将，由同侧车等子力将军成杀；又称「高钓马」。',
  },
  {
    id: 'bajiaoma',
    name: '八角马',
    label: '八角马杀',
    definition: '马在九宫附近封住将（帅）的多处出路（定将），由车等其它子力将军成杀。',
  },
  {
    id: 'shuangchecuo',
    name: '双车错',
    label: '双车错杀',
    definition: '双车分占两线，前后或左右交错将军，将（帅）无法兼顾；也称「长短车」。',
  },
  {
    id: 'haidilaoyue',
    name: '海底捞月',
    label: '海底捞月',
    definition: '车（炮）沉至对方底线、在将（帅）背后发起攻击，车炮分列两侧、己方帅（将）占中成杀。',
  },
  {
    id: 'mengsha',
    name: '闷杀',
    label: '闷杀',
    definition: '借对方自己的子力堵死将（帅）的出路（自阻），再用一子将军成杀。',
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

/** 将门：将（帅）正前方一格（仍须在九宫内） */
function gatePos(king: Pos, mated: Side): Pos | null {
  const front: Pos = [king[0] + (mated === 'b' ? 1 : -1), king[1]];
  return inPalace(front[0], front[1], mated) ? front : null;
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

interface Match {
  pattern: CheckmatePattern;
  match: (ctx: Ctx) => boolean;
}

/** 识别顺序 = 数组顺序（前者优先） */
const MATCHERS: Match[] = [
  // 马后炮：单炮将军，炮架为己方马
  {
    pattern: PATTERN.mahoupao,
    match: (ctx) => {
      const c = singleChecker(ctx, 'C');
      if (!c) return false;
      const screen = cannonScreen(ctx.board, c.pos, ctx.an.king);
      return screen?.piece.s === ctx.an.winner && screen.piece.t === 'N';
    },
  },
  // 重炮：单炮将军，炮架为己方另一门炮
  {
    pattern: PATTERN.chongpao,
    match: (ctx) => {
      const c = singleChecker(ctx, 'C');
      if (!c) return false;
      const screen = cannonScreen(ctx.board, c.pos, ctx.an.king);
      return screen?.piece.s === ctx.an.winner && screen.piece.t === 'C';
    },
  },
  // 大刀剜心：最后一步为己方车吃去对方宫心士
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
  // 铁门栓：己方炮镇中路（与将同线），车 / 兵封住将门并将军
  {
    pattern: PATTERN.tiemenshuan,
    match: (ctx) => {
      const gate = gatePos(ctx.an.king, ctx.an.mated);
      if (!gate) return false;
      const gateChecked = ctx.an.checkers.some(
        (c) => samePos(c.pos, gate) && (c.piece.t === 'R' || c.piece.t === 'P'),
      );
      if (!gateChecked) return false;
      const midCannon = piecesOf(ctx.board, ctx.an.winner, 'C').some(({ pos }) => pos[1] === ctx.an.king[1]);
      return midCannon;
    },
  },
  // 闷宫：单炮借对方士为炮架将军，将的自家堵子全是士
  {
    pattern: PATTERN.mengong,
    match: (ctx) => {
      const c = singleChecker(ctx, 'C');
      if (!c) return false;
      const screen = cannonScreen(ctx.board, c.pos, ctx.an.king);
      if (screen?.piece.s !== ctx.an.mated || screen.piece.t !== 'A') return false;
      const own = ctx.an.escapes.filter((e) => e.blocked === 'own');
      return own.length >= 1 && own.every((e) => e.piece?.t === 'A');
    },
  },
  // 天地炮：将（帅）在中路，一炮镇中路、一炮沉底
  {
    pattern: PATTERN.tiandipao,
    match: (ctx) => {
      if (ctx.an.king[1] !== 4) return false;
      const cannons = piecesOf(ctx.board, ctx.an.winner, 'C');
      if (cannons.length < 2) return false;
      const mid = cannons.filter(({ pos }) => pos[1] === 4);
      const deep = cannons.filter(({ pos }) => pos[0] === baseRow(ctx.an.mated));
      return mid.length >= 1 && deep.some((d) => !mid.some((m) => samePos(m.pos, d.pos)));
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
  // 双将：两子以上同时将军
  {
    pattern: PATTERN.shuangjiang,
    match: (ctx) => ctx.an.checkers.length >= 2,
  },
  // 白脸将（对面笑）：将（帅）的出路受「将帅照面」规则限制
  {
    pattern: PATTERN.bailianjiang,
    match: (ctx) => ctx.an.escapes.some((e) => e.blocked === 'face'),
  },
  // 双马饮泉：双马配合，一马将军、另一马控将
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
  // 卧槽马：马在对方二路横线三 / 七路交叉点将军
  {
    pattern: PATTERN.wocaoma,
    match: (ctx) => ctx.an.checkers.some((c) => c.piece.t === 'N' && isWocaomaSquare(c.pos, ctx.an.mated)),
  },
  // 挂角马：马在对方士角将军
  {
    pattern: PATTERN.guajiaoma,
    match: (ctx) => ctx.an.checkers.some((c) => c.piece.t === 'N' && isShijiaoSquare(c.pos, ctx.an.mated)),
  },
  // 钓鱼马：马占三·八 / 七·八位封锁将门，由其它子力将军
  {
    pattern: PATTERN.diaoyuma,
    match: (ctx) =>
      piecesOf(ctx.board, ctx.an.winner, 'N').some(
        ({ pos }) => isDiaoyumaSquare(pos, ctx.an.mated) && !isChecker(ctx, pos) && coversEscape(ctx, pos),
      ),
  },
  // 侧面虎（高钓马）：马占对方三、七路卒位控将，同侧车等成杀
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
  // 八角马：马在九宫附近封住将（帅）两处以上出路（定将），由其它子力将军
  {
    pattern: PATTERN.bajiaoma,
    match: (ctx) =>
      piecesOf(ctx.board, ctx.an.winner, 'N').some(({ pos }) => {
        if (isChecker(ctx, pos)) return false;
        const [r, c] = pos;
        const near = c >= 2 && c <= 6 && (ctx.an.mated === 'b' ? r <= 4 : r >= 5);
        if (!near) return false;
        const moves = pieceMoves(ctx.board, r, c);
        const covered = ctx.an.escapes.filter((e) =>
          moves.some(([rr, cc]) => rr === e.pos[0] && cc === e.pos[1]),
        );
        return covered.length >= 2;
      }),
  },
  // 双车错：双车分占两线，一车将军、另一车封路
  {
    pattern: PATTERN.shuangchecuo,
    match: (ctx) => {
      const rooks = piecesOf(ctx.board, ctx.an.winner, 'R');
      if (rooks.length < 2) return false;
      const checker = rooks.find(({ pos }) => isChecker(ctx, pos));
      if (!checker) return false;
      return rooks.some(({ pos }) => !samePos(pos, checker.pos) && coversEscape(ctx, pos));
    },
  },
  // 海底捞月：车（炮）沉底在对方底线发起攻击，己方帅（将）占中
  {
    pattern: PATTERN.haidilaoyue,
    match: (ctx) => {
      if (ctx.an.king[1] !== 4) return false;
      const myKing = findKing(ctx.board, ctx.an.winner);
      if (!myKing || myKing[1] !== 4) return false;
      return piecesOf(ctx.board, ctx.an.winner).some(
        ({ pos, piece }) =>
          (piece.t === 'R' || piece.t === 'C') &&
          pos[0] === baseRow(ctx.an.mated) &&
          (isChecker(ctx, pos) || coversEscape(ctx, pos)),
      );
    },
  },
  // 闷杀：将（帅）的出路被自家子力（非全为士）堵死
  {
    pattern: PATTERN.mengsha,
    match: (ctx) => {
      const own = ctx.an.escapes.filter((e) => e.blocked === 'own');
      if (own.length === 0 || own.length !== ctx.an.escapes.length) return false;
      return own.some((e) => e.piece?.t !== 'A');
    },
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
