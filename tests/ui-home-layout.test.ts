/**
 * 主界面（首页 / 等待 / 加入）布局规格测试：
 * 1) 主页背景 init_bg.png 的署名文字已用 cover.bmp 木板条带覆盖（像素级验证，透明区不受影响）；
 * 2) 主界面整体放大：木质挂板与页脚提示按 --ui-scale 等比缩放，对局页 / 对局回顾页不使用缩放；
 * 3) 三个子面板（创建对局 / 加入对局 / 人机对弈）与木板内框对齐（几何常量契约）。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 注释先剥离，避免注释中的文字混入选择器
const CSS = readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const BG_PNG = path.join(ROOT, 'src', 'renderer', 'assets', 'img', 'init_bg.png');

// ---------------------------------------------------------------- CSS 解析辅助

interface CssRule {
  selectors: string[];
  decls: string;
}

/** 极简 CSS 规则拆分：取「选择器 { 声明 }」；@media 内的规则也能逐个匹配 */
function cssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selectors = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('@'));
    if (selectors.length) rules.push({ selectors, decls: m[2] });
  }
  return rules;
}

const RULES = cssRules(CSS);

/** 取某选择器的声明文本（同一选择器取最先出现的一条规则） */
function declsOf(selector: string): string {
  const rule = RULES.find((r) => r.selectors.includes(selector));
  return rule ? ';' + rule.decls : '';
}

/** 取属性值（字符串，未做单位解析） */
function decl(selector: string, prop: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(declsOf(selector));
  return m ? m[1].trim() : undefined;
}

/** 取长度值（px） */
function px(selector: string, prop: string): number | undefined {
  const v = decl(selector, prop);
  if (v === undefined) return undefined;
  const m = /^(-?[\d.]+)px$/.exec(v);
  return m ? Number(m[1]) : undefined;
}

/** 解析 margin 简写，返回 [top, right, bottom, left]（允许无单位的 0） */
function margin(selector: string): number[] {
  const v = decl(selector, 'margin') ?? '';
  const nums = v.split(/\s+/).map((t) => Number(/^(-?[\d.]+)(?:px)?$/.exec(t)?.[1]));
  if (nums.length === 1) return [nums[0], nums[0], nums[0], nums[0]];
  if (nums.length === 2) return [nums[0], nums[1], nums[0], nums[1]];
  if (nums.length === 3) return [nums[0], nums[1], nums[2], nums[1]];
  if (nums.length === 4) return nums;
  throw new Error(`无法解析 margin: "${v}"`);
}

// ---------------------------------------------------------------- 索引 PNG 解码

interface IndexedPng {
  width: number;
  height: number;
  palette: number[][];
  alpha: number[];
  indices: Uint8Array;
}

/** 解码 8bit 索引（colorType 3）非交错 PNG：验证素材像素所需的最小实现 */
function decodeIndexedPng(buf: Buffer): IndexedPng {
  let off = 8;
  const chunks: { type: string; data: Buffer }[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR')!.data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 3 || ihdr[12] !== 0) {
    throw new Error(`init_bg.png 格式变化：bitDepth=${ihdr[8]} colorType=${ihdr[9]} interlace=${ihdr[12]}`);
  }
  const plte = chunks.find((c) => c.type === 'PLTE')!.data;
  const palette: number[][] = [];
  for (let i = 0; i < plte.length; i += 3) palette.push([plte[i], plte[i + 1], plte[i + 2]]);
  const alpha = new Array(palette.length).fill(255);
  const trns = chunks.find((c) => c.type === 'tRNS');
  if (trns) for (let i = 0; i < trns.data.length; i++) alpha[i] = trns.data[i];

  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = width;
  const indices = new Uint8Array(height * width);
  const prev = new Uint8Array(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 1 ? cur[x - 1] : 0;
      const b = prev[x];
      const c = x >= 1 ? prev[x - 1] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
    indices.set(cur, y * stride);
    prev.set(cur);
  }
  return { width, height, palette, alpha, indices };
}

// ---------------------------------------------------------------- 主页背景（cover 覆盖）

describe('主页背景：署名文字已被 cover.bmp 覆盖', () => {
  const img = decodeIndexedPng(readFileSync(BG_PNG));

  it('仍是 316×422 的索引 PNG（保留调色板与透明区）', () => {
    expect({ w: img.width, h: img.height }).toEqual({ w: 316, h: 422 });
    // 透明区（画面四角在木板轮廓之外）与不透明区（木面）保持原样
    expect(img.alpha[img.indices[5 * img.width + 5]]).toBe(0);
    expect(img.alpha[img.indices[380 * img.width + 10]]).toBe(255);
  });

  it('署名文字区域已被木板条带覆盖（无暗色文字像素）', () => {
    // 原文字实测范围 x 43..252、y 377..389（文字色 ≈ RGB 83,59,32）；
    // 覆盖后为 cover.bmp 条带木色（≈ RGB 138,103,70），取稍大范围扫描
    let minR = 255;
    let minG = 255;
    let minA = 255;
    for (let y = 375; y <= 391; y++) {
      for (let x = 40; x <= 256; x++) {
        const i = img.indices[y * img.width + x];
        minR = Math.min(minR, img.palette[i][0]);
        minG = Math.min(minG, img.palette[i][1]);
        minA = Math.min(minA, img.alpha[i]);
      }
    }
    expect(minR).toBeGreaterThan(110);
    expect(minG).toBeGreaterThan(85);
    expect(minA).toBe(255);
  });
});

