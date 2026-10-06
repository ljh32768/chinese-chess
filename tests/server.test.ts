import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { HostServer, listenWithFallback } from '../src/server/host-server.js';
import { Board } from '../src/shared/types.js';
import { TestClient } from './ws-client.js';

let server: HostServer | null = null;
const clients: TestClient[] = [];

interface ServerOpts {
  graceMs?: number;
  turnMs?: number;
  aiDelayMs?: number;
}

/** 随机取一个高位端口并启动服务，避开 fetch 屏蔽的端口与端口占用 */
async function startServer(opts: ServerOpts = {}): Promise<HostServer> {
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const candidate = new HostServer({
      port: 20000 + Math.floor(Math.random() * 30000),
      staticDir: null,
      host: '127.0.0.1',
      graceMs: opts.graceMs,
      turnMs: opts.turnMs,
      aiDelayMs: opts.aiDelayMs,
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

async function connect(port: number, role: 'host' | 'guest' | 'spectator'): Promise<TestClient> {
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

  it('非整数坐标被拒绝为坐标非法，服务仍可继续走子', async () => {
    const { host } = await setup();
    host.send({ type: 'move', from: [1.5, 0], to: [2, 0] });
    const rejected = await host.waitType('move_rejected');
    expect(rejected.reason).toBe('坐标非法');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await host.waitType('move_applied')).seq).toBe(1);
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

  it('拒绝重开请求则维持结束状态，不广播 start', async () => {
    const { host, guest } = await setup();
    host.send({ type: 'resign' });
    await host.waitType('game_over');
    await guest.waitType('game_over');

    guest.send({ type: 'restart_request' });
    await host.waitType('restart_request');
    host.send({ type: 'restart_response', accept: false });
    const resp = await guest.waitType('restart_response');
    expect(resp.accept).toBe(false);
    await guest.expectNo('start');
  });
});

describe('主机服务 · 悔棋（请求-回应）', () => {
  async function setup() {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    await guest.waitType('start');
    return { s, host, guest };
  }

  it('对方同意后回退一步，双方棋盘与棋谱同步', async () => {
    const { host, guest } = await setup();
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
    expect(at(st.state.board, 9, 0)).toEqual({ t: 'R', s: 'r' }); // 红车回到原位
    expect(st.state.turn).toBe('r');

    const st2 = await host.waitType('state');
    expect(st2.state.moveSeq).toBe(0);
  });

  it('拒绝悔棋则局面保持不变', async () => {
    const { s, host, guest } = await setup();
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');

    guest.send({ type: 'undo_request' });
    await host.waitType('undo_request');
    host.send({ type: 'undo_response', accept: false });
    expect((await guest.waitType('undo_response')).accept).toBe(false);
    expect(s.game.moveSeq).toBe(1);
    expect(s.game.history).toHaveLength(1);
  });

  it('没有可悔的棋时请求被拒绝（error 提示）', async () => {
    const { host } = await setup();
    host.send({ type: 'undo_request' });
    const err = await host.waitType('error');
    expect(err.message).toBe('当前没有可悔的棋');
  });

  it('对方不在线（宽限中）时不能悔棋', async () => {
    const { host, guest } = await setup();
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');

    guest.close();
    await host.waitType('opponent_away');
    host.send({ type: 'undo_request' });
    const err = await host.waitType('error');
    expect(err.message).toBe('对方不在线，无法悔棋');
  });
});

describe('主机服务 · 观战', () => {
  it('观战者随时可加入、不占席位，并收到对局广播', async () => {
    const s = await startServer();
    const watcher = await connect(s.address.port, 'spectator');
    const w = await watcher.waitType('welcome');
    expect(w.side).toBeNull();

    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    const start = await watcher.waitType('start');
    expect(start.state.status).toBe('playing');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const applied = await watcher.waitType('move_applied');
    expect(applied.seq).toBe(1);
    await host.waitType('move_applied'); // 双方与观战者都收到广播
  });

  it('观战者不能走子或发起请求（只读）', async () => {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    await guest.waitType('start');

    const watcher = await connect(s.address.port, 'spectator');
    await watcher.waitType('welcome');
    watcher.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await watcher.waitType('error')).message).toBe('观战模式只读');
    watcher.send({ type: 'draw_request' });
    expect((await watcher.waitType('error')).message).toBe('观战模式只读');
    await host.expectNo('move_applied');
  });

  it('观战者离开不影响对局，也不触发宽限', async () => {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    await guest.waitType('start');

    const watcher = await connect(s.address.port, 'spectator');
    await watcher.waitType('welcome');
    watcher.close();
    await host.expectNo('opponent_away');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    expect((await host.waitType('move_applied')).seq).toBe(1);
  });
});

