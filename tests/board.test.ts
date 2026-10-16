/**
 * 棋盘渲染测试（Canvas 绘制计划为纯数据，与 DOM 解耦）。
 * 覆盖：皮肤几何参数、素材路径、坐标换算与命中、棋子/落点/上一步/将军/悬停绘制计划、视角翻转、
 * 走子动画（抬起 → 移动 → 放下）的一帧几何与绘制计划。
 */

import { describe, expect, it } from 'vitest';
import {
  ArrowOp,
  DEFAULT_SKIN,
  DiscOp,
  HINT_COLOR,
  HINT_TARGET_COLOR,
  HINT_THREAT_COLOR,
  IMAGE_KEYS,
  SKINS,
  SKIN_IDS,
  arrowSegment,
  assetUrl,
  boardBgUrl,
  canvasPoint,
  cellCenter,
  computeDrawList,
  DrawOp,
  isSkinId,
  liftFrame,
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

const draws = (ops: ReturnType<typeof computeDrawList>) => ops.filter((o): o is DrawOp => 'img' in o);
const rings = (ops: ReturnType<typeof computeDrawList>) => ops.filter((o): o is RingOp => 'ring' in o);
const arrows = (ops: ReturnType<typeof computeDrawList>) => ops.filter((o): o is ArrowOp => 'arrow' in o);
const discs = (ops: ReturnType<typeof computeDrawList>) => ops.filter((o): o is DiscOp => 'disc' in o);
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

  it('AI 推荐（复盘）：原棋子蓝环 + 指向落点的箭头 + 蓝色落点标记', () => {
    const ops = computeDrawList(view({ hint: { from: [9, 0], to: [7, 0] } }), skin2);
    const blue = rings(ops).filter((r) => r.color === HINT_COLOR);
    expect(blue).toHaveLength(2);
    // 起点 [9,0]：cx=30.5, cy=542（细环，标出「原来的棋子」）
    expect(blue[0]).toMatchObject({ cx: 30.5, cy: 542, radius: skin2.disc / 2 + 3, width: 2.5 });
    // 终点 [7,0]：cy=57*7+5+24=428（亮环略大于蓝盘）
    const discR = skin2.disc * 0.62;
    expect(blue[1]).toMatchObject({ cx: 30.5, cy: 428, radius: discR + 2, width: 3 });
    // 落点蓝色圆盘（半透明压在落点上 → 「蓝色棋子」观感）
    expect(discs(ops)).toHaveLength(1);
    expect(discs(ops)[0]).toMatchObject({ cx: 30.5, cy: 428, radius: discR, color: HINT_COLOR });
    // 箭头：从起点指向落点，杆末端停在蓝盘外缘
    const arrow = arrows(ops);
    expect(arrow).toHaveLength(1);
    expect(arrow[0]).toMatchObject({ x1: 30.5, y1: 542, x2: 30.5, color: HINT_COLOR });
    expect(arrow[0].y2).toBeCloseTo(428 + discR + 7, 5);
    // 不再借用素材提示点
    expect(findImage(ops, 'dot')).toHaveLength(0);
  });

  it('AI 推荐为吃子时同样只画蓝环 / 蓝盘 / 箭头（不叠加提示点）', () => {
    const ops = computeDrawList(view({ hint: { from: [9, 0], to: [3, 0] } }), skin2);
    expect(findImage(ops, 'dot')).toHaveLength(0);
    expect(rings(ops).filter((r) => r.color === HINT_COLOR)).toHaveLength(2);
    expect(discs(ops)).toHaveLength(1);
    expect(arrows(ops)).toHaveLength(1);
  });

  it('AI 推荐箭头随视角翻转（黑方视角坐标取反）', () => {
    const ops = computeDrawList(view({ hint: { from: [9, 0], to: [7, 0] }, flip: true }), skin2);
    const arrow = arrows(ops)[0];
    // 逻辑 [9,0] 翻转 → 视图 [0,8]：cx=57*8+3+27.5=486.5, cy=5+24=29
    expect(arrow.x1).toBe(486.5);
    expect(arrow.y1).toBe(29);
    expect(discs(ops)[0]).toMatchObject({ cx: 486.5, cy: 57 * 2 + 5 + 24 });
  });
});

