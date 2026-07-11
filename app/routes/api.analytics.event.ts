import { analyticsEvents } from '../../database/schema';
import { db } from '../lib/db.server';
import type { Route } from './+types/api.analytics.event';

/**
 * POST { type, meta?, identity? } — append one analytics event.
 *
 * The durable record of things SpacetimeDB forgets (rooms are deleted when they
 * empty). Deliberately permissive: guests included, no auth. The daily metrics
 * cron aggregates these; the client fires it best-effort (see connection.ts).
 */

const ALLOWED_TYPES = new Set(['room_created']);
const IDENTITY_RE = /^[0-9a-f]{8,128}$/;

export async function action(args: Route.ActionArgs) {
  if (args.request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const body = (await args.request.json().catch(() => null)) as {
    type?: string;
    meta?: unknown;
    identity?: string;
  } | null;

  const type = body?.type;
  if (!type || !ALLOWED_TYPES.has(type)) {
    return Response.json({ error: 'unknown event type' }, { status: 400 });
  }

  // Keep meta small and stringy — it's an opaque JSON blob for aggregation.
  let meta = '{}';
  if (body?.meta && typeof body.meta === 'object') {
    const json = JSON.stringify(body.meta);
    if (json.length <= 512) meta = json;
  }

  const identity =
    typeof body?.identity === 'string' && IDENTITY_RE.test(body.identity)
      ? body.identity
      : null;

  await db().insert(analyticsEvents).values({ type, meta, identity });
  return Response.json({ ok: true });
}
