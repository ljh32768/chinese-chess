/**
 * 渲染层主控制器：页面切换、棋盘交互、消息处理、服务器选择、房间与账号、人机对弈。
 *
 * 客户端不再于启动时绑定服务器：先在「连接服务器」板块选择目标服务器（自动搜索 / 手动输入），
 * 再进入首页创建 / 加入房间；未连接服务器时仍可本机人机对弈（本地 AI）。
 * 客户端只发送「走子意图」，联机对局一切以服务器广播为准。
 */

import { findKing, initBoard, legalMoves } from '../shared/rules.js';
import { ClientMessage, OnlinePlayer, ServerMessage } from '../shared/protocol.js';
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
import { Game } from '../shared/game.js';
import { pickMove } from '../shared/ai.js';
import { CheckmateInfo, classifyCheckmate, classifyCheckmateFromHistory } from '../shared/checkmate.js';
import {
  EndgamePuzzle,
  LEVEL_LABEL,
  PUZZLES,
  buildPuzzleBoard,
  findMateMove,
  nextPuzzle,
} from '../shared/endgame.js';
import { capturedPieces, describeMove } from '../shared/notation.js';
import { DiscoveredServer, discoverSubnet, probeServer } from './discover.js';
import {
  DEFAULT_PORT,
  ServerAddr,
  isDesktopClient,
  pageServer,
  parseAddress,
  serverKey,
  subnetPrefix,
} from './servers.js';
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

/** 本页面的查询参数（桌面客户端由 Electron 入口附加 client / server / lan） */
const pageParams = new URLSearchParams(window.location.search);

/** 本地偏好键（localStorage） */
const SKIN_KEY = 'lanschess-skin';
const TOKEN_KEY = 'lanschess-token';
const USER_KEY = 'lanschess-user';
/** 进行中的房间会话（刷新页面后可自动重连原局） */
const SESSION_KEY = 'lanschess-session';
/** 本机最近一次入座身份（游客 id 只在本机稳定，用于「我的历史」过滤） */
const PLAYER_KEY = 'lanschess-player';
/** 残局挑战通关记录（id → 取胜所用步数） */
const ENDGAME_KEY = 'lanschess-endgame';

/** 残局挑战的进度（本地对弈，不连服务器） */
interface EndgameState {
  puzzle: EndgamePuzzle;
  /** 玩家已用步数 */
  used: number;
  /** 结果：null 进行中；win 已达成目标；fail 超出步数或被将死 */
  result: null | 'win' | 'fail';
  /** 结果原因文案（将死 / 困毙 / 超出步数 / 被将死…） */
  reason: string;
}

/** 棋子汉字（红黑两套用字，用于吃子展示） */
const PIECE_NAME: Record<Side, Record<PieceType, string>> = {
  r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

/** 客户端本地视图状态（仅用于渲染，非权威） */
const S = {
  /** 当前连接的服务器；未选择时为 null */
  server: null as ServerAddr | null,
  /** 通过浏览器访问时锁定服务器地址（与访问地址一致，不可更改） */
  serverLocked: false,
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
  /** 本地人机对弈（不连服务器，规则与 AI 均在本地运行） */
  offline: false,
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
  /** 人机对战（联机 AI 房间或本地 AI） */
  aiMode: false,
  /** 当前皮肤（参考项目三套素材） */
  skin: DEFAULT_SKIN as SkinId,
  /** 鼠标悬停的交叉点（仅用于预高亮） */
  hover: null as Pos | null,
  /** 提示环（残局挑战的「提示」正解首着） */
  hint: null as Move | null,
  /** 残局挑战进度；null 表示当前不是残局模式 */
  endgame: null as EndgameState | null,
  /** 房主在等待页选择的取先（红方）方式；默认「猜先」 */
  firstMode: 'guess' as FirstMode,
  /** 猜先阶段：双方到齐后先进入棋盘界面，再在棋盘上抓子 / 猜单双 */
  guessPhase: null as null | 'grasp' | 'waitGrasp' | 'waitGuess',
  /** 当前账号（可选）：登录后对局记录归属账号，并支持跨设备恢复席位 */
  account: null as { token: string; username: string } | null,
};

let net: Net | null = null;
/** 等待服务端对 create_room / join_room / login / register 的回应 */
let pendingReq: { resolve: () => void; reject: (e: Error) => void } | null = null;

/** 本地人机对弈的权威状态机与 AI 定时器（仅 offline 模式） */
let localGame: Game | null = null;
let localAiTimer = 0;

/** 已加载的皮肤素材（按皮肤缓存） */
const loadedImages: Partial<Record<SkinId, Record<string, HTMLImageElement>>> = {};
const skin = (): (typeof SKINS)[SkinId] => SKINS[S.skin];

const flip = () => S.side === 'b';
const sideName = (s: Side) => (s === 'r' ? '红方' : '黑方');
const resultText = () => (S.winner === 'r' ? '红方胜' : S.winner === 'b' ? '黑方胜' : '和棋');

/**
 * 终局杀法（仅「将死」且识别到具体杀法时返回）。
 * 识别依据终局局面与完整着法，在本地完成——联机、人机、残局、观战结果一致。
 */
function mateInfo(): CheckmateInfo | null {
  if (S.reason !== '将死' || !S.winner) return null;
  // 残局从自定义局面开始，无法从标准开局回放着法（「被吃的棋子」需按终局盘面推导）
  const info = S.endgame
    ? classifyCheckmate(S.board, S.winner === 'r' ? 'b' : 'r', { lastMove: S.lastMove })
    : classifyCheckmateFromHistory(S.board, S.history, S.winner);
  return info?.recognized ? info : null;
}

/** 终局状态文案：识别到杀法时用杀法名替代泛指的「将死」 */
const overText = (mate: CheckmateInfo | null) => `${resultText()} · ${mate ? mate.pattern.label : S.reason}`;

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

function showModal(o: {
  title: string;
  sub?: string;
  buttons: ModalButton[];
  column?: boolean;
  /** 富内容（如玩家列表），置于标题与按钮之间 */
  body?: HTMLElement;
  /** 更宽的弹层（列表类内容） */
  wide?: boolean;
}): void {
  $('modal-title').textContent = o.title;
  $('modal-sub').textContent = o.sub ?? '';
  const body = $('modal-body');
  body.replaceChildren();
  if (o.body) body.appendChild(o.body);
  $('modal-card').classList.toggle('wide', !!o.wide);
  const box = $('modal-btns');
  box.className = 'btns' + (o.column ? ' col' : '');
  box.replaceChildren();
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

/** 当前是否本方可以操作棋盘（观战 / 非本回合 / 断线等待 / 残局已出结果时不可操作） */
function canPlay(): boolean {
  return !S.spectator && S.status === 'playing' && S.turn === S.side && !S.oppAway && !S.endgame?.result;
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
    hint: S.hint,
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
  if (S.endgame) {
    const p = S.endgame.puzzle;
    $('role-hint').textContent =
      `残局「${p.name}」· 你执${S.side === 'r' ? '红' : '黑'} · ${p.goalMoves} 步内取胜`;
    return;
  }
  if (S.offline) {
    $('role-hint').textContent = '人机对战（本地）· 你执红 · AI 执黑';
    return;
  }
  if (S.aiMode) {
    $('role-hint').textContent = `房间 ${S.roomId} · 人机对战 · AI 执黑`;
    return;
  }
  if (S.guessPhase) {
    $('role-hint').textContent = `房间 ${S.roomId} · 猜先`;
    return;
  }
  $('role-hint').textContent = `房间 ${S.roomId} · 你执${S.side === 'r' ? '红' : '黑'}${
    S.isOwner ? ' · 房主' : ''
  }`;
}

/** 猜先阶段的状态文案（未在猜先中返回 null） */
function guessStatusText(): string | null {
  switch (S.guessPhase) {
    case 'grasp':
      return '猜先：请抓单或抓双';
    case 'waitGuess':
      return '猜先：等待对手猜单双…';
    case 'waitGrasp':
      return '猜先：等待房主抓子…';
    default:
      return null;
  }
}

/** 计时读秒剩余时间文案（未启用计时返回空串） */
function remainText(): string {
  if (!S.deadline || S.status !== 'playing') return '';
  const sec = Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000));
  return `（剩余 ${sec}s）`;
}

