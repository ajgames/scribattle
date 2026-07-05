import { create } from 'zustand';

/**
 * Client game state. SpacetimeDB table rows get mirrored into this store by
 * app/spacetime/connection.ts (once the module is published and bindings are
 * generated) — components only ever read the store.
 *
 * Shell version: just enough shape for the menu → lobby → game flow.
 */

export type GamePhase = 'menu' | 'lobby' | 'playing' | 'ended';

export interface PlayerInfo {
  id: string;
  username: string;
  score: number;
  isHost: boolean;
  isArtist: boolean;
}

interface GameState {
  username: string;
  roomCode: string;
  phase: GamePhase;
  players: PlayerInfo[];

  setUsername: (name: string) => void;
  joinedLobby: (code: string) => void;
  gameStarted: () => void;
  reset: () => void;
}

const initialState = {
  username: '',
  roomCode: '',
  phase: 'menu' as GamePhase,
  players: [] as PlayerInfo[],
};

export const useGameStore = create<GameState>()(set => ({
  ...initialState,

  setUsername: username => set({ username }),
  joinedLobby: roomCode => set({ roomCode, phase: 'lobby' }),
  gameStarted: () => set({ phase: 'playing' }),
  reset: () => set(state => ({ ...initialState, username: state.username })),
}));
