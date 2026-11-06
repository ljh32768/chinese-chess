# ADR-0007：渲染层模块规格（src/renderer/）

- 状态：已接受（记录现状实现；v1.4 起棋盘改为 Canvas + 图片素材）
- 日期：2026-10-03（v1.4 视觉改造：2026-10-06；v2.4 视觉与交互精修：2026-10-11）
- 关联入口：首页（含人机难度子菜单与更换皮肤）、主机等待页（含地址复制）、加入页、对局页、结束结果卡、断线提示与宽限重连、视角翻转、悬停反馈、快捷键、心跳、音效
- 关联文档：[ADR-0003 通信协议](./0003-wire-protocol.md)、[ADR-0005 主机服务](./0005-host-server.md)、[ADR-0009 扩展](./0009-c-d-extensions.md)

---

## 1. 背景

渲染层有两类使用者：Electron 主机窗口与加入者浏览器。
两者必须共用同一份页面与代码，只以角色（host/guest）和阵营（红/黑）区分；
渲染层是**非权威**的，一切以主机广播为准，本地计算仅用于交互提示。

## 2. 决策

- 页面为单页多屏（screen-home / screen-host / screen-join / screen-game），
  以 CSS 类 `active` 切换，不用路由。
- 视觉与素材对齐参考项目 [Reference/Chess](../../Reference/Chess)（MIT，许可随素材一起分发：
  [assets/LICENSE-ReferenceChess.txt](../../src/renderer/assets/LICENSE-ReferenceChess.txt)）：
  木质挂板菜单、金框按钮、木纹棋盘底图、图片棋子、提示点、落点框与点击/选子音效。
- 棋盘用 **Canvas + 图片素材**渲染（`drawImage`），不引入框架；画布内部尺寸固定为皮肤尺寸，
  显示尺寸由 CSS 响应式缩放（点击位置按显示比例换算回画布坐标）。
- 皮肤三套（`stype1/2/3`，几何参数与素材目录与参考项目一致），首页「更换皮肤」按
  `stype1 → stype2 → stype3` 循环切换，偏好写入 `localStorage`，同时对局页与页面背景（`bg.jpg`）一起换。
- 文件职责分离：`app.ts` 流程与交互、`board.ts` 纯渲染/绘制计划与坐标换算、
  `sound.ts` 音效、`net.ts` 连接与心跳。
- 客户端本地状态对象 `S` 只保存「用于渲染的镜像」，不参与任何权威判定。
- 黑方视角通过坐标翻转（`flip`）实现，逻辑坐标与视图坐标显式互转。
- 对局结束不使用全屏遮罩：结果卡与结束操作放在侧栏，棋盘保持完整可见（终局最需要复盘棋盘）。
- 心跳：5s 间隔 `ping`，16s 未收到 `pong` 视为断线主动关闭。

## 3. 详细规格

### 3.1 页面结构（index.html）

| 屏 | id | 元素与入口 |
|---|---|---|
| 首页 | `screen-home` | 木质挂板菜单 `menu-index`：「创建对局」`btn-create`、「加入对局」`btn-show-join`、「人机对弈」`btn-create-ai`、「残局挑战」`btn-endgame`、「对局回顾」`btn-history`、「更换皮肤」`btn-skin`（**v2.5 起 6 个入口铺满挂板按钮区**）；人机子菜单 `menu-ai`（难度单选 `ai-depth` 2/3/4 + `btn-ai-start` + 返回 `btn-ai-back`）、残局子菜单 `menu-endgame`（题库列表 `endgame-list` + 返回 `btn-endgame-back`，见 [ADR-0009 §3.12](./0009-c-d-extensions.md)）；本机地址提示 `home-hint` |
| 主机等待 | `screen-host` | 版块与挂板内框对齐（实测 `init_bg.png` 内表面 x≈10..290、y≈158..395，面板 `280×237`）：标题 `info-title`（内含等待转圈 `spinner`）、地址大字显示 `host-ip`（**点击地址块 `ip-box` 即复制**，非安全上下文降级）、先手（红方）方式 `side-opts`（随机黑红 / 猜先 / 黑 / 红，选中态 `.active`）+ 说明 `side-hint`、等待文案 `host-wait`（猜先阶段显示进度）、取消 `btn-cancel-host`（素材返回箭头） |
| 加入 | `screen-join` | 地址输入 `join-ip`、端口输入 `join-port`、连接 `btn-connect`（面板与内框对齐、限高保证按钮落在框内，见 §3.5.3）、观战 `btn-spectate`、搜索主机 `btn-scan` + 结果区 `scan-result`（面板内滚动）、返回 `btn-join-back`、提示 `join-msg` |
| 对局 | `screen-game` | Canvas 棋盘 `board`、棋盘按钮条 `bn_box`（`actions-play`：`btn-undo/btn-draw/btn-resign/btn-leave`；**v2.5 残局** `actions-endgame`：`btn-eg-undo/btn-eg-hint/btn-eg-restart/btn-eg-leave`；`actions-over`：`btn-play-again/btn-home`；`actions-spectate`：`btn-spectate-leave`）、侧栏双方信息 `p-top/p-bottom`、状态框 `status-box`（含倒计时）、**残局目标块 `eg-box`（`eg-info`：残局名 / 难度 / 目标步数 / 已用步数 / 要点）**、请求等待提示 `req-hint`、吃子 `cap-red-list`/`cap-black-list`、角色提示 `role-hint`（**棋谱面板已移除，改由「对局回顾」复盘**） |
| 对局回顾 | `screen-history` | 列表 `history-list`（每行：红黑方 / 取先方式 / 时间 / 胜负，点击进入复盘）、返回 `btn-history-back`、刷新 `btn-history-refresh` |
| 复盘 | `screen-replay` | 复盘棋盘 `replay-board`、步进按钮 `btn-replay-first/prev/next/last`、返回列表 `btn-replay-back`、对局信息 `replay-info`、当前步 `replay-step`、AI 推荐 `replay-hint` |
| 通用弹层 | `modal` | 标题 `modal-title`、说明 `modal-sub`、动态按钮 `modal-btns`；ESC / 点击遮罩可关闭；用于和棋/重开/悔棋请求、认输确认、猜先应答、对手离开与断线提示，**不用于对局结束** |
| 轻提示 | `toast` | 1.8s 自动消失（席位结果 / 猜先结果也用它提示） |
| 音效元素 | `click-audio` / `select-audio` | 常驻 `<audio preload="auto">`（与参考项目一致），由 `sound.ts` 直接 `play()` |

### 3.2 客户端镜像状态 `S`（app.ts）

