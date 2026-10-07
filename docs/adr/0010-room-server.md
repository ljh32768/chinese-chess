# ADR-0010：局域网中心服务器与多房间架构（从主机权威迁移）

- 状态：已接受（2026-10-07 评审确认，实施中）
- 日期：2026-10-07
- 关联入口：创建/加入房间、房间口令、房间列表、席位与先手方式、走子同步、断线重连、最简账号系统、对局回顾、服务器发现、进程入口
- 关联文档：[ADR-0001 总体架构](./0001-host-authoritative-architecture.md)、[ADR-0003 通信协议](./0003-wire-protocol.md)、[ADR-0004 状态机](./0004-game-state-machine.md)、[ADR-0005 主机服务](./0005-host-server.md)、[ADR-0006 进程入口](./0006-process-entries.md)、[ADR-0009 C/D 档扩展](./0009-c-d-extensions.md)

---

## 1. 背景

现状是**主机权威 + P2P 星型**：创建对局的一方在自己的进程里跑 `HostServer`，
进程内同时持有 HTTP 静态服务、WebSocket、唯一权威 `Game`，并且**本机页面就是这个进程的主人（`role='host'`）**。
[ADR-0001 §2.6](./0001-host-authoritative-architecture.md) 明确写着「无房间系统：连接本身就是对局，底层不存在 `roomId`」，
[ADR-0005 §3.4](./0005-host-server.md) 用 `hostConn` / `guestConn` 双席位模型实现「对局即连接」。

这套模型在「两个人临时下盘棋」上很优雅，但存在三个结构性限制：

1. **公平性**：权威规则引擎运行在其中一方玩家的机器上，该玩家理论上可以修改客户端/进程来作弊。
2. **可用性**：对局依赖某个玩家机器常亮；该玩家关窗口，对局与记录一起消失。
3. **扩展性**：`hosting` / `hostConn` / `guestConn` / `records` 全是**进程级单例**，同一时刻只能服务一盘棋，
   无法并发多盘、无法集中战绩、无法统一提供 AI。

目标：改为**局域网中心服务器**——服务器是一个独立的、纯托管的常驻进程，玩家全部作为客户端接入，
支持**多房间并发**。

## 2. 决策

1. **引入「房间」这一层**：服务器 = 大厅 + 多房间。新增 `Room` 实体承载「一局」的全部状态，
   服务器用 `Map<roomId, Room>` 管理并发对局。**这是对 ADR-0001 §2.6「无房间系统」的显式修订。**
2. **服务器纯托管**：服务器进程不占任何玩家席位，不参与对局；只提供静态资源、房间管理、权威裁判、
   AI 与记录。玩家一律通过浏览器 / Electron 客户端接入。
3. **角色语义降级**：`host` 从「服务器 + 玩家」降级为**房间创建者（房主）**，只保留控权语义
   （选择先手方式 / 抓子 / 放弃等待重连）；席位改用 `seat: 'r' | 'b'` 表达。
4. **身份与连接解耦**：服务器签发 `playerId`，客户端持久化保存；重连时凭 `playerId` 恢复原席位，
   不再依赖「同 `role` 重新 `join`」。
5. **复用而非重写**：`Game`、`rules`、`notation`、`ai`、`protocol` 编解码、`renderer/board` 与大部分
   `renderer/app` 保持不动；改动集中在 `host-server.ts`（拆成 `Server` + `Room`）、`protocol.ts`、`app.ts`。
6. **对局记录集中并落盘**：`records` 从「进程内存、最多 50 局、重启清空」升级为服务器级持久化历史。
7. **房间口令可选**：建房时可选择是否设置口令；**未设置口令的房间点击即可加入**，设置了口令的需输入正确口令。
8. **终局房间自动销毁**：对局结束（`over`）后启动销毁倒计时，期间双方未达成「再来一局」则销毁房间并释放房间号。
9. **最简账号系统**：用户名 + 密码注册 / 登录，服务器签发 token；**账号可选**，未登录以游客身份游玩，
   登录后对局记录归属账号、并支持凭账号跨设备重连原席位。
