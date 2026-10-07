/**
 * 渲染层主控制器：页面切换、棋盘交互、消息处理。
 *
 * 客户端只发送「走子意图」，一切以服务器广播为准；
 * 房间的创建 / 加入通过 `create_room` / `join_room` 完成（见 shared/protocol.ts）。
 */

import { findKing, initBoard, legalMoves } from '../shared/rules.js';
import { ClientMessage, ServerMessage } from '../shared/protocol.js';
import {
  Board,
  FirstMode,
  GameSnapshot,
  GuessChoice,
  Move,
  PieceType,
  Pos,
  RoomSummary,
  Side,
} from '../shared/types.js';
import { capturedPieces } from '../shared/notation.js';
import { DiscoveredServer, discoverSubnet, probeServer } from './discover.js';
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
import { Net } from './net.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const boardEl = document.getElementById('board') as HTMLCanvasElement;

/** 本地偏好键（localStorage） */
const SKIN_KEY = 'lanschess-skin';
const TOKEN_KEY = 'lanschess-token';
const USER_KEY = 'lanschess-user';
/** 进行中的房间会话（刷新页面后可自动重连原局） */
const SESSION_KEY = 'lanschess-session';

/** 棋子汉字（红黑两套用字，用于吃子展示） */
const PIECE_NAME: Record<Side, Record<PieceType, string>> = {
  r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

/** 客户端本地视图状态（仅用于渲染，非权威） */
const S = {
  /** 当前角色；未加入房间时为 null */
  role: null as 'player' | 'spectator' | null,
  /** 所在房间号 */
  roomId: '',
  /** 本端玩家 id（观战为空串） */
  playerId: '',
  /** 本端展示名 */
  name: '',
  /** 是否为房主（控权：先手方式 / 抓子 / 口令 / 放弃等待） */
  isOwner: false,
  /** 房间是否设置了口令 */
  locked: false,
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
  /** 对手展示名（对手加入后由服务端下发） */
  oppName: '',
  /** 完整着法序列（棋谱 / 吃子 / 悔棋展示） */
  history: [] as Move[],
  /** 本回合截止时间（epoch ms）；null 表示不限时 */
  deadline: null as number | null,
  /** 人机对战（AI 执黑） */
  aiMode: false,
  /** 当前皮肤（参考项目三套素材） */
  skin: DEFAULT_SKIN as SkinId,
  /** 鼠标悬停的交叉点（仅用于预高亮） */
  hover: null as Pos | null,
  /** 房主在等待页选择的先手（红方）方式 */
  firstMode: 'r' as FirstMode,
  /** 当前账号（可选）：登录后对局记录归属账号，并支持跨设备恢复席位 */
  account: null as { token: string; username: string } | null,
};

let net: Net | null = null;
/** 等待服务端对 create_room / join_room / login / register 的回应 */
let pendingReq: { resolve: () => void; reject: (e: Error) => void } | null = null;

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

/** 本地存储读写（隐私模式下静默失败） */
function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 忽略：隐私模式下无法写入，仅本次会话生效 */
  }
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
    $('role-hint').textContent = `房间 ${S.roomId} · 观战 · 只读`;
    return;
  }
  if (S.aiMode) {
    $('role-hint').textContent = `房间 ${S.roomId} · 人机对战 · AI 执黑`;
    return;
  }
  $('role-hint').textContent = `房间 ${S.roomId} · 你执${S.side === 'r' ? '红' : '黑'}${
    S.isOwner ? ' · 房主' : ''
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
  const oppLabel = S.oppName && !S.aiMode && S.oppName !== '对手' ? S.oppName : '对手';
  $('p-top-name').textContent = S.spectator ? sideName(opp) : `${sideName(opp)} · ${oppLabel}`;
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

/** 等待页：展示房间号 / 口令状态 / 先手方式 */
function showWaiting(): void {
  $('host-ip').textContent = S.roomId || '—';
  $('room-pass-hint').textContent = S.locked
    ? '本房间已设置口令，加入者需输入口令'
    : '未设口令，任何人点击即可加入';
  $('host-wait').textContent = S.aiMode ? '正在开始人机对战…' : '让对方在「加入房间」中输入上方房间号';
  renderSidePick();
  show('screen-host');
}

const FIRST_HINT: Record<FirstMode, string> = {
  r: '先手（红方）：房主执红先行',
  b: '先手（红方）：房主执黑，对手执红先行',
  random: '先手（红方）：开局时随机分配红黑',
  guess: '先手（红方）：房主抓单双、对手猜，猜中者执红',
};

/** 等待页：渲染先手（红方）方式的选择状态 */
function renderSidePick(): void {
  document.querySelectorAll<HTMLButtonElement>('#side-opts .side_opt').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === S.firstMode);
  });
  $('side-hint').textContent = FIRST_HINT[S.firstMode];
}

/** 等待页：选择先手方式（仅等待阶段有效，开赛后服务端会拒绝） */
function chooseFirst(mode: FirstMode): void {
  if (S.firstMode === mode) return;
  S.firstMode = mode;
  renderSidePick();
  net?.send({ type: 'choose_first', mode });
}

// -------------------------------------------------------------- 消息处理

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'room_joined':
      applyRoomJoined(msg);
      settlePending(true);
      return;
    case 'auth_ok':
      S.account = { token: msg.token, username: msg.username };
      writeStore(TOKEN_KEY, msg.token);
      writeStore(USER_KEY, msg.username);
      renderHomeHint();
      toast(`已登录：${msg.username}`);
      settlePending(true);
      return;
    case 'room_list':
      renderRoomList(msg.rooms);
      return;
    case 'room_closed': {
      // 房间已被销毁（终局超时 / 空闲回收 / 房主解散 / 服务器停止）
      net?.close();
      net = null;
      clearSession();
      const inGame = S.status === 'playing' || S.status === 'over';
      S.status = 'idle';
      S.oppAway = false;
      showModal({
        title: '房间已结束',
        sub: msg.reason,
        buttons: [
          {
            label: inGame ? '返回首页' : '知道了',
            primary: true,
            onClick: () => {
              resetLocal();
              show('screen-home');
            },
          },
        ],
      });
      return;
    }
    case 'start':
      closeModal(); // 猜先弹层（若在等待应答时开局）
      if (msg.side !== null) S.side = msg.side;
      applySnapshot(msg.state);
      enterGame();
      toast('对局开始，红方先行');
      return;
    case 'grasp_request':
      // 猜先第一步：房主自己抓单 / 抓双
      $('host-wait').textContent = '猜先：请选择抓单或抓双…';
      showModal({
        title: '猜 先',
        sub: '请抓子（藏好，让对方猜单双）',
        buttons: [
          { label: '抓 单', primary: true, onClick: () => net?.send({ type: 'grasp', choice: 'odd' }) },
          { label: '抓 双', onClick: () => net?.send({ type: 'grasp', choice: 'even' }) },
        ],
      });
      return;
    case 'guess_request':
      // 猜先第二步：对手弹层应答，房主在等待页看到进度
      if (S.isOwner) {
        $('host-wait').textContent = '进入猜先：等待对手猜单双…';
      } else {
        showModal({
          title: '猜 先',
          sub: '房主已抓子，请猜单双 —— 猜中者执红',
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
      return;
    case 'first_result': {
      const ownerRed = msg.ownerSide === 'r';
      if (msg.mode === 'guess' && msg.guess) {
        const cn = (c: GuessChoice) => (c === 'odd' ? '单' : '双');
        toast(
          `猜先：房主抓「${cn(msg.guess.actual)}」，${S.isOwner ? '对方' : '你'}猜「${cn(msg.guess.choice)}」→ 房主执${
            ownerRed ? '红' : '黑'
          }`,
        );
      } else if (msg.mode === 'random') {
        toast(`随机黑红：房主执${ownerRed ? '红' : '黑'}，对手执${ownerRed ? '黑' : '红'}`);
      }
      return;
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
      return;
    case 'move_rejected':
      toast(`走子无效：${msg.reason}`);
      return;
    case 'state':
      applySnapshot(msg.state);
      // 对手离开 / 放弃等待后回到等待页；顺带关闭断线弹层
      if (S.role === 'player' && S.status === 'waiting' && !S.aiMode) {
        closeModal();
        $('host-wait').textContent = '对手已离开，等待新对手加入…';
        show('screen-host');
      }
      return;
    case 'game_over':
      applySnapshot(msg.state);
      return;
    case 'draw_request':
      showModal({
        title: '对方请求和棋',
        sub: '同意则本局判和',
        buttons: [
          { label: '同意', primary: true, onClick: () => respondDraw(true) },
          { label: '拒绝', onClick: () => respondDraw(false) },
        ],
      });
      return;
    case 'draw_response':
      S.pending = null;
      if (!msg.accept) toast('对方拒绝了和棋请求');
      updatePanel();
      return;
    case 'restart_request':
      showModal({
        title: '对方请求重开',
        sub: '同意则立即重新开局',
        buttons: [
          { label: '同意', primary: true, onClick: () => respondRestart(true) },
          { label: '拒绝', onClick: () => respondRestart(false) },
        ],
      });
      return;
    case 'restart_response':
      S.pending = null;
      if (!msg.accept) toast('对方拒绝了重开请求');
      updatePanel();
      return;
    case 'undo_request':
      showModal({
        title: '对方请求悔棋',
        sub: '同意则回退一步',
        buttons: [
          { label: '同意', primary: true, onClick: () => respondUndo(true) },
          { label: '拒绝', onClick: () => respondUndo(false) },
        ],
      });
      return;
    case 'undo_response':
      S.pending = null;
      if (msg.accept) toast('悔棋成功，已回退一步');
      else toast('对方拒绝了悔棋请求');
      updatePanel();
      return;
    case 'opponent_joined':
      closeModal();
      S.oppName = msg.player.name;
      if (S.status === 'playing') {
        toast('对手已重新连接');
      } else {
        $('host-wait').textContent = `对手（${msg.player.name}）已加入，正在开局…`;
      }
      updatePanel();
      return;
    case 'opponent_away':
      // 对手意外断线：进入宽限等待（房主可放弃等待，改为等待新对手）
      S.oppAway = true;
      updatePanel();
      showModal({
        title: '对手已断开',
        sub: '正在等待对方重连（限时恢复）',
        buttons: S.isOwner
          ? [
              { label: '继续等待重连', primary: true },
              { label: '等待新对手', onClick: () => net?.send({ type: 'wait_new_opponent' }) },
            ]
          : [{ label: '继续等待重连', primary: true }],
      });
      return;
    case 'opponent_left':
      handleOpponentLeft(msg.reason);
      return;
    case 'error':
      // 房主 / 对手的协议或状态错误提示；若正等待加入回应则作为加入失败处理
      if (pendingReq) {
        const reject = pendingReq.reject;
        pendingReq = null;
        reject(new Error(msg.message));
      } else {
        toast(msg.message);
      }
      return;
    default:
      return;
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
      sub: '与服务器的连接已中断，可返回首页重试',
      buttons: [{ label: '返回首页', primary: true, onClick: leaveToHome }],
    });
  } else {
    toast(reason);
  }
}

// -------------------------------------------------------------- 房间会话

/** 建立到服务器的 WebSocket 连接（页面由服务器提供，因此用当前来源地址） */
async function openSocket(): Promise<Net> {
  net?.close();
  const n = new Net({ onMessage: handleMessage, onClosed: handleClosed });
  net = n;
  await n.connect(`ws://${location.host}/ws`);
  return n;
}

