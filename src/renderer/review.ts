/**
 * 对局回顾：对局列表（红黑方 / 取先方式 / 时间 / 胜负）与复盘
 * （逐步回放 + AI 推荐 / 试下：两者都用左右箭头按手数步进）。
 *
 * 记录由中心服务器保存在内存中，通过 /api/history 系列接口读取；
 * 复盘棋盘复用对局页的 Canvas 渲染器（board.ts）。
 */

import { describeMove } from '../shared/notation.js';
import { CheckmateInfo, KUNBI_PATTERN, classifyCheckmateFromHistory } from '../shared/checkmate.js';
import {
  cloneBoard,
  findKing,
  initBoard,
  isInCheck,
  legalMoves,
  makeMove,
  sideHasAnyMove,
} from '../shared/rules.js';
import {
  AiLineMove,
  FIRST_MODE_LABEL,
  MAX_AI_LINE_PLIES,
  Board,
  GameRecord,
  GameRecordSummary,
  Move,
  Pos,
  Side,
} from '../shared/types.js';
import { Skin, canvasPoint, pickCell, renderBoard } from './board.js';

/** 复盘第 index 步（0 = 开局）后的棋盘 */
export function replayBoard(moves: Move[], index: number): Board {
  const board = initBoard();
  const n = Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, moves.length));
  for (let i = 0; i < n; i++) makeMove(board, moves[i].from, moves[i].to);
  return board;
}

/** 行棋方名称（红方 / 黑方） */
export function sideName(side: Side): string {
  return side === 'r' ? '红方' : '黑方';
}

/**
 * 在某个局面之上试走前 `plies` 手（越界自动收敛），返回**新棋盘**（不改动 base）。
 * 「AI 推荐」的变化预览与「试下」自由走子共用。
 */
export function withMoves(base: Board, moves: Move[], plies: number): Board {
  const board = cloneBoard(base);
  const n = Math.max(0, Math.min(Number.isFinite(plies) ? Math.floor(plies) : 0, moves.length));
  for (let i = 0; i < n; i++) makeMove(board, moves[i].from, moves[i].to);
  return board;
}

/** 第 index 步（0 = 开局）轮到哪一方（红先） */
export function sideAt(index: number): Side {
  return index % 2 === 0 ? 'r' : 'b';
}

/**
 * 变化是否走到了终局（走完这些着法后，下一方已无任何合法着法：绝杀 / 困毙）。
 * 为真时「AI 推荐」的右箭头置灰，不再续算。
 */
export function lineEndsGame(base: Board, moves: Move[], side: Side): boolean {
  if (!moves.length) return false;
  const board = withMoves(base, moves, moves.length);
  const next: Side = moves.length % 2 === 0 ? side : side === 'r' ? 'b' : 'r';
  return !sideHasAnyMove(board, next);
}

/** 续算目标手数：已算出手数 + 5，最多到 MAX_AI_LINE_PLIES */
export function lineChunkTarget(computed: number): number {
  const n = Number.isFinite(computed) ? Math.max(0, Math.floor(computed)) : 0;
  return Math.min(MAX_AI_LINE_PLIES, n + LINE_CHUNK);
}

/** 把已算出的整段变化编码为 `prefix=fr,fc,tr,tc|...`（续算时服务端原样沿用） */
export function encodeLinePrefix(moves: Move[]): string {
  return moves.map((m) => `${m.from[0]},${m.from[1]},${m.to[0]},${m.to[1]}`).join('|');
}

/** 时间戳 → 「MM-DD HH:mm」 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 结果文案：红胜（马后炮） / 和棋（同意和棋）。
 * 「将死」时优先用记录中识别出的杀法名，其余「将死」一律按「绝杀」展示。
 */
export function resultText(rec: { winner: Side | null; reason: string; killMethod?: string }): string {
  const who = rec.winner === 'r' ? '红胜' : rec.winner === 'b' ? '黑胜' : '和棋';
  const reason = rec.reason === '将死' ? '绝杀' : rec.reason;
  return `${who}（${rec.killMethod ?? reason}）`;
}

/**
 * 复盘页的终局杀法：依据终局局面 + 完整着法即时识别。
 * 与对局页 / 服务端落库共用同一实现，因此新老记录都能给出具体杀法。
 */
