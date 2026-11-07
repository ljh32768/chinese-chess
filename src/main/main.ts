/**
 * Electron 主进程：两种形态，由命令行参数区分。
 *
 * **客户端（默认）**：启动时不绑定某个服务器，进程内只起一个「本机外壳服务」
 * （仅监听 127.0.0.1、随机端口、不落盘），用于把客户端页面交给窗口加载；
 * 真正的对局服务器由用户在「连接服务器」板块中选择（自动搜索局域网 / 手动输入地址）。
 *
 * **无头服务端（`--server`）**：不创建窗口，直接监听局域网端口（缺省 27310），
 * 数据落 `<userData>/data`，日志落 `<userData>/logs/server.log`；
 * 供 Windows 计划任务在登录后自启（见 `scripts/install-autostart.ps1`）。
 *
 * 客户端形态通过 URL 参数把初始信息交给渲染层：
 *   - `client=electron`：标记这是桌面客户端（连接服务器板块可用；浏览器打开时该板块锁定）
 *   - `server=<host:port>`：优先尝试的服务器（环境变量 `LANSCHESS_SERVER`，缺省 127.0.0.1:27310）
 *   - `lan=<ip>`：本机局域网地址，供客户端推导要扫描的网段
 */

import { BrowserWindow, app } from 'electron';
import path from 'node:path';
import { DEFAULT_PORT } from '../shared/defaults.js';
import { logInfo, setLogFile } from '../server/log.js';
import { GameServer, getLanIp, listenWithFallback } from '../server/server.js';
import { LocalServiceManager } from './local-service.js';
import {
  ensureLocalServiceToken,
  isServerMode,
  readLocalServiceEnabled,
  resolveServerDataDir,
  resolveServerPort,
  serverLogPath,
} from './server-mode.js';

const DEFAULT_SERVER = `127.0.0.1:${DEFAULT_PORT}`;

/** 本机外壳服务（只提供页面与静态资源；不参与对局） */
let shellServer: GameServer | null = null;
/** 本机服务开关（主界面右上角「本机服务」；仅客户端形态） */
let localService: LocalServiceManager | null = null;

function targetServer(): string {
  return (process.env.LANSCHESS_SERVER ?? '').trim() || DEFAULT_SERVER;
}

/** 起本机外壳服务：仅回环地址 + 随机端口，避免与真实服务器抢占端口或被局域网发现 */
async function startShellServer(): Promise<number> {
  const manager = new LocalServiceManager();
  localService = manager;
  const server = new GameServer({
    port: 0,
    host: '127.0.0.1',
    dataDir: null,
    localService: manager,
  });
  const port = await server.listen();
  shellServer = server;
  // 首屏（登录 / 首页）可能需要立刻读状态：启动补齐放到后台，查询会经串行队列等待它完成
  void manager.init();
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

/** 无头服务端实例与关闭状态（仅 `--server` 模式使用） */
let headlessServer: GameServer | null = null;
let shuttingDown = false;

/** 关闭无头服务端并退出：落盘、断开连接、写最后一条日志 */
function shutdownHeadless(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  const s = headlessServer;
  headlessServer = null;
  void (s ? s.close() : Promise.resolve()).finally(() => app.exit(code));
}

/** 无头服务端：固定端口、可预期数据目录、日志落盘；端口被占用时直接退出（不静默换端口） */
async function startHeadlessServer(): Promise<void> {
  const userData = app.getPath('userData');
  const logFile = serverLogPath(userData);
  setLogFile(logFile);
  // 桌面客户端「本机服务」关闭时：登录自启的计划任务仍会拉起本进程，这里直接退出
  if (!readLocalServiceEnabled(userData)) {
    logInfo('本机服务已关闭（local-service.json enabled=false），本次自启不启动服务器');
    app.exit(0);
    return;
  }
  const shutdownToken = ensureLocalServiceToken(userData);
  const dataDir = resolveServerDataDir(process.env, userData);
  const port = resolveServerPort(process.env);
  logInfo(`无头服务端启动：端口 ${port}，数据目录 ${dataDir ?? '仅内存'}，日志 ${logFile}`);

  process.on('SIGINT', () => shutdownHeadless(0));
  process.on('SIGTERM', () => shutdownHeadless(0));
  app.on('before-quit', (ev) => {
    if (shuttingDown) return;
    ev.preventDefault();
    shutdownHeadless(0);
  });

  try {
    const started = await listenWithFallback(port, true, dataDir, {
      token: shutdownToken,
      run: () => shutdownHeadless(0),
    });
    headlessServer = started.server;
    // 就绪信息已由 GameServer.listen() 写入日志；这里只给开发时的控制台留一行
    console.log(`[局域网象棋] 服务器已启动：http://${getLanIp()}:${started.port}`);
  } catch (err) {
    logInfo(`服务器启动失败（端口 ${port}）：${(err as Error).message}`);
    console.error(`[局域网象棋] 服务器启动失败（端口 ${port}）：${(err as Error).message}`);
    app.exit(1);
  }
}

if (isServerMode(process.argv)) {
  void app.whenReady().then(startHeadlessServer);
} else {
  void app.whenReady().then(createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });

  app.on('window-all-closed', () => {
    const s = shellServer;
    const l = localService;
    shellServer = null;
    localService = null;
    void Promise.all([s ? s.close() : Promise.resolve(), l ? l.close() : Promise.resolve()]).finally(() =>
      app.quit(),
    );
  });
}