/** 发送一个需要服务端回应的请求（room_joined / auth_ok 成功，error 失败） */
function request(msg: ClientMessage, timeoutMs = 8000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (!pendingReq) return;
      pendingReq = null;
      reject(new Error('服务器无响应，请稍后重试'));
    }, timeoutMs);
    pendingReq = {
      resolve: () => {
        window.clearTimeout(timer);
        resolve();
      },
      reject: (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    };
    net?.send(msg);
  });
}

function settlePending(ok: boolean): void {
  const p = pendingReq;
  pendingReq = null;
  if (ok) p?.resolve();
}

/** 记住当前房间会话，页面刷新后可用同一身份重连原局 */
function storeSession(): void {
  if (S.spectator || !S.roomId || !S.playerId) return;
  writeStore(SESSION_KEY, JSON.stringify({ roomId: S.roomId, playerId: S.playerId }));
}

function clearSession(): void {
  writeStore(SESSION_KEY, null);
}

/** 服务端确认加入房间：写入本地状态并进入对应页面 */
function applyRoomJoined(msg: Extract<ServerMessage, { type: 'room_joined' }>): void {
  S.roomId = msg.roomId;
  S.playerId = msg.playerId;
  S.name = msg.name;
  S.locked = msg.locked;
  S.spectator = msg.seat === null;
  S.role = S.spectator ? 'spectator' : 'player';
  S.isOwner = !S.spectator && msg.ownerId === msg.playerId;
  S.side = msg.seat ?? 'r';
  S.firstMode = msg.firstMode;
  S.oppName = '';
  storeSession();

  applySnapshot(msg.state);
  if (S.spectator) {
    enterGame();
    toast('已进入观战（只读）');
  } else if (msg.state.status === 'playing') {
    enterGame();
    toast('已恢复对局');
  } else {
    showWaiting();
  }
}

