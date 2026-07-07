/**
 * SpacetimeDB module for Scribattle — realtime game state.
 *
 * Rooms and their players (create / join / leave), plus the core loop:
 * the host starts the game, one player is the artist and paints strokes,
 * everyone else submits guesses; a correct guess scores and once every
 * guesser has it — or the turn clock runs out — the turn rotates to the
 * next artist with a fresh word. A round is one full trip through the
 * roster; after `rounds` rounds the game finishes and clients show the
 * scoreboard + a slideshow of every drawing that players vote on.
 * Persistent, cross-game data (accounts, stats, history) lives in Turso
 * via Drizzle, not here.
 *
 * Publish with:   npm run stdb:publish
 * Generate client bindings with:   npm run stdb:generate
 */
import { SenderError, schema, table, t, type ReducerCtx } from 'spacetimedb/server';
import { containsProfanity } from './profanity';

// keep in sync with app/game/constants.ts
const ROOM_CODE_LENGTH = 4;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_PLAYERS = 8;
const MAX_USERNAME_LENGTH = 16;
const MAX_GUESS_LENGTH = 64;
// a stroke is a flat [x0, y0, x1, y1, …] polyline in normalized 0..1 paper
// coords — cap it so a hostile client can't grow rows without bound
const MAX_STROKE_FLOATS = 4096;
const MAX_STROKES_PER_TURN = 600;

// a correct guess is worth less the later in the turn it lands: linear decay
// from MAX (instant guess) to MIN (buzzer-beater)
const MAX_GUESSER_POINTS = 100;
const MIN_GUESSER_POINTS = 20;
const ARTIST_POINTS = 25;

/** Hard ceiling on the turn clock — rooms can be faster, never slower. */
const MAX_TURN_SECONDS = 45;
const DEFAULT_ROUNDS = 3;
// clients fire end_turn when their countdown hits zero; absorb clock jitter
const END_TURN_GRACE_MICROS = 500_000n;

// each turn opens with the artist picking one of N words; if they dawdle
// past the window, any client pokes auto_pick_word (same trust model as
// end_turn). Keep in sync with app/game/constants.ts.
const WORD_CHOICE_COUNT = 3;
const WORD_CHOICE_SECONDS = 10;

// a room where every player has been offline this long is dead — reaped by
// the sweep in connect/create/join (there's no scheduled reaper yet)
const STALE_GAME_MICROS = 5n * 60n * 1_000_000n;

const VOTE_CATEGORIES = ['funny', 'artistic', 'horrible'] as const;

