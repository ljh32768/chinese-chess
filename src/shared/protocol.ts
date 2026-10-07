/**
 * 通信协议（JSON over WebSocket）。
 * 中心服务器权威：客户端只发送「意图」，服务器校验后广播。
 *
 * 连接与房间分离：先 `create_room` / `join_room` 进入某个房间，
 * 之后的对局消息（move / resign ...）都属于该房间，不再重复携带 roomId。
 */

import {
  FirstMode,
  GameSnapshot,
  GuessChoice,
  GuessResult,
  Move,
  PlayerRef,
  Pos,
  RoomMode,
  RoomSummary,
  Side,
} from './types.js';

/** 客户端角色：对局玩家（占席位）/ 观战者（只读，不占席位） */
export type Role = 'player' | 'spectator';

/** 服务器在线玩家（邀请房间时展示与选择用） */
export interface OnlinePlayer {
  /** 玩家稳定标识（account:<用户名> / guest:<随机>） */
  id: string;
  name: string;
  kind: PlayerRef['kind'];
  /** 所在房间号；null 表示仍在大厅（可被邀请） */
  roomId: string | null;
  /** 在房间内的角色；大厅为 null */
  role: Role | null;
}

/** 客户端 → 服务端 */
export type ClientMessage =
  /** 注册账号（用户名唯一，密码 ≥4 位） */
  | { type: 'register'; username: string; password: string }
  /** 登录，换取 token */
  | { type: 'login'; username: string; password: string }
  /** 创建房间：mode='ai' 时立即配 AI 黑席并开局；password 为空表示「点击即可加入」 */
  | { type: 'create_room'; mode?: RoomMode; depth?: number; password?: string | null; token?: string }
  /** 加入房间；带 playerId 时尝试恢复原席位（宽限期内重连），token 用于识别账号身份 */
  | { type: 'join_room'; roomId: string; role: Role; playerId?: string; password?: string; token?: string }
  /** 离开房间（主动，不走宽限） */
  | { type: 'leave_room' }
  /** 请求房间列表 */
  | { type: 'list_rooms' }
  /** 请求服务器在线玩家列表（房间内邀请用） */
  | { type: 'list_players' }
  /** 邀请在线玩家加入本房间：对局或观战（被邀请者可免口令加入） */
  | { type: 'invite_player'; playerId: string; role: Role }
  /** 走子请求（玩家发起，由服务器校验） */
  | { type: 'move'; from: Pos; to: Pos }
  /** 认输 */
  | { type: 'resign' }
  /** 发起和棋请求 */
  | { type: 'draw_request' }
  /** 回应和棋请求 */
  | { type: 'draw_response'; accept: boolean }
  /** 发起重开请求 */
  | { type: 'restart_request' }
  /** 回应重开请求 */
  | { type: 'restart_response'; accept: boolean }
  /** 发起悔棋请求 */
  | { type: 'undo_request' }
  /** 回应悔棋请求 */
  | { type: 'undo_response'; accept: boolean }
  /** 房主在等待阶段设置 / 取消房间口令（null 或空串表示点击即可加入） */
  | { type: 'set_password'; password: string | null }
  /** 房主放弃等待断线对手，立即转为等待新对手 */
  | { type: 'wait_new_opponent' }
  /** 房主选择先手（红方）归属方式；仅等待阶段有效 */
  | { type: 'choose_first'; mode: FirstMode }
  /** 房主「抓子」（猜先第一步）：抓单 / 抓双，作为隐藏结果 */
  | { type: 'grasp'; choice: GuessChoice }
  /** 对手猜先应答（猜单 / 猜双） */
  | { type: 'guess'; choice: GuessChoice }
  /** 心跳 */
  | { type: 'ping'; t: number };

