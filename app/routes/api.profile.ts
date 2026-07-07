import { getAuth } from '@clerk/react-router/server';
import { eq } from 'drizzle-orm';
import { unlocks } from '../../database/schema';
import { db } from '../lib/db.server';
import { ensureUser } from '../lib/users.server';
import type { Route } from './+types/api.profile';

/**
 * The signed-in user's economy snapshot: credits, referral code, owned shop
 * items. Signed-out (or Clerk unconfigured) callers get { signedIn: false } —
 * the client treats that as "guest, full-length ads, no unlocks".
 */
export async function loader(args: Route.LoaderArgs) {
  let userId: string | null = null;
  try {
    userId = (await getAuth(args)).userId;
  } catch {
    // Clerk middleware not configured — everyone is a guest
  }
  if (!userId) return Response.json({ signedIn: false });

  const me = await ensureUser(userId);
  const owned = await db()
    .select({ itemId: unlocks.itemId })
    .from(unlocks)
    .where(eq(unlocks.userId, userId))
    .all();

  return Response.json({
    signedIn: true,
    credits: me.credits,
    referralCode: me.referralCode,
    unlocks: owned.map(u => u.itemId),
  });
}
