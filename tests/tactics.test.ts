/**
 * 战术模块测试（纯函数，与 DOM / 网络解耦）。两部分：
 * 1) 吃子提示分析：开局无提示、无根白吃、有根小换大（须净赚 ≥1 分：马换炮 0.5 分不算）、
 *    等价交换不提示、将帅不参与提示、
 *    将守护的子（将不能安全吃回 → 按无根；能安全吃回 → 按有根）、红黑对称（绿色目标 = 对方视角的红色威胁）、纯函数性。
 * 2) 战术识别（闪击 / 闪将 / 将军抽 / 串打 / 捉双）：手工构造局面 → 走子 → 断言命中与「被威胁棋子」；
 *    严格判定顺序先看是否照将——照将走「闪将 / 将军抽」（**将军抽 = 将军的子本人**同时新咬到 / 抽出大子
 *    ——「将军同时还攻击大子」；**闪将 = 闪开的子让线、将军由藏在后面的子发出**：① 移开的子本人将军 +
 *    藏在后面的子因让线新捉到大子；② 移开的子不将军、由让线露出的车 / 炮成将。只将军而不抽大子
 *    不做战术提示；被抽子可含将后同线大子，且被抽子须是本步**新造**的威胁——走子前就已能吃到的子不算；
 *    照将须由**真棋子**造成——让线的后方攻击子只认车 / 炮，帅 / 将照面不算，兵 / 士 / 象也不算；
 *    炮还须**让开炮口**（v3.35）——移开的子须原在炮架与将之间；夹在炮与炮架之间时走子只是补足炮架
 *    （挡子 2 → 1）→ 普通将军，不算闪将；
 *    移开的子本人也将军的双将情形归闪将①，未抽到大子时不做提示），
 *    不照将走「串打 / 捉双 / 闪击」。所有战术的攻击还须**能合法吃到**（`legalMoves` 过滤送将 / 照面）；
 *    **v3.31 起「有根」不算赢到子**：串打要求前 / 后两枚都**无根**（任一枚有根即可被对方等值交换守住）；
 *    **v3.34 起捉双同样要求每一枚被捉子都无根**（有根即属兑子，不再按「小换大」获利口径放行）；
 *    将军抽 / 闪击沿用吃子提示的获利口径（无根，或小换大净赚 ≥1 分——马 4 换有根炮 4.5 不算）；
 *    闪击还须「双向双威胁」：让线露出的攻击 + 移开的子自身也捉到大子，且**被威胁子只算车 / 马 / 炮**、
 *    两处攻击都须是能合法吃到的真威胁（移开的子被牵制、看起来够得着却吃不过去时不算，不判闪击）；
 *    另含反例（让线被挡 / 目标价值过低 / 非新攻击 / 只让线而移子的子不捉子 / 原本就能吃到的子后将军 /
 *    被抽子可蹩马腿两全 / 将死返回空 / 只出 1 条 / 不改动棋盘 / 红黑对称）。
 */

import { describe, expect, it } from 'vitest';
import {
  PIECE_VALUE,
  TacticHit,
  captureHints,
  detectTactics,
  profitableTargets,
} from '../src/shared/tactics.js';
import { boardAfterMove, initBoard, judgeAfterMove } from '../src/shared/rules.js';
import { Board, Move, PieceType, Pos, Side } from '../src/shared/types.js';

/** 空棋盘 */
const emptyBoard = (): Board => Array.from({ length: 10 }, () => Array(9).fill(null));

/** 落子 */
const put = (b: Board, r: number, c: number, t: PieceType, s: Side): void => {
  b[r][c] = { t, s };
};

/** 放双方将帅（不同纵线，避免将帅照面影响走法生成） */
const withKings = (b: Board): Board => {
  put(b, 9, 4, 'K', 'r');
  put(b, 0, 3, 'K', 'b');
  return b;
};

/**
 * 用户截图局面（v3.10 回归）：红马 (2,2) 照将并咬住 (3,4) 的黑炮，
 * 但该炮受黑马 (1,5) 保护——马 4 换炮 4.5 只差 0.5 分，属于几乎等值的交换。
 */
const screenshotBoard = (): Board => {
  const b = emptyBoard();
  put(b, 0, 3, 'K', 'b');
  put(b, 0, 5, 'A', 'b');
  put(b, 1, 4, 'A', 'b');
  put(b, 1, 5, 'N', 'b'); // 黑马：保护 (3,4) 的黑炮
  put(b, 2, 4, 'B', 'b');
  put(b, 3, 4, 'C', 'b'); // 截图里被绿环误标的炮
  put(b, 2, 8, 'B', 'b');
  put(b, 3, 8, 'P', 'b');
  put(b, 5, 0, 'P', 'b');
  put(b, 6, 0, 'P', 'b');
  put(b, 7, 5, 'R', 'b');
  put(b, 8, 4, 'K', 'r');
  put(b, 2, 2, 'N', 'r');
  put(b, 9, 2, 'B', 'r');
  put(b, 6, 8, 'P', 'r');
  return b;
};

const has = (ps: [number, number][], pos: [number, number]): boolean =>
  ps.some(([r, c]) => r === pos[0] && c === pos[1]);

