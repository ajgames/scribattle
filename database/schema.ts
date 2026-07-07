import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Turso (persistent) schema — the durable side of the split:
 *   SpacetimeDB → live game state (rooms, strokes, guesses, turn timers)
 *   Turso       → anything that outlives a game (accounts, credits, unlocks)
 *
 * Rows are keyed by Clerk user id. A user row is created lazily the first
 * time a signed-in client hits /api/profile. Credits are earned via
 * referrals (share links carry ?ref=<referralCode>) and spent in the shop
 * (catalog lives in code — app/lib/catalog.ts — only ownership is stored).
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // Clerk user id
  username: text('username').notNull(),
  /** Spendable balance — earned from referrals, spent on shop items. */
  credits: integer('credits').notNull().default(0),
  /** Share-link code (?ref=…) that attributes signups to this user. */
  referralCode: text('referral_code').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** One row per referred signup — referredId is unique so credit lands once. */
export const referrals = sqliteTable('referrals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  referrerId: text('referrer_id')
    .notNull()
    .references(() => users.id),
  referredId: text('referred_id')
    .notNull()
    .unique()
    .references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Shop purchases — itemId references the static catalog in app/lib/catalog.ts. */
export const unlocks = sqliteTable(
  'unlocks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    itemId: text('item_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  t => [uniqueIndex('unlocks_user_item').on(t.userId, t.itemId)]
);
