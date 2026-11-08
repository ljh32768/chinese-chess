/**
 * 杀法识别测试。
 *
 * 每种经典杀法构造一个终局局面：先验证该局面确实是「将死」（规则引擎判定），
 * 再验证识别出的杀法名，避免「局面本身不是将死却通过了识别」的假阳性。
 *
 * 判定口径见《象棋杀法与局面状态严格判定》：本模块只处理「将死」（困毙不属于此）。
 */

import { describe, expect, it } from 'vitest';
import {
  CHECKMATE_PATTERNS,
  KUNBI_PATTERN,
  capturedPieceAt,
  classifyCheckmate,
  classifyCheckmateFromHistory,
} from '../src/shared/checkmate.js';
import { judgeAfterMove, makeMove } from '../src/shared/rules.js';
import { Board, Move, PieceType, Side } from '../src/shared/types.js';

/** 棋子简写：`rK` = 红帅、`bA` = 黑士（s + 大写兵种） */
type Spec = [number, number, string];

/** 由「行, 列, 棋子」列表构造棋盘 */
function boardOf(items: Spec[]): Board {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, spec] of items) {
    b[r][c] = { t: spec[1] as PieceType, s: spec[0] as Side };
  }
  return b;
}

/** 断言该局面确为将死，并识别为指定杀法 */
function expectMate(items: Spec[], mated: Side, id: string): void {
  const board = boardOf(items);
  const judge = judgeAfterMove(board, mated);
  expect(judge?.reason, `局面应被判定为将死（实际 ${JSON.stringify(judge)}）`).toBe('将死');
  const info = classifyCheckmate(board, mated);
  expect(info.pattern.id, `识别结果：${info.pattern.name}`).toBe(id);
  expect(info.recognized).toBe(true);
}