// curated drawable-noun pack — flat difficulty for now (tiers later)
const WORDS = [
  'acorn', 'airplane', 'alarm clock', 'alligator', 'ambulance', 'anchor',
  'angel', 'ant', 'apple', 'aquarium', 'arrow', 'astronaut', 'avocado',
  'backpack', 'bagel', 'balloon', 'banana', 'barn', 'baseball', 'basketball',
  'bat', 'bathtub', 'beach', 'bear', 'beaver', 'bee', 'beehive', 'bell',
  'belt', 'bench', 'bicycle', 'binoculars', 'birdhouse', 'birthday cake',
  'blanket', 'boat', 'bone', 'book', 'bookshelf', 'boomerang', 'boot',
  'bowtie', 'bracelet', 'brain', 'bridge', 'broccoli', 'broom', 'bubble',
  'bulldozer', 'bus', 'butterfly', 'cabin', 'cactus', 'cake', 'calculator',
  'calendar', 'camel', 'camera', 'campfire', 'candle', 'canoe', 'cape',
  'car', 'carousel', 'carrot', 'castle', 'cat', 'caterpillar', 'cave',
  'cello', 'chair', 'chandelier', 'cheese', 'cheetah', 'cherry', 'chicken',
  'chimney', 'chocolate', 'church', 'clock', 'cloud', 'coconut', 'comb',
  'comet', 'compass', 'computer', 'cookie', 'coral', 'corn', 'couch', 'cow',
  'cowboy', 'crab', 'crayon', 'crocodile', 'crown', 'cruise ship', 'cupcake',
  'curtain', 'deer', 'desert', 'desk', 'diamond', 'dice', 'dinosaur', 'dog',
  'dolphin', 'donut', 'door', 'dragon', 'dragonfly', 'dresser', 'drill',
  'drum', 'duck', 'eagle', 'ear', 'earth', 'easel', 'eel', 'egg', 'elephant',
  'elf', 'envelope', 'eraser', 'eye', 'falcon', 'fan', 'farm', 'feather',
  'fence', 'fern', 'ferris wheel', 'fire', 'fireplace', 'firetruck',
  'fireworks', 'fish', 'fishing rod', 'flag', 'flamingo', 'flashlight',
  'flip flops', 'flower', 'football', 'forest', 'fork', 'fountain', 'fox',
  'frog', 'frying pan', 'galaxy', 'garden', 'gate', 'ghost', 'gift',
  'gingerbread man', 'giraffe', 'glacier', 'glasses', 'globe', 'glove',
  'goat', 'goggles', 'goldfish', 'gorilla', 'grapes', 'grasshopper',
  'greenhouse', 'guitar', 'hamburger', 'hammer', 'hammock', 'hamster',
  'harp', 'hat', 'haystack', 'headphones', 'hedgehog', 'helicopter',
  'helmet', 'hippo', 'honey', 'horse', 'hot air balloon', 'hot dog',
  'hourglass', 'house', 'ice cream', 'ice skate', 'iceberg', 'igloo',
  'iguana', 'island', 'jacket', 'jar', 'jellyfish',
  'jet ski', 'juggler', 'jungle', 'kangaroo', 'kayak', 'kettle', 'key',
  'keyboard', 'kite', 'kitten', 'knight', 'koala', 'ladder', 'ladybug',
  'lamp', 'lantern', 'laptop', 'lasso', 'lawnmower', 'leaf', 'lemon',
  'leopard', 'lighthouse', 'lightning', 'lion', 'lizard', 'llama', 'lobster',
  'lock', 'lollipop', 'magician', 'magnet', 'magnifying glass', 'mailbox',
  'mango', 'map', 'maze', 'mermaid', 'meteor', 'microphone', 'microscope',
  'milkshake', 'mitten', 'monkey', 'moon', 'moose', 'mosquito', 'moth',
  'motorcycle', 'mountain', 'mouse', 'mummy', 'mushroom', 'mustache',
  'narwhal',
  'necklace', 'nest', 'net', 'newspaper', 'ninja', 'noodles', 'nose',
  'ocean', 'octopus', 'orange', 'ostrich', 'otter', 'oven', 'owl',
  'paintbrush', 'palette', 'palm tree', 'pancake', 'panda', 'paper airplane',
  'parachute', 'parrot', 'peacock', 'peanut', 'pear', 'pelican', 'pencil',
  'penguin', 'piano', 'pig', 'pigeon', 'pillow', 'pineapple', 'pinwheel',
  'pirate', 'pizza', 'planet', 'playground', 'pogo stick', 'polar bear',
  'popcorn', 'popsicle', 'porcupine', 'postcard', 'potato', 'pretzel',
  'princess', 'pumpkin', 'puppet', 'puzzle', 'pyramid', 'quilt', 'rabbit',
  'raccoon', 'radio', 'raft', 'rainbow', 'rake', 'refrigerator', 'reindeer',
  'rhinoceros', 'ring', 'river', 'robot', 'rocket', 'roller coaster',
  'rooster', 'rope', 'rose', 'rowboat', 'rug', 'ruler', 'sailboat', 'salad',
  'sandcastle', 'sandwich', 'satellite', 'saxophone', 'scarecrow', 'scarf',
  'school bus', 'scissors', 'scooter', 'scorpion', 'seagull', 'seahorse',
  'seal', 'seashell', 'seesaw', 'shark', 'sheep', 'shield', 'ship', 'shoe',
  'shovel', 'shower', 'skateboard', 'skeleton', 'ski', 'skunk', 'skyscraper',
  'sled', 'sloth', 'snail', 'snake', 'snorkel', 'snowflake', 'snowman',
  'soccer ball', 'sock', 'spaceship', 'spaghetti', 'spider', 'spoon',
  'squid', 'squirrel', 'stapler', 'starfish', 'statue', 'stethoscope',
  'stingray', 'stop sign', 'strawberry', 'submarine', 'suitcase', 'sun',
  'sunflower', 'surfboard', 'sushi', 'swan', 'sweater', 'swing', 'sword',
  'taco', 'tambourine', 'teapot', 'teddy bear', 'telescope', 'tent', 'tiger',
  'toaster', 'toothbrush', 'toothpaste', 'top hat', 'torch', 'tornado',
  'toucan', 'tower', 'tractor', 'traffic light', 'train', 'trampoline',
  'treasure', 'treehouse', 'tricycle', 'trombone', 'trophy', 'trumpet',
  'tugboat', 'turtle', 'typewriter', 'ufo', 'umbrella', 'unicorn', 'vacuum',
  'vampire', 'vase', 'violin', 'volcano', 'vulture', 'waffle', 'wagon',
  'walrus', 'wand', 'washing machine', 'watch', 'waterfall', 'watermelon',
  'well', 'werewolf', 'whale', 'wheel', 'wheelbarrow', 'windmill', 'window',
  'witch', 'wizard', 'wolf', 'worm', 'wreath', 'wrench', 'xylophone',
  'yacht', 'yarn', 'zebra', 'zipper', 'zoo',
] as const;

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
    /** Who's drawing. Set to the creator while waiting; meaningful once playing. */
    artist: t.identity(),
    /**
     * The word being drawn ('' while waiting). NOTE: the table is public, so
     * a determined guesser can read this from the client cache — good enough
     * for now; hide it behind row-level security or a private table later.
     */
    currentWord: t.string(),
    /** Monotonic turn counter; guesses/strokes are scoped to their turn. */
    turn: t.u32(),
    /** 1-based round (one round = everyone drew once). 0 while waiting. */
    round: t.u32(),
    /** When the current turn's clock started — clients render the countdown. */
    turnStartedAt: t.timestamp(),
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

