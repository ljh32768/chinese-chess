/**
 * 音效模块（素材与参考项目一致：click.wav / select.wav）。
 * 浏览器要求播放前有用户手势，走子/选中都发生在点击里，播放失败静默忽略。
 */

const SRC = {
  click: './assets/audio/click.wav',
  select: './assets/audio/select.wav',
} as const;

type SoundKey = keyof typeof SRC;

const cache = new Map<SoundKey, HTMLAudioElement>();

function play(key: SoundKey): void {
  try {
    let audio = cache.get(key);
    if (!audio) {
      audio = new Audio(SRC[key]);
      audio.preload = 'auto';
      cache.set(key, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
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
