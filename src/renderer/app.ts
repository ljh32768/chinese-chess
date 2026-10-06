/**
 * 渲染层主控制器：页面切换、棋盘交互、消息处理。
 * 客户端只发送「走子意图」，一切以主机广播为准。
 */

import { findKing, initBoard, legalMoves } from '../shared/rules.js';
import { ServerMessage } from '../shared/protocol.js';
import { Board, FirstMode, GameSnapshot, GuessChoice, Move, PieceType, Pos, Side } from '../shared/types.js';
import { capturedPieces } from '../shared/notation.js';
import { DiscoveredHost, discoverSubnet, probeHost } from './discover.js';
import {
  BoardView,
  DEFAULT_SKIN,
  SkinId,
  SKINS,
  boardBgUrl,
  canvasPoint,
  isSkinId,
  loadSkinImages,
  nextSkin,
  pickCell,
  renderBoard,
} from './board.js';
import { initReview, ReviewController } from './review.js';
import { playClick, playSelect } from './sound.js';
import { Net, WelcomeInfo } from './net.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const boardEl = document.getElementById('board') as HTMLCanvasElement;

/** 皮肤偏好键（localStorage） */
const SKIN_KEY = 'lanschess-skin';

/** 棋子汉字（红黑两套用字，用于吃子展示） */
const PIECE_NAME: Record<Side, Record<PieceType, string>> = {
  r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

/** 客户端本地视图状态（仅用于渲染，非权威） */
const S = {
  role: 'host' as 'host' | 'guest',
  /** 观战者模式：只读旁观（不占红黑席位） */
  spectator: false,
  side: 'r' as Side,
  board: initBoard() as Board,
  turn: 'r' as Side,
  selected: null as Pos | null,
  moves: [] as Pos[],
  lastMove: null as Move | null,
  status: 'idle' as GameSnapshot['status'],
  winner: null as Side | null,
  reason: '',
  check: false,
  moveSeq: 0,
  /** 已发出、等待对方回应的请求（用于侧栏等待状态） */
  pending: null as null | 'draw' | 'restart' | 'undo',
  /** 对手意外断线、宽限期等待重连中（服务端 opponent_away） */
  oppAway: false,
  /** 完整着法序列（棋谱 / 吃子 / 悔棋展示） */
  history: [] as Move[],
  /** 本回合截止时间（epoch ms）；null 表示不限时 */
  deadline: null as number | null,
  /** 人机对战（本机创建的对局，AI 执黑） */
  aiMode: false,
  /** 当前皮肤（参考项目三套素材） */
  skin: DEFAULT_SKIN as SkinId,
  /** 鼠标悬停的交叉点（仅用于预高亮） */
  hover: null as Pos | null,
  /** 主机在等待页选择的先手（红方）方式 */
  firstMode: 'r' as FirstMode,
};

let net: Net | null = null;

/** 已加载的皮肤素材（按皮肤缓存） */
const loadedImages: Partial<Record<SkinId, Record<string, HTMLImageElement>>> = {};
const skin = (): (typeof SKINS)[SkinId] => SKINS[S.skin];

const flip = () => S.side === 'b';
const sideName = (s: Side) => (s === 'r' ? '红方' : '黑方');
const resultText = () => (S.winner === 'r' ? '红方胜' : S.winner === 'b' ? '黑方胜' : '和棋');

// -------------------------------------------------------------- 基础 UI

function show(id: string): void {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?: () => void;
}

function showModal(o: { title: string; sub?: string; buttons: ModalButton[] }): void {
  $('modal-title').textContent = o.title;
  $('modal-sub').textContent = o.sub ?? '';
  const box = $('modal-btns');
  box.innerHTML = '';
  for (const b of o.buttons) {
    const el = document.createElement('button');
    el.className = 'btn ' + (b.primary ? 'primary' : 'ghost');
    el.textContent = b.label;
    el.addEventListener('click', () => {
      closeModal();
      b.onClick?.();
    });
    box.appendChild(el);
  }
  $('modal').classList.add('show');
}

function closeModal(): void {
  $('modal').classList.remove('show');
}

// -------------------------------------------------------------- 渲染

/** 当前是否本方可以操作棋盘（观战 / 非本回合 / 断线等待时不可操作） */
function canPlay(): boolean {
  return !S.spectator && S.status === 'playing' && S.turn === S.side && !S.oppAway;
}

/** 组装棋盘渲染视图（纯展示，不含规则判定） */
function boardView(): BoardView {
  const playable = canPlay();
  return {
    board: S.board,
    selected: S.selected,
    moves: S.moves,
    lastMove: S.lastMove,
    flip: flip(),
    checkKing: S.check ? findKing(S.board, S.turn) : null,
    interactiveSide: playable ? S.side : null,
    hover: playable ? S.hover : null,
  };
}

/** 重绘棋盘（不做面板与状态同步，供悬停 / 脉冲帧调用） */
function paint(): void {
  renderBoard(boardEl, boardView(), skin(), loadedImages[S.skin] ?? {}, performance.now());
}

/** 按皮肤套用页面背景（木质底图，与参考项目一致） */
function applyTheme(): void {
  document.body.style.background = `#2b2016 url(${boardBgUrl(skin())}) repeat`;
}

/** 确保当前皮肤素材已加载（复盘页需要等待素材就绪后再绘制） */
function ensureSkinImagesLoaded(): Promise<void> {
  const skinId = S.skin;
  if (loadedImages[skinId]) return Promise.resolve();
  return loadSkinImages(skin()).then((imgs) => {
    loadedImages[skinId] = imgs;
    paint();
  });
}

/** 按需加载当前皮肤素材（不阻塞界面） */
function ensureSkinImages(): void {
  void ensureSkinImagesLoaded();
}

/** 对局回顾（列表 + 复盘）；在 init() 中装配 */
let review: ReviewController | null = null;

/** 将军警示环的脉冲动画：仅在需要时运行定时重绘 */
let pulseTimer = 0;
function syncPulse(): void {
  const need = S.check && S.status === 'playing' && $('screen-game').classList.contains('active');
  if (need && !pulseTimer) {
    pulseTimer = window.setInterval(() => {
      if (!S.check || S.status !== 'playing') {
        window.clearInterval(pulseTimer);
        pulseTimer = 0;
        return;
      }
      paint();
    }, 100);
  } else if (!need && pulseTimer) {
    window.clearInterval(pulseTimer);
    pulseTimer = 0;
  }
}

function render(): void {
  paint();
  updatePanel();
  syncPulse();
}

function updateRoleHint(): void {
  if (S.spectator) {
    $('role-hint').textContent = '观战 · 只读';
    return;
  }
  if (S.aiMode) {
    $('role-hint').textContent = '人机对战 · AI 执黑';
    return;
  }
  $('role-hint').textContent = `你执${S.side === 'r' ? '红' : '黑'} · ${
    S.role === 'host' ? '主机' : '加入者'
  }`;
}

/** 计时读秒剩余时间文案（未启用计时返回空串） */
function remainText(): string {
  if (!S.deadline || S.status !== 'playing') return '';
  const sec = Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000));
  return `（剩余 ${sec}s）`;
}