const stroke = table(
  { name: 'stroke', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameCode: t.string().index('btree'),
    /** Which turn painted this — strokes stay all game for the slideshow. */
    turn: t.u32(),
    /** Flat [x0, y0, x1, y1, …] polyline, normalized 0..1 across the paper. */
    points: t.array(t.f32()),
    color: t.string(),
    width: t.f32(),
    /** Raised 3D tube (artist toggle) vs the default flat ink. */
    threeD: t.bool(),
  }
);

/**
 * The artist's in-progress stroke, one row per game, replaced as the pointer
 * moves so everyone watches the line grow. Committing the stroke (add_stroke)
 * or rotating the turn deletes it.
 */
const liveStroke = table(
  { name: 'live_stroke', public: true },
  {
    gameCode: t.string().primaryKey(),
    points: t.array(t.f32()),
    color: t.string(),
    width: t.f32(),
    threeD: t.bool(),
  }
);

/** One row per turn — who drew what word. Drives the end-of-game slideshow. */
const drawing = table(
  { name: 'drawing', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameCode: t.string().index('btree'),
    turn: t.u32(),
    artist: t.identity(),
    artistName: t.string(),
    word: t.string(),
  }
);

/**
 * Slideshow ballots: each voter gets one pick per category ('funny' |
 * 'artistic' | 'horrible'); re-voting moves it, voting the same drawing
 * again retracts it.
 */
const vote = table(
  { name: 'vote', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameCode: t.string().index('btree'),
    voter: t.identity(),
    /** The voted drawing's turn number. */
    turn: t.u32(),
    category: t.string(),
  }
);

const guess = table(
  { name: 'guess', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    gameCode: t.string().index('btree'),
    player: t.identity(),
    username: t.string(),
    /** '' when correct — the word itself is never echoed into the feed. */
    text: t.string(),
    correct: t.bool(),
    turn: t.u32(),
    createdAt: t.timestamp(),
  }
);

/**
 * The artist's word options — one row per room, present only while the
 * pick-a-word window is open (currentWord '' and turnStartedAt timing the
 * window). Lives in its own table (not a game column) so adding it was a
 * non-breaking migration; same public-readability caveat as currentWord.
 */
const wordChoice = table(
  { name: 'word_choice', public: true },
  {
    gameCode: t.string().primaryKey(),
    choices: t.array(t.string()),
  }
);

/**
 * Server-internal heartbeat, one row per room: bumped by every meaningful
 * reducer (join, turn events, guesses, votes, presence flips). The stale-game
 * sweep compares against it, so rooms whose players all vanished get reaped
 * instead of haunting the public list forever. Public only because the client
 * SDK crashes on codegen'd types for private tables (dangling type ref in
 * schema()); no client subscribes to it, and it's just a code + timestamp.
 */
const activity = table(
  { name: 'activity', public: true },
  {
    gameCode: t.string().primaryKey(),
    lastActiveAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  game,
  player,
  stroke,
  liveStroke,
  drawing,
  vote,
  guess,
  wordChoice,
  activity,
});