/** 取消等待（销毁自己创建的房间）并回首页 */
async function cancelHost(): Promise<void> {
  net?.send({ type: 'leave_room' });
  net?.close();
  net = null;
  clearSession();
  resetLocal();
  backToIndex();
  show('screen-home');
}

/** 重置本地对局视图状态 */
function resetLocal(): void {
  S.role = null;
  S.roomId = '';
  S.playerId = '';
  S.name = '';
  S.isOwner = false;
  S.locked = false;
  S.spectator = false;
  S.status = 'idle';
  S.selected = null;
  S.moves = [];
  S.aiMode = false;
  S.deadline = null;
  S.hover = null;
  S.oppName = '';
  S.oppAway = false;
  S.pending = null;
}

function leaveToHome(): void {
  net?.send({ type: 'leave_room' });
  net?.close();
  net = null;
  clearSession();
  closeModal();
  resetLocal();
  backToIndex();
  show('screen-home');
}

// -------------------------------------------------------------- 首页入口

const FIRST_MODE_DEFAULT: FirstMode = 'r';

/** 首页「创建房间」子菜单 */
function showCreateMenu(): void {
  $('menu-index').hidden = true;
  $('menu-ai').hidden = true;
  $('menu-create').hidden = false;
}

function backToIndex(): void {
  $('menu-ai').hidden = true;
  $('menu-create').hidden = true;
  $('menu-index').hidden = false;
}