10. **客户端双通道**：浏览器与 Electron 均可接入；**Electron 默认「连接服务器」**（不再默认自建服务）。

评审确认（2026-10-07）：

| 议题 | 结论 |
|---|---|
| Electron 默认行为 | 默认「连接服务器」；无可用服务器时给出提示，保留「本机开服」便携模式作为兜底 |
| AI 陪练房间 | 保留（`mode='ai'`，服务器提供 AI 黑席；AI 不是玩家，不违反「纯托管」） |
| 房间口令 | 可选：不设置则点击即入；设置后需口令 |
| 终局房间 | 对局结束后无人再来一局则销毁 |
| 账号系统 | 做最简版本（用户名 + 密码 + token，可选使用） |

## 3. 详细规格

### 3.1 进程与部署形态

| 形态 | 启动方式 | 说明 |
|---|---|---|
| 中心服务器（推荐） | `npm run serve`（新增） | 常驻 Node 进程，无界面；部署在局域网内一台常开设备（NAS / 小主机）。端口默认 `7777` |
| 玩家客户端（浏览器） | 打开 `http://<服务器IP>:7777/` | 纯客户端 |
| 玩家客户端（Electron） | `npm start` | Electron **默认连接服务器**（`LANSCHESS_SERVER` 指定，缺省 `127.0.0.1:7777`）；连不上时提示，并提供「本机开服」便携兜底 |
| 便携模式（兜底） | Electron 勾选 / 参数开启「本机开服」 | 进程内起 server 并连接 `127.0.0.1`，等价于现状的单机开服，便于无独立服务器时使用 |

