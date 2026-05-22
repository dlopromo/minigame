# MiniGame App README

This folder contains the static mini-game app served by GitHub Pages.

## Architecture

- `index.html`: SPA shell and screen containers.
- `css/common.css`: shared layout, buttons, cards, toast, input styles.
- `css/lobby.css`: lobby, room, game selection, and mode selection UI.
- `js/common.js`: shared utilities.
- `js/roomSession.js`: `localStorage` room resume ticket helper.
- `js/firebaseConfig.js`: Firebase web config.
- `js/signaling.js`: Firebase Realtime Database party room, queue, chat, actions, and snapshots.
- `js/gameManager.js`: game registration and lifecycle.
- `js/lobby.js`: local play and Firebase Party Room flow.
- `games/<gameId>/<gameId>.js`: game logic and rendering.
- `games/<gameId>/<gameId>.css`: game-specific styles.

Related root Firebase files:

- `../firebase.json`: points Firebase CLI at the RTDB rules file.
- `../database.rules.json`: friends-only MVP validation for room codes, users, signaling, room start state, game state, and fallback game actions.

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
  minPlayers: 1,
  maxPlayers: 2,
  allowSpectators: true,
  aiFill: false,
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

## Multiplayer Layer

There is one multiplayer path:

- Firebase Party Room: RTDB stores members, queue, chat, round start, actions,
  and game snapshots.

Party Rooms use Firebase as the room and round authority. Firebase works over
WAN, so friends do not need to be on the same LAN.
Guess Color, 鋤大DEE, and 鬥地主 room play are Firebase-first: non-host clients write actions to `gameActions`, the host applies them, and `gameState` becomes the source of truth for board/turn/result updates.
The host removes each `gameActions/{actionId}` after processing or discarding it, so old fallback actions do not replay forever.
Refresh resume is Firebase-only: the same browser returns to the same room and
restores active game state from `gameStart` and `gameState`.

Room lobby has a compact debug panel:

- `狀態`: Firebase room lifecycle.
- `傳輸`: always Firebase.
- `房主`: current host display name.
- `回合`: active round id suffix.
- `隊列`: queued users.
- `Queue`: pending Firebase action count.

## Big Dee MVP

`bigDee` supports local single-player and short-code room play.

- `supportsSingle: true`
- `supportsMultiplayer: true`
- `maxPlayers: 4`
- `minRoomPlayers: 2`
- `aiFill: true`
- Four seats: real players first, then AI fill.
- Extra room members become spectators/queue.
- 52 cards, 13 cards per player.
- Holder of `3♦` starts, and the first play must include `3♦`.
- Supported hands: single, pair, triple, and five-card hands.
- Five-card ranking: straight < flush < full house < four of a kind < straight flush.
- Straight ranking: `A2345` is largest, then `23456`, then `10JQKA`; `34567` is smallest.
- Result scoring uses base stake `1`, remaining-card multipliers, and recorded top-card penalty notes.
- AI chooses the smallest legal play, but automatically plays the strongest legal response when the next player has one card.

## Dou Dizhu MVP

`douDizhu` supports local single-player and short-code room play. Four-player
鬥地主 is intentionally out of scope.

- `supportsSingle: true`
- `supportsMultiplayer: true`
- `minPlayers: 1`
- `minRoomPlayers: 2`
- `maxPlayers: 3`
- `allowSpectators: true`
- `aiFill: true`
- Three seats: real players first, then AI fill.
- Extra room members become spectators/queue.
- Uses 54 cards with small joker and big joker.
- Bidding supports pass, 1, 2, and 3 points.
- Highest bidder becomes landlord and receives the 3 bottom cards.
- Supports the standard 13 hand families listed in the game spec, including rocket, bombs, straights, pair chains, airplanes, and four-with-two.
- Bombs and rockets double the final multiplier.
- AI reads all hands and uses a teammate-aware strategy instead of random play.

## Global Game Contract

All new games should declare:

- `minPlayers`: minimum human player seats before AI fill.
- `maxPlayers`: legal player seat cap; extra room members become spectators.
- `allowSpectators: true` unless a game has a hard reason to block watching.
- `aiFill: true` when empty player seats can be filled by AI.

Room games should treat spectators as read-only full-state viewers. When a game
uses AI fill, AI should make the best available decision from known state rather
than random legal moves.

Game-specific multiplayer actions must be sent through:

```js
App.Lobby.sendRoomGameAction(msg);
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
8. Add tests for local mode and Party Room mode.

## Room Seat Rules

For room games, lobby seating is shared:

```text
online queued users ordered by queuedAt
        |
        v
first maxPlayers users -> player seats
remaining members      -> spectators / queue
empty seats + aiFill   -> AI player records in gameStart only
```

AI seats are not written into `rooms/{code}/members`; they only exist inside
`gameStart.players` and the game snapshot. Card games use the host as referee:
the host accepts actions, runs AI, writes `gameState`, and other clients render
that snapshot.

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
node --check minigame/games/guessColor/guessColor.js
node --check minigame/games/bigDee/bigDee.js
node --check minigame/games/douDizhu/douDizhu.js
node -e "JSON.parse(require('fs').readFileSync('firebase.json','utf8')); JSON.parse(require('fs').readFileSync('database.rules.json','utf8'));"
```

Manual checks:

- Local Guess Color works.
- Local 鋤大DEE starts, deals 13 cards to each seat, and AI turns progress.
- Local 鬥地主 starts, bidding resolves, bottom cards reveal, and AI turns progress.
- Empty username is rejected for multiplayer.
- Special-character username is rejected for multiplayer.
- Host creates a 4-digit Party Room.
- Joiner enters room lobby and can chat.
- Queue toggle updates the queue list.
- Host starts Guess Color with queued users and joiner enters the game without waiting forever.
- Extra or unqueued users remain spectators.

## Agent Notes

Read these before changing room or game lifecycle code:

- `docs/AGENT_LOGIC.md`
- `docs/ROOM_SPEC.md`
