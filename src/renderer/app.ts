/**
 * 渲染层主控制器：页面切换、棋盘交互、消息处理、服务器选择、房间与账号、人机对弈。
 *
 * 客户端不再于启动时绑定服务器：先在「连接服务器」板块选择目标服务器（自动搜索 / 手动输入），
 * 再进入首页创建 / 加入房间；未连接服务器时仍可本机人机对弈（本地 AI）。
 * 客户端只发送「走子意图」，联机对局一切以服务器广播为准。
 */

import { cloneBoard, findKing, initBoard, legalMoves, validateMove } from '../shared/rules.js';
import { ClientMessage, OnlinePlayer, ServerMessage } from '../shared/protocol.js';
import {
  Board,
  FirstMode,
  GameSnapshot,
  GuessChoice,
  Move,
  Piece,
  PieceType,
  Pos,
  RoomSummary,
  Side,
} from '../shared/types.js';
import { Game } from '../shared/game.js';
import { pickMove } from '../shared/ai.js';
import { boardToFen } from '../shared/uci.js';
import { CheckmateInfo, classifyCheckmate, classifyCheckmateFromHistory } from '../shared/checkmate.js';
import { CaptureHints, TacticHit, captureHints, detectTactics } from '../shared/tactics.js';
import {
  CUSTOM_LEVEL,
  EndgamePuzzle,
  EndgameRecord,
  LEVEL_LABEL,
  PUZZLES,
  buildPuzzleBoard,
  endgameOutcome,
  findMateMove,
  isOptimalSteps,
  minMateDepth,
  nextPuzzle,
  parseCustomEndgames,
  parseEndgameRecords,
  recordFail,
  recordWin,
  removeCustomEndgame,
  upsertCustomEndgame,
} from '../shared/endgame.js';
import { capturedPieces, describeMove } from '../shared/notation.js';
import { coveredCount } from '../shared/jieqi.js';
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
  PIECE_IMG,
  SkinId,
  SKINS,
  assetUrl,
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
import { BannerContent, bannerContent } from './banner.js';
import { detectOpening } from './openings.js';
import { EndgameEditorController, initEndgameEditor } from './endgame-editor.js';

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
/** 自建残局存档（编辑器保存的题目列表，同样只存本机） */
const CUSTOM_KEY = 'lanschess-endgame-custom';

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

/** 选中棋子的抬起动画：进度在 from → to 之间推进（to=1 保持抬起，to=0 落回原处） */
interface LiftAnim {
  pos: Pos;
  from: number;
  to: number;
  start: number;
}

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
  /** 走子动画（抬起 → 移动 → 放下）；null 表示当前静止 */
  anim: null as { from: Pos; to: Pos; piece: Piece; start: number; startLifted?: boolean } | null,
  /** 被点击抬起的棋子（升起 / 保持 / 落下）；同一时刻只抬起一枚 */
  lifts: [] as LiftAnim[],
  /** 提示环（残局挑战的「提示」正解首着） */
  hint: null as Move | null,
  /** 吃子提示是否开启（绿环 = 可吃的对方无根 / 小换大的子，红环 = 会被吃的己方子） */
  captureHint: false,
  /** 吃子提示结果；仅在开启且对局中计算，render() 时刷新（悬停 / 脉冲帧只读） */
  hints: null as CaptureHints | null,
  /** 本步识别出的战术（棋盘上方提示 + 被威胁棋子闪电）；null 表示当前无 */
  fx: null as { seq: number; hits: TacticHit[] } | null,
  /** 被威胁的敌方棋子（供 board.ts 画闪电） */
  threats: [] as Pos[],
  /** 残局挑战进度；null 表示当前不是残局模式 */
  endgame: null as EndgameState | null,
  /** 揭棋（暗棋）模式：棋盘含暗子，吃子按快照记录展示 */
  jieqi: false,
  /** 揭棋：双方吃子记录（快照下发，含被吃暗子翻开后的身份） */
  capRed: [] as PieceType[],
  capBlack: [] as PieceType[],
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
  // 揭棋局面含暗子，无「经典杀法」可言：不做杀法识别，终局只显示将死
  if (S.jieqi) return null;
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

// -------------------------------------------------------------- 正中提示条（将军 / 绝杀）

/** 提示条显示时长（毫秒）：渐入 → 保持 → 渐出（较 v2.10 延长，便于看清将军 / 绝杀） */
const BANNER_MS = 2500;
let bannerTimer = 0;
/** 上一帧提示条的局势键与时间：联机走子会连收 move_applied + game_over，按此去重 */
let lastBannerKey = '';
let lastBannerAt = 0;

/** 在棋盘正中显示将军 / 绝杀黑色大圆（绝杀另带暗红斜线），1.5s 后渐出消失 */
function showBanner(c: BannerContent): void {
  const el = $('board-banner');
  const card = $('banner-card');
  card.dataset.kind = c.kind;
  card.dataset.pattern = c.style.pattern;
  card.style.setProperty('--b-accent', c.style.accent);
  $('banner-name').textContent = c.name;
  $('banner-sub').textContent = c.sub;
  el.classList.remove('show');
  void el.offsetWidth; // 强制回流，让连续触发的动画能重新播放
  el.hidden = false;
  el.classList.add('show');
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, BANNER_MS);
}

/** 同一局势（seq + 类型）在短时间内重复触发时只显示一次 */
function showBannerOnce(key: string, run: () => void): void {
  const now = performance.now();
  if (key === lastBannerKey && now - lastBannerAt < 800) return;
  lastBannerKey = key;
  lastBannerAt = now;
  run();
}

/**
 * 按当前局面决定是否弹提示条：「将死」→ 绝杀（杀法名 + 该杀法图案样式）；「将军」→ 将军警示。
 * 在每次走子后调用（联机 move_applied / game_over、本地人机与残局）。
 */
