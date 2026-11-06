# 局域网象棋（lan-chess）文档中心

局域网中国象棋：**中心服务器（局域网）+ 多房间并发** + WebSocket 通信 + 纯 TypeScript 规则引擎，
浏览器的与 Electron 客户端共用同一套渲染页面。

> 一句话：局域网内任一台设备打开服务器地址，就能创建 / 加入房间，完整、正确地下一盘棋。

- 版本：v3.10（v0.1.0 为 MVP 代码基线；v1.1–v1.6 为主机权威时代的优化与功能迭代；**v2.0 迁移到局域网中心服务器**；**v2.1 客户端自选服务器 + 房间列表 / 邀请 + 本地人机对弈**；**v2.2 点击板块后的大面板 UI + 邀请玩家列表 + 猜先进入棋盘 + 人机对局不计入回顾**；**v2.3 修复桌面客户端对局回顾 Failed to fetch（API 跨源）+ 新增「我的历史」**；**v2.4 界面视觉与交互精修 + 象棋杀法识别**；**v2.5 残局挑战：内置经典杀法题库 + 强制将死求解器，本地对弈、提示 / 悔棋 / 重来与通关记录**；**v2.6 残局优化：残局页面「下一关」按钮 + 题库自检（`checkPuzzle` / `checkEndgameBank`）**；**v2.7 残局不限步数（将死即胜）+ 列表状态标记（绿勾 / 红叉 / 白勾 + 绿 / 灰外圈表示是否最优）**；**v2.8 走子动画（抬起 / 移动 / 放下）+ 将军 / 绝杀棋盘正中提示条（各杀法一套图案样式，1.5s 渐入渐出）**；**v2.9 走子动画改为「点击棋子抬起」+ 被吃掉的棋子改为棋盘两侧灰色缩略图 + 自建残局编辑器**；**v2.10 吃子提示：绿环标「可吃掉的对方无根子 / 小换大」，红环标「会被对方吃掉的己方子」**；**v2.10 界面布局：去掉本局「邀请玩家」按钮，邀请列表改为等待页右栏 / 对局页侧栏常驻展示（进入房间即拉取 + 每 5s 自动刷新 + 手动刷新）**；**v2.10 提示特效升级：将军 / 绝杀改为棋盘正中黑色大圆（将军白字 / 绝杀红字 + 绝杀暗红斜线）与被将军的将颤抖；新增战术特效（闪击 / 闪将 / 将军抽马车炮 / 串打 / 捉双——文字在棋盘上方 + 被威胁棋子闪电）与开局招法提示（当头炮 / 起马局等）**；**v2.11 长将 / 长捉 / 重复局面裁决：新增共享纯模块 `shared/repetition.ts`——同一局面（棋盘布局 + 行棋方）第 3 次出现即裁决：一方每步都是「打」（将 / 捉）而另一方不是则该方判负（长将 / 长捉 / 长打判负），双方都是「打」或都不是则不变作和**；**v2.11 复盘 AI 推荐：点「AI推荐」按钮才显示推荐（原棋子指向落点的箭头 + 蓝色落点）+ 点落点看「后续变化」+ 「试下」自由走子**；**v3.0 揭棋（暗棋）：洗子开局 + 暗子按起始兵种首步 / 翻开 + 翻开的士相越界 + 公开快照抹除真实身份；人机对弈「揭棋」模式与双人「揭棋房间」**；**v3.0 AI 引擎更换为皮卡鱼（Pikafish）UCI 原生引擎（新增 `shared/engine.ts` 引擎端口 + `shared/uci.ts` 换算层 + `server/pikafish.ts` 常驻进程封装 + `server/engine-select.ts` 优先选择与回退；服务端 AI 房间与本地人机共用同一引擎接口，引擎缺失时自动回退纯 TS）**；**v3.1 战术判定修正 + 提示特效调优：串打 / 捉双 / 将军抽统一改为「两者必然失去其一」——模拟对方每一种合法应着，走动的子仍须至少攻击到一枚被威胁子（排除「被威胁子反吃攻击子」「垫子挡线」「移走炮架」等能两全的伪战术），串打并要求前后两子都 ≥马；将军颤抖幅度减半且约 1.1s 内衰减到 0（不再一直抖）；将军 / 绝杀正中提示延长至 2.5s**；**v3.2 复盘 / 战术 / 难度修正：复盘「AI推荐」与「后续变化」首手一致（客户端回传推荐着法，`lineFor` 复用为首手）+ 绝杀暗红斜线改为「左上→右下」对角 + 人机难度恢复「入门 / 菜鸟 / 中级 / 高手」用纯 TS 并新增「棋圣」档走皮卡鱼 + 串打等战术按「获利」口径排除有根棋（目标无根或小换大）**）；**v3.3 串打漏报 / 残局死子 / 长杀核验修正：串打等战术撤销「获利口径」（回到「两者必然失去其一」——被威胁子是否有根不再影响判定，真串打不再漏报）；棋盘两侧吃子条改由权威状态机下发的 `capturedByRed/Black` 驱动（标准 / 揭棋 / 残局 / 人机一致），修复残局自定义开局下按标准开局推导出的「莫名死子」；吃子条放大并保留红 / 黑原色（不再置灰）；自建残局保存前核验上限由 4 步放宽到 **50 步**、求解改到 **Web Worker**（界面显示「核验中…」不阻塞，超预算或 50 步内无强制杀法即报「无杀法」）**）；**v3.4 吃子提示「将守护」判定（将 / 帅作保护者时须能合法吃回——吃回后自身不被将军，否则该子按无根处理、绿 / 红环照常标出；除将 / 帅外的保护子仍按伪合法走法）+ 战术元素放大（棋盘上方提示条 21px、闪电基准半径 disc/2 + 12）**；**v3.5 人机对弈可选执红 / 执黑（本地）：面板新增「我执红（先行）/ 我执黑（后行）」单选（默认执红），选黑时由 AI（红方）先行、棋盘随你的视角翻转，侧栏提示与悔棋一并按所选方生效**；**v3.5 战术提示严格判定重构（`shared/tactics.ts` 的 `detectTactics`）：按「先看是否照将」分支——将军抽的将军来源可为**闪将**、被抽子含**将后同线大子**（经典抽将），只将军才是闪将；串打 / 捉双按「两者必然失去其一」（排除「移子蹩马腿同时挡将」等能两全的伪战术），捉双仅「一子捉双」；**将军抽 / 串打 / 捉双 统一为「两者必然失去其一 + 能获利吃到」**（无根白吃 / 小换大，与吃子提示同口径——「将军抽有根的炮」等有根且不划算的伪战术不再提示）；**三次重复在无人长打时不再判和，改为下发 `repetitionHint` 提示「请变招」**（对局继续）；同步更新 ADR-0002 §3.7 / ADR-0004 §3.6 / ADR-0007 §3.5.7 与用例**）；**v3.6 战术判定修正：闪击须为「双向双威胁」——移开的棋子自身也必须捉到大子（只让线不再误判闪击）；将军抽只认本步新造的获利威胁（原本就白吃着的子 + 任意一步将军不再误报「将军抽 X」）**；**v3.7 提示与编辑器精修：将军 / 绝杀去掉黑底与圆框，改为楷体加粗大字并删除下方小字（绝杀大字直接显示杀法名）；战术提示（闪击 / 闪将 / 将军抽 / 串打 / 捉双）改为黑色方框 + 同款楷体；自建残局编辑器棋子栏改用棋盘同款棋子素材、右上角显示剩余可摆枚数（0 枚置灰），并支持拖拽入盘 / 盘内调位 / 拖出拿走**；**v3.8 提示字样统一：开局提示只显示开局名（去掉「开局：」前缀与括号别名，如「当头炮」）；绝杀大字统一为纯杀法名（钓鱼马 / 列马车 / 卧槽马 / 八脚马 / 侧面虎 / 马后炮 / 天地炮 / 夹车炮 / 重炮 / 对面笑 / 困毙 / 闷宫 / 闷杀 / 双车错 / 海底捞月 / 铁门栓 / 双将，不再追加「杀」字，新增「困毙」终局条目）；残局题库由 9 局扩到 21 局，为各杀法补一步杀示例（含困毙）**；**v3.9 八脚马构图修正 + 提示条上移放大：绝杀字样里的「八脚马（八角马）」改为正确定式——马占对方宫角、将（帅）在斜对宫角，马控住两条退路（残局示例同步改成该构图）；战术 / 开局提示（捉双、当头炮等）从棋盘上沿移出画布，改在棋盘正上方独占一行（`.board-tactics-slot` 常驻占位、字号 21 → 30px）**；**v3.10 吃子提示 / 将军抽修正：「小换大」须净赚 ≥1 分——马 4 换炮 4.5 这类几乎等值的交换不再算可获利吃子，修复「马吃有根炮」被误标绿环、并连带误报「将军抽炮」（用户截图局面回归）**
- 状态：v3.10 完成；494 项自动化测试通过，lint / format / build / CI 全绿
- 更新日期：2026-11-06

版本里程碑：

