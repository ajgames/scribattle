import {
  useGameStore,
  type DrawingInfo,
  type GuessInfo,
  type LiveStrokeInfo,
  type OpenGameInfo,
  type PlayerInfo,
  type RoomInfo,
  type StrokeInfo,
  type VoteCategory,
  type VoteInfo,
} from '../game/store';
import { DbConnection } from './module_bindings';

/**
 * The one SpacetimeDB connection for the app (Maincloud by default).
 *
 * Identity: anonymous-first. The token from the first connect is kept in
 * localStorage, so the same identity is shared across tabs and survives
 * refreshes — the server keeps the player row on disconnect (only flips
 * `online`), which is what makes refresh-and-rejoin seamless.
 *
 * Data flow: subscribe to all public tables, mirror rows into the zustand
 * store with a microtask-batched sync so row floods don't cause render
 * floods. Components never touch the connection — they read the store and
 * call the action functions exported here.
 */

const URI = import.meta.env.VITE_SPACETIMEDB_URI || 'http://localhost:3000';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_NAME || 'scribattle';
const TOKEN_KEY = 'scribattle:spacetimedb-token';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SERVER_STATE_TIMEOUT_MS = 10_000;

let conn: DbConnection | null = null;
let connectPromise: Promise<DbConnection> | null = null;
let myIdentityHex = '';
let reconnectDelay = RECONNECT_BASE_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function loadToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // storage unavailable (private mode) — identity is per-page-load then
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Connect (idempotent). Resolves once the initial subscription is applied,
 * i.e. the client cache is authoritative — callers can trust the store right
 * after awaiting this. A stale/revoked token (e.g. the database was reset)
 * gets one automatic anonymous retry.
 */
export function connect(): Promise<DbConnection> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SpacetimeDB connection is client-only'));
  }
  if (connectPromise) return connectPromise;

  const hadToken = !!loadToken();
  connectPromise = doConnect(loadToken())
    .catch(err => {
      if (!hadToken) throw err;
      clearToken();
      return doConnect(undefined);
    })
    .catch(err => {
      connectPromise = null;
      useGameStore.getState().connectionChanged('disconnected');
      throw err;
    });
  return connectPromise;
}

function doConnect(token: string | undefined): Promise<DbConnection> {
  useGameStore.getState().connectionChanged('connecting');
  return new Promise((resolve, reject) => {
    let settled = false;

    DbConnection.builder()
      .withUri(URI)
      .withDatabaseName(DB_NAME)
      .withToken(token)
      .onConnect((connection, identity, freshToken) => {
        saveToken(freshToken);
        myIdentityHex = identity.toHexString();
        reconnectDelay = RECONNECT_BASE_MS;
        useGameStore.getState().connectionChanged('connected', myIdentityHex);

        registerRowCallbacks(connection);
        connection
          .subscriptionBuilder()
          .onApplied(() => {
            conn = connection;
            scheduleSync();
            if (!settled) {
              settled = true;
              resolve(connection);
            }
          })
          .onError(() => {
            if (!settled) {
              settled = true;
              reject(new Error('SpacetimeDB subscription failed'));
            }
          })
          .subscribe([
            'SELECT * FROM game',
            'SELECT * FROM player',
            'SELECT * FROM stroke',
            'SELECT * FROM live_stroke',
            'SELECT * FROM drawing',
            'SELECT * FROM vote',
            'SELECT * FROM guess',
            'SELECT * FROM word_choice',
            'SELECT * FROM spectator',
          ]);
      })
      .onConnectError((_ctx, err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      })
      .onDisconnect(() => {
        conn = null;
        connectPromise = null;
        useGameStore.getState().connectionChanged('disconnected');
        scheduleReconnect();
      })
      .build();
  });
}

/** Reconnect with capped exponential backoff after an unexpected drop. */
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {
      // doConnect's onDisconnect/onConnectError path schedules the next try
      scheduleReconnect();
    });
  }, delay);
}

// ---------------------------------------------------------------------------
// Row mirroring: SpacetimeDB client cache → zustand store
// ---------------------------------------------------------------------------

function registerRowCallbacks(connection: DbConnection) {
  for (const tbl of [
    connection.db.game,
    connection.db.player,
    connection.db.stroke,
    connection.db.liveStroke,
    connection.db.drawing,
    connection.db.vote,
    connection.db.guess,
    connection.db.wordChoice,
    connection.db.spectator,
  ] as const) {
    tbl.onInsert(scheduleSync);
    tbl.onDelete(scheduleSync);
  }
  connection.db.game.onUpdate(scheduleSync);
  connection.db.player.onUpdate(scheduleSync);
  connection.db.liveStroke.onUpdate(scheduleSync);
  connection.db.wordChoice.onUpdate(scheduleSync);
}

let syncScheduled = false;

/** Batch bursts of row events into one store update per microtask. */
function scheduleSync() {
  if (syncScheduled) return;
  syncScheduled = true;
  queueMicrotask(() => {
    syncScheduled = false;
    sync();
  });
}

