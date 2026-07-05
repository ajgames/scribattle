/**
 * SpacetimeDB module for Scribattle — realtime game state.
 *
 * Groundwork only: rooms and their players (create / join / leave). The
 * full loop (turns, word selection, strokes, guesses, scoring) gets its
 * tables and reducers once the user journey is mapped out. Persistent,
 * cross-game data (accounts, stats, history) lives in Turso via Drizzle,
 * not here.
 *
 * Publish with:   npm run stdb:publish
 * Generate client bindings with:   npm run stdb:generate
 */
import { SenderError, schema, table, t } from 'spacetimedb/server';

// keep in sync with app/game/constants.ts
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const MAX_USERNAME_LENGTH = 16;

const game = table(
  { name: 'game', public: true },
  {
    code: t.string().primaryKey(),
    status: t.string(), // 'waiting' | 'playing' | 'finished'
    isPublic: t.bool(),
    playerCount: t.u32(),
    maxPlayers: t.u32(),
    rounds: t.u32(),
    turnSeconds: t.u32(),
    createdAt: t.timestamp(),
  }
);

const player = table(
  { name: 'player', public: true },
  {
    identity: t.identity().primaryKey(),
    username: t.string(),
    gameCode: t.string().index('btree'),
    isHost: t.bool(),
    score: t.u32(),
    online: t.bool(),
    joinedAt: t.timestamp(),
  }
);

const spacetimedb = schema({ game, player });

function randomCode(ctx: { random(): number }): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(ctx.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function cleanUsername(raw: string): string {
  const name = raw.trim().slice(0, MAX_USERNAME_LENGTH);
  if (name.length < 2) throw new SenderError('Username must be at least 2 characters');
  return name;
}

export const createGame = spacetimedb.reducer(
  { username: t.string(), isPublic: t.bool() },
  (ctx, { username, isPublic }) => {
    const name = cleanUsername(username);

    let code = randomCode(ctx);
    while (ctx.db.game.code.find(code)) code = randomCode(ctx);

    ctx.db.game.insert({
      code,
      status: 'waiting',
      isPublic,
      playerCount: 1,
      maxPlayers: MAX_PLAYERS,
      rounds: 3,
      turnSeconds: 90,
      createdAt: ctx.timestamp,
    });

    if (ctx.db.player.identity.find(ctx.sender)) ctx.db.player.identity.delete(ctx.sender);
    ctx.db.player.insert({
      identity: ctx.sender,
      username: name,
      gameCode: code,
      isHost: true,
      score: 0,
      online: true,
      joinedAt: ctx.timestamp,
    });
  }
);

export const joinGame = spacetimedb.reducer(
  { username: t.string(), code: t.string() },
  (ctx, { username, code }) => {
    const name = cleanUsername(username);

    const room = ctx.db.game.code.find(code.toUpperCase());
    if (!room) throw new SenderError('Game not found — check the code');
    if (room.status !== 'waiting') throw new SenderError('That game already started');
    if (room.playerCount >= room.maxPlayers) throw new SenderError('That game is full');

    if (ctx.db.player.identity.find(ctx.sender)) ctx.db.player.identity.delete(ctx.sender);
    ctx.db.player.insert({
      identity: ctx.sender,
      username: name,
      gameCode: room.code,
      isHost: false,
      score: 0,
      online: true,
      joinedAt: ctx.timestamp,
    });
    ctx.db.game.code.update({ ...room, playerCount: room.playerCount + 1 });
  }
);

export const leaveGame = spacetimedb.reducer(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) return;
  ctx.db.player.identity.delete(ctx.sender);

  const room = ctx.db.game.code.find(me.gameCode);
  if (!room) return;
  const remaining = room.playerCount - 1;
  if (remaining <= 0) {
    ctx.db.game.code.delete(room.code);
  } else {
    ctx.db.game.code.update({ ...room, playerCount: remaining });
  }
});

export default spacetimedb;
