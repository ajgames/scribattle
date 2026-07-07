import { SignInButton, SignUpButton, useUser } from '@clerk/react-router';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { REFERRAL_REWARD, SHOP_ITEMS, WELCOME_BONUS, type ShopItem } from '../lib/catalog';
import { buyItem, refreshProfile, useProfileStore } from '../lib/profile';
import { referralLink } from '../lib/referral';
import { pageMeta } from '../lib/seo';
import type { Route } from './+types/shop';

export function meta({}: Route.MetaArgs) {
  return pageMeta({
    title: 'Shop — Ink Skins, Brushes & Ad-Free — Scribattle',
    description:
      'Spend Scribattle credits on ink skin packs, the fat-cap brush, and an ad-free experience. Earn free credits by inviting friends with your referral link.',
    path: '/shop',
  });
}

const KIND_LABEL: Record<ShopItem['kind'], string> = {
  perk: 'perk',
  skin: 'ink skin',
  tool: 'artist tool',
};

/**
 * The credit sink: spend referral credits on skins (extra palette inks),
 * artist tools (brush upgrades), and the ad-free perk. Also the referral
 * hub — your share link and the earn-per-signup pitch live here.
 */
export default function Shop() {
  const { isSignedIn } = useUser();
  const profile = useProfileStore();
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    refreshProfile();
  }, [isSignedIn]);

  const shareUrl =
    typeof window !== 'undefined' && profile.referralCode
      ? referralLink(profile.referralCode, window.location.origin)
      : '';

  function copyShareLink() {
    if (!shareUrl) return;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  async function handleBuy(itemId: string) {
    if (busyItem) return;
    setBusyItem(itemId);
    setError('');
    try {
      await buyItem(itemId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'purchase failed');
    } finally {
      setBusyItem(null);
    }
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#f7f5f1] text-stone-900">
      <div className="menu-backdrop" aria-hidden />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-12">
        <header className="text-center">
          <Link to="/" className="font-serif text-5xl tracking-tight text-stone-900">
            Scri<span className="italic text-stone-500">battle</span>
          </Link>
          <p className="mt-2 text-xs font-medium uppercase tracking-widest text-stone-500">
            The shop
          </p>
        </header>

        {isSignedIn ? (
          <>
            {/* balance + referral hub */}
            <section className="rounded-xl border border-stone-200 bg-white/70 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-medium uppercase tracking-widest text-stone-400">
                  Your credits
                </h2>
                <span className="font-mono text-2xl tabular-nums">✨ {profile.credits}</span>
              </div>
              <p className="mt-3 text-sm text-stone-600">
                Earn {REFERRAL_REWARD} credits for every friend who signs up from your
                link (they get {WELCOME_BONUS} to start with, too).
              </p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl || 'loading your link…'}
                  className="w-full truncate rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-500"
                />
                <button
                  onClick={copyShareLink}
                  disabled={!shareUrl}
                  className="shrink-0 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-medium uppercase tracking-widest text-stone-600 transition enabled:hover:border-stone-900 enabled:hover:text-stone-900 disabled:opacity-40"
                >
                  {copied ? 'copied!' : 'copy'}
                </button>
              </div>
            </section>

            {/* catalog */}
            <section className="flex flex-col gap-3">
              {SHOP_ITEMS.map(item => {
                const owned = profile.unlocks.includes(item.id);
                const affordable = profile.credits >= item.price;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 rounded-xl border border-stone-200 bg-white/70 px-5 py-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium">{item.name}</h3>
                        <span className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
                          {KIND_LABEL[item.kind]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-stone-500">{item.description}</p>
                      {item.colors && (
                        <div className="mt-2 flex gap-1.5">
                          {item.colors.map(c => (
                            <span
                              key={c}
                              className="size-4 rounded-full border border-stone-200"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    {owned ? (
                      <span className="text-xs font-medium uppercase tracking-widest text-green-600">
                        owned
                      </span>
                    ) : (
                      <button
                        onClick={() => handleBuy(item.id)}
                        disabled={busyItem !== null || !affordable}
                        title={affordable ? undefined : 'not enough credits — share your link!'}
                        className="shrink-0 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 transition enabled:hover:bg-stone-700 disabled:opacity-40"
                      >
                        {busyItem === item.id ? '…' : `✨ ${item.price}`}
                      </button>
                    )}
                  </div>
                );
              })}
            </section>

            {error && <p className="text-center text-sm text-red-600">{error}</p>}
          </>
        ) : (
          <section className="rounded-xl border border-stone-200 bg-white/70 p-8 text-center">
            <p className="text-sm text-stone-600">
              The shop runs on credits — sign up free, share your invite link, and earn{' '}
              {REFERRAL_REWARD} credits per friend for skins, artist tools, and an
              ad-free experience.
            </p>
            <div className="mt-5 flex items-center justify-center gap-3">
              <SignUpButton mode="modal">
                <button className="rounded-lg bg-stone-900 px-5 py-2.5 text-sm font-medium text-stone-50 transition hover:bg-stone-700">
                  Sign up free
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button className="rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 transition hover:border-stone-900 hover:text-stone-900">
                  Sign in
                </button>
              </SignInButton>
            </div>
          </section>
        )}

        <Link to="/" className="text-center text-xs text-stone-400 transition hover:text-stone-600">
          ← back to the main menu
        </Link>
      </div>
    </main>
  );
}
