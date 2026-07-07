import { useGameStore } from '../game/store';
import type { ModerationStatus, ReportReason } from './moderation';

/**
 * Client half of moderation: submit reports (with a game snapshot as admin
 * evidence), poll for warnings against my identity, acknowledge them.
 */

/**
 * The reporter's view of the game, straight from the store mirror — room
 * (including the secret word), players, the offending turn's strokes, and the
 * recent guess feed. Stored server-side per warning for admin review.
 */
export function buildGameSnapshot(): Record<string, unknown> {
  const s = useGameStore.getState();
  return {
    capturedAt: new Date().toISOString(),
    room: s.room,
    players: s.players,
    strokes: s.strokes.filter(st => st.turn === (s.room?.turn ?? -1)),
    guesses: s.guesses.slice(-50),
    drawings: s.drawings,
  };
}

export async function submitReport(input: {
  offenderIdentity: string;
  gameCode: string;
  turn: number;
  reason: ReportReason;
  details: string;
}): Promise<void> {
  const reporterIdentity = useGameStore.getState().identity;
  const res = await fetch('/api/moderation/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, reporterIdentity, snapshot: buildGameSnapshot() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? 'report failed');
  }
}

export async function fetchModerationStatus(identity: string): Promise<ModerationStatus | null> {
  try {
    const res = await fetch(`/api/moderation/status?identity=${encodeURIComponent(identity)}`);
    if (!res.ok) return null;
    return (await res.json()) as ModerationStatus;
  } catch {
    return null; // offline — try again next poll
  }
}

export function ackWarning(identity: string, warningId: number): Promise<unknown> {
  return fetch('/api/moderation/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, warningId }),
  }).catch(() => {
    // best-effort — an unacked warning just shows again next poll
  });
}
