/**
 * 构建辅助：把渲染层静态资源从 src/renderer 复制到 dist/renderer。
 * （tsc 只处理 .ts，HTML/CSS 与图片音效素材需要单独拷贝。）
 *
 * 皮卡鱼引擎**不在此复制**：
 * - 打包：由 electron-builder 的 `extraResources` 直接从 `Reference/` 放到
 *   `resources/dist/engine/`（asar 之外，可直接 spawn，无需 asarUnpack）；
 * - 开发态（`npm run serve` / `npm run dev`）：由 `src/server/pikafish.ts` 的
 *   引擎发现回退到仓库内 `Reference/Pikafish皮卡鱼20260925/`。
 * 两处都找不到引擎时，运行时会自动回退纯 TS 引擎。
 */

import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src', 'renderer');
const outDir = path.join(root, 'dist', 'renderer');

mkdirSync(outDir, { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  cpSync(path.join(srcDir, file), path.join(outDir, file));
}
// 棋盘 / 棋子 / 按钮 / 音效素材（含参考项目 MIT 许可说明）
cpSync(path.join(srcDir, 'assets'), path.join(outDir, 'assets'), { recursive: true });
console.log('[build] 静态资源已复制到 dist/renderer');
