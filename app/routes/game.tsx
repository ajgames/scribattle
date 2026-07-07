import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { AdBreak } from '../components/AdBreak';
import { ClientOnly } from '../components/ClientOnly';
import { ModerationGuard } from '../components/ModerationGuard';
import { ReportModal } from '../components/ReportModal';
import { DrawCanvas } from '../game/three/DrawCanvas';
import { hintedWordDisplay } from '../game/hints';
import { loadStoredUsername } from '../game/names';
import { useGameStore, type VoteCategory } from '../game/store';
import { AD_FREE_ITEM_ID, REFERRAL_REWARD, SHOP_ITEMS } from '../lib/catalog';
import { useProfileStore } from '../lib/profile';
import { referralLink } from '../lib/referral';
import {
  castVote,
  clearCanvas,
  endTurn,
  ensureInGame,
  leaveGame,
  playAgain,
  sendLiveStroke,
  sendStroke,
  submitGuess,
} from '../spacetime/connection';
import type { Route } from './+types/game';

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Game ${params.code} — Scribattle` }];
}

const PALETTE = ['#1c1917', '#dc2626', '#2563eb', '#16a34a', '#d97706'];
const BRUSH_WIDTH = 0.007; // normalized to paper width, matches server clamps
const FAT_BRUSH_WIDTH = 0.016; // 'fat-cap' shop unlock — still inside server clamps

const VOTE_BUTTONS: { category: VoteCategory; emoji: string; label: string }[] = [
  { category: 'funny', emoji: '😂', label: 'funny' },
  { category: 'artistic', emoji: '🎨', label: 'artistic' },
  { category: 'horrible', emoji: '💀', label: 'horrible' },
];

/** Seconds left on the turn clock, ticking against the server's start stamp. */
function useTurnCountdown(turnStartedAtMs: number | null, turnSeconds: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (turnStartedAtMs == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [turnStartedAtMs]);
  if (turnStartedAtMs == null) return null;
  return Math.max(0, Math.ceil((turnStartedAtMs + turnSeconds * 1000 - now) / 1000));
}

/**
 * The core loop screen: scoreboard (left), shared drawing surface (center),
 * guess feed (right). Everything renders from the SpacetimeDB mirror — the
 * artist's strokes (including in-progress ones) and every guess land on all
 * clients in real time. When the rounds run out the room flips to 'finished'
 * and this screen becomes the results: ranked scoreboard + a slideshow of
 * every drawing with funny/artistic/horrible voting.
 */
export default function Game({ params }: Route.ComponentProps) {
  const navigate = useNavigate();
  const code = params.code.toUpperCase();
  const identity = useGameStore(s => s.identity);
  const players = useGameStore(s => s.players);
  const room = useGameStore(s => s.room);
  const roomCode = useGameStore(s => s.roomCode);
  const strokes = useGameStore(s => s.strokes);
  const liveStroke = useGameStore(s => s.liveStroke);
  const guesses = useGameStore(s => s.guesses);

  const [color, setColor] = useState(PALETTE[0]);
  const [threeD, setThreeD] = useState(false);
  const [fatBrush, setFatBrush] = useState(false);
  const [guessDraft, setGuessDraft] = useState('');
  const [guessError, setGuessError] = useState('');
  const [reporting, setReporting] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  // shop unlocks shape the easel: skin packs add inks, 'fat-cap' adds a
  // brush size, 'ad-free' skips the post-match ad break entirely
  const unlockIds = useProfileStore(s => s.unlocks);
  const palette = useMemo(
    () => [
      ...PALETTE,
      ...SHOP_ITEMS.filter(i => i.colors && unlockIds.includes(i.id)).flatMap(
        i => i.colors!
      ),
    ],
    [unlockIds]
  );
  const hasFatCap = unlockIds.includes('fat-cap');
  const adFree = unlockIds.includes(AD_FREE_ITEM_ID);
  const brushWidth = hasFatCap && fatBrush ? FAT_BRUSH_WIDTH : BRUSH_WIDTH;

  // one ad break per match end — reset when the room leaves 'finished'
  // (rematch) so the next match gets its own break
  const [adWatched, setAdWatched] = useState(false);

  // same refresh recovery as the lobby: persisted identity re-attaches to its
  // player row; a nameless direct visit goes to the menu with the code prefilled
  useEffect(() => {
    const name = useGameStore.getState().username || loadStoredUsername();
    if (!name) {
      navigate(`/?join=${code}`, { replace: true });
      return;
    }
    useGameStore.getState().setUsername(name);
    ensureInGame(code, name).catch(() => navigate(`/?join=${code}`, { replace: true }));
  }, [code, navigate]);

  // landed here before the host pressed start (deep link), or the host queued
  // a rematch — either way the lobby is where 'waiting' rooms live
  useEffect(() => {
    if (roomCode === code && room?.status === 'waiting') {
      navigate(`/lobby/${code}`, { replace: true });
    }
  }, [roomCode, room?.status, code, navigate]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [guesses.length]);

  const inRoom = roomCode === code;
  const playing = inRoom && room?.status === 'playing';
  const finished = inRoom && room?.status === 'finished';

  useEffect(() => {
    if (!finished) setAdWatched(false);
  }, [finished]);
  const isArtist = !!playing && room.artist === identity;
  const artistName = players.find(p => p.isArtist)?.username ?? '…';
  const guessedThisTurn =
    !!playing &&
    guesses.some(g => g.correct && g.playerId === identity && g.turn === room.turn);
  const canGuess = !!playing && !isArtist && !guessedThisTurn;

  const secondsLeft = useTurnCountdown(playing ? room.turnStartedAtMs : null, room?.turnSeconds ?? 60);

  // the canvas shows only the turn being painted — older turns are history
  const turnStrokes = useMemo(
    () => (playing ? strokes.filter(s => s.turn === room.turn) : []),
    [strokes, playing, room?.turn]
  );

  // when the clock runs out, poke the server (all clients race; the server's
  // own clock decides, so early pokes and duplicates are quiet no-ops)
  const lastEndPoke = useRef(0);
  useEffect(() => {
    if (!playing || secondsLeft == null || secondsLeft > 0) return;
    const t = Date.now();
    if (t - lastEndPoke.current < 2000) return;
    lastEndPoke.current = t;
    endTurn();
  }, [playing, secondsLeft]);

  // guessers see the word's shape (letter blanks, wide gaps between words)
  // with letters filling in as hints — exponentially faster as the clock runs
  // out. The artist (and anyone who already solved it) sees the whole word.
  // Rendered with whitespace-pre so the gaps hold.
  const elapsedFraction =
    playing && secondsLeft != null && room.turnSeconds > 0
      ? 1 - secondsLeft / room.turnSeconds
      : 0;
  const wordDisplay = !playing
    ? ''
    : isArtist || guessedThisTurn
      ? room.currentWord
      : hintedWordDisplay(room.currentWord, room.turn, elapsedFraction);

  function handleGuess() {
    const text = guessDraft.trim();
    if (!text || !canGuess) return;
    setGuessDraft('');
    setGuessError('');
    submitGuess(text).catch(err => {
      // surface real rejections (e.g. the profanity filter); a game that
      // ended between keystrokes just reads as a generic miss
      setGuessError(err instanceof Error ? err.message : 'Guess not sent');
    });
  }

  if (finished) {
    // the ad break runs between the buzzer and the results; the 'ad-free'
    // shop perk (and a rematch reset) skip straight through. The moderation
    // guard rides along so warnings land even on the results screen.
    if (!adFree && !adWatched) {
      return (
        <>
          <ModerationGuard />
          <AdBreak onDone={() => setAdWatched(true)} />
        </>
      );
    }
    return (
      <>
        <ModerationGuard />
        <GameOver code={code} />
      </>
    );
  }

  return (
    <main className="flex min-h-svh flex-col bg-[#f7f5f1] text-stone-900">
      <ModerationGuard />
      {reporting && playing && (
        <ReportModal
          offenderIdentity={room.artist}
          offenderName={artistName}
          gameCode={code}
          turn={room.turn}
          onClose={() => setReporting(false)}
        />
      )}
      {/* top bar: round/turn status, the word (masked for guessers), the clock */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white/70 px-5 py-3">
        <Link to="/" className="font-serif text-2xl tracking-tight">
          Scri<span className="italic text-stone-500">battle</span>
        </Link>
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-stone-400">
            {playing
              ? `Round ${room.round}/${room.rounds} — ${artistName} is drawing`
              : 'waiting…'}
          </p>
          <p className="whitespace-pre font-mono text-sm tracking-widest text-stone-600">
            {wordDisplay || ' '}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {playing && secondsLeft != null && (
            <span
              className={`rounded-md border px-2 py-1 font-mono text-sm tabular-nums ${
                secondsLeft <= 10
                  ? 'border-red-200 bg-red-50 text-red-600'
                  : 'border-stone-200 bg-white text-stone-600'
              }`}
            >
              0:{String(secondsLeft).padStart(2, '0')}
            </span>
          )}
          <span className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-xs tracking-[0.2em] text-stone-500">
            {code}
          </span>
          {playing && !isArtist && (
            <button
              onClick={() => setReporting(true)}
              title="report this drawing"
              className="rounded-md border border-stone-200 bg-white px-2 py-1 text-xs text-stone-400 transition hover:border-red-300 hover:text-red-600"
            >
              ⚑
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        {/* scoreboard — live mirror of the player table */}
        <aside className="rounded-xl border border-stone-200 bg-white/70 p-4 lg:w-56">
          <h2 className="text-xs font-medium uppercase tracking-widest text-stone-400">Players</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {players.map(p => (
              <li
                key={p.id}
                className={`flex items-center justify-between ${p.online ? '' : 'opacity-40'}`}
              >
                <span className="font-medium">
                  {p.username}
                  {p.isArtist && ' ✏️'}
                  {p.id === identity && <span className="text-stone-400"> (you)</span>}
                </span>
                <span className="font-mono tabular-nums text-stone-500">{p.score}</span>
              </li>
            ))}
            {players.length === 0 && (
              <li className="text-xs italic text-stone-400">connecting…</li>
            )}
          </ul>
        </aside>

        {/* drawing surface — R3F canvas (WebGL, client-only) */}
        <section className="relative min-h-[50svh] flex-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <ClientOnly
            fallback={<div className="flex h-full items-center justify-center text-sm text-stone-400">warming up the easel…</div>}
          >
            <DrawCanvas
              strokes={turnStrokes}
              liveStroke={liveStroke}
              canDraw={isArtist}
              color={color}
              width={brushWidth}
              threeD={threeD}
              onStrokeProgress={points => {
                sendLiveStroke(points, color, brushWidth, threeD);
              }}
              onStrokeEnd={points => {
                sendStroke(points, color, brushWidth, threeD).catch(() => {
                  // rejected stroke (turn rotated mid-draw) just never appears
                });
              }}
            />
          </ClientOnly>

          {isArtist ? (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-stone-200 bg-white/90 px-4 py-2 shadow-sm">
              {palette.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`brush color ${c}`}
                  className={`size-5 rounded-full border transition ${
                    color === c
                      ? 'scale-125 border-stone-900'
                      : 'border-stone-200 hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <span className="mx-1 h-5 w-px bg-stone-200" />
              <button
                onClick={() => setThreeD(v => !v)}
                title="raised 3D ink"
                className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-widest transition ${
                  threeD
                    ? 'bg-stone-900 text-stone-50'
                    : 'text-stone-400 hover:text-stone-700'
                }`}
              >
                3D
              </button>
              {hasFatCap && (
                <button
                  onClick={() => setFatBrush(v => !v)}
                  title="fat cap brush (shop unlock)"
                  className={`rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-widest transition ${
                    fatBrush
                      ? 'bg-stone-900 text-stone-50'
                      : 'text-stone-400 hover:text-stone-700'
                  }`}
                >
                  Fat
                </button>
              )}
              <span className="mx-1 h-5 w-px bg-stone-200" />
              <button
                onClick={() => clearCanvas().catch(() => {})}
                className="text-xs uppercase tracking-widest text-stone-400 transition hover:text-stone-700"
              >
                clear
              </button>
            </div>
          ) : (
            playing && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-stone-200 bg-white/90 px-4 py-2 text-xs uppercase tracking-widest text-stone-400 shadow-sm">
                {artistName} is drawing — type your guess →
              </div>
            )
          )}
        </section>

        {/* guess feed — live mirror of the guess table */}
        <aside className="flex flex-col rounded-xl border border-stone-200 bg-white/70 lg:w-72">
          <h2 className="border-b border-stone-100 p-4 text-xs font-medium uppercase tracking-widest text-stone-400">
            Guesses
          </h2>
          <div ref={feedRef} className="max-h-[40svh] flex-1 space-y-2 overflow-y-auto p-4 text-sm lg:max-h-none">
            {guesses.map(g => (
              <p key={g.id} className={g.correct ? 'font-medium text-green-700' : ''}>
                <span className="font-medium">{g.username}</span>{' '}
                {g.correct ? 'guessed the word! 🎉' : <span className="text-stone-600">{g.text}</span>}
              </p>
            ))}
            {guesses.length === 0 && (
              <p className="italic text-stone-400">guesses will stream here in real time…</p>
            )}
          </div>
          <div className="border-t border-stone-100 p-3">
            {guessError && (
              <p className="mb-2 text-xs text-red-600">{guessError}</p>
            )}
            <input
              value={guessDraft}
              onChange={e => {
                setGuessDraft(e.target.value);
                setGuessError('');
              }}
              onKeyDown={e => e.key === 'Enter' && handleGuess()}
              disabled={!canGuess}
              maxLength={64}
              placeholder={
                isArtist
                  ? 'you’re drawing!'
                  : guessedThisTurn
                    ? 'you got it — waiting for the rest'
                    : 'type your guess…'
              }
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-stone-300 focus:border-stone-400 disabled:bg-stone-50"
            />
          </div>
        </aside>
      </div>
    </main>
  );
}

/**
 * Results screen: final standings and a slideshow of every drawing from the
 * game. Each player gets one vote per category (funny / artistic / horrible);
 * votes land in SpacetimeDB so the tallies update live for everyone.
 */
function GameOver({ code }: { code: string }) {
  const navigate = useNavigate();
  const identity = useGameStore(s => s.identity);
  const players = useGameStore(s => s.players);
  const strokes = useGameStore(s => s.strokes);
  const drawings = useGameStore(s => s.drawings);
  const votes = useGameStore(s => s.votes);

  const [slide, setSlide] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const signedIn = useProfileStore(s => s.signedIn);
  const referralCode = useProfileStore(s => s.referralCode);

  const standings = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players]
  );

  // signed-in players share referral-tagged links — each signup pays credits
  function copyShareLink() {
    const url =
      signedIn && referralCode
        ? referralLink(referralCode, window.location.origin)
        : window.location.origin;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1500);
      })
      .catch(() => {});
  }
  const isHost = players.find(p => p.id === identity)?.isHost ?? false;

  const current = drawings[Math.min(slide, Math.max(0, drawings.length - 1))];
  const slideStrokes = useMemo(
    () => (current ? strokes.filter(s => s.turn === current.turn) : []),
    [strokes, current]
  );

  function tally(turn: number, category: VoteCategory): number {
    return votes.filter(v => v.turn === turn && v.category === category).length;
  }
  function myPick(category: VoteCategory): number | null {
    return votes.find(v => v.voterId === identity && v.category === category)?.turn ?? null;
  }

  async function handleLeave() {
    try {
      await leaveGame();
    } catch {
      // best-effort — the server flips us offline on disconnect anyway
    }
    navigate('/');
  }

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <main className="flex min-h-svh flex-col bg-[#f7f5f1] text-stone-900">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white/70 px-5 py-3">
        <Link to="/" className="font-serif text-2xl tracking-tight">
          Scri<span className="italic text-stone-500">battle</span>
        </Link>
        <p className="text-xs uppercase tracking-widest text-stone-400">Game over</p>
        <span className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-xs tracking-[0.2em] text-stone-500">
          {code}
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-6 lg:flex-row">
        {/* final standings */}
        <aside className="lg:w-72">
          <div className="rounded-xl border border-stone-200 bg-white/70 p-5">
            <h2 className="text-xs font-medium uppercase tracking-widest text-stone-400">
              Final standings
            </h2>
            <ol className="mt-4 space-y-3">
              {standings.map((p, i) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    <span className="mr-2 inline-block w-6 text-center">
                      {medals[i] ?? `${i + 1}.`}
                    </span>
                    {p.username}
                    {p.id === identity && <span className="text-stone-400"> (you)</span>}
                  </span>
                  <span className="font-mono tabular-nums text-stone-500">{p.score}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            {isHost && (
              <button
                onClick={() => playAgain().catch(() => {})}
                className="w-full rounded-lg bg-stone-900 py-2.5 font-medium text-stone-50 transition hover:bg-stone-700 active:scale-[0.99]"
              >
                Play again
              </button>
            )}
            <button
              onClick={handleLeave}
              className="w-full rounded-lg border border-stone-200 bg-white py-2.5 text-sm text-stone-500 transition hover:text-stone-800"
            >
              Leave game
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-stone-200 bg-white/70 p-4 text-center">
            <p className="text-xs text-stone-500">
              {signedIn
                ? `Share Scribattle — every friend who signs up from your link earns you ${REFERRAL_REWARD} credits for skins, tools, and ad-free play.`
                : 'Loved the match? Share Scribattle with a friend.'}
            </p>
            <button
              onClick={copyShareLink}
              className="mt-2 rounded-full border border-stone-200 bg-white px-4 py-1.5 text-xs font-medium uppercase tracking-widest text-stone-500 transition hover:border-stone-400 hover:text-stone-800"
            >
              {shareCopied ? 'link copied!' : 'copy share link'}
            </button>
          </div>
        </aside>

        {/* slideshow + voting */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-stone-400">
              The gallery — vote for your favorites
            </h2>
            {drawings.length > 1 && (
              <div className="flex items-center gap-3 text-sm">
                <button
                  onClick={() => setSlide(s => (s - 1 + drawings.length) % drawings.length)}
                  className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-stone-500 transition hover:text-stone-900"
                  aria-label="previous drawing"
                >
                  ←
                </button>
                <span className="font-mono text-xs tabular-nums text-stone-400">
                  {Math.min(slide + 1, drawings.length)} / {drawings.length}
                </span>
                <button
                  onClick={() => setSlide(s => (s + 1) % drawings.length)}
                  className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-stone-500 transition hover:text-stone-900"
                  aria-label="next drawing"
                >
                  →
                </button>
              </div>
            )}
          </div>

          {current ? (
            <>
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
                <ClientOnly
                  fallback={
                    <div className="flex h-full items-center justify-center text-sm text-stone-400">
                      hanging the gallery…
                    </div>
                  }
                >
                  <DrawCanvas
                    strokes={slideStrokes}
                    canDraw={false}
                    color="#1c1917"
                    width={BRUSH_WIDTH}
                    onStrokeEnd={() => {}}
                  />
                </ClientOnly>
              </div>

              <p className="text-center text-sm text-stone-600">
                <span className="font-mono">“{current.word}”</span> by{' '}
                <span className="font-medium">{current.artistName}</span>
              </p>

              <div className="flex items-center justify-center gap-3">
                {VOTE_BUTTONS.map(({ category, emoji, label }) => {
                  const mine = myPick(category) === current.turn;
                  const count = tally(current.turn, category);
                  return (
                    <button
                      key={category}
                      onClick={() => castVote(current.turn, category).catch(() => {})}
                      title={`vote ${label}`}
                      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
                        mine
                          ? 'border-stone-900 bg-stone-900 text-stone-50'
                          : 'border-stone-200 bg-white text-stone-600 hover:border-stone-400'
                      }`}
                    >
                      <span>{emoji}</span>
                      <span className="uppercase tracking-widest">{label}</span>
                      {count > 0 && <span className="font-mono tabular-nums">{count}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-stone-200 bg-white/70 text-sm italic text-stone-400">
              no drawings made it to the gallery
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
