# ADR-0011：AI 引擎更换为皮卡鱼（Pikafish）UCI 原生引擎

- 状态：已接受（v3.0 实施完成）
- 日期：2026-10-16
- 关联入口：服务端 AI 房间、复盘 AI 推荐、渲染层「本地人机对弈」、残局挑战防守 AI
- 关联文档：[ADR-0009 §3.3 / §3.7 / §3.10 / §3.12](./0009-c-d-extensions.md)、[ADR-0010 §10](./0010-room-server.md)、[ADR-0006 进程入口与构建](./0006-process-entries.md)

---

## 1. 背景与问题

- 原 AI 是纯 TS 搜索：`shared/ai.ts pickMove()`（negamax + α-β，`depth` 2–4，时限 1.2s），棋力有限。
- 目标：把 AI 引擎换成**皮卡鱼（Pikafish）**——当前棋力最强的开源象棋引擎。资源位于
  `Reference/Pikafish皮卡鱼20260925/`（Windows / Linux / MacOS / Android 原生 UCI 二进制 + `pikafish.nnue` 权重，约 50MB）。
- **关键约束**：渲染层是浏览器上下文（`main.ts`：`contextIsolation: true`、`nodeIntegration: false`），
  **无法 spawn 原生进程**；仓库内也没有 WASM 版引擎资源。因此皮卡鱼只能跑在 Node 侧。

## 2. 决策

1. 抽出引擎端口 `EnginePort`，**皮卡鱼优先、纯 TS 自动回退**（非 Windows / 引擎缺失 / 页面经 `file://` 打开时仍可对弈）。
2. 引擎进程由 **Node 侧的 `GameServer`** 持有（局域网服务器与 Electron 本机外壳服务皆为 `GameServer`）。
3. 渲染层「本地人机对弈 / 残局防守」不再本机算着法，改为向**承载页面的服务器**（同源 `POST /api/ai/move`）取着法
   —— 页面永远由某个 Node 服务器提供，故同源、无 CORS；仅需服务器可达，**不需要联机对局（WebSocket）连接**。
4. 引擎输出一律经规则引擎 `validateMove` 复核；非法 / `(none)` / 超时 / 进程出错一律回退纯 TS。
5. 难度沿用既有外部契约 `depth 1..4`，内部映射为皮卡鱼 `Skill Level` + `go movetime`（不改变协议与前端菜单）。

## 3. 详细规格

### 3.1 换算层（`shared/uci.ts`，纯函数）

| 项 | 规格 |
|---|---|
| `boardToFen(board, side)` | 棋盘 + 行棋方 → 中国象棋 FEN；摆子第 1 行 = `board[0]`（黑方底线）；红大写 / 黑小写；行棋方 `w`=红、`b`=黑；末尾恒为 `- - 0 1`（每次全新局面，不带历史） |
| `fenToBoard(fen)` | FEN → `{ board, side }`；摆子段行数 / 列数 / 棋子字母 / 行棋方非法时返回 `null`（不抛异常，供 HTTP 400 使用） |
| `posToSquare` / `squareToPos` | 项目 `[行,列]` ↔ UCI 方格：文件 `a`+列，行号 `9 - 行`（如 `[7,1]` ↔ `b2`、`[9,4]` ↔ `e0`） |
| `moveToUci` / `uciToMove` | 着法 ↔ UCI 着法串（炮二平五 = `b2e2`） |
| `parseBestMove(line)` | 解析 `bestmove b2e2 ponder ...`；`bestmove (none)` / 无着法 → `null` |

> 以上约定已用引擎 `position fen` + `d` 实测校验（初始局面 FEN 与 `b2e2` 一致）。

### 3.2 引擎端口（`shared/engine.ts`）

| 项 | 规格 |
|---|---|
| 端口 | `EnginePort.bestMove(board, side, level) → Promise<{ move, source: 'pikafish' \| 'ts' }>`；`move = null` 表示无合法着法；`dispose?()` 可选 |
| 难度 | `EngineLevel = 1 \| 2 \| 3 \| 4`（入门 / 菜鸟 / 中级 / 高手）；`normalizeLevel(x)` 缺省 2、非法钳到 1..4 |
| 回退实现 | `LocalEngine`：调用 `pickMove`（`depth = level`，时限 0.9–1.2s），`source: 'ts'` |

