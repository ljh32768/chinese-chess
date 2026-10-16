import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { GameServer, listenWithFallback } from '../src/server/server.js';
import { EngineLevel, EnginePort, LocalEngine } from '../src/shared/engine.js';
import { ClientMessage } from '../src/shared/protocol.js';
import { initBoard, validateMove } from '../src/shared/rules.js';
import { Board, Piece, Pos, Side } from '../src/shared/types.js';
import { TestClient } from './ws-client.js';

let server: GameServer | null = null;
const clients: TestClient[] = [];

/** 初始局面 FEN（与皮卡鱼实测一致） */
const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

interface ServerOpts {
  graceMs?: number;
  turnMs?: number;
  aiDelayMs?: number;
  overTtlMs?: number;
  roomIdleMs?: number;
  maxRooms?: number;
  maxSpectators?: number;
  engine?: EnginePort;
}

/** 随机取一个高位端口并启动服务，避开 fetch 屏蔽的端口与端口占用 */
async function startServer(opts: ServerOpts = {}): Promise<GameServer> {
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const candidate = new GameServer({
      port: 20000 + Math.floor(Math.random() * 30000),
      staticDir: null,
      host: '127.0.0.1',
      dataDir: null,
      ...opts,
    });
    try {
      await candidate.listen();
      server = candidate;
      return candidate;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('无法启动测试服务');
}

/** 用原始路径发请求（fetch 会规范化 URL，无法发送 `..%2F` 这类路径） */
function rawGet(port: number, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** 仅建立连接（不加入房间） */
async function open(port: number): Promise<TestClient> {
  const c = new TestClient(port);
  clients.push(c);
  await c.open();
  return c;
}

type CreateRoomMsg = Omit<Extract<ClientMessage, { type: 'create_room' }>, 'type'>;
type JoinRoomMsg = Omit<Extract<ClientMessage, { type: 'join_room' }>, 'type' | 'roomId'>;

/** 建房（房主自动入座），返回连接与房间信息 */
async function createRoom(s: GameServer, msg: CreateRoomMsg = {}) {
  const c = await open(s.address.port);
  c.send({ type: 'create_room', ...msg });
  const joined = await c.waitType('room_joined');
  return { c, roomId: joined.roomId, playerId: joined.playerId, joined };
}

/** 加入房间（默认作为玩家） */
async function joinRoom(s: GameServer, roomId: string, msg: JoinRoomMsg = {}) {
  const c = await open(s.address.port);
  c.send({ type: 'join_room', roomId, role: msg.role ?? 'player', ...msg });
  return c;
}

/** 建房 + 加入并等待开局（默认房主执红） */
async function setupGame(s: GameServer) {
  const { c: host, roomId, playerId } = await createRoom(s);
  const guest = await joinRoom(s, roomId);
  const gJoined = await guest.waitType('room_joined');
  const hStart = await host.waitType('start');
  const gStart = await guest.waitType('start');
  return { host, guest, roomId, hostId: playerId, guestId: gJoined.playerId, hStart, gStart };
}

/** 揭棋房间：建房 + 加入并等待开局（洗子局面） */
async function setupJieqiGame(s: GameServer) {
  const { c: host, roomId, playerId } = await createRoom(s, { mode: 'jieqi' });
  const guest = await joinRoom(s, roomId);
  const gJoined = await guest.waitType('room_joined');
  const hStart = await host.waitType('start');
  const gStart = await guest.waitType('start');
  return { host, guest, roomId, hostId: playerId, guestId: gJoined.playerId, hStart, gStart };
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** 从 move_applied 里取某一格，便于断言 */
const at = (board: Board, r: number, c: number) => board[r][c];

describe('服务器 · 建房与加入', () => {
  it('建房返回 6 位房间号并进入等待状态', async () => {
    const s = await startServer();
    const { joined, roomId } = await createRoom(s);
    expect(roomId).toMatch(/^\d{6}$/);
    expect(joined.seat).toBe('r');
    expect(joined.state.status).toBe('waiting');
    expect(joined.locked).toBe(false);
    expect(joined.ownerId).toBe(joined.playerId);
  });

  it('加入不存在的房间返回错误', async () => {
    const s = await startServer();
    const guest = await joinRoom(s, '000000');
    expect((await guest.waitType('error')).message).toBe('房间不存在');
  });

  it('双方到齐后自动开局（房主执红）', async () => {
    const s = await startServer();
    const { host, guest, gStart } = await setupGame(s);
    expect((await host.waitType('first_result')).ownerSide).toBe('r');
    expect((await guest.waitType('first_result')).ownerSide).toBe('r');
    expect(gStart.side).toBe('b');
    expect(s.roomCount).toBe(1);
  });

  it('房间已满时第三个玩家被拒绝，观战仍可加入', async () => {
    const s = await startServer();
    const { roomId } = await setupGame(s);
    const extra = await joinRoom(s, roomId);
    expect((await extra.waitType('error')).message).toBe('房间已满');

    const watcher = await joinRoom(s, roomId, { role: 'spectator' });
    expect((await watcher.waitType('room_joined')).seat).toBeNull();
  });

  it('设置口令后加入需正确口令', async () => {
    const s = await startServer();
    const { c: host, roomId, playerId } = await createRoom(s);
    host.send({ type: 'set_password', password: 'abc123' });
    // 等待房主端自身无错误（set_password 无回执，这里直接尝试加入验证）
    await new Promise((r) => setTimeout(r, 20));

    const bad = await joinRoom(s, roomId, { password: 'wrong' });
    expect((await bad.waitType('error')).message).toBe('房间口令错误');

    const ok = await joinRoom(s, roomId, { password: 'abc123' });
    expect((await ok.waitType('room_joined')).seat).toBe('b');
    expect(host).toBeDefined();
    expect(playerId).toBeTruthy();
  });

  it('未加入房间时发送对局消息返回错误', async () => {
    const s = await startServer();
    const c = await open(s.address.port);
    c.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await c.waitType('error')).message).toBe('尚未加入房间');
  });

  it('房间列表返回人数、状态与是否上锁', async () => {
    const s = await startServer();
    const { roomId } = await createRoom(s, { password: 'pw' });
    const c = await open(s.address.port);
    c.send({ type: 'list_rooms' });
    const list = await c.waitType('room_list');
    expect(list.rooms).toHaveLength(1);
    expect(list.rooms[0]).toMatchObject({ roomId, players: 1, status: 'waiting', locked: true, mode: 'pvp' });
  });
});

describe('服务器 · 走子同步', () => {
  it('走子成功会向双方广播完整棋盘与 seq', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const hMsg = await host.waitType('move_applied');
    const gMsg = await guest.waitType('move_applied');

    expect(hMsg.seq).toBe(1);
    expect(hMsg.turn).toBe('b');
    expect(at(hMsg.board, 8, 0)).toEqual({ t: 'R', s: 'r' });
    expect(at(hMsg.board, 9, 0)).toBeNull();
    expect(hMsg.history).toEqual([{ from: [9, 0], to: [8, 0] }]);
    expect(gMsg.seq).toBe(1);
    expect(gMsg.history).toEqual([{ from: [9, 0], to: [8, 0] }]);

    guest.send({ type: 'move', from: [3, 0], to: [4, 0] });
    const hMsg2 = await host.waitType('move_applied');
    expect(hMsg2.seq).toBe(2);
    expect(hMsg2.turn).toBe('r');
    expect(at(hMsg2.board, 4, 0)).toEqual({ t: 'P', s: 'b' });
  });

  it('非本方回合走子被拒绝', async () => {
    const s = await startServer();
    const { guest } = await setupGame(s);
    guest.send({ type: 'move', from: [9, 0], to: [8, 0] }); // 黑方在红方回合走子
    expect((await guest.waitType('move_rejected')).reason).toBe('还没轮到你走棋');
  });

  it('不能移动对方的棋子', async () => {
    const s = await startServer();
    const { host } = await setupGame(s);
    host.send({ type: 'move', from: [3, 0], to: [4, 0] }); // 红方去动黑卒
    expect((await host.waitType('move_rejected')).reason).toBe('这不是你的棋子');
  });

  it('非法走子被拒绝且不广播', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'move', from: [6, 0], to: [4, 0] }); // 兵走两格
    expect((await host.waitType('move_rejected')).reason).toBe('不符合走法或会送将');
    await guest.expectNo('move_applied');
  });

  it('非整数坐标被拒绝为坐标非法，服务仍可继续走子', async () => {
    const s = await startServer();
    const { host } = await setupGame(s);
    host.send({ type: 'move', from: [1.5, 0], to: [2, 0] });
    expect((await host.waitType('move_rejected')).reason).toBe('坐标非法');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await host.waitType('move_applied')).seq).toBe(1);
  });

  it('两房间并发互不影响（房间隔离）', async () => {
    const s = await startServer();
    const a = await setupGame(s);
    const b = await setupGame(s);
    expect(a.roomId).not.toBe(b.roomId);

    a.host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const aMove = await a.host.waitType('move_applied');
    expect(aMove.seq).toBe(1);

    // B 房权威状态不受影响
    expect(s.room(b.roomId)!.game.moveSeq).toBe(0);
    await b.guest.expectNo('move_applied');

    b.guest.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await b.guest.waitType('move_rejected')).reason).toBe('还没轮到你走棋');
  });
});

