# Scribattle — Architecture Index

Multiplayer draw-and-guess game. React Router v7 (framework mode) + SpacetimeDB (realtime) + Turso/Drizzle (persistent) + Clerk (auth).

## The two-database split (most important concept)

| Store | Holds | Code |
|---|---|---|
| **SpacetimeDB** (Maincloud) | Live game state: rooms, players, strokes, guesses, votes, turn timers. Server-authoritative via reducers. | `server/src/index.ts` (the module), `app/spacetime/` (client) |
| **Turso** (via Drizzle) | Anything that outlives a game: user accounts (Clerk id keyed), credits, referrals, shop unlocks. | `database/schema.ts`, `app/lib/db.server.ts`, `app/routes/api.*` |

Game identity is **anonymous-first**: a SpacetimeDB token in localStorage (`scribattle:spacetimedb-token`) identifies the player across refreshes — totally separate from Clerk auth. Clerk sign-in only gates the economy (credits/shop/referrals/reduced ads).

## Realtime data flow (one direction)

```
server/src/index.ts (reducers mutate tables)
  → app/spacetime/connection.ts   subscribes to all public tables, mirrors rows
  → app/game/store.ts             zustand store (read-only mirror + UI state)
  → route components              read store, call action fns from connection.ts
```

- Components **never** touch the connection directly; they call the exported action functions (`createGame`, `submitGuess`, `sendStroke`, …) in `app/spacetime/connection.ts`.
- `sync()` in connection.ts rebuilds the whole store digest per microtask batch; `waitForStore(pred)` bridges reducer acks to mirrored state.
- Reducer `SenderError` messages propagate to the client as promise rejections — that's how validation errors (bad code, full room, profanity) reach the UI.

## SpacetimeDB module (`server/src/`)

- `index.ts` — all tables + reducers. Game loop: `create_game`/`join_game` → host `start_game` → artist draws (`add_stroke`, `update_live_stroke`), others `submit_guess` (decaying points) → `end_turn` rotates (server-clock-checked, clients race safely) → after N rounds `status='finished'` → slideshow + `cast_vote` → host `play_again`.
- `profanity.ts` — dictionary filter (de-leet + squeeze + collapsed forms; whole-word list + unambiguous substrings). Applied to usernames and guesses.
- Rooms: 4-char codes, `isPublic` flag — private rooms are simply filtered out of the home-screen list client-side (`sync()` in connection.ts); word is technically readable in the public table (known tradeoff, see comment on the `game` table).
- Presence: disconnect only flips `online`; player rows are removed explicitly (`leave_game`) or when the room empties.

### Module workflows
- Publish (dev targets **Maincloud**, not local): `yes | npm run stdb:publish:cloud`
- Regenerate client bindings (only when tables/reducer **signatures** change): `npm run stdb:generate` → `app/spacetime/module_bindings/`
- Logs: `npm run stdb:logs:cloud`
- Constants (room code length/alphabet, max players, etc.) are duplicated in `app/game/constants.ts` — keep in sync with `server/src/index.ts`.

## Routes (`app/routes.ts` — must be edited when adding routes)

| Route | File | Purpose |
|---|---|---|
| `/` | `routes/home.tsx` | Username, create (public/private toggle), join by code, public games list |
| `/lobby/:code` | `routes/lobby.tsx` | Waiting room, invite links (referral-tagged), host starts |
| `/game/:code` | `routes/game.tsx` | Core loop screen + `GameOver` results/slideshow/voting; ad break between them |
| `/watch/:code` | `routes/watch.tsx` | Watch mode — same `GameScreen`, spectator row instead of player row (no username, no ad break, join CTA; `spectator` table caps at 20/room, rows die on disconnect) |
| `/shop` | `routes/shop.tsx` | Credits balance, referral link hub, buy catalog items |
| `/admin` | `routes/admin.tsx` | Moderation dashboard — allowlisted admin emails only, 404 for everyone else |
| `/sign-in`, `/sign-up` | `routes/sign-{in,up}.tsx` | Clerk pages (modals used mostly) |
| `/api/profile` | `routes/api.profile.ts` | GET: `{signedIn, credits, referralCode, unlocks}`; lazily creates the Turso user row |
| `/api/referral/claim` | `routes/api.referral.claim.ts` | POST `{code}`: credit referrer + welcome bonus (new accounts only, once ever) |
| `/api/shop/buy` | `routes/api.shop.buy.ts` | POST `{itemId}`: spend credits, insert unlock |
| `/api/moderation/report` | `routes/api.moderation.report.ts` | POST: file a report (creates/attaches to a warning, stores snapshot, may IP-ban) |
| `/api/moderation/status` | `routes/api.moderation.status.ts` | GET `?identity=`: offender polls for warnings/bans; records identity→IP |
| `/api/moderation/ack` | `routes/api.moderation.ack.ts` | POST: offender's client confirms it showed/enforced a warning |

