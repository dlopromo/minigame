# MiniGame

A lightweight GitHub Pages mini-game collection for quick office-break play with friends.

## Play

Open:

```text
https://dlopromo.github.io/
```

Current games:

- Guess Color: a Mastermind / Hit & Blow style color-code game.
- 鋤大DEE: a four-seat Big Two MVP with real-player seats, AI fill, and spectators in rooms.
- 鬥地主: a three-player Landlord MVP with bidding, bottom cards, rockets, bombs, AI fill, and spectators in rooms.
- 21點: a Blackjack MVP with explicit phase handling so bust / dealer / result states do not stall.
- 2048 Race: same-seed 2048 boards with no tile cap, local save progress, and Reverse undo.
- 轉色牌: an UNO-like color/number/action card MVP.
- 冚棉胎: a casual snap/slap reaction card MVP.
- 9Upper: a bluff-answer voting party MVP.
- 百家樂: a player-vs-AI-banker betting MVP with $1000 starting balance and $100-$500 bets.
- 大小: a player-vs-AI-dealer dice betting MVP with $1000 starting balance and $50-$500 bets.

Current modes:

- Local play
- Firebase Party Room with queue, chat history, spectators, AI fill, AI takeover, host migration, room history, and room-scoped leaderboard
- Focus/Boss mode: press `Shift` twice to cover the app with a quiet workspace brief, then press `Shift` twice or `Escape` to return.

All games support local single-player and short-code room starts. In rooms,
queued users are seated in `queuedAt` order up to the game's `maxPlayers`; extra
users stay as spectators while remaining in the queue for the next round. Empty
legal seats are filled by AI only when the game declares `aiFill: true`.

## Firebase Setup

Short-code rooms use Firebase Realtime Database plus Anonymous Auth.

Runtime config is intentionally not committed with real Firebase values. Local
development can use:

```text
minigame/js/firebaseConfig.local.js
```

Use `minigame/js/firebaseConfig.local.example.js` as the template.

GitHub Pages deploys should set one repository secret:

```text
FIREBASE_CONFIG_JSON
```

The Pages workflow writes that secret into `minigame/js/firebaseConfig.generated.js`
at deploy time. The committed `minigame/js/firebaseConfig.js` is a safe empty
stub, which avoids GitHub secret scanning blocking the repo.

Required Firebase services:

- Authentication: enable Anonymous sign-in.
- Realtime Database: create a database and add `databaseURL` to the web config.

This repo includes an RTDB rules file:

```text
database.rules.json
firebase.json
```

Deploy after checking it in Firebase's Rules Playground:

```bash
firebase deploy --only database
```

The rules are still friends-only MVP rules, not a public anti-cheat backend:
Anonymous Auth is required, room codes must be 4 digits, usernames must match the
app's 12-character Chinese/English/digit rule, and room/gameAction shapes are
validated before writes.

## Room Flow

Party Rooms use a 4-digit numeric room code. Entering an existing code joins
that room; entering a new code creates it. A random-create helper is also
available.

- Username is required, capped at 12 characters, and may only use Chinese characters, English letters, or digits.
- Host chooses the game and multiplayer mode from the persistent Party Room.
- Room chat and queue stay alive across game switches.
- The same Chatroom stays visible in the room lobby, game screen, and in-room result flow.
- Public room/game events are logged into Chatroom; hidden game information is not logged.
- Users must join the queue to play; unqueued users are spectators.
- Room state in Firebase starts each round.
- Firebase room/signaling state works over WAN.
- Room play is Firebase-first: client actions go through `gameActions`, and `gameState` is the source of truth for turn and board updates.
- Host clears Firebase `gameActions` after processing, so the fallback queue does not keep growing.
- Guess Color, 鋤大DEE, and 鬥地主 store Firebase `gameState` snapshots so refresh can restore active room state.
- Room lobby includes a compact Room Info panel for status, Firebase transport, host, round, queue, and fallback action count.
- If a player disconnects mid-round, their seat is temporarily AI-controlled; the same browser can re-enter the room code and resume that seat.
- If the host disconnects, the earliest joined online member can claim host authority through a Firebase transaction.
- `minigame/admin.html` provides a lightweight room monitor for rooms, players, AI takeover, history, and leaderboard data.

See the detailed room contract in:

```text
minigame/docs/ROOM_SPEC.md
minigame/docs/PLATFORM_SPEC.md
minigame/docs/CHATROOM_SPEC.md
```

## Development

This project is static HTML/CSS/JavaScript. There is no build step.

Run locally:

```bash
python3 -m http.server 4174
```

Then open:

```text
http://127.0.0.1:4174/minigame/index.html
```

The repo root also contains `index.html` with a `<base href="minigame/">`, so
GitHub Pages can serve the app from the project root.

Useful checks:

```bash
node minigame/tests/run-tests.js
node --check minigame/js/firebaseConfig.js
node --check minigame/js/signaling.js
node --check minigame/js/lobby.js
node --check minigame/games/guessColor/guessColor.js
node --check minigame/games/blackjack/blackjack.js
node --check minigame/games/tile2048/tile2048.js
node --check minigame/games/colorShift/colorShift.js
node --check minigame/games/snapStack/snapStack.js
node --check minigame/games/nineUpper/nineUpper.js
node --check minigame/games/baccarat/baccarat.js
node --check minigame/games/sicBo/sicBo.js
```

## Roadmap

- Add host controls for manually promoting/removing queued members.
- Add hardened Admin Auth / private rules if the room monitor becomes public-facing.
- Add Cloud Functions if fully automatic all-offline interruption archival is required.
