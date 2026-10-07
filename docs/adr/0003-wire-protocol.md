# ADR-0003：通信协议模块规格（shared/protocol.ts）

- 状态：**协议已更新** —— 消息类型与字段约束以下文为准的部分仍然有效；
  `join` / `welcome` / `leave` 已被 [ADR-0010 §3.5](./0010-room-server.md) 改为
  `create_room` / `join_room` / `leave_room` / `room_joined` 等（2026-10-07）
- 日期：2026-10-03
- 关联入口：加入对局、开局、走子同步、认输/和棋/重开/离开、断线重连宽限、心跳
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
- C/D 档扩展（观战 `spectator`、悔棋 `undo_request/undo_response`、`move_applied.history/deadline`、
  `pong.ip/port`、`join.role` 三态）详见 [ADR-0009](./0009-c-d-extensions.md)。

## 3. 详细规格

### 3.1 客户端 → 服务端（ClientMessage）

| type | 字段 | 语义 | 服务端处理 |
|---|---|---|---|
| `join` | `role: 'host' \| 'guest' \| 'spectator'` | 加入对局并声明角色；宽限期内同阵营重新 join 即恢复原对局 | 分配阵营（默认 host=r、guest=b，可被先手方式改写），回 `welcome`（携带当前快照与先手方式）；错误回 `error` |
| `choose_first` | `mode: 'r' \| 'b' \| 'random' \| 'guess'` | 主机在等待页选择先手（红方）方式 | 仅主机、非 `playing` 时有效；记录方式并在双方到齐后确定席位（`random` 随机、`guess` 进入猜先） |
| `grasp` | `choice: 'odd' \| 'even'` | 主机「抓子」（猜先第一步）：抓单 / 抓双作为隐藏结果 | 仅主机且处于抓子阶段有效；记录隐藏结果并通知双方猜先（`guess_request`） |
| `guess` | `choice: 'odd' \| 'even'` | 客方猜先应答（猜单 / 猜双） | 仅客方且已完成抓子时有效；猜中者执红，广播 `first_result` 并开局 |
| `move` | `from: [r,c]`、`to: [r,c]` | 走子意图（坐标必须是整数对，否则回 `坐标非法`） | 经 `Game.applyMove` 校验；广播 `move_applied` 或单播 `move_rejected` |
| `resign` | — | 认输 | 状态置 over，广播 `game_over`（reason=`认输`） |
| `draw_request` | — | 发起和棋 | 记录发起方，转发 `draw_request` 给对手 |
| `draw_response` | `accept: boolean` | 回应和棋 | 同意→结算`同意和棋`并广播；拒绝→通知发起方 |
| `restart_request` | — | 发起重开 | 仅在对局结束后有效；转发 `restart_request` 给对手 |
| `restart_response` | `accept: boolean` | 回应重开 | 同意→`startGame()` 广播 `start`；拒绝→通知发起方 |
| `wait_new_opponent` | — | 主机放弃等待断线对手 | 取消宽限、清空客席位并重置为 waiting，回 `state` + `opponent_left` |
| `leave` | — | 主动离开对局 | 关闭连接；不走宽限期，立即按「离开」清理 |
| `ping` | `t: number` | 心跳 | 回 `pong { t }` |

### 3.2 服务端 → 客户端（ServerMessage）

| type | 关键字段 | 语义 |
|---|---|---|
| `welcome` | `side`、`hostIp`、`port`、`state`、`firstMode` | 加入成功，返回分配阵营与当前快照（宽限期内重连时 `state.status='playing'`）；`firstMode` 为当前先手方式 |
| `start` | `state`、`side` | 对局开始（双方到齐）：逐连接下发，`side` 为本连接最终阵营（观战者为 null） |
| `grasp_request` | — | 猜先第一步：请主机抓单 / 抓双（仅主机可见） |
| `guess_request` | — | 猜先第二步：主机已抓子，请客方猜单双（主机用它更新等待提示） |
| `first_result` | `mode`、`hostSide`、`guess` | 席位与先手结果（`random` / `guess` 确定席位后广播）；`guess` 含客方选择、实际结果与是否猜中 |
| `move_applied` | `seq`、`from`、`to`、`board`、`turn`、`check`、`status`、`winner`、`reason`、`lastMove` | 走子成功广播（全量棋盘） |
| `move_rejected` | `from`、`to`、`reason` | 走子被拒绝（单播给发起方） |
| `state` | `state: GameSnapshot` | 全量状态同步：断线重连恢复、宽限结束/放弃等待回到 waiting 等 |
| `draw_request` / `draw_response` | `accept?` | 和棋请求与结果 |
| `restart_request` / `restart_response` | `accept?` | 重开请求与结果 |
| `game_over` | `winner`、`reason`、`state` | 终局广播（将死/困毙/认输/同意和棋） |
| `opponent_joined` | — | 通知主机：对手已加入 / 已重连 |
| `opponent_away` | `reason`、`graceMs` | 对手意外断线，进入宽限期等待重连（主机侧弹层提示） |
| `opponent_left` | `reason` | 对手离开/宽限超时（`主机已离开` / `对手已离开` / `已放弃等待对方重连`） |
| `error` | `message` | 协议或状态错误（如未加入就发 move、对局已满） |
| `pong` | `t` | 心跳回应 |

