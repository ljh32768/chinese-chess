/**
 * 棋盘正中提示（将军 / 绝杀黑色大圆）的样式与内容测试。
 * 覆盖：每种杀法都有各自的强调色（与底纹 / 徽记保留数据）、未知杀法回退兜底、
 * 将军与绝杀的内容组装（主标题固定、副标题保留杀法名）。
 */

import { describe, expect, it } from 'vitest';
import {
  BANNER_PATTERN_IDS,
  bannerContent,
  bannerStyle,
  CHECK_STYLE,
  type BannerMotif,
} from '../src/renderer/banner.js';
import { CHECKMATE_PATTERNS } from '../src/shared/checkmate.js';

const MOTIFS: BannerMotif[] = ['ring', 'chevron', 'diamond', 'grid', 'stripe'];

describe('杀法图案样式 bannerStyle', () => {
  it('杀法库中每种杀法都有自己的图案样式（pattern 与杀法 id 一致）', () => {
    for (const p of CHECKMATE_PATTERNS) {
      const style = bannerStyle(p.id);
      expect(style.pattern).toBe(p.id);
      expect(MOTIFS).toContain(style.motif);
      expect(style.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(style.emblem.length).toBeGreaterThan(0);
    }
  });

  it('各杀法样式互不相同：强调色唯一，且五种底纹都被用到', () => {
    const accents = CHECKMATE_PATTERNS.map((p) => bannerStyle(p.id).accent);
    expect(new Set(accents).size).toBe(accents.length);

    const motifs = new Set(CHECKMATE_PATTERNS.map((p) => bannerStyle(p.id).motif));
    for (const m of MOTIFS) expect(motifs.has(m)).toBe(true);
  });

  it('将军样式独立于各杀法（名称 / 底纹 / 强调色都不与杀法重复）', () => {
    expect(CHECK_STYLE.pattern).toBe('check');
    expect(bannerStyle('check')).toEqual(CHECK_STYLE);
    for (const p of CHECKMATE_PATTERNS) {
      expect(bannerStyle(p.id).pattern).not.toBe(CHECK_STYLE.pattern);
      expect(bannerStyle(p.id).accent).not.toBe(CHECK_STYLE.accent);
    }
  });

  it('未知杀法回退到兜底样式 generic', () => {
    expect(bannerStyle('not-a-pattern').pattern).toBe('generic');
  });

  it('样式表覆盖全部杀法 id（含兜底）', () => {
    expect(BANNER_PATTERN_IDS).toHaveLength(CHECKMATE_PATTERNS.length);
    for (const p of CHECKMATE_PATTERNS) expect(BANNER_PATTERN_IDS).toContain(p.id);
  });
});

describe('提示条内容 bannerContent', () => {
  it('将军：固定标题「将军」，副标题默认「应将」，用将军警示样式', () => {
    const c = bannerContent('check');
    expect(c.kind).toBe('check');
    expect(c.name).toBe('将军');
    expect(c.sub).toBe('应将');
    expect(c.style).toEqual(CHECK_STYLE);
    expect(bannerContent('check', { sub: '黑方被将军' }).sub).toBe('黑方被将军');
  });

  it('绝杀：主标题固定「绝杀」，副标题保留具体杀法名，强调色随杀法', () => {
    const c = bannerContent('mate', { label: '马后炮杀', patternId: 'mahoupao', sub: '马后炮杀 · 红方绝杀' });
    expect(c.kind).toBe('mate');
    expect(c.name).toBe('绝杀');
    expect(c.sub).toBe('马后炮杀 · 红方绝杀');
    expect(c.style.pattern).toBe('mahoupao');
    expect(c.style.accent).toBe(bannerStyle('mahoupao').accent);
  });

  it('绝杀缺省：主标题仍为「绝杀」，副标题退到「绝杀」，样式兜底', () => {
    const c = bannerContent('mate');
    expect(c.name).toBe('绝杀');
    expect(c.sub).toBe('绝杀');
    expect(c.style.pattern).toBe('generic');
    // 给出 label 时用作副标题兜底（具体杀法名不丢）
    expect(bannerContent('mate', { label: '闷杀' }).sub).toBe('闷杀');
  });
});
