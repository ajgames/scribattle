# Scribattle.io — User Story Document

A real-time multiplayer drawing & guessing game (Pictionary / skribbl.io style). One
player draws a secret word while everyone else races to guess it in a live chat. Points
are awarded for guessing quickly and for drawing something people can guess.

This document defines **what we want to build**, expressed as user stories. It is derived
from the intent of the previous `old-client` (React Router v7) and `old-server` (Go
WebSocket) prototypes, but it is written for a **clean rewrite**. It describes the desired
experience, not the existing implementation. Where the old prototype only stubbed or faked
a feature, the story here defines the real, finished behavior we're targeting.

**Format:** Each story is `As a <role>, I want <capability>, so that <benefit>` with
acceptance criteria (AC). Priority is `P0` (must-have for a playable game), `P1` (core
experience), `P2` (polish / later).

**Roles**
- **Player** — anyone in a game (drawing or guessing).
- **Host** — the player who created the game and controls its flow.
- **Artist** — the player currently drawing this turn.
- **Guesser** — any non-artist player during an active turn.
- **Visitor** — someone on the site who hasn't joined a game yet.

---

## Epic 1 — Landing & Game Discovery

### 1.1 See the game and get started fast `P0`
**As a** Visitor, **I want** a landing page that explains the game and gives me one obvious
action, **so that** I can start playing within seconds.
- AC: Landing page states what Scribattle is in one line and shows a primary "Create Game" and secondary "Join Game" action.
- AC: If the backend is unreachable, I see a clear "can't reach server" state rather than a blank or broken page.

### 1.2 Browse public games `P1`
**As a** Visitor, **I want** to see a live list of joinable public games, **so that** I can jump into an existing lobby.
- AC: The list shows game code, status (waiting/playing/finished), player count vs. max, and key settings (rounds, round length).
- AC: Only games in a joinable state (waiting, not full, public) show a "Join" action; in-progress games may be viewable but not joinable mid-round unless late-join is enabled (see 7.6).
- AC: The list updates in near-real-time (no manual refresh needed) and removes stale/finished games.

### 1.3 Join by code `P0`
**As a** Visitor, **I want** to enter a short game code, **so that** I can join a specific game a friend gave me.
- AC: Codes are short, human-readable, and unambiguous (no easily confused characters like 0/O, 1/I).
- AC: An invalid or expired code shows a friendly error and lets me try again.

---

## Epic 2 — Game Creation & Configuration

### 2.1 Create a game `P0`
**As a** Host, **I want** to create a new game and immediately land in its lobby, **so that** I can invite others and start playing.
- AC: Creating a game auto-joins me as the host — I never have to create then separately join.
- AC: I get a shareable game code and a share link right away.

### 2.2 Configure match settings `P0`
**As a** Host, **I want** to set the rules before starting, **so that** the match fits my group.
- AC: I can set max players (e.g. 2–16), round/turn duration (e.g. 30–300s), and number of rounds.
- AC: Sensible defaults are pre-filled so I can create a game without touching any setting.
- AC: Settings are validated (min/max) with inline feedback.

### 2.3 Choose game mode `P1`
**As a** Host, **I want** to pick a game mode (e.g. Standard, Speed, Custom), **so that** I can control pacing and difficulty without configuring every field.
- AC: Each mode applies a preset (duration, player range, word difficulty, scoring multipliers).
- AC: "Custom" unlocks full manual control of all settings.

### 2.4 Provide custom word lists `P1`
**As a** Host, **I want** to supply my own list of words/prompts, **so that** we can play themed rounds (inside jokes, a topic, another language).
- AC: I can enter a custom prompt list when creating a game.
- AC: If I provide fewer words than needed, the game falls back to the built-in word pool.
- AC: Custom words are only ever shown to the artist, never leaked to guessers.

### 2.5 Public vs. private games `P1`
**As a** Host, **I want** to choose whether my game is listed publicly or joinable only by code, **so that** I can play with just my friends or open it to strangers.
- AC: Private games don't appear in the public list and require the code to join.

### 2.6 Remember my name `P2`
**As a** Player, **I want** my display name remembered between sessions, **so that** I don't retype it every game.
- AC: My last-used name is pre-filled on the create/join forms.

---

## Epic 3 — Joining & The Lobby

