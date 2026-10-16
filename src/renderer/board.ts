/**
 * 棋盘渲染（Canvas + 图片素材）。纯渲染，不含规则与网络逻辑。
 *
 * 画布尺寸、格距、素材目录与绘制公式均沿袭参考项目 Reference/Chess（MIT，见 assets/LICENSE-ReferenceChess.txt）：
 * 棋子/提示点/落点框的图片内已含偏移量，按参考项目同样公式贴图即可得到一致的画面。
 * 支持黑方视角翻转：逻辑坐标 (r,c) 与视图坐标互换。
 */

import { Board, Piece, PieceType, Pos, Side } from '../shared/types.js';
import type { CaptureHints } from '../shared/tactics.js';

/** 皮肤标识（与参考项目 stype1/2/3 对应） */
export type SkinId = 'stype1' | 'stype2' | 'stype3';

export interface Skin {
  id: SkinId;
  label: string;
  /** 画布内部尺寸（参考项目 com.stype） */
  width: number;
  height: number;
  /** 交叉点跨度 */
  spaceX: number;
  spaceY: number;
  /** 第一个交叉点的贴图起点（图片左上方，偏移量含在图片内） */
  pointStartX: number;
  pointStartY: number;
  /**
   * 棋子图片内「圆盘中心」相对图片左上角的偏移（实测素材）。
   * 仅用于视觉中心（警示环/悬停环）与点击命中，不参与贴图。
   */
  discX: number;
  discY: number;
  /** 圆盘直径（实测素材，用于绘制环半径） */
  disc: number;
  /** 素材子目录（assets/img/<page>/） */
  page: string;
}

export const SKINS: Record<SkinId, Skin> = {
  stype1: {
    id: 'stype1',
    label: '经典小盘',
    width: 325,
    height: 403,
    spaceX: 35,
    spaceY: 36,
    pointStartX: 5,
    pointStartY: 19,
    discX: 18,
    discY: 17,
    disc: 27,
    page: 'stype_1',
  },
  stype2: {
    id: 'stype2',
    label: '木质大盘',
    width: 523,
    height: 580,
    spaceX: 57,
    spaceY: 57,
    pointStartX: 3,
    pointStartY: 5,
    discX: 27.5,
    discY: 24,
    disc: 47,
    page: 'stype_2',
  },
  stype3: {
    id: 'stype3',
    label: '雅致棋盘',
    width: 530,
    height: 567,
    spaceX: 57,
    spaceY: 57,
    pointStartX: -2,
    pointStartY: 0,
    discX: 23.5,
    discY: 23.5,
    disc: 40,
    page: 'stype_3',
  },
};

export const SKIN_IDS: readonly SkinId[] = ['stype1', 'stype2', 'stype3'];
export const DEFAULT_SKIN: SkinId = 'stype2';

export function isSkinId(x: string | null | undefined): x is SkinId {
  return x === 'stype1' || x === 'stype2' || x === 'stype3';
}

/** 皮肤循环顺序：更换皮肤按钮按此切换 */
export function nextSkin(id: SkinId): SkinId {
  const i = SKIN_IDS.indexOf(id);
  return SKIN_IDS[(i + 1) % SKIN_IDS.length];
}

/** 棋子类型 → 素材文件名前缀（帅仕相马车炮兵 → j s x m c p z） */
const PIECE_IMG: Record<PieceType, string> = {
  K: 'j',
  A: 's',
  B: 'x',
  N: 'm',
  R: 'c',
  C: 'p',
  P: 'z',
};

/** 提示点贴图相对交叉点的偏移（参考项目固定 +10） */
const DOT_OFFSET = 10;

/** 吃子提示环配色：绿 = 可吃的对方棋子，红 = 会被吃的己方棋子 */
export const HINT_TARGET_COLOR = '#2f9e44';
export const HINT_THREAT_COLOR = '#d64545';

/** 单套皮肤需要预加载的素材键 */
export const IMAGE_KEYS: readonly string[] = [
  'bg',
  'dot',
  'box',
  ...(['r', 'b'] as Side[]).flatMap((s) => Object.values(PIECE_IMG).map((k) => `${s}_${k}`)),
];

export function assetUrl(skin: Skin, key: string): string {
  return `./assets/img/${skin.page}/${key}.png`;
}

/** 页面背景（棋盘同皮肤的木质底图） */
export function boardBgUrl(skin: Skin): string {
  return `./assets/img/${skin.page}/bg.jpg`;
}

