/**
 * 自建残局编辑器：在棋盘上摆出残局局面。
 *
 * - 棋盘下方是红黑两排棋子（「棋子栏」）：**拖拽**棋子到棋盘交叉点落子；棋盘上的棋子可拖动调整位置，
 *   拖出棋盘（或右键点击）即拿走。棋子栏用与棋盘同款的棋子素材，右上角显示该棋子的**剩余可摆枚数**，
 *   摆满（剩余 0）时整枚置灰且不能再拖入。
 * - 右侧「局面」面板：初始局面（标准开局） / 清空 / 红黑互换（位置不变、阵营对调）。
 * - 右下角「红先 / 黑先」= 玩家（先手方）执哪一方；棋盘左右翻转固定为红方在下。
 * - 「保 存」时先**自动核验**：局面是否合法（双方有将、无重叠、先手方未被将军、双方均有子可走）
 *   且能在核验上限（50 步）内强制将死对方；核验在 **Web Worker** 里求解（界面显示「核验中…」，
 *   不阻塞界面），超预算或上限内无杀法即报「无杀法」；不通过则逐条列出问题并留在编辑器，
 *   通过则按求出的最优步数入库。
 *
 * 本模块只管编辑器自身的 DOM 与状态：切屏、落盘、弹层由 app.ts 注入（避免模块间循环依赖）。
 */

import {
  CUSTOM_CHECK_MAX,
  CustomCheck,
  EndgamePuzzle,
  boardToPieces,
  checkCustomEndgame,
  makeCustomEndgame,
  piecesToBoard,
  swapPieceSides,
} from '../shared/endgame.js';
import { initBoard } from '../shared/rules.js';
import { Board, Cell, PieceType, Pos, ROWS, COLS, Side } from '../shared/types.js';
import { BoardView, PIECE_IMG, Skin, assetUrl, canvasPoint, pickCell, renderBoard } from './board.js';
import { playClick, playSelect } from './sound.js';

/** 棋子栏条目：红 車馬相仕帥炮兵 / 黑 車馬象士將炮卒（与棋盘素材同款用字） */
const PALETTE: ReadonlyArray<{ t: PieceType; s: Side; label: string }> = [
  { t: 'R', s: 'r', label: '車' },
  { t: 'N', s: 'r', label: '馬' },
  { t: 'B', s: 'r', label: '相' },
  { t: 'A', s: 'r', label: '仕' },
  { t: 'K', s: 'r', label: '帥' },
  { t: 'C', s: 'r', label: '炮' },
  { t: 'P', s: 'r', label: '兵' },
  { t: 'R', s: 'b', label: '車' },
  { t: 'N', s: 'b', label: '馬' },
  { t: 'B', s: 'b', label: '象' },
  { t: 'A', s: 'b', label: '士' },
  { t: 'K', s: 'b', label: '將' },
  { t: 'C', s: 'b', label: '炮' },
  { t: 'P', s: 'b', label: '卒' },
];

/** 每种棋子的标准枚数上限（棋子栏「剩余个数」= 上限 − 棋盘上该方该种棋子数） */
export const PIECE_LIMIT: Record<Side, Record<PieceType, number>> = {
  r: { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 },
  b: { K: 1, A: 2, B: 2, N: 2, R: 2, C: 2, P: 5 },
};

/** 棋子栏「剩余个数」：标准枚数上限 − 当前棋盘上该方该种棋子数（不足 0 时按 0 计） */
export function remainingCount(board: Board, t: PieceType, s: Side): number {
  let used = 0;
  for (const row of board) {
    for (const p of row) if (p && p.t === t && p.s === s) used++;
  }
  return Math.max(0, PIECE_LIMIT[s][t] - used);
}

/** 编辑器依赖（由 app.ts 注入） */
export interface EditorDeps {
  /** 当前皮肤 */
  skin: () => Skin;
  /** 当前皮肤已加载的素材（棋盘绘制用） */
  images: () => Record<string, HTMLImageElement>;
  /** 切屏（复用 app.ts 的 show） */
  show: (id: string) => void;
  toast: (msg: string) => void;
  /** 自动核验不通过：弹层逐条列出问题（编辑器保持打开，便于按问题修改） */
  onInvalid: (name: string, problems: string[]) => void;
  /** 核验通过：落盘并返回残局面板 */
  onSave: (p: EndgamePuzzle) => void;
  /** 「返 回」：放弃编辑，回到残局面板 */
  onCancel: () => void;
  /** 新建时的默认残局名（由 app.ts 按已有自建数量生成） */
  defaultName: () => string;
}

