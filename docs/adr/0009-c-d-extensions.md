# ADR-0009：C/D 档与 v1.5 扩展模块规格（日志 / 记谱 / AI / 自动发现 / 先手方式 / 对局回顾）

- 状态：已接受（记录现状实现；v1.5 追加 §3.9 先手方式与猜先、§3.10 对局回顾与 AI 推荐；v2.5 追加 §3.12 残局挑战；v2.6 更新 §3.12：残局「下一关」按钮 + 题库自检；v2.7 更新 §3.12：不限步数（将死即胜）+ 列表状态标记；**v3.0 更新 §3.3：AI 引擎改为皮卡鱼 UCI 原生引擎（纯 TS 保留为回退），详见 [ADR-0011](./0011-pikafish-engine.md)**）
- 日期：2026-10-03（v1.5 追加：2026-10-06；v2.5 追加：2026-10-12）
- 关联入口：主机日志、棋谱与吃子、悔棋、观战、人机对战、计时读秒、局域网主机搜索、先手方式与猜先、对局回顾与 AI 推荐、残局挑战
- 关联文档：[ADR-0003 通信协议](./0003-wire-protocol.md)、[ADR-0004 状态机](./0004-game-state-machine.md)、[ADR-0005 主机服务](./0005-host-server.md)、[ADR-0007 渲染层](./0007-renderer-ui.md)

---

## 1. 背景

C 档（工程化）与 D 档（功能扩展）引入四个新模块与若干跨层能力：
主机日志、中文记谱、AI 引擎、局域网自动发现；并在协议与状态机上扩展了
观战（spectator）、悔棋（undo）、人机对战与计时读秒。本 ADR 汇总这些规格。

## 2. 决策

- 新模块保持既有边界：`log.ts` / `ai.ts` 仅在服务端；`notation.ts` 为无环境依赖的共享纯函数；
  `discover.ts` 仅在渲染层（浏览器 WebSocket 探测）。
- 协议扩展遵循「新增 `type` / 可选字段，不破坏既有语义」：`undo_request` / `undo_response`、
  `join.role='spectator'`、`welcome.side=null`、`move_applied.history/deadline`、`pong.ip/port`。
- 悔棋沿用「请求-回应」模式（与和棋同构）；观战与 AI 都建立在既有 `broadcast` 与席位模型上。
- 计时读秒默认关闭（`turnMs=0`），避免影响休闲对局；通过 `LANSCHESS_TURN_MS` 或选项开启。

## 3. 详细规格

### 3.1 主机日志（server/log.ts）

| 项 | 规格 |
|---|---|
| 开关 | `LANSCHESS_DEBUG`：未设置 → info 打点；`1/true/debug` → 追加 debug 明细；`0/off/false` → 全部关闭 |
| info 打点 | 服务就绪 / 连接（主机、加入者、观战者）/ 主动离开 / 走子 / 终局（含超时判负）/ 宽限开始与超时 / AI 走子 |
| debug 明细 | 拒绝走子原因、静态资源未命中、未知消息、服务端异常、HTTP/WS 服务错误 |
| 前置 | 测试环境默认静音（`vitest.config.ts` 设 `LANSCHESS_DEBUG=0`） |

### 3.2 中文记谱与吃子（shared/notation.ts）

| 函数 | 语义 |
|---|---|
| `describeMove(board, from, to)` | 走子前局面 → 传统中文记谱（纵线编号：红汉字自右向左、黑数字自右向左；平/进/退规则见文件头注释） |
| `describeHistory(history)` | 从标准开局回放，逐步生成记谱数组 |
| `capturedPieces(history)` | 回放统计 `{ byRed, byBlack }`（各自吃掉的对方棋子，按发生顺序） |

消歧约定：同一纵线 ≥2 枚同兵种时位置词前置（前车/后车；3 枚用前中后；≥4 枚首尾用前后、其余按从前序号编号）。