/** 房间内的「邀请玩家 / 邀请观战」入口：仅联机且在房间内时可用（开局后转为邀请观战） */
function renderInviteButtons(): void {
  const can = !!S.roomId && !S.offline;
  const label = inviteRole() === 'spectator' ? '邀请观战' : '邀请玩家';
  $<HTMLInputElement>('btn-invite').hidden = !can;
  $<HTMLInputElement>('btn-invite').value = label;
  $('btn-invite-host').hidden = !can;
  $('btn-invite-host').textContent = label;
}

function updatePanel(): void {
  updateRoleHint();
  const opp: Side = S.side === 'r' ? 'b' : 'r';
  const rowTop = $('p-top');
  const rowBottom = $('p-bottom');
  rowTop.className = 'player-row ' + (opp === 'r' ? 'red' : 'black');
  rowBottom.className = 'player-row ' + (S.side === 'r' ? 'red' : 'black');
  // 观战者视角显示红黑双方，不出现「你 / 对手」
  const oppLabel = S.oppName && S.oppName !== '对手' ? S.oppName : '对手';
  $('p-top-name').textContent = S.spectator ? sideName(opp) : `${sideName(opp)} · ${oppLabel}`;
  $('p-bottom-name').textContent = S.spectator ? sideName(S.side) : `${sideName(S.side)} · 你`;

  const active = S.status === 'playing';
  // 残局挑战：出结果（成功 / 失败）后按终局处理（操作切换为「再来一局 / 返回首页」）
  const eg = S.endgame;
  const over = S.status === 'over' || !!eg?.result;
  // 操作组：观战者隐藏对局操作（只读），残局用独立操作行，对局中与结束态互斥切换
  $('actions-play').hidden = over || S.spectator || !!eg;
  $('actions-endgame').hidden = !eg || over;
  $('actions-over').hidden = !over || S.spectator;
  $('actions-spectate').hidden = !S.spectator;
  rowTop.classList.toggle('active', active && S.turn === opp);
  rowBottom.classList.toggle('active', active && S.turn === S.side);
  $('p-top-tag').textContent = active && S.turn === opp ? '走棋中' : '';
  $('p-bottom-tag').textContent = active && S.turn === S.side ? '走棋中' : '';

  const st = $('status-box');
  // 「轮到你走棋」用浅金实底强调（styles.css .status-box.mine）；将军 / 终局态各自覆盖
  st.classList.toggle('mine', active && !S.check && !S.spectator && S.turn === S.side);
  st.classList.toggle('check', active && S.check);
  st.classList.toggle('over', over);
  st.classList.toggle(
    'win-red',
    (S.status === 'over' && S.winner === 'r') || (eg?.result === 'win' && eg.puzzle.side === 'r'),
  );
  st.classList.toggle(
    'win-black',
    (S.status === 'over' && S.winner === 'b') || (eg?.result === 'win' && eg.puzzle.side === 'b'),
  );
  st.classList.toggle('draw', S.status === 'over' && S.winner === null);
  st.classList.toggle('lose', eg?.result === 'fail');
  let statusText: string;
  const mate = S.status === 'over' ? mateInfo() : null;
  if (eg?.result === 'win') {
    // 达成目标：显示识别出的杀法名（无杀法名时退回「将死 / 困毙」）
    statusText = `挑战成功 · ${mate ? mate.pattern.label : S.reason}`;
  } else if (eg?.result === 'fail') {
    statusText = `挑战失败 · ${eg.reason}`;
  } else if (S.status === 'over') {
    statusText = overText(mate);
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
      : eg
        ? S.turn === S.side
          ? `轮到你走棋（第 ${eg.used + 1} / ${eg.puzzle.goalMoves} 步）`
          : `对手思考中…（已用 ${eg.used} / ${eg.puzzle.goalMoves} 步）`
        : S.turn === S.side
          ? '轮到你走棋'
          : '对方思考中…';
  } else {
    statusText = S.spectator ? '等待对局开始' : (guessStatusText() ?? '准备开始');
  }
  st.textContent = active ? `${statusText}${remainText()}` : statusText;

  // 残局目标：名称 / 难度 / 目标步数 / 已用步数 + 一句要点
  const egBox = $('eg-box');
  egBox.hidden = !eg;
  if (eg) {
    $('eg-info').innerHTML =
      `<div>残局：${eg.puzzle.name} · ${LEVEL_LABEL[eg.puzzle.level]}</div>` +
      `<div>目标：${eg.puzzle.goalMoves} 步内取胜</div>` +
      `<div>已用：${eg.used} / ${eg.puzzle.goalMoves} 步</div>` +
      `<div class="eg-intro">${eg.puzzle.intro}</div>`;
  }

  // 终局杀法：将死时展示识别出的具体杀法名与解说（识别不到经典杀法时保持隐藏）
  const killBox = $('kill-box');
  killBox.hidden = !mate;
  if (mate) {
    killBox.classList.toggle('win-red', S.winner === 'r');
    killBox.classList.toggle('win-black', S.winner === 'b');
    $('kill-name').textContent = mate.pattern.label;
    $('kill-def').textContent = mate.pattern.definition;
    $('kill-also').textContent = mate.alsoMatched.length ? `同时构成：${mate.alsoMatched.join('、')}` : '';
  }

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

  renderInviteButtons();
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
  if ($('screen-game').classList.contains('active')) render();
}

function enterGame(): void {
  show('screen-game');
  render();
}

/** 等待页：展示房间号 / 口令状态 / 取先方式 */
function showWaiting(): void {
  $('host-ip').textContent = S.roomId || '—';
  $('room-pass-hint').textContent = S.locked
    ? '本房间已设置口令，加入者需输入口令'
    : '未设口令，任何人点击即可加入';
  $('host-wait').textContent = S.aiMode ? '正在开始人机对战…' : '让对方在「加入房间」中选择本房间';
  renderSidePick();
  renderInviteButtons();
  show('screen-host');
}

