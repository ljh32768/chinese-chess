/**
 * 打包脚本：先把「Electron 发行包 / electron-builder 二进制」的下载源固定到 npmmirror
 * 镜像，再调用 electron-builder 产出 Windows 安装包。
 *
 * 为什么需要它：electron-builder **不复用** `node_modules/electron`，而是从自己的缓存
 * `%LOCALAPPDATA%\electron-builder\Cache` 取「目标平台的 Electron 发行包」，未命中时默认
 * 去 **GitHub** 下载（还要 winCodeSign / nsis 等打包工具）。国内网络常连不上 GitHub
 * （`connect ETIMEDOUT`），这里统一改走 npmmirror。
 *
 * 换源：若环境里已设置同名变量（如内网镜像），以环境变量为准，不会被覆盖。
 *
 * 离线打包：首次联网执行一次会把 Electron / nsis / winCodeSign 等拉进本机缓存，
 * 之后断网也能打包（缓存就绪即不再发起下载）。
 *
 * 用法：`npm run dist`                     → 等价 `node scripts/dist.mjs --win`
 *       `node scripts/dist.mjs --win --dir` → 参数透传给 electron-builder
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');

/** 默认镜像（国内可达）；已由环境变量指定时沿用环境变量 */
const DEFAULT_MIRRORS = {
  ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
};

const env = { ...process.env };
for (const [key, value] of Object.entries(DEFAULT_MIRRORS)) {
  if (!env[key]) env[key] = value;
}

const args = process.argv.slice(2);
if (args.length === 0) args.push('--win');

console.log(`[dist] ELECTRON_MIRROR=${env.ELECTRON_MIRROR}`);
console.log(`[dist] ELECTRON_BUILDER_BINARIES_MIRROR=${env.ELECTRON_BUILDER_BINARIES_MIRROR}`);

const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, stdio: 'inherit' });
if (result.error) {
  console.error(`[dist] 无法启动 electron-builder：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
