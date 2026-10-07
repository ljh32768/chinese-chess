/**
 * WebSocket 连接对象：服务器与房间之间共享的最小连接视图。
 *
 * 连接与身份解耦：连接只记录「当前在哪个房间」「以什么角色加入」「是谁」，
 * 席位（红 / 黑）由房间在开赛时确定，因此不存在「连接即席位」的假设。
 */

import { WebSocket } from 'ws';
import { PlayerRef } from '../shared/types.js';

export interface Conn {
  ws: WebSocket;
  /** 当前所在房间号；未加入房间时为 null */
  roomId: string | null;
  role: 'player' | 'spectator' | null;
  /** 玩家身份；观战者为 null */
  player: PlayerRef | null;
  /** 客户端主动离开后置位：断开时不做宽限等待，立即清理 */
  leaving?: boolean;
}

/** 发送消息（仅 OPEN 状态） */
export function sendTo(conn: Conn | null | undefined, msg: unknown): void {
  if (!conn) return;
  if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
}
