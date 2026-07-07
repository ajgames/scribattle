import { desc, eq, gt, inArray } from 'drizzle-orm';
import { Form, Link, useNavigation } from 'react-router';
import { gameSnapshots, ipBans, reports, warnings } from '../../database/schema';
import { requireAdmin } from '../lib/admin.server';
import { db } from '../lib/db.server';
import type { Route } from './+types/admin';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'Moderation — Scribattle' }];
}

const WARNING_PAGE = 50;

/** Display-ready slice of a reporter's game snapshot (see buildGameSnapshot). */
interface SnapshotView {
  word: string;
  artistName: string;
  playerNames: string[];
  strokes: { points: number[]; color: string; width: number }[];
  guesses: { username: string; text: string; correct: boolean }[];
}

/** Defensively pick the admin-relevant bits out of the stored JSON blob. */
function parseSnapshot(data: string, turn: number): SnapshotView | null {
  try {
    const raw = JSON.parse(data) as Record<string, any>;
    const players: any[] = Array.isArray(raw.players) ? raw.players : [];
    const drawings: any[] = Array.isArray(raw.drawings) ? raw.drawings : [];
    return {
      word: String(raw.room?.currentWord ?? drawings.find(d => d?.turn === turn)?.word ?? ''),
      artistName: String(
        players.find(p => p?.isArtist)?.username ??
          drawings.find(d => d?.turn === turn)?.artistName ??
          '?'
      ),
      playerNames: players.map(p => String(p?.username ?? '?')),
      strokes: (Array.isArray(raw.strokes) ? raw.strokes : [])
        .filter((s: any) => Array.isArray(s?.points))
        .map((s: any) => ({
          points: s.points.map(Number),
          color: typeof s.color === 'string' ? s.color : '#1c1917',
          width: typeof s.width === 'number' ? s.width : 0.007,
        })),
      guesses: (Array.isArray(raw.guesses) ? raw.guesses : []).map((g: any) => ({
        username: String(g?.username ?? '?'),
        text: String(g?.text ?? ''),
        correct: !!g?.correct,
      })),
    };
  } catch {
    return null;
  }
}

export async function loader(args: Route.LoaderArgs) {
  await requireAdmin(args);

  const warningRows = await db()
    .select()
    .from(warnings)
    .orderBy(desc(warnings.createdAt))
    .limit(WARNING_PAGE)
    .all();
  const ids = warningRows.map(w => w.id);

  const reportRows = ids.length
    ? await db().select().from(reports).where(inArray(reports.warningId, ids)).all()
    : [];
  const snapshotRows = ids.length
    ? await db().select().from(gameSnapshots).where(inArray(gameSnapshots.warningId, ids)).all()
    : [];
  const banRows = await db()
    .select()
    .from(ipBans)
    .where(gt(ipBans.expiresAt, new Date()))
    .orderBy(desc(ipBans.createdAt))
    .all();

  return {
    warnings: warningRows.map(w => ({
      id: w.id,
      offenderIdentity: w.offenderIdentity,
      gameCode: w.gameCode,
      turn: w.turn,
      reason: w.reason,
      level: w.level,
      acknowledged: !!w.acknowledgedAt,
      createdAt: w.createdAt.getTime(),
      reports: reportRows
        .filter(r => r.warningId === w.id)
        .map(r => ({
          reporterIdentity: r.reporterIdentity,
          reason: r.reason,
          details: r.details,
        })),
      snapshot: (() => {
        const row = snapshotRows.find(s => s.warningId === w.id);
        return row ? parseSnapshot(row.data, w.turn) : null;
      })(),
    })),
    bans: banRows.map(b => ({
      id: b.id,
      ip: b.ip,
      identity: b.identity,
      createdAt: b.createdAt.getTime(),
      expiresAt: b.expiresAt.getTime(),
    })),
  };
}

/**
 * Admin verbs, as form intents:
 *   lift-ban <banId>          — delete one ban row
 *   dismiss-warning <id>      — forgive: warning + its reports + snapshots go
 */
export async function action(args: Route.ActionArgs) {
  await requireAdmin(args);
  const form = await args.request.formData();
  const intent = form.get('intent');
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) return Response.json({ error: 'bad id' }, { status: 400 });

  if (intent === 'lift-ban') {
    await db().delete(ipBans).where(eq(ipBans.id, id));
  } else if (intent === 'dismiss-warning') {
    await db().delete(gameSnapshots).where(eq(gameSnapshots.warningId, id));
    await db().delete(reports).where(eq(reports.warningId, id));
    await db().delete(ipBans).where(eq(ipBans.warningId, id));
    await db().delete(warnings).where(eq(warnings.id, id));
  } else {
    return Response.json({ error: 'unknown intent' }, { status: 400 });
  }
  return { ok: true };
}

