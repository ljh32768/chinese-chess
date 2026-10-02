import { afterEach, describe, expect, it } from 'vitest';
import { HostServer } from '../src/server/host-server.js';
import { Board } from '../src/shared/types.js';
import { TestClient } from './ws-client.js';

let server: HostServer | null = null;
const clients: TestClient[] = [];

/** 随机取一个高位端口并启动服务，避开 fetch 屏蔽的端口与端口占用 */
async function startServer(): Promise<HostServer> {
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const candidate = new HostServer({
      port: 20000 + Math.floor(Math.random() * 30000),
      staticDir: null,
      host: '127.0.0.1',
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

async function connect(port: number, role: 'host' | 'guest'): Promise<TestClient> {
  const c = new TestClient(port);
  clients.push(c);
  await c.open();
  c.send({ type: 'join', role });
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server?.close();
  server = null;
});

/** 从 move_applied 里取某一格，便于断言 */
const at = (board: Board, r: number, c: number) => board[r][c];

describe('主机服务 · 连接与开局', () => {
  it('未创建对局时加入者会被拒绝', async () => {
    const s = await startServer();
    const guest = await connect(s.address.port, 'guest');
    const err = await guest.waitType('error');
    expect(err.message).toBe('主机尚未创建对局');
  });

  it('创建对局后双方加入会自动开局', async () => {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    const welcome = await host.waitType('welcome');
    expect(welcome.side).toBe('r');

    const guest = await connect(s.address.port, 'guest');
    const gw = await guest.waitType('welcome');
    expect(gw.side).toBe('b');
    await host.waitType('opponent_joined');

    const start = await guest.waitType('start');
    expect(start.state.status).toBe('playing');
    expect(start.state.turn).toBe('r');
  });

  it('对局已满时第二个加入者被拒绝', async () => {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');

    const extra = await connect(s.address.port, 'guest');
    const err = await extra.waitType('error');
    expect(err.message).toBe('对局已满，无法加入');
  });
});

describe('主机服务 · 走子同步', () => {
  async function setup(): Promise<{ host: TestClient; guest: TestClient }> {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    await guest.waitType('start');
    return { host, guest };
  }

  it('走子成功会向双方广播完整棋盘与 seq', async () => {
    const { host, guest } = await setup();

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const hMsg = await host.waitType('move_applied');
    const gMsg = await guest.waitType('move_applied');

    expect(hMsg.seq).toBe(1);
    expect(hMsg.turn).toBe('b');
    expect(at(hMsg.board, 8, 0)).toEqual({ t: 'R', s: 'r' });
    expect(at(hMsg.board, 9, 0)).toBeNull();
    expect(gMsg.seq).toBe(1);

    guest.send({ type: 'move', from: [3, 0], to: [4, 0] });
    const hMsg2 = await host.waitType('move_applied');
    expect(hMsg2.seq).toBe(2);
    expect(hMsg2.turn).toBe('r');
    expect(at(hMsg2.board, 4, 0)).toEqual({ t: 'P', s: 'b' });
  });

  it('非本方回合走子被拒绝', async () => {
    const { guest } = await setup();
    guest.send({ type: 'move', from: [9, 0], to: [8, 0] }); // 黑方在红方回合走子
    const rejected = await guest.waitType('move_rejected');
    expect(rejected.reason).toBe('还没轮到你走棋');
  });

  it('不能移动对方的棋子', async () => {
    const { host } = await setup();
    host.send({ type: 'move', from: [3, 0], to: [4, 0] }); // 红方去动黑卒
    const rejected = await host.waitType('move_rejected');
    expect(rejected.reason).toBe('这不是你的棋子');
  });

  it('非法走子被拒绝且不广播', async () => {
    const { host, guest } = await setup();
    host.send({ type: 'move', from: [6, 0], to: [4, 0] }); // 兵走两格
    const rejected = await host.waitType('move_rejected');
    expect(rejected.reason).toBe('不符合走法或会送将');
    await guest.expectNo('move_applied');
  });

  it('走子后轮到对方，双方棋盘一致', async () => {
    const { host, guest } = await setup();
    host.send({ type: 'move', from: [7, 1], to: [7, 4] }); // 红炮平移到中路
    await host.waitType('move_applied');
    const gMsg = await guest.waitType('move_applied');
    expect(at(gMsg.board, 7, 4)).toEqual({ t: 'C', s: 'r' });
  });
});

describe('主机服务 · 对局控制', () => {
  async function setup() {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    await guest.waitType('start');
    return { host, guest };
  }

  it('认输会广播 game_over', async () => {
    const { host, guest } = await setup();
    guest.send({ type: 'resign' });
    const over = await host.waitType('game_over');
    expect(over.winner).toBe('r');
    expect(over.reason).toBe('认输');
    const over2 = await guest.waitType('game_over');
    expect(over2.winner).toBe('r');
  });

  it('和棋请求被同意后判和', async () => {
    const { host, guest } = await setup();
    host.send({ type: 'draw_request' });
    await guest.waitType('draw_request');
    guest.send({ type: 'draw_response', accept: true });
    const over = await host.waitType('game_over');
    expect(over.winner).toBeNull();
    expect(over.reason).toBe('同意和棋');
  });

  it('拒绝和棋请求则对局继续', async () => {
    const { host, guest } = await setup();
    host.send({ type: 'draw_request' });
    await guest.waitType('draw_request');
    guest.send({ type: 'draw_response', accept: false });
    const resp = await host.waitType('draw_response');
    expect(resp.accept).toBe(false);
    await host.expectNo('game_over');
  });

  it('双方同意后重开，回到初始局面', async () => {
    const { host, guest } = await setup();
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
});

describe('主机服务 · 断线与心跳', () => {
  it('对手断线会给另一方提示', async () => {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');

    guest.close();
    const left = await host.waitType('opponent_left');
    expect(left.reason).toBe('对手已离开');
  });

  it('ping 会得到 pong', async () => {
    const s = await startServer();
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    host.send({ type: 'ping', t: 12345 });
    const pong = await host.waitType('pong');
    expect(pong.t).toBe(12345);
  });

  it('未知消息类型返回 error 且服务不崩溃', async () => {
    const s = await startServer();
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    host.ws.send('这不是 JSON');
    const err = await host.waitType('error');
    expect(err.message).toBe('无法解析的消息');
    host.send({ type: 'ping', t: 1 });
    expect((await host.waitType('pong')).t).toBe(1);
  });
});

describe('主机服务 · HTTP 接口', () => {
  it('/api/host-info 返回地址与状态', async () => {
    const s = await startServer();
    const res = await fetch(`http://127.0.0.1:${s.address.port}/api/host-info`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as { port: number; hosting: boolean };
    expect(info.port).toBe(s.address.port);
    expect(info.hosting).toBe(false);
  });

  it('/api/host/start 会开启等待状态', async () => {
    const s = await startServer();
    const res = await fetch(`http://127.0.0.1:${s.address.port}/api/host/start`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(s.isHosting()).toBe(true);
    const info = (await (await fetch(`http://127.0.0.1:${s.address.port}/api/host-info`)).json()) as {
      hosting: boolean;
    };
    expect(info.hosting).toBe(true);
  });
});