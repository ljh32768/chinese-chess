/**
 * 渲染层主控制器：页面切换、棋盘交互、消息处理。
 * 客户端只发送「走子意图」，一切以主机广播为准。
 */

import { initBoard, legalMoves } from '../shared/rules.js';
import { ServerMessage } from '../shared/protocol.js';
import { Board, GameSnapshot, Move, Pos, Side } from '../shared/types.js';
import { pickCell, renderBoard, svgPoint } from './board.js';
import { Net, WelcomeInfo } from './net.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const boardEl = document.getElementById('board') as unknown as SVGSVGElement;

/** 客户端本地视图状态（仅用于渲染，非权威） */
const S = {
  role: 'host' as 'host' | 'guest',
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
};

let net: Net | null = null;

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

function render(): void {
  renderBoard(boardEl, {
    board: S.board,
    selected: S.selected,
    moves: S.moves,
    lastMove: S.lastMove,
    flip: flip(),
  });
  updatePanel();
}

function updateRoleHint(): void {
  $('role-hint').textContent = `你执${S.side === 'r' ? '红' : '黑'} · ${
    S.role === 'host' ? '主机' : '加入者'
  }`;
}

function updatePanel(): void {
  const opp: Side = S.side === 'r' ? 'b' : 'r';
  const rowTop = $('p-top');
  const rowBottom = $('p-bottom');
  rowTop.className = 'player-row ' + (opp === 'r' ? 'red' : 'black');
  rowBottom.className = 'player-row ' + (S.side === 'r' ? 'red' : 'black');
  $('p-top-name').textContent = `${sideName(opp)} · 对手`;
  $('p-bottom-name').textContent = `${sideName(S.side)} · 你`;

  const active = S.status === 'playing';
  rowTop.classList.toggle('active', active && S.turn === opp);
  rowBottom.classList.toggle('active', active && S.turn === S.side);
  $('p-top-tag').textContent = active && S.turn === opp ? '走棋中' : '';
  $('p-bottom-tag').textContent = active && S.turn === S.side ? '走棋中' : '';

  const st = $('status-box');
  st.classList.toggle('check', active && S.check);
  if (S.status === 'over') {
    st.textContent = `${resultText()} · ${S.reason}`;
  } else if (active && S.check) {
    st.textContent = S.turn === S.side ? '⚠ 你被将军了' : '⚠ 对方被将军';
  } else if (active) {
    st.textContent = S.turn === S.side ? '轮到你走棋' : '对方思考中…';
  } else {
    st.textContent = '准备开始';
  }
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
  updateRoleHint();
  if ($('screen-game').classList.contains('active')) render();
}

function enterGame(): void {
  show('screen-game');
  render();
}

// -------------------------------------------------------------- 消息处理

function showGameOver(): void {
  showModal({
    title: resultText(),
    sub: S.reason,
    buttons: [
      { label: '再来一局', primary: true, onClick: requestRestart },
      { label: '返回首页', onClick: leaveToHome },
    ],
  });
}

function handleMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'start':
      applySnapshot(msg.state);
      enterGame();
      toast('对局开始，红方先行');
      break;
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
      render();
      if (msg.status === 'over') showGameOver();
      break;
    case 'move_rejected':
      toast(`走子无效：${msg.reason}`);
      break;
    case 'state':
      applySnapshot(msg.state);
      break;
    case 'game_over':
      applySnapshot(msg.state);
      showGameOver();
      break;
    case 'draw_request':
      showModal({
        title: '对方请求和棋',
        sub: '同意则本局判和',
        buttons: [
          {
            label: '同意',
            primary: true,
            onClick: () => net?.send({ type: 'draw_response', accept: true }),
          },
          { label: '拒绝', onClick: () => net?.send({ type: 'draw_response', accept: false }) },
        ],
      });
      break;
    case 'draw_response':
      if (!msg.accept) toast('对方拒绝了和棋请求');
      break;
    case 'restart_request':
      showModal({
        title: '对方请求重开',
        sub: '同意则立即重新开局',
        buttons: [
          {
            label: '同意',
            primary: true,
            onClick: () => net?.send({ type: 'restart_response', accept: true }),
          },
          { label: '拒绝', onClick: () => net?.send({ type: 'restart_response', accept: false }) },
        ],
      });
      break;
    case 'restart_response':
      if (!msg.accept) toast('对方拒绝了重开请求');
      break;
    case 'opponent_joined':
      $('host-wait').textContent = '对手已加入，正在开局…';
      break;
    case 'opponent_left':
      handleOpponentLeft(msg.reason);
      break;
    default:
      break;
  }
}

