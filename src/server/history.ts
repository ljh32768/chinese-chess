/**
 * 对局记录仓库：跨房间集中保存，并落盘到 `data/history.json`。
 *
 * - 写入：终局时由房间调用 `add()`（防抖合并写，避免频繁磁盘 IO）；
 * - 读取：`/api/history` 列表与 `/api/history/:id` 明细、`/api/ai/hint` 复盘推荐；
 * - 容错：文件缺失或损坏时降级为空表并继续启动，不阻塞服务。
 */

import fs from 'node:fs';
import path from 'node:path';
import { GameRecord, GameRecordSummary } from '../shared/types.js';
import { logDebug } from './log.js';

/** 对局记录摘要（剔除着法明细） */
export function toSummary(r: GameRecord): GameRecordSummary {
  return {
    id: r.id,
    roomId: r.roomId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    red: r.red,
    black: r.black,
    firstMode: r.firstMode,
    guess: r.guess,
    winner: r.winner,
    reason: r.reason,
    moveCount: r.moveCount,
  };
}

export class HistoryStore {
  private records: GameRecord[] = [];
  private readonly file: string | null;
  private readonly maxRecords: number;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** @param dataDir 持久化目录；null 表示仅内存（测试用） */
  constructor(dataDir: string | null, maxRecords = 200) {
    this.file = dataDir ? path.join(dataDir, 'history.json') : null;
    this.maxRecords = maxRecords;
    this.load();
  }

  /** 追加一局记录（超出容量时丢弃最旧的），并安排落盘 */
  add(rec: GameRecord): void {
    this.records.push(rec);
    if (this.records.length > this.maxRecords) this.records.shift();
    this.scheduleSave();
  }

  /** 列表（最近在前） */
  list(): GameRecordSummary[] {
    return [...this.records].reverse().map(toSummary);
  }

  /** 单局明细 */
  get(id: string): GameRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /** 立即落盘（服务器关闭前调用，确保不丢记录） */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }

  // ------------------------------------------------------------ 持久化

  private load(): void {
    if (!this.file) return;
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw) as GameRecord[];
      if (Array.isArray(data)) {
        this.records = data.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.moves));
      }
      logDebug(`对局记录已载入：${this.records.length} 局`);
    } catch (err) {
      // 首次启动（文件不存在）或文件损坏：降级为空表，不阻塞服务
      logDebug(`对局记录读取失败（按空表处理）：${String(err)}`);
    }
  }

  /** 防抖落盘：同一批终局只写一次 */
  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 200);
    this.saveTimer.unref();
  }

  private save(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.records, null, 2), 'utf8');
    } catch (err) {
      logDebug(`对局记录写入失败：${String(err)}`);
    }
  }
}