### 3.3 AI 引擎（端口 shared/engine.ts + 实现 server/pikafish.ts）

> **v3.0 变更**：AI 引擎更换为**皮卡鱼（Pikafish）UCI 原生引擎**；纯 TS negamax 保留为自动回退。
> 完整决策与规格见 [ADR-0011](./0011-pikafish-engine.md)。

| 项 | 规格 |
|---|---|
| 端口 | `EnginePort.bestMove(board, side, level)` → `{ move, source: 'pikafish' \| 'ts' }`；无合法着法时 `move = null` |
| 实现 | 皮卡鱼优先（Node 侧常驻单进程 + 串行请求队列 + 空闲回收 + 崩溃重启 + 引擎发现）；出错 / 非法着法时回退纯 TS |
| 难度 | 沿用外部契约 `level 1..4`（入门 / 菜鸟 / 中级 / 高手），映射 `Skill Level` + `go movetime` |
| 换算 | `shared/uci.ts`：棋盘 ↔ 中国象棋 FEN、项目坐标 ↔ UCI 方格、`bestmove` 行解析 |
| 纯 TS 回退 | `pickMove(board, side, { depth, timeLimitMs })`（`shared/ai.ts`）：negamax + α-β、迭代加深 + 时间保护、吃子优先排序 |
| 评估 | 子力（车 900 / 炮 450 / 马 400 / 相·士 200 / 兵·卒 100 / 将 100000）+ 兵卒过河位置分，红黑对称 |
| 性能 | 纯 TS 回退：开局 depth=2 实测约 115–200ms（测试断言 < 1500ms） |
| 安全网 | 引擎（或服务器）返回的 `from/to` 一律经 `validateMove` 复核；非法 / `(none)` / 超时一律回退 |
| 调用方 | 服务端 AI 房间（[room.ts `runAiMove()`](../../src/server/room.ts)）、复盘 AI 推荐（`hintFor`）、渲染层本地人机 / 残局防守（`POST /api/ai/move` 由承载页面的服务器代跑） |

### 3.4 局域网自动发现（renderer/discover.ts）

| 项 | 规格 |
|---|---|
| 探测 | `probeHost(ip, port, { timeoutMs=300, createSocket })`：连 `/ws` → 发 `ping` → 收 `pong` 即命中，返回主机自我声明的 `{ip, port}` |
| 扫描 | `discoverSubnet(prefix, port, { timeoutMs=400, concurrency=24, onProgress })`：扫 `<prefix>.1~254`，按声明地址去重 |
| 页面流程 | 先直探输入框地址与 `location.hostname`（800ms 超时），再扫网段并合并去重；结果渲染为可点击按钮填入加入表单 |
| 说明 | 浏览器无法使用 mDNS / UDP；探测不占用任何席位（仅 `ping/pong`），可安全用于他人对局 |

### 3.5 观战（spectator）

| 层 | 规格 |
|---|---|
| 协议 | `join.role='spectator'`；`welcome.side=null`；广播（`start`/`move_applied`/`state`/`game_over` 等）同时发给观战者 |
| 服务端 | `spectators` 集合不占红黑席位；观战者除 `ping`/`leave` 外的任何消息回 `error: 观战模式只读`；断线仅移除集合，不触发宽限 |
| 客户端 | `S.spectator`：按红方视角渲染、双方名称不带「你/对手」、隐藏对局操作、仅保留「离开观战」、状态文案为「红方/黑方行棋中…」 |

### 3.6 悔棋（undo）

| 层 | 规格 |
|---|---|
| 状态机 | `Game.history`（着法序列）+ 私有 `past`（每步前局面）；`undo()` 回退一步并清 `pendingUndo`；终局/认输/和棋/重置清空 |
| 协议 | `undo_request` → 对手弹层 → `undo_response{accept}`；同意后广播 `undo_response` + `state` 全量同步 |
| 限制 | 仅 `playing` 且有棋可悔；同一时刻仅一个待处理请求；对手离线（宽限中）时拒绝 |
| 人机对战 | AI 自动同意（悔棋后若轮到黑方 AI 会重新走子） |

