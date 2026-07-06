/**
 * Timed letter hints for guessers. The current word is already in every
 * client's cache (the `game` table is public), so hints are computed locally:
 * same word + turn + clock → the same letters revealed on every screen, no
 * server round-trips.
 *
 * The reveal count grows *exponentially* with elapsed turn time — almost
 * nothing early, then a rush of letters as the clock runs out. At least one
 * letter always stays hidden so the final seconds are still a guess.
 */

/** Steepness of the exponential reveal curve (higher = more back-loaded). */
const CURVE = 3;

/** Deterministic PRNG — clients must agree on the reveal order. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many of `letterCount` letters are revealed at `elapsedFraction` (0..1). */
export function revealCount(letterCount: number, elapsedFraction: number): number {
  if (letterCount <= 1) return 0;
  const t = Math.min(Math.max(elapsedFraction, 0), 1);
  const f = (Math.exp(CURVE * t) - 1) / (Math.exp(CURVE) - 1);
  return Math.min(Math.floor(letterCount * f), letterCount - 1);
}

/**
 * The guesser's view of the word at `elapsedFraction` through the turn:
 * revealed letters in place, `_` for the rest, letters spaced apart and a
 * wide gap between words (render with whitespace-pre). The reveal order is a
 * shuffle seeded by the turn number, so every client shows the same hints.
 */
export function hintedWordDisplay(word: string, turn: number, elapsedFraction: number): string {
  const letterIdx: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== ' ') letterIdx.push(i);
  }

  const rand = mulberry32((turn + 1) * 0x9e3779b9);
  for (let i = letterIdx.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [letterIdx[i], letterIdx[j]] = [letterIdx[j], letterIdx[i]];
  }
  const revealed = new Set(letterIdx.slice(0, revealCount(letterIdx.length, elapsedFraction)));

  let offset = 0;
  return word
    .split(' ')
    .map(part => {
      const chars = [...part].map((ch, j) => (revealed.has(offset + j) ? ch : '_'));
      offset += part.length + 1;
      return chars.join(' ');
    })
    .join('   ');
}
