/**
 * 无界面主机端（Node CLI）。
 * 用于开发调试与自动化验证：不需要 Electron 也能起一个局域网对局服务。
 * 端口被占用：未显式指定 LANSCHESS_PORT 时自动回退随机端口，显式指定则提示更换端口。
 */

import { HostServer, getLanIp, listenWithFallback } from './host-server.js';

let server: HostServer | null = null;

try {
  const preferred = Number(process.env.LANSCHESS_PORT ?? 7777);
  const explicit = process.env.LANSCHESS_PORT !== undefined;
  const started = await listenWithFallback(preferred, explicit);
  server = started.server;
  console.log(`[局域网象棋] 主机端已启动：http://${getLanIp()}:${started.port}`);
  console.log('[局域网象棋] 用浏览器打开该地址即可「创建对局」或「加入对局」。');
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