监听地址仍为 `0.0.0.0`，WebSocket 路径仍为 `/ws`；端口策略沿用 `LANSCHESS_PORT` 与
[listenWithFallback()](../../src/server/host-server.ts#L1062-L1072)（Electron 便携模式回退随机端口）。

### 3.2 分层与模块职责

```text
shared/（协议 / 规则 / 类型，无环境依赖） —— 基本不动
   ▲
   │
server/
 ├─ Server        监听、静态服务、HTTP 路由、WS 连接路由（连接 → 房间）
 ├─ RoomManager   Map<roomId, Room> 的注册表、房间号分配、空闲回收
 └─ Room         单局：席位、先手、猜先、宽限、读秒、AI、记录（复用 Game / rules / ai）
   ▲
   │
main / server-main（进程入口：Electron 客户端 / 常驻服务器）
```

| 模块 | 职责 | 依赖 |
|---|---|---|
| `Server` | HTTP 静态 + API、`WebSocketServer`、连接路由到房间、服务器信息 | `RoomManager`、`Room` |
| `RoomManager` | 建房 / 房间号分配去重 / 加入 / 离开 / 空闲回收 / 并发上限 | `Room` |
| `Room` | 一局的全部运行时状态与行为（席位、先手、猜先、宽限、读秒、AI、终局落库） | `Game`、`rules`、`ai`、`log` |
| `Game` | 权威棋盘状态机 | `rules` |

### 3.3 房间模型与生命周期

| 项 | 规格 |
|---|---|
| 房间号 | `roomId`：6 位数字字符串（易口头传达），由 `RoomManager` 分配并保证在存活房间内唯一 |
| 口令 | `Room.password: string \| null`；`null` 表示**点击即可加入**，否则 `join_room` 必须带正确口令，否则 `error: 房间口令错误` |
| 席位 | `Room.seats`：房主席 `a`（创建者）与对手席 `b`；`Member = { conn, player, seat, graceTimer }`，AI 模式 `b.conn = null` |
| 房主 | `Room.ownerId`：创建者的 `playerId`，仅用于控权（`choose_first` / `grasp` / `wait_new_opponent`） |
| 观战 | `Room.spectators: Set<Conn>`，不占席位、只读、可随时加入，上限 `maxSpectators`（默认 20） |
| 状态 | 沿用 `GameStatus`：`idle → waiting → playing → over`；`Room.closed` 为独立标志 |
| 建房 | `create_room` → 建房者入座房主席，房间进入 `waiting`（AI 模式立即开局） |
| 满员 | 两席位皆占时，第三个 `join_room(role='player')` 回 `error: 房间已满`；观战不受限 |
| 口令错误 | 房间有口令且 `password` 不匹配 → `error: 房间口令错误`（不泄露其它房间信息） |
| **终局销毁** | 对局进入 `over` 后启动 `overTtlMs`（默认 5 分钟）倒计时；期间双方达成「再来一局」则取消并重开，超时则销毁房间广播 `room_closed` |
| 空闲回收 | 房间内无任何在线连接超过 `roomIdleMs`（默认 60s）→ 销毁房间并释放 `roomId` |
| 解散 | 房主在未开局时主动离开 → 销毁房间，通知房内其余连接 `room_closed` |
| 并发上限 | `maxRooms`（默认 50）；超限时 `create_room` 回 `error: 房间数已达上限` |
| 人机房间 | `create_room { mode: 'ai', depth }`：AI 占虚拟黑席，不需要第二真人；沿用 [ADR-0009 §3.7](./0009-c-d-extensions.md) |

房间关闭（回收 / 解散 / 服务器停止）统一广播 `room_closed { reason }`，
客户端返回首页并清理本房间的 `playerId`。

### 3.4 身份与重连

| 项 | 规格 |
|---|---|
| 签发 | `create_room` / `join_room` 成功后，服务器在响应中携带 `playerId` |
| 两种身份 | 已登录：`playerId = 'account:<用户名>'`（跨设备稳定）；游客：`playerId = 'guest:<随机>'`（当前设备会话内稳定） |
| 存储 | 客户端存 `localStorage`：账号 token 单独保存；游客 `playerId` 按 `roomId` 保存（`lanchess:player:<roomId>`） |
| 重连 | `join_room { roomId, playerId }`：`playerId` 命中房间内某席位 → 恢复该席位与原局（等价现状宽限期重连）；未命中 → 按新玩家分配空席位 |
| 宽限 | 由现状的 `hostGraceTimer` / `guestGraceTimer` 改为**按席位**计时（`Member.graceTimer`），`graceMs` 默认 30000 不变 |
| 超时 | 宽限超时：该席位置空；`playing` 且一方席位为空 → 房间回到 `waiting`；房主席位超时且未开局 → 销毁房间 |
| 观战者 | 不签发 `playerId`，断线即移除，不触发宽限 |

> **已知限制**：同一浏览器内多个标签共享 `localStorage`，因此第二个标签会带上同一 `playerId` 被服务器判定为「房主重连」。
> 同一台机器上模拟两名玩家需使用不同来源（如 `127.0.0.1` 与 `localhost`）或不同浏览器；跨设备真实联机不受影响。

### 3.5 通信协议

**新增（Client → Server）**

| type | 字段 | 语义 |
|---|---|---|
| `register` | `username`、`password` | 注册账号（用户名唯一，密码 ≥4 位） |
| `login` | `username`、`password` | 登录，换取 token |
| `create_room` | `mode?: 'pvp' \| 'ai'`、`depth?: 1..4`、`password?: string \| null` | 创建房间；`ai` 模式立即配 AI 黑席 |
| `join_room` | `roomId`、`role: 'player' \| 'spectator'`、`playerId?`、`password?` | 加入房间；带 `playerId` 则尝试恢复席位 |
| `leave_room` | — | 离开房间（主动，不走宽限） |
| `list_rooms` | — | 请求房间列表 |
| `set_password` | `password: string \| null` | 房主在等待阶段设置 / 取消口令（null 或空串表示点击即可加入） |

**新增（Server → Client）**

| type | 关键字段 | 语义 |
|---|---|---|
| `auth_ok` | `token`、`username` | 注册 / 登录成功 |
| `room_joined` | `roomId`、`seat`（观战为 null）、`playerId`、`name`、`ownerId`、`locked`、`state`、`firstMode`、`serverIp`、`port` | 建房 / 加入成功（同时取代 `welcome` 与 `room_created`） |
| `room_list` | `rooms: RoomSummary[]` | 房间列表（含人数、状态、是否上锁、模式） |
| `room_closed` | `reason` | 房间被销毁（终局超时 / 空闲回收 / 房主解散 / 服务器停止） |

**变更**

| 项 | 变化 |
|---|---|
| `join` | **移除**，由 `create_room` / `join_room` 取代（`Role` 简化为 `role: 'player' \| 'spectator'`） |
| `welcome` | **移除**，并入 `room_joined`；`hostIp` → 服务器地址 `serverIp` |
| `leave` | **移除**，由 `leave_room` 取代 |
| `choose_first` / `grasp` | 权限判定由 `role === 'host'` 改为 `playerId === room.ownerId` |
| `pong` | `ip` / `port` 语义由「主机自述地址」改为「服务器地址」 |
| 对局消息 | `start` / `move_applied` / `state` **不**重复携带 `roomId`：连接本身已属于某个房间，`roomId` 由 `room_joined` 提供 |

**复用不变**：`move`、`resign`、`draw_request` / `draw_response`、`restart_request` / `restart_response`、
`undo_request` / `undo_response`、`wait_new_opponent`、`guess`、`first_result`、`grasp_request`、
`guess_request`、`opponent_joined` / `opponent_away` / `opponent_left`、`move_rejected`、`error`、`ping`。

协议扩展遵循 [ADR-0003 §3.6](./0003-wire-protocol.md) 的约定：新增 `type` / 可选字段，不破坏既有字段语义。

### 3.6 HTTP 接口

| 方法+路径 | 变化 | 说明 |
|---|---|---|
| `GET /api/server-info` | 取代 `/api/host-info` | `{ ip, port, version, rooms, maxRooms }`；同时作为「这是本游戏服务器」的探测标记 |
| `GET /api/rooms` | 新增 | 房间列表（与 `list_rooms` 同源） |
| `POST /api/auth/register` | 新增 | `{ username, password }` → `{ token, username }`（REST 便捷入口，与 WS `register` 同源） |
| `POST /api/auth/login` | 新增 | `{ username, password }` → `{ token, username }` |
| `GET /api/history` | 变更 | 全局对局记录；支持可选 `?roomId=` / `?user=` 过滤 |
| `GET /api/history/:id` | 不变 | 单局明细 |
| `GET /api/ai/hint` | 不变 | 按记录 + 步数复原局面求推荐着法 |
| `POST /api/host/start` | 移除 | 由 WS `create_room` 取代 |
| `POST /api/host/start-ai` | 移除 | 由 `create_room { mode: 'ai' }` 取代 |
| `POST /api/host/stop` | 移除 | 由 `leave_room` / `room_closed` 取代 |
| 静态服务 | 不变 | 仍以 `dist/` 为根，路径穿越防护与 MIME 白名单不变 |

### 3.7 状态归属对照（现状 → 目标）

| 现状（`HostServer` 单例字段） | 目标归属 | 说明 |
|---|---|---|
| `hostConn` / `guestConn` | `Room.seats.r` / `Room.seats.b` | 席位不再绑定角色名 |
| `hosting` | `RoomManager` 注册表 + `Room.status` | 不再有进程级「等待托管」概念 |
| `firstMode` / `hostSide` | `Room.firstMode` / `Room.ownerSide` | 更名（服务器架构下无「主机」） |
| `guessStage` / `pendingGuess` / `lastGuess` | `Room.*` | 平移 |
| `currentRecord` | `Room.currentRecord` | 平移 |
| `records` / `recordSeq` / `maxRecords` | `Server.history`（全局、持久化） | 记录跨房间集中 |
| `hostGraceTimer` / `guestGraceTimer` | `Room.seats.{r,b}.graceTimer` | 改为按席位 |
| `turnTimer` / `aiTimer` | `Room.*` | 平移 |
| `spectators` | `Room.spectators` | 按房间 |
| `game` | `Room.game` | 每房间一个权威 `Game` |
| `connOf(side)` / `sendTo` / `broadcast` / `sendToSeats` / `sendToOpponent` | `Room` 内同名方法 | 逻辑平移，范围由「进程」变为「房间」 |
| `pickLanIp` / `getLanIp` | `Server` 级保留 | 用于展示服务器地址 |
| `serveStatic` / `isInsideRoot` | `Server` 级保留 | 不变 |
| `startAiGame` / `scheduleAiMove` | `Room`（仅 `mode='ai'`） | 平移 |

### 3.8 持久化

| 项 | 规格 |
|---|---|
| 内容 | 对局记录（`GameRecord[]`，含 `moves`），跨房间统一 |
| 形式 | 先落地为 `data/history.json`（零额外依赖）；后续可平滑替换为 SQLite |
| 策略 | 终局写入后异步落盘（防抖合并写）；启动时读取；文件损坏时降级为空并告警，不阻塞启动 |
| 容量 | 保留最近 `maxRecords`（默认 200，较现状 50 提高） |
| 不做 | 房间运行时状态持久化（服务器重启不恢复进行中的对局，见 §3.10） |

### 3.9 服务器发现

现状 [discover.ts](../../src/renderer/discover.ts) 是「扫网段 + WS `ping` 探测找**主机**」。
中心服务器架构下改为找**服务器**：

| 方式 | 规格 |
|---|---|
| 网段扫描（浏览器可用） | 探测 `GET /api/server-info`（或 WS `ping` 回 `pong` 携带 `serverIp`），命中即判定为本游戏服务器；复用现有并发扫描与去重逻辑 |
| mDNS 公告（Node 侧，可选） | 服务端注册 `_lanchess._tcp`，Electron 客户端可直接发现，免扫网段 |
| 固定地址 | 最简路径：客户端记住上次服务器地址（`localStorage`），默认 `127.0.0.1:7777` |

### 3.10 最简账号系统（可选使用）

| 项 | 规格 |
|---|---|
| 定位 | **可选**：不登录也能玩（游客身份）；登录后对局记录归属账号、并支持跨设备恢复席位 |
| 注册 | `username`（3–16 位，字母/数字/下划线，唯一）+ `password`（≥4 位）→ 服务器生成 `salt` 与 `scrypt` 哈希存储 |
| 登录 | 校验哈希 → 签发 `token`（随机 32 字节 hex），写入该用户的记录中（随 users 文件持久化，服务器重启仍有效） |
| 身份 | token → `username` → `PlayerRef { id: 'account:<username>', name: username, kind: 'account' }` |
| 游客 | 未带 token 的玩家由服务器分配 `guest:<随机>`，展示名为「游客xxxx」 |
| 记录归属 | `GameRecord.red/black` 由 `'host' / 'guest'` 改为 `PlayerRef`（含 `id` / `name` / `kind`） |
| 入口 | 客户端「加入房间」面板内含登录 / 注册表单；也可走 `POST /api/auth/*` |
| 落盘 | `data/users.json`：`{ [username]: { username, salt, hash, token, createdAt } }` |
| 明确不做 | 邮箱验证、找回密码、OAuth、多设备会话管理、token 过期与吊销、角色权限 |

### 3.11 明确不做

公网联机、跨网段穿透、HTTPS/WSS、消息鉴权中间件、服务器重启后恢复进行中的对局、
观战回放的历史缓冲、消息压缩与二进制协议、账号的邮箱验证 / 找回密码 / OAuth。

## 4. 迁移计划

分四阶段渐进推进，**每一阶段结束时 `npm test` / `npm run lint` / `npm run format:check` / `npm run build` 必须全绿**，
并各自产生一个 Git 提交（遵循 [AGENTS.md](../../AGENTS.md)）。

### 阶段 1：抽取 `Room`（行为完全不变）

| 项 | 内容 |
|---|---|
| 目标 | 把 `HostServer` 里的单局状态与逻辑下沉到 `Room`，`HostServer` 暂时只持有 1 个 `Room` |
| 落点 | 新增 `src/server/room.ts`；改造 [host-server.ts](../../src/server/host-server.ts) 为委托 |
| 不改 | 协议、HTTP 接口、渲染层、Electron/CLI 入口 |
| 测试 | 现有 [server.test.ts](../../tests/server.test.ts) / [fullgame.test.ts](../../tests/fullgame.test.ts) **一行不改即应通过**（这是本阶段的核心验收信号） |
| 验收 | 双人局域网对局手工验证与现状一致 |
| 提交 | `refactor(server): 抽取 Room 承载单局状态与逻辑` |

### 阶段 2：多房间与房间号

| 项 | 内容 |
|---|---|
| 目标 | `Server` 持有 `Map<roomId, Room>`，支持并发多盘与房间号加入 |
| 落点 | 新增 `RoomManager`；[protocol.ts](../../src/shared/protocol.ts) 新增 `create_room` / `join_room` / `leave_room` / `list_rooms` / `room_created` / `room_joined` / `room_list` / `room_closed`；[host-server.ts](../../src/server/host-server.ts) 连接路由；[app.ts](../../src/renderer/app.ts) 房间 UI；[net.ts](../../src/renderer/net.ts) `join_room` |
| 测试 | 新增 `tests/room.test.ts`；[server.test.ts](../../tests/server.test.ts) 增加「两房间并发、状态隔离、满员拒绝、房间列表、空闲回收」用例 |
| 验收 | 两个浏览器各开一个房间同时下棋，走子/快照/终局互不串；第三方可观战 |
| 提交 | `feat(server): 多房间并发与房间号加入` |

### 阶段 3：部署分离（纯托管）

| 项 | 内容 |
|---|---|
| 目标 | 服务器独立常驻；Electron 默认降为客户端 |
| 落点 | 新增 `src/server/server-main.ts` 与 `npm run serve`；改造 [main.ts](../../src/main/main.ts)（默认连服务器，`LANSCHESS_SERVER` 指定，保留「本机开服」便携模式）；[cli.ts](../../src/server/cli.ts) 迁到新的服务器入口 |
| 测试 | 服务器入口单测；双机（服务器 + 客户端）手工验证；便携模式回归 |
| 验收 | 服务器机器不开浏览器也能被两个客户端正常对局；Electron 不再是「谁开谁当局主」 |
| 提交 | `feat(entry): 独立服务端入口与纯客户端 Electron` |

### 阶段 4：持久化与发现

| 项 | 内容 |
|---|---|
| 目标 | 记录落盘；客户端能发现服务器 |
| 落点 | 新增 `src/server/history.ts`（落盘 + 读取 + 防抖写）；改造 [discover.ts](../../src/renderer/discover.ts) 为 `probeServer()`；可选 mDNS 公告 |
| 测试 | 历史落盘与重启读取、损坏文件降级、`probeServer` 探测与去重 |
| 验收 | 重启服务器后 `/api/history` 记录仍在；客户端扫描可列出局域网服务器 |
| 提交 | `feat(server): 对局记录持久化与服务器发现` |

### 文档同步（贯穿）

- 新增本 ADR-0010，并在 [adr/README.md](./README.md) 索引登记。
- **显式修订 ADR-0001 §2.6**：标注「无房间系统」被 ADR-0010 取代。
- 更新 [ADR-0003](./0003-wire-protocol.md)（协议新增与 `join` 移除）、[ADR-0005](./0005-host-server.md)（服务 → 房间拆分）、
  [ADR-0006](./0006-process-entries.md)（新增常驻服务器入口）、[ADR-0008](./0008-testing-strategy.md)（房间维度用例）。
- 更新 [docs/README.md](../README.md)：总体架构图、模块总览、功能入口表、快速开始与目录结构。

## 5. 代码入口（目标）

| 内容 | 位置 |
|---|---|
| 服务器（监听 / 静态 / HTTP / WS 路由 / 房间表） | `src/server/server.ts`（现 [host-server.ts](../../src/server/host-server.ts) 改造） |
| 单局房间（席位 / 先手 / 宽限 / 读秒 / AI / 记录） | `src/server/room.ts` |
| 连接对象 | `src/server/conn.ts` |
| 账号系统 | `src/server/accounts.ts` |
| 对局历史持久化 | `src/server/history.ts` |
| 权威状态机（复用） | [game.ts](../../src/server/game.ts) |
| 协议 | [protocol.ts](../../src/shared/protocol.ts) |
| 常驻服务器入口 | `src/server/server-main.ts`（`npm run serve`） |
| Electron 客户端入口 | [main.ts](../../src/main/main.ts) |
| 房间 UI / 网络客户端 | [app.ts](../../src/renderer/app.ts)、[net.ts](../../src/renderer/net.ts)、[index.html](../../src/renderer/index.html) |
| 服务器发现 | [discover.ts](../../src/renderer/discover.ts) |

## 6. 验收标准

- **房间隔离**：两个房间同时进行对局，任一房间的走子 / `seq` / 快照 / 终局不影响另一房间（`room.test.ts` + `server.test.ts`）。
- **房间生命周期**：满员拒绝、观战不受限、口令错误被拒（无口令房间点击即入）、终局超时销毁并广播 `room_closed`、空闲回收、房主离开解散。
- **身份重连**：带 `playerId` 的 `join_room` 能恢复原席位与原局；账号 token 跨设备稳定；无 `playerId` 的第三名玩家被判定为满员拒绝或观战。
- **账号系统**：注册 / 登录成功签发 token；重复用户名被拒；密码错误被拒；用户与 token 落盘并在重启后仍可登录。
- **权威与公平**：`shared/` 仍可在 node 环境直接导入测试；客户端无法绕过 `validateMove`（`move_rejected` 路径不变）。
- **持久化**：服务器重启后 `/api/history` 仍返回历史记录；`data/history.json` 损坏时不阻塞启动。
- **工程**：`npm test`、`npm run lint`、`npm run format:check`、`npm run build` 全绿。
- **部署**：`npm run serve` 可在无界面机器上常驻；两个客户端（浏览器 / Electron）可同时接入并完整下完一盘棋。

## 7. 评审结论（2026-10-07）

三项待确认议题均已拍板，结论见 [§2 评审确认](#2-决策)：

| 议题 | 结论 |
|---|---|
| Electron 默认行为 | **默认「连接服务器」**，保留「本机开服」便携兜底 |
| AI 陪练房间 | **保留**（`mode='ai'`） |
| 房间口令 | **可选**：不设置则点击即入 |
| 终局房间 | **无人「再来一局」即销毁**（`overTtlMs` 倒计时） |
| 账号系统 | **做最简版本**（用户名 + 密码 + token，可选使用） |

## 8. 实施记录（2026-10-07 完成）

四阶段在同一次实施中落地（阶段 1「抽取 Room」与阶段 2「多房间」合并为一次重构，测试同步更新）：

| 阶段 | 内容 | 落点 |
|---|---|---|
| 1+2 | 共享层与协议改造；`HostServer` 拆分为 `GameServer` + `Room`；多房间、房间号、口令、终局销毁、空闲回收、按席位宽限 | `shared/types.ts`、`shared/protocol.ts`、`server/server.ts`、`server/room.ts`、`server/conn.ts` |
| 2 | 最简账号系统与对局记录持久化 | `server/accounts.ts`、`server/history.ts`（落盘 `data/users.json`、`data/history.json`） |
| 3 | 常驻服务器入口；Electron 默认「连接服务器」并保留便携兜底 | `server/server-main.ts`、`main/main.ts`、`package.json`、`scripts/dev.mjs` |
| 3+4 | 客户端房间 / 账号 UI 与会话自动重连；服务器发现改为探测服务器 | `renderer/app.ts`、`renderer/index.html`、`renderer/styles.css`、`renderer/net.ts`、`renderer/discover.ts` |
| 4 | 文档同步（本 ADR + 0001/0003/0005/0006/0008 + README + 索引） | `docs/` |

验证：`npm test`（196 项）／`npm run lint`／`npm run format:check`／`npm run build` 全绿；
另用真实浏览器完成「创建房间 → 对手加入 → 开局」的双人端到端验证，两标签页控制台无报错。