describe('杀法识别：每种杀法一个终局局面', () => {
  it('反例（用户截图）：双车错局面里马恰占三路卒位，但所控格已被照将车封死，不得判侧面虎', () => {
    // 截图局面还原：黑将 (2,5)、黑马 (2,7)/(7,6)，红车 (1,0)/(2,2)、红马 (3,2)、红帅 (7,3)
    // 红马 (3,2) 确实在「三路卒原位」，但它控住的 (2,4) 正被同线照将的红车 (2,2) 自己封着，
    // 马没有独自拿下任何逃路 —— 该杀法是双车错，不是侧面虎
    const items: Spec[] = [
      [2, 5, 'bK'],
      [2, 7, 'bN'],
      [7, 6, 'bN'],
      [1, 0, 'rR'],
      [2, 2, 'rR'],
      [3, 2, 'rN'],
      [7, 3, 'rK'],
    ];
    expectMate(items, 'b', 'shuangchecuo');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('侧面虎');
  });

  it('反例：双车错局面里马恰占钓鱼马位，但只是陪衬，不得判钓鱼马', () => {
    const items: Spec[] = [
      [0, 4, 'bK'],
      [9, 4, 'rK'],
      [1, 0, 'rR'],
      [0, 8, 'rR'],
      [5, 4, 'rP'],
      [2, 2, 'rN'],
    ];
    expectMate(items, 'b', 'shuangchecuo');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('钓鱼马');
  });

  it('马后炮：炮借己方马为炮架将军，且该马控将（马前炮后）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [9, 4, 'rK'],
        [2, 4, 'rN'],
        [4, 4, 'rC'],
      ],
      'b',
      'mahoupao',
    );
  });

  it('重炮：双炮同线叠架，后炮借前炮为架', () => {
    expectMate(
      [
        [0, 3, 'bK'],
        [0, 4, 'bN'],
        [9, 4, 'rK'],
        [2, 3, 'rC'],
        [3, 3, 'rC'],
        [3, 4, 'rN'],
      ],
      'b',
      'chongpao',
    );
  });

  it('闷宫：单炮借对方士为炮架，将（帅）被自家士堵死', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [1, 4, 'bA'],
        [9, 4, 'rK'],
        [0, 1, 'rC'],
        [2, 4, 'rN'],
      ],
      'b',
      'mengong',
    );
  });

  it('闷宫：底炮借红仕为架照将、帅被双仕堵死；另一门炮封的逃路与照将炮重复（用户截图回归）', () => {
    // 用户截图局面（黑先胜）：黑炮 (9,2) 借红仕 (9,3) 为炮架照将，红帅 (9,4) 的
    // (9,3)、(8,4) 被自家双仕堵住；唯一逃路 (9,5) 已被**照将的这枚炮自己**封住
    // （帅走后炮与帅之间仍恰隔红仕一枚）。黑方另一门炮 (2,5) 只是在重复封路，
    // 抽走它仍是杀棋 → 不应据此排除闷宫（旧逻辑会退化成「将死」）。
    const items: Spec[] = [
      [0, 2, 'bB'],
      [0, 3, 'bA'],
      [0, 4, 'bK'],
      [0, 5, 'bA'],
      [0, 6, 'bB'],
      [1, 4, 'bN'],
      [2, 5, 'bC'],
      [3, 0, 'bP'],
      [3, 4, 'bP'],
      [3, 8, 'bP'],
      [4, 5, 'bN'],
      [6, 7, 'bR'],
      [9, 2, 'bC'],
      [5, 6, 'rB'],
      [6, 0, 'rP'],
      [6, 4, 'rP'],
      [6, 8, 'rP'],
      [7, 0, 'rN'],
      [7, 2, 'rC'],
      [7, 6, 'rN'],
      [7, 7, 'rC'],
      [8, 4, 'rA'],
      [9, 3, 'rA'],
      [9, 4, 'rK'],
      [9, 7, 'rR'],
    ];
    expectMate(items, 'r', 'mengong');
    expect(classifyCheckmate(boardOf(items), 'r').alsoMatched).toEqual([]);
  });

  it('反例：车在将正前方（肋道）贴帅，不在将后方，不算铁门栓', () => {
    // 红车 (1,4) 贴在黑将 (0,4) 的正前方（非底线、也非将的后侧）；红炮 (4,4) 借车为架同时照将，
    // 另一红车 (1,0) 保护贴帅车 → 双将，而不是铁门栓
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [0, 5, 'bA'],
      [9, 4, 'rK'],
      [1, 4, 'rR'],
      [4, 4, 'rC'],
      [1, 0, 'rR'],
    ];
    expectMate(items, 'b', 'shuangjiang');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('铁门栓');
  });

  it('铁门栓：中炮牵制士象、车从底线贴帅照将（用户截图局面，不是对面笑）', () => {
    // 红炮 (3,4) 镇中路，与黑将之间隔着黑象 (2,4) + 黑士 (1,4)：任一移开即照将——
    // 黑士因此不能吃贴帅的红车 (0,5)；黑将的逃路 (0,3) 被自家士堵住，红帅在 5 路照面护车
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [1, 4, 'bA'],
      [0, 2, 'bB'],
      [2, 4, 'bB'],
      [9, 5, 'rK'],
      [0, 5, 'rR'],
      [3, 4, 'rC'],
    ];
    expectMate(items, 'b', 'tiemenshuan');
    // 照面只护住贴帅的车、双方将（帅）本不在同一纵线 → 不再把「对面笑」列为同时构成
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('对面笑');
  });

  it('铁门栓定式：底象可无（抽走 (0,2) 的象仍判铁门栓）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [1, 4, 'bA'],
        [2, 4, 'bB'],
        [9, 5, 'rK'],
        [0, 5, 'rR'],
        [3, 4, 'rC'],
      ],
      'b',
      'tiemenshuan',
    );
  });

  it('铁门栓定式：左右对称（车贴将左侧、底士在右侧）同样成立', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 5, 'bA'],
        [1, 4, 'bA'],
        [0, 6, 'bB'],
        [2, 4, 'bB'],
        [9, 3, 'rK'],
        [0, 3, 'rR'],
        [3, 4, 'rC'],
      ],
      'b',
      'tiemenshuan',
    );
  });

  it('铁门栓定式：红方被将死的镜像（车贴红帅底线、黑炮镇中牵制）', () => {
    expectMate(
      [
        [9, 4, 'rK'],
        [9, 5, 'rA'],
        [8, 4, 'rA'],
        [7, 4, 'rB'],
        [9, 6, 'rB'],
        [0, 3, 'bK'],
        [9, 3, 'bR'],
        [6, 4, 'bC'],
      ],
      'r',
      'tiemenshuan',
    );
  });

  it('反例：照将子换成兵（卒）不再算铁门栓（车固定为车）', () => {
    // 与上方定式同构，只把底线照将的车 (0,5) 换成红兵 → 按「海底捞月」判定，不得判铁门栓
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [1, 4, 'bA'],
      [0, 2, 'bB'],
      [2, 4, 'bB'],
      [9, 5, 'rK'],
      [0, 5, 'rP'],
      [3, 4, 'rC'],
    ];
    expectMate(items, 'b', 'haidilaoyue');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('铁门栓');
  });

  it('天地炮：一炮沉底线照将、一炮镇中路牵制士象（用户截图局面）', () => {
    // 红炮 (0,2) 沉底线，借黑士 (0,3) 为架照将；红炮 (3,4) 镇中路，
    // 与黑将之间隔着黑象 (2,4) + 黑士 (1,4)——任一移开即照将，黑象因此不能吃底线炮；
    // 黑将被自家双士堵死（闷宫式自阻），双炮配合成杀（无须车马兵参与）。
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [1, 4, 'bA'],
      [2, 4, 'bB'],
      [9, 4, 'rK'],
      [9, 3, 'rA'],
      [8, 4, 'rA'],
      [9, 2, 'rB'],
      [7, 4, 'rB'],
      [5, 2, 'rP'],
      [3, 4, 'rC'],
      [0, 2, 'rC'],
    ];
    expectMate(items, 'b', 'tiandipao');
    // 中炮参与牵制 → 不再把「闷宫」列为同时构成（闷宫按「单炮」口径判定）
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('闷宫');
  });

  it('夹车炮：双炮重叠作架，车在同侧配合将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [1, 4, 'bA'],
        [9, 4, 'rK'],
        [0, 8, 'rR'],
        [3, 4, 'rC'],
        [4, 4, 'rC'],
      ],
      'b',
      'jiachepao',
    );
  });

  it('海底捞月：兵（卒）走到底线照将，且将（帅）正前方一格被对方自己的棋子挡住', () => {
    // 红兵 (0,5) 沉底横向照将；黑将 (0,4) 的退路 (0,3) 被自家士堵住、正前方 (1,4) 被自家车挡住
    // （车吃不到 (0,5) 的兵，挪开也不解将）；吃兵又会与红帅 (9,5) 照面 → 将死
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [1, 4, 'bR'],
      [9, 5, 'rK'],
      [0, 5, 'rP'],
    ];
    expectMate(items, 'b', 'haidilaoyue');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('铁门栓');
  });

  it('海底捞月：红方被将死的镜像（黑卒沉底、红帅正前方被自家棋子挡住）', () => {
    expectMate(
      [
        [9, 4, 'rK'],
        [9, 5, 'rA'],
        [8, 4, 'rR'],
        [0, 3, 'bK'],
        [9, 3, 'bP'],
      ],
      'r',
      'haidilaoyue',
    );
  });

  it('反例：兵沉底照将但正前方被「我方」棋子挡住时，不算海底捞月', () => {
    // (1,4) 是红马（我方子力、由红车保护），并非对方自己的棋子 → 不满足自堵退路的条件
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [9, 5, 'rK'],
      [0, 5, 'rP'],
      [1, 4, 'rN'],
      [1, 5, 'rR'],
    ];
    const judge = judgeAfterMove(boardOf(items), 'b');
    expect(judge?.reason).toBe('将死');
    const info = classifyCheckmate(boardOf(items), 'b');
    expect(info.pattern.id).not.toBe('haidilaoyue');
    expect(info.recognized).toBe(false); // 未命中具名杀法，走兜底「绝杀」
  });

  it('海底捞月与铁门栓互斥：铁门栓定式（照将子为车、底线另一侧为将的士）不判海底捞月', () => {
    // 收紧后的铁门栓要求「底线另一侧是将（帅）的士」，与「底线兵照将」占同一格，
    // 两者无法同时成立；`MATCHERS` 仍把铁门栓排在海底捞月之前，保证优先级不倒置
    const items: Spec[] = [
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [1, 4, 'bA'],
      [0, 2, 'bB'],
      [2, 4, 'bB'],
      [9, 5, 'rK'],
      [0, 5, 'rR'],
      [3, 4, 'rC'],
    ];
    expectMate(items, 'b', 'tiemenshuan');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('海底捞月');
  });

  it('列马车：马在钓鱼马位、将在底线五路、车在底线贴将照将且在马口保护下', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 5, 'bA'],
        [9, 3, 'rK'],
        [0, 3, 'rR'],
        [2, 2, 'rN'],
      ],
      'b',
      'liemache',
    );
  });

  it('列马车：用户截图局面（无底士，黑将在底线五路被底线车贴将）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [9, 0, 'bP'],
        [8, 5, 'rK'],
        [0, 3, 'rR'],
        [2, 2, 'rN'],
      ],
      'b',
      'liemache',
    );
  });

  it('列马车：红方被将死的镜像（杀法识别不依赖阵营）', () => {
    expectMate(
      [
        [9, 4, 'rK'],
        [9, 5, 'rA'],
        [0, 3, 'bK'],
        [9, 3, 'bR'],
        [7, 2, 'bN'],
      ],
      'r',
      'liemache',
    );
  });

  it('卧槽马：马在对方下二路象前的「卧槽」位控将门一侧', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 4, 'rK'],
        [1, 2, 'rN'],
        [2, 4, 'rP'],
      ],
      'b',
      'wocaoma',
    );
  });

  it('钓鱼马：马占三·八 / 七·八位封锁将门（控位子，不直接将军），车成杀', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 5, 'bA'],
        [9, 3, 'rK'],
        [0, 0, 'rR'],
        [2, 2, 'rN'],
      ],
      'b',
      'diaoyuma',
    );
  });

  it('侧面虎：马占对方卒（兵）位侧控将门，同侧车成杀', () => {
    expectMate(
      [
        [0, 5, 'bK'],
        [0, 4, 'bN'],
        [9, 4, 'rK'],
        [0, 8, 'rR'],
        [3, 6, 'rN'],
      ],
      'b',
      'cemianhu',
    );
  });

  it('侧面虎：车紧贴将一侧照将、马占三路卒位控门（非列马车定式）', () => {
    // 用户截图局面：黑将 (2,3)、红车 (1,3) 贴将照将、红马 (3,2) 占侧面虎位
    // 马既护住车（将不敢吃车）又控住 (2,4)；但列马车是固定定式（马须在钓鱼马位、将在底线五路、
    // 车在底线贴将），此局面不构成列马车，应判侧面虎
    const items: Spec[] = [
      [2, 3, 'bK'],
      [9, 0, 'bP'],
      [8, 5, 'rK'],
      [1, 3, 'rR'],
      [3, 2, 'rN'],
    ];
    expectMate(items, 'b', 'cemianhu');
    expect(classifyCheckmate(boardOf(items), 'b').alsoMatched).not.toContain('列马车');
  });

  it('侧面虎：用户截图局面（马占七路卒原位、车沿同列照将）', () => {
    // 截图局面还原：黑将 (2,5)、黑士 (0,3)、红马 (3,6)、红车 (5,5)、红帅 (9,4)
    // 红车沿第 5 列照将、封住 (1,5)，红马独自拿下 (2,4) → 侧面虎。
    // 该格另受「将帅照面」规则间接封口，但不影响马类杀法的结构判定（不再按「抽走即非将死」的必要性收紧）
    const items: Spec[] = [
      [2, 5, 'bK'],
      [0, 3, 'bA'],
      [3, 6, 'rN'],
      [5, 5, 'rR'],
      [9, 4, 'rK'],
    ];
    expectMate(items, 'b', 'cemianhu');
  });

  it('八脚马（八角马）：马占士角、将（帅）在斜对宫角，马控逃路、车照将成杀', () => {
    expectMate(
      [
        [2, 5, 'bK'],
        [9, 4, 'rK'],
        [0, 3, 'rN'],
        [2, 0, 'rR'],
      ],
      'b',
      'bajiaoma',
    );
  });

  it('双车错：双车分占两条不同的线交错将军', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [9, 4, 'rK'],
        [1, 0, 'rR'],
        [0, 8, 'rR'],
        [5, 4, 'rP'],
      ],
      'b',
      'shuangchecuo',
    );
  });

  it('闷杀：将（帅）的逃路全被自家子力堵死（不限炮架）', () => {
    expectMate(
      [
        [0, 3, 'bK'],
        [0, 4, 'bN'],
        [1, 3, 'bN'],
        [9, 4, 'rK'],
        [2, 2, 'rN'],
      ],
      'b',
      'mengsha',
    );
  });

  it('双将：两子同时将军（车 + 马）', () => {
    expectMate(
      [
        [1, 4, 'bK'],
        [0, 4, 'bN'],
        [2, 4, 'bN'],
        [9, 3, 'rK'],
        [1, 0, 'rR'],
        [3, 3, 'rN'],
      ],
      'b',
      'shuangjiang',
    );
  });

  it('对面笑：车在将门、借帅力封口（白脸将 / 千里照面）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bP'],
        [0, 5, 'bP'],
        [9, 4, 'rK'],
        [1, 4, 'rR'],
      ],
      'b',
      'bailianjiang',
    );
  });

  it('大刀剜心：车吃去对方宫心士成杀（附加条目；最后一步吃士）', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [1, 4, 'bA'],
      [0, 3, 'bN'],
      [9, 4, 'rK'],
      [1, 0, 'rR'],
      [1, 5, 'rP'],
    ]);
    // 车（1,0）→（1,4）吃宫心士后成杀
    makeMove(board, [1, 0], [1, 4]);
    expect(judgeAfterMove(board, 'b')?.reason).toBe('将死');
    const info = classifyCheckmate(board, 'b', { lastMove: { from: [1, 0], to: [1, 4] }, captured: 'A' });
    expect(info.pattern.id).toBe('daodao-wanxin');
  });

  it('双马饮泉：一马控将、另一马将军（附加条目）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 3, 'rK'],
        [2, 3, 'rN'],
        [3, 5, 'rN'],
      ],
      'b',
      'shuangma-yinquan',
    );
  });

  it('挂角马：马在宫顶角直接将军（附加条目）', () => {
    expectMate(
      [
        [0, 4, 'bK'],
        [0, 3, 'bA'],
        [0, 5, 'bA'],
        [9, 4, 'rK'],
        [2, 3, 'rN'],
        [2, 4, 'rP'],
      ],
      'b',
      'guajiaoma',
    );
  });

  it('未匹配经典杀法时兜底为「绝杀」，且 recognized 为 false', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [9, 3, 'rK'],
      [0, 8, 'rR'],
      [2, 4, 'rP'],
    ]);
    expect(judgeAfterMove(board, 'b')?.reason).toBe('将死');
    const info = classifyCheckmate(board, 'b');
    expect(info.pattern.id).toBe('generic');
    expect(info.pattern.label).toBe('绝杀');
    expect(info.recognized).toBe(false);
  });

  it('红方被将死同样可识别（杀法识别不依赖阵营）', () => {
    // 与「马后炮」镜像：黑炮借黑马为架将死红帅
    expectMate(
      [
        [9, 4, 'rK'],
        [0, 4, 'bK'],
        [7, 4, 'bN'],
        [5, 4, 'bC'],
      ],
      'r',
      'mahoupao',
    );
  });
});

