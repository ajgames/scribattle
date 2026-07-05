import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { generateRoomCode, ROOM_CODE_LENGTH } from '../game/constants';
import { generateUsername, loadStoredUsername, storeUsername } from '../game/names';
import { useGameStore } from '../game/store';
import type { Route } from './+types/home';

export function meta({}: Route.MetaArgs) {
  const title = 'Scribattle — Free Multiplayer Drawing & Guessing Game';
  const description =
    'Draw. Guess. Battle. Scribattle is a free multiplayer drawing game: one player sketches a secret word while everyone else races to guess it in real time — right in your browser.';
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Scribattle' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
}

export default function Home() {
  const navigate = useNavigate();
  const username = useGameStore(s => s.username);
  const setUsername = useGameStore(s => s.setUsername);
  const reset = useGameStore(s => s.reset);

  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');

  // prefill: saved name from a previous game, otherwise a fresh random one
  useEffect(() => {
    if (!useGameStore.getState().username) {
      setUsername(loadStoredUsername() ?? generateUsername());
    }
  }, [setUsername]);

  const validName = username.trim().length >= 2;

  function enterLobby(code?: string) {
    if (!validName) {
      setError('Pick a username first (2+ characters)');
      return;
    }
    const name = username.trim();
    reset();
    setUsername(name);
    storeUsername(name);
    // shell: room creation is client-side for now; the SpacetimeDB create_game
    // reducer takes over once the module is published
    navigate(`/lobby/${encodeURIComponent(code ?? generateRoomCode())}`);
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#f7f5f1] text-stone-900">
      <div className="menu-backdrop" aria-hidden />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-10 px-6">
        <header className="text-center">
          <h1 className="font-serif text-7xl tracking-tight text-stone-900">
            Scri<span className="italic text-stone-500">battle</span>
          </h1>
          <p className="mt-3 text-sm text-stone-500">Draw. Guess. Battle. Repeat.</p>
        </header>

        <div className="flex w-full flex-col gap-3">
          <label className="text-xs font-medium uppercase tracking-widest text-stone-500">
            Username
          </label>
          <input
            value={username}
            onChange={e => {
              setUsername(e.target.value);
              setError('');
            }}
            onKeyDown={e => e.key === 'Enter' && enterLobby()}
            maxLength={16}
            placeholder="doodlemaster42"
            className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-center text-lg outline-none transition placeholder:text-stone-400 focus:border-stone-900"
            autoFocus
          />

          <button
            onClick={() => enterLobby()}
            className="mt-1 w-full rounded-lg bg-stone-900 py-3 text-lg font-medium text-stone-50 transition hover:bg-stone-700 active:scale-[0.99]"
          >
            Create Game
          </button>

          <div className="my-2 flex items-center gap-3 text-xs text-stone-400">
            <div className="h-px flex-1 bg-stone-200" />
            or join friends
            <div className="h-px flex-1 bg-stone-200" />
          </div>

          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              onKeyDown={e =>
                e.key === 'Enter' && joinCode.length === ROOM_CODE_LENGTH && enterLobby(joinCode)
              }
              maxLength={ROOM_CODE_LENGTH}
              placeholder="ROOM CODE"
              className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.4em] outline-none transition placeholder:tracking-normal placeholder:text-stone-400 focus:border-stone-900"
            />
            <button
              onClick={() => enterLobby(joinCode)}
              disabled={joinCode.length !== ROOM_CODE_LENGTH}
              className="rounded-lg border border-stone-300 bg-white px-5 font-medium text-stone-700 transition enabled:hover:border-stone-900 enabled:hover:text-stone-900 disabled:opacity-40"
            >
              Join
            </button>
          </div>

          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>

        <footer className="text-center text-xs text-stone-400">
          one player draws · everyone guesses · fastest correct guess scores big
        </footer>
      </div>
    </main>
  );
}
