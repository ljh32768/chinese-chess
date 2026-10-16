# ADR-0012：揭棋（暗棋）——隐藏信息的象棋变体

- 状态：已接受
- 日期：2026-10-16
- 关联入口：首页「人机对弈」的「揭棋（暗棋）」模式、首页「创建房间」的「揭棋房间」、棋盘暗子渲染与翻开、揭棋吃子展示
- 关联文档：[ADR-0002 规则引擎](./0002-rules-engine.md)、[ADR-0004 状态机](./0004-game-state-machine.md)、[ADR-0007 渲染层](./0007-renderer-ui.md)、[ADR-0010 房间服务器](./0010-room-server.md)

---

## 1. 背景

揭棋（Jieqi，又称暗棋、越南象棋 Cờ Úp）是中国象棋的流行变体：棋盘、棋子、九宫、河界与
「将死即胜」的目标都不变，但**除将帅外的全部棋子开局一律背面朝下随机摆放**，双方（连同棋子主人）
都不知道暗子的真实身份。暗子第一次走动时，按**它所在起始位置对应的兵种**行棋，走完后立即**翻开**
露出真实身份；此后按真实身份行棋。翻开后的**士 / 相不受九宫 / 河界限制**（其余限制如蹩马腿、
塞象眼、炮架照旧）。

规则来源（检索核对）：

- QQ 象棋揭棋玩法说明 <https://image.qqchess.qq.com/test_160324/activity/html/jieqiguize.html>
- Mistboard 揭棋规则 <https://mistboard.com/zh-hant/rules/jieqi>
- rules.moddable.games：Jieqi — Xiangqi <https://rules.moddable.games/xiangqi/variants/jieqi/>

关键条款（本项目采用的版本）：

| # | 规则 |
|---|---|
| 1 | 摆子：双方各 15 枚（2 仕/士、2 相/象、2 马、2 车、2 炮、5 兵/卒）洗混后随机铺在己方 15 个起始点；将/帅正面摆在原位 |
| 2 | 暗子首步按「所在起始位置的兵种」走子、吃子，限制（蹩马腿 / 塞象眼 / 九宫 / 河界 / 炮架）照常 |
| 3 | 首步走完后该子翻开，露出真实身份，此后按真实身份行棋 |
| 4 | 翻开后的**士 / 相**可以出九宫 / 过河；走法形状不变（士斜一步、相走田字且仍会塞象眼） |
| 5 | 暗子被吃：本实现**向双方公开**其身份（简化取舍，见 §4） |
| 6 | 胜负：将死 / 困毙判负；将帅照面、送将过滤等既有规则不变 |

## 2. 决策

- **新增共享纯模块 `shared/jieqi.ts`**（洗子、起始兵种、翻子、公开快照抹除），与规则 / 状态机一同
  运行在服务端与浏览器（本地人机）；不引入任何环境依赖。
- **暗子以「字段扩展 + 无侵入」表示**：`Piece` 增加可选 `hidden`（暗子标记，公开）、
  `real`（真实身份，仅权威端持有）、`free`（翻开的士/相免九宫河界）。`t` 始终表示**当前生效的走法兵种**
  （暗子为「起始位置兵种」），因此既有规则引擎 / AI 无需感知隐藏信息即可正确工作（也天然不会「偷看」）。
- **抹除在权威快照出口完成**：`Game.snapshot()` 在揭棋变体下返回 `redactBoard()` 结果（去掉 `real`），
  于是服务端广播、断线重连、观战、悔棋同步**全部自动**只下发公开信息。
- **变体隔离**：`Game.variant: 'xiangqi' | 'jieqi'`；标准象棋走原逻辑，行为不变。
- **入口**：不改首页挂板（挂板背景素材固定为 6 入口，改动会破坏既有布局契约），
  揭棋作为既有面板内的**模式选项**：人机对弈面板「标准象棋 / 揭棋（暗棋）」；创建房间面板「揭棋房间」勾选。
- **对局记录**：揭棋不写入「对局回顾」（与本地人机对局一致）——记录回放依赖「标准开局 + 着法」，
  揭棋的初始暗子分布不同，需另行存储初始局面；本版不做，留待后续。
- 人机揭棋复用本地 AI（`pickMove`）；AI 只读 `t`，因此**看不到任何暗子的真实身份**（含它自己的）。

## 3. 详细规格

### 3.1 数据结构（shared/types.ts）

| 字段 | 类型 | 说明 |
|---|---|---|
| `Piece.hidden` | `boolean?` | 暗子（未翻开）。公开信息（客户端据此画背面） |
| `Piece.real` | `PieceType?` | 暗子的真实身份；**仅权威端持有**，下发前抹除 |
| `Piece.free` | `boolean?` | 翻开的士 / 相：不受九宫 / 河界限制 |
| `GameVariant` | `'xiangqi' \| 'jieqi'` | 对局变体 |
| `RoomMode` | `'pvp' \| 'ai' \| 'jieqi'` | `jieqi` = 双人揭棋房间 |
| `GameSnapshot.variant` | `GameVariant?` | 客户端据此切换暗子渲染与吃子展示 |
| `GameSnapshot.capturedByRed/Black` | `PieceType[]?` | 揭棋吃子记录（含被吃暗子翻开后的身份） |

