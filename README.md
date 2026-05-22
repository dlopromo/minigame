# MiniGame

A lightweight GitHub Pages mini-game collection for quick office-break play with friends.

## Play

Open:

```text
https://dlopromo.github.io/minigame/
```

Current games:

- Guess Color: a Mastermind / Hit & Blow style color-code game.
- 鋤大DEE: a four-seat Big Two MVP with real-player seats, AI fill, and spectators in rooms.
- 鬥地主: a three-player Landlord MVP with bidding, bottom cards, rockets, bombs, AI fill, and spectators in rooms.

Current modes:

- Local play
- Firebase Party Room with queue, chat history, spectators, AI fill, AI takeover, host migration, room history, and room-scoped leaderboard

鋤大DEE and 鬥地主 support local single-player and short-code room starts. In
rooms, queued users are seated first, extra users stay as spectators/queue, and
empty legal seats are filled by AI when the game supports it.

## Firebase Setup

Short-code rooms use Firebase Realtime Database plus Anonymous Auth.

Required config lives in:

```text
minigame/js/firebaseConfig.js
```

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

Useful checks:

```bash
node --check minigame/js/firebaseConfig.js
node --check minigame/js/signaling.js
node --check minigame/js/lobby.js
node --check minigame/games/guessColor/guessColor.js
```

## Roadmap

- Add host controls for manually promoting/removing queued members.
- Add hardened Admin Auth / private rules if the room monitor becomes public-facing.
- Add Cloud Functions if fully automatic all-offline interruption archival is required.
