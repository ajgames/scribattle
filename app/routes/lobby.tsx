import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { loadStoredUsername } from '../game/names';
import { useGameStore } from '../game/store';
import { useGameSounds } from '../game/useGameSounds';
import { REFERRAL_REWARD } from '../lib/catalog';
import { useProfileStore } from '../lib/profile';
import { captureRefParam } from '../lib/referral';
import { JOIN_OG_IMAGE, pageMeta } from '../lib/seo';
import { ensureInGame, leaveGame, startGame } from '../spacetime/connection';
import type { Route } from './+types/lobby';

export function meta({ params }: Route.MetaArgs) {
  // noindex keeps ephemeral rooms out of search; the og description + image
  // still power link unfurls when a host shares the invite link
  return pageMeta({
    title: `Lobby ${params.code} — Scribattle`,
    description: `You're invited to room ${params.code} on Scribattle, the free multiplayer drawing and guessing game. Tap to join the battle!`,
    noindex: true,
    image: JOIN_OG_IMAGE,
  });
}

/**
 * Waiting room, live from SpacetimeDB. On mount we make sure this identity is
 * a member of the room — after a refresh the persisted token still owns its
 * player row, so this reconnects seamlessly; a first visit joins. The player
 * list mirrors the `player` table in real time.
 */
export default function Lobby({ params }: Route.ComponentProps) {
  const navigate = useNavigate();
  const code = params.code.toUpperCase();

  const connection = useGameStore(s => s.connection);
  const identity = useGameStore(s => s.identity);
  const roomCode = useGameStore(s => s.roomCode);
  const players = useGameStore(s => s.players);
  const room = useGameStore(s => s.room);

  useGameSounds();

  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const referralCode = useProfileStore(s => s.referralCode);

  function copy(what: 'code' | 'link') {
    // signed-in hosts share referral-tagged links: friends who sign up from
    // one earn the sharer credits (see app/lib/referral.ts)
    const refTag = referralCode ? `?ref=${encodeURIComponent(referralCode)}` : '';
    const text =
      what === 'code' ? code : `${window.location.origin}/lobby/${code}${refTag}`;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(what);
        setTimeout(() => setCopied(c => (c === what ? null : c)), 1500);
      })
      .catch(() => {
        // clipboard unavailable (http, permissions) — leave the code visible
      });
  }

  // the host's start_game flips the room row — every member follows it in
  useEffect(() => {
    if (roomCode === code && room?.status === 'playing') {
      navigate(`/game/${code}`);
    }
  }, [roomCode, room?.status, code, navigate]);

  useEffect(() => {
    let cancelled = false;
    // arrived via a friend's referral-tagged invite? remember it for signup
    captureRefParam();
    // refresh wipes the store but not localStorage — recover the name; with
    // no name at all (shared link, fresh browser) go pick one, code prefilled
    const name = useGameStore.getState().username || loadStoredUsername();
    if (!name) {
      navigate(`/?join=${code}`, { replace: true });
      return;
    }
    useGameStore.getState().setUsername(name);
    ensureInGame(code, name).catch(err => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Could not reach the game server');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  const inRoom = roomCode === code;
  const me = players.find(p => p.id === identity);
  const isHost = !!me?.isHost;

  async function handleStart() {
    if (starting) return;
    setStarting(true);
    setError('');
    try {
      await startGame(); // the status effect above handles navigation
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the game');
      setStarting(false);
    }
  }

  async function handleLeave() {
    try {
      await leaveGame();
    } catch {
      // leaving is best-effort — the server flips us offline on disconnect
    }
    navigate('/');
  }

  const statusLine = error
    ? null
    : !inRoom
      ? connection === 'connected'
        ? 'joining room…'
        : 'connecting…'
      : connection !== 'connected'
        ? 'reconnecting…'
        : null;

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
            <button
              onClick={() => copy('code')}
              title="copy room code"
              className="group flex items-center gap-3 rounded-lg px-3 py-1 transition hover:bg-stone-100"
            >
              <span className="font-mono text-4xl font-medium tracking-[0.3em]">{code}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-5 text-stone-300 transition group-hover:text-stone-600"
                aria-hidden
              >
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            <span className="h-4 text-xs text-stone-400">
              {copied === 'code'
                ? 'code copied!'
                : copied === 'link'
                  ? 'invite link copied!'
                  : 'share it with friends to let them join'}
            </span>
            <button
              onClick={() => copy('link')}
              className="mt-1 rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-stone-500 transition hover:border-stone-400 hover:text-stone-800"
            >
              copy invite link
            </button>
            {referralCode && (
              <p className="mt-1 text-center text-[11px] text-stone-400">
                your link is referral-tagged — friends who sign up earn you{' '}
                {REFERRAL_REWARD} credits for the{' '}
                <Link to="/shop" className="underline">
                  shop
                </Link>
              </p>
            )}
          </div>

          {error ? (
            <div className="w-full rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-center">
              <p className="text-sm text-red-700">{error}</p>
              <Link to="/" className="mt-2 inline-block text-xs text-red-500 underline">
                back to the menu
              </Link>
            </div>
          ) : (
            <ul className="w-full divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white/70">
              {players.map(p => (
                <li
                  key={p.id}
                  className={`flex items-center justify-between px-5 py-3 text-sm ${p.online ? '' : 'opacity-40'}`}
                >
                  <span className="font-medium">{p.username}</span>
                  <span className="text-xs uppercase tracking-widest text-stone-400">
                    {[p.isHost && 'host', p.id === identity && 'you', !p.online && 'away']
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
              {inRoom && players.length < (room?.maxPlayers ?? 8) && (
                <li className="px-5 py-3 text-sm italic text-stone-400">waiting for players…</li>
              )}
              {!inRoom && (
                <li className="px-5 py-3 text-sm italic text-stone-400">{statusLine ?? '…'}</li>
              )}
            </ul>
          )}

          {statusLine && inRoom && (
            <p className="text-xs uppercase tracking-widest text-amber-600">{statusLine}</p>
          )}

          <svg className="scribble-loader" viewBox="0 0 220 44" fill="none" aria-hidden>
            <path
              d="M8 30 C 30 8, 44 40, 62 24 S 96 6, 112 26 S 146 42, 162 22 S 196 10, 212 28"
              stroke="#1c1917"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>

          <button
            onClick={handleStart}
            disabled={!inRoom || !isHost || starting}
            title={isHost ? undefined : 'the host starts the game'}
            className="w-full rounded-lg bg-stone-900 py-3 text-lg font-medium text-stone-50 transition enabled:hover:bg-stone-700 enabled:active:scale-[0.99] disabled:opacity-40"
          >
            {starting ? 'Starting…' : 'Start Game'}
          </button>

          <button
            onClick={handleLeave}
            className="text-xs text-stone-400 transition hover:text-stone-600"
          >
            ← leave lobby
          </button>
        </div>
      </div>
    </main>
  );
}
