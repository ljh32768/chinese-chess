/**
 * 共享类型定义：棋子、棋盘、对局状态、玩家身份。
 * 该文件不依赖 DOM / 网络，可同时被服务端与浏览器端使用。
 */

/** 阵营：红 / 黑 */
export type Side = 'r' | 'b';

/** 棋子类型：帅仕相马车炮兵 */
export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';

/**
 * 单颗棋子。
 * 揭棋（暗棋）下追加隐藏信息字段：
 * - `hidden`（暗子，公开信息，客户端据此画背面）
 * - `real`（真实身份，**仅权威端持有**，下发前由 redactBoard 抹除）
 * - `free`（翻开的士 / 相不受九宫 / 河界限制）
 * `t` 始终表示「当前生效的走法兵种」：暗子为所在起始位置的兵种，翻开后为真实身份。
 */
export interface Piece {
  t: PieceType;
  s: Side;
  /** 揭棋：未翻开的暗子 */
  hidden?: boolean;
  /** 揭棋：暗子的真实身份（仅权威端持有） */
  real?: PieceType;
  /** 揭棋：翻开的士 / 相免九宫 / 河界限制 */
  free?: boolean;
}

/** 对局变体：标准象棋 / 揭棋（暗棋） */
export type GameVariant = 'xiangqi' | 'jieqi';

/** 棋盘单元格，空格为 null */
export type Cell = Piece | null;

/** 10 行 9 列的棋盘 */
export type Board = Cell[][];

/** 坐标 [行, 列] */
export type Pos = [number, number];

/** 对局状态机 */
export type GameStatus = 'idle' | 'waiting' | 'playing' | 'over';

/** 当前走子信息 */
export interface Move {
  from: Pos;
  to: Pos;
}

/** 完整对局快照（服务端广播、客户端渲染都用它） */
export interface GameSnapshot {
  board: Board;
  turn: Side;
  moveSeq: number;
  status: GameStatus;
  winner: Side | null;
  reason: string;
  lastMove: Move | null;
  check: boolean;
  /** 完整着法序列（棋谱 / 悔棋 / 回放基础），红黑交替从红方开始 */
  history: Move[];
  /** 本回合截止时间（epoch ms）；null 表示不限时（计时读秒关闭） */
  deadline: number | null;
  /** 对局变体（标准对局省略；揭棋为 `jieqi`，客户端据此渲染暗子） */
  variant?: GameVariant;
  /** 红方 / 黑方已吃掉的子（含揭棋被吃暗子翻开后的真实身份；标准 / 残局 / 人机一律下发） */
  capturedByRed: PieceType[];
  capturedByBlack: PieceType[];
  /**
   * 重复局面提示：连续长将 / 长捉到第 5 步，或本手构成「三次重复」且无人单方长打时置位
   * （对局不判负、不判和，提示双方「请变招」）。
   * 每手走子重新计算，下一步无提示即清除；悔棋 / 重开同步清除。
   */
  repetitionHint?: boolean;
}

/** 棋盘尺寸常量 */
export const ROWS = 10;
export const COLS = 9;

/**
 * 复盘 AI 后续变化单次请求的手数上限。
 * 界面上「AI推荐」先算 5 手，之后每走到 5 的倍数再续算 5 手；上限避免一次请求过重。
 */
export const MAX_AI_LINE_PLIES = 30;

/** 对局结束原因 */
export type GameOverReason = '将死' | '困毙' | '认输' | '同意和棋' | '超时判负';
// 注：v3.5 起三次重复不再判和；v3.43 起长将 / 长捉也不再判负——连续「打」到第 5 步或三次重复
// 均只下发 `repetitionHint` 提示「请变招」（对局继续），因此终局原因里没有重复局面相关项。

/**
 * 先手（红方）归属方式：房主在等待页选择。
 * - `r`      房主执红（默认）
 * - `b`      房主执黑
 * - `random` 随机黑红（开赛时随机决定）
 * - `guess`  猜先（对手猜单双，猜中者执红）
 */
export type FirstMode = 'r' | 'b' | 'random' | 'guess';

/** 猜先选择：单 / 双 */
export type GuessChoice = 'odd' | 'even';

/** 先手方式的中文名（服务端日志、列表「取先方式」列共用） */
export const FIRST_MODE_LABEL: Record<FirstMode, string> = {
  r: '房主执红',
  b: '房主执黑',
  random: '随机黑红',
  guess: '猜先',
};

/** 玩家身份：账号 / 游客 / AI */
export interface PlayerRef {
  /** 稳定标识：`account:<用户名>` / `guest:<随机>` / `ai` */
  id: string;
  /** 展示名（对局记录、侧栏显示用） */
  name: string;
  kind: 'account' | 'guest' | 'ai';
}

/** AI 席位（人机对战的虚拟黑方） */
export const AI_PLAYER: PlayerRef = { id: 'ai', name: 'AI', kind: 'ai' };

/** 猜先结果明细 */
export interface GuessResult {
  /** 对手猜的选择 */
  choice: GuessChoice;
  /** 房主「抓子」的结果 */
  actual: GuessChoice;
  /** 对手是否猜中（猜中则对手执红） */
  guestWon: boolean;
}

/** 房间模式：双人对战 / 人机对战 / 双人揭棋（暗棋） */
export type RoomMode = 'pvp' | 'ai' | 'jieqi';

/** 房间摘要（房间列表展示用） */
export interface RoomSummary {
  roomId: string;
  /** 已入座人数 0..2 */
  players: number;
  status: GameStatus;
  mode: RoomMode;
  /** 是否设置了口令（前端据此展示锁标记，不泄露口令本身） */
  locked: boolean;
  /** 房主展示名 */
  ownerName: string;
}

/** 对局记录摘要（对局回顾列表） */
export interface GameRecordSummary {
  id: string;
  /** 所属房间号 */
  roomId: string;
  /** 开局时间（epoch ms） */
  startedAt: number;
  /** 结束时间（epoch ms） */
  endedAt: number;
  /** 红方玩家 */
  red: PlayerRef;
  /** 黑方玩家 */
  black: PlayerRef;
  firstMode: FirstMode;
  /** 猜先模式下的猜先明细 */
  guess: GuessResult | null;
  /** 胜方；null 表示和棋 */
  winner: Side | null;
  reason: string;
  /**
   * 将死时识别出的杀法名（如「马后炮杀」；未识别到经典杀法时缺省）。
   * 由共享层 checkmate.ts 依据终局局面判定。
   */
  killMethod?: string;
  moveCount: number;
}

/** 完整对局记录（复盘用，含逐步着法） */
export interface GameRecord extends GameRecordSummary {
  moves: Move[];
}

/** AI 推荐走子（复盘用） */
export interface AiHint {
  /** 该局面的行棋方 */
  side: Side;
  from: Pos;
  to: Pos;
  /** 中文记谱，如「炮二平五」 */
  text: string;
}

/** AI 后续变化中的一手（与单步推荐同构） */
export type AiLineMove = AiHint;

/** AI 后续变化：从复盘的某一步起，连续推演若干手（首手即该局面的推荐着法） */
export interface AiLine {
  /** 起始行棋方 */
  side: Side;
  moves: AiLineMove[];
}
