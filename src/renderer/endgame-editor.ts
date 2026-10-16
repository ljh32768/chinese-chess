/**
 * 自建残局编辑器：在棋盘上摆出残局局面。
 *
 * - 棋盘下方是红黑两排棋子（「棋子栏」）：先点一颗选中作为画笔（再点一次取消画笔），
 *   再点棋盘交叉点落子；右键点棋盘上的棋子可把它拿走；清空棋盘用右侧「局面」面板的「清空」。
 * - 右侧「局面」面板：初始局面（标准开局） / 清空 / 红黑互换（位置不变、阵营对调）。
 * - 右下角「红先 / 黑先」= 玩家（先手方）执哪一方；棋盘左右翻转固定为红方在下。
 * - 「保 存」时先**自动核验**：局面是否合法（双方有将、无重叠、先手方未被将军、双方均有子可走）
 *   且能在核验上限内强制将死对方；不通过则逐条列出问题并留在编辑器，通过则按求出的最优步数入库。
 *
 * 本模块只管编辑器自身的 DOM 与状态：切屏、落盘、弹层由 app.ts 注入（避免模块间循环依赖）。
 */

import {
  CUSTOM_CHECK_MAX,
  EndgamePuzzle,
  boardToPieces,
  checkCustomEndgame,
  makeCustomEndgame,
  piecesToBoard,
  swapPieceSides,
} from '../shared/endgame.js';
import { initBoard } from '../shared/rules.js';
import { Board, Cell, PieceType, Pos, ROWS, COLS, Side } from '../shared/types.js';
import { BoardView, Skin, canvasPoint, pickCell, renderBoard } from './board.js';
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

/** 编辑器依赖（由 app.ts 注入） */
export interface EditorDeps {
  /** 当前皮肤 */
  skin: () => Skin;
  /** 当前皮肤已加载的素材 */
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

export function initEndgameEditor(deps: EditorDeps): EndgameEditorController {
  const canvas = document.getElementById('eg-board') as HTMLCanvasElement;
  const nameEl = document.getElementById('eg-name') as HTMLInputElement;
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
    /** 当前画笔：选中的棋子（null = 未选，点棋盘只会提示先选棋子） */
    tool: null as { t: PieceType; s: Side } | null,
    /** 先手方（玩家执子方） */
    first: 'r' as Side,
    /** 正在编辑的残局 id（新建时生成，保存时用于覆盖同名条目） */
    id: '',
    /** 默认残局名（用户没填名字时用） */
    defaultName: '自建残局',
    /** 正在保存核验中（避免连点） */
    checking: false,
  };
  /** 鼠标悬停的交叉点（有画笔时显示落点提示） */
  let hover: Pos | null = null;

  /** 鼠标 / 触摸坐标 → 逻辑棋盘坐标（编辑器不翻转视角） */
  function cellAt(clientX: number, clientY: number): Pos | null {
    const pt = canvasPoint(canvas, clientX, clientY, deps.skin());
    return pickCell(pt.x, pt.y, deps.skin(), false);
  }

  /** 重绘棋盘：有画笔时把悬停格作为「落点」提示（空格显示提示点、已有棋子显示环） */
  function paint(): void {
    const view: BoardView = {
      board: state.board,
      selected: null,
      moves: hover && state.tool ? [hover] : [],
      lastMove: null,
      flip: false,
    };
    renderBoard(canvas, view, deps.skin(), deps.images());
  }

  /** 棋子栏 / 棋盘光标按当前画笔刷新 */
  function renderTool(): void {
    for (const btn of Array.from(document.querySelectorAll<HTMLButtonElement>('.eg-piece'))) {
      const on = !!state.tool && btn.dataset.t === state.tool.t && btn.dataset.s === state.tool.s;
      btn.classList.toggle('on', on);
    }
    canvas.style.cursor = state.tool ? 'crosshair' : 'default';
  }

  /** 选中 / 取消画笔（重复点同一颗棋子即取消） */
  function pickTool(t: PieceType, s: Side): void {
    state.tool = state.tool && state.tool.t === t && state.tool.s === s ? null : { t, s };
    playSelect();
    renderTool();
  }

