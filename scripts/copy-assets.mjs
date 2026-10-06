/**
 * 构建辅助：把渲染层静态资源从 src/renderer 复制到 dist/renderer。
 * （tsc 只处理 .ts，HTML/CSS 与图片音效素材需要单独拷贝。）
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
