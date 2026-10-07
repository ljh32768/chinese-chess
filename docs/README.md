# 局域网象棋（lan-chess）文档中心

局域网两人实时对战中国象棋 MVP。主机权威 + WebSocket 通信 + 纯 TypeScript 规则引擎，
Electron 桌面端与浏览器共用同一套渲染页面。

> 一句话：局域网内两台设备连上后，能完整、正确地下一盘棋。

- 版本：v1.6（v0.1.0 为 MVP 代码基线；v1.1–v1.3 为 A–D 四档优化迭代；v1.4 前端视觉改造；v1.5 先手方式 / 猜先 + 对局回顾与 AI 推荐；v1.6 主界面放大与木框对齐 + 主页署名遮盖）
- 状态：A、B、C、D 四档优化与 v1.4 前端改造完成；v1.5、v1.6 功能扩展完成；175 项自动化测试通过，lint / format / build / CI 全绿
- 更新日期：2026-10-07

版本里程碑：

| 版本 | 内容 | 记录 |
|---|---|---|
| v0.1.0 | MVP：创建/加入对局、走子与裁判、认输/和棋/重开、断线提示、Electron 与浏览器共用页面 | commits `5bcd5cb` … `34c6f36` |
| v1.1 | A 档 快速见效：错误提示、地址复制、弹层交互与等待态、大屏布局、悬停反馈、快捷键、矮窗口修复 | commit `d3065ad` |
| v1.2 | B 档 稳健性：断线重连宽限、终局清理 pending、静态路径加固、协议清理 | commit `2f1b609` |
| v1.3 | C 档 工程化 + D 档 功能扩展：CI/lint/format、dev 脚本、安装包打包、主机日志；局域网主机发现、棋谱/吃子/悔棋、观战、人机对战与计时读秒 | commit `e22f7b0` |
| v1.4 | 前端视觉改造：对齐参考项目 Reference/Chess 的经典木质风格——Canvas + 图片棋子渲染、三套皮肤、音效、木质挂板菜单、人机难度子菜单 | commit `b78ace8` |
| v1.5 | 功能扩展：等待页放大 + 先手方式（红 / 黑 / 随机黑红 / 猜先）、删除棋谱改为「对局回顾」（列表 + 复盘右箭头逐步 + AI 推荐） | 见 ADR-0003/0005/0007/0009 |
| v1.6 | 界面调整：主界面（首页 / 等待 / 加入）整体放大 1.25 倍（含背景图，对局与回顾不变）、三个子面板与木板内框对齐、用 cover.bmp 覆盖主页背景署名 | commit `6e9fb40` |

---

## 1. 文档导航

| 文档 | 内容 | 说明 |
|---|---|---|
| [Product-plan.md](./Product-plan.md) | 产品设计文档（v0.1） | 定位、范围、流程、验收标准 |
| [Technical-solution.md](./Technical-solution.md) | 技术方案（v1.0） | 架构选型与总体设计 |
| [adr/](./adr/) | ADR 架构决策 + 模块详细规格（0001–0009） | **各功能入口的详细 spec，见第 5 节** |
| [Optimization-plan.md](./Optimization-plan.md) | 优化路线图（v1.3） | A–D 四档全部完成；分档列出现状问题、方案、代码落点与完成记录 |
| [Demo.html](./Demo.html) | 单文件界面原型 | 仅验证界面布局与操作流程，无真实网络 |

> 视觉素材（棋盘、棋子、按钮、音效）来自参考项目 [Reference/Chess](../Reference/Chess)（MIT 协议，
> 版权归原作者所有），许可随素材分发：[src/renderer/assets/LICENSE-ReferenceChess.txt](../src/renderer/assets/LICENSE-ReferenceChess.txt)。

---

## 2. 快速开始

```bash
npm install          # 安装依赖
npm run build        # 编译 TypeScript + 复制静态资源到 dist/
npm test             # 运行全部测试（vitest run）
npm run lint         # ESLint 检查
npm run format:check # Prettier 格式校验
npm start            # 构建后以 Electron 桌面端启动（主机端）
npm run host         # 以无界面 Node 方式启动主机端（CLI，需先 build）
npm run dev          # 开发模式：tsc watch + 主机端自动重启 + 静态资源同步
npm run dist         # 用 electron-builder 产出 Windows 安装包（release/）
```