const FIRST_HINT: Record<FirstMode, string> = {
  r: '先手（红方）：房主执红先行',
  b: '先手（红方）：房主执黑，对手执红先行',
  random: '先手（红方）：开局时随机分配红黑',
  guess: '先手（红方）：房主抓单双、对手猜，猜中者执红；对手加入后双方直接进入棋盘再猜',
};

/** 等待页：渲染取先方式下拉框（默认「猜先」）与说明 */
function renderSidePick(): void {
  $<HTMLSelectElement>('first-mode').value = S.firstMode;
  $('side-hint').textContent = FIRST_HINT[S.firstMode];
}

/** 等待页：选择取先方式（仅等待阶段有效，开赛后服务端会拒绝） */
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
      renderAccountPanel();
      updateHomeChips();
      toast(`已登录：${msg.username}`);
      settlePending(true);
      return;
    case 'room_list':
      renderRoomList(msg.rooms);
      return;
    case 'player_list':
      renderPlayerList(msg.players);
      return;
    case 'invite':
      showInviteModal(msg);
      return;
    case 'room_closed': {
      // 房间已被销毁（终局超时 / 空闲回收 / 房主解散 / 服务器停止）；连接本身保留
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
              backToIndex();
              show('screen-home');
            },
          },
        ],
      });
      return;
    }
    case 'start':
      closeModal(); // 猜先弹层（若在等待应答时开局）
      S.guessPhase = null;
      if (msg.side !== null) S.side = msg.side;
      applySnapshot(msg.state);
      enterGame();
      toast('对局开始，红方先行');
      return;
    case 'grasp_request':
      // 猜先第一步：房主自己抓单 / 抓双（双方已在对局界面，弹层盖在棋盘上）
      S.guessPhase = 'grasp';
      enterGame();
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
      // 猜先第二步：对手弹层应答，房主在对局界面看进度
      enterGame();
      if (S.isOwner) {
        S.guessPhase = 'waitGuess';
        updatePanel();
      } else {
        S.guessPhase = null;
        updatePanel();
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
      S.guessPhase = null;
      updatePanel();
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
        S.guessPhase = null;
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
      } else if (S.firstMode === 'guess') {
        // 猜先：有人加入后直接进入棋盘界面，再在棋盘上抓子 / 猜单双
        enterGame();
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
  renderServers();
}

// ------------------------------------------------------- 连接与房间会话

/** 建立到目标服务器的 WebSocket 连接（默认连当前选中的服务器） */
async function openSocket(addr: ServerAddr | null = S.server): Promise<Net> {
  if (!addr) throw new Error('尚未选择服务器');
  net?.close();
  const n = new Net({ onMessage: handleMessage, onClosed: handleClosed });
  net = n;
  await n.connect(`ws://${addr.host}:${addr.port}/ws`);
  return n;
}

/** 确保已有到服务器的连接（有服务器地址时会尝试重连） */
async function ensureSocket(): Promise<boolean> {
  if (net?.connected) return true;
  if (!S.server) return false;
  try {
    await openSocket();
    return true;
  } catch {
    return false;
  }
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

/** 记住本机最近一次入座身份（对局回顾的「我的历史」用；游客 id 仅在本机稳定） */
function storePlayer(): void {
  if (S.spectator || !S.playerId) return;
  writeStore(PLAYER_KEY, JSON.stringify({ id: S.playerId, name: S.name }));
}

/** 读取本机最近一次入座身份 */
function readPlayer(): { id: string; name: string } | null {
  const raw = readStore(PLAYER_KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { id?: unknown; name?: unknown };
    if (typeof data.id === 'string' && typeof data.name === 'string') {
      return { id: data.id, name: data.name };
    }
  } catch {
    /* 忽略损坏的本地数据 */
  }
  return null;
}

/** 「我的历史」过滤用的玩家 id：登录后按账号（跨设备稳定），否则用本机最近一次入座身份 */
function myPlayerId(): string {
  if (S.account) return `account:${S.account.username}`;
  return readPlayer()?.id ?? '';
}

/** 「我的历史」显示的身份文案 */
function myPlayerLabel(): string {
  if (S.account) return `账号 ${S.account.username}`;
  const last = readPlayer();
  return last ? last.name : '未识别';
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
  S.offline = false;
  S.aiMode = false;
  S.guessPhase = null;
  storeSession();
  storePlayer();

  applySnapshot(msg.state);
  if (S.spectator) {
    enterGame();
    toast('已进入观战（只读）');
  } else if (msg.state.status === 'playing') {
    enterGame();
    toast('已恢复对局');
  } else if (S.firstMode === 'guess' && !S.isOwner) {
    // 猜先：有人加入后直接进入棋盘界面，再在棋盘上抓子 / 猜单双
    S.guessPhase = 'waitGrasp';
    enterGame();
  } else {
    showWaiting();
  }
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
  S.offline = false;
  S.status = 'idle';
  S.selected = null;
  S.moves = [];
  S.aiMode = false;
  S.deadline = null;
  S.hover = null;
  S.oppName = '';
  S.oppAway = false;
  S.pending = null;
  S.guessPhase = null;
  S.hint = null;
  S.endgame = null;
  localGame = null;
  window.clearTimeout(localAiTimer);
  localAiTimer = 0;
}

/** 离开房间回到首页（保留与服务器的连接，便于继续浏览房间列表） */
function leaveToHome(): void {
  if (S.roomId && !S.offline) net?.send({ type: 'leave_room' });
  clearSession();
  closeModal();
  resetLocal();
  backToIndex();
  show('screen-home');
}

// --------------------------------------------------- 服务器选择（连接服务器）

/** 服务器列表条目：failed 表示最近一次连接尝试失败 */
interface ServerEntry {
  addr: ServerAddr;
  failed: boolean;
}

const serverEntries = new Map<string, ServerEntry>();

/** 把地址加入列表（已存在则返回原条目） */
function upsertServer(addr: ServerAddr): ServerEntry {
  const key = serverKey(addr);
  const existed = serverEntries.get(key);
  if (existed) return existed;
  const entry: ServerEntry = { addr, failed: false };
  serverEntries.set(key, entry);
  return entry;
}

/**
 * 连接成功后以服务器自述地址为准改键：避免同一台服务器因「输入地址」与「自述地址」不同
 * 而在列表里出现两行（自述地址已存在时直接丢弃重复条目）。
 */
function rekeyServer(from: ServerAddr, to: ServerAddr): void {
  if (serverKey(from) === serverKey(to)) return;
  const moved = serverEntries.get(serverKey(from));
  if (!moved) return;
  serverEntries.delete(serverKey(from));
  if (serverEntries.has(serverKey(to))) return;
  moved.addr = to;
  serverEntries.set(serverKey(to), moved);
}

/** 该地址是否为当前已连上的服务器 */
function isConnectedTo(addr: ServerAddr): boolean {
  return !!S.server && serverKey(S.server) === serverKey(addr) && !!net?.connected;
}

function setServerMsg(text: string, kind?: 'ok' | 'err'): void {
  const el = $('server-msg');
  el.textContent = text;
  el.className = 'hint' + (kind ? ` ${kind}` : '');
}

/** 渲染服务器列表：绿=已连接 / 红=连接失败 / 灰=未连接（另加「锁定」态） */
function renderServers(): void {
  const list = $('server-list');
  list.replaceChildren();
  $('server-panel').classList.toggle('locked', S.serverLocked);
  const locked = S.serverLocked;
  $<HTMLInputElement>('server-addr').disabled = locked;
  $<HTMLButtonElement>('btn-server-connect').disabled = locked;
  $<HTMLButtonElement>('btn-server-scan').disabled = locked;
  $<HTMLButtonElement>('btn-server-list').disabled = locked;

  const entries = [...serverEntries.values()].sort(
    (a, b) => Number(isConnectedTo(b.addr)) - Number(isConnectedTo(a.addr)),
  );
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'room-empty';
    empty.textContent = '暂无服务器，请搜索局域网或手动输入地址';
    list.appendChild(empty);
  }
  for (const entry of entries) {
    const connected = isConnectedTo(entry.addr);
    const row = document.createElement('div');
    row.className = 'server-row ' + (connected ? 'ok' : entry.failed ? 'fail' : '');
    if (locked) row.classList.add('locked');
    const dot = document.createElement('span');
    dot.className = 'dot-status';
    const addr = document.createElement('span');
    addr.className = 'addr';
    addr.textContent = `${entry.addr.host}:${entry.addr.port}`;
    const tag = document.createElement('span');
    tag.className = 'tag-line';
    tag.textContent = connected ? '已连接' : entry.failed ? '连接失败' : '未连接';
    row.append(dot, addr, tag);
    if (!connected) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = '连接';
      btn.disabled = locked;
      btn.addEventListener('click', () => void connectServer(entry.addr));
      row.appendChild(btn);
    }
    list.appendChild(row);
  }
  $('btn-server-enter').textContent = net?.connected ? '进入游戏' : '进入（本机对弈）';
}

