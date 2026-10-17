# ADR-0009：C/D 档与 v1.5 扩展模块规格（日志 / 记谱 / AI / 自动发现 / 先手方式 / 对局回顾）

- 状态：已接受（记录现状实现；v1.5 追加 §3.9 先手方式与猜先、§3.10 对局回顾与 AI 推荐；v2.5 追加 §3.12 残局挑战；v2.6 更新 §3.12：残局「下一关」按钮 + 题库自检；v2.7 更新 §3.12：不限步数（将死即胜）+ 列表状态标记；v2.9 更新 §3.12：自建残局编辑器，保存时自动核验（取消「自检题库」手动入口）；**v2.11 更新 §3.10：复盘 AI 推荐改为按钮点开显示（箭头 + 蓝色落点）+ 后续变化 + 试下**；**v3.0 更新 §3.3：AI 引擎改为皮卡鱼 UCI 原生引擎（纯 TS 保留为回退），详见 [ADR-0011](./0011-pikafish-engine.md)**）
- 日期：2026-10-03（v1.5 追加：2026-10-06；v2.5 追加：2026-10-12；v2.9 追加：2026-10-15；v2.11 追加：2026-10-16；v3.0 追加：2026-10-16；v3.2 追加：2026-10-16）
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
| 实现 | **按难度分派**：1–4（入门 / 菜鸟 / 中级 / 高手）走纯 TS；5「棋圣」走皮卡鱼（Node 侧常驻单进程 + 串行请求队列 + 空闲回收 + 崩溃重启 + 引擎发现）；引擎出错 / 非法着法 / 缺失时回退纯 TS |
| 难度 | 外部契约 `level 1..5`（入门 / 菜鸟 / 中级 / 高手 / **棋圣**）；1–4 用纯 TS negamax（恢复皮卡鱼接入前的难度手感），5「棋圣」映射皮卡鱼 `Skill Level` + `go movetime` |
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
| 入口 | `POST /api/host/start-ai`（可选 `?depth=1..4`）+ 首页「人机对弈」子菜单（选棋种 / 我执哪一方 / 难度后点「开始对弈」） |
| 难度 | 外部契约 `depth 1..5`：1 入门 / 2 菜鸟 / 3 中级（默认选中）/ 4 高手 / 5 棋圣（皮卡鱼）；缺省或非法值沿用当前 `aiDepth`；响应回显生效的 `depth`。**v3.0+：1–4 档为纯 TS negamax，仅 5「棋圣」走皮卡鱼（映射 `Skill Level` + `go movetime`）；引擎缺失时「棋圣」回退纯 TS（见 [ADR-0011](./0011-pikafish-engine.md)）** |
| 我执哪一方（本地人机，v3.5） | 首页「人机对弈」面板在棋种与难度之间新增「**我执红（先行）/ 我执黑（后行）**」单选（默认执红）；`createAiRoom()` 以 `aiSideChoice()` 设 `S.side`，`localAiSide()` 取玩家的对方（我执红 → AI 黑，我执黑 → AI 红），开局后立即 `scheduleLocalAi()`，故**我执黑时由 AI（红方）先行**；棋盘随 `S.side` 翻转（`flip = S.side === 'b'`）、侧栏角色提示显示「你执红 / 黑 · AI 执黑 / 红」、本地悔棋回到**本方**回合。**服务端 AI 房间（协议保留）仍为人类执红** |
| 席位 | AI 占虚拟黑方（无连接）；`guest` 加入被拒（`人机对局，无法加入`）；观战者可加入 |
| 行为 | 人类执红先行（服务端 AI 房间）；AI 在 `aiDelayMs`（默认 400ms）后自动应招；`draw_request` → AI 拒绝；`undo_request` → 自动同意；`restart_request` → 自动同意并开新局 |
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

### 3.10 对局回顾与 AI 推荐（v1.5；v2.11 更新复盘的推荐交互）

