# ADR-0008：测试策略与验收规格

- 状态：已接受（记录现状实现）
- 日期：2026-10-03
- 关联入口：`npm test`、交付前验证
- 关联文档：[Product-plan.md 第 14 节验收标准](../Product-plan.md)、[ADR-0002](./0002-rules-engine.md)、[ADR-0005](./0005-host-server.md)

---

## 1. 背景

MVP 的交付底线是「能完整、正确地下一盘棋」。
测试需要同时守住三层：规则裁判的正确性、主机服务的行为一致性、整局端到端的可回放性。
项目约定：**每次改动后必须编写或更新相关测试，并确保全部测试通过后才交付**。

## 2. 决策

- 测试框架：**vitest**（node 环境），配置见 [vitest.config.ts](../../vitest.config.ts)：`include: ['tests/**/*.test.ts']`。
- 测试分层：
  1. **单元层**：纯函数与状态机（rules、game、lan-ip、accounts、history），不启服务；
  2. **集成层**：真实 `GameServer` + 真实 WebSocket 客户端（server.test.ts）；
  3. **端到端层**：完整一盘棋回放（fullgame.test.ts），逐步断言双方一致性与终局。
- 测试客户端复用 [tests/ws-client.ts](../../tests/ws-client.ts)：封装 `open/send/waitType/close`，等待指定类型消息。
- 服务端测试使用**随机高位端口 + `staticDir: null` + `dataDir: null`**，避免端口冲突、静态资源与磁盘写入干扰。

## 3. 详细规格

### 3.1 测试清单

| 文件 | 层级 | 覆盖内容 |
|---|---|---|
| [rules.test.ts](../../tests/rules.test.ts) | 单元 | 开局 32 子；将帅九宫；各棋子走法（车/马蹩腿/炮架/象塞眼/士/将/过河卒）；照面；将军；将死/困毙；`validateMove` 各拒绝原因 |
| [game.test.ts](../../tests/game.test.ts) | 单元 | `reset` 初始态；合法走子切换回合/`seq+1`/`lastMove`；非本方回合拒绝；非法走子棋盘不变；吃子；认输/和棋/重开；终局清理 pending；悔棋回退；history 快照；**`setup()` 自定义局面（残局开局）与走子后终局判定** |
| [board.test.ts](../../tests/board.test.ts) | 单元 | 三套皮肤几何参数与素材路径；坐标换算与点击命中（含响应式缩放）；绘制计划：棋子贴图/上一步落点框/选中压暗/合法落点提示点与可吃子环/将军脉冲环/悬停预高亮/AI 推荐高亮；视角翻转 |
| [notation.test.ts](../../tests/notation.test.ts) | 单元 | 传统中文记谱（炮二平五/马八进七/卒3进1/前后消歧/斜走目标列）；describeHistory 回放；capturedPieces 吃子统计 |
| [ai.test.ts](../../tests/ai.test.ts) | 单元 | 一步杀、白吃子、无着法返回 null、开局着法合法且 depth=2 耗时 < 1500ms |
| [net.test.ts](../../tests/net.test.ts) | 单元 | 连接建立与消息分发；pong 内部消化；心跳 5s 与 16s 无 pong 判离线（假定时器 + 假 WebSocket）；主动关闭不提示；连接失败 reject |
| [fullgame.test.ts](../../tests/fullgame.test.ts) | 端到端 | 35 步将杀线回放：双方每步棋盘一致且与**服务器权威**棋盘一致；`seq` 单调 +1；终局 `game_over` 原因=`将死`；history 与着法线一致；结束后可重开回到初始局面 |
| [server.test.ts](../../tests/server.test.ts) | 集成 | 建房/加入/房号校验/房间不存在/满员/口令（无口令点击即入）；房间列表；走子广播与拒绝；非整数坐标；认输/和棋/重开（含拒绝分支）/悔棋/离开；观战只读与人数上限；断线宽限与 **playerId 重连恢复**；房主离开/宽限超时销毁房间；**终局无人「再来一局」销毁房间**；空闲回收；建房数上限；**两房间并发隔离**；先手方式（房主执黑、随机黑红、猜先猜中归属、非房主与对局中禁止改）与对局回顾（记录字段/明细/404/AI 推荐合法性）；注册登录与账号 token 归属；人机对战（AI 自动应招/自动同意悔棋/拒绝和棋/`depth` 难度）；计时超时判负；日志打点与端口回退；静态资源 MIME（含 png/jpg/wav）与路径穿越 |
| [review.test.ts](../../tests/review.test.ts) | 单元 | 复盘局面还原（逐步 / 越界收敛 / 行棋方交替）；列表文案（玩家名 / 取先方式 / 时间 / 胜负 / 四种取先方式） |
| [endgame.test.ts](../../tests/endgame.test.ts) | 单元 | 残局题库自洽（id 唯一 / 难度有序 / 棋子不重叠 / 双方有将 / 对方有子可走 / 先行方未被将军）；**逐条由求解器验证「目标步数内可强制取胜、且步数不能再少」**、正解首着合法且走完仍在杀棋内、非退化；求解器语义（一步杀 / 多步杀 / 困毙同将死 / 不改动传入棋盘 / 黑方对称）；渲染层接线契约 |
| [discover.test.ts](../../tests/discover.test.ts) | 单元/集成 | 真实服务器探测；无服务端口返回 null；网段扫描聚合、按声明地址去重与进度回调 |
| [persistence.test.ts](../../tests/persistence.test.ts) | 单元 | 账号注册/登录/token 轮换与校验；账号与对局记录落盘、重建实例后读回；容量上限；文件损坏降级为空表 |
| [lan-ip.test.ts](../../tests/lan-ip.test.ts) | 单元 | 无候选返回 null；192.168 优先；虚拟网卡降权；忽略 IPv6 |