describe('主机服务 · 断线与心跳', () => {
  it('对手意外断线进入宽限等待并通知另一方', async () => {
    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');

    guest.close();
    const away = await host.waitType('opponent_away');
    expect(away.reason).toBe('对手已断开');
    expect(away.graceMs).toBe(30000);
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

describe('主机服务 · 断线重连（宽限期）', () => {
  /** 开局并走一步，制造可验证的进行中局面（红车 [9,0]→[8,0]） */
  async function setupPlaying(graceMs: number) {
    const s = await startServer({ graceMs });
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');
    await guest.waitType('start');
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await guest.waitType('move_applied');
    return { s, host, guest };
  }

  it('加入者意外断线后对局保留，宽限期内重连恢复原局面', async () => {
    const { s, host, guest } = await setupPlaying(1000);
    guest.close();
    const away = await host.waitType('opponent_away');
    expect(away.reason).toBe('对手已断开');
    expect(away.graceMs).toBe(1000);
    expect(s.game.status).toBe('playing');
    expect(s.game.moveSeq).toBe(1);

    const guest2 = await connect(s.address.port, 'guest');
    const w = await guest2.waitType('welcome');
    expect(w.side).toBe('b');
    expect(w.state.status).toBe('playing');
    expect(w.state.moveSeq).toBe(1);
    expect(at(w.state.board, 8, 0)).toEqual({ t: 'R', s: 'r' });

    await host.waitType('opponent_joined');
    const sync = await host.waitType('state');
    expect(sync.state.status).toBe('playing');
    expect(sync.state.moveSeq).toBe(1);

    // 恢复后对局可继续（轮到黑方）
    guest2.send({ type: 'move', from: [3, 0], to: [4, 0] });
    const applied = await host.waitType('move_applied');
    expect(applied.seq).toBe(2);
    expect(applied.turn).toBe('r');
  });

  it('宽限超时后清空席位并回到等待新对手', async () => {
    const { host, guest } = await setupPlaying(80);
    guest.close();
    await host.waitType('opponent_away');

    const st = await host.waitType('state');
    expect(st.state.status).toBe('waiting');
    expect(st.state.moveSeq).toBe(0); // 已重置为等待状态
    const left = await host.waitType('opponent_left');
    expect(left.reason).toBe('对手已离开');

    // 新加入者加入即可开新局
    const guest2 = await connect(server!.address.port, 'guest');
    const start = await guest2.waitType('start');
    expect(start.state.status).toBe('playing');
    expect(start.state.moveSeq).toBe(0);
  });

  it('主机可放弃等待断线对手，立即转为等待新对手', async () => {
    const { host, guest } = await setupPlaying(5000);
    guest.close();
    await host.waitType('opponent_away');

    host.send({ type: 'wait_new_opponent' });
    const st = await host.waitType('state');
    expect(st.state.status).toBe('waiting');
    const left = await host.waitType('opponent_left');
    expect(left.reason).toBe('已放弃等待对方重连');

    // 宽限计时器已取消，新对手可立即加入开局
    const guest2 = await connect(server!.address.port, 'guest');
    const start = await guest2.waitType('start');
    expect(start.state.status).toBe('playing');
  });

  it('主动离开（leave）不走宽限，立即通知对手', async () => {
    const { host, guest } = await setupPlaying(5000);
    guest.send({ type: 'leave' });
    const left = await host.waitType('opponent_left');
    expect(left.reason).toBe('对手已离开');
    await host.expectNo('opponent_away');
  });

  it('主机意外断线保留对局，宽限期内重连恢复', async () => {
    const { s, host, guest } = await setupPlaying(1000);
    host.close();
    const away = await guest.waitType('opponent_away');
    expect(away.reason).toBe('主机已断开');
    expect(s.game.status).toBe('playing');

    const host2 = await connect(s.address.port, 'host');
    const w = await host2.waitType('welcome');
    expect(w.side).toBe('r');
    expect(w.state.status).toBe('playing');
    expect(w.state.moveSeq).toBe(1);

    await guest.waitType('opponent_joined');
    const sync = await guest.waitType('state');
    expect(sync.state.status).toBe('playing');

    // 恢复后仍可继续走子（轮到黑方）
    guest.send({ type: 'move', from: [3, 0], to: [4, 0] });
    const applied = await host2.waitType('move_applied');
    expect(applied.seq).toBe(2);
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

describe('主机服务 · 静态资源', () => {
  let base = '';
  let dir = '';
  let secret = '';
  let server: HostServer | null = null;

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
      const candidate = new HostServer({
        port: 20000 + Math.floor(Math.random() * 30000),
        staticDir: dir,
        host: '127.0.0.1',
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

describe('主机服务 · 人机对战与计时读秒', () => {
  /** 创建人机对局并连接主机，等对局开始 */
  async function setupAi(s: HostServer) {
    const res = await fetch(`http://127.0.0.1:${s.address.port}/api/host/start-ai`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const host = await connect(s.address.port, 'host');
    const w = await host.waitType('welcome');
    return { host, welcome: w };
  }

  it('人机对战：主机执红，AI 延迟后自动走黑', async () => {
    const s = await startServer({ aiDelayMs: 20 });
    const { host, welcome } = await setupAi(s);
    expect(welcome.side).toBe('r');
    expect(welcome.state.status).toBe('playing');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const mine = await host.waitType('move_applied');
    expect(mine.seq).toBe(1);

    const ai = await host.waitType('move_applied');
    expect(ai.seq).toBe(2);
    expect(ai.turn).toBe('r'); // AI 走完轮到红方
    expect(ai.history).toHaveLength(2);
    expect(ai.board[ai.from[0]][ai.from[1]]).toBeNull();
    expect(s.game.history[1]).toEqual({ from: ai.from, to: ai.to });
  }, 10000);

  it('人机对战：guest 无法加入，观战者可加入', async () => {
    const s = await startServer({ aiDelayMs: 1000 });
    await setupAi(s);

    const guest = await connect(s.address.port, 'guest');
    expect((await guest.waitType('error')).message).toBe('人机对局，无法加入');

    const watcher = await connect(s.address.port, 'spectator');
    expect((await watcher.waitType('welcome')).side).toBeNull();
  });

  it('人机对战：悔棋自动同意（AI 重新走子）、和棋被拒、重开自动同意', async () => {
    const s = await startServer({ aiDelayMs: 20 });
    const { host } = await setupAi(s);
    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    await host.waitType('move_applied'); // AI 应招

    host.send({ type: 'undo_request' });
    expect((await host.waitType('undo_response')).accept).toBe(true);
    await host.waitType('state');
    // 悔棋后轮到黑方（AI），AI 会重新走子
    const aiAgain = await host.waitType('move_applied');
    expect(aiAgain.seq).toBe(2);

    host.send({ type: 'draw_request' });
    expect((await host.waitType('draw_response')).accept).toBe(false);

    host.send({ type: 'resign' });
    await host.waitType('game_over');
    host.send({ type: 'restart_request' });
    const restarted = await host.waitType('start');
    expect(restarted.state.moveSeq).toBe(0);
    expect(restarted.state.status).toBe('playing');
  }, 10000);

  it('人机对战难度：start-ai 支持 depth 参数（1-4），非法值忽略', async () => {
    const s = await startServer({ aiDelayMs: 1000 });
    const res = await fetch(`http://127.0.0.1:${s.address.port}/api/host/start-ai?depth=4`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { depth: number }).depth).toBe(4);

    const bad = await fetch(`http://127.0.0.1:${s.address.port}/api/host/start-ai?depth=99`, {
      method: 'POST',
    });
    expect(((await bad.json()) as { depth: number }).depth).toBe(4); // 非法值沿用上一次深度
  });

  it('计时读秒：本回合超时判负并清空 deadline', async () => {
    const s = await startServer({ turnMs: 150 });
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    const start = await host.waitType('start');
    expect(start.state.deadline).toBeGreaterThan(Date.now());

    const over = await host.waitType('game_over');
    expect(over.reason).toBe('超时判负');
    expect(over.winner).toBe('b'); // 红方先行且未走子
    expect(over.state.deadline).toBeNull();
  });

  it('计时读秒：走子后 deadline 顺延给下一方', async () => {
    const s = await startServer({ turnMs: 5000 });
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    const start = await host.waitType('start');
    const firstDeadline = start.state.deadline as number;

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    const applied = await host.waitType('move_applied');
    expect(applied.deadline).toBeGreaterThanOrEqual(firstDeadline);
  });
});

describe('主机服务 · 日志与端口回退（C2/C5）', () => {
  it('默认输出连接/走子/终局打点，LANSCHESS_DEBUG=0 可关闭', async () => {
    vi.stubEnv('LANSCHESS_DEBUG', '1'); // 打开（同时包含 debug 明细）
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const s = await startServer();
    s.setHosting(true);
    const host = await connect(s.address.port, 'host');
    await host.waitType('welcome');
    const guest = await connect(s.address.port, 'guest');
    await guest.waitType('welcome');
    await host.waitType('start');

    host.send({ type: 'move', from: [9, 0], to: [8, 0] });
    await host.waitType('move_applied');
    host.send({ type: 'resign' });
    await host.waitType('game_over');

    const logs = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logs).toContain('主机连接（红方');
    expect(logs).toContain('加入者连接（黑方');
    expect(logs).toContain('走子：红方');
    expect(logs).toContain('对局结束：黑方胜（认输）');

    // 关闭开关后不再输出
    vi.stubEnv('LANSCHESS_DEBUG', '0');
    spy.mockClear();
    guest.send({ type: 'ping', t: 1 });
    await guest.waitType('pong');
    expect(spy).not.toHaveBeenCalled();
  });

  it('listenWithFallback：端口占用时回退随机端口', async () => {
    // 占用者与待启动者都用默认 0.0.0.0，保证两平台都能触发 EADDRINUSE
    const first = new HostServer({ port: 0 });
    const occupied = await first.listen();
    try {
      const started = await listenWithFallback(occupied);
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
    const first = new HostServer({ port: 0 });
    const occupied = await first.listen();
    try {
      await expect(listenWithFallback(occupied, true)).rejects.toMatchObject({
        code: 'EADDRINUSE',
      });
    } finally {
      await first.close();
    }
  });
});