describe('棋子价值表', () => {
  it('车 > 炮 > 马 > 士象 > 兵卒，帅/将用极大值兜底', () => {
    expect(PIECE_VALUE.R).toBeGreaterThan(PIECE_VALUE.C);
    expect(PIECE_VALUE.C).toBeGreaterThan(PIECE_VALUE.N);
    expect(PIECE_VALUE.N).toBeGreaterThan(PIECE_VALUE.B);
    expect(PIECE_VALUE.B).toBe(PIECE_VALUE.A);
    expect(PIECE_VALUE.B).toBeGreaterThan(PIECE_VALUE.P);
    expect(PIECE_VALUE.K).toBeGreaterThan(PIECE_VALUE.R);
  });
});

describe('开局局面', () => {
  it('双方开局都没有可获利吃子（既无绿环也无红环）', () => {
    const b = initBoard();
    expect(captureHints(b, 'r')).toEqual({ targets: [], threats: [] });
    expect(captureHints(b, 'b')).toEqual({ targets: [], threats: [] });
  });
});

describe('绿色目标：可以吃掉的对方棋子', () => {
  it('无根白吃：红车吃无保护的黑马（黑方无处反吃）', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b');
    const hints = captureHints(b, 'r');
    expect(hints.targets).toEqual([[5, 3]]);
    expect(hints.threats).toEqual([]);
  });

  it('小换大：红兵吃有黑马保护的黑车（价值 1 → 9，交换后净赚）', () => {
    const b = withKings(emptyBoard());
    put(b, 4, 3, 'P', 'r'); // 红兵过河，可向前吃 (3,3)
    put(b, 3, 3, 'R', 'b'); // 黑车
    put(b, 1, 2, 'N', 'b'); // 黑马护车（马腿 (2,2) 空）
    const hints = captureHints(b, 'r');
    // 黑车有根，但价值 9 > 最便宜攻击者（红兵 1）→ 小换大，标记绿色
    expect(hints.targets).toEqual([[3, 3]]);
    // 反过来：红兵无根且被黑车吃 → 对红方是红色威胁
    expect(hints.threats).toEqual([[4, 3]]);
  });

  it('小换大仍须明显获利：红马吃有黑马保护的黑车（4 → 9，净赚 5 分）→ 标绿', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 3, 'N', 'r'); // 红马
    put(b, 3, 2, 'R', 'b'); // 黑车（目标）
    put(b, 1, 1, 'N', 'b'); // 黑马护车（马腿 (2,1) 空）
    expect(profitableTargets(b, 'r')).toEqual([[3, 2]]);
  });

  it('马吃有根炮（4 → 4.5，只差 0.5 分）→ 不算小换大，不标绿（v3.10 截图回归）', () => {
    // 截图局面：红马 (2,2) 能吃到 (3,4) 的黑炮，但该炮有黑马 (1,5) 保护，一换一后几乎等价
    expect(profitableTargets(screenshotBoard(), 'r')).toEqual([]);
    expect(captureHints(screenshotBoard(), 'r').targets).toEqual([]);
  });

  it('等价交换不提示：有根的黑车与红车同价（一换一不赚）', () => {
    const b = withKings(emptyBoard());
    put(b, 4, 0, 'R', 'b'); // 黑车（目标）
    put(b, 0, 0, 'R', 'b'); // 黑车护它（同纵线，中间无子）
    put(b, 4, 8, 'R', 'r'); // 红车正对黑车
    const targets = profitableTargets(b, 'r');
    expect(targets).toEqual([]); // 价值相等且有根 → 不算小换大
  });

  it('炮不算保护：相邻的黑炮没有炮架，黑马仍算无根（红车可白吃）', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r'); // 红车（价值 9，比马贵）
    put(b, 5, 3, 'N', 'b'); // 黑马（价值 4，无根）
    put(b, 5, 4, 'C', 'b'); // 相邻黑炮：到 (5,3) 之间无炮架，吃不到
    const hints = captureHints(b, 'r');
    // 无根 → 白吃，标记绿色（若误把炮当成「有根」则价值 4 < 9 不会被标出）
    expect(hints.targets).toEqual([[5, 3]]);
  });

  it('炮有炮架时算保护：隔着黑卒的黑炮能反吃，黑马即有根（红车 9 vs 马 4 不赚）', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r'); // 红车 9
    put(b, 5, 3, 'N', 'b'); // 黑马 4（被黑炮保护）
    put(b, 5, 5, 'P', 'b'); // 黑卒：充当炮架（卒不能直接吃到 (5,3)）
    put(b, 5, 6, 'C', 'b'); // 黑炮：隔 (5,5) 的卒可反吃 (5,3)
    expect(profitableTargets(b, 'r')).toEqual([]); // 有根且价值不赚 → 不提示
  });

  it('将/帅不参与提示（可「吃到」对方将帅也不标记）', () => {
    const b = withKings(emptyBoard());
    put(b, 0, 0, 'R', 'r'); // 红车与黑将同在第 0 行且中间无子（黑方被将军）
    expect(profitableTargets(b, 'r')).toEqual([]);
  });

  it('将守护的子：将吃回后会被将军（送将非法）→ 该子按无根处理，标记绿色', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b'); // 黑将
    put(b, 0, 5, 'N', 'b'); // 目标：黑马（仅被黑将守护）
    put(b, 2, 4, 'N', 'r'); // 红马可跳吃 (0,5)（马腿 (1,4) 空），价值 4 = 黑马 4
    put(b, 0, 8, 'R', 'r'); // 红车同在第 0 行：黑将吃回后落在红车的将军线上 → 吃回非法
    put(b, 9, 3, 'K', 'r');
    expect(profitableTargets(b, 'r')).toEqual([[0, 5]]);
  });

  it('将守护的子：将能安全吃回 → 有根，不标记绿色（等价值一换一不赚）', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b');
    put(b, 0, 5, 'N', 'b');
    put(b, 2, 4, 'N', 'r');
    put(b, 9, 3, 'K', 'r'); // 无其它红子 → 黑将吃回后不被将军
    expect(profitableTargets(b, 'r')).toEqual([]);
  });

  it('将能安全吃回：不会把进攻子的原格误判为「仍在攻击」（有根判定正确）', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b'); // 黑将
    put(b, 1, 4, 'N', 'b'); // 目标：黑马（被黑将守护）
    put(b, 5, 4, 'R', 'r'); // 红车正对 (1,4)：吃过去后红车已被吃，黑将可安全吃回
    put(b, 9, 3, 'K', 'r');
    expect(profitableTargets(b, 'r')).toEqual([]); // 有根且马 4 < 车 9 → 不算小换大
  });

  it('将守护的子（红方视角）：红帅吃回后会被将军 → 红子成为红色威胁', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r'); // 红帅
    put(b, 9, 5, 'N', 'r'); // 红马（仅被红帅守护）
    put(b, 7, 4, 'N', 'b'); // 黑马可跳吃 (9,5)（马腿 (8,4) 空），价值 4 = 红马 4
    put(b, 9, 8, 'R', 'b'); // 黑车同在第 9 行：红帅吃回后落在黑车的将军线上 → 吃回非法
    put(b, 0, 3, 'K', 'b');
    expect(captureHints(b, 'r').threats).toContainEqual([9, 5]);
  });
});

