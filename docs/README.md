# 局域网象棋（lan-chess）文档中心

局域网两人实时对战中国象棋 MVP。主机权威 + WebSocket 通信 + 纯 TypeScript 规则引擎，
Electron 桌面端与浏览器共用同一套渲染页面。

> 一句话：局域网内两台设备连上后，能完整、正确地下一盘棋。

- 版本：v0.1.0
- 状态：MVP 已实现并通过全部测试

---

## 1. 文档导航

| 文档 | 内容 | 说明 |
|---|---|---|
| [Product-plan.md](./Product-plan.md) | 产品设计文档（v0.1） | 定位、范围、流程、验收标准 |
| [Technical-solution.md](./Technical-solution.md) | 技术方案（v1.0） | 架构选型与总体设计 |
| [adr/](./adr/) | ADR 架构决策 + 模块详细规格 | **各功能入口的详细 spec，见第 5 节** |
| [Demo.html](./Demo.html) | 单文件界面原型 | 仅验证界面布局与操作流程，无真实网络 |

---

## 2. 快速开始

```bash
npm install          # 安装依赖
npm run build        # 编译 TypeScript + 复制静态资源到 dist/
npm test             # 运行全部测试（vitest run）
npm start            # 构建后以 Electron 桌面端启动（主机端）
npm run host         # 先 build，再以无界面 Node 方式启动主机端（CLI 调试用）
```

局域网对战流程：

1. 主机运行 `npm start`（或 `npm run build && npm run host`），在首页点击「创建对局」，页面显示本机地址，如 `192.168.1.42:7777`。
2. 对手在同一局域网的浏览器中打开 `http://192.168.1.42:7777/`，点击「加入对局」，输入该地址连接。
3. 双方加入后自动开局：主机执红先行，加入者执黑。

环境变量：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `LANSCHESS_PORT` | `7777` | 主机监听端口；Electron 模式端口被占用时自动回退随机端口 |

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
| 6 | 渲染层 | 页面流转、棋盘 SVG 渲染与交互、WebSocket 客户端、心跳 | [app.ts](../src/renderer/app.ts)、[board.ts](../src/renderer/board.ts)、[net.ts](../src/renderer/net.ts)、[index.html](../src/renderer/index.html) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 7 | 测试体系 | 单元测试、服务端集成测试、完整对局端到端回放 | [tests/](../tests/) | [ADR-0008](./adr/0008-testing-strategy.md) |

---

## 5. 功能入口

按用户可见功能列出入口链路：**UI 触发点 → 客户端处理 → 服务端处理 → 规则/状态判定**，
每一行末尾为对应的详细规格（ADR）。

