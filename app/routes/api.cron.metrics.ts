import { and, eq, gte, sql } from 'drizzle-orm';
import {
  analyticsEvents,
  ipBans,
  referrals,
  reports,
  unlocks,
  users,
  warnings,
} from '../../database/schema';
import { shopItem } from '../lib/catalog';
import { db } from '../lib/db.server';
import { sendAlert } from '../lib/telegram.server';
import type { Route } from './+types/api.cron.metrics';

/**
 * Daily growth digest → Telegram. Scheduled from vercel.json (twice a day).
 *
 * Aggregates a rolling 24h window across Turso and pushes a formatted message.
 * Rooms come from the analytics_events log (SpacetimeDB deletes rooms when they
 * empty, so it can't be counted after the fact); everything else is already
 * durably timestamped in its own table.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET
 * is set; we also accept `?key=<CRON_SECRET>` for manual/local triggering. When
 * CRON_SECRET is unset the endpoint is open (dev convenience only).
 */
export async function loader(args: Route.LoaderArgs) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const url = new URL(args.request.url);
    const bearer = args.request.headers.get('authorization');
    const ok = bearer === `Bearer ${secret}` || url.searchParams.get('key') === secret;
    if (!ok) return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const database = db();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const countSince = (table: any, createdAtCol: any): Promise<number> =>
    database
      .select({ n: sql<number>`count(*)` })
      .from(table)
      .where(gte(createdAtCol, since))
      .get()
      .then((r: { n: number } | undefined) => r?.n ?? 0);

  // Rooms, split by public/private, from the event log.
  const roomRows = await database
    .select({
      isPublic: sql<string>`json_extract(${analyticsEvents.meta}, '$.isPublic')`,
      n: sql<number>`count(*)`,
    })
    .from(analyticsEvents)
    .where(
      and(eq(analyticsEvents.type, 'room_created'), gte(analyticsEvents.createdAt, since))
    )
    .groupBy(sql`json_extract(${analyticsEvents.meta}, '$.isPublic')`)
    .all();

  // json_extract yields 1/0 for SQLite booleans.
  const publicRooms = roomRows.find(r => String(r.isPublic) === '1')?.n ?? 0;
  const privateRooms = roomRows.find(r => String(r.isPublic) === '0')?.n ?? 0;
  const totalRooms = publicRooms + privateRooms;

  // Purchases + credits spent (price comes from the code catalog).
  const purchaseRows = await database
    .select({ itemId: unlocks.itemId })
    .from(unlocks)
    .where(gte(unlocks.createdAt, since))
    .all();
  const creditsSpent = purchaseRows.reduce((sum, p) => sum + (shopItem(p.itemId)?.price ?? 0), 0);

  const [signups, referralCount, reportCount, warningCount, banCount] = await Promise.all([
    countSince(users, users.createdAt),
    countSince(referrals, referrals.createdAt),
    countSince(reports, reports.createdAt),
    countSince(warnings, warnings.createdAt),
    countSince(ipBans, ipBans.createdAt),
  ]);

  const text = [
    `📊 <b>Scribattle · last 24h</b>`,
    ``,
    `🎨 Rooms: <b>${totalRooms}</b> (${publicRooms} public / ${privateRooms} private)`,
    `👤 Signups: <b>${signups}</b>   🔗 Referrals: <b>${referralCount}</b>`,
    `🛒 Purchases: <b>${purchaseRows.length}</b> (${creditsSpent} credits)`,
    `🚩 Moderation: ${reportCount} reports · ${warningCount} warnings · ${banCount} bans`,
  ].join('\n');

  try {
    await sendAlert(text);
  } catch (err) {
    // Surface the failure to the cron log without 500-crashing the invocation.
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }

  return Response.json({ ok: true });
}
