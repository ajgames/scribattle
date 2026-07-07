/**
 * Referral attribution, client side. Landing on any page with ?ref=CODE
 * stashes the code in localStorage; once the visitor signs up (Clerk),
 * <ReferralClaimer> in root.tsx posts it to /api/referral/claim which
 * credits the referrer. Cleared after one claim attempt either way.
 */

const REF_KEY = 'scribattle:pending-ref';

/** Call on mount from any landing page — remembers ?ref=CODE for later. */
export function captureRefParam(): void {
  try {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && /^[a-zA-Z0-9_-]{4,32}$/.test(ref)) {
      localStorage.setItem(REF_KEY, ref);
    }
  } catch {
    // storage unavailable — referral attribution just won't happen
  }
}

export function loadPendingRef(): string | null {
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function clearPendingRef(): void {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* ignore */
  }
}

/** The share URL for a referrer — new visitors land on the menu, tagged. */
export function referralLink(referralCode: string, origin: string): string {
  return `${origin}/?ref=${encodeURIComponent(referralCode)}`;
}