function updatePanel(): void {
  const opp: Side = S.side === 'r' ? 'b' : 'r';
  const rowTop = $('p-top');
  const rowBottom = $('p-bottom');
  rowTop.className = 'player-row ' + (opp === 'r' ? 'red' : 'black');
  rowBottom.className = 'player-row ' + (S.side === 'r' ? 'red' : 'black');
  // 观战者视角显示红黑双方，不出现「你 / 对手」
  $('p-top-name').textContent = S.spectator ? sideName(opp) : `${sideName(opp)} · 对手`;
  $('p-bottom-name').textContent = S.spectator ? sideName(S.side) : `${sideName(S.side)} · 你`;

  const active = S.status === 'playing';
  const over = S.status === 'over';
  // 操作组：观战者隐藏对局操作（只读），对局中与结束态互斥切换
  $('actions-play').hidden = over || S.spectator;
  $('actions-over').hidden = !over || S.spectator;
  $('actions-spectate').hidden = !S.spectator;
  rowTop.classList.toggle('active', active && S.turn === opp);
  rowBottom.classList.toggle('active', active && S.turn === S.side);
  $('p-top-tag').textContent = active && S.turn === opp ? '走棋中' : '';
  $('p-bottom-tag').textContent = active && S.turn === S.side ? '走棋中' : '';

  const st = $('status-box');
  st.classList.toggle('check', active && S.check);
  st.classList.toggle('over', over);
  st.classList.toggle('win-red', over && S.winner === 'r');
  st.classList.toggle('win-black', over && S.winner === 'b');
  st.classList.toggle('draw', over && S.winner === null);
  let statusText: string;
  if (S.status === 'over') {
    statusText = `${resultText()} · ${S.reason}`;
  } else if (active && S.oppAway) {
    statusText = '对手已断开，等待重连…';
  } else if (active && S.check) {
    statusText = S.spectator
      ? `⚠ ${sideName(S.turn)}被将军`
      : S.turn === S.side
        ? '⚠ 你被将军了'
        : '⚠ 对方被将军';
  } else if (active) {
    statusText = S.spectator
      ? `${sideName(S.turn)}行棋中…`
      : S.turn === S.side
        ? '轮到你走棋'
        : '对方思考中…';
  } else {
    statusText = S.spectator ? '等待对局开始' : '准备开始';
  }
  st.textContent = active ? `${statusText}${remainText()}` : statusText;

  // 请求等待状态（和棋 / 重开 / 悔棋发出后）
  const req = $('req-hint');
  req.hidden = !S.pending;
  if (S.pending) {
    req.textContent =
      S.pending === 'draw'
        ? '已发送和棋请求，等待对方回应…'
        : S.pending === 'undo'
          ? '已发送悔棋请求，等待对方回应…'
          : '已发送重开请求，等待对方回应…';
  }

  renderCaptured();
}