| 字段 | 语义 |
|---|---|
| `role` / `side` | 主机/加入者、红/黑（来自 `welcome`） |
| `board` / `turn` / `check` | 主机广播的棋盘镜像 |
| `moveSeq` | 最近一次广播的版本号 |
| `status` / `winner` / `reason` | 对局状态与结果 |
| `selected` / `moves` | 当前选中的棋子与本地计算的合法落点（仅提示用） |
| `lastMove` | 上一步高亮 |
| `pending` | 已发出、等待对方回应的请求（`'draw'` / `'restart'` / `'undo'` / null），驱动 `req-hint` 等待提示 |
| `oppAway` | 对手意外断线、宽限等待重连中：状态框显示等待文案，棋盘冻结不可交互；收到快照或对手回来时清除 |
| `history` | 完整着法序列（棋谱 / 吃子 / 悔棋展示的数据源） |
| `deadline` | 本回合截止时间（计时读秒倒计时显示）；null 表示不限时 |
| `spectator` | 观战模式：只读渲染、隐藏对局操作、双方名称不带「你/对手」 |
| `aiMode` | 本机创建的人机对战（AI 执黑）：角色提示显示「人机对战 · AI 执黑」 |
| `skin` | 当前皮肤（`stype1/2/3`），来自 `localStorage`（键 `lanschess-skin`），不可用时回退 `stype2` |
| `hover` | 鼠标悬停的交叉点（仅用于预高亮，非规则判定；快照同步与离开棋盘时清空） |
| `firstMode` | 主机在等待页选择的先手（红方）方式（`r` / `b` / `random` / `guess`），来自 `welcome.firstMode` 或本地选择 |
| `captureHint` / `hints` | 吃子提示开关与结果（`CaptureHints`）：开启时 `render()` 由 `refreshCaptureHints()` 重算，悬停 / 脉冲帧只读；仅对局进行中且非观战时有效（v2.10，见 [ADR-0009 §3.13](./0009-c-d-extensions.md)） |

> `welcome.side` 在 `random` / `guess` 下是**临时占位**（开局前才会最终确定）；
> 最终阵营以 `start.side` 为准（观战者为 null，保持红方视角）。

### 3.3 页面流转

```text
首页 ──创建对局──► 主机等待 ──(start)──► 对局 ──终局──► 侧栏结果卡（棋盘保持可见）──再来一局/返回首页
  └──加入对局──► 加入页 ──(welcome+playing / start)──► 对局
对局 ──离开──► 首页（主机同时调用 /api/host/stop）
```

### 3.4 消息处理（app.ts `handleMessage`）

| 消息 | UI 行为 |
|---|---|
| `start` | 应用快照 → 进入对局页 → toast「对局开始，红方先行」 |
| `move_applied` | 更新镜像并重绘；`status='over'` 时侧栏切换为结果卡与「再来一局/返回首页」 |
| `move_rejected` | toast「走子无效：<原因>」 |
| `state` | 应用快照；主机收到 `waiting` 时关闭弹层并切回等待页（宽限超时/放弃等待），`idle` 时回首页 |
| `game_over` | 应用快照（结果卡由 `updatePanel` 呈现，不遮挡棋盘） |
| `draw_request` | 弹层「对方请求和棋」→ 同意/拒绝发送 `draw_response` |
| `draw_response` | 清空 `pending`；拒绝时 toast 提示 |
| `restart_request` | 弹层「对方请求重开」→ 同意/拒绝发送 `restart_response` |
| `restart_response` | 清空 `pending`；拒绝时 toast 提示 |
| `undo_request` | 弹层「对方请求悔棋」→ 同意/拒绝发送 `undo_response` |
| `undo_response` | 清空 `pending`；同意 → toast「悔棋成功，已回退一步」，随后 `state` 全量同步；拒绝 → toast 提示 |
| `opponent_joined` | 关闭弹层；对局中 → toast「对手已重新连接」；等待中 → 更新等待页文案 |
| `opponent_away` | 置 `oppAway`：状态框显示「对手已断开，等待重连…」，棋盘冻结；弹层「对手已断开」，主机可选「等待新对手」（发 `wait_new_opponent`） |
| `opponent_left` | 对局中：弹「对手已离开」；否则 toast |
| `error` | toast 服务端错误消息（如「尚未加入对局」），不再静默丢弃 |
| `guess_request` | 猜先第二步：客方弹层「猜先」提供「猜单 / 猜双」（回 `guess`）；主机：等待文案改为「进入猜先：等待加入者猜单双…」 |
| `grasp_request` | 猜先第一步：主机弹层「猜先」提供「抓单 / 抓双」（回 `grasp`），等待文案改为「猜先：请选择抓单或抓双…」；客方不会收到该消息 |
| `first_result` | 关闭猜先弹层；`random` / `guess` 用 toast 提示席位结果（含猜先选择、实际结果与归属） |

`applySnapshot` 会同时清空 `selected` / `moves` / `pending` / `oppAway`，保证任何全量同步后回到干净状态。

### 3.5 棋盘渲染规格（board.ts，Canvas + 素材）

皮肤几何参数（与参考项目 `com.stype` 完全一致；`discX/discY/disc` 为实测素材内圆盘偏移与直径，
仅用于视觉中心与点击命中）：

| 皮肤 | 画布 | 格距 | 贴图起点 | 圆盘偏移 | 圆盘直径 | 素材目录 |
|---|---|---|---|---|---|---|
| `stype1` 经典小盘 | 325×403 | 35 / 36 | 5 / 19 | 18 / 17 | 27 | `assets/img/stype_1/` |
| `stype2` 木质大盘（默认） | 523×580 | 57 / 57 | 3 / 5 | 27.5 / 24 | 47 | `assets/img/stype_2/` |
| `stype3` 雅致棋盘 | 530×567 | 57 / 57 | -2 / 0 | 23.5 / 23.5 | 40 | `assets/img/stype_3/` |

绘制计划 `computeDrawList(view, skin)`（纯数据，可单测）：

