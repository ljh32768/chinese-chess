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
  1. **单元层**：纯函数与状态机（rules、game、lan-ip），不启服务；
  2. **集成层**：真实 `HostServer` + 真实 WebSocket 客户端（server.test.ts）；
  3. **端到端层**：完整一盘棋回放（fullgame.test.ts），逐步断言双方一致性与终局。
- 测试客户端复用 [tests/ws-client.ts](../../tests/ws-client.ts)：封装 `open/send/waitType/close`，等待指定类型消息。
- 服务端测试使用**随机高位端口 + `staticDir: null`**，避免端口冲突与静态资源干扰。

## 3. 详细规格

### 3.1 测试清单

| 文件 | 层级 | 覆盖内容 |
|---|---|---|
| [rules.test.ts](../../tests/rules.test.ts) | 单元 | 开局 32 子；将帅九宫；各棋子走法（车/马蹩腿/炮架/象塞眼/士/将/过河卒）；照面；将军；将死/困毙；`validateMove` 各拒绝原因 |
| [game.test.ts](../../tests/game.test.ts) | 单元 | `reset` 初始态；合法走子切换回合/`seq+1`/`lastMove`；非本方回合拒绝；非法走子棋盘不变；吃子；认输/和棋/重开 |
| [fullgame.test.ts](../../tests/fullgame.test.ts) | 端到端 | 35 步将杀线回放：双方每步棋盘一致且与主机权威一致；`seq` 单调 +1；终局 `game_over` 原因=`将死`；结束后可重开回到初始局面 |
| [server.test.ts](../../tests/server.test.ts) | 集成 | 未创建对局 guest 被拒；创建后双方加入自动开局；走子广播；非法走子拒绝；认输/和棋/重开/离开；断线通知 |
| [lan-ip.test.ts](../../tests/lan-ip.test.ts) | 单元 | 无候选返回 null；192.168 优先；虚拟网卡降权；忽略 IPv6 |

### 3.2 执行方式

```bash
npm test          # 全量（vitest run，CI 友好，非 watch）
```

- 交付前必须全绿；新增功能/修复必须同步新增或更新对应用例（项目约定）。
- 端到端用例的等待消息均有超时保护，失败时给出明确断言信息，而非挂起。

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
- 棋盘点击命中、视角翻转的交互观感。

建议回归路径：`npm start` → 创建对局 → 本机浏览器打开地址加入 → 走子/认输/和棋/重开各验证一次。

### 3.5 明确不做

覆盖率门禁、性能基准、混沌/模糊测试、浏览器 E2E 驱动（Playwright 等）、CI 配置。

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