### 3.1 Join a game with a name `P0`
**As a** Player, **I want** to join a game with a display name, **so that** others can recognize me.
- AC: A name is required; joining is blocked with a clear message if the game is full, already started (and late-join disabled), or doesn't exist.
- AC: On success I land directly in the game lobby.

### 3.2 See who's in the lobby `P0`
**As a** Player, **I want** to see everyone in the lobby and their status, **so that** I know who I'm playing with and whether we're ready to start.
- AC: The player list updates live as people join and leave.
- AC: Each player shows name, host badge, ready state, and a "you" indicator for myself.

### 3.3 Ready up `P0`
**As a** Player, **I want** to toggle a "ready" state, **so that** the host knows I'm set to begin.
- AC: My ready state is visible to everyone in real time.
- AC: The lobby shows an aggregate like "3 of 5 players ready."

### 3.4 Share an invite `P1`
**As a** Host, **I want** a one-click way to copy the game code / invite link, **so that** I can quickly bring friends in.
- AC: A visible copy-to-clipboard control for the code and/or a deep link that pre-fills the join form.

### 3.5 Start the match `P0`
**As a** Host, **I want** to start the game once conditions are met, **so that** play begins for everyone at once.
- AC: Start is only enabled when the minimum player count is met (and, per host preference, when all players are ready).
- AC: The start control clearly explains why it's disabled (e.g. "Need at least 2 players," "Waiting for all players to ready up").
- AC: Starting transitions every connected player into the first turn simultaneously.

### 3.6 Manage players (host) `P1`
**As a** Host, **I want** to remove a disruptive player, **so that** I can keep the game fun.
- AC: Host can kick a player; the kicked player is removed and told they were kicked.
- AC: Kicking is reflected live for all remaining players.

### 3.7 Host handover `P1`
**As a** Player, **I want** host duties to transfer automatically if the host leaves, **so that** the game isn't stuck without a controller.
- AC: If the host leaves during the lobby, host status passes to another player deterministically.
- AC: The new host gains host controls without needing to rejoin.

---

## Epic 4 — Session Persistence & Reconnection

### 4.1 Survive a page refresh `P0`
**As a** Player, **I want** to stay in my game after refreshing or briefly losing connection, **so that** an accident doesn't knock me out mid-game.
- AC: Reloading the game page re-establishes my identity and puts me back in the same game seat.
- AC: My score, host status, and ready state are preserved across the reconnect.

### 4.2 Reconnect gracefully `P0`
**As a** Player, **I want** the app to automatically try to reconnect when the connection drops, **so that** transient network blips are invisible.
- AC: The client detects a dropped socket and retries with backoff up to a reasonable limit.
- AC: While disconnected I see a clear connection indicator; on reconnect I'm resynced to current game state.

### 4.3 Grace period for abandoned games `P1`
**As a** Player, **I want** a game to persist briefly after everyone disconnects, **so that** a group reload or a host's dropped connection doesn't destroy the match.
- AC: An empty game is retained for a short grace window before cleanup, then removed.
- AC: Reconnecting within the window restores the game.

### 4.4 See other players' presence `P1`
**As a** Player, **I want** to see which players are currently connected vs. temporarily gone, **so that** I understand who's actually here.
- AC: Each player shows a connected/disconnected/idle indicator that updates live.
- AC: A player idle or gone for too long is surfaced (and may be auto-removed per host settings).

---

## Epic 5 — The Drawing Canvas (Artist)

### 5.1 Draw in real time `P0`
**As an** Artist, **I want** to draw on a canvas and have everyone see my strokes appear live, **so that** they can guess as I draw.
- AC: My strokes are streamed to all guessers with low, batched latency (smooth, not laggy).
- AC: The stream is efficient (throttled/batched) so it scales to many players.

### 5.2 Brush tools & colors `P0`
**As an** Artist, **I want** a color palette and adjustable brush sizes, **so that** I can draw expressively.
- AC: I can pick from a palette of colors and multiple brush sizes.
- AC: Selected color/size are visually indicated.

### 5.3 Eraser and fill `P1`
**As an** Artist, **I want** an eraser and a fill/bucket tool, **so that** I can correct mistakes and fill regions quickly.
- AC: Eraser and fill are available alongside the brush and sync to all viewers.

### 5.4 Undo `P0`
**As an** Artist, **I want** to undo my last stroke(s), **so that** I can fix mistakes without clearing everything.
- AC: Undo removes the most recent stroke(s) for me and all viewers in sync.