function handleOpponentLeft(reason: string): void {
  if (S.status === 'playing' || S.status === 'over') {
    S.status = 'over';
    render();
    showModal({
      title: '对手已离开',
      sub: reason,
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
    render();
    showModal({
      title: '连接已断开',
      sub: reason,
      buttons: [{ label: '返回首页', primary: true, onClick: leaveToHome }],
    });
  } else {
    toast(reason);
  }
}

// -------------------------------------------------------------- 连接

async function openNet(url: string, role: 'host' | 'guest'): Promise<void> {
  net?.close();
  net = new Net({
    onWelcome(info: WelcomeInfo) {
      S.side = info.side;
      S.role = role;
      applySnapshot(info.state);
      if (info.state.status === 'playing') enterGame();
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
    $('host-ip').textContent = `${info.ip}:${info.port}`;
    $('host-wait').textContent = '请让对方在「加入对局」中输入上方地址';
    show('screen-host');
    await openNet(`ws://${location.host}/ws`, 'host');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
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

function showJoin(): void {
  const msg = $('join-msg');
  msg.textContent = '';
  msg.className = 'hint';
  show('screen-join');
}

async function doJoin(): Promise<void> {
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
  S.role = 'guest';
  try {
    await openNet(`ws://${ip}:${port}/ws`, 'guest');
    setMsg('连接成功，正在开局…', 'ok');
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
  net?.send({ type: 'draw_request' });
  toast('已发送和棋请求…');
}

function requestRestart(): void {
  if (S.status === 'idle' || S.status === 'waiting') return toast('对局尚未开始');
  net?.send({ type: 'restart_request' });
  toast('已发送重开请求…');
}

// -------------------------------------------------------------- 走子交互

function onCell([r, c]: Pos): void {
  const p = S.board[r][c];

  if (S.selected) {
    if (S.moves.some(([rr, cc]) => rr === r && cc === c)) {
      net?.send({ type: 'move', from: S.selected, to: [r, c] });
      S.selected = null;
      S.moves = [];
      render();
      return;
    }
    if (p && p.s === S.side) {
      S.selected = [r, c];
      S.moves = legalMoves(S.board, r, c);
      render();
      return;
    }
    S.selected = null;
    S.moves = [];
    render();
    return;
  }

  if (p && p.s === S.side) {
    S.selected = [r, c];
    S.moves = legalMoves(S.board, r, c);
    render();
  } else if (p) {
    toast('这是对方的棋子');
  }
}

// -------------------------------------------------------------- 初始化

function bindEvents(): void {
  $('btn-create').addEventListener('click', () => void createGame());
  $('btn-show-join').addEventListener('click', showJoin);
  $('btn-cancel-host').addEventListener('click', () => void cancelHost());
  $('btn-connect').addEventListener('click', () => void doJoin());
  $('btn-join-back').addEventListener('click', () => show('screen-home'));
  $('btn-resign').addEventListener('click', resign);
  $('btn-draw').addEventListener('click', offerDraw);
  $('btn-restart').addEventListener('click', requestRestart);
  $('btn-leave').addEventListener('click', leaveToHome);

  boardEl.addEventListener('click', (e) => {
    if (S.status !== 'playing') return;
    if (S.turn !== S.side) return toast('还没轮到你走棋');
    const pt = svgPoint(boardEl, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    const pos = pickCell(pt.x, pt.y, flip());
    if (pos) onCell(pos);
  });

  const joinIp = $<HTMLInputElement>('join-ip');
  joinIp.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') void doJoin();
  });
}

async function init(): Promise<void> {
  bindEvents();
  render();
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