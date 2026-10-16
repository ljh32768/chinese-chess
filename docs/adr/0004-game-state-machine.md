# ADR-0004：对局状态机模块规格（shared/game.ts）

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：开局、走子、认输、和棋、重开
- 关联文档：[ADR-0002 规则引擎](./0002-rules-engine.md)、[ADR-0005 主机服务](./0005-host-server.md)

---

## 1. 背景

主机进程需要一个**唯一权威**的对局对象：棋盘、回合、走子序号、胜负状态都只有这一份，
所有入口（WebSocket 消息、HTTP API、测试）都必须通过它读写，禁止绕过校验直接改棋盘。

## 2. 决策

- `Game` 类聚合全部权威状态；外部只能通过方法修改。
- 走子统一走 `applyMove(from, to, side)` 的**校验链**，任何一步失败都拒绝且不改动状态。
- 胜负原因只使用固定文案（`GameOverReason`）：`将死`、`困毙`、`认输`、`同意和棋`、`超时判负`，
  以及 v2.11 起的重复局面裁决结果 `长将判负` / `长捉判负` / `长打判负` / `重复局面判和`。
- 和棋/重开采用「请求-回应」两段式：由主机服务记录发起方（`pendingDraw` / `pendingRestart`），
  `Game` 只负责终局结算与重置，不处理网络转发。

## 3. 详细规格

### 3.1 状态字段

| 字段 | 类型 | 语义 |
|---|---|---|
| `board` | `Board` | 权威棋盘（10×9） |
| `turn` | `Side` | 当前行棋方，初始 `'r'` |
| `moveSeq` | `number` | 成功走子计数，每次 +1，作为广播 `seq` |
| `status` | `'idle' \| 'waiting' \| 'playing' \| 'over'` | 对局状态 |
| `winner` | `Side \| null` | 胜方；和棋为 `null` |
| `reason` | `string` | 结束原因文案 |
| `lastMove` | `Move \| null` | 上一步（用于界面高亮） |
| `check` | `boolean` | 当前行棋方是否被将军 |
| `pendingDraw` | `Side \| null` | 和棋请求发起方（服务层辅助字段） |
| `pendingRestart` | `Side \| null` | 重开请求发起方（服务层辅助字段） |
| `pendingUndo` | `Side \| null` | 悔棋请求发起方（服务层辅助字段） |
| `history` / `past` | `Move[]` / 局面快照栈 | 着法序列与走子前局面（棋谱 / 悔棋回放基础） |
| `posKeys` / `moveNatures` | `string[]` / `{ side, nature }[]` | 每个局面的键与每一手的性质（将 / 捉 / 闲），重复局面裁决基础；随 `undo` 一并回退 |
| `deadline` | `number \| null` | 本回合截止时间（计时读秒，由主机服务写入；null = 不限时） |

> `posKeys` / `moveNatures` 是 v2.11 新增的私有字段，见 §3.6。
> C/D 档扩展的 `undo()`、`timeout()`、history/deadline、人机对战与观战行为见 [ADR-0009](./0009-c-d-extensions.md)。

### 3.2 状态流转

```text
idle ── setHosting(true) ──► waiting ── 双方 join ──► playing ── 终局 ──► over
                                │                                          │
                                └── setHosting(false) ──► idle             └── 重开（同意）──► playing
```

| 事件 | 触发入口 | 结果 |
|---|---|---|
| 创建对局 | `HostServer.setHosting(true)` | `idle/over → waiting`（`reset('waiting')`） |
| 双方到齐 | `HostServer.maybeStart()` | `reset('playing')`，广播 `start` |
| 一步合法走子 | `applyMove` | 更新棋盘/回合/`lastMove`/`moveSeq`，重判将军与终局 |
| 一步非法走子 | `applyMove` | 返回 `{ ok:false, reason }`，状态零改动 |
| 认输 | `resign(side)` | `over`，winner=对方，reason=`认输` |
| 同意和棋 | `acceptDraw()` | `over`，winner=`null`，reason=`同意和棋` |
| 重开 | `HostServer` 收到同意 | `reset('playing')` |

### 3.3 `applyMove` 校验链（严格顺序）

| 顺序 | 检查 | 失败返回 |
|---|---|---|
| 1 | `status === 'playing'` | `对局未在进行中` |
| 2 | `side === turn` | `还没轮到你走棋` |
| 3 | `validateMove(board, from, to, side)` | 规则引擎给出的中文原因（见 ADR-0002 §3.5） |
| 4 | 记录走子前局面（`past`），执行 `makeMove`，追加 `history` / `posKeys` / `moveNatures`（本手性质：将 / 捉 / 闲），`lastMove` 更新，`moveSeq += 1`，`turn` 切换 | — |
| 5 | `check = isInCheck(新 turn)`；`judgeAfterMove(新 turn)` | 终局则 `over` + `winner` + `reason`，并清空 `pendingDraw` / `pendingRestart` / `pendingUndo` |
| 6 | `judgeRepetition(posKeys, moveNatures)`（同一局面第 3 次出现，见 §3.6） | 终局则同上；否则对局继续 |

