# ADR-0004：对局状态机模块规格（server/game.ts）

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
- 胜负原因只使用四种固定文案：`将死`、`困毙`、`认输`、`同意和棋`（`GameOverReason`）。
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
| 4 | 执行 `makeMove`，`lastMove` 更新，`moveSeq += 1`，`turn` 切换 | — |
| 5 | `check = isInCheck(新 turn)`；`judgeAfterMove(新 turn)` | 终局则 `over` + `winner` + `reason` |

注意：第 4 步之后必然成功；失败均发生在第 1~3 步，因此**被拒绝的走子不会改变任何状态**（含 `moveSeq`）。

### 3.4 终局判定组合

| 情形 | winner | reason | 判定来源 |
|---|---|---|---|
| 对方被将死 | 走子方 | `将死` | `judgeAfterMove` |
| 对方被困毙 | 走子方 | `困毙` | `judgeAfterMove` |
| 任意一方认输 | 对方 | `认输` | `resign` |
| 一方求和且对方同意 | `null` | `同意和棋` | `acceptDraw` |

### 3.5 明确不做

悔棋、计时读秒、长将/长捉/重复局面判定、断线判负（断线由服务层回退到 waiting/idle，不判负）、
观战者状态。这些能力扩展时需保持「所有修改经由 `Game` 方法」这一约束。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| `Game` 类与字段 | [game.ts](../../src/server/game.ts#L14-L27) |
| 重置 `reset()` | [game.ts](../../src/server/game.ts#L29-L40) |
| 快照 `snapshot()` | [game.ts](../../src/server/game.ts#L43-L54) |
| 走子 `applyMove()` | [game.ts](../../src/server/game.ts#L60-L82) |
| 认输 `resign()` | [game.ts](../../src/server/game.ts#L85-L92) |
| 和棋 `acceptDraw()` | [game.ts](../../src/server/game.ts#L95-L102) |
| 可重开判定 `canRestart()` | [game.ts](../../src/server/game.ts#L105-L107) |

调用方：[host-server.ts `handleMessage()`](../../src/server/host-server.ts#L250-L342)、
测试 [game.test.ts](../../tests/game.test.ts)。

## 5. 验收标准

- `reset` 后 `playing`、红方先行、`moveSeq=0`、标准开局（[game.test.ts](../../tests/game.test.ts)）。
- 合法走子：回合切换、`moveSeq+1`、`lastMove` 更新、棋盘变化正确。
- 非本方回合 / 非法走法：返回对应原因，棋盘与 `moveSeq` 保持不变。
- 吃子后棋盘更新；将死局面自动置 `over` 且 `reason='将死'`。
- 认输、同意和棋分别以 `认输`、`同意和棋` 结束；`canRestart` 仅在 `over` 时为真。