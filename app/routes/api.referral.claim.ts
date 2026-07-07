import { getAuth } from '@clerk/react-router/server';
import { eq } from 'drizzle-orm';
import { referrals, users } from '../../database/schema';
import { REFERRAL_REWARD, WELCOME_BONUS } from '../lib/catalog';
import { db } from '../lib/db.server';
import { ensureUser } from '../lib/users.server';
import type { Route } from './+types/api.referral.claim';

/** How long after account creation a referral can still be attributed. */
const CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * POST { code } — the freshly-signed-up caller says "this referral code sent
 * me". Credits the referrer (+REFERRAL_REWARD) and the newcomer
 * (+WELCOME_BONUS), once per account ever (referrals.referredId is unique).
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

  const body = (await args.request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim();
  if (!code) return Response.json({ error: 'missing code' }, { status: 400 });

  const me = await ensureUser(userId);

  // one attribution per account, and only for genuinely new accounts
  if (Date.now() - me.createdAt.getTime() > CLAIM_WINDOW_MS) {
    return Response.json({ error: 'referrals only apply to new accounts' }, { status: 400 });
  }
  const prior = await db()
    .select({ id: referrals.id })
    .from(referrals)
    .where(eq(referrals.referredId, userId))
    .get();
  if (prior) return Response.json({ error: 'already claimed' }, { status: 409 });

  const referrer = await db().select().from(users).where(eq(users.referralCode, code)).get();
  if (!referrer) return Response.json({ error: 'unknown referral code' }, { status: 404 });
  if (referrer.id === userId) {
    return Response.json({ error: 'nice try — you can’t refer yourself' }, { status: 400 });
  }

  await db().insert(referrals).values({ referrerId: referrer.id, referredId: userId });
  await db()
    .update(users)
    .set({ credits: referrer.credits + REFERRAL_REWARD })
    .where(eq(users.id, referrer.id));
  await db()
    .update(users)
    .set({ credits: me.credits + WELCOME_BONUS })
    .where(eq(users.id, userId));

  return Response.json({ ok: true, welcomeBonus: WELCOME_BONUS });
}
