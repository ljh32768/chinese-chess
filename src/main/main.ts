/**
 * Electron 主进程：启动主机服务（WebSocket + 静态页面），并打开窗口。
 * 窗口加载的是本机 HTTP 服务上的页面，因此渲染层与浏览器加入者共用同一套代码。
 */

import { BrowserWindow, app } from 'electron';
import { HostServer } from '../server/host-server.js';

let server: HostServer | null = null;
let port = 0;

async function ensureServer(): Promise<number> {
  if (server) return port;
  const preferred = Number(process.env.LANSCHESS_PORT ?? 7777);
  const first = new HostServer({ port: preferred });
  try {
    port = await first.listen();
    server = first;
  } catch {
    // 端口被占用时退回随机端口，保证程序不崩溃
    const fallback = new HostServer({ port: 0 });
    port = await fallback.listen();
    server = fallback;
  }
  return port;
}

async function createWindow(): Promise<void> {
  const p = await ensureServer();
  const win = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: '#14110e',
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