function randomCode(ctx: { random(): number }): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(ctx.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

function randomWordChoices(ctx: { random(): number }, count: number): string[] {
  const picks = new Set<number>();
  while (picks.size < count) picks.add(Math.floor(ctx.random() * WORDS.length));
  return [...picks].map(i => WORDS[i]);
}

function cleanUsername(raw: string): string {
  const name = raw.trim().slice(0, MAX_USERNAME_LENGTH);
  if (name.length < 2) throw new SenderError('Username must be at least 2 characters');
  if (containsProfanity(name)) throw new SenderError('Pick a cleaner username');
  return name;
}

function normalizeGuess(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

type Ctx = ReducerCtx<typeof spacetimedb.schemaType>;
type GameRow = NonNullable<ReturnType<Ctx['db']['game']['code']['find']>>;
type PlayerRow = NonNullable<ReturnType<Ctx['db']['player']['identity']['find']>>;

function playersIn(ctx: Ctx, code: string) {
  return [...ctx.db.player.gameCode.filter(code)].sort((a, b) =>
    Number(a.joinedAt.microsSinceUnixEpoch - b.joinedAt.microsSinceUnixEpoch)
  );
}

/** Wipe every per-game row (game over cleanup, room deleted, or rematch). */
function deleteGameArtifacts(ctx: Ctx, code: string) {
  ctx.db.stroke.gameCode.delete(code);
  ctx.db.guess.gameCode.delete(code);
  ctx.db.drawing.gameCode.delete(code);
  ctx.db.vote.gameCode.delete(code);
  ctx.db.liveStroke.gameCode.delete(code);
  ctx.db.wordChoice.gameCode.delete(code);
}

/** Bump the room's heartbeat — see the `activity` table. */
function touchActivity(ctx: Ctx, code: string) {
  const row = { gameCode: code, lastActiveAt: ctx.timestamp };
  if (ctx.db.activity.gameCode.find(code)) {
    ctx.db.activity.gameCode.update(row);
  } else {
    ctx.db.activity.insert(row);
  }
}

/**
 * Reap rooms whose players are all offline and whose heartbeat went quiet.
 * Runs opportunistically on connect/create/join — cheap at this scale, and it
 * always fires right before someone looks at the public games list. Rooms
 * with anyone online are never touched, no matter how idle (a host camping
 * an open lobby is legitimate).
 */
function expireStaleGames(ctx: Ctx) {
  for (const room of ctx.db.game.iter()) {
    const players = playersIn(ctx, room.code);
    if (players.some(p => p.online)) continue;
    // pre-activity rooms fall back to createdAt (their heartbeat never wrote)
    const lastActive =
      ctx.db.activity.gameCode.find(room.code)?.lastActiveAt ?? room.createdAt;
    if (ctx.timestamp.since(lastActive).micros < STALE_GAME_MICROS) continue;

    for (const p of players) ctx.db.player.identity.delete(p.identity);
    ctx.db.game.code.delete(room.code);
    deleteGameArtifacts(ctx, room.code);
    ctx.db.activity.gameCode.delete(room.code);
  }
}

/**
 * Point the room at a new artist/turn and open the pick-a-word window: the
 * artist gets WORD_CHOICE_COUNT options, `currentWord` stays '' and
 * `turnStartedAt` times the choice window. The draw clock (and the slideshow
 * drawing row) start in `lockWord` once a word is picked.
 */
function beginTurn(ctx: Ctx, room: GameRow, artist: PlayerRow, turn: number, round: number): GameRow {
  ctx.db.liveStroke.gameCode.delete(room.code);
  const choices = { gameCode: room.code, choices: randomWordChoices(ctx, WORD_CHOICE_COUNT) };
  if (ctx.db.wordChoice.gameCode.find(room.code)) {
    ctx.db.wordChoice.gameCode.update(choices);
  } else {
    ctx.db.wordChoice.insert(choices);
  }
  const updated = {
    ...room,
    artist: artist.identity,
    currentWord: '',
    turn,
    round,
    turnStartedAt: ctx.timestamp,
  };
  ctx.db.game.code.update(updated);
  touchActivity(ctx, room.code);
  return updated;
}

/** Lock in the turn's word: log the slideshow row and start the draw clock. */
function lockWord(ctx: Ctx, room: GameRow, word: string): void {
  ctx.db.wordChoice.gameCode.delete(room.code);
  const artist = ctx.db.player.identity.find(room.artist);
  ctx.db.drawing.insert({
    id: 0n,
    gameCode: room.code,
    turn: room.turn,
    artist: room.artist,
    artistName: artist?.username ?? '',
    word,
  });
  ctx.db.game.code.update({
    ...room,
    currentWord: word,
    turnStartedAt: ctx.timestamp,
  });
  touchActivity(ctx, room.code);
}

/**
 * Rotate to the next artist (join order, wrapping). Wrapping past the end of
 * the roster starts the next round; running out of rounds finishes the game —
 * strokes/drawings stick around for the slideshow until the room dies.
 */
function advanceTurn(ctx: Ctx, room: GameRow): GameRow {
  touchActivity(ctx, room.code);
  const roster = playersIn(ctx, room.code);
  if (roster.length === 0) return room;
  const idx = roster.findIndex(p => p.identity.isEqual(room.artist));
  const nextIdx = (idx + 1) % roster.length;
  const wrapped = nextIdx <= idx; // idx === -1 (artist left) never wraps
  const round = wrapped ? room.round + 1 : room.round;

  if (round > room.rounds) {
    ctx.db.liveStroke.gameCode.delete(room.code);
    ctx.db.wordChoice.gameCode.delete(room.code);
    const finished = { ...room, status: 'finished', currentWord: '', turnStartedAt: ctx.timestamp };
    ctx.db.game.code.update(finished);
    return finished;
  }
  return beginTurn(ctx, room, roster[nextIdx], room.turn + 1, round);
}

/**
 * Remove the sender's player row (if any) and fix up the game it was in:
 * decrement the count, delete the game when it empties, hand host to the
 * longest-tenured remaining player, and rotate the turn if the artist left.
 * Used by leave and by create/join so a player switching games never leaks
 * a stale row or player count.
 */
function detachFromGame(ctx: Ctx) {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) return;
  ctx.db.player.identity.delete(ctx.sender);

  const room = ctx.db.game.code.find(me.gameCode);
  if (!room) return;

  const remaining = playersIn(ctx, room.code);
  if (remaining.length === 0) {
    ctx.db.game.code.delete(room.code);
    deleteGameArtifacts(ctx, room.code);
    ctx.db.activity.gameCode.delete(room.code);
    return;
  }
  let updated = { ...room, playerCount: remaining.length };
  ctx.db.game.code.update(updated);

  if (me.isHost) {
    const heir = remaining[0];
    ctx.db.player.identity.update({ ...heir, isHost: true });
  }

  // the artist walking out mid-turn shouldn't strand the round
  if (updated.status === 'playing' && ctx.sender.isEqual(updated.artist)) {
    advanceTurn(ctx, updated);
  }
}

export const createGame = spacetimedb.reducer(
  { username: t.string(), isPublic: t.bool() },
  (ctx, { username, isPublic }) => {
    const name = cleanUsername(username);

    expireStaleGames(ctx);

    let code = randomCode(ctx);
    while (ctx.db.game.code.find(code)) code = randomCode(ctx);

    ctx.db.game.insert({
      code,
      status: 'waiting',
      isPublic,
      playerCount: 1,
      maxPlayers: MAX_PLAYERS,
      rounds: DEFAULT_ROUNDS,
      turnSeconds: MAX_TURN_SECONDS,
      artist: ctx.sender,
      currentWord: '',
      turn: 0,
      round: 0,
      turnStartedAt: ctx.timestamp,
      createdAt: ctx.timestamp,
    });

    detachFromGame(ctx);
    ctx.db.player.insert({
      identity: ctx.sender,
      username: name,
      gameCode: code,
      isHost: true,
      score: 0,
      online: true,
      joinedAt: ctx.timestamp,
    });
    touchActivity(ctx, code);
  }
);

export const joinGame = spacetimedb.reducer(
  { username: t.string(), code: t.string() },
  (ctx, { username, code }) => {
    const name = cleanUsername(username);
    expireStaleGames(ctx);

    const room = ctx.db.game.code.find(code.toUpperCase());
    if (!room) throw new SenderError('Game not found — check the code');

    // already in this game (refresh / second tab) — idempotent re-join
    const existing = ctx.db.player.identity.find(ctx.sender);
    if (existing && existing.gameCode === room.code) {
      ctx.db.player.identity.update({ ...existing, username: name, online: true });
      touchActivity(ctx, room.code);
      return;
    }

    // mid-game joins are welcome — the newcomer guesses now and is dealt into
    // the artist rotation as the turn wraps; only a finished game is closed
    if (room.status === 'finished') {
      throw new SenderError('That game just ended — ask the host for a rematch');
    }
    if (room.playerCount >= room.maxPlayers) throw new SenderError('That game is full');

    detachFromGame(ctx);
    ctx.db.player.insert({
      identity: ctx.sender,
      username: name,
      gameCode: room.code,
      isHost: false,
      score: 0,
      online: true,
      joinedAt: ctx.timestamp,
    });
    // detachFromGame only touches the sender's *previous* game (the same-game
    // case returned above), so `room` is still current
    ctx.db.game.code.update({ ...room, playerCount: room.playerCount + 1 });
    touchActivity(ctx, room.code);
  }
);

export const leaveGame = spacetimedb.reducer(ctx => {
  detachFromGame(ctx);
});

/** Host kicks off the game: round 1, turn 1, host draws first. */
export const startGame = spacetimedb.reducer(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) throw new SenderError('You are not in a game');
  if (!me.isHost) throw new SenderError('Only the host can start the game');

  const room = ctx.db.game.code.find(me.gameCode);
  if (!room) throw new SenderError('Game not found');
  if (room.status !== 'waiting') return; // double-click / two tabs — idempotent

  // TODO: require 2+ players once the loop is stable — solo start kept for dev
  deleteGameArtifacts(ctx, room.code);
  beginTurn(ctx, { ...room, status: 'playing' }, me, 1, 1);
});

