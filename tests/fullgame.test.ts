/**
 * 完整一盘棋的端到端回放测试：
 * 双方通过 WebSocket 轮流走子，直到红方将死黑方，验证：
 * 1. 每一步双方广播的棋盘一致，且与服务器权威棋盘一致；
 * 2. seq 单调递增，防乱序；
 * 3. 终局广播 game_over，原因为「将死」（对局记录中带有识别出的杀法名）；
 * 4. 结束后可重开，回到初始局面。
 *
 * 着法序列由 scripts/find-mate.mjs 生成并逐步校验（见该脚本的回放校验输出）。
 */

import { afterEach, describe, expect, it } from 'vitest';
import { GameServer } from '../src/server/server.js';
import { Board } from '../src/shared/types.js';
import { MATE_LINE } from './mate-line.js';
import { TestClient } from './ws-client.js';

let server: GameServer | null = null;
const clients: TestClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = null;
});

/** 随机取一个高位端口并启动服务，避开 fetch 屏蔽的端口与端口占用 */
async function startServer(): Promise<GameServer> {
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const candidate = new GameServer({
      port: 20000 + Math.floor(Math.random() * 30000),
      staticDir: null,
      host: '127.0.0.1',
      dataDir: null,
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

const boardKey = (b: Board) => JSON.stringify(b);

async function open(port: number): Promise<TestClient> {
  const c = new TestClient(port);
  clients.push(c);
  await c.open();
  return c;
}

describe('完整对局回放', () => {
  it('双方走完一整盘棋，红方将死黑方，棋盘始终一致', async () => {
    const s = await startServer();

    // 房主建房（默认执红），对手加入后自动开局
    const host = await open(s.address.port);
    host.send({ type: 'create_room', mode: 'pvp' });
    const roomId = (await host.waitType('room_joined')).roomId;

    const guest = await open(s.address.port);
    guest.send({ type: 'join_room', roomId, role: 'player' });
    const gJoined = await guest.waitType('room_joined');
    expect(gJoined.seat).toBe('b');
    await host.waitType('start');
    await guest.waitType('start');

    let expectedSeq = 0;
    let sawCheck = false;

    for (let i = 0; i < MATE_LINE.length; i++) {
      const mover = i % 2 === 0 ? host : guest;
      const other = i % 2 === 0 ? guest : host;
      const step = MATE_LINE[i];

      mover.send({ type: 'move', from: step.from, to: step.to });

      const mine = await mover.waitType('move_applied');
      const theirs = await other.waitType('move_applied');

      // seq 单调递增且双方一致
      expect(mine.seq).toBe(expectedSeq + 1);
      expect(theirs.seq).toBe(mine.seq);
      expectedSeq = mine.seq;

      // 双方收到的棋盘完全一致，且与服务器权威棋盘一致
      expect(boardKey(theirs.board)).toBe(boardKey(mine.board));
      expect(boardKey(s.room(roomId)!.game.board)).toBe(boardKey(mine.board));

      // 走子在服务器权威棋盘上确实生效
      expect(mine.board[step.to[0]][step.to[1]]).not.toBeNull();
      expect(mine.board[step.from[0]][step.from[1]]).toBeNull();

      expect(mine.lastMove).toEqual({ from: step.from, to: step.to });

      if (mine.check) sawCheck = true;

      if (i === MATE_LINE.length - 1) {
        // 终局：最后一步将死，status 为 over
        expect(mine.status).toBe('over');
        expect(mine.winner).toBe('r');
        expect(mine.reason).toBe('将死');
      } else {
        expect(mine.status).toBe('playing');
      }
    }

    // 对局过程中至少出现过一次将军
    expect(sawCheck).toBe(true);

    // 双方都收到 game_over，判定一致
    const overHost = await host.waitType('game_over');
    const overGuest = await guest.waitType('game_over');
    expect(overHost.winner).toBe('r');
    expect(overHost.reason).toBe('将死');
    expect(overGuest.winner).toBe('r');
    expect(boardKey(overHost.state.board)).toBe(boardKey(overGuest.state.board));
    expect(overHost.state.moveSeq).toBe(MATE_LINE.length);
    expect(overHost.state.history).toHaveLength(MATE_LINE.length);
    expect(overHost.state.history[0]).toEqual(MATE_LINE[0]);

    // 对局记录带识别出的杀法名（「将死」不再只有泛指文案）
    const list = (await (await fetch(`http://127.0.0.1:${s.address.port}/api/history`)).json()) as {
      games: { reason: string; killMethod?: string }[];
    };
    expect(list.games).toHaveLength(1);
    expect(list.games[0].reason).toBe('将死');
    expect(list.games[0].killMethod).toBe('夹车炮杀');

    // 终局后走子会被拒绝，程序不崩溃
    guest.send({ type: 'move', from: [9, 4], to: [8, 4] });
    const rejected = await guest.waitType('move_rejected');
    expect(rejected.reason).toBe('对局未在进行中');

    // 重开：回到初始局面
    host.send({ type: 'restart_request' });
    await guest.waitType('restart_request');
    guest.send({ type: 'restart_response', accept: true });
    const restarted = await host.waitType('start');
    expect(restarted.state.moveSeq).toBe(0);
    expect(restarted.state.turn).toBe('r');
    expect(restarted.state.status).toBe('playing');
    expect(boardKey(restarted.state.board)).toBe(boardKey(s.room(roomId)!.game.board));
  }, 30000);
});
