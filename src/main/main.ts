/**
 * Electron 主进程：启动主机服务（WebSocket + 静态页面），并打开窗口。
 * 窗口加载的是本机 HTTP 服务上的页面，因此渲染层与浏览器加入者共用同一套代码。
 */

import { BrowserWindow, app } from 'electron';
import { HostServer, listenWithFallback } from '../server/host-server.js';

let server: HostServer | null = null;
let port = 0;

async function ensureServer(): Promise<number> {
  if (server) return port;
  const preferred = Number(process.env.LANSCHESS_PORT ?? 7777);
  // Electron 模式下端口被占用时始终回退随机端口，保证程序不崩溃（与 CLI 的显式端口策略不同）
  const started = await listenWithFallback(preferred, false);
  server = started.server;
  port = started.port;
  return port;
}

async function createWindow(): Promise<void> {
  const p = await ensureServer();
  const win = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: '#2b2016',
    title: '局域网象棋',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`http://127.0.0.1:${p}/`);
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  const s = server;
  server = null;
  void (s ? s.close() : Promise.resolve()).finally(() => app.quit());
});
