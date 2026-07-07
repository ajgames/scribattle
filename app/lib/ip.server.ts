import { and, eq, gt } from 'drizzle-orm';
import { ipBans } from '../../database/schema';
import { db } from './db.server';

/**
 * Client IP extraction + ban lookup. Behind Vercel (or any proxy) the real
 * address is in x-forwarded-for; a bare local dev server has neither header,
 * so IP features quietly no-op there.
 */

export function getClientIp(request: Request): string | null {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip');
}

export type IpBanRow = typeof ipBans.$inferSelect;

/** The unexpired ban row for this IP, if any. */
export async function findActiveBan(ip: string | null): Promise<IpBanRow | null> {
  if (!ip) return null;
  const row = await db()
    .select()
    .from(ipBans)
    .where(and(eq(ipBans.ip, ip), gt(ipBans.expiresAt, new Date())))
    .get();
  return row ?? null;
}
