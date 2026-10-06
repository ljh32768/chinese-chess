/**
 * 音效模块（素材与参考项目一致：click.wav / select.wav）。
 *
 * 播放方式与参考项目保持一致：使用 index.html 中常驻的 <audio preload="auto"> 元素，
 * 直接 play()，**不重置 currentTime**。
 * 重置进度会在声音尚未播完时强行 seek，产生截断杂音（原版没有这个问题）。
 */

const AUDIO_ID = {
  click: 'click-audio',
  select: 'select-audio',
} as const;

type SoundKey = keyof typeof AUDIO_ID;

function play(key: SoundKey): void {
  try {
    const el = document.getElementById(AUDIO_ID[key]) as HTMLAudioElement | null;
    if (!el) return;
    // 播完后再触发时浏览器会自动从头播放；播放中重复调用为无操作（与原版一致）
    void el.play().catch(() => undefined);
  } catch {
    /* 忽略：音效不可用不影响对局 */
  }
}

/** 走子音效 */
export function playClick(): void {
  play('click');
}

/** 选子音效 */
export function playSelect(): void {
  play('select');
}