function maybeBanner(): void {
  if (!$('screen-game').classList.contains('active')) return;
  const winner = S.winner;
  if (S.status === 'over' && winner && S.reason === '将死') {
    const mate = mateInfo();
    const id = mate?.pattern.id ?? 'generic';
    showBannerOnce(`mate:${id}:${S.moveSeq}`, () =>
      showBanner(
        bannerContent('mate', {
          label: mate ? mate.pattern.label : '将死',
          patternId: id,
          sub: `${mate ? mate.pattern.label : '将死'} · ${sideName(winner)}绝杀`,
        }),
      ),
    );
  } else if (S.status === 'playing' && S.check) {
    showBannerOnce(`check:${S.turn}:${S.moveSeq}`, () =>
      showBanner(bannerContent('check', { sub: `${sideName(S.turn)}被将军` })),
    );
  }
}

// -------------------------------------------------------------- 棋盘上方提示（战术 / 开局）

/** 棋盘上方提示的显示时长（毫秒）：渐入 → 保持 → 渐出 */
const TACTIC_MS = 2500;
let tacticTimer = 0;
/** 闪电清除定时器（与上方提示同时消失） */
let fxTimer = 0;
/** 上一步已处理的 moveSeq（联机重复广播时去重） */
let lastFxSeq = -1;

/** 在棋盘上方显示战术 / 开局提示（约 2.5s 渐入渐出） */
function showTactics(text: string): void {
  const el = $('board-tactics');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth; // 强制回流，让连续触发的动画能重新播放
  el.hidden = false;
  el.classList.add('show');
  window.clearTimeout(tacticTimer);
  tacticTimer = window.setTimeout(() => {
    el.classList.remove('show');
    el.hidden = true;
  }, TACTIC_MS);
}

/**
 * 走子后的特效：战术识别（棋盘上方提示 + 被威胁棋子闪电）与开局招法提示。
 * 每步只算一次并存入 `S`（供渲染帧读取），不在 `paint()` 里重算。
 * @param before 走子前局面（须在提交新盘面之前 `cloneBoard(S.board)` 取得）
 * @param move   该步
 * @param seq    该步的 moveSeq（重复广播去重）
 */