| 顺序 | 元素 | 画法 |
|---|---|---|
| 1 | 棋盘底图 | `bg.png` 贴于 (0,0)，画布尺寸即皮肤尺寸（与参考项目一致，超出部分自然裁切） |
| 2 | 上一步 | 起点/终点各贴一张落点框 `r_box.png`（红色四角框） |
| 3 | 当前选中 | 落点框 + 被选中棋子压暗到 `alpha 0.75`（参考项目做法） |
| 4 | 合法落点 | 空位贴提示点 `dot.png`（参考项目固定 +10 偏移）；可吃子改画空心红环（本项目增强） |
| 5 | 棋子 | `${红/黑}_${车马相仕帅炮兵→c m x s j p z}` 贴图，坐标为 `space*坐标 + pointStart` |
| 6 | 吃子提示（v2.10） | `capture`：绿色环（`#2f9e44`）= 可吃的对方棋子（无根 / 小换大）、红色环（`#d64545`）= 会被吃的己方棋子；半径 `disc/2 + 4`、宽 3、alpha 0.9（规格见 [ADR-0009 §3.13](./0009-c-d-extensions.md)） |
| 7 | 将军警示 | 被将军一方将帅加红色脉冲环（半径 `disc/2 + 6`，透明度随时间正弦变化）；`kingShake` 使该枚棋子贴图按 `dx/dy` 抖动位移（约 40ms 重绘一帧，见 §3.5.7） |
| 8 | 悬停预高亮 | 本方可操作时，己方棋子 / 合法落点画金色环（半径 `disc/2 + 3` / 13） |
| 9 | AI 推荐（复盘） | `hint`：起点细金环（宽 2.5 / alpha 0.7）、终点粗金环（宽 3.5 / alpha 0.95）；落点为空时叠加素材提示点，吃子时不叠加 |
| 10 | 抬起 / 走子动画 | `lifts` 的棋子原地升降、`anim` 的棋子由起点移到终点；连同椭圆落影画在最上层，这些格的静态贴图跳过（见 §3.5.5） |
| 11 | 战术闪电（v2.10） | `threats` 的每枚被威胁敌方棋子画折线闪电（`BoltOp`，画在棋子之后；闪烁 `alpha*(0.55+0.45*sin(time/90+seed))`，见 §3.5.7） |

坐标换算：
- 视觉中心 `cellCenter` = 贴图起点 + 素材圆盘偏移；
- `pickCell(px, py, skin, flip)` 以视觉中心四舍五入取最近交叉点，行/列越界或距离超过 `0.75×spaceX` 返回 null；
- `canvasPoint(canvas, clientX, clientY, skin)` 按画布 CSS 显示尺寸等比换算回画布内部坐标（响应式缩放后点击仍准确）；
- 视角翻转 `toView/toLogic`：黑方视角 `[9-r, 8-c]`（底图不翻转，棋子/落点按翻转后坐标贴图）。

### 3.5.1 皮肤与音效（v1.4）

| 项 | 规格 |
|---|---|
| 皮肤切换 | 首页「更换皮肤」→ `nextSkin` 循环 `stype1 → stype2 → stype3`；切换时套用页面背景 `bg.jpg`、按需加载该皮肤素材并重绘；对局进行中禁止切换（toast 提示）；偏好写入 `localStorage` |
| 素材加载 | `loadSkinImages(skin)` 预加载 `bg / dot / box / 14 枚棋子`，按皮肤缓存（同一皮肤只加载一次）；加载完成补一次重绘，缺图静默跳过 |
| 音效 | `sound.ts`：选子 `select.wav`、走子（收到 `move_applied`）`click.wav`；**播放方式与参考项目一致**——`index.html` 常驻 `<audio preload="auto">`（`click-audio` / `select-audio`），只调 `play()`，**不重置 `currentTime`**（重置会在声音未播完时强行 seek，产生原版没有的截断杂音）；播放失败静默忽略（自动播放策略） |
| 服务器 | 静态资源需按 MIME 下发：`.png / .jpg / .wav` 已加入主机服务 MIME 白名单 |

### 3.5.2 对局回顾与复盘（review.ts，v1.5）

| 项 | 规格 |
|---|---|
| 入口 | 首页「对局回顾」`btn-history` → `screen-history`（列表） |
| 列表数据 | `GET /api/history`（主机内存中的最近 50 局，最近在前）；每行四列：**红黑方**（席位 + 红/黑）、**取先方式**、**时间**（MM-DD HH:mm）、**胜负**（红胜/黑胜/和棋 + 原因） |
| 空列表 | 显示「暂无对局记录，先下完一盘棋吧」 |
| 进入复盘 | 点击某行 → `GET /api/history/:id`（含着法）→ `screen-replay`；`reloadImages()` 后再绘制 |
| 复盘棋盘 | 复用 `renderBoard`：`replayBoard(moves, index)` 逐步还原局面、`lastMove` 为当前步、`checkKing` 按行棋方是否被将军、`hint` 为 AI 推荐 |
| 步进 | 「◀ 上一步」「下一步 ▶」一次一步；「开局 ⏮」「末步 ⏭」直接跳转；到边界时按钮 `disabled`；← / → 方向键等效（仅复盘页激活时生效） |
| 当前局面 | 「第 n / 总步数 步 · 本步：<中文记谱>」（`describeMove` 按走子前局面生成），第 0 步显示「开局局面」 |
| AI 推荐 | 每步变化后用 `GET /api/ai/hint?id&index` 请求（120ms 防抖 + 序号防乱序）；文案「红方/黑方推荐：<记谱>」，无着法时显示「已终局或无需走子」 |
| 皮肤联动 | 切换皮肤后 `redraw()` 重绘复盘棋盘 |
| 返回 | 「返回列表」`btn-replay-back`；ESC 依次从复盘 → 列表 → 首页 |

### 3.5.3 主界面尺寸、放大与木框对齐（v1.6）

主界面（首页 / 等待 / 加入，均为木质挂板 `.menu_box`）与对局页、对局回顾页分离：
**只有主界面使用放大变量，对局与回顾保持原尺寸**。

| 项 | 规格 |
|---|---|
| 整体放大 | `:root { --ui-scale: 1.25 }`；`.menu_box` 应用 `zoom: var(--ui-scale)` 等比缩放（背景图、按钮随 zoom 一起放大）；`@media (max-width: 480px)` 回退 `1`，避免手机浏览器入局时水平溢出（v2.2 起删除了页脚 `.home-hint`，缩放只作用于首页挂板） |
| 挂板几何 | 背景 `init_bg.png` 316×422（内含美术标题与挂绳）；`box-sizing: content-box` + `padding-top: 158` + `height: 264`，padding box 恒为 422（背景图完整显示，含底框）；首页入口由 `.menu_init { padding-top: 6 }` 起排，**v2.5 起 6 个入口按 `6×43 + 6 = 264` 铺满按钮区**（按钮素材 214×92 为正常 / 悬停两态各 46px，故 `background-size: 214px 86px` 等比压到 43px、悬停偏移同步改为 `center -43px`；v1.6 起为 5 个入口 × 46px + `padding-top: 32`） |
| 木框内框 | 实测内表面 x≈10..290、y≈158..395（10px 深色边框）；内容区自 y=158 起，与内框上沿对齐 |
| 面板对齐（**v2.2 已被「大面板」取代**） | `.menu_info` 统一 `width: 280`、`margin: 0 0 8px 10px`（与内框同宽、左/上对齐）：等待页版块 `.menu_info.wide` 另加 `height: 237` 铺满内框（280×237）；人机页面板自动高 + `8px` 间距的「开始对弈」；加入页 `#screen-join .menu_info` 限高 `183`（= 237 − 46 − 8）且内部滚动，保证面板 +「连接」按钮都落在内框内。**v2.2 起点击板块后的界面改用 `.panel-lg` 大面板（独立于木框，见 [ADR-0010 §10](./0010-room-server.md)），木质挂板只承载首页入口** |
| 署名遮盖 | 主页背景 `init_bg.png` 底部原含参考项目作者署名「@一叶孤舟 QQ:28701884 欢迎交流」，已用目录中的 `cover.bmp` 中段木板条带（羽化边缘、就近映射回原调色板）覆盖；仍为 8bit 索引 PNG，透明区（画面四角与阴影）保持不变 |

