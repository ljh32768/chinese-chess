# 局域网象棋（lan-chess）文档中心

局域网中国象棋：**中心服务器（局域网）+ 多房间并发** + WebSocket 通信 + 纯 TypeScript 规则引擎，
浏览器的与 Electron 客户端共用同一套渲染页面。

> 一句话：局域网内任一台设备打开服务器地址，就能创建 / 加入房间，完整、正确地下一盘棋。

- 版本：v2.9（v0.1.0 为 MVP 代码基线；v1.1–v1.6 为主机权威时代的优化与功能迭代；**v2.0 迁移到局域网中心服务器**；**v2.1 客户端自选服务器 + 房间列表 / 邀请 + 本地人机对弈**；**v2.2 点击板块后的大面板 UI + 邀请玩家列表 + 猜先进入棋盘 + 人机对局不计入回顾**；**v2.3 修复桌面客户端对局回顾 Failed to fetch（API 跨源）+ 新增「我的历史」**；**v2.4 界面视觉与交互精修 + 象棋杀法识别**；**v2.5 残局挑战：内置经典杀法题库 + 强制将死求解器，本地对弈、提示 / 悔棋 / 重来与通关记录**；**v2.6 残局优化：残局页面「下一关」按钮 + 题库自检（`checkPuzzle` / `checkEndgameBank`）**；**v2.7 残局不限步数（将死即胜）+ 列表状态标记（绿勾 / 红叉 / 白勾 + 绿 / 灰外圈表示是否最优）**；**v2.8 走子动画（抬起 / 移动 / 放下）+ 将军 / 绝杀棋盘正中提示条（各杀法一套图案样式，1.5s 渐入渐出）**；**v2.9 走子动画改为「点击棋子抬起」+ 被吃掉的棋子改为棋盘两侧灰色缩略图 + 自建残局编辑器**；**v3.0 AI 引擎更换为皮卡鱼（Pikafish）UCI 原生引擎（服务端与本地人机共用同一引擎接口，引擎缺失时自动回退纯 TS）**）
- 状态：v3.0 完成；340 项自动化测试通过，lint / build 全绿
- 更新日期：2026-10-15

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
| **v3.0** | **AI 引擎更换为皮卡鱼（Pikafish）：新增共享换算层 `shared/uci.ts`（棋盘 ↔ 中国象棋 FEN、项目坐标 ↔ UCI 方格、`bestmove` 解析）与引擎端口 `shared/engine.ts`（`EnginePort` + 难度档位 + 纯 TS 回退）、Node 侧 `server/pikafish.ts`（常驻单进程 + 串行请求队列 + 空闲回收 + 崩溃重启 + 引擎发现）与 `server/engine-select.ts`（优先皮卡鱼、失败回退）；服务端 AI 房间与复盘 AI 推荐改用引擎，新增 `POST /api/ai/move` 供渲染层本地人机 / 残局防守取着法（由承载页面的 Node 服务器代跑引擎）；引擎输出一律经 `validateMove` 复核；难度 `depth 1..4` 映射到 `Skill Level` + `go movetime`；打包由 electron-builder 的 `extraResources` 把引擎 + 权重直接放到 `resources/dist/engine`（asar 之外，无需 `asarUnpack`，也不必手工复制）；本机无引擎时全链路自动回退纯 TS** | 见 [ADR-0011](./adr/0011-pikafish-engine.md) |

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
   点「观战」无需口令即可只读旁观；等待页与对局页都可点「邀请玩家」（开局后变为「邀请观战」）
   打开玩家列表，把服务器上线的玩家一键拉进对局或观战（被邀请者免口令加入）。
4. 双方到齐自动开局；开赛前房主可在等待页用**下拉框**选择取先方式：猜先（默认）/ 随机黑红 / 房主执红 / 房主执黑
   （猜先由房主抓单双、对手猜，猜中者执红；**对手加入后双方直接进入棋盘界面，再在棋盘上抓子/猜单双**）。
5. 第三方观众从房间列表点「观战」即可只读旁观（不占席位）。
6. 单人可点首页「人机对弈」选择难度（菜鸟/中级/高手）后与 AI（执黑）对弈——**该模式不需要连接联机对局服务器
   （WebSocket）；AI 着法由承载页面的服务器调用皮卡鱼引擎代算，本机无引擎 / 离线时自动回退纯 TS 引擎**。
