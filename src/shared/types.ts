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
}

/** 棋盘尺寸常量 */
export const ROWS = 10;
export const COLS = 9;

/** 对局结束原因 */
export type GameOverReason = '将死' | '困毙' | '认输' | '同意和棋';