Refresh/deep-link recovery: lobby and game mount `ensureInGame()`; nameless visitors bounce to `/?join=CODE`.

## Economy & monetization

- **Catalog is code, ownership is data**: `app/lib/catalog.ts` defines items (ad-free perk, ink skin packs, fat-cap brush), prices, referral rewards, and ad-break durations. Turso `unlocks` only stores `(userId, itemId)`.
- **Profile mirror**: `app/lib/profile.ts` — zustand store fed by `/api/profile`; `refreshProfile()` runs from `EconomyBoot` in `root.tsx` and after claims/purchases. Unlocks change gameplay in `game.tsx` (extra palette colors, fat brush toggle, ad skip).
- **Referrals**: `app/lib/referral.ts`. Share links carry `?ref=<referralCode>`; home/lobby capture it to localStorage on mount; `EconomyBoot` (root.tsx) claims it after a fresh signup (<24h-old Clerk account).
- **Ads**: `app/components/AdBreak.tsx` — placeholder interstitial shown by `game.tsx` when a match finishes, before results. Guests wait `AD_SECONDS_GUEST`, members `AD_SECONDS_MEMBER`, `ad-free` owners skip. Contains the "tired of ads?" upsell ladder. AdSense account meta tag is in `root.tsx`; the placeholder box in AdBreak is where a real ad unit mounts.

## Moderation (report → warn → remove → IP ban)

- Players report the **current artist** (⚑ button in game header) via `ReportModal.tsx`: reason (`profane-imagery` | `drawing-words` | `other`) + free text. Constants/copy in `app/lib/moderation.ts` (pure, shared), client calls in `app/lib/moderation.client.ts`.
- Offenders are keyed by **SpacetimeDB identity hex** (the anonymous session id), not Clerk. Reports of the same offender+game+turn collapse into **one warning**; escalation counts warnings in a rolling 3-day window: level 1 = warning modal, level 2 = removed from the game, level 3 = 2-week IP ban.
- Turso tables: `warnings` (one per offense, level fixed at creation), `reports` (raw, per reporter, free text), `game_snapshots` (reporter's client-side game state JSON — word, strokes of the turn, players, guesses — for admin review), `identity_ips`, `ip_bans`.
- **IP plumbing**: gameplay traffic goes to SpacetimeDB, so our server only sees a player's IP when their client polls `/api/moderation/status` (every 30s in-game via `ModerationGuard.tsx`). Polls upsert `identity_ips`; a level-3 warning bans all recently-seen IPs; a banned identity polling from a new IP gets that IP banned too. `root.tsx`'s loader checks `ip_bans` (via `app/lib/ip.server.ts`) on every document request and renders `BannedScreen` instead of the app.
- **Trust model**: level-1/2 enforcement is client-side (`ModerationGuard` shows the modal, then `leaveGame()` on level 2) — a tampered client can ignore it; the level-3 IP ban is server-enforced. Local dev has no `x-forwarded-for`, so IP features no-op there unless you send the header manually.
- **Admin**: `/admin` (`routes/admin.tsx`) lists active bans (lift button) and recent warnings with reporter details + an SVG replay of the snapshotted drawing; dismissing a warning deletes it with its reports/snapshot/bans. Access = Clerk primary email in the `ADMIN_EMAILS` allowlist in `app/lib/admin.server.ts` (uses `clerkClient(args).users.getUser`); everyone else gets a 404 from both loader and action.

## Auth (Clerk)

- `root.tsx`: `clerkMiddleware` + `rootAuthLoader`, but **only when keys exist in `.env`** — the shell must boot Clerk-less (then `getAuth` throws; API routes catch and treat callers as guests).
- API routes use `getAuth(args)` from `@clerk/react-router/server`.

## Drawing surface

`app/game/three/DrawCanvas.tsx` — React Three Fiber canvas. Strokes are flat `[x0,y0,x1,y1,…]` polylines normalized 0..1 across the paper; live stroke streamed via a throttled single-row-per-game table. `app/game/hints.ts` masks the word for guessers with time-based letter reveals.

## Commands

- `npm run typecheck` (app, runs typegen first) / `npm run typecheck:server` (module)
- `npm run db:push` — Turso schema (preferred over migrations for now)
- No test suite yet. Dev server: user runs it themselves (don't start one).

## Gotchas

- React Router v7 framework mode: new/renamed route files require `app/routes.ts` edits, and `.react-router/types` regenerates via `npm run typecheck`.
- SpacetimeDB `spacetime publish` to Maincloud prompts interactively — pipe `yes` or use `--yes`.
- `u64` table ids arrive as BigInt; timestamps as `microsSinceUnixEpoch` BigInt.
- Browser testing: Chrome automation can't reach loopback — run dev on `0.0.0.0:5174` and use the LAN IP; draw via JS-dispatched PointerEvents.
