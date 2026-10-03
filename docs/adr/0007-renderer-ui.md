# ADR-0007：渲染层模块规格（src/renderer/）

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：首页、主机等待页（含地址复制）、加入页、对局页、结束结果卡、断线提示与宽限重连、视角翻转、悬停反馈、快捷键、心跳
- 关联文档：[ADR-0003 通信协议](./0003-wire-protocol.md)、[ADR-0005 主机服务](./0005-host-server.md)

---

## 1. 背景

渲染层有两类使用者：Electron 主机窗口与加入者浏览器。
两者必须共用同一份页面与代码，只以角色（host/guest）和阵营（红/黑）区分；
渲染层是**非权威**的，一切以主机广播为准，本地计算仅用于交互提示。

## 2. 决策

- 页面为单页多屏（screen-home / screen-host / screen-join / screen-game），
  以 CSS 类 `active` 切换，不用路由。
- 棋盘用 **SVG 动态渲染**（字符串拼装 `innerHTML`），不引入框架与外部素材。
- 文件职责分离：`app.ts` 流程与交互、`board.ts` 纯渲染与坐标换算、`net.ts` 连接与心跳。
- 客户端本地状态对象 `S` 只保存「用于渲染的镜像」，不参与任何权威判定。
- 黑方视角通过坐标翻转（`flip`）实现，逻辑坐标与视图坐标显式互转。
- 对局结束不使用全屏遮罩：结果卡与结束操作放在侧栏，棋盘保持完整可见（终局最需要复盘棋盘）。
- 心跳：5s 间隔 `ping`，16s 未收到 `pong` 视为断线主动关闭。

## 3. 详细规格

### 3.1 页面结构（index.html）

| 屏 | id | 元素与入口 |
|---|---|---|
| 首页 | `screen-home` | 「创建对局」`btn-create`、「人机对战」`btn-create-ai`、「加入对局」`btn-show-join`、本机地址提示 `home-hint` |
| 主机等待 | `screen-host` | 地址大字显示 `host-ip`、复制地址 `btn-copy-ip`（非安全上下文降级）、等待文案 `host-wait`、取消 `btn-cancel-host` |
| 加入 | `screen-join` | 地址输入 `join-ip`、端口输入 `join-port`、连接 `btn-connect`、观战 `btn-spectate`、搜索主机 `btn-scan` + 结果区 `scan-result`、返回 `btn-join-back`、错误提示 `join-msg` |
| 对局 | `screen-game` | SVG 棋盘 `board`、双方信息 `p-top/p-bottom`、状态框 `status-box`（含倒计时）、请求等待提示 `req-hint`、棋谱 `move-list`、吃子 `cap-red-list`/`cap-black-list`、三组操作 `actions-play`（`btn-resign/btn-draw/btn-undo/btn-leave`）、`actions-over`（`btn-play-again/btn-home`）、`actions-spectate`（`btn-spectate-leave`）、角色提示 `role-hint` |
| 通用弹层 | `modal` | 标题 `modal-title`、说明 `modal-sub`、动态按钮 `modal-btns`；ESC / 点击遮罩可关闭；仅用于和棋/重开请求、认输确认、对手离开与断线提示，**不用于对局结束** |
| 轻提示 | `toast` | 1.8s 自动消失 |

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

`applySnapshot` 会同时清空 `selected` / `moves` / `pending` / `oppAway`，保证任何全量同步后回到干净状态。

### 3.5 棋盘渲染规格（board.ts）

| 常量 | 值 | 说明 |
|---|---|---|
| `CELL` | 56 | 格距 |
| `PAD` | 34 | 边距 |
| `R` | 24 | 棋子半径 |
| `viewBox` | `0 0 516 572` | 8×CELL+2PAD × 9×CELL+2PAD |

| 元素 | 画法 |
|---|---|
| 棋盘线 | 10 条横线 + 9 条竖线（中间列在楚河汉界处断开）+ 九宫斜线 + 外框 |
| 文字 | 「楚河」「汉界」 |
| 上一步 | 金色双圆环（from/to） |
| 合法落点 | 空点=绿色实心小圆（`mv mv-dot`）；可吃子=绿色空心环（`mv mv-cap`） |
| 棋子 | 圆盘 + 内圈 + 汉字（帅仕相马车炮兵 / 将士象马车炮卒），红黑配色；`interactiveSide` 一方的棋子带 `hoverable` 类与悬停环（`ring`，默认透明） |
| 选中 | 金色高亮环 |
| 将军/将死警示 | 被将军（含将死）一方的将/帅加红色脉冲环（`checkKing`，CSS `checkPulse`） |
| 视角翻转 | `toView/toLogic`：黑方视角 `[9-r, 8-c]` |