### 3.3 皮卡鱼进程（`server/pikafish.ts`，仅 Node）

| 项 | 规格 |
|---|---|
| 生命周期 | **惰性启动**（首次请求才 spawn，避免每个客户端启动即养进程）；空闲 `60s` 回收；`dispose()` 幂等（`quit` → 1s 后 `SIGKILL` 兜底 → `unref`） |
| 并发 | **单进程 + 串行请求队列**（stdin 上不可交错 `position`/`go`）；排队上限 32 |
| 握手 | `uci` → 等 `uciok`；`setoption`（`Threads` 2 / `Hash` 32MB；仅在显式给出 `PIKAFISH_NNUE` 时设 `EvalFile`，其余交由引擎在同目录自寻 `pikafish.nnue`，避免中文安装路径打不开权重）；`isready` → 等 `readyok`；握手超时 15s |
| 取着法 | `position fen <FEN>` + `go movetime <ms>` → 解析 `bestmove` |
| 容错 | 子进程 `exit` / `error` 时让在等请求失败（调用方回退纯 TS）；**连续「启动失败」上限 5**，达到后停用皮卡鱼 |
| 引擎发现 | `PIKAFISH_PATH` → `<root>/dist/engine/<平台文件>` → `<root>/Reference/Pikafish皮卡鱼20260925/<平台文件>`。`<root>` 取仓库 / 应用根目录；打包态另探测 `process.resourcesPath`（`extraResources` 把引擎放到 `resources/dist/engine/`，由该候选命中） |
| 难度映射 | `1: Skill 0 / 120ms`、`2: Skill 3 / 300ms`、`3: Skill 10 / 700ms`、`4: Skill 20 / 1200ms` |

### 3.4 引擎选择（`server/engine-select.ts`）

- `createEngine()`：`LANSCHESS_ENGINE=off`（或 `PIKAFISH_DISABLE=1`）→ 纯 TS；发现不到引擎 → 纯 TS；否则 `FallbackEngine(皮卡鱼, 纯 TS)`。
- `FallbackEngine`：皮卡鱼出错 / 返回非法着法 / 报「无着法」但规则上仍有可走 → 回退纯 TS，并把实际来源写进 `source`。

### 3.5 服务端接入（`server.ts` / `room.ts`）

| 项 | 规格 |
|---|---|
| 注入 | `GameServerOptions.engine?: EnginePort`（测试可注入 stub）；`GameServer` 构造时 `opts.engine ?? createEngine()`；`roomDeps()` 注入 `RoomDeps.engine` |
| 释放 | `close()` 与 `listen()` 失败路径均调用 `engine.dispose?.()` |
| 新接口 | `POST /api/ai/move`，body `{ fen, level }` → `{ from, to, source }`；无着法 `{ none: true, source }`；FEN 非法 400、非 POST 405、JSON 非法 400。路由须置于 `/api/` 兜底之前 |
| 复盘推荐 | `GET /api/ai/hint` 改为 async（`handleAiHint`）；`hintFor(record, index, level, engine)` 出着法并经 `validateMove` 复核，非法 / 无着法返回 `null`（HTTP 回 `{ none: true }`） |
| 服务端 AI 房间 | `room.ts scheduleAiMove()` → `runAiMove()`（async）：取着法前记录 `game.moveSeq` 与克隆棋盘，返回后复核 `moveSeq` / 回合 / 状态，再过 `validateMove` 才 `applyAndBroadcast` |
| 计时豁免 | `armTurnTimer()` 在 `mode === 'ai'` 且轮到 AI 席时不 arm（引擎思考耗时不可控，否则 `LANSCHESS_TURN_MS` 开启时会把 AI 误判超时负） |

### 3.6 渲染层接入（`renderer/app.ts`）

| 项 | 规格 |
|---|---|
| 调度 | `scheduleLocalAi()` 保持原入口（350ms 延迟后调 `runLocalAi(aiSide)`） |
| 取着法 | `runLocalAi()` → `requestAiMove()`：`POST /api/ai/move`，body `{ fen: boardToFen(board, side), level }`；`level = S.endgame ? ENDGAME_AI_DEPTH(4) : aiDepth()` |
| 令牌校验 | 请求前记录 `localGame` 实例与 `moveSeq`，返回后三者（实例 / `moveSeq` / 回合）未变才落子——防悔棋 / 重来 / 终局期间旧着法被应用 |
| 客户端复核 | 服务器返回的着法先过 `validateMove`，非法即视为失败 |
| 回退 | 请求整体失败（离线 / `file://` / 引擎不可用）或复核不通过 → 回退本机 `pickMove`（level ≥ 4 用 0.9s、否则 1.2s） |