| 项 | 规格 |
|---|---|
| 记录时机 | 终局（`broadcastGameOver`）时 `saveRecord()` 写入：席位（主机/加入者）、取先方式、猜先明细、起止时间、胜负与原因、着法序列；同一局只写一次。**人机对局（v2.2 起）不写入记录**；容量与落盘见 ADR-0010 §3.8 |
| 放弃开局 | 离开 / 宽限超时 / 停止托管时 `abandonGame()` 清空进行中记录，避免串到下一局 |
| 列表 | `GET /api/history` → `{ games: GameRecordSummary[] }`（最近在前） |
| 明细 | `GET /api/history/:id` → `GameRecord`（含 `moves`）；未知 id → 404 |
| AI 推荐 | `GET /api/ai/hint?id=&index=&depth=`：按 `moves` 前 `index` 步用 `makeMove` 复原局面，行棋方 = `index % 2 === 0 ? 'r' : 'b'`；**v3.0 起改由 `hintFor(record, index, level, engine)` 调引擎出着法**（`level` 默认 2、上限 5），经 `validateMove` 复核后返回推荐着法 + `describeMove` 中文记谱；无着法回 `{ none: true }`。HTTP 处理函数改为 async（`handleAiHint`）。客户端复盘固定用 `depth=5`（棋圣 / 皮卡鱼）以保推荐质量 |
| AI 推荐（客户端，v2.11） | 复盘页侧栏「AI 推荐」面板**默认只显示引导文案**（不再自动请求）；点按钮「AI推荐」才请求 `/api/ai/hint`，并把结果画到棋盘：**从原棋子指向推荐落点的箭头** + **蓝色落点标记**（半透明蓝盘压在落点上、外圈亮蓝环 → 「蓝色棋子」观感；起点另画细蓝环标出「原来的棋子」）。再点「收起推荐」隐藏；换局面（步进 / 跳步）会收起推荐与变化 |
| 后续变化（v2.11） | `GET /api/ai/line?id=&index=&plies=&depth=&first=`：`lineFor()` 在复原局面上连续推演 `plies`（默认 4，上限 8）手（**首手即该局面的推荐着法**，其后为 AI 视角双方应接；任一方无着可走即提前结束，全无着法回 `{ none: true }`），返回 `AiLine { side, moves: AiLineMove[] }`（每手含 `side` / `from` / `to` / `text`）。**首手复用**：客户端把已显示的「推荐」着法以 `first=fr,fc,tr,tc` 回传（复盘固定 `depth=5`），`lineFor()` 合法时直接作为首手——皮卡鱼按思考时限取着法、两次独立查询可能不同，故必须复用，保证「推荐」与「后续变化首手」一致。客户端：点「后续变化」**或直接点棋盘上的蓝色落点**即请求，把着法列成可点的列表并默认预览到末端（棋盘叠加该变化、推荐箭头收起）；点某一行预览到该手，按钮变「回到当前」回到未预览局面。预览用纯函数 `withMoves(base, moves, plies)`，不改动记录 |
| 试下（v2.11，自由走子） | 点「试下」以当前复盘局面为起点自由试走：点己方子 → 棋盘亮出合法落点 → 点落点走子（红先交替，走子后交给对方，规则用 `legalMoves` 过滤送将）；着法只在 `cloneBoard` 出来的试下盘上推演，**不改动对局记录**。操作行多出「悔一步」（按试走着法重算盘面）/「重来」（清空试走着法），按钮变「退出试下」；步进 / 跳步 / 离开复盘即结束试下 |
| 客户端 | `review.ts`：列表 → 复盘；棋盘复用 `renderBoard`，只读局面 / 变化预览 / 试下三种形态共用 `paintView()`；推荐与变化请求带序号（`hintSeq`）防乱序，推荐按钮带 120ms 防抖 |

### 3.11 杀法识别与终局展示（v2.4）