/** 渲染吃子面板（由着法序列推导，纯展示） */
function renderCaptured(): void {
  const cap = capturedPieces(S.history);
  $('cap-red-list').textContent = cap.byRed.map((t) => PIECE_NAME.b[t]).join(' ') || '—';
  $('cap-black-list').textContent = cap.byBlack.map((t) => PIECE_NAME.r[t]).join(' ') || '—';
}

function applySnapshot(s: GameSnapshot): void {
  S.board = s.board;
  S.turn = s.turn;
  S.moveSeq = s.moveSeq;
  S.status = s.status;
  S.winner = s.winner;
  S.reason = s.reason;
  S.lastMove = s.lastMove;
  S.check = s.check;
  S.selected = null;
  S.moves = [];
  S.pending = null;
  S.oppAway = false;
  S.hover = null;
  S.history = s.history ?? [];
  S.deadline = s.deadline ?? null;
  updateRoleHint();
  if ($('screen-game').classList.contains('active')) render();
}

function enterGame(): void {
  show('screen-game');
  render();
}

// -------------------------------------------------------------- 消息处理

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'start':
      closeModal(); // 猜先弹层（若在等待应答时开局）
      if (msg.side !== null) S.side = msg.side;
      applySnapshot(msg.state);
      enterGame();
      toast('对局开始，红方先行');
      break;
    case 'grasp_request':
      // 猜先第一步：主机自己抓单 / 抓双
      $('host-wait').textContent = '猜先：请选择抓单或抓双…';
      showModal({
        title: '猜 先',
        sub: '请抓子（藏好，让对方猜单双）',
        buttons: [
          { label: '抓 单', primary: true, onClick: () => net?.send({ type: 'grasp', choice: 'odd' }) },
          { label: '抓 双', onClick: () => net?.send({ type: 'grasp', choice: 'even' }) },
        ],
      });
      break;
    case 'guess_request':
      // 猜先第二步：客方弹层应答，主机在等待页看到进度
      if (S.role === 'host') {
        $('host-wait').textContent = '进入猜先：等待加入者猜单双…';
      } else {
        showModal({
          title: '猜 先',
          sub: '主机已抓子，请猜单双 —— 猜中者执红',
          buttons: [
            {
              label: '猜 单',
              primary: true,
              onClick: () => net?.send({ type: 'guess', choice: 'odd' as GuessChoice }),
            },
            { label: '猜 双', onClick: () => net?.send({ type: 'guess', choice: 'even' as GuessChoice }) },
          ],
        });
      }
      break;
    case 'first_result': {
      const hostRed = msg.hostSide === 'r';
      if (msg.mode === 'guess' && msg.guess) {
        const cn = (c: GuessChoice) => (c === 'odd' ? '单' : '双');
        toast(
          `猜先：主机抓「${cn(msg.guess.actual)}」，${S.role === 'guest' ? '你' : '对方'}猜「${cn(msg.guess.choice)}」→ 主机执${
            hostRed ? '红' : '黑'
          }`,
        );
      } else if (msg.mode === 'random') {
        toast(`随机黑红：主机执${hostRed ? '红' : '黑'}，加入者执${hostRed ? '黑' : '红'}`);
      }
      break;
    }
    case 'move_applied':
      S.board = msg.board;
      S.turn = msg.turn;
      S.moveSeq = msg.seq;
      S.check = msg.check;
      S.status = msg.status;
      S.winner = msg.winner;
      S.reason = msg.reason;
      S.lastMove = msg.lastMove;
      S.selected = null;
      S.moves = [];
      S.history = msg.history;
      S.deadline = msg.deadline;
      playClick();
      render();
      break;
    case 'move_rejected':
      toast(`走子无效：${msg.reason}`);
      break;
    case 'state':
      applySnapshot(msg.state);
      // 宽限超时 / 放弃等待后主机回到等待页（等待新对手加入）；顺带关闭断线弹层
      if (S.role === 'host' && S.status === 'waiting') {
        closeModal();
        $('host-wait').textContent = '对手已离开，等待新对手加入…';
        show('screen-host');
      } else if (S.role === 'host' && S.status === 'idle') {
        closeModal();
        show('screen-home');
      }
      break;
    case 'game_over':
      applySnapshot(msg.state);
      break;
    case 'draw_request':
      showModal({
        title: '对方请求和棋',
        sub: '同意则本局判和',
        buttons: [
          { label: '同意', primary: true, onClick: () => respondDraw(true) },
          { label: '拒绝', onClick: () => respondDraw(false) },
        ],
      });
      break;
    case 'draw_response':
      S.pending = null;
      if (!msg.accept) toast('对方拒绝了和棋请求');
      updatePanel();
      break;
    case 'restart_request':
      showModal({
        title: '对方请求重开',
        sub: '同意则立即重新开局',
        buttons: [
          { label: '同意', primary: true, onClick: () => respondRestart(true) },
          { label: '拒绝', onClick: () => respondRestart(false) },
        ],
      });
      break;
    case 'restart_response':
      S.pending = null;
      if (!msg.accept) toast('对方拒绝了重开请求');
      updatePanel();
      break;
    case 'undo_request':
      showModal({
        title: '对方请求悔棋',
        sub: '同意则回退一步',
        buttons: [
          { label: '同意', primary: true, onClick: () => respondUndo(true) },
          { label: '拒绝', onClick: () => respondUndo(false) },
        ],
      });
      break;
    case 'undo_response':
      S.pending = null;
      if (msg.accept) {
        toast('悔棋成功，已回退一步');
      } else {
        toast('对方拒绝了悔棋请求');
      }
      updatePanel();
      break;
    case 'opponent_joined':
      closeModal();
      if (S.status === 'playing') {
        toast('对手已重新连接');
      } else {
        $('host-wait').textContent = '对手已加入，正在开局…';
      }
      updatePanel();
      break;
    case 'opponent_away':
      // 对手意外断线：进入宽限等待（主机可放弃等待，改为等待新对手）
      S.oppAway = true;
      updatePanel();
      showModal({
        title: '对手已断开',
        sub: '正在等待对方重连（限时恢复）',
        buttons:
          S.role === 'host'
            ? [
                { label: '继续等待重连', primary: true },
                { label: '等待新对手', onClick: () => net?.send({ type: 'wait_new_opponent' }) },
              ]
            : [{ label: '继续等待重连', primary: true }],
      });
      break;
    case 'opponent_left':
      handleOpponentLeft(msg.reason);
      break;
    case 'error':
      // 主机端的协议 / 状态错误提示（如「尚未加入对局」）
      toast(msg.message);
      break;
    default:
      break;
  }
}

