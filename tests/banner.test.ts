/**
 * 棋盘正中提示（吃 / 将 / 绝杀纯文字大字）的内容与优先级测试。
 * v3.7 起提示不再有黑色圆底 / 圆框与副标题；v3.40 起被将军固定单字「将」，
 * 绝杀先显示具体杀法名、特判显示结束后再接「绝杀」；
 * v3.45 起新增「吃」提示，优先级低于「将」与「绝杀」。
 */

import { describe, expect, it } from 'vitest';
import { bannerContent, bannerPriority } from '../src/renderer/banner.js';

/** 进行中、未被将军、未吃子的基准局面 */
const idle = { over: false, reason: null, check: false, captured: false };

describe('提示内容 bannerContent', () => {
  it('将：被将军时固定大字「将」', () => {
    const c = bannerContent('check');
    expect(c.kind).toBe('check');
    expect(c.name).toBe('将');
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

describe('吃：新增的吃子提示', () => {
  it('吃：吃子时固定大字「吃」', () => {
    const c = bannerContent('capture');
    expect(c.kind).toBe('capture');
    expect(c.name).toBe('吃');
    // 忽略多余的杀法名参数，仍是单字「吃」
    expect(bannerContent('capture', { label: '马后炮' }).name).toBe('吃');
  });

  it('吃子提示出现：仅吃子、未被将军时显示「吃」', () => {
    expect(bannerPriority({ ...idle, captured: true })).toBe('capture');
  });

  it('无吃子时不显示：无事发生（未将军、未吃子、未终局）返回 null', () => {
    expect(bannerPriority(idle)).toBeNull();
    expect(bannerPriority({ ...idle, reason: '认输' })).toBeNull();
  });
});

describe('提示优先级：绝杀 > 将 > 吃', () => {
  it('吃子同时被将军时只显示「将」，吃子被压过', () => {
    expect(bannerPriority({ ...idle, check: true, captured: true })).toBe('check');
  });

  it('吃子同时将死时只显示「绝杀」，吃子被压过', () => {
    expect(bannerPriority({ over: true, reason: '将死', check: false, captured: true })).toBe('mate');
  });

  it('将死且被将军（将死局面恒被将军）仍只显示「绝杀」', () => {
    expect(bannerPriority({ over: true, reason: '将死', check: true, captured: true })).toBe('mate');
  });

  it('吃子同时困毙时只显示「困毙」（绝杀条目）', () => {
    expect(bannerPriority({ over: true, reason: '困毙', check: false, captured: true })).toBe('mate');
  });

  it('终局但原因不是将死 / 困毙（如认输）时任何提示都不显示', () => {
    expect(bannerPriority({ over: true, reason: '认输', check: true, captured: true })).toBeNull();
  });
});
