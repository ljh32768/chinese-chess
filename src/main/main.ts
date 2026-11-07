/**
 * Electron 客户端主进程：**启动时不再绑定某个服务器**。
 *
 * 进程内只起一个「本机外壳服务」（仅监听 127.0.0.1、随机端口、不落盘），
 * 用于把客户端页面本身交给窗口加载；真正的对局服务器由用户在「连接服务器」板块中选择
 * （自动搜索局域网 / 手动输入地址），因此服务器切换不需要重启客户端。
 *
 * 通过 URL 参数把初始信息交给渲染层：
 *   - `client=electron`：标记这是桌面客户端（连接服务器板块可用；浏览器打开时该板块锁定）
 *   - `server=<host:port>`：优先尝试的服务器（环境变量 `LANSCHESS_SERVER`，缺省 127.0.0.1:7777）
 *   - `lan=<ip>`：本机局域网地址，供客户端推导要扫描的网段
 */

import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { GameServer, getLanIp } from '../server/server.js';

const DEFAULT_SERVER = '127.0.0.1:7777';

/** 本机外壳服务（只提供页面与静态资源；不参与对局） */
let shellServer: GameServer | null = null;

function targetServer(): string {
  return (process.env.LANSCHESS_SERVER ?? '').trim() || DEFAULT_SERVER;
}

/** 起本机外壳服务：仅回环地址 + 随机端口，避免与真实服务器抢占端口或被局域网发现 */
async function startShellServer(): Promise<number> {
  const server = new GameServer({ port: 0, host: '127.0.0.1', dataDir: null });
  const port = await server.listen();
  shellServer = server;
  return port;
}

async function createWindow(): Promise<void> {
  const port = await startShellServer();
  const params = new URLSearchParams({
    client: 'electron',
    server: targetServer(),
    lan: getLanIp(),
  });

  // 窗口与任务栏 / 安装包图标统一使用 Reference/picture/symbol.png（构建时随素材复制到 dist/renderer）
  const iconPath = path.join(app.getAppPath(), 'dist', 'renderer', 'assets', 'img', 'symbol.png');
  const win = new BrowserWindow({
    width: 1360,
    height: 960,
    minWidth: 900,
    minHeight: 700,
    backgroundColor: '#2b2016',
    title: '局域网象棋',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(`http://127.0.0.1:${port}/?${params.toString()}`);
}

void app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on('window-all-closed', () => {
  const s = shellServer;
  shellServer = null;
  void (s ? s.close() : Promise.resolve()).finally(() => app.quit());
});
