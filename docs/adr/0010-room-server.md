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
| `GET /api/history` | 变更 | 全局对局记录；支持可选 `?roomId=` / `?user=` 过滤（后者即客户端的「我的历史」）；**所有 `/api/*` 响应带 CORS 头并放行 `OPTIONS` 预检（v2.3，见 §11.1）** |
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
| 权威状态机（复用） | [game.ts](../../src/shared/game.ts) |
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

## 9. v2.1 增量（2026-10-07 完成）

v2.0 落地后暴露的五个使用问题与修正（不改变「服务器权威 / 房间隔离 / 纯托管」的核心决策）：

### 9.1 客户端不再于启动时绑定服务器

| 问题 | 现状（v2.0） | v2.1 修正 |
|---|---|---|
| 启动即绑定地址 | 浏览器用 `location.host`；Electron 由 `LANSCHESS_SERVER` 探测后**直接加载该服务器的页面**，连不上只能开便携服务 | 新增**「连接服务器」板块**，成为客户端首屏：自动搜索局域网内可连接的服务器 + 手动输入 `主机:端口`，「连接」后加入列表；**已连接绿色 / 连接失败红色 / 未连接灰色** |
| Electron 无页面可加载 | 必须先连上一台服务器才能拿到页面 | Electron 进程内起一个**本机外壳服务**（仅 `127.0.0.1`、随机端口、`dataDir: null`，只提供页面与静态资源）承载页面，再把 `<host:port>` 交给渲染层去连；**切服务器无需重启客户端** |
| 找不到局域网地址 | — | 入口通过 URL 参数把信息交给渲染层：`client=electron`（桌面客户端标记）、`server=<host:port>`（优先尝试的服务器）、`lan=<ip>`（本机局域网地址，用于推导要扫描的网段） |

浏览器打开页面时「连接服务器」板块**锁定**：地址恒等于访问地址（输入框与按钮禁用、条目显示绿色并提示已锁定），
因为浏览器能拿到的页面本身就来自该服务器。判定依据只有 URL 参数 `client=electron`（不做 UA 猜测，避免 Electron 内核浏览器误判）。