/** 创建双人对战房间（口令可选，留空即任何人可加入） */
async function createRoom(): Promise<void> {
  const password = $<HTMLInputElement>('create-pass').value.trim();
  try {
    await openSocket();
    S.aiMode = false;
    S.firstMode = FIRST_MODE_DEFAULT;
    await request({ type: 'create_room', mode: 'pvp', password: password || null, token: S.account?.token });
    backToIndex();
  } catch (e) {
    net?.close();
    net = null;
    toast(e instanceof Error ? e.message : String(e));
    show('screen-home');
  }
}

/** 读取人机对战难度（搜索深度，2/3/4 对应菜鸟/中级/高手） */
function aiDepth(): number {
  const el = document.querySelector<HTMLInputElement>('input[name="ai-depth"]:checked');
  const depth = Number(el?.value ?? 3);
  return Number.isInteger(depth) && depth >= 1 && depth <= 4 ? depth : 3;
}

/** 人机对战：AI 执黑，创建后直接进入对局 */
async function createAiRoom(): Promise<void> {
  try {
    await openSocket();
    S.aiMode = true;
    await request({ type: 'create_room', mode: 'ai', depth: aiDepth(), token: S.account?.token });
    backToIndex();
  } catch (e) {
    net?.close();
    net = null;
    S.aiMode = false;
    toast(e instanceof Error ? e.message : String(e));
    show('screen-home');
  }
}

function showJoin(): void {
  const msg = $('join-msg');
  msg.textContent = '';
  msg.className = 'hint';
  $('scan-result').hidden = true;
  renderAccountState();
  show('screen-join');
}

/** 加入房间（或观战） */
async function doJoin(asSpectator = false): Promise<void> {
  const roomId = $<HTMLInputElement>('join-room').value.trim();
  const pwd = $<HTMLInputElement>('join-pwd').value;
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    const msg = $('join-msg');
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };

  if (!/^\d{4,8}$/.test(roomId)) return setMsg('请输入 4-8 位数字房间号', 'err');

  setMsg(`正在加入房间 ${roomId} …`);
  S.aiMode = false;
  try {
    await openSocket();
    const session = readSession();
    const playerId = session && session.roomId === roomId ? session.playerId : undefined;
    await request({
      type: 'join_room',
      roomId,
      role: asSpectator ? 'spectator' : 'player',
      playerId,
      password: pwd || undefined,
      token: S.account?.token,
    });
    setMsg(asSpectator ? '已进入观战（只读）' : '加入成功', 'ok');
  } catch (e) {
    net?.close();
    net = null;
    setMsg(e instanceof Error ? e.message : '加入失败', 'err');
  }
}