/** The room's current artist + playing-state guard shared by the draw reducers. */
function requireArtist(ctx: Ctx): GameRow {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) throw new SenderError('You are not in a game');
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room || room.status !== 'playing') throw new SenderError('The game is not running');
  if (!ctx.sender.isEqual(room.artist)) throw new SenderError('Only the artist can draw');
  return room;
}

function validateStroke(points: number[], color: string, width: number): number {
  if (points.length < 2 || points.length % 2 !== 0 || points.length > MAX_STROKE_FLOATS) {
    throw new SenderError('Bad stroke data');
  }
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new SenderError('Bad stroke color');
  return Math.min(Math.max(width, 0.005), 0.1);
}

/** Artist paints one finished stroke; everyone renders it from the table. */
export const addStroke = spacetimedb.reducer(
  { points: t.array(t.f32()), color: t.string(), width: t.f32(), threeD: t.bool() },
  (ctx, { points, color, width, threeD }) => {
    const room = requireArtist(ctx);
    if (points.length < 4) throw new SenderError('Bad stroke data');
    const w = validateStroke(points, color, width);

    let count = 0;
    for (const s of ctx.db.stroke.gameCode.filter(room.code)) {
      if (s.turn === room.turn && ++count >= MAX_STROKES_PER_TURN) {
        throw new SenderError('Stroke limit reached');
      }
    }

    ctx.db.stroke.insert({
      id: 0n,
      gameCode: room.code,
      turn: room.turn,
      points,
      color,
      width: w,
      threeD,
    });
    // the committed stroke supersedes the live preview
    ctx.db.liveStroke.gameCode.delete(room.code);
  }
);