describe('服务器 · 对局控制', () => {
  it('认输会广播 game_over', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    guest.send({ type: 'resign' });
    const over = await host.waitType('game_over');
    expect(over.winner).toBe('r');
    expect(over.reason).toBe('认输');
    expect((await guest.waitType('game_over')).winner).toBe('r');
  });

  it('和棋请求被同意后判和', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'draw_request' });
    await guest.waitType('draw_request');
    guest.send({ type: 'draw_response', accept: true });
    const over = await host.waitType('game_over');
    expect(over.winner).toBeNull();
    expect(over.reason).toBe('同意和棋');
  });

  it('拒绝和棋请求则对局继续', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'draw_request' });
    await guest.waitType('draw_request');
    guest.send({ type: 'draw_response', accept: false });
    expect((await host.waitType('draw_response')).accept).toBe(false);
    await host.expectNo('game_over');
  });

  it('双方同意后重开，回到初始局面', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    guest.send({ type: 'restart_request' });
    await host.waitType('restart_request');
    host.send({ type: 'restart_response', accept: true });
    const restart = await guest.waitType('start');
    expect(restart.state.moveSeq).toBe(0);
    expect(restart.state.turn).toBe('r');
    expect(restart.state.status).toBe('playing');
  });

  it('拒绝重开请求则维持结束状态，不广播 start', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    guest.send({ type: 'restart_request' });
    await host.waitType('restart_request');
    host.send({ type: 'restart_response', accept: false });
    expect((await guest.waitType('restart_response')).accept).toBe(false);
    await guest.expectNo('start');
  });
});

describe('服务器 · 悔棋（请求-回应）', () => {
  it('对方同意后回退一步，双方棋盘与棋谱同步', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');

    guest.send({ type: 'undo_request' });
    await host.waitType('undo_request');
    host.send({ type: 'undo_response', accept: true });

    expect((await guest.waitType('undo_response')).accept).toBe(true);
    const st = await guest.waitType('state');
    expect(st.state.moveSeq).toBe(0);
    expect(st.state.history).toEqual([]);
    expect(at(st.state.board, 9, 0)).toEqual({ t: 'R', s: 'r' });
    expect(st.state.turn).toBe('r');
  });

  it('拒绝悔棋则局面保持不变', async () => {
    const s = await startServer();
    const { host, guest, roomId } = await setupGame(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');

    guest.send({ type: 'undo_request' });
    await host.waitType('undo_request');
    host.send({ type: 'undo_response', accept: false });
    expect((await guest.waitType('undo_response')).accept).toBe(false);
    expect(s.room(roomId)!.game.moveSeq).toBe(1);
  });

  it('没有可悔的棋时请求被拒绝（error 提示）', async () => {
    const s = await startServer();
    const { host } = await setupGame(s);
    host.send({ type: 'undo_request' });
    expect((await host.waitType('error')).message).toBe('当前没有可悔的棋');
  });

  it('对方不在线（宽限中）时不能悔棋', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');

    guest.close();
    await host.waitType('opponent_away');
    host.send({ type: 'undo_request' });
    expect((await host.waitType('error')).message).toBe('对方不在线，无法悔棋');
  });
});

describe('服务器 · 观战', () => {
  it('观战者随时可加入、不占席位，并收到对局广播', async () => {
    const s = await startServer();
    const { roomId } = await createRoom(s);
    const watcher = await joinRoom(s, roomId, { role: 'spectator' });
    expect((await watcher.waitType('room_joined')).seat).toBeNull();

    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');
    const start = await watcher.waitType('start');
    expect(start.state.status).toBe('playing');
  });

  it('观战者不能走子或发起请求（只读）', async () => {
    const s = await startServer();
    const { host, roomId } = await setupGame(s);
    const watcher = await joinRoom(s, roomId, { role: 'spectator' });
    await watcher.waitType('room_joined');
    watcher.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await watcher.waitType('error')).message).toBe('观战模式只读');
    watcher.send({ type: 'draw_request' });
    expect((await watcher.waitType('error')).message).toBe('观战模式只读');
    await host.expectNo('move_applied');
  });

  it('观战者离开不影响对局，也不触发宽限', async () => {
    const s = await startServer();
    const { host, roomId } = await setupGame(s);
    const watcher = await joinRoom(s, roomId, { role: 'spectator' });
    await watcher.waitType('room_joined');
    watcher.close();
    await host.expectNo('opponent_away');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await host.waitType('move_applied')).seq).toBe(1);
  });
});