function sync() {
  if (!conn) return;
  const store = useGameStore.getState();

  const allPlayers = [...conn.db.player.iter()];
  const allGames = [...conn.db.game.iter()];
  const allSpectators = [...conn.db.spectator.iter()];

  // public rooms browsable from the main menu, newest first. Rooms where
  // everyone is offline are hidden immediately — the server reaps them a few
  // minutes later (see expireStaleGames in the module)
  const openGames: OpenGameInfo[] = allGames
    .filter(
      g =>
        g.isPublic &&
        g.status !== 'finished' &&
        allPlayers.some(p => p.gameCode === g.code && p.online)
    )
    .sort((a, b) => Number(b.createdAt.microsSinceUnixEpoch - a.createdAt.microsSinceUnixEpoch))
    .map(g => ({
      code: g.code,
      status: g.status,
      playerCount: g.playerCount,
      maxPlayers: g.maxPlayers,
      hostName:
        allPlayers.find(p => p.gameCode === g.code && p.isHost)?.username ?? 'unknown',
      spectatorCount: allSpectators.filter(s => s.gameCode === g.code).length,
    }));

  // the focused room comes from my player row, or failing that my spectator
  // row (watch mode) — both survive refreshes server-side
  const myRow = allPlayers.find(p => p.identity.toHexString() === myIdentityHex) ?? null;
  const mySpectatorRow = myRow
    ? null
    : (allSpectators.find(s => s.identity.toHexString() === myIdentityHex) ?? null);
  if (!myRow && !mySpectatorRow) {
    store.serverSync({
      room: null,
      players: [],
      strokes: [],
      liveStroke: null,
      drawings: [],
      votes: [],
      guesses: [],
      openGames,
      isWatching: false,
      spectatorCount: 0,
    });
    return;
  }

  const code = myRow ? myRow.gameCode : mySpectatorRow!.gameCode;
  const gameRow = allGames.find(g => g.code === code);
  const room: RoomInfo | null = gameRow
    ? {
        code: gameRow.code,
        status: gameRow.status,
        playerCount: gameRow.playerCount,
        maxPlayers: gameRow.maxPlayers,
        rounds: gameRow.rounds,
        turnSeconds: gameRow.turnSeconds,
        artist: gameRow.artist.toHexString(),
        currentWord: gameRow.currentWord,
        wordChoices: conn.db.wordChoice.gameCode.find(code)?.choices ?? [],
        turn: gameRow.turn,
        round: gameRow.round,
        turnStartedAtMs: Number(gameRow.turnStartedAt.microsSinceUnixEpoch / 1000n),
      }
    : null;

  const artistHex = room?.status === 'playing' ? room.artist : '';
  const players: PlayerInfo[] = allPlayers
    .filter(p => p.gameCode === code)
    .sort((a, b) => Number(a.joinedAt.microsSinceUnixEpoch - b.joinedAt.microsSinceUnixEpoch))
    .map(p => ({
      id: p.identity.toHexString(),
      username: p.username,
      score: p.score,
      isHost: p.isHost,
      isArtist: p.identity.toHexString() === artistHex,
      online: p.online,
    }));

  const strokes: StrokeInfo[] = [...conn.db.stroke.iter()]
    .filter(s => s.gameCode === code)
    .sort((a, b) => Number(a.id - b.id))
    .map(s => ({
      id: s.id.toString(),
      turn: s.turn,
      points: Array.from(s.points),
      color: s.color,
      width: s.width,
      widths: Array.from(s.widths),
      threeD: s.threeD,
    }));

  const liveRow = [...conn.db.liveStroke.iter()].find(l => l.gameCode === code);
  const liveStroke: LiveStrokeInfo | null = liveRow
    ? {
        points: Array.from(liveRow.points),
        color: liveRow.color,
        width: liveRow.width,
        widths: Array.from(liveRow.widths),
        threeD: liveRow.threeD,
      }
    : null;

  const drawings: DrawingInfo[] = [...conn.db.drawing.iter()]
    .filter(d => d.gameCode === code)
    .sort((a, b) => a.turn - b.turn)
    .map(d => ({
      turn: d.turn,
      artistId: d.artist.toHexString(),
      artistName: d.artistName,
      word: d.word,
    }));

  const votes: VoteInfo[] = [...conn.db.vote.iter()]
    .filter(v => v.gameCode === code)
    .map(v => ({
      voterId: v.voter.toHexString(),
      turn: v.turn,
      category: v.category,
    }));

  const guesses: GuessInfo[] = [...conn.db.guess.iter()]
    .filter(g => g.gameCode === code)
    .sort((a, b) => Number(a.id - b.id))
    .map(g => ({
      id: g.id.toString(),
      playerId: g.player.toHexString(),
      username: g.username,
      text: g.text,
      correct: g.correct,
      turn: g.turn,
    }));

  store.serverSync({
    room,
    players,
    strokes,
    liveStroke,
    drawings,
    votes,
    guesses,
    openGames,
    isWatching: !myRow,
    spectatorCount: allSpectators.filter(s => s.gameCode === code).length,
  });
}

