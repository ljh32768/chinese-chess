# ADR-0009：C/D 档与 v1.5 扩展模块规格（日志 / 记谱 / AI / 自动发现 / 先手方式 / 对局回顾）

- 状态：已接受（记录现状实现；v1.5 追加 §3.9 先手方式与猜先、§3.10 对局回顾与 AI 推荐）
- 日期：2026-10-03（v1.5 追加：2026-10-06）
- 关联入口：主机日志、棋谱与吃子、悔棋、观战、人机对战、计时读秒、局域网主机搜索、先手方式与猜先、对局回顾与 AI 推荐
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

### 3.3 AI 引擎（shared/ai.ts）

| 项 | 规格 |
|---|---|
| 接口 | `pickMove(board, side, { depth=2, timeLimitMs=1500 })`，无合法着法返回 `null` |
| 算法 | negamax + α-β；迭代加深 + 时间保护（超时回退已完成浅层）；吃子优先排序 |
| 评估 | 子力（车 900 / 炮 450 / 马 400 / 相·士 200 / 兵·卒 100 / 将 100000）+ 兵卒过河位置分，红黑对称 |
| 性能 | 开局 depth=2 实测约 115–200ms（测试断言 < 1500ms） |
| 局限 | 无置换表/静态搜索/长将判断（明确不做） |

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
| 难度 | `depth` 搜索深度：2 菜鸟 / 3 中级（默认选中）/ 4 高手；缺省或非法值沿用当前 `aiDepth`；响应回显生效的 `depth` |
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
| AI 推荐 | `GET /api/ai/hint?id=&index=&depth=`：按 `moves` 前 `index` 步用 `makeMove` 复原局面，行棋方 = `index % 2 === 0 ? 'r' : 'b'`，`pickMove`（depth 默认 2，上限 4，时限 1.2s）返回推荐着法 + `describeMove` 中文记谱；无着法回 `{ none: true }` |
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