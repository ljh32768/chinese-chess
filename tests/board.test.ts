/**
 * 棋盘渲染测试（Canvas 绘制计划为纯数据，与 DOM 解耦）。
 * 覆盖：皮肤几何参数、素材路径、坐标换算与命中、棋子/落点/上一步/将军/悬停绘制计划、视角翻转、
 * 走子动画（抬起 → 移动 → 放下）的一帧几何与绘制计划。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SKIN,
  IMAGE_KEYS,
  SKINS,
  SKIN_IDS,
  assetUrl,
  boardBgUrl,
  canvasPoint,
  cellCenter,
  computeDrawList,
  DrawOp,
  isSkinId,
  moveAnimFrame,
  nextSkin,
  pickCell,
  RingOp,
  toLogic,
  toView,
} from '../src/renderer/board.js';
import { BoardView, MoveAnim } from '../src/renderer/board.js';
import { initBoard } from '../src/shared/rules.js';
import { Board, Piece } from '../src/shared/types.js';

const skin2 = SKINS.stype2;

/** 空棋盘 */
const emptyBoard = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null));

/** 构造默认视图参数，可用 over 覆盖 */
const view = (over: Partial<BoardView> = {}): BoardView => ({
  board: initBoard(),
  selected: null,
  moves: [],
  lastMove: null,
  flip: false,
  ...over,
});

const draws = (ops: ReturnType<typeof computeDrawList>) => ops.filter((o): o is DrawOp => !('ring' in o));
const rings = (ops: ReturnType<typeof computeDrawList>) => ops.filter((o): o is RingOp => 'ring' in o);
const findImage = (ops: ReturnType<typeof computeDrawList>, img: string) =>
  draws(ops).filter((o) => o.img === img);

describe('皮肤定义（对齐参考项目几何参数）', () => {
  it('三套皮肤的画布尺寸与格距与参考项目一致', () => {
    expect(SKIN_IDS).toEqual(['stype1', 'stype2', 'stype3']);
    expect(SKINS.stype1).toMatchObject({
      width: 325,
      height: 403,
      spaceX: 35,
      spaceY: 36,
      pointStartX: 5,
      pointStartY: 19,
      page: 'stype_1',
    });
    expect(SKINS.stype2).toMatchObject({
      width: 523,
      height: 580,
      spaceX: 57,
      spaceY: 57,
      pointStartX: 3,
      pointStartY: 5,
      page: 'stype_2',
    });
    expect(SKINS.stype3).toMatchObject({
      width: 530,
      height: 567,
      spaceX: 57,
      spaceY: 57,
      pointStartX: -2,
      pointStartY: 0,
      page: 'stype_3',
    });
  });

  it('更换皮肤按 stype1 → stype2 → stype3 → stype1 循环', () => {
    expect(nextSkin('stype1')).toBe('stype2');
    expect(nextSkin('stype2')).toBe('stype3');
    expect(nextSkin('stype3')).toBe('stype1');
    expect(isSkinId(DEFAULT_SKIN)).toBe(true);
    expect(isSkinId('stype9')).toBe(false);
    expect(isSkinId(null)).toBe(false);
  });

  it('素材路径指向皮肤目录，加载清单含棋盘/提示点/落点框与两方十四枚棋子', () => {
    expect(assetUrl(skin2, 'bg')).toBe('./assets/img/stype_2/bg.png');
    expect(assetUrl(skin2, 'r_c')).toBe('./assets/img/stype_2/r_c.png');
    expect(boardBgUrl(SKINS.stype3)).toBe('./assets/img/stype_3/bg.jpg');
    expect(IMAGE_KEYS).toHaveLength(3 + 14);
    expect(IMAGE_KEYS).toContain('dot');
    expect(IMAGE_KEYS).toContain('b_z');
  });
});

