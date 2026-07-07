import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { identityIps, ipBans, warnings } from '../../database/schema';
import { db } from '../lib/db.server';
import { getClientIp } from '../lib/ip.server';
import { BAN_MS, type ModerationStatus } from '../lib/moderation';
import type { Route } from './+types/api.moderation.status';

const IDENTITY_RE = /^[0-9a-f]{8,128}$/;

/**
 * GET ?identity=<hex> — polled by every client while in a game. Returns the
 * caller's unacknowledged warnings (level tells the client what to do: show a
 * notice, leave the game, or show the ban screen) and whether they're banned.
 *
 * Side effects that make IP bans possible at all (gameplay goes through
 * SpacetimeDB, so this poll is the only time we see a player's IP):
 *  - records identity→IP so a future level-3 warning can ban it
 *  - if the identity already earned a level-3, bans the current IP too
 *    (catches address changes and pre-poll bans)
 */
export async function loader(args: Route.LoaderArgs) {
  const identity = new URL(args.request.url).searchParams.get('identity') ?? '';
  if (!IDENTITY_RE.test(identity)) {
    return Response.json({ error: 'bad identity' }, { status: 400 });
  }
  const ip = getClientIp(args.request);
  const now = new Date();

  if (ip) {
    await db()
      .insert(identityIps)
      .values({ identity, ip })
      .onConflictDoUpdate({
        target: [identityIps.identity, identityIps.ip],
        set: { lastSeenAt: sql`(unixepoch())` },
      });
  }

  const unacked = await db()
    .select()
    .from(warnings)
    .where(and(eq(warnings.offenderIdentity, identity), isNull(warnings.acknowledgedAt)))
    .orderBy(desc(warnings.createdAt))
    .all();

  // does this identity have a live ban (via any of its warnings)?
  const banned = await db()
    .select({ id: ipBans.id, expiresAt: ipBans.expiresAt })
    .from(ipBans)
    .where(and(eq(ipBans.identity, identity), gt(ipBans.expiresAt, now)))
    .orderBy(desc(ipBans.expiresAt))
    .get();

  // banned identity showing up from a new address — extend the net
  if (banned && ip) {
    const thisIpBanned = await db()
      .select({ id: ipBans.id })
      .from(ipBans)
      .where(and(eq(ipBans.ip, ip), gt(ipBans.expiresAt, now)))
      .get();
    if (!thisIpBanned) {
      await db()
        .insert(ipBans)
        .values({ ip, identity, expiresAt: new Date(Date.now() + BAN_MS) });
    }
  }

  const status: ModerationStatus = {
    warnings: unacked.map(w => ({
      id: w.id,
      level: w.level,
      reason: w.reason as ModerationStatus['warnings'][number]['reason'],
    })),
    banned: !!banned,
    bannedUntil: banned?.expiresAt.getTime(),
  };
  return Response.json(status);
}