### 3.7 人机对战（AI 模式）

| 项 | 规格 |
|---|---|
| 入口 | `POST /api/host/start-ai`（可选 `?depth=1..4`）+ 首页「人机对弈」子菜单（选难度后点「开始对弈」） |
| 难度 | 外部契约 `depth 1..4`：1 入门 / 2 菜鸟 / 3 中级（默认选中）/ 4 高手；缺省或非法值沿用当前 `aiDepth`；响应回显生效的 `depth`。**v3.0：`depth` 不再等价于搜索深度，改由引擎映射为皮卡鱼 `Skill Level` + `go movetime`（见 [ADR-0011](./0011-pikafish-engine.md)）** |
| 席位 | AI 占虚拟黑方（无连接）；`guest` 加入被拒（`人机对局，无法加入`）；观战者可加入 |
| 行为 | 人类执红先行；AI 在 `aiDelayMs`（默认 400ms）后自动应招；`draw_request` → AI 拒绝；`undo_request` → 自动同意；`restart_request` → 自动同意并开新局 |
| 与宽限 | AI 模式无客方连接，不触发断线宽限 |
| 对局回顾 | **人机对局不计入对局回顾（v2.2）**：终局时 `saveRecord()` 在 `currentRecord.ai === true` 时直接跳过落库；客户端本地人机对弈只在本机状态机内结束，同样不产生记录 |

### 3.8 计时读秒

| 项 | 规格 |
|---|---|
| 开启 | `HostServerOptions.turnMs` 或环境变量 `LANSCHESS_TURN_MS`；默认 0（不限时） |
| 快照 | `GameSnapshot.deadline: number \| null`（epoch ms），随 `start` / `move_applied` / `state` 下发 |
| 主机行为 | 每次走子/悔棋/开局后 `armTurnTimer()` 重设截止时间；超时 `Game.timeout(行棋方)` → `over`，`reason='超时判负'` |
| 客户端 | 状态框追加「（剩余 xx s）」，每 500ms 刷新；终局/未启用时不显示 |

### 3.9 先手方式与猜先（v1.5）

| 项 | 规格 |
|---|---|
| 选择入口 | 等待页「取先方式」**下拉框**（v2.2 由四个按钮改为 `<select>`）：猜先（**默认**）、随机黑红、房主执红、房主执黑；仅等待阶段可改（对局中回 `error: 对局进行中，无法更改先手方式`） |
| 席位确定 | 双方到齐后由 `beginFirst()` 统一分配：`r`/`b` 固定；`random` 服务端随机；`guess` 由「主机抓子 + 客方猜」决定 |
| 猜先规则 | **主机自己抓子**：双方到齐后主机收到 `grasp_request`，弹层选择「抓单 / 抓双」（`grasp`）→ 双方收到 `guess_request` → 客方回 `guess{choice}` → **猜中者执红**；结果由 `first_result{guess{choice,actual,guestWon}}` 广播（`actual` = 主机抓到的结果）。**v2.2：客方加入后双方直接进入棋盘界面（`enterGame()`），抓子 / 猜单双的弹层盖在棋盘上，状态栏显示「猜先：…」进度** |
| 猜先进度 | 对局界面状态栏文案：请抓单或抓双 → 等待对手猜单双…（房主）/ 等待房主抓子…（加入者）；客方重连时补发 `guess_request`，不重复请主机抓子 |
| 开放出错 | 非主机 `choose_first` → `只有主机可以选择先手方式`；非主机 `grasp` → `只有主机可以抓子`；非抓子阶段 `grasp` → `当前不在抓子阶段`；非客方 `guess` → `只有加入者可以猜先`；未抓子或已开局时 `guess` → `当前不在猜先阶段` |
| 阵营下发 | `start` 逐连接携带 `side`（观战者 null）；`welcome.side` 在 `random`/`guess` 下是临时占位 |
| 路由 | `connOf(side)` 按阵营找连接（主机不一定执红），`sendTo` / `broadcast` / `sendToOpponent` 均与席位无关 |
| 客户端提示 | 主机弹层「抓单 / 抓双」（`grasp_request`）→ 客方弹层「猜单 / 猜双」（`guess_request`）；结果用 toast 提示（如「猜先：主机抓「双」，加入者猜「单」→ 主机执红」） |

