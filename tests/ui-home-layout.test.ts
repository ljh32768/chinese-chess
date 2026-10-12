/**
 * 主界面（首页 / 等待 / 加入）布局规格测试：
 * 1) 主页背景 init_bg.png 的署名文字已用 cover.bmp 木板条带覆盖（像素级验证，透明区不受影响）；
 * 2) 首页木质挂板按 --ui-scale 等比缩放；点击板块后的界面改用「大面板」（参考对局回顾），不再与木框对齐；
 * 3) 大面板内的列表行（房间 / 玩家）不会被撑破，离线玩家置灰且不显示邀请按钮；
 * 4) 底部小字（服务器 / 已登录）已删除，等待页取先方式为下拉框（默认猜先）；
 * 5) v2.4 视觉与交互精修：设计令牌、焦点可见、切屏 / 弹层动效、减少动态效果、状态框「轮到你走棋」强调。
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
const HTML = readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
const APP = readFileSync(path.join(ROOT, 'src', 'renderer', 'app.ts'), 'utf8');
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

// ---------------------------------------------------------------- 首页挂板与整体放大

describe('首页木质挂板：仅入口，按 --ui-scale 放大', () => {
  it('放大比例大于 1', () => {
    expect(Number(decl(':root', '--ui-scale'))).toBeGreaterThan(1);
  });

  it('仅木质挂板缩放；大面板 / 对局页 / 对局回顾页不受影响', () => {
    const zoomSelectors = RULES.filter((r) => /(?:^|;)\s*zoom\s*:/.test(';' + r.decls))
      .map((r) => r.selectors.join(', '))
      .sort();
    expect(zoomSelectors).toEqual(['.menu_box']);
    for (const sel of ['.game-layout', '.chess-box', '.panel', '.review_box', '.modal', '.panel-lg']) {
      expect(decl(sel, 'zoom')).toBeUndefined();
    }
  });

  it('背景图随挂板等比放大（挂板尺寸 = 素材尺寸，zoom 作用于整个挂板）', () => {
    expect(px('.menu_box', 'width')).toBe(316);
    expect(decl('.menu_box', 'background')).toContain('init_bg.png');
    expect(decl('.menu_box', 'zoom')).toBe('var(--ui-scale)');
    // 首页挂板只承载入口按钮（v2.5 起 6 个：创建/加入/人机/残局/回顾/皮肤），不再嵌套子面板
    expect(HTML).toMatch(/<div class="menu_box" id="menu-board">[\s\S]*?id="menu-index"/);
  });

  it('6 个入口按钮正好铺满挂板内框（43×6 + 6 = 264）', () => {
    const boardHtml = HTML.slice(HTML.indexOf('id="menu-board"'), HTML.indexOf('id="menu-create"'));
    expect((boardHtml.match(/<a id="/g) ?? []).length).toBe(6);
    // 内框可用高度 = 422（背景图高） - 158（顶部标题区）
    expect(px('.menu_box', 'height')).toBe(264);
    expect(px('.menu_init', 'padding-top')).toBe(6);
    expect(px('.menu_box a', 'height')).toBe(43);
    expect(6 * 43 + 6).toBe(264);
    // 按钮素材 214×92（正常 / 悬停两态各 46px）等比压到 43px，悬停偏移同步
    expect(decl('.menu_box a', 'background-size')).toBe('214px 86px');
    expect(decl('.menu_box a:hover', 'background-position')).toBe('center -43px');
  });
});

// ---------------------------------------------------------------- 点击板块后的大面板

describe('点击板块后的界面：不再与木框对齐，改用大面板（参考对局回顾）', () => {
  it('大面板与「对局回顾」同款：宽 620、限高可滚动', () => {
    expect(decl('.panel-lg', 'max-width')).toBe('620px');
    expect(decl('.review_box', 'max-width')).toBe('620px');
    expect(decl('.panel-lg', 'overflow-y')).toBe('auto');
    expect(decl('.panel-lg', 'max-height')).toBe('calc(100vh - 48px)');
  });

  it('已删除「与木板内框对齐」的窄面板规则（.menu_info / 280 宽 / 内框几何常量）', () => {
    expect(RULES.some((r) => r.selectors.some((s) => s.startsWith('.menu_info')))).toBe(false);
    // 大面板不再出现 280px 宽或 237px 高这类内框尺寸
    const values = RULES.flatMap((r) => [decl(r.selectors[0], 'width'), decl(r.selectors[0], 'max-height')]);
    expect(values).not.toContain('280px');
    expect(values).not.toContain('237px');
  });

  it('首页各面板 / 连接服务器 / 等待 / 加入 都用大面板承载', () => {
    for (const id of ['menu-create', 'menu-ai', 'menu-endgame', 'menu-acct', 'server-panel']) {
      const idx = HTML.indexOf(`id="${id}"`);
      expect(idx).toBeGreaterThan(-1);
      // 元素自身带 panel-lg 类
      expect(HTML.slice(HTML.lastIndexOf('<', idx), HTML.indexOf('>', idx))).toContain('panel-lg');
    }
    for (const id of ['screen-host', 'screen-join']) {
      const idx = HTML.indexOf(`id="${id}"`);
      expect(idx).toBeGreaterThan(-1);
      // 整屏承载的大面板
      expect(HTML.slice(idx, HTML.indexOf('</section>', idx))).toContain('class="panel-lg"');
    }
  });

  it('整行按钮只作用于 .btn.block，列表行内的小按钮显式复位外边距', () => {
    expect(decl('.btn.block', 'width')).toBe('100%');
    expect(decl('.modal .btn', 'flex')).toBe('1');
    // 列表行里的并排小按钮不被整行规则影响
    for (const sel of ['.room-row .btn', '.player-item .btn', '.server-row .btn']) {
      expect(decl(sel, 'margin-top')).toBe('0');
      expect(decl(sel, 'width')).toBeUndefined();
    }
    // 并排按钮行按 flex 等分，不取整行宽
    expect(decl('.scan-actions .btn', 'width')).toBe('auto');
  });
});

// ---------------------------------------------------------------- 列表行与邀请玩家

describe('大面板内的列表行（房间 / 服务器 / 邀请玩家）', () => {
  it('列表行用 flex 排布，信息项 min-width 归零（可省略），按钮不参与拉伸', () => {
    expect(decl('.room-row', 'display')).toBe('flex');
    expect(decl('.room-row .btn', 'flex')).toBe('none');
    expect(decl('.room-row .room-info', 'min-width')).toBe('0');
    expect(decl('.server-row .addr', 'min-width')).toBe('0');
    expect(decl('.server-manual .btn', 'flex')).toBe('none');
    expect(decl('.player-item .p-name', 'min-width')).toBe('0');
    expect(decl('.player-item .btn', 'flex')).toBe('none');
  });

  it('邀请玩家：宽版弹层 + 玩家列表；离线 / 对局中的玩家置灰且不显示邀请按钮', () => {
    expect(decl('.modal.wide', 'max-width')).toBe('520px');
    expect(decl('.player-item', 'display')).toBe('flex');
    expect(decl('.player-item.offline', 'opacity')).toBe('0.6');
    expect(decl('.player-item.busy', 'opacity')).toBe('0.72');
    expect(RULES.some((r) => r.selectors.includes('.player-item.offline .btn'))).toBe(true);
    expect(RULES.some((r) => r.selectors.includes('.player-item.busy .btn'))).toBe(true);
    // 弹层新增富内容容器（玩家列表挂在这里）
    expect(HTML).toContain('id="modal-body"');
    expect(decl('.modal-body', 'overflow-y')).toBe('auto');
  });

  it('hidden 属性必须生效（需盖过 label / .btn 等更具体的选择器）', () => {
    expect(decl('[hidden]', 'display')).toBe('none !important');
  });
});

// ---------------------------------------------------------------- 文案与表单

describe('其他界面约定', () => {
  it('底部小字「服务器 xxx · 已登录 xxx」已删除', () => {
    expect(HTML).not.toContain('home-hint');
    expect(CSS).not.toContain('home-hint');
  });

  it('等待页取先方式改为下拉框，默认猜先', () => {
    expect(HTML).toMatch(/<select id="first-mode">[\s\S]*?<option value="guess" selected>/);
    expect(HTML).toContain('<option value="random">');
    expect(HTML).toContain('<option value="r">');
    expect(HTML).toContain('<option value="b">');
    // 原四个先手按钮已移除
    expect(HTML).not.toContain('side_opts');
    expect(CSS).not.toContain('side_opt');
  });

  it('对局回顾支持「全部对局 / 我的历史」切换（含身份说明位）', () => {
    expect(HTML).toContain('id="tab-history-all"');
    expect(HTML).toContain('id="tab-history-mine"');
    expect(HTML).toContain('id="history-note"');
    expect(decl('.review_tab.active', 'background')).toBeTruthy();
    expect(decl('.review_scope_note', 'text-align')).toBe('right');
  });
});

// ---------------------------------------------------------------- v2.4 视觉与交互精修

describe('v2.4 视觉与交互精修', () => {
  it('设计令牌集中在 :root（木色层次 / 强调金 / 焦点环 / 缓动）', () => {
    expect(decl(':root', '--ui-scale')).toBe('1.25');
    expect(decl(':root', '--gold')).toBe('#ffcf7a');
    expect(decl(':root', '--surface-3')).toBeTruthy();
    expect(decl(':root', '--focus-ring')).toBeTruthy();
    expect(decl(':root', '--ease')).toBeTruthy();
  });

  it('键盘焦点可见：按钮 / 标签页 / 列表行 / 挂板入口都有焦点环', () => {
    const focusRule = RULES.find((r) => r.selectors.includes('.btn:focus-visible'));
    expect(focusRule).toBeTruthy();
    expect(focusRule!.decls).toContain('--focus-ring');
    for (const sel of ['.chip:focus-visible', '.review_tab:focus-visible', '.room-row:focus-visible']) {
      expect(focusRule!.selectors).toContain(sel);
    }
    expect(decl('.menu_box a:focus-visible', 'outline')).toContain('--gold');
  });

  it('动效克制：切屏淡入上浮、弹层缩放淡入，且可被「减少动态效果」整体关闭', () => {
    expect(decl('.screen.active', 'animation')).toContain('screen-in');
    expect(decl('.modal-mask.show', 'animation')).toContain('fade-in');
    expect(decl('.modal-mask.show .modal', 'animation')).toContain('modal-in');
    expect(CSS).toContain('prefers-reduced-motion: reduce');
    const reduced = RULES.find((r) => r.selectors.includes('*') && r.decls.includes('animation-duration'));
    expect(reduced).toBeTruthy();
  });

  it('对局状态框：「轮到你走棋」用浅金实底强调，由 app.ts 切换 .mine', () => {
    expect(decl('.status-box.mine', 'background')).toBeTruthy();
    expect(APP).toContain("classList.toggle('mine'");
    // 将军 / 终局态仍在 .mine 之后定义，优先级更高（沿用原有警示配色）
    expect(decl('.status-box.check', 'color')).toBe('#ffb066');
    expect(decl('.status-box.over.win-red', 'color')).toBe('#ff9d8a');
  });

  it('细节修正：空标签不渲染、toast 允许换行、右上角入口可省略、房间号做徽章', () => {
    expect(decl('.tag:empty', 'display')).toBe('none');
    expect(decl('.toast', 'white-space')).toBeUndefined();
    expect(decl('.toast', 'max-width')).toBeTruthy();
    expect(decl('.chip', 'text-overflow')).toBe('ellipsis');
    expect(decl('.room-row .room-no', 'background')).toBeTruthy();
    // 背景暗角（纯装饰层，不接收事件）
    expect(decl('body::before', 'pointer-events')).toBe('none');
    expect(decl('body::before', 'background')).toContain('radial-gradient');
  });

  it('轻提示具备无障碍语义（status / polite）', () => {
    expect(HTML).toContain('id="toast" role="status" aria-live="polite"');
  });
});

describe('v2.4 终局杀法展示', () => {
  it('对局侧栏含杀法框（杀法名 / 解说 / 同时构成），显隐由 app.ts 控制', () => {
    for (const id of ['kill-box', 'kill-name', 'kill-def', 'kill-also']) {
      expect(HTML).toContain(`id="${id}"`);
    }
    expect(APP).toContain("const killBox = $('kill-box')");
    expect(APP).toContain('killBox.hidden = !mate');
    expect(APP).toContain('function mateInfo()');
  });

  it('复盘页含「终局杀法」面板（按记录着法即时识别）', () => {
    for (const id of ['replay-mate-box', 'replay-mate-name', 'replay-mate-def', 'replay-mate-also']) {
      expect(HTML).toContain(`id="${id}"`);
    }
    expect(HTML).toContain('终局杀法');
  });

  it('杀法框沿用 v2.4 设计令牌（与状态框同款面板、单一强调金）', () => {
    expect(decl('.kill-box', 'border')).toBe('1px solid var(--line)');
    expect(decl('.kill-box', 'border-radius')).toBe('var(--radius-sm)');
    expect(decl('.kill-name', 'color')).toBe('var(--gold)');
    expect(decl('.kill-def', 'color')).toBe('var(--text-dim)');
    expect(decl('.kill-also', 'color')).toBe('var(--text-mute)');
    // 黑方致胜时杀法名换用冷色，与状态框的 win-black 呼应
    expect(decl('.kill-box.win-black .kill-name', 'color')).toBe('#bcd2e8');
    // 空的「同时构成」不占位
    expect(decl('.kill-also:empty', 'display')).toBe('none');
  });

  it('小屏（<=900px）下杀法框与状态框同列铺满', () => {
    const rule = RULES.find((r) => r.selectors.includes('.kill-box') && r.decls.includes('flex: 1 1 100%'));
    expect(rule).toBeTruthy();
  });
});
