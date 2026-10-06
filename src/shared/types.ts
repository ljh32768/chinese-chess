/**
 * 共享类型定义：棋子、棋盘、对局状态。
 * 该文件不依赖 DOM / 网络，可同时被服务端与浏览器端使用。
 */

/** 阵营：红 / 黑 */
export type Side = 'r' | 'b';

/** 棋子类型：帅仕相马车炮兵 */
export type PieceType = 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P';

/** 单颗棋子 */
export interface Piece {
  t: PieceType;
  s: Side;
}

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

/** 完整对局快照（主机广播、客户端渲染都用它） */
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
}

/** 棋盘尺寸常量 */
export const ROWS = 10;
export const COLS = 9;

/** 对局结束原因 */
export type GameOverReason = '将死' | '困毙' | '认输' | '同意和棋' | '超时判负';

/**
 * 先手（红方）归属方式：主机在等待页选择。
 * - `r`      主机执红（默认）
 * - `b`      主机执黑
 * - `random` 随机黑红（开赛时随机决定）
 * - `guess`  猜先（客方猜单双，猜中者执红）
 */
export type FirstMode = 'r' | 'b' | 'random' | 'guess';

/** 猜先选择：单 / 双 */
export type GuessChoice = 'odd' | 'even';

/** 先手方式的中文名（主机日志、列表「取先方式」列共用） */
export const FIRST_MODE_LABEL: Record<FirstMode, string> = {
  r: '主机执红',
  b: '主机执黑',
  random: '随机黑红',
  guess: '猜先',
};

/** 席位归属（对局记录用） */
export type Seat = 'host' | 'guest' | 'ai';

/** 猜先结果明细 */
export interface GuessResult {
  /** 客方猜的选择 */
  choice: GuessChoice;
  /** 主机「抓子」的随机结果 */
  actual: GuessChoice;
  /** 客方是否猜中（猜中则客方执红） */
  guestWon: boolean;
}

/** 对局记录摘要（对局回顾列表） */
export interface GameRecordSummary {
  id: string;
  /** 开局时间（epoch ms） */
  startedAt: number;
  /** 结束时间（epoch ms） */
  endedAt: number;
  red: Seat;
  black: Seat;
  firstMode: FirstMode;
  /** 猜先模式下的猜先明细 */
  guess: GuessResult | null;
  /** 胜方；null 表示和棋 */
  winner: Side | null;
  reason: string;
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
