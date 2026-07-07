import { eq } from 'drizzle-orm';
import { users } from '../../database/schema';
import { db } from './db.server';

/**
 * Lazy user provisioning: a Turso row is created the first time a signed-in
 * client touches an authenticated API route. The referral code minted here is
 * what share links carry as ?ref=….
 */

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 8;

function randomReferralCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export type UserRow = typeof users.$inferSelect;

/** Fetch-or-create the row for a Clerk user id. */
export async function ensureUser(userId: string, username = 'player'): Promise<UserRow> {
  const existing = await db().select().from(users).where(eq(users.id, userId)).get();
  if (existing) return existing;

  // retry on the (astronomically rare) referral-code collision
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const row = await db()
        .insert(users)
        .values({ id: userId, username, referralCode: randomReferralCode() })
        .returning()
        .get();
      return row;
    } catch (err) {
      // a parallel request may have inserted us first — return that row
      const raced = await db().select().from(users).where(eq(users.id, userId)).get();
      if (raced) return raced;
      if (attempt === 2) throw err;
    }
  }
  throw new Error('unreachable');
}
