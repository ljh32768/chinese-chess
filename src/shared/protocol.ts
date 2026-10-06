/**
 * 通信协议（JSON over WebSocket）。
 * 主机权威：客户端只发送「意图」，主机校验后广播。
 */

import { FirstMode, GameSnapshot, GuessChoice, GuessResult, Move, Pos, Side } from './types.js';

/** 玩家角色：主机（默认红方）/ 加入者（默认黑方）/ 观战者（只读，不占席位） */
export type Role = 'host' | 'guest' | 'spectator';

/** 客户端 → 服务端 */
export type ClientMessage =
  /** 加入对局，声明角色（宽限期内同阵营重新 join 即恢复原对局） */
  | { type: 'join'; role: Role }
  /** 走子请求（加入者 / 主机都走这条；由主机校验） */
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
  /** 主机放弃等待断线对手，立即转为等待新对手 */
  | { type: 'wait_new_opponent' }
  /** 主机选择先手（红方）归属方式；仅等待阶段有效 */
  | { type: 'choose_first'; mode: FirstMode }
  /** 客方猜先应答（猜单 / 猜双） */
  | { type: 'guess'; choice: GuessChoice }
  /** 离开对局 */
  | { type: 'leave' }
  /** 心跳 */
  | { type: 'ping'; t: number };

/** 服务端 → 客户端 */
export type ServerMessage =
  /** 加入成功，返回自己被分配的阵营与当前状态（观战者 side 为 null） */
  | {
      type: 'welcome';
      side: Side | null;
      hostIp: string;
      port: number;
      state: GameSnapshot;
      /** 主机在等待页选择的先手方式（随机 / 猜先时开赛前才最终确定席位） */
      firstMode: FirstMode;
    }
  /** 对手已加入，对局开始（side 为本连接最终阵营，观战者为 null） */
  | { type: 'start'; state: GameSnapshot; side: Side | null }
  /** 猜先开始：主机已「抓子」，请客方猜单双 */
  | { type: 'guess_request' }
  /** 席位与先手结果（随机 / 猜先开赛前广播） */
  | { type: 'first_result'; mode: FirstMode; hostSide: Side; guess: GuessResult | null }
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
  /** 对手加入（通知主机） */
  | { type: 'opponent_joined' }
  /** 对手意外断线，进入宽限期等待重连（graceMs 为宽限时长） */
  | { type: 'opponent_away'; reason: string; graceMs: number }
  /** 对手离开 / 断线 */
  | { type: 'opponent_left'; reason: string }
  /** 协议或状态错误 */
  | { type: 'error'; message: string }
  /** 心跳回应（ip/port 为主机自我声明地址，供局域网自动发现去重与预填） */
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
