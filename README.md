# Scribattle.io

A real-time multiplayer drawing & guessing game (skribbl.io style): one player
draws a secret word, everyone else races to guess it. See `USER_STORIES.md`
for the full product spec.

**Status: application shell.** Routes, theme, and infrastructure are wired;
gameplay stories wait on the user-journey mapping.

## Stack

- **React Router 8** (framework mode, SSR) + **Tailwind CSS 4**
- **React Three Fiber** — the drawing surface is a WebGL canvas (3D painting)
- **SpacetimeDB** — realtime game state (rooms, strokes, guesses); module in `server/`
- **Turso + Drizzle** — persistent data (accounts, stats); schema in `database/`
- **Clerk** — authentication (wired, activates when keys land in `.env`)
- **zustand** — client game state, mirrored from SpacetimeDB tables

Architecture follows `realtime-example-battleroll/` — read that project's
`app/spacetime/connection.ts` before wiring multiplayer.

## Run it

```sh
git clone git@github.com:ajgames/scriblio.git
cd scriblio
npm install
cp .env.example .env   # fill in Clerk + Turso keys (optional for the shell)
npm run dev
```

Open http://localhost:5173.

## Commands

| command | what it does |
| --- | --- |
| `npm run dev` | vite dev server |
| `npm run typecheck` | react-router typegen + tsc |
| `npm run typecheck:server` | typecheck the SpacetimeDB module |
| `npm run stdb:publish` | publish `server/` as database `scribattle` |
| `npm run stdb:generate` | generate typed client bindings |
| `npm run db:push` | push Drizzle schema to Turso |
| `npm run db:studio` | browse the Turso database |

## Project layout

```
app/
  routes/home.tsx        landing (username, create game, join by code)
  routes/lobby.tsx       waiting room shell (room code, player list)
  routes/game.tsx        game shell (scoreboard · R3F canvas · guess chat)
  game/store.ts          zustand game state
  game/three/            R3F drawing surface
  spacetime/             SpacetimeDB client integration (see its README)
  lib/db.server.ts       Turso/Drizzle client (server-only)
database/schema.ts       persistent schema (Clerk-linked users, stats later)
server/src/index.ts      SpacetimeDB module (game + player tables, reducers)
old-client/ old-server/  previous prototype (local only, not committed)
realtime-example-battleroll/  architecture reference (local only, not committed)
```

## Brand

Cream (`#f7f5f1`) + stone palette; Instrument Serif for the wordmark
(upright "Scri", italic "battle"), Schibsted Grotesk for UI, IBM Plex Mono
for room codes. `public/favicon.svg` is the wordmark's Instrument Serif "S"
traced to a path on a dark rounded square.
