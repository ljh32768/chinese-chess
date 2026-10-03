# ADR-0005：主机服务模块规格（server/host-server.ts）

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：创建对局、显示本机地址、加入对局、WebSocket 消息路由、断线重连宽限与断线清理
- 关联文档：[ADR-0003 通信协议](./0003-wire-protocol.md)、[ADR-0004 状态机](./0004-game-state-machine.md)

---

## 1. 背景

主机端需要在一个进程内同时提供三件事：

1. 给加入者/主机分发同一份前端页面（HTTP 静态资源）；
2. 给页面提供「创建/停止/查询」的控制接口（HTTP API）；
3. 承载对局实时通信（WebSocket），并把消息路由到权威 `Game`。

此外必须解决「主机地址怎么给对手」——从多网卡中自动挑出最可能的局域网 IPv4。

## 2. 决策

- 一个 `http.Server` 同时承载静态资源、HTTP API 与 `WebSocketServer`（`ws`，路径 `/ws`），共用一个端口。
- 连接管理采用**双席位模型**：`hostConn`（红方）与 `guestConn`（黑方），各占一个 `Conn`；
  连接即身份，天然实现「对局即连接、无房间系统」。
- 局域网地址选择 `pickLanIp()`：物理网卡私有网段优先、虚拟网卡降权，供页面展示与加入预填。
- 静态服务以编译产物 `dist/` 为根，做路径穿越防护，未命中一律 404。

## 3. 详细规格

### 3.1 服务生命周期

| 方法 | 行为 |
|---|---|
| `listen(): Promise<number>` | 创建 HTTP 服务 + `WebSocketServer({server, path:'/ws'})`；`port:0` 表示随机端口；返回实际端口 |
| `close(): Promise<void>` | 关闭双方连接 → `wss.close` → `http.close` |
| `setHosting(on)` | `true`：`idle/over → waiting` 并尝试开局；`false`：`waiting → idle`（不影响进行中对局） |
| `address` | 返回 `{ ip: getLanIp(), port }` |
| `isHosting()` | 是否处于等待加入状态 |

默认配置：`port=7777`（`LANSCHESS_PORT` 环境变量可覆盖）、`host='0.0.0.0'`、静态根为 `dist/`、
断线宽限 `graceMs=30000`（`HostServerOptions` 可覆盖，测试用小值）、
计时读秒 `turnMs=0`（`LANSCHESS_TURN_MS` 可开启）、AI `aiDelayMs=400` / `aiDepth=2`。

> C/D 档新增能力（观战席位、人机对战、计时读秒、日志打点、主机自我声明地址）详见 [ADR-0009](./0009-c-d-extensions.md)。

### 3.2 HTTP 接口

| 方法+路径 | 请求 | 响应 | 说明 |
|---|---|---|---|
| `GET /api/host-info` | — | `{ ip, port, hosting, hasHost, hasGuest, state }` | 页面初始化：展示本机地址、预填加入表单 |
| `POST /api/host/start` | — | `{ ip, port }` | 创建对局（进入 waiting） |
| `POST /api/host/start-ai` | — | `{ ip, port }` | 创建人机对战（AI 占黑方席位，立即开局） |
| `POST /api/host/stop` | — | `{ ok: true }` | 取消等待（同时结束人机对战） |
| `GET /api/*`（其他） | — | 404 `{ error: 'not found' }` | 未定义接口 |
| `GET 其他路径` | — | 静态文件 | `/` → `renderer/index.html`；其余按 `dist/` 解析，未命中回退 `dist/renderer/` |