| 版本 | 内容 | 记录 |
|---|---|---|
| v0.1.0 | MVP：创建/加入对局、走子与裁判、认输/和棋/重开、断线提示、Electron 与浏览器共用页面 | commits `5bcd5cb` … `34c6f36` |
| v1.1 | A 档 快速见效：错误提示、地址复制、弹层交互与等待态、大屏布局、悬停反馈、快捷键、矮窗口修复 | commit `d3065ad` |
| v1.2 | B 档 稳健性：断线重连宽限、终局清理 pending、静态路径加固、协议清理 | commit `2f1b609` |
| v1.3 | C 档 工程化 + D 档 功能扩展：CI/lint/format、dev 脚本、安装包打包、主机日志；局域网主机发现、棋谱/吃子/悔棋、观战、人机对战与计时读秒 | commit `e22f7b0` |
| v1.4 | 前端视觉改造：对齐参考项目 Reference/Chess 的经典木质风格——Canvas + 图片棋子渲染、三套皮肤、音效、木质挂板菜单、人机难度子菜单 | commit `b78ace8` |
| v1.5 | 功能扩展：等待页放大 + 先手方式（红 / 黑 / 随机黑红 / 猜先）、删除棋谱改为「对局回顾」（列表 + 复盘右箭头逐步 + AI 推荐） | 见 ADR-0003/0005/0007/0009 |
| v1.6 | 界面调整：主界面整体放大 1.25 倍、三个子面板与木板内框对齐、用 cover.bmp 覆盖主页署名 | commit `6e9fb40` |
| v2.0 | 架构迁移：主机权威（P2P 星型）→ 局域网中心服务器 + 多房间并发；新增最简账号系统、房间口令、终局房间自动销毁、对局记录持久化、服务器发现重构；Electron 默认改为「连接服务器」 | 见 [ADR-0010](./adr/0010-room-server.md) |
| **v2.1** | **客户端不再于启动时绑定地址：新增「连接服务器」板块（自动搜索局域网 + 手动输入，绿/红/灰状态；浏览器访问时锁定）；账号入口移到主页右上角；「加入房间」改为房间列表（点击即入 / 上锁房间填口令 / 无需口令观战）；房间内可邀请在线玩家加入对局或观战；人机对弈改由客户端本地 AI 运行（未连接服务器也可用）** | 见 [ADR-0010 §9](./adr/0010-room-server.md) |
| **v2.2** | **点击板块后的界面改用「大面板」（参考对局回顾，不再与木质内框对齐）；「邀请玩家」改为宽版玩家列表（在线在前可一键邀请、离线 / 对局中置灰；等待阶段只邀请对局，开局后为邀请观战）；等待页取先方式改为下拉框（默认猜先），对手加入后双方直接进入棋盘再猜单双；删除首页底部「服务器 / 已登录」小字；人机对局不计入对局回顾** | 见 [ADR-0010 §10](./adr/0010-room-server.md) |
| **v2.3** | **修复桌面客户端「对局回顾」一直 Failed to fetch：所有 `/api/*` 响应补上 CORS 头并放行 `OPTIONS` 预检（页面来自本机外壳服务，REST 访问真实服务器属跨源）；「对局回顾」新增「全部对局 / 我的历史」页签（`GET /api/history?user=`），登录按账号、游客按本机最近一次入座身份过滤** | 见 [ADR-0010 §11](./adr/0010-room-server.md) |
| **v2.4** | **界面视觉与交互精修（不动结构、只精修表达）：`:root` 设计令牌（木色层次 / 强调金 / 焦点环 / 缓动）；面板头部分隔线与文本层级；切屏淡入、弹层缩放淡入与 `prefers-reduced-motion` 支持；按钮 / 列表行 / 输入框统一 hover / active / disabled / `:focus-visible` 金色焦点环；对局「轮到你走棋」浅金实底强调（将军 / 终局仍为警示配色）；房间号徽章、回顾页签幽灵态、单选按钮与滚动条配色、轻提示换行与 `role=status`、右上角入口超宽省略** | 见 [ADR-0007 §3.5.4](./adr/0007-renderer-ui.md) |
| **v2.4** | **象棋杀法识别：新增共享模块 `shared/checkmate.ts`（18 种经典杀法 + 结构匹配），将死时状态框显示具体杀法名（如「马后炮杀」）并给出解说与「同时构成」；对局记录新增 `killMethod` 随对局回顾落库，列表与复盘页同步展示（复盘按着法即时识别，新老记录都可用）；终局杀法框沿用 v2.4 设计令牌与层级** | 见 [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| **v2.5** | **残局挑战：新增共享模块 `shared/endgame.ts`（9 局经典杀法题库 + 强制将死求解器 `canForceMate` / `findMateMove`）；首页挂板新增「残局挑战」入口（5 → 6 入口，按钮按 43px 等比缩放铺满内框）；题库列表给出名称 / 难度 / 目标步数与通关标记，开局即本地对弈（AI 执玩家的对方、深度 4 防守），对局页残局操作行为「悔棋 / 提示 / 重来 / 离开」并新增残局目标信息块；在目标步数内将死即成功（超出步数 / 被将死则失败），通关记录存本机并显示「已通关 · N 步」；状态机新增 `Game.setup()` 以自定义局面开局** | 见 [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| **v2.6** | **残局功能优化：对局页残局操作行新增「下一关」（`nextPuzzle` 跳转题库下一局，最后一关自动隐藏、无解时提示）；残局面板新增「自检题库」（`endgame.ts` 增 `checkPuzzle` / `checkEndgameBank` 纯函数，逐条核验局面合法 / 目标步数内可解 / 步数最少，结果以弹层逐条列出）** | 见 [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| **v2.7** | **残局改为不限步数：把对方将死即挑战成功（不再按步数判负），题库给出的步数改为展示「最优步数」；「提示」改用 `minMateDepth` + `findMateMove` 给出当前局面仍能取胜的最快着法；列表新增状态标记——勾叉表示完成 / 失败 / 未完成（绿勾 / 红叉 / 白勾），外圈绿色表示已达成最优步数、灰色表示未达成；本机记录改为「取胜最少步数 + 是否曾失败」并兼容旧的数字格式** | 见 [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| **v2.8** | **对局动效：走子动画「抬起 → 移动 → 放下」（`board.ts` 增 `anim` / `moveAnimFrame` / 落影，`app.ts` 走子后按 rAF 在 460ms 内推进）；将军 / 绝杀在棋盘正中弹**提示条**（新增纯数据模块 `renderer/banner.ts`：18 种杀法各一套图案样式——五种底纹 + 强调色 + 徽记，未收录杀法回退兜底），显示 1.5s 渐入渐出（`banner-cycle`），`prefers-reduced-motion` 下不做走子动画、提示条去掉动效但保持可见** | 见 [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| **v2.9** | **走子动画改为「点击棋子抬起」：新增 `board.ts liftFrame()` 与 `BoardView.lifts`（原地升起 / 落下，抬高 + 放大 + 落影），`app.ts liftPiece()` / `lowerAllLifts()` 绑定选中与取消（同一时刻只抬起一枚，`LIFT_MS = 200ms`）；走子时该子已在抬起态，`animateMove(from, to, startLifted)` 直接从平移开始、落点再放下（对手 / AI 走子仍是完整三段）；联机点击落点后保持抬起等待服务器确认，被拒则落回；抬起与走子共用一条 rAF 帧循环，保持抬起时停帧不空转；`prefers-reduced-motion` 下不做抬起动画（选中仍以压暗 + 落点框表达）** | 见 [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| **v2.9** | **吃子展示改造：删除侧栏「红方吃子 / 黑方吃子」文字面板，改为棋盘两侧的三栏结构（左 = 红方所吃 / 右 = 黑方所吃），被吃掉的子以素材缩略图统一置灰（`filter: grayscale(1) opacity(0.55)`）实时摆到棋盘旁；吃子条随棋盘高度拉伸并纵向居中，左右对称保证棋盘居中** | 见 [ADR-0007 §3.5.6](./adr/0007-renderer-ui.md) |
| **v2.9** | **自建残局：残局面板新增「自建残局」编辑器（新增渲染模块 [endgame-editor.ts](../src/renderer/endgame-editor.ts)：棋盘摆子 + 右侧「局面」面板（初始局面 / 清空 / 红黑互换）+ 棋盘下方棋子栏 + 红先 / 黑先）；保存时**自动核验**（`checkCustomEndgame`：局面合法 + 求解器在 4 步内求出最优步数），不通过则逐条列出问题；自建残局存本机，与内置题库同列表（「自建」徽章 + 编辑 / 删除），通关记录与开局流程完全复用；原「自检题库」手动入口移除** | 见 [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| **v2.10** | **吃子提示：新增共享纯模块 `shared/tactics.ts`（`captureHints` / `profitableTargets` / `PIECE_VALUE`）——从本端视角算出「可获利吃掉的对方棋子」（无根白吃或小换大）与「会被对方吃掉的己方棋子」；棋盘为前者画绿环、后者画红环（`BoardView.capture`，半径 `disc/2 + 4`）；对局侧栏新增「吃子提示」切换按钮（默认关闭，开启后金色实底强调），结果仅在 `render()` 时重算** | 见 [ADR-0009 §3.13](./adr/0009-c-d-extensions.md) |
| **v2.10** | **界面布局：去掉「邀请玩家 / 邀请观战」按钮与邀请弹层，邀请列表改为常驻展示——等待页改为两栏 `.wait-layout`（左栏等待信息 + 右栏邀请列表面板），对局页在棋盘侧栏内嵌同款面板（标题 + 刷新 + 列表，窄栏限高可滚动）；进入房间即拉取一次、等待页与对局页每 5s 自动刷新、并保留手动「刷新」；列表规则沿用 v2.2（在线且在大厅者置顶可一键邀请、对局中 / 离线者置灰无按钮）** | 见 [ADR-0010 §12](./adr/0010-room-server.md) |
| **v2.10** | **提示特效升级：将军 / 绝杀的正中提示由圆角卡片改为**黑色大圆**——圆中「将军」白字 / 「绝杀」红字，绝杀另有一条暗红斜线自右上方穿过黑圈到右下方；**被将军的将/帅颤抖**（Canvas 抖动位移，叠加原红色脉冲环）；新增**战术特效**——闪击 / 闪将 / 将军抽（马 / 车 / 炮）/ 串打 / 捉双（新增共享纯函数模块 [tactics.ts](../src/shared/tactics.ts)：基于「让线」与「新攻击」判定，优先级只出最高 1 条），其文字置于**棋盘上方**（`.board-stage` 顶部提示条），**被威胁的敌方棋子周围画闪电**（`BoardView.threats` → `BoltOp`）；新增**开局招法提示**（[openings.ts](../src/renderer/openings.ts)：按红方首着记谱识别「当头炮 / 起马局 / 飞相局 / 仙人指路 / 士角炮 / 过宫炮」）；`prefers-reduced-motion` 下闪电与颤抖不做动效、信息仍保留** | 见 [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| **v2.11** | **长将 / 长捉 / 重复局面裁决：新增共享纯模块 `shared/repetition.ts`（`positionKey` 局面键、`classifyMove` 每手性质「将 / 捉 / 闲」、`judgeRepetition` 三次重复裁决，复用 `tactics.ts` 的 `profitableTargets` 判定「捉」）；`game.ts` 记录 `posKeys` / `moveNatures` 并在走子后触发裁决，`undo` / `reset` / `setup` 同步回退与清空；恰好一方「长打」→ `长将判负` / `长捉判负` / `长打判负`，双方都长打或都不是 → `重复局面判和`（`GameOverReason` 新增四种文案，终局随 `game_over` 广播与落库）** | 见 [ADR-0002 §3.7](./adr/0002-rules-engine.md)、[ADR-0004 §3.6](./adr/0004-game-state-machine.md) |
| **v2.11** | **复盘 AI 推荐改造：AI 推荐由「打开复盘即自动请求」改为**点侧栏「AI推荐」按钮才显示**——棋盘画**从原棋子指向推荐落点的箭头 + 蓝色落点标记**（半透明蓝盘压在落点上、外圈亮蓝环，起点细蓝环标出原棋子；`board.ts` 新增 `ArrowOp` / `DiscOp` / `HINT_COLOR` / `arrowSegment()`）；**点棋盘上的蓝色落点或「后续变化」按钮**即请求新增的 `GET /api/ai/line`（`room.ts lineFor()` 连续推演 4 手，首手即推荐着法），着法列成可点列表并预览到变化末端（点某行预览到该手、「回到当前」退出）；新增**「试下」自由走子**：以当前复盘局面为起点点自己的子 → 亮合法落点 → 走子（红先交替，本端 `cloneBoard` 推演，不改动记录），可「悔一步 / 重来 / 退出试下」** | 见 [ADR-0009 §3.10](./adr/0009-c-d-extensions.md) |
| **v3.0** | **AI 引擎更换为皮卡鱼（Pikafish）：新增共享换算层 `shared/uci.ts`（棋盘 ↔ 中国象棋 FEN、项目坐标 ↔ UCI 方格、`bestmove` 解析）与引擎端口 `shared/engine.ts`（`EnginePort` + 难度档位 + 纯 TS 回退）、Node 侧 `server/pikafish.ts`（常驻单进程 + 串行请求队列 + 空闲回收 + 崩溃重启 + 引擎发现）与 `server/engine-select.ts`（优先皮卡鱼、失败回退）；服务端 AI 房间与复盘 AI 推荐改用引擎，新增 `POST /api/ai/move` 供渲染层本地人机 / 残局防守取着法（由承载页面的 Node 服务器代跑引擎）；引擎输出一律经 `validateMove` 复核；难度 `depth 1..4` 映射到 `Skill Level` + `go movetime`；打包由 electron-builder 的 `extraResources` 把引擎 + 权重直接放到 `resources/dist/engine`（asar 之外，无需 `asarUnpack`，也不必手工复制）；本机无引擎时全链路自动回退纯 TS** | 见 [ADR-0011](./adr/0011-pikafish-engine.md) |
| **v3.0** | **揭棋（暗棋）：新增共享纯模块 `shared/jieqi.ts`（洗子 `dealBoard` / 起始兵种 `startTypeAt` / 翻子 `revealAt` / 公开快照抹除 `redactBoard`）；`Piece` 增加 `hidden` / `real` / `free`，`t` 始终为「当前生效走法兵种」；`rules.ts` 支持翻开的士 / 相出九宫 / 过河、`cloneBoard` 保留新字段；`Game` 增加 `variant` / `openJieqi()` / 吃子记录 / 快照天然抹除；入口**不改首页挂板**——人机对弈面板增「标准象棋 / 揭棋（暗棋）」单选、创建房间面板增「揭棋房间」勾选；棋盘新增程序化暗子背面（`BackOp`）；双人揭棋房间与本地人机揭棋共用同一套规则，**揭棋不计入对局回顾** | 见 [ADR-0012](./adr/0012-jieqi.md) |
| **v3.1** | **战术判定修正 + 提示特效调优：新增 `mustLoseOne()`（`shared/tactics.ts`）——将军抽 / 串打 / 捉双统一要求「两者必然失去其一」：逐个模拟对方的每一种合法应着，走动的子仍须至少攻击到被威胁子中的一枚（且自身未被反吃），据此排除「被威胁子反吃攻击子」「垫子挡住射线」「移走炮架」等能两全的伪战术；串打并要求前 / 后两子都价值 ≥马。将军颤抖幅度由 `0.06×格距` 减半为 `0.03×格距` 并在 `SHAKE_MS = 1100ms` 内线性衰减到 0（不再一直抖，每次新将军重新起算）；将军 / 绝杀正中提示由 1.5s 延长至 **2.5s**（`BANNER_MS` + `banner-cycle` 同步） | 见 [ADR-0007 §3.5.5 / §3.5.7](./adr/0007-renderer-ui.md) |
| **v3.2** | **复盘 / 战术 / 难度修正**：① **复盘 AI 推荐与后续变化首手一致**——`/api/ai/line` 新增 `first=fr,fc,tr,tc`，客户端把已显示的推荐着法回传，`lineFor()` 合法时直接作为首手（皮卡鱼按思考时限取着法、两次独立查询可能不同，故必须复用）；复盘固定 `depth=5` 保推荐质量。② **绝杀暗红斜线改为「左上→右下」对角**（`#banner-slash` 居中 `rotate(-45deg)`）。③ **人机难度改回「入门 / 菜鸟 / 中级 / 高手」用纯 TS**（`engine-select.ts` `LevelRouter` 按难度分派），**新增最高档「棋圣」走皮卡鱼**（`EngineLevel` 1..5、`LEVEL_PARAMS` 补 5 档；引擎缺失时「棋圣」回退纯 TS）。④ **战术「两者必然失去其一」改为获利口径**（`mustLoseOne` 目标须**无根**或**小换大**）——有根且非小换大的棋不再判为必失 | 见 [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md)、[ADR-0009 §3.3 / §3.7 / §3.10](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| **v3.3** | **串打漏报 / 残局死子 / 长杀核验修正**：① **串打等战术撤销「获利口径」**——`tactics.ts mustLoseOne` 回到「两者必然失去其一」（对方任一应着后走动的子仍须攻击到被威胁子中的至少一枚；被威胁子是否有根不再影响判定），修复真串打不提示的漏报。② **吃子条改由权威状态机驱动**——`Game.snapshot()` 对标准 / 揭棋 / 残局 / 人机**一律下发** `capturedByRed/Black`，`room.ts` 走子广播同步携带，`app.ts renderCaptured()` 直接采用（不再按着法序列从标准开局推导），修复残局自定义开局下推出的「莫名死子」。③ **吃子条放大并保留红 / 黑原色**（`.cap-piece` 34px、去掉 `grayscale/opacity`）。④ **自建残局核验上限 4 → 50 步**（`CUSTOM_CHECK_MAX`），求解移到 **Web Worker**（`renderer/endgame-worker.ts`，编辑器保存时按钮显示「核验中…」、不阻塞界面；`checkCustomEndgame` 增求解预算 `CUSTOM_CHECK_BUDGET_MS`，超预算或 50 步内无强制杀法即逐条列「无杀法」） | 见 [ADR-0007 §3.5.6 / §3.5.7](./adr/0007-renderer-ui.md)、[ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| **v3.4** | **吃子提示「将守护」判定 + 战术元素放大**：① **吃子提示的「有根」判定带上进攻子**——`profitableTargets` 记住每个落点**最便宜的合法攻击者位置**，`isDefended(board, enemy, at, byPos)` 把该进攻子搬到 `at` 再判对方能否回头反吃（进攻子原格清空，避免它在「将吃回后是否被将军」的判定里被重复计入）；**将 / 帅作保护者时要求吃回合法**——吃回后自身不能被将军（送将 / 照面非法），若将 / 帅是唯一保护者且吃回会被将军则该子**按无根处理**（绿环 = 可吃 / 红环 = 有险照常标出）；除将 / 帅外的保护子仍按伪合法走法（不考虑牵制）。② **战术元素放大**——棋盘上方提示条 `#board-tactics` `font-size: 21px` / `letter-spacing: 5px` / `padding: 10px 26px`（小屏 17px / 6px 16px）；战术闪电基准半径 `disc/2 + 12`、`lineWidth: 3`、`shadowBlur: 12` | 见 [ADR-0009 §3.13](./adr/0009-c-d-extensions.md)、[ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| **v3.5** | **人机对弈可选执红 / 执黑（本地）**：首页「人机对弈」面板在棋种与难度之间新增「**我执红（先行）/ 我执黑（后行）**」单选（默认执红）；`createAiRoom()` 以 `aiSideChoice()` 决定 `S.side`，`localAiSide()` 取玩家的对方（我执红 → AI 黑，我执黑 → AI 红），开局后立即 `scheduleLocalAi()`，故**选黑时由 AI（红方）先行**；棋盘随 `S.side` 翻转、侧栏角色提示显示「你执红 / 黑 · AI 执黑 / 红」、本地悔棋回到**本方**回合（原先写死回红方回合，我执黑时改为回黑方回合）。服务端 AI 房间（协议保留）仍为人类执红 | 见 [ADR-0009 §3.7](./adr/0009-c-d-extensions.md) |
| **v3.5** | **战术提示严格判定重构（`shared/tactics.ts` 的 `detectTactics`）**：按「**先看是否照将**」分支——照将走「闪将 / 将军抽」（**只将军 = 闪将**；**将军 + 捉大子 = 将军抽**），不照将走「串打 / 捉双 / 闪击」。**将军抽**的将军来源可为**闪将**（让线露出后方子力照将）、被抽子可为被让线后方子力或**将后同线大子**（`behindKingVictim()`：对方应将、将移开该线后即落入照将直线子的攻击口——经典抽将），抽将用 `unavoidablyLost()`（**我方任意子**攻击到即可）。**串打 / 捉双**用 `mustLoseOne()`（走动的这枚子）验证**「两者必然失去其一」**（新增排除「移子**蹩马腿**同时挡将」等能两全的伪战术）；**捉双仅「一子捉双」**（不含「两子分捉」） | 见 [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| **v3.5** | **战术获利口径 + 重复局面不判和**：① `unavoidablyLost()` / `mustLoseOne()` 在「两者必然失去其一」之上再加「**能获利吃到**」——被威胁子须能按 `profitableTargets` 口径（无根白吃 / 小换大）被我方在**对方的每一种应着之后**吃到；有根且不划算的伪战术（如「将军抽有根的炮」）不再提示，串打 / 捉双一并适用（统一恢复 v3.3 撤销的获利口径）。② **三次重复在无人长打时不再判和**——`judgeRepetition` 返回 `{ outcome: 'hint', reason: '请变招' }`，`Game` 置位 `repetitionHint`（随 `snapshot()` / `move_applied` 广播下发），渲染层状态框显示「重复局面 · 请变招」并弹一次轻提示（对局继续，悔棋 / 重开同步清除） | 见 [ADR-0002 §3.7](./adr/0002-rules-engine.md)、[ADR-0004 §3.6](./adr/0004-game-state-machine.md)、[ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| **v3.7** | **提示与编辑器精修**：① **将军 / 绝杀正中提示改为纯文字**——去掉黑色圆底、圆框、暗红斜线与下方小字描述；大字改用楷体加粗（`--font-chess`），将军为「将军」、**绝杀直接显示具体杀法名**（如「马后炮杀」）。② **战术提示改黑色方框**——棋盘上方 `#board-tactics`（闪击 / 闪将 / 将军抽 / 串打 / 捉双 / 开局）改为纯黑方框 + 同款楷体加粗。③ **自建残局编辑器**——棋子栏改用与棋盘同款的皮肤棋子素材，右上角显示**剩余可摆枚数**（标准枚数上限 − 盘上已有，0 枚置灰且不可拖入），交互改为**拖拽**：从棋子栏拖入棋盘、盘内拖动调位、拖出棋盘即拿走（右键仍可拿走） | 见 [ADR-0007 §3.5.5 / §3.5.7](./adr/0007-renderer-ui.md)、[ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| **v3.8** | **提示字样统一 + 残局杀法示例**：① **开局提示只给名称**——`openings.ts` 的名称去掉括号别名（「当头炮」「起马局」等），棋盘上方提示条不再加「开局：」前缀。② **绝杀字样统一为纯杀法名**——`CheckmatePattern.label` 与 `name` 一致，不再追加「杀」字（钓鱼马 / 列马车 / 卧槽马 / **八脚马**（原「八角马」）/ 侧面虎 / 马后炮 / 天地炮 / 夹车炮 / 重炮 / 对面笑 / 闷宫 / 闷杀 / 双车错 / 海底捞月 / 铁门栓 / 双将）；**新增「困毙」终局条目**（`KUNBI_PATTERN`，未被将军但无子可走时正中同样显示「困毙」，对局页 / 复盘杀法框给出定义）。③ **残局题库 9 → 21 局**——为清单中的各杀法补一步杀示例（钓鱼马 / 列马车 / 八脚马 / 侧面虎 / 马后炮 / 天地炮 / 夹车炮 / 困毙 / 闷宫 / 闷杀 / 铁门栓 / 双将），全部由求解器校验「一步可强制取胜」 | 见 [ADR-0007 §3.5.5 / §3.5.7](./adr/0007-renderer-ui.md)、[ADR-0009 §3.11 / §3.12](./adr/0009-c-d-extensions.md) |
| **v3.9** | **八脚马构图修正 + 提示条上移放大**：① **八脚马（八角马）改为正确定式**——马占对方九宫的一个士角、将（帅）在斜对的另一个宫角（相隔宫心），马正好控住将（帅）的两条退路，再由车 / 炮 / 兵将死（此前误判为「马与将斜向相邻」）；残局示例与用例同步改成图片构图（红马 (0,3)、黑将 (2,5)、红车平二路照将）。② **战术 / 开局提示移到棋盘上方并放大**——`#board-tactics` 从 `.board-stage` 内（`top: 6px`，压住棋盘上沿）移到画布之外的 `.board-tactics-slot`（棋盘正上方独占一行、`min-height: 64px` 常驻占位，出现 / 消失不推动棋盘），字号 21 → **30px**、字距 6px、内边距 `10px 36px`（小屏 22px），动画改为纵向轻移；对局页画布高度上限相应收为 `calc(100vh - 268px)` | 见 [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md)、[ADR-0009 §3.11 / §3.12](./adr/0009-c-d-extensions.md) |
| **v3.10** | **吃子提示 / 将军抽修正（「小换大」获利门槛）**：`shared/tactics.ts` 新增 `MIN_PROFIT = 1`——**有根的目标须比最便宜攻击者至少贵 1 分**才算「净赚」，吃子提示 `profitableTargets` 与多子战术的获利口径（`mustLoseOne`，串打 / 捉双 / 将军抽）同时生效。修复用户截图局面「红马照将并咬住有根黑炮（马 4 vs 炮 4.5，仅差 0.5 分）」被**误标绿环**并**误报「将军抽炮」**——马换炮这类几乎等值的交换按等价处理；兵吃车、马吃车等净赚 ≥1 分的真小换大不受影响 | 见 [ADR-0009 §3.13](./adr/0009-c-d-extensions.md)、[ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |

---

## 1. 文档导航

| 文档 | 内容 | 说明 |
|---|---|---|
| [Product-plan.md](./Product-plan.md) | 产品设计文档（v0.1） | 定位、范围、流程、验收标准 |
| [Technical-solution.md](./Technical-solution.md) | 技术方案（v1.0，主机权威时代基线） | 架构选型与总体设计；权威边界仍适用，进程形态见 ADR-0010 |
| [adr/](./adr/) | ADR 架构决策 + 模块详细规格（0001–0010） | **各功能入口的详细 spec，见第 5 节** |
| [Optimization-plan.md](./Optimization-plan.md) | 优化路线图（v1.3） | A–D 四档全部完成；分档列出现状问题、方案、代码落点与完成记录 |
| [Demo.html](./Demo.html) | 单文件界面原型 | 仅验证界面布局与操作流程，无真实网络 |

> 视觉素材（棋盘、棋子、按钮、音效）来自参考项目 [Reference/Chess](../Reference/Chess)（MIT 协议，
> 版权归原作者所有），许可随素材分发：[src/renderer/assets/LICENSE-ReferenceChess.txt](../src/renderer/assets/LICENSE-ReferenceChess.txt)。

---

## 2. 快速开始

```bash
npm install          # 安装依赖
npm run build        # 编译 TypeScript + 复制静态资源到 dist/
npm test             # 运行全部测试（vitest run）
npm run lint         # ESLint 检查
npm run format:check # Prettier 格式校验
npm run serve        # 启动中心服务器（无界面常驻；等价 npm run host）
npm start            # 以 Electron 客户端启动（默认连接服务器）
npm run dev          # 开发模式：tsc watch + 服务器自动重启 + 静态资源同步
npm run dist         # 产出 Windows 安装包（release/）；经 scripts/dist.mjs，默认走 npmmirror 镜像
```

局域网对战流程：

1. 在一台常开设备（NAS / 小主机 / 任一电脑）上运行 `npm run build && npm run serve`，
   控制台显示服务器地址，如 `http://192.168.1.42:7777`（账号与对局记录默认落盘到 `./data/`）。
2. 客户端**启动后先在「连接服务器」板块选择服务器**：板块会自动搜索局域网内可连接的服务器
   （并列出结果），也可手动输入 `主机:端口` 点「连接」；列表中已连接的服务器显示绿色、连接失败红色、未连接灰色。
   浏览器打开页面时该板块**锁定**为访问地址（灰色不可改）——因为浏览器访问的地址就是服务器地址。
3. 进入首页后点「创建房间」（可选设置房间口令）→ 进入等待页并得到 **6 位房间号**；
   对手点「加入房间」从**房间列表**中点击该房间即可加入（房间有口令时需输入口令），
   点「观战」无需口令即可只读旁观；等待页右栏与对局页棋盘侧栏都**常驻**玩家列表
   （等待阶段标题「邀请玩家」、开局后变为「邀请观战」，列表每 5s 自动刷新，也可点「刷新」手动拉取），
   点列表中「在线」玩家右侧的「邀请」即可把其拉进对局或观战（被邀请者免口令加入）。
4. 双方到齐自动开局；开赛前房主可在等待页用**下拉框**选择取先方式：猜先（默认）/ 随机黑红 / 房主执红 / 房主执黑
   （猜先由房主抓单双、对手猜，猜中者执红；**对手加入后双方直接进入棋盘界面，再在棋盘上抓子/猜单双**）。
5. 第三方观众从房间列表点「观战」即可只读旁观（不占席位）。
6. 单人可点首页「人机对弈」，先选棋种（**标准象棋 / 揭棋（暗棋）**）、**我执哪一方（我执红（先行）/ 我执黑（后行），默认执红）**与难度（**入门 / 菜鸟 / 中级 / 高手 / 棋圣**）后与 AI（执另一方；你执黑时 AI 执红先行）对弈——
   **1–4 档为纯 TS 引擎（皮卡鱼接入前的难度手感），第 5 档「棋圣」走皮卡鱼（Pikafish）**，
   **该模式不需要连接联机对局服务器（WebSocket）；AI 着法由承载页面的服务器调用皮卡鱼引擎代算，本机无引擎 / 离线时自动回退纯 TS 引擎**。
   选「揭棋」时除将帅外的棋子开局背面随机摆放（暗子），暗子首步按所在位置的兵种走并随即翻开（翻开的士 / 相可出九宫、过河）；
   **AI 也看不到任何暗子的真实身份**。
7. 对局结束后：若无人点「再来一局」，房间会自动销毁并释放房间号；首页「对局回顾」可查看历史对局
   （红黑方 / 取先方式 / 时间 / 胜负），顶部页签可切换「全部对局 / 我的历史」（我的历史按账号或本机最近一次身份过滤，
   请求的是**当前所选服务器**的记录）；点进某一局即可「下一步 ▶」逐步复盘并查看每个局面的 AI 推荐着法。
   **人机对局（本地或服务器 AI 房间）与揭棋对局均不计入对局回顾。**
8. 单人还可点首页「残局挑战」做杀法练习：面板里列出 21 局残局（入门 / 中等 / 困难，并给出每局「最优 N 步」；入门档为各经典杀法的一步杀示例），
   点一条即进入棋盘——你执红先行，AI（黑方）自动应招；**不限步数，把对方将死即挑战成功**（被对方将死 / 困毙则挑战失败）。
   列表每条带状态标记：**勾叉表示完成 / 失败 / 未完成（绿勾 / 红叉 / 白勾），外圈绿色表示已达成最优步数、灰色表示未达成**。
   侧栏「残局」信息块显示残局名、难度、最优步数与已用步数；棋盘下可用「悔棋 / 提示 / 下一关 / 重来 / 离开」
   （提示给出当前局面仍能取胜的最快着法；「下一关」直接跳到题库中的下一局，最后一关时按钮自动隐藏）。
   通关记录存在本机（取胜最少步数 + 是否曾失败）。**残局同样是本地对弈，不需要连接服务器，也不计入对局回顾。**
   面板底部的「自建残局」可自己摆一个局面：编辑器左侧是棋盘（下方两排棋子栏——先点一颗作画笔再点棋盘落子，右键可拿走棋子），
   右侧「局面」面板提供**初始局面 / 清空 / 红黑互换**，右下角用**红先 / 黑先**选择你执哪一方；点「保 存」时**自动核验**
   （局面合法且能在 50 步内强制将死对方；核验在后台线程求解，界面显示「核验中…」），不通过会逐条列出问题并留在编辑器，通过则按求出的**最优步数**入库；
   自建残局与内置题库同列表（「自建」徽章），行尾 `✎` 可再编辑、`✕` 可删除。
9. 双人也可下揭棋：创建房间时勾选「揭棋（暗棋）房间」，对手从房间列表（带「揭棋」标记）加入即可；
   开局服务器把双方除将帅外的棋子洗匀背面摆放，**双方与观战者都只能看到暗子的背面**（真实身份只留在服务器），
   走子后落点暗子翻开；翻开的士 / 相可出九宫 / 过河，其余与标准象棋一致（将死 / 困毙判负）。**揭棋对局不计入对局回顾。**

账号（可选）：点首页**右上角**的账号按钮（未登录时显示「登录 / 注册」，登录后显示用户名），
在弹出的面板中填写用户名与密码点「登 录」或「注 册」；登录后对局记录会归属账号，
并能凭账号在不同设备上恢复原席位。不登录也能以「游客」身份游玩。

环境变量：

| 变量 | 默认值 | 作用 |
|---|---|---|
| `LANSCHESS_PORT` | `7777` | 服务器监听端口；Electron 便携模式被占用时自动回退随机端口，CLI 显式指定时给出提示 |
| `LANSCHESS_DATA` | `<cwd>/data` | 账号与对局记录的持久化目录；设为 `off` 则仅内存 |
| `LANSCHESS_SERVER` | `127.0.0.1:7777` | Electron 客户端**优先尝试连接**的服务器地址（`host:port`，仍可在「连接服务器」板块改用其它服务器） |
| `LANSCHESS_TURN_MS` | `0` | 计时读秒：每回合限时毫秒数，`0` 表示不限时（如 `60000` = 每步 60 秒，超时判负） |
| `LANSCHESS_DEBUG` | 未设置 | 日志开关：未设置输出 info 打点；`1` 追加 debug 明细；`0` 全部关闭 |
| `LANSCHESS_ENGINE` | 未设置 | 设为 `off` 强制 AI 走纯 TS 引擎（不加载皮卡鱼；测试与无引擎环境用） |
| `PIKAFISH_PATH` | 未设置 | 显式指定皮卡鱼引擎可执行文件路径（优先于自动发现） |
| `PIKAFISH_NNUE` | 未设置 | 显式指定权重 `pikafish.nnue` 路径（默认由引擎在同目录自寻） |
| `ELECTRON_MIRROR` | `npmmirror` | 打包时 Electron 发行包下载源；`npm run dist` 已默认指向 npmmirror，设置后可换源（如内网镜像） |
| `ELECTRON_BUILDER_BINARIES_MIRROR` | `npmmirror` | 打包工具（winCodeSign / nsis 等）下载源；同上 |

---

## 3. 总体架构

```text
┌──────────────────────────────────────────────────────────┐
│                中心服务器（node dist/server，纯托管）       │
│                                                          │
│  Server         HTTP 静态资源 + /api/* + WebSocket /ws    │
│  RoomManager    Map<roomId, Room>：建房 / 路由 / 空闲回收  │
│  Room           Game 权威状态机 + rules + AI + 计时 + 记录  │
│  AccountStore   最简账号（scrypt 加盐 + token）            │
│  HistoryStore   对局记录跨房间集中保存                      │
│                 ↓ 落盘 data/users.json、data/history.json  │
└────────────────────────────┬─────────────────────────────┘
                             │ WebSocket（JSON）
        ┌────────────────────┼────────────────────┐
        │                    │                    │
  ┌─────▼─────┐        ┌─────▼─────┐        ┌─────▼─────┐
  │  玩家 A   │        │  玩家 B   │        │  观战者   │
  │ 浏览器/   │        │ 浏览器/   │        │  只读     │
  │ Electron  │        │ Electron  │        │           │
  └───────────┘        └───────────┘        └───────────┘
```

> v2.0 架构迁移：原「主机即服务器」的 `HostServer` 拆分为
> [server.ts](../src/server/server.ts)（多房间服务器）与 [room.ts](../src/server/room.ts)（单局房间），
> 并新增 [accounts.ts](../src/server/accounts.ts)、[history.ts](../src/server/history.ts)、
> [conn.ts](../src/server/conn.ts)、[server-main.ts](../src/server/server-main.ts)
> —— 详见 [ADR-0010](./adr/0010-room-server.md)。
>
> v1.3 新增模块：渲染层局域网服务器发现（现 [discover.ts](../src/renderer/discover.ts)，v2.1 起充当
> 「连接服务器」板块的搜索后端）、服务端 [log.ts](../src/server/log.ts)（服务器日志）、
> 共享层 [notation.ts](../src/shared/notation.ts)（中文记谱）——详见 [ADR-0009](./adr/0009-c-d-extensions.md)。
>
> v1.4 前端视觉改造：渲染层棋盘改为 **Canvas + 图片素材**（[board.ts](../src/renderer/board.ts)），
> 新增音效 [sound.ts](../src/renderer/sound.ts) 与素材目录 [assets/](../src/renderer/assets/)——详见 [ADR-0007](./adr/0007-renderer-ui.md)。
>
> v2.1：`game.ts` / `ai.ts` 从 `server/` 上移到 `shared/`（客户端本地人机对弈与复盘推荐复用同一份纯 TS 实现）；
> 新增渲染层 [servers.ts](../src/renderer/servers.ts)（服务器地址解析 / 网段推导 / 客户端形态判定）——详见 [ADR-0010 §9](./adr/0010-room-server.md)。

核心原则（详见 [ADR-0001](./adr/0001-host-authoritative-architecture.md) 与 [ADR-0010](./adr/0010-room-server.md)）：

- **服务器权威**：唯一真实棋盘在服务器进程的某个 `Room.game` 中，规则校验与胜负判定都在服务器完成；
  服务器**不占任何玩家席位**（纯托管），因此玩家无法通过修改客户端作弊。
- **客户端请求**：客户端只发送走子「意图」，服务器校验后广播结果。
- **房间隔离**：每个房间一份权威 `Game`，并发多盘互不影响；`roomId` 是一等概念。
- **规则引擎与 UI 分离**：`rules.ts` 为纯 TS 模块，不依赖 DOM / 网络，可独立单测。
- **简单同步**：每步广播完整棋盘快照，带单调递增 `seq`。

---

## 4. 功能模块化总览

代码分为共享层、服务端、渲染层与进程入口，依赖方向单向、无环：

```text
shared（协议/规则/类型，无环境依赖）
   ▲                      ▲
   │                      │
server（中心服务器）    renderer（浏览器页面）
   ▲                      ▲
   │                      │
main / server-main（进程入口，装配 server 与页面）
```

| # | 模块 | 职责 | 代码入口 | 详细规格 |
|---|---|---|---|---|
| 1 | 规则引擎 | 走法生成、送将过滤、将军/将死/困毙判定 | [rules.ts](../src/shared/rules.ts)、[types.ts](../src/shared/types.ts) | [ADR-0002](./adr/0002-rules-engine.md) |
| 2 | 通信协议 | 客户端/服务端消息定义、编解码、共享数据结构 | [protocol.ts](../src/shared/protocol.ts)、[types.ts](../src/shared/types.ts) | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0010](./adr/0010-room-server.md) |
| 3 | 对局状态机 | 权威棋盘状态、走子校验链、认输/和棋/重开/超时、**重复局面裁决触发**（服务端房间与客户端本地人机共用） | [game.ts](../src/shared/game.ts) | [ADR-0004](./adr/0004-game-state-machine.md) |
| 4 | 中心服务器 | HTTP 静态服务 + API、WebSocket 路由、房间表、空闲回收、局域网 IP 发现 | [server.ts](../src/server/server.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 5 | 房间 | 席位、先手方式、猜先、断线宽限、读秒、人机对战、终局落库与销毁倒计时 | [room.ts](../src/server/room.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 6 | 连接对象 | WebSocket 连接与房间 / 角色 / 玩家身份的最小视图 | [conn.ts](../src/server/conn.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 7 | 账号系统 | 注册 / 登录 / token（scrypt 加盐），落盘 `data/users.json` | [accounts.ts](../src/server/accounts.ts) | [ADR-0010 §3.10](./adr/0010-room-server.md) |
| 8 | 对局记录 | 跨房间集中保存、防抖落盘、损坏降级 | [history.ts](../src/server/history.ts) | [ADR-0010 §3.8](./adr/0010-room-server.md) |
| 9 | 进程入口 | Electron 客户端、常驻服务器入口、构建脚本 | [main.ts](../src/main/main.ts)、[server-main.ts](../src/server/server-main.ts)、[copy-assets.mjs](../scripts/copy-assets.mjs) | [ADR-0006](./adr/0006-process-entries.md) |
| 10 | 渲染层 | 页面流转、棋盘 Canvas 渲染与交互（含走子动画 / 被将军的将颤抖 / 被威胁棋子闪电）、正中纯文字大字提示（将军 / 绝杀杀法名，楷体加粗）、棋盘上方战术与开局提示条（黑色方框 + 楷体）、三套皮肤与音效、服务器选择 / 房间 / 账号 UI、对局回顾与复盘、本地人机对弈（可选执红 / 执黑）、WebSocket 客户端与心跳、服务器搜索 | [app.ts](../src/renderer/app.ts)、[board.ts](../src/renderer/board.ts)、[banner.ts](../src/renderer/banner.ts)、[openings.ts](../src/renderer/openings.ts)、[review.ts](../src/renderer/review.ts)、[sound.ts](../src/renderer/sound.ts)、[net.ts](../src/renderer/net.ts)、[servers.ts](../src/renderer/servers.ts)、[discover.ts](../src/renderer/discover.ts)、[index.html](../src/renderer/index.html) | [ADR-0007](./adr/0007-renderer-ui.md)、[ADR-0009](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 11 | 测试体系 | 单元测试、服务端集成测试、完整对局端到端回放 | [tests/](../tests/) | [ADR-0008](./adr/0008-testing-strategy.md) |
| 12 | 记谱 / AI / 日志 | 中文记谱与吃子；**AI 引擎接口 `EnginePort`（皮卡鱼 UCI 原生引擎优先，纯 TS negamax 自动回退）**、难度档位（1 入门 / 2 菜鸟 / 3 中级 / 4 高手）、棋盘 ↔ 中国象棋 FEN / UCI 方格换算；`LANSCHESS_DEBUG` 日志 | [notation.ts](../src/shared/notation.ts)、[ai.ts](../src/shared/ai.ts)、[engine.ts](../src/shared/engine.ts)、[uci.ts](../src/shared/uci.ts)、[pikafish.ts](../src/server/pikafish.ts)、[engine-select.ts](../src/server/engine-select.ts)、[log.ts](../src/server/log.ts) | [ADR-0009 §3.3](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 13 | 杀法识别 | 将死时判定具体杀法（**19 种**经典杀法 + 兜底「将死」）、给出杀法名与解说；定义按《象棋杀法与局面状态严格判定》收紧（新增「列马车」；「对面笑」＝白脸将；「八脚马」＝八角马 / 定将马；清单外的大刀剜心 / 双马饮泉 / 挂角马为附加条目）；**v3.8 起展示名就是纯杀法名**（不再追加「杀」字），并单独导出 **`KUNBI_PATTERN`（困毙）** 供终局展示；服务端落库与客户端展示共用 | [checkmate.ts](../src/shared/checkmate.ts) | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 14 | 残局挑战 | 内置经典杀法题库（**21 局**，入门 – 困难；v3.8 起为绝杀字样清单各补一道一步杀示例，含困毙）+ 强制将死求解器与最快取胜步数 `minMateDepth`；本地对弈（**不限步数，将死即胜**）、提示（最快取胜着法）/ 悔棋 / 下一关 / 重来、最优步数展示、列表状态标记、本机胜负记录；**自建残局**（编辑器摆子 + 保存时自动核验并求出最优步数，与内置题库同列表、可编辑 / 删除，存本机） | [endgame.ts](../src/shared/endgame.ts)、[endgame-editor.ts](../src/renderer/endgame-editor.ts) | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 15 | 吃子提示 | 从本端视角算出「可获利吃掉的对方棋子」（**无根白吃 / 明显小换大——净赚 ≥1 分**）与「会被对方吃掉的己方棋子」；棋盘分别画绿环 / 红环，侧栏可一键开关。**「有根」判定带上进攻子**，且**将 / 帅作保护者时须能合法吃回**（吃回被将军则该子按无根处理）。**v3.10 起马换炮（4 vs 4.5，仅差 0.5 分）不再算小换大** | [tactics.ts](../src/shared/tactics.ts) | [ADR-0009 §3.13](./adr/0009-c-d-extensions.md) |
| 16 | 战术识别 | 走子后识别闪击 / 闪将 / 将军抽（马 / 车 / 炮）/ 串打 / 捉双，给出被威胁棋子（供闪电）与标签；以「让线」与「新攻击」降低误报，仅输出优先级最高的 1 条；纯函数、不改动传入棋盘。**v3.4 起战术元素放大**（棋盘上方提示条字号加大、闪电半径加大）；**v3.6 起闪击须「双向双威胁」**（移开的棋子自身也要捉到大子），**将军抽只认本步新造的获利威胁**（走子前就白吃着的子不抽——原本就有的攻击 + 任意一步将军不再误报） | [tactics.ts](../src/shared/tactics.ts) | [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| 17 | 重复局面裁决 | 三次重复局面（棋盘布局 + 行棋方）的长将 / 长捉 / 长打判定与不变作和；局面键 `positionKey`、每手性质「将 / 捉 / 闲」`classifyMove`、裁决 `judgeRepetition` | [repetition.ts](../src/shared/repetition.ts) | [ADR-0002 §3.7](./adr/0002-rules-engine.md) |
| 18 | 开局提示 | 按红方首着的中文记谱识别开局名（当头炮 / 起马局 / 飞相局 / 仙人指路 / 士角炮 / 过宫炮；**只给名称，无括号别名、无「开局：」前缀**），仅标准开局使用 | [openings.ts](../src/renderer/openings.ts) | [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| 19 | 揭棋（暗棋） | 洗子开局（`dealBoard` / `startTypeAt`）、暗子首步按起始兵种并翻开（`revealAt`）、翻开的士 / 相越九宫河界（`Piece.free`）、公开快照抹除真实身份（`redactBoard`）；双人揭棋房间与本地人机揭棋共用同一套规则与状态机 | [jieqi.ts](../src/shared/jieqi.ts) | [ADR-0012](./adr/0012-jieqi.md) |

---

## 5. 功能入口

按用户可见功能列出入口链路：**UI 触发点 → 客户端处理 → 服务端处理 → 规则/状态判定**，
每一行末尾为对应的详细规格（ADR）。

| 功能 | UI 触发点 | 实现入口（代码） | 详细 spec |
|---|---|---|---|
| 连接服务器（选服务器） | 启动后首屏「连接服务器」板块：自动搜索结果 + 手动输入地址 +「连接」 | [app.ts `openServersScreen()` / `connectServer()` / `renderServers()`](../src/renderer/app.ts) → [servers.ts `parseAddress()`](../src/renderer/servers.ts) → [discover.ts `probeServer()` / `discoverSubnet()`](../src/renderer/discover.ts) | [ADR-0010 §9.1](./adr/0010-room-server.md) |
| 浏览器锁定服务器 | 浏览器打开页面时（无 `client=electron` 参数） | [app.ts `connectLockedServer()`](../src/renderer/app.ts)（地址=访问地址，输入与按钮禁用，行显示绿色） | [ADR-0010 §9.1](./adr/0010-room-server.md) |
| 创建房间 | 首页「创建房间」→ 子面板填口令 →「创建房间」 | [app.ts `createRoom()`](../src/renderer/app.ts) → WS `create_room` → [server.ts `handleCreateRoom()`](../src/server/server.ts) → [room.ts `joinPlayer()`](../src/server/room.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 房间口令（可选） | 创建房间子面板的「房间口令（可选）」 | [app.ts `createRoom()`](../src/renderer/app.ts)（随 `create_room.password` 提交）→ [server.ts](../src/server/server.ts#L383-L392)；等待页可用 `set_password` 修改 | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 加入房间（房间列表） | 首页「加入房间」→ 房间列表 | [app.ts `showJoin()` / `refreshRooms()` / `renderRoomList()` / `pickRoom()`](../src/renderer/app.ts) → WS `list_rooms` → [server.ts `listRooms()`](../src/server/server.ts)；无口令点击即入，有口令先填口令再「加入房间」 | [ADR-0010 §3.3 / §9.3](./adr/0010-room-server.md) |
| 观战（只读） | 房间列表每行「观战」（**无需口令**）或手填房间号后「观 战」 | `join_room{role:'spectator'}` → [room.ts `joinSpectator()`](../src/server/room.ts) → [app.ts `joinRoom()`](../src/renderer/app.ts) | [ADR-0009 §3.5](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 邀请玩家 / 邀请观战 | 等待页**右栏** / 对局页**棋盘侧栏**常驻的玩家列表（标题「邀请玩家」，开局后变为「邀请观战」；进入房间拉取 + 每 5s 自动刷新 +「刷新」按钮）→ 点击某行「邀请」 | [app.ts `renderInvitePanel()` / `refreshInviteList()` / `renderPlayerList()` / `sendInvite()`](../src/renderer/app.ts) → WS `list_players` / `invite_player` → [server.ts `playerList()` / `handleInvite()`](../src/server/server.ts) → 被邀请者弹层接受 → `join_room`（[room.ts `isInvited()`](../src/server/room.ts) 免口令） | [ADR-0010 §9.4 / §10 / §12](./adr/0010-room-server.md) |
| 账号注册 / 登录（可选） | 首页**右上角**账号按钮 → 面板用户名 + 密码 →「登 录」/「注 册」（登录后按钮显示用户名） | [app.ts `openAccountPanel()` / `doAuth()`](../src/renderer/app.ts) → WS `register` / `login` 或 `POST /api/auth/*` → [accounts.ts](../src/server/accounts.ts) | [ADR-0010 §3.10](./adr/0010-room-server.md) |
| 取先方式（下拉框，默认猜先） | 等待页「取先方式」下拉框（猜先 / 随机黑红 / 房主执红 / 房主执黑） | [app.ts `chooseFirst()` / `renderSidePick()`](../src/renderer/app.ts) → `choose_first` → [room.ts `maybeStart()` / `beginFirst()`](../src/server/room.ts) | [ADR-0009 §3.9](./adr/0009-c-d-extensions.md)、[ADR-0010 §10](./adr/0010-room-server.md) |
| 猜先（房主抓、对手猜） | 双方加入后**直接进入棋盘界面**：房主弹层「抓单 / 抓双」→ 对手弹层「猜单 / 猜双」 | `grasp` → `guess` → [room.ts `beginFirst()`](../src/server/room.ts) → 广播 `first_result`（猜中者执红）→ 逐连接 `start{side}` | [ADR-0009 §3.9](./adr/0009-c-d-extensions.md) |
| 自动开局 | 双方到齐后由服务器触发 | [room.ts `afterJoin()` / `maybeStart()` / `startGame()`](../src/server/room.ts) → 广播 `start` | [ADR-0010](./adr/0010-room-server.md) |
| 复制房间号 | 等待页点击房间号块（`ip-box`） | [app.ts `copyRoomNo()`](../src/renderer/app.ts)（非安全上下文降级 `execCommand`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 走子（选子/落点/发送） | 点击棋盘 | 联机：[app.ts `onCell()`](../src/renderer/app.ts) → `move` → [room.ts `applyAndBroadcast()`](../src/server/room.ts) → [game.ts `applyMove()`](../src/shared/game.ts)；本地人机：`localMove()` → [shared/game.ts](../src/shared/game.ts) | [ADR-0002](./adr/0002-rules-engine.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 规则裁判（将军/将死/困毙） | 走子后自动判定 | [rules.ts `judgeAfterMove()`](../src/shared/rules.ts)、[`validateMove()`](../src/shared/rules.ts) | [ADR-0002](./adr/0002-rules-engine.md) |
| 重复局面裁决（长将 / 长捉 / 长打判负 · 不变作和） | 走子后自动判定（同一局面第 3 次出现时触发） | [game.ts `applyMove()`](../src/shared/game.ts)（记录局面键与每手「将 / 捉 / 闲」性质）→ [repetition.ts `positionKey()` / `classifyMove()` / `judgeRepetition()`](../src/shared/repetition.ts)（「捉」复用 [tactics.ts `profitableTargets()`](../src/shared/tactics.ts)）→ 终局广播 `game_over` 并落库 | [ADR-0002 §3.7](./adr/0002-rules-engine.md)、[ADR-0004 §3.6](./adr/0004-game-state-machine.md) |
| 将军/将死高亮与颤抖 | 走子后自动 | [board.ts `computeDrawList()`](../src/renderer/board.ts)（被将军一方的将/帅红色脉冲警示环；`BoardView.kingShake` 使其抖动位移，`app.ts` 按 `performance.now()` 生成偏移、`syncPulse()` 约 40ms 重绘） | [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| 吃子提示（绿环 = 可吃 / 红环 = 有险） | 对局侧栏「吃子提示」按钮（默认关闭，对局中可开关） | [app.ts `toggleCaptureHint()` / `refreshCaptureHints()`](../src/renderer/app.ts) → [tactics.ts `captureHints()`](../src/shared/tactics.ts)（无根 / 小换大分析；「有根」判定带上进攻子，且将 / 帅作保护者时须能合法吃回，否则按无根）→ [board.ts `computeDrawList()`](../src/renderer/board.ts)（`BoardView.capture` 画绿 / 红环） | [ADR-0009 §3.13](./adr/0009-c-d-extensions.md) |
| 杀法识别（将死时给出具体杀法名） | 走子致将死时自动 | [checkmate.ts `classifyCheckmate()`](../src/shared/checkmate.ts)（终局棋盘 + 最后一步/吃子 → 杀法名与解说） | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 终局杀法展示（对局页 / 观战 / 本地人机） | 终局后右侧面板 | [app.ts `mateInfo()` / `updatePanel()`](../src/renderer/app.ts)（状态框显示「红方胜 · 夹车炮杀」，其下渲染杀法框：杀法名 + 定义 + 同时构成） | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 终局杀法展示（对局回顾 / 复盘） | 回顾列表「胜负」列、复盘页「终局杀法」面板 | 落库：[room.ts `saveRecord()`](../src/server/room.ts) → `killMethod` → [history.ts `toSummary()`](../src/server/history.ts)；展示：[review.ts `resultText()` / `mateOf()`](../src/renderer/review.ts) | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 点击棋子抬起 / 取消落回 | 点击己方棋子选中 / 点空位、右键、ESC 取消 | [app.ts `liftPiece()` / `lowerAllLifts()`](../src/renderer/app.ts) → [board.ts `liftFrame()` / `BoardView.lifts`](../src/renderer/board.ts)（原地升起 + 放大 + 落影，`LIFT_MS = 200ms`；同一时刻只抬起一枚） | [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| 走子动画（移动 / 放下） | 走子后自动（联机 / 人机 / 残局） | [app.ts `animateMove()`](../src/renderer/app.ts) → [board.ts `moveAnimFrame()` / `computeDrawList()`](../src/renderer/board.ts)（本端点选时已抬起 → 省去起身段直接平移；起点 / 终点格跳过静态贴图，动画帧 + 椭圆落影画在最上层） | [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| 将军 / 绝杀正中提示 | 走子后自动（将军或致将死） | [app.ts `maybeBanner()` / `showBanner()`](../src/renderer/app.ts) → [banner.ts `bannerContent()`](../src/renderer/banner.ts)（棋盘正中**纯文字大字**：无黑底 / 无圆框 / 无小字，楷体加粗；将军显示「将军」，**绝杀直接显示具体杀法名**；显示 2.5s 渐入渐出） | [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| 战术特效（闪击 / 闪将 / 将军抽 / 串打 / 捉双） | 走子后自动（仅对局进行中） | [app.ts `applyMoveEffects()` / `showTactics()`](../src/renderer/app.ts) → [tactics.ts `detectTactics()`](../src/shared/tactics.ts) → 棋盘上方（画布之外、独占一行）**黑色方框**提示条（`#board-tactics`，楷体加粗，v3.9 放大到 30px）+ [board.ts `BoltOp` / `BoardView.threats`](../src/renderer/board.ts) 给被威胁的敌方棋子画闪电（闪电基准半径 `disc/2 + 12`） | [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| 开局招法提示（当头炮 / 起马局等） | 红方首着后自动（仅标准开局） | [app.ts `applyMoveEffects()`](../src/renderer/app.ts) → [openings.ts `detectOpening()`](../src/renderer/openings.ts)（按 `describeMove()` 记谱识别，只把开局名（如「当头炮」）显示在棋盘上方提示条） | [ADR-0007 §3.5.7](./adr/0007-renderer-ui.md) |
| 悬停预高亮 | 鼠标悬停棋盘 | [app.ts `bindEvents()`](../src/renderer/app.ts) + [board.ts `computeDrawList()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 被吃掉的棋子展示 | 对局页棋盘两侧吃子条自动更新（左 = 红方所吃 / 右 = 黑方所吃，放大的红 / 黑原色素材缩略图） | [app.ts `renderCaptured()` / `fillCapStrip()`](../src/renderer/app.ts) → 权威快照 / 广播的 `capturedByRed/Black`（[game.ts `snapshot()`](../src/shared/game.ts)）、素材经 [board.ts `PIECE_IMG` / `assetUrl()`](../src/renderer/board.ts) | [ADR-0007 §3.5.6](./adr/0007-renderer-ui.md)、[ADR-0009 §3.2](./adr/0009-c-d-extensions.md) |
| 悔棋（申请/同意） | 对局页「悔棋」 | 联机：[app.ts `offerUndo()`](../src/renderer/app.ts) → `undo_request` / `undo_response` → [room.ts `handleMessage()`](../src/server/room.ts) → [game.ts `undo()`](../src/shared/game.ts)；本地人机：直接回退到本方回合 | [ADR-0009 §3.6](./adr/0009-c-d-extensions.md) |
| 计时读秒 | 状态框显示「剩余 xx s」 | [room.ts `armTurnTimer()`](../src/server/room.ts) → 快照 `deadline` → [app.ts `updatePanel()`](../src/renderer/app.ts) | [ADR-0009 §3.8](./adr/0009-c-d-extensions.md) |
| 断线重连（宽限恢复） | 对手意外断线时自动提示，重连后恢复原局 | [room.ts `startGrace()` / `expireGrace()`](../src/server/room.ts) → `opponent_away`；客户端凭 `playerId` 重连（[app.ts `tryResumeSession()`](../src/renderer/app.ts)） | [ADR-0010 §3.4](./adr/0010-room-server.md) |
| 终局销毁房间 | 对局结束后无人「再来一局」时自动 | [room.ts `armOverTimer()`](../src/server/room.ts) → 广播 `room_closed` → [app.ts `handleMessage()`](../src/renderer/app.ts) | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 认输 / 和棋 / 再来一局 | 对局页按钮 | [app.ts `resign()` / `offerDraw()` / `requestRestart()`](../src/renderer/app.ts) → [room.ts](../src/server/room.ts) → `game_over` / `start`（本地人机走本地状态机） | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 离开房间 | 棋盘下「离开」/ 结果卡「返回首页」/「离开观战」 | [app.ts `leaveToHome()`](../src/renderer/app.ts) → `leave_room` → [room.ts `leave()`](../src/server/room.ts)（房主离开会销毁房间；保留与服务器的连接） | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 对局回顾（列表：全部 / 我的历史） | 首页「对局回顾」→ 页签「全部对局 / 我的历史」（**不含人机对局**；我的历史按账号或本机最近身份过滤） | [review.ts `open()` / `historyUrl()`](../src/renderer/review.ts) → `GET /api/history`（可选 `?user=`）→ [history.ts](../src/server/history.ts) | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md)、[ADR-0010 §11](./adr/0010-room-server.md) |
| 复盘（逐步） | 列表点击某局 → 「下一步 ▶」/ → 键 | [review.ts `step()` / `jump()`](../src/renderer/review.ts) → `GET /api/history/:id` | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md) |
| 复盘 AI 推荐（按钮点开才显示） | 复盘页侧栏「AI 推荐」面板 →「AI推荐」按钮（再点「收起推荐」） | [review.ts `toggleHint()` / `paintView()`](../src/renderer/review.ts) → `GET /api/ai/hint?id&index&depth=5` → [server.ts `handleAiHint()`](../src/server/server.ts) → [room.ts `hintFor()`](../src/server/room.ts)（引擎出着法，经 `validateMove` 复核后才返回）→ [board.ts `computeDrawList()` 的 `hint`](../src/renderer/board.ts)（原棋子蓝环 + 指向落点的箭头 + 蓝色落点圆盘，`HINT_COLOR` / `arrowSegment()` / `ArrowOp` / `DiscOp`） | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 复盘「后续变化」 | 点棋盘上的蓝色落点，或侧栏「后续变化」按钮（列表行可点 → 预览到该手；「回到当前」退出预览） | [review.ts `showLine()` / `previewLine()` / `renderLine()`](../src/renderer/review.ts) → `GET /api/ai/line?id&index&plies&depth=5&first=<推荐着法>` → [room.ts `lineFor()`](../src/server/room.ts)、[server.ts `/api/ai/line`](../src/server/server.ts)（**首手复用推荐着法**，保证推荐与变化首手一致）；预览用 [review.ts `withMoves()`](../src/renderer/review.ts) | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md) |
| 复盘「试下」（自由走子） | 侧栏「试下」按钮 → 点自己的子 → 点合法落点走子；「悔一步 / 重来 / 退出试下」 | [review.ts `enterTrial()` / `trialClick()` / `trialUndo()` / `trialReset()`](../src/renderer/review.ts) → [rules.ts `legalMoves()`](../src/shared/rules.ts)（本端 `cloneBoard` 推演，不改动记录） | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md) |
| 人机对弈（本地） | 首页「人机对弈」→ 选棋种 / **我执哪一方（我执红 / 我执黑）** / 难度 →「开始对弈」（**不计入对局回顾**） | [app.ts `createAiRoom()` / `aiSideChoice()` / `localAiSide()` / `localMove()` / `scheduleLocalAi()` / `runLocalAi()` / `requestAiMove()`](../src/renderer/app.ts) → [shared/game.ts](../src/shared/game.ts)；着法由**承载页面的服务器** `POST /api/ai/move` 代跑皮卡鱼引擎给出，请求失败时回退 [shared/ai.ts `pickMove()`](../src/shared/ai.ts)；**不需要联机对局（WebSocket）连接** | [ADR-0009 §3.7](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 人机对弈（服务器 AI 房间，协议保留；**不计入对局回顾**） | 可由 `create_room{mode:'ai'}` 触发 | [room.ts `startAiGame()` / `scheduleAiMove()` / `runAiMove()`](../src/server/room.ts) → [server.ts `roomDeps()`](../src/server/server.ts) 注入引擎（皮卡鱼优先） | [ADR-0010 §10](./adr/0010-room-server.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 残局挑战（题库列表 → 开局） | 首页「残局挑战」→ 面板列表点某一条（**本地对弈，不需服务器；不限步数，将死即胜**） | [app.ts `openEndgamePanel()` / `renderEndgameList()` / `startPuzzle()`](../src/renderer/app.ts) → [endgame.ts `PUZZLES` / `buildPuzzleBoard()`](../src/shared/endgame.ts) → [game.ts `setup()`](../src/shared/game.ts) | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 残局提示 / 悔棋 / 重来 | 棋盘下「提示 / 悔棋 / 重来」 | [app.ts `endgameHint()` / `endgameUndo()` / `restartPuzzle()`](../src/renderer/app.ts) → [endgame.ts `minMateDepth()` / `findMateMove()`](../src/shared/endgame.ts)（当前局面仍能取胜的最快着法，棋盘金环高亮 + 中文记谱 + 步数提示） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 残局「下一关」 | 棋盘下「下一关」（最后一关自动隐藏） | [app.ts `endgameNext()`](../src/renderer/app.ts) → [endgame.ts `nextPuzzle()`](../src/shared/endgame.ts) → `startPuzzle(next)`；结果弹层同样提供「下一关」 | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 残局题库自检（纯函数） | 无界面入口（v2.9 起）：原残局面板底部「自检题库」按钮已移除 | [endgame.ts `positionProblems()` / `checkPuzzle()` / `checkEndgameBank()`](../src/shared/endgame.ts)（测试与自建残局保存前核验复用） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 自建残局（编辑局面） | 残局面板底部「自建残局」→ 独立切屏编辑器：从棋子栏把棋子拖到棋盘落子、盘内拖动调位、拖出棋盘（或右键）拿走；「局面」面板初始局面 / 清空 / 红黑互换；右下「红先 / 黑先」；棋子栏用棋盘同款素材并在右上角显示剩余可摆枚数（0 枚置灰） | [app.ts `openEndgameEditor()`](../src/renderer/app.ts) → [endgame-editor.ts `initEndgameEditor()`](../src/renderer/endgame-editor.ts)（[`initBoard`](../src/shared/rules.ts) / `piecesToBoard` / `boardToPieces` / `swapPieceSides` / `remainingCount`） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 自建残局（保存时自动核验） | 编辑器「保 存」→ 自动核验局面合法性并求出最优步数；不通过逐条列出问题（编辑器保持打开） | [endgame-editor.ts `save()`](../src/renderer/endgame-editor.ts) → [endgame.ts `checkCustomEndgame()`](../src/shared/endgame.ts) → 通过则 [app.ts `saveCustomEndgame()`](../src/renderer/app.ts)（`upsertCustomEndgame` 写本机存档） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 自建残局（列表 / 编辑 / 删除） | 残局列表「自建」徽章行 → 点击开局；行尾 `✎` 编辑、`✕` 删除（二次确认） | [app.ts `renderEndgameList()` / `endgameRow()` / `askDeleteCustom()`](../src/renderer/app.ts) → `parseCustomEndgames` / `removeCustomEndgame` | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 揭棋（人机，本地） | 首页「人机对弈」→ 模式选「揭棋（暗棋）」→ 难度 →「开始对弈」（**本地对弈，不需服务器；AI 看不到任何暗子真实身份**） | [app.ts `createAiRoom()` / `aiVariant()`](../src/renderer/app.ts) → [game.ts `openJieqi()`](../src/shared/game.ts) → [jieqi.ts `dealBoard()`](../src/shared/jieqi.ts)；AI 仍走 [ai.ts `pickMove()`](../src/shared/ai.ts) | [ADR-0012 §3.4 / §3.5](./adr/0012-jieqi.md) |
| 揭棋房间（双人） | 首页「创建房间」→ 勾选「揭棋（暗棋）房间」→ 创建；对手从房间列表（带「揭棋」标记）加入 | [app.ts `createRoom()`](../src/renderer/app.ts) → `create_room{mode:'jieqi'}` → [server.ts `handleCreateRoom()`](../src/server/server.ts) → [room.ts `startGame()`](../src/server/room.ts)（`game.openJieqi()`） | [ADR-0012 §3.6](./adr/0012-jieqi.md) |
| 揭棋暗子渲染 / 翻开 | 揭棋对局自动 | [board.ts `computeDrawList()`](../src/renderer/board.ts)（`p.hidden` → `BackOp` 素面背面，抬起 / 走子动画帧同规则）；走子后服务端翻开，广播的快照里该子 `hidden` 消失 | [ADR-0012 §3.5](./adr/0012-jieqi.md) |
| 揭棋吃子展示 / 暗子计数 | 侧栏吃子面板与角色提示自动 | [app.ts `renderCaptured()` / `jieqiTag()`](../src/renderer/app.ts) → 快照 `capturedByRed/Black` 与 [jieqi.ts `coveredCount()`](../src/shared/jieqi.ts) | [ADR-0012 §3.5](./adr/0012-jieqi.md) |
| 残局胜负与列表状态标记 | 每步之后自动判定；打开面板时渲染列表 | [app.ts `endgameEvaluate()` / `showEndgameResult()` / `renderEndgameList()`](../src/renderer/app.ts)（将死即胜并记入 `localStorage` 的最少步数；被将死 / 困毙记失败；列表勾叉 = 完成 / 失败 / 未完成，外圈绿 / 灰 = 是否达成最优步数） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 更换皮肤 | 首页「更换皮肤」 | [app.ts `switchSkin()`](../src/renderer/app.ts) → [board.ts `nextSkin()` / `loadSkinImages()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 选子 / 走子音效 | 点击棋子 / 收到走子广播时自动 | [sound.ts](../src/renderer/sound.ts)（`select.wav` / `click.wav`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 心跳保活 | 后台自动运行（5s 间隔） | [net.ts `startPing()`](../src/renderer/net.ts) → `ping` / `pong`（`pong` 携带服务器声明地址） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 视角翻转（黑方） | 加入者执黑时自动翻转 | [board.ts `toView()` / `pickCell()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 服务器常驻启动 / 开发模式 | `npm run serve` / `npm run dev` | [server-main.ts](../src/server/server-main.ts)、[dev.mjs](../scripts/dev.mjs) | [ADR-0006](./adr/0006-process-entries.md) |
| Electron 客户端启动 / 打包 | `npm start` / `npm run dist` | [main.ts `createWindow()`](../src/main/main.ts)（本机外壳服务承载页面 + `client`/`server`/`lan` 参数）、[package.json](../package.json) | [ADR-0006](./adr/0006-process-entries.md)、[ADR-0010 §9.1](./adr/0010-room-server.md) |

---

## 6. 目录结构

```text
Chinese_chess/
├── src/
│   ├── shared/            # 共享层：无 DOM/网络/Node 依赖，服务端与浏览器共用
│   │   ├── types.ts       #   数据结构：Side/Piece（含揭棋 hidden/real/free）/Board/PlayerRef/GameRecord/RoomSummary/AiHint/AiLine...
│   │   ├── protocol.ts    #   通信协议：ClientMessage/ServerMessage/encode/decode/isValidPos/OnlinePlayer
│   │   ├── rules.ts       #   规则引擎：走法/将军/将死/困毙/validateMove
│   │   ├── game.ts        #   对局状态机：权威棋盘、走子校验、悔棋/超时/终局、重复局面裁决触发
│   │   ├── ai.ts          #   人机引擎（纯 TS 回退）：negamax + α-β
│   │   ├── engine.ts      #   AI 引擎端口 EnginePort + 难度档位 + 纯 TS 回退实现
│   │   ├── uci.ts         #   皮卡鱼换算层：棋盘 ↔ 中国象棋 FEN、项目坐标 ↔ UCI 方格、bestmove 解析
│   │   ├── notation.ts    #   中文记谱：describeMove/describeHistory/capturedPieces
│   │   ├── checkmate.ts   #   杀法识别：19 种经典杀法匹配（严格判定，将死时给出具体杀法名与解说）+ 困毙终局条目
│   │   ├── endgame.ts     #   残局挑战：题库（21 局）+ 强制将死求解器（canForceMate/findMateMove/minMateDepth）+ 局面核验（checkPuzzle/checkEndgameBank）+ 自建残局（checkCustomEndgame/makeCustomEndgame/parseCustomEndgames/upsert/remove）
│   │   ├── tactics.ts     #   战术模块：吃子提示（captureHints/profitableTargets/PIECE_VALUE，无根 / 小换大分析）+ 战术识别（detectTactics：闪击 / 闪将 / 将军抽 / 串打 / 捉双）
│   │   ├── repetition.ts  #   重复局面裁决：局面键 / 每手性质（将·捉·闲）/ 三次重复裁决（positionKey/classifyMove/judgeRepetition）
│   │   └── jieqi.ts       #   揭棋（暗棋）：洗子开局 / 起始兵种 / 翻子 / 公开快照抹除真实身份（纯函数）
│   ├── server/            # 服务端（中心服务器）
│   │   ├── server.ts      #   服务器：HTTP 静态+API、WS 路由、房间表、在线玩家、邀请、空闲回收、局域网 IP
│   │   ├── room.ts        #   单局房间：席位/先手/猜先/宽限/读秒/AI 房间/邀请口令豁免/落库/销毁倒计时
│   │   ├── conn.ts        #   连接对象（连接 ↔ 房间 ↔ 角色 ↔ 玩家身份）
│   │   ├── pikafish.ts    #   皮卡鱼 UCI 引擎进程封装（惰性启动 / 串行队列 / 空闲回收 / 崩溃重启 / 引擎发现）
│   │   ├── engine-select.ts #  引擎选择：优先皮卡鱼，出错 / 非法着法自动回退纯 TS
│   │   ├── accounts.ts    #   最简账号：注册/登录/token，落盘 data/users.json
│   │   ├── history.ts     #   对局记录：跨房间集中保存，落盘 data/history.json
│   │   ├── log.ts         #   服务器日志（LANSCHESS_DEBUG 开关）
│   │   └── server-main.ts #   常驻服务器入口（npm run serve）
│   ├── main/
│   │   └── main.ts        #   Electron 客户端主进程（本机外壳服务 + client/server/lan 参数）
│   └── renderer/          # 渲染层（客户端页面，浏览器与 Electron 共用）
│       ├── app.ts         #   页面流转 / 服务器选择 / 房间与账号交互 / 邀请 / 本地人机（标准 / 揭棋）/ 残局挑战（含下一关 / 自建残局列表与核验）/ 特效（将军 / 绝杀大字、战术闪电、开局提示）/ 消息处理
│       ├── servers.ts     #   服务器地址工具（解析 / 网段推导 / 客户端形态判定）
│       ├── board.ts       #   棋盘 Canvas 渲染（三套皮肤）、绘制计划、坐标换算、点击抬起帧与走子动画帧、被将军的将颤抖、被威胁棋子闪电
│       ├── banner.ts      #   棋盘正中提示（将军 / 绝杀纯文字大字，绝杀直接显示杀法名）的内容（纯数据）
│       ├── openings.ts    #   开局招法识别（红方首着记谱 → 当头炮 / 起马局 / 飞相局 / 仙人指路 / 士角炮 / 过宫炮；纯函数）
│       ├── endgame-editor.ts # 自建残局编辑器（棋盘摆子（拖拽入盘 / 调位 / 拖出）+ 同款素材棋子栏 + 剩余枚数 + 局面面板 + 红先/黑先 + 保存前自动核验）
│       ├── review.ts      #   对局回顾列表与复盘（逐步回放 + AI 推荐按钮 / 后续变化 / 试下）
│       ├── sound.ts       #   音效（选子 / 走子）
│       ├── net.ts         #   WebSocket 客户端 + 心跳
│       ├── discover.ts    #   局域网服务器搜索（WS 探测 + 网段扫描）
│       ├── assets/        #   视觉素材：img/stype_1..3、菜单按钮、audio、参考项目许可
│       ├── index.html     #   页面结构（连接服务器/首页/等待/加入/对局/回顾/复盘/弹层）
│       └── styles.css     #   样式（参考项目木质经典风格 + v2.4 令牌化视觉精修）
├── tests/                 # vitest 测试（单元 + 集成 + 端到端）
├── scripts/
│   ├── copy-assets.mjs    # 构建后复制 HTML/CSS 与素材到 dist
│   ├── dist.mjs           # 打包：固定 npmmirror 镜像后调用 electron-builder（离线可用）
│   └── dev.mjs            # 开发模式：tsc watch + 服务器自动重启
├── data/                  # 运行时数据（账号 / 对局记录，git 忽略）
├── .github/workflows/     # CI：lint → format → build → test
├── docs/                  # 本文档中心（README + ADR + 产品/技术文档 + Demo）
├── dist/                  # tsc 编译产物（git 忽略）
├── release/               # electron-builder 安装包产物（git 忽略）
├── package.json           # 脚本：build / dev / test / lint / format / serve / host / start / dist
├── eslint.config.mjs      # ESLint（typescript-eslint recommended）
├── .prettierrc.json       # Prettier（printWidth 110）
├── tsconfig.json          # TS 配置（strict，NodeNext，ES2022）
└── vitest.config.ts       # 测试配置（node 环境，tests/**/*.test.ts）
```

---

## 7. 关键数据流（一步走子）

```text
点击棋盘 → app.onCell() 本地合法性提示（legalMoves）
        → 发送 {type:'move', from, to}
        → server.handleMessage() 按连接的 roomId 路由到 Room
        → Room.handleMessage() → Game.applyMove() 权威校验（validateMove + judgeAfterMove）
        → 合法：广播 {type:'move_applied', seq, board, turn, check, ...}
        → 非法：单播 {type:'move_rejected', reason}
        → 终局追加广播 {type:'game_over', ...}，落库并启动房间销毁倒计时
```

---

## 8. 测试与验收

- 测试命令：`npm test`（vitest run，node 环境）；配套 `npm run lint` 与 `npm run format:check`。
- 覆盖范围：规则引擎单测、状态机单测（含自定义局面 `setup` / 悔棋 / 终局清理 / **重复局面裁决（长将 / 长捉 / 长打判负与不变作和、悔棋与重开同步回退）**）、棋盘 Canvas 渲染计划与点击命中、中文记谱与吃子统计、
  AI 引擎、**残局题库与强制将死求解器（含最快取胜步数 `minMateDepth`、局面核验 `checkPuzzle` / `checkEndgameBank`、自建残局保存前自动核验 `checkCustomEndgame` 与本机存档解析 / 变更）**、**揭棋（洗子 / 起始兵种 / 翻子 / 公开快照抹除 / 规则与状态机的揭棋行为）**、WebSocket 客户端心跳、完整对局端到端回放、服务器连接/消息/房间隔离/口令/宽限重连/观战/人机（含难度）/
  先手方式与猜先/对局回顾与 AI 推荐（含**后续变化 `/api/ai/line`**）/计时/静态安全与素材 MIME 集成、账号与记录持久化、局域网 IP 与服务器发现、
  复盘局面还原与**后续变化 / 试下共用的局面推演 `withMoves`**、**AI 推荐标记（箭头 + 蓝色落点）与 `arrowSegment` 几何**、**战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）与开局招法识别**、主界面布局（署名遮盖 / 放大范围 / 大面板 / **6 入口挂板几何** / v2.4 视觉精修契约 / **v2.9 自建残局编辑器契约** / **v2.10 提示特效契约** / **v2.11 复盘 AI 推荐契约** / **v3.0 揭棋入口契约**）。

| 测试文件 | 覆盖 |
|---|---|
| [rules.test.ts](../tests/rules.test.ts) | 开局棋盘、各棋子走法、将军/照面、将死/困毙、validateMove |
| [game.test.ts](../tests/game.test.ts) | Game 状态机：走子、拒绝、认输、和棋、重开、终局清理 pending、悔棋回退、history 快照、**`setup()` 自定义局面（残局开局）与终局判定** |
| [repetition.test.ts](../tests/repetition.test.ts) | 重复局面裁决：**局面键（棋盘布局 + 行棋方）**、**每手性质（走子致将军 = 将 / 新出现的得子威胁 = 捉 / 同一子仍被咬 = 闲）**、**三次重复裁决（不足 3 次不裁决 / 长将 / 长捉 / 将捉混合记长打 / 双方长打或双方长闲判和 / 只看最后一次循环）**；**状态机集成（长将、长捉、双方长闲三种循环各自走满 3 次重复后正确终局；第 2 次重复不裁决；悔棋回退重复计数不提前裁决；`reset` / `setup` 清空历史；普通开局不误判）** |
| [board.test.ts](../tests/board.test.ts) | 棋盘渲染：三套皮肤几何参数、素材路径、坐标换算与点击命中（含响应式缩放）、绘制计划、视角翻转、**点击抬起（`liftFrame` 原地升降 / 放大 / 落影、进度越界夹取、翻转、抬起格跳过静态贴图、棋子离场时跳过）、走子动画（一帧几何：抬起高度 / 放大 / 平移 / 落影、`startLifted` 省去起身段、进度越界夹取、翻转、纯函数性、终点格跳过静态贴图）**、**吃子提示环（绿 / 红环的半径 / 颜色 / 坐标 / 翻转，未开启不画环）**、**AI 推荐标记（蓝环 ×2 + 蓝盘 + 箭头与 `arrowSegment` 几何：按 gap 收进末端 / 超长退化零长 / 两点重合不 NaN、随视角翻转、不再借用素材提示点）**、**被威胁棋子闪电（`BoltOp` 存在性与 `seed` 确定、画在棋子之上、**闪电基准半径已放大为 `disc/2 + 12`（v3.4）**）、将颤抖（`kingShake` 使将位 `DrawOp` 坐标按偏移量移动）**、**揭棋暗子背面（`BackOp` 素面背面 + 阵营色、明子对照、选中压暗作用于背面、抬起 / 走子动画帧 `back` 标记）** |
| [banner.test.ts](../tests/banner.test.ts) | 棋盘正中提示（纯文字大字）：**内容组装（将军固定「将军」；绝杀直接显示具体杀法名——v3.8 起为纯名称如「马后炮」，困毙同样可显示；缺省退回「绝杀」；不改动传入参数）** |
| [openings.test.ts](../tests/openings.test.ts) | 开局招法识别（纯函数）：**红方首着命中（炮二平五 / 炮八平五 → 当头炮、马二进三 / 马八进七 → 起马局、相三进五 / 相七进五 → 飞相局、兵七进一 / 兵三进一 → 仙人指路、士角炮 / 过宫炮）**、非首着（黑方首着 / 未匹配着法）与空着法返回 `null`、不改动传入着法 |
| [checkmate.test.ts](../tests/checkmate.test.ts) | 杀法识别（严格判定）：19 种杀法各构造一个终局局面（先用规则引擎确认确为将死，再断言杀法名；含新增「列马车」、八脚马（八角马）与红黑镜像）；**v3.8 展示名为纯杀法名（无「杀」后缀）与困毙条目**、未匹配时兜底「将死」、红黑双方对称、同时成立的杀法进 `alsoMatched`、清单外附加条目排在主判定之后、`capturedPieceAt` 推导吃子、杀法库条目唯一 |
| [endgame.test.ts](../tests/endgame.test.ts) | 残局挑战：题库自洽（id 唯一、难度有序、棋子不重叠、双方有将、对方有子可走）、**21 局逐条由求解器验证「目标步数内可强制取胜且步数最少」**、**v3.8 杀法示例齐全（清单各杀法各有一道一步杀示例，困毙示例走成欠行）**、正解首着合法且走完仍在杀棋内、非退化（不是随便走都赢）；**局面核验（内置题库逐条通过，能否抓出缺将/越界/重叠/不可解/非最少步数/后手已被将死，且不改动传入题目）**；求解器语义（一步杀 / 多步杀 / **困毙同将死** / **`minMateDepth` 最快取胜步数（含题库逐局 = `goalMoves`）** / 不改动传入棋盘 / 黑方对称）；**自建残局（保存前自动核验：默认上限 50 步、一步/两步杀通过并给出最优步数、上限内无杀法即不通过并报「无杀法」、上限可调、缺将/重叠/越界/后手已被将死拦下、不改动传入棋子表；题目构造 `makeCustomEndgame` 等级固定「自建」；本机存档解析丢弃损坏与结构不符条目、新增 / 同 id 覆盖 / 删除且不改动传入数组；棋盘↔棋子表互转与红黑互换）**；**本机记录（完成/失败/未完成、最优步数判定、旧版数字格式兼容、失败不覆盖已通关、取胜清除失败标记、纯函数不改动传入对象）**；界面接线（首页 6 入口、残局面板、残局操作行与信息块、**不限步数（无「超出步数」判负）**、**列表状态标记（绿勾/红叉/白勾 + 绿/灰外圈）**、**「下一关」按钮与最后一关隐藏**、**自建残局入口与编辑器结构（棋盘 / 棋子栏 / 红先黑先 / 局面面板）、棋子栏同款素材 + 剩余枚数角标（0 枚置灰）、拖拽入盘 / 盘内调位 / 拖出拿走、保存时在 Web Worker 里自动核验、编辑器并入列表与编辑 / 删除**、**既有「自检题库」手动入口已移除**、**多步残局继续调度 AI 应招**、列表与样式契约） |
| [review.test.ts](../tests/review.test.ts) | 复盘局面还原与越界收敛、行棋方交替、**行棋方名称 `sideName`**、**后续变化 / 试下共用的局面推演 `withMoves`（在给定局面上试走前 N 手且不改动传入棋盘、plies 越界收敛）**、列表文案（玩家名/取先方式/时间/胜负）、**结果文案优先显示杀法名（killMethod）**、**复盘按着法即时识别杀法（mateOf）**、**列表请求路径 `historyUrl`（全部 / 我的历史 + URL 编码）** |
| [jieqi.test.ts](../tests/jieqi.test.ts) | 揭棋（暗棋）：起始兵种映射与 15 个暗子位、**洗子开局（将帅明置 / 每方 2仕2相2马2车2炮5兵 / 固定 rng 可复现 / 暗子走法兵种 = 所在起始兵种）**、翻子（`t` ← 真实身份、士相置 `free`、明子不翻开）、**公开快照抹除 `real`（不动原盘）**；引擎（暗子按起始兵种走、`free` 士相出九宫 / 过河、塞象眼照旧）；状态机（`openJieqi`、走子翻开、暗子首步不能后退、**吃子记录真实身份并随悔棋回退**、**快照抹除且带变体 / 吃子记录**、标准对局无揭棋字段、揭棋下同样判定将死） |
| [notation.test.ts](../tests/notation.test.ts) | 中文记谱（平/进/退/前后消歧/斜走目标列）、describeHistory 回放、capturedPieces 吃子统计 |
| [tactics.test.ts](../tests/tactics.test.ts) | 吃子提示分析：开局无提示、**无根白吃**、**有根小换大**、等价交换不提示、**炮的「有根」判定（无炮架不算根 / 有炮架算根）**、将帅不参与提示、**将守护的子（将吃回会被将军 → 按无根标绿；将能安全吃回 → 按有根不标；进攻子原格不被误判为仍在攻击；红方视角对称的红色威胁）**、红黑对称（红方 threats = 黑方 targets）、纯函数性；战术识别（纯函数）：**闪将 / 闪击（「让线」判定）、将军抽（走动的子本身是将的发出者且同时新攻击高价值子）、串打（单一车 / 炮沿同一射线攻击两枚高价值子）、捉双（单一子攻击 ≥2 高价值子且不在同一射线）**，并统一要求**「两者必然失去其一」（`mustLoseOne`：对方任一应着后走动的子仍须至少攻击到被威胁子中的一枚，排除「被威胁子反吃攻击子」「垫子挡线」「移走炮架」等能两全的伪战术；被威胁子是否有根不影响判定）**；反例（让线被挡 / 目标价值过低 / 非新攻击 / 被威胁子可反吃攻击子 / 将死局面返回空 / 优先级只出最高 1 条 / 不改动传入棋盘 / 红黑对称）与**「前子有根仍成立」的正例（v3.3 漏报修复回归）** |
| [ai.test.ts](../tests/ai.test.ts) | 纯 TS 回退引擎：一步杀、白吃子、无着法返回 null、开局着法合法与耗时 |
| [uci.test.ts](../tests/uci.test.ts) | 皮卡鱼换算层：初始局面 FEN（引擎实测一致）、FEN 往返不变式与非法输入、方格换算（`b2` ↔ `[7,1]`、`e0` ↔ `[9,4]`）、着法串换算、`bestmove` 行解析（含 `ponder` / `(none)`） |
| [pikafish.test.ts](../tests/pikafish.test.ts) | 皮卡鱼真机集成（**本机无引擎文件时整组跳过**）：开局返回规则引擎认可的合法着法、一步杀局面返回杀着、`dispose()` 后请求被拒绝 |
| [net.test.ts](../tests/net.test.ts) | 连接建立与消息分发、pong 内部消化、心跳 5s、16s 无 pong 判离线、主动关闭不提示 |
| [fullgame.test.ts](../tests/fullgame.test.ts) | 完整一盘棋 WS 回放：双方棋盘一致、seq 单调、history 一致、`game_over`「将死」、**对局记录带识别出的杀法名（killMethod）**、重开 |
| [server.test.ts](../tests/server.test.ts) | 建房/加入/口令/房间列表/满员；走子与拒绝；认输/和棋/重开/悔棋/离开；观战；宽限重连与房间销毁；终局销毁；空闲回收；两房间隔离；先手方式与猜先；账号与记录归属；**API 跨源响应头与 OPTIONS 预检**、**`/api/history?user=` 我的历史过滤**、**复盘 AI 推荐 `/api/ai/hint` 与后续变化 `/api/ai/line`（首手即推荐着法、双方交替、文本非空、未知 id 404）**；玩家列表与房间邀请（在线玩家、**离线账号 online=false 与不可邀请**、免口令加入、邀请校验）；**人机对局不计入对局回顾**；人机；计时；日志与端口回退；静态资源安全与 MIME；**揭棋房间（快照抹除真实身份 / 洗子开局双方各 15 暗子 / 走子翻开 / 观战者同样看不到底牌 / 不计入对局回顾 / 重开重新洗子）** |
| [persistence.test.ts](../tests/persistence.test.ts) | 账号注册/登录/token 轮换、账号与对局记录落盘与重启读回（**含杀法名 killMethod**）、容量上限、损坏文件降级 |
| [discover.test.ts](../tests/discover.test.ts) | 服务器探测、无服务端口返回 null、网段扫描聚合去重与进度 |
| [servers.test.ts](../tests/servers.test.ts) | 服务器地址解析、网段推导、服务器键、页面地址回退与「浏览器 / 桌面客户端」判定 |
| [lan-ip.test.ts](../tests/lan-ip.test.ts) | pickLanIp 网段优先级与虚拟网卡跳过 |
| [ui-home-layout.test.ts](../tests/ui-home-layout.test.ts) | 主界面布局：主页背景署名已被 cover.bmp 覆盖（索引 PNG 像素级验证）、首页木质挂板缩放与入口结构（**6 个入口：43×6 + 6 = 264 铺满内框，按钮素材等比缩放与悬停偏移**）、**点击板块后的大面板已取代木框对齐窄面板（620 宽 / 与对局回顾同款 / 不再有 280 内框尺寸）**、列表行不被按钮撑破、**邀请列表常驻等待页右栏 / 对局侧栏（置灰规则 + 无邀请按钮）**、底部小字已删除、取先方式下拉框（默认猜先）、**对局回顾「全部对局 / 我的历史」页签**、**v2.4 视觉精修契约（设计令牌 / 焦点环 / 切屏与弹层动效 / 减少动态效果 / 状态框「轮到你走棋」强调 / toast 换行与 aria 语义）**、**v2.4 终局杀法展示契约（杀法框结构 / 只引用设计令牌 / 小屏同列铺满 / 复盘页「终局杀法」面板）**、**v2.8 走子动画与正中提示契约（`board-stage` 结构 / 2.5s 渐入渐出 / v3.7 纯文字无黑底无圆框 / 楷体加粗 / 绝杀大字取杀法名 / 减少动态效果仍可见 / app.ts 接线）**、**v2.9 点击抬起契约（抬起帧与 `lifts` / 点击选中即抬起 / 取消落回 / 走子从抬起态直接平移 / 联机等待确认期间保持抬起）**、**v2.9 被吃掉的棋子展示契约（侧栏文字面板与其样式已删除 / 两侧吃子条三栏居中 / 缩略图放大并保留红黑原色（v3.3 起不再置灰）/ app.ts 素材渲染且不再有文字映射）**、**v2.10 吃子提示契约（`btn-hint` 按钮结构 / 默认关闭与按压态 / 开启态金色实底与焦点环 / `app.ts` 接线）**、**v2.10 提示特效契约（正中纯文字大字 / 战术提示黑色方框 + 楷体加粗 / 棋盘上方 `#board-tactics` 提示条 / 被将军的将颤抖与战术闪电 / 开局提示 / 减少动态效果仍可见 / app.ts `detectTactics` / `detectOpening` 接线）**、**v2.11 复盘 AI 推荐契约（推荐 / 后续变化 / 试下按钮与着法列表结构、默认引导文案、点按钮才请求、点蓝色落点看后续变化、试下自由走子的接线与面板文案 / 按钮态、按钮与列表行的设计令牌与金色焦点环）**、**v3.0 揭棋入口契约（人机「标准象棋 / 揭棋」模式单选 / 创建房间「揭棋房间」勾选 / 渲染层接线 / `BackOp` 背面绘制）**、**v3.4 战术元素放大契约（闪电基准半径 `disc/2 + 12`）**、**v3.9 上方提示条契约（移到画布之外、棋盘上方独占一行 `.board-tactics-slot`（`min-height: 64px` 常驻占位）/ 字号 30px / 字距 6px / 内边距 10px 36px / 小屏 22px）**、**v3.5 人机对弈「我执红 / 我执黑」契约（面板单选与默认执红 / `aiSideChoice()` 决定 `S.side` / AI 执对方并在我执黑时先行 / 侧栏提示与悔棋按所选方生效）**、**v3.5 重复局面「请变招」提示契约（状态框「重复局面 · 请变招」文案 / 轻提示按手去重 / 快照与 `move_applied` 均下发 `repetitionHint`）** |

验收标准见 [Product-plan.md 第 14 节](./Product-plan.md)、[ADR-0008](./adr/0008-testing-strategy.md)
与 [ADR-0010 §6](./adr/0010-room-server.md)。

---

## 9. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 打不开页面 / 客户端连不上服务器 | 确认中心服务器已 `npm run serve` 启动、与客户端在同一局域网、防火墙放行端口；客户端在「连接服务器」板块手动输入 `主机:端口` 点「连接」，或点「搜索局域网」自动发现 |
| 「连接服务器」板块点不动 / 灰色 | 这是**浏览器打开页面**时的预期行为：地址由访问地址决定（与访问地址一致），故锁定；要切换服务器请用 Electron 客户端 |
| 搜索不到服务器 | 自动搜索只扫本机所在 /24 网段；跨网段或虚拟网卡环境请手动输入地址；确认服务器与客户端同一网段 |
| 连接列表里出现「连接失败」的红色条目 | 该地址没有可用的本局服务器（未启动 / 端口不对 / 被防火墙拦截）；改点其它条目或重新输入地址 |
| 搜索服务器时连接偶发失败 | 搜索会并发探测 254 个地址，探测超时较短；稍后点「刷新列表」或「连接」重试即可 |
| 加入时提示「房间不存在」 | 房间号输错，或该房间已被销毁（房主离开 / 终局后无人再来一局 / 空闲超时）；点「刷新房间」查看当前可加入的房间 |
| 加入时提示「房间口令错误」 | 该房间设置了口令：从房间列表点击该房间后填入「口令（房间已上锁）」输入框，或让房内玩家在邀请列表中点你行的「邀请」拉你入房（被邀请者免口令） |
| 加入时提示「房间已满」 | 该房间两席已满（人机房里对手席由 AI 占用）；可点「观战」只读旁观，或另开一间 |
| 邀请玩家时提示「该玩家不在线 / 已在房间中」 | 对方已断开（列表里显示为「离线」置灰）或已进入其它房间（显示为「对局中」）；只可邀请列表里「在线」且有「邀请」按钮的玩家 |
| 没连服务器还能玩吗 | 可以：首页「人机对弈」与「残局挑战」都在**客户端本地**运行（规则、AI 与残局求解都在本机），无需连接服务器；创建 / 加入房间、对局回顾才需要服务器 |
| 残局打不开 / 提示点了没反应 | 残局是本地对弈，与服务器无关；「提示」在已走离杀棋（局面已无法在剩余步数内取胜）时会提示「建议重来」，此时点「重来」恢复初始局面即可。通关记录存在本机浏览器（`localStorage`），换浏览器 / 清缓存会丢失 |
| 端口被占用 | 服务器未显式指定 `LANSCHESS_PORT` 时自动回退随机端口；显式指定则提示更换端口 |
| 对方意外断线 | 进入 30 秒宽限期：对方重新打开页面会自动凭 `playerId` 恢复原局；房主也可选择「等待新对手」 |
| 两盘棋同时进行 | 支持：每个房间有独立权威棋盘与房间号，互不影响 |
| 同一台机器想开两个玩家 | 同浏览器多标签共享 `localStorage`，第二个标签会被当作「房主重连」；请用不同来源（`127.0.0.1` 与 `localhost`）或不同浏览器 |
| 对局记录重启后丢失 | 默认落盘到 `./data/history.json`；若设置了 `LANSCHESS_DATA=off` 则仅内存 |
| 服务器端没有日志 / 日志太多 | `LANSCHESS_DEBUG=0` 关闭；`=1` 输出调试明细（默认只输出连接/走子/终局等关键打点） |
| Electron 里「对局回顾」报无法连接 / 一直转圈 | 记录接口按**当前所选服务器**请求（不再是页面来源地址）；v2.3 起服务端已对所有 `/api/*` 返回 CORS 头，若仍提示无法连接，请先在「连接服务器」板块连上该服务器 |