验收（自动化）：[tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts) 以像素级检查署名区域
（无暗色文字像素、透明区不变）并断言缩放范围（zoom 仅出现在 `.menu_box`）、首页挂板入口结构、
大面板（`.panel-lg`）与列表行 / 邀请玩家列表 / 取先下拉框 / 无页脚小字等布局契约（v2.2 更新；
v2.4 追加视觉精修契约，见 §3.5.4）。

### 3.5.4 v2.4 视觉与交互精修（令牌化 / 状态反馈 / 动效 / 无障碍）

在 v2.2 的「大面板」结构与 v1.4 的木质素材风格之上做**不动结构、只精修表达**的一轮：
统一视觉语言、强化对局过程中的状态可见性、补足键盘与减弱动效支持。原则：只保留一种强调色（金），
所有可点击元素状态一致（hover / active / disabled / focus-visible），装饰性动效在
`prefers-reduced-motion` 下全部关闭。

| 项 | 规格 |
|---|---|
| 设计令牌（`:root`） | 木色层次 `--wood-deep/--surface-0..3`、线条 `--line/--line-strong`、强调 `--accent/--gold/--gold-bright`、文本阶梯 `--text/--text-dim/--text-mute`、`--radius/--shadow-panel/--shadow-pop/--focus-ring/--ease`；组件只引用变量，不再散落字面色值（`--ui-scale` 仍只作用于 `.menu_box`） |
| 层级 | 面板标题 17px/金 → 分组标题 12px/金 + 字距 → 正文 `--text` → 说明 `--text-dim`；面板头部与内容之间加发丝分隔线（`.panel-lg-head`） |
| 背景焦点 | `body::before` 全屏暗角（radial-gradient，`pointer-events: none`），压低木纹背景干扰，让挂板 / 面板成为视觉焦点 |
| 按钮与状态 | `.btn` family 统一 hover 上浮 1px + 提亮、active 回落按压、`:disabled` 去饱和且 `not-allowed`；`.bn_box input` 与 `.btn` 同步；`.btn.ghost` 为木面反色（金字） |
| 焦点可见 | 键盘 `:focus-visible` 统一金色焦点环（`--focus-ring`）；挂板入口 `a:focus-visible` 用 2px 金描边；鼠标点击不出现焦点环 |
| 动效（克制） | 切屏 `screen-in`（淡入 + 上浮 10px，0.26s）、弹层遮罩 `fade-in` + 弹层 `modal-in`（缩放淡入）；列表行 hover 横移 2px 提示「可点进去」；`prefers-reduced-motion: reduce` 时动画与过渡降到 0.001ms |
| 对局侧栏 | 「轮到你走棋」用浅金实底 `.status-box.mine`（与主按钮呼应，一眼可辨该谁走）；将军 `.check`、终局 `.over.*` 仍在 `.mine` 之后定义，优先级更高，保持原警示配色；玩家行左侧加红 / 黑细色条，走棋方整行加亮，「走棋中」为胶囊标签（`.tag:empty` 不渲染）；将死时状态框下方追加**终局杀法框**（`.kill-box`，与状态框同款面板 + 左侧金色发丝，只引用设计令牌；含杀法名 `/`.kill-name`/、解说 `/`.kill-def`/、同时构成的其它杀法 `/`.kill-also`/`，规则见 [ADR-0009 §3.11](./0009-c-d-extensions.md)）。**v3.5 起**：`S.repetitionHint` 为真（三次重复但无人长打）时状态框文案为「重复局面 · 请变招」（将军 `.check` 警示优先于本行），并弹一次轻提示「重复局面，请变招」（`maybeVaryHint`，同一手按 `moveSeq` 去重） |
| 列表与表单 | 房间号做成徽章（`.room-row .room-no`）；回顾页签未选中态改为描边幽灵样式（不再是深色块）；单选按钮 `accent-color: var(--accent)`；输入框 hover/focus 描边 + 金色光圈；滚动条统一细金色（`scrollbar-width/color` + `::-webkit-scrollbar`） |
| 细节修正 | 轻提示允许换行（`max-width: min(86vw, 460px)`，窄屏不再溢出）并带 `role="status" aria-live="polite"`；右上角服务器 / 账号入口超宽省略（`max-width: 46vw` + ellipsis） |
| 小屏 | `@media (max-width: 480px)` 除挂板回退 1 倍外，大面板内边距收紧（14px），右上角入口靠边 8px |

验收（自动化）：同 §3.5.3 的 [tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts)
追加断言：`:root` 令牌、`:focus-visible` 焦点环、切屏 / 弹层动效与 `prefers-reduced-motion`、
`.status-box.mine`（含 `app.ts` 的 class 切换）、`.tag:empty`、toast 换行与 aria 语义、房间号徽章、暗角层、
以及终局杀法框（HTML 结构 + 只引用令牌的样式 + 小屏同列铺满）。

### 3.5.5 v2.8 走子动画与棋盘正中提示条（v2.9：改为「点击棋子抬起」）

在 v1.4 的 Canvas + 素材渲染之上，给「选子 / 落子」与「将军 / 将死」补上动效反馈：
**点击棋子即抬起**，走子时在抬起状态上平移、落点再放下；将军 / 绝杀在棋盘**正中**弹**纯文字大字**
（v3.7 起去掉黑色圆底 / 圆框 / 暗红斜线与下方小字，改为楷体加粗大字；将军显示「将军」，绝杀直接显示具体杀法名——v3.8 起为纯杀法名，困毙显示「困毙」），
显示 2.5s 后渐出消失；被将军的将（帅）同时**颤抖**（闪电 / 颤抖与战术 / 开局提示见 §3.5.7）。
原则同 v2.4：克制、可被 `prefers-reduced-motion` 关闭（信息仍保留）。