| 项 | 规格 |
|---|---|
| 目标 | 将死时不再只显示泛指的「将死」，而是给出具体杀法名（如「马后炮杀」）与一句话解说 |
| 识别模块 | 新增 [shared/checkmate.ts](../../src/shared/checkmate.ts)：纯函数、无 DOM / 网络依赖，服务端落库与渲染层展示共用同一实现，结果一致 |
| 输入 | 终局棋盘 + 被将死方；可选「最后一步」与「最后一步被吃棋子」（后者由 `capturedPieceAt()` 按着法序列推导，供「大刀剜心」判定「车吃宫心士」） |
| 输出 | `CheckmateInfo { pattern, alsoMatched, recognized }`；`pattern` 含 `id / name / label / definition`，未命中时兜底 `generic`（label 仍为「将死」） |
| 杀法库 | **19 种**：马后炮、重炮、闷宫、铁门栓、天地炮、夹车炮、海底捞月、列马车、卧槽马、钓鱼马、侧面虎、八角马、双车错、闷杀、双将、对面笑（白脸将 / 千里照面）；外加清单外**附加条目**大刀剜心、双马饮泉、挂角马（排在主判定之后，避免抢占主杀法）；每条含一句定义。定义按《象棋杀法与局面状态严格判定》收紧（「夹车炮」沿用原口径「双炮重叠作架 + 车配合将军」）：「八角马」＝马在士角与将对角定将；「马后炮」须马兼作炮架与控子；「双车错」须两车分占两条不同的线；「海底捞月」限车炮对单车残局；「困毙（欠行）」未被将军，不属本模块（只在「将死」时调用） |
| 判定方式 | 先分析终局：列出正在将军的棋子，以及将（帅）在九宫内相邻各格的受阻原因（己方子力堵住 / 被对方子力攻击 / 将帅照面禁止）；再按「具体结构优先于泛指结构」的严格顺序匹配杀法库（马后炮 → 重炮 → 闷宫 → 铁门栓 → 天地炮 → 夹车炮 → 海底捞月 → 列马车 → 卧槽马 → 钓鱼马 → 侧面虎 → 八角马 → 双车错 → 闷杀 → 双将 → 对面笑 → 附加条目 → 兜底），首个命中者为主杀法，其余命中者写入 `alsoMatched` |
| 位置判据 | 卧槽位＝对方二路横线与三、七路交叉点（底象前一格）；士角位＝对方九宫四个士角（「八角马」要求马在该士角且与将（帅）对角相邻）；宫顶角位＝对方九宫靠近河界的两个角（「挂角马」）；钓鱼马位＝三·八 / 七·八；侧面虎位＝三、七路卒（兵）位；将门＝将（帅）正前方一格（须在九宫内）；宫心＝对方九宫中心；底线行＝对方底线那一行；「列马车」＝车与将（帅）正交相邻（贴帅）照将且车在马口保护下 |
| 记录落库 | `GameRecordSummary / GameRecord` 新增可选 `killMethod`（如「马后炮杀」）：`saveRecord()` 在 `reason === '将死'` 时判定并写入，未识别到经典杀法则缺省；容量与落盘沿用 [ADR-0010 §3.8](./0010-room-server.md) |
| 对局页展示 | [app.ts `updatePanel()`](../../src/renderer/app.ts)：将死且识别到杀法时，状态框显示「红方胜 · 夹车炮杀」，其下渲染杀法框（杀法名 + 定义 + 「同时构成：…」）；联机、观战、本地人机共用同一判定 |
| 回顾展示 | 列表「胜负」列优先显示记录中的 `killMethod`（旧记录退回「将死」）；复盘页新增「终局杀法」面板，按记录着法即时识别，因此新老记录都能给出具体杀法 |

### 3.12 残局挑战（v2.5；v2.6 追加「下一关」与「自检题库」；v2.7 改为不限步数 + 状态标记；v2.9 追加「自建残局」编辑器；v3.3 核验上限 4 → 50 步并移到 Web Worker）