静态服务安全规则（[serveStatic](../../src/server/host-server.ts#L208-L240)）：
解析后的绝对路径必须位于静态根内（`path.relative` 判断，不得以 `..` 开头），否则按 404 处理；
`startsWith(root)` 会把 `dist-evil` 类同前缀兄弟目录误判放行，已弃用。所有响应带 `Cache-Control: no-store`。
MIME 白名单覆盖 html/js/mjs/css/json/map/svg/ico/png。

### 3.3 局域网 IP 选择 `pickLanIp(ifaces)`

| 规则 | 分值 |
|---|---|
| `192.168.*` | +40 |
| `10.*` | +30 |
| `172.16~31.*` | +20 |
| 其他 IPv4 | +10 |
| 网卡名命中虚拟特征（vEthernet/WSL/Hyper-V/VirtualBox/VMware/Docker/Loopback/Tailscale/ZeroTier/VPN/TAP/TUN） | −100 |

- 跳过 `internal` 与 IPv6；`family` 兼容 Node 18+ 的数字 `4`。
- 无候选返回 `null`；`getLanIp()` 最终回退 `127.0.0.1`。

### 3.4 连接生命周期与席位约束

| 事件 | 条件 | 服务端行为 |
|---|---|---|
| `join(host)` | 席位空闲 | 绑定 `hostConn`，`side='r'`，回 `welcome`；宽限期内重连则保留 `playing` 并广播 `state`；若 guest 已在场通知 `opponent_joined` |
| `join(host)` | 席位已占（不同连接） | `error: 主机端已存在` |
| `join(guest)` | `hosting=false` | `error: 主机尚未创建对局` |
| `join(guest)` | 主机等待中且席位空闲 | 绑定 `guestConn`，`side='b'`，回 `welcome`，通知主机 `opponent_joined`；宽限期内重连则保留 `playing` 并广播 `state` |
| `join(guest)` | 席位已占 | `error: 对局已满，无法加入` |
| 双方到齐 | `hosting && hostConn && guestConn && status ∈ {idle, waiting}` | `startGame()`：`reset('playing')` + 广播 `start` |
| host 主动离开 | `leave` 或非 `playing` | 清空 `hostConn`，通知 guest `opponent_left('主机已离开')`，`hosting=false`；进行中对局置 `idle`，取消客方宽限计时 |
| host 意外断开 | `playing` 且非 `leave` | 保留对局与席位，启动宽限计时，通知 guest `opponent_away`；超时后 `hosting=false` + `reset('idle')` + `opponent_left('主机已离开')` |
| guest 主动离开 | `leave` 或非 `playing` | 清空 `guestConn`，通知 host `opponent_left('对手已离开')`；进行中对局回 `waiting`（hosting 时）或 `idle` |
| guest 意外断开 | `playing` 且非 `leave` | 保留对局与席位，启动宽限计时，通知 host `opponent_away`；超时（或 host 发 `wait_new_opponent`）后清空席位、`reset('waiting')`，回 `state` + `opponent_left` |

### 3.5 WebSocket 消息路由（`handleMessage`）

| 消息 | 处理 |
|---|---|
| `move` | 校验已加入 → 坐标整数校验（`isValidPos`）→ `Game.applyMove` → 合法广播 `move_applied`（终局追加 `game_over`）；非法单播 `move_rejected` |
| `resign` | `Game.resign` → 广播 `game_over` |
| `draw_request` / `draw_response` | 仅 `playing` 有效；发起方记录于 `pendingDraw`；同意 → `acceptDraw` + `game_over`；拒绝 → 清空并通知发起方 |
| `restart_request` / `restart_response` | 仅 `over` 有效（`canRestart`）；同意 → 广播 `restart_response` + `startGame()`；拒绝 → 通知发起方 |
| `wait_new_opponent` | 仅主机、且存在客方宽限计时时有效：取消宽限 + `dropGuestSeat`（重置 waiting + `state` + `opponent_left`） |
| `leave` | 标记 `conn.leaving` 后 `ws.close()`：按「主动离开」立即清理，不走宽限 |
| `ping` | 回 `pong { t }` |
| 其他 | `error: 未知消息类型` |

所有解析异常被捕获并回 `error`，服务进程不崩溃。

### 3.6 发送工具

| 方法 | 语义 |
|---|---|
| `send(ws, msg)` | 单连接发送（仅 `OPEN` 状态） |
| `sendTo(side, msg)` | 按阵营发送给对应席位 |
| `broadcast(msg)` | 同时发给红、黑双方 |

### 3.7 明确不做

HTTPS/WSS、鉴权、房间号、多房间、断线自动重连（服务端只做宽限保留，重连由客户端手动发起）、
连接数限流、消息持久化。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| MIME 表 / 虚拟网卡特征 | [host-server.ts](../../src/server/host-server.ts#L19-L32) |
| `pickLanIp` / `getLanIp` | [host-server.ts](../../src/server/host-server.ts#L38-L62) |
| `HostServer.listen()` / `close()` | [host-server.ts](../../src/server/host-server.ts#L106-L140) |
| `setHosting()` | [host-server.ts](../../src/server/host-server.ts#L149-L160) |
| HTTP 路由 `handleHttp()` | [host-server.ts](../../src/server/host-server.ts#L164-L195) |
| 静态服务 `serveStatic()` / `isInsideRoot()` | [host-server.ts](../../src/server/host-server.ts#L208-L240)、[host-server.ts](../../src/server/host-server.ts#L544-L548) |
| WS 连接/消息处理 | [host-server.ts](../../src/server/host-server.ts#L243-L365) |
| 加入/开局 `handleJoin` / `maybeStart` / `startGame` | [host-server.ts](../../src/server/host-server.ts#L367-L436) |
| 断线清理与宽限 `handleClose` / `startGuestGrace` / `dropGuestSeat` | [host-server.ts](../../src/server/host-server.ts#L438-L525) |

## 5. 验收标准

- [server.test.ts](../../tests/server.test.ts)：未创建对局时 guest 被拒；创建后双方加入自动开局；
  走子广播双方；非法走子被拒；认输/和棋/重开/离开消息流正确；断线宽限（`opponent_away`）、
  宽限内重连恢复、宽限超时回到 waiting、`wait_new_opponent` 放弃等待、主动 leave 立即清理。
- [lan-ip.test.ts](../../tests/lan-ip.test.ts)：无网卡返回 `null`；192.168 优先；跳过虚拟网卡；忽略 IPv6。
- 静态服务对路径穿越请求（含 `root-evil` 类同前缀兄弟目录）返回 404；`/` 正确返回页面。
- 任意非法消息不会导致服务崩溃。