describe('坐标换算与命中 pickCell', () => {
  it('视角翻转：逻辑坐标与视图坐标互转', () => {
    expect(toView([0, 0], false)).toEqual([0, 0]);
    expect(toView([0, 0], true)).toEqual([9, 8]);
    expect(toLogic(toView([6, 3], true), true)).toEqual([6, 3]);
  });

  it('交叉点视觉中心 = 贴图起点 + 素材圆盘偏移', () => {
    expect(cellCenter([0, 0], skin2)).toEqual({ x: 30.5, y: 29 });
    expect(cellCenter([9, 4], skin2)).toEqual({ x: 258.5, y: 542 });
  });

  it('点击交叉点中心命中对应格子', () => {
    const { x, y } = cellCenter([0, 0], skin2);
    expect(pickCell(x, y, skin2, false)).toEqual([0, 0]);
    const p = cellCenter([7, 3], skin2);
    expect(pickCell(p.x, p.y, skin2, false)).toEqual([7, 3]);
  });

  it('黑方视角下同一画布位置映射到翻转后的逻辑坐标', () => {
    const { x, y } = cellCenter([0, 0], skin2);
    expect(pickCell(x, y, skin2, true)).toEqual([9, 8]);
  });

  it('棋盘范围外的点击返回 null', () => {
    expect(pickCell(-100, -100, skin2, false)).toBeNull();
    expect(pickCell(skin2.width + 200, skin2.height + 200, skin2, false)).toBeNull();
    // 右下角越界（超过第 9 行 / 第 8 列）
    const { x, y } = cellCenter([9, 8], skin2);
    expect(pickCell(x, y, skin2, false)).toEqual([9, 8]);
    expect(pickCell(x + skin2.spaceX * 1.2, y, skin2, false)).toBeNull();
  });

  it('canvasPoint 按画布显示尺寸等比换算（响应式缩放后点击仍准确）', () => {
    const fake = {
      getBoundingClientRect: () => ({ left: 10, top: 20, width: skin2.width / 2, height: skin2.height / 2 }),
    } as unknown as HTMLCanvasElement;
    expect(canvasPoint(fake, 10 + 50, 20 + 60, skin2)).toEqual({ x: 100, y: 120 });
  });
});

