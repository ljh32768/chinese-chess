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
- 胜负原因只使用固定文案（`GameOverReason`）：`将死`、`困毙`、`认输`、`同意和棋`、`超时判负`。
  重复局面（长将 / 长捉 / 三次重复）**从不作为终局原因**：v3.5 起三次重复不判和，v3.43 起长将 / 长捉
  不再判负，v3.44 起连续「打」到第 5 步改为**禁走该手**（`code: 'vary'`，弹层提示「请变招」；无其它合法着法时放行），
  三次重复仍下发 `repetitionHint` 提示「请变招」，对局继续。
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
| `posKeys` / `moveNatures` | `string[]` / `{ side, nature }[]` | 每个局面的键与每一手的性质（将 / 捉 / 闲），重复局面提示基础；随 `undo` 一并回退 |
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
| 3.5 | `isVaryBlocked(from, to, side)`（长将 / 长捉第 5 步且存在其它不构成第 5 步的合法着法） | `{ ok:false, code:'vary', reason:'长将 / 长捉不可持续到第 5 步，请变招' }`（本手不落子） |
| 4 | 记录走子前局面（`past`），执行 `makeMove`，追加 `history` / `posKeys` / `moveNatures`（本手性质：将 / 捉 / 闲），`lastMove` 更新，`moveSeq += 1`，`turn` 切换 | — |
| 5 | `check = isInCheck(新 turn)`；`judgeAfterMove(新 turn)` | 终局则 `over` + `winner` + `reason`，并清空 `pendingDraw` / `pendingRestart` / `pendingUndo` |
| 6 | `judgeRepetition(posKeys, moveNatures)`（同一局面第 3 次出现，见 §3.6） | **不终局**：置位或清除 `repetitionHint`，对局继续 |

注意：第 3.5 步被拦截时同样**不改变任何状态**（含 `moveSeq` / `turn` / `history`），玩家可改走其它合法着法；
第 4 步之后必然成功，因此**被拒绝的走子不会改变任何状态**。

### 3.4 终局判定组合

| 情形 | winner | reason | 判定来源 |
|---|---|---|---|
| 对方被将死 | 走子方 | `将死` | `judgeAfterMove` |
| 对方被困毙 | 走子方 | `困毙` | `judgeAfterMove` |
| 长将 / 长捉 / 长打（连续「打」到第 5 步） | —（**不终局、本手被禁**） | 返回 `code:'vary'`，弹层提示 `请变招`；无其它合法着法时放行 | `isVaryBlocked`（§3.6） |
| 三次重复 | —（**不终局**） | 置 `repetitionHint`，提示 `请变招` | `judgeRepetition`（§3.6） |
| 任意一方认输 | 对方 | `认输` | `resign` |
| 一方求和且对方同意 | `null` | `同意和棋` | `acceptDraw` |

### 3.5 明确不做

自然限着、断线判负（意外断线由服务层进入宽限期保留对局，
超时后回退 waiting/idle，不判负）、观战者状态。这些能力扩展时需保持「所有修改经由 `Game` 方法」这一约束。

### 3.6 重复局面提示与长将 / 长捉拦截（v2.11 起；v3.5 起不判和、v3.43 起不判负、v3.44 起第 5 步禁走）

`Game` 只做「记录 + 触发 / 拦截」，判定本身是纯函数，规格见 [ADR-0002 §3.7](./0002-rules-engine.md)。

- 每手成功后追加：`posKeys`（`positionKey(棋盘, 新行棋方)`）与 `moveNatures`（`classifyMove(走子前, 走子后, 走子方)`）。
- **走子前**（`validateMove` 通过后）调 `isVaryBlocked(from, to, side)`：本手是该方连续「打」（将 / 捉）的
  **第 5 步**、走完的局面与此前重复（`posKeys` 已包含该局面键，形成重复循环），且还存在其它不构成第 5 步的
  合法着法 → 返回 `{ ok:false, code:'vary' }`，**这一手不落子**（局面 / `moveSeq` / `turn` / `history` 均不变），
  渲染层用「确认认输」的弹层框架提示「请变招」。
  **例外**：局面并未重复（正常进攻中一路向前的连续将军 / 捉子），或该方除这类着法外没有任何其它合法着法
  （`alternatives` 为空或全部都是第 5 步）→ 放行、不提示。
- 走子后若未立刻终局，则调 `judgeRepetition({ keys: posKeys, natures: moveNatures })`，**只置位公开字段
  `repetitionHint`，绝不以它结束对局**：
  - 同一局面第 3 次出现且**无人单方长打**（双方都长打或都不是）→ 置位（不判和，提示「请变招」）；
  - 恰好一方长打但还没到第 5 步 → 不置位（继续走子，到第 5 步再拦截）。
  该标志每手重新计算（未构成提示即为 `false`），随快照 / `move_applied` 下发，渲染层提示「请变招」。
- AI 兜底：`pickVarySafeMove(side, preferred)` 首先选着法若被拦截，则改走该方第一条不被拦截的合法着法；
  全部被拦截时返回首选着法（例外分支放行）。服务端房间 AI 与本地人机 AI 均经此方法走子。
- `reset()` / `setup()` 把两条历史重置为「只有当前局面 + 无着法」并清空 `repetitionHint`，
  `undo()` 与 `history` 一同 `pop` 且清空该标志，因此**悔棋、重开不会沿用旧的重复计数与提示**。
- 人机（本地 / 服务器 AI 房间）与残局挑战共用同一份 `Game`，因此同一套提示 / 拦截自动生效。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| `Game` 类与字段（含 `posKeys` / `moveNatures`） | [game.ts](../../src/shared/game.ts#L20-L71) |
| 重置 `reset()` | [game.ts](../../src/shared/game.ts#L73-L109) |
| 自定义局面 `setup()` | [game.ts](../../src/shared/game.ts#L110-L118) |
| 快照 `snapshot()` | [game.ts](../../src/shared/game.ts#L119-L145) |
| 走子 `applyMove()`（含第 5 步拦截与三次重复提示） | [game.ts](../../src/shared/game.ts#L146-L196) |
| 第 5 步拦截 `isVaryBlocked()` / AI 兜底 `pickVarySafeMove()` | [game.ts](../../src/shared/game.ts) |
| 终局结算 `endGame()` | [game.ts](../../src/shared/game.ts#L198-L207) |
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
- 重复局面（v2.11，v3.43 改为提示，v3.44 第 5 步禁走）：长将 / 长捉连续「打」到第 5 步时
  该手返回 `{ ok:false, code:'vary' }` 且**不落子**（局面 / `moveSeq` / `turn` / `history` 不变），
  **不判负、不判和、不产生 winner**；第 4 步照常可走；除长将 / 长捉外无其它合法着法时放行、不提示；
  AI 经 `pickVarySafeMove` 自动改走安全着法；双方长闲的三次重复仍只提示「请变招」；
  `undo()` 一并回退提示与重复计数、`reset()` / `setup()` 清空历史（[repetition.test.ts](../../tests/repetition.test.ts)）。