// ---------------------------------------------------------------- 主界面整体放大

describe('主界面整体放大：--ui-scale', () => {
  it('放大比例大于 1', () => {
    expect(Number(decl(':root', '--ui-scale'))).toBeGreaterThan(1);
  });

  it('仅木质挂板与页脚提示缩放；对局页 / 对局回顾页不受影响', () => {
    const zoomSelectors = RULES.filter((r) => /(?:^|;)\s*zoom\s*:/.test(';' + r.decls))
      .map((r) => r.selectors.join(', '))
      .sort();
    expect(zoomSelectors).toEqual(['.home-hint', '.menu_box']);
    for (const sel of ['.game-layout', '.chess-box', '.panel', '.review_box', '.modal']) {
      expect(decl(sel, 'zoom')).toBeUndefined();
    }
  });

  it('背景图随挂板等比放大（挂板尺寸 = 素材尺寸，zoom 作用于整个挂板）', () => {
    expect(px('.menu_box', 'width')).toBe(316);
    expect(decl('.menu_box', 'background')).toContain('init_bg.png');
    expect(decl('.menu_box', 'zoom')).toBe('var(--ui-scale)');
  });
});

// ---------------------------------------------------------------- 面板与木框对齐

describe('子面板与木板内框对齐（创建 / 加入 / 人机）', () => {
  // 素材 316×422；木板内框实测 x≈10..290、y≈158..395
  const FRAME = { x: 10, y: 158, w: 280, h: 237 };

  it('挂板内容区从内框上沿开始，padding box 完整覆盖 422 高的背景图', () => {
    expect(px('.menu_box', 'padding-top')).toBe(FRAME.y);
    expect(px('.menu_box', 'height')).toBe(422 - FRAME.y);
    // 首页 5 个按钮仍在原位置（y = 190 起），不因对齐调整而位移
    expect(px('.menu_init', 'padding-top')).toBe(190 - FRAME.y);
  });

  it('面板与内框同宽同左（加入 / 人机共用 .menu_info；等待页铺满内框）', () => {
    expect(px('.menu_info', 'width')).toBe(FRAME.w);
    const [mt, , mb, ml] = margin('.menu_info');
    expect({ mt, ml, mb }).toEqual({ mt: 0, ml: FRAME.x, mb: 8 });
    // 等待页版块高度 = 内框高度
    expect(px('.menu_info.wide', 'height')).toBe(FRAME.h);
    // 面板顶部（158）+ 等待版块高度（237）= 395 = 内框下沿
    expect(FRAME.y + FRAME.h).toBe(395);
  });

  it('面板下方按钮（开始对弈 / 连接）落在内框内：面板限高 + 8px 间距 + 46px 按钮', () => {
    const BTN = 46;
    expect(px('#screen-join .menu_info', 'max-height')).toBe(FRAME.h - BTN - 8);
    expect(px('.menu_dy a', 'margin-top')).toBe(8);
    expect(px('#btn-connect', 'margin-top')).toBe(8);
    expect(px('#btn-server-enter', 'margin-top')).toBe(8);
    expect(px('.menu_box a', 'height')).toBe(BTN);
  });
});

// ---------------------------------------------------------------- 面板内列表行

describe('窄面板内的列表行不会被撑破（连接服务器 / 加入房间）', () => {
  it('整行按钮只作用于直接子元素，不会命中列表行内的并排小按钮', () => {
    expect(decl('.menu_info > .btn', 'width')).toBe('100%');
    // 若退回「后代选择器」写法，房间行里的「加入 / 观战」会被撑到整行宽而溢出被裁剪
    expect(RULES.some((r) => r.selectors.includes('.menu_info .btn'))).toBe(false);
  });

  it('列表行用 flex 排布，信息项 min-width 归零（可省略），按钮不参与拉伸', () => {
    expect(decl('.room-row', 'display')).toBe('flex');
    expect(decl('.room-row .btn', 'flex')).toBe('none');
    expect(decl('.room-row .room-info', 'min-width')).toBe('0');
    expect(decl('.server-row .addr', 'min-width')).toBe('0');
    expect(decl('.server-manual .btn', 'flex')).toBe('none');
    // 横向裁掉溢出内容，避免出现横向滚动条
    expect(decl('#screen-join .menu_info', 'overflow-x')).toBe('hidden');
  });

  it('hidden 属性必须生效（需盖过 .menu_info label 等更具体的选择器）', () => {
    expect(decl('[hidden]', 'display')).toBe('none !important');
  });
});
