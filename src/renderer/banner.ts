/**
 * 棋盘正中提示条（将军 / 绝杀）的内容与图案样式。
 *
 * 「绝杀的各种方式」= 每一种杀法一套图案样式（底纹 motif + 强调色 accent + 徽记 emblem），
 * 配置见 `STYLES`（键为 `shared/checkmate.ts` 的杀法 id）；将军未成杀时用固定的警示样式。
 *
 * 纯数据、无 DOM 依赖，便于单测；app.ts 负责写入 DOM 并触发 1.5s 渐入渐出动画。
 */

/** 提示条类型：将军（未成杀） / 绝杀（将死） */
export type BannerKind = 'check' | 'mate';

/** 图案底纹（CSS 按 `data-motif` 渲染不同纹理，区分各种杀法） */
export type BannerMotif = 'ring' | 'chevron' | 'diamond' | 'grid' | 'stripe';

export interface BannerStyle {
  /** 图案标识（写入 `data-pattern`，供 CSS 与测试检索） */
  pattern: string;
  /** 底纹样式 */
  motif: BannerMotif;
  /** 强调色（文字 / 描边 / 徽记底色） */
  accent: string;
  /** 徽记字符（1–2 个汉字，点出该杀法的关键子力） */
  emblem: string;
}

/** 将军（未成杀）：独立的警示样式，与各杀法都不相同 */
export const CHECK_STYLE: BannerStyle = {
  pattern: 'check',
  motif: 'ring',
  accent: '#ff8a3c',
  emblem: '将',
};

/** 各杀法的图案样式（与 CHECKMATE_PATTERNS 的 id 一一对应） */
const STYLES: Record<string, BannerStyle> = {
  mahoupao: { pattern: 'mahoupao', motif: 'chevron', accent: '#ffd36a', emblem: '马炮' },
  chongpao: { pattern: 'chongpao', motif: 'stripe', accent: '#ffb347', emblem: '炮炮' },
  'daodao-wanxin': { pattern: 'daodao-wanxin', motif: 'diamond', accent: '#ff8a5c', emblem: '车士' },
  tiemenshuan: { pattern: 'tiemenshuan', motif: 'grid', accent: '#f0b429', emblem: '炮车' },
  mengong: { pattern: 'mengong', motif: 'ring', accent: '#e8c37a', emblem: '炮士' },
  tiandipao: { pattern: 'tiandipao', motif: 'chevron', accent: '#ffc76b', emblem: '天炮' },
  jiachepao: { pattern: 'jiachepao', motif: 'stripe', accent: '#ffab5e', emblem: '夹炮' },
  shuangjiang: { pattern: 'shuangjiang', motif: 'diamond', accent: '#ffd98a', emblem: '双将' },
  bailianjiang: { pattern: 'bailianjiang', motif: 'grid', accent: '#ff9d8a', emblem: '帅将' },
  'shuangma-yinquan': { pattern: 'shuangma-yinquan', motif: 'ring', accent: '#9fdc9f', emblem: '马马' },
  wocaoma: { pattern: 'wocaoma', motif: 'chevron', accent: '#8fd0ff', emblem: '卧马' },
  guajiaoma: { pattern: 'guajiaoma', motif: 'diamond', accent: '#a9c9ff', emblem: '角马' },
  diaoyuma: { pattern: 'diaoyuma', motif: 'stripe', accent: '#bfe0ff', emblem: '钓马' },
  cemianhu: { pattern: 'cemianhu', motif: 'grid', accent: '#ffb6d5', emblem: '虎马' },
  bajiaoma: { pattern: 'bajiaoma', motif: 'ring', accent: '#d7b3ff', emblem: '八马' },
  shuangchecuo: { pattern: 'shuangchecuo', motif: 'chevron', accent: '#ff9f9f', emblem: '车车' },
  haidilaoyue: { pattern: 'haidilaoyue', motif: 'stripe', accent: '#7fe3d4', emblem: '捞月' },
  mengsha: { pattern: 'mengsha', motif: 'grid', accent: '#c9b38a', emblem: '闷' },
  generic: { pattern: 'generic', motif: 'diamond', accent: '#ffcf7a', emblem: '杀' },
};

/** 取将军或某杀法的图案样式；未知杀法（含兜底）回退 `generic` */
export function bannerStyle(patternId: string): BannerStyle {
  if (patternId === CHECK_STYLE.pattern) return CHECK_STYLE;
  return STYLES[patternId] ?? STYLES.generic;
}

/** 已被收录图案样式的杀法 id（含将军与兜底） */
export const BANNER_PATTERN_IDS: readonly string[] = Object.keys(STYLES);

/** 中央提示条内容 */
export interface BannerContent {
  kind: BannerKind;
  /** 主标题（将军 / 具体杀法展示名） */
  name: string;
  /** 副标题（哪一方被将军 / 哪一方绝杀） */
  sub: string;
  style: BannerStyle;
}

/**
 * 组装提示条内容。
 * @param kind        check 将军 / mate 绝杀
 * @param opts.label  绝杀时的杀法展示名（如「马后炮杀」），缺省「将死」
 * @param opts.patternId 杀法 id（决定图案样式），缺省回退 generic
 * @param opts.sub    副标题
 */
export function bannerContent(
  kind: BannerKind,
  opts: { label?: string; patternId?: string; sub?: string } = {},
): BannerContent {
  if (kind === 'check') {
    return { kind, name: '将军', sub: opts.sub ?? '应将', style: CHECK_STYLE };
  }
  return {
    kind,
    name: opts.label ?? '将死',
    sub: opts.sub ?? '绝杀',
    style: bannerStyle(opts.patternId ?? 'generic'),
  };
}
