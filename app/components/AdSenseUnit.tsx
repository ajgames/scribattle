import { useEffect, useRef } from 'react';
import { ADSENSE_CLIENT, AD_SLOT_POST_GAME } from '../lib/catalog';

/**
 * A single Google AdSense display unit.
 *
 * The loader script (`adsbygoogle.js`) lives in the document head (root.tsx);
 * here we render the `<ins>` slot and hand it to AdSense with one `push({})`.
 * The push queues if the loader hasn't finished downloading yet, so order is safe.
 *
 * SPA note: this component mounts fresh each time the ad break appears, giving a
 * new empty `<ins>`. The interstitial re-renders every second (countdown), so the
 * push is fenced behind a ref — pushing a second time for an already-filled `<ins>`
 * makes AdSense throw "All 'ins' elements … already have ads in them".
 *
 * Until a real `data-ad-slot` is configured (AD_SLOT_POST_GAME), and in dev where
 * AdSense never fills (unapproved origin), we show a house-ad placeholder so the
 * break never looks broken.
 */
export function AdSenseUnit({ className }: { className?: string }) {
  const insRef = useRef<HTMLModElement>(null);
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!AD_SLOT_POST_GAME || pushedRef.current) return;
    // guard SSR / loader-not-present; the array is created by the loader script
    if (typeof window === 'undefined') return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushedRef.current = true;
    } catch {
      // a duplicate push (fast remount) or loader hiccup — leave the slot as-is
    }
  }, []);

  if (!AD_SLOT_POST_GAME) {
    // placeholder house ad — no live slot configured
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 ${className ?? ''}`}
      >
        <span className="rounded border border-stone-200 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-stone-400">
          Advertisement
        </span>
        <p className="font-serif text-3xl tracking-tight text-stone-300">Your ad here</p>
      </div>
    );
  }

  return (
    <ins
      ref={insRef}
      className={`adsbygoogle block ${className ?? ''}`}
      style={{ display: 'block' }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={AD_SLOT_POST_GAME}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