7. 对局结束后：若无人点「再来一局」，房间会自动销毁并释放房间号；首页「对局回顾」可查看历史对局
   （红黑方 / 取先方式 / 时间 / 胜负），顶部页签可切换「全部对局 / 我的历史」（我的历史按账号或本机最近一次身份过滤，
   请求的是**当前所选服务器**的记录）；点进某一局即可「下一步 ▶」逐步复盘并查看每个局面的 AI 推荐着法。
   **人机对局（本地或服务器 AI 房间）不计入对局回顾。**
8. 单人还可点首页「残局挑战」做杀法练习：面板里列出 9 局残局（入门 / 中等 / 困难，并给出每局「最优 N 步」），
   点一条即进入棋盘——你执红先行，AI（黑方）自动应招；**不限步数，把对方将死即挑战成功**（被对方将死 / 困毙则挑战失败）。
   列表每条带状态标记：**勾叉表示完成 / 失败 / 未完成（绿勾 / 红叉 / 白勾），外圈绿色表示已达成最优步数、灰色表示未达成**。
   侧栏「残局」信息块显示残局名、难度、最优步数与已用步数；棋盘下可用「悔棋 / 提示 / 下一关 / 重来 / 离开」
   （提示给出当前局面仍能取胜的最快着法；「下一关」直接跳到题库中的下一局，最后一关时按钮自动隐藏）。
   通关记录存在本机（取胜最少步数 + 是否曾失败）。残局面板底部的「自检题库」会用求解器逐条核验每局的
   局面合法性与可解性（目标步数内可解且步数最少），结果以弹层逐条列出。**残局同样是本地对弈，不需要连接服务器，也不计入对局回顾。**

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
| 3 | 对局状态机 | 权威棋盘状态、走子校验链、认输/和棋/重开/超时（服务端房间与客户端本地人机共用） | [game.ts](../src/shared/game.ts) | [ADR-0004](./adr/0004-game-state-machine.md) |
| 4 | 中心服务器 | HTTP 静态服务 + API、WebSocket 路由、房间表、空闲回收、局域网 IP 发现 | [server.ts](../src/server/server.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 5 | 房间 | 席位、先手方式、猜先、断线宽限、读秒、人机对战、终局落库与销毁倒计时 | [room.ts](../src/server/room.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 6 | 连接对象 | WebSocket 连接与房间 / 角色 / 玩家身份的最小视图 | [conn.ts](../src/server/conn.ts) | [ADR-0010](./adr/0010-room-server.md) |
| 7 | 账号系统 | 注册 / 登录 / token（scrypt 加盐），落盘 `data/users.json` | [accounts.ts](../src/server/accounts.ts) | [ADR-0010 §3.10](./adr/0010-room-server.md) |
| 8 | 对局记录 | 跨房间集中保存、防抖落盘、损坏降级 | [history.ts](../src/server/history.ts) | [ADR-0010 §3.8](./adr/0010-room-server.md) |
| 9 | 进程入口 | Electron 客户端、常驻服务器入口、构建脚本 | [main.ts](../src/main/main.ts)、[server-main.ts](../src/server/server-main.ts)、[copy-assets.mjs](../scripts/copy-assets.mjs) | [ADR-0006](./adr/0006-process-entries.md) |
| 10 | 渲染层 | 页面流转、棋盘 Canvas 渲染与交互（含走子动画）、正中提示条（将军 / 绝杀）、三套皮肤与音效、服务器选择 / 房间 / 账号 UI、对局回顾与复盘、本地人机对弈、WebSocket 客户端与心跳、服务器搜索 | [app.ts](../src/renderer/app.ts)、[board.ts](../src/renderer/board.ts)、[banner.ts](../src/renderer/banner.ts)、[review.ts](../src/renderer/review.ts)、[sound.ts](../src/renderer/sound.ts)、[net.ts](../src/renderer/net.ts)、[servers.ts](../src/renderer/servers.ts)、[discover.ts](../src/renderer/discover.ts)、[index.html](../src/renderer/index.html) | [ADR-0007](./adr/0007-renderer-ui.md)、[ADR-0009](./adr/0009-c-d-extensions.md)、[ADR-0010](./adr/0010-room-server.md) |
| 11 | 测试体系 | 单元测试、服务端集成测试、完整对局端到端回放 | [tests/](../tests/) | [ADR-0008](./adr/0008-testing-strategy.md) |
| 12 | 记谱 / AI / 日志 | 中文记谱与吃子；**AI 引擎接口 `EnginePort`（皮卡鱼 UCI 原生引擎优先，纯 TS negamax 自动回退）**、难度档位（1 入门 / 2 菜鸟 / 3 中级 / 4 高手）、棋盘 ↔ 中国象棋 FEN / UCI 方格换算；`LANSCHESS_DEBUG` 日志 | [notation.ts](../src/shared/notation.ts)、[ai.ts](../src/shared/ai.ts)、[engine.ts](../src/shared/engine.ts)、[uci.ts](../src/shared/uci.ts)、[pikafish.ts](../src/server/pikafish.ts)、[engine-select.ts](../src/server/engine-select.ts)、[log.ts](../src/server/log.ts) | [ADR-0009 §3.3](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 13 | 杀法识别 | 将死时判定具体杀法（18 种经典杀法 + 兜底「将死」）、给出杀法名与解说；服务端落库与客户端展示共用 | [checkmate.ts](../src/shared/checkmate.ts) | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 14 | 残局挑战 | 内置经典杀法题库（9 局，入门 – 困难）+ 强制将死求解器与最快取胜步数 `minMateDepth`；本地对弈（**不限步数，将死即胜**）、提示（最快取胜着法）/ 悔棋 / 下一关 / 重来、最优步数展示、列表状态标记、本机胜负记录与题库自检 | [endgame.ts](../src/shared/endgame.ts) | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |

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
| 邀请玩家 / 邀请观战 | 等待页 / 对局页「邀请玩家」（开局后按钮变为「邀请观战」）→ 弹层内的玩家列表（在线在前） | [app.ts `openInvite()` / `renderPlayerList()` / `sendInvite()`](../src/renderer/app.ts) → WS `list_players` / `invite_player` → [server.ts `playerList()` / `handleInvite()`](../src/server/server.ts) → 被邀请者弹层接受 → `join_room`（[room.ts `isInvited()`](../src/server/room.ts) 免口令） | [ADR-0010 §9.4 / §10](./adr/0010-room-server.md) |
| 账号注册 / 登录（可选） | 首页**右上角**账号按钮 → 面板用户名 + 密码 →「登 录」/「注 册」（登录后按钮显示用户名） | [app.ts `openAccountPanel()` / `doAuth()`](../src/renderer/app.ts) → WS `register` / `login` 或 `POST /api/auth/*` → [accounts.ts](../src/server/accounts.ts) | [ADR-0010 §3.10](./adr/0010-room-server.md) |
| 取先方式（下拉框，默认猜先） | 等待页「取先方式」下拉框（猜先 / 随机黑红 / 房主执红 / 房主执黑） | [app.ts `chooseFirst()` / `renderSidePick()`](../src/renderer/app.ts) → `choose_first` → [room.ts `maybeStart()` / `beginFirst()`](../src/server/room.ts) | [ADR-0009 §3.9](./adr/0009-c-d-extensions.md)、[ADR-0010 §10](./adr/0010-room-server.md) |
| 猜先（房主抓、对手猜） | 双方加入后**直接进入棋盘界面**：房主弹层「抓单 / 抓双」→ 对手弹层「猜单 / 猜双」 | `grasp` → `guess` → [room.ts `beginFirst()`](../src/server/room.ts) → 广播 `first_result`（猜中者执红）→ 逐连接 `start{side}` | [ADR-0009 §3.9](./adr/0009-c-d-extensions.md) |
| 自动开局 | 双方到齐后由服务器触发 | [room.ts `afterJoin()` / `maybeStart()` / `startGame()`](../src/server/room.ts) → 广播 `start` | [ADR-0010](./adr/0010-room-server.md) |
| 复制房间号 | 等待页点击房间号块（`ip-box`） | [app.ts `copyRoomNo()`](../src/renderer/app.ts)（非安全上下文降级 `execCommand`） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 走子（选子/落点/发送） | 点击棋盘 | 联机：[app.ts `onCell()`](../src/renderer/app.ts) → `move` → [room.ts `applyAndBroadcast()`](../src/server/room.ts) → [game.ts `applyMove()`](../src/shared/game.ts)；本地人机：`localMove()` → [shared/game.ts](../src/shared/game.ts) | [ADR-0002](./adr/0002-rules-engine.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 规则裁判（将军/将死/困毙） | 走子后自动判定 | [rules.ts `judgeAfterMove()`](../src/shared/rules.ts)、[`validateMove()`](../src/shared/rules.ts) | [ADR-0002](./adr/0002-rules-engine.md) |
| 将军/将死高亮 | 走子后自动 | [board.ts `computeDrawList()`](../src/renderer/board.ts)（被将军一方的将/帅红色脉冲警示环） | [ADR-0007](./adr/0007-renderer-ui.md) |
| 杀法识别（将死时给出具体杀法名） | 走子致将死时自动 | [checkmate.ts `classifyCheckmate()`](../src/shared/checkmate.ts)（终局棋盘 + 最后一步/吃子 → 杀法名与解说） | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 终局杀法展示（对局页 / 观战 / 本地人机） | 终局后右侧面板 | [app.ts `mateInfo()` / `updatePanel()`](../src/renderer/app.ts)（状态框显示「红方胜 · 夹车炮杀」，其下渲染杀法框：杀法名 + 定义 + 同时构成） | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 终局杀法展示（对局回顾 / 复盘） | 回顾列表「胜负」列、复盘页「终局杀法」面板 | 落库：[room.ts `saveRecord()`](../src/server/room.ts) → `killMethod` → [history.ts `toSummary()`](../src/server/history.ts)；展示：[review.ts `resultText()` / `mateOf()`](../src/renderer/review.ts) | [ADR-0009 §3.11](./adr/0009-c-d-extensions.md) |
| 点击棋子抬起 / 取消落回 | 点击己方棋子选中 / 点空位、右键、ESC 取消 | [app.ts `liftPiece()` / `lowerAllLifts()`](../src/renderer/app.ts) → [board.ts `liftFrame()` / `BoardView.lifts`](../src/renderer/board.ts)（原地升起 + 放大 + 落影，`LIFT_MS = 200ms`；同一时刻只抬起一枚） | [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| 走子动画（移动 / 放下） | 走子后自动（联机 / 人机 / 残局） | [app.ts `animateMove()`](../src/renderer/app.ts) → [board.ts `moveAnimFrame()` / `computeDrawList()`](../src/renderer/board.ts)（本端点选时已抬起 → 省去起身段直接平移；起点 / 终点格跳过静态贴图，动画帧 + 椭圆落影画在最上层） | [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| 将军 / 绝杀正中提示条 | 走子后自动（将军或致将死） | [app.ts `maybeBanner()` / `showBanner()`](../src/renderer/app.ts) → [banner.ts `bannerStyle()` / `bannerContent()`](../src/renderer/banner.ts)（棋盘正中显示 1.5s 渐入渐出，各杀法一套图案样式） | [ADR-0007 §3.5.5](./adr/0007-renderer-ui.md) |
| 悬停预高亮 | 鼠标悬停棋盘 | [app.ts `bindEvents()`](../src/renderer/app.ts) + [board.ts `computeDrawList()`](../src/renderer/board.ts) | [ADR-0007](./adr/0007-renderer-ui.md) |
| 被吃掉的棋子展示 | 对局页棋盘两侧吃子条自动更新（左 = 红方所吃 / 右 = 黑方所吃，灰色素材缩略图） | [app.ts `renderCaptured()` / `fillCapStrip()`](../src/renderer/app.ts) → [notation.ts `capturedPieces()`](../src/shared/notation.ts)、素材经 [board.ts `PIECE_IMG` / `assetUrl()`](../src/renderer/board.ts) | [ADR-0007 §3.5.6](./adr/0007-renderer-ui.md)、[ADR-0009 §3.2](./adr/0009-c-d-extensions.md) |
| 悔棋（申请/同意） | 对局页「悔棋」 | 联机：[app.ts `offerUndo()`](../src/renderer/app.ts) → `undo_request` / `undo_response` → [room.ts `handleMessage()`](../src/server/room.ts) → [game.ts `undo()`](../src/shared/game.ts)；本地人机：直接回退到本方回合 | [ADR-0009 §3.6](./adr/0009-c-d-extensions.md) |
| 计时读秒 | 状态框显示「剩余 xx s」 | [room.ts `armTurnTimer()`](../src/server/room.ts) → 快照 `deadline` → [app.ts `updatePanel()`](../src/renderer/app.ts) | [ADR-0009 §3.8](./adr/0009-c-d-extensions.md) |
| 断线重连（宽限恢复） | 对手意外断线时自动提示，重连后恢复原局 | [room.ts `startGrace()` / `expireGrace()`](../src/server/room.ts) → `opponent_away`；客户端凭 `playerId` 重连（[app.ts `tryResumeSession()`](../src/renderer/app.ts)） | [ADR-0010 §3.4](./adr/0010-room-server.md) |
| 终局销毁房间 | 对局结束后无人「再来一局」时自动 | [room.ts `armOverTimer()`](../src/server/room.ts) → 广播 `room_closed` → [app.ts `handleMessage()`](../src/renderer/app.ts) | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 认输 / 和棋 / 再来一局 | 对局页按钮 | [app.ts `resign()` / `offerDraw()` / `requestRestart()`](../src/renderer/app.ts) → [room.ts](../src/server/room.ts) → `game_over` / `start`（本地人机走本地状态机） | [ADR-0003](./adr/0003-wire-protocol.md)、[ADR-0004](./adr/0004-game-state-machine.md) |
| 离开房间 | 棋盘下「离开」/ 结果卡「返回首页」/「离开观战」 | [app.ts `leaveToHome()`](../src/renderer/app.ts) → `leave_room` → [room.ts `leave()`](../src/server/room.ts)（房主离开会销毁房间；保留与服务器的连接） | [ADR-0010 §3.3](./adr/0010-room-server.md) |
| 对局回顾（列表：全部 / 我的历史） | 首页「对局回顾」→ 页签「全部对局 / 我的历史」（**不含人机对局**；我的历史按账号或本机最近身份过滤） | [review.ts `open()` / `historyUrl()`](../src/renderer/review.ts) → `GET /api/history`（可选 `?user=`）→ [history.ts](../src/server/history.ts) | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md)、[ADR-0010 §11](./adr/0010-room-server.md) |
| 复盘（逐步 + AI 推荐） | 列表点击某局 → 「下一步 ▶」/ → 键 | [review.ts](../src/renderer/review.ts) → `GET /api/history/:id` + `GET /api/ai/hint?id&index` → [server.ts `handleAiHint()`](../src/server/server.ts) → [room.ts `hintFor()`](../src/server/room.ts)（引擎出着法，经 `validateMove` 复核后才返回） | [ADR-0009 §3.10](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 人机对弈（本地） | 首页「人机对弈」→ 选难度 →「开始对弈」（**不计入对局回顾**） | [app.ts `createAiRoom()` / `localMove()` / `scheduleLocalAi()` / `runLocalAi()` / `requestAiMove()`](../src/renderer/app.ts) → [shared/game.ts](../src/shared/game.ts)；着法由**承载页面的服务器** `POST /api/ai/move` 代跑皮卡鱼引擎给出，请求失败时回退 [shared/ai.ts `pickMove()`](../src/shared/ai.ts)；**不需要联机对局（WebSocket）连接** | [ADR-0009 §3.7](./adr/0009-c-d-extensions.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 人机对弈（服务器 AI 房间，协议保留；**不计入对局回顾**） | 可由 `create_room{mode:'ai'}` 触发 | [room.ts `startAiGame()` / `scheduleAiMove()` / `runAiMove()`](../src/server/room.ts) → [server.ts `roomDeps()`](../src/server/server.ts) 注入引擎（皮卡鱼优先） | [ADR-0010 §10](./adr/0010-room-server.md)、[ADR-0011](./adr/0011-pikafish-engine.md) |
| 残局挑战（题库列表 → 开局） | 首页「残局挑战」→ 面板列表点某一条（**本地对弈，不需服务器；不限步数，将死即胜**） | [app.ts `openEndgamePanel()` / `renderEndgameList()` / `startPuzzle()`](../src/renderer/app.ts) → [endgame.ts `PUZZLES` / `buildPuzzleBoard()`](../src/shared/endgame.ts) → [game.ts `setup()`](../src/shared/game.ts) | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 残局提示 / 悔棋 / 重来 | 棋盘下「提示 / 悔棋 / 重来」 | [app.ts `endgameHint()` / `endgameUndo()` / `restartPuzzle()`](../src/renderer/app.ts) → [endgame.ts `minMateDepth()` / `findMateMove()`](../src/shared/endgame.ts)（当前局面仍能取胜的最快着法，棋盘金环高亮 + 中文记谱 + 步数提示） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 残局「下一关」 | 棋盘下「下一关」（最后一关自动隐藏） | [app.ts `endgameNext()`](../src/renderer/app.ts) → [endgame.ts `nextPuzzle()`](../src/shared/endgame.ts) → `startPuzzle(next)`；结果弹层同样提供「下一关」 | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
| 残局题库自检 | 残局面板底部「自检题库」 | [app.ts `checkEndgameBankUI()`](../src/renderer/app.ts) → [endgame.ts `checkPuzzle()` / `checkEndgameBank()`](../src/shared/endgame.ts)（逐条核验局面合法 / 目标步数内可解 / 步数最少，弹层逐条列出） | [ADR-0009 §3.12](./adr/0009-c-d-extensions.md) |
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
│   │   ├── types.ts       #   数据结构：Side/Piece/Board/PlayerRef/GameRecord/RoomSummary...
│   │   ├── protocol.ts    #   通信协议：ClientMessage/ServerMessage/encode/decode/isValidPos/OnlinePlayer
│   │   ├── rules.ts       #   规则引擎：走法/将军/将死/困毙/validateMove
│   │   ├── game.ts        #   对局状态机：权威棋盘、走子校验、悔棋/超时/终局
│   │   ├── ai.ts          #   人机引擎（纯 TS 回退）：negamax + α-β
│   │   ├── engine.ts      #   AI 引擎端口 EnginePort + 难度档位 + 纯 TS 回退实现
│   │   ├── uci.ts         #   皮卡鱼换算层：棋盘 ↔ 中国象棋 FEN、项目坐标 ↔ UCI 方格、bestmove 解析
│   │   ├── notation.ts    #   中文记谱：describeMove/describeHistory/capturedPieces
│   │   ├── checkmate.ts   #   杀法识别：18 种经典杀法匹配（将死时给出具体杀法名与解说）
│   │   └── endgame.ts     #   残局挑战：题库（9 局）+ 强制将死求解器（canForceMate/findMateMove/minMateDepth）+ 题库自检（checkPuzzle/checkEndgameBank）
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
│       ├── app.ts         #   页面流转 / 服务器选择 / 房间与账号交互 / 邀请 / 本地人机 / 残局挑战（含下一关 / 自检）/ 消息处理
│       ├── servers.ts     #   服务器地址工具（解析 / 网段推导 / 客户端形态判定）
│       ├── board.ts       #   棋盘 Canvas 渲染（三套皮肤）、绘制计划、坐标换算、点击抬起帧与走子动画帧
│       ├── banner.ts      #   棋盘正中提示条（将军 / 各杀法一套图案样式）的内容与样式（纯数据）
│       ├── review.ts      #   对局回顾列表与复盘（逐步回放 + AI 推荐）
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
- 覆盖范围：规则引擎单测、状态机单测（含自定义局面 `setup` / 悔棋 / 终局清理）、棋盘 Canvas 渲染计划与点击命中、中文记谱与吃子统计、
  AI 引擎、**残局题库与强制将死求解器（含最快取胜步数 `minMateDepth`、题库自检 `checkPuzzle` / `checkEndgameBank`）**、WebSocket 客户端心跳、完整对局端到端回放、服务器连接/消息/房间隔离/口令/宽限重连/观战/人机（含难度）/
  先手方式与猜先/对局回顾与 AI 推荐/计时/静态安全与素材 MIME 集成、账号与记录持久化、局域网 IP 与服务器发现、
  复盘局面还原、主界面布局（署名遮盖 / 放大范围 / 大面板 / **6 入口挂板几何** / v2.4 视觉精修契约）。

| 测试文件 | 覆盖 |
|---|---|
| [rules.test.ts](../tests/rules.test.ts) | 开局棋盘、各棋子走法、将军/照面、将死/困毙、validateMove |
| [game.test.ts](../tests/game.test.ts) | Game 状态机：走子、拒绝、认输、和棋、重开、终局清理 pending、悔棋回退、history 快照、**`setup()` 自定义局面（残局开局）与终局判定** |
| [board.test.ts](../tests/board.test.ts) | 棋盘渲染：三套皮肤几何参数、素材路径、坐标换算与点击命中（含响应式缩放）、绘制计划、视角翻转、**点击抬起（`liftFrame` 原地升降 / 放大 / 落影、进度越界夹取、翻转、抬起格跳过静态贴图、棋子离场时跳过）、走子动画（一帧几何：抬起高度 / 放大 / 平移 / 落影、`startLifted` 省去起身段、进度越界夹取、翻转、纯函数性、终点格跳过静态贴图）** |
| [banner.test.ts](../tests/banner.test.ts) | 棋盘正中提示条：**18 种杀法各有图案样式（pattern 与杀法 id 一致、强调色唯一、五种底纹齐备）**、将军样式独立、未知杀法回退兜底、样式表覆盖全部杀法 id、将军 / 绝杀内容组装（缺省退到「将死」与兜底图案） |
| [checkmate.test.ts](../tests/checkmate.test.ts) | 杀法识别：18 种杀法各构造一个终局局面（先用规则引擎确认确为将死，再断言杀法名）、未匹配时兜底「将死」、红黑双方对称、同时成立的杀法进 `alsoMatched`、`capturedPieceAt` 推导吃子、杀法库条目唯一 |
| [endgame.test.ts](../tests/endgame.test.ts) | 残局挑战：题库自洽（id 唯一、难度有序、棋子不重叠、双方有将、对方有子可走）、**9 局逐条由求解器验证「目标步数内可强制取胜且步数最少」**、正解首着合法且走完仍在杀棋内、非退化（不是随便走都赢）；**题库自检（内置题库逐条通过，能否抓出缺将/越界/重叠/不可解/非最少步数/后手已被将死，且不改动传入题目）**；求解器语义（一步杀 / 多步杀 / **困毙同将死** / **`minMateDepth` 最快取胜步数（含题库逐局 = `goalMoves`）** / 不改动传入棋盘 / 黑方对称）；**本机记录（完成/失败/未完成、最优步数判定、旧版数字格式兼容、失败不覆盖已通关、取胜清除失败标记、纯函数不改动传入对象）**；界面接线（首页 6 入口、残局面板、残局操作行与信息块、**不限步数（无「超出步数」判负）**、**列表状态标记（绿勾/红叉/白勾 + 绿/灰外圈）**、**「下一关」按钮与最后一关隐藏**、**「自检题库」入口与结果弹层**、**多步残局继续调度 AI 应招**、列表与样式契约） |
| [review.test.ts](../tests/review.test.ts) | 复盘局面还原与越界收敛、行棋方交替、列表文案（玩家名/取先方式/时间/胜负）、**结果文案优先显示杀法名（killMethod）**、**复盘按着法即时识别杀法（mateOf）**、**列表请求路径 `historyUrl`（全部 / 我的历史 + URL 编码）** |
| [notation.test.ts](../tests/notation.test.ts) | 中文记谱（平/进/退/前后消歧/斜走目标列）、describeHistory 回放、capturedPieces 吃子统计 |
| [ai.test.ts](../tests/ai.test.ts) | 纯 TS 回退引擎：一步杀、白吃子、无着法返回 null、开局着法合法与耗时 |
| [uci.test.ts](../tests/uci.test.ts) | 皮卡鱼换算层：初始局面 FEN（引擎实测一致）、FEN 往返不变式与非法输入、方格换算（`b2` ↔ `[7,1]`、`e0` ↔ `[9,4]`）、着法串换算、`bestmove` 行解析（含 `ponder` / `(none)`） |
| [pikafish.test.ts](../tests/pikafish.test.ts) | 皮卡鱼真机集成（**本机无引擎文件时整组跳过**）：开局返回规则引擎认可的合法着法、一步杀局面返回杀着、`dispose()` 后请求被拒绝 |
| [net.test.ts](../tests/net.test.ts) | 连接建立与消息分发、pong 内部消化、心跳 5s、16s 无 pong 判离线、主动关闭不提示 |
| [fullgame.test.ts](../tests/fullgame.test.ts) | 完整一盘棋 WS 回放：双方棋盘一致、seq 单调、history 一致、`game_over`「将死」、**对局记录带识别出的杀法名（killMethod）**、重开 |
| [server.test.ts](../tests/server.test.ts) | 建房/加入/口令/房间列表/满员；走子与拒绝；认输/和棋/重开/悔棋/离开；观战；宽限重连与房间销毁；终局销毁；空闲回收；两房间隔离；先手方式与猜先；账号与记录归属；**API 跨源响应头与 OPTIONS 预检**、**`/api/history?user=` 我的历史过滤**；玩家列表与房间邀请（在线玩家、**离线账号 online=false 与不可邀请**、免口令加入、邀请校验）；**人机对局不计入对局回顾**；人机；计时；日志与端口回退；静态资源安全与 MIME |
| [persistence.test.ts](../tests/persistence.test.ts) | 账号注册/登录/token 轮换、账号与对局记录落盘与重启读回（**含杀法名 killMethod**）、容量上限、损坏文件降级 |
| [discover.test.ts](../tests/discover.test.ts) | 服务器探测、无服务端口返回 null、网段扫描聚合去重与进度 |
| [servers.test.ts](../tests/servers.test.ts) | 服务器地址解析、网段推导、服务器键、页面地址回退与「浏览器 / 桌面客户端」判定 |
| [lan-ip.test.ts](../tests/lan-ip.test.ts) | pickLanIp 网段优先级与虚拟网卡跳过 |
| [ui-home-layout.test.ts](../tests/ui-home-layout.test.ts) | 主界面布局：主页背景署名已被 cover.bmp 覆盖（索引 PNG 像素级验证）、首页木质挂板缩放与入口结构（**6 个入口：43×6 + 6 = 264 铺满内框，按钮素材等比缩放与悬停偏移**）、**点击板块后的大面板已取代木框对齐窄面板（620 宽 / 与对局回顾同款 / 不再有 280 内框尺寸）**、列表行不被按钮撑破、**邀请玩家列表置灰与宽版弹层**、底部小字已删除、取先方式下拉框（默认猜先）、**对局回顾「全部对局 / 我的历史」页签**、**v2.4 视觉精修契约（设计令牌 / 焦点环 / 切屏与弹层动效 / 减少动态效果 / 状态框「轮到你走棋」强调 / toast 换行与 aria 语义）**、**v2.4 终局杀法展示契约（杀法框结构 / 只引用设计令牌 / 小屏同列铺满 / 复盘页「终局杀法」面板）**、**v2.8 走子动画与正中提示条契约（`board-stage` 结构 / 1.5s 渐入渐出 / 五种底纹与 `--b-accent` / 减少动态效果仍可见 / app.ts 接线）**、**v2.9 点击抬起契约（抬起帧与 `lifts` / 点击选中即抬起 / 取消落回 / 走子从抬起态直接平移 / 联机等待确认期间保持抬起）**、**v2.9 被吃掉的棋子展示契约（侧栏文字面板与其样式已删除 / 两侧吃子条三栏居中 / 缩略图置灰 / app.ts 素材渲染且不再有文字映射）** |

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
| 加入时提示「房间口令错误」 | 该房间设置了口令：从房间列表点击该房间后填入「口令（房间已上锁）」输入框，或让房内玩家用「邀请玩家」邀请你（被邀请者免口令） |
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
