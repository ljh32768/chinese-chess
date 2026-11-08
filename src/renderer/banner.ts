/**
 * 棋盘正中提示（将军 / 绝杀）的内容。
 *
 * v3.7 起改为**纯文字**：不再有黑色圆底与圆框，也不再有下方的小字描述；
 * 大字用楷体加粗（样式见 styles.css `.banner-name`）。
 * 「将」（将军）固定显示单字「将」；绝杀**先显示具体杀法名**（如「侧面虎」），
 * 特判显示结束后再接「绝杀」；未命中特判时直接显示「绝杀」。
 *
 * 纯数据、无 DOM 依赖，便于单测；app.ts 负责写入 DOM 并触发 2.5s 渐入渐出动画。
 */

/** 提示条类型：将（被将军、未成杀） / 绝杀（将死） */
export type BannerKind = 'check' | 'mate';

/** 中央提示内容 */
export interface BannerContent {
  kind: BannerKind;
  /** 大字：将固定「将」；绝杀为具体杀法名，缺省「绝杀」 */
  name: string;
}

/**
 * 组装提示内容。
 * @param kind        check 将 / mate 绝杀
 * @param opts.label  绝杀时的杀法展示名（如「侧面虎」）；缺省退回「绝杀」
 */
export function bannerContent(kind: BannerKind, opts: { label?: string } = {}): BannerContent {
  if (kind === 'check') return { kind, name: '将' };
  return { kind, name: opts.label || '绝杀' };
}