describe('箭头几何 arrowSegment（AI 推荐箭头杆）', () => {
  it('把线段末端按 gap 收进，方向不变', () => {
    expect(arrowSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 20)).toEqual({ x1: 0, y1: 0, x2: 80, y2: 0 });
    const up = arrowSegment({ x: 30.5, y: 542 }, { x: 30.5, y: 428 }, 41.1);
    expect(up).toMatchObject({ x1: 30.5, y1: 542, x2: 30.5 });
    expect(up.y2).toBeCloseTo(469.1, 5);
  });

  it('gap 不小于线段长度时退化为零长（不会反向指回）', () => {
    expect(arrowSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 40)).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });

  it('两点重合不产生 NaN', () => {
    expect(arrowSegment({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toEqual({ x1: 5, y1: 5, x2: 5, y2: 5 });
  });
});

describe('吃子提示环（BoardView.capture）', () => {
  it('绿色环标记可吃的对方棋子、红色环标记会被吃的己方棋子', () => {
    const ops = computeDrawList(view({ capture: { targets: [[3, 0]], threats: [[6, 0]] } }), skin2);
    const green = rings(ops).filter((r) => r.color === HINT_TARGET_COLOR);
    const red = rings(ops).filter((r) => r.color === HINT_THREAT_COLOR);
    // 半径 = 圆盘直径 / 2 + 4；贴图中心 = 57*列 + 30.5 / 57*行 + 29
    expect(green).toEqual([
      { ring: true, cx: 30.5, cy: 200, radius: 27.5, color: HINT_TARGET_COLOR, width: 3, alpha: 0.9 },
    ]);
    expect(red).toEqual([
      { ring: true, cx: 30.5, cy: 371, radius: 27.5, color: HINT_THREAT_COLOR, width: 3, alpha: 0.9 },
    ]);
  });

  it('多枚棋子 / 双方分别标记时不遗漏（每点一个环）', () => {
    const ops = computeDrawList(
      view({
        capture: {
          targets: [
            [3, 0],
            [7, 2],
          ],
          threats: [[6, 0]],
        },
      }),
      skin2,
    );
    expect(rings(ops).filter((r) => r.color === HINT_TARGET_COLOR)).toEqual([
      { ring: true, cx: 30.5, cy: 200, radius: 27.5, color: HINT_TARGET_COLOR, width: 3, alpha: 0.9 },
      { ring: true, cx: 144.5, cy: 428, radius: 27.5, color: HINT_TARGET_COLOR, width: 3, alpha: 0.9 },
    ]);
    expect(rings(ops).filter((r) => r.color === HINT_THREAT_COLOR)).toHaveLength(1);
  });

  it('黑方视角翻转后提示环坐标随之翻转', () => {
    const ops = computeDrawList(view({ flip: true, capture: { targets: [[3, 0]], threats: [] } }), skin2);
    // 逻辑 [3,0] → 视图 [6,8]：cx = 57*8 + 30.5 = 486.5，cy = 57*6 + 29 = 371
    expect(rings(ops).filter((r) => r.color === HINT_TARGET_COLOR)).toEqual([
      { ring: true, cx: 486.5, cy: 371, radius: 27.5, color: HINT_TARGET_COLOR, width: 3, alpha: 0.9 },
    ]);
  });

  it('未开启提示（capture 省略 / null）时不画任何提示环', () => {
    const off = rings(computeDrawList(view({ capture: null }), skin2));
    expect(off.some((r) => r.color === HINT_TARGET_COLOR || r.color === HINT_THREAT_COLOR)).toBe(false);
    expect(rings(computeDrawList(view(), skin2)).length).toBe(0);
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

  it('走子动画 startLifted：省去起身段，一开始就在抬起高度上平移', () => {
    const lifted = moveAnimFrame({ ...anim(0), startLifted: true }, skin2, false);
    expect(lifted.x).toBe(3); // 仍在起点
    expect(lifted.y).toBeCloseTo(347 - 23.94, 6); // 但已抬到空中
    expect(lifted.lift).toBe(1);
    expect(lifted.scale).toBeCloseTo(1.14, 6);
    // 同一进度下未抬起时还在贴盘 → 起身
    expect(moveAnimFrame(anim(0), skin2, false).lift).toBe(0);
    // 终点仍会正常放下
    const landed = moveAnimFrame({ ...anim(1), startLifted: true }, skin2, false);
    expect(landed.y).toBe(290);
    expect(landed.lift).toBe(0);
    expect(landed.shadow).toBeNull();
  });
});

describe('点击棋子抬起（liftFrame / BoardView.lifts）', () => {
  const rook: Piece = { t: 'R', s: 'r' };

  it('抬起帧：原地升起 + 放大 + 出现落影，进度越界夹到 0..1', () => {
    const rest = liftFrame([6, 0], rook, 0, skin2, false);
    expect(rest).toMatchObject({ img: 'r_c', x: 3, y: 347, scale: 1, lift: 0, shadow: null });

    const up = liftFrame([6, 0], rook, 1, skin2, false);
    expect(up.y).toBeCloseTo(347 - 23.94, 6);
    expect(up.scale).toBeCloseTo(1.14, 6);
    expect(up.lift).toBe(1);
    expect(up.shadow).not.toBeNull();
    expect(up.shadow!.cy).toBeCloseTo(347 + 24, 6);

    expect(liftFrame([6, 0], rook, -1, skin2, false).lift).toBe(0);
    expect(liftFrame([6, 0], rook, 2, skin2, false).lift).toBe(1);
  });

  it('黑方视角：抬起帧坐标随翻转（[6,0] → 视图 [3,8]）', () => {
    const up = liftFrame([6, 0], rook, 1, skin2, true);
    expect(up.x).toBe(459); // 3 + 57*8
    expect(up.y).toBeCloseTo(176 - 23.94, 6); // 5 + 57*3 − 抬起高度
  });

  it('绘制计划：抬起的棋子原地不再静态贴图，改由抬起帧绘制在最上层并带落影', () => {
    const b = emptyBoard();
    b[6][0] = rook;
    const ops = computeDrawList(view({ board: b, selected: [6, 0], lifts: [{ pos: [6, 0], t: 1 }] }), skin2);
    const pieces = draws(ops).filter((o) => o.img === 'r_c');
    expect(pieces).toHaveLength(1);
    expect(pieces[0].scale).toBeCloseTo(1.14, 6);
    // 静态贴图（alpha 0.75 的选中压暗）已被跳过
    expect(draws(ops).some((o) => o.img === 'r_c' && o.alpha === 0.75)).toBe(false);
    const shadowIdx = ops.findIndex((o) => 'shadow' in o);
    const pieceIdx = ops.findIndex((o) => !('ring' in o) && !('shadow' in o) && o.img === 'r_c');
    expect(pieceIdx).toBeGreaterThan(shadowIdx);
  });

  it('无抬起时棋子照常静态贴图（含选中压暗）', () => {
    const b = emptyBoard();
    b[6][0] = rook;
    const ops = computeDrawList(view({ board: b, selected: [6, 0] }), skin2);
    expect(draws(ops)).toContainEqual({ img: 'r_c', x: 3, y: 347, alpha: 0.75 });
    expect(ops.some((o) => 'shadow' in o)).toBe(false);
  });

  it('抬起帧找不到棋子时跳过（起子已离场的过渡帧）', () => {
    const b = emptyBoard();
    const ops = computeDrawList(view({ board: b, lifts: [{ pos: [6, 0], t: 1 }] }), skin2);
    expect(ops.some((o) => 'shadow' in o)).toBe(false);
    expect(draws(ops).every((o) => !o.img.startsWith('r_'))).toBe(true);
  });
});
