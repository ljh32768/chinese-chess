/**
 * 棋盘正中提示（将军 / 绝杀纯文字大字）的内容测试。
 * v3.7 起提示不再有黑色圆底 / 圆框与副标题：将军固定「将军」，绝杀直接显示具体杀法名。
 */

import { describe, expect, it } from 'vitest';
import { bannerContent } from '../src/renderer/banner.js';

describe('提示内容 bannerContent', () => {
  it('将军：固定大字「将军」', () => {
    const c = bannerContent('check');
    expect(c.kind).toBe('check');
    expect(c.name).toBe('将军');
  });

  it('绝杀：大字直接显示具体杀法名（纯名称，不带「杀」字）', () => {
    const c = bannerContent('mate', { label: '马后炮' });
    expect(c.kind).toBe('mate');
    expect(c.name).toBe('马后炮');
    expect(bannerContent('mate', { label: '困毙' }).name).toBe('困毙');
    expect(bannerContent('mate', { label: '八脚马' }).name).toBe('八脚马');
  });

  it('绝杀缺省：没有杀法名时大字退回「绝杀」', () => {
    expect(bannerContent('mate').name).toBe('绝杀');
    expect(bannerContent('mate', { label: '' }).name).toBe('绝杀');
  });

  it('不改动传入参数', () => {
    const opts = { label: '闷杀' };
    const c = bannerContent('mate', opts);
    expect(c.name).toBe('闷杀');
    expect(opts).toEqual({ label: '闷杀' });
  });
});
