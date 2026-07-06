import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react-router';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ROOM_CODE_LENGTH } from '../game/constants';
import { generateUsername, loadStoredUsername, storeUsername } from '../game/names';
import { useGameStore } from '../game/store';
import { connect, createGame, joinGame } from '../spacetime/connection';
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
  const [searchParams] = useSearchParams();
  const username = useGameStore(s => s.username);
  const setUsername = useGameStore(s => s.setUsername);
  const openGames = useGameStore(s => s.openGames);
  const connection = useGameStore(s => s.connection);

  // ?join=CODE — e.g. bounced here from a shared lobby link with no saved name.
  // Arriving with a code means the intent is to join, so the create path is
  // hidden entirely until the invite is dismissed.
  const inviteCode = (searchParams.get('join') ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
  const joinOnly = inviteCode.length === ROOM_CODE_LENGTH;

  const [joinCode, setJoinCode] = useState(inviteCode);
  const [listPublicly, setListPublicly] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  // prefill: saved name from a previous game, otherwise a fresh random one.
  // Also warm up the SpacetimeDB connection so create/join feel instant.
  useEffect(() => {
    if (!useGameStore.getState().username) {
      setUsername(loadStoredUsername() ?? generateUsername());
    }
    connect().catch(() => {
      // surfaced when the user actually tries to create/join
    });
  }, [setUsername]);

  const validName = username.trim().length >= 2;

  async function enterLobby(code?: string) {
    if (busy) return;
    if (!validName) {
      setError('Pick a username first (2+ characters)');
      return;
    }
    const name = username.trim();
    setUsername(name);
    storeUsername(name);
    setBusy(code ? 'join' : 'create');
    setError('');
    try {
      // server-authoritative: create_game generates the room code, join_game
      // validates it — both reject with a human-readable message
      const roomCode = code ? await joinGame(name, code) : await createGame(name, listPublicly);
      // joining a game that's already underway drops you straight onto the easel
      const status = useGameStore.getState().room?.status;
      navigate(status === 'playing' ? `/game/${roomCode}` : `/lobby/${roomCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach the game server');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#f7f5f1] text-stone-900">
      <div className="menu-backdrop" aria-hidden />

      <nav className="absolute right-4 top-4 z-20 flex items-center gap-2">
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button className="rounded-lg px-4 py-2 text-sm font-medium text-stone-600 transition hover:text-stone-900">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-700">
              Sign up
            </button>
          </SignUpButton>
        </Show>
        <Show when="signed-in">
          <UserButton />
        </Show>
      </nav>

      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-10 px-6 py-12">
        <header className="text-center">
          <h1 className="font-serif text-7xl tracking-tight text-stone-900">
            <Link to="/">
              Scri<span className="italic text-stone-500">battle</span>
            </Link>
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
            onKeyDown={e =>
              e.key === 'Enter' && (joinOnly ? enterLobby(joinCode) : enterLobby())
            }
            maxLength={16}
            placeholder="doodlemaster42"
            className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-center text-lg outline-none transition placeholder:text-stone-400 focus:border-stone-900"
            autoFocus
          />

          {joinOnly ? (
            <>
              {/* invite link flow — the code is set, so only joining makes sense */}
              <div className="mt-1 flex w-full flex-col items-center gap-1 rounded-xl border border-stone-200 bg-white/70 px-6 py-4">
                <span className="text-xs uppercase tracking-widest text-stone-400">
                  You’re invited to room
                </span>
                <span className="font-mono text-3xl font-medium tracking-[0.3em]">
                  {inviteCode}
                </span>
              </div>
              <button
                onClick={() => enterLobby(inviteCode)}
                disabled={busy !== null}
                className="w-full rounded-lg bg-stone-900 py-3 text-lg font-medium text-stone-50 transition enabled:hover:bg-stone-700 enabled:active:scale-[0.99] disabled:opacity-60"
              >
                {busy === 'join' ? 'Joining…' : 'Join Game'}
              </button>
              <Link
                to="/"
                className="mt-1 w-full rounded-lg border border-stone-200 bg-white py-2.5 text-center text-sm text-stone-500 transition hover:border-stone-400 hover:text-stone-800"
              >
                ← back to the main menu
              </Link>
            </>
          ) : (
            <>
              <button
                onClick={() => enterLobby()}
                disabled={busy !== null}
                className="mt-1 w-full rounded-lg bg-stone-900 py-3 text-lg font-medium text-stone-50 transition enabled:hover:bg-stone-700 enabled:active:scale-[0.99] disabled:opacity-60"
              >
                {busy === 'create' ? 'Creating…' : 'Create Game'}
              </button>
              <label className="flex items-center justify-center gap-2 text-xs text-stone-500">
                <input
                  type="checkbox"
                  checked={listPublicly}
                  onChange={e => setListPublicly(e.target.checked)}
                  className="size-3.5 accent-stone-900"
                />
                list my game publicly so anyone can join
              </label>

              <div className="my-2 flex items-center gap-3 text-xs text-stone-400">
                <div className="h-px flex-1 bg-stone-200" />
                or join friends
                <div className="h-px flex-1 bg-stone-200" />
              </div>

              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={e =>
                    setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                  }
                  onKeyDown={e =>
                    e.key === 'Enter' &&
                    joinCode.length === ROOM_CODE_LENGTH &&
                    enterLobby(joinCode)
                  }
                  maxLength={ROOM_CODE_LENGTH}
                  placeholder="ROOM CODE"
                  className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.4em] outline-none transition placeholder:tracking-normal placeholder:text-stone-400 focus:border-stone-900"
                />
                <button
                  onClick={() => enterLobby(joinCode)}
                  disabled={joinCode.length !== ROOM_CODE_LENGTH || busy !== null}
                  className="rounded-lg border border-stone-300 bg-white px-5 font-medium text-stone-700 transition enabled:hover:border-stone-900 enabled:hover:text-stone-900 disabled:opacity-40"
                >
                  {busy === 'join' ? '…' : 'Join'}
                </button>
              </div>
            </>
          )}

          {error && <p className="text-center text-sm text-red-600">{error}</p>}
        </div>

        {!joinOnly && (
          <section className="w-full">
            <h2 className="mb-2 text-center text-xs font-medium uppercase tracking-widest text-stone-500">
              Games happening now
            </h2>
            <ul className="w-full divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white/70">
              {openGames.map(g => {
                // games in progress are joinable too — you hop in as a guesser
                const joinable = g.playerCount < g.maxPlayers;
                return (
                  <li key={g.code} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="font-mono tracking-[0.2em] text-stone-700">{g.code}</span>
                    <span className="min-w-0 flex-1 truncate text-stone-500">
                      {g.hostName}’s game
                    </span>
                    {g.status === 'playing' && (
                      <span className="text-xs uppercase tracking-widest text-green-600">
                        live
                      </span>
                    )}
                    <span className="text-xs tabular-nums text-stone-400">
                      {g.playerCount}/{g.maxPlayers}
                    </span>
                    {joinable ? (
                      <button
                        onClick={() => enterLobby(g.code)}
                        disabled={busy !== null}
                        className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-700 transition enabled:hover:border-stone-900 enabled:hover:text-stone-900 disabled:opacity-40"
                      >
                        Join
                      </button>
                    ) : (
                      <span className="text-xs uppercase tracking-widest text-amber-600">
                        full
                      </span>
                    )}
                  </li>
                );
              })}
              {openGames.length === 0 && (
                <li className="px-4 py-3 text-center text-sm italic text-stone-400">
                  {connection === 'connected'
                    ? 'no public games right now — start one!'
                    : 'looking for games…'}
                </li>
              )}
            </ul>
          </section>
        )}

        <footer className="text-center text-xs text-stone-400">
          one player draws · everyone guesses · fastest correct guess scores big
        </footer>
      </div>
    </main>
  );
}