搜索沿用 [§3.9](#39-服务器发现) 的 `probeServer()` / `discoverSubnet()`，但由「点结果即整页跳转」改为
「在板块内连接 WebSocket 并切换目标」；同一台服务器的「输入地址」与「自述地址」不同时按自述地址合并为一行。

### 9.2 账号入口移到主页右上角

「加入房间」页里的用户名 / 密码表单移到**首页右上角账号按钮**：未登录显示「登录 / 注册」，
点击打开面板登录 / 注册 / 退出登录；登录后按钮直接显示用户名。

### 9.3 「加入房间」改为房间列表

「加入房间」页以**房间列表**为主（连接服务器后才拉取，未连接时给出「去连接服务器」引导）：
- 点击列表内的房间：**未设口令直接加入**；设了口令则显示「口令（房间已上锁）」输入框，填好后点「加入房间」
- 每行独立的「观战」按钮：**无需口令**即可只读旁观
- 保留手填房间号 + 加入 / 观战的入口

### 9.4 房间内邀请在线玩家

| 项 | 规格 |
|---|---|
| 在线识别 | 连接建立即签发身份（账号或游客），使**大厅中**的玩家也可被点名邀请 |
| 协议 | C→S `list_players`、`invite_player{playerId, role}`；S→C `player_list{players}`、`invite{from, roomId, role, locked}` |
| 权限 | 房内任意在线成员（含观战）均可邀请；不可邀请自己、已离线者、已在房间中者 |
| 容量 | 邀请为对局需有空席位；邀请为观战需观战席未满（满员房间仍可邀观战） |
| 口令豁免 | 邀请成功时房间记录该 `playerId`；其 `join_room` 命中即**免口令**（加入后消费掉，避免长期豁免） |
| 入口 | 等待页与对局页的「邀请在线玩家」→ 弹层列出在线玩家 → 「邀请加入对局」/「邀请观战」；被邀请者收到弹层，接受即入房 |

### 9.5 人机对弈改为客户端本地运行

`game.ts`（状态机）与 `ai.ts`（negamax + α-β）从 `src/server/` 上移到 **`src/shared/`**，
两者本就只依赖 `shared/rules`，因此客户端可在**未连接任何服务器**时本地跑完整规则与 AI
（首页「人机对弈」→ 选难度 →「开始对弈」，AI 执黑）。服务器 `create_room{mode:'ai'}` 的 AI 房间协议保留（测试仍覆盖），
但界面不再依赖它。随之，`review.ts` 的记录接口基址改为**显式取当前所选服务器**（桌面客户端的页面来自本机外壳服务）。

### 9.6 交付与验证

| 项 | 内容 |
|---|---|
| 新增 | `src/renderer/servers.ts`（地址解析 / 网段推导 / 客户端形态判定）、`tests/servers.test.ts` |
| 移动 | `src/server/game.ts` → `src/shared/game.ts`、`src/server/ai.ts` → `src/shared/ai.ts` |
| 改造 | `main.ts`（本机外壳服务 + URL 参数）、`app.ts`（服务器板块 / 房间列表 / 邀请 / 本地人机）、`index.html`、`styles.css`、`review.ts`、`server.ts`（在线玩家 + 邀请 + 口令豁免）、`room.ts`（邀请集合 + 容量判定） |
| 测试 | `npm test` 209 项、`lint` / `format:check` / `build` 全绿；另用真实浏览器核对：锁定态、账号面板、房间列表与「观战」、邀请弹层与接受、本地人机对弈，控制台无报错 |
| 顺带修复 | `[hidden]{display:none!important}`（原被 `.menu_info label` 覆盖导致隐藏不彻底）；整行按钮宽度限制为 `.menu_info > .btn`（原后代选择器会把房间行内「加入/观战」撑成整行而溢出被裁剪） |

## 10. v2.2 增量（2026-10-07 完成）

v2.1 实际使用中暴露的五个问题与修正（不改变「服务器权威 / 房间隔离 / 纯托管」的核心决策）：

### 10.1 点击板块后的界面改为「大面板」（不再与木框对齐）

| 问题 | 现状（v2.1） | v2.2 修正 |
|---|---|---|
| 窄面板拥挤 | 创建 / 人机 / 账号 / 连接服务器 / 等待 / 加入 全部塞进 280×237 的木质内框（v1.6 的「面板与木框对齐」原则），列表类内容拥挤、依赖面板内滚动 | 改用**大面板 `.panel-lg`**：与「对局回顾」`.review_box` 同款（宽 620、`max-height: calc(100vh - 48px)`、可滚动、同一套木纹底），滚动与布局都交给面板自己；**首页木质挂板（含「中国象棋」标题）仅作为入口保留，点开板块后隐藏** |
| 首页底部小字 | 页脚 `服务器 192.168.1.42:7777 · 已登录：xxx` | **删除**：去掉 `#home-hint` 与 `renderHomeHint()`；服务器 / 账号信息仍在右上角两个 chip 上 |

### 10.2 「邀请玩家」改为玩家列表

| 项 | 规格 |
|---|---|
| 入口 | 等待页按钮「邀请玩家」；对局页按钮在**开局后自动变为「邀请观战」**（`inviteRole()`：`playing` / `over` → 邀请观战，否则邀请加入对局） |
| 数据 | `list_players` 返回**在线连接 + 已注册但离线的账号**（[protocol.ts `OnlinePlayer.online`](../../src/shared/protocol.ts)；离线账号由 [accounts.ts `usernames()`](../../src/server/accounts.ts) 提供，`roomId: null`） |
| 展示 | 宽版弹层（`.modal.wide`，520px）+ 左对齐列表：在线且在大厅的玩家**排在最前**并带「邀请」按钮；在其它房间（对局中）与离线玩家**置灰**且不显示按钮 |
| 过滤 | 自己、本房间内的玩家、`kind === 'ai'` 不出现在列表里 |
| 服务端 | 离线玩家邀请返回 `该玩家不在线`；房间满 / 观战席满沿用 §9.4 的判定 |

### 10.3 取先方式改为下拉框（默认猜先）

等待页的四个先手按钮改为 `<select id="first-mode">`：猜先（`FIRST_MODE_DEFAULT`，默认）/ 随机黑红 / 房主执红 / 房主执黑；
建房成功后客户端立即发一次 `choose_first` 把下拉框当前选择同步给服务器（房主随后改选即发变更）。

### 10.4 猜先：先进棋盘，再猜单双

双方到齐后不再停留在等待页：加入者收到 `room_joined`（`firstMode === 'guess'`）、房主收到 `opponent_joined` / `grasp_request` 时都会先 `enterGame()`
把界面切到棋盘，抓子（房主）与猜单双（加入者）的弹层盖在棋盘上；对局界面状态栏显示猜先进度
（请抓单或抓双 / 等待对手猜单双… / 等待房主抓子…），`first_result` / `start` 后清空。

### 10.5 人机对局不计入对局回顾

[room.ts `saveRecord()`](../../src/server/room.ts) 在 `currentRecord.ai === true`（服务器 AI 房间）时跳过落库；
客户端本地人机对弈只在本机状态机内运行，本就无记录。

### 10.6 交付与验证

| 项 | 内容 |
|---|---|
| 客户端 | `index.html`（大面板结构 + `#modal-body` + 取先下拉框 + 删除页脚）、`styles.css`（`.panel-lg`、玩家列表、宽版弹层；删除 `.menu_info` 体系与 `.home-hint`）、`app.ts`（`showHomePanel()` / 猜先进入棋盘 / 邀请玩家列表 / 删除页脚小字） |
| 服务端 | [room.ts](../../src/server/room.ts)（AI 不落库）、[server.ts `playerList()`](../../src/server/server.ts)、[accounts.ts](../../src/server/accounts.ts)、[protocol.ts](../../src/shared/protocol.ts) |
| 测试 | `server.test.ts` 新增「人机对局终局不计入对局回顾」「list_players 含离线账号且不可邀请」；`ui-home-layout.test.ts` 契约改为「大面板 + 邀请列表 + 下拉框 + 无页脚小字」；`npm test` 217 项、`lint` / `format:check` / `build` 全绿 |
| 浏览器实测 | 浏览器三会话实测（127.0.0.1 房主 / localhost 加入者 / 局域网地址 大厅玩家）：创建房间（大面板、挂板已隐藏）→ 等待页取先下拉框默认「猜先」→ 加入者点击房间行后**双方直接进入棋盘**（房主弹「抓单 / 抓双」、加入者状态栏「猜先：等待房主抓子…」）→ 抓单 / 猜单 → 双方开局（加入者执红「轮到你走棋」）→ 对局页按钮变「邀请观战」，列表标题「邀请观战」（在线在前带「邀请」、离线账号与「对局中」置灰无按钮、本房间内玩家与自己不出现）；等待阶段列表标题为「邀请加入对局」、无观战入口 |

## 11. v2.3 增量（2026-10-08 完成）

### 11.1 修复：桌面客户端「对局回顾」一直 Failed to fetch

| 项 | 内容 |
|---|---|
| 现象 | Electron 客户端打开「对局回顾」始终显示 `Failed to fetch`（浏览器直连服务器的页面一切正常） |
| 原因 | 客户端页面由**本机外壳服务**（`127.0.0.1:<随机端口>`）提供，而对局回顾走 REST（`/api/history`、`/api/history/:id`、`/api/ai/hint`）访问**真实服务器**（另一端口 / 另一 IP）→ 属跨源请求；服务器此前只在响应中带 `Content-Type` / `Cache-Control`，**没有任何 CORS 头**，浏览器直接拦截响应体。服务器搜索不受影响，是因为 `probeServer()` 走 WebSocket（`ping`/`pong`），WS 不受同源策略约束 |
| 修复 | [server.ts](../../src/server/server.ts)：`sendJson()` 对所有 `/api/*` 响应统一附加 `Access-Control-Allow-Origin: *`（+ `Allow-Methods` / `Allow-Headers`），并对 `OPTIONS` 预检直接回 `204`；客户端 [review.ts](../../src/renderer/review.ts) 在 `fetch` 抛错时给出可读提示「无法连接服务器 <地址>，请确认「连接服务器」中已连接」 |
| 取舍 | 采用 `*`（而非白名单回显来源）：外壳服务端口随机、且客户端允许「页面来自 A 服务器、连接 B 服务器」，白名单无法覆盖；与本项目「局域网内网互信、不做消息鉴权」（§3.11）一致 |
| 测试 | `server.test.ts` 新增「API 带跨源响应头，OPTIONS 预检直接放行」（断言 `access-control-allow-origin` / `-methods` / `-headers`） |

### 11.2 新增：对局回顾的「我的历史」

| 项 | 规格 |
|---|---|
| 切换入口 | 对局回顾页顶部新增「全部对局 / 我的历史」页签（[review.ts](../../src/renderer/review.ts) `setScope()` / `renderScopeTabs()`），右侧显示当前身份（如「身份：账号 ljh32768」「身份：游客89788011」） |
| 接口 | `GET /api/history?user=<玩家 id>`：按 `red.id === user \|\| black.id === user` 过滤（与既有 `?roomId=` 并存）；[review.ts `historyUrl()`](../../src/renderer/review.ts) 负责拼装并做 URL 编码 |
| 身份来源 | 已登录 → `account:<用户名>`（跨设备稳定）；游客 → 本机最近一次入座身份（`localStorage: lanschess-player`，[app.ts `storePlayer()`](../../src/renderer/app.ts) 在每次入座时写入）；未识别 → 列表区给出「登录后可按账号查看 / 游客需先加入过一局」的提示 |
| 范围 | 记录接口基址仍是**当前所选服务器**（`apiBase()`），因此「我的历史」= 当前服务器上属于我的对局 |
| 空态 | 已识别身份但无记录 → 「当前服务器没有你的对局记录」 |

### 11.3 交付与验证

| 项 | 内容 |
|---|---|
| 客户端 | `review.ts`（页签 / `historyUrl()` / 跨源错误提示）、`app.ts`（`lanschess-player` 身份持久化与注入）、`index.html` + `styles.css`（页签与身份说明样式） |
| 服务端 | `server.ts`（CORS 头 / OPTIONS / `?user=` 过滤） |
| 测试 | `npm test` 223 项（新增 CORS+OPTIONS、`?user=` 过滤、`historyUrl`、回顾页签 UI 契约）、`lint` / `format:check` / `build` 全绿 |
| 浏览器实测 | 复刻桌面客户端形态（页面来自 `127.0.0.1:7789` 外壳服务，连接真实服务器 `192.168.18.50:7788`）：对局回顾正常列出记录（不再 Failed to fetch）→「我的历史」显示「身份：游客89788011」并列出该局 → 把本地身份改成未知游客后显示「当前服务器没有你的对局记录」（过滤生效）→ 注册登录后身份变为「账号 mine_test」；另以浏览器直连页面（同源）复核「全部对局 / 我的历史」均正确 |

## 12. v2.10 增量（2026-10-16 完成）

### 12.1 邀请列表改为常驻侧栏（去掉「邀请玩家」按钮与弹层）

| 项 | 规格 |
|---|---|
| 动机 | 原设计需要先点「邀请玩家 / 邀请观战」按钮才弹出玩家列表，多一次点击；列表本身信息量小，适合常驻展示 |
| 等待页 | 改为**两栏 `.wait-layout`**：左栏为房间号 / 口令状态 / 取先方式等等待信息，右栏为常驻的**邀请列表面板**（`.panel-lg`，标题「邀请玩家」+「刷新」按钮）。原来的整行「邀请玩家」按钮与 `<input id="btn-invite">` 一并删除 |
| 对局页 | 棋盘侧栏 `.panel` 内新增 `.panel-box`（标题「邀请玩家 / 邀请观战」+「刷新」+ 列表），取代原 `<input id="btn-invite">`；窄栏下列表 `max-height: 208px` 可滚动，不挤占棋盘 |
| 数据 | 沿用 §9.4 / §10.2 协议：`list_players` / `player_list`；进入房间（`enterGame` / `showWaiting`）时拉取一次，等待页与对局页每 **5s 自动刷新**，并保留手动「刷新」 |
| 展示 | 与 §10.2 一致：在线且在大厅者排在最前并带「邀请」按钮；在别处对局中 / 离线者置灰且不显示按钮；自己、本房间内玩家、`kind === 'ai'` 不出现 |
| 角色 | `inviteRole()` 不变：等待阶段为「邀请玩家」，开局后转为「邀请观战」（标题与提示文案随之切换） |
| 头像（v3.17） | 列表每行在状态点前加 **26px 头像**（`.p-item-avatar`）；收到的「房间邀请」弹层加 **44px 邀请者头像 + 名字**（`.invite-who`）。头像仍不上传服务器：`app.ts playerAvatar()` 对账号按本机 `lanschess-avatar:<用户名>` 取自定义头像，其他玩家 / 游客回退默认 `symbol.png`（详见 [ADR-0007 §3.5.8](./0007-renderer-ui.md)） |
| 弹层 | 不再有手动「邀请玩家」弹层（**收到的「房间邀请」确认弹层仍保留，v3.17 起带头像**）；`.modal.wide`（520px）与 `#modal-body` 保留给残局「自检题库」结果等其他富内容弹层 |

### 12.2 交付与验证

| 项 | 内容 |
|---|---|
| 客户端 | `index.html`（等待页 `.wait-layout` 两栏 + 对局侧栏邀请面板；删除 `btn-invite` / `btn-invite-host`）、`styles.css`（`.wait-layout` / `.invite-head` / `.panel-box .player-list`）、`app.ts`（`renderInvitePanel()` / `refreshInviteList()` / `playerRow()` / `renderPlayerList()` 改为渲染两处容器，删除 `openInvite()` 弹层入口） |
| 服务端 | 无改动（协议与权限沿用 §9.4、§10.2） |
| 测试 | `ui-home-layout.test.ts` 契约改为「邀请列表常驻等待页右栏 / 对局侧栏（不再有邀请按钮与弹层）」；`npm test` 340 项、`lint` / `format:check` / `build` 全绿 |
| 浏览器实测 | 单会话：创建房间 → 等待页为左右两栏（左：房间号 / 取先方式；右：「邀请玩家」+ 刷新 + 空态文案），左侧不再有「邀请玩家」按钮，控制台无报错；双会话（`127.0.0.1` 房主 / `localhost` 加入者）进入对局：棋盘右侧面板内嵌「邀请玩家」方框（标题 + 刷新 + 列表），窄栏文字完整可读、无裁剪 / 溢出，底部无独立邀请按钮 |

## 13. v3.15 增量：登录首屏与账号入口（2026-11-07 完成）

| 项 | 规格 |
|---|---|
| 动机 | 取消游客模式：账号用于保存对局记录与跨设备恢复席位，未登录不应直接进入首页；同时启动不再先打开「连接服务器」界面 |
| 首屏 | `index.html` 新增 `screen-login`（登录 / 注册）；`app.ts init()` 依据本机 `lanschess-token` + `lanschess-user` 决定：有 token → 首页（后台 `connectQuietly()` 连服务器并 `tryResumeSession()`），无 token → `showLoginScreen()` |
| 登录 / 注册 | 走既有 WebSocket `login` / `register`（服务器 `AccountStore` 的规则不变：用户名 3–16 位字母 / 数字 / 下划线、密码 ≥4 位）；客户端在首屏先做同样的格式校验（密码 4–20 位、注册确认密码），服务器错误（重名 / 密码错误）显示在 `#login-status` |
| 服务器 | 登录页在后台静默连接当前服务器（浏览器 = 访问地址且锁定；桌面客户端 = 启动参数 / 默认 `127.0.0.1:7777`），失败时提示并可点「连接服务器」进入 `screen-servers` 手动选择；连接页「进入游戏」未登录时回登录页 |
| 账号归属 | 登录成功沿用 `auth_ok` 的 token 落盘（`lanschess-token` / `lanschess-user`）；建房 / 加入 / 续局仍携带 `token`，对局记录按 `account:<用户名>` 归属；退出登录清除 token 并回到登录首屏 |
| 头像 | 头像为**本机偏好**（`lanschess-avatar:<用户名>`，data URL ≤2 MB），不进入服务端账号记录；未设置时统一使用 `symbol.png`；主页入口、用户页、对局侧栏展示 |
| 兼容 | 服务端仍保留游客身份签发能力（协议与既有集成测试不变），仅客户端 UI 不再提供游客入口 |
| 验证 | [tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts) 覆盖首屏 / 用户页 / 头像 / 图标 / 放大契约；`npm test` 509 项通过 |

