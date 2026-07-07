/**
 * Moderation constants and types shared by the client (report modal, warning
 * notices) and the API routes. Pure data — no imports — so it's safe in both
 * bundles. The flow:
 *
 *   report #1 for an offense  → level-1 warning modal for the offender
 *   report #2 (fresh offense) → level-2: removed from the current game
 *   report #3 within 3 days   → level-3: 2-week IP ban
 *
 * Offenders are keyed by SpacetimeDB identity hex (the anonymous session id);
 * multiple reports of the same game+turn collapse into a single warning.
 */

export const WARNING_WINDOW_DAYS = 3;
export const BAN_DAYS = 14;

export const WARNING_WINDOW_MS = WARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
export const BAN_MS = BAN_DAYS * 24 * 60 * 60 * 1000;

export const MAX_REPORT_DETAILS = 1000;

export type ReportReason = 'profane-imagery' | 'drawing-words' | 'other';

export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: 'profane-imagery', label: 'Profane or inappropriate imagery' },
  { id: 'drawing-words', label: 'Drawing words instead of pictures' },
  { id: 'other', label: 'Other' },
];

export function isReportReason(v: unknown): v is ReportReason {
  return REPORT_REASONS.some(r => r.id === v);
}

/** What the offender is told they did — shown in the warning modal. */
export const REASON_EXPLANATIONS: Record<ReportReason, string> = {
  'profane-imagery':
    'Players reported you for drawing profane or inappropriate imagery. Keep your drawings family-friendly.',
  'drawing-words':
    'Players reported you for writing words or letters instead of drawing. Spelling the word out ruins the game — draw it!',
  other: 'Players reported you for breaking the rules of the game.',
};

/** A warning as returned to the offender's client (no reporter details). */
export interface WarningNotice {
  id: number;
  level: number; // 1 warn · 2 removed · 3 banned
  reason: ReportReason;
}

export interface ModerationStatus {
  warnings: WarningNotice[];
  banned: boolean;
  bannedUntil?: number; // ms since epoch
}