局域网对战流程：

1. 主机运行 `npm start`（或 `npm run build && npm run host`），在首页点击「创建对局」，页面显示本机地址，如 `192.168.1.42:7777`。
2. 对手在同一局域网的浏览器中打开 `http://192.168.1.42:7777/`，点击「加入对局」，输入该地址连接（也可点「搜索局域网主机」自动发现）。
3. 开局前主机可在等待页选择先手方式：红 / 黑 / 随机黑红 / 猜先（猜先由主机抓单双、加入者猜，猜中者执红）；
   双方到齐后自动开局（默认主机执红先行，加入者执黑）。
4. 单人可点首页「人机对弈」选择难度（菜鸟/中级/高手）后与 AI（执黑）对弈；第三方观众可点「观战」旁观。
5. 对局结束后可在首页「对局回顾」查看对战列表（红黑方 / 取先方式 / 时间 / 胜负），
   点进某一局即可用「下一步 ▶」逐步复盘，并查看每个局面的 AI 推荐着法。

环境变量：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `LANSCHESS_PORT` | `7777` | 主机监听端口；Electron 模式端口被占用时自动回退随机端口，CLI 显式指定时给出提示 |
| `LANSCHESS_DEBUG` | 未设置 | 主机日志开关：未设置输出 info 打点；`1` 追加 debug 明细；`0` 全部关闭 |
| `LANSCHESS_TURN_MS` | `0` | 计时读秒：每回合限时毫秒数，`0` 表示不限时（如 `60000` = 每步 60 秒，超时判负） |

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────────────┐
│                主机端（Electron / Node CLI）          │
│                                                      │
│   渲染进程（浏览器页面）        主进程 / Node 进程     │
│  ┌────────────────────┐      ┌────────────────────┐  │
│  │ renderer 渲染层     │      │  HostServer        │  │
│  │  app.ts  页面/交互  │◄────►│   HTTP 静态+API    │  │
│  │  board.ts 棋盘渲染  │  WS  │   WebSocket /ws    │  │
│  │  net.ts  网络客户端 │      │  Game 权威状态机    │  │
│  └────────────────────┘      │  rules 规则引擎     │  │
│                              └─────────┬──────────┘  │
└────────────────────────────────────────┼─────────────┘
                                         │ WebSocket（JSON）
                        ┌────────────────┴──────────────┐
                        │                               │
                 ┌──────▼──────┐                ┌───────▼──────┐
                 │ Electron 主机 │                │ 手机/电脑浏览器│
                 │ 渲染层页面    │                │ 打开主机 HTTP │
                 └─────────────┘                └──────────────┘
```

> v1.3 新增模块：渲染层 [discover.ts](../src/renderer/discover.ts)（局域网主机发现）、
> 服务端 [ai.ts](../src/server/ai.ts)（人机对战）与 [log.ts](../src/server/log.ts)（主机日志）、
> 共享层 [notation.ts](../src/shared/notation.ts)（中文记谱）——详见 [ADR-0009](./adr/0009-c-d-extensions.md)。
>
> v1.4 前端视觉改造：渲染层棋盘改为 **Canvas + 图片素材**（[board.ts](../src/renderer/board.ts)），
> 新增音效 [sound.ts](../src/renderer/sound.ts) 与素材目录 [assets/](../src/renderer/assets/)，
> 页面改为参考项目的木质挂板风格——详见 [ADR-0007](./adr/0007-renderer-ui.md)。
>
> v1.5 功能扩展：等待页放大并支持先手方式（红 / 黑 / 随机黑红 / 猜先），删除棋谱面板改为
> **对局回顾**（[review.ts](../src/renderer/review.ts)：列表 + 复盘右箭头逐步 + AI 推荐），
> 主机服务新增 `/api/history`、`/api/history/:id`、`/api/ai/hint`——详见 [ADR-0009](./adr/0009-c-d-extensions.md)。
>
> v1.6 界面调整：主界面（首页 / 等待 / 加入）整体放大 1.25 倍（`--ui-scale`，背景图同步放大；
> 对局页与对局回顾页不变），三个子面板（创建 / 加入 / 人机）与木板内框对齐，
> 主页背景署名已用 `cover.bmp` 覆盖——详见 [ADR-0007 §3.5.3](./adr/0007-renderer-ui.md)。

核心原则（详见 [ADR-0001](./adr/0001-host-authoritative-architecture.md)）：

- **主机权威**：唯一真实棋盘在主机进程的 `Game` 中，规则校验与胜负判定都在主机完成。
- **加入者请求**：客户端只发送走子「意图」，主机校验后广播结果。
- **规则引擎与 UI 分离**：`rules.ts` 为纯 TS 模块，不依赖 DOM / 网络，可独立单测。
- **简单同步**：每步广播完整棋盘快照，带单调递增 `seq`。

---

## 4. 功能模块化总览

代码分为 5 个模块（三层 + 入口 + 工程基建），依赖方向单向、无环：

```text
shared（协议/规则/类型，无环境依赖）
   ▲                      ▲
   │                      │
