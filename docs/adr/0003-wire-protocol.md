# ADR-0003：通信协议模块规格（shared/protocol.ts）

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：加入对局、开局、走子同步、认输/和棋/重开/离开、心跳
- 关联文档：[ADR-0004 对局状态机](./0004-game-state-machine.md)、[ADR-0005 主机服务](./0005-host-server.md)

---

## 1. 背景

主机与加入者之间需要一个**简单、可读、易调试**的通信格式。
MVP 不做房间系统与二进制优化，优先保证「创建、加入、走子、裁判、重开」这条主链路清晰可追踪。

## 2. 决策

- 传输：**JSON over WebSocket**，WebSocket 固定路径 `/ws`。
- 单条消息 = 一个 JSON 对象，必有 `type` 字段用于路由；其余字段随类型而定。
- 方向只有两种：`ClientMessage`（客户端→服务端）与 `ServerMessage`（服务端→客户端），联合类型穷举。
- 走子同步采用**全量快照**：`move_applied` 直接携带完整 `board`，不依赖增量补丁。
- `seq`（= `Game.moveSeq`）随每步走子**单调递增（+1）**，作为状态版本号随广播下发。
- 编解码：`encode()` 为 `JSON.stringify`；`decode()` 做基础结构校验（必须是含字符串 `type` 的对象），
  解析失败返回 `null`，由调用方回复 `error`。

## 3. 详细规格

### 3.1 客户端 → 服务端（ClientMessage）

| type | 字段 | 语义 | 服务端处理 |
|---|---|---|---|
| `join` | `role: 'host' \| 'guest'` | 加入对局并声明角色 | 分配阵营（host=r，guest=b），回 `welcome`；错误回 `error` |
| `move` | `from: [r,c]`、`to: [r,c]`、`seq?` | 走子意图 | 经 `Game.applyMove` 校验；广播 `move_applied` 或单播 `move_rejected` |
| `resign` | — | 认输 | 状态置 over，广播 `game_over`（reason=`认输`） |
| `draw_request` | — | 发起和棋 | 记录发起方，转发 `draw_request` 给对手 |
| `draw_response` | `accept: boolean` | 回应和棋 | 同意→结算`同意和棋`并广播；拒绝→通知发起方 |
| `restart_request` | — | 发起重开 | 仅在对局结束后有效；转发 `restart_request` 给对手 |
| `restart_response` | `accept: boolean` | 回应重开 | 同意→`startGame()` 广播 `start`；拒绝→通知发起方 |
| `leave` | — | 离开对局 | 直接关闭连接，走断线清理逻辑 |
| `ping` | `t: number` | 心跳 | 回 `pong { t }` |

### 3.2 服务端 → 客户端（ServerMessage）

| type | 关键字段 | 语义 |
|---|---|---|
| `welcome` | `side`、`hostIp`、`port`、`state` | 加入成功，返回分配阵营与当前快照 |
| `start` | `state` | 对局开始（双方到齐），客户端进入对局页 |
| `move_applied` | `seq`、`from`、`to`、`board`、`turn`、`check`、`status`、`winner`、`reason`、`lastMove` | 走子成功广播（全量棋盘） |
| `move_rejected` | `from`、`to`、`reason` | 走子被拒绝（单播给发起方） |
| `state` | `state: GameSnapshot` | 全量状态同步（加入后/重开/重连场景） |
| `draw_request` / `draw_response` | `accept?` | 和棋请求与结果 |
| `restart_request` / `restart_response` | `accept?` | 重开请求与结果 |
| `game_over` | `winner`、`reason`、`state` | 终局广播（将死/困毙/认输/同意和棋） |
| `opponent_joined` | — | 通知主机：对手已加入 |
| `opponent_left` | `reason` | 对手离开/断线（`主机已离开` / `对手已离开`） |
| `error` | `message` | 协议或状态错误（如未加入就发 move、对局已满） |
| `pong` | `t` | 心跳回应 |

### 3.3 关键字段约束

- `Pos = [row, col]`：`row ∈ 0..9`，`col ∈ 0..8`；服务端对非数组坐标回 `move_rejected`（`坐标非法`）。
- `GameSnapshot` 字段：`board`、`turn`、`moveSeq`、`status`、`winner`、`reason`、`lastMove`、`check`。
- `status ∈ {idle, waiting, playing, over}`；`winner ∈ {'r','b',null}`。
- `seq` 与 `moveSeq` 同源，每次成功走子 +1；未成功（被拒绝）不递增。

### 3.4 典型消息流

```text
【创建 + 加入 + 开局】
host  ── join(host) ──►            ◄── welcome(side=r, state=waiting...)
guest ── join(guest) ─►            ◄── welcome(side=b)
host  ◄── opponent_joined ──
双方  ◄── start(state) ────          （Game.reset('playing')）

【一步走子】
client ── move{from,to} ─►  applyMove 校验
  合法：双方 ◄── move_applied{seq, board, ...}   终局时追加 game_over
  非法：发起方 ◄── move_rejected{reason}

【和棋】
A ── draw_request ─►  B ◄── draw_request
B ── draw_response{accept:true} ─►  双方 ◄── draw_response + game_over(同意和棋)

【重开】
A ── restart_request ─►  B ◄── restart_request
B ── restart_response{accept:true} ─►  双方 ◄── restart_response + start(state)
```

### 3.5 错误与容错

- `decode` 失败 → 服务端回 `error: 无法解析的消息`（[host-server.ts](../../src/server/host-server.ts#L236-L244)）。
- 未 `join` 就发送 `move` → `error: 尚未加入对局`。
- guest 在主机未创建对局时加入 → `error: 主机尚未创建对局`；重复占用角色 → `error: 主机端已存在` / `对局已满，无法加入`。
- 未知消息类型 → `error: 未知消息类型`。

### 3.6 明确不做

房间号/密码、断线重连、消息压缩、二进制协议、版本协商、消息鉴权。协议扩展时新增 `type` 即可，
不破坏现有字段语义。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| ClientMessage / ServerMessage 联合类型 | [protocol.ts](../../src/shared/protocol.ts#L12-L73) |
| encode / decode | [protocol.ts](../../src/shared/protocol.ts#L75-L88) |
| 消息路由实现 | [host-server.ts `handleMessage()`](../../src/server/host-server.ts#L250-L342) |
| 客户端消息分发 | [app.ts `handleMessage()`](../../src/renderer/app.ts#L173-L245) |
| 客户端发送封装 | [net.ts `send()`](../../src/renderer/net.ts#L105-L107) |

## 5. 验收标准

- [server.test.ts](../../tests/server.test.ts) 覆盖：未创建对局时 guest 被拒、创建后双方加入自动开局、走子广播、
  非法走子被拒、认输/和棋/重开/离开、断线通知。
- [fullgame.test.ts](../../tests/fullgame.test.ts) 验证 `seq` 全程单调递增 +1，且双方收到的 `board` 与主机权威一致。
- 任何非法/异常输入都不会导致主机进程崩溃（统一走 `error` 回复）。