describe('红色威胁与对称性', () => {
  it('红方视角的 threats 等于对方视角的 targets', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b');
    put(b, 4, 3, 'P', 'r');
    put(b, 3, 3, 'R', 'b');
    put(b, 1, 2, 'N', 'b');
    expect(captureHints(b, 'r').threats).toEqual(captureHints(b, 'b').targets);
    expect(captureHints(b, 'b').threats).toEqual(captureHints(b, 'r').targets);
  });

  it('黑方视角对称：黑车吃无根的红马', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 3, 'N', 'r');
    put(b, 5, 8, 'R', 'b');
    const hints = captureHints(b, 'b');
    expect(has(hints.targets, [5, 3])).toBe(true);
  });
});

describe('纯函数性', () => {
  it('不改动传入的棋盘', () => {
    const b = withKings(emptyBoard());
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b');
    const snapshot = JSON.stringify(b);
    captureHints(b, 'r');
    profitableTargets(b, 'b');
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});

/** 走一步并识别战术（返回识别结果） */
function run(before: Board, from: Pos, to: Pos): TacticHit[] {
  const after = boardAfterMove(before, from, to);
  return detectTactics(before, { from, to } as Move, after);
}

/** 双方将帅（红 7,3 / 黑 0,4 之外由用例另设） */
const kings = (b: Board, blackKing: Pos = [0, 4]): void => {
  put(b, 7, 3, 'K', 'r');
  put(b, blackKing[0], blackKing[1], 'K', 'b');
};

describe('闪将（discovered-check）', () => {
  it('让开一条线后车照将 → 闪将，被威胁者是将', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r'); // 红车
    put(b, 0, 2, 'N', 'r'); // 挡在车与将之间的红马（让开它）
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
    expect(hits[0].label).toBe('闪将');
    expect(hits[0].threats).toEqual([[0, 4]]);
  });

  it('让线被另一枚子挡住 → 不成立', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r'); // 走开
    put(b, 0, 3, 'N', 'r'); // 仍挡住车照将
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });

  it('炮架吃子后仍停在炮与将的连线上（并没有闪开）→ 不判闪将', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 5, 'K', 'b'); // 黑将（九宫内，炮换架后正好被照）
    put(b, 0, 0, 'C', 'r'); // 红炮
    put(b, 0, 1, 'R', 'r'); // 炮架（走动的子）
    put(b, 0, 3, 'N', 'b'); // 炮原先正打着的黑马
    put(b, 1, 3, 'P', 'b'); // 黑方另有子可走，避免被判「将死」提前返回
    // 红车前进吃马到 (0,3)：仍停在炮与黑将之间继续当炮架，炮只是「换架」改照将 → 不是让线
    expect(run(b, [0, 1], [0, 3])).toHaveLength(0);
  });

  it('炮架没动、让开其后方的挡子 → 仍判闪将（炮透过炮架照将）', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 5, 'K', 'b');
    put(b, 0, 0, 'C', 'r'); // 红炮
    put(b, 0, 2, 'P', 'r'); // 炮架（不动）
    put(b, 0, 3, 'N', 'r'); // 让开的子（炮与黑将之间的第二枚）
    expect(run(b, [0, 3], [1, 5]).map((h) => h.kind)).toEqual(['discovered-check']);
  });

  it('红黑对称：黑车照将 → 闪将', () => {
    const b = emptyBoard();
    put(b, 1, 3, 'K', 'b');
    put(b, 9, 4, 'K', 'r');
    put(b, 9, 0, 'R', 'b');
    put(b, 9, 2, 'N', 'b');
    const hits = run(b, [9, 2], [7, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
  });

  it('用户截图（v3.32）：马挂角将军 + 同时让开炮线（双将）→ 不判闪将（闪将②须移开的子本人不将军）', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r'); // 红帅
    put(b, 2, 4, 'K', 'b'); // 黑将：被马挂角照将，同时红炮透过红兵照将
    put(b, 5, 4, 'P', 'r'); // 红兵：红炮的炮架
    put(b, 6, 4, 'C', 'r'); // 红炮：原本被 (4,4) 的马当第二枚挡子，让线后照将
    put(b, 4, 4, 'N', 'r'); // 还原最后一步：红马 (4,4) 跳到 (3,6) 挂角将军并让开炮线
    // 动子自己也将军（双将）→ 归闪将①；本步又没抽到大子，不做战术提示
    expect(run(b, [4, 4], [3, 6])).toHaveLength(0);
  });

  it('用户截图（v3.35）：移开的马夹在炮与炮架之间（补足炮架）→ 普通将军，不判闪将', () => {
    const b = emptyBoard();
    put(b, 9, 3, 'K', 'r'); // 红帅
    put(b, 0, 4, 'K', 'b'); // 黑将
    put(b, 3, 4, 'P', 'r'); // 红兵：炮架（本步不动）
    put(b, 5, 4, 'C', 'r'); // 红炮：隔红兵照将
    put(b, 4, 4, 'N', 'r'); // 还原最后一步：红马 (4,4) 跳到 (3,2)，让炮够着自己的炮架
    // 走子前炮与将之间有「马 + 兵」两枚挡子，走子后只剩兵（炮架）一枚——炮只是补足炮架后照将，
    // 属于普通将军；移开的马并未挡在炮架与将之间，不算让线闪将
    expect(run(b, [4, 4], [3, 2])).toHaveLength(0);
  });

  it('对照：移开的马挡在炮架与将之间 → 走子后才露出炮照将，仍判闪将（v3.35）', () => {
    const b = emptyBoard();
    put(b, 9, 3, 'K', 'r');
    put(b, 0, 4, 'K', 'b');
    put(b, 3, 4, 'P', 'r'); // 炮架（不动）
    put(b, 5, 4, 'C', 'r'); // 红炮：隔红兵照将
    put(b, 2, 4, 'N', 'r'); // 还原最后一步：红马 (2,4) 跳到 (3,2)，让开炮架与将之间的挡子
    const hits = run(b, [2, 4], [3, 2]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
    expect(hits[0].label).toBe('闪将');
    expect(hits[0].threats).toEqual([[0, 4]]);
  });

  it('checker 被牵制、实际吃不到将帅（伪将军）→ 不判闪将', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 3, 'K', 'b');
    put(b, 9, 3, 'R', 'r'); // 让线后「照」到黑将的红车
    put(b, 9, 0, 'R', 'b'); // 沿 9 行牵制红车（离开 9 行会暴露红帅）
    put(b, 5, 3, 'N', 'r'); // 让开 3 列的红马
    // 红马跳到 (3,2)：红车照到 (0,3) 的黑将，但真吃过去要离开 9 行、红帅被黑车照 → 伪将军
    expect(run(b, [5, 3], [3, 2])).toHaveLength(0);
  });
});