### 3.10 对局回顾与 AI 推荐（v1.5）

| 项 | 规格 |
|---|---|
| 记录时机 | 终局（`broadcastGameOver`）时 `saveRecord()` 写入：席位（主机/加入者）、取先方式、猜先明细、起止时间、胜负与原因、着法序列；同一局只写一次。**人机对局（v2.2 起）不写入记录**；容量与落盘见 ADR-0010 §3.8 |
| 放弃开局 | 离开 / 宽限超时 / 停止托管时 `abandonGame()` 清空进行中记录，避免串到下一局 |
| 列表 | `GET /api/history` → `{ games: GameRecordSummary[] }`（最近在前） |
| 明细 | `GET /api/history/:id` → `GameRecord`（含 `moves`）；未知 id → 404 |
| AI 推荐 | `GET /api/ai/hint?id=&index=&depth=`：按 `moves` 前 `index` 步用 `makeMove` 复原局面，行棋方 = `index % 2 === 0 ? 'r' : 'b'`；**v3.0 起改由 `hintFor(record, index, level, engine)` 调引擎出着法**（`level` 默认 2、上限 4），经 `validateMove` 复核后返回推荐着法 + `describeMove` 中文记谱；无着法回 `{ none: true }`。HTTP 处理函数改为 async（`handleAiHint`） |
| 客户端 | `review.ts`：列表 → 复盘；复盘棋盘复用 `renderBoard`（`hint` 高亮起点/终点），步进一次一步，AI 推荐 120ms 防抖 + 序号防乱序 |

### 3.11 杀法识别与终局展示（v2.4）

| 项 | 规格 |
|---|---|
| 目标 | 将死时不再只显示泛指的「将死」，而是给出具体杀法名（如「马后炮杀」）与一句话解说 |
| 识别模块 | 新增 [shared/checkmate.ts](../../src/shared/checkmate.ts)：纯函数、无 DOM / 网络依赖，服务端落库与渲染层展示共用同一实现，结果一致 |
| 输入 | 终局棋盘 + 被将死方；可选「最后一步」与「最后一步被吃棋子」（后者由 `capturedPieceAt()` 按着法序列推导，供「大刀剜心」判定「车吃宫心士」） |
| 输出 | `CheckmateInfo { pattern, alsoMatched, recognized }`；`pattern` 含 `id / name / label / definition`，未命中时兜底 `generic`（label 仍为「将死」） |
| 杀法库 | 18 种：马后炮、重炮、大刀剜心、铁门栓、闷宫、天地炮、夹车炮、双将、白脸将（对面笑）、双马饮泉、卧槽马、挂角马、钓鱼马、侧面虎（高钓马）、八角马、双车错、海底捞月、闷杀；每条含一句定义，资料出处见模块注释（维基教科书《中国象棋/基本杀法列表》、维基百科「铁门闩 / 双车错 / 卧槽马 / 钓鱼马 / 挂角马」、百度百科「绝杀 / 闷杀 / 大刀剜心」等） |
| 判定方式 | 先分析终局：列出正在将军的棋子，以及将（帅）在九宫内相邻各格的受阻原因（己方子力堵住 / 被对方子力攻击 / 将帅照面禁止）；再按「具体结构优先」顺序匹配杀法库，首个命中者为主杀法，其余命中者写入 `alsoMatched` |
| 位置判据 | 卧槽位＝对方二路横线与三、七路交叉点（底象前一格）；士角位＝对方九宫四个士角；钓鱼马位＝三·八 / 七·八；侧面虎位＝三、七路卒（兵）位；将门＝将（帅）正前方一格（须在九宫内）；宫心＝对方九宫中心；底线行＝对方底线那一行 |
| 记录落库 | `GameRecordSummary / GameRecord` 新增可选 `killMethod`（如「马后炮杀」）：`saveRecord()` 在 `reason === '将死'` 时判定并写入，未识别到经典杀法则缺省；容量与落盘沿用 [ADR-0010 §3.8](./0010-room-server.md) |
| 对局页展示 | [app.ts `updatePanel()`](../../src/renderer/app.ts)：将死且识别到杀法时，状态框显示「红方胜 · 夹车炮杀」，其下渲染杀法框（杀法名 + 定义 + 「同时构成：…」）；联机、观战、本地人机共用同一判定 |
| 回顾展示 | 列表「胜负」列优先显示记录中的 `killMethod`（旧记录退回「将死」）；复盘页新增「终局杀法」面板，按记录着法即时识别，因此新老记录都能给出具体杀法 |

