/**
 * 主机端结构化日志（C5）。
 *
 * 用途：局域网排障——连接 / 断开 / 走子 / 终局等关键事件默认输出到控制台。
 * 开关：环境变量 `LANSCHESS_DEBUG`
 *   - 未设置    → info 级打点（默认输出）
 *   - `1`/`true`/`debug` → 追加 debug 明细（消息级、静态未命中等）
 *   - `0`/`off`/`false`  → 全部关闭
 */

type LogMode = 'off' | 'info' | 'debug';

/** 每次调用时读取环境变量，便于测试与运行时切换 */
function mode(): LogMode {
  const v = (process.env.LANSCHESS_DEBUG ?? '').trim().toLowerCase();
  if (v === '0' || v === 'off' || v === 'false') return 'off';
  if (v === '1' || v === 'true' || v === 'debug') return 'debug';
  return 'info';
}

/** 关键事件打点（默认输出） */
export function logInfo(msg: string): void {
  if (mode() !== 'off') console.log(`[lan-chess] ${msg}`);
}

/** 排障明细（仅在 LANSCHESS_DEBUG 开启时输出） */
export function logDebug(msg: string): void {
  if (mode() === 'debug') console.log(`[lan-chess][debug] ${msg}`);
}