坐标换算：`pickCell` 将点击位置四舍五入到最近交叉点，超过 `0.52×CELL` 判定为无效点击；
`svgPoint` 处理 `preserveAspectRatio: meet` 下的 letterbox 偏移。

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
| 悬停预高亮 | `render()` 在「对局中且轮到自己」时传入 `interactiveSide`；己方棋子带 `hoverable`，CSS `:hover` 显示金色环；合法落点 `mv-dot` / `mv-cap` 悬停放大/加粗 |
| 光标 | `#board` 默认光标；仅 `.piece.hoverable`、`.mv-dot`、`.mv-cap` 为手型。触摸设备无 hover，不受影响 |
| ESC | 有弹层时关闭弹层；否则调用 `clearSelection()` 取消棋盘选中 |
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

动画/音效/皮肤、移动端专门适配（仅基础 viewport）、断线自动重连（宽限期内手动重新加入即可恢复原局）、
聊天、棋谱导出/回放播放器。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 页面结构 / 控件 id | [index.html](../../src/renderer/index.html) |
| 镜像状态 `S` | [app.ts](../../src/renderer/app.ts#L25-L49) |
| 页面切换/弹层/toast | [app.ts](../../src/renderer/app.ts#L53-L95) |
| 消息处理（断线重连/悔棋分支） | [app.ts `handleMessage()`](../../src/renderer/app.ts#L246-L371) |
| 棋谱与吃子渲染 | [app.ts `renderNotation()`](../../src/renderer/app.ts#L204-L244) |
| 结束结果卡与操作组切换 | [app.ts `updatePanel()`](../../src/renderer/app.ts#L139-L202) |
| 创建/人机/复制地址/搜索/加入/离开 | [app.ts](../../src/renderer/app.ts#L449-L628) |
| 走子交互 | [app.ts `onCell()`](../../src/renderer/app.ts#L681-L713) |
| 取消选中与快捷键 | [app.ts `clearSelection()`](../../src/renderer/app.ts#L672-L677)、[app.ts `bindEvents()`](../../src/renderer/app.ts#L715-L765) |
| 棋盘标记生成 | [board.ts `boardMarkup()`](../../src/renderer/board.ts#L72-L154) |
| 棋盘挂载 / 坐标与点击 | [board.ts `renderBoard()`](../../src/renderer/board.ts#L157-L159)、[board.ts](../../src/renderer/board.ts#L23-L62) |
| 局域网主机发现 | [discover.ts](../../src/renderer/discover.ts) |
| WebSocket 客户端 | [net.ts](../../src/renderer/net.ts#L38-L107) |
| 心跳 | [net.ts `startPing()`](../../src/renderer/net.ts#L124-L137) |

> 观战/悔棋/人机对战/计时读秒/主机搜索的完整规格见 [ADR-0009](./0009-c-d-extensions.md)。

## 5. 验收标准

- 首页 → 创建 → 等待 → 开局 → 走子 → 终局结果卡（棋盘保持可见）→ 再来一局/返回首页，全流程无死路。
- 加入者执黑时棋盘自动上下翻转，点击命中与显示一致。
- 主机广播的任何快照都能正确渲染（包括 `check` 提示与终局状态）。
- 对方断线/主机断线均有明确弹层提示，不白屏、不崩溃。
- 对手意外断线：状态框显示等待重连、棋盘冻结；宽限内重连后弹层自动关闭并恢复对局；
  宽限超时自动回到等待页（弹层不残留）。
- 等待页地址可一键复制（非安全上下文降级为选中文本 + `execCommand`）。
- 悬停己方棋子/合法落点有预高亮且光标为手型；ESC / 右键可取消选中，ESC / 遮罩可关闭弹层。
- 请求发出后侧栏显示等待状态；矮窗口下内容不被裁剪、可滚动。