### 3.3 关键字段约束

- `Pos = [row, col]`：`row ∈ 0..9`，`col ∈ 0..8`；非整数对回 `move_rejected`（`坐标非法`），整数越界由规则引擎回 `越界`。
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

【席位与先手（v1.5：红 / 黑 / 随机 / 猜先）】
host ── choose_first{mode} ─►   记录方式（等待阶段可改；对局中拒绝）
双方到齐后按方式确定席位：
  · r / b      → 直接 `first_result{mode, hostSide}` + 逐连接 start(state, side)
  · random     → 服务端随机 hostSide，同上
  · guess      → 主机 ◄── grasp_request（主机自己抓单 / 抓双）
                 host ── grasp{choice} ─►
                 双方 ◄── guess_request（客方弹层猜单双）
                 guest ── guess{choice} ─►
                 双方 ◄── first_result{mode:'guess', hostSide, guess{choice,actual,guestWon}} + start
                 （猜中者执红；客方重连时会补发 guess_request，不重复请主机抓子）

【意外断线 → 宽限期内重连（以 guest 为例，host 同理）】
guest 断连（非 leave） ─►  对局保持 playing，host ◄── opponent_away{graceMs}
  ├─ 宽限内 guest 重新 join ─► guest ◄── welcome(state=playing)
  │                            host  ◄── opponent_joined + state（双方以快照对齐）
  └─ 宽限超时 / host ── wait_new_opponent ─►  Game.reset(waiting)
                              host ◄── state(waiting) + opponent_left{reason}
```

### 3.5 错误与容错

- `decode` 失败 → 服务端回 `error: 无法解析的消息`（[host-server.ts](../../src/server/host-server.ts#L243-L258)）。
- 未 `join` 就发送 `move` → `error: 尚未加入对局`。
- guest 在主机未创建对局时加入 → `error: 主机尚未创建对局`；重复占用角色 → `error: 主机端已存在` / `对局已满，无法加入`。
- 未知消息类型 → `error: 未知消息类型`。

### 3.6 明确不做

房间号/密码、断线自动重连（宽限期内需手动重新加入；不做客户端自动重试）、消息压缩、
二进制协议、版本协商、消息鉴权。协议扩展时新增 `type` 即可，不破坏现有字段语义。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| ClientMessage / ServerMessage 联合类型 | [protocol.ts](../../src/shared/protocol.ts#L12-L77) |
| 坐标校验 `isValidPos` | [protocol.ts](../../src/shared/protocol.ts#L94-L97) |
| encode / decode | [protocol.ts](../../src/shared/protocol.ts#L79-L92) |
| 消息路由实现 | [host-server.ts `handleMessage()`](../../src/server/host-server.ts#L260-L365) |
| 客户端消息分发 | [app.ts `handleMessage()`](../../src/renderer/app.ts#L178-L281) |
| 客户端发送封装 | [net.ts `send()`](../../src/renderer/net.ts#L105-L107) |

## 5. 验收标准

- [server.test.ts](../../tests/server.test.ts) 覆盖：未创建对局时 guest 被拒、创建后双方加入自动开局、走子广播、
  非法走子被拒、非整数坐标被拒、认输/和棋/重开/离开、断线宽限与重连恢复、宽限超时、主机放弃等待。
- [fullgame.test.ts](../../tests/fullgame.test.ts) 验证 `seq` 全程单调递增 +1，且双方收到的 `board` 与主机权威一致。
- 任何非法/异常输入都不会导致主机进程崩溃（统一走 `error` 回复）。