function applyMoveEffects(before: Board, move: Move, seq: number): void {
  S.fx = null;
  S.threats = [];
  if (seq === lastFxSeq) return;
  lastFxSeq = seq;
  if (S.status !== 'playing') return; // 将死（绝杀）由正中圆环表达，不做战术提示与闪电
  const hits = detectTactics(before, move, S.board);
  let text = '';
  // 开局招法提示：仅标准开局，且恰为红方首着那一步
  if (!S.endgame) {
    const opening = detectOpening(S.history);
    if (opening && opening.index === S.history.length - 1) text = `开局：${opening.name}`;
  }
  if (hits.length) {
    S.fx = { seq, hits };
    S.threats = hits[0].threats;
    text = text ? `${hits[0].label} · ${text}` : hits[0].label;
    // 与文字一同消失：约 2.5s 后清掉闪电并停帧
    window.clearTimeout(fxTimer);
    fxTimer = window.setTimeout(() => {
      S.fx = null;
      S.threats = [];
      syncPulse();
      paint();
    }, TACTIC_MS);
  }
  if (text) showTactics(text);
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

/** 点击抬起 / 落下的一帧时长（毫秒） */
const LIFT_MS = 200;
/** 走子动画时长（毫秒）；已抬起时直接从平移开始，否则 起身 → 移动 → 放下 */
const MOVE_ANIM_MS = 460;
/** 动画（抬起 / 落下 / 走子）的 rAF 句柄 */
let animRAF = 0;

/** 是否跟随系统「减少动态效果」（减少时不做抬起 / 走子动画，提示条也去掉缩放动效） */
const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const easeLift = (k: number): number => 1 - (1 - k) * (1 - k);

/** 抬起动画的当前进度（0 贴盘 / 1 完全抬起） */
function liftProgress(a: LiftAnim, now: number): number {
  const k = Math.min(1, (now - a.start) / LIFT_MS);
  return a.from + (a.to - a.from) * easeLift(k);
}

/** 某格棋子当前的抬起进度（无抬起记录时为 0） */
function liftOf(pos: Pos): number {
  const a = S.lifts.find((x) => x.pos[0] === pos[0] && x.pos[1] === pos[1]);
  return a ? liftProgress(a, performance.now()) : 0;
}

/** 某格是否处于「已抬起」状态（联机等待服务器确认期间保持抬起） */
function hasLiftAt(pos: Pos): boolean {
  return S.lifts.some((a) => a.pos[0] === pos[0] && a.pos[1] === pos[1]);
}

/**
 * 动画帧：推进抬起 / 落下 / 走子动画，直到全部结束。
 * 只有「正在动」的抬起（到达 1 保持抬起的不算）与走子动画会持续请求重绘。
 */
function tickAnim(): void {
  const now = performance.now();
  const animBusy = !!S.anim && now - S.anim.start < MOVE_ANIM_MS;
  const liftBusy = S.lifts.some((a) => now - a.start < LIFT_MS);
  // 落回原处（to=0）且已跑完的记录即可丢弃；保持抬起（to=1）的留着
  S.lifts = S.lifts.filter((a) => a.to === 1 || now - a.start < LIFT_MS);
  paint();
  if (animBusy || liftBusy) {
    animRAF = window.requestAnimationFrame(tickAnim);
  } else {
    S.anim = null;
    animRAF = 0;
  }
}

/** 启动动画帧循环（已在运行时不重复启动） */
function kickAnim(): void {
  if (!animRAF) animRAF = window.requestAnimationFrame(tickAnim);
}

/** 让当前抬起的棋子全部落回原处 */
function lowerAllLifts(): void {
  const now = performance.now();
  for (const a of S.lifts) {
    if (a.to === 1) {
      a.from = liftProgress(a, now);
      a.to = 0;
      a.start = now;
    }
  }
  kickAnim();
}

/** 点击棋子：把它抬起（同一时刻只抬起一枚，其它先落下） */
function liftPiece(pos: Pos): void {
  if (prefersReducedMotion()) return;
  const cur = S.lifts.find((a) => a.pos[0] === pos[0] && a.pos[1] === pos[1]);
  if (cur && cur.to === 1) return; // 已抬起：保持
  lowerAllLifts();
  S.lifts = S.lifts.filter((a) => a.pos[0] !== pos[0] || a.pos[1] !== pos[1]);
  S.lifts.push({ pos, from: 0, to: 1, start: performance.now() });
  kickAnim();
}

/** 清空抬起状态（全量同步 / 离开对局时立即复位） */
function clearLifts(): void {
  S.lifts = [];
}

/**
 * 启动一步走子的动画（抬起 → 移动 → 放下）。
 * 起点/终点取自刚更新的盘面：动画期间该棋子由 board.ts 单独绘制，落点格不静态贴图。
 * @param startLifted 该棋子点击时已抬起（选中态）时置真：直接从平移开始，不再重复起身
 */
function animateMove(from: Pos, to: Pos, startLifted = false): void {
  if (prefersReducedMotion()) return;
  const piece = S.board[to[0]]?.[to[1]];
  if (!piece) return;
  S.anim = { from, to, piece, start: performance.now(), startLifted };
  // 起点的「点击抬起」交给走子动画接管（避免同格画两次）
  S.lifts = S.lifts.filter((a) => a.pos[0] !== from[0] || a.pos[1] !== from[1]);
  paint(); // 先画起始帧，避免全量同步那一帧先闪现在终点
  kickAnim();
}

/** 被将军的将 / 帅颤抖：短促衰减（不再一直抖），幅度取格距的一小部分；减少动态效果时不做 */
const SHAKE_MS = 1100;
const SHAKE_AMP_RATIO = 0.03;
/** 当前颤抖的局势键（行棋方 + 步序）与起始时间：每次新将军重新起算，约 1.1s 后停止 */
const shakeState = { key: '', start: 0 };

/** 组装棋盘渲染视图（纯展示，不含规则判定） */
function boardView(): BoardView {
  const playable = canPlay();
  const now = performance.now();
  const sk = skin();
  // 被将军的将 / 帅：仅在将军出现后的短窗口内颤抖，幅度随时间衰减到 0
  const key = `${S.turn}:${S.moveSeq}`;
  if (S.check && S.status === 'playing') {
    if (shakeState.key !== key) {
      shakeState.key = key;
      shakeState.start = now;
    }
  } else if (shakeState.key) {
    shakeState.key = '';
  }
  const shakeElapsed = now - shakeState.start;
  const shaking =
    shakeState.key === key &&
    S.check &&
    S.status === 'playing' &&
    !prefersReducedMotion() &&
    shakeElapsed < SHAKE_MS;
  const shakeDecay = Math.max(0, 1 - shakeElapsed / SHAKE_MS);
  const shakeAmp = sk.spaceX * SHAKE_AMP_RATIO * shakeDecay;
  return {
    board: S.board,
    selected: S.selected,
    moves: S.moves,
    lastMove: S.lastMove,
    flip: flip(),
    anim: S.anim
      ? {
          from: S.anim.from,
          to: S.anim.to,
          piece: S.anim.piece,
          t: Math.min(1, (now - S.anim.start) / MOVE_ANIM_MS),
          startLifted: S.anim.startLifted,
        }
      : null,
    lifts: S.lifts.length ? S.lifts.map((a) => ({ pos: a.pos, t: liftProgress(a, now) })) : null,
    checkKing: S.check ? findKing(S.board, S.turn) : null,
    kingShake: shaking ? { dx: Math.sin(now / 28) * shakeAmp, dy: Math.cos(now / 19) * shakeAmp } : null,
    interactiveSide: playable ? S.side : null,
    hover: playable ? S.hover : null,
    threats: S.fx ? S.threats : null,
    hint: S.hint,
    capture: S.hints,
  };
}

/** 重绘棋盘（不做面板与状态同步，供悬停 / 脉冲帧调用） */
function paint(): void {
  // 减少动态效果时传 0：脉冲环保持静态、闪电不闪烁、将不颤抖
  const time = prefersReducedMotion() ? 0 : performance.now();
  renderBoard(boardEl, boardView(), skin(), loadedImages[S.skin] ?? {}, time);
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

/** 自建残局编辑器（棋盘摆子 + 保存前自动核验）；在 init() 中装配 */
let editor: EndgameEditorController | null = null;

/** 将军警示环的脉冲 / 将的颤抖 / 战术闪电闪烁：仅在需要时运行定时重绘（约 40ms 一帧） */
let pulseTimer = 0;
function syncPulse(): void {
  const need = (S.check || !!S.fx) && S.status === 'playing' && $('screen-game').classList.contains('active');
  if (need && !pulseTimer) {
    pulseTimer = window.setInterval(() => {
      if ((!S.check && !S.fx) || S.status !== 'playing') {
        window.clearInterval(pulseTimer);
        pulseTimer = 0;
        return;
      }
      paint();
    }, 40);
  } else if (!need && pulseTimer) {
    window.clearInterval(pulseTimer);
    pulseTimer = 0;
  }
}

/**
 * 刷新吃子提示结果：仅在提示开启、对局进行中且非观战时计算（观战无「自己 / 对方」之分）。
 * 计算量不大但不必每帧做，故只在 render() 时刷新，悬停 / 脉冲帧只读 `S.hints`。
 */
function refreshCaptureHints(): void {
  const on = S.captureHint && S.status === 'playing' && !S.spectator;
  S.hints = on ? captureHints(S.board, S.side) : null;
}

/** 切换吃子提示：绿环 = 可吃掉的对方无根子 / 小换大，红环 = 会被对方吃掉的己方子 */
function toggleCaptureHint(): void {
  if (S.status !== 'playing' || S.spectator) return;
  S.captureHint = !S.captureHint;
  render();
  toast(S.captureHint ? '已开启吃子提示：绿环可吃 · 红环有险' : '已关闭吃子提示');
}

function render(): void {
  refreshCaptureHints();
  paint();
  updatePanel();
  syncPulse();
}

/** 揭棋标记（含双方剩余暗子数）；非揭棋返回空串 */
function jieqiTag(): string {
  if (!S.jieqi) return '';
  return ` · 揭棋（暗棋）· 暗子 红${coveredCount(S.board, 'r')}/黑${coveredCount(S.board, 'b')}`;
}

function updateRoleHint(): void {
  if (S.spectator) {
    $('role-hint').textContent = `房间 ${S.roomId} · 观战 · 只读${jieqiTag()}`;
    return;
  }
  if (S.endgame) {
    const p = S.endgame.puzzle;
    $('role-hint').textContent =
      `残局「${p.name}」· 你执${S.side === 'r' ? '红' : '黑'} · 不限步数 · 最优 ${p.goalMoves} 步`;
    return;
  }
  if (S.offline) {
    $('role-hint').textContent = `人机对战（本地）· 你执红 · AI 执黑${jieqiTag()}`;
    return;
  }
  if (S.aiMode) {
    $('role-hint').textContent = `房间 ${S.roomId} · 人机对战 · AI 执黑${jieqiTag()}`;
    return;
  }
  if (S.guessPhase) {
    $('role-hint').textContent = `房间 ${S.roomId} · 猜先${jieqiTag()}`;
    return;
  }
  $('role-hint').textContent = `房间 ${S.roomId} · 你执${S.side === 'r' ? '红' : '黑'}${
    S.isOwner ? ' · 房主' : ''
  }${jieqiTag()}`;
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

/** 房间内的「邀请玩家 / 邀请观战」列表：仅联机且在房间内时显示（开局后转为邀请观战） */
function renderInvitePanel(): void {
  const can = !!S.roomId && !S.offline;
  $('invite-panel-host').hidden = !can;
  $('invite-panel-game').hidden = !can;
  if (!can) return;
  const spectator = inviteRole() === 'spectator';
  const label = spectator ? '邀请观战' : '邀请玩家';
  const hint = spectator
    ? '本局已开始：点击右侧「邀请」，对方接受后可只读观战'
    : '点击右侧「邀请」，对方接受后即可加入本局';
  $('invite-title-host').textContent = label;
  $('invite-title-game').textContent = label;
  $('invite-hint-host').textContent = hint;
  $('invite-hint-game').textContent = hint;
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
  // 吃子提示：仅对局进行中且非观战时可用（开启态用金色实底强调）
  const hintBtn = $<HTMLInputElement>('btn-hint');
  hintBtn.hidden = !active || S.spectator;
  hintBtn.classList.toggle('on', S.captureHint);
  hintBtn.setAttribute('aria-pressed', S.captureHint ? 'true' : 'false');
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
          ? `轮到你走棋（第 ${eg.used + 1} 步）`
          : `对手思考中…（已用 ${eg.used} 步）`
        : S.turn === S.side
          ? '轮到你走棋'
          : '对方思考中…';
  } else {
    statusText = S.spectator ? '等待对局开始' : (guessStatusText() ?? '准备开始');
  }
  st.textContent = active ? `${statusText}${remainText()}` : statusText;

  // 残局信息：名称 / 难度 / 最优步数 / 已用步数 + 一句要点
  const egBox = $('eg-box');
  egBox.hidden = !eg;
  if (eg) {
    $('eg-info').innerHTML =
      `<div>残局：${eg.puzzle.name} · ${LEVEL_LABEL[eg.puzzle.level]}</div>` +
      `<div>最优：${eg.puzzle.goalMoves} 步</div>` +
      `<div>已用：${eg.used} 步</div>` +
      `<div class="eg-intro">${eg.puzzle.intro}</div>`;
  }
  // 残局「下一关」：题库中还有下一局时可用，最后一关隐藏（结果弹层另有「下一关」）
  $<HTMLButtonElement>('btn-eg-next').hidden = !eg || !nextPuzzle(eg.puzzle.id);

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

  renderInvitePanel();
  renderCaptured();
}

/** 渲染被吃掉的棋子：棋盘两侧的灰色缩略图（标准对局由着法序列推导；揭棋按快照下发的吃子记录） */
function renderCaptured(): void {
  const cap = capturedPieces(S.history);
  // 左条 = 红方所吃（黑方的子），右条 = 黑方所吃（红方的子）；揭棋用快照记录的吃子（含暗子真实身份）
  fillCapStrip($('cap-red'), S.jieqi ? S.capRed : cap.byRed, 'b');
  fillCapStrip($('cap-black'), S.jieqi ? S.capBlack : cap.byBlack, 'r');
}

/** 把一组被吃棋子渲染为灰色素材缩略图；内容（皮肤 + 棋子序列）未变则跳过重建，避免闪烁 */
function fillCapStrip(el: HTMLElement, types: PieceType[], side: Side): void {
  const sig = `${S.skin}:${types.join('')}`;
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.replaceChildren(
    ...types.map((t) => {
      const img = document.createElement('img');
      img.className = 'cap-piece';
      img.alt = '';
      img.src = assetUrl(skin(), `${side}_${PIECE_IMG[t]}`);
      return img;
    }),
  );
}

function applySnapshot(s: GameSnapshot, opts: { keepAnim?: boolean } = {}): void {
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
  // 全量同步（含悔棋 / 重开）默认不做走子动画；终局的 game_over 紧跟 move_applied，需保留在跑的动画
  if (!opts.keepAnim) S.anim = null;
  clearLifts(); // 抬起状态由本端交互驱动，全量同步后一律复位
  S.fx = null; // 战术特效由走子驱动，全量同步（悔棋 / 重开 / 重连）后一律复位
  S.threats = [];
  lastFxSeq = -1;
  S.history = s.history ?? [];
  S.deadline = s.deadline ?? null;
  // 揭棋：变体与吃子记录随快照下发（标准对局无 variant，保持 false）
  S.jieqi = s.variant === 'jieqi';
  S.capRed = s.capturedByRed ?? [];
  S.capBlack = s.capturedByBlack ?? [];
  if ($('screen-game').classList.contains('active')) render();
}

function enterGame(): void {
  show('screen-game');
  render();
  refreshInviteList();
}

/** 等待页：展示房间号 / 口令状态 / 取先方式 + 常驻邀请列表 */
function showWaiting(): void {
  $('host-ip').textContent = S.roomId || '—';
  $('room-pass-hint').textContent = S.locked
    ? '本房间已设置口令，加入者需输入口令'
    : '未设口令，任何人点击即可加入';
  $('host-wait').textContent = S.aiMode ? '正在开始人机对战…' : '让对方在「加入房间」中选择本房间';
  renderSidePick();
  renderInvitePanel();
  show('screen-host');
  refreshInviteList();
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
    case 'move_applied': {
      const before = cloneBoard(S.board); // 战术识别需要「走子前」局面
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
      S.jieqi = msg.variant === 'jieqi';
      S.capRed = msg.capturedByRed ?? [];
      S.capBlack = msg.capturedByBlack ?? [];
      S.anim = null;
      // 本端点选时已把该子抬起（等待服务器确认期间保持抬起）→ 走子动画直接从平移开始
      playClick();
      render();
      animateMove(msg.from, msg.to, hasLiftAt(msg.from));
      maybeBanner();
      applyMoveEffects(before, { from: msg.from, to: msg.to }, msg.seq);
      return;
    }
    case 'move_rejected':
      toast(`走子无效：${msg.reason}`);
      lowerAllLifts(); // 抬起中的棋子落回原处
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
      // 终局紧随 move_applied（同一步），保留正在播放的走子动画；将军 / 绝杀提示条按局面去重
      applySnapshot(msg.state, { keepAnim: true });
      maybeBanner();
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
  S.jieqi = false;
  S.capRed = [];
  S.capBlack = [];
  S.anim = null;
  clearLifts();
  window.cancelAnimationFrame(animRAF);
  animRAF = 0;
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

/** 创建双人对战房间（口令可选，留空即任何人可加入；可勾选揭棋） */
async function createRoom(): Promise<void> {
  if (!requireServer()) return;
  const password = $<HTMLInputElement>('create-pass').value.trim();
  const jieqi = $<HTMLInputElement>('create-jieqi').checked;
  // 服务端房间的缺省取先方式是「房主执红」，客户端缺省是「猜先」：
  // 建房成功后立即把本端默认同步给服务器，并回写本端状态（否则会被 room_joined 覆盖成服务端缺省值）
  const firstMode = FIRST_MODE_DEFAULT;
  try {
    await ensureSocket();
    S.aiMode = false;
    S.offline = false;
    S.guessPhase = null;
    await request({
      type: 'create_room',
      mode: jieqi ? 'jieqi' : 'pvp',
      password: password || null,
      token: S.account?.token,
    });
    S.firstMode = firstMode;
    renderSidePick();
    net?.send({ type: 'choose_first', mode: firstMode });
    backToIndex();
    if (jieqi) toast('已创建揭棋房间，等待对手加入');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    show('screen-home');
  }
}

/** 读取人机对战难度档位（1 入门 / 2 菜鸟 / 3 中级 / 4 高手 / 5 棋圣） */
function aiDepth(): number {
  const el = document.querySelector<HTMLInputElement>('input[name="ai-depth"]:checked');
  const depth = Number(el?.value ?? 3);
  return Number.isInteger(depth) && depth >= 1 && depth <= 5 ? depth : 3;
}

/** 读取本地人机对弈的棋种：标准象棋 / 揭棋（暗棋） */
function aiVariant(): 'xiangqi' | 'jieqi' {
  const el = document.querySelector<HTMLInputElement>('input[name="ai-variant"]:checked');
  return el?.value === 'jieqi' ? 'jieqi' : 'xiangqi';
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
  const jieqi = aiVariant() === 'jieqi';
  localGame = new Game();
  if (jieqi) localGame.openJieqi();
  else localGame.reset('playing');
  clearSession();
  applySnapshot(localGame.snapshot());
  backToIndex();
  enterGame();
  toast(jieqi ? '开始揭棋人机对弈（本地，无需服务器）' : '开始人机对弈（本地，无需服务器）');
  scheduleLocalAi();
}

/** 本地走子（offline / 残局模式）：直接走本地状态机，AI 随后应答 */
function localMove(from: Pos, to: Pos, opts: { startLifted?: boolean } = {}): void {
  const game = localGame;
  if (!game) return;
  const before = cloneBoard(S.board); // 战术识别需要「走子前」局面（须在 applyMove 前取）
  const result = game.applyMove(from, to, S.side);
  if (!result.ok) {
    toast(result.reason ?? '非法走子');
    lowerAllLifts();
    return;
  }
  playClick();
  S.hint = null; // 走子后清除提示环
  applySnapshot(game.snapshot());
  animateMove(from, to, opts.startLifted);
  maybeBanner();
  applyMoveEffects(before, { from, to }, S.moveSeq);
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
    void runLocalAi(aiSide);
  }, 350);
}

/**
 * 取一步 AI 着法并落子。
 *
 * 优先请求「承载页面的服务器」的 `/api/ai/move`（由 Node 侧调用皮卡鱼引擎）；
 * 请求失败（离线 / 页面经 `file://` 打开 / 引擎不可用）时回退本机纯 TS 引擎。
 * 引擎异步返回期间局面可能已变（悔棋 / 重来 / 终局），故返回后必须复核再落子。
 */
async function runLocalAi(aiSide: Side): Promise<void> {
  const g = localGame;
  if (!g || g.status !== 'playing' || g.turn !== aiSide || S.endgame?.result) return;
  const seq = g.moveSeq;
  const level = S.endgame ? ENDGAME_AI_DEPTH : aiDepth();
  const move = await requestAiMove(g, aiSide, level);
  if (!move) return;
  // 复核：游戏实例 / 步数 / 回合均未变才落子
  if (localGame !== g || g.moveSeq !== seq || g.status !== 'playing' || g.turn !== aiSide) return;
  if (S.endgame?.result) return;
  const before = cloneBoard(g.board); // 战术识别需要「走子前」局面（须在 applyMove 前取）
  g.applyMove(move.from, move.to, aiSide);
  playClick();
  S.hint = null; // 走子后清除提示环
  applySnapshot(g.snapshot());
  animateMove(move.from, move.to);
  maybeBanner();
  applyMoveEffects(before, move, S.moveSeq);
  if (S.endgame) endgameEvaluate();
}

/**
 * 向承载页面的服务器请求一步 AI 着法（`{ fen, level }` → `{ from, to }`）；
 * 请求失败时回退本机纯 TS 引擎 `pickMove`，保证无服务器 / 无引擎也能对弈。
 */
async function requestAiMove(g: Game, side: Side, level: number): Promise<Move | null> {
  const board: Board = g.board;
  try {
    const res = await fetch('/api/ai/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen: boardToFen(board, side), level }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { from?: Pos; to?: Pos; none?: boolean };
    if (data.none) return null;
    if (!data.from || !data.to) throw new Error('响应缺少着法');
    const move: Move = { from: data.from, to: data.to };
    // 服务器返回的着法必须在规则引擎中合法，否则视为失败并回退本机引擎
    if (validateMove(board, move.from, move.to, side) !== null) throw new Error('着法非法');
    return move;
  } catch {
    // 服务器不可达时回退本机纯 TS（「棋圣」档用「高手」深度兜底）
    const depth = level >= 5 ? 4 : level;
    return pickMove(board, side, { depth, timeLimitMs: level >= 4 ? 900 : 1200 });
  }
}

// -------------------------------------------------------------- 残局挑战

/** 残局防守 AI 的搜索深度（高手水平，尽量逼出玩家的正解） */
const ENDGAME_AI_DEPTH = 4;

/** 「提示」求解的最大步数：在该步数以内给出仍能取胜的最快着法 */
const ENDGAME_HINT_MAX = 6;

/** 读取本机残局记录（纯逻辑见 shared/endgame.ts `parseEndgameRecords`） */
function readEndgameRecord(): Record<string, EndgameRecord> {
  return parseEndgameRecords(readStore(ENDGAME_KEY));
}

/** 记录取胜（保留最少步数） */
function recordEndgameWin(id: string, used: number): void {
  writeStore(ENDGAME_KEY, JSON.stringify(recordWin(readEndgameRecord(), id, used)));
}

/** 记录失败（被将死 / 困毙）；已通关的局不再标记失败 */
function recordEndgameFail(id: string): void {
  writeStore(ENDGAME_KEY, JSON.stringify(recordFail(readEndgameRecord(), id)));
}

/** 打开「残局挑战」面板（内置题库 + 自建残局） */
function openEndgamePanel(): void {
  renderEndgameList();
  showHomePanel('endgame');
}

/** 从编辑器回到残局面板（编辑器是独立切屏，需先切回首页） */
function backToEndgamePanel(): void {
  show('screen-home');
  openEndgamePanel();
}

/** 读取本机自建残局（纯逻辑见 shared/endgame.ts `parseCustomEndgames`） */
function readCustomEndgames(): EndgamePuzzle[] {
  return parseCustomEndgames(readStore(CUSTOM_KEY));
}

/** 写回本机自建残局 */
function writeCustomEndgames(list: EndgamePuzzle[]): void {
  writeStore(CUSTOM_KEY, JSON.stringify(list));
}

/** 新建自建残局的默认名（按已有数量顺延） */
function defaultCustomName(): string {
  return `自建残局 ${readCustomEndgames().length + 1}`;
}

/**
 * 渲染残局列表：内置题库在前、自建残局在后（状态标记 + 名称 + 难度 + 最优步数，点击即开局）。
 * 标记含义：勾叉表示完成 / 失败 / 未完成（绿勾 / 红叉 / 白勾），
 * 外圈表示是否达成最优步数（绿圈 = 是最优，灰圈 = 不是最优）；自建条目另有「编辑 / 删除」。
 */
function renderEndgameList(): void {
  const box = $('endgame-list');
  box.replaceChildren();
  const rec = readEndgameRecord();
  for (const p of PUZZLES) box.appendChild(endgameRow(p, rec[p.id], null));
  for (const p of readCustomEndgames()) {
    box.appendChild(endgameRow(p, rec[p.id], { edit: () => editor?.open(p), del: () => askDeleteCustom(p) }));
  }
}

/** 列表单行；`acts` 有值时为自建残局（右侧多出「编辑 / 删除」两个小按钮） */
function endgameRow(
  p: EndgamePuzzle,
  rec: EndgameRecord | undefined,
  acts: { edit: () => void; del: () => void } | null,
): HTMLElement {
  const status = endgameOutcome(rec);
  const optimal = isOptimalSteps(rec, p.goalMoves);
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'eg-row';

  const mark = document.createElement('span');
  mark.className = `eg-mark ${status}${optimal ? ' optimal' : ''}`;
  mark.textContent = status === 'fail' ? '✗' : '✓';
  mark.title =
    status === 'win'
      ? optimal
        ? `已完成 · 最优 ${p.goalMoves} 步`
        : '已完成（未达最优步数）'
      : status === 'fail'
        ? '失败'
        : '未完成';

  const name = document.createElement('span');
  name.className = 'eg-name';
  name.textContent = p.name;
  const level = document.createElement('span');
  level.className =
    'eg-level' + (p.level === 'hard' ? ' hard' : '') + (p.level === CUSTOM_LEVEL ? ' custom' : '');
  level.textContent = LEVEL_LABEL[p.level];
  const goal = document.createElement('span');
  goal.className = 'eg-goal';
  goal.textContent = `最优 ${p.goalMoves} 步`;
  row.append(mark, name, level, goal);
  row.addEventListener('click', () => startPuzzle(p));
  if (!acts) return row;

  const item = document.createElement('div');
  item.className = 'eg-item';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'eg-mini';
  edit.textContent = '✎';
  edit.title = '编辑这个自建残局';
  edit.addEventListener('click', acts.edit);
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'eg-mini del';
  del.textContent = '✕';
  del.title = '删除这个自建残局';
  del.addEventListener('click', acts.del);
  item.append(row, edit, del);
  return item;
}

/** 删除自建残局：二次确认，并一并清掉本机对应的通关记录 */
function askDeleteCustom(p: EndgamePuzzle): void {
  showModal({
    title: '删除自建残局',
    sub: `确定删除「${p.name}」吗？删除后无法恢复，本机对应的通关记录也会清除。`,
    buttons: [
      {
        label: '删　除',
        primary: true,
        onClick: () => {
          writeCustomEndgames(removeCustomEndgame(readCustomEndgames(), p.id));
          const rest = { ...readEndgameRecord() };
          delete rest[p.id];
          writeStore(ENDGAME_KEY, JSON.stringify(rest));
          renderEndgameList();
          toast(`已删除「${p.name}」`);
        },
      },
      { label: '取消' },
    ],
  });
}

// -------------------------------------------------------------- 自建残局编辑器

/** 打开自建残局编辑器（新建） */
function openEndgameEditor(): void {
  editor?.open(null);
}

/**
 * 保存前自动核验未通过：逐条列出问题。
 * 编辑器保持打开，便于按问题把局面改到合法且能强制取胜。
 */
function showCustomProblems(name: string, problems: string[]): void {
  const body = document.createElement('div');
  body.className = 'eg-check-list';
  for (const text of problems) {
    const row = document.createElement('div');
    row.className = 'eg-check-row bad';
    const mark = document.createElement('span');
    mark.className = 'eg-check-mark';
    mark.textContent = '✗';
    const detail = document.createElement('span');
    detail.className = 'eg-check-detail';
    detail.textContent = text;
    row.append(mark, detail);
    body.appendChild(row);
  }
  showModal({
    title: `「${name}」自动核验未通过`,
    sub: `共 ${problems.length} 处问题，改好后可再次保存（局面需双方有将、不重叠，且能在 4 步内强制将死对方）`,
    body,
    wide: true,
    buttons: [{ label: '知道了', primary: true }],
  });
}

/** 核验通过：自建残局落盘并回到残局面板 */
function saveCustomEndgame(p: EndgamePuzzle): void {
  writeCustomEndgames(upsertCustomEndgame(readCustomEndgames(), p));
  toast(`已保存「${p.name}」：最优 ${p.goalMoves} 步`);
  backToEndgamePanel();
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
  toast(`残局「${p.name}」：将死即胜（最优 ${p.goalMoves} 步）`);
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

/**
 * 残局提示：不限步数——给出当前局面下仍能取胜的最快着法（并报出该局面最优步数）；
 * 若已走成无法强制取胜的局面则建议重来。先让「计算中」绘制出来再做同步求解。
 */
function endgameHint(): void {
  const eg = S.endgame;
  if (!eg || S.status !== 'playing' || eg.result) return;
  toast('计算提示中…');
  window.setTimeout(() => {
    if (!S.endgame || S.endgame.result || S.status !== 'playing') return;
    // 当前局面的最优取胜步数：0 表示在搜索上限内已无强制取胜着法
    const depth = minMateDepth(S.board, S.side, ENDGAME_HINT_MAX);
    const mv = depth > 0 ? findMateMove(S.board, S.side, depth) : null;
    if (!mv) {
      toast('当前局面已无强制取胜的着法，建议「重来」');
      return;
    }
    S.hint = mv;
    paint();
    toast(`提示：${describeMove(S.board, mv.from, mv.to)}（${depth} 步内取胜）`);
  }, 0);
}

/** 残局：每步之后判定目标（不限步数，将死对方即成功；被将死 / 困毙即失败） */
function endgameEvaluate(): void {
  const eg = S.endgame;
  if (!eg || eg.result) return;
  // 已用步数 = 玩家自己的着法数（玩家先行，隔一步一手）
  eg.used = S.history.filter((_, i) => i % 2 === 0).length;
  if (S.status === 'over') {
    const won = S.winner === eg.puzzle.side;
    eg.result = won ? 'win' : 'fail';
    eg.reason = won ? S.reason : `被${S.reason}`;
    if (won) recordEndgameWin(eg.puzzle.id, eg.used);
    else recordEndgameFail(eg.puzzle.id);
  } else {
    // 仍在进行中（不限步数）：渲染后交给 AI 应招
    render();
    scheduleLocalAi();
    return;
  }
  render();
  showEndgameResult();
}

/** 残局结果弹层：成功可「下一关」（并给出是否达成最优步数），失败可「重来」 */
function showEndgameResult(): void {
  const eg = S.endgame;
  if (!eg) return;
  const won = eg.result === 'win';
  const next = won ? nextPuzzle(eg.puzzle.id) : null;
  const optimal = eg.used === eg.puzzle.goalMoves;
  showModal({
    title: won ? '挑战成功' : '挑战失败',
    sub: won
      ? `「${eg.puzzle.name}」${eg.reason} · 用时 ${eg.used} 步（最优 ${eg.puzzle.goalMoves} 步${
          optimal ? ' · 已达成最优' : ''
        }）`
      : `「${eg.puzzle.name}」${eg.reason}（最优 ${eg.puzzle.goalMoves} 步）`,
    buttons: [
      ...(next ? [{ label: `下一关：${next.name}`, primary: true, onClick: () => startPuzzle(next) }] : []),
      { label: won ? '再来一次' : '重　来', primary: !next, onClick: restartPuzzle },
      { label: '返回首页', onClick: leaveToHome },
    ],
  });
}

/** 残局「下一关」：直接进入题库中的下一局（已是最后一关则提示） */
function endgameNext(): void {
  const eg = S.endgame;
  if (!eg) return;
  const next = nextPuzzle(eg.puzzle.id);
  if (!next) return toast('已经是最后一关了');
  startPuzzle(next);
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
  const joinable = rooms.filter((r) => r.mode !== 'ai');
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
    info.textContent = `${r.ownerName} · ${r.players}/2 · ${state}${r.mode === 'jieqi' ? ' · 揭棋' : ''}${
      r.locked ? ' · 需口令' : ''
    }`;
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

/** 拉取服务器在线玩家列表（邀请列表常驻展示：进入房间时 + 定时刷新 + 手动「刷新」） */
function refreshInviteList(): void {
  if (!S.roomId || S.offline) return;
  net?.send({ type: 'list_players' });
}

/** 邀请列表的一行：在线且在大厅的玩家可一键邀请；在别处对局中 / 离线的置灰且不显示按钮 */
function playerRow(p: OnlinePlayer, role: 'player' | 'spectator'): HTMLElement {
  const inviteable = p.online && p.roomId === null;
  const item = document.createElement('div');
  item.className = 'player-item ' + (inviteable ? 'online' : p.online ? 'busy' : 'offline');

  const dot = document.createElement('span');
  dot.className = 'p-dot';
  const name = document.createElement('span');
  name.className = 'p-name';
  name.textContent = p.name;
  item.append(dot, name);
  if (p.kind === 'account') {
    const kind = document.createElement('span');
    kind.className = 'p-kind';
    kind.textContent = '账号';
    item.appendChild(kind);
  }
  const state = document.createElement('span');
  state.className = 'p-state';
  state.textContent = !p.online ? '离线' : p.roomId === null ? '在线' : '对局中';
  item.appendChild(state);

  if (inviteable) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small';
    btn.textContent = '邀请';
    btn.addEventListener('click', () => sendInvite(p.id, role));
    item.appendChild(btn);
  }
  return item;
}

/**
 * 渲染常驻邀请列表（等待页右栏 / 对局页侧栏）：
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

  for (const id of ['player-list-host', 'player-list-game']) {
    const box = $(id);
    box.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'room-empty';
      empty.textContent = '当前没有其它玩家，可让对方打开本服务器地址后等待其上线';
      box.appendChild(empty);
      continue;
    }
    for (const p of rows) box.appendChild(playerRow(p, role));
  }
  renderInvitePanel();
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
    if (localGame?.variant === 'jieqi') localGame.openJieqi();
    else localGame?.reset('playing');
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

/** 取消当前选中（ESC / 右键触发）：抬起的棋子落回原处 */
function clearSelection(): void {
  if (!S.selected) return;
  S.selected = null;
  S.moves = [];
  lowerAllLifts();
  render();
}

// -------------------------------------------------------------- 走子交互

function onCell([r, c]: Pos): void {
  const p = S.board[r][c];
  // 点击己方棋子 = 选中：棋子抬起（同一时刻只抬起一枚）
  const pick = (): void => {
    S.selected = [r, c];
    S.moves = legalMoves(S.board, r, c);
    liftPiece([r, c]);
    playSelect();
    render();
  };

  if (S.selected) {
    if (S.moves.some(([rr, cc]) => rr === r && cc === c)) {
      const from = S.selected;
      const startLifted = liftOf(from) > 0.5; // 本端已把该子抬起
      S.selected = null;
      S.moves = [];
      render();
      // 本地对局立即走子（抬起交给走子动画）；联机则保持抬起，等服务器确认后再走动画
      if (S.offline) localMove(from, [r, c], { startLifted });
      else net?.send({ type: 'move', from, to: [r, c] });
      return;
    }
    if (p && p.s === S.side) {
      pick();
      return;
    }
    S.selected = null;
    S.moves = [];
    lowerAllLifts(); // 点到空位 / 对方棋子：取消选中，棋子落回
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
  $('btn-eg-create').addEventListener('click', openEndgameEditor);
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

  // 邀请列表常驻：手动「刷新」
  $('btn-invite-refresh-host').addEventListener('click', refreshInviteList);
  $('btn-invite-refresh-game').addEventListener('click', refreshInviteList);

  // 对局
  $('btn-spectate-leave').addEventListener('click', leaveToHome);
  $('btn-hint').addEventListener('click', toggleCaptureHint);
  $('btn-resign').addEventListener('click', resign);
  $('btn-draw').addEventListener('click', offerDraw);
  $('btn-undo').addEventListener('click', offerUndo);
  // 残局挑战：悔棋 / 提示 / 下一关 / 重来 / 离开
  $('btn-eg-undo').addEventListener('click', endgameUndo);
  $('btn-eg-hint').addEventListener('click', endgameHint);
  $('btn-eg-next').addEventListener('click', endgameNext);
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
    if ($('screen-endgame-editor').classList.contains('active')) return backToEndgamePanel();
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
  editor = initEndgameEditor({
    skin,
    images: () => loadedImages[S.skin] ?? {},
    show,
    toast,
    onInvalid: showCustomProblems,
    onSave: saveCustomEndgame,
    onCancel: backToEndgamePanel,
    defaultName: defaultCustomName,
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

  // 邀请列表常驻侧栏：在等待页 / 对局页每 5s 刷新在线状态（离线 / 不在房间时不发请求）
  window.setInterval(() => {
    const onWaiting = $('screen-host').classList.contains('active');
    const onGame = $('screen-game').classList.contains('active');
    if (onWaiting || onGame) refreshInviteList();
  }, 5000);

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
