/** Shared client-side tuning. Keep server-relevant values in sync with server/src/index.ts. */

export const ROOM_CODE_LENGTH = 4;

// no 0/O, 1/I/L — codes are read aloud and typed from memory
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const MAX_USERNAME_LENGTH = 16;

export const DEFAULTS = {
  maxPlayers: 8,
  rounds: 3,
  turnSeconds: 45, // hard max — server clamps to 45
};

/** Seconds the artist gets to pick a word before the server accepts an auto-pick poke. */
export const WORD_CHOICE_SECONDS = 10;

export function generateRoomCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
