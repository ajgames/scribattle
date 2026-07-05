import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClientOnly } from '../components/ClientOnly';
import { DrawCanvas } from '../game/three/DrawCanvas';
import { useGameStore } from '../game/store';
import type { Route } from './+types/game';

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Game ${params.code} — Scribattle` }];
}

/**
 * Game shell: layout only. The three panels map to the core loop —
 * scoreboard (left), drawing surface (center), guess chat (right).
 * Turn logic, word selection, timers, and realtime strokes come after the
 * user journey is mapped out.
 */
export default function Game({ params }: Route.ComponentProps) {
  const navigate = useNavigate();
  const code = params.code.toUpperCase();
  const username = useGameStore(s => s.username);

  useEffect(() => {
    if (!useGameStore.getState().username) navigate('/', { replace: true });
  }, [navigate]);

  return (
    <main className="flex min-h-svh flex-col bg-[#f7f5f1] text-stone-900">
      {/* top bar: round status + timer placeholder */}
      <header className="flex items-center justify-between border-b border-stone-200 bg-white/70 px-5 py-3">
        <Link to="/" className="font-serif text-2xl tracking-tight">
          Scri<span className="italic text-stone-500">battle</span>
        </Link>
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-stone-400">Round 1 of 3</p>
          <p className="font-mono text-sm text-stone-600">_ _ _ _ _ _</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-lg tabular-nums">90</span>
          <span className="rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-xs tracking-[0.2em] text-stone-500">
            {code}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        {/* scoreboard — mirrors the SpacetimeDB player table eventually */}
        <aside className="rounded-xl border border-stone-200 bg-white/70 p-4 lg:w-56">
          <h2 className="text-xs font-medium uppercase tracking-widest text-stone-400">Players</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span className="font-medium">{username || '—'} ✏️</span>
              <span className="font-mono tabular-nums text-stone-500">0</span>
            </li>
            <li className="text-xs italic text-stone-400">waiting for players…</li>
          </ul>
        </aside>

        {/* drawing surface — R3F canvas (WebGL, client-only) */}
        <section className="relative min-h-[50svh] flex-1 overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
          <ClientOnly
            fallback={<div className="flex h-full items-center justify-center text-sm text-stone-400">warming up the easel…</div>}
          >
            <DrawCanvas />
          </ClientOnly>

          {/* toolbar placeholder: brush / colors / undo / clear */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-stone-200 bg-white/90 px-4 py-2 shadow-sm">
            {['#1c1917', '#dc2626', '#2563eb', '#16a34a', '#d97706'].map(c => (
              <span key={c} className="size-5 rounded-full border border-stone-200" style={{ backgroundColor: c }} />
            ))}
            <span className="mx-1 h-5 w-px bg-stone-200" />
            <span className="text-xs uppercase tracking-widest text-stone-400">tools soon</span>
          </div>
        </section>

        {/* guess chat placeholder */}
        <aside className="flex flex-col rounded-xl border border-stone-200 bg-white/70 lg:w-72">
          <h2 className="border-b border-stone-100 p-4 text-xs font-medium uppercase tracking-widest text-stone-400">
            Guesses
          </h2>
          <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm text-stone-400 italic">
            guesses will stream here in real time…
          </div>
          <div className="border-t border-stone-100 p-3">
            <input
              disabled
              placeholder="type your guess…"
              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-stone-300"
            />
          </div>
        </aside>
      </div>
    </main>
  );
}