### 3.7 打包、运行与开关

| 项 | 规格 |
|---|---|
| 打包 | `package.json` 的 **`extraResources`** 把 `Reference/Pikafish皮卡鱼20260925/` 下的引擎与权重直接放到 `resources/dist/engine/`——**在 asar 之外**，可直接 spawn、无需 `asarUnpack`，也不必手工复制。目标仅为 Windows（`build.win`），故固定用 Windows 引擎文件 |
| 开发态 | 不复制：`npm run serve` / `npm run dev` 由引擎发现回退到仓库 `Reference/Pikafish皮卡鱼20260925/`（`copy-assets.mjs` 只复制渲染层静态资源） |
| 环境变量 | `PIKAFISH_PATH`（引擎可执行文件路径）、`PIKAFISH_NNUE`（显式权重路径）、`LANSCHESS_ENGINE=off`（强制纯 TS） |
| 打包下载源 | electron-builder **不复用** `node_modules/electron`，而是从自己的缓存 `%LOCALAPPDATA%\electron-builder\Cache` 取「目标平台 Electron 发行包」，未命中时默认去 **GitHub** 下载（另需 winCodeSign / nsis 等工具）。国内网络连不上 GitHub，故 `npm run dist` 经 [`scripts/dist.mjs`](../../scripts/dist.mjs) 固定 `ELECTRON_MIRROR` / `ELECTRON_BUILDER_BINARIES_MIRROR` 为 **npmmirror**（已设置同名变量时以环境变量为准）。首次联网跑一次即把 Electron / nsis / winCodeSign 拉进本机缓存，**之后断网也能打包**（缓存就绪即不再发起下载） |
| 不入库 | `Reference/`（含引擎与权重）与 `dist/` 均被 `.gitignore` 忽略。打包时 electron-builder 直接以 `Reference/` 为源，故**打包机需存在该目录**（缺失会直接报错，而非静默跳过——换取「有引擎 / 无引擎」显式可见） |

## 4. 代码入口

| 功能 | 入口 |
|---|---|
| 换算层 | [uci.ts](../../src/shared/uci.ts) |
| 引擎端口 / 回退 | [engine.ts](../../src/shared/engine.ts)、[ai.ts](../../src/shared/ai.ts) |
| 皮卡鱼进程 | [pikafish.ts](../../src/server/pikafish.ts) |
| 引擎选择 | [engine-select.ts](../../src/server/engine-select.ts) |
| 服务端接入 | [server.ts `handleAiMove()` / `handleAiHint()` / `roomDeps()`](../../src/server/server.ts)、[room.ts `runAiMove()` / `hintFor()`](../../src/server/room.ts) |
| 渲染层接入 | [app.ts `scheduleLocalAi()` / `runLocalAi()` / `requestAiMove()`](../../src/renderer/app.ts) |
| 构建打包 | [copy-assets.mjs](../../scripts/copy-assets.mjs)（仅静态资源）、[package.json `build.extraResources`](../../package.json) |

## 5. 验收标准

- 单测：`tests/uci.test.ts`（FEN 往返 / 非法输入 / 坐标与着法换算 / `bestmove` 解析）、`tests/pikafish.test.ts`
  （真机集成，**无引擎文件时整组跳过**：开局返回合法着法、一步杀返回杀着、`dispose()` 后拒绝）、
  `tests/server.test.ts`（`/api/ai/move` 注入 stub 成功路径、非法 FEN 400 / 非 POST 405、无引擎时回退纯 TS 返回合法着法）；
  `tests/ai.test.ts` 继续覆盖纯 TS 回退。
- 端到端：起服务器后 `POST /api/ai/move` 由皮卡鱼返回合法着法（实测初始局面得 `b2e2`；一步杀局面得杀着）。
- 降级：`LANSCHESS_ENGINE=off` 时全链路回退纯 TS，对弈功能不受影响。
- 回归：`npm test`（340 项）、`npm run lint`、`npm run build` 全绿；残局题库可解性不变（见 [ADR-0009 §3.12](./0009-c-d-extensions.md)）。