| 项 | 规格 |
|---|---|
| 点击抬起 / 落下（v2.9） | `board.ts` 的 `BoardView.lifts = [{ pos, t }]`（`t` 为 0..1 抬起进度）驱动；纯函数 `liftFrame()` 只在原交叉点升降（升高 `0.42×格距`、放大到 1.14、出现落影）。`app.ts` 点击己方棋子 → `liftPiece()`（同一时刻只抬起一枚，先前拾起的先落下），取消选中 / 点到空位 / 右键 / ESC → `lowerAllLifts()` 落回；单帧时长 `LIFT_MS = 200ms`，由 `requestAnimationFrame` 推进 |
| 走子动画（抬起 → 移动 → 放下） | `BoardView.anim = { from, to, piece, t, startLifted }` 驱动；`moveAnimFrame()` 给出该帧的贴图坐标 / 缩放 / 抬起量 / 落影。三段式：**抬起**（0→0.28）→ **移动**（→0.72：保持抬起平移，缓动 `easeInOut`）→ **放下**（→1）。`startLifted` 为真（点击选中时已抬起）时**省去起身段**，直接从平移开始；对手 / AI 走子仍是完整三段。动画期间该棋子起点 / 终点格不再静态贴图，抬起的棋子与走子帧（`DrawOp.scale` 以圆盘中心为锚点缩放）连同椭圆落影（`ShadowOp`）画在最上层，先落影后棋子 |
| 动画接线与时长 | `app.ts` 在联机 `move_applied`、本地人机 / 残局的走子后调用 `animateMove(from, to, startLifted)`，用 `requestAnimationFrame` 在 `MOVE_ANIM_MS = 460ms` 内推进（抬起与走子共用一条帧循环，只有「正在动」时才持续重绘，保持抬起时停帧）。`prefers-reduced-motion: reduce` 时不做抬起 / 走子动画（选中仍以压暗 `alpha 0.75` + 落点框表达）。终局紧随 `move_applied` 到达的 `game_over` 用 `applySnapshot(state, { keepAnim: true })` 保留在跑的动画；悔棋 / 重开 / `state` 全量同步清空动画与抬起状态 |
| 提示内容（banner.ts） | `renderer/banner.ts`（纯数据、无 DOM）：`bannerContent(kind, opts)` 只组装大字——将军固定「将军」；**绝杀直接显示具体杀法名**（`opts.label`，**v3.8 起为纯名称**，如「马后炮」「八脚马」；困毙终局同样显示「困毙」；缺省退回「绝杀」）。v3.7 起不再有副标题（下方小字已删除），也不再按杀法维护图案样式表 |
| 显示与动效 | 结构：`.chess-box > .board-stage`（相对定位，仅包住画布）内，画布之后放 `.board-banner`（绝对定位铺满、居中、`pointer-events: none`）> `#banner-name`（**纯文字大字**，无背景 / 无边框 / 无圆角）。`.board-banner.show` 触发 `@keyframes banner-cycle 2.5s`：渐入（0→14%）→ 保持（→80%）→ 渐出（→100%），`app.ts` 在 `BANNER_MS = 2500ms` 后移除并隐藏；`showBanner()` 只写 `#banner-name` 的 `data-kind`（check / mate）与文本；每次走子按局面判定（`maybeBanner()`），联机的 `game_over` 与 `move_applied` 用 `moveSeq` + 类型去重 |
| 字体与配色（v3.7） | 大字用 `--font-chess`（`"STKaiti", "KaiTi", "楷体", "Kaiti SC", "LiSu", "隶书", "SimSun", serif`）并 `font-weight: 900` + 1px 深色描边加粗；将军 `#fff3d6`（58px）、绝杀 `#ff3b30`（46px，略小以免长杀法名超出棋盘），均带深色描边 / 阴影保证压在木纹棋盘上也清晰 |
| 无障碍 / 减弱动效 | 提示条 `role="status" aria-live="assertive"`；`prefers-reduced-motion: reduce` 下**去掉缩放 / 淡入动效但保持可见**（信息不丢），2.5s 后由脚本隐藏 |

验收（自动化）：[tests/board.test.ts](../../tests/board.test.ts)（抬起帧原地升降与夹取、抬起格跳过静态贴图、`startLifted` 省去起身段、动画一帧几何、落影、翻转与纯函数性、**`BoltOp` 闪电与 `kingShake` 抖动**）、
[tests/banner.test.ts](../../tests/banner.test.ts)（**将军固定「将军」/ 绝杀大字直接显示具体杀法名（缺省退回「绝杀」）/ 不改动传入参数**）、
[tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts)（`#banner-name` 纯文字结构（无 `banner-card` / `banner-slash` / `banner-sub`）/ 2.5s 渐入渐出 / 无黑底无圆框 / 楷体加粗与 `data-kind` 白红配色 / 减弱动效仍可见 / `app.ts` 接线：点击抬起、取消落回、走子从抬起态平移）。

### 3.5.6 v2.9 被吃掉的棋子展示（棋盘两侧缩略图；v3.3 放大并保留红黑原色）

把「吃子」从侧栏的**文字列表**改为棋盘**两侧的棋子缩略图**：删除侧栏文字面板，被吃掉的子以素材缩略图
摆到棋盘左右两侧。v3.3 起缩略图**放大**（26px → 34px）并**保留红 / 黑原色**（去掉去色 / 压暗），
数据改由权威状态机下发的 `capturedByRed/Black` 驱动。

| 项 | 规格 |
|---|---|
| 数据 | v3.3 起改用 [game.ts `snapshot()`](../../src/shared/game.ts) 下发的 `capturedByRed/Black`（[room.ts `applyAndBroadcast()`](../../src/server/room.ts) 走子广播同步携带）——标准 / 揭棋 / 残局 / 人机一律包含；渲染层直接采用，**不再**按着法序列从标准开局推导（`notation.ts capturedPieces(history)` 保留为通用工具，残局自定义开局下会推出并不存在的「死子」故不再使用）；侧栏原「红方吃子 / 黑方吃子」文字面板删除 |
| 结构 | `index.html` 对局页 `.chess-box > .board-row`（三栏 flex 居中）：左 `.cap-strip#cap-red`（红方所吃 = 黑子）+ 中间 `.board-stage`（画布 + 提示条）+ 右 `.cap-strip#cap-black`（黑方所吃 = 红子） |
| 渲染 | `app.ts renderCaptured()` → `fillCapStrip()`：按 `assetUrl(skin(), side + '_' + PIECE_IMG[t])` 生成 `<img class="cap-piece">`，保留红 / 黑原色；以「皮肤 + 棋子序列」为签名，未变则跳过重建避免闪烁；揭棋用快照记录的吃子（含暗子真实身份）。素材映射 `PIECE_IMG` 由 `board.ts` 导出复用 |
| 放大与原色 | `.cap-piece { width: 34px }`（v3.3 由 26px 放大），**不再** `filter: grayscale(1) opacity(0.55)`——被吃掉的子按素材呈现红 / 黑原色 |
| 布局 | `.cap-strip { align-self: stretch; flex-direction: column; flex-wrap: wrap; justify-content: center }`：随棋盘高度拉伸并纵向居中；条宽 40px、缩略图 34px。空条仍占位（左右对称，棋盘保持居中） |
| 无障碍 | 吃子条 `aria-hidden="true"`、缩略图 `alt=""`：与盘面重复的纯装饰信息，不进入可访问性树 |