describe('杀法库与辅助函数', () => {
  it('展示名统一为纯杀法名（v3.8：不再追加「杀」字），并含困毙条目', () => {
    const labels = CHECKMATE_PATTERNS.map((p) => p.label);
    for (const name of [
      '钓鱼马',
      '列马车',
      '卧槽马',
      '八脚马',
      '侧面虎',
      '马后炮',
      '天地炮',
      '夹车炮',
      '重炮',
      '对面笑',
      '闷宫',
      '闷杀',
      '双车错',
      '海底捞月',
      '铁门栓',
      '双将',
    ]) {
      expect(labels, `缺少杀法名：${name}`).toContain(name);
    }
    // 旧展示名（带「杀」字的同义写法）已不再出现
    expect(labels).not.toContain('马后炮杀');
    expect(labels).not.toContain('夹车炮杀');
    expect(labels).not.toContain('八角马');
    // 困毙：单独导出，不参与将死匹配
    expect(KUNBI_PATTERN).toMatchObject({ id: 'kunbi', name: '困毙', label: '困毙' });
    expect(CHECKMATE_PATTERNS.map((p) => p.id)).not.toContain('kunbi');
  });

  it('杀法库条目 id / 名称唯一，且包含兜底条目与新增「列马车」', () => {
    const ids = CHECKMATE_PATTERNS.map((p) => p.id);
    const names = CHECKMATE_PATTERNS.map((p) => p.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(ids).toContain('generic');
    expect(ids).toContain('liemache');
    for (const p of CHECKMATE_PATTERNS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.definition.length).toBeGreaterThan(0);
    }
  });

  it('清单外附加条目（大刀剜心 / 双马饮泉 / 挂角马）排在主判定顺序之后', () => {
    const ids = CHECKMATE_PATTERNS.map((p) => p.id);
    const attached = ['daodao-wanxin', 'shuangma-yinquan', 'guajiaoma'];
    const mainLast = ids.findIndex((id) => attached.includes(id));
    // 附加条目之前不应再有其他附加条目，且都紧邻兜底之前
    for (const id of attached) expect(ids.indexOf(id)).toBeGreaterThanOrEqual(mainLast);
    expect(ids.indexOf('generic')).toBe(ids.length - 1);
  });

  it('同时成立的杀法记入 alsoMatched（双车错同时是双将）', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [0, 3, 'bA'],
      [9, 4, 'rK'],
      [0, 8, 'rR'],
      [2, 4, 'rR'],
      [1, 3, 'rN'],
    ]);
    const info = classifyCheckmate(board, 'b');
    expect(info.pattern.name).toBe('双车错');
    expect(info.alsoMatched).toContain('双将');
    expect(info.alsoMatched).not.toContain('双车错');
  });

  it('capturedPieceAt：按着法序列推导最后一步吃子（吃卒 / 无吃子）', () => {
    // 红兵 6,0 → 3,0 连续推进并吃掉黑卒；黑马往返各一步凑成双方交替
    const moves: Move[] = [
      { from: [6, 0], to: [5, 0] },
      { from: [0, 1], to: [2, 0] },
      { from: [5, 0], to: [4, 0] },
      { from: [2, 0], to: [0, 1] },
      { from: [4, 0], to: [3, 0] },
    ];
    expect(capturedPieceAt(moves, 4)).toBe('P');
    expect(capturedPieceAt(moves, 0)).toBeNull();
    expect(capturedPieceAt(moves, 99)).toBeNull();
  });

  it('classifyCheckmateFromHistory：和棋与空着法返回 null', () => {
    const board = boardOf([
      [0, 4, 'bK'],
      [9, 4, 'rK'],
    ]);
    expect(classifyCheckmateFromHistory(board, [], 'b')).toBeNull();
    expect(classifyCheckmateFromHistory(board, [{ from: [6, 0], to: [5, 0] }], null)).toBeNull();
  });
});