/** 回应对方的和棋请求（同时清空自己已发出的同名请求等待态） */
function respondDraw(accept: boolean): void {
  S.pending = null;
  net?.send({ type: 'draw_response', accept });
  updatePanel();
}

/** 回应对方的重开请求 */
function respondRestart(accept: boolean): void {
  S.pending = null;
  net?.send({ type: 'restart_response', accept });
  updatePanel();
}

/** 回应对方的悔棋请求 */
function respondUndo(accept: boolean): void {
  S.pending = null;
  net?.send({ type: 'undo_response', accept });
  updatePanel();
}

function handleOpponentLeft(reason: string): void {
  // 主机视角 reason 就是「对手已离开」，避免标题与说明重复
  const sub = reason === '对手已离开' ? '本局已结束，可返回首页重新开局' : reason;
  if (S.status === 'playing' || S.status === 'over') {
    S.status = 'over';
    S.oppAway = false;
    render();
    showModal({
      title: '对手已离开',
      sub,
      buttons: [{ label: '返回首页', primary: true, onClick: leaveToHome }],
    });
  } else {
    toast(reason);
    updatePanel();
  }
}

function handleClosed(reason: string): void {
  if (S.status === 'playing' || S.status === 'over') {
    S.status = 'over';
    S.oppAway = false;
    render();
    showModal({
      title: '连接已断开',
      sub: '与主机的连接已中断，可返回首页重试',
      buttons: [{ label: '返回首页', primary: true, onClick: leaveToHome }],
    });
  } else {
    toast(reason);
  }
}