/** 连接指定服务器：探测成功则切换 WebSocket 目标并标记为已连接 */
async function connectServer(addr: ServerAddr, silent = false): Promise<boolean> {
  const entry = upsertServer(addr);
  if (S.roomId) {
    setServerMsg('请先离开当前房间再切换服务器', 'err');
    return false;
  }
  entry.failed = false;
  renderServers();
  if (!silent) setServerMsg(`正在连接 ${addr.host}:${addr.port} …`);

  let hit: DiscoveredServer | null;
  try {
    hit = await probeServer(addr.host, addr.port, { timeoutMs: 1500 });
  } catch {
    hit = null;
  }
  if (!hit) {
    entry.failed = true;
    renderServers();
    if (!silent) setServerMsg(`无法连接 ${addr.host}:${addr.port}`, 'err');
    return false;
  }
  const target: ServerAddr = { host: hit.ip, port: hit.port };
  rekeyServer(addr, target);
  try {
    await openSocket(target);
  } catch {
    upsertServer(target).failed = true;
    renderServers();
    if (!silent) setServerMsg(`无法连接 ${target.host}:${target.port}`, 'err');
    return false;
  }
  S.server = target;
  renderServers();
  updateHomeChips();
  if (!silent) setServerMsg(`已连接 ${target.host}:${target.port}`, 'ok');
  return true;
}

/** 浏览器打开时锁定为访问地址（不可更改） */
async function connectLockedServer(): Promise<void> {
  const addr = S.server;
  if (!addr) return;
  try {
    await openSocket(addr);
    setServerMsg('浏览器访问：服务器地址与访问地址一致，已锁定', 'ok');
  } catch {
    setServerMsg('无法连接本页面所在服务器（浏览器访问时地址已锁定）', 'err');
  }
  renderServers();
  updateHomeChips();
}

/** 可扫描的 /24 网段前缀（来自启动参数的本机地址与已选服务器地址） */
function scanPrefixes(): string[] {
  const out = new Set<string>();
  const add = (ip: string | null | undefined) => {
    const prefix = subnetPrefix(ip ?? '');
    if (prefix) out.add(prefix);
  };
  add(pageParams.get('lan'));
  add(S.server?.host);
  return [...out];
}

/** 自动搜索同网段服务器：命中即加入列表（灰色，点击「连接」后变绿） */
async function scanServers(): Promise<void> {
  if (S.serverLocked) return;
  const prefixes = scanPrefixes();
  if (prefixes.length === 0) {
    setServerMsg('无法推导网段，请手动输入服务器地址', 'err');
    return;
  }
  const port = S.server?.port ?? DEFAULT_PORT;
  for (const prefix of prefixes) {
    setServerMsg(`正在搜索 ${prefix}.0/24 …`);
    const found = await discoverSubnet(prefix, port, {
      onProgress: (done, total) => setServerMsg(`正在搜索 ${prefix}.0/24 … ${done}/${total}`),
    });
    for (const h of found) upsertServer({ host: h.ip, port: h.port });
    renderServers();
  }
  setServerMsg(
    serverEntries.size > 1
      ? '已发现可连接的服务器，点击「连接」即可加入'
      : '未发现其它服务器，可手动输入地址',
    serverEntries.size > 1 ? 'ok' : 'err',
  );
}

/** 进入连接服务器板块：桌面客户端自动尝试启动参数地址并搜索局域网 */
let autoScanned = false;
async function openServersScreen(): Promise<void> {
  renderServers();
  show('screen-servers');
  if (S.serverLocked || autoScanned) return;
  autoScanned = true;
  const prefill = S.server ?? { host: '127.0.0.1', port: DEFAULT_PORT };
  upsertServer(prefill);
  renderServers();
  await connectServer(prefill, true);
  await scanServers();
}

/** 「进入游戏」：尽力连接，失败也允许进入首页（本机人机对弈仍可用） */
async function enterFromServerScreen(): Promise<void> {
  if (S.server && !net?.connected) await connectServer(S.server, true);
  backToIndex();
  show('screen-home');
  updateHomeChips();
  if (net?.connected) await tryResumeSession();
}

/** 刷新列表：重试当前服务器并重绘 */
async function refreshServerList(): Promise<void> {
  if (S.serverLocked) return renderServers();
  if (S.server && !net?.connected) await connectServer(S.server, true);
  renderServers();
  setServerMsg('列表已刷新');
}

/** 需要服务器才能进行的操作：未连接时提示并引导到连接服务器板块 */
function requireServer(): boolean {
  if (net?.connected) return true;
  if (S.server) {
    toast('服务器未连接，请先在「连接服务器」中连接');
  } else {
    toast('请先连接服务器');
  }
  void openServersScreen();
  return false;
}

/** 从服务器地址生成 REST 接口基址（桌面客户端的页面来自本机外壳服务，必须显式指向服务器） */
function apiBase(): string {
  return S.server ? `http://${S.server.host}:${S.server.port}` : '';
}

// -------------------------------------------------------------- 首页入口

/** 默认取先方式：猜先（双方进入棋盘后再抓子 / 猜单双） */
const FIRST_MODE_DEFAULT: FirstMode = 'guess';

/** 首页板块：木质挂板（入口）与大面板互斥显示 */
type HomePanel = 'index' | 'create' | 'ai' | 'endgame' | 'acct';

function showHomePanel(panel: HomePanel): void {
  $('menu-board').hidden = panel !== 'index';
  $('menu-index').hidden = panel !== 'index';
  $('menu-create').hidden = panel !== 'create';
  $('menu-ai').hidden = panel !== 'ai';
  $('menu-endgame').hidden = panel !== 'endgame';
  $('menu-acct').hidden = panel !== 'acct';
}

