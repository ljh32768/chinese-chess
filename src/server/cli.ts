/**
 * 无界面主机端（Node CLI）。
 * 用于开发调试与自动化验证：不需要 Electron 也能起一个局域网对局服务。
 */

import { HostServer, getLanIp } from './host-server.js';

const port = Number(process.env.LANSCHESS_PORT ?? 7777);
const server = new HostServer({ port });

server
  .listen()
  .then((p) => {
    console.log(`[局域网象棋] 主机端已启动：http://${getLanIp()}:${p}`);
    console.log('[局域网象棋] 用浏览器打开该地址即可「创建对局」或「加入对局」。');
  })
  .catch((err: unknown) => {
    console.error('[局域网象棋] 启动失败：', err);
    process.exit(1);
  });

const shutdown = (): void => {
  void server.close().finally(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);