### 3.12 残局挑战（v2.5；v2.6 追加「下一关」与「自检题库」；v2.7 改为不限步数 + 状态标记）

| 项 | 规格 |
|---|---|
| 目标 | 内置一批经典杀法残局：玩家执先手方（红），**不限步数，把对方将死即挑战成功**（被对方将死 / 困毙则挑战失败）；**本地对弈，不需要连接服务器，也不计入「对局回顾」** |
| 题库模块 | 新增 [shared/endgame.ts](../../src/shared/endgame.ts)：纯函数、无 DOM / 网络依赖。`EndgamePuzzle { id, name, level, side, goalMoves, intro, pieces }`，`pieces` 为 `[行, 列, 类型, 阵营]` 列表；`PUZZLES` 共 9 局（入门 5：对面笑 / 卧槽马 / 挂角马 / 重炮 / 双车错；中等 2：借帅封门 / 车马成杀 = 两步杀；困难 2：车炮冷着 / 车马残杀 = 三步杀），均为本项目自建的标准杀法构图 |
| 求解器 | `canForceMate(board, side, moves)`：我方着法 → 对方**所有**应着 → 递归，判断能否不论对方如何应对都在 moves 步（我方着法数）内取胜；对方无着可走（将死或困毙）即算取胜。`findMateMove(board, side, moves)` 返回一步可强制取胜的着法（无解返回 null）。`minMateDepth(board, side, max)` 返回当前局面**最少**几步可强制取胜（max 步以内无解返回 0），不限步数下用它配合 `findMateMove` 给出「仍能取胜」的最快着法（返回步数即该局面的最优步数）。实现要点：就地试走 + `isAttacked` 还原、置换缓存（棋盘 + 行棋方 + 剩余步数）、对方无着可走与递归两层剪枝；不修改传入棋盘 |
| 题库校验 | [tests/endgame.test.ts](../../tests/endgame.test.ts) 逐条断言：局面自洽（双方有将、无重叠、玩家先行方未被将军、对方有子可走）、`canForceMate(goalMoves) === true`、`goalMoves` 为最小步数（少一步即不可解）、`findMateMove` 首着合法且走完仍在杀棋之内、非退化（不是「随便走哪儿都赢」） |
| 题库自检 | [endgame.ts `checkPuzzle(p)` / `checkEndgameBank()`](../../src/shared/endgame.ts) 为纯函数，复用规则引擎 + 求解器逐条核验：局面合法（双方有将 / 无重叠 / 越界 / 步数 ≥ 1）、开局双方均未被将军且均有子可走、目标步数内可强制取胜、步数为最少、求解器能给出正解首着；返回 `PuzzleCheck { id, name, level, ok, solvable, minimal, problems[] }`。界面入口在残局面板底部「自检题库」（`btn-eg-check` → [app.ts `checkEndgameBankUI()`](../../src/renderer/app.ts)），结果以弹层逐条列出通过 / 不通过与问题说明；新增题目可先用它自检再入库 |
| 状态机 | [game.ts `setup(board, turn)`](../../src/shared/game.ts)：以自定义局面开局（清空着法 / 悔棋栈 / 待处理请求，标记先行方是否被将军），残局与既有 `applyMove` / `undo` / 终局判定完全复用 |
| 入口 | 首页木质挂板「残局挑战」（`btn-endgame`，v2.5 由 5 入口改为 6 入口）→ 大面板 `menu-endgame` 列出题库（名称 / 难度徽章 / **最优步数** / **状态标记**），点击任意一条即开局 |
| 对局页 | 残局用独立操作行 `actions-endgame`：**悔棋**（连同 AI 应招一起回退）、**提示**（不限步数，用 `minMateDepth` 求出当前局面最少取胜步数，再由 `findMateMove` 给出对应着法——棋盘高亮起点 / 终点金环 + 轻提示记谱 + 步数；已走成无法强制取胜则提示重来）、**下一关**（`nextPuzzle` 直接进入题库中的下一局；题库中无下一局时按钮隐藏，已到末关点击提示「已经是最后一关了」）、**重来**（恢复初始局面）、**离开**；隐藏「和棋 / 认输」。侧栏 `eg-box` 显示残局名、难度、**最优步数**、已用步数与本局要点；状态框显示「轮到你走棋（第 x 步）」（不再有步数上限） |
| 防守 AI | 执玩家的对方（高手档 level 4），延迟 0.35s 应招。**v3.0 起改由引擎出着法（皮卡鱼优先，见 [ADR-0011](./0011-pikafish-engine.md)）**：`app.ts runLocalAi()` 经 `POST /api/ai/move` 取着法，请求失败回退 [shared/ai.ts `pickMove()`](../../src/shared/ai.ts)（depth 4 / 0.9s）；玩家走完一步后由 `endgameEvaluate()` 继续调度 AI（未出结果时）。题库可解性由 `minMateDepth` 按「对**最优防守**仍可强制将死」校验，故加强防守不破坏契约 |
| 胜负判定 | **不限步数**：每步（玩家与 AI）之后只看终局——我方取胜（将死 / 困毙）→ 成功并记录取胜最少步数；被对方将死 / 困毙 → 失败（「被将死 / 被困毙」）。成功弹层可「下一关 / 再来一次 / 返回首页」并显示「用时 N 步（最优 M 步 · 是否达成最优）」，失败弹层可「重来 / 返回首页」 |
| 记录与状态标记 | 本机记录仅存 `localStorage['lanschess-endgame']`：`id → { win?: 取胜最少步数, fail?: 是否曾失败 }`（兼容 v2.5/v2.6 的「数字 = 最少步数」旧格式，读入时视为已通关；损坏数据按未完成处理）。列表每行状态标记：**勾叉表示完成 / 失败 / 未完成——绿勾（已完成）、红叉（失败）、白勾（未完成）；外圈绿色表示已达成最优步数（`win === goalMoves`）、灰色表示未达成**（[styles.css `.eg-mark`](../../src/renderer/styles.css)） |
| 杀法展示 | 残局的终局同样走 [§3.11](#311-杀法识别与终局展示v24) 的杀法识别：状态框显示「挑战成功 · 卧槽马杀」并渲染杀法框；因残局不是从标准开局开始，`mateInfo()` 对残局改用 `classifyCheckmate(终局棋盘, 被将死方, { lastMove })`（不推导被吃子） |

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 主机日志 | [log.ts](../../src/server/log.ts) |
| 中文记谱与吃子 | [notation.ts](../../src/shared/notation.ts) |
| AI 引擎 | [ai.ts](../../src/shared/ai.ts)、[pickMove 调用](../../src/server/room.ts) |
| 自动发现 | [discover.ts](../../src/renderer/discover.ts) |
| 观战/悔棋/人机/计时服务端 | [host-server.ts](../../src/server/host-server.ts)（`handleJoin` / `undo_*` / `startAiGame` / `armTurnTimer`） |
| 先手方式 / 猜先 / 席位分配 | [host-server.ts `maybeStart()` / `beginFirst()` / `dispatchStart()`](../../src/server/host-server.ts)、[app.ts `chooseFirst()`](../../src/renderer/app.ts) |
| 对局记录 / AI 推荐服务端 | [host-server.ts `saveRecord()` / `hintFor()`](../../src/server/host-server.ts) |
| 对局回顾 / 复盘客户端 | [review.ts](../../src/renderer/review.ts) |
| 杀法识别（杀法库 + 匹配） | [checkmate.ts](../../src/shared/checkmate.ts)（`CHECKMATE_PATTERNS` / `classifyCheckmate` / `classifyCheckmateFromHistory`） |
| 残局题库与求解器 | [endgame.ts](../../src/shared/endgame.ts)（`PUZZLES` / `buildPuzzleBoard` / `canForceMate` / `findMateMove` / `minMateDepth` / `findPuzzle` / `nextPuzzle` / `checkPuzzle` / `checkEndgameBank`） |
| 残局开局与判定 | [game.ts `setup()`](../../src/shared/game.ts)、[app.ts `startPuzzle()` / `restartPuzzle()` / `endgameUndo()` / `endgameHint()` / `endgameNext()` / `checkEndgameBankUI()` / `endgameEvaluate()` / `showEndgameResult()`](../../src/renderer/app.ts) |
| 残局界面 | [index.html `menu-endgame`（含 `btn-eg-check`）/ `actions-endgame`（含 `btn-eg-next`）/ `eg-box`](../../src/renderer/index.html)、[styles.css `.eg-row` / `.eg-mark` / `.eg-info` / `.eg-check-*`](../../src/renderer/styles.css) |
| 杀法落库 | [room.ts `saveRecord()`](../../src/server/room.ts)、[history.ts `toSummary()`](../../src/server/history.ts)（`killMethod`） |
| 杀法展示 | [app.ts `mateInfo()` / `kill-box`](../../src/renderer/app.ts)、[review.ts `mateOf()` / `replay-mate-box`](../../src/renderer/review.ts)、[index.html](../../src/renderer/index.html)、[styles.css](../../src/renderer/styles.css) |
| 状态机扩展 | [game.ts](../../src/shared/game.ts)（`history` / `undo` / `timeout` / `deadline`） |
| 渲染层扩展 | [app.ts](../../src/renderer/app.ts)（吃子面板 / 悔棋 / 观战 / 倒计时 / 搜索 / 先手方式）、[review.ts](../../src/renderer/review.ts)（对局回顾 / 复盘 / AI 推荐） |
| 工程化配置 | [package.json](../../package.json)（dev/lint/format/dist）、[.github/workflows/ci.yml](../../.github/workflows/ci.yml) |

## 5. 验收标准

- C 档：`npm run lint`、`npm run format:check`、`npm run build`、`npm test` 全部通过；
  `npm run dist` 可产出 Windows 安装包；`npm run dev` 可自动重启主机端。
- D 档（自动化）：见 [ADR-0008 §3.1](./0008-testing-strategy.md) 中 notation / ai / discover / server 新增用例。
- D 档（浏览器实测）：人机对战自动应招与悔棋、观战只读与棋谱同步、双人悔棋请求-回应、
  吃子面板、计时倒计时、主机搜索并连接，全部通过（2026-10-03 验证）。
- v2.4（杀法识别，浏览器实测 2026-10-11）：终局对局页状态框显示「红方胜 · 夹车炮杀」并在其下渲染杀法框；
  对局回顾列表「胜负」列显示「红胜（夹车炮杀）」；复盘页「终局杀法」面板显示杀法名与解说；控制台无报错。
- v2.5（残局挑战，2026-10-12）：
  - 自动化：`npm test`（281 项，含 [tests/endgame.test.ts](../../tests/endgame.test.ts) 18 项）/ `npm run lint` / `npm run format:check` / `npm run build` 全绿；题库 9 局逐条由求解器验证「可解 + 步数最少 + 非退化」，并与规则引擎独立实现的对拍结果一致。
  - 界面实测（浏览器）：首页 6 个入口完整落在木质挂板内框内（末个按钮底边 = 挂板下沿）；
    残局列表 9 条（名称 / 难度 / 目标步数）；开局「卧槽马」状态框「轮到你走棋（第 1 / 1 步）」+ 目标块「已用 0 / 1 步」；
    「提示」给出正解首着「马九进七」；走出正解后状态框「挑战成功 · 卧槽马杀」并渲染杀法框，弹层含「下一关：挂角马」；
    列表出现「已通关 · 1 步」；「重来」可复位。两步杀「借帅封门」：玩家将军 → AI 自动应招（士填将门）→ 平帅照面取胜，
    显示「挑战成功 · 困毙 · 用时 2 步」，列表记「已通关 · 2 步」。一步不杀则「挑战失败 · 超出步数」并弹出重来 / 返回首页。控制台无报错。
- v2.6（残局优化：下一关 + 题库自检，2026-10-13）：
  - 自动化：`npm test`（288 项，含 [tests/endgame.test.ts](../../tests/endgame.test.ts) 25 项）/ `npm run lint` / `npm run format:check` / `npm run build` 全绿；
    自检用例覆盖内置题库逐条通过，以及缺将、越界、重叠、目标步数不可解、非最少步数、后手已被将死等异常题目的识别（且不改动传入题目）。
  - 界面实测（浏览器）：残局对局页操作行出现「下一关」（末关隐藏），点击即进入题库中的下一局；残局面板底部「自检题库」点开后弹出逐条结果，全部为「✓ 局面合法 · 目标步数内可解 · 步数最少」；控制台无报错。
- v2.7（残局改为不限步数 + 列表状态标记，2026-10-13）：
  - 自动化：`npm test`（296 项，含 [tests/endgame.test.ts](../../tests/endgame.test.ts) 33 项）/ `npm run lint` / `npm run format:check` / `npm run build` 全绿；
    新增 `minMateDepth` 单测（一步杀为 1、两步杀上限不足为 0、放宽上限仍取最少）与「题库逐局 `minMateDepth(…, 6) === goalMoves`」；本机记录纯函数单测（完成 / 失败 / 未完成、最优步数判定、旧版数字格式兼容、失败不覆盖已通关、取胜清除失败标记、不改动传入对象）；界面接线断言残局判定已无「超出步数」分支、列表/侧栏改为展示最优步数、状态标记类名（`eg-mark` 的 `win` / `fail` / `todo` / `optimal`）齐备。
  - 界面实测（浏览器）：残局列表 9 条，每行左侧为圆形状态标记、右侧显示「最优 N 步」（未通关时为白勾 + 灰圈）；进入残局后侧栏显示「残局：名 · 难度」「最优：N 步」「已用：M 步」，状态框「轮到你走棋（第 x 步）」，角色提示「不限步数 · 最优 N 步」（均无步数上限写法）；「提示」给出当前局面最快取胜着法并标注步数（实测「提示：车九进八（1 步内取胜）」）且棋盘出现金色高亮环；控制台无报错。
    （说明：将死后的列表标记变化属纯前端渲染逻辑，已由自动化用例覆盖；浏览器自动化工具无法点击 Canvas，故本轮未在浏览器内实盘走完整局。）