### 3.2 执行方式

```bash
npm test          # 全量（vitest run，CI 友好，非 watch）
npm run lint      # ESLint（typescript-eslint recommended）
npm run format:check   # Prettier 校验（printWidth 110；CSS/HTML/docs 不纳入）
npm run build     # tsc + 静态资源复制
```

- 交付前必须全绿；新增功能/修复必须同步新增或更新对应用例（项目约定）。
- 端到端用例的等待消息均有超时保护，失败时给出明确断言信息，而非挂起。
- GitHub Actions（`.github/workflows/ci.yml`）按 lint → format → build → test 顺序执行。

### 3.3 端到端回放的关键断言（对应验收标准）

| 断言 | 对应产品验收 |
|---|---|
| 每步后双客户端棋盘 === 主机 `snapshot().board` | 双方棋盘同步 |
| `seq` 从 1 单调递增 | 防乱序/防重复 |
| 非法走子返回 `move_rejected` 且棋盘不变 | 非法走子被拒绝 |
| 将死广播 `game_over { reason: '将死' }` | 裁判正确 |
| `restart` 后回到开局快照 | 可重开 |
| 断线时对方收到 `opponent_left`，服务不崩溃 | 断线提示、程序不崩溃 |

### 3.4 未纳入自动化（依赖人工/浏览器验证）

- 真实局域网双设备连通性（涉及防火墙与网卡环境）；
- Electron 窗口行为与视觉布局；
- 棋盘点击命中、视角翻转、悬停反馈的交互观感；
- 人机对战应招、观战只读、棋谱/吃子面板、搜索主机、倒计时显示的端到端观感。

建议回归路径：`npm start`（或 `npm run dev`）→ 创建对局 → 本机浏览器打开地址加入 → 走子/悔棋/认输/和棋/重开各验证一次；
再以「人机对战」与「观战」各跑一遍。

### 3.5 明确不做

覆盖率门禁、性能基准、混沌/模糊测试、浏览器 E2E 驱动（Playwright 等）。

## 4. 代码入口

| 内容 | 位置 |
|---|---|
| 测试配置 | [vitest.config.ts](../../vitest.config.ts) |
| 测试客户端工具 | [ws-client.ts](../../tests/ws-client.ts) |
| 全部用例 | [tests/](../../tests/) |

## 5. 验收标准

- `npm test` 全量通过（0 失败）。
- 任一模块发生行为变更时，对应测试同步更新并通过，方可提交。
- 每次改动完成后创建 Git commit（项目约定）。