### 5.5 Clear canvas `P1`
**As an** Artist, **I want** to clear the whole canvas, **so that** I can restart my drawing.
- AC: Clear wipes the canvas for everyone and is reflected instantly.

### 5.6 Touch & mobile drawing `P1`
**As an** Artist on a phone or tablet, **I want** to draw with touch, **so that** I can play on mobile.
- AC: Drawing works with touch and mouse/trackpad; the canvas scales responsively while keeping aspect ratio.

### 5.7 Only the artist can draw `P0`
**As a** Guesser, **I want** drawing to be locked to the current artist, **so that** the game stays fair and the canvas isn't griefed.
- AC: Non-artists cannot draw; attempts are ignored/blocked server-side, not just hidden in the UI.
- AC: The UI clearly communicates whose turn it is (e.g. "You're drawing: WORD" for the artist, "Alice is drawing" for guessers).

---

## Epic 6 — The Canvas (Guessers & Late Joiners)

### 6.1 Watch the drawing live `P0`
**As a** Guesser, **I want** to watch the artist's drawing render stroke by stroke, **so that** I can figure out the word.
- AC: Strokes appear in the same order/appearance the artist made them.

### 6.2 See the canvas when I join late `P1`
**As a** Player who connects mid-turn, **I want** the current drawing to appear immediately, **so that** I'm not staring at a blank canvas.
- AC: On connect, the client receives the current canvas state (accumulated strokes) and renders it before new strokes arrive.

---

## Epic 7 — Rounds, Turns & Word Selection

