# ADR-0007：渲染层模块规格（src/renderer/）

- 状态：已接受（记录现状实现；v1.4 起棋盘改为 Canvas + 图片素材）
- 日期：2026-10-03（v1.4 视觉改造：2026-10-06）
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
| 首页 | `screen-home` | 木质挂板菜单 `menu-index`：「创建对局」`btn-create`、「加入对局」`btn-show-join`、「人机对弈」`btn-create-ai`、「对局回顾」`btn-history`、「更换皮肤」`btn-skin`（5 个入口铺满挂板按钮区）；人机子菜单 `menu-ai`（难度单选 `ai-depth` 2/3/4 + `btn-ai-start` + 返回 `btn-ai-back`）；本机地址提示 `home-hint` |
| 主机等待 | `screen-host` | 版块与挂板内框对齐（实测 `init_bg.png` 内表面 x≈10..290、y≈158..395，面板 `280×237`）：标题 `info-title`（内含等待转圈 `spinner`）、地址大字显示 `host-ip`（**点击地址块 `ip-box` 即复制**，非安全上下文降级）、先手（红方）方式 `side-opts`（随机黑红 / 猜先 / 黑 / 红，选中态 `.active`）+ 说明 `side-hint`、等待文案 `host-wait`（猜先阶段显示进度）、取消 `btn-cancel-host`（素材返回箭头） |
| 加入 | `screen-join` | 地址输入 `join-ip`、端口输入 `join-port`、连接 `btn-connect`、观战 `btn-spectate`、搜索主机 `btn-scan` + 结果区 `scan-result`、返回 `btn-join-back`、提示 `join-msg` |
| 对局 | `screen-game` | Canvas 棋盘 `board`、棋盘按钮条 `bn_box`（`actions-play`：`btn-undo/btn-draw/btn-resign/btn-leave`；`actions-over`：`btn-play-again/btn-home`；`actions-spectate`：`btn-spectate-leave`）、侧栏双方信息 `p-top/p-bottom`、状态框 `status-box`（含倒计时）、请求等待提示 `req-hint`、吃子 `cap-red-list`/`cap-black-list`、角色提示 `role-hint`（**棋谱面板已移除，改由「对局回顾」复盘**） |
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
| 6 | 将军警示 | 被将军一方将帅加红色脉冲环（半径 `disc/2 + 6`，透明度随时间正弦变化，100ms 重绘一帧） |
| 7 | 悬停预高亮 | 本方可操作时，己方棋子 / 合法落点画金色环（半径 `disc/2 + 3` / 13） |
| 8 | AI 推荐（复盘） | `hint`：起点细金环（宽 2.5 / alpha 0.7）、终点粗金环（宽 3.5 / alpha 0.95）；落点为空时叠加素材提示点，吃子时不叠加 |

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