function backToIndex(): void {
  showHomePanel('index');
}

/** 创建双人对战房间（口令可选，留空即任何人可加入） */
async function createRoom(): Promise<void> {
  if (!requireServer()) return;
  const password = $<HTMLInputElement>('create-pass').value.trim();
  // 服务端房间的缺省取先方式是「房主执红」，客户端缺省是「猜先」：
  // 建房成功后立即把本端默认同步给服务器，并回写本端状态（否则会被 room_joined 覆盖成服务端缺省值）
  const firstMode = FIRST_MODE_DEFAULT;
  try {
    await ensureSocket();
    S.aiMode = false;
    S.offline = false;
    S.guessPhase = null;
    await request({ type: 'create_room', mode: 'pvp', password: password || null, token: S.account?.token });
    S.firstMode = firstMode;
    renderSidePick();
    net?.send({ type: 'choose_first', mode: firstMode });
    backToIndex();
  } catch (e) {
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

/** 人机对弈（本地）：不依赖服务器，AI 执黑，规则与搜索都在本机运行 */
function createAiRoom(): void {
  net?.close();
  net = null;
  window.clearTimeout(localAiTimer);
  S.offline = true;
  S.aiMode = true;
  S.spectator = false;
  S.role = 'player';
  S.roomId = '';
  S.playerId = '';
  S.name = '你';
  S.isOwner = false;
  S.locked = false;
  S.firstMode = 'r';
  S.side = 'r';
  S.oppName = 'AI';
  localGame = new Game();
  localGame.reset('playing');
  clearSession();
  applySnapshot(localGame.snapshot());
  backToIndex();
  enterGame();
  toast('开始人机对弈（本地，无需服务器）');
  scheduleLocalAi();
}

/** 本地走子（offline / 残局模式）：直接走本地状态机，AI 随后应答 */
function localMove(from: Pos, to: Pos): void {
  const game = localGame;
  if (!game) return;
  const result = game.applyMove(from, to, S.side);
  if (!result.ok) {
    toast(result.reason ?? '非法走子');
    return;
  }
  playClick();
  S.hint = null; // 走子后清除提示环
  applySnapshot(game.snapshot());
  if (S.endgame) {
    endgameEvaluate();
    return;
  }
  scheduleLocalAi();
}

/** AI 执子方：人机对弈固定黑方；残局挑战执玩家的对方 */
function localAiSide(): Side {
  return S.endgame ? (S.endgame.puzzle.side === 'r' ? 'b' : 'r') : 'b';
}

/** 本地 AI 自动应答（人机对弈黑方 / 残局挑战的防守方） */
function scheduleLocalAi(): void {
  window.clearTimeout(localAiTimer);
  localAiTimer = 0;
  const game = localGame;
  const aiSide = localAiSide();
  if (!game || game.status !== 'playing' || game.turn !== aiSide || S.endgame?.result) return;
  localAiTimer = window.setTimeout(() => {
    localAiTimer = 0;
    const g = localGame;
    if (!g || g.status !== 'playing' || g.turn !== aiSide || S.endgame?.result) return;
    const move = pickMove(g.board, aiSide, {
      depth: S.endgame ? ENDGAME_AI_DEPTH : aiDepth(),
      timeLimitMs: S.endgame ? 900 : 1200,
    });
    if (!move) return;
    g.applyMove(move.from, move.to, aiSide);
    playClick();
    S.hint = null; // 走子后清除提示环
    applySnapshot(g.snapshot());
    if (S.endgame) endgameEvaluate();
  }, 350);
}

// -------------------------------------------------------------- 残局挑战

/** 残局防守 AI 的搜索深度（高手水平，尽量逼出玩家的正解） */
const ENDGAME_AI_DEPTH = 4;

/** 读取残局通关记录（id → 最好成绩步数） */
function readEndgameRecord(): Record<string, number> {
  const raw = readStore(ENDGAME_KEY);
  if (!raw) return {};
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [id, v] of Object.entries(data)) {
      if (typeof v === 'number' && v > 0) out[id] = v;
    }
    return out;
  } catch {
    return {}; // 损坏的本地数据按「未通关」处理
  }
}

/** 记录通关（保留最好成绩） */
function recordEndgameClear(id: string, used: number): void {
  const rec = readEndgameRecord();
  if (!rec[id] || used < rec[id]) rec[id] = used;
  writeStore(ENDGAME_KEY, JSON.stringify(rec));
}

/** 打开「残局挑战」面板（题库列表） */
function openEndgamePanel(): void {
  renderEndgameList();
  showHomePanel('endgame');
}

/** 渲染题库列表：名称 + 难度 + 目标步数 + 通关标记（点击即开局） */
function renderEndgameList(): void {
  const box = $('endgame-list');
  box.replaceChildren();
  const done = readEndgameRecord();
  for (const p of PUZZLES) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'eg-row';
    const name = document.createElement('span');
    name.className = 'eg-name';
    name.textContent = p.name;
    const level = document.createElement('span');
    level.className = 'eg-level' + (p.level === 'hard' ? ' hard' : '');
    level.textContent = LEVEL_LABEL[p.level];
    const goal = document.createElement('span');
    goal.className = 'eg-goal';
    goal.textContent = `${p.goalMoves} 步内取胜`;
    row.append(name, level, goal);
    if (done[p.id]) {
      const tag = document.createElement('span');
      tag.className = 'eg-done';
      tag.textContent = `已通关 · ${done[p.id]} 步`;
      row.appendChild(tag);
    }
    row.addEventListener('click', () => startPuzzle(p));
    box.appendChild(row);
  }
}

/** 开始（或重开）一局残局：本地对弈，不依赖服务器 */
function startPuzzle(p: EndgamePuzzle): void {
  net?.close();
  net = null;
  window.clearTimeout(localAiTimer);
  localAiTimer = 0;
  S.offline = true;
  S.aiMode = false;
  S.spectator = false;
  S.role = 'player';
  S.roomId = '';
  S.playerId = '';
  S.name = '你';
  S.isOwner = false;
  S.locked = false;
  S.firstMode = 'r';
  S.side = p.side;
  S.oppName = 'AI';
  S.hint = null;
  S.endgame = { puzzle: p, used: 0, result: null, reason: '' };
  localGame = new Game();
  localGame.setup(buildPuzzleBoard(p), p.side);
  clearSession();
  applySnapshot(localGame.snapshot());
  backToIndex();
  enterGame();
  toast(`残局「${p.name}」：${p.goalMoves} 步内取胜`);
  scheduleLocalAi();
}

/** 把当前残局恢复到初始局面 */
function restartPuzzle(): void {
  const eg = S.endgame;
  if (!eg) return;
  window.clearTimeout(localAiTimer);
  localAiTimer = 0;
  S.hint = null;
  eg.used = 0;
  eg.result = null;
  eg.reason = '';
  localGame = new Game();
  localGame.setup(buildPuzzleBoard(eg.puzzle), eg.puzzle.side);
  applySnapshot(localGame.snapshot());
  render();
  toast('已重来');
  scheduleLocalAi();
}

