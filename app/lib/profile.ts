import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { AD_FREE_ITEM_ID } from './catalog';

/**
 * Client mirror of /api/profile — the signed-in user's credits, referral
 * code, and owned shop items. Guests get the zero state. Refreshed on app
 * boot (root.tsx), after a referral claim, and after a purchase.
 */

interface ProfileState {
  /** false until the first /api/profile response lands. */
  loaded: boolean;
  signedIn: boolean;
  credits: number;
  referralCode: string;
  unlocks: string[];
}

const zero = { loaded: false, signedIn: false, credits: 0, referralCode: '', unlocks: [] as string[] };

export const useProfileStore: UseBoundStore<StoreApi<ProfileState>> = create<ProfileState>()(
  () => ({ ...zero })
);

export function hasUnlock(itemId: string): boolean {
  return useProfileStore.getState().unlocks.includes(itemId);
}

export function isAdFree(state: ProfileState): boolean {
  return state.unlocks.includes(AD_FREE_ITEM_ID);
}

export async function refreshProfile(): Promise<void> {
  try {
    const res = await fetch('/api/profile');
    if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
    const data = await res.json();
    useProfileStore.setState({
      loaded: true,
      signedIn: !!data.signedIn,
      credits: data.credits ?? 0,
      referralCode: data.referralCode ?? '',
      unlocks: data.unlocks ?? [],
    });
  } catch {
    // offline / server hiccup — keep whatever we had, mark as loaded so the
    // UI doesn't wait forever
    useProfileStore.setState(s => ({ ...s, loaded: true }));
  }
}

/** Attribute my signup to a referral code. Resolves even on rejection. */
export async function claimReferral(code: string): Promise<void> {
  try {
    const res = await fetch('/api/referral/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (res.ok) await refreshProfile();
  } catch {
    // attribution is best-effort — never block the user on it
  }
}

/** Buy a catalog item with credits. Throws with a human message on failure. */
export async function buyItem(itemId: string): Promise<void> {
  const res = await fetch('/api/shop/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'purchase failed');
  await refreshProfile();
}
