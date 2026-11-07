/**
 * 桌面版「无头服务端」模式的纯函数（无 Electron 依赖，便于单测）。
 *
 * 桌面版默认是客户端（`LanChess.exe`）；带上 `--server` 参数时不再创建窗口，
 * 而是以本机为局域网中心服务器常驻运行，供计划任务在登录后自启。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_PORT } from '../shared/defaults.js';
import { parseLocalServicePref } from '../shared/local-service.js';

/** 是否以无头服务端模式启动（严格匹配 `--server`） */
export function isServerMode(argv: string[]): boolean {
  return argv.includes('--server');
}

/**
 * 无头服务端监听端口：`LANSCHESS_PORT` 合法时优先，否则用固定缺省端口。
 * 与 CLI 入口不同，这里**不做随机端口回退**——常驻服务器必须监听可预期端口。
 */
export function resolveServerPort(env: NodeJS.ProcessEnv): number {
  const raw = (env.LANSCHESS_PORT ?? '').trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

/**
 * 无头服务端数据目录：
 * - `LANSCHESS_DATA=off` → `null`（仅内存）
 * - `LANSCHESS_DATA=<路径>` → 解析为绝对路径（相对路径按当前工作目录）
 * - 未设置 → `<userData>/data`（安装目录通常不可写，故不落到 cwd）
 */
export function resolveServerDataDir(env: NodeJS.ProcessEnv, userDataDir: string): string | null {
  const raw = (env.LANSCHESS_DATA ?? '').trim();
  if (raw.toLowerCase() === 'off') return null;
  if (raw) return path.resolve(raw);
  return path.join(userDataDir, 'data');
}

/** 无头服务端日志文件：`<userData>/logs/server.log` */
export function serverLogPath(userDataDir: string): string {
  return path.join(userDataDir, 'logs', 'server.log');
}

/** 本机服务开关偏好文件（桌面客户端与 `--server` 共用；关闭后自启的服务器会直接退出） */
export function localServicePrefPath(userDataDir: string): string {
  return path.join(userDataDir, 'local-service.json');
}

/** 读取本机服务开关偏好：缺省开启（文件缺失 / 损坏也按开启处理） */
export function readLocalServiceEnabled(userDataDir: string): boolean {
  try {
    return parseLocalServicePref(fs.readFileSync(localServicePrefPath(userDataDir), 'utf8'));
  } catch {
    return true;
  }
}

/** 本机服务关闭 token 文件（桌面客户端与 `--server` 共用，避免无权限杀进程） */
export function localServiceTokenPath(userDataDir: string): string {
  return path.join(userDataDir, 'local-service-token');
}

/** 读取 / 生成关闭 token：首次生成 32+ 位随机串并落盘，后续两个进程复用同一个 */
export function ensureLocalServiceToken(userDataDir: string): string {
  try {
    const saved = fs.readFileSync(localServiceTokenPath(userDataDir), 'utf8').trim();
    if (saved.length >= 16) return saved;
  } catch {
    /* 首次运行或文件损坏：重新生成 */
  }
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(localServiceTokenPath(userDataDir), token, { encoding: 'utf8', mode: 0o600 });
  } catch {
    /* 写入失败时仍返回本次 token（仅本进程可关闭，不影响服务运行） */
  }
  return token;
}