// -------------------------------------------------------------- 连接

async function openNet(url: string, role: 'host' | 'guest' | 'spectator'): Promise<void> {
  net?.close();
  net = new Net({
    onWelcome(info: WelcomeInfo) {
      S.side = info.side ?? 'r'; // 观战者 side 为 null，统一按红方视角渲染
      S.spectator = info.side === null;
      S.role = role === 'host' ? 'host' : 'guest';
      S.firstMode = info.firstMode;
      renderSidePick();
      applySnapshot(info.state);
      if (S.spectator) {
        enterGame();
        toast('已进入观战（只读）');
      } else if (info.state.status === 'playing') {
        enterGame();
      }
    },
    onMessage: handleMessage,
    onClosed: handleClosed,
  });
  await net.connect(url, role);
}

async function createGame(): Promise<void> {
  try {
    const res = await fetch('/api/host/start', { method: 'POST' });
    if (!res.ok) throw new Error('当前页面无法创建对局，请通过主机端打开');
    const info = (await res.json()) as { ip: string; port: number };
    S.role = 'host';
    S.aiMode = false;
    S.firstMode = 'r'; // 主机服务在新建等待时也会重置为默认
    $('host-ip').textContent = `${info.ip}:${info.port}`;
    $('host-wait').textContent = '让对方在「加入对局」中输入上方地址';
    renderSidePick();
    show('screen-host');
    await openNet(`ws://${location.host}/ws`, 'host');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

const FIRST_HINT: Record<FirstMode, string> = {
  r: '先手（红方）：主机执红先行',
  b: '先手（红方）：主机执黑，加入者执红先行',
  random: '先手（红方）：开局时随机分配红黑',
  guess: '先手（红方）：主机抓单双、加入者猜，猜中者执红',
};

/** 等待页：渲染先手（红方）方式的选择状态 */
function renderSidePick(): void {
  document.querySelectorAll<HTMLButtonElement>('#side-opts .side_opt').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === S.firstMode);
  });
  $('side-hint').textContent = FIRST_HINT[S.firstMode];
}

/** 等待页：选择先手方式（仅等待阶段有效，开赛后主机服务会拒绝） */
function chooseFirst(mode: FirstMode): void {
  if (S.firstMode === mode) return;
  S.firstMode = mode;
  renderSidePick();
  $('host-wait').textContent = '让对方在「加入对局」中输入上方地址';
  net?.send({ type: 'choose_first', mode });
}

/** 首页「人机对弈」子菜单：与参考项目一致，先选难度再开始 */
function showAiMenu(): void {
  $('menu-index').hidden = true;
  $('menu-ai').hidden = false;
}

function backToIndex(): void {
  $('menu-ai').hidden = true;
  $('menu-index').hidden = false;
}

/** 读取人机对战难度（搜索深度，2/3/4 对应菜鸟/中级/高手） */
function aiDepth(): number {
  const el = document.querySelector<HTMLInputElement>('input[name="ai-depth"]:checked');
  const depth = Number(el?.value ?? 3);
  return Number.isInteger(depth) && depth >= 1 && depth <= 4 ? depth : 3;
}