| 项 | 规格 |
|---|---|
| 目标 | 内置一批经典杀法残局：玩家执先手方（红），**不限步数，把对方将死即挑战成功**（被对方将死 / 困毙则挑战失败）；**本地对弈，不需要连接服务器，也不计入「对局回顾」** |
| 题库模块 | 新增 [shared/endgame.ts](../../src/shared/endgame.ts)：纯函数、无 DOM / 网络依赖。`EndgamePuzzle { id, name, level, side, goalMoves, intro, pieces }`，`pieces` 为 `[行, 列, 类型, 阵营]` 列表；`PUZZLES` 共 9 局（入门 5：对面笑 / 卧槽马 / 挂角马 / 重炮 / 双车错；中等 2：借帅封门 / 车马成杀 = 两步杀；困难 2：车炮冷着 / 车马残杀 = 三步杀），均为本项目自建的标准杀法构图 |
| 求解器 | `canForceMate(board, side, moves)`：我方着法 → 对方**所有**应着 → 递归，判断能否不论对方如何应对都在 moves 步（我方着法数）内取胜；对方无着可走（将死或困毙）即算取胜。`findMateMove(board, side, moves)` 返回一步可强制取胜的着法（无解返回 null）。`minMateDepth(board, side, max)` 返回当前局面**最少**几步可强制取胜（max 步以内无解返回 0），不限步数下用它配合 `findMateMove` 给出「仍能取胜」的最快着法（返回步数即该局面的最优步数）。实现要点：就地试走 + `isAttacked` 还原、置换缓存（棋盘 + 行棋方 + 剩余步数）、对方无着可走与递归两层剪枝；不修改传入棋盘。**v3.3 起三者均接受可选 `deadline`（单调时钟）**：超出即抛 `SolveTimeout`，供自建残局核验在工作线程里按预算中止（默认 `Infinity`，测试与题库自检不受影响） |
| 题库校验 | [tests/endgame.test.ts](../../tests/endgame.test.ts) 逐条断言：局面自洽（双方有将、无重叠、玩家先行方未被将军、对方有子可走）、`canForceMate(goalMoves) === true`、`goalMoves` 为最小步数（少一步即不可解）、`findMateMove` 首着合法且走完仍在杀棋之内、非退化（不是「随便走哪儿都赢」） |
| 局面核验（纯函数） | [endgame.ts `positionProblems()` / `checkPuzzle(p)` / `checkEndgameBank()`](../../src/shared/endgame.ts) 复用规则引擎 + 求解器逐条核验：局面合法（双方有将 / 无重叠 / 越界 / 步数 ≥ 1）、开局双方均未被将军且均有子可走、目标步数内可强制取胜、步数为最少、求解器能给出正解首着；`checkPuzzle` 返回 `PuzzleCheck { id, name, level, ok, solvable, minimal, problems[] }`。**v2.9 起不再有界面入口**：原「自检题库」按钮（`btn-eg-check`）与其结果弹层已移除，改由测试与「自建残局」保存前核验复用 |
| 自建残局（数据结构） | 难度档新增 `'custom'`（`LEVEL_LABEL.custom = '自建'`，列表徽章 `.eg-level.custom`）；自建残局与内置题目同构（`EndgamePuzzle`，`level = CUSTOM_LEVEL`），只存本机 `localStorage['lanschess-endgame-custom']`。新增纯函数：[`makeCustomEndgame()`](../../src/shared/endgame.ts)（由编辑器状态生成题目）、`parseCustomEndgames()`（损坏数据 / 结构不符的条目丢弃）、`upsertCustomEndgame()` / `removeCustomEndgame()`（均不修改传入数组）、`piecesToBoard()` / `boardToPieces()` / `swapPieceSides()`（棋盘 ↔ 棋子表、红黑互换） |
| 保存前自动核验 | [`checkCustomEndgame(pieces, side, limit = CUSTOM_CHECK_MAX, budgetMs = CUSTOM_CHECK_BUDGET_MS)`](../../src/shared/endgame.ts)：与题库自检同一套判定（复用 `positionProblems`），只是步数不预设——**在 `CUSTOM_CHECK_MAX`（v3.3 起为 50 步）以内由 `minMateDepth` 求出最优步数**，返回 `CustomCheck { ok, goalMoves, problems[] }`。不通过（缺将 / 重叠 / 越界 / 先手方被将军 / 对方无子可走 / 上限内无强制杀法）即逐条列出问题，其中上限内无杀法（含求解超 `budgetMs` 预算）报「**无杀法：50 步内无法强制将死对方**」；编辑器保持打开，便于按问题把局面改到合法且能强制取胜。**v3.3 起求解在 Web Worker 里跑**（见下「核验线程」） |
| 核验线程（v3.3） | 新增 [renderer/endgame-worker.ts](../../src/renderer/endgame-worker.ts)：模块化 Worker，`onmessage` 收到 `{ pieces, side, limit }` 后调用同一 `checkCustomEndgame` 并 `postMessage` 回结果。编辑器 [endgame-editor.ts `runCheck()`](../../src/renderer/endgame-editor.ts) 用 `new Worker(new URL('./endgame-worker.js', import.meta.url), { type: 'module' })` 起线程，保存时把「保 存」按钮置为「**核验中…**」并禁用（不阻塞界面），结果到达后恢复；`Worker` 不可用 / `onerror` 时回退同线程同步核验。`CUSTOM_CHECK_BUDGET_MS = 30_000` 为求解预算，超出即按「无杀法」返回，防止复杂局面无限枚举 |
| 自建残局编辑器 | 残局面板底部「自建残局」（`btn-eg-create`）→ 独立切屏 `screen-endgame-editor`，界面参照常见象棋残局编辑器：左侧棋盘（`eg-board`，Canvas 摆子）+ 棋盘下方棋子栏（`eg-pal-red` / `eg-pal-black`：红 車馬相仕帥炮兵、黑 車馬象士將炮卒）+ 右下「红先 / 黑先」（`eg-first-r` / `eg-first-b`）；右侧「局面」面板（`eg-reset` 初始局面 / `eg-clear` 清空 / `eg-swap` 红黑互换）、残局名输入（`eg-name`）与「返 回 / 保 存」（`eg-cancel` / `eg-save`）。交互：先在棋子栏选一颗作画笔（再点一次取消画笔），再点棋盘交叉点落子；右键点棋盘拿走该格棋子；有画笔时悬停给出落点提示。模块 [endgame-editor.ts `initEndgameEditor()`](../../src/renderer/endgame-editor.ts) 只管编辑器自身的 DOM 与状态，切屏 / 落盘 / 弹层由 [app.ts](../../src/renderer/app.ts) 注入（避免循环依赖） |
| 自建残局落盘与列表 | [app.ts `renderEndgameList()`](../../src/renderer/app.ts)：内置题库在前、自建残局在后，共用同一 `endgameRow()` 行（状态标记 + 名称 + 难度 / 「自建」徽章 + 最优步数）；自建条目右侧多出「编辑（`✎`）/ 删除（`✕`）」两个小按钮（[`askDeleteCustom()`](../../src/renderer/app.ts) 二次确认，并一并清掉本机对应的通关记录）。保存（`saveCustomEndgame()`）通过 `upsertCustomEndgame()` 写入本机存档后回到残局面板；自建残局与内置残局一样可开局、可记通关记录，只是题库中没有下一局（「下一关」按钮隐藏） |
| 状态机 | [game.ts `setup(board, turn)`](../../src/shared/game.ts)：以自定义局面开局（清空着法 / 悔棋栈 / 待处理请求，标记先行方是否被将军），残局与既有 `applyMove` / `undo` / 终局判定完全复用 |
| 入口 | 首页木质挂板「残局挑战」（`btn-endgame`，v2.5 由 5 入口改为 6 入口）→ 大面板 `menu-endgame` 列出题库（名称 / 难度徽章 / **最优步数** / **状态标记**），点击任意一条即开局 |
| 对局页 | 残局用独立操作行 `actions-endgame`：**悔棋**（连同 AI 应招一起回退）、**提示**（不限步数，用 `minMateDepth` 求出当前局面最少取胜步数，再由 `findMateMove` 给出对应着法——棋盘高亮起点 / 终点金环 + 轻提示记谱 + 步数；已走成无法强制取胜则提示重来）、**下一关**（`nextPuzzle` 直接进入题库中的下一局；题库中无下一局时按钮隐藏，已到末关点击提示「已经是最后一关了」）、**重来**（恢复初始局面）、**离开**；隐藏「和棋 / 认输」。侧栏 `eg-box` 显示残局名、难度、**最优步数**、已用步数与本局要点；状态框显示「轮到你走棋（第 x 步）」（不再有步数上限） |
| 防守 AI | 执玩家的对方（高手档 level 4），延迟 0.35s 应招。**v3.0 起改由引擎出着法（皮卡鱼优先，见 [ADR-0011](./0011-pikafish-engine.md)）**：`app.ts runLocalAi()` 经 `POST /api/ai/move` 取着法，请求失败回退 [shared/ai.ts `pickMove()`](../../src/shared/ai.ts)（depth 4 / 0.9s）；玩家走完一步后由 `endgameEvaluate()` 继续调度 AI（未出结果时）。题库可解性由 `minMateDepth` 按「对**最优防守**仍可强制将死」校验，故加强防守不破坏契约 |
| 胜负判定 | **不限步数**：每步（玩家与 AI）之后只看终局——我方取胜（将死 / 困毙）→ 成功并记录取胜最少步数；被对方将死 / 困毙 → 失败（「被将死 / 被困毙」）。成功弹层可「下一关 / 再来一次 / 返回首页」并显示「用时 N 步（最优 M 步 · 是否达成最优）」，失败弹层可「重来 / 返回首页」 |
| 记录与状态标记 | 本机记录仅存 `localStorage['lanschess-endgame']`：`id → { win?: 取胜最少步数, fail?: 是否曾失败 }`（兼容 v2.5/v2.6 的「数字 = 最少步数」旧格式，读入时视为已通关；损坏数据按未完成处理）。列表每行状态标记：**勾叉表示完成 / 失败 / 未完成——绿勾（已完成）、红叉（失败）、白勾（未完成）；外圈绿色表示已达成最优步数（`win === goalMoves`）、灰色表示未达成**（[styles.css `.eg-mark`](../../src/renderer/styles.css)） |
| 杀法展示 | 残局的终局同样走 [§3.11](#311-杀法识别与终局展示v24) 的杀法识别：状态框显示「挑战成功 · 卧槽马杀」并渲染杀法框；因残局不是从标准开局开始，`mateInfo()` 对残局改用 `classifyCheckmate(终局棋盘, 被将死方, { lastMove })`（不推导被吃子） |

### 3.13 吃子提示（v2.10）

| 项 | 规格 |
|---|---|
| 视角 | 以本端玩家一方（`S.side`）为视角：绿色标「可吃的对方子」，红色标「会被吃的己方子」；观战无「自己 / 对方」之分，不提示 |
| 分析模块 | 新增 [shared/tactics.ts](../../src/shared/tactics.ts)：纯函数、无 DOM / 网络依赖。`captureHints(board, side)` 返回 `{ targets, threats }`——`targets` 为可获利吃掉的对方棋子（绿），`threats` 为会被对方吃掉的己方棋子（红）；`threats` 即「以对方视角算 targets」，红黑天然对称 |
| 可获利吃子 | `profitableTargets(board, side)`：对每个对方棋子（**不含将帅**）所在点 S——先一次性算出该方所有合法着法（`legalMoves`，已过滤送将 / 照面）得到每个落点最便宜的攻击者价值 `minAttacker`；再判 S 是否**有根**（见下）。判据：`minAttacker` 存在且「**无根 → 白吃**」或「**有根但目标价值 > `minAttacker` → 小换大**」 |
| 「有根」判定 | 有根 = 己方能回头反吃：把 S 换成**我方真正会用来吃它的那枚子**（最便宜的合法攻击者 `byPos`）并把该子原格清空，再看对方能否回头反吃。不能用空格占位（炮吃子需炮架，空格会让炮被误判为有根），也不能直接用原盘面（S 上的己方子会被 `pieceMoves` 跳过 → 把无保护子误判为无根）。**将 / 帅作「根」时须能合法吃回**——吃回后自身不能处于被将军状态（送将非法，含将帅照面）；若将 / 帅是唯一保护者且吃回会被将军，则该子按**无根**处理（绿环 / 红环照常标出）。进攻子搬到 S（而非留在原位）可避免它在「将吃回后是否被将军」的判定里被重复计入 |
| 「有根」判定口径 | 除将 / 帅外的保护子按**伪合法**走法判定（沿用旧口径，**不考虑牵制**）；只有将 / 帅这一种保护者要求吃回**合法** |
| 价值表 | `PIECE_VALUE`：车 9 / 炮 4.5 / 马 4 / 士象 2 / 兵卒 1（帅将兜底极大值，正常不参与提示） |
| 明确不做 | 只做一手静态估值：除将 / 帅外的保护子不考虑牵制（被牵制的「根」仍算有根）、不考虑多子连环交换与反吃链、不考虑机动性 / 位置价值；**价值相同的有根交换（一换一）不提示** |
| 棋盘绘制 | [board.ts](../../src/renderer/board.ts) `BoardView.capture`（`CaptureHints`）：绿环 `HINT_TARGET_COLOR` / 红环 `HINT_THREAT_COLOR`，半径 `disc/2 + 4`、宽 3、alpha 0.9；画在棋子与「可吃子红环」之上、将军警示环之下（见 ADR-0007 §3.5 绘制计划） |
| 交互 | 对局侧栏「吃子提示」按钮（`btn-hint`，**默认关闭**）：仅 `status === 'playing'` 且非观战时可见；点击切换，开启后用金色实底强调（`#btn-hint.on`）并置 `aria-pressed`；结果在 `render()` 时由 `refreshCaptureHints()` 重算，悬停 / 脉冲帧只读 `S.hints`（不重复计算） |
| 覆盖范围 | 联机对战、本地人机、服务器 AI 房间与残局——凡有本地盘面且对局进行中的模式 |

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 主机日志 | [log.ts](../../src/server/log.ts) |
| 中文记谱与吃子 | [notation.ts](../../src/shared/notation.ts) |
| AI 引擎 | [ai.ts](../../src/shared/ai.ts)、[pickMove 调用](../../src/server/room.ts) |
| 自动发现 | [discover.ts](../../src/renderer/discover.ts) |
| 观战/悔棋/人机/计时服务端 | [host-server.ts](../../src/server/host-server.ts)（`handleJoin` / `undo_*` / `startAiGame` / `armTurnTimer`） |
| 先手方式 / 猜先 / 席位分配 | [host-server.ts `maybeStart()` / `beginFirst()` / `dispatchStart()`](../../src/server/host-server.ts)、[app.ts `chooseFirst()`](../../src/renderer/app.ts) |
| 对局记录 / AI 推荐 / 后续变化服务端 | [room.ts `saveRecord()` / `hintFor()` / `lineFor()`](../../src/server/room.ts)、[server.ts `/api/ai/hint` / `/api/ai/line`](../../src/server/server.ts) |
| 对局回顾 / 复盘客户端 | [review.ts](../../src/renderer/review.ts)（列表 / 复盘 / 推荐按钮 / 后续变化 / 试下；`withMoves()` 纯函数）、[board.ts `HINT_COLOR` / `arrowSegment()` / `ArrowOp` / `DiscOp`](../../src/renderer/board.ts)（推荐箭头与蓝色落点） |
| 杀法识别（杀法库 + 匹配） | [checkmate.ts](../../src/shared/checkmate.ts)（`CHECKMATE_PATTERNS` / `classifyCheckmate` / `classifyCheckmateFromHistory`） |
| 残局题库与求解器 | [endgame.ts](../../src/shared/endgame.ts)（`PUZZLES` / `buildPuzzleBoard` / `canForceMate` / `findMateMove` / `minMateDepth` / `findPuzzle` / `nextPuzzle` / `checkPuzzle` / `checkEndgameBank`） |
| 残局开局与判定 | [game.ts `setup()`](../../src/shared/game.ts)、[app.ts `startPuzzle()` / `restartPuzzle()` / `endgameUndo()` / `endgameHint()` / `endgameNext()` / `checkEndgameBankUI()` / `endgameEvaluate()` / `showEndgameResult()`](../../src/renderer/app.ts) |
| 残局界面 | [index.html `menu-endgame`（含 `btn-eg-check`）/ `actions-endgame`（含 `btn-eg-next`）/ `eg-box`](../../src/renderer/index.html)、[styles.css `.eg-row` / `.eg-mark` / `.eg-info` / `.eg-check-*`](../../src/renderer/styles.css) |
| 杀法落库 | [room.ts `saveRecord()`](../../src/server/room.ts)、[history.ts `toSummary()`](../../src/server/history.ts)（`killMethod`） |
| 杀法展示 | [app.ts `mateInfo()` / `kill-box`](../../src/renderer/app.ts)、[review.ts `mateOf()` / `replay-mate-box`](../../src/renderer/review.ts)、[index.html](../../src/renderer/index.html)、[styles.css](../../src/renderer/styles.css) |
| 吃子提示分析 | [tactics.ts](../../src/shared/tactics.ts)（`captureHints` / `profitableTargets` / `PIECE_VALUE`） |
| 吃子提示界面 | [app.ts `toggleCaptureHint()` / `refreshCaptureHints()`](../../src/renderer/app.ts)、[board.ts `BoardView.capture` / `HINT_TARGET_COLOR` / `HINT_THREAT_COLOR`](../../src/renderer/board.ts)、[index.html `btn-hint`](../../src/renderer/index.html)、[styles.css `#btn-hint`](../../src/renderer/styles.css) |
| 状态机扩展 | [game.ts](../../src/shared/game.ts)（`history` / `undo` / `timeout` / `deadline`） |
| 渲染层扩展 | [app.ts](../../src/renderer/app.ts)（吃子面板 / 悔棋 / 观战 / 倒计时 / 搜索 / 先手方式）、[review.ts](../../src/renderer/review.ts)（对局回顾 / 复盘 / AI 推荐按钮 / 后续变化 / 试下）、[board.ts](../../src/renderer/board.ts)（推荐箭头 + 蓝色落点） |
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
- v2.9（自建残局 + 保存时自动核验，2026-10-15）：
  - 自动化：`npm test`（329 项，含 [tests/endgame.test.ts](../../tests/endgame.test.ts) 45 项）/ `npm run lint` / `npm run format:check` / `npm run build` 全绿；
    新增 `checkCustomEndgame` 单测（一步 / 两步杀通过并给出最优步数、默认 4 步上限内无杀法即不通过、上限可调、缺将 / 重叠 / 越界 / 后手方已被将死被拦下、不改动传入棋子表）、`makeCustomEndgame` / `parseCustomEndgames` / `upsert` / `remove` 与本机存档解析（损坏数据与结构不符条目丢弃、不修改传入数组）、`boardToPieces` / `piecesToBoard` / `swapPieceSides` 互转单测；界面接线断言编辑器结构（棋盘 / 双排棋子栏 / 红先黑先 / 局面面板 / 保存）、保存时自动核验、自建残局并入列表与编辑 / 删除、以及**原「自检题库」入口已移除**。
  - 界面实测（浏览器）：残局面板 9 条内置题目 + 底部「自建残局」按钮（面板上已无「自检题库」）；进入编辑器可见棋盘（木质底图）、棋盘下方红黑两排棋子（各 7 颗：車馬相仕帥炮兵 / 車馬象士將炮卒）、右下「红先 / 黑先」、右侧「局面」面板（初始局面 / 清空 / 红黑互换）与残局名输入、「返 回 / 保 存」；「清空」后点「保 存」自动核验并弹出未通过弹层（列出「缺少红帅」「缺少黑将」），关闭后编辑器仍在；「初始局面」可恢复标准开局；「红先 / 黑先」切换高亮正常；「返 回」与 ESC 均回到残局面板；控制台无应用自身报错，`index.html` / `styles.css` / `app.js` / `endgame-editor.js` 与 `assets/img/stype_2/*` 均无 404。
    （说明：摆子与「合法局面保存成功 → 列表出现「自建」行」这一步需要精确点击 Canvas 交叉点，浏览器自动化工具做不到，故由纯函数单测与界面接线断言覆盖。）
- v2.10（吃子提示，2026-10-16）：
  - 自动化：`npm test`（342 项，含新增 [tests/tactics.test.ts](../../tests/tactics.test.ts) 11 项）/ `npm run lint` / `npm run format:check` / `npm run build` 全绿；
    分析用例覆盖开局无提示、无根白吃、有根小换大、等价交换不提示、**炮的「有根」判定（无炮架不算根 / 有炮架算根）**、将帅不参与提示、红黑对称与纯函数性；[tests/board.test.ts](../../tests/board.test.ts) 覆盖提示环的几何（半径 / 颜色 / 坐标 / 翻转）与「未开启不画环」；[tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts) 覆盖按钮结构、开启态样式、焦点环与 `app.ts` 接线。
  - 说明：提示的「分析 + 绘制 + 交互」三层均由自动化用例覆盖；浏览器自动化工具无法点击 Canvas，故本轮未在浏览器内实盘走完一盘棋验证绿 / 红环。
- v2.11（复盘 AI 推荐：按钮点开显示 + 后续变化 + 试下，2026-10-16）：
  - 自动化：`npm test`（354 项，含 [board.test.ts](../../tests/board.test.ts) 40 项 / [review.test.ts](../../tests/review.test.ts) 16 项 / [server.test.ts](../../tests/server.test.ts) 集成用例）/ `npm run lint` / `npm run format:check` / `npm run build` 全绿；
    新增 `arrowSegment` 几何单测（按 gap 收进末端、超长退化零长、两点重合不 NaN）、推荐标记绘制计划（蓝环 ×2 + 蓝盘 + 箭头、随视角翻转、不再借用素材提示点）、`withMoves` 纯函数单测（在给定局面上试走前 N 手且不改动传入棋盘、plies 越界收敛）、`AI 后续变化` 服务端集成（首手为该局面推荐着法且合法、双方交替、文本非空、未知 id 404）、以及复盘界面的 DOM / 样式 / 接线契约（按钮与变化列表结构、默认引导文案、点按钮才请求、点落点看后续变化、试下自由走子、面板文案与按钮态、设计令牌与焦点环）。
  - 界面实测（浏览器，预置一局 37 步「夹车炮杀」记录）：复盘页「AI 推荐」面板初始为引导文案 +「后续变化」禁用；点「AI推荐」后文案变「红方推荐：炮八进七」、按钮变「收起推荐」、棋盘出现原棋子指向落点的**蓝色箭头与蓝色圆盘/蓝环**；点「后续变化」列出 3 行（首行「炮八进七」）并预览到变化末端，点第 1 行可回到该手（行高亮 + 按钮变「回到当前」），再点回到未预览局面并重现箭头；点「试下」进入自由走子（提示「试下中（红方走子）」+「悔一步 / 重来 / 退出试下」），点红马与其合法落点即走子并在列表记一手，点「悔一步」清空记录、棋盘复位；「退出试下」后回到初始引导文案；控制台无 error / warning。
- v3.4（吃子提示「将守护」判定 + 战术元素放大，2026-10-17）：
  - **吃子提示**：`profitableTargets` 的「有根」判定改为带上**我方会用来吃子的那枚最便宜攻击者**（`byPos`）：把 S 换成该进攻子并把其原格清空后再判对方能否回头反吃；**将 / 帅作保护者时要求吃回合法**——吃回后自身不能被将军（送将 / 照面非法），若将 / 帅是唯一保护者且吃回会被将军则该子按无根处理（绿 / 红环照常标出）；除将 / 帅外的保护子仍按伪合法走法（不考虑牵制）。
  - **战术元素放大**：棋盘上方提示条 `#board-tactics` 加大（`font-size: 21px` / `letter-spacing: 5px` / `padding: 10px 26px`，小屏 `17px`）；战术闪电基准半径 `disc/2 + 12`、`lineWidth: 3`、`shadowBlur: 12`。
  - 自动化：`npm test` 新增 / 扩展 [tests/tactics.test.ts](../../tests/tactics.test.ts)（将不能安全吃回 → 无根绿环；将能安全吃回 → 有根不标；进攻子原格不被误判为仍在攻击；红方视角对称的红色威胁）、[tests/board.test.ts](../../tests/board.test.ts)（闪电放大后的基准半径）、[tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts)（上方提示条字号 / 内边距 / 闪电半径契约）。
