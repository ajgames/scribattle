import { and, eq, gt } from 'drizzle-orm';
import { gameSnapshots, identityIps, ipBans, reports, warnings } from '../../database/schema';
import { db } from '../lib/db.server';
import {
  BAN_MS,
  MAX_REPORT_DETAILS,
  WARNING_WINDOW_MS,
  isReportReason,
} from '../lib/moderation';
import type { Route } from './+types/api.moderation.report';

const IDENTITY_RE = /^[0-9a-f]{8,128}$/;
const GAME_CODE_RE = /^[A-Z0-9]{4}$/;
/** Snapshot JSON cap — a full turn of strokes fits comfortably under this. */
const MAX_SNAPSHOT_BYTES = 900_000;

/**
 * POST — a player reports the current artist. Body:
 *   { reporterIdentity, offenderIdentity, gameCode, turn, reason, details?, snapshot? }
 *
 * One warning per offense (offender+game+turn): the first report of an
 * offense creates it (level = recent-warning count + 1, capped at 3) and
 * stores the reporter's game snapshot for admin review; later reports of the
 * same offense just attach as extra report rows. A level-3 warning
 * immediately bans every IP the offender's client has been seen on recently.
 */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const body = (await args.request.json().catch(() => null)) as {
    reporterIdentity?: string;
    offenderIdentity?: string;
    gameCode?: string;
    turn?: number;
    reason?: string;
    details?: string;
    snapshot?: unknown;
  } | null;
  if (!body) return Response.json({ error: 'bad body' }, { status: 400 });

  const { reporterIdentity, offenderIdentity, gameCode, reason } = body;
  const turn = body.turn;
  if (
    !reporterIdentity ||
    !offenderIdentity ||
    !IDENTITY_RE.test(reporterIdentity) ||
    !IDENTITY_RE.test(offenderIdentity) ||
    !gameCode ||
    !GAME_CODE_RE.test(gameCode) ||
    typeof turn !== 'number' ||
    !Number.isInteger(turn) ||
    turn < 0 ||
    !isReportReason(reason)
  ) {
    return Response.json({ error: 'invalid report' }, { status: 400 });
  }
  if (reporterIdentity === offenderIdentity) {
    return Response.json({ error: 'cannot report yourself' }, { status: 400 });
  }
  const details = (body.details ?? '').trim().slice(0, MAX_REPORT_DETAILS);

  // same offense already on file? attach this report (idempotently) and stop —
  // five people reporting one drawing is one strike, not five
  const existing = await db()
    .select()
    .from(warnings)
    .where(
      and(
        eq(warnings.offenderIdentity, offenderIdentity),
        eq(warnings.gameCode, gameCode),
        eq(warnings.turn, turn)
      )
    )
    .get();
  if (existing) {
    await db()
      .insert(reports)
      .values({ warningId: existing.id, reporterIdentity, reason, details })
      .onConflictDoNothing();
    return Response.json({ ok: true, level: existing.level });
  }

  // fresh offense — escalate off the offender's recent record
  const windowStart = new Date(Date.now() - WARNING_WINDOW_MS);
  const recent = await db()
    .select({ id: warnings.id })
    .from(warnings)
    .where(
      and(eq(warnings.offenderIdentity, offenderIdentity), gt(warnings.createdAt, windowStart))
    )
    .all();
  const level = Math.min(recent.length + 1, 3);

  const warning = await db()
    .insert(warnings)
    .values({ offenderIdentity, gameCode, turn, reason, level })
    .returning()
    .get();
  await db()
    .insert(reports)
    .values({ warningId: warning.id, reporterIdentity, reason, details });

  // admin evidence: the reporter's client-side view of the game right now
  if (body.snapshot != null) {
    const data = JSON.stringify(body.snapshot);
    if (data.length <= MAX_SNAPSHOT_BYTES) {
      await db()
        .insert(gameSnapshots)
        .values({ warningId: warning.id, gameCode, turn, data });
    }
  }

  // strike three: ban every IP this identity has been seen on recently.
  // (IPs come from moderation-status polls — see api.moderation.status.ts.)
  if (level >= 3) {
    const seen = await db()
      .select()
      .from(identityIps)
      .where(
        and(eq(identityIps.identity, offenderIdentity), gt(identityIps.lastSeenAt, windowStart))
      )
      .all();
    const expiresAt = new Date(Date.now() + BAN_MS);
    for (const s of seen) {
      await db()
        .insert(ipBans)
        .values({ ip: s.ip, identity: offenderIdentity, warningId: warning.id, expiresAt });
    }
  }

  return Response.json({ ok: true, level });
}