describe('绘制计划 computeDrawList', () => {
  it('第一层永远是棋盘底图', () => {
    const ops = computeDrawList(view(), skin2);
    expect(ops[0]).toEqual({ img: 'bg', x: 0, y: 0 });
  });

  it('开局渲染红黑各十六枚棋子（帅仕相马车炮兵 / 将士象马车炮卒）', () => {
    const ops = computeDrawList(view(), skin2);
    expect(findImage(ops, 'r_j')).toHaveLength(1);
    expect(findImage(ops, 'b_j')).toHaveLength(1);
    expect(draws(ops).filter((o) => o.img.startsWith('r_'))).toHaveLength(16);
    expect(draws(ops).filter((o) => o.img.startsWith('b_'))).toHaveLength(16);
  });

  it('棋子按参考项目公式贴图（space*坐标 + pointStart）', () => {
    const ops = computeDrawList(view(), skin2);
    // 开局红车位于逻辑 [9,0] → 视图 [9,0] → x=3, y=57*9+5=518
    expect(findImage(ops, 'r_c')).toContainEqual({ img: 'r_c', x: 3, y: 518, alpha: 1 });
  });

  it('视角翻转后棋子贴图坐标随之翻转', () => {
    const ops = computeDrawList(view({ flip: true }), skin2);
    // 逻辑 [9,0] 翻转后为视图 [0,8] → x=57*8+3=459, y=5
    expect(findImage(ops, 'r_c')).toContainEqual({ img: 'r_c', x: 459, y: 5, alpha: 1 });
  });

  it('上一步走子在起点与终点绘制落点框', () => {
    const ops = computeDrawList(view({ lastMove: { from: [6, 0], to: [5, 0] } }), skin2);
    expect(findImage(ops, 'box')).toEqual([
      { img: 'box', x: 3, y: 347 },
      { img: 'box', x: 3, y: 290 },
    ]);
  });

  it('选中棋子：落点框 + 棋子压暗一档', () => {
    const ops = computeDrawList(view({ selected: [6, 0] }), skin2);
    expect(findImage(ops, 'box')).toEqual([{ img: 'box', x: 3, y: 347 }]);
    // [6,0] 是红兵 → 素材 r_z，坐标 3 / 347，被选中压暗到 0.75
    expect(findImage(ops, 'r_z')).toContainEqual({ img: 'r_z', x: 3, y: 347, alpha: 0.75 });
  });

  it('合法落点：空位画提示点（叠加固定偏移），可吃子改画空心环', () => {
    const b = emptyBoard();
    b[5][0] = { t: 'R', s: 'r' };
    b[4][4] = { t: 'P', s: 'b' };
    const ops = computeDrawList(
      view({
        board: b,
        moves: [
          [4, 0],
          [4, 4],
        ],
      }),
      skin2,
    );
    // 空位 [4,0]：x=3+10=13, y=57*4+5+10=243
    expect(findImage(ops, 'dot')).toEqual([{ img: 'dot', x: 13, y: 243 }]);
    // 可吃子 [4,4]：画在棋子之上的空心环
    const cap = rings(ops).find((r) => !r.pulse && r.color === '#c0392b');
    expect(cap).toMatchObject({ cx: 258.5, cy: 257, radius: skin2.disc / 2 + 2 });
  });

  it('将军：将帅位置绘制红色脉冲警示环', () => {
    const ops = computeDrawList(view({ checkKing: [9, 4] }), skin2);
    expect(rings(ops)).toContainEqual({
      ring: true,
      cx: 258.5,
      cy: 542,
      radius: skin2.disc / 2 + 6,
      color: '#e23b2e',
      width: 3.5,
      alpha: 0.85,
      pulse: true,
    });
  });

  it('黑方视角翻转后警示环坐标随之翻转', () => {
    const ops = computeDrawList(view({ checkKing: [0, 3], flip: true }), skin2);
    // 逻辑 [0,3] 翻转后视图为 [9,5] → cx=57*5+3+27.5=315.5, cy=542
    expect(rings(ops).find((r) => r.pulse)).toMatchObject({ cx: 315.5, cy: 542 });
  });

  it('悬停预高亮：本方可操作时给己方棋子 / 合法落点画金色环', () => {
    const own = computeDrawList(view({ hover: [9, 0], interactiveSide: 'r' }), skin2);
    expect(rings(own).some((r) => !r.pulse && r.color === '#f0b429')).toBe(true);

    const move = computeDrawList(view({ hover: [4, 0], moves: [[4, 0]], interactiveSide: 'r' }), skin2);
    expect(rings(move).some((r) => !r.pulse && r.color === '#f0b429')).toBe(true);
  });

  it('不可操作 / 悬停对方棋子时不画悬停环', () => {
    expect(rings(computeDrawList(view({ hover: [9, 0], interactiveSide: null }), skin2))).toHaveLength(0);
    expect(rings(computeDrawList(view({ hover: [0, 0], interactiveSide: 'r' }), skin2))).toHaveLength(0);
  });

  it('AI 推荐（复盘）：起点细金环、终点粗金环，落点为空时叠加提示点', () => {
    const ops = computeDrawList(view({ hint: { from: [9, 0], to: [7, 0] } }), skin2);
    const gold = rings(ops).filter((r) => r.color === '#f0b429');
    expect(gold).toHaveLength(2);
    // 起点 [9,0]：cx=30.5, cy=542；终点 [7,0]：cy=57*7+5+24=428
    expect(gold[0]).toMatchObject({ cx: 30.5, cy: 542, width: 2.5 });
    expect(gold[1]).toMatchObject({ cx: 30.5, cy: 428, width: 3.5 });
    // 落点为空 → 提示点（3+10 / 57*7+5+10）
    expect(findImage(ops, 'dot')).toEqual([{ img: 'dot', x: 13, y: 414, alpha: 0.9 }]);
  });

  it('AI 推荐为吃子时不叠加提示点（避免提示点被棋子遮住）', () => {
    const ops = computeDrawList(view({ hint: { from: [9, 0], to: [3, 0] } }), skin2);
    expect(findImage(ops, 'dot')).toHaveLength(0);
    expect(rings(ops).filter((r) => r.color === '#f0b429')).toHaveLength(2);
  });
});

