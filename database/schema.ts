import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Turso (persistent) schema — the durable side of the split:
 *   SpacetimeDB → live game state (rooms, strokes, guesses, turn timers)
 *   Turso       → anything that outlives a game (accounts, stats, history)
 *
 * Shell version: just the Clerk-linked user row. Match history, lifetime
 * stats, and custom word lists get tables once the user journey is mapped.
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // Clerk user id
  username: text('username').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});