验收（自动化）：[tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts)（侧栏文字面板与其样式已删除、
两侧吃子条结构顺序与三栏居中、缩略图放大且不再置灰、`app.ts` 用素材渲染且不再有文字映射）。

### 3.5.7 v2.10 战术闪电与开局提示（将军 / 绝杀大字与将颤抖）

在 §3.5.5 的动效之上，v2.10 加上正中提示与将颤抖，v3.7 起正中提示改为**纯文字楷体大字**（无黑底 / 无圆框 / 无小字），
并新增**战术特效**（闪击 / 闪将 / 将军抽（马 / 车 / 炮）/ 串打 / 捉双）与**开局招法提示**：
战术与开局的**文字放在棋盘上方**（v3.7 起为**黑色方框** + 楷体加粗），战术**被威胁的敌方棋子周围画闪电**。
判定全部走纯函数（可单测），视觉只在 `renderBoard` 里按时间推进。

| 项 | 规格 |
|---|---|
| 战术识别（`shared/tactics.ts`，纯函数） | `detectTactics(before: Board, move: Move, after: Board): TacticHit[]`，`TacticHit{ kind, label, actors: Pos[], threats: Pos[] }`；`kind` ∈ `discovered-check`（闪将）/ `discovered-attack`（闪击）/ `check-fork`（将军抽）/ `skewer`（串打）/ `fork`（捉双）。导出 `VALUE`（子力价值：车 9 > 炮 4.5 > 马 4 > 士/象 2 > 兵 1）。**不改动传入棋盘**；走子方由 `before[from]` 取 |
| 判定口径（严格顺序） | **先看是否照将**——照将走「闪将 / 将军抽」分支，不照将走「串打 / 捉双 / 闪击」分支。① **将军抽**（将军抽车 / 马 / 炮）：本着一身二任——将军（**直接将军或闪将**）+ 同时捉**能获利吃到的大子**（车 / 马 / 炮），且 `unavoidablyLost()` 要求**对方任一应着后仍至少一枚被抽子能被获利吃到**（`profitableTargets` 口径：无根白吃 / 小换大；**我方任意子**吃下即可，不限于走动的子）。被抽子两类：**走子后直接攻击到的大子**（我方任意子 / 后方子力发出），或**被照之将同线后方的大子**（`behindKingVictim()`：对方应将、将移开该线后即落入照将直线子的攻击口——经典抽将）。**被抽子须是本步新造的威胁**——走子前先算一次 `profitableTargets(before, me)`（`winsBefore`），已在其中的子（我方原本就白吃着的子）与这步将军无关，不算「抽」（否则「本来就有攻击 + 任意一步将军」都会被误报为将军抽）。② **闪将** = 只将军、**未同时捉大子**，要求存在「**非走动的子**」的 checker 因**让线**而成将（checker 限车 / 炮）。③ 不照将分支：**串打** = 走动的车 / 炮沿**同一条射线**攻击**前、后两枚都价值 ≥马** 的敌子；**捉双** = 走动的**单枚子**同时攻击 ≥2 个价值 ≥马 的敌子（**不含**「两子分捉」）；**闪击** = **双向双威胁**——让线后**新威胁**到的敌方子（非将，攻击者为**非走动的直线子力**，要求「after 有、before 无」）**＋ 移开的棋子自身也须带威胁**（走子后捉到、走子前我方并未攻击的敌方大子，如马 / 兵 / 前炮移开后反捉一车）；两条件缺一不可，只让线而移开的子自身不捉子（躲子 / 闲走）不判闪击（「将」由闪将分支负责，「献子」等无法静态判定的从略）。④ **两者必然失去其一 + 能获利吃到**——将军抽 / 串打 / 捉双都须通过 `unavoidablyLost()`（抽将，我方任意子）或 `mustLoseOne()`（串打 / 捉双，走动的这枚子）：逐个模拟对方的**每一种**合法应着（复用 `repliesOf`，每个应着局面只算一次获利集），被威胁子仍至少有其一**能被获利吃到**，据此排除「被威胁子反吃攻击子」「垫子挡住射线」「移走炮架」「移子**蹩马腿**同时挡将」以及**有根且不划算**（等价或亏）等能两全的伪战术。**获利口径对将军抽 / 串打 / 捉双一视同仁**（v3.2 曾试、v3.3 曾撤销；**v3.5 起对多子战术统一恢复**） |
| 输出与优先级 | **只输出 1 条**：绝杀 > 将军抽（将军 + 捉大子）> 闪将（只将军）> 串打 > 捉双 > 闪击；**照将与不照将互斥**（照将分支只出闪将 / 将军抽，不照将分支只出串打 / 捉双 / 闪击）；仅 `status === 'playing'` 检测；`threats` 为该条被威胁的敌方棋子（供闪电） |
| 接线与去重（app.ts） | 状态 `S.fx = { seq, hits } \| null` 与 `S.threats: Pos[]`；`applyMoveEffects(before, move, seq)` 组装；**取 `before`**：联机在 `S.board = msg.board` **之前** `cloneBoard(S.board)`、本地在 `applyMove` 前 `cloneBoard`，`game_over` 同 `seq` 由 `fx:${seq}` 去重**不重算**；`applySnapshot()` 重置 `fx / threats / fxOpening`（防悔棋 / 重连残留）。每步只算一次并存入 `S`，**不在 `paint()` 里重算** |
| 棋盘上方提示条 | **v3.9 起移到画布之外、棋盘正上方独占一行**：`.chess-box > .board-tactics-slot`（flex 居中，`min-height: 64px` 常驻占位，出现 / 消失不推动棋盘）内放 `#board-tactics`（不再绝对定位、不压住棋盘；`pointer-events: none`，**v3.7 起黑色方框**：`background: #000` / `border-radius: 0`，字用 `--font-chess` 楷体并 `font-weight: 900`），显示战术 `label` / 开局名（无内容时不显示）；渐入渐出约 2.5s 后隐藏；`prefers-reduced-motion` 下去动效保持可见。**v3.9 起放大**：`font-size: 30px` / `letter-spacing: 6px` / `padding: 10px 36px`，小屏 `@media (max-width: 480px)` 收为 `22px` / `4px`、槽高 `46px`；对局页画布高度上限相应收为 `calc(100vh - 268px)` |
| 被威胁棋子闪电（board.ts） | `BoardView.threats?: Pos[] \| null` → `computeDrawList()` 在**棋子之后**推入 `BoltOp{ bolt: true, cx, cy, radius, color, alpha, seed }`（`cx/cy` 取 `cellCenter`，`seed = r*9 + c` **确定、禁用随机**；**v3.4 起基准半径放大为 `disc/2 + 12`**）；`renderBoard()` 画折线闪电 + 辉光（`lineWidth: 3`、`shadowBlur: 12`），闪烁 `alpha*(0.55 + 0.45*sin(time/90 + seed))`；`prefers-reduced-motion` 下静态不闪 |
| 将颤抖（board.ts + app.ts） | `BoardView.kingShake?: { dx, dy } \| null` → `computeDrawList()` 对 `checkKing` 那枚棋子的 `DrawOp` 做 `x += dx; y += dy`；`app.ts boardView()` 在将军出现后的**短窗口**内按 `performance.now()` 生成 `dx = A*sin(t/28)、dy = A*cos(t/19)`，幅度 `A = spaceX*0.03`（约为原 `0.06` 的一半）并随时间线性**衰减到 0**，`SHAKE_MS = 1100ms` 后不再颤抖（**不一直抖**）；每次新将军（行棋方 + `moveSeq` 变化）重新起算；`prefersReducedMotion()` 时不抖。`syncPulse()` 在**将军或存在 `fx`** 时以约 **40ms** 重绘（抖动停止后仍为脉冲环续帧） |
| 开局提示（`renderer/openings.ts`，纯函数） | `detectOpening(history: Move[]): { name: string; index: number } \| null`：从 `initBoard()` 回放，用 `notation.ts describeMove(board, from, to)` 取**红方首着**记谱查表——炮二平五 / 炮八平五 → 当头炮；马二进三 / 马八进七 → 起马局；相三进五 / 相七进五 → 飞相局；兵七进一 / 兵三进一 → 仙人指路；炮二平四 / 炮八平六 → 士角炮；炮二平六 / 炮八平四 → 过宫炮。**名称只给简称，不带括号别名**（v3.8）。**仅标准开局**（`!S.endgame`）显示，命中时在 `#board-tactics` **只显示开局名**（如「当头炮」，不再加「开局：」前缀） |
| 无障碍 / 减弱动效 | 上方提示条仅为视觉提示，不加 `aria-live`（避免与正中提示重复播报）；`prefers-reduced-motion: reduce` 下不做闪电闪烁与将颤抖，但提示文字与闪电静态形态仍可见 |
| 明确不做 | 战术识别为**启发式提示**，不改变任何规则 / 胜负判定；绝杀时**不再叠加**战术提示与闪电（正中大字已表达）；同一时刻**最多显示 1 条战术** |

