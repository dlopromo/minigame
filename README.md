# MiniGame

A lightweight GitHub Pages mini-game collection for quick office-break play with friends.

## Play

Open:

```text
https://dlopromo.github.io/minigame/
```

Current game:

- Guess Color: a Mastermind / Hit & Blow style color-code game.

Current modes:

- Local play
- Manual two-player WebRTC connection
- Firebase short-code room with players and spectators

## Firebase Setup

Short-code rooms use Firebase Realtime Database plus Anonymous Auth.

Required config lives in:

```text
minigame/js/firebaseConfig.js
```

Required Firebase services:

- Authentication: enable Anonymous sign-in.
- Realtime Database: create a database and add `databaseURL` to the web config.

Suggested MVP rules for friends-only testing:

```json
{
  "rules": {
    "rooms": {
      ".read": "auth != null",
      ".write": "auth != null",
      ".indexOn": ["createdAt"]
    }
  }
}
```

## Room Flow

Short-code rooms generate a random 4-digit numeric room code.

- Username is required, capped at 12 characters, and may only use Chinese characters, English letters, or digits.
- Host chooses the game and multiplayer mode.
- Room state in Firebase starts each round.
- WebRTC DataChannel is used for in-game sync.
- Extra users become spectators.

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
node --check minigame/js/webrtc.js
node --check minigame/games/guessColor/guessColor.js
```

## Roadmap

- Add Big Dee / 鋤大DEE as the next game.
- Add arcade-style leaderboards.
- Improve multiplayer reconnection and host recovery.
