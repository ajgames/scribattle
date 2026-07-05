# SpacetimeDB integration

The realtime layer for Scribattle: rooms, players, and — once the user
journey is mapped — turns, strokes, guesses, and scoring all flow through
SpacetimeDB. Persistent cross-game data (accounts, stats) lives in Turso.

**Current status: groundwork.** The module in `server/src/index.ts` defines
`game` + `player` tables and `create_game` / `join_game` / `leave_game`
reducers, but the client is not connected yet — the UI shell runs standalone.

## Wiring it up

```sh
spacetime start          # local SpacetimeDB on :3000
npm run stdb:publish     # publish server/src/index.ts as database `scribattle`
npm run stdb:generate    # generate typed client bindings into module_bindings/
```

Then create `connection.ts` here following the pattern in
`realtime-example-battleroll/app/spacetime/connection.ts`:

- one module-level `DbConnection`, token in `sessionStorage` (per-tab identity)
- subscribe to all tables; mirror rows into the zustand store (`app/game/store.ts`)
  with a microtask-batched sync so row floods don't cause render floods
- export plain action functions (`createGame`, `joinGame`, `leaveGame`) that
  call reducers — components never touch the connection directly

The client connects to `ws://localhost:3000` by default; override with
`VITE_SPACETIMEDB_URI` in `.env`.

## After changing server/src/index.ts

```sh
npm run stdb:publish
npm run stdb:generate
```