验收（自动化）：[tests/tactics.test.ts](../../tests/tactics.test.ts)（各 `kind` 命中与反例：让线被挡 / 价值过低 / 非新攻击 / 只让线而移开的子自身不捉子（不判闪击） / 原本就白吃着的子后将军（不判将军抽） / 将死返回空 / 优先级只出 1 条 / 不改动棋盘 / 红黑对称）、
[tests/openings.test.ts](../../tests/openings.test.ts)（红方首着命中各开局、非首着与空着法返回 `null`）、
[tests/board.test.ts](../../tests/board.test.ts)（`BoltOp` 存在性与 `seed`、**放大后的基准半径 `disc/2 + 12`**、画在棋子之后；`kingShake` 使将位 `DrawOp` 坐标偏移）、
[tests/ui-home-layout.test.ts](../../tests/ui-home-layout.test.ts)（`#board-tactics` 结构、**v3.7 黑色方框 + 楷体加粗**、正中大字 `data-kind` 白红配色与无黑底 / 无圆框、减少动态效果块、`app.ts` 的 `detectTactics` / `detectOpening` 接线）。

### 3.6 走子交互（app.ts `onCell`）

| 场景 | 行为 |
|---|---|
| 已选中 + 点击合法落点 | 发送 `move{from, to}`，清空选中（等主机广播） |
| 已选中 + 点击己方棋子 | 切换选中并刷新落点 |
| 已选中 + 其他 | 取消选中 |
| 未选中 + 点击己方棋子 | 选中，`legalMoves` 计算落点（纯提示，主机仍会复核） |
| 未选中 + 点击对方棋子 | toast「这是对方的棋子」 |
| 非本方回合点击 | toast「还没轮到你走棋」 |
| 对局已结束点击 | 无响应（棋盘只读，保留终局画面） |

### 3.7 悬停反馈与快捷键（A 档增强）

| 项 | 规格 |
|---|---|
| 悬停预高亮 | `render()` 在「对局中且轮到自己」时传入 `interactiveSide`；`mousemove` 命中交叉点后写入 `S.hover` 并重绘，绘制计划对己方棋子 / 合法落点追加金色环 |
| 光标 | 悬停在可选中棋子或合法落点上时 `canvas.style.cursor = 'pointer'`，其余为默认；`mouseleave` 清空悬停；触摸设备不触发 mousemove，不受影响 |
| ESC | 有弹层时关闭弹层；复盘页 → 回顾列表；回顾列表 → 首页；否则调用 `clearSelection()` 取消棋盘选中 |
| 方向键 | 复盘页激活时 ← / → 等效「上一步 / 下一步」（一次一步） |
| 右键 | 棋盘 `contextmenu` 阻止默认菜单并取消选中 |
| 遮罩点击 | 点击 `modal` 遮罩空白处关闭弹层（等效「取消」） |
| 请求等待态 | `offerDraw` / `requestRestart` 发出后置 `pending` 并在 `req-hint` 显示等待文案，已有 `pending` 时防重复发送；收到响应或快照同步时清空 |
| 断线冻结 | 对手宽限等待重连期间（`oppAway`）棋盘与落点不显示交互态，点击提示「对手已断开，等待重连」 |

### 3.8 连接与心跳（net.ts）

| 项 | 规格 |
|---|---|
| 连接 | `connect(url, role)`：`open` 后发 `join`；收到 `welcome` resolve；首个 `error` reject 并关闭；`onclose/onerror` 且未 settle → reject「无法连接到主机」 |
| 心跳 | 5s 发 `ping{t: Date.now()}`；16s 无 `pong` 主动关闭（触发 `onClosed` 断线提示） |
| 主动关闭 | `close()` 置 `closing=true`，不触发断线提示 |
| 地址来源 | 主机：`ws://${location.host}/ws`；加入者：`ws://${ip}:${port}/ws`，端口须为纯数字 |