describe('服务器 · 断线与心跳', () => {
  it('对手意外断线进入宽限等待并通知另一方', async () => {
    const s = await startServer();
    const { host, guest } = await setupGame(s);
    guest.close();
    const away = await host.waitType('opponent_away');
    expect(away.reason).toBe('对手已断开');
    expect(away.graceMs).toBe(30000);
  });

  it('ping 会得到 pong（携带服务器地址）', async () => {
    const s = await startServer();
    const host = await open(s.address.port);
    host.send({ type: 'ping', t: 12345 });
    const pong = await host.waitType('pong');
    expect(pong.t).toBe(12345);
    expect(pong.port).toBe(s.address.port);
  });

  it('未知消息 / 非法 JSON 返回 error 且服务不崩溃', async () => {
    const s = await startServer();
    const host = await open(s.address.port);
    host.ws.send('这不是 JSON');
    expect((await host.waitType('error')).message).toBe('无法解析的消息');
    host.send({ type: 'ping', t: 1 });
    expect((await host.waitType('pong')).t).toBe(1);
  });
});

describe('服务器 · 断线重连（宽限期）', () => {
  /** 开局并走一步，制造可验证的进行中局面（红车 [9,0]→[8,0]） */
  async function setupPlaying(graceMs: number) {
    const s = await startServer({ graceMs });
    const { host, guest, roomId, hostId, guestId } = await setupGame(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');
    return { s, host, guest, roomId, hostId, guestId };
  }

  it('对手意外断线后对局保留，凭 playerId 重连恢复原局面', async () => {
    const { s, host, guest, roomId, guestId } = await setupPlaying(1000);
    guest.close();
    const away = await host.waitType('opponent_away');
    expect(away.reason).toBe('对手已断开');
    expect(away.graceMs).toBe(1000);
    expect(s.room(roomId)!.game.status).toBe('playing');
    expect(s.room(roomId)!.game.moveSeq).toBe(1);

    const guest2 = await joinRoom(s, roomId, { playerId: guestId });
    const w = await guest2.waitType('room_joined');
    expect(w.seat).toBe('b');
    expect(w.playerId).toBe(guestId);
    expect(w.state.status).toBe('playing');
    expect(w.state.moveSeq).toBe(1);
    expect(at(w.state.board, 8, 0)).toEqual({ t: 'R', s: 'r' });

    await host.waitType('opponent_joined');
    const sync = await host.waitType('state');
    expect(sync.state.moveSeq).toBe(1);

    // 恢复后对局可继续（轮到黑方）
    guest2.send({ type: 'move', from: [3, 0], to: [4, 0] });
    expect((await host.waitType('move_applied')).seq).toBe(2);
  });

  it('房主意外断线保留对局，带 playerId 重连恢复', async () => {
    const { s, host, guest, roomId, hostId } = await setupPlaying(1000);
    host.close();
    const away = await guest.waitType('opponent_away');
    expect(away.reason).toBe('房主已断开');
    expect(s.room(roomId)!.game.status).toBe('playing');

    const host2 = await joinRoom(s, roomId, { playerId: hostId });
    const w = await host2.waitType('room_joined');
    expect(w.seat).toBe('r');
    expect(w.state.moveSeq).toBe(1);

    await guest.waitType('opponent_joined');
    // 恢复后仍可继续走子（轮到黑方）
    guest.send({ type: 'move', from: [3, 0], to: [4, 0] });
    expect((await host2.waitType('move_applied')).seq).toBe(2);
  });

  it('宽限超时后清空对手席并回到等待新对手（房主仍在）', async () => {
    const { s, host, guest, roomId } = await setupPlaying(80);
    guest.close();
    await host.waitType('opponent_away');

    const st = await host.waitType('state');
    expect(st.state.status).toBe('waiting');
    expect(st.state.moveSeq).toBe(0);
    expect((await host.waitType('opponent_left')).reason).toBe('对手已离开');
    expect(s.room(roomId)!.game.status).toBe('waiting');

    // 新对手加入即可开新局
    const guest2 = await joinRoom(s, roomId);
    expect((await guest2.waitType('start')).state.status).toBe('playing');
  });

  it('房主可放弃等待断线对手，立即转为等待新对手', async () => {
    const { s, host, guest } = await setupPlaying(5000);
    guest.close();
    await host.waitType('opponent_away');

    host.send({ type: 'wait_new_opponent' });
    expect((await host.waitType('state')).state.status).toBe('waiting');
    expect((await host.waitType('opponent_left')).reason).toBe('已放弃等待对方重连');
    expect(host).toBeDefined();
    expect(s.roomCount).toBe(1);
  });

  it('主动离开（leave_room）不走宽限，立即通知对手', async () => {
    const { host, guest } = await setupPlaying(5000);
    guest.send({ type: 'leave_room' });
    expect((await host.waitType('opponent_left')).reason).toBe('对手已离开');
    await host.expectNo('opponent_away');
  });

  it('房主主动离开会销毁房间并通知对手', async () => {
    const { s, host, guest } = await setupPlaying(5000);
    host.send({ type: 'leave_room' });
    const closed = await guest.waitType('room_closed');
    expect(closed.reason).toBe('房主已离开');
    await new Promise((r) => setTimeout(r, 20));
    expect(s.roomCount).toBe(0);
  });

  it('房主宽限超时会销毁房间', async () => {
    const { s, host, guest } = await setupPlaying(80);
    host.close();
    await guest.waitType('opponent_away');
    const closed = await guest.waitType('room_closed');
    expect(closed.reason).toBe('房主已断开');
    expect(s.roomCount).toBe(0);
  });
});

describe('服务器 · 房间生命周期', () => {
  it('终局后无人「再来一局」则销毁房间', async () => {
    const s = await startServer({ overTtlMs: 80 });
    const { host, guest } = await setupGame(s);
    host.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    const closed = await guest.waitType('room_closed');
    expect(closed.reason).toBe('对局已结束');
    expect(s.roomCount).toBe(0);
  });

  it('终局后双方「再来一局」则不销毁房间', async () => {
    const s = await startServer({ overTtlMs: 120 });
    const { host, guest } = await setupGame(s);
    host.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    guest.send({ type: 'restart_request' });
    await host.waitType('restart_request');
    host.send({ type: 'restart_response', accept: true });
    await guest.waitType('start');

    await new Promise((r) => setTimeout(r, 200));
    expect(s.roomCount).toBe(1);
  });

  it('房间内无在线连接超时后被回收', async () => {
    // AI 房的对手席没有连接：人类断线后房间内无在线连接，触发空闲回收
    const s = await startServer({ roomIdleMs: 80 });
    const { c } = await createRoom(s, { mode: 'ai' });
    await c.waitType('start');
    c.close();
    await new Promise((r) => setTimeout(r, 300));
    expect(s.roomCount).toBe(0);
  });

  it('建房数达到上限时返回错误', async () => {
    const s = await startServer({ maxRooms: 1 });
    await createRoom(s);
    const c = await open(s.address.port);
    c.send({ type: 'create_room' });
    expect((await c.waitType('error')).message).toBe('房间数已达上限');
  });
});

describe('服务器 · 先手方式（红黑 / 随机 / 猜先）', () => {
  it('默认房主执红；选择「黑」后房主执黑、对手执红先行', async () => {
    const s = await startServer();
    const { c: host, roomId, joined } = await createRoom(s);
    expect(joined.firstMode).toBe('r');
    host.send({ type: 'choose_first', mode: 'b' });
    await new Promise((r) => setTimeout(r, 20));

    const guest = await joinRoom(s, roomId);
    expect((await guest.waitType('room_joined')).seat).toBe('r');
    expect((await host.waitType('start')).side).toBe('b');
    expect((await guest.waitType('start')).side).toBe('r');

    // 未轮到黑方（房主）时抢先走子被拒
    host.send({ type: 'move', from: [3, 0], to: [4, 0] });
    await host.waitType('move_rejected');

    // 红方（对手）先行，随后轮到黑方（房主）
    guest.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await guest.waitType('move_applied')).turn).toBe('b');
    host.send({ type: 'move', from: [3, 0], to: [4, 0] });
    const applied = await host.wait((m) => m.type === 'move_applied' && m.turn === 'r');
    expect(applied.type).toBe('move_applied');
  });

  it('随机黑红：开赛前广播席位结果，双方各按结果执子', async () => {
    const s = await startServer();
    const { c: host, roomId } = await createRoom(s, {});
    host.send({ type: 'choose_first', mode: 'random' });
    await new Promise((r) => setTimeout(r, 20));

    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');

    const result = await host.waitType('first_result');
    expect(result.mode).toBe('random');
    expect(['r', 'b']).toContain(result.ownerSide);
    expect(result.guess).toBeNull();
    await guest.waitType('first_result');

    const redConn = result.ownerSide === 'r' ? host : guest;
    const blackConn = result.ownerSide === 'r' ? guest : host;
    expect((await redConn.waitType('start')).side).toBe('r');
    expect((await blackConn.waitType('start')).side).toBe('b');

    redConn.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await redConn.waitType('move_applied')).turn).toBe('b');
  });

  it('猜先：房主抓单双、对手猜，猜中者执红', async () => {
    const s = await startServer();
    const { c: host, roomId } = await createRoom(s);
    host.send({ type: 'choose_first', mode: 'guess' });
    await new Promise((r) => setTimeout(r, 20));

    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');

    // 第一步：房主收到「抓子」请求（对手不该收到）
    await host.waitType('grasp_request');
    await guest.expectNo('grasp_request');

    // 抓子前：对手猜先或抢着抓子都被拒
    guest.send({ type: 'guess', choice: 'odd' });
    expect((await guest.waitType('error')).message).toBe('当前不在猜先阶段');
    guest.send({ type: 'grasp', choice: 'odd' });
    expect((await guest.waitType('error')).message).toBe('只有房主可以抓子');

    // 房主抓「单」，双方收到猜先请求
    host.send({ type: 'grasp', choice: 'odd' });
    await guest.waitType('guess_request');
    await host.waitType('guess_request');

    // 对手猜「单」→ 猜中 → 对手执红
    guest.send({ type: 'guess', choice: 'odd' });
    const result = await guest.waitType('first_result');
    expect(result.mode).toBe('guess');
    expect(result.guess).toEqual({ choice: 'odd', actual: 'odd', guestWon: true });
    expect(result.ownerSide).toBe('b');

    expect((await guest.waitType('start')).side).toBe('r');
    expect((await host.waitType('start')).side).toBe('b');

    // 红方（对手）先行，房主（黑方）抢先走子被拒
    host.send({ type: 'move', from: [3, 0], to: [4, 0] });
    await host.waitType('move_rejected');
    guest.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await guest.waitType('move_applied')).turn).toBe('b');
  });

  it('猜先未猜中：房主执红；非房主不能改先手方式', async () => {
    const s = await startServer();
    const { c: host, roomId } = await createRoom(s);
    host.send({ type: 'choose_first', mode: 'guess' });
    await new Promise((r) => setTimeout(r, 20));

    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');
    await host.waitType('grasp_request');

    guest.send({ type: 'choose_first', mode: 'r' });
    expect((await guest.waitType('error')).message).toBe('只有房主可以选择先手方式');

    host.send({ type: 'grasp', choice: 'even' });
    await guest.waitType('guess_request');
    guest.send({ type: 'guess', choice: 'odd' });

    const result = await host.waitType('first_result');
    expect(result.guess).toEqual({ choice: 'odd', actual: 'even', guestWon: false });
    expect(result.ownerSide).toBe('r');
    expect((await host.waitType('start')).side).toBe('r');
    expect((await guest.waitType('start')).side).toBe('b');
  });

  it('对局进行中不允许更改先手方式', async () => {
    const s = await startServer();
    const { host } = await setupGame(s);
    host.send({ type: 'choose_first', mode: 'guess' });
    expect((await host.waitType('error')).message).toBe('对局进行中，无法更改先手方式');
  });
});

