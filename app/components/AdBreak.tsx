import { SignUpButton, useUser } from '@clerk/react-router';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  AD_SECONDS_GUEST,
  AD_SECONDS_MEMBER,
  REFERRAL_REWARD,
} from '../lib/catalog';

/**
 * Post-match interstitial: a house-ad placeholder (swap in a real ad network
 * later), a countdown before the skip unlocks, and the monetization ladder —
 * guests are pitched a free account (shorter breaks), members are pitched
 * ad-free / share-to-earn. Players who own 'ad-free' never see this
 * (game.tsx skips rendering it).
 */
export function AdBreak({ onDone }: { onDone: () => void }) {
  const { isSignedIn } = useUser();
  const total = isSignedIn ? AD_SECONDS_MEMBER : AD_SECONDS_GUEST;
  const [secondsLeft, setSecondsLeft] = useState(total);

  useEffect(() => {
    setSecondsLeft(total);
    const id = setInterval(() => setSecondsLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [total]);

  const skippable = secondsLeft <= 0;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-[#f7f5f1] px-6 text-stone-900">
      <p className="text-xs font-medium uppercase tracking-widest text-stone-400">
        Ad break — results in a moment
      </p>

      {/* placeholder ad slot: this box is where the ad network unit mounts */}
      <div className="flex aspect-video w-full max-w-lg flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-stone-300 bg-white shadow-sm">
        <span className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
          Advertisement
        </span>
        <p className="font-serif text-3xl tracking-tight text-stone-300">Your ad here</p>
      </div>

      <button
        onClick={onDone}
        disabled={!skippable}
        className="rounded-lg border border-stone-300 bg-white px-6 py-2.5 text-sm font-medium text-stone-700 transition enabled:hover:border-stone-900 enabled:hover:text-stone-900 disabled:opacity-50"
      >
        {skippable ? 'See the results →' : `Skip in ${secondsLeft}…`}
      </button>

      {/* the upsell ladder: guest → free account; member → ad-free + referrals */}
      <div className="w-full max-w-lg rounded-xl border border-stone-200 bg-white/70 px-5 py-4 text-center text-sm text-stone-600">
        {isSignedIn ? (
          <p>
            Tired of ads?{' '}
            <Link to="/shop" className="font-medium text-stone-900 underline">
              Go ad-free in the shop
            </Link>{' '}
            — share your invite link and every friend who signs up earns you{' '}
            <span className="font-medium">{REFERRAL_REWARD} credits</span> toward it.
          </p>
        ) : (
          <p>
            Tired of ads?{' '}
            <SignUpButton mode="modal">
              <button className="font-medium text-stone-900 underline">
                Sign up free
              </button>
            </SignUpButton>{' '}
            for shorter ad breaks — and earn credits for skins and artist tools when
            friends join from your link.
          </p>
        )}
      </div>
    </main>
  );
}