/** 逻辑坐标 → 视图坐标（flip 时上下左右翻转） */
export function toView([r, c]: Pos, flip: boolean): Pos {
  return flip ? [9 - r, 8 - c] : [r, c];
}

/** 视图坐标 → 逻辑坐标 */
export function toLogic([vr, vc]: Pos, flip: boolean): Pos {
  return flip ? [9 - vr, 8 - vc] : [vr, vc];
}

/** 走子动画：抬起 → 移动 → 放下（`t` 为 0..1 进度，由渲染层按时间推进） */
export interface MoveAnim {
  from: Pos;
  to: Pos;
  /** 被移动的棋子（动画期间在盘上单独绘制，起点/终点格不再静态贴图） */
  piece: Piece;
  /** 进度 0..1 */
  t: number;
  /**
   * 该棋子点击时已被「抬起」（选中态），走子动画直接从平移开始（不再重复起身）。
   * 省略 / false 时走完整的起身 → 平移 → 放下（对手 / AI 走子用）。
   */
  startLifted?: boolean;
}

/** 点击选中的棋子「抬起」/ 取消选中「落下」的一帧状态（`t` 为 0..1 抬起进度） */
export interface MoveLift {
  pos: Pos;
  t: number;
}

export interface BoardView {
  board: Board;
  selected: Pos | null;
  moves: Pos[];
  lastMove: { from: Pos; to: Pos } | null;
  flip: boolean;
  /** 走子动画（有值时该棋子按动画帧绘制）；null / 省略表示静止盘面 */
  anim?: MoveAnim | null;
  /** 被点击抬起的棋子（含正在升起 / 落下）；这些格不再静态贴图，由抬起帧单独绘制 */
  lifts?: MoveLift[] | null;
  /** 被将军（含将死）一方的将/帅位置，用于警示高亮 */
  checkKing?: Pos | null;
  /**
   * 当前可交互（可选中 / 可落子）的一方；null 表示本方不可操作。
   * 仅用于悬停预高亮与光标样式，不参与任何规则判定。
   */
  interactiveSide?: Side | null;
  /** 鼠标悬停的交叉点（用于预高亮，非规则判定） */
  hover?: Pos | null;
  /** AI 推荐着法（复盘用）：起点细金环 + 终点粗金环 */
  hint?: { from: Pos; to: Pos } | null;
  /** 吃子提示（可选）：绿色环 = 可吃的对方棋子（无根 / 小换大），红色环 = 会被吃的己方棋子 */
  capture?: CaptureHints | null;
}

/** 交叉点的贴图起点（视图坐标）：`space*坐标 + pointStart`，可再叠加固定偏移 */
export function tileOrigin(pos: Pos, skin: Skin, flip: boolean, offset = 0): { x: number; y: number } {
  const [vr, vc] = toView(pos, flip);
  return {
    x: skin.spaceX * vc + skin.pointStartX + offset,
    y: skin.spaceY * vr + skin.pointStartY + offset,
  };
}

/** 交叉点视觉中心（视图坐标）：贴图起点 + 素材内圆盘偏移 */
export function cellCenter([vr, vc]: Pos, skin: Skin): { x: number; y: number } {
  return {
    x: skin.spaceX * vc + skin.pointStartX + skin.discX,
    y: skin.spaceY * vr + skin.pointStartY + skin.discY,
  };
}

/** 把画布内坐标（视图坐标）映射为逻辑棋盘坐标；远离交叉点返回 null */
export function pickCell(px: number, py: number, skin: Skin, flip: boolean): Pos | null {
  const vc = Math.round((px - skin.pointStartX - skin.discX) / skin.spaceX);
  const vr = Math.round((py - skin.pointStartY - skin.discY) / skin.spaceY);
  if (vr < 0 || vr > 9 || vc < 0 || vc > 8) return null;
  const { x, y } = cellCenter([vr, vc], skin);
  if (Math.hypot(px - x, py - y) > skin.spaceX * 0.75) return null;
  return toLogic([vr, vc], flip);
}

/** 把鼠标 / 触摸的客户端坐标换算为画布内部坐标（画布可能被 CSS 等比缩放） */
export function canvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  skin: Skin,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.width > 0 ? skin.width / rect.width : 1;
  const sy = rect.height > 0 ? skin.height / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

/** 贴图指令（img 为素材键，坐标已算出，直接 drawImage 即可） */
export interface DrawOp {
  img: string;
  x: number;
  y: number;
  /** 透明度（被选中的棋子压暗一档，参考项目做法） */
  alpha?: number;
  /** 缩放倍数（走子动画抬起时放大；以素材圆盘中心为锚点，省略即 1） */
  scale?: number;
}