describe('服务器 · 对局回顾与 AI 推荐', () => {
  /** 打一局并结束（默认房主执红，走一步后红方认输） */
  async function playAndFinish() {
    const s = await startServer();
    const { host, guest, roomId } = await setupGame(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    host.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');
    return { s, base: `http://127.0.0.1:${s.address.port}`, roomId };
  }

  it('终局后写入记录：玩家、取先方式、时间、胜负与着法数', async () => {
    const { base } = await playAndFinish();
    const list = (await (await fetch(`${base}/api/history`)).json()) as {
      games: Record<string, unknown>[];
    };
    expect(list.games).toHaveLength(1);
    const g = list.games[0];
    expect((g.red as { kind: string }).kind).toBe('guest');
    expect((g.black as { kind: string }).kind).toBe('guest');
    expect(g.firstMode).toBe('r');
    expect(g.guess).toBeNull();
    expect(g.winner).toBe('b');
    expect(g.reason).toBe('认输');
    expect(g.moveCount).toBe(1);
    expect(g.startedAt).toBeLessThanOrEqual(g.endedAt as number);
  });

  it('记录明细含着法序列，未知 id 返回 404', async () => {
    const { base } = await playAndFinish();
    const list = (await (await fetch(`${base}/api/history`)).json()) as { games: { id: string }[] };
    const detail = (await (await fetch(`${base}/api/history/${list.games[0].id}`)).json()) as {
      moves: { from: Pos; to: Pos }[];
    };
    expect(detail.moves).toEqual([{ from: [9, 0], to: [8, 0] }]);
    expect((await fetch(`${base}/api/history/999`)).status).toBe(404);
  });

  it('AI 推荐：按步数复原局面并返回该行棋方的合法着法', async () => {
    const { base } = await playAndFinish();
    const list = (await (await fetch(`${base}/api/history`)).json()) as { games: { id: string }[] };
    const id = list.games[0].id;

    const hint = (await (await fetch(`${base}/api/ai/hint?id=${id}&index=0`)).json()) as {
      side: string;
      from: Pos;
      to: Pos;
      text: string;
    };
    expect(hint.side).toBe('r'); // 第 0 步（开局）红方行棋
    expect(validateMove(initBoard(), hint.from, hint.to, 'r')).toBeNull();
    expect(hint.text.length).toBeGreaterThan(0);

    const hint2 = (await (await fetch(`${base}/api/ai/hint?id=${id}&index=1`)).json()) as { side: string };
    expect(hint2.side).toBe('b');
  });

  it('AI 走子接口：POST /api/ai/move 由注入的引擎返回着法', async () => {
    const seen: { side: Side; level: EngineLevel }[] = [];
    const stub: EnginePort = {
      bestMove(_board: Board, side: Side, level: EngineLevel) {
        seen.push({ side, level });
        return Promise.resolve({ move: { from: [9, 0], to: [8, 0] }, source: 'pikafish' });
      },
    };
    const s = await startServer({ engine: stub });
    const base = `http://127.0.0.1:${s.address.port}`;
    const res = await fetch(`${base}/api/ai/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: START_FEN, level: 3 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: [9, 0], to: [8, 0], source: 'pikafish' });
    expect(seen).toEqual([{ side: 'r', level: 3 }]);
  });

  it('AI 走子接口：非法 FEN 返回 400，非 POST 返回 405', async () => {
    const s = await startServer({ engine: new LocalEngine() });
    const base = `http://127.0.0.1:${s.address.port}`;
    const bad = await fetch(`${base}/api/ai/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: 'not-a-fen', level: 2 }),
    });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/ai/move`)).status).toBe(405);
  });

  it('AI 走子接口：未配置引擎时回退纯 TS 引擎，仍返回合法着法', async () => {
    // vitest 全局 env 设了 LANSCHESS_ENGINE=off，故此处 createEngine() 走纯 TS
    const s = await startServer();
    const base = `http://127.0.0.1:${s.address.port}`;
    const res = await fetch(`${base}/api/ai/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: START_FEN, level: 1 }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { from: Pos; to: Pos; source: string };
    expect(data.source).toBe('ts');
    expect(validateMove(initBoard(), data.from, data.to, 'r')).toBeNull();
  });

  it('AI 后续变化：从该步起连续推演若干手（首手即推荐着法、双方交替）', async () => {
    const { base } = await playAndFinish();
    const list = (await (await fetch(`${base}/api/history`)).json()) as { games: { id: string }[] };
    const id = list.games[0].id;

    const line = (await (await fetch(`${base}/api/ai/line?id=${id}&index=0&plies=2`)).json()) as {
      side: string;
      moves: { side: string; from: Pos; to: Pos; text: string }[];
    };
    expect(line.side).toBe('r'); // 第 0 步（开局）红方行棋
    expect(line.moves.length).toBeGreaterThanOrEqual(1);
    expect(line.moves[0].side).toBe('r');
    expect(validateMove(initBoard(), line.moves[0].from, line.moves[0].to, 'r')).toBeNull();
    if (line.moves.length > 1) expect(line.moves[1].side).toBe('b');
    expect(line.moves.every((m) => m.text.length > 0)).toBe(true);

    // 未知 id → 404
    expect((await fetch(`${base}/api/ai/line?id=999`)).status).toBe(404);
  }, 15000);

  it('AI 后续变化：传入 first 时首手复用「推荐」着法（保证与 AI 推荐一致）', async () => {
    const { base } = await playAndFinish();
    const list = (await (await fetch(`${base}/api/history`)).json()) as { games: { id: string }[] };
    const id = list.games[0].id;
    const hint = (await (await fetch(`${base}/api/ai/hint?id=${id}&index=0`)).json()) as {
      from: Pos;
      to: Pos;
    };
    const first = `${hint.from[0]},${hint.from[1]},${hint.to[0]},${hint.to[1]}`;
    const line = (await (
      await fetch(`${base}/api/ai/line?id=${id}&index=0&plies=3&first=${first}`)
    ).json()) as { moves: { from: Pos; to: Pos }[] };
    expect(line.moves.length).toBeGreaterThanOrEqual(1);
    expect(line.moves[0].from).toEqual(hint.from);
    expect(line.moves[0].to).toEqual(hint.to);
  }, 15000);

  it('对局未结束时不写入记录', async () => {
    const s = await startServer();
    await setupGame(s);
    const list = (await (await fetch(`http://127.0.0.1:${s.address.port}/api/history`)).json()) as {
      games: unknown[];
    };
    expect(list.games).toHaveLength(0);
  });

  it('人机对局终局不计入对局回顾', async () => {
    const s = await startServer({ aiDelayMs: 1000 });
    const base = `http://127.0.0.1:${s.address.port}`;
    const { c: host } = await createRoom(s, { mode: 'ai' });
    await host.waitType('start');
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    host.send({ type: 'resign' });
    await host.waitType('game_over');

    const list = (await (await fetch(`${base}/api/history`)).json()) as { games: unknown[] };
    expect(list.games).toHaveLength(0);
  }, 10000);
});

