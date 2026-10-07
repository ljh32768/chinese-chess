/**
 * Electron 客户端主进程：**默认连接中心服务器**（不再默认自建服务）。
 *
 * 服务器地址来源（按优先级）：
 *   1. 环境变量 `LANSCHESS_SERVER`（形如 `192.168.1.5:7777`）
 *   2. 缺省 `127.0.0.1:7777`
 *
 * 连不上时弹窗询问：可选择「本机开服」（便携兜底，进程内起服务器）或退出。
 * 客户端窗口加载的是服务器上的页面，因此与浏览器打开同一地址完全一致。
 */

import { BrowserWindow, app, dialog } from 'electron';
import { GameServer, listenWithFallback } from '../server/server.js';

const DEFAULT_SERVER = '127.0.0.1:7777';

let localServer: GameServer | null = null;
let localPort = 0;

function targetServer(): string {
  return (process.env.LANSCHESS_SERVER ?? '').trim() || DEFAULT_SERVER;
}

/** 探测目标地址是否为可用的本游戏服务器（依据 /api/server-info 的版本与端口字段） */
async function probe(addr: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`http://${addr}/api/server-info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const info = (await res.json()) as { version?: unknown; port?: unknown };
    return typeof info.version === 'string' && typeof info.port === 'number';
  } catch {
    return false;
  }
}

/** 便携兜底：进程内启动服务器并返回可连接的地址 */
async function ensureLocalServer(): Promise<string> {
  if (localServer) return `127.0.0.1:${localPort}`;
  const preferred = Number(process.env.LANSCHESS_PORT ?? 7777);
  const started = await listenWithFallback(preferred, false);
  localServer = started.server;
  localPort = started.port;
  return `127.0.0.1:${localPort}`;
}

async function createWindow(): Promise<void> {
  let addr = targetServer();
  if (!(await probe(addr))) {
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      buttons: ['本机开服（便携模式）', '退出'],
      defaultId: 0,
      cancelId: 1,
      title: '局域网象棋',
      message: `无法连接服务器 ${addr}`,
      detail:
        '请确认中心服务器已启动、地址正确（可用环境变量 LANSCHESS_SERVER 指定）。\n' +
        '也可以选择「本机开服」，在本机临时开一局（便携模式）。',
    });
    if (choice !== 0) {
      app.quit();
      return;
    }
    addr = await ensureLocalServer();
  }

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
  await win.loadURL(`http://${addr}/`);
}

void app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  const s = localServer;
  localServer = null;
  void (s ? s.close() : Promise.resolve()).finally(() => app.quit());
});