/** 人机对战：AI 执黑，创建后直接进入对局 */
async function createAiGame(): Promise<void> {
  try {
    const res = await fetch(`/api/host/start-ai?depth=${aiDepth()}`, { method: 'POST' });
    if (!res.ok) throw new Error('当前页面无法创建对局，请通过主机端打开');
    S.role = 'host';
    S.aiMode = true;
    await openNet(`ws://${location.host}/ws`, 'host');
    toast('人机对战开始，你执红先行');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

/** 读取上次选择的皮肤（localStorage 不可用时回退默认皮肤） */
function loadSkinPreference(): SkinId {
  try {
    const saved = window.localStorage.getItem(SKIN_KEY);
    return isSkinId(saved) ? saved : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** 更换皮肤：按参考项目顺序循环三套素材，并记住选择 */
function switchSkin(): void {
  if ($('screen-game').classList.contains('active') && S.status === 'playing') {
    return toast('对局中不能更换皮肤');
  }
  S.skin = nextSkin(S.skin);
  try {
    window.localStorage.setItem(SKIN_KEY, S.skin);
  } catch {
    /* 忽略：隐私模式下无法写入，仅本次会话生效 */
  }
  applyTheme();
  ensureSkinImages();
  paint();
  review?.redraw(); // 复盘棋盘跟随皮肤
  toast(`已更换皮肤：${SKINS[S.skin].label}`);
}

async function cancelHost(): Promise<void> {
  try {
    await fetch('/api/host/stop', { method: 'POST' });
  } catch {
    /* 忽略 */
  }
  net?.close();
  net = null;
  S.status = 'idle';
  show('screen-home');
}

/**
 * 复制本机地址（A2）。
 * 局域网页面是 http 非安全上下文，navigator.clipboard 多数不可用，
 * 因此降级为「选中文本 + execCommand('copy')」。
 */
async function copyHostAddr(): Promise<void> {
  const el = $('host-ip');
  const text = el.textContent?.trim() ?? '';
  if (!text || text === '—') return;
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    try {
      document.execCommand('copy');
    } catch {
      /* 忽略：即使复制失败也已选中文本，用户可手动复制 */
    }
    sel?.removeAllRanges();
  }
  toast('地址已复制');
}

function showJoin(): void {
  const msg = $('join-msg');
  msg.textContent = '';
  msg.className = 'hint';
  $('scan-result').hidden = true;
  show('screen-join');
}

/** 从 IP 中取前三段作为 /24 网段前缀；不合法返回 null */
function subnetPrefix(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  return m ? m[1] : null;
}

/** 把发现的候选主机渲染为可点击按钮（点击后填入加入表单） */
function renderScanResult(hosts: DiscoveredHost[]): void {
  const box = $('scan-result');
  box.replaceChildren();
  box.hidden = hosts.length === 0;
  for (const h of hosts) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = `${h.ip}:${h.port}`;
    btn.addEventListener('click', () => {
      $<HTMLInputElement>('join-ip').value = h.ip;
      $<HTMLInputElement>('join-port').value = String(h.port);
      toast(`已选择 ${h.ip}:${h.port}`);
    });
    box.appendChild(btn);
  }
}

/** 搜索局域网主机（D1）：先直探已知地址，再扫描同网段并合并去重 */
async function scanHosts(): Promise<void> {
  const msg = $('join-msg');
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };
  const ipInput = $<HTMLInputElement>('join-ip').value.trim();
  const port = Number($<HTMLInputElement>('join-port').value.trim() || '7777');
  const prefix = subnetPrefix(ipInput) ?? subnetPrefix(location.hostname);
  if (!prefix || !Number.isInteger(port)) {
    return setMsg('请先填写同网段的任意主机地址与端口，再进行搜索', 'err');
  }

  const found = new Map<string, DiscoveredHost>();
  const add = (h: DiscoveredHost | null) => {
    if (h) found.set(`${h.ip}:${h.port}`, h);
  };

  // 已知地址优先（输入框中的地址 / 当前页面来源主机），再扫网段
  setMsg('正在探测已知地址…');
  if (subnetPrefix(ipInput)) add(await probeHost(ipInput, port, { timeoutMs: 800 }));
  if (location.hostname !== ipInput) {
    add(await probeHost(location.hostname, port, { timeoutMs: 800 }));
  }

  const sweep = await discoverSubnet(prefix, port, {
    onProgress: (done, total) => setMsg(`正在搜索 ${prefix}.0/24 … ${done}/${total}`),
  });
  for (const h of sweep) add(h);

  const hosts = [...found.values()];
  renderScanResult(hosts);
  setMsg(
    hosts.length ? `发现 ${hosts.length} 台主机，点击即可填入` : '未发现主机，请确认在同一局域网',
    hosts.length ? 'ok' : 'err',
  );
}

async function doJoin(asSpectator = false): Promise<void> {
  const ip = $<HTMLInputElement>('join-ip').value.trim();
  const port = $<HTMLInputElement>('join-port').value.trim();
  const msg = $('join-msg');
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };

  if (!ip || !port) return setMsg('请输入主机地址和端口', 'err');
  if (!/^\d+$/.test(port)) return setMsg('端口必须是数字', 'err');

  setMsg(`正在连接 ${ip}:${port} …`);
  S.aiMode = false;
  try {
    await openNet(`ws://${ip}:${port}/ws`, asSpectator ? 'spectator' : 'guest');
    setMsg(asSpectator ? '已进入观战（只读）' : '连接成功，正在开局…', 'ok');
  } catch (e) {
    setMsg(e instanceof Error ? e.message : '连接失败', 'err');
  }
}

