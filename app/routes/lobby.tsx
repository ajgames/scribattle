import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useGameStore } from '../game/store';
import type { Route } from './+types/lobby';

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Lobby ${params.code} — Scribattle` }];
}

/**
 * Lobby shell. Real behavior (live player list, host settings, start button
 * gating) arrives with the SpacetimeDB `game`/`player` subscriptions once the
 * user journey is mapped out.
 */
export default function Lobby({ params }: Route.ComponentProps) {
  const navigate = useNavigate();
  const code = params.code.toUpperCase();
  const username = useGameStore(s => s.username);
  const joinedLobby = useGameStore(s => s.joinedLobby);

  // no username means the user landed here directly — bounce to the menu
  useEffect(() => {
    if (!useGameStore.getState().username) {
      navigate('/', { replace: true });
      return;
    }
    joinedLobby(code);
  }, [code, joinedLobby, navigate]);

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#f7f5f1] text-stone-900">
      <div className="menu-backdrop" aria-hidden />

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-10 px-6">
        <header className="text-center">
          <Link to="/" className="font-serif text-4xl tracking-tight text-stone-900">
            Scri<span className="italic text-stone-500">battle</span>
          </Link>
          <p className="mt-2 text-xs font-medium uppercase tracking-widest text-stone-500">
            Waiting room
          </p>
        </header>

        <div className="flex w-full flex-col items-center gap-6">
          <div className="flex w-full flex-col items-center gap-2 rounded-xl border border-stone-200 bg-white/70 px-6 py-5">
            <span className="text-xs uppercase tracking-widest text-stone-400">Room code</span>
            <span className="font-mono text-4xl font-medium tracking-[0.3em]">{code}</span>
            <span className="text-xs text-stone-400">share it with friends to let them join</span>
          </div>

          {/* placeholder player list — will mirror the SpacetimeDB player table */}
          <ul className="w-full divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white/70">
            <li className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="font-medium">{username || '—'}</span>
              <span className="text-xs uppercase tracking-widest text-stone-400">host · you</span>
            </li>
            <li className="px-5 py-3 text-sm text-stone-400 italic">waiting for players…</li>
          </ul>

          <svg className="scribble-loader" viewBox="0 0 220 44" fill="none" aria-hidden>
            <path
              d="M8 30 C 30 8, 44 40, 62 24 S 96 6, 112 26 S 146 42, 162 22 S 196 10, 212 28"
              stroke="#1c1917"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>

          <button
            onClick={() => {
              useGameStore.getState().gameStarted();
              navigate(`/game/${code}`);
            }}
            className="w-full rounded-lg bg-stone-900 py-3 text-lg font-medium text-stone-50 transition hover:bg-stone-700 active:scale-[0.99]"
          >
            Start Game
          </button>

          <Link to="/" className="text-xs text-stone-400 transition hover:text-stone-600">
            ← leave lobby
          </Link>
        </div>
      </div>
    </main>
  );
}