describe('闪击（discovered-attack）', () => {
  it('让线后车攻击敌车 + 移开的马同时捉炮（双向双威胁）→ 闪击', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 被让线后暴露的敌车
    put(b, 1, 3, 'C', 'b'); // 移开的马跳到 (2,1) 后咬住的敌炮
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-attack');
    expect(hits[0].label).toBe('闪击');
    expect(hits[0].threats).toEqual([
      [0, 6],
      [1, 3],
    ]);
  });

  it('被让线露出的攻击只打到士 / 象 / 兵 → 不算威胁、不判闪击', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'B', 'b'); // 让线后车「攻击」到的黑象（士 / 象 / 兵不算闪击的威胁）
    put(b, 1, 3, 'C', 'b'); // 移开的马跳到 (2,1) 后确实捉到敌炮
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });

  it('移开的棋子被牵制、实际吃不到目标（伪威胁）→ 不判闪击', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 3, 'K', 'b');
    put(b, 0, 4, 'R', 'b'); // 沿 4 列牵制红炮
    put(b, 8, 4, 'C', 'r'); // 走动的红炮
    put(b, 8, 0, 'R', 'r'); // 让线后新打到黑马的红车
    put(b, 8, 7, 'N', 'b'); // 被让线的黑马
    put(b, 6, 7, 'N', 'b'); // 红炮走到 (6,4) 后「看起来」吃得到的黑马（实际被牵制吃不过去）
    put(b, 6, 5, 'P', 'r'); // 炮架
    put(b, 7, 2, 'P', 'b'); // 黑方另有子可走动，避免被判将死
    // 红炮 (8,4)→(6,4)：让线成立，但它吃 (6,7) 会送将（非法）→ 移开的子并未造成威胁
    expect(run(b, [8, 4], [6, 4])).toHaveLength(0);
  });

  it('移开的棋子是兵也能判闪击（被威胁子只算车 / 马 / 炮，不限制移开的兵种）', () => {
    const b = emptyBoard();
    put(b, 9, 4, 'K', 'r');
    put(b, 0, 3, 'K', 'b');
    put(b, 4, 0, 'R', 'r');
    put(b, 4, 4, 'P', 'r'); // 走动的是红兵（过河后横走 / 向前，让开 4 行线）
    put(b, 4, 8, 'R', 'b'); // 让线后暴露的黑车
    put(b, 3, 3, 'C', 'b'); // 红兵走到 (3,4) 后能吃到的黑炮
    const hits = run(b, [4, 4], [3, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-attack');
    expect(hits[0].threats).toEqual([
      [4, 8],
      [3, 3],
    ]);
  });

  it('移开的棋子自身不带威胁（只让线）→ 不判闪击', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 被让线后暴露的敌车
    // 马跳到 (2,1) 什么都没捉到：仅车让线，不构成「双向双威胁」
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });

  it('目标原本已被攻击（非新攻击）→ 不成立', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 6, 'R', 'b'); // 车中间无子，走子前就已被攻击
    put(b, 2, 1, 'N', 'r'); // 走一步无关的马
    expect(run(b, [2, 1], [4, 2])).toHaveLength(0);
  });

  it('炮的炮架吃子后仍停在射线上（换架改打后面的子）→ 不判闪击', () => {
    const b = emptyBoard();
    put(b, 7, 3, 'K', 'r');
    put(b, 0, 5, 'K', 'b');
    put(b, 4, 0, 'C', 'r'); // 红炮
    put(b, 4, 2, 'R', 'r'); // 炮架（走动的子）
    put(b, 4, 4, 'R', 'b'); // 炮原先正打着的黑车
    put(b, 4, 6, 'C', 'b'); // 换架后炮「改打」的黑炮
    // 红车吃黑车后仍停在炮与黑炮的连线上（继续当炮架）→ 炮只是换架改打，不是让线
    expect(run(b, [4, 2], [4, 4])).toHaveLength(0);
  });

  it('让线车打到的车、移开的马捉到的炮都有根且交换不赚 → 不判闪击（v3.31 有根不算）', () => {
    const b = emptyBoard();
    kings(b, [2, 4]);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 让线后新被红车攻击的黑车（受 (0,8) 黑车保护 → 有根，车换车不赚）
    put(b, 0, 8, 'R', 'b');
    put(b, 1, 1, 'B', 'b'); // 黑象：护住 (3,3) 的黑炮（象眼 (2,2) 空）
    put(b, 3, 3, 'C', 'b'); // 移开的马跳到 (2,1) 后咬到的炮（马 4 换炮 4.5 仅 0.5 分）
    expect(run(b, [0, 2], [2, 1])).toHaveLength(0);
  });
});

