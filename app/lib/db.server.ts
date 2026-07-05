import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../../database/schema';

/**
 * Turso client for loaders/actions. Lazy so the shell boots without a
 * database configured — it only throws when a route actually queries.
 */
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (_db) return _db;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is not set — copy .env.example to .env and fill it in');
  }
  _db = drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }), { schema });
  return _db;
}