/** 程序绘制的圆环（警示 / 悬停 / 可吃子提示） */
export interface RingOp {
  ring: true;
  cx: number;
  cy: number;
  radius: number;
  color: string;
  width: number;
  alpha: number;
  /** 脉冲动画（将军警示环） */
  pulse?: boolean;
}

/** 程序绘制的落影（走子抬起时棋子在盘面上的投影） */
export interface ShadowOp {
  shadow: true;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  alpha: number;
}

export type RenderOp = DrawOp | RingOp | ShadowOp;

// ------------------------------------------------------------ 走子动画

/** 抬起阶段结束 / 放下阶段开始的进度分界（剩余区间为移动平移） */
const ANIM_LIFT_END = 0.28;
const ANIM_DROP_START = 0.72;
/** 抬起高度（格距的比例）与抬起时的放大倍数 */
const ANIM_LIFT_HEIGHT = 0.42;
const ANIM_LIFT_SCALE = 1.14;

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const easeIn = (t: number): number => t * t;
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** 走子动画的一帧几何（纯数据，便于单测） */
export interface AnimFrame {
  /** 棋子素材键 */
  img: string;
  /** 贴图左边（已含平移与抬起位移） */
  x: number;
  y: number;
  scale: number;
  /** 抬起量 0..1（抬起 → 1，放下 → 0） */
  lift: number;
  /** 落影（抬起时才有；贴地时不画） */
  shadow: { cx: number; cy: number; rx: number; ry: number; alpha: number } | null;
}

/** 抬起量 → 贴图位置 / 缩放 / 落影（贴盘 0 ↔ 完全抬起 1 之间） */
function liftedPose(
  origin: { x: number; y: number },
  lift: number,
  skin: Skin,
): { x: number; y: number; scale: number; shadow: AnimFrame['shadow'] } {
  return {
    x: origin.x,
    y: origin.y - skin.spaceY * ANIM_LIFT_HEIGHT * lift,
    scale: 1 + (ANIM_LIFT_SCALE - 1) * lift,
    shadow:
      lift > 0.02
        ? {
            cx: origin.x + skin.discX,
            cy: origin.y + skin.discY,
            rx: skin.disc * (0.5 + 0.14 * lift),
            ry: skin.disc * (0.22 + 0.08 * lift),
            alpha: 0.34 * lift,
          }
        : null,
  };
}

/**
 * 点击棋子「抬起」/ 取消选中「落下」的一帧几何：只在原交叉点垂直升降。
 * @param t 抬起进度 0（贴盘）..1（完全抬起）
 */
export function liftFrame(pos: Pos, piece: Piece, t: number, skin: Skin, flip: boolean): AnimFrame {
  const lift = Math.min(1, Math.max(0, t));
  const pose = liftedPose(tileOrigin(pos, skin, flip), lift, skin);
  return {
    img: `${piece.s}_${PIECE_IMG[piece.t]}`,
    x: pose.x,
    y: pose.y,
    scale: pose.scale,
    lift,
    shadow: pose.shadow,
  };
}

/**
 * 计算走子动画在进度 `t` 时的一帧几何。
 * 三段式：抬起（升高 + 放大 + 出现落影）→ 移动（保持抬起平移）→ 放下（回落 + 恢复大小 + 落影消失）。
 * `anim.startLifted` 为真（点击选中时已抬起）时省去起身段：直接从平移开始，落点再放下。
 */
export function moveAnimFrame(anim: MoveAnim, skin: Skin, flip: boolean): AnimFrame {
  const from = tileOrigin(anim.from, skin, flip);
  const to = tileOrigin(anim.to, skin, flip);
  const t = Math.min(1, Math.max(0, anim.t));

  const raiseEnd = anim.startLifted ? 0 : ANIM_LIFT_END; // 起身段结束（已抬起则为 0）
  let tp = 0; // 平移进度
  let lift: number;
  if (raiseEnd > 0 && t <= raiseEnd) {
    lift = easeOut(t / raiseEnd); // 起身
  } else if (t <= ANIM_DROP_START) {
    tp = easeInOut((t - raiseEnd) / (ANIM_DROP_START - raiseEnd)); // 平移（保持抬起）
    lift = 1;
  } else {
    tp = 1;
    lift = 1 - easeIn((t - ANIM_DROP_START) / (1 - ANIM_DROP_START)); // 放下
  }

  const pose = liftedPose({ x: from.x + (to.x - from.x) * tp, y: from.y + (to.y - from.y) * tp }, lift, skin);
  return {
    img: `${anim.piece.s}_${PIECE_IMG[anim.piece.t]}`,
    x: pose.x,
    y: pose.y,
    scale: pose.scale,
    lift,
    shadow: pose.shadow,
  };
}