describe('照将分支（闪将 / 将军抽）', () => {
  it('走动的车将军且同时新抽到马（将军的子本人咬住大子）→ 将军抽马（v3.24）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 2, 0, 'R', 'r');
    put(b, 4, 4, 'N', 'b'); // 被抽的马：走子前红车够不到，走子后落到车的 4 路上
    const hits = run(b, [2, 0], [2, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽马');
    expect(hits[0].threats).toEqual([[4, 4]]);
  });

  it('原本就已能合法吃到的敌子：另一子将军后不判将军抽', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 3, 'N', 'b'); // 走子前红车就已能吃这匹马（原本就有的攻击）
    put(b, 4, 6, 'N', 'r'); // 另一子跳去 (2,5) 照将，与被抽的马无关
    expect(run(b, [4, 6], [2, 5])).toHaveLength(0);
  });

  it('走动的马将军且自己同时咬住车与炮 → 将军抽车（将军的子本人抽子）', () => {
    const b = emptyBoard();
    kings(b); // 红帅 (7,3)、黑将 (0,4)
    put(b, 4, 6, 'N', 'r');
    put(b, 3, 7, 'R', 'b');
    put(b, 4, 4, 'C', 'b');
    const hits = run(b, [4, 6], [2, 5]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([
      [3, 7],
      [4, 4],
    ]);
  });

  it('将军同时咬住车与炮（车可蹩马腿脱身）→ 仍按图案判将军抽车（v3.25 不要求对方必失）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 4, 6, 'N', 'r');
    put(b, 1, 7, 'R', 'b'); // 被抽的车：可横走到马腿 (1,5) 蹩腿挡将，自身脱险
    put(b, 4, 4, 'C', 'b'); // 被抽的炮：无救
    const hits = run(b, [4, 6], [2, 5]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([
      [1, 7],
      [4, 4],
    ]);
  });

  it('被抽的炮走子前就已能吃到（非本步新造）→ 不判将军抽炮', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b');
    put(b, 9, 5, 'K', 'r'); // 帅不在 4 路，避免黑将左移时照面
    put(b, 2, 0, 'R', 'r'); // 红车走到 (2,4) 沿 4 路照将
    put(b, 2, 7, 'C', 'b'); // 黑炮：走子前红车已在 2 行上正对它
    put(b, 5, 7, 'R', 'b'); // 黑车同列保护 (2,7)（本用例与是否获利无关）
    // 走子前红车 (2,0) 已能沿 2 行直接吃炮 → 这步将军并未新造得子威胁，不算「抽」
    expect(run(b, [2, 0], [2, 4])).toHaveLength(0);
  });

  it('马抽有根炮（马 4 换炮 4.5 仅 0.5 分，不赚）→ 不判将军抽炮（v3.31 有根不算）', () => {
    const before = screenshotBoard();
    before[2][2] = null;
    put(before, 4, 1, 'N', 'r'); // 还原最后一步：红马 (4,1) 跳到 (2,2)
    // 跳到 (2,2) 后照将，同时咬住 (3,4) 的黑炮；该炮受黑马 (1,5) 保护（有根），
    // 马 4 换炮 4.5 净赚仅 0.5 分 < 1 → 不算「抽」
    expect(run(before, [4, 1], [2, 2])).toHaveLength(0);
  });

  it('移开的马挂角将军 + 让线露出的车新捉到炮 → 闪将（动的子将军且后方子力攻击大子）', () => {
    const b = emptyBoard();
    put(b, 9, 3, 'K', 'r');
    put(b, 0, 4, 'K', 'b');
    put(b, 4, 0, 'R', 'r'); // 让线后新捉到炮的车（本身不将军）
    put(b, 4, 4, 'N', 'r'); // 挡在车与炮之间、走到 (2,3) 挂角将军的马
    put(b, 4, 7, 'C', 'b'); // 被让线露出的车新捉到的炮
    const hits = run(b, [4, 4], [2, 3]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
    expect(hits[0].label).toBe('闪将');
    expect(hits[0].threats).toEqual([
      [0, 4],
      [4, 7],
    ]);
  });

  it('让线车照将 + 走动的马同时捉车 → 将军抽车（用户截图②：将军 + 同时攻击大子）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r'); // 让线后方车 → 照将（移开的马本身不将军）
    put(b, 0, 2, 'N', 'r'); // 让开的马：走到 (1,4) 同时咬住 (3,5) 的黑车
    put(b, 3, 5, 'R', 'b');
    const hits = run(b, [0, 2], [1, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[3, 5]]);
  });

  it('用户截图②：红炮借卒照将、红车同时捉马 → 将军抽马（不是闪将）', () => {
    const b = emptyBoard();
    put(b, 0, 2, 'N', 'r');
    put(b, 2, 1, 'C', 'r');
    put(b, 4, 4, 'R', 'r'); // 走到 (4,3) 让开红炮 (6,4) 借黑卒 (3,4) 照将，同时捉黑马 (7,3)
    put(b, 4, 6, 'N', 'r');
    put(b, 6, 4, 'C', 'r');
    put(b, 9, 1, 'R', 'r');
    put(b, 9, 3, 'A', 'r');
    put(b, 9, 5, 'K', 'r');
    put(b, 0, 4, 'K', 'b');
    put(b, 3, 4, 'P', 'b');
    put(b, 4, 8, 'C', 'b');
    put(b, 7, 3, 'N', 'b');
    put(b, 7, 5, 'C', 'b');
    const hits = run(b, [4, 4], [4, 3]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽马');
    expect(hits[0].threats).toEqual([[7, 3]]);
  });

  it('经典抽将（动的车本人照将、将后有敌车）→ 将军抽车（v3.24 用户截图口径）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 2, 0, 'R', 'r'); // 走到 (0,0) 沿第 0 行照将
    put(b, 0, 7, 'R', 'b'); // 被照之将同线后方的大子（将移开该线后即被吃）
    const hits = run(b, [2, 0], [0, 0]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[0, 7]]);
  });

  it('用户截图局面：一件照将、将后同线还有敌车 → 将军抽车（不是闪将）', () => {
    const b = emptyBoard();
    put(b, 9, 3, 'K', 'r'); // 红帅
    put(b, 1, 4, 'K', 'b'); // 黑将（被照）
    put(b, 1, 0, 'R', 'b'); // 将后同线的黑车
    put(b, 0, 7, 'R', 'r'); // 红车走到 (1,7) 沿第 1 行照将
    const hits = run(b, [0, 7], [1, 7]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[1, 0]]);
  });

  it('走子只照将、并未同时捉大子 → 仍是闪将（低价值子不算「抽」）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 4, 0, 'P', 'b'); // 马跳到 (2,1) 只咬到一兵（非大子）
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('discovered-check');
    expect(hits[0].label).toBe('闪将');
  });

  it('用户截图（v3.36）：红车进底线照将、将后同线黑马早已被红马看着 → 仍判将军抽马', () => {
    const b = emptyBoard();
    put(b, 9, 3, 'K', 'r'); // 红帅
    put(b, 2, 4, 'K', 'b'); // 黑将（被照）
    put(b, 2, 1, 'N', 'b'); // 将后同线（第 2 行）的黑马
    put(b, 1, 3, 'N', 'r'); // 红马：走子前就已攻击 (2,1)（马腿 (1,2) 空）
    put(b, 1, 7, 'R', 'r'); // 红车走到 (2,7) 沿第 2 行照将
    const hits = run(b, [1, 7], [2, 7]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽马');
    expect(hits[0].threats).toEqual([[2, 1]]);
  });

  it('走子前本已照将（非本步新造）+ 将后同线子走子前已可吃 → 不算将军抽（v3.36 反证）', () => {
    const b = emptyBoard();
    kings(b, [1, 4]);
    put(b, 1, 8, 'R', 'r'); // 走子前红车已在第 1 行照将
    put(b, 1, 1, 'N', 'b'); // 将后同线黑马，走子前已被红马 (2,3) 攻击
    put(b, 2, 3, 'N', 'r');
    // 红车 (1,8)→(1,7)：仍是原来的照将（未新造），旧威胁不算「抽」
    expect(run(b, [1, 8], [1, 7])).toHaveLength(0);
  });

  it('被抽的子可反吃攻击子（对方能两全）→ 不成立', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 8, 'R', 'b'); // 黑车可直取走到 (1,4) 的红车（黑将亦可吃），两子皆保
    expect(run(b, [1, 0], [1, 4])).toHaveLength(0);
  });
});