/** Resolve when the mirrored store satisfies `pred` (row updates arrive async of the reducer ack). */
function waitForStore(
  pred: (s: ReturnType<typeof useGameStore.getState>) => boolean,
  timeoutMs = SERVER_STATE_TIMEOUT_MS
): Promise<void> {
  if (pred(useGameStore.getState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Timed out waiting for the game server'));
    }, timeoutMs);
    const unsub = useGameStore.subscribe(s => {
      if (pred(s)) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Actions — the only way components talk to the server
// ---------------------------------------------------------------------------

/** Create a room (code is generated server-side) and return its code. */
export async function createGame(username: string, isPublic = false): Promise<string> {
  const c = await connect();
  const prev = useGameStore.getState().roomCode;
  await c.reducers.createGame({ username, isPublic });
  await waitForStore(s => !!s.roomCode && s.roomCode !== prev);
  return useGameStore.getState().roomCode;
}

/** Join an existing room by code. Rejects with the server's message (bad code, full, started). */
export async function joinGame(username: string, code: string): Promise<string> {
  const c = await connect();
  const target = code.toUpperCase();
  await c.reducers.joinGame({ username, code: target });
  await waitForStore(s => s.roomCode === target);
  return target;
}

export async function leaveGame(): Promise<void> {
  const c = await connect();
  await c.reducers.leaveGame({});
}

/** Host only — flips the room to 'playing'; every client's store follows. */
export async function startGame(): Promise<void> {
  const c = await connect();
  await c.reducers.startGame({});
  await waitForStore(s => s.room?.status === 'playing');
}

/** Artist only — publish one finished stroke (normalized 0..1 point pairs). */
export async function sendStroke(
  points: number[],
  color: string,
  width: number,
  widths: number[],
  threeD: boolean
): Promise<void> {
  const c = await connect();
  await c.reducers.addStroke({ points, color, width, widths, threeD });
}

/**
 * Artist only — stream the in-progress stroke so everyone watches it grow.
 * Fire-and-forget (throttled by the caller); empty points drops the preview.
 * The committed add_stroke also clears it server-side.
 */
export function sendLiveStroke(
  points: number[],
  color: string,
  width: number,
  widths: number[],
  threeD: boolean
): void {
  conn?.reducers.updateLiveStroke({ points, color, width, widths, threeD }).catch(() => {
    // preview-only traffic — a rejected frame (turn just rotated) is harmless
  });
}

/**
 * Any client whose countdown hit zero — the server checks its own clock, so
 * early calls are quiet no-ops and racing clients only rotate the turn once.
 */
export function endTurn(): void {
  conn?.reducers.endTurn({}).catch(() => {});
}

/** Artist locks in one of their word options. */
export async function chooseWord(index: number): Promise<void> {
  const c = await connect();
  await c.reducers.chooseWord({ index });
}

/** Choice window ran out — poke the server to pick for the artist (endTurn-style no-op if early). */
export function autoPickWord(): void {
  conn?.reducers.autoPickWord({}).catch(() => {});
}

/** Slideshow ballot — one pick per category; same pick again retracts it. */
export async function castVote(turn: number, category: VoteCategory): Promise<void> {
  const c = await connect();
  await c.reducers.castVote({ turn, category });
}

/** Host only — reset a finished room back to the lobby for a rematch. */
export async function playAgain(): Promise<void> {
  const c = await connect();
  await c.reducers.playAgain({});
  await waitForStore(s => s.room?.status === 'waiting');
}

/** Artist only — wipe the canvas for everyone. */
export async function clearCanvas(): Promise<void> {
  const c = await connect();
  await c.reducers.clearCanvas({});
}

/** Guesser only — the server scores it and feeds the guess list. */
export async function submitGuess(text: string): Promise<void> {
  const c = await connect();
  await c.reducers.submitGuess({ text });
}

/**
 * Make sure we're a member of `code` — the lobby/game mount path. After a
 * refresh the persisted identity usually still owns its player row, so this
 * is a no-op; otherwise it joins (idempotently, server-side).
 */
export async function ensureInGame(code: string, username: string): Promise<void> {
  await connect();
  const target = code.toUpperCase();
  const s = useGameStore.getState();
  if (s.roomCode === target && !s.isWatching) return;
  await joinGame(username, target);
}

/** Watch a room without playing — no username, no player row. */
export async function watchGame(code: string): Promise<void> {
  const c = await connect();
  await c.reducers.watchGame({ code: code.toUpperCase() });
}

/** Stop watching (fire-and-forget — leaving the page is the common exit). */
export function leaveWatch(): void {
  conn?.reducers.leaveWatch({}).catch(() => {});
}

/**
 * Watch-mode mirror of ensureInGame: after a refresh the identity's
 * spectator row usually survives, so this is a no-op; otherwise watch.
 * A player of `code` opening the watch URL stays a player.
 */
export async function ensureWatching(code: string): Promise<void> {
  await connect();
  const target = code.toUpperCase();
  if (useGameStore.getState().roomCode === target) return;
  await watchGame(target);
}