/**
 * 生成一帧的绘制计划（纯数据，便于单元测试）。
 * 顺序与参考项目一致：底图 → 落点框 → 提示点 → 棋子，程序绘制的环最后（保证可见）。
 */
export function computeDrawList(v: BoardView, skin: Skin): RenderOp[] {
  const ops: RenderOp[] = [{ img: 'bg', x: 0, y: 0 }];

  /** 贴图坐标：棋子/落点框用贴图起点，提示点再叠加固定偏移 */
  const at = (pos: Pos, offset = 0): { x: number; y: number } => tileOrigin(pos, skin, v.flip, offset);
  const center = (pos: Pos) => {
    const [vr, vc] = toView(pos, v.flip);
    return cellCenter([vr, vc], skin);
  };

  // 上一步：起点 / 终点落点框
  if (v.lastMove) {
    for (const pos of [v.lastMove.from, v.lastMove.to]) {
      const { x, y } = at(pos);
      ops.push({ img: 'box', x, y });
    }
  }
  // 当前选中：落点框
  if (v.selected) {
    const { x, y } = at(v.selected);
    ops.push({ img: 'box', x, y });
  }

  // 合法落点：空位画提示点（可吃子改在棋子之上画环）
  for (const pos of v.moves) {
    if (v.board[pos[0]][pos[1]]) continue;
    const { x, y } = at(pos, DOT_OFFSET);
    ops.push({ img: 'dot', x, y });
  }

  // 棋子（被选中的棋子压暗一档；动画中的棋子在其终点格跳过，抬起的棋子也跳过——均由动画帧单独绘制）
  const animTo = v.anim ? v.anim.to : null;
  const lifted = (r: number, c: number): boolean =>
    (v.lifts ?? []).some((l) => l.pos[0] === r && l.pos[1] === c);
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = v.board[r][c];
      if (!p) continue;
      if (animTo && animTo[0] === r && animTo[1] === c) continue;
      if (lifted(r, c)) continue;
      const { x, y } = at([r, c]);
      const selected = !!v.selected && v.selected[0] === r && v.selected[1] === c;
      ops.push({ img: `${p.s}_${PIECE_IMG[p.t]}`, x, y, alpha: selected ? 0.75 : 1 });
    }
  }

  // 可吃子：在棋子之上画空心环（参考项目无此提示，属本项目增强）
  for (const pos of v.moves) {
    if (!v.board[pos[0]][pos[1]]) continue;
    const { x, y } = center(pos);
    ops.push({ ring: true, cx: x, cy: y, radius: skin.disc / 2 + 2, color: '#c0392b', width: 3, alpha: 0.9 });
  }

  // 吃子提示（可选）：绿色 = 可吃的对方棋子（无根 / 小换大），红色 = 会被吃的己方棋子
  if (v.capture) {
    const ringRadius = skin.disc / 2 + 4;
    for (const [kind, color] of [
      ['targets', HINT_TARGET_COLOR],
      ['threats', HINT_THREAT_COLOR],
    ] as [keyof CaptureHints, string][]) {
      for (const pos of v.capture[kind]) {
        const { x, y } = center(pos);
        ops.push({ ring: true, cx: x, cy: y, radius: ringRadius, color, width: 3, alpha: 0.9 });
      }
    }
  }

  // 将军 / 将死：将帅红色脉冲警示环
  if (v.checkKing) {
    const { x, y } = center(v.checkKing);
    ops.push({
      ring: true,
      cx: x,
      cy: y,
      radius: skin.disc / 2 + 6,
      color: '#e23b2e',
      width: 3.5,
      alpha: 0.85,
      pulse: true,
    });
  }

  // 悬停预高亮：仅在本方可操作时显示（己方棋子 / 合法落点）
  if (v.hover && v.interactiveSide) {
    const hit = v.board[v.hover[0]][v.hover[1]];
    const isOwn = hit && hit.s === v.interactiveSide;
    const isMove = v.moves.some(([r, c]) => r === v.hover![0] && c === v.hover![1]);
    if (isOwn || isMove) {
      const { x, y } = center(v.hover);
      ops.push({
        ring: true,
        cx: x,
        cy: y,
        radius: isOwn ? skin.disc / 2 + 3 : 13,
        color: '#f0b429',
        width: 3,
        alpha: 0.85,
      });
    }
  }

  // AI 推荐（复盘）：起点细金环、终点粗金环；落点为空时叠加素材提示点
  if (v.hint) {
    const origin = center(v.hint.from);
    ops.push({
      ring: true,
      cx: origin.x,
      cy: origin.y,
      radius: skin.disc / 2 + 3,
      color: '#f0b429',
      width: 2.5,
      alpha: 0.7,
    });
    const dest = center(v.hint.to);
    ops.push({
      ring: true,
      cx: dest.x,
      cy: dest.y,
      radius: skin.disc / 2 + 3,
      color: '#f0b429',
      width: 3.5,
      alpha: 0.95,
    });
    if (!v.board[v.hint.to[0]][v.hint.to[1]]) {
      const d = at(v.hint.to, DOT_OFFSET);
      ops.push({ img: 'dot', x: d.x, y: d.y, alpha: 0.9 });
    }
  }

  // 点击选中的棋子「抬起」：升起 / 落下的棋子与落影画在最上层（先落影后棋子）
  for (const l of v.lifts ?? []) {
    const p = v.board[l.pos[0]]?.[l.pos[1]];
    if (!p) continue;
    const f = liftFrame(l.pos, p, l.t, skin, v.flip);
    if (f.shadow) ops.push({ shadow: true, ...f.shadow });
    ops.push({ img: f.img, x: f.x, y: f.y, alpha: 1, scale: f.scale });
  }

  // 走子动画：抬起的棋子与落影画在最上层（先落影后棋子，保证棋子压在投影之上）
  if (v.anim) {
    const f = moveAnimFrame(v.anim, skin, v.flip);
    if (f.shadow) ops.push({ shadow: true, ...f.shadow });
    ops.push({ img: f.img, x: f.x, y: f.y, alpha: 1, scale: f.scale });
  }

  return ops;
}

