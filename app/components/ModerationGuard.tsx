import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useGameStore } from '../game/store';
import {
  BAN_DAYS,
  REASON_EXPLANATIONS,
  WARNING_WINDOW_DAYS,
  type WarningNotice,
} from '../lib/moderation';
import { ackWarning, fetchModerationStatus } from '../lib/moderation.client';
import { leaveGame } from '../spacetime/connection';

const POLL_MS = 30_000;

/**
 * The offender-side half of moderation, mounted on the game screen. Polls
 * /api/moderation/status for warnings against my identity and enforces them:
 *
 *   level 1 → warning modal explaining what was reported
 *   level 2 → modal, then removal from the current game on acknowledge
 *   level 3 → modal, removal, and the server has IP-banned us for 2 weeks
 *             (the root loader blocks banned IPs from loading the app)
 *
 * Enforcement is client-side by design: gameplay is on SpacetimeDB where our
 * API has no authority, so a tampered client can ignore level 2 — but the
 * level-3 IP ban is server-enforced and unavoidable.
 */
export function ModerationGuard() {
  const navigate = useNavigate();
  const identity = useGameStore(s => s.identity);
  const [notice, setNotice] = useState<(WarningNotice & { banned?: boolean }) | null>(null);
  const [leaving, setLeaving] = useState(false);
  const noticeShowing = useRef(false);
  noticeShowing.current = notice !== null;

  useEffect(() => {
    if (!identity) return;
    let cancelled = false;

    async function poll() {
      if (noticeShowing.current) return; // one notice at a time
      const status = await fetchModerationStatus(identity);
      if (cancelled || !status) return;
      const next = status.warnings[0];
      if (next) {
        setNotice({ ...next, banned: status.banned });
      } else if (status.banned) {
        setNotice({ id: 0, level: 3, reason: 'other', banned: true });
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [identity]);

  if (!notice) return null;

  const removed = notice.level >= 2 || notice.banned;

  async function dismiss() {
    if (leaving) return;
    setLeaving(true);
    if (notice!.id) await ackWarning(identity, notice!.id);
    if (removed) {
      try {
        await leaveGame();
      } catch {
        // best-effort — the ban/ack is already recorded server-side
      }
      navigate('/');
      return;
    }
    setLeaving(false);
    setNotice(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4">
      <div className="w-full max-w-sm rounded-xl border-2 border-red-300 bg-white p-5 shadow-lg">
        <h2 className="font-medium text-red-700">
          {notice.banned || notice.level >= 3
            ? '🚫 You have been banned'
            : notice.level === 2
              ? '⚠️ Removed from this game'
              : '⚠️ Warning'}
        </h2>

        <p className="mt-2 text-sm text-stone-600">{REASON_EXPLANATIONS[notice.reason]}</p>

        <p className="mt-2 text-sm text-stone-600">
          {notice.banned || notice.level >= 3 ? (
            <>
              This is your third strike in {WARNING_WINDOW_DAYS} days — you are banned
              from Scribattle for {BAN_DAYS} days.
            </>
          ) : notice.level === 2 ? (
            <>
              This is your second warning, so you've been removed from this game. One
              more report in the next {WARNING_WINDOW_DAYS} days and you'll be banned
              for {BAN_DAYS} days.
            </>
          ) : (
            <>
              This is a warning. If you're reported again you'll be removed from the
              game, and a third report within {WARNING_WINDOW_DAYS} days means a{' '}
              {BAN_DAYS}-day ban.
            </>
          )}
        </p>

        <button
          onClick={dismiss}
          disabled={leaving}
          className="mt-4 w-full rounded-lg bg-stone-900 py-2.5 text-sm font-medium text-stone-50 transition enabled:hover:bg-stone-700 disabled:opacity-60"
        >
          {leaving ? '…' : removed ? 'I understand — leave game' : 'I understand'}
        </button>
      </div>
    </div>
  );
}