/** 读取本地保存的房间会话 */
function readSession(): { roomId: string; playerId: string } | null {
  const raw = readStore(SESSION_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { roomId?: unknown; playerId?: unknown };
    if (typeof data.roomId === 'string' && typeof data.playerId === 'string') {
      return { roomId: data.roomId, playerId: data.playerId };
    }
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return null;
}

/** 页面加载时尝试用上次会话重连原局（失败则静默回首页） */
async function tryResumeSession(): Promise<boolean> {
  const session = readSession();
  if (!session) return false;
  try {
    await openSocket();
    await request(
      {
        type: 'join_room',
        roomId: session.roomId,
        role: 'player',
        playerId: session.playerId,
        token: S.account?.token,
      },
      4000,
    );
    return true;
  } catch {
    net?.close();
    net = null;
    clearSession();
    return false;
  }
}

// -------------------------------------------------------------- 账号（可选）

function renderAccountState(): void {
  const user = S.account?.username;
  $('acct-user').setAttribute('placeholder', user ? `已登录：${user}` : '用户名');
}

function renderHomeHint(): void {
  const who = S.account ? `已登录：${S.account.username}` : '未登录（游客）';
  $('home-hint').textContent = `服务器 ${location.host} · ${who}`;
}

/** 登录 / 注册（可选：不登录也能以游客身份游玩） */
async function doAuth(isRegister: boolean): Promise<void> {
  const username = $<HTMLInputElement>('acct-user').value.trim();
  const password = $<HTMLInputElement>('acct-pwd').value;
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    const msg = $('join-msg');
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };
  if (!username || !password) return setMsg('请输入用户名与密码', 'err');
  try {
    if (!net?.connected) await openSocket();
    await request(
      isRegister ? { type: 'register', username, password } : { type: 'login', username, password },
    );
    renderAccountState();
    $<HTMLInputElement>('acct-pwd').value = '';
  } catch (e) {
    setMsg(e instanceof Error ? e.message : '操作失败', 'err');
  }
}

/** 退出登录（仅清除本地凭据） */
function logout(): void {
  S.account = null;
  writeStore(TOKEN_KEY, null);
  writeStore(USER_KEY, null);
  renderAccountState();
  renderHomeHint();
  toast('已退出登录');
}

// -------------------------------------------------------------- 服务器发现与房间列表

/** 把房间列表渲染为可点击按钮（点击后填入房间号） */
function renderRoomList(rooms: RoomSummary[]): void {
  const box = $('scan-result');
  box.replaceChildren();
  const joinable = rooms.filter((r) => r.mode === 'pvp');
  box.hidden = joinable.length === 0;
  for (const r of joinable) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    const state = r.status === 'playing' ? '对局中' : r.players >= 2 ? '已满' : '等待中';
    btn.textContent = `${r.roomId} · ${r.players}/2 · ${state}${r.locked ? ' · 🔒' : ''}`;
    btn.addEventListener('click', () => {
      $<HTMLInputElement>('join-room').value = r.roomId;
      if (r.locked) $<HTMLInputElement>('join-pwd').focus();
      toast(`已选择房间 ${r.roomId}`);
    });
    box.appendChild(btn);
  }
}

/** 刷新房间列表 */
async function refreshRooms(): Promise<void> {
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    const msg = $('join-msg');
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };
  try {
    if (!net?.connected) await openSocket();
    net?.send({ type: 'list_rooms' });
    setMsg('已刷新房间列表', 'ok');
  } catch (e) {
    setMsg(e instanceof Error ? e.message : '无法连接服务器', 'err');
  }
}

/** 局域网服务器发现：扫描同网段并列出可访问的服务器（点击即跳转） */
function renderServerList(servers: DiscoveredServer[]): void {
  const box = $('scan-result');
  box.replaceChildren();
  box.hidden = servers.length === 0;
  for (const s of servers) {
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = `${s.ip}:${s.port}`;
    btn.addEventListener('click', () => {
      window.location.href = `http://${s.ip}:${s.port}/`;
    });
    box.appendChild(btn);
  }
}

/** 从 IP 中取前三段作为 /24 网段前缀；不合法返回 null */
function subnetPrefix(ip: string): string | null {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip.trim());
  return m ? m[1] : null;
}

