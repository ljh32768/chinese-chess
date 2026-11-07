/**
 * 常驻中心服务器入口（无界面，纯托管）。
 *
 * 用法：`npm run serve`（`npm run host` 为等价别名）
 *
 * 环境变量：
 * | 变量 | 默认值 | 作用 |
 * |---|---|---|
 * | `LANSCHESS_PORT` | `27310` | 监听端口；显式指定被占用时报错退出，未指定则回退随机端口 |
 * | `LANSCHESS_DATA` | `<cwd>/data` | 账号与对局记录的持久化目录；设为 `off` 则仅内存 |
 * | `LANSCHESS_TURN_MS` | `0` | 每回合限时毫秒数，0 表示不限时 |
 * | `LANSCHESS_DEBUG` | 未设置 | 日志开关：未设置输出 info；`1` 追加 debug；`0` 全部关闭 |
 */

import path from 'node:path';
import { DEFAULT_PORT } from '../shared/defaults.js';
import { GameServer, getLanIp, listenWithFallback } from './server.js';

let server: GameServer | null = null;

/** 持久化目录：`LANSCHESS_DATA=off` 表示不落盘（测试 / 临时运行） */
function resolveDataDir(): string | null {
  const v = process.env.LANSCHESS_DATA;
  if (v === 'off') return null;
  return v ? path.resolve(v) : path.resolve(process.cwd(), 'data');
}

try {
  const preferred = Number(process.env.LANSCHESS_PORT ?? DEFAULT_PORT);
  const explicit = process.env.LANSCHESS_PORT !== undefined;
  const started = await listenWithFallback(preferred, explicit, resolveDataDir());
  server = started.server;
  console.log(`[局域网象棋] 服务器已启动：http://${getLanIp()}:${started.port}`);
  console.log('[局域网象棋] 浏览器打开该地址即可创建 / 加入房间；Electron 客户端把服务器设为该地址。');
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `[局域网象棋] 端口 ${process.env.LANSCHESS_PORT} 已被占用：请更换 LANSCHESS_PORT 或关闭占用该端口的程序后重试。`,
    );
  } else {
    console.error('[局域网象棋] 启动失败：', err);
  }
  process.exit(1);
}

const shutdown = (): void => {
  void server?.close().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