### 7.1 Automatic turn rotation `P0`
**As a** Player, **I want** the game to rotate the artist role fairly across turns and rounds, **so that** everyone gets to draw.
- AC: Each turn assigns exactly one artist; over a round, every player draws once (or per the mode's rule).
- AC: Rotation order is deterministic and visible (players can tell who's next / how many turns remain).

### 7.2 Word choice for the artist `P1`
**As an** Artist, **I want** to choose from a few candidate words at the start of my turn, **so that** I can draw something I'm comfortable with.
- AC: At turn start the artist is offered a small set of word options (with difficulty indicated) and picks one within a time limit.
- AC: If the artist doesn't choose in time, a word is auto-selected.
- AC: Words carry category/difficulty metadata used for scoring and filtering.

### 7.3 Hidden word with hints `P0`
**As a** Guesser, **I want** the word hidden but with progressive hints (length, then revealed letters over time), **so that** guessing is challenging but not impossible.
- AC: Guessers see the word as blanks showing length; the artist sees the full word.
- AC: As the timer runs down, letters are progressively revealed to guessers.

### 7.4 Turn timer `P0`
**As a** Player, **I want** a visible countdown for each turn, **so that** I feel the time pressure and know when the turn ends.
- AC: A synchronized countdown is shown to everyone and drives turn end.
- AC: The turn ends when time runs out or when all guessers have guessed correctly.

### 7.5 Turn results reveal `P0`
**As a** Player, **I want** an end-of-turn summary, **so that** I see the word and who got points.
- AC: At turn end the word is revealed to everyone.
- AC: The summary shows who guessed correctly and the points awarded this turn before the next turn begins.

### 7.6 Late join into an active game `P2`
**As a** Player, **I want** to join a game that's already running (if allowed), **so that** I don't have to wait for it to finish.
- AC: If late-join is enabled, I join as a spectator/guesser for the current turn and enter rotation on the next round.

---

## Epic 8 — Guessing & Scoring

### 8.1 Submit guesses `P0`
**As a** Guesser, **I want** to type guesses and get instant feedback, **so that** I know if I'm right.
- AC: Guesses are checked server-side against the current word (case-insensitive, trimmed, tolerant of minor variance).
- AC: A correct guess is confirmed to me immediately and I stop being able to score again this turn.

### 8.2 Don't spoil the word `P0`
**As a** Guesser, **I want** my correct guess to not reveal the word in public chat, **so that** others still have to guess.
- AC: A correct guess is shown as "Alice guessed the word!" — the actual word is not printed to players who haven't guessed.
- AC: Incorrect guesses appear as normal chat so players can riff off each other.

### 8.3 Time-based scoring `P0`
**As a** Player, **I want** points that reward guessing quickly, **so that** speed matters.
- AC: Correct guessers earn points scaled by how fast they guessed (earlier = more).
- AC: A "first correct" bonus rewards the fastest guesser.
- AC: Scoring multipliers can vary by game mode / word difficulty.

### 8.4 Reward the artist `P1`
**As an** Artist, **I want** to earn points when people guess my drawing, **so that** I'm motivated to draw well (not too easy, not impossible).
- AC: The artist earns points based on how many players guessed correctly (and optionally how quickly).

### 8.5 Post-guess chat lane `P1`
**As a** Player who already guessed correctly, **I want** to keep chatting with other correct-guessers without spoiling, **so that** I can still participate.
- AC: Players who've guessed can see/participate in a "correct guessers" chat that isn't visible to those still guessing (or messages are held until turn end).

### 8.6 Live score updates `P0`
**As a** Player, **I want** to see scores update live, **so that** I always know the standings.
- AC: Every player's running score is visible and updates as points are awarded.

---

## Epic 9 — Chat & Communication

### 9.1 Real-time chat `P0`
**As a** Player, **I want** a live chat, **so that** I can guess and talk to other players.
- AC: Messages broadcast to all players in near real-time with sender name and timestamp.
- AC: Chat visually distinguishes normal chat, guesses, and system messages.

### 9.2 System event feed `P1`
**As a** Player, **I want** system messages for key events (joins, leaves, round start/end, correct guesses), **so that** I can follow what's happening.
- AC: System messages appear inline in chat, styled distinctly from player messages.

### 9.3 Basic moderation `P2`
**As a** Player, **I want** guarding against spam and abuse, **so that** chat stays usable.
- AC: Rate limiting on messages/guesses; basic profanity handling on names and messages (configurable).

---

## Epic 10 — Match Flow & Endgame

### 10.1 Pause & resume `P1`
**As a** Host, **I want** to pause and resume the match, **so that** we can take a break without losing state.
- AC: Pausing halts the timer and drawing for everyone; resuming continues from where it left off.
- AC: Pause/resume are broadcast so all clients reflect the same state.

### 10.2 Skip a turn `P1`
**As a** Host (or artist), **I want** to skip the current turn, **so that** a stuck or AFK situation doesn't stall the game.
- AC: Skipping ends the current turn without awarding drawing points and advances rotation.

### 10.3 End the match `P0`
**As a** Host, **I want** to end the match, **so that** I can wrap up early or when rounds are complete.
- AC: A match ends when all rounds complete, when the host ends it, or when it's abandoned.
- AC: Ending transitions everyone to the results screen.

### 10.4 Final results / podium `P0`
**As a** Player, **I want** a final scoreboard at the end, **so that** I see who won.
- AC: Final results rank all players by score with a clear winner/podium.
- AC: From results I can rematch (new game with same group/settings) or return home.

---

## Epic 11 — Leaderboards & Stats

### 11.1 In-game leaderboard `P1`
**As a** Player, **I want** a live leaderboard during the match, **so that** I can track standings and per-round performance.
- AC: Leaderboard ranks players by total score and can show per-round detail (correct guesses, avg guess time, turns as artist).

### 11.2 Lifetime player stats `P2`
**As a** returning Player, **I want** persistent personal stats, **so that** I can see my progress over time.
- AC: Stats such as games played, games won, total/average score, guess accuracy, average guess time, favorite category are tracked and viewable.
- AC: (Requires persistent player identity — see 12.x.)

---

## Epic 12 — Identity, Accounts & Persistence (Foundational)

### 12.1 Lightweight guest identity `P0`
**As a** Player, **I want** to play instantly without signing up, **so that** there's zero friction.
- AC: A guest identity is created on first use and persists locally so I keep the same seat across reloads.

### 12.2 Optional accounts `P2`
**As a** returning Player, **I want** to optionally create an account, **so that** my stats and name follow me across devices.
- AC: Optional auth links guest play to a persistent profile; unauthenticated guest play still works fully.

### 12.3 Durable game/match storage `P1`
**As a** product owner, **I want** game and match data to be stored durably (not only in memory), **so that** stats, history, and reconnection survive server restarts and can scale.
- AC: Match results and player stats persist beyond a single process lifetime.
- AC: Active game state can be recovered or gracefully handled across restarts/deploys.

---

## Epic 13 — Words & Content

### 13.1 Curated word pool `P0`
**As a** product owner, **I want** a built-in library of words organized by category and difficulty, **so that** default games have good, varied prompts.
- AC: A default word list exists with category and difficulty tagging.
- AC: Word selection respects the game mode's difficulty (e.g. Speed mode uses simpler words).

### 13.2 Category filtering `P2`
**As a** Host, **I want** to restrict a game to certain categories, **so that** we can theme the match (animals, movies, etc.).
- AC: Host can select allowed categories; only matching words are drawn.

---

## Epic 14 — Cross-Cutting / Non-Functional

### 14.1 Responsive, mobile-friendly UI `P0`
**As a** Player, **I want** the game to work well on desktop, tablet, and phone, **so that** I can play anywhere.
- AC: Layout adapts across breakpoints; canvas and controls are usable on touch devices.

### 14.2 Consistent, accessible visual design `P1`
**As a** Player, **I want** a clean, legible interface (including dark mode), **so that** long sessions are comfortable.
- AC: A consistent design system (colors, spacing, components); dark mode supported; adequate contrast and focus states.
- AC: Interactive elements are keyboard-accessible and labeled.

### 14.3 Fair play & anti-cheat `P1`
**As a** Player, **I want** the server to be the source of truth for words, scoring, and permissions, **so that** clients can't cheat.
- AC: The secret word, scoring, timing, and "who can draw" are enforced server-side; clients only receive what they're allowed to see.
- AC: Guessers never receive the word over the wire before it's revealed.

### 14.4 Scales to real usage `P1`
**As a** product owner, **I want** the real-time layer to handle many concurrent games and players, **so that** the game stays smooth under load.
- AC: Drawing traffic is batched/throttled; broadcasts are targeted (e.g. senders don't get echoed their own strokes).
- AC: Connection lifecycle is robust: heartbeats, timeouts, cleanup of dead connections, idle detection.

### 14.5 Observability & health `P2`
**As an** operator, **I want** health checks and basic metrics, **so that** I can monitor and debug the service.
- AC: A health endpoint and key metrics (active games/players, event throughput, connection counts) are exposed.

### 14.6 Clear error & edge-case handling `P1`
**As a** Player, **I want** friendly handling of errors (game not found, full, expired, kicked, connection lost), **so that** I'm never stuck on a broken screen.
- AC: Each failure state has a clear message and a path forward (create/join/home).

---

## Appendix A — Prototype Reality Check (informs the rewrite)

The previous prototype established the shell and real-time plumbing but **left most of the
game loop unimplemented**. Notable gaps the rewrite must actually deliver (these were faked,
stubbed, or missing):

- **Guessing is not real.** Guesses were broadcast as chat with a `// TODO: Implement guess validation` — no correctness check, no scoring, no word hiding. (Epics 8, 7.3)
- **No scoring at all.** Points, time bonuses, leaderboards, and stats were defined in the API spec but never computed. (Epics 8, 11)
- **No round/turn engine.** No timer countdown, no artist rotation, no round start/end lifecycle; "start game" only broadcast a message and picked one random artist/word once. (Epic 7)
- **Pause/resume/skip/kick were stubs** returning "not implemented." (Epics 3.6, 10.1, 10.2)
- **Host model was a workaround.** The client invented an "effective/auto-assigned host" because the server's host assignment was unreliable; the rewrite should make host ownership authoritative and correct. (Epic 3.7)
- **Word secrecy leaked by design.** Full game state (including `currentPrompt`) was sent to all clients and dumped in a debug panel — the word must be server-guarded and only sent to the artist. (Epics 7.3, 14.3)
- **Canvas persistence was weak.** Strokes were kept in an in-memory `drawingHistory`; late-joiner canvas replay and durable storage need real support. (Epics 6.2, 12.3)
- **In-memory only.** All state lived in process memory with a cleanup goroutine — no durability for stats, history, or restart resilience. (Epic 12.3)
- **Reconnection was naive.** The WebSocket hook had no auto-reconnect; auto-rejoin created a *new* player identity rather than restoring the seat/score. (Epic 4)

**Guiding principle for the rewrite:** design around the stories above and make the
**server authoritative** for game state, word secrecy, scoring, timing, and permissions.
Don't port the prototype's tech debt — build the game loop the prototype only described.