describe('服务器 · HTTP 接口与账号', () => {
  it('/api/server-info 返回地址、版本与房间数', async () => {
    const s = await startServer();
    const info = (await (await fetch(`http://127.0.0.1:${s.address.port}/api/server-info`)).json()) as {
      port: number;
      version: string;
      rooms: number;
    };
    expect(info.port).toBe(s.address.port);
    expect(info.version).toBeTruthy();
    expect(info.rooms).toBe(0);
  });

  it('/api/rooms 返回房间列表', async () => {
    const s = await startServer();
    const { roomId } = await createRoom(s);
    const data = (await (await fetch(`http://127.0.0.1:${s.address.port}/api/rooms`)).json()) as {
      rooms: { roomId: string }[];
    };
    expect(data.rooms.map((r) => r.roomId)).toEqual([roomId]);
  });

  it('API 带跨源响应头，OPTIONS 预检直接放行（桌面客户端从本机外壳页访问）', async () => {
    const s = await startServer();
    const base = `http://127.0.0.1:${s.address.port}`;
    const res = await fetch(`${base}/api/history`, { headers: { Origin: 'http://127.0.0.1:5555' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    const preflight = await fetch(`${base}/api/history`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');
  });

  it('我的历史：/api/history?user= 只返回该玩家的对局', async () => {
    const s = await startServer();
    const base = `http://127.0.0.1:${s.address.port}`;
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'pass1234' }),
    });
    const { token } = (await reg.json()) as { token: string };

    // 第一局：账号 bob 执红（对手认输）；第二局：两名游客
    const { c: host, roomId } = await createRoom(s, { token });
    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');
    await host.waitType('start');
    guest.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    const second = await setupGame(s);
    second.host.send({ type: 'resign' });
    await second.host.waitType('game_over');

    const all = (await (await fetch(`${base}/api/history`)).json()) as { games: unknown[] };
    expect(all.games).toHaveLength(2);

    const mine = (await (
      await fetch(`${base}/api/history?user=${encodeURIComponent('account:bob')}`)
    ).json()) as { games: { red: { name: string } }[] };
    expect(mine.games).toHaveLength(1);
    expect(mine.games[0].red.name).toBe('bob');

    const none = (await (await fetch(`${base}/api/history?user=account:nobody`)).json()) as {
      games: unknown[];
    };
    expect(none.games).toHaveLength(0);
  });

  it('注册 / 登录：签发 token，重复用户名与错误密码被拒', async () => {
    const s = await startServer();
    const base = `http://127.0.0.1:${s.address.port}`;
    const post = (p: string, body: unknown) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const reg = await post('/api/auth/register', { username: 'alice', password: 'pass1234' });
    expect(reg.status).toBe(200);
    const regBody = (await reg.json()) as { token: string; username: string };
    expect(regBody.username).toBe('alice');
    expect(regBody.token).toBeTruthy();

    expect((await post('/api/auth/register', { username: 'alice', password: 'pass1234' })).status).toBe(400);
    expect((await post('/api/auth/register', { username: 'ab', password: 'pass1234' })).status).toBe(400);

    const login = await post('/api/auth/login', { username: 'alice', password: 'pass1234' });
    expect(login.status).toBe(200);
    expect((await post('/api/auth/login', { username: 'alice', password: 'bad' })).status).toBe(400);
  });

  it('账号 token 可用于加入房间并归属对局记录', async () => {
    const s = await startServer();
    const base = `http://127.0.0.1:${s.address.port}`;
    const reg = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'pass1234' }),
    });
    const { token } = (await reg.json()) as { token: string };

    const { c: host, roomId } = await createRoom(s, { token });
    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');
    await host.waitType('start');
    guest.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    const list = (await (await fetch(`${base}/api/history`)).json()) as {
      games: { red: { name: string; kind: string } }[];
    };
    expect(list.games[0].red).toMatchObject({ name: 'bob', kind: 'account' });
  });
});