| 功能 | UI 触发点 | 实现入口（代码） | 详细 spec |
|---|---|---|---|
| 创建对局 | 首页「创建对局」按钮 | [app.ts `createGame()`](../src/renderer/app.ts#L287-L300) → `POST /api/host/start` → [host-server.ts `setHosting()`](../src/server/host-server.ts#L139-L150) | [ADR-0005](./adr/0005-host-server.md) |
| 显示本机地址 | 主机等待页 | [app.ts `init()`](../src/renderer/app.ts#L444-L458) → `GET /api/host-info` → [host-server.ts `pickLanIp()`](../src/server/host-server.ts#L38-L57) | [ADR-0005](./adr/0005-host-server.md) |
| 加入对局 | 「加入对局」→ 输入 IP:端口 →「连接」 | [app.ts `doJoin()`](../src/renderer/app.ts#L321-L341) → WS `join(guest)` → [host-server.ts `handleJoin()`](../src/server/host-server.ts#L344-L387) | [ADR-0005](./adr/0005-host-server.md) |
| 自动开局 | 双方加入后由主机触发 | [host-server.ts `maybeStart()` / `startGame()`](../src/server/host-server.ts#L389-L400) → 广播 `start` | [ADR-0003](./adr/0003-wire-protocol.md) |
| 走子（选子/落点/发送） | 点击棋盘 | [app.ts `onCell()`](../src/renderer/app.ts#L385-L415) → `move` → [game.ts `applyMove()`](../src/server/game.ts#L60-L82) → 广播 `move_applied` | [ADR-0002](./adr/0002-rules-engine.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 规则裁判（将军/将死/困毙） | 走子后自动判定 | [rules.ts `judgeAfterMove()`](../src/shared/rules.ts#L299-L307)、[`validateMove()`](../src/shared/rules.ts#L313-L330) | [ADR-0002](./adr/0002-rules-engine.md) |
| 认输 | 对局页「认输」 | [app.ts `resign()`](../src/renderer/app.ts#L359-L369) → `resign` → [game.ts `resign()`](../src/server/game.ts#L85-L92) → 广播 `game_over` | [ADR-0004](./adr/0004-game-state-machine.md) |
| 和棋（申请/同意） | 对局页「和棋」 | [app.ts `offerDraw()`](../src/renderer/app.ts#L371-L375) → `draw_request` / `draw_response` → [host-server.ts 路由](../src/server/host-server.ts#L292-L311) | [ADR-0003](./adr/0003-wire-protocol.md) |
| 重开（申请/同意） | 「重开」或结束弹层「再来一局」 | [app.ts `requestRestart()`](../src/renderer/app.ts#L377-L381) → `restart_request` / `restart_response` → [host-server.ts 路由](../src/server/host-server.ts#L313-L331) | [ADR-0003](./adr/0003-wire-protocol.md) |
| 离开对局 | 对局页「离开」/ 弹层「返回首页」 | [app.ts `leaveToHome()`](../src/renderer/app.ts#L343-L355) → `leave` → [host-server.ts `handleClose()`](../src/server/host-server.ts#L402-L415) | [ADR-0005](./adr/0005-host-server.md) |
| 断线提示 | 对方断开 / 连接中断时自动弹出 | [net.ts `onclose`](../src/renderer/net.ts#L86-L94)、[app.ts `handleClosed()`](../src/renderer/app.ts#L256-L268) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 心跳保活 | 后台自动运行（5s 间隔） | [net.ts `startPing()`](../src/renderer/net.ts#L120-L133) → `ping` / `pong` | [ADR-0007](./adr/0007-renderer-ui.md) |
| 视角翻转（黑方） | 加入者执黑时自动翻转 | [board.ts `toView()` / `pickCell()`](../src/renderer/board.ts#L23-L47) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 结束弹层 | 对局结束自动弹出 | [app.ts `showGameOver()`](../src/renderer/app.ts#L152-L161) | [ADR-0007](./adr/0007-renderer-ui.md) |
| Electron 桌面启动 | `npm start` | [main.ts `createWindow()`](../src/main/main.ts#L28-L41) | [ADR-0006](./adr/0006-process-entries.md) |
| 无界面主机启动 | `npm run host` | [cli.ts](../src/server/cli.ts) | [ADR-0006](./adr/0006-process-entries.md) |

---

## 6. 目录结构

```text
Chinese_chess/
├── src/
│   ├── shared/            # 共享层：无 DOM/网络依赖，服务端与浏览器共用
│   │   ├── types.ts       #   数据结构：Side/Piece/Board/GameSnapshot...
│   │   ├── protocol.ts    #   通信协议：ClientMessage/ServerMessage/encode/decode
│   │   └── rules.ts       #   规则引擎：走法/将军/将死/困毙/validateMove
│   ├── server/            # 服务端
│   │   ├── game.ts        #   对局状态机（主机权威）
│   │   ├── host-server.ts #   HTTP + WebSocket 主机服务、局域网 IP 发现
│   │   └── cli.ts         #   无界面主机端入口
│   ├── main/
│   │   └── main.ts        #   Electron 主进程入口
│   └── renderer/          # 渲染层（主机界面与加入者浏览器共用）
│       ├── app.ts         #   页面流转 / 交互 / 消息处理
│       ├── board.ts       #   棋盘 SVG 渲染与坐标换算
│       ├── net.ts         #   WebSocket 客户端 + 心跳
│       ├── index.html     #   页面结构（首页/等待/加入/对局/弹层）
│       └── styles.css     #   样式
├── tests/                 # vitest 测试（单元 + 集成 + 端到端）
├── scripts/
│   └── copy-assets.mjs    # 构建后复制 HTML/CSS 到 dist
├── docs/                  # 本文档中心（README + ADR + 产品/技术文档 + Demo）
├── dist/                  # tsc 编译产物（git 忽略）
├── package.json           # 脚本：build / test / host / start
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

- 测试命令：`npm test`（vitest run，node 环境）。
- 覆盖范围：规则引擎单测、状态机单测、完整对局端到端回放、服务端连接/消息集成、局域网 IP 选择。

| 测试文件 | 覆盖 |
|---|---|
| [rules.test.ts](../tests/rules.test.ts) | 开局棋盘、各棋子走法、将军/照面、将死/困毙、validateMove |
| [game.test.ts](../tests/game.test.ts) | Game 状态机：走子、拒绝、认输、和棋、重开 |
| [fullgame.test.ts](../tests/fullgame.test.ts) | 完整一盘棋 WS 回放：双方棋盘一致、seq 单调、`game_over`「将死」、重开 |
| [server.test.ts](../tests/server.test.ts) | 连接/加入/开局/走子广播/拒绝/断线等集成行为 |
| [lan-ip.test.ts](../tests/lan-ip.test.ts) | pickLanIp 网段优先级与虚拟网卡跳过 |

验收标准见 [Product-plan.md 第 14 节](./Product-plan.md) 与 [ADR-0008](./adr/0008-testing-strategy.md)。

---

## 9. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 加入者连不上 | 确认同一局域网、防火墙放行端口、地址用主机页显示的那个（跳过虚拟网卡） |
| 端口被占用 | Electron 模式会自动回退随机端口；CLI 模式请换 `LANSCHESS_PORT` |
| 对方断线 | 页面弹「对手已离开」提示，程序不崩溃；可返回首页重新开局 |
| 页面提示"请通过主机端页面打开" | 直接从文件系统打开的页面无本地服务，需通过 `http://主机:端口/` 访问 |