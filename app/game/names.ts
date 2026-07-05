/** Random username generation + localStorage persistence for the home screen. */

const ADJECTIVES = [
  'Doodly', 'Sketchy', 'Inky', 'Wobbly', 'Turbo', 'Spicy',
  'Shady', 'Rogue', 'Zippy', 'Chunky', 'Sneaky', 'Salty',
  'Smudgy', 'Cosmic', 'Scribbly', 'Blotchy',
];

const NOUNS = [
  'Pencil', 'Crayon', 'Brush', 'Marker', 'Doodle', 'Sketch',
  'Eraser', 'Easel', 'Canvas', 'Chalk', 'Quill', 'Stylus',
];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** e.g. "InkyCrayon42" — always fits the 16-char input limit */
export function generateUsername(): string {
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(Math.random() * 90) + 10}`;
}

const STORAGE_KEY = 'scribattle:username';

export function loadStoredUsername(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeUsername(name: string) {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // storage unavailable (private mode, etc.) — playing still works
  }
}
