# 局域网象棋 MVP 优化建议（Roadmap）

- 版本：v1.3
- 状态：A、B、C、D 四档全部完成并验证（见第 3 节）
- 日期：2026-10-03
- 关联文档：[README.md](./README.md)（模块化与功能入口）、[adr/](./adr/)（现状规格）、[Product-plan.md](./Product-plan.md)（产品规划）

---

## 1. 背景与范围

- **目标设备：电脑与平板**。不做手机专门适配（现有 `@media(max-width:640px)` 断点保留现状即可）；平板竖屏（≥768px）布局已验证可正常并排展开。
- **架构约束**：保持主机权威、规则引擎纯函数、渲染层非权威镜像（见 [ADR-0001](./adr/0001-host-authoritative-architecture.md)）；新增能力不改变权威边界。
- **落地约定**：每项改动配套测试与 Git commit（项目规则，见 AGENTS.md）。
- 优先级：A 档（快速见效）> B 档（稳健性）> C 档（工程化）> D 档（功能扩展）。

---

## 2. 优化清单

### A 快速见效（改动小、可感知）

A1–A7 已全部完成并验证（commit `d3065ad`），明细见第 3 节。

### B 稳健性

B1–B4 已全部完成并验证（commit `2f1b609`），明细见第 3 节。

### C 工程化

C1–C5 已全部完成并验证（commit `e22f7b0`），明细见第 3 节。

### D 功能扩展（对照产品规划后续版本）

D1–D4 已全部完成并验证（commit `e22f7b0`），明细见第 3 节。实现取舍：

- **D1**：浏览器无法使用 mDNS / UDP，改为「同网段 WebSocket 探测」：
  先直探已知地址（输入框 / 页面来源主机），再扫 `<前缀>.1~254`，按主机自我声明地址去重（`pong` 携带 `ip/port`）。
- **D2**：传统中文记谱（含前后/中消歧）+ 吃子统计 + 悔棋「请求-回应」（与和棋同构），快照新增 `history` 为回放打基础。
- **D3**：`spectator` 角色不占红黑席位，服务端对其一切操作回「观战模式只读」，客户端只读 UI（隐藏对局操作）。
- **D4**：AI 为 negamax + α-β（默认深度 2，开局约 150ms），主机侧以虚拟黑方席位自动应招；
  计时读秒以快照 `deadline` 字段 + 主机超时判负实现，默认关闭，`LANSCHESS_TURN_MS` 或 `turnMs` 开启。

---

## 3. 已完成（近期）

| 项 | 说明 | 记录 |
|---|---|---|
| C1 CI + lint/format | ESLint(typescript-eslint) + Prettier（printWidth 110，CSS/HTML/docs 除外）+ GitHub Actions（lint→format→build→test） | commit `e22f7b0` |
| C2 开发脚本 | `npm run dev`（tsc watch + 主机端自动重启 + 静态资源同步）；`listenWithFallback` 统一端口回退（显式端口被占用给友好提示） | commit `e22f7b0` |
| C3 测试补齐 | 心跳超时/断线（假定时器）、端口回退、重开拒绝分支、静态 MIME、断线重连用例 | commit `e22f7b0` |
| C4 Electron 打包 | electron-builder（NSIS）+ `npm run dist` + `engines`，已产出 `release/LanChess Setup 0.1.0.exe` | commit `e22f7b0` |
| C5 主机日志 | 连接/断开/走子/终局/宽限打点，`LANSCHESS_DEBUG` 控制（0=关闭，1=含 debug 明细） | commit `e22f7b0` |
| D1 局域网自动发现 | 同网段 WS 探测 + 已知地址直探 + 声明地址去重；加入页「搜索局域网主机」 | commit `e22f7b0` |
| D2 棋谱与悔棋 | 传统中文记谱 + 吃子面板 + 悔棋「请求-回应」；快照 `history` 序列 | commit `e22f7b0` |
| D3 观战 | `spectator` 角色（不占席位、广播只读、服务端拒绝操作、客户端只读 UI） | commit `e22f7b0` |
| D4 AI 与计时 | 人机对战（negamax + α-β，AI 执黑自动应招/同意悔棋/拒绝和棋/同意重开）+ 计时读秒（deadline/超时判负/倒计时显示） | commit `e22f7b0` |
| B1 断线重连宽限 | 意外断线进入宽限期（默认 30s，`graceMs` 可配）：同阵营重新 join 用 `state` 恢复原棋盘与回合；超时清空席位回到等待新对手；主机可 `wait_new_opponent` 放弃等待；主动 leave 不走宽限 | commit `2f1b609` |
| B2 终局清理 pending | 走子致将死/困毙时清空 `pendingDraw` / `pendingRestart`，与认输/和棋/重置保持一致 | commit `2f1b609` |
| B3 静态路径加固 | `serveStatic` 改用 `path.relative` 判断目录归属，修复「dist-evil」同前缀兄弟目录误判放行 | commit `2f1b609` |
| B4 协议清理 | 移除无人使用的 `move.seq`；走子坐标补整数校验（非整数回「坐标非法」）；`state` 消息在重连场景正式启用 | commit `2f1b609` |
| A1 错误提示 | 客户端补齐 `error` 分支，服务端错误消息以 toast 呈现，不再静默丢弃 | commit `d3065ad` |
| A2 地址复制 | 等待页地址大字显示 + 一键复制；http 非安全上下文降级「选中文本 + `execCommand('copy')`」 | commit `d3065ad` |
| A3 弹层与等待态 | 弹层支持 ESC / 点击遮罩关闭；和棋/重开请求发出后侧栏显示等待状态并防重复发送 | commit `d3065ad` |
| A4 大屏布局 | 布局宽度上限 960→1180px；棋盘按视口高度等比缩放；侧栏加宽（为 D2 棋谱预留） | commit `d3065ad` |
| A5 悬停反馈 | 己方棋子悬停金色预高亮环、合法落点悬停放大；光标仅在可交互位置为手型 | commit `d3065ad` |
| A6 快捷键 | ESC / 右键取消选中（ESC 优先关闭弹层）；触摸设备不受影响 | commit `d3065ad` |
| A7 矮窗口修复 | body 高度改 `min-height`，内容高于视口时随内容撑开，修复 flex 居中裁剪 | commit `d3065ad` |
| 终局结果卡 | 对局结束不再全屏遮挡，侧栏结果卡 + 操作组切换（再来一局 / 返回首页） | commit `34c6f36` |
| 将帅警示高亮 | 被将军 / 将死一方的将、帅红色脉冲环（`checkKing`） | commit `34c6f36` |
| 移除失效「重开」 | 对局中重开服务端不受理，重开语义由结束态「再来一局」承担 | commit `34c6f36` |
| 棋盘渲染单测 | `boardMarkup` 纯函数化 + 7 个用例（全量 78 测试通过） | commit `34c6f36` |

---

## 4. 明确不做（维持 MVP 边界）

- 手机专门适配（目标设备为电脑 / 平板）
- 账号、公网联机、匹配大厅、多房间
- 长将 / 长捉 / 重复局面等复杂裁判规则（除非产品范围调整）