  /** 「红先 / 黑先」按当前先手方刷新 */
  function renderFirst(): void {
    for (const s of ['r', 'b'] as Side[]) firstBtns[s].classList.toggle('on', state.first === s);
  }

  /** 生成棋子栏（红黑各一排） */
  function buildPalette(): void {
    for (const s of ['r', 'b'] as Side[]) {
      const row = rows[s];
      row.replaceChildren();
      for (const item of PALETTE.filter((x) => x.s === s)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `eg-piece ${s}`;
        btn.dataset.t = item.t;
        btn.dataset.s = item.s;
        btn.textContent = item.label;
        btn.title = `选中${item.label}作为画笔（再点一次取消）`;
        btn.addEventListener('click', () => pickTool(item.t, item.s));
        row.appendChild(btn);
      }
    }
  }

  /** 保存：先自动核验（同步求解，先让「核验中」绘制出来） */
  function save(): void {
    if (state.checking) return;
    const name = nameEl.value.trim() || state.defaultName;
    const pieces = boardToPieces(state.board);
    state.checking = true;
    deps.toast('保存前自动核验中…');
    window.setTimeout(() => {
      state.checking = false;
      const check = checkCustomEndgame(pieces, state.first, CUSTOM_CHECK_MAX);
      if (!check.ok) {
        deps.onInvalid(name, check.problems);
        return;
      }
      deps.onSave(makeCustomEndgame(state.id, name, state.first, pieces, check.goalMoves));
    }, 0);
  }

  function open(p?: EndgamePuzzle | null): void {
    state.board = p ? piecesToBoard(p.pieces) : initBoard();
    state.tool = null;
    state.first = p?.side ?? 'r';
    state.defaultName = p?.name ?? deps.defaultName();
    state.id = p?.id ?? `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    state.checking = false;
    hover = null;
    nameEl.value = state.defaultName;
    renderTool();
    renderFirst();
    paint();
    deps.show('screen-endgame-editor');
    deps.toast(p ? `编辑自建残局「${p.name}」` : '先点一颗棋子作为画笔，再点棋盘落子（右键可拿走棋子）');
  }

  // 棋子栏 / 局面面板 / 棋盘交互
  buildPalette();
  document.getElementById('eg-reset')?.addEventListener('click', () => {
    state.board = initBoard();
    playClick();
    paint();
  });
  document.getElementById('eg-clear')?.addEventListener('click', () => {
    state.board = emptyBoard();
    playClick();
    paint();
  });
  document.getElementById('eg-swap')?.addEventListener('click', () => {
    state.board = swapBoardSides(state.board);
    playClick();
    paint();
  });
  for (const s of ['r', 'b'] as Side[]) {
    firstBtns[s].addEventListener('click', () => {
      state.first = s;
      renderFirst();
    });
  }
  document.getElementById('eg-save')?.addEventListener('click', save);
  document.getElementById('eg-cancel')?.addEventListener('click', () => deps.onCancel());

  canvas.addEventListener('click', (e) => {
    const pos = cellAt(e.clientX, e.clientY);
    if (!pos) return;
    if (!state.tool) return deps.toast('先在下方棋子栏里选一颗棋子，再点棋盘落子');
    state.board[pos[0]][pos[1]] = { t: state.tool.t, s: state.tool.s };
    playClick();
    paint();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const pos = cellAt(e.clientX, e.clientY);
    if (!pos || !state.board[pos[0]][pos[1]]) return;
    state.board[pos[0]][pos[1]] = null; // 右键拿走该格的棋子
    playClick();
    paint();
  });
  canvas.addEventListener('mousemove', (e) => {
    const pos = cellAt(e.clientX, e.clientY);
    const same =
      (pos === null && hover === null) || (!!pos && !!hover && pos[0] === hover[0] && pos[1] === hover[1]);
    if (same) return;
    hover = pos;
    paint();
  });
  canvas.addEventListener('mouseleave', () => {
    if (!hover) return;
    hover = null;
    paint();
  });

  return { open };
}