/** 残局悔棋：连同 AI 的应着一起回退，已用步数随之回退 */
function endgameUndo(): void {
  const eg = S.endgame;
  const game = localGame;
  if (!eg || !game) return;
  if (game.history.length === 0) return toast('当前没有可悔的棋');
  window.clearTimeout(localAiTimer);
  localAiTimer = 0;
  game.undo();
  if (game.turn !== eg.puzzle.side && game.history.length > 0) game.undo();
  S.hint = null;
  eg.used = game.history.filter((_, i) => i % 2 === 0).length;
  applySnapshot(game.snapshot());
  toast('已悔棋');
}

/** 残局提示：给出仍能在剩余步数内取胜的正解首着（已走离杀棋时提示重来） */
function endgameHint(): void {
  const eg = S.endgame;
  if (!eg || S.status !== 'playing' || eg.result) return;
  const mv = findMateMove(S.board, S.side, eg.puzzle.goalMoves - eg.used);
  if (!mv) {
    toast('当前局面已无法在剩余步数内取胜，建议「重来」');
    return;
  }
  S.hint = mv;
  paint();
  toast(`提示：${describeMove(S.board, mv.from, mv.to)}`);
}

/** 残局：每步之后判定目标（我方取胜 = 成功；被将死 / 超出步数 = 失败） */
function endgameEvaluate(): void {
  const eg = S.endgame;
  if (!eg || eg.result) return;
  // 已用步数 = 玩家自己的着法数（玩家先行，隔一步一手）
  eg.used = S.history.filter((_, i) => i % 2 === 0).length;
  if (S.status === 'over') {
    const won = S.winner === eg.puzzle.side;
    eg.result = won ? 'win' : 'fail';
    eg.reason = won ? S.reason : `被${S.reason}`;
    if (won) recordEndgameClear(eg.puzzle.id, eg.used);
  } else if (eg.used >= eg.puzzle.goalMoves) {
    eg.result = 'fail';
    eg.reason = '超出步数';
  } else {
    // 仍在进行中（未超出目标步数）：渲染后交给 AI 应招
    render();
    scheduleLocalAi();
    return;
  }
  render();
  showEndgameResult();
}

/** 残局结果弹层：成功可「下一关」，失败可「重来」 */
function showEndgameResult(): void {
  const eg = S.endgame;
  if (!eg) return;
  const won = eg.result === 'win';
  const next = won ? nextPuzzle(eg.puzzle.id) : null;
  showModal({
    title: won ? '挑战成功' : '挑战失败',
    sub: `「${eg.puzzle.name}」${won ? `${eg.reason} · 用时 ${eg.used} 步` : eg.reason}`,
    buttons: [
      ...(next ? [{ label: `下一关：${next.name}`, primary: true, onClick: () => startPuzzle(next) }] : []),
      { label: won ? '再来一次' : '重　来', primary: !next, onClick: restartPuzzle },
      { label: '返回首页', onClick: leaveToHome },
    ],
  });
}

// -------------------------------------------------------------- 账号（可选）

/** 首页右上角账号区：未登录显示入口，登录后显示用户名 */
function updateHomeChips(): void {
  const chip = $('acct-chip');
  chip.textContent = S.account ? S.account.username : '登录 / 注册';
  chip.classList.toggle('on', !!S.account);
  $('server-chip').textContent = S.server ? `服务器：${S.server.host}:${S.server.port}` : '服务器：未连接';
}

/** 打开账号面板（登录 / 注册 / 退出登录） */
function openAccountPanel(): void {
  showHomePanel('acct');
  renderAccountPanel();
}

function renderAccountPanel(): void {
  const msg = $('acct-msg');
  msg.className = 'hint';
  msg.textContent = S.account ? `已登录：${S.account.username}` : '未登录将以游客身份游玩';
  $<HTMLButtonElement>('btn-logout').hidden = !S.account;
  $<HTMLInputElement>('acct-user').value = S.account?.username ?? '';
}

/** 登录 / 注册（可选：不登录也能以游客身份游玩） */
async function doAuth(isRegister: boolean): Promise<void> {
  const username = $<HTMLInputElement>('acct-user').value.trim();
  const password = $<HTMLInputElement>('acct-pwd').value;
  const setMsg = (t: string, kind?: 'ok' | 'err') => {
    const msg = $('acct-msg');
    msg.textContent = t;
    msg.className = 'hint' + (kind ? ` ${kind}` : '');
  };
  if (!username || !password) return setMsg('请输入用户名与密码', 'err');
  if (!S.server) {
    setMsg('请先连接服务器', 'err');
    void openServersScreen();
    return;
  }
  try {
    if (!(await ensureSocket())) return setMsg('无法连接服务器', 'err');
    await request(
      isRegister ? { type: 'register', username, password } : { type: 'login', username, password },
    );
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
  renderAccountPanel();
  updateHomeChips();
  toast('已退出登录');
}

// -------------------------------------------------- 加入房间与房间列表

function setJoinMsg(t: string, kind?: 'ok' | 'err'): void {
  const msg = $('join-msg');
  msg.textContent = t;
  msg.className = 'hint' + (kind ? ` ${kind}` : '');
}

/** 口令输入行：仅在选中上锁房间时出现 */
function setPwdVisible(visible: boolean): void {
  $('join-pwd-label').hidden = !visible;
  $<HTMLInputElement>('join-pwd').hidden = !visible;
  if (!visible) $<HTMLInputElement>('join-pwd').value = '';
}

/** 打开「加入房间」：先确认已连接服务器，再拉取房间列表 */
function showJoin(): void {
  setJoinMsg('');
  setPwdVisible(false);
  $('room-list').replaceChildren();
  show('screen-join');
  if (!net?.connected) {
    setJoinMsg(S.server ? '服务器未连接，正在尝试连接…' : '尚未连接服务器，请先连接', 'err');
    if (!S.server) {
      renderRoomListPrompt();
      return;
    }
  }
  void refreshRooms();
}

/** 未连接服务器时在列表区给出「去连接服务器」引导 */
function renderRoomListPrompt(): void {
  const box = $('room-list');
  box.replaceChildren();
  const tip = document.createElement('div');
  tip.className = 'room-empty';
  tip.textContent = '连接服务器后才能查看可加入的房间';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  btn.textContent = '去连接服务器';
  btn.addEventListener('click', () => void openServersScreen());
  box.append(tip, btn);
}

/** 拉取房间列表（服务端返回 room_list 后渲染） */
async function refreshRooms(): Promise<void> {
  if (!(await ensureSocket())) {
    setJoinMsg('尚未连接服务器，请先连接', 'err');
    renderRoomListPrompt();
    return;
  }
  net?.send({ type: 'list_rooms' });
}

/** 渲染房间列表：点击房间行即加入（上锁房间需先填口令），「观战」无需口令 */
function renderRoomList(rooms: RoomSummary[]): void {
  const box = $('room-list');
  box.replaceChildren();
  const joinable = rooms.filter((r) => r.mode === 'pvp');
  if (joinable.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'room-empty';
    empty.textContent = '当前没有房间，点「创建房间」开一局吧';
    box.appendChild(empty);
    setJoinMsg('房间列表已刷新', 'ok');
    return;
  }
  for (const r of joinable) {
    const row = document.createElement('div');
    row.className = 'room-row';
    row.title = `房主 ${r.ownerName}`;
    const no = document.createElement('span');
    no.className = 'room-no';
    no.textContent = r.roomId;
    const info = document.createElement('span');
    info.className = 'room-info';
    const state = r.status === 'playing' ? '对局中' : r.players >= 2 ? '已满' : '等待中';
    info.textContent = `${r.ownerName} · ${r.players}/2 · ${state}${r.locked ? ' · 需口令' : ''}`;
    const joinBtn = document.createElement('button');
    joinBtn.type = 'button';
    joinBtn.className = 'btn small';
    joinBtn.textContent = '加入';
    joinBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pickRoom(r);
    });
    const specBtn = document.createElement('button');
    specBtn.type = 'button';
    specBtn.className = 'btn small';
    specBtn.textContent = '观战';
    specBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      void joinRoom(r.roomId, 'spectator');
    });
    row.append(no, info, joinBtn, specBtn);
    row.addEventListener('click', () => pickRoom(r));
    box.appendChild(row);
  }
  setJoinMsg(`共 ${joinable.length} 个房间，点击即可加入`, 'ok');
}

