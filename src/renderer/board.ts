/**
 * 棋盘渲染（SVG）。纯渲染，不含规则与网络逻辑。
 * 支持黑方视角翻转：逻辑坐标 (r,c) 与视图坐标互换。
 */

import { Board, PieceType, Pos, Side } from '../shared/types.js';

export const CELL = 56;
export const PAD = 34;
export const R = 24;
export const VBW = 8 * CELL + PAD * 2; // 516
export const VBH = 9 * CELL + PAD * 2; // 572

const NAME: Record<Side, Record<PieceType, string>> = {
  r: { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵' },
  b: { K: '将', A: '士', B: '象', N: '马', R: '车', C: '炮', P: '卒' },
};

const X = (c: number) => PAD + c * CELL;
const Y = (r: number) => PAD + r * CELL;

/** 逻辑坐标 → 视图坐标（flip 时上下左右翻转） */
export function toView([r, c]: Pos, flip: boolean): Pos {
  return flip ? [9 - r, 8 - c] : [r, c];
}

/** 视图坐标 → 逻辑坐标 */
export function toLogic([vr, vc]: Pos, flip: boolean): Pos {
  return flip ? [9 - vr, 8 - vc] : [vr, vc];
}

export interface BoardView {
  board: Board;
  selected: Pos | null;
  moves: Pos[];
  lastMove: { from: Pos; to: Pos } | null;
  flip: boolean;
}

/** 把点击位置（SVG 内部坐标）映射为逻辑棋盘坐标；不在有效落点返回 null */
export function pickCell(px: number, py: number, flip: boolean): Pos | null {
  const vc = Math.round((px - PAD) / CELL);
  const vr = Math.round((py - PAD) / CELL);
  if (vr < 0 || vr > 9 || vc < 0 || vc > 8) return null;
  if (Math.hypot(px - X(vc), py - Y(vr)) > CELL * 0.52) return null;
  return toLogic([vr, vc], flip);
}

/** 把鼠标 / 触摸的客户端坐标换算为 SVG viewBox 内部坐标 */
export function svgPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height) || 1;
  const offX = (rect.width - vb.width * scale) / 2;
  const offY = (rect.height - vb.height * scale) / 2;
  return {
    x: (clientX - rect.left - offX) / scale,
    y: (clientY - rect.top - offY) / scale,
  };
}

export function renderBoard(svg: SVGSVGElement, v: BoardView): void {
  let h = '';
  h += `<rect x="0" y="0" width="${VBW}" height="${VBH}" fill="#e9cb8d" rx="6"/>`;
  h += `<rect x="4" y="4" width="${VBW - 8}" height="${VBH - 8}" fill="none" stroke="#c9a768" stroke-width="1" rx="5" opacity=".6"/>`;

  const line = (x1: number, y1: number, x2: number, y2: number, w = 1.4, op = 0.8) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b4f2a" stroke-width="${w}" opacity="${op}" stroke-linecap="round"/>`;

  for (let i = 0; i < 10; i++) h += line(X(0), Y(i), X(8), Y(i));
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) {
      h += line(X(c), Y(0), X(c), Y(9));
    } else {
      h += line(X(c), Y(0), X(c), Y(4));
      h += line(X(c), Y(5), X(c), Y(9));
    }
  }
  // 九宫斜线
  h += line(X(3), Y(0), X(5), Y(2));
  h += line(X(5), Y(0), X(3), Y(2));
  h += line(X(3), Y(7), X(5), Y(9));
  h += line(X(5), Y(7), X(3), Y(9));
  h += `<rect x="${X(0)}" y="${Y(0)}" width="${8 * CELL}" height="${9 * CELL}" fill="none" stroke="#6b4f2a" stroke-width="2.6"/>`;

  h += `<text x="${X(2)}" y="${Y(4.5) + 9}" text-anchor="middle" font-size="23" fill="#8a6b3f" opacity=".55" letter-spacing="8" font-family="serif">楚河</text>`;
  h += `<text x="${X(6)}" y="${Y(4.5) + 9}" text-anchor="middle" font-size="23" fill="#8a6b3f" opacity=".55" letter-spacing="8" font-family="serif">汉界</text>`;

  // 上一步高亮
  if (v.lastMove) {
    for (const pos of [v.lastMove.from, v.lastMove.to]) {
      const [vr, vc] = toView(pos, v.flip);
      h += `<circle cx="${X(vc)}" cy="${Y(vr)}" r="${R + 5}" fill="none" stroke="#d4a017" stroke-width="2.5" opacity=".65"/>`;
    }
  }

  // 合法落点
  for (const pos of v.moves) {
    const [vr, vc] = toView(pos, v.flip);
    if (v.board[pos[0]][pos[1]]) {
      h += `<circle cx="${X(vc)}" cy="${Y(vr)}" r="${R + 3}" fill="none" stroke="#2e8b57" stroke-width="3.2" opacity=".9"/>`;
    } else {
      h += `<circle cx="${X(vc)}" cy="${Y(vr)}" r="7" fill="#2e8b57" opacity=".55"/>`;
    }
  }

  // 棋子
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = v.board[r][c];
      if (!p) continue;
      const [vr, vc] = toView([r, c], v.flip);
      const x = X(vc);
      const y = Y(vr);
      const red = p.s === 'r';
      const stroke = red ? '#b3261e' : '#22303c';
      const fill = red ? '#fdf2e0' : '#f6f2ea';
      h += `<g>
        <circle cx="${x}" cy="${y + 2}" r="${R}" fill="rgba(60,40,15,.22)"/>
        <circle cx="${x}" cy="${y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="2.1"/>
        <circle cx="${x}" cy="${y}" r="${R - 4.5}" fill="none" stroke="${stroke}" stroke-width="1" opacity=".4"/>
        <text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central"
              font-size="25" font-weight="700" fill="${stroke}"
              font-family="'PingFang SC','Microsoft YaHei',serif">${NAME[p.s][p.t]}</text>
      </g>`;
    }
  }

  // 选中环
  if (v.selected) {
    const [vr, vc] = toView(v.selected, v.flip);
    h += `<circle cx="${X(vc)}" cy="${Y(vr)}" r="${R + 4}" fill="none" stroke="#f0b429" stroke-width="3.5"/>`;
  }

  svg.innerHTML = h;
}