/**
 * Artist streams the in-progress stroke (throttled client-side) so everyone
 * watches it grow. Empty points = the stroke was abandoned; drop the preview.
 */
export const updateLiveStroke = spacetimedb.reducer(
  { points: t.array(t.f32()), color: t.string(), width: t.f32(), threeD: t.bool() },
  (ctx, { points, color, width, threeD }) => {
    const room = requireArtist(ctx);
    if (points.length === 0) {
      ctx.db.liveStroke.gameCode.delete(room.code);
      return;
    }
    const w = validateStroke(points, color, width);
    const row = { gameCode: room.code, points, color, width: w, threeD };
    if (ctx.db.liveStroke.gameCode.find(room.code)) {
      ctx.db.liveStroke.gameCode.update(row);
    } else {
      ctx.db.liveStroke.insert(row);
    }
  }
);

/** Artist wipes the paper (current turn only — past turns are slideshow history). */
export const clearCanvas = spacetimedb.reducer(ctx => {
  const room = requireArtist(ctx);
  const doomed = [...ctx.db.stroke.gameCode.filter(room.code)].filter(s => s.turn === room.turn);
  for (const s of doomed) ctx.db.stroke.id.delete(s.id);
  ctx.db.liveStroke.gameCode.delete(room.code);
});

/** The artist picks one of their word options while the choice window is open. */
export const chooseWord = spacetimedb.reducer({ index: t.u32() }, (ctx, { index }) => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) throw new SenderError('You are not in a game');
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room || room.status !== 'playing') throw new SenderError('The game is not running');
  if (!ctx.sender.isEqual(room.artist)) throw new SenderError('Only the artist picks the word');
  const pending = ctx.db.wordChoice.gameCode.find(room.code);
  if (!pending) return; // already locked — double-click
  if (index >= pending.choices.length) throw new SenderError('Bad word choice');
  lockWord(ctx, room, pending.choices[index]);
});

