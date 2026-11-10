/**
 * 棋盘正中提示（吃 / 将军 / 绝杀）的内容与优先级。
 *
 * v3.7 起改为**纯文字**：不再有黑色圆底与圆框，也不再有下方的小字描述；
 * 大字用楷体加粗（样式见 styles.css `.banner-name`）。
 * 「吃」固定显示单字「吃」；「将」（将军）固定显示单字「将」；绝杀**先显示具体杀法名**
 * （如「侧面虎」），特判显示结束后再接「绝杀」；未命中特判时直接显示「绝杀」。
 *
 * 三类提示同一时刻只显示一条，优先级：**绝杀 > 将 > 吃**（见 `bannerPriority()`）。
 *
 * 纯数据、无 DOM 依赖，便于单测；app.ts 负责写入 DOM 并触发 2.5s 渐入渐出动画。
 */

/** 提示条类型：吃（吃掉对方棋子） / 将（被将军、未成杀） / 绝杀（将死） */
export type BannerKind = 'capture' | 'check' | 'mate';

/** 中央提示内容 */
export interface BannerContent {
  kind: BannerKind;
  /** 大字：吃固定「吃」、将固定「将」；绝杀为具体杀法名，缺省「绝杀」 */
  name: string;
}

/**
 * 组装提示内容。
 * @param kind        capture 吃 / check 将 / mate 绝杀
 * @param opts.label  绝杀时的杀法展示名（如「侧面虎」）；缺省退回「绝杀」
 */
export function bannerContent(kind: BannerKind, opts: { label?: string } = {}): BannerContent {
  if (kind === 'capture') return { kind, name: '吃' };
  if (kind === 'check') return { kind, name: '将' };
  return { kind, name: opts.label || '绝杀' };
}

/** 与正中提示相关的局面要素 */
export interface BannerSituation {
  /** 对局是否已结束（已结束且原因不是将死 / 困毙时不显示提示） */
  over: boolean;
  /** 终局原因（`将死` / `困毙` / 认输 / …）；进行中为 null */
  reason: string | null;
  /** 当前是否被将军 */
  check: boolean;
  /** 这一手是否吃掉了对方的棋子 */
  captured: boolean;
}

/**
 * 提示优先级：**绝杀 > 将 > 吃**。
 * 将死 / 困毙 → `mate`；进行中被将军 → `check`；仅吃子 → `capture`；其余不显示（null）。
 * 同一手既吃子又将军 / 将死时，只返回将军 / 绝杀，吃子提示被压过。
 */
export function bannerPriority(s: BannerSituation): BannerKind | null {
  if (s.over) return s.reason === '将死' || s.reason === '困毙' ? 'mate' : null;
  if (s.check) return 'check';
  return s.captured ? 'capture' : null;
}
