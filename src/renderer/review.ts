/**
 * 对局回顾：对局列表（红黑方 / 取先方式 / 时间 / 胜负）与复盘
 * （右箭头逐步回放 + AI 推荐）。
 *
 * 记录由主机保存在内存中，通过 /api/history 系列接口读取；
 * 复盘棋盘复用对局页的 Canvas 渲染器（board.ts）。
 */

import { describeMove } from '../shared/notation.js';
import { findKing, initBoard, isInCheck, makeMove } from '../shared/rules.js';
import {
  AiHint,
  FIRST_MODE_LABEL,
  Board,
  GameRecord,
  GameRecordSummary,
  Move,
  Pos,
  Seat,
  Side,
} from '../shared/types.js';
import { Skin, renderBoard } from './board.js';

/** 席位显示名（主机 / 加入者 / AI） */
export const SEAT_LABEL: Record<Seat, string> = { host: '主机', guest: '加入者', ai: 'AI' };

/** 复盘第 index 步（0 = 开局）后的棋盘 */
export function replayBoard(moves: Move[], index: number): Board {
  const board = initBoard();
  const n = Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, moves.length));
  for (let i = 0; i < n; i++) makeMove(board, moves[i].from, moves[i].to);
  return board;
}

/** 第 index 步（0 = 开局）轮到哪一方（红先） */
export function sideAt(index: number): Side {
  return index % 2 === 0 ? 'r' : 'b';
}

/** 时间戳 → 「MM-DD HH:mm」 */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 结果文案：红胜（将死） / 和棋（同意和棋） */
export function resultText(rec: { winner: Side | null; reason: string }): string {
  const who = rec.winner === 'r' ? '红胜' : rec.winner === 'b' ? '黑胜' : '和棋';
  return `${who}（${rec.reason}）`;
}

/** 列表行文案 */
export function recordLine(rec: GameRecordSummary): {
  vs: string;
  first: string;
  time: string;
  result: string;
} {
  return {
    vs: `${SEAT_LABEL[rec.red]}（红） vs ${SEAT_LABEL[rec.black]}（黑）`,
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
  /** 切屏（复用 app.ts 的 show） */
  show: (id: string) => void;
  toast: (msg: string) => void;
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

export function initReview(deps: ReviewDeps): ReviewController {
  const canvas = $<HTMLCanvasElement>('replay-board');
  let records: GameRecordSummary[] = [];
  let record: GameRecord | null = null;
  let index = 0;
  let hint: { from: Pos; to: Pos } | null = null;
  let hintSeq = 0;
  let hintTimer = 0;

  // ---------------------------------------------------------------- 列表

  async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`请求失败（${res.status}）`);
    return (await res.json()) as T;
  }

  async function open(): Promise<void> {
    deps.show('screen-history');
    await refresh();
  }

  /** 拉取对局列表并渲染 */
  async function refresh(): Promise<void> {
    const box = $('history-list');
    box.textContent = '正在读取对局记录…';
    try {
      const data = await fetchJson<{ games: GameRecordSummary[] }>('/api/history');
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
      empty.textContent = '暂无对局记录，先下完一盘棋吧';
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
    hint = null;
    deps.show('screen-replay');
    await deps.loadImages();
    paint();
    renderInfo();
    void fetchHint();
  }

  /** 复盘棋盘：复用对局页渲染器（只读，无交互高亮） */
  function paint(): void {
    if (!record) return;
    const board = replayBoard(record.moves, index);
    const turn = sideAt(index);
    renderBoard(
      canvas,
      {
        board,
        selected: null,
        moves: [],
        lastMove: index > 0 ? record.moves[index - 1] : null,
        flip: false,
        checkKing: isInCheck(board, turn) ? findKing(board, turn) : null,
        interactiveSide: null,
        hint,
      },
      deps.skin(),
      deps.images(),
      performance.now(),
    );
  }

  /** 侧栏信息：对局信息 / 当前步 / AI 推荐 */
  function renderInfo(): void {
    if (!record) return;
    const line = recordLine(record);
    const guess = record.guess
      ? `<div>猜先：主机抓「${record.guess.actual === 'odd' ? '单' : '双'}」，加入者猜「${record.guess.choice === 'odd' ? '单' : '双'}」（${record.guess.guestWon ? '猜中' : '未中'}）</div>`
      : '';
    $('replay-info').innerHTML =
      `<div>${line.vs}</div><div>取先方式：${line.first}</div>` +
      guess +
      `<div>时间：${line.time}</div><div>结果：${line.result}</div><div>共 ${record.moveCount} 步</div>`;

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
  }

  /** 步进（delta 步，越界自动收敛）；步进后清除旧推荐并重新请求 */
  function step(delta: number): void {
    if (!record) return;
    const next = Math.max(0, Math.min(index + delta, record.moves.length));
    if (next === index) return;
    index = next;
    hint = null;
    paint();
    renderInfo();
    void fetchHint();
  }

  function jump(to: number): void {
    if (!record) return;
    const next = Math.max(0, Math.min(to, record.moves.length));
    if (next === index) return;
    index = next;
    hint = null;
    paint();
    renderInfo();
    void fetchHint();
  }

  /** 请求该局面的 AI 推荐（带序号防乱序；120ms 防抖） */
  async function fetchHint(): Promise<void> {
    if (!record) return;
    const rec = record;
    const seq = ++hintSeq;
    $('replay-hint').textContent = `${sideAt(index) === 'r' ? '红方' : '黑方'} · AI 思考中…`;
    window.clearTimeout(hintTimer);
    await new Promise<void>((r) => {
      hintTimer = window.setTimeout(() => r(), HINT_DEBOUNCE_MS);
    });
    if (seq !== hintSeq || record !== rec) return;
    try {
      const data = await fetchJson<Partial<AiHint> & { none?: boolean }>(
        `/api/ai/hint?id=${encodeURIComponent(rec.id)}&index=${index}`,
      );
      if (seq !== hintSeq || record !== rec) return;
      if (data.none || !data.from || !data.to || !data.text) {
        hint = null;
        $('replay-hint').textContent = '无推荐着法（已终局或无需走子）';
      } else {
        hint = { from: data.from, to: data.to };
        $('replay-hint').textContent = `${data.side === 'r' ? '红方' : '黑方'}推荐：${data.text}`;
      }
      paint();
    } catch {
      if (seq === hintSeq) $('replay-hint').textContent = 'AI 推荐获取失败';
    }
  }

  // ---------------------------------------------------------------- 事件

  $('btn-history-back').addEventListener('click', () => deps.show('screen-home'));
  $('btn-history-refresh').addEventListener('click', () => void refresh());
  $('btn-replay-back').addEventListener('click', () => deps.show('screen-history'));
  $('btn-replay-first').addEventListener('click', () => jump(0));
  $('btn-replay-prev').addEventListener('click', () => step(-1));
  $('btn-replay-next').addEventListener('click', () => step(1));
  $('btn-replay-last').addEventListener('click', () => {
    if (record) jump(record.moves.length);
  });

  // 左右方向键：一次一步（与「下一步 ▶ / ◀ 上一步」等效）
  window.addEventListener('keydown', (e) => {
    if (!$('screen-replay').classList.contains('active')) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });

  return {
    open,
    isReplayActive: () => $('screen-replay').classList.contains('active'),
    redraw: () => paint(),
  };
}