function leaveToHome(): void {
  net?.send({ type: 'leave' });
  net?.close();
  net = null;
  if (S.role === 'host') {
    fetch('/api/host/stop', { method: 'POST' }).catch(() => undefined);
  }
  closeModal();
  S.status = 'idle';
  S.selected = null;
  S.moves = [];
  S.aiMode = false;
  S.deadline = null;
  S.hover = null;
  backToIndex();
  show('screen-home');
}

// -------------------------------------------------------------- 对局操作

function resign(): void {
  if (S.status !== 'playing') return toast('对局尚未开始');
  showModal({
    title: '确认认输？',
    sub: '认输后本局判负',
    buttons: [
      { label: '确认认输', primary: true, onClick: () => net?.send({ type: 'resign' }) },
      { label: '取消' },
    ],
  });
}

function offerDraw(): void {
  if (S.status !== 'playing') return toast('对局尚未开始');
  if (S.pending) return toast('请求已发送，等待对方回应');
  net?.send({ type: 'draw_request' });
  S.pending = 'draw';
  updatePanel();
  toast('已发送和棋请求…');
}

function requestRestart(): void {
  if (S.status !== 'over') return toast('对局结束后才能重开');
  if (S.pending) return toast('请求已发送，等待对方回应');
  net?.send({ type: 'restart_request' });
  S.pending = 'restart';
  updatePanel();
  toast('已发送重开请求…');
}

/** 悔棋：请求回退一步（与和棋同构的「请求-回应」） */
function offerUndo(): void {
  if (S.status !== 'playing') return toast('对局尚未开始');
  if (S.pending) return toast('请求已发送，等待对方回应');
  if (S.history.length === 0) return toast('当前没有可悔的棋');
  net?.send({ type: 'undo_request' });
  S.pending = 'undo';
  updatePanel();
  toast('已发送悔棋请求…');
}

/** 取消当前选中（ESC / 右键触发） */
function clearSelection(): void {
  if (!S.selected) return;
  S.selected = null;
  S.moves = [];
  render();
}

// -------------------------------------------------------------- 走子交互

function onCell([r, c]: Pos): void {
  const p = S.board[r][c];
  const pick = (): void => {
    S.selected = [r, c];
    S.moves = legalMoves(S.board, r, c);
    playSelect();
    render();
  };

  if (S.selected) {
    if (S.moves.some(([rr, cc]) => rr === r && cc === c)) {
      net?.send({ type: 'move', from: S.selected, to: [r, c] });
      S.selected = null;
      S.moves = [];
      render();
      return;
    }
    if (p && p.s === S.side) {
      pick();
      return;
    }
    S.selected = null;
    S.moves = [];
    render();
    return;
  }

  if (p && p.s === S.side) {
    pick();
  } else if (p) {
    toast('这是对方的棋子');
  }
}

// -------------------------------------------------------------- 初始化

