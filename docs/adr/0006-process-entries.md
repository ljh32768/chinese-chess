# ADR-0006：进程入口与构建规格（main/main.ts、server/server-main.ts、scripts/）

- 状态：**入口已调整** —— 新增常驻服务器入口 `server-main.ts`；Electron 默认「连接服务器」，
  便携模式为兜底；构建与端口策略不变，见 [ADR-0010](./0010-room-server.md)（2026-10-07）
- 日期：2026-10-03
- 关联入口：`npm start`（Electron 客户端）、`npm run serve`（常驻服务器，`npm run host` 为别名）、`npm run build`
- 关联文档：[ADR-0005 主机服务](./0005-host-server.md)、[ADR-0007 渲染层](./0007-renderer-ui.md)、[ADR-0010](./0010-room-server.md)

---

## 1. 背景

同一套主机服务需要在两种形态下运行：

- **桌面形态**：普通玩家双击即用，需要有窗口、界面。
- **无界面形态**：开发调试与自动化验证用，不需要 Electron 也能起服务。

两种形态必须复用同一个 `HostServer` 与同一份前端页面，避免行为分叉。

## 2. 决策

- **Electron 主进程**（`main.ts`）：启动 `HostServer`，窗口直接加载 `http://127.0.0.1:<port>/`，
  即「渲染进程 = 浏览器页面」，与加入者浏览器跑同一份代码。
- **CLI 入口**（`cli.ts`）：直接 `new HostServer().listen()`，打印局域网地址供浏览器访问，
  处理 `SIGINT/SIGTERM` 优雅退出。
- **端口策略**：优先 `7777`（`LANSCHESS_PORT`），Electron 中被占用时**自动回退随机端口**，保证程序不崩溃。
- **构建**：`tsc` 编译 `src → dist`，再由 `scripts/copy-assets.mjs` 把 HTML/CSS 复制到 `dist/renderer`。

## 3. 详细规格

### 3.1 npm 脚本

| 脚本 | 命令 | 说明 |
|---|---|---|
| `npm run build` | `tsc && node scripts/copy-assets.mjs` | 编译 + 复制静态资源 |
| `npm run dev` | `node scripts/dev.mjs` | 开发模式：首次构建 → tsc watch → dist 变化自动重启主机端，渲染层 html/css 变化自动同步 |
| `npm test` | `vitest run` | 全量测试 |
| `npm run lint` / `format:check` | `eslint .` / `prettier --check .` | 规范与格式门禁（CI 依赖） |
| `npm run serve` | `node dist/server/server-main.js` | 常驻中心服务器（**需先 build**） |
| `npm run host` | `node dist/server/server-main.js` | 同上（历史别名） |
| `npm start` | `npm run build && electron .` | Electron 客户端（自动先构建；默认连接服务器） |
| `npm run dist` | `npm run build && electron-builder --win` | 产出 Windows 安装包到 `release/`（NSIS，可改安装目录） |

### 3.2 构建配置

| 项 | 值 |
|---|---|
| `tsconfig.json` | `target/module: ES2022 + NodeNext`，`strict`，`noUnusedLocals/Parameters`，`rootDir: src`，`outDir: dist`，`sourceMap: true` |
| 模块解析 | NodeNext，源码内相对导入需带 `.js` 后缀（ESM 输出） |
| 静态资源 | [copy-assets.mjs](../../scripts/copy-assets.mjs)：复制 `src/renderer/index.html`、`styles.css` → `dist/renderer/` |
| 产物结构 | `dist/server/*`、`dist/shared/*`、`dist/renderer/*`、`dist/main/*` |
| 静态服务根 | `dist/`（[defaultStaticDir](../../src/server/host-server.ts#L667-L670)），页面内 `../shared/*.js` 请求可正确命中 |
| `package.json` | `"main": "dist/main/main.js"`，`"type": "module"`，`"engines": { "node": ">=18" }` |
| 打包配置 | `package.json` 的 `build` 字段：appId `com.lanchess.app`、productName `LanChess`、NSIS（`oneClick=false`，快捷方式「局域网象棋」）、输出 `release/` |

### 3.3 Electron 主进程（`main.ts`）

| 步骤 | 行为 |
|---|---|
| `app.whenReady()` | 进入 `createWindow()` |
| `ensureServer()` | 经 `listenWithFallback(7777)` 启动：端口占用时回退 `port: 0` 随机端口；已有实例则复用 |
| `new BrowserWindow` | 1120×840，最小 720×640，背景 `#14110e`，标题「局域网象棋」，隐藏菜单栏 |
| 安全配置 | `contextIsolation: true`、`nodeIntegration: false` |
| 加载 | `http://127.0.0.1:<port>/`（即主机服务页面） |
| `activate`（macOS） | 无窗口时重建窗口 |
| `window-all-closed` | 关闭 `HostServer` 后 `app.quit()` |

### 3.4 Node CLI（`cli.ts`）

| 步骤 | 行为 |
|---|---|
| 端口 | `Number(process.env.LANSCHESS_PORT ?? 7777)`；经 [listenWithFallback](../../src/server/host-server.ts) 启动 |
| 启动 | 成功后打印 `[局域网象棋] 主机端已启动：http://<lan-ip>:<port>`（服务端另行输出结构化日志） |
| 端口占用 | 未显式设置 `LANSCHESS_PORT` → 自动回退随机端口；显式设置 → 提示更换端口并 `exit(1)` |
| 失败 | 打印错误并 `process.exit(1)` |
| 退出 | `SIGINT/SIGTERM` → `close()` → `exit(0)` |

### 3.5 明确不做

自动更新、托盘、多窗口、开机自启、HTTPS（安装包打包已由 `npm run dist` 支持）。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| Electron 启动与端口回退 | [main.ts `ensureServer()`](../../src/main/main.ts#L12-L26) |
| 窗口创建与加载 | [main.ts `createWindow()`](../../src/main/main.ts#L28-L41) |
| 退出清理 | [main.ts](../../src/main/main.ts#L49-L53) |
| CLI 启动/关闭 | [cli.ts](../../src/server/cli.ts#L8-L27) |
| 构建脚本 | [copy-assets.mjs](../../scripts/copy-assets.mjs)、[tsconfig.json](../../tsconfig.json)、[package.json](../../package.json#L8-L13) |

## 5. 验收标准

- `npm run build` 成功，`dist/` 下包含 server/shared/renderer/main 四组产物与 HTML/CSS。
- `npm start` 打开桌面窗口并显示首页；端口被占用时仍能启动（随机端口）。
- `npm run host` 打印可访问的局域网地址，浏览器打开后能创建/加入对局。
- 关闭窗口后进程退出且端口释放（`close()` 生效）。