import { eq } from 'drizzle-orm';
import { appConfig } from '../../database/schema';
import { db } from './db.server';

/**
 * Telegram Bot API glue for the daily metrics alert (app/routes/api.cron.metrics.ts).
 *
 * Only the bot token (TELEGRAM_ALERT_TOKEN) is required. Telegram's sendMessage
 * still needs a chat_id, but rather than make you dig up the numeric id we
 * resolve it once from getUpdates — send the bot any message and the next cron
 * run captures your chat and persists it in app_config. Pin it explicitly with
 * TELEGRAM_CHAT_ID to skip auto-resolution.
 */

const CHAT_ID_KEY = 'telegram_alert_chat_id';

function token(): string {
  const t = process.env.TELEGRAM_ALERT_TOKEN;
  if (!t) throw new Error('TELEGRAM_ALERT_TOKEN is not set');
  return t;
}

async function api(method: string, body?: unknown): Promise<any> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: unknown; description?: string }
    | null;
  if (!json?.ok) {
    throw new Error(`telegram ${method} failed: ${json?.description ?? res.status}`);
  }
  return json.result;
}

async function cachedChatId(): Promise<string | null> {
  const row = await db()
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, CHAT_ID_KEY))
    .get();
  return row?.value ?? null;
}

async function rememberChatId(chatId: string): Promise<void> {
  await db()
    .insert(appConfig)
    .values({ key: CHAT_ID_KEY, value: chatId })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: chatId } });
}

/**
 * The chat to send alerts to, in priority order: explicit env override, a
 * previously-resolved id, or the most recent chat that messaged the bot.
 * Returns null (rather than throwing) when nobody has messaged the bot yet, so
 * the caller can surface a helpful "message your bot first" hint.
 */
export async function resolveAlertChatId(): Promise<string | null> {
  // Tolerate a quoted value in .env (e.g. TELEGRAM_CHAT_ID="-100123") — not
  // every env loader strips the surrounding quotes.
  const pinned = process.env.TELEGRAM_CHAT_ID?.trim().replace(/^["']|["']$/g, '');
  if (pinned) return pinned;

  const cached = await cachedChatId();
  if (cached) return cached;

  const updates = (await api('getUpdates')) as Array<{
    message?: { chat?: { id?: number } };
  }>;
  const latest = [...updates].reverse().find(u => u.message?.chat?.id != null);
  const chatId = latest?.message?.chat?.id;
  if (chatId == null) return null;

  await rememberChatId(String(chatId));
  return String(chatId);
}

/** Send an HTML-formatted message to the resolved alert chat. */
export async function sendAlert(text: string): Promise<void> {
  const chatId = await resolveAlertChatId();
  if (!chatId) {
    throw new Error(
      'no Telegram chat id — send your bot a message once so it can resolve one, or set TELEGRAM_CHAT_ID'
    );
  }
  await api('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}