describe('串打（skewer）', () => {
  it('车在同一射线以前马后马（两子皆无根，对方两全不得）→ 串打', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 5, 'N', 'b'); // 前子：马（无根、与红车相邻，无法反吃）
    put(b, 5, 6, 'N', 'b'); // 后子：马（无根）
    const hits = run(b, [5, 0], [5, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
    expect(hits[0].threats).toEqual([
      [5, 5],
      [5, 6],
    ]);
  });

  it('炮借己方炮架后以前马后马（皆无根）→ 串打', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 1, 'C', 'r'); // 红炮（走到 5,4）
    put(b, 5, 5, 'P', 'r'); // 己方炮架（马无法反吃，对方也移不走）
    put(b, 5, 6, 'N', 'b'); // 前子：马（无根）
    put(b, 5, 7, 'N', 'b'); // 后子：马（无根）
    const hits = run(b, [5, 1], [5, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
  });

  it('后子有根（受前子保护，吃过之后可反吃）→ 不判串打（v3.31 有根不算）', () => {
    const b = emptyBoard();
    kings(b, [2, 5]);
    put(b, 5, 1, 'R', 'r');
    put(b, 5, 6, 'R', 'b'); // 前子：车
    put(b, 5, 8, 'C', 'b'); // 后子：炮（受前车保护 → 有根，吃完可反吃）
    expect(run(b, [5, 1], [5, 4])).toHaveLength(0);
  });

  it('用户截图①：红车 (7,1) 同线打黑马 (7,3) 与黑炮 (7,5)（两子皆无根）→ 串打', () => {
    const b = emptyBoard();
    put(b, 0, 2, 'N', 'r');
    put(b, 2, 1, 'C', 'r');
    put(b, 4, 4, 'R', 'r');
    put(b, 4, 6, 'N', 'r');
    put(b, 6, 4, 'C', 'r');
    put(b, 7, 0, 'R', 'r'); // 走到 (7,1) 形成串打
    put(b, 9, 3, 'A', 'r');
    put(b, 9, 5, 'K', 'r');
    put(b, 0, 4, 'K', 'b');
    put(b, 3, 4, 'P', 'b');
    put(b, 4, 8, 'C', 'b');
    put(b, 7, 3, 'N', 'b');
    put(b, 7, 5, 'C', 'b');
    const hits = run(b, [7, 0], [7, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
    expect(hits[0].threats).toEqual([
      [7, 3],
      [7, 5],
    ]);
  });

  it('前子有根（受后车保护，可原地兑子守住）→ 不判串打（v3.31 有根不算）', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 0, 'R', 'r');
    put(b, 5, 5, 'N', 'b'); // 前子：马（被后车保护 → 有根）
    put(b, 5, 6, 'R', 'b'); // 后子：车（保护前马）
    expect(run(b, [5, 0], [5, 4])).toHaveLength(0);
  });

  it('炮串打：前子有根（即使小换大也不计）→ 不判串打（v3.31 用户口径）', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 1, 'C', 'r'); // 红炮（走到 5,4）
    put(b, 5, 5, 'P', 'r'); // 己方炮架
    put(b, 5, 6, 'R', 'b'); // 前子：车（受 (3,6) 黑车保护 → 有根）
    put(b, 5, 7, 'R', 'b'); // 后子：车
    put(b, 3, 6, 'R', 'b'); // 黑车：沿 6 列保护前车
    expect(run(b, [5, 1], [5, 4])).toHaveLength(0);
  });

  it('前子沿射线退到车口（原位已空、仍挡着后子）→ 仍判串打（v3.22 漏报修复）', () => {
    const b = emptyBoard();
    put(b, 9, 5, 'K', 'r');
    put(b, 9, 3, 'A', 'r');
    put(b, 8, 1, 'R', 'r'); // 走到 (6,1) 后沿线打两子
    put(b, 0, 5, 'N', 'r');
    put(b, 0, 3, 'K', 'b');
    put(b, 2, 6, 'C', 'b');
    put(b, 6, 3, 'C', 'b'); // 前子：黑炮（可退到 (6,2) 挡后子，但退到车口仍会被吃）
    put(b, 6, 5, 'N', 'b'); // 后子：黑马
    const hits = run(b, [8, 1], [6, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('skewer');
    expect(hits[0].label).toBe('串打');
    expect(hits[0].threats).toEqual([
      [6, 3],
      [6, 5],
    ]);
  });

  it('用户截图（v3.34）：红车 (2,8) 同线打黑炮 (2,7) / 黑马 (2,6)，但炮受底线黑车保护（有根）→ 不判串打', () => {
    const b = emptyBoard();
    put(b, 0, 4, 'K', 'b'); // 黑将
    put(b, 0, 7, 'R', 'b'); // 黑车：沿 7 列可吃回 (2,7)（(1,7) 空）
    put(b, 2, 6, 'N', 'b'); // 后子：黑马（无根）
    put(b, 2, 7, 'C', 'b'); // 前子：黑炮（受底线黑车保护 → 有根）
    put(b, 8, 3, 'K', 'r'); // 红帅
    put(b, 3, 8, 'R', 'r'); // 红车：进到 (2,8) 形成「前炮后马」
    // 旧构建（不含 v3.31 有根口径）会把此局面误报「串打」；源码按有根口径应给出 0 条提示
    expect(run(b, [3, 8], [2, 8])).toHaveLength(0);
  });

  it('串打：前子有根（黑兵可吃回、黑炮借兵作炮架也可吃回）→ 不判串打（炮 / 兵的根判定）', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 0, 'R', 'r'); // 红车：走到 (5,4)
    put(b, 5, 5, 'N', 'b'); // 前子：黑马（有根）
    put(b, 5, 6, 'N', 'b'); // 后子：黑马（无根）
    put(b, 4, 5, 'P', 'b'); // 黑兵：可前进吃回 (5,5)，同时是黑炮的炮架
    put(b, 3, 5, 'C', 'b'); // 黑炮：借 (4,5) 兵作炮架，也能吃回 (5,5)
    expect(run(b, [5, 0], [5, 4])).toHaveLength(0);
  });
});

