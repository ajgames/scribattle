import { and, eq } from 'drizzle-orm';
import { warnings } from '../../database/schema';
import { db } from '../lib/db.server';
import type { Route } from './+types/api.moderation.ack';

const IDENTITY_RE = /^[0-9a-f]{8,128}$/;

/**
 * POST { identity, warningId } — the offender's client confirms it showed the
 * warning notice (and enforced it: level 2+ leaves the game). Acknowledged
 * warnings stop coming back from the status poll.
 */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const body = (await args.request.json().catch(() => null)) as {
    identity?: string;
    warningId?: number;
  } | null;
  const identity = body?.identity ?? '';
  const warningId = body?.warningId;
  if (!IDENTITY_RE.test(identity) || typeof warningId !== 'number') {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  await db()
    .update(warnings)
    .set({ acknowledgedAt: new Date() })
    .where(and(eq(warnings.id, warningId), eq(warnings.offenderIdentity, identity)));

  return Response.json({ ok: true });
}