/**
 * A dawdling artist gets a word picked for them: any client whose choice
 * countdown hit zero calls this (same trust model as end_turn — the server's
 * clock decides, racing clients lock the word once).
 */
export const autoPickWord = spacetimedb.reducer(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) return;
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room || room.status !== 'playing') return;
  const pending = ctx.db.wordChoice.gameCode.find(room.code);
  if (!pending) return;

  const elapsed = ctx.timestamp.since(room.turnStartedAt).micros;
  const limit = BigInt(WORD_CHOICE_SECONDS) * 1_000_000n - END_TURN_GRACE_MICROS;
  if (elapsed < limit) return;
  lockWord(ctx, room, pending.choices[Math.floor(ctx.random() * pending.choices.length)]);
});

/**
 * Any client whose countdown hit zero calls this; the server checks the turn
 * clock against its own timestamps, so early/spoofed calls are quiet no-ops
 * and racing clients only rotate the turn once. While the pick-a-word window
 * is open `turnStartedAt` marks the window start instead, so this doubles as
 * a stuck-room failsafe (a full turnSeconds after an unpicked word).
 */
export const endTurn = spacetimedb.reducer(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) return;
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room || room.status !== 'playing') return;

  const elapsed = ctx.timestamp.since(room.turnStartedAt).micros;
  const limit = BigInt(room.turnSeconds) * 1_000_000n - END_TURN_GRACE_MICROS;
  if (elapsed < limit) return;
  advanceTurn(ctx, room);
});

/**
 * A guess from a non-artist. Wrong guesses land in the public feed; a correct
 * one scores guesser + artist and is stored with empty text so the word never
 * leaks into the feed. Guesser points decay with the turn clock — the earlier
 * the solve, the bigger the score. When every guesser has it, the turn rotates.
 */
export const submitGuess = spacetimedb.reducer({ text: t.string() }, (ctx, { text }) => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) throw new SenderError('You are not in a game');
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room || room.status !== 'playing') throw new SenderError('The game is not running');
  if (ctx.sender.isEqual(room.artist)) throw new SenderError('The artist cannot guess');

  const cleaned = text.trim().slice(0, MAX_GUESS_LENGTH);
  if (!cleaned) return;
  // wrong guesses are broadcast to the whole room — keep the feed family-friendly
  if (containsProfanity(cleaned)) {
    throw new SenderError('Let’s keep it friendly — that guess was blocked');
  }

  const turnGuesses = [...ctx.db.guess.gameCode.filter(room.code)].filter(
    g => g.turn === room.turn
  );
  if (turnGuesses.some(g => g.correct && g.player.isEqual(ctx.sender))) {
    return; // already got it this turn — swallow chatter until turn ends
  }

  touchActivity(ctx, room.code);
  const correct = normalizeGuess(cleaned) === normalizeGuess(room.currentWord);
  ctx.db.guess.insert({
    id: 0n,
    gameCode: room.code,
    player: ctx.sender,
    username: me.username,
    text: correct ? '' : cleaned,
    correct,
    turn: room.turn,
    createdAt: ctx.timestamp,
  });
  if (!correct) return;

  const elapsed = Number(ctx.timestamp.since(room.turnStartedAt).micros);
  const turnMicros = room.turnSeconds * 1_000_000;
  const remaining = Math.min(Math.max(1 - elapsed / turnMicros, 0), 1);
  const earned = Math.round(
    MIN_GUESSER_POINTS + (MAX_GUESSER_POINTS - MIN_GUESSER_POINTS) * remaining
  );
  ctx.db.player.identity.update({ ...me, score: me.score + earned });
  const artist = ctx.db.player.identity.find(room.artist);
  if (artist) {
    ctx.db.player.identity.update({ ...artist, score: artist.score + ARTIST_POINTS });
  }

  // every connected guesser solved it → next turn. Offline players don't
  // count — an AFK tab shouldn't make everyone wait out the clock (they can
  // still solve for points if they reconnect before it runs down naturally).
  const solved = new Set(
    turnGuesses.filter(g => g.correct).map(g => g.player.toHexString())
  );
  solved.add(ctx.sender.toHexString());
  const guessers = playersIn(ctx, room.code).filter(
    p => p.online && !p.identity.isEqual(room.artist)
  );
  if (guessers.every(p => solved.has(p.identity.toHexString()))) {
    advanceTurn(ctx, room);
  }
});

