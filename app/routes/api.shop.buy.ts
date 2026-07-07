import { getAuth } from '@clerk/react-router/server';
import { and, eq } from 'drizzle-orm';
import { unlocks, users } from '../../database/schema';
import { shopItem } from '../lib/catalog';
import { db } from '../lib/db.server';
import { ensureUser } from '../lib/users.server';
import type { Route } from './+types/api.shop.buy';

/**
 * POST { itemId } — spend credits on a catalog item. Ownership is a row in
 * `unlocks` (unique per user+item); prices come from app/lib/catalog.ts.
 */
export async function action(args: Route.ActionArgs) {
  if (args.request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  let userId: string | null = null;
  try {
    userId = (await getAuth(args)).userId;
  } catch {
    /* Clerk unconfigured */
  }
  if (!userId) return Response.json({ error: 'sign in first' }, { status: 401 });

  const body = (await args.request.json().catch(() => null)) as { itemId?: string } | null;
  const item = body?.itemId ? shopItem(body.itemId) : undefined;
  if (!item) return Response.json({ error: 'unknown item' }, { status: 404 });

  const me = await ensureUser(userId);

  const owned = await db()
    .select({ id: unlocks.id })
    .from(unlocks)
    .where(and(eq(unlocks.userId, userId), eq(unlocks.itemId, item.id)))
    .get();
  if (owned) return Response.json({ error: 'already owned' }, { status: 409 });
  if (me.credits < item.price) {
    return Response.json(
      { error: `not enough credits — ${item.name} costs ${item.price}` },
      { status: 402 }
    );
  }

  await db()
    .update(users)
    .set({ credits: me.credits - item.price })
    .where(eq(users.id, userId));
  await db().insert(unlocks).values({ userId, itemId: item.id });

  return Response.json({ ok: true, credits: me.credits - item.price });
}
