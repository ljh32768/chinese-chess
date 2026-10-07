# 局域网象棋（lan-chess）文档中心

局域网中国象棋：**中心服务器（局域网）+ 多房间并发** + WebSocket 通信 + 纯 TypeScript 规则引擎，
浏览器的与 Electron 客户端共用同一套渲染页面。

> 一句话：局域网内任一台设备打开服务器地址，就能创建 / 加入房间，完整、正确地下一盘棋。

- 版本：v2.0（v0.1.0 为 MVP 代码基线；v1.1–v1.6 为主机权威时代的优化与功能迭代；**v2.0 迁移到局域网中心服务器**）
- 状态：v2.0 架构迁移完成；196 项自动化测试通过，lint / format / build / CI 全绿
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
| v1.6 | 界面调整：主界面整体放大 1.25 倍、三个子面板与木板内框对齐、用 cover.bmp 覆盖主页署名 | commit `6e9fb40` |
| **v2.0** | **架构迁移：主机权威（P2P 星型）→ 局域网中心服务器 + 多房间并发**；新增最简账号系统、房间口令、终局房间自动销毁、对局记录持久化、服务器发现重构；Electron 默认改为「连接服务器」 | 见 [ADR-0010](./adr/0010-room-server.md) |

---

## 1. 文档导航

| 文档 | 内容 | 说明 |
|---|---|---|
| [Product-plan.md](./Product-plan.md) | 产品设计文档（v0.1） | 定位、范围、流程、验收标准 |
| [Technical-solution.md](./Technical-solution.md) | 技术方案（v1.0，主机权威时代基线） | 架构选型与总体设计；权威边界仍适用，进程形态见 ADR-0010 |
| [adr/](./adr/) | ADR 架构决策 + 模块详细规格（0001–0010） | **各功能入口的详细 spec，见第 5 节** |
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
npm run serve        # 启动中心服务器（无界面常驻；等价 npm run host）
npm start            # 以 Electron 客户端启动（默认连接服务器）
npm run dev          # 开发模式：tsc watch + 服务器自动重启 + 静态资源同步
npm run dist         # 用 electron-builder 产出 Windows 安装包（release/）
```

局域网对战流程：

1. 在一台常开设备（NAS / 小主机 / 任一电脑）上运行 `npm run build && npm run serve`，
   控制台显示服务器地址，如 `http://192.168.1.42:7777`（账号与对局记录默认落盘到 `./data/`）。
2. 各位玩家用浏览器打开该地址；也可以运行 Electron 客户端（默认连 `127.0.0.1:7777`，
   用 `LANSCHESS_SERVER=192.168.1.42:7777` 指定服务器；连不上时可选择「本机开服」便携模式）。
3. 房主点首页「创建房间」（可选设置房间口令）→ 进入等待页并得到 **6 位房间号**；
   对手点「加入房间」输入房间号（房间有口令时输入口令），也可点「刷新房间」从列表选择。
4. 双方到齐自动开局；开赛前房主可在等待页选择先手方式：红 / 黑 / 随机黑红 / 猜先
   （猜先由房主抓单双、对手猜，猜中者执红）。
5. 第三方观众输入同一房间号点「观战」即可只读旁观（不占席位）。
6. 单人可点首页「人机对弈」选择难度（菜鸟/中级/高手）后与 AI（执黑）对弈。
7. 对局结束后：若无人点「再来一局」，房间会自动销毁并释放房间号；首页「对局回顾」可查看历史对局
   （红黑方 / 取先方式 / 时间 / 胜负），点进某一局即可「下一步 ▶」逐步复盘并查看每个局面的 AI 推荐着法。

账号（可选）：在「加入房间」页填写用户名与密码点「登 录」或「注 册」；登录后对局记录会归属账号，
并能凭账号在不同设备上恢复原席位。不登录也能以「游客」身份游玩。