/** 搜索局域网服务器：先直探当前来源地址，再扫同网段并合并去重 */
async function scanServers(): Promise<void> {
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    const msg = $('join-msg');
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };
  const port = Number(location.port || '7777');
  const prefix = subnetPrefix(location.hostname);
  if (!prefix || !Number.isInteger(port)) {
    return setMsg('请通过服务器地址打开页面后再搜索，或手动输入房间号', 'err');
  }

  const found = new Map<string, DiscoveredServer>();
  const add = (h: DiscoveredServer | null) => {
    if (h) found.set(`${h.ip}:${h.port}`, h);
  };

  setMsg('正在探测当前服务器…');
  add(await probeServer(location.hostname, port, { timeoutMs: 800 }));

  const sweep = await discoverSubnet(prefix, port, {
    onProgress: (done, total) => setMsg(`正在搜索 ${prefix}.0/24 … ${done}/${total}`),
  });
  for (const h of sweep) add(h);

  const servers = [...found.values()];
  renderServerList(servers);
  setMsg(
    servers.length ? `发现 ${servers.length} 台服务器，点击即可切换` : '未发现其它服务器',
    servers.length ? 'ok' : 'err',
  );
}

// -------------------------------------------------------------- 皮肤

/** 读取上次选择的皮肤（localStorage 不可用时回退默认皮肤） */
function loadSkinPreference(): SkinId {
  const saved = readStore(SKIN_KEY);
  return isSkinId(saved) ? saved : DEFAULT_SKIN;
}

/** 更换皮肤：按参考项目顺序循环三套素材，并记住选择 */
function switchSkin(): void {
  if ($('screen-game').classList.contains('active') && S.status === 'playing') {
    return toast('对局中不能更换皮肤');
  }
  S.skin = nextSkin(S.skin);
  writeStore(SKIN_KEY, S.skin);
  applyTheme();
  ensureSkinImages();
  paint();
  review?.redraw(); // 复盘棋盘跟随皮肤
  toast(`已更换皮肤：${SKINS[S.skin].label}`);
}

/**
 * 复制房间号（邀请对手用）。
 * 局域网页面是 http 非安全上下文，navigator.clipboard 多数不可用，
 * 因此降级为「选中文本 + execCommand('copy')」。
 */
async function copyRoomNo(): Promise<void> {
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
  toast('房间号已复制');
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
  $('btn-create').addEventListener('click', showCreateMenu);
  $('btn-create-back').addEventListener('click', backToIndex);
  $('btn-create-start').addEventListener('click', () => void createRoom());
  $('btn-show-join').addEventListener('click', showJoin);
  $('btn-create-ai').addEventListener('click', () => {
    $('menu-index').hidden = true;
    $('menu-create').hidden = true;
    $('menu-ai').hidden = false;
  });
  $('btn-ai-back').addEventListener('click', backToIndex);
  $('btn-ai-start').addEventListener('click', () => void createAiRoom());
  $('btn-skin').addEventListener('click', switchSkin);
  $('btn-history').addEventListener('click', () => void review?.open());
  document.querySelectorAll<HTMLButtonElement>('#side-opts .side_opt').forEach((btn) => {
    btn.addEventListener('click', () => chooseFirst(btn.dataset.mode as FirstMode));
  });
  $('btn-cancel-host').addEventListener('click', () => void cancelHost());
  $('ip-box').addEventListener('click', () => void copyRoomNo());
  $('btn-connect').addEventListener('click', () => void doJoin());
  $('btn-spectate').addEventListener('click', () => void doJoin(true));
  $('btn-rooms').addEventListener('click', () => void refreshRooms());
  $('btn-scan').addEventListener('click', () => void scanServers());
  $('btn-login').addEventListener('click', () => void doAuth(false));
  $('btn-register').addEventListener('click', () => void doAuth(true));
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

  const roomInput = $<HTMLInputElement>('join-room');
  roomInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doJoin();
  });
  const pwdInput = $<HTMLInputElement>('join-pwd');
  pwdInput.addEventListener('keydown', (e) => {
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

  // 账号：恢复上次登录的 token（可选使用）
  const token = readStore(TOKEN_KEY);
  const username = readStore(USER_KEY);
  if (token && username) S.account = { token, username };
  renderAccountState();
  renderHomeHint();

  // 计时读秒（D4）：定时刷新剩余时间显示（未启用计时时几乎零开销）
  window.setInterval(() => {
    if (S.deadline && S.status === 'playing') updatePanel();
  }, 500);

  // 刷新页面后尝试恢复原局（失败静默回首页）
  await tryResumeSession();
}

void init();

// 退出登录入口：长按首页提示区（避免占用宝贵的菜单按钮位）
$('home-hint').addEventListener('dblclick', () => {
  if (S.account) logout();
});
