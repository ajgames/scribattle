import { Howl } from 'howler';

/**
 * Tiny SFX layer over howler. The mp3s live in public/sounds (Mixkit free
 * license — friendly game-UI one-shots). Howls are built lazily on first
 * play so SSR never touches WebAudio, and howler itself queues the browser
 * autoplay unlock behind the first user gesture.
 */
const FILES = {
  join: 'join.mp3',
  leave: 'leave.mp3',
  roundStart: 'round-start.mp3',
  roundEnd: 'round-end.mp3',
  newWord: 'new-word.mp3',
  countdown: 'countdown.mp3',
  correct: 'correct.mp3',
} as const;

export type SoundName = keyof typeof FILES;

const VOLUME = 0.5;
const cache = new Map<SoundName, Howl>();

export function playSound(name: SoundName): void {
  if (typeof window === 'undefined') return;
  let howl = cache.get(name);
  if (!howl) {
    howl = new Howl({ src: [`/sounds/${FILES[name]}`], volume: VOLUME });
    cache.set(name, howl);
  }
  howl.play();
}
