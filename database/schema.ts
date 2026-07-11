import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// ---------------------------------------------------------------------------
// Analytics. Game rooms live in SpacetimeDB and are deleted the moment they
// empty (see server/src/index.ts), so the live store can't answer "how many
// rooms were created today". This append-only log is the durable record: the
// client writes one row per room creation (via /api/analytics/event), and the
// daily metrics cron (/api/cron/metrics) aggregates it over a 24h window.
// ---------------------------------------------------------------------------

export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Event kind, e.g. 'room_created'. */
    type: text('type').notNull(),
    /** Small JSON blob of event-specific fields, e.g. {"isPublic":true}. */
    meta: text('meta').notNull().default('{}'),
    /** SpacetimeDB identity hex of the actor, when known (nullable — guests). */
    identity: text('identity'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  t => [index('analytics_events_type_time').on(t.type, t.createdAt)]
);

/**
 * Tiny key/value store for server-side runtime config that has nowhere else to
 * live. Currently just the Telegram chat id auto-resolved from getUpdates so
 * the alert cron doesn't need it hand-configured (see app/lib/telegram.server.ts).
 */
export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---------------------------------------------------------------------------
// Moderation. Players are identified by their SpacetimeDB identity hex (the
// anonymous "session id" persisted in their localStorage), not Clerk — anyone
// can be reported, signed in or not. Escalation within a rolling window:
// level 1 = warning modal, level 2 = removed from the game, level 3 = IP ban.
// Constants (window/ban lengths, reasons) live in app/lib/moderation.ts.
// ---------------------------------------------------------------------------

/**
 * One row per offense (offender + game + turn) — multiple reports of the same
 * drawing collapse into one warning instead of triple-striking the artist.
 * `level` is fixed at creation from the offender's recent history.
 */
export const warnings = sqliteTable(
  'warnings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SpacetimeDB identity hex of the reported player. */
    offenderIdentity: text('offender_identity').notNull(),
    gameCode: text('game_code').notNull(),
    turn: integer('turn').notNull(),
    reason: text('reason').notNull(), // 'profane-imagery' | 'drawing-words' | 'other'
    /** 1 = warn, 2 = removed from game, 3 = IP banned. */
    level: integer('level').notNull(),
    /** Set when the offender's client has shown the notice. */
    acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  t => [
    index('warnings_offender').on(t.offenderIdentity),
    uniqueIndex('warnings_offense').on(t.offenderIdentity, t.gameCode, t.turn),
  ]
);

/** Raw reports, all of them — the free-text details land here, per reporter. */
export const reports = sqliteTable(
  'reports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    warningId: integer('warning_id')
      .notNull()
      .references(() => warnings.id),
    reporterIdentity: text('reporter_identity').notNull(),
    reason: text('reason').notNull(),
    details: text('details').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  t => [uniqueIndex('reports_once_per_reporter').on(t.warningId, t.reporterIdentity)]
);

/**
 * Admin evidence: the reporter's client-side view of the game at report time
 * (room, players, the offending turn's strokes, recent guesses) as JSON.
 */
export const gameSnapshots = sqliteTable('game_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  warningId: integer('warning_id')
    .notNull()
    .references(() => warnings.id),
  gameCode: text('game_code').notNull(),
  turn: integer('turn').notNull(),
  data: text('data').notNull(), // JSON blob
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * identity → IP sightings, upserted every time a client polls moderation
 * status. Gameplay goes through SpacetimeDB (we never see IPs there), so this
 * is what lets a level-3 warning turn into an IP ban.
 */
export const identityIps = sqliteTable(
  'identity_ips',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    identity: text('identity').notNull(),
    ip: text('ip').notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  t => [
    uniqueIndex('identity_ips_pair').on(t.identity, t.ip),
    index('identity_ips_identity').on(t.identity),
  ]
);

/** Active bans — root.tsx checks the caller's IP on every document request. */
export const ipBans = sqliteTable(
  'ip_bans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ip: text('ip').notNull(),
    /** The identity that earned the ban (for admin forensics). */
    identity: text('identity').notNull(),
    warningId: integer('warning_id').references(() => warnings.id),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  t => [index('ip_bans_ip').on(t.ip)]
);
