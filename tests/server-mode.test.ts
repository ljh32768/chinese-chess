/**
 * 桌面版无头服务端（`--server`）参数解析与文件日志测试。
 * 覆盖：模式判定、固定端口（不回退随机）、数据目录（off / 相对 / 绝对 / userData 缺省）、日志路径与落盘。
 */

import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_PORT } from '../src/shared/defaults.js';
import {
  ensureLocalServiceToken,
  isServerMode,
  localServicePrefPath,
  localServiceTokenPath,
  readLocalServiceEnabled,
  resolveServerDataDir,
  resolveServerPort,
  serverLogPath,
} from '../src/main/server-mode.js';
import { logInfo, setLogFile } from '../src/server/log.js';

describe('无头服务端模式判定 isServerMode', () => {
  it('只认 --server 参数', () => {
    expect(isServerMode(['electron', '--server'])).toBe(true);
    expect(isServerMode(['LanChess.exe', '--server'])).toBe(true);
    expect(isServerMode(['electron'])).toBe(false);
    expect(isServerMode(['electron', '--server=1'])).toBe(false);
    expect(isServerMode([])).toBe(false);
  });
});

describe('无头服务端端口 resolveServerPort', () => {
  it('未设置时用固定缺省端口', () => {
    expect(resolveServerPort({})).toBe(DEFAULT_PORT);
    expect(resolveServerPort({ LANSCHESS_PORT: '   ' })).toBe(DEFAULT_PORT);
  });

  it('环境变量合法时优先（便于固定部署改端口）', () => {
    expect(resolveServerPort({ LANSCHESS_PORT: '28888' })).toBe(28888);
    expect(resolveServerPort({ LANSCHESS_PORT: ' 28888 ' })).toBe(28888);
  });

  it('非法值回退缺省端口，且不接受 0（无头模式不做随机端口）', () => {
    expect(resolveServerPort({ LANSCHESS_PORT: 'abc' })).toBe(DEFAULT_PORT);
    expect(resolveServerPort({ LANSCHESS_PORT: '0' })).toBe(DEFAULT_PORT);
    expect(resolveServerPort({ LANSCHESS_PORT: '65536' })).toBe(DEFAULT_PORT);
    expect(resolveServerPort({ LANSCHESS_PORT: '-1' })).toBe(DEFAULT_PORT);
  });
});

describe('无头服务端数据目录 resolveServerDataDir', () => {
  const userData = path.resolve('C:/Users/test/AppData/Roaming/LanChess');

  it('未设置时落到 userData/data（安装目录通常不可写）', () => {
    expect(resolveServerDataDir({}, userData)).toBe(path.join(userData, 'data'));
  });

  it('off 表示仅内存（不落盘）', () => {
    expect(resolveServerDataDir({ LANSCHESS_DATA: 'off' }, userData)).toBeNull();
    expect(resolveServerDataDir({ LANSCHESS_DATA: 'OFF' }, userData)).toBeNull();
  });

  it('显式路径解析为绝对路径', () => {
    const absolute = path.resolve('D:/lanchess-data');
    expect(resolveServerDataDir({ LANSCHESS_DATA: absolute }, userData)).toBe(absolute);
    expect(resolveServerDataDir({ LANSCHESS_DATA: 'relative-data' }, userData)).toBe(
      path.resolve('relative-data'),
    );
  });
});

describe('无头服务端日志路径 serverLogPath', () => {
  it('固定在 userData/logs/server.log', () => {
    const userData = path.resolve('C:/Users/test/AppData/Roaming/LanChess');
    expect(serverLogPath(userData)).toBe(path.join(userData, 'logs', 'server.log'));
  });
});

describe('本机服务偏好与关闭 token（客户端与 --server 共用）', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanchess-service-'));
    dirs.push(dir);
    return dir;
  }

  it('偏好缺省开启；写入 enabled=false 后读取为关闭', () => {
    const dir = tempDir();
    expect(localServicePrefPath(dir)).toBe(path.join(dir, 'local-service.json'));
    expect(readLocalServiceEnabled(dir)).toBe(true);

    fs.writeFileSync(localServicePrefPath(dir), JSON.stringify({ enabled: false }));
    expect(readLocalServiceEnabled(dir)).toBe(false);

    // 损坏的文件按开启处理
    fs.writeFileSync(localServicePrefPath(dir), '{');
    expect(readLocalServiceEnabled(dir)).toBe(true);
  });

  it('关闭 token 首次生成后落盘，并在同一 userData 内复用', () => {
    const dir = tempDir();
    const first = ensureLocalServiceToken(dir);
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(fs.readFileSync(localServiceTokenPath(dir), 'utf8')).toBe(first);
    expect(ensureLocalServiceToken(dir)).toBe(first);
  });
});

describe('文件日志 setLogFile', () => {
  const dirs: string[] = [];
  const originalDebug = process.env.LANSCHESS_DEBUG;

  afterEach(() => {
    setLogFile(null);
    if (originalDebug === undefined) delete process.env.LANSCHESS_DEBUG;
    else process.env.LANSCHESS_DEBUG = originalDebug;
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('写入带 ISO 时间戳的一行；关闭后不再写入', () => {
    // vitest 默认把 LANSCHESS_DEBUG 设为 0（静音日志），这里显式打开 info 级
    process.env.LANSCHESS_DEBUG = '1';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanchess-log-'));
    dirs.push(dir);
    const file = serverLogPath(dir);

    setLogFile(file);
    logInfo('无头服务端测试');

    const text = fs.readFileSync(file, 'utf8');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[lan-chess\] 无头服务端测试\n$/);

    setLogFile(null);
    logInfo('关闭后不应落盘');
    expect(fs.readFileSync(file, 'utf8')).toBe(text);
  });
});
