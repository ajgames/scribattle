# Deploying Scribattle to Vercel (production)

The app has three external services, each with its own production setup:

- **Turso** — persistent data (accounts, stats, history), queried server-side in loaders/actions
- **SpacetimeDB Maincloud** — realtime game state, connected to directly from the browser
- **Clerk** — auth

Vercel only runs the React Router app; Turso and SpacetimeDB live elsewhere, so
the main work is provisioning production instances and wiring env vars.

## 1. Turso production database

Create a separate prod database (don't point prod at the dev one):

```sh
turso db create scribattle-prod
turso db show scribattle-prod --url          # → TURSO_DATABASE_URL
turso db tokens create scribattle-prod       # → TURSO_AUTH_TOKEN
```

Push the schema to it from your machine (same `db:push` flow as dev, just
overriding the env for one command):

```sh
TURSO_DATABASE_URL=libsql://scribattle-prod-YOURORG.turso.io \
TURSO_AUTH_TOKEN=<token> \
npm run db:push
```

Repeat that `db:push` against prod whenever the schema changes — Vercel never
runs migrations for you.

## 2. SpacetimeDB module

Dev already targets Maincloud, so production can use the same published module —
but then **dev and prod share live game state**. If you want them isolated,
publish a second module and point prod at it:

```sh
spacetime publish scribattle-prod --server maincloud --module-path server
```

Then in Vercel set `VITE_SPACETIMEDB_NAME=scribattle-prod` (or leave it
`scribattle` to share with dev — fine while you're the only user).

After any change to `server/src/`, republish (`npm run stdb:publish:cloud`, or
the `scribattle-prod` variant) **before** deploying client code that depends on
it — browsers talk to Maincloud directly, not through Vercel.

## 3. Clerk production instance

1. In the [Clerk dashboard](https://dashboard.clerk.com), switch the app from
   **Development** to a **Production** instance (Create production instance).
2. Production instances require a real domain you own — Clerk won't run on
   `*.vercel.app`. Add your domain, then create the DNS records Clerk lists
   (CNAMEs for `clerk.<domain>`, `accounts.<domain>`, plus email records).
3. Copy the production keys: `pk_live_…` and `sk_live_…`.

If you don't have a domain yet, you can temporarily ship with the dev
(`pk_test`/`sk_test`) keys — auth works on `*.vercel.app` but with dev-mode
limits and a "development" badge.

## 4. Vercel project + env vars

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new). Vercel
   auto-detects React Router v7 (build `npm run build`, no config needed).
2. Before the first deploy, add these under **Settings → Environment
   Variables** (Production environment):

| Variable | Value | Used |
|---|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_live_…` | build time (inlined into client bundle) |
| `CLERK_SECRET_KEY` | `sk_live_…` | server runtime |
| `TURSO_DATABASE_URL` | `libsql://scribattle-prod-….turso.io` | server runtime |
| `TURSO_AUTH_TOKEN` | token from step 1 | server runtime |
| `VITE_SPACETIMEDB_URI` | `https://maincloud.spacetimedb.com` | build time |
| `VITE_SPACETIMEDB_NAME` | `scribattle` (or `scribattle-prod`) | build time |

**Gotcha:** the `VITE_*` variables are baked into the client bundle at build
time. Changing one in Vercel does nothing until you trigger a **redeploy** —
and "Redeploy" must rebuild (don't reuse the build cache from before the
change).

## 5. Verify

- `/` loads and shows open public rooms (SpacetimeDB reachable — check the
  browser console for websocket errors if not).
- Sign-up flow works end to end (Clerk production DNS can take a few minutes
  to propagate).
- Two browsers can create/join a room and play a turn (strokes stream both ways).

## Ongoing deploys

- App code: push to `main` → Vercel auto-deploys.
- `server/src/` (SpacetimeDB module): `npm run stdb:publish:cloud` manually.
- `database/schema.ts`: `db:push` against prod manually (step 1).