describe('服务器 · 静态资源', () => {
  let base = '';
  let dir = '';
  let secret = '';
  let server: GameServer | null = null;

  beforeAll(async () => {
    // 构造与 dist 相同的目录结构：renderer/* 页面脚本 + shared/* 共享模块
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'lanchess-static-'));
    dir = path.join(base, 'root');
    secret = path.join(base, 'lanchess-secret.txt');
    fs.mkdirSync(path.join(dir, 'renderer'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'shared'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'renderer', 'index.html'), '<!DOCTYPE html><title>t</title>');
    fs.writeFileSync(path.join(dir, 'renderer', 'app.js'), 'export const app = 1;');
    fs.writeFileSync(path.join(dir, 'renderer', 'styles.css'), 'body{}');
    fs.writeFileSync(path.join(dir, 'renderer', 'data.json'), '{"ok":true}');
    fs.writeFileSync(path.join(dir, 'renderer', 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(dir, 'renderer', 'piece.png'), 'png-bytes');
    fs.writeFileSync(path.join(dir, 'renderer', 'board.jpg'), 'jpg-bytes');
    fs.writeFileSync(path.join(dir, 'renderer', 'click.wav'), 'wav-bytes');
    fs.writeFileSync(path.join(dir, 'renderer', 'blob.bin'), 'binary');
    fs.writeFileSync(path.join(dir, 'shared', 'rules.js'), 'export const rules = 1;');
    // 静态根目录之外的敏感文件不应能被访问
    fs.writeFileSync(secret, 'top-secret');
    // 与根目录前缀相同的兄弟目录（dist-evil 类）：startsWith 判断会误判放行
    fs.mkdirSync(path.join(base, 'root-evil'), { recursive: true });
    fs.writeFileSync(path.join(base, 'root-evil', 'secret.txt'), 'sibling-secret');

    for (let i = 0; i < 5 && !server; i++) {
      const candidate = new GameServer({
        port: 20000 + Math.floor(Math.random() * 30000),
        staticDir: dir,
        host: '127.0.0.1',
        dataDir: null,
      });
      try {
        await candidate.listen();
        server = candidate;
      } catch {
        server = null;
      }
    }
    if (!server) throw new Error('无法启动静态资源测试服务');
  });

  afterAll(async () => {
    await server?.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('根路径返回页面', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.address.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<title>t</title>');
  });

  it('页面脚本可从 renderer 目录取到', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.address.port}/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });

  it('共享模块 ../shared/rules.js 可以正常加载', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.address.port}/shared/rules.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('export const rules');
  });

  it('样式表可访问', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.address.port}/styles.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
  });

  it('MIME 白名单覆盖 json / svg，未知扩展名回退 octet-stream', async () => {
    const json = await fetch(`http://127.0.0.1:${server!.address.port}/data.json`);
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');

    const svg = await fetch(`http://127.0.0.1:${server!.address.port}/icon.svg`);
    expect(svg.status).toBe(200);
    expect(svg.headers.get('content-type')).toContain('image/svg+xml');

    const bin = await fetch(`http://127.0.0.1:${server!.address.port}/blob.bin`);
    expect(bin.status).toBe(200);
    expect(bin.headers.get('content-type')).toContain('application/octet-stream');
  });

  it('棋盘图片与音效素材按正确 MIME 返回（浏览器可渲染 / 播放）', async () => {
    const png = await fetch(`http://127.0.0.1:${server!.address.port}/piece.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toContain('image/png');

    const jpg = await fetch(`http://127.0.0.1:${server!.address.port}/board.jpg`);
    expect(jpg.status).toBe(200);
    expect(jpg.headers.get('content-type')).toContain('image/jpeg');

    const wav = await fetch(`http://127.0.0.1:${server!.address.port}/click.wav`);
    expect(wav.status).toBe(200);
    expect(wav.headers.get('content-type')).toContain('audio/wav');
  });

  it('不存在的文件返回 404', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.address.port}/nope.js`);
    expect(res.status).toBe(404);
  });

  it('拒绝路径穿越访问项目外的文件', async () => {
    const res = await fetch(`http://127.0.0.1:${server!.address.port}/../lanchess-secret.txt`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('secret');
  });

  it('拒绝同前缀兄弟目录（root-evil）的路径穿越', async () => {
    // 原始请求路径保留编码，避免 fetch/URL 规范化掉 `..`
    const res = await rawGet(server!.address.port, '/..%2Froot-evil%2Fsecret.txt');
    expect(res.status).toBe(404);
    expect(res.body).not.toContain('sibling-secret');
  });
});