export interface EndgameEditorController {
  /** 打开编辑器：传题目表示编辑已有条目，不传为新建 */
  open: (p?: EndgamePuzzle | null) => void;
}

/** 空棋盘 */
function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(null));
}

/** 棋盘红黑互换（位置不变、阵营对调）：走共享层的纯函数 */
function swapBoardSides(board: Board): Board {
  return piecesToBoard(swapPieceSides(boardToPieces(board)));
}

/** 正在拖拽的棋子：`from` = 棋盘上的原位置（null = 从棋子栏拖入） */
interface DragState {
  t: PieceType;
  s: Side;
  from: Pos | null;
}

export function initEndgameEditor(deps: EditorDeps): EndgameEditorController {
  const canvas = document.getElementById('eg-board') as HTMLCanvasElement;
  const nameEl = document.getElementById('eg-name') as HTMLInputElement;
  const saveBtn = document.getElementById('eg-save') as HTMLButtonElement;
  const rows: Record<Side, HTMLElement> = {
    r: document.getElementById('eg-pal-red') as HTMLElement,
    b: document.getElementById('eg-pal-black') as HTMLElement,
  };
  const firstBtns: Record<Side, HTMLButtonElement> = {
    r: document.getElementById('eg-first-r') as HTMLButtonElement,
    b: document.getElementById('eg-first-b') as HTMLButtonElement,
  };

  const state = {
    board: emptyBoard(),
    /** 先手方（玩家执子方） */
    first: 'r' as Side,
    /** 正在编辑的残局 id（新建时生成，保存时用于覆盖同名条目） */
    id: '',
    /** 默认残局名（用户没填名字时用） */
    defaultName: '自建残局',
    /** 正在保存核验中（避免连点） */
    checking: false,
  };
  /** 正在拖拽的棋子（null = 未拖拽） */
  let drag: DragState | null = null;
  /** 拖拽时指针所在的交叉点（落点提示） */
  let hover: Pos | null = null;
  /** 跟随指针的拖拽棋子图像（懒创建，避免无拖拽时也建元素） */
  let ghost: HTMLImageElement | null = null;

  /** 鼠标 / 触摸坐标 → 逻辑棋盘坐标（编辑器不翻转视角） */
  function cellAt(clientX: number, clientY: number): Pos | null {
    const pt = canvasPoint(canvas, clientX, clientY, deps.skin());
    return pickCell(pt.x, pt.y, deps.skin(), false);
  }

  /** 指针是否落在棋盘画布内（不在则视为「拖出棋盘」） */
  function cellInside(clientX: number, clientY: number): Pos | null {
    const rect = canvas.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
      return null;
    return cellAt(clientX, clientY);
  }

  /** 重绘棋盘：拖拽时把指针所在格作为落点提示，并压暗 / 框选出被拖动的棋子 */
  function paint(): void {
    const view: BoardView = {
      board: state.board,
      selected: drag?.from ?? null,
      moves: drag && hover ? [hover] : [],
      lastMove: null,
      flip: false,
    };
    renderBoard(canvas, view, deps.skin(), deps.images());
  }

  /** 棋子栏右上角「剩余个数」：摆满（0）时置灰并标记不可拖入 */
  function renderCounts(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.eg-piece'))) {
      const t = btn.dataset.t as PieceType;
      const s = btn.dataset.s as Side;
      const left = remainingCount(state.board, t, s);
      const badge = btn.querySelector<HTMLElement>('.eg-count');
      if (badge) badge.textContent = String(left);
      btn.classList.toggle('depleted', left <= 0);
      btn.setAttribute('aria-disabled', left <= 0 ? 'true' : 'false');
      const label = PALETTE.find((x) => x.t === t && x.s === s)?.label ?? '';
      btn.title =
        left > 0
          ? `${label}：剩余 ${left} 枚，拖到棋盘上落子`
          : `${label}：${PIECE_LIMIT[s][t]} 枚已全部摆上棋盘（拖走棋盘上的棋子后可再用）`;
    }
  }

  /** 棋盘重绘 + 棋子栏计数刷新（局面变更后调用） */
  function refresh(): void {
    paint();
    renderCounts();
  }

  /** 「红先 / 黑先」按当前先手方刷新 */
  function renderFirst(): void {
    for (const s of ['r', 'b'] as Side[]) firstBtns[s].classList.toggle('on', state.first === s);
  }

  /** 生成棋子栏（红黑各一排）：棋子素材与棋盘一致，右上角挂剩余枚数角标 */
  function buildPalette(): void {
    const sk = deps.skin();
    for (const s of ['r', 'b'] as Side[]) {
      const row = rows[s];
      row.replaceChildren();
      for (const item of PALETTE.filter((x) => x.s === s)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `eg-piece ${s}`;
        btn.dataset.t = item.t;
        btn.dataset.s = item.s;
        const img = document.createElement('img');
        img.src = assetUrl(sk, `${s}_${PIECE_IMG[item.t]}`);
        img.alt = item.label;
        img.draggable = false;
        const count = document.createElement('span');
        count.className = 'eg-count';
        btn.append(img, count);
        btn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          e.preventDefault();
          if (remainingCount(state.board, item.t, item.s) <= 0) return;
          startDrag(e.clientX, e.clientY, item.t, item.s, null);
        });
        row.appendChild(btn);
      }
    }
    renderCounts();
  }

  /** 拖拽棋子图像（单例）：大小按棋盘当前显示比例，与棋盘上的棋子同尺寸 */
  function dragGhost(t: PieceType, s: Side, clientX: number, clientY: number): HTMLImageElement {
    if (!ghost) {
      ghost = document.createElement('img');
      ghost.className = 'eg-drag-ghost';
      ghost.alt = '';
      document.body.appendChild(ghost);
    }
    const rect = canvas.getBoundingClientRect();
    const sk = deps.skin();
    const scale = rect.width > 0 ? rect.width / sk.width : 1;
    ghost.src = assetUrl(sk, `${s}_${PIECE_IMG[t]}`);
    ghost.style.width = `${Math.max(30, Math.round(sk.disc * scale))}px`;
    ghost.style.left = `${clientX}px`;
    ghost.style.top = `${clientY}px`;
    ghost.hidden = false;
    return ghost;
  }

  /** 指针移动：拖动棋子图像并更新落点提示 */
  function onDragMove(e: PointerEvent): void {
    if (!drag) return;
    if (ghost) {
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    }
    const pos = cellInside(e.clientX, e.clientY);
    const same =
      (pos === null && hover === null) || (!!pos && !!hover && pos[0] === hover[0] && pos[1] === hover[1]);
    if (same) return;
    hover = pos;
    paint();
  }

  /** 结束拖拽：移除全局监听、隐藏棋子图像、恢复光标 */
  function endDrag(): void {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    if (ghost) ghost.hidden = true;
    canvas.style.cursor = 'default';
  }

  /** 落下：目标格为空 / 已有棋子均可（已有棋子被替换，其枚数自动回到棋子栏） */
  function dropPiece(pos: Pos, d: DragState): boolean {
    if (d.from && d.from[0] === pos[0] && d.from[1] === pos[1]) return false;
    const moved = d.from ? state.board[d.from[0]][d.from[1]] : null;
    if (d.from) state.board[d.from[0]][d.from[1]] = null;
    state.board[pos[0]][pos[1]] = moved ?? { t: d.t, s: d.s };
    return true;
  }

  /** 松开指针：落在棋盘内则落子 / 调位，落在棋盘外则把原本在盘上的棋子拿走 */
  function onDragEnd(e: PointerEvent): void {
    if (!drag) return;
    const d = drag;
    const pos = cellInside(e.clientX, e.clientY);
    endDrag();
    drag = null;
    hover = null;
    let changed = false;
    if (pos) changed = dropPiece(pos, d);
    else if (d.from) {
      state.board[d.from[0]][d.from[1]] = null; // 拖出棋盘 = 拿走该子
      changed = true;
    }
    if (changed) {
      playClick();
      refresh();
    } else {
      paint();
    }
  }

  /** 拖拽被系统中断（触摸取消 / 窗口失焦）：放弃本次拖拽，不放子 */
  function onDragCancel(): void {
    endDrag();
    drag = null;
    hover = null;
    paint();
  }

  /** 开始拖拽：`from` 为棋盘上的原位置，从棋子栏拖入时为 null */
  function startDrag(clientX: number, clientY: number, t: PieceType, s: Side, from: Pos | null): void {
    if (drag) return;
    drag = { t, s, from };
    hover = from;
    playSelect();
    dragGhost(t, s, clientX, clientY);
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
    canvas.style.cursor = 'grabbing';
    paint();
  }

  /** 核验中：按钮禁用并显示「核验中…」，避免连点 */
  function setChecking(on: boolean): void {
    state.checking = on;
    saveBtn.disabled = on;
    saveBtn.textContent = on ? '核验中…' : '保　存';
  }

  /** 在 Web Worker 里跑核验（不阻塞界面）；Worker 不可用 / 出错时回退同步核验 */
  function runCheck(pieces: Array<[number, number, PieceType, Side]>, side: Side): Promise<CustomCheck> {
    return new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(new URL('./endgame-worker.js', import.meta.url), { type: 'module' });
      } catch {
        resolve(checkCustomEndgame(pieces, side, CUSTOM_CHECK_MAX));
        return;
      }
      let settled = false;
      const finish = (r: CustomCheck): void => {
        if (settled) return;
        settled = true;
        worker.terminate();
        resolve(r);
      };
      worker.onmessage = (e: MessageEvent<CustomCheck>) => finish(e.data);
      // Worker 出错（如加载失败）回退同步核验，保证仍能给出结论
      worker.onerror = () => finish(checkCustomEndgame(pieces, side, CUSTOM_CHECK_MAX));
      worker.postMessage({ pieces, side, limit: CUSTOM_CHECK_MAX });
    });
  }

  /** 保存：先自动核验（工作线程求解 50 步内是否有强制杀法，界面显示「核验中…」） */
  function save(): void {
    if (state.checking) return;
    const name = nameEl.value.trim() || state.defaultName;
    const pieces = boardToPieces(state.board);
    const first = state.first;
    setChecking(true);
    deps.toast('正在核验：50 步内是否有强制杀法…');
    void runCheck(pieces, first).then((check) => {
      setChecking(false);
      if (!check.ok) {
        deps.onInvalid(name, check.problems);
        return;
      }
      deps.onSave(makeCustomEndgame(state.id, name, first, pieces, check.goalMoves));
    });
  }

  function open(p?: EndgamePuzzle | null): void {
    state.board = p ? piecesToBoard(p.pieces) : initBoard();
    state.first = p?.side ?? 'r';
    state.defaultName = p?.name ?? deps.defaultName();
    state.id = p?.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setChecking(false);
    drag = null;
    hover = null;
    if (ghost) ghost.hidden = true;
    nameEl.value = state.defaultName;
    canvas.style.cursor = 'default';
    buildPalette();
    renderFirst();
    paint();
    deps.show('screen-endgame-editor');
    deps.toast(
      p
        ? `编辑自建残局「${p.name}」`
        : '从棋子栏把棋子拖到棋盘上；棋盘上的棋子可拖动调整位置，拖出棋盘即拿走',
    );
  }

  // 棋子栏 / 局面面板 / 棋盘交互
  buildPalette();
  document.getElementById('eg-reset')?.addEventListener('click', () => {
    state.board = initBoard();
    playClick();
    refresh();
  });
  document.getElementById('eg-clear')?.addEventListener('click', () => {
    state.board = emptyBoard();
    playClick();
    refresh();
  });
  document.getElementById('eg-swap')?.addEventListener('click', () => {
    state.board = swapBoardSides(state.board);
    playClick();
    refresh();
  });
  for (const s of ['r', 'b'] as Side[]) {
    firstBtns[s].addEventListener('click', () => {
      state.first = s;
      renderFirst();
    });
  }
  document.getElementById('eg-save')?.addEventListener('click', save);
  document.getElementById('eg-cancel')?.addEventListener('click', () => deps.onCancel());

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pos = cellAt(e.clientX, e.clientY);
    const p = pos ? state.board[pos[0]][pos[1]] : null;
    if (!pos || !p) return;
    e.preventDefault();
    startDrag(e.clientX, e.clientY, p.t, p.s, pos);
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const pos = cellAt(e.clientX, e.clientY);
    if (!pos || !state.board[pos[0]][pos[1]]) return;
    state.board[pos[0]][pos[1]] = null; // 右键拿走该格的棋子
    playClick();
    refresh();
  });
  // 悬停光标：盘上有子可拖动（抓手），空格 / 盘外为普通指针
  canvas.addEventListener('pointermove', (e) => {
    if (drag) return;
    const pos = cellAt(e.clientX, e.clientY);
    const p = pos ? state.board[pos[0]][pos[1]] : null;
    canvas.style.cursor = p ? 'grab' : 'default';
  });
  canvas.addEventListener('pointerleave', () => {
    if (drag) return;
    canvas.style.cursor = 'default';
  });

  return { open };
}
