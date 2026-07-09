/**
 * The in-game economy, all in code (client- and server-safe, no imports):
 * shop catalog, referral rewards, and ad-break tuning. Ownership rows live
 * in Turso (`unlocks`); this file is the source of truth for what an item
 * *is* and costs.
 */

/** Credits the referrer earns when someone signs up from their link. */
export const REFERRAL_REWARD = 50;
/** Welcome credits for the new user who signed up via a referral link. */
export const WELCOME_BONUS = 25;

/** Ad break length after each match — signing up shrinks it. */
export const AD_SECONDS_GUEST = 8;
export const AD_SECONDS_MEMBER = 3;

/**
 * Google AdSense identifiers for the post-match interstitial unit.
 * The publisher id matches the loader/meta tag in `root.tsx`. `AD_SLOT_POST_GAME`
 * is the `data-ad-slot` of a display ad unit created in the AdSense dashboard
 * (Ads → By ad unit → Display ads). Empty until a real slot is filled in;
 * `AdSenseUnit` renders its house-ad placeholder instead of a live unit when it is.
 */
export const ADSENSE_CLIENT = 'ca-pub-3025736277635211';
export const AD_SLOT_POST_GAME = '1571449575';

export type ShopItemKind = 'perk' | 'skin' | 'tool';

export interface ShopItem {
  id: string;
  kind: ShopItemKind;
  name: string;
  description: string;
  price: number;
  /** Skin packs: extra ink colors added to the artist palette when owned. */
  colors?: string[];
}

export const AD_FREE_ITEM_ID = 'ad-free';

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: AD_FREE_ITEM_ID,
    kind: 'perk',
    name: 'Ad-free forever',
    description: 'No more ad breaks between matches. Ever.',
    price: 300,
  },
  {
    id: 'ink-gold',
    kind: 'skin',
    name: 'Gilded ink',
    description: 'Two golden inks on your artist palette.',
    price: 100,
    colors: ['#b45309', '#eab308'],
  },
  {
    id: 'ink-neon',
    kind: 'skin',
    name: 'Neon pack',
    description: 'Three electric inks that demand attention.',
    price: 100,
    colors: ['#e11d48', '#06b6d4', '#a3e635'],
  },
  {
    id: 'fat-cap',
    kind: 'tool',
    name: 'Fat cap brush',
    description: 'A chunky brush toggle for bold, confident lines.',
    price: 150,
  },
];

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find(i => i.id === id);
}