/** 脉冲环的瞬时透明度（time 为毫秒时间戳） */
function ringAlpha(op: RingOp, time: number): number {
  if (!op.pulse) return op.alpha;
  return op.alpha * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time / 260)));
}

/** 把一帧绘制计划画到画布上 */
export function renderBoard(
  canvas: HTMLCanvasElement,
  v: BoardView,
  skin: Skin,
  images: Record<string, HTMLImageElement>,
  time = 0,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // 内部尺寸固定为皮肤尺寸（与参考项目一致），显示尺寸交给 CSS 响应式缩放
  if (canvas.width !== skin.width) canvas.width = skin.width;
  if (canvas.height !== skin.height) canvas.height = skin.height;
  ctx.clearRect(0, 0, skin.width, skin.height);

  for (const op of computeDrawList(v, skin)) {
    if ('ring' in op) {
      ctx.save();
      ctx.globalAlpha = ringAlpha(op, time);
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      ctx.beginPath();
      ctx.arc(op.cx, op.cy, op.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if ('shadow' in op) {
      // 走子抬起时的落影：贴地的椭圆黑影，随抬起高度变淡变大
      ctx.save();
      ctx.globalAlpha = op.alpha;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(op.cx, op.cy, op.rx, op.ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }
    const img = images[op.img];
    if (!img || !img.complete || img.naturalWidth === 0) continue;
    ctx.save();
    ctx.globalAlpha = op.alpha ?? 1;
    const scale = op.scale ?? 1;
    if (scale === 1) {
      ctx.drawImage(img, op.x, op.y);
    } else {
      // 以素材圆盘中心为锚点缩放（抬起放大时棋子不跑位）
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, op.x + skin.discX * (1 - scale), op.y + skin.discY * (1 - scale), w, h);
    }
    ctx.restore();
  }
}

/** 图片加载结果缓存（同一皮肤只加载一次） */
const imageCache = new Map<SkinId, Promise<Record<string, HTMLImageElement>>>();

/** 预加载一套皮肤的全部素材（失败也不阻塞：缺图会跳过绘制） */
export function loadSkinImages(skin: Skin): Promise<Record<string, HTMLImageElement>> {
  const cached = imageCache.get(skin.id);
  if (cached) return cached;
  const loading = Promise.all(
    IMAGE_KEYS.map(
      (key) =>
        new Promise<[string, HTMLImageElement]>((resolve) => {
          const img = new Image();
          img.onload = () => resolve([key, img]);
          img.onerror = () => resolve([key, img]);
          img.src = assetUrl(skin, key);
        }),
    ),
  ).then((entries) => Object.fromEntries(entries));
  imageCache.set(skin.id, loading);
  return loading;
}