> 标准象棋对局不写 `variant` / `captured*`，因此接入后旧行为与旧快照结构完全不变。

### 3.2 揭棋模块（shared/jieqi.ts）

| 函数 | 语义 |
|---|---|
| `startTypeAt(side, r, c)` | 起始点对应的兵种（车 / 马 / 相 / 仕 / 炮 / 兵）；非起始点返回 null |
| `dealBoard(rng?)` | 生成揭棋开局：将帅正面，其余 15 点洗子铺暗子（`rng` 便于测试确定化） |
| `revealAt(board, pos)` | 翻开该点暗子：`t` ← `real`，去掉 `hidden`/`real`，若为士 / 相置 `free`；返回是否翻开 |
| `redactBoard(board)` | 深拷贝并抹除全部 `real`（公开快照出口） |
| `coveredCount(board, side)` | 某方尚未翻开的暗子数（侧栏展示） |

### 3.3 规则引擎（shared/rules.ts）

- `cloneBoard` 改为保留全部字段（`{ ...piece }`），确保 `hidden` / `real` / `free` 在
  `legalMoves` 试走、悔棋快照、AI 试走中不丢失。
- `pieceMoves`：`A`（仕）在 `free` 时允许棋盘内任意一格斜走（不再限九宫）；`B`（相）在 `free` 时
  跳过河界限制（仍走田字、仍塞象眼）；其余兵种与暗子（无 `free`）行为不变。

### 3.4 状态机（shared/game.ts）

| 方法 / 行为 | 规格 |
|---|---|
| `variant` | 默认 `'xiangqi'`；揭棋房间 / 本地揭棋置 `'jieqi'` |
| `openJieqi()` | 以洗子局面开局（`variant='jieqi'`，`status='playing'`，清空记录） |
| `applyMove` | 揭棋下：记录被吃子身份（`real ?? t`）到吃子方数组；走子后对落点调用 `revealAt` |
| `undo()` | 连带回退吃子数组（`past` 快照含 `capRed` / `capBlack` 与完整盘面） |
| `snapshot()` | 揭棋下 `board = redactBoard(board)` 并附带 `variant` / `capturedByRed` / `capturedByBlack` |

### 3.5 渲染层（renderer）

| 项 | 规格 |
|---|---|
| 暗子背面 | `board.ts` 新增 `BackOp`（`{ back, cx, cy, r, side }`），`computeDrawList` 对 `p.hidden` 画程序化背面（无新素材）；抬起 / 走子动画同样按背面绘制 |
| 入口（本地） | 「人机对弈」面板新增模式单选「标准象棋 / 揭棋（暗棋）」；选揭棋即以 `openJieqi()` 开局，AI 执黑 |
| 入口（联机） | 「创建房间」面板新增「揭棋（暗棋）房间」勾选，`create_room{mode:'jieqi'}` |
| 房间列表 | 增加揭棋标记（`mode==='jieqi'` 显示「揭棋」），并纳入可加入列表（`mode !== 'ai'`） |
| 吃子面板 | 揭棋改用快照 `capturedByRed/Black`（标准对局仍由着法回放推导） |
| 终局杀法 | 揭棋不做杀法识别（局面含暗子，识别无意义），终局只显示「将死 / 困毙」 |
| 状态栏 | 追加「揭棋 · 剩余暗子 N」提示 |

### 3.6 协议与服务端

- `create_room.mode` 增加 `'jieqi'`；`RoomMode` 同步扩展。
- `Room`：`jieqi` 与 `pvp` 同构（两席、先手方式 / 猜先 / 宽限 / 读秒 / 观战 / 悔棋都复用），
  仅**开局改为洗子**（`startGame()` → `game.openJieqi()`），且**终局不落库**。
- 所有对外快照（`room_joined.state` / `start` / `state` / `move_applied`）在揭棋下自动抹除 `real`；
  `move_applied` 追加可选 `variant` / `capturedByRed` / `capturedByBlack` 字段。
- 观战者在揭棋房间同样只能看到公开信息（服务端统一抹除，不存在「观战偷看」）。

## 4. 已知取舍

1. **被吃暗子向双方公开**：严格规则只向吃子方揭示；本实现为便于统计与展示向双方公开。
2. **不落库 / 不可复盘**：见 §2；后续若需要，可扩展 `GameRecord.initialBoard` 记录洗子结果。
3. **不做长将 / 长捉 / 重复局面裁决**：与主项目既有范围一致（ADR-0002 明确不做）。
4. **不做「翻子」动画**：仅以走子动画 + 盘面替换呈现翻开效果。

## 5. 测试

- `tests/jieqi.test.ts`：洗子（数量 / 兵种多重集 / 将帅明置 / 起始兵种一致）、翻子、抹除、
  引擎（暗子按起始兵种走、翻开后士相越界、送将过滤）、状态机（翻开 / 吃子记录 / 悔棋回退 / 快照不含 `real`）。
- `tests/rules.test.ts`：补 `free` 士 / 相走法与 `cloneBoard` 字段保留。
- `tests/server.test.ts`：揭棋房间建房 / 开局洗子 / 广播抹除 / 走子翻开 / 不落库。
- `tests/board.test.ts`：暗子背面绘制计划与 `hidden` 棋子不贴正图。
- `tests/ui-home-layout.test.ts`：人机面板揭棋模式选项、创建房间揭棋勾选契约。
