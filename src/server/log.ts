/**
 * 主机端结构化日志（C5）。
 *
 * 用途：局域网排障——连接 / 断开 / 走子 / 终局等关键事件默认输出到控制台。
 * 开关：环境变量 `LANSCHESS_DEBUG`
 *   - 未设置    → info 级打点（默认输出）
 *   - `1`/`true`/`debug` → 追加 debug 明细（消息级、静态未命中等）
 *   - `0`/`off`/`false`  → 全部关闭
 * 文件输出：无头服务端（桌面版 `--server`）没有控制台，由入口调用 `setLogFile()` 追加写入文件。
 */

import fs from 'node:fs';
import path from 'node:path';

type LogMode = 'off' | 'info' | 'debug';

/** 当前日志文件（null 表示只输出控制台） */
let fileSink: string | null = null;

/** 每次调用时读取环境变量，便于测试与运行时切换 */
function mode(): LogMode {
  const v = (process.env.LANSCHESS_DEBUG ?? '').trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  if (v === '1' || v === 'true' || v === 'debug') return 'debug';
  return 'info';
}

/** 启用 / 关闭文件日志；目录不存在时自动创建，不可写则静默降级为仅控制台 */
export function setLogFile(file: string | null): void {
  fileSink = null;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fileSink = file;
  } catch {
    /* 日志文件不可用不应影响服务器运行 */
  }
}

/** 写入一行（带 ISO 时间戳）；写文件失败不影响主流程 */
function write(line: string): void {
  if (!fileSink) return;
  try {
    fs.appendFileSync(fileSink, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* 忽略磁盘写入错误 */
  }
}

/** 关键事件打点（默认输出） */
export function logInfo(msg: string): void {
  if (mode() === 'off') return;
  const line = `[lan-chess] ${msg}`;
  console.log(line);
  write(line);
}

/** 排障明细（仅在 LANSCHESS_DEBUG 开启时输出） */
export function logDebug(msg: string): void {
  if (mode() !== 'debug') return;
  const line = `[lan-chess][debug] ${msg}`;
  console.log(line);
  write(line);
}
