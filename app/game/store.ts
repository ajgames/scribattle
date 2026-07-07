import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * Client game state — a read-only mirror of SpacetimeDB rows plus local UI
 * state (username draft, connection status). app/spacetime/connection.ts owns
 * the socket and pushes digests in via `serverSync`; components only read.
 */

export type GamePhase = 'menu' | 'lobby' | 'playing' | 'ended';
export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface PlayerInfo {
  id: string; // identity hex
  username: string;
  score: number;
  isHost: boolean;
  isArtist: boolean;
  online: boolean;
}

export interface RoomInfo {
  code: string;
  status: string; // 'waiting' | 'playing' | 'finished'
  playerCount: number;
  maxPlayers: number;
  rounds: number;
  turnSeconds: number;
  /** Identity hex of the current artist (only meaningful while playing). */
  artist: string;
  /** The secret word — '' unless playing. Only render it for the artist. */
  currentWord: string;
  /** Artist's word options — non-empty while the pick-a-word window is open. */
  wordChoices: string[];
  turn: number;
  /** 1-based round (everyone draws once per round). 0 while waiting. */
  round: number;
  /** Server clock start of the current turn, ms since epoch — drives the countdown. */
  turnStartedAtMs: number;
}

export interface StrokeInfo {
  id: string; // u64 as string, insertion order
  /** Which turn painted this — the canvas shows the current turn, the slideshow the rest. */
  turn: number;
  /** Flat [x0, y0, x1, y1, …], normalized 0..1 across the paper. */
  points: number[];
  color: string;
  width: number;
  /** Raised 3D tube vs default flat ink. */
  threeD: boolean;
}

/** The artist's in-progress stroke, streamed so everyone watches it grow. */
export interface LiveStrokeInfo {
  points: number[];
  color: string;
  width: number;
  threeD: boolean;
}

/** One per turn: who drew which word — the end-of-game slideshow reel. */
export interface DrawingInfo {
  turn: number;
  artistId: string;
  artistName: string;
  word: string;
}

export type VoteCategory = 'funny' | 'artistic' | 'horrible';

export interface VoteInfo {
  voterId: string;
  /** The voted drawing's turn number. */
  turn: number;
  category: string;
}

export interface GuessInfo {
  id: string;
  playerId: string;
  username: string;
  /** '' when correct — the feed never shows the word. */
  text: string;
  correct: boolean;
  turn: number;
}

/** A public room surfaced on the main menu. */
export interface OpenGameInfo {
  code: string;
  status: string;
  playerCount: number;
  maxPlayers: number;
  hostName: string;
  spectatorCount: number;
}

export interface ServerDigest {
  room: RoomInfo | null;
  players: PlayerInfo[];
  strokes: StrokeInfo[];
  liveStroke: LiveStrokeInfo | null;
  drawings: DrawingInfo[];
  votes: VoteInfo[];
  guesses: GuessInfo[];
  openGames: OpenGameInfo[];
  /** True when the focused room comes from my spectator row, not a player row. */
  isWatching: boolean;
  /** Watchers of the focused room. */
  spectatorCount: number;
}

function phaseFor(room: RoomInfo | null): GamePhase {
  if (!room) return 'menu';
  if (room.status === 'playing') return 'playing';
  if (room.status === 'finished') return 'ended';
  return 'lobby';
}

interface GameState {
  connection: ConnectionStatus;
  /** My SpacetimeDB identity (hex), '' until first connect. */
  identity: string;
  username: string;
  /** Room the *server* says I'm in ('' if none) — survives refresh. */
  roomCode: string;
  room: RoomInfo | null;
  /** Players in my room, join order. */
  players: PlayerInfo[];
  /** Every stroke painted this game (all turns), paint order. */
  strokes: StrokeInfo[];
  /** The artist's in-progress stroke (null when the brush is up). */
  liveStroke: LiveStrokeInfo | null;
  /** One entry per turn, turn order — feeds the slideshow. */
  drawings: DrawingInfo[];
  /** Slideshow ballots for my room. */
  votes: VoteInfo[];
  /** Guess feed for my room, oldest first. */
  guesses: GuessInfo[];
  /** Public rooms anyone can browse into, newest first. */
  openGames: OpenGameInfo[];
  /** I'm a spectator of the focused room (no player row — watch mode). */
  isWatching: boolean;
  /** Watchers of the focused room. */
  spectatorCount: number;
  phase: GamePhase;

  setUsername: (name: string) => void;
  connectionChanged: (status: ConnectionStatus, identity?: string) => void;
  serverSync: (digest: ServerDigest) => void;
  reset: () => void;
}

const initialState = {
  connection: 'idle' as ConnectionStatus,
  identity: '',
  username: '',
  roomCode: '',
  room: null as RoomInfo | null,
  players: [] as PlayerInfo[],
  strokes: [] as StrokeInfo[],
  liveStroke: null as LiveStrokeInfo | null,
  drawings: [] as DrawingInfo[],
  votes: [] as VoteInfo[],
  guesses: [] as GuessInfo[],
  openGames: [] as OpenGameInfo[],
  isWatching: false,
  spectatorCount: 0,
  phase: 'menu' as GamePhase,
};

export const useGameStore: UseBoundStore<StoreApi<GameState>> = create<GameState>()(set => ({
  ...initialState,

  setUsername: username => set({ username }),

  connectionChanged: (connection, identity) =>
    set(state => ({ connection, identity: identity ?? state.identity })),

  serverSync: ({
    room,
    players,
    strokes,
    liveStroke,
    drawings,
    votes,
    guesses,
    openGames,
    isWatching,
    spectatorCount,
  }) =>
    set({
      room,
      players,
      strokes,
      liveStroke,
      drawings,
      votes,
      guesses,
      openGames,
      isWatching,
      spectatorCount,
      roomCode: room?.code ?? '',
      phase: phaseFor(room),
    }),

  reset: () =>
    set(state => ({
      ...initialState,
      connection: state.connection,
      identity: state.identity,
      username: state.username,
    })),
}));

// dev console access: window.gameStore.getState()
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as { gameStore: typeof useGameStore }).gameStore = useGameStore;
}
