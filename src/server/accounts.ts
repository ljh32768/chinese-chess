/**
 * 最简账号系统（可选使用）。
 *
 * - 注册：用户名（3–16 位字母/数字/下划线，唯一）+ 密码（≥4 位），密码以 scrypt 加盐哈希存储；
 * - 登录：校验哈希后签发长期 token（随用户记录一起落盘，服务器重启仍然有效）；
 * - 身份：token → 用户名 → `PlayerRef { id: 'account:<用户名>', kind: 'account' }`。
 *
 * 明确不做：邮箱验证、找回密码、OAuth、多设备会话管理、token 过期与吊销。
 * 落盘于 `data/users.json`；文件缺失或损坏时降级为空表并继续启动，不阻塞服务。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PlayerRef } from '../shared/types.js';
import { logDebug, logInfo } from './log.js';

interface UserRecord {
  username: string;
  salt: string;
  hash: string;
  token: string;
  createdAt: number;
}

export type AuthResult = { ok: true; token: string; username: string } | { ok: false; error: string };

/** 用户名：3–16 位字母 / 数字 / 下划线 */
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const MIN_PASSWORD = 4;
const KEY_LEN = 32;

const hashPassword = (password: string, salt: string): string =>
  crypto.scryptSync(password, salt, KEY_LEN).toString('hex');

/** 恒定时间比较，避免按字符比较泄露信息 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export class AccountStore {
  private readonly users = new Map<string, UserRecord>();
  private readonly file: string | null;

  /** @param dataDir 持久化目录；null 表示仅内存（测试用） */
  constructor(dataDir: string | null) {
    this.file = dataDir ? path.join(dataDir, 'users.json') : null;
    this.load();
  }

  /** token → 玩家身份；未知 token 返回 null */
  resolve(token: unknown): PlayerRef | null {
    if (typeof token !== 'string' || !token) return null;
    for (const u of this.users.values()) {
      if (u.token === token) {
        return { id: `account:${u.username}`, name: u.username, kind: 'account' };
      }
    }
    return null;
  }

  /** 已注册用户名（在线状态由服务器结合当前连接判断） */
  usernames(): string[] {
    return [...this.users.keys()];
  }

  register(username: unknown, password: unknown): AuthResult {
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return { ok: false, error: '用户名需为 3-16 位字母、数字或下划线' };
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return { ok: false, error: `密码至少 ${MIN_PASSWORD} 位` };
    }
    if (this.users.has(username)) return { ok: false, error: '用户名已被占用' };

    const salt = crypto.randomBytes(16).toString('hex');
    const record: UserRecord = {
      username,
      salt,
      hash: hashPassword(password, salt),
      token: crypto.randomBytes(24).toString('hex'),
      createdAt: Date.now(),
    };
    this.users.set(username, record);
    this.save();
    logInfo(`账号注册：${username}（当前 ${this.users.size} 个账号）`);
    return { ok: true, token: record.token, username };
  }

  login(username: unknown, password: unknown): AuthResult {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return { ok: false, error: '用户名或密码不能为空' };
    }
    const record = this.users.get(username);
    // 用户名不存在与密码错误返回同一提示，避免枚举账号
    if (!record || !safeEqual(hashPassword(password, record.salt), record.hash)) {
      return { ok: false, error: '用户名或密码错误' };
    }
    // 每次登录轮换 token（旧 token 立即失效）
    record.token = crypto.randomBytes(24).toString('hex');
    this.save();
    logInfo(`账号登录：${username}`);
    return { ok: true, token: record.token, username };
  }

  // ------------------------------------------------------------ 持久化

  private load(): void {
    if (!this.file) return;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw) as Record<string, UserRecord>;
      for (const [name, rec] of Object.entries(data)) {
        if (rec && typeof rec.username === 'string' && typeof rec.token === 'string') {
          this.users.set(name, rec);
        }
      }
      logDebug(`账号表已载入：${this.users.size} 个账号`);
    } catch (err) {
      // 首次启动（文件不存在）或文件损坏：降级为空表，不阻塞服务
      logDebug(`账号表读取失败（按空表处理）：${String(err)}`);
    }
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const data: Record<string, UserRecord> = {};
      for (const [name, rec] of this.users) data[name] = rec;
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      logDebug(`账号表写入失败：${String(err)}`);
    }
  }
}
