/**
 * 账号与对局记录的持久化测试：落盘、重启后读取、损坏文件降级。
 * 使用临时目录，避免污染工作区。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountStore } from '../src/server/accounts.js';
import { HistoryStore, toSummary } from '../src/server/history.js';
import { GameRecord, PlayerRef } from '../src/shared/types.js';

let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanchess-data-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const player = (name: string): PlayerRef => ({ id: `account:${name}`, name, kind: 'account' });

const record = (id: string): GameRecord => ({
  id,
  roomId: '123456',
  startedAt: 1,
  endedAt: 2,
  red: player('alice'),
  black: player('bob'),
  firstMode: 'r',
  guess: null,
  winner: 'r',
  reason: '将死',
  killMethod: '马后炮',
  moveCount: 1,
  moves: [{ from: [9, 0], to: [8, 0] }],
});

describe('账号系统 AccountStore', () => {
  it('注册后可解析 token，重复用户名与非法输入被拒', () => {
    const store = new AccountStore(null);
    const reg = store.register('alice', 'pass1234');
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;

    expect(store.resolve(reg.token)).toEqual({ id: 'account:alice', name: 'alice', kind: 'account' });
    expect(store.resolve('不存在')).toBeNull();

    expect(store.register('alice', 'pass1234')).toEqual({ ok: false, error: '用户名已被占用' });
    expect(store.register('ab', 'pass1234').ok).toBe(false); // 用户名过短
    expect(store.register('carol', '123').ok).toBe(false); // 密码过短
    expect(store.register('bad name', 'pass1234').ok).toBe(false);
  });

  it('登录校验密码，并轮换 token（旧 token 失效）', () => {
    const store = new AccountStore(null);
    const reg = store.register('alice', 'pass1234');
    if (!reg.ok) throw new Error('注册失败');
    const oldToken = reg.token;

    expect(store.login('alice', 'wrong')).toEqual({ ok: false, error: '用户名或密码错误' });
    expect(store.login('ghost', 'pass1234').ok).toBe(false);

    const login = store.login('alice', 'pass1234');
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    expect(login.token).not.toBe(oldToken);
    expect(store.resolve(oldToken)).toBeNull();
    expect(store.resolve(login.token)).not.toBeNull();
  });

  it('账号与 token 落盘，重建实例后仍可登录与解析', () => {
    const first = new AccountStore(dir);
    const reg = first.register('alice', 'pass1234');
    if (!reg.ok) throw new Error('注册失败');

    const second = new AccountStore(dir);
    expect(second.resolve(reg.token)).toEqual({ id: 'account:alice', name: 'alice', kind: 'account' });
    expect(second.login('alice', 'pass1234').ok).toBe(true);
    expect(second.register('alice', 'pass1234').ok).toBe(false);
  });

  it('文件损坏时降级为空表，不阻塞启动', () => {
    fs.writeFileSync(path.join(dir, 'users.json'), '{ 这不是合法 JSON');
    const store = new AccountStore(dir);
    expect(store.resolve('anything')).toBeNull();
    expect(store.register('alice', 'pass1234').ok).toBe(true);
  });
});

describe('对局记录 HistoryStore', () => {
  it('追加后可列表（最近在前）与按 id 取明细', () => {
    const store = new HistoryStore(null);
    store.add(record('a'));
    store.add(record('b'));
    expect(store.list().map((g) => g.id)).toEqual(['b', 'a']);
    expect(store.get('a')?.moves).toEqual([{ from: [9, 0], to: [8, 0] }]);
    expect(store.get('nope')).toBeUndefined();
  });

  it('超出容量时丢弃最旧的记录', () => {
    const store = new HistoryStore(null, 2);
    store.add(record('a'));
    store.add(record('b'));
    store.add(record('c'));
    expect(store.list().map((g) => g.id)).toEqual(['c', 'b']);
  });

  it('落盘并可在新实例中读回；摘要字段完整', () => {
    const first = new HistoryStore(dir);
    first.add(record('a'));
    first.flush();

    const second = new HistoryStore(dir);
    const list = second.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(toSummary(record('a')));
    expect(list[0].killMethod).toBe('马后炮'); // 杀法名随记录落盘并读回
    expect(second.get('a')?.moveCount).toBe(1);
  });

  it('文件损坏时降级为空表，不阻塞启动', () => {
    fs.writeFileSync(path.join(dir, 'history.json'), 'not json at all');
    const store = new HistoryStore(dir);
    expect(store.list()).toEqual([]);
    store.add(record('a'));
    expect(store.list()).toHaveLength(1);
  });
});