注意：第 4 步之后必然成功；失败均发生在第 1~3 步，因此**被拒绝的走子不会改变任何状态**（含 `moveSeq`）。

### 3.4 终局判定组合

| 情形 | winner | reason | 判定来源 |
|---|---|---|---|
| 对方被将死 | 走子方 | `将死` | `judgeAfterMove` |
| 对方被困毙 | 走子方 | `困毙` | `judgeAfterMove` |
| 一方长将 / 长捉 / 长打，另一方不是 | 对方 | `长将判负` / `长捉判负` / `长打判负` | `judgeRepetition`（§3.6） |
| 双方长打，或双方长闲（三次重复） | `null` | `重复局面判和` | `judgeRepetition`（§3.6） |
| 任意一方认输 | 对方 | `认输` | `resign` |
| 一方求和且对方同意 | `null` | `同意和棋` | `acceptDraw` |

### 3.5 明确不做

自然限着、断线判负（意外断线由服务层进入宽限期保留对局，
超时后回退 waiting/idle，不判负）、观战者状态。这些能力扩展时需保持「所有修改经由 `Game` 方法」这一约束。

### 3.6 重复局面裁决（v2.11）

`Game` 只做「记录 + 触发」，判定本身是纯函数，规格见 [ADR-0002 §3.7](./0002-rules-engine.md)。

- 每手成功后追加：`posKeys`（`positionKey(棋盘, 新行棋方)`）与 `moveNatures`（`classifyMove(走子前, 走子后, 走子方)`）。
- 走子后若未立刻终局，则调 `judgeRepetition({ keys: posKeys, natures: moveNatures })`：
  恰好一方长打 → 对方胜（`长将判负` / `长捉判负` / `长打判负`）；双方长打或都不是 → 和棋（`重复局面判和`）。
- `reset()` / `setup()` 把两条历史重置为「只有当前局面 + 无着法」，`undo()` 与 `history` 一同 `pop`，
  因此**悔棋、重开不会沿用旧的重复计数**。
- 人机（本地 / 服务器 AI 房间）与残局挑战共用同一份 `Game`，因此同一套裁决自动生效。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| `Game` 类与字段（含 `posKeys` / `moveNatures`） | [game.ts](../../src/shared/game.ts#L18-L52) |
| 重置 `reset()` | [game.ts](../../src/shared/game.ts#L54-L72) |
| 自定义局面 `setup()` | [game.ts](../../src/shared/game.ts#L74-L84) |
| 快照 `snapshot()` | [game.ts](../../src/shared/game.ts#L86-L100) |
| 走子 `applyMove()`（含重复局面裁决） | [game.ts](../../src/shared/game.ts#L102-L146) |
| 终局结算 `endGame()` | [game.ts](../../src/shared/game.ts#L148-L157) |
| 悔棋 `undo()` | [game.ts](../../src/shared/game.ts)（同步 `pop` `history` / `posKeys` / `moveNatures`） |
| 认输 `resign()` / 超时 `timeout()` / 和棋 `acceptDraw()` / 可重开 `canRestart()` | [game.ts](../../src/shared/game.ts) |

调用方：[room.ts `applyAndBroadcast()`](../../src/server/room.ts)（联机，服务端房间权威）、
[app.ts](../../src/renderer/app.ts)（本地人机对弈 / 残局挑战），
测试 [game.test.ts](../../tests/game.test.ts) / [repetition.test.ts](../../tests/repetition.test.ts)。

## 5. 验收标准

- `reset` 后 `playing`、红方先行、`moveSeq=0`、标准开局（[game.test.ts](../../tests/game.test.ts)）。
- 合法走子：回合切换、`moveSeq+1`、`lastMove` 更新、棋盘变化正确。
- 非本方回合 / 非法走法：返回对应原因，棋盘与 `moveSeq` 保持不变。
- 吃子后棋盘更新；将死局面自动置 `over` 且 `reason='将死'`，并清空待处理请求。
- 认输、同意和棋分别以 `认输`、`同意和棋` 结束；`canRestart` 仅在 `over` 时为真。
- `setup(board, turn)` 以自定义局面开局（残局挑战）：`status='playing'`、`moveSeq=0`、`history` 与悔棋栈清空、
  待处理请求清零，并按先行方是否被将军置 `check`；之后走子 / 悔棋 / 终局判定与标准开局完全一致。
- 三次重复局面裁决（v2.11）：长将 / 长捉 / 长打方判负（对方胜）、双方长打或双方长闲判和；
  第 2 次重复不裁决；`undo()` 一并回退重复计数、`reset()` / `setup()` 清空历史（[repetition.test.ts](../../tests/repetition.test.ts)）。