/** 服务端 → 客户端 */
export type ServerMessage =
  /** 注册 / 登录成功，返回长期 token */
  | { type: 'auth_ok'; token: string; username: string }
  /**
   * 建房 / 加入成功（取代原 welcome）：
   * seat 为 null 表示观战；locked 表示房间设置了口令。
   */
  | {
      type: 'room_joined';
      roomId: string;
      seat: Side | null;
      playerId: string;
      name: string;
      ownerId: string;
      locked: boolean;
      state: GameSnapshot;
      /** 房主选择的先手方式（随机 / 猜先时开赛前才最终确定席位） */
      firstMode: FirstMode;
      /** 服务器自我声明地址（供客户端展示与发现去重） */
      serverIp: string;
      port: number;
    }
  /** 房间列表 */
  | { type: 'room_list'; rooms: RoomSummary[] }
  /** 服务器在线玩家列表 */
  | { type: 'player_list'; players: OnlinePlayer[] }
  /** 收到房间邀请（邀请者 / 房间号 / 角色 / 房间是否设口令） */
  | { type: 'invite'; from: PlayerRef; roomId: string; role: Role; locked: boolean }
  /** 房间被销毁（终局超时 / 空闲回收 / 房主解散 / 服务器停止） */
  | { type: 'room_closed'; reason: string }
  /** 对局开始（side 为本连接最终阵营，观战者为 null） */
  | { type: 'start'; state: GameSnapshot; side: Side | null }
  /** 猜先第一步：请房主抓单 / 抓双（仅房主可见） */
  | { type: 'grasp_request' }
  /** 猜先第二步：房主已抓子，请对手猜单双 */
  | { type: 'guess_request' }
  /** 席位与先手结果（随机 / 猜先开赛前广播） */
  | { type: 'first_result'; mode: FirstMode; ownerSide: Side; guess: GuessResult | null }
  /** 走子成功并广播（携带完整棋盘，seq 防乱序） */
  | {
      type: 'move_applied';
      seq: number;
      from: Pos;
      to: Pos;
      board: GameSnapshot['board'];
      turn: Side;
      check: boolean;
      status: GameSnapshot['status'];
      winner: Side | null;
      reason: string;
      lastMove: Move | null;
      /** 完整着法序列（棋谱 / 悔棋展示用） */
      history: Move[];
      /** 本回合截止时间（epoch ms）；null 表示不限时 */
      deadline: number | null;
    }
  /** 走子被拒绝 */
  | { type: 'move_rejected'; from: Pos; to: Pos; reason: string }
  /** 全量状态同步（断线重连恢复 / 宽限结束回到等待 / 重开） */
  | { type: 'state'; state: GameSnapshot }
  /** 对手发起和棋请求 */
  | { type: 'draw_request' }
  /** 和棋结果 */
  | { type: 'draw_response'; accept: boolean }
  /** 对手发起重开请求 */
  | { type: 'restart_request' }
  /** 重开结果 */
  | { type: 'restart_response'; accept: boolean }
  /** 对手发起悔棋请求 */
  | { type: 'undo_request' }
  /** 悔棋结果（同意后服务端会追加 state 全量同步） */
  | { type: 'undo_response'; accept: boolean }
  /** 对局结束 */
  | { type: 'game_over'; winner: Side | null; reason: string; state: GameSnapshot }
  /** 对手加入 / 已重连（携带其身份，供展示与队列提示） */
  | { type: 'opponent_joined'; player: PlayerRef }
  /** 对手意外断线，进入宽限期等待重连（graceMs 为宽限时长） */
  | { type: 'opponent_away'; reason: string; graceMs: number }
  /** 对手离开 / 断线 */
  | { type: 'opponent_left'; reason: string }
  /** 协议或状态错误 */
  | { type: 'error'; message: string }
  /** 心跳回应（ip/port 为服务器自我声明地址，供局域网发现去重与预填） */
  | { type: 'pong'; t: number; ip?: string; port?: number };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/** 解析并做基础结构校验；非法返回 null */
export function decode(raw: string): ({ type: string } & Record<string, unknown>) | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || typeof obj.type !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

/** 校验走子坐标：必须是 [行, 列] 的整数对（越界由规则引擎另行判定） */
export function isValidPos(p: unknown): p is Pos {
  return Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n));
}