describe('走子动画（抬起 → 移动 → 放下）', () => {
  const rook: Piece = { t: 'R', s: 'r' };
  /** 红车 [6,0] → [5,0] 的动画（起点 y=347，终点 y=290；格距 57、圆盘偏移 3/24） */
  const anim = (t: number): MoveAnim => ({ from: [6, 0], to: [5, 0], piece: rook, t });

  it('抬起前（t=0）：棋子仍在起点、未放大、无落影', () => {
    const f = moveAnimFrame(anim(0), skin2, false);
    expect(f.img).toBe('r_c');
    expect(f.x).toBe(3);
    expect(f.y).toBe(347);
    expect(f.scale).toBe(1);
    expect(f.lift).toBe(0);
    expect(f.shadow).toBeNull();
  });

  it('移动中（t=0.5）：抬起高度与放大同时生效，落影出现在棋子下方的盘面上', () => {
    const f = moveAnimFrame(anim(0.5), skin2, false);
    // 平移进度 easeInOut(0.5)=0.5：x=3，y 基准 = (347+290)/2 = 318.5；抬起 57*0.42=23.94
    expect(f.x).toBeCloseTo(3, 6);
    expect(f.y).toBeCloseTo(318.5 - 23.94, 6);
    expect(f.scale).toBeCloseTo(1.14, 6);
    expect(f.lift).toBe(1);
    expect(f.shadow).not.toBeNull();
    // 落影贴在盘面（不含抬起位移）：cy = 318.5 + discY(24) = 342.5
    expect(f.shadow!.cy).toBeCloseTo(342.5, 6);
    expect(f.shadow!.rx).toBeCloseTo(47 * 0.64, 6);
    expect(f.shadow!.alpha).toBeCloseTo(0.34, 6);
  });

  it('放下完成（t=1）：落回终点、恢复原大、落影消失', () => {
    const f = moveAnimFrame(anim(1), skin2, false);
    expect(f.x).toBe(3);
    expect(f.y).toBe(290);
    expect(f.scale).toBe(1);
    expect(f.lift).toBe(0);
    expect(f.shadow).toBeNull();
  });

  it('进度越界会被夹到 0..1', () => {
    expect(moveAnimFrame(anim(-1), skin2, false).y).toBe(347);
    expect(moveAnimFrame(anim(2), skin2, false).y).toBe(290);
  });

  it('黑方视角：动画坐标随翻转（[5,0] 翻转后为视图 [4,8]）', () => {
    const f = moveAnimFrame(anim(1), skin2, true);
    expect(f.x).toBe(459);
    expect(f.y).toBe(233);
  });

  it('纯函数：不改动传入的动画对象', () => {
    const a = anim(0.5);
    moveAnimFrame(a, skin2, false);
    expect(a.t).toBe(0.5);
    expect(a.piece).toEqual(rook);
  });

  it('绘制计划：动画中的棋子在终点格不再静态贴图，改由动画帧单独绘制并带落影', () => {
    const b = emptyBoard();
    b[5][0] = rook;
    const ops = computeDrawList(
      view({ board: b, lastMove: { from: [6, 0], to: [5, 0] }, anim: anim(0.5) }),
      skin2,
    );
    // 终点格静态贴图被跳过：全盘只剩动画帧这一枚 r_c
    const pieces = draws(ops).filter((o) => o.img === 'r_c');
    expect(pieces).toHaveLength(1);
    expect(pieces[0].scale).toBeCloseTo(1.14, 6);
    // 抬起时有落影，且落影画在棋子之前（棋子压在投影之上）
    const shadowIdx = ops.findIndex((o) => 'shadow' in o);
    const pieceIdx = ops.findIndex((o) => !('ring' in o) && !('shadow' in o) && o.img === 'r_c');
    expect(shadowIdx).toBeGreaterThan(-1);
    expect(pieceIdx).toBeGreaterThan(shadowIdx);
  });

  it('无动画时不产生落影，棋子也不带缩放', () => {
    const b = emptyBoard();
    b[5][0] = rook;
    const ops = computeDrawList(view({ board: b, lastMove: { from: [6, 0], to: [5, 0] } }), skin2);
    expect(ops.some((o) => 'shadow' in o)).toBe(false);
    expect(draws(ops).every((o) => o.scale === undefined)).toBe(true);
  });
});