describe('捉双（fork）', () => {
  it('马同时捉住两枚敌车（不同线路、对方无法两全）→ 捉双', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 5, 2, 'N', 'r');
    put(b, 3, 2, 'R', 'b'); // 马位可捉到的敌车（车无法反吃马）
    put(b, 6, 5, 'R', 'b'); // 另一路敌车
    const hits = run(b, [5, 2], [4, 4]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('fork');
    expect(hits[0].label).toBe('捉双');
    expect(hits[0].threats).toEqual([
      [3, 2],
      [6, 5],
    ]);
  });

  it('只捉到兵 / 象（价值过低）→ 不成立', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 5, 2, 'N', 'r');
    put(b, 2, 3, 'P', 'b');
    put(b, 6, 5, 'B', 'b');
    expect(run(b, [5, 2], [4, 4])).toHaveLength(0);
  });

  it('捉双：两枚被捉的马都有根（马换马不赚）→ 不判捉双（v3.31 有根不算）', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 2, 'N', 'r'); // 红马跳到 (4,4)
    put(b, 2, 3, 'N', 'b'); // 被捉的马（受 (0,4) 黑马保护 → 有根）
    put(b, 2, 5, 'N', 'b'); // 被捉的马（同样受 (0,4) 黑马保护）
    put(b, 0, 4, 'N', 'b'); // 黑马：同时保护 (2,3) 与 (2,5)（马腿 (1,4) 空）
    expect(run(b, [5, 2], [4, 4])).toHaveLength(0);
  });

  it('用户截图（v3.34）：马同时捉两枚有根车（车有根，属兑子而非捉双）→ 不判捉双', () => {
    const b = emptyBoard();
    kings(b, [0, 5]);
    put(b, 5, 2, 'N', 'r'); // 红马跳到 (4,4)
    put(b, 3, 2, 'R', 'b'); // 被捉：黑车（受 (1,3) 黑马保护 → 有根）
    put(b, 5, 6, 'R', 'b'); // 被捉：黑车（受 (3,7) 黑马保护 → 有根）
    put(b, 1, 3, 'N', 'b'); // 黑马：保护 (3,2)（马腿 (2,3) 空）
    put(b, 3, 7, 'N', 'b'); // 黑马：保护 (5,6)（马腿 (4,7) 空）
    // 旧口径按「小换大」放行（车 9 > 马 4，净赚 5 分）会误报「捉双」；v3.34 起有根即不算
    expect(run(b, [5, 2], [4, 4])).toHaveLength(0);
  });
});