server（主机服务）      renderer（浏览器页面）
   ▲                      ▲
   │                      │
main / cli（进程入口，装配 server 与页面）
```

| # | 模块 | 职责 | 代码入口 | 详细规格 |
|---|---|---|---|---|
| 1 | 规则引擎 | 走法生成、送将过滤、将军/将死/困毙判定 | [rules.ts](../src/shared/rules.ts)、[types.ts](../src/shared/types.ts) | [ADR-0002](./adr/0002-rules-engine.md) |
| 2 | 通信协议 | 客户端/服务端消息定义、编解码、共享数据结构 | [protocol.ts](../src/shared/protocol.ts)、[types.ts](../src/shared/types.ts) | [ADR-0003](./adr/0003-wire-protocol.md) |
| 3 | 对局状态机 | 主机权威棋盘状态、走子校验链、认输/和棋/重开 | [game.ts](../src/server/game.ts) | [ADR-0004](./adr/0004-game-state-machine.md) |
| 4 | 主机服务 | HTTP 静态服务 + 控制 API、WebSocket 路由、连接管理、局域网 IP 发现 | [host-server.ts](../src/server/host-server.ts) | [ADR-0005](./adr/0005-host-server.md) |
| 5 | 进程入口 | Electron 主进程、Node CLI 主机端、构建脚本 | [main.ts](../src/main/main.ts)、[cli.ts](../src/server/cli.ts)、[copy-assets.mjs](../scripts/copy-assets.mjs) | [ADR-0006](./adr/0006-process-entries.md) |
| 6 | 渲染层 | 页面流转、棋盘 Canvas 渲染与交互、三套皮肤与音效、对局回顾与复盘（AI 推荐）、WebSocket 客户端、心跳、吃子/悔棋/观战/倒计时/主机搜索 | [app.ts](../src/renderer/app.ts)、[board.ts](../src/renderer/board.ts)、[review.ts](../src/renderer/review.ts)、[sound.ts](../src/renderer/sound.ts)、[net.ts](../src/renderer/net.ts)、[discover.ts](../src/renderer/discover.ts)、[index.html](../src/renderer/index.html) | [ADR-0007](./adr/0007-renderer-ui.md)、[ADR-0009](./adr/0009-c-d-extensions.md) |
| 7 | 测试体系 | 单元测试、服务端集成测试、完整对局端到端回放 | [tests/](../tests/) | [ADR-0008](./adr/0008-testing-strategy.md) |
| 8 | 记谱模块 | 传统中文记谱生成、着法回放、吃子统计（纯函数） | [notation.ts](../src/shared/notation.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 9 | AI 引擎 | negamax + α-β 搜索、局面评估、人机对战走子 | [ai.ts](../src/server/ai.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 10 | 主机日志 | 连接/断开/走子/终局/宽限打点，`LANSCHESS_DEBUG` 开关 | [log.ts](../src/server/log.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 11 | 自动发现 | 同网段 WS 探测与去重，供加入页搜索主机 | [discover.ts](../src/renderer/discover.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |

---

## 5. 功能入口

按用户可见功能列出入口链路：**UI 触发点 → 客户端处理 → 服务端处理 → 规则/状态判定**，
每一行末尾为对应的详细规格（ADR）。

| 功能 | UI 触发点 | 实现入口（代码） | 详细 spec |
|---|---|---|---|
| 创建对局 | 首页「创建对局」按钮 | [app.ts `createGame()`](../src/renderer/app.ts) → `POST /api/host/start` → [host-server.ts `setHosting()`](../src/server/host-server.ts)（等待页可选先手方式） | [ADR-0005](./adr/0005-host-server.md) |
| 先手方式（红/黑/随机/猜先） | 等待页「先手（红方）」四个选项 | [app.ts `chooseFirst()`](../src/renderer/app.ts) → `choose_first` → [host-server.ts `maybeStart()` / `beginFirst()`](../src/server/host-server.ts)（`random` 随机、`guess` 进入猜先） | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0009](./adr/0009-c-d-extensions.md) |
| 猜先（主机抓、客方猜） | 主机弹层「抓单 / 抓双」→ 客方弹层「猜单 / 猜双」 | `grasp` → `guess` → [host-server.ts `beginFirst()`](../src/server/host-server.ts) → 广播 `first_result`（猜中者执红）→ 逐连接 `start{side}` | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 对局回顾（列表） | 首页「对局回顾」 | [review.ts `open()`](../src/renderer/review.ts) → `GET /api/history`（红黑方 / 取先方式 / 时间 / 胜负） | [ADR-0007](./adr/0007-renderer-ui.md)、[ADR-0009](./adr/0009-c-d-extensions.md) |
| 复盘（逐步 + AI 推荐） | 回顾列表点击某局 → 「下一步 ▶」/ → 键 | [review.ts](../src/renderer/review.ts) → `GET /api/history/:id`（着法）+ `GET /api/ai/hint?id&index`（[host-server.ts `hintFor()`](../src/server/host-server.ts)） | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 人机对战 | 首页「人机对弈」→ 选难度 →「开始对弈」 | [app.ts `createAiGame()`](../src/renderer/app.ts) → `POST /api/host/start-ai?depth=2|3|4` → [host-server.ts `startAiGame()` / `scheduleAiMove()`](../src/server/host-server.ts) → [ai.ts](../src/server/ai.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 更换皮肤 | 首页「更换皮肤」 | [app.ts `switchSkin()`](../src/renderer/app.ts) → [board.ts `nextSkin()` / `loadSkinImages()`](../src/renderer/board.ts)（页面背景同步换 `bg.jpg`，偏好存 `localStorage`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 选子 / 走子音效 | 点击棋子 / 收到走子广播时自动 | [sound.ts](../src/renderer/sound.ts)（`select.wav` / `click.wav`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 显示本机地址 | 主机等待页 | [app.ts `init()`](../src/renderer/app.ts) → `GET /api/host-info` → [host-server.ts `pickLanIp()`](../src/server/host-server.ts#L43-L62) | [ADR-0005](./adr/0005-host-server.md) |
| 复制主机地址 | 等待页点击地址块（`ip-box`，提示「点击复制」） | [app.ts `copyHostAddr()`](../src/renderer/app.ts)（非安全上下文降级 `execCommand`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 加入对局 | 「加入对局」→ 输入 IP:端口 →「连接」 | [app.ts `doJoin()`](../src/renderer/app.ts) → WS `join(guest)` → [host-server.ts `handleJoin()`](../src/server/host-server.ts) | [ADR-0005](./adr/0005-host-server.md) |
| 搜索局域网主机 | 加入页「搜索主机」 | [app.ts `scanHosts()`](../src/renderer/app.ts) → [discover.ts](../src/renderer/discover.ts)（WS 探测 + 网段扫描） | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 观战（只读） | 加入页「观战」 | `join(spectator)` → [host-server.ts `handleJoin()`](../src/server/host-server.ts)（spectator 分支）→ [app.ts `openNet()`](../src/renderer/app.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 自动开局 | 双方加入后由主机触发 | [host-server.ts `maybeStart()` / `startGame()`](../src/server/host-server.ts) → 广播 `start` | [ADR-0003](./adr/0003-wire-protocol.md) |
| 走子（选子/落点/发送） | 点击棋盘 | [app.ts `onCell()`](../src/renderer/app.ts) → `move` → [game.ts `applyMove()`](../src/server/game.ts#L82-L119) → [host-server.ts `applyAndBroadcast()`](../src/server/host-server.ts) | [ADR-0002](./adr/0002-rules-engine.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 规则裁判（将军/将死/困毙） | 走子后自动判定 | [rules.ts `judgeAfterMove()`](../src/shared/rules.ts#L299-L307)、[`validateMove()`](../src/shared/rules.ts#L313-L330) | [ADR-0002](./adr/0002-rules-engine.md) |
| 将军/将死高亮 | 走子后自动 | [board.ts `computeDrawList()`](../src/renderer/board.ts)（被将军一方的将/帅红色脉冲警示环） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 悬停预高亮 | 鼠标悬停棋盘 | [app.ts `bindEvents()`](../src/renderer/app.ts) + [board.ts `computeDrawList()`](../src/renderer/board.ts)（己方棋子 / 合法落点金色环 + 手型光标） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 吃子统计 | 侧栏吃子面板自动更新（棋谱面板已移除，改由「对局回顾」复盘） | [app.ts `renderCaptured()`](../src/renderer/app.ts) → [notation.ts `capturedPieces()`](../src/shared/notation.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 悔棋（申请/同意） | 对局页「悔棋」 | [app.ts `offerUndo()`](../src/renderer/app.ts) → `undo_request` / `undo_response` → [game.ts `undo()`](../src/server/game.ts#L121-L141) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 计时读秒 | 状态框显示「剩余 xx s」 | [host-server.ts `armTurnTimer()`](../src/server/host-server.ts) → 快照 `deadline` → [app.ts `updatePanel()`](../src/renderer/app.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |
| 取消选中（ESC/右键） | 对局中按 ESC 或右键棋盘 | [app.ts `clearSelection()`](../src/renderer/app.ts)、[`bindEvents()`](../src/renderer/app.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 断线重连（宽限恢复） | 对手意外断线时自动提示，重连后恢复原局 | [host-server.ts `handleClose()` / `startGuestGrace()`](../src/server/host-server.ts) → `opponent_away` → [app.ts `handleMessage()`](../src/renderer/app.ts) 显示等待；超时或「等待新对手」回 waiting | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0005](./adr/0005-host-server.md) |
| 服务端错误提示 | 收到 `error` 消息时自动 | [app.ts `handleMessage()`](../src/renderer/app.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 认输 | 对局页「认输」 | [app.ts `resign()`](../src/renderer/app.ts) → `resign` → [game.ts `resign()`](../src/server/game.ts#L143-L153) → 广播 `game_over` | [ADR-0004](./adr/0004-game-state-machine.md) |
| 和棋（申请/同意） | 对局页「和棋」 | [app.ts `offerDraw()`](../src/renderer/app.ts) → `draw_request` / `draw_response` → [host-server.ts 路由](../src/server/host-server.ts) | [ADR-0003](./adr/0003-wire-protocol.md) |
| 再来一局（申请/同意） | 对局结束后侧栏结果卡「再来一局」 | [app.ts `requestRestart()`](../src/renderer/app.ts) → `restart_request` / `restart_response` → [host-server.ts 路由](../src/server/host-server.ts) | [ADR-0003](./adr/0003-wire-protocol.md) |
| 离开对局 | 棋盘下「离开」/ 结果卡「返回首页」/「离开观战」 | [app.ts `leaveToHome()`](../src/renderer/app.ts) → `leave` → [host-server.ts `handleClose()`](../src/server/host-server.ts) | [ADR-0005](./adr/0005-host-server.md) |
| 断线提示 | 对方主动离开 / 本端连接中断时自动弹出 | [net.ts `onclose`](../src/renderer/net.ts#L90-L98)、[app.ts `handleClosed()`](../src/renderer/app.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 心跳保活 | 后台自动运行（5s 间隔） | [net.ts `startPing()`](../src/renderer/net.ts#L124-L137) → `ping` / `pong`（`pong` 携带主机声明地址） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 视角翻转（黑方） | 加入者执黑时自动翻转 | [board.ts `toView()` / `pickCell()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 结束结果卡 | 对局结束时侧栏显示结果与结束操作（不遮挡棋盘） | [app.ts `updatePanel()`](../src/renderer/app.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| Electron 桌面启动 / 打包 | `npm start` / `npm run dist` | [main.ts `createWindow()`](../src/main/main.ts#L22-L33)、[package.json `build` 配置](../package.json) | [ADR-0006](./adr/0006-process-entries.md) |
| 无界面主机启动 / 开发模式 | `npm run host` / `npm run dev` | [cli.ts](../src/server/cli.ts)、[dev.mjs](../scripts/dev.mjs) | [ADR-0006](./adr/0006-process-entries.md) |

---

## 6. 目录结构

```text
Chinese_chess/
├── src/
│   ├── shared/            # 共享层：无 DOM/网络依赖，服务端与浏览器共用
│   │   ├── types.ts       #   数据结构：Side/Piece/Board/GameSnapshot...
│   │   ├── protocol.ts    #   通信协议：ClientMessage/ServerMessage/encode/decode/isValidPos
│   │   ├── rules.ts       #   规则引擎：走法/将军/将死/困毙/validateMove
│   │   └── notation.ts    #   中文记谱：describeMove/describeHistory/capturedPieces
│   ├── server/            # 服务端
│   │   ├── game.ts        #   对局状态机（主机权威，含 history/undo/timeout）
│   │   ├── host-server.ts #   HTTP + WebSocket 主机服务、宽限重连、AI/计时/观战
│   │   ├── ai.ts          #   人机对战 AI（negamax + α-β）
│   │   ├── log.ts         #   主机日志（LANSCHESS_DEBUG 开关）
│   │   └── cli.ts         #   无界面主机端入口
│   ├── main/
│   │   └── main.ts        #   Electron 主进程入口
│   └── renderer/          # 渲染层（主机界面与加入者浏览器共用）
│       ├── app.ts         #   页面流转 / 交互 / 消息处理 / 吃子 / 观战 / 倒计时 / 皮肤 / 先手方式
│       ├── board.ts       #   棋盘 Canvas 渲染（三套皮肤）、绘制计划与坐标换算
│       ├── review.ts      #   对局回顾列表与复盘（逐步回放 + AI 推荐）
│       ├── sound.ts       #   音效（选子 / 走子）
│       ├── net.ts         #   WebSocket 客户端 + 心跳
│       ├── discover.ts    #   局域网主机发现（WS 探测 + 网段扫描）
│       ├── assets/        #   视觉素材：img/stype_1..3（棋盘/棋子/提示点）、菜单按钮、audio、参考项目许可
│       ├── index.html     #   页面结构（首页/等待/加入/对局/回顾/复盘/弹层）
│       └── styles.css     #   样式（参考项目木质经典风格）
├── tests/                 # vitest 测试（单元 + 集成 + 端到端）
├── scripts/
│   ├── copy-assets.mjs    # 构建后复制 HTML/CSS 与素材到 dist
│   └── dev.mjs            # 开发模式：tsc watch + 主机端自动重启
├── .github/workflows/     # CI：lint → format → build → test
├── docs/                  # 本文档中心（README + ADR + 产品/技术文档 + Demo）
├── dist/                  # tsc 编译产物（git 忽略）
├── release/               # electron-builder 安装包产物（git 忽略）
├── package.json           # 脚本：build / dev / test / lint / format / host / start / dist
├── eslint.config.mjs      # ESLint（typescript-eslint recommended）
├── .prettierrc.json       # Prettier（printWidth 110）
├── tsconfig.json          # TS 配置（strict，NodeNext，ES2022）
└── vitest.config.ts       # 测试配置（node 环境，tests/**/*.test.ts）
```

---

## 7. 关键数据流（一步走子）

```text
点击棋盘 → app.onCell() 本地合法性提示（legalMoves）
        → 发送 {type:'move', from, to}
        → host-server.handleMessage() 路由
        → Game.applyMove() 权威校验（validateMove + judgeAfterMove）
        → 合法：广播 {type:'move_applied', seq, board, turn, check, ...}
        → 非法：单播 {type:'move_rejected', reason}
        → 终局追加广播 {type:'game_over', winner, reason, state}
```

---

## 8. 测试与验收

- 测试命令：`npm test`（vitest run，node 环境）；配套 `npm run lint` 与 `npm run format:check`。
- 覆盖范围：规则引擎单测、状态机单测（含悔棋/终局清理）、棋盘 Canvas 渲染计划与点击命中、中文记谱与吃子统计、
  AI 引擎、WebSocket 客户端心跳、完整对局端到端回放、服务端连接/消息/宽限重连/观战/人机（含难度）/先手方式与猜先/对局回顾与 AI 推荐/计时/静态安全与素材 MIME 集成、局域网 IP 与主机发现、复盘局面还原、主界面布局（署名遮盖 / 放大范围 / 面板与木框对齐）。

| 测试文件 | 覆盖 |
|---|---|
| [rules.test.ts](../tests/rules.test.ts) | 开局棋盘、各棋子走法、将军/照面、将死/困毙、validateMove |
| [game.test.ts](../tests/game.test.ts) | Game 状态机：走子、拒绝、认输、和棋、重开、终局清理 pending、悔棋回退、history 快照 |
| [board.test.ts](../tests/board.test.ts) | 棋盘渲染：三套皮肤几何参数、素材路径、坐标换算与点击命中（含响应式缩放）、绘制计划（棋子/上一步/选中/落点/将军/悬停/AI 推荐）、视角翻转 |
| [review.test.ts](../tests/review.test.ts) | 对局回顾：复盘局面逐步还原与越界收敛、行棋方交替、列表文案（红黑方/取先方式/时间/胜负） |
| [notation.test.ts](../tests/notation.test.ts) | 中文记谱（平/进/退/前后消歧/斜走目标列）、describeHistory 回放、capturedPieces 吃子统计 |
| [ai.test.ts](../tests/ai.test.ts) | 一步杀、白吃子、无着法返回 null、开局着法合法与耗时 |
| [net.test.ts](../tests/net.test.ts) | 连接握手、心跳 5s、16s 无 pong 判离线、主动关闭不提示（假定时器） |
| [fullgame.test.ts](../tests/fullgame.test.ts) | 完整一盘棋 WS 回放：双方棋盘一致、seq 单调、history 一致、`game_over`「将死」、重开 |
| [server.test.ts](../tests/server.test.ts) | 加入/开局/走子/拒绝/悔棋/观战/人机（含难度参数）/计时/宽限重连/日志/端口回退/静态资源安全与 MIME（png/jpg/wav）等集成行为 |
| [discover.test.ts](../tests/discover.test.ts) | 主机探测、无服务端口返回 null、网段扫描聚合去重与进度 |
| [lan-ip.test.ts](../tests/lan-ip.test.ts) | pickLanIp 网段优先级与虚拟网卡跳过 |
| [ui-home-layout.test.ts](../tests/ui-home-layout.test.ts) | 主界面布局：主页背景署名已被 cover.bmp 覆盖（索引 PNG 像素级验证）、整体放大仅作用于木质挂板/页脚（对局与回顾不缩放）、三个子面板与木框对齐几何常量（280×237 / 限高 183 / 间距 8） |

验收标准见 [Product-plan.md 第 14 节](./Product-plan.md) 与 [ADR-0008](./adr/0008-testing-strategy.md)。

---

## 9. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 加入者连不上 | 确认同一局域网、防火墙放行端口、地址用主机页显示的那个（跳过虚拟网卡）；也可在加入页点「搜索局域网主机」自动发现 |
| 端口被占用 | Electron 模式会自动回退随机端口；CLI 未显式指定端口时同样回退，显式指定（`LANSCHESS_PORT`）则提示更换端口 |
| 对方意外断线 | 进入 30 秒宽限期：重新打开页面「加入对局」连接即可恢复原局；主机也可在弹层选「等待新对手」。超时才提示「对手已离开」，程序不崩溃 |
| 对方主动离开 | 页面弹「对手已离开」提示；可返回首页重新开局 |
| 想要每步限时 | 启动主机前设置 `LANSCHESS_TURN_MS=60000`（每步 60 秒）；超时方判负，状态框显示剩余秒数 |
| 主机端没有日志 / 日志太多 | `LANSCHESS_DEBUG=0` 关闭；`=1` 输出调试明细（默认只输出连接/走子/终局等关键打点） |
| 页面提示"请通过主机端页面打开" | 直接从文件系统打开的页面无本地服务，需通过 `http://主机:端口/` 访问 |