/** 选中某房间：无口令直接加入，有口令则先要求输入 */
function pickRoom(r: RoomSummary): void {
  $<HTMLInputElement>('join-room').value = r.roomId;
  if (r.locked) {
    setPwdVisible(true);
    $<HTMLInputElement>('join-pwd').focus();
    setJoinMsg('该房间已设置口令，请输入口令后点击「加入房间」', 'err');
  } else {
    setPwdVisible(false);
    void joinRoom(r.roomId, 'player');
  }
}

/** 加入房间（role='spectator' 时无需口令，只读旁观） */
async function joinRoom(roomId: string, role: 'player' | 'spectator'): Promise<void> {
  if (!/^\d{4,8}$/.test(roomId)) return setJoinMsg('请输入 4-8 位数字房间号', 'err');
  if (!(await ensureSocket())) return setJoinMsg('尚未连接服务器，请先连接', 'err');
  const pwd = $<HTMLInputElement>('join-pwd').value;
  setJoinMsg(`正在加入房间 ${roomId} …`);
  S.aiMode = false;
  S.offline = false;
  try {
    const session = readSession();
    const playerId = session && session.roomId === roomId ? session.playerId : undefined;
    await request({
      type: 'join_room',
      roomId,
      role,
      playerId,
      password: pwd || undefined,
      token: S.account?.token,
    });
    setJoinMsg(role === 'spectator' ? '已进入观战（只读）' : '加入成功', 'ok');
  } catch (e) {
    setJoinMsg(e instanceof Error ? e.message : '加入失败', 'err');
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
    if (!(await ensureSocket())) return false;
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
    clearSession();
    return false;
  }
}

// ------------------------------------------------------- 邀请玩家 / 观战

/** 邀请角色：等待阶段只邀请「加入对局」；对局开始后才提供「邀请观战」 */
function inviteRole(): 'player' | 'spectator' {
  return S.status === 'playing' || S.status === 'over' ? 'spectator' : 'player';
}

/** 打开邀请面板：拉取服务器玩家列表（自己 / 本房间内的玩家除外） */
async function openInvite(): Promise<void> {
  if (!S.roomId) return toast('请先加入房间');
  if (S.offline) return toast('本地对弈没有可邀请的玩家');
  if (!(await ensureSocket())) return toast('尚未连接服务器');
  net?.send({ type: 'list_players' });
  toast('正在获取玩家列表…');
}

/**
 * 渲染玩家列表（大面板风格）：
 * 在线且在大厅的玩家排在最前并可一键邀请；在别处对局中与离线的玩家置灰、不显示邀请按钮。
 */
function renderPlayerList(players: OnlinePlayer[]): void {
  const role = inviteRole();
  const rows = players
    .filter((p) => p.id !== S.playerId && p.roomId !== S.roomId && p.kind !== 'ai')
    .sort(
      (a, b) =>
        Number(b.online && b.roomId === null) - Number(a.online && a.roomId === null) ||
        a.name.localeCompare(b.name),
    );

  const body = document.createElement('div');
  body.className = 'player-list';
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'room-empty';
    empty.textContent = '当前没有其它玩家，可让对方打开本服务器地址后等待其上线';
    body.appendChild(empty);
  }
  for (const p of rows) {
    // 只有「在线且不在其它房间」的玩家能被邀请
    const inviteable = p.online && p.roomId === null;
    const item = document.createElement('div');
    item.className = 'player-item ' + (inviteable ? 'online' : p.online ? 'busy' : 'offline');

    const dot = document.createElement('span');
    dot.className = 'p-dot';
    const name = document.createElement('span');
    name.className = 'p-name';
    name.textContent = p.name;
    const state = document.createElement('span');
    state.className = 'p-state';
    state.textContent = !p.online ? '离线' : p.roomId === null ? '在线' : '对局中';
    item.append(dot, name);
    if (p.kind === 'account') {
      const kind = document.createElement('span');
      kind.className = 'p-kind';
      kind.textContent = '账号';
      item.appendChild(kind);
    }
    item.appendChild(state);

    if (inviteable) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small';
      btn.textContent = '邀请';
      btn.addEventListener('click', () => {
        closeModal();
        sendInvite(p.id, role);
      });
      item.appendChild(btn);
    }
    body.appendChild(item);
  }

  showModal({
    title: role === 'player' ? '邀请加入对局' : '邀请观战',
    sub:
      role === 'player'
        ? '点击玩家右侧「邀请」，对方接受后即可加入本局'
        : '本局已开始：点击玩家右侧「邀请」，对方接受后可只读观战',
    body,
    wide: true,
    buttons: [
      { label: '刷新', onClick: () => void openInvite() },
      { label: '关闭', primary: true },
    ],
  });
}

function sendInvite(playerId: string, role: 'player' | 'spectator'): void {
  net?.send({ type: 'invite_player', playerId, role });
  toast(role === 'player' ? '已发出对局邀请' : '已发出观战邀请');
}

/** 收到他人的房间邀请：可直接加入（房间设口令也免口令） */
function showInviteModal(msg: Extract<ServerMessage, { type: 'invite' }>): void {
  const roleText = msg.role === 'player' ? '加入对局' : '观战';
  showModal({
    title: '房间邀请',
    sub: `「${msg.from.name}」邀请你${roleText}：房间 ${msg.roomId}${msg.locked ? '（已上锁，邀请可免口令）' : ''}`,
    buttons: [
      { label: '接受', primary: true, onClick: () => void acceptInvite(msg.roomId, msg.role) },
      { label: '拒绝' },
    ],
  });
}

/** 接受邀请并加入房间 */
async function acceptInvite(roomId: string, role: 'player' | 'spectator'): Promise<void> {
  if (S.roomId) return toast('你已在房间中');
  if (!(await ensureSocket())) return toast('尚未连接服务器');
  try {
    await request({ type: 'join_room', roomId, role, token: S.account?.token });
    toast(role === 'player' ? '已加入对局' : '已进入观战');
  } catch (e) {
    toast(e instanceof Error ? e.message : '加入失败');
  }
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
      {
        label: '确认认输',
        primary: true,
        onClick: () => {
          if (S.offline && localGame) {
            localGame.resign('r');
            applySnapshot(localGame.snapshot());
          } else {
            net?.send({ type: 'resign' });
          }
        },
      },
      { label: '取消' },
    ],
  });
}

