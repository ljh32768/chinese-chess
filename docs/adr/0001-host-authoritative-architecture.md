# ADR-0001：主机权威 + WebSocket + 纯 TS 规则引擎的总体架构

- 状态：**部分被取代** —— 权威边界与分层原则仍有效；「主机即服务器 / 无房间系统」已被
  [ADR-0010 局域网中心服务器与多房间架构](./0010-room-server.md) 取代（2026-10-07）
- 日期：2026-10-03
- 关联文档：[Technical-solution.md](../Technical-solution.md)、[Product-plan.md](../Product-plan.md)、[docs/README.md](../README.md)、[ADR-0010](./0010-room-server.md)

---

## 1. 背景

MVP 目标是「局域网内两台设备连上后，能完整、正确地下一盘棋」。
需要在不引入账号、匹配服务器、房间系统的前提下，保证：

- 棋盘状态只有一份真实来源，双方显示一致；
- 非法走子必须被拒绝，裁判规则（将军/将死/困毙）判定唯一且可信；
- 客户端可以被篡改而不影响对局公平性；
- 规则逻辑可单元测试，不依赖浏览器环境。

## 2. 决策

采用 **主机权威（Host Authoritative）+ JSON over WebSocket + 纯 TS 规则引擎** 架构：

1. **主机即服务器**：创建对局的一方启动 `HostServer`，进程内持有唯一权威 `Game`。
2. **加入者只发意图**：客户端发送 `move` 意图，主机用 `validateMove` 校验后才应用并广播。
3. **每步广播完整快照**：数据量小（9×10 棋盘），稳定优先，不做增量同步。
4. **规则引擎纯函数化**：`shared/` 层不依赖 DOM / 网络 / Node API，服务端与浏览器共用。
5. **单一页面复用**：Electron 主机窗口与加入者浏览器加载同一个 `renderer/index.html`，
   仅以 `role`（host / guest）与 `side`（红 / 黑）区分行为。
6. **无房间系统**：连接本身就是对局；底层不存在 `roomId`（与产品文档 4.6 一致）。
   > 该条已被 [ADR-0010](./0010-room-server.md) 取代：服务器引入房间层，`roomId` 成为一等概念；
   > 权威边界（唯一真实棋盘在服务器进程内）保持不变。

## 3. 详细规格

### 3.1 分层与依赖方向

```text
        ┌───────────────────────┐
        │ shared/ （无环境依赖）  │
        │  types / protocol / rules │
        └───────▲───────▲───────┘
                │       │
     ┌──────────┴──┐ ┌──┴────────────┐
     │ server/     │ │ renderer/     │
     │ game        │ │ app/board/net │
     │ host-server │ │ (浏览器)      │
     └──────▲──────┘ └───────────────┘
            │
   ┌────────┴────────┐
   │ main / cli 入口  │  （装配 server，打开页面）
   └─────────────────┘
```

| 模块 | 运行位置 | 依赖 | 明确不依赖 |
|---|---|---|---|
| `shared/` | 服务端 + 浏览器 | 仅标准 TS | DOM、网络、Node API |
| `server/` | Node / Electron 主进程 | `shared/`、`ws`、Node 标准库 | DOM |
| `renderer/` | 浏览器 / Electron 渲染进程 | `shared/`、DOM、`WebSocket` | Node API |
| `main/`、`cli.ts` | 进程入口 | `server/`、Electron | 规则逻辑 |

依赖必须单向：`renderer → shared`、`server → shared`、`main/cli → server`，禁止反向或跨层引用。

### 3.2 进程与部署形态

| 形态 | 启动方式 | 主机服务所在 | 页面所在 |
|---|---|---|---|
| Electron 桌面 | `npm start` | 主进程 `ensureServer()` | `BrowserWindow` 加载 `http://127.0.0.1:<port>/` |
| Node CLI | `npm run build && npm run host` | CLI 进程 | 任意浏览器访问 `http://<lan-ip>:<port>/` |

- 端口默认 `7777`（`LANSCHESS_PORT` 可覆盖）；Electron 模式端口被占用时回退随机端口（`port: 0`）。
- 监听地址默认 `0.0.0.0`，WebSocket 固定路径 `/ws`。

### 3.3 权威边界

| 数据 / 行为 | 权威方 | 客户端行为 |
|---|---|---|
| 棋盘、回合、`moveSeq`、胜负 | 主机 `Game` | 仅渲染主机广播的快照 |
| 走子合法性 | 主机 `validateMove` | 本地 `legalMoves` 只用于落点提示 |
| 将军 / 将死 / 困毙 | 主机 `judgeAfterMove` | 展示 `check` / `game_over` |
| 认输 / 和棋 / 重开 | 主机状态机 | 仅发送请求消息 |

### 3.4 MVP 范围外（架构上不提供）

账号、公网联机、匹配服务器、多房间/大厅、观战、回放、AI、自动发现、断线重连、
悔棋、计时、长将/长捉/重复局面等复杂裁判规则。加回这些能力时不改变本架构的权威边界。

## 4. 代码入口

| 内容 | 入口 |
|---|---|
| 共享数据结构 | [types.ts](../../src/shared/types.ts) |
| 共享规则引擎 | [rules.ts](../../src/shared/rules.ts) |
| 通信协议 | [protocol.ts](../../src/shared/protocol.ts) |
| 权威状态机 | [game.ts](../../src/server/game.ts#L14-L107) |
| 主机服务 | [host-server.ts](../../src/server/host-server.ts#L79-L431) |
| Electron 入口 | [main.ts](../../src/main/main.ts) |
| CLI 入口 | [cli.ts](../../src/server/cli.ts) |
| 渲染层 | [app.ts](../../src/renderer/app.ts)、[board.ts](../../src/renderer/board.ts)、[net.ts](../../src/renderer/net.ts) |

## 5. 验收标准

- 主机唯一棋盘状态与双方渲染一致（由 [fullgame.test.ts](../../tests/fullgame.test.ts) 逐步断言）。
- 非法走子仅主机可判定拒绝，客户端无法绕过（`move_rejected` 路径）。
- `shared/` 模块可被 vitest 在 node 环境下直接导入测试，无需 DOM 模拟。
- 加入者刷新/重开页面使用同一份 `renderer` 代码，不出现主机专有逻辑泄漏。