const LEVEL_BADGES: Record<number, { label: string; cls: string }> = {
  1: { label: 'warned', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  2: { label: 'removed', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  3: { label: 'banned', cls: 'bg-red-50 text-red-700 border-red-200' },
};

function short(identity: string): string {
  return `${identity.slice(0, 8)}…`;
}

function when(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** The snapshot drawing, replayed from the stored strokes as flat SVG ink. */
function SnapshotDrawing({ strokes }: { strokes: SnapshotView['strokes'] }) {
  return (
    <svg
      viewBox="0 0 1 1"
      className="aspect-square w-full max-w-xs rounded-lg border border-stone-200 bg-white"
    >
      {strokes.map((s, i) => {
        const pts: string[] = [];
        for (let j = 0; j + 1 < s.points.length; j += 2) {
          pts.push(`${s.points[j]},${s.points[j + 1]}`);
        }
        return (
          <polyline
            key={i}
            points={pts.join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

/**
 * Moderation dashboard — allowlisted admins only (app/lib/admin.server.ts;
 * everyone else 404s). Recent warnings with their reports and the snapshot
 * evidence, plus active IP bans with a lift button.
 */
export default function Admin({ loaderData }: Route.ComponentProps) {
  const { warnings: warningList, bans } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';

  return (
    <main className="min-h-svh bg-[#f7f5f1] text-stone-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
        <header className="flex items-baseline justify-between">
          <Link to="/" className="font-serif text-3xl tracking-tight">
            Scri<span className="italic text-stone-500">battle</span>
          </Link>
          <span className="text-xs font-medium uppercase tracking-widest text-stone-400">
            moderation
          </span>
        </header>

        {/* active bans */}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-stone-500">
            Active IP bans ({bans.length})
          </h2>
          <div className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white/70">
            {bans.map(b => (
              <div key={b.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="font-mono">{b.ip}</span>
                <span className="font-mono text-xs text-stone-400" title={b.identity}>
                  {short(b.identity)}
                </span>
                <span className="flex-1 text-right text-xs text-stone-400">
                  until {when(b.expiresAt)}
                </span>
                <Form method="post">
                  <input type="hidden" name="intent" value="lift-ban" />
                  <input type="hidden" name="id" value={b.id} />
                  <button
                    disabled={busy}
                    className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition enabled:hover:border-stone-900 enabled:hover:text-stone-900 disabled:opacity-40"
                  >
                    lift
                  </button>
                </Form>
              </div>
            ))}
            {bans.length === 0 && (
              <p className="px-4 py-3 text-sm italic text-stone-400">no active bans</p>
            )}
          </div>
        </section>

        {/* warnings + evidence */}
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-widest text-stone-500">
            Recent warnings ({warningList.length})
          </h2>
          <div className="flex flex-col gap-3">
            {warningList.map(w => {
              const badge = LEVEL_BADGES[w.level] ?? LEVEL_BADGES[1];
              return (
                <div key={w.id} className="rounded-xl border border-stone-200 bg-white/70 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span
                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                    <span className="font-medium">{w.reason}</span>
                    <span className="font-mono text-xs text-stone-400" title={w.offenderIdentity}>
                      {short(w.offenderIdentity)}
                    </span>
                    <span className="text-xs text-stone-400">
                      game {w.gameCode} · turn {w.turn} · {when(w.createdAt)}
                      {!w.acknowledged && ' · unseen'}
                    </span>
                    <span className="flex-1" />
                    <Form
                      method="post"
                      onSubmit={e => {
                        if (!confirm('Dismiss this warning and delete its reports/snapshot?')) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="dismiss-warning" />
                      <input type="hidden" name="id" value={w.id} />
                      <button
                        disabled={busy}
                        className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition enabled:hover:border-red-400 enabled:hover:text-red-600 disabled:opacity-40"
                      >
                        dismiss
                      </button>
                    </Form>
                  </div>

                  <ul className="mt-2 space-y-1 text-sm text-stone-600">
                    {w.reports.map((r, i) => (
                      <li key={i}>
                        <span className="font-mono text-xs text-stone-400" title={r.reporterIdentity}>
                          {short(r.reporterIdentity)}
                        </span>{' '}
                        <span className="text-xs text-stone-400">({r.reason})</span>{' '}
                        {r.details ? `“${r.details}”` : <span className="italic text-stone-400">no details</span>}
                      </li>
                    ))}
                  </ul>

                  {w.snapshot && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-medium uppercase tracking-widest text-stone-400 transition hover:text-stone-700">
                        snapshot — “{w.snapshot.word}” by {w.snapshot.artistName}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3 lg:flex-row">
                        <SnapshotDrawing strokes={w.snapshot.strokes} />
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="text-xs text-stone-400">
                            players: {w.snapshot.playerNames.join(', ') || '—'}
                          </p>
                          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                            {w.snapshot.guesses.map((g, i) => (
                              <li key={i} className={g.correct ? 'text-green-700' : 'text-stone-600'}>
                                <span className="font-medium">{g.username}</span>{' '}
                                {g.correct ? 'guessed the word' : g.text}
                              </li>
                            ))}
                            {w.snapshot.guesses.length === 0 && (
                              <li className="italic text-stone-400">no guesses captured</li>
                            )}
                          </ul>
                        </div>
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
            {warningList.length === 0 && (
              <p className="rounded-xl border border-stone-200 bg-white/70 px-4 py-3 text-sm italic text-stone-400">
                no warnings on file — a quiet day in the gallery
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