### 3.9 明确不做

落子补间动画、移动端专门适配（仅基础 viewport + 媒体查询）、断线自动重连（宽限期内手动重新加入即可恢复原局）、
聊天、棋谱导出/回放播放器。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 页面结构 / 控件 id | [index.html](../../src/renderer/index.html) |
| 镜像状态 `S` | [app.ts `S`](../../src/renderer/app.ts) |
| 页面切换/弹层/toast | [app.ts `show()` / `showModal()` / `toast()`](../../src/renderer/app.ts) |
| 消息处理（断线重连/悔棋分支） | [app.ts `handleMessage()`](../../src/renderer/app.ts) |
| 棋谱与吃子渲染 | [app.ts `renderNotation()`](../../src/renderer/app.ts) |
| 结束结果卡与操作组切换 | [app.ts `updatePanel()`](../../src/renderer/app.ts) |
| 皮肤/主题/素材预加载/脉冲重绘 | [app.ts `switchSkin()` / `applyTheme()` / `ensureSkinImages()` / `syncPulse()`](../../src/renderer/app.ts) |
| 创建/人机/复制地址/搜索/加入/离开 | [app.ts](../../src/renderer/app.ts) |
| 走子交互与悬停 | [app.ts `onCell()` / `bindEvents()`](../../src/renderer/app.ts) |
| 棋盘绘制计划与执行 | [board.ts `computeDrawList()` / `renderBoard()`](../../src/renderer/board.ts) |
| 正中大圆与战术 / 开局提示条 | [banner.ts](../../src/renderer/banner.ts)、[app.ts `maybeBanner()` / `applyMoveEffects()` / `showTactics()`](../../src/renderer/app.ts) |
| 战术识别与开局提示 | [shared/tactics.ts `detectTactics()`](../../src/shared/tactics.ts)、[openings.ts `detectOpening()`](../../src/renderer/openings.ts) |
| 皮肤定义与素材路径 | [board.ts `SKINS` / `assetUrl()` / `loadSkinImages()`](../../src/renderer/board.ts) |
| 坐标与点击命中 | [board.ts `cellCenter()` / `pickCell()` / `canvasPoint()` / `toView()`](../../src/renderer/board.ts) |
| 音效 | [sound.ts](../../src/renderer/sound.ts) |
| 对局回顾与复盘 | [review.ts](../../src/renderer/review.ts)（列表行渲染 / 复盘步进 / AI 推荐请求） |
| 先手方式选择 | [app.ts `renderSidePick()` / `chooseFirst()`](../../src/renderer/app.ts) |
| 素材与许可 | [assets/](../../src/renderer/assets/)（含 `LICENSE-ReferenceChess.txt`） |
| 局域网主机发现 | [discover.ts](../../src/renderer/discover.ts) |
| WebSocket 客户端 / 心跳 | [net.ts](../../src/renderer/net.ts) |

> 观战/悔棋/人机对战（含难度参数）/计时读秒/主机搜索的完整规格见 [ADR-0009](./0009-c-d-extensions.md)。

## 5. 验收标准

- 首页 → 创建 → 等待 → 开局 → 走子 → 终局结果卡（棋盘保持可见）→ 再来一局/返回首页，全流程无死路。
- 首页菜单、加入页、等待页均为参考项目木质挂板风格；对局页为木纹棋盘 + 图片棋子 + 棋盘下方按钮条 + 侧栏信息。
- 三套皮肤可循环切换（页面背景与棋盘同时更换、偏好持久化），切换后点击命中仍准确。
- 加入者执黑时棋盘自动翻转，点击命中与显示一致。
- 主机广播的任何快照都能正确渲染（包括 `check` 提示与终局状态）。
- 对方断线/主机断线均有明确弹层提示，不白屏、不崩溃。
- 对手意外断线：状态框显示等待重连、棋盘冻结；宽限内重连后弹层自动关闭并恢复对局；
  宽限超时自动回到等待页（弹层不残留）。
- 等待页地址可一键复制（非安全上下文降级为选中文本 + `execCommand`）。
- 悬停己方棋子/合法落点有预高亮且光标为手型；ESC / 右键可取消选中，ESC / 遮罩可关闭弹层。
- 选子/走子有音效；素材（png/jpg/wav）经主机服务按正确 MIME 下发，无 404。
- 主机等待页可切换先手方式（红 / 黑 / 随机黑红 / 猜先），猜先时客方弹层应答且双方都能看到结果；
  主机执黑时其棋盘自动翻转、红方（客方）先行。
- 对局回顾列表按「红黑方 / 取先方式 / 时间 / 胜负」展示已结束对局；点击进入复盘后
  右箭头（或 → 键）一次一步，棋盘与中文记谱同步，AI 推荐随步数刷新并高亮在棋盘上。
- 请求发出后侧栏显示等待状态；矮窗口下棋盘按高度等比缩小、内容不被裁剪。
- 主界面（首页 / 等待 / 加入）整体按 1.25 放大且背景图同步放大，各页面无滚动条溢出；
  对局页与对局回顾页保持原尺寸（不随主界面放大）。
- 三个子面板（创建 / 加入 / 人机）与木板内框对齐：面板 280 宽、左/上对齐内框，
  面板与按钮均不越出木板内框；主页背景不再显示参考项目作者署名。
- v2.4 视觉精修：界面只使用一种强调色（金），色值与圆角/阴影/缓动全部取自 `:root` 令牌；
  键盘 Tab 到按钮 / 列表行 / 挂板入口有金色焦点环；切屏淡入与弹层缩放淡入在
  `prefers-reduced-motion: reduce` 下被关闭；对局轮到自己时状态框为浅金实底（将军 / 终局仍为警示配色）；
  窄屏下轻提示自动换行、右上角入口超宽省略，页面无水平溢出。
- v2.10 / v3.7 / v3.8 提示特效：将军 / 绝杀在棋盘正中显示**楷体加粗大字**（v3.7 起无黑底 / 无圆框 / 无小字，
  将军为「将军」、**绝杀直接显示具体杀法名**（纯名称，困毙显示「困毙」）；开局提示只显示开局名）；被将军的将（帅）可见**颤抖**；
  闪击 / 闪将 / 将军抽 / 串打 / 捉双的提示文字出现在**棋盘上方黑色方框**（楷体加粗）且**被威胁棋子周围有闪电**；
  开局首着给出「当头炮 / 起马局」等提示；开启「减少动态效果」后信息仍在但闪电 / 颤抖 / 渐入渐出被关闭。