/**
 * Slideshow ballot: one pick per category per voter. Voting a new drawing in
 * a category you already used moves the vote; re-voting the same drawing
 * retracts it.
 */
export const castVote = spacetimedb.reducer(
  { turn: t.u32(), category: t.string() },
  (ctx, { turn, category }) => {
    const me = ctx.db.player.identity.find(ctx.sender);
    if (!me) throw new SenderError('You are not in a game');
    const room = ctx.db.game.code.find(me.gameCode);
    if (!room || room.status !== 'finished') throw new SenderError('Voting opens when the game ends');
    if (!(VOTE_CATEGORIES as readonly string[]).includes(category)) {
      throw new SenderError('Unknown vote category');
    }
    const exists = [...ctx.db.drawing.gameCode.filter(room.code)].some(d => d.turn === turn);
    if (!exists) throw new SenderError('No such drawing');

    const prior = [...ctx.db.vote.gameCode.filter(room.code)].find(
      v => v.category === category && v.voter.isEqual(ctx.sender)
    );
    touchActivity(ctx, room.code);
    if (prior) {
      ctx.db.vote.id.delete(prior.id);
      if (prior.turn === turn) return; // same pick again — retract
    }
    ctx.db.vote.insert({ id: 0n, gameCode: room.code, voter: ctx.sender, turn, category });
  }
);

/** Host resets a finished room back to the lobby for a rematch. */
export const playAgain = spacetimedb.reducer(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me) throw new SenderError('You are not in a game');
  if (!me.isHost) throw new SenderError('Only the host can start a rematch');
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room) throw new SenderError('Game not found');
  if (room.status !== 'finished') return; // double-click — idempotent

  deleteGameArtifacts(ctx, room.code);
  for (const p of playersIn(ctx, room.code)) {
    ctx.db.player.identity.update({ ...p, score: 0 });
  }
  ctx.db.game.code.update({
    ...room,
    status: 'waiting',
    artist: ctx.sender,
    currentWord: '',
    turn: 0,
    round: 0,
    turnStartedAt: ctx.timestamp,
  });
  touchActivity(ctx, room.code);
});

/**
 * Presence: identities persist across refreshes (token in localStorage), so a
 * disconnect only flips `online` — the player row stays and the client rejoins
 * seamlessly on reconnect. Actual removal is explicit (leave_game) or a future
 * scheduled reaper for long-offline players.
 */
export const onConnect = spacetimedb.clientConnected(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (me) {
    if (!me.online) ctx.db.player.identity.update({ ...me, online: true });
    touchActivity(ctx, me.gameCode);
  }
  // every visitor sweeps — the public games list they're about to see never
  // shows rooms that died with their tabs (my row is online now, so my own
  // room is safe)
  expireStaleGames(ctx);
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const me = ctx.db.player.identity.find(ctx.sender);
  if (!me || !me.online) return;
  ctx.db.player.identity.update({ ...me, online: false });
  // stamp when the room went quiet — the stale sweep measures from here
  touchActivity(ctx, me.gameCode);

  // if everyone still connected already solved the word, the leaver was the
  // only thing keeping the turn alive — rotate now instead of waiting out the
  // clock. (The artist leaving is different: the turn stays so they can
  // reconnect and keep drawing.)
  const room = ctx.db.game.code.find(me.gameCode);
  if (!room || room.status !== 'playing' || ctx.sender.isEqual(room.artist)) return;
  const solved = new Set(
    [...ctx.db.guess.gameCode.filter(room.code)]
      .filter(g => g.turn === room.turn && g.correct)
      .map(g => g.player.toHexString())
  );
  const guessers = playersIn(ctx, room.code).filter(
    p => p.online && !p.identity.isEqual(room.artist) && !p.identity.isEqual(ctx.sender)
  );
  if (guessers.length > 0 && guessers.every(p => solved.has(p.identity.toHexString()))) {
    advanceTurn(ctx, room);
  }
});

export default spacetimedb;
