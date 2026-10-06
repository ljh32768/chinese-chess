# ADR-0009：C/D 档扩展模块规格（日志 / 记谱 / AI / 自动发现）

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：主机日志、棋谱与吃子、悔棋、观战、人机对战、计时读秒、局域网主机搜索
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

### 3.3 AI 引擎（server/ai.ts）

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

### 3.8 计时读秒

| 项 | 规格 |
|---|---|
| 开启 | `HostServerOptions.turnMs` 或环境变量 `LANSCHESS_TURN_MS`；默认 0（不限时） |
| 快照 | `GameSnapshot.deadline: number \| null`（epoch ms），随 `start` / `move_applied` / `state` 下发 |
| 主机行为 | 每次走子/悔棋/开局后 `armTurnTimer()` 重设截止时间；超时 `Game.timeout(行棋方)` → `over`，`reason='超时判负'` |
| 客户端 | 状态框追加「（剩余 xx s）」，每 500ms 刷新；终局/未启用时不显示 |

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 主机日志 | [log.ts](../../src/server/log.ts) |
| 中文记谱与吃子 | [notation.ts](../../src/shared/notation.ts) |
| AI 引擎 | [ai.ts](../../src/server/ai.ts)、[pickMove 调用](../../src/server/host-server.ts) |
| 自动发现 | [discover.ts](../../src/renderer/discover.ts) |
| 观战/悔棋/人机/计时服务端 | [host-server.ts](../../src/server/host-server.ts)（`handleJoin` / `undo_*` / `startAiGame` / `armTurnTimer`） |
| 状态机扩展 | [game.ts](../../src/server/game.ts)（`history` / `undo` / `timeout` / `deadline`） |
| 渲染层扩展 | [app.ts](../../src/renderer/app.ts)（棋谱面板 / 悔棋 / 观战 / 倒计时 / 搜索） |
| 工程化配置 | [package.json](../../package.json)（dev/lint/format/dist）、[.github/workflows/ci.yml](../../.github/workflows/ci.yml) |

## 5. 验收标准

- C 档：`npm run lint`、`npm run format:check`、`npm run build`、`npm test` 全部通过；
  `npm run dist` 可产出 Windows 安装包；`npm run dev` 可自动重启主机端。
- D 档（自动化）：见 [ADR-0008 §3.1](./0008-testing-strategy.md) 中 notation / ai / discover / server 新增用例。
- D 档（浏览器实测）：人机对战自动应招与悔棋、观战只读与棋谱同步、双人悔棋请求-回应、
  吃子面板、计时倒计时、主机搜索并连接，全部通过（2026-10-03 验证）。