# MiniGame App README

This folder contains the static mini-game app served by GitHub Pages.

## Architecture

- `index.html`: SPA shell and screen containers.
- `css/common.css`: shared layout, buttons, cards, toast, input styles.
- `css/lobby.css`: lobby, room, game selection, and mode selection UI.
- `js/common.js`: shared utilities.
- `js/firebaseConfig.js`: Firebase web config.
- `js/signaling.js`: Firebase Realtime Database room signaling.
- `js/webrtc.js`: manual two-player WebRTC and host-mesh DataChannel support.
- `js/gameManager.js`: game registration and lifecycle.
- `js/lobby.js`: local play, manual multiplayer, short-code room flow.
- `games/<gameId>/<gameId>.js`: game logic and rendering.
- `games/<gameId>/<gameId>.css`: game-specific styles.

## Game Module Contract

Each game registers itself through `App.GameManager.register()`.

```js
App.GameManager.register({
  id: 'guessColor',
  name: '猜顏色',
  icon: '🎨',
  description: 'Hit & Blow',
  supportsSingle: true,
  supportsMultiplayer: true,
  maxPlayers: 2,
  multiplayerModes: ['coop', 'race'],
  buildRoomStart: function(opts) {
    return {};
  },
  init: function(container, opts) {},
  handleMessage: function(msg) {},
  destroy: function() {}
});
```

`init(container, opts)` receives:

```js
{
  mode: 'single' | 'coop' | 'race',
  isHost: true,
  role: 'player' | 'spectator',
  roomId: '1234',
  selfId: 'client-id',
  roundId: 'round-id',
  players: [],
  spectators: [],
  playerName: 'DAVID',
  opponentName: 'FRIEND',
  initialState: {},
  initialCode: null
}
```

## Multiplayer Layers

There are two multiplayer paths:

- Manual WebRTC: old two-player offer/answer flow.
- Short-code room: Firebase RTDB room state plus host-mesh WebRTC.

Short-code rooms use Firebase as the round-start authority. DataChannel messages are still used for low-latency in-game updates.

Game-specific messages must be wrapped as:

```js
App.WebRTC.send({ type: 'game_msg', payload: msg });
```

## Adding A New Game

1. Create `games/<gameId>/<gameId>.js`.
2. Create `games/<gameId>/<gameId>.css`.
3. Add the CSS and script to `index.html`, or rely on future dynamic loading.
4. Register the game with `App.GameManager.register()`.
5. Set `supportsSingle`, `supportsMultiplayer`, `maxPlayers`, and `multiplayerModes`.
6. If the game has hidden opening state, implement `buildRoomStart()`.
7. In `init()`, handle:
   - `role: "player"`
   - `role: "spectator"`
   - `initialState`
8. Add tests for local mode, manual multiplayer, and short-code room mode.

## Username Rules

- Username is required for every multiplayer entry.
- Username is trimmed and capped at 12 characters.
- Empty or all-space names must be rejected with `請輸入你的名字`.
- Only Chinese characters, English letters, and digits are allowed.
- Spaces, punctuation, emoji, and symbols must be rejected with `名字只可使用中文、英文或數字`.
- Use `textContent` or escaping when rendering username values.

## Verification

Static checks:

```bash
node --check minigame/js/firebaseConfig.js
node --check minigame/js/signaling.js
node --check minigame/js/lobby.js
node --check minigame/js/webrtc.js
node --check minigame/games/guessColor/guessColor.js
```

Manual checks:

- Local Guess Color works.
- Empty username is rejected for multiplayer.
- Special-character username is rejected for multiplayer.
- Host creates a 4-digit room.
- Joiner enters room lobby.
- Host starts Guess Color and joiner enters the game without waiting forever.
- Third user becomes spectator.

## Agent Notes

Read these before changing room or game lifecycle code:

- `docs/AGENT_LOGIC.md`
- `docs/ROOM_SPEC.md`
