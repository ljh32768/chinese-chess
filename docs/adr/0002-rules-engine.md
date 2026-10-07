# ADR-0002：规则引擎模块规格（shared/rules.ts + shared/types.ts）

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：走子校验、落点提示、将军/将死/困毙裁判
- 关联文档：[ADR-0004 对局状态机](./0004-game-state-machine.md)、[Product-plan.md 第 8 节](../Product-plan.md)

---

## 1. 背景

裁判正确性是 MVP 的核心。规则逻辑必须：

- 与服务端权威校验、浏览器落点提示使用**同一份实现**，避免两端行为不一致；
- 可在 node 环境直接单测（不依赖 DOM / 网络）；
- 判定结果唯一：同一局面下「是否合法 / 是否将军 / 是否终局」有且仅有一个答案。

## 2. 决策

- 规则引擎实现为 `shared/rules.ts` 中的**纯函数集合**，输入输出只涉及 `shared/types.ts` 的数据结构。
- 采用「伪合法走法 → 送将过滤」两段式：先按棋子走法生成候选（`pieceMoves`），
  再模拟落子后检查己方将/帅是否被攻击（`legalMoves`），天然覆盖**应将**与**送将**。
- 将帅照面（对脸）并入 `isAttacked`：目标为将/帅且对方将/帅同列无遮挡时视为被攻击。
- 胜负判定集中在 `judgeAfterMove`：无任何合法着法时，被将军为**将死**、否则为**困毙**，均由对方胜。

## 3. 详细规格

### 3.1 坐标与棋盘

| 项 | 规格 |
|---|---|
| 棋盘 | 10 行 × 9 列，`Board = Cell[][]`，空格为 `null` |
| 坐标 | `Pos = [行, 列]`；行 0 在上（黑方底线），行 9 在下（红方底线） |
| 阵营 | `Side = 'r' | 'b'`；红方默认先行 |
| 棋子类型 | `K` 帅/将、`A` 仕/士、`B` 相/象、`N` 马、`R` 车、`C` 炮、`P` 兵/卒 |
| 九宫 | 列 3~5；红方行 7~9，黑方行 0~2（`inPalace`） |
| 过河 | 红方 `r <= 4`、黑方 `r >= 5` 视为过河（兵/卒横走条件） |

### 3.2 各棋子走法（`pieceMoves`，伪合法）

| 棋子 | 走法 | 限制 |
|---|---|---|
| 帅/将 K | 上下左右一步 | 只在九宫内；不能吃己方 |
| 仕/士 A | 斜走一步 | 只在九宫内；不能吃己方 |
| 相/象 B | 斜走两格（田字） | 不过河；**塞象眼**（中间格有子则禁） |
| 马 N | 日字（8 个方向） | **蹩马腿**（相邻方向格有子则禁） |
| 车 R | 直线任意距离 | 遇子停止；可吃对方子 |
| 炮 C | 直线移动同车 | 移动需路径全空；**吃子须隔且仅隔一子**（炮架） |
| 兵/卒 P | 向前一步 | 过河后可左右横走一步；永不后退；不能吃己方 |

所有走法统一规则：目标格为对方棋子=吃子，为空=移动，为己方棋子=排除。

### 3.3 合法走法与将军检测

| 函数 | 语义 |
|---|---|
| `isAttacked(b, r, c, by)` | 格子 `(r,c)` 是否被 `by` 方攻击；目标为将/帅时含**照面**判定 |
| `isInCheck(b, s)` | `s` 方是否被将军（找不到将/帅视为被将军） |
| `legalMoves(b, r, c)` | 该棋子伪合法走法过滤：模拟落子后己方将/帅不得被攻击 |
| `sideHasAnyMove(b, s)` | `s` 方是否还存在任意合法着法 |

过滤算法：对每个候选落点深拷贝棋盘 → `makeMove` → `findKing` → `isAttacked`，
任一条件失败即剔除。该过滤同时实现三种约束：**不能送将**、**被将军必须应将**、**将帅不能照面**。

### 3.4 走子与终局判定

| 函数 | 语义 |
|---|---|
| `makeMove(b, from, to)` | 原地执行一步（不做规则校验，仅供内部与测试） |
| `boardAfterMove(b, from, to)` | 返回模拟后的新棋盘（不改原棋盘） |
| `judgeAfterMove(b, sideToMove)` | 无合法着法时返回 `{ winner, reason }`；`reason ∈ {将死, 困毙}`；否则 `null` |

### 3.5 权威校验入口 `validateMove(b, from, to, expectedSide)`

返回 `null` 表示合法；否则返回中文原因（客户端 `move_rejected.reason` 直接展示）：

| 顺序 | 条件 | 返回原因 |
|---|---|---|
| 1 | 起点/终点越界 | `越界` |
| 2 | 起点无棋子 | `起点没有棋子` |
| 3 | 棋子不属于发起方 | `这不是你的棋子` |
| 4 | 目标为己方棋子 | `不能吃自己的棋子` |
| 5 | 起点=终点 | `起点与终点相同` |
| 6 | 不在 `legalMoves` 中 | `不符合走法或会送将` |

### 3.6 明确不做（MVP 范围外）

长将、长捉、重复局面、自然限着、悔棋、计时读秒。加入这些规则时只扩展 `rules.ts` 与 `judgeAfterMove`，
不改变本模块的纯函数边界。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 数据结构（Side/Piece/Board/GameSnapshot...） | [types.ts](../../src/shared/types.ts#L1-L53) |
| 开局摆子 `initBoard` | [rules.ts](../../src/shared/rules.ts#L24-L40) |
| 各棋子走法 `pieceMoves` | [rules.ts](../../src/shared/rules.ts#L50-L196) |
| 攻击/照面判定 `isAttacked` | [rules.ts](../../src/shared/rules.ts#L212-L241) |
| 将军判定 `isInCheck` | [rules.ts](../../src/shared/rules.ts#L244-L248) |
| 合法走法过滤 `legalMoves` | [rules.ts](../../src/shared/rules.ts#L251-L263) |
| 终局判定 `judgeAfterMove` | [rules.ts](../../src/shared/rules.ts#L299-L307) |
| 权威校验 `validateMove` | [rules.ts](../../src/shared/rules.ts#L313-L330) |

调用方：主机 [game.ts `applyMove()`](../../src/shared/game.ts#L60-L82)、
客户端落点提示 [app.ts `onCell()`](../../src/renderer/app.ts#L449-L481)。

## 5. 验收标准

- 32 枚棋子开局位置正确，红黑各 16（[rules.test.ts](../../tests/rules.test.ts)）。
- 各棋子走法、塞象眼、蹩马腿、炮架、过河卒横走均有测试断言。
- 对脸局面被判定为非法（`legalMoves` 过滤）且可检测为将军。
- 将死返回 `{ winner: 对方, reason: '将死' }`；困毙返回 `{ winner: 对方, reason: '困毙' }`。
- `validateMove` 六类拒绝原因逐一可复现。