function offerDraw(): void {
  if (S.status !== 'playing') return toast('对局尚未开始');
  if (S.offline) return toast('AI 拒绝了和棋请求');
  if (S.pending) return toast('请求已发送，等待对方回应');
  net?.send({ type: 'draw_request' });
  S.pending = 'draw';
  updatePanel();
  toast('已发送和棋请求…');
}

function requestRestart(): void {
  // 残局挑战：「再来一局 / 重来」都是把本局恢复到初始局面
  if (S.endgame) return restartPuzzle();
  if (S.status !== 'over') return toast('对局结束后才能重开');
  if (S.offline) {
    localGame?.reset('playing');
    if (localGame) applySnapshot(localGame.snapshot());
    scheduleLocalAi();
    toast('已重新开局');
    return;
  }
  if (S.pending) return toast('请求已发送，等待对方回应');
  net?.send({ type: 'restart_request' });
  S.pending = 'restart';
  updatePanel();
  toast('已发送重开请求…');
}

/** 悔棋：请求回退一步（与和棋同构的「请求-回应」）；本地对弈直接回退到本方回合 */
function offerUndo(): void {
  if (S.status !== 'playing') return toast('对局尚未开始');
  if (S.offline) {
    const game = localGame;
    if (!game) return;
    if (game.history.length === 0) return toast('当前没有可悔的棋');
    game.undo();
    if (game.turn !== 'r' && game.history.length > 0) game.undo();
    applySnapshot(game.snapshot());
    toast('已悔棋');
    return;
  }
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
      const from = S.selected;
      S.selected = null;
      S.moves = [];
      render();
      if (S.offline) localMove(from, [r, c]);
      else net?.send({ type: 'move', from, to: [r, c] });
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

/** 打开对局回顾（需要服务器提供记录接口） */
function openHistory(): void {
  if (!S.server) {
    toast('请先连接服务器');
    void openServersScreen();
    return;
  }
  void review?.open();
}

function bindEvents(): void {
  // 连接服务器
  $('btn-server-connect').addEventListener('click', () => {
    const addr = parseAddress($<HTMLInputElement>('server-addr').value, DEFAULT_PORT);
    if (!addr) return setServerMsg('地址格式不正确，示例：192.168.1.42:7777', 'err');
    void connectServer(addr);
  });
  $('btn-server-scan').addEventListener('click', () => void scanServers());
  $('btn-server-list').addEventListener('click', () => void refreshServerList());
  $('btn-server-enter').addEventListener('click', () => void enterFromServerScreen());
  $('server-chip').addEventListener('click', () => void openServersScreen());
  $('acct-chip').addEventListener('click', openAccountPanel);
  $('server-addr').addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') $('btn-server-connect').click();
  });

  // 首页
  $('btn-create').addEventListener('click', () => showHomePanel('create'));
  $('btn-create-back').addEventListener('click', backToIndex);
  $('btn-create-start').addEventListener('click', () => void createRoom());
  $('btn-show-join').addEventListener('click', showJoin);
  $('btn-create-ai').addEventListener('click', () => showHomePanel('ai'));
  $('btn-ai-back').addEventListener('click', backToIndex);
  $('btn-ai-start').addEventListener('click', createAiRoom);
  $('btn-endgame').addEventListener('click', openEndgamePanel);
  $('btn-endgame-back').addEventListener('click', backToIndex);
  $('btn-acct-back').addEventListener('click', backToIndex);
  $('btn-login').addEventListener('click', () => void doAuth(false));
  $('btn-register').addEventListener('click', () => void doAuth(true));
  $('btn-logout').addEventListener('click', logout);
  $('btn-skin').addEventListener('click', switchSkin);
  $('btn-history').addEventListener('click', openHistory);

  // 等待页：取先方式下拉框（默认猜先；仅等待阶段有效）
  $('first-mode').addEventListener('change', (e) => {
    chooseFirst((e.target as HTMLSelectElement).value as FirstMode);
  });
  $('btn-cancel-host').addEventListener('click', leaveToHome);
  $('ip-box').addEventListener('click', () => void copyRoomNo());

  // 加入房间
  $('btn-connect').addEventListener(
    'click',
    () => void joinRoom($<HTMLInputElement>('join-room').value.trim(), 'player'),
  );
  $('btn-spectate').addEventListener(
    'click',
    () => void joinRoom($<HTMLInputElement>('join-room').value.trim(), 'spectator'),
  );
  $('btn-rooms').addEventListener('click', () => void refreshRooms());
  $('btn-join-back').addEventListener('click', () => show('screen-home'));

  // 邀请
  $('btn-invite').addEventListener('click', () => void openInvite());
  $('btn-invite-host').addEventListener('click', () => void openInvite());

  // 对局
  $('btn-spectate-leave').addEventListener('click', leaveToHome);
  $('btn-resign').addEventListener('click', resign);
  $('btn-draw').addEventListener('click', offerDraw);
  $('btn-undo').addEventListener('click', offerUndo);
  // 残局挑战：悔棋 / 提示 / 重来 / 离开
  $('btn-eg-undo').addEventListener('click', endgameUndo);
  $('btn-eg-hint').addEventListener('click', endgameHint);
  $('btn-eg-restart').addEventListener('click', restartPuzzle);
  $('btn-eg-leave').addEventListener('click', leaveToHome);
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
    if (S.status !== 'playing' || S.endgame?.result) return;
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
    if ((e as KeyboardEvent).key === 'Enter') void joinRoom(roomInput.value.trim(), 'player');
  });
  const pwdInput = $<HTMLInputElement>('join-pwd');
  pwdInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void joinRoom(roomInput.value.trim(), 'player');
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
    apiBase,
    myId: myPlayerId,
    myLabel: myPlayerLabel,
    show,
    toast,
  });
  render();

  // 账号：恢复上次登录的 token（可选使用）
  const token = readStore(TOKEN_KEY);
  const username = readStore(USER_KEY);
  if (token && username) S.account = { token, username };
  updateHomeChips();

  // 服务器：浏览器访问时锁定为当前访问地址；桌面客户端由启动参数预填
  S.serverLocked = !isDesktopClient(window.location.search);
  S.server = S.serverLocked
    ? pageServer(window.location.hostname, window.location.port, window.location.protocol)
    : (parseAddress(pageParams.get('server') ?? '', DEFAULT_PORT) ?? {
        host: '127.0.0.1',
        port: DEFAULT_PORT,
      });
  upsertServer(S.server);

  // 计时读秒（D4）：定时刷新剩余时间显示（未启用计时时几乎零开销）
  window.setInterval(() => {
    if (S.deadline && S.status === 'playing') updatePanel();
  }, 500);

  // 首个板块：连接服务器
  show('screen-servers');
  renderServers();
  if (S.serverLocked) {
    await connectLockedServer();
  } else {
    await openServersScreen();
  }
}

void init();
