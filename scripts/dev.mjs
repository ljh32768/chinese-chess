/**
 * 开发脚本（C2）：tsc watch + 主机端自动重启。
 *
 * - 首次完整构建（tsc + 复制静态资源）
 * - 此后监听 dist 变化自动重启 Node 主机端，监听 src/renderer 的 html/css 变化自动复制资源
 * - Ctrl+C 退出并清理子进程
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const runOnce = (cmd, args) =>
  spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

console.log('[dev] 首次构建…');
const first = runOnce('npx', ['tsc']);
if (first.status !== 0) process.exit(first.status ?? 1);
runOnce(process.execPath, ['scripts/copy-assets.mjs']);

let child = null;
const startServer = () => {
  if (child) child.kill();
  child = spawn(process.execPath, ['dist/server/cli.js'], { stdio: 'inherit' });
};

startServer();

// tsc watch：编译产物写入 dist 后触发重启
const tscWatch = spawn('npx', ['tsc', '-w', '--preserveWatchOutput'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

let restartTimer = null;
fs.watch('dist', { recursive: true }, (_event, file) => {
  if (!file || !file.endsWith('.js')) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log('[dev] 检测到编译产物变化，重启主机端…');
    startServer();
  }, 250);
});

// 渲染层静态资源变化时同步到 dist
fs.watch('src/renderer', { recursive: true }, (_event, file) => {
  if (!file || !/\.(html|css)$/.test(file)) return;
  console.log(`[dev] 复制静态资源：${file}`);
  runOnce(process.execPath, ['scripts/copy-assets.mjs']);
});

const shutdown = () => {
  child?.kill();
  tscWatch.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
