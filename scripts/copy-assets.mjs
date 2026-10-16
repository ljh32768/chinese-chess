/**
 * 构建辅助：
 * 1. 把渲染层静态资源从 src/renderer 复制到 dist/renderer（tsc 只处理 .ts）；
 * 2. 尽力把皮卡鱼引擎（平台对应二进制 + 权重）从 Reference/ 复制到 dist/engine，
 *    供打包与运行时发现。缺失时**只告警不报错**（无引擎时运行时会回退纯 TS 引擎）。
 */

import { chmodSync, cpSync, existsSync, mkdirSync } from 'node:fs';
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

// ---------------------------------------------------------------- 皮卡鱼引擎

/** 各平台引擎文件名（与 src/server/pikafish.ts 保持一致） */
const ENGINE_FILE = {
  win32: 'Pikafish-Windows-x86-64-universal.exe',
  linux: 'Pikafish-Linux-x86-64-universal',
  darwin: 'Pikafish-MacOS-universal',
};
const REFERENCE_DIR = 'Pikafish皮卡鱼20260925';

const engineFile = ENGINE_FILE[process.platform] ?? ENGINE_FILE.win32;
const srcEngine = path.join(root, 'Reference', REFERENCE_DIR, engineFile);
const srcNnue = path.join(root, 'Reference', REFERENCE_DIR, 'pikafish.nnue');
const outEngineDir = path.join(root, 'dist', 'engine');

if (!existsSync(srcEngine)) {
  console.warn(`[build] 未找到皮卡鱼引擎（${srcEngine}），跳过复制：运行时将回退纯 TS 引擎`);
} else {
  mkdirSync(outEngineDir, { recursive: true });
  cpSync(srcEngine, path.join(outEngineDir, engineFile));
  if (process.platform !== 'win32') chmodSync(path.join(outEngineDir, engineFile), 0o755);
  if (existsSync(srcNnue)) {
    cpSync(srcNnue, path.join(outEngineDir, 'pikafish.nnue'));
  } else {
    console.warn('[build] 未找到 pikafish.nnue，引擎可能无法加载权重');
  }
  console.log(`[build] 皮卡鱼引擎已复制到 dist/engine（${engineFile}）`);
}