export function mateOf(rec: GameRecord): CheckmateInfo | null {
  // 困毙（欠行）：无具体杀法，直接以终局原因作为展示名
  if (rec.reason === '困毙' && rec.winner) {
    return { pattern: KUNBI_PATTERN, alsoMatched: [], recognized: true };
  }
  if (rec.reason !== '将死') return null;
  const board = replayBoard(rec.moves, rec.moves.length);
  const info = classifyCheckmateFromHistory(board, rec.moves, rec.winner);
  return info?.recognized ? info : null;
}

/** 列表行文案 */
export function recordLine(rec: GameRecordSummary): {
  vs: string;
  first: string;
  time: string;
  result: string;
} {
  return {
    vs: `${rec.red.name}（红） vs ${rec.black.name}（黑）`,
    first: FIRST_MODE_LABEL[rec.firstMode],
    time: formatTime(rec.startedAt),
    result: resultText(rec),
  };
}

/** 复盘页依赖（由 app.ts 注入，避免模块间循环依赖） */
export interface ReviewDeps {
  /** 当前皮肤 */
  skin: () => Skin;
  /** 当前皮肤已加载的素材（可能为空，需先 loadImages） */
  images: () => Record<string, HTMLImageElement>;
  /** 确保当前皮肤素材已加载，resolve 后即可重绘 */
  loadImages: () => Promise<void>;
  /**
   * 对局记录接口的基址（形如 `http://192.168.1.42:7777`，无服务器时为空串表示同源）。
   * 桌面客户端的页面由本机外壳服务提供，因此必须显式指向所选服务器（跨源，需服务端 CORS）。
   */
  apiBase: () => string;
  /** 「我的历史」过滤用的玩家 id（登录为 `account:<用户名>`；游客为本机最近身份；未识别为空串） */
  myId: () => string;
  /** 当前身份展示名（「我的历史」说明文案用） */
  myLabel: () => string;
  /** 切屏（复用 app.ts 的 show） */
  show: (id: string) => void;
  toast: (msg: string) => void;
}

/** 回顾范围：全部对局 / 我的历史 */
export type ReviewScope = 'all' | 'mine';

/**
 * 对局列表请求路径：全部走 `/api/history`；「我的历史」带 `?user=<玩家 id>`。
 * 未识别身份时退回全部（由调用方给出提示）。
 */
export function historyUrl(scope: ReviewScope, myId: string): string {
  return scope === 'mine' && myId ? `/api/history?user=${encodeURIComponent(myId)}` : '/api/history';
}