环境变量：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `LANSCHESS_PORT` | `7777` | 服务器监听端口；Electron 便携模式被占用时自动回退随机端口，CLI 显式指定时给出提示 |
| `LANSCHESS_DATA` | `<cwd>/data` | 账号与对局记录的持久化目录；设为 `off` 则仅内存 |
| `LANSCHESS_SERVER` | `127.0.0.1:7777` | Electron 客户端要连接的服务器地址（`host:port`） |
| `LANSCHESS_TURN_MS` | `0` | 计时读秒：每回合限时毫秒数，`0` 表示不限时（如 `60000` = 每步 60 秒，超时判负） |
| `LANSCHESS_DEBUG` | 未设置 | 日志开关：未设置输出 info 打点；`1` 追加 debug 明细；`0` 全部关闭 |

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────────────────┐
│                中心服务器（node dist/server，纯托管）       │
│                                                          │
│  Server         HTTP 静态资源 + /api/* + WebSocket /ws    │
│  RoomManager    Map<roomId, Room>：建房 / 路由 / 空闲回收  │
│  Room           Game 权威状态机 + rules + AI + 计时 + 记录  │
│  AccountStore   最简账号（scrypt 加盐 + token）            │
│  HistoryStore   对局记录跨房间集中保存                      │
│                 ↓ 落盘 data/users.json、data/history.json  │
└────────────────────────────┬─────────────────────────────┘
                             │ WebSocket（JSON）
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
  │  玩家 A   │        │  玩家 B   │        │  观战者   │
  │ 浏览器/   │        │ 浏览器/   │        │  只读     │
  │ Electron  │        │ Electron  │        │           │
  └───────────┘        └───────────┘        └───────────┘
```

> v2.0 架构迁移：原「主机即服务器」的 `HostServer` 拆分为
> [server.ts](../src/server/server.ts)（多房间服务器）与 [room.ts](../src/server/room.ts)（单局房间），
> 并新增 [accounts.ts](../src/server/accounts.ts)、[history.ts](../src/server/history.ts)、
> [conn.ts](../src/server/conn.ts)、[server-main.ts](../src/server/server-main.ts)
> —— 详见 [ADR-0010](./adr/0010-room-server.md)。
>
> v1.3 新增模块：渲染层 [discover.ts](../src/renderer/discover.ts)（局域网服务器发现）、
> 服务端 [ai.ts](../src/server/ai.ts)（人机对战）与 [log.ts](../src/server/log.ts)（服务器日志）、
> 共享层 [notation.ts](../src/shared/notation.ts)（中文记谱）——详见 [ADR-0009](./adr/0009-c-d-extensions.md)。
>
> v1.4 前端视觉改造：渲染层棋盘改为 **Canvas + 图片素材**（[board.ts](../src/renderer/board.ts)），
> 新增音效 [sound.ts](../src/renderer/sound.ts) 与素材目录 [assets/](../src/renderer/assets/)——详见 [ADR-0007](./adr/0007-renderer-ui.md)。

核心原则（详见 [ADR-0001](./adr/0001-host-authoritative-architecture.md) 与 [ADR-0010](./adr/0010-room-server.md)）：

- **服务器权威**：唯一真实棋盘在服务器进程的某个 `Room.game` 中，规则校验与胜负判定都在服务器完成；
  服务器**不占任何玩家席位**（纯托管），因此玩家无法通过修改客户端作弊。
- **客户端请求**：客户端只发送走子「意图」，服务器校验后广播结果。
- **房间隔离**：每个房间一份权威 `Game`，并发多盘互不影响；`roomId` 是一等概念。
- **规则引擎与 UI 分离**：`rules.ts` 为纯 TS 模块，不依赖 DOM / 网络，可独立单测。
- **简单同步**：每步广播完整棋盘快照，带单调递增 `seq`。

---

## 4. 功能模块化总览

代码分为共享层、服务端、渲染层与进程入口，依赖方向单向、无环：

```text
shared（协议/规则/类型，无环境依赖）
   ▲                      ▲
   │                      │
server（中心服务器）    renderer（浏览器页面）
   ▲                      ▲
   │                      │
main / server-main（进程入口，装配 server 与页面）
```

| # | 模块 | 职责 | 代码入口 | 详细规格 |
|---|---|---|---|---|
| 1 | 规则引擎 | 走法生成、送将过滤、将军/将死/困毙判定 | [rules.ts](../src/shared/rules.ts)、[types.ts](../src/shared/types.ts) | [ADR-0002](./adr/0002-rules-engine.md) |
| 2 | 通信协议 | 客户端/服务端消息定义、编解码、共享数据结构 | [protocol.ts](../src/shared/protocol.ts)、[types.ts](../src/shared/types.ts) | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0010](./adr/0010-room-server.md) |
| 3 | 对局状态机 | 权威棋盘状态、走子校验链、认输/和棋/重开/超时 | [game.ts](../src/server/game.ts) | [ADR-0004](./adr/0004-game-state-machine.md) |
| 4 | 中心服务器 | HTTP 静态服务 + API、WebSocket 路由、房间表、空闲回收、局域网 IP 发现 | [server.ts](../src/server/server.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 5 | 房间 | 席位、先手方式、猜先、断线宽限、读秒、人机对战、终局落库与销毁倒计时 | [room.ts](../src/server/room.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 6 | 连接对象 | WebSocket 连接与房间 / 角色 / 玩家身份的最小视图 | [conn.ts](../src/server/conn.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 7 | 账号系统 | 注册 / 登录 / token（scrypt 加盐），落盘 `data/users.json` | [accounts.ts](../src/server/accounts.ts) | [ADR-0010 §3.10](./adr/0010-room-server.md) |
| 8 | 对局记录 | 跨房间集中保存、防抖落盘、损坏降级 | [history.ts](../src/server/history.ts) | [ADR-0010 §3.8](./adr/0010-room-server.md) |
| 9 | 进程入口 | Electron 客户端、常驻服务器入口、构建脚本 | [main.ts](../src/main/main.ts)、[server-main.ts](../src/server/server-main.ts)、[copy-assets.mjs](../scripts/copy-assets.mjs) | [ADR-0006](./adr/0006-process-entries.md) |
| 10 | 渲染层 | 页面流转、棋盘 Canvas 渲染与交互、三套皮肤与音效、房间 / 账号 UI、对局回顾与复盘、WebSocket 客户端与心跳、服务器发现 | [app.ts](../src/renderer/app.ts)、[board.ts](../src/renderer/board.ts)、[review.ts](../src/renderer/review.ts)、[sound.ts](../src/renderer/sound.ts)、[net.ts](../src/renderer/net.ts)、[discover.ts](../src/renderer/discover.ts)、[index.html](../src/renderer/index.html) | [ADR-0007](./adr/0007-renderer-ui.md)、[ADR-0009](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 11 | 测试体系 | 单元测试、服务端集成测试、完整对局端到端回放 | [tests/](../tests/) | [ADR-0008](./adr/0008-testing-strategy.md) |
| 12 | 记谱 / AI / 日志 | 中文记谱与吃子、negamax + α-β 搜索、`LANSCHESS_DEBUG` 日志 | [notation.ts](../src/shared/notation.ts)、[ai.ts](../src/server/ai.ts)、[log.ts](../src/server/log.ts) | [ADR-0009](./adr/0009-c-d-extensions.md) |

---

## 5. 功能入口

按用户可见功能列出入口链路：**UI 触发点 → 客户端处理 → 服务端处理 → 规则/状态判定**，
每一行末尾为对应的详细规格（ADR）。

| 功能 | UI 触发点 | 实现入口（代码） | 详细 spec |
|---|---|---|---|
| 创建房间 | 首页「创建房间」→ 子面板填口令 →「创建房间」 | [app.ts `createRoom()`](../src/renderer/app.ts) → WS `create_room` → [server.ts `handleCreateRoom()`](../src/server/server.ts) → [room.ts `joinPlayer()`](../src/server/room.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 房间口令（可选） | 创建房间子面板的「房间口令（可选）」 | [app.ts `createRoom()`](../src/renderer/app.ts)（随 `create_room.password` 提交）→ [server.ts](../src/server/server.ts#L383-L392)；等待页可用 `set_password` 修改 | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 加入房间 | 首页「加入房间」→ 输入房间号（+口令）→「加入房间」 | [app.ts `doJoin()`](../src/renderer/app.ts) → WS `join_room` → [server.ts `handleJoinRoom()`](../src/server/server.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 房间列表 | 加入页「刷新房间」 | [app.ts `refreshRooms()`](../src/renderer/app.ts) → WS `list_rooms` / `GET /api/rooms` → [server.ts `listRooms()`](../src/server/server.ts) | [ADR-0010 §3.6](./adr/0010-room-server.md) |
| 观战（只读） | 加入页「观 战」 | `join_room{role:'spectator'}` → [room.ts `joinSpectator()`](../src/server/room.ts) → [app.ts `openSocket()` / `doJoin()`](../src/renderer/app.ts) | [ADR-0009 §3.5](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 账号注册 / 登录（可选） | 加入页用户名 + 密码 →「登 录」/「注 册」 | [app.ts `doAuth()`](../src/renderer/app.ts) → WS `register` / `login` 或 `POST /api/auth/*` → [accounts.ts](../src/server/accounts.ts) | [ADR-0010 §3.10](./adr/0010-room-server.md) |
| 先手方式（红/黑/随机/猜先） | 等待页「先手（红方）」四个选项 | [app.ts `chooseFirst()`](../src/renderer/app.ts) → `choose_first` → [room.ts `maybeStart()` / `beginFirst()`](../src/server/room.ts) | [ADR-0009 §3.9](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 猜先（房主抓、对手猜） | 房主弹层「抓单 / 抓双」→ 对手弹层「猜单 / 猜双」 | `grasp` → `guess` → [room.ts `beginFirst()`](../src/server/room.ts) → 广播 `first_result`（猜中者执红）→ 逐连接 `start{side}` | [ADR-0009 §3.9](./adr/0009-c-d-extensions.md) |
| 自动开局 | 双方到齐后由服务器触发 | [room.ts `afterJoin()` / `maybeStart()` / `startGame()`](../src/server/room.ts) → 广播 `start` | [ADR-0010](./adr/0010-room-server.md) |
| 复制房间号 | 等待页点击房间号块（`ip-box`） | [app.ts `copyRoomNo()`](../src/renderer/app.ts)（非安全上下文降级 `execCommand`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 走子（选子/落点/发送） | 点击棋盘 | [app.ts `onCell()`](../src/renderer/app.ts) → `move` → [room.ts `applyAndBroadcast()`](../src/server/room.ts) → [game.ts `applyMove()`](../src/server/game.ts) | [ADR-0002](./adr/0002-rules-engine.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 规则裁判（将军/将死/困毙） | 走子后自动判定 | [rules.ts `judgeAfterMove()`](../src/shared/rules.ts)、[`validateMove()`](../src/shared/rules.ts) | [ADR-0002](./adr/0002-rules-engine.md) |
| 将军/将死高亮 | 走子后自动 | [board.ts `computeDrawList()`](../src/renderer/board.ts)（被将军一方的将/帅红色脉冲警示环） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 悬停预高亮 | 鼠标悬停棋盘 | [app.ts `bindEvents()`](../src/renderer/app.ts) + [board.ts `computeDrawList()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 吃子统计 | 侧栏吃子面板自动更新 | [app.ts `renderCaptured()`](../src/renderer/app.ts) → [notation.ts `capturedPieces()`](../src/shared/notation.ts) | [ADR-0009 §3.2](./adr/0009-c-d-extensions.md) |
| 悔棋（申请/同意） | 对局页「悔棋」 | [app.ts `offerUndo()`](../src/renderer/app.ts) → `undo_request` / `undo_response` → [room.ts `handleMessage()`](../src/server/room.ts) → [game.ts `undo()`](../src/server/game.ts) | [ADR-0009 §3.6](./adr/0009-c-d-extensions.md) |
| 计时读秒 | 状态框显示「剩余 xx s」 | [room.ts `armTurnTimer()`](../src/server/room.ts) → 快照 `deadline` → [app.ts `updatePanel()`](../src/renderer/app.ts) | [ADR-0009 §3.8](./adr/0009-c-d-extensions.md) |
| 断线重连（宽限恢复） | 对手意外断线时自动提示，重连后恢复原局 | [room.ts `startGrace()` / `expireGrace()`](../src/server/room.ts) → `opponent_away`；客户端凭 `playerId` 重连（[app.ts `tryResumeSession()`](../src/renderer/app.ts)） | [ADR-0010 §3.4](./adr/0010-room-server.md) |
| 终局销毁房间 | 对局结束后无人「再来一局」时自动 | [room.ts `armOverTimer()`](../src/server/room.ts) → 广播 `room_closed` → [app.ts `handleMessage()`](../src/renderer/app.ts) | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 认输 / 和棋 / 再来一局 | 对局页按钮 | [app.ts `resign()` / `offerDraw()` / `requestRestart()`](../src/renderer/app.ts) → [room.ts](../src/server/room.ts) → `game_over` / `start` | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 离开房间 | 棋盘下「离开」/ 结果卡「返回首页」/「离开观战」 | [app.ts `leaveToHome()`](../src/renderer/app.ts) → `leave_room` → [room.ts `leave()`](../src/server/room.ts)（房主离开会销毁房间） | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 对局回顾（列表） | 首页「对局回顾」 | [review.ts `open()`](../src/renderer/review.ts) → `GET /api/history` → [history.ts](../src/server/history.ts) | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md) |
| 复盘（逐步 + AI 推荐） | 列表点击某局 → 「下一步 ▶」/ → 键 | [review.ts](../src/renderer/review.ts) → `GET /api/history/:id` + `GET /api/ai/hint?id&index` | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md) |
| 人机对战 | 首页「人机对弈」→ 选难度 →「开始对弈」 | [app.ts `createAiRoom()`](../src/renderer/app.ts) → `create_room{mode:'ai',depth}` → [room.ts `startAiGame()` / `scheduleAiMove()`](../src/server/room.ts) → [ai.ts](../src/server/ai.ts) | [ADR-0009 §3.7](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 搜索局域网服务器 | 加入页「搜索服务器」 | [app.ts `scanServers()`](../src/renderer/app.ts) → [discover.ts `probeServer()` / `discoverSubnet()`](../src/renderer/discover.ts)（点结果跳转到该服务器） | [ADR-0010 §3.9](./adr/0010-room-server.md) |
| 更换皮肤 | 首页「更换皮肤」 | [app.ts `switchSkin()`](../src/renderer/app.ts) → [board.ts `nextSkin()` / `loadSkinImages()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 选子 / 走子音效 | 点击棋子 / 收到走子广播时自动 | [sound.ts](../src/renderer/sound.ts)（`select.wav` / `click.wav`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 心跳保活 | 后台自动运行（5s 间隔） | [net.ts `startPing()`](../src/renderer/net.ts) → `ping` / `pong`（`pong` 携带服务器声明地址） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 视角翻转（黑方） | 加入者执黑时自动翻转 | [board.ts `toView()` / `pickCell()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 服务器常驻启动 / 开发模式 | `npm run serve` / `npm run dev` | [server-main.ts](../src/server/server-main.ts)、[dev.mjs](../scripts/dev.mjs) | [ADR-0006](./adr/0006-process-entries.md) |
| Electron 客户端启动 / 打包 | `npm start` / `npm run dist` | [main.ts `createWindow()`](../src/main/main.ts)、[package.json](../package.json) | [ADR-0006](./adr/0006-process-entries.md)、[ADR-0010 §3.1](./adr/0010-room-server.md) |

---

## 6. 目录结构

```text
Chinese_chess/
├── src/
│   ├── shared/            # 共享层：无 DOM/网络依赖，服务端与浏览器共用
│   │   ├── types.ts       #   数据结构：Side/Piece/Board/PlayerRef/GameRecord/RoomSummary...
│   │   ├── protocol.ts    #   通信协议：ClientMessage/ServerMessage/encode/decode/isValidPos
│   │   ├── rules.ts       #   规则引擎：走法/将军/将死/困毙/validateMove
│   │   └── notation.ts    #   中文记谱：describeMove/describeHistory/capturedPieces
│   ├── server/            # 服务端（中心服务器）
│   │   ├── server.ts      #   服务器：HTTP 静态+API、WS 路由、房间表、空闲回收、局域网 IP
│   │   ├── room.ts        #   单局房间：席位/先手/猜先/宽限/读秒/AI/落库/销毁倒计时
│   │   ├── conn.ts        #   连接对象（连接 ↔ 房间 ↔ 角色 ↔ 玩家身份）
│   │   ├── accounts.ts    #   最简账号：注册/登录/token，落盘 data/users.json
│   │   ├── history.ts     #   对局记录：跨房间集中保存，落盘 data/history.json
│   │   ├── game.ts        #   对局状态机（权威，含 history/undo/timeout/deadline）
│   │   ├── ai.ts          #   人机对战 AI（negamax + α-β）
│   │   ├── log.ts         #   服务器日志（LANSCHESS_DEBUG 开关）
│   │   └── server-main.ts #   常驻服务器入口（npm run serve）
│   ├── main/
│   │   └── main.ts        #   Electron 客户端主进程（默认连接服务器）
│   └── renderer/          # 渲染层（客户端页面，浏览器与 Electron 共用）
│       ├── app.ts         #   页面流转 / 房间与账号交互 / 消息处理 / 吃子 / 观战 / 倒计时 / 皮肤
│       ├── board.ts       #   棋盘 Canvas 渲染（三套皮肤）、绘制计划与坐标换算
│       ├── review.ts      #   对局回顾列表与复盘（逐步回放 + AI 推荐）
│       ├── sound.ts       #   音效（选子 / 走子）
│       ├── net.ts         #   WebSocket 客户端 + 心跳
│       ├── discover.ts    #   局域网服务器发现（WS 探测 + 网段扫描）
│       ├── assets/        #   视觉素材：img/stype_1..3、菜单按钮、audio、参考项目许可
│       ├── index.html     #   页面结构（首页/等待/加入/对局/回顾/复盘/弹层）
│       └── styles.css     #   样式（参考项目木质经典风格）
├── tests/                 # vitest 测试（单元 + 集成 + 端到端）
├── scripts/
│   ├── copy-assets.mjs    # 构建后复制 HTML/CSS 与素材到 dist
│   └── dev.mjs            # 开发模式：tsc watch + 服务器自动重启
├── data/                  # 运行时数据（账号 / 对局记录，git 忽略）
├── .github/workflows/     # CI：lint → format → build → test
├── docs/                  # 本文档中心（README + ADR + 产品/技术文档 + Demo）
├── dist/                  # tsc 编译产物（git 忽略）
├── release/               # electron-builder 安装包产物（git 忽略）
├── package.json           # 脚本：build / dev / test / lint / format / serve / host / start / dist
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
        → server.handleMessage() 按连接的 roomId 路由到 Room
        → Room.handleMessage() → Game.applyMove() 权威校验（validateMove + judgeAfterMove）
        → 合法：广播 {type:'move_applied', seq, board, turn, check, ...}
        → 非法：单播 {type:'move_rejected', reason}
        → 终局追加广播 {type:'game_over', ...}，落库并启动房间销毁倒计时
```

---

## 8. 测试与验收

- 测试命令：`npm test`（vitest run，node 环境）；配套 `npm run lint` 与 `npm run format:check`。
- 覆盖范围：规则引擎单测、状态机单测（含悔棋/终局清理）、棋盘 Canvas 渲染计划与点击命中、中文记谱与吃子统计、
  AI 引擎、WebSocket 客户端心跳、完整对局端到端回放、服务器连接/消息/房间隔离/口令/宽限重连/观战/人机（含难度）/
  先手方式与猜先/对局回顾与 AI 推荐/计时/静态安全与素材 MIME 集成、账号与记录持久化、局域网 IP 与服务器发现、
  复盘局面还原、主界面布局（署名遮盖 / 放大范围 / 面板与木框对齐）。

| 测试文件 | 覆盖 |
|---|---|
| [rules.test.ts](../tests/rules.test.ts) | 开局棋盘、各棋子走法、将军/照面、将死/困毙、validateMove |
| [game.test.ts](../tests/game.test.ts) | Game 状态机：走子、拒绝、认输、和棋、重开、终局清理 pending、悔棋回退、history 快照 |
| [board.test.ts](../tests/board.test.ts) | 棋盘渲染：三套皮肤几何参数、素材路径、坐标换算与点击命中（含响应式缩放）、绘制计划、视角翻转 |
| [review.test.ts](../tests/review.test.ts) | 复盘局面还原与越界收敛、行棋方交替、列表文案（玩家名/取先方式/时间/胜负） |
| [notation.test.ts](../tests/notation.test.ts) | 中文记谱（平/进/退/前后消歧/斜走目标列）、describeHistory 回放、capturedPieces 吃子统计 |
| [ai.test.ts](../tests/ai.test.ts) | 一步杀、白吃子、无着法返回 null、开局着法合法与耗时 |
| [net.test.ts](../tests/net.test.ts) | 连接建立与消息分发、pong 内部消化、心跳 5s、16s 无 pong 判离线、主动关闭不提示 |
| [fullgame.test.ts](../tests/fullgame.test.ts) | 完整一盘棋 WS 回放：双方棋盘一致、seq 单调、history 一致、`game_over`「将死」、重开 |
| [server.test.ts](../tests/server.test.ts) | 建房/加入/口令/房间列表/满员；走子与拒绝；认输/和棋/重开/悔棋/离开；观战；宽限重连与房间销毁；终局销毁；空闲回收；两房间隔离；先手方式与猜先；账号与记录归属；人机；计时；日志与端口回退；静态资源安全与 MIME |
| [persistence.test.ts](../tests/persistence.test.ts) | 账号注册/登录/token 轮换、账号与对局记录落盘与重启读回、容量上限、损坏文件降级 |
| [discover.test.ts](../tests/discover.test.ts) | 服务器探测、无服务端口返回 null、网段扫描聚合去重与进度 |
| [lan-ip.test.ts](../tests/lan-ip.test.ts) | pickLanIp 网段优先级与虚拟网卡跳过 |
| [ui-home-layout.test.ts](../tests/ui-home-layout.test.ts) | 主界面布局：主页背景署名已被 cover.bmp 覆盖（索引 PNG 像素级验证）、整体放大仅作用于木质挂板/页脚、三个子面板与木框对齐几何常量 |

验收标准见 [Product-plan.md 第 14 节](./Product-plan.md)、[ADR-0008](./adr/0008-testing-strategy.md)
与 [ADR-0010 §6](./adr/0010-room-server.md)。

---

## 9. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 打不开页面 / 客户端连不上服务器 | 确认中心服务器已 `npm run serve` 启动、与客户端在同一局域网、防火墙放行端口；Electron 用 `LANSCHESS_SERVER=主机:端口` 指定服务器 |
| 加入时提示「房间不存在」 | 房间号输错，或该房间已被销毁（房主离开 / 终局后无人再来一局 / 空闲超时）；点「刷新房间」查看当前可加入的房间 |
| 加入时提示「房间口令错误」 | 该房间设置了口令，向房主索取后填入「口令（如有）」输入框 |
| 加入时提示「房间已满」 | 该房间两席已满（人机房里对手席由 AI 占用）；可旁观或另开一间 |
| 端口被占用 | 服务器未显式指定 `LANSCHESS_PORT` 时自动回退随机端口；显式指定则提示更换端口 |
| 对方意外断线 | 进入 30 秒宽限期：对方重新打开页面会自动凭 `playerId` 恢复原局；房主也可选择「等待新对手」 |
| 两盘棋同时进行 | 支持：每个房间有独立权威棋盘与房间号，互不影响 |
| 同一台机器想开两个玩家 | 同浏览器多标签共享 `localStorage`，第二个标签会被当作「房主重连」；请用不同来源（`127.0.0.1` 与 `localhost`）或不同浏览器 |
| 对局记录重启后丢失 | 默认落盘到 `./data/history.json`；若设置了 `LANSCHESS_DATA=off` 则仅内存 |
| 主机端没有日志 / 日志太多 | `LANSCHESS_DEBUG=0` 关闭；`=1` 输出调试明细（默认只输出连接/走子/终局等关键打点） |
| 页面提示"请通过主机端页面打开" | 直接从文件系统打开的页面无服务器连接，需通过 `http://服务器:端口/` 访问 |