describe('优先级与边界', () => {
  it('让线子将军（移开的子不将军）+ 将后同线大子 → 判将军抽车（v3.22 反证：将军抽由让线子发出）', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 0, 0, 'R', 'r');
    put(b, 0, 2, 'N', 'r');
    put(b, 0, 6, 'R', 'b'); // 让线后不仅照将，将之后还有一枚敌车
    const hits = run(b, [0, 2], [2, 1]);
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('check-fork');
    expect(hits[0].label).toBe('将军抽车');
    expect(hits[0].threats).toEqual([[0, 6]]);
  });

  it('一步将死（绝杀）→ 不返回任何战术（由正中圆环表达）', () => {
    const b = emptyBoard();
    put(b, 7, 3, 'K', 'r');
    put(b, 0, 0, 'R', 'r');
    put(b, 2, 8, 'R', 'r');
    put(b, 0, 4, 'K', 'b');
    const after = boardAfterMove(b, [2, 8], [1, 8]);
    // 先用规则引擎确认确为将死
    expect(judgeAfterMove(after, 'b')).toEqual({ winner: 'r', reason: '将死' });
    expect(detectTactics(b, { from: [2, 8], to: [1, 8] }, after)).toHaveLength(0);
  });

  it('纯函数：不改动传入的 before / after 棋盘', () => {
    const b = emptyBoard();
    kings(b);
    put(b, 1, 0, 'R', 'r');
    put(b, 1, 8, 'R', 'b');
    const after = boardAfterMove(b, [1, 0], [1, 4]);
    const beforeSnap = JSON.stringify(b);
    const afterSnap = JSON.stringify(after);
    detectTactics(b, { from: [1, 0], to: [1, 4] }, after);
    expect(JSON.stringify(b)).toBe(beforeSnap);
    expect(JSON.stringify(after)).toBe(afterSnap);
  });
});