export interface ReviewController {
  /** 打开对局回顾列表（并刷新数据） */
  open: () => Promise<void>;
  /** 复盘页是否处于激活状态（快捷键判断用） */
  isReplayActive: () => boolean;
  /** 皮肤 / 素材变化后重绘复盘棋盘 */
  redraw: () => void;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

/** 暂停：AI 推荐请求与步进解耦，避免连续点箭头时画面错位 */
const HINT_DEBOUNCE_MS = 120;
/** 「AI 推荐」一次计算的手数：先算 5 手，之后每走到 5 的倍数再续算 5 手 */
const LINE_CHUNK = 5;
/** 复盘分析用的引擎档位：5 = 棋圣（皮卡鱼），保证复盘推荐质量 */
const AI_LEVEL = 5;

/** 推荐 / 试下的状态（驱动面板文案与按钮可用性） */
type HintState = 'idle' | 'loading' | 'shown' | 'none' | 'error';
type LineState = 'idle' | 'loading' | 'shown' | 'error';

export function initReview(deps: ReviewDeps): ReviewController {
  const canvas = $<HTMLCanvasElement>('replay-board');
  let records: GameRecordSummary[] = [];
  let record: GameRecord | null = null;
  let index = 0;
  /** 推荐箭头（仅在点开「AI推荐」后才有值） */
  let hint: { from: Pos; to: Pos } | null = null;
  let hintState: HintState = 'idle';
  let hintText = '';
  /** AI 推荐变化：首批 5 手，走到末端再续算 5 手；lineDone = 已到终局（右箭头置灰） */
  let line: AiLineMove[] | null = null;
  let lineState: LineState = 'idle';
  let lineStep = 0;
  let lineDone = false;
  /** 试下：以当前复盘局面为起点自由走子（只在本端推演，不改动记录） */
  let trial: { board: Board; moves: Move[]; selected: Pos | null } | null = null;
  /** 试下已展示到第几手（左右箭头步进；等于 moves.length 时是最新一步） */
  let trialStep = 0;
  let trialHover: Pos | null = null;
  /** 请求代次：步进 / 换局后旧响应作废（推荐与续算共用） */
  let hintSeq = 0;
  let hintTimer = 0;
  /** 当前回顾范围（全部 / 我的历史） */
  let scope: ReviewScope = 'all';

  // ---------------------------------------------------------------- 列表

  async function fetchJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${deps.apiBase()}${url}`);
    } catch {
      // fetch 抛错常见于：服务器已关闭 / 地址不可达 / 跨源被拦截（服务端缺少 CORS 头）
      const where = deps.apiBase() || window.location.origin;
      throw new Error(`无法连接服务器 ${where}，请确认「连接服务器」中已连接`);
    }
    if (!res.ok) throw new Error(`请求失败（${res.status}）`);
    return (await res.json()) as T;
  }

  async function open(): Promise<void> {
    deps.show('screen-history');
    await refresh();
  }

  /** 切换回顾范围（全部对局 / 我的历史） */
  function setScope(next: ReviewScope): void {
    if (scope === next) return;
    scope = next;
    void refresh();
  }

  /** 渲染「全部对局 / 我的历史」切换状态与身份说明 */
  function renderScopeTabs(): void {
    $('tab-history-all').classList.toggle('active', scope === 'all');
    $('tab-history-mine').classList.toggle('active', scope === 'mine');
    $('history-note').textContent = scope === 'mine' ? `身份：${deps.myLabel()}` : '';
  }

  /** 拉取对局列表并渲染（按当前范围过滤） */
  async function refresh(): Promise<void> {
    const box = $('history-list');
    renderScopeTabs();
    const myId = deps.myId();
    if (scope === 'mine' && !myId) {
      records = [];
      box.replaceChildren();
      const tip = document.createElement('p');
      tip.className = 'review_empty';
      tip.textContent = '尚未识别到你的身份：请重新登录账号后查看「我的历史」。';
      box.appendChild(tip);
      return;
    }
    box.textContent = scope === 'mine' ? '正在读取我的对局记录…' : '正在读取对局记录…';
    try {
      const data = await fetchJson<{ games: GameRecordSummary[] }>(historyUrl(scope, myId));
      records = data.games;
    } catch (e) {
      box.textContent = e instanceof Error ? e.message : '读取失败';
      return;
    }
    renderList();
  }

  function renderList(): void {
    const box = $('history-list');
    box.replaceChildren();
    if (records.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'review_empty';
      empty.textContent = scope === 'mine' ? '当前服务器没有你的对局记录' : '暂无对局记录，先下完一盘棋吧';
      box.appendChild(empty);
      return;
    }
    for (const rec of records) {
      const line = recordLine(rec);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'review_row';
      row.innerHTML =
        `<span class="rv-vs">${line.vs}</span>` +
        `<span class="rv-first">${line.first}</span>` +
        `<span class="rv-time">${line.time}</span>` +
        `<span class="rv-result ${rec.winner === 'r' ? 'win-red' : rec.winner === 'b' ? 'win-black' : 'draw'}">${line.result}</span>`;
      row.addEventListener('click', () => void openReplay(rec.id));
      box.appendChild(row);
    }
  }

  // ---------------------------------------------------------------- 复盘

  /** 打开某局复盘（读取明细并回到开局局面） */
  async function openReplay(id: string): Promise<void> {
    try {
      record = await fetchJson<GameRecord>(`/api/history/${id}`);
    } catch (e) {
      deps.toast(e instanceof Error ? e.message : '读取对局失败');
      return;
    }
    index = 0;
    resetAux();
    deps.show('screen-replay');
    await deps.loadImages();
    paint();
    renderInfo();
  }

  /** 进入新局面（步进 / 换局）或离开复盘时清掉推荐、变化与试下 */
  function resetAux(): void {
    hintSeq++; // 让在途请求作废
    hint = null;
    hintState = 'idle';
    hintText = '';
    line = null;
    lineState = 'idle';
    lineStep = 0;
    lineDone = false;
    trial = null;
    trialStep = 0;
    trialHover = null;
    canvas.style.cursor = 'default';
  }

  /** 试下中当前应由哪一方走（沿用红先交替） */
  function trialSide(): Side {
    return sideAt(index + (trial ? trial.moves.length : 0));
  }

  /** 面板文案：试下提示优先，其次是推荐状态 */
  function panelMsg(): string {
    if (trial) {
      if (trialStep < trial.moves.length) {
        return `试下预览：第 ${trialStep} / ${trial.moves.length} 手（点 ▶ 继续，点棋盘回到最新）`;
      }
      const side = trialSide();
      if (!sideHasAnyMove(trial.board, side)) return `试下：${sideName(side)}已无着可走`;
      return `试下中（${sideName(side)}走）：点自己的棋子，再点落点自由试走`;
    }
    if (hintState === 'loading') return `${sideName(sideAt(index))} · AI 思考中…`;
    if (hintState === 'none') return '无推荐着法（已终局或无需走子）';
    if (hintState === 'error') return 'AI 推荐获取失败，请确认已连接服务器';
    if (hintState === 'shown' && line) {
      if (lineState === 'loading') return `正在计算后续变化…（已算 ${line.length} 手）`;
      if (lineStep === 0) return `${sideName(sideAt(index))}推荐：${hintText}（共 ${line.length} 手）`;
      if (lineDone && lineStep >= line.length) {
        return `变化终点：第 ${lineStep} 手 · ${line[lineStep - 1].text}`;
      }
      return `变化预览：第 ${lineStep} / ${line.length} 手（点 ▶ 继续）`;
    }
    return '点击「AI推荐」查看推荐着法（先算 5 手）';
  }

  /** 复盘棋盘：只读局面 / AI 推荐变化 / 试下三种形态共用同一渲染器 */
  function paint(): void {
    if (!record) return;
    const base = replayBoard(record.moves, index);
    if (trial) {
      const side = trialSide();
      const previewing = trialStep < trial.moves.length;
      const board = previewing ? withMoves(base, trial.moves, trialStep) : trial.board;
      paintView(board, {
        selected: previewing ? null : trial.selected,
        moves: !previewing && trial.selected ? legalMoves(board, trial.selected[0], trial.selected[1]) : [],
        lastMove: trialStep > 0 ? trial.moves[trialStep - 1] : null,
        interactiveSide: previewing ? null : side,
        hover: previewing ? null : trialHover,
        turn: sideAt(index + trialStep),
      });
      return;
    }
    const board = line && lineStep > 0 ? withMoves(base, line, lineStep) : base;
    paintView(board, {
      selected: null,
      moves: [],
      lastMove: line && lineStep > 0 ? line[lineStep - 1] : index > 0 ? record.moves[index - 1] : null,
      interactiveSide: null,
      hover: null,
      // 只在原局面（第 0 手）画推荐箭头；向前推演后收起
      hint: hintState === 'shown' && lineStep === 0 ? hint : null,
      turn: sideAt(index + lineStep),
    });
  }

  /** 把一份盘面按当前皮肤画到复盘画布（额外字段由调用方按形态给出） */
  function paintView(
    board: Board,
    extra: {
      selected: Pos | null;
      moves: Pos[];
      lastMove: { from: Pos; to: Pos } | null;
      interactiveSide: Side | null;
      hover: Pos | null;
      hint?: { from: Pos; to: Pos } | null;
      turn?: Side;
    },
  ): void {
    const turn = extra.turn ?? sideAt(index);
    renderBoard(
      canvas,
      {
        board,
        selected: extra.selected,
        moves: extra.moves,
        lastMove: extra.lastMove,
        flip: false,
        checkKing: isInCheck(board, turn) ? findKing(board, turn) : null,
        interactiveSide: extra.interactiveSide,
        hover: extra.hover,
        hint: extra.hint ?? null,
      },
      deps.skin(),
      deps.images(),
      performance.now(),
    );
  }

  /** 侧栏信息：对局信息 / 当前步 / AI 推荐按钮与变化列表 */
  function renderInfo(): void {
    if (!record) return;
    const line = recordLine(record);
    const guess = record.guess
      ? `<div>猜先：房主抓「${record.guess.actual === 'odd' ? '单' : '双'}」，对手猜「${record.guess.choice === 'odd' ? '单' : '双'}」（${record.guess.guestWon ? '猜中' : '未中'}）</div>`
      : '';
    $('replay-info').innerHTML =
      `<div>${line.vs}</div><div>取先方式：${line.first}</div>` +
      guess +
      `<div>时间：${line.time}</div><div>结果：${line.result}</div><div>共 ${record.moveCount} 步</div>`;

    // 终局杀法：将死时只展示识别出的主杀法名与解说（不展示「同时构成」，识别不到经典杀法时隐藏）
    const mate = mateOf(record);
    $('replay-mate-box').hidden = !mate;
    if (mate) {
      $('replay-mate-name').textContent = mate.pattern.label;
      $('replay-mate-def').textContent = mate.pattern.definition;
    }

    const stepText =
      index === 0
        ? '开局局面'
        : `本步：${describeMove(replayBoard(record.moves, index - 1), record.moves[index - 1].from, record.moves[index - 1].to)}`;
    $('replay-step').textContent = `第 ${index} / ${record.moves.length} 步 · ${stepText}`;

    // 箭头可用性
    $<HTMLInputElement>('btn-replay-first').disabled = index === 0;
    $<HTMLInputElement>('btn-replay-prev').disabled = index === 0;
    $<HTMLInputElement>('btn-replay-next').disabled = index >= record.moves.length;
    $<HTMLInputElement>('btn-replay-last').disabled = index >= record.moves.length;

    syncControls();
  }

  /** 同步 AI 推荐面板的按钮文案 / 按压态 / 步数导航 / 变化列表（与棋盘状态保持一致） */
  function syncControls(): void {
    const inTrial = !!trial;
    $('replay-hint').textContent = panelMsg();

    const hintBtn = $<HTMLInputElement>('btn-replay-hint');
    hintBtn.value = hintState === 'shown' ? '收起推荐' : 'AI推荐';
    hintBtn.disabled = inTrial || hintState === 'loading';
    hintBtn.classList.toggle('on', hintState === 'shown' && !inTrial);

    const tryBtn = $<HTMLInputElement>('btn-replay-try');
    tryBtn.value = inTrial ? '退出试下' : '试下';
    tryBtn.classList.toggle('on', inTrial);

    $('replay-try-bar').hidden = !inTrial;
    $<HTMLInputElement>('btn-replay-try-undo').disabled = !inTrial || !trial?.moves.length;
    renderNav();
    renderLine();
  }

  /** 左右箭头导航：AI 推荐变化或试下着法（两者共用一个步数条） */
  function renderNav(): void {
    const nav = $('replay-step-nav');
    const pos = $('replay-step-pos');
    const prev = $<HTMLInputElement>('btn-replay-step-prev');
    const next = $<HTMLInputElement>('btn-replay-step-next');
    if (trial) {
      nav.hidden = false;
      pos.textContent = `第 ${trialStep} / ${trial.moves.length} 手`;
      prev.disabled = trialStep <= 0;
      next.disabled = trialStep >= trial.moves.length;
      return;
    }
    if (hintState === 'shown' && line) {
      nav.hidden = false;
      pos.textContent = `第 ${lineStep} / ${line.length} 手`;
      prev.disabled = lineStep <= 0;
      // 绝杀 / 无着可走（lineDone）走到末端后右箭头置灰；未到终局时到已算末端会续算 5 手
      next.disabled = lineState === 'loading' || (lineDone && lineStep >= line.length);
      return;
    }
    nav.hidden = true;
    prev.disabled = true;
    next.disabled = true;
  }

  /** 变化 / 试下着法列表：变化行可点（预览到该手），试下行只作记录但高亮当前步 */
  function renderLine(): void {
    const box = $('replay-line');
    if (trial) {
      const made = trial;
      if (!made.moves.length) {
        box.hidden = true;
        box.replaceChildren();
        return;
      }
      const base = replayBoard(record?.moves ?? [], index);
      const rows = made.moves.map((m, i) =>
        lineRow(
          i + 1,
          sideAt(index + i),
          describeMove(withMoves(base, made.moves, i), m.from, m.to),
          false,
          i + 1 === trialStep,
        ),
      );
      box.hidden = false;
      box.replaceChildren(...rows);
      return;
    }
    if (lineState === 'idle') {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    if (line) {
      const rows: HTMLElement[] = line.map((m, i) =>
        lineRow(i + 1, m.side, m.text, true, i + 1 === lineStep),
      );
      if (lineState === 'loading') rows.push(lineNote('正在计算后续变化…'));
      else if (lineState === 'error') rows.push(lineNote('后续变化获取失败'));
      box.hidden = false;
      box.replaceChildren(...rows);
      return;
    }
    box.hidden = false;
    box.replaceChildren(lineNote(lineState === 'loading' ? '正在计算后续变化…' : '后续变化获取失败'));
  }

  /** 变化列表下方的一行提示（续算中 / 失败） */
  function lineNote(text: string): HTMLElement {
    const note = document.createElement('div');
    note.className = 'replay-line-note';
    note.textContent = text;
    return note;
  }

  /** 一行着法（`clickable` 为真时可点：预览到该手） */
  function lineRow(idx: number, side: Side, text: string, clickable: boolean, active: boolean): HTMLElement {
    const row = document.createElement(clickable ? 'button' : 'div');
    row.className = `replay-line-row${clickable ? '' : ' static'}${active ? ' on' : ''}`;
    row.innerHTML =
      `<span class="replay-line-idx">${idx}.</span>` +
      `<span class="replay-line-side ${side}">${side === 'r' ? '红' : '黑'}</span>` +
      `<span class="replay-line-text">${text}</span>`;
    if (clickable) {
      (row as HTMLButtonElement).type = 'button';
      row.addEventListener('click', () => previewLine(idx));
    }
    return row;
  }

  /** 预览后续变化到第 `step` 手（0 = 回到当前局面）；落到 5 的倍数且已在末端时自动续算 */
  function previewLine(step: number): void {
    if (!line) return;
    lineStep = Math.max(0, Math.min(step, line.length));
    paint();
    syncControls();
    maybeExtendLine();
  }

  /**
   * 走到已算末端（5 / 10 / 15…）时自动续算 5 手；
   * 还未走到末端或已到终局（lineDone）则不再请求。
   */
  function maybeExtendLine(): void {
    if (!line || hintState !== 'shown' || lineState === 'loading') return;
    if (lineDone || lineStep !== line.length) return;
    if (lineStep % LINE_CHUNK !== 0) return;
    void extendLine();
  }

  /** AI 推荐变化：左箭头回退一手 */
  function linePrev(): void {
    if (!line || lineStep <= 0) return;
    lineStep--;
    paint();
    syncControls();
  }

  /** AI 推荐变化：右箭头前进一手；走到已算末端（5 的倍数）时自动续算 5 手 */
  async function lineNext(): Promise<void> {
    if (!line) return;
    if (lineStep < line.length) {
      lineStep++;
      paint();
      syncControls();
      maybeExtendLine();
      return;
    }
    if (lineDone || lineState === 'loading') return;
    await extendLine();
    if (!line || lineStep >= line.length) return;
    lineStep++;
    paint();
    syncControls();
    maybeExtendLine();
  }

  /** 续算 5 手：把已算出的整段变化作为 prefix 回传，服务端只补算新增手数 */
  async function extendLine(): Promise<void> {
    if (!record || !line || lineDone || lineState === 'loading') return;
    const target = lineChunkTarget(line.length);
    if (target <= line.length) {
      lineDone = true;
      syncControls();
      return;
    }
    const rec = record;
    const seq = ++hintSeq;
    const prefix = encodeLinePrefix(line.map((m) => ({ from: m.from, to: m.to })));
    lineState = 'loading';
    syncControls();
    try {
      const data = await fetchJson<{ none?: boolean; moves?: AiLineMove[] }>(
        `/api/ai/line?id=${encodeURIComponent(rec.id)}&index=${index}&plies=${target}` +
          `&depth=${AI_LEVEL}&prefix=${encodeURIComponent(prefix)}`,
      );
      if (seq !== hintSeq || record !== rec) return;
      if (data.none || !data.moves?.length) {
        lineDone = true;
        lineState = 'shown';
        syncControls();
        return;
      }
      line = data.moves;
      lineDone =
        data.moves.length < target || lineEndsGame(replayBoard(rec.moves, index), data.moves, sideAt(index));
      lineState = 'shown';
      paint();
      syncControls();
    } catch {
      if (seq !== hintSeq) return;
      lineState = 'shown';
      syncControls();
      deps.toast('后续变化获取失败，请确认已连接服务器');
    }
  }

  /** 步进（delta 步，越界自动收敛）；步进后收起旧推荐 / 变化并退出试下 */
  function step(delta: number): void {
    if (!record) return;
    const next = Math.max(0, Math.min(index + delta, record.moves.length));
    if (next === index) return;
    index = next;
    resetAux();
    paint();
    renderInfo();
  }

  function jump(to: number): void {
    if (!record) return;
    const next = Math.max(0, Math.min(to, record.moves.length));
    if (next === index) return;
    index = next;
    resetAux();
    paint();
    renderInfo();
  }

  /**
   * 「AI推荐」：点开才请求，一次先算 5 手（首手即推荐着法，画蓝色箭头 + 落点）；
   * 左右箭头逐步预览变化，走到已算末端（5 的倍数）时自动续算 5 手，绝杀后右箭头置灰。
   */
  async function toggleHint(): Promise<void> {
    if (!record || trial) return;
    if (hintState === 'shown') {
      hintSeq++; // 让在途的续算请求作废
      hint = null;
      hintState = 'idle';
      line = null;
      lineState = 'idle';
      lineStep = 0;
      lineDone = false;
      paint();
      syncControls();
      return;
    }
    const rec = record;
    const seq = ++hintSeq;
    hintState = 'loading';
    hint = null;
    line = null;
    lineState = 'idle';
    lineStep = 0;
    lineDone = false;
    syncControls();
    window.clearTimeout(hintTimer);
    await new Promise<void>((r) => {
      hintTimer = window.setTimeout(() => r(), HINT_DEBOUNCE_MS);
    });
    if (seq !== hintSeq || record !== rec) return;
    try {
      const data = await fetchJson<{ none?: boolean; moves?: AiLineMove[] }>(
        `/api/ai/line?id=${encodeURIComponent(rec.id)}&index=${index}&plies=${LINE_CHUNK}` +
          `&depth=${AI_LEVEL}`,
      );
      if (seq !== hintSeq || record !== rec) return;
      if (data.none || !data.moves?.length) {
        hint = null;
        hintState = 'none';
      } else {
        const first = data.moves[0];
        hint = { from: first.from, to: first.to };
        hintText = first.text;
        line = data.moves;
        lineDone =
          data.moves.length < LINE_CHUNK ||
          lineEndsGame(replayBoard(rec.moves, index), data.moves, sideAt(index));
        hintState = 'shown';
        lineState = 'shown';
      }
      paint();
      syncControls();
    } catch {
      if (seq !== hintSeq) return;
      hintState = 'error';
      syncControls();
    }
  }

  // ------------------------------------------------------------ 试下（自由走子）

  /** 进入试下：以当前复盘局面为起点，本端自由试走（不改动记录） */
  function enterTrial(): void {
    if (!record) return;
    hintSeq++;
    hint = null;
    hintState = 'idle';
    hintText = '';
    line = null;
    lineState = 'idle';
    lineStep = 0;
    lineDone = false;
    trial = { board: replayBoard(record.moves, index), moves: [], selected: null };
    trialStep = 0;
    trialHover = null;
    paint();
    syncControls();
  }

  function exitTrial(): void {
    trial = null;
    trialStep = 0;
    trialHover = null;
    hintState = 'idle';
    canvas.style.cursor = 'default';
    paint();
    syncControls();
  }

  /** 试下：左右箭头逐步查看已试走的着法（0 = 刚进入试下的局面） */
  function trialStepBy(delta: number): void {
    if (!trial) return;
    const next = Math.max(0, Math.min(trialStep + delta, trial.moves.length));
    if (next === trialStep) return;
    trialStep = next;
    trial.selected = null;
    paint();
    syncControls();
  }

  /** 试下：悔一步（重算盘面） */
  function trialUndo(): void {
    if (!record || !trial || !trial.moves.length) return;
    trial.moves.pop();
    trial.selected = null;
    trial.board = withMoves(replayBoard(record.moves, index), trial.moves, trial.moves.length);
    trialStep = Math.min(trialStep, trial.moves.length);
    paint();
    syncControls();
  }

  /** 试下：重来（清空试走着法，回到进入时的局面） */
  function trialReset(): void {
    if (!trial) return;
    enterTrial();
    deps.toast('已重来：回到进入试下时的局面');
  }

  /** 试下棋盘点击：选中己方子 → 点合法落点走子（红先交替，走子后自动交给对方） */
  function trialClick(pos: Pos): void {
    if (!trial) return;
    // 正在预览历史试走着法：点棋盘先回到最新一步，避免在旧局面上误走子
    if (trialStep < trial.moves.length) {
      trialStep = trial.moves.length;
      trial.selected = null;
      paint();
      syncControls();
      return;
    }
    const side = trialSide();
    const piece = trial.board[pos[0]][pos[1]];
    const sel = trial.selected;
    if (sel) {
      if (sel[0] === pos[0] && sel[1] === pos[1]) {
        trial.selected = null;
      } else if (piece && piece.s === side) {
        trial.selected = pos;
      } else if (legalMoves(trial.board, sel[0], sel[1]).some(([r, c]) => r === pos[0] && c === pos[1])) {
        makeMove(trial.board, sel, pos);
        trial.moves.push({ from: sel, to: pos });
        trialStep = trial.moves.length;
        trial.selected = null;
      } else {
        trial.selected = null;
      }
      paint();
      syncControls();
      return;
    }
    if (piece && piece.s === side) {
      trial.selected = pos;
      paint();
      syncControls();
    }
  }

  // ---------------------------------------------------------------- 事件

  $('btn-history-back').addEventListener('click', () => deps.show('screen-home'));
  $('btn-history-refresh').addEventListener('click', () => void refresh());
  $('tab-history-all').addEventListener('click', () => setScope('all'));
  $('tab-history-mine').addEventListener('click', () => setScope('mine'));
  $('btn-replay-back').addEventListener('click', () => {
    resetAux();
    deps.show('screen-history');
  });
  $('btn-replay-first').addEventListener('click', () => jump(0));
  $('btn-replay-prev').addEventListener('click', () => step(-1));
  $('btn-replay-next').addEventListener('click', () => step(1));
  $('btn-replay-last').addEventListener('click', () => {
    if (record) jump(record.moves.length);
  });
  // AI 推荐：点按钮显示 / 收起推荐；点棋盘上的蓝色落点看变化第一步；试下自由走子
  $('btn-replay-hint').addEventListener('click', () => void toggleHint());
  $('btn-replay-try').addEventListener('click', () => (trial ? exitTrial() : enterTrial()));
  $('btn-replay-try-undo').addEventListener('click', trialUndo);
  $('btn-replay-try-reset').addEventListener('click', trialReset);
  // 左右箭头：AI 推荐变化或试下着法逐步
  $('btn-replay-step-prev').addEventListener('click', () => (trial ? trialStepBy(-1) : linePrev()));
  $('btn-replay-step-next').addEventListener('click', () => {
    if (trial) trialStepBy(1);
    else void lineNext();
  });

  canvas.addEventListener('click', (e) => {
    if (!record) return;
    const pt = canvasPoint(canvas, e.clientX, e.clientY, deps.skin());
    const pos = pickCell(pt.x, pt.y, deps.skin(), false);
    if (!pos) return;
    if (trial) {
      trialClick(pos);
      return;
    }
    if (hint && hintState === 'shown' && lineStep === 0 && pos[0] === hint.to[0] && pos[1] === hint.to[1]) {
      previewLine(1);
    }
  });

  // 试下时悬停预高亮 + 手型光标（预览历史着法 / 其余形态只读）
  canvas.addEventListener('mousemove', (e) => {
    if (!trial) return;
    if (trialStep < trial.moves.length) {
      if (trialHover) {
        trialHover = null;
        paint();
      }
      canvas.style.cursor = 'default';
      return;
    }
    const pt = canvasPoint(canvas, e.clientX, e.clientY, deps.skin());
    const pos = pickCell(pt.x, pt.y, deps.skin(), false);
    const same =
      (pos === null && trialHover === null) ||
      (!!pos && !!trialHover && pos[0] === trialHover[0] && pos[1] === trialHover[1]);
    if (same) return;
    trialHover = pos;
    const hit = pos ? trial.board[pos[0]][pos[1]] : null;
    const clickable =
      !!pos &&
      (hit?.s === trialSide() ||
        (trial.selected
          ? legalMoves(trial.board, trial.selected[0], trial.selected[1]).some(
              ([r, c]) => r === pos[0] && c === pos[1],
            )
          : false));
    canvas.style.cursor = clickable ? 'pointer' : 'default';
    paint();
  });
  canvas.addEventListener('mouseleave', () => {
    if (!trial || !trialHover) return;
    trialHover = null;
    canvas.style.cursor = 'default';
    paint();
  });

  // 左右方向键：试下中步进试走着法；AI 推荐显示中步进变化；否则步进对局记录
  window.addEventListener('keydown', (e) => {
    if (!$('screen-replay').classList.contains('active')) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    if (trial) {
      trialStepBy(delta);
      return;
    }
    if (hintState === 'shown' && line) {
      if (delta > 0) void lineNext();
      else linePrev();
      return;
    }
    step(delta);
  });

  return {
    open,
    isReplayActive: () => $('screen-replay').classList.contains('active'),
    redraw: () => paint(),
  };
}