describe('服务器 · 人机对战与计时读秒', () => {
  it('人机对战：人类执红，AI 延迟后自动走黑', async () => {
    const s = await startServer({ aiDelayMs: 20 });
    const { c: host, joined } = await createRoom(s, { mode: 'ai' });
    expect(host).toBeDefined();
    expect(joined.seat).toBe('r');
    expect((await host.waitType('start')).state.status).toBe('playing');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await host.waitType('move_applied')).seq).toBe(1);

    const ai = await host.waitType('move_applied');
    expect(ai.seq).toBe(2);
    expect(ai.turn).toBe('r'); // AI 走完轮到红方
    expect(ai.history).toHaveLength(2);
  }, 10000);

  it('人机对战：其它玩家无法加入（房间已满），观战者可加入', async () => {
    const s = await startServer({ aiDelayMs: 1000 });
    const { roomId } = await createRoom(s, { mode: 'ai' });

    const other = await joinRoom(s, roomId);
    expect((await other.waitType('error')).message).toBe('房间已满');

    const watcher = await joinRoom(s, roomId, { role: 'spectator' });
    expect((await watcher.waitType('room_joined')).seat).toBeNull();
  });

  it('人机对战：悔棋自动同意、和棋被拒、重开自动同意', async () => {
    const s = await startServer({ aiDelayMs: 20 });
    const { c: host } = await createRoom(s, { mode: 'ai' });
    await host.waitType('start');
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await host.waitType('move_applied'); // AI 应招

    host.send({ type: 'undo_request' });
    expect((await host.waitType('undo_response')).accept).toBe(true);
    await host.waitType('state');
    expect((await host.waitType('move_applied')).seq).toBe(2);

    host.send({ type: 'draw_request' });
    expect((await host.waitType('draw_response')).accept).toBe(false);

    host.send({ type: 'resign' });
    await host.waitType('game_over');
    host.send({ type: 'restart_request' });
    const restarted = await host.waitType('start');
    expect(restarted.state.moveSeq).toBe(0);
  }, 10000);

  it('人机对战难度：depth 参数（1-4）生效，非法值沿用上次', async () => {
    const s = await startServer({ aiDelayMs: 1000 });
    const a = await createRoom(s, { mode: 'ai', depth: 4 });
    const room = s.room(a.roomId)!;
    expect(room).toBeDefined();

    // 非法 depth 不报错，仍可正常建房
    const b = await createRoom(s, { mode: 'ai', depth: 99 });
    expect(b.roomId).toMatch(/^\d{6}$/);
  });

  it('计时读秒：本回合超时判负并清空 deadline', async () => {
    const s = await startServer({ turnMs: 150 });
    const { host, hStart } = await setupGame(s);
    expect(hStart.state.deadline as number).toBeGreaterThan(Date.now());

    const over = await host.waitType('game_over');
    expect(over.reason).toBe('超时判负');
    expect(over.winner).toBe('b'); // 红方先行且未走子
    expect(over.state.deadline).toBeNull();
  });

  it('计时读秒：走子后 deadline 顺延给下一方', async () => {
    const s = await startServer({ turnMs: 5000 });
    const { host, hStart } = await setupGame(s);
    const firstDeadline = hStart.state.deadline as number;

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await host.waitType('move_applied')).deadline as number).toBeGreaterThanOrEqual(firstDeadline);
  });
});

describe('服务器 · 日志与端口回退', () => {
  it('默认输出连接/走子/终局打点，LANSCHESS_DEBUG=0 可关闭', async () => {
    vi.stubEnv('LANSCHESS_DEBUG', '1'); // 打开（同时包含 debug 明细）
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const s = await startServer();
    const { host, guest } = await setupGame(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    host.send({ type: 'resign' });
    await host.waitType('game_over');

    const logs = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logs).toContain('房主加入');
    expect(logs).toContain('对手加入');
    expect(logs).toContain('走子 红方');
    expect(logs).toContain('对局结束 黑方胜（认输）');

    // 关闭开关后不再输出
    vi.stubEnv('LANSCHESS_DEBUG', '0');
    spy.mockClear();
    guest.send({ type: 'ping', t: 1 });
    await guest.waitType('pong');
    expect(spy).not.toHaveBeenCalled();
  });

  it('listenWithFallback：端口占用时回退随机端口', async () => {
    // 占用者与待启动者都用默认 0.0.0.0，保证两平台都能触发 EADDRINUSE
    const first = new GameServer({ port: 0, dataDir: null });
    const occupied = await first.listen();
    try {
      const started = await listenWithFallback(occupied, false, null);
      try {
        expect(started.fallback).toBe(true);
        expect(started.port).not.toBe(occupied);
      } finally {
        await started.server.close();
      }
    } finally {
      await first.close();
    }
  });

  it('listenWithFallback：显式指定端口被占用时抛出 EADDRINUSE', async () => {
    const first = new GameServer({ port: 0, dataDir: null });
    const occupied = await first.listen();
    try {
      await expect(listenWithFallback(occupied, true, null)).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await first.close();
    }
  });
});