function bindEvents(): void {
  $('btn-create').addEventListener('click', () => void createGame());
  $('btn-show-join').addEventListener('click', showJoin);
  $('btn-create-ai').addEventListener('click', showAiMenu);
  $('btn-ai-back').addEventListener('click', backToIndex);
  $('btn-ai-start').addEventListener('click', () => void createAiGame());
  $('btn-skin').addEventListener('click', switchSkin);
  $('btn-history').addEventListener('click', () => void review?.open());
  document.querySelectorAll<HTMLButtonElement>('#side-opts .side_opt').forEach((btn) => {
    btn.addEventListener('click', () => chooseFirst(btn.dataset.mode as FirstMode));
  });
  $('btn-cancel-host').addEventListener('click', () => void cancelHost());
  $('ip-box').addEventListener('click', () => void copyHostAddr());
  $('btn-connect').addEventListener('click', () => void doJoin());
  $('btn-spectate').addEventListener('click', () => void doJoin(true));
  $('btn-scan').addEventListener('click', () => void scanHosts());
  $('btn-spectate-leave').addEventListener('click', leaveToHome);
  $('btn-join-back').addEventListener('click', () => show('screen-home'));
  $('btn-resign').addEventListener('click', resign);
  $('btn-draw').addEventListener('click', offerDraw);
  $('btn-undo').addEventListener('click', offerUndo);
  $('btn-play-again').addEventListener('click', requestRestart);
  $('btn-home').addEventListener('click', leaveToHome);
  $('btn-leave').addEventListener('click', leaveToHome);

  /** 点击 / 悬停位置 → 逻辑棋盘坐标 */
  const cellAt = (clientX: number, clientY: number): Pos | null => {
    const pt = canvasPoint(boardEl, clientX, clientY, skin());
    return pickCell(pt.x, pt.y, skin(), flip());
  };

  boardEl.addEventListener('click', (e) => {
    if (S.spectator) return toast('观战模式只读');
    if (S.status !== 'playing') return;
    if (S.oppAway) return toast('对手已断开，等待重连');
    if (S.turn !== S.side) return toast('还没轮到你走棋');
    const pos = cellAt(e.clientX, e.clientY);
    if (pos) onCell(pos);
  });

  // 悬停预高亮 + 手型光标（触摸设备不触发，不影响交互）
  boardEl.addEventListener('mousemove', (e) => {
    const pos = cellAt(e.clientX, e.clientY);
    const same =
      (pos === null && S.hover === null) ||
      (!!pos && !!S.hover && pos[0] === S.hover[0] && pos[1] === S.hover[1]);
    if (same) return;
    S.hover = pos;
    const hit = pos ? S.board[pos[0]][pos[1]] : null;
    const clickable =
      canPlay() && (hit?.s === S.side || S.moves.some(([r, c]) => !!pos && r === pos[0] && c === pos[1]));
    boardEl.style.cursor = clickable ? 'pointer' : 'default';
    paint();
  });
  boardEl.addEventListener('mouseleave', () => {
    if (!S.hover) return;
    S.hover = null;
    boardEl.style.cursor = 'default';
    paint();
  });

  // 右键取消选中（与 ESC 等效）
  boardEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clearSelection();
  });

  // 弹层：点击遮罩关闭
  $('modal').addEventListener('click', (e) => {
    if (e.target === $('modal')) closeModal();
  });

  // ESC：优先关闭弹层，其次复盘/回顾返回，否则取消棋盘选中
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('modal').classList.contains('show')) return closeModal();
    if ($('screen-replay').classList.contains('active')) return show('screen-history');
    if ($('screen-history').classList.contains('active')) return show('screen-home');
    clearSelection();
  });

  const joinIp = $<HTMLInputElement>('join-ip');
  joinIp.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doJoin();
  });
}

async function init(): Promise<void> {
  S.skin = loadSkinPreference();
  applyTheme();
  ensureSkinImages();
  renderSidePick();
  bindEvents();
  review = initReview({
    skin,
    images: () => loadedImages[S.skin] ?? {},
    loadImages: ensureSkinImagesLoaded,
    show,
    toast,
  });
  render();
  // 计时读秒（D4）：定时刷新剩余时间显示（未启用计时时几乎零开销）
  window.setInterval(() => {
    if (S.deadline && S.status === 'playing') updatePanel();
  }, 500);
  try {
    const res = await fetch('/api/host-info');
    if (res.ok) {
      const info = (await res.json()) as { ip: string; port: number };
      $('home-hint').textContent = `本机地址 ${info.ip}:${info.port}`;
      $<HTMLInputElement>('join-ip').value = info.ip;
      $<HTMLInputElement>('join-port').value = String(info.port);
    }
  } catch {
    $('home-hint').textContent = '请通过主机端页面打开以创建对局';
  }
}

void init();