describe('服务器 · 在线玩家与房间邀请', () => {
  it('list_players 返回在线玩家：在房间内的人带房间号，大厅玩家 roomId 为 null', async () => {
    const s = await startServer();
    const { host, roomId } = await setupGame(s);
    const lobby = await open(s.address.port);

    host.send({ type: 'list_players' });
    const list = await host.waitType('player_list');
    expect(list.players).toHaveLength(3);
    expect(list.players.filter((p) => p.roomId === roomId)).toHaveLength(2);
    expect(list.players.filter((p) => p.roomId === null)).toHaveLength(1);
    expect(list.players.every((p) => p.online)).toBe(true);
    expect(lobby).toBeDefined();
  });

  it('list_players 包含已注册但离线的账号（online=false，不可邀请）', async () => {
    const s = await startServer();
    const { c: host } = await createRoom(s);
    // 注册后用 REST 直接落盘账号：没有 WebSocket 连接 → 视为离线
    await fetch(`http://127.0.0.1:${s.address.port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'offline_user', password: 'pass1234' }),
    });

    host.send({ type: 'list_players' });
    const list = await host.waitType('player_list');
    const offline = list.players.find((p) => p.id === 'account:offline_user');
    expect(offline).toBeDefined();
    expect(offline).toMatchObject({ name: 'offline_user', kind: 'account', online: false, roomId: null });

    host.send({ type: 'invite_player', playerId: 'account:offline_user', role: 'player' });
    expect((await host.waitType('error')).message).toBe('该玩家不在线');
  });

  it('邀请大厅玩家：对方收到 invite（含邀请者 / 房间号 / 角色 / 是否上锁）', async () => {
    const s = await startServer();
    const { c: host, roomId, playerId } = await createRoom(s, { password: 'pw' });
    const lobby = await open(s.address.port);

    host.send({ type: 'list_players' });
    const list = await host.waitType('player_list');
    const target = list.players.find((p) => p.id !== playerId)!;
    expect(target.roomId).toBeNull();

    host.send({ type: 'invite_player', playerId: target.id, role: 'player' });
    const inv = await lobby.waitType('invite');
    expect(inv.roomId).toBe(roomId);
    expect(inv.role).toBe('player');
    expect(inv.locked).toBe(true);
    expect(inv.from.name).toBeTruthy();
  });

  it('被邀请者可免口令加入上锁房间，未被邀请者仍需口令', async () => {
    const s = await startServer();
    const { c: host, roomId } = await createRoom(s, { password: 'pw' });
    // 用账号登录，使被邀请者拥有可预测的身份 id
    const invitee = await open(s.address.port);
    invitee.send({ type: 'register', username: 'alice', password: 'pass1' });
    await invitee.waitType('auth_ok');
    const stranger = await open(s.address.port);

    host.send({ type: 'list_players' });
    const list = await host.waitType('player_list');
    expect(list.players.some((p) => p.id === 'account:alice')).toBe(true);

    host.send({ type: 'invite_player', playerId: 'account:alice', role: 'player' });
    await invitee.waitType('invite');

    invitee.send({ type: 'join_room', roomId, role: 'player' });
    expect((await invitee.waitType('room_joined')).seat).toBe('b');

    stranger.send({ type: 'join_room', roomId, role: 'player' });
    expect((await stranger.waitType('error')).message).toBe('房间口令错误');
  });

  it('邀请校验：玩家不在线 / 已在房间中', async () => {
    const s = await startServer();
    const { host, guestId } = await setupGame(s);

    host.send({ type: 'invite_player', playerId: 'guest:nobody', role: 'player' });
    expect((await host.waitType('error')).message).toBe('该玩家不在线');

    // 已在房间中的对手不能再被邀请
    host.send({ type: 'invite_player', playerId: guestId, role: 'player' });
    expect((await host.waitType('error')).message).toBe('该玩家已在房间中');
  });

  it('房间满员时仍可邀请观战（只读不占席位）', async () => {
    const s = await startServer();
    const { host } = await setupGame(s); // 两席已满
    const lobby = await open(s.address.port);

    host.send({ type: 'list_players' });
    const list = await host.waitType('player_list');
    const target = list.players.find((p) => p.roomId === null)!;

    host.send({ type: 'invite_player', playerId: target.id, role: 'player' });
    expect((await host.waitType('error')).message).toBe('房间已满，无法邀请对局');

    host.send({ type: 'invite_player', playerId: target.id, role: 'spectator' });
    expect((await lobby.waitType('invite')).role).toBe('spectator');
  });

  it('未加入房间时不能邀请，返回错误', async () => {
    const s = await startServer();
    const c = await open(s.address.port);
    c.send({ type: 'invite_player', playerId: 'guest:x', role: 'player' });
    expect((await c.waitType('error')).message).toBe('尚未加入房间');
  });
});

describe('服务器 · 揭棋（暗棋）房间', () => {
  /** 服务端下发的棋盘里某方尚未翻开的暗子数 */
  const hiddenCount = (board: Board, s: Side): number =>
    board.flat().filter((p): p is Piece => !!p && p.s === s && !!p.hidden).length;
  /** 棋盘是否已抹除全部真实身份（客户端 / 观战者都看不到底牌） */
  const noSecrets = (board: Board): boolean => board.flat().every((p) => !p || p.real === undefined);

  it('创建揭棋房间：快照标记 variant=jieqi，房间列表带 jieqi 模式', async () => {
    const s = await startServer();
    const { c: host, joined, roomId } = await createRoom(s, { mode: 'jieqi' });
    expect(joined.state.variant).toBe('jieqi');
    expect(joined.state.status).toBe('waiting');

    host.send({ type: 'list_rooms' });
    const list = await host.waitType('room_list');
    expect(list.rooms.find((r) => r.roomId === roomId)?.mode).toBe('jieqi');
  });

  it('开局洗子：双方各 15 暗子、将帅明置、下发棋盘不含真实身份', async () => {
    const s = await startServer();
    const { c: host, roomId } = await createRoom(s, { mode: 'jieqi' });
    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');
    const hStart = await host.waitType('start');
    const gStart = await guest.waitType('start');

    expect(hStart.state.variant).toBe('jieqi');
    expect(hStart.side).toBe('r');
    expect(gStart.side).toBe('b');
    expect(hiddenCount(hStart.state.board, 'r')).toBe(15);
    expect(hiddenCount(hStart.state.board, 'b')).toBe(15);
    expect(hStart.state.board[9][4]).toEqual({ t: 'K', s: 'r' });
    expect(hStart.state.board[0][4]).toEqual({ t: 'K', s: 'b' });
    // 权威端持有真实身份，但下发的棋盘已抹除
    expect(hStart.state.board.flat().some((p) => !!p?.hidden)).toBe(true);
    expect(noSecrets(hStart.state.board)).toBe(true);
    // 双方看到完全相同的（已抹除）棋盘
    expect(gStart.state.board).toEqual(hStart.state.board);
  });

  it('走子：落点暗子翻开并广播（含变体与吃子记录），观战者同样看不到底牌', async () => {
    const s = await startServer();
    const { c: host, roomId } = await createRoom(s, { mode: 'jieqi' });
    const guest = await joinRoom(s, roomId);
    await guest.waitType('room_joined');
    await host.waitType('start');

    const watcher = await joinRoom(s, roomId, { role: 'spectator' });
    const wJoined = await watcher.waitType('room_joined');
    expect(wJoined.seat).toBeNull();
    expect(wJoined.state.variant).toBe('jieqi');
    expect(noSecrets(wJoined.state.board)).toBe(true);

    // 红方 (9,0) 是「车」位的暗子，首步按车走子
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const applied = await host.waitType('move_applied');
    expect(applied.variant).toBe('jieqi');
    expect(applied.capturedByRed).toEqual([]);
    expect(applied.capturedByBlack).toEqual([]);
    expect(applied.board[8][0]!.hidden).toBeUndefined(); // 已翻开
    expect(applied.board[8][0]!.real).toBeUndefined();
    expect(noSecrets(applied.board)).toBe(true);
  });

  it('揭棋对局不计入对局回顾（终局后记录为空）', async () => {
    const s = await startServer();
    const { host } = await setupJieqiGame(s);
    host.send({ type: 'resign' });
    await host.waitType('game_over');

    const list = (await (await fetch(`http://127.0.0.1:${s.address.port}/api/history`)).json()) as {
      games: unknown[];
    };
    expect(list.games).toHaveLength(0);
  });

  it('重开：揭棋重新洗子并回到第 0 步', async () => {
    const s = await startServer();
    const { host, guest } = await setupJieqiGame(s);
    host.send({ type: 'resign' });
    await host.waitType('game_over');

    host.send({ type: 'restart_request' });
    const req = await guest.waitType('restart_request');
    expect(req).toBeDefined();
    guest.send({ type: 'restart_response', accept: true });
    const restarted = await host.waitType('start');
    expect(restarted.state.variant).toBe('jieqi');
    expect(restarted.state.moveSeq).toBe(0);
    expect(hiddenCount(restarted.state.board, 'r')).toBe(15);
    expect(hiddenCount(restarted.state.board, 'b')).toBe(15);
  });
});
