# MiniGame App README

This document describes the static mini-game app served from the repository
root by GitHub Pages.

## Architecture

- `index.html`: SPA shell and screen containers.
- `admin.html`: lightweight Firebase room monitor for room status, AI takeover,
  history, and room leaderboard.
- `css/common.css`: shared layout, buttons, cards, toast, input styles.
- `css/lobby.css`: lobby, room, game selection, and mode selection UI.
- `js/common.js`: shared utilities.
- `js/roomSession.js`: `localStorage` room resume ticket helper.
- `js/firebaseConfig.js`: safe empty Firebase config stub.
- `js/firebaseConfig.generated.js`: GitHub Pages runtime config generated from the `FIREBASE_CONFIG_JSON` secret.
- `js/firebaseConfig.local.js`: optional local-only Firebase config ignored by git.
- `js/signaling.js`: Firebase Realtime Database party room, queue, chat, actions, and snapshots.
- `js/roomSeating.js`: pure queue, spectator, and AI-fill seating rules.
- `js/admin.js`: Admin monitor page logic.
- `js/gameManager.js`: game registration and lifecycle.
- `js/lobby.js`: local play and Firebase Party Room flow.
- `games/<gameId>/<gameId>.js`: game logic and rendering.
- `games/<gameId>/<gameId>.css`: game-specific styles.

Related Firebase files:

- `firebase.json`: points Firebase CLI at the RTDB rules file.
- `database.rules.json`: friends-only MVP validation for room codes, users, signaling, room start state, game state, and fallback game actions.

## Project Tree

The app is kept as a standalone static GitHub Pages project:

- Project settings: root `README.md`, `firebase.json`, `database.rules.json`, `.gitignore`.
- Static app entry: `index.html`.
- Shared styles: `css/`.
- App shell and room flow: `js/lobby.js`, `js/gameManager.js`.
- Firebase / RTDB layer: `js/firebaseConfig.js`, `js/signaling.js`.
- Room helpers: `js/roomSession.js`, `js/roomSeating.js`.
- Shared UI utilities: `js/common.js`.
- Games: `games/<gameId>/`.
- Admin monitor: `admin.html`, `js/admin.js`.
- Tests: `tests/`.
- Agent / technical docs: `docs/`.

There is a single Guess Color implementation at `games/guessColor/`. No game owns a separate Chatroom implementation; room chat is centralized in Lobby + Signaling.

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

Chatroom is a standard room capability. The lobby, game screen, and in-room
result screens use the same Firebase chat stream. Room lifecycle events and
public game actions are written into chat; hidden information such as other
players' hands, deck order, non-public draws, and Guess Color secret answers is
not written to chat.

Detailed chat contract:

```text
docs/CHATROOM_SPEC.md
```

Current MVP completion status:

```text
docs/MVP_STATUS.md
```

Party Rooms use Firebase as the room and round authority. Firebase works over
WAN, so friends do not need to be on the same LAN.
Guess Color, 鋤大DEE, 鬥地主, 21點, 2048, 轉色牌, 冚棉胎, 9Upper, 百家樂, and 大小 room play are Firebase-first: non-host clients write actions to `gameActions`, the host applies them, and `gameState` becomes the source of truth for board/turn/result updates.
The host removes each `gameActions/{actionId}` after processing or discarding it, so old fallback actions do not replay forever.
Refresh resume is Firebase-only: the same browser returns to the same room and
restores active game state from `gameStart` and `gameState`.
The same stable browser `clientId` is also used for room-code re-entry, so a
disconnected player can enter the same 4-digit code and resume their member
record.

Room lobby has a compact debug panel:

- `狀態`: Firebase room lifecycle.
- `傳輸`: always Firebase.
- `房主`: current host display name.
- `回合`: active round id suffix.
- `隊列`: queued users.
- `Queue`: pending Firebase action count.

Room seating is centralized in `App.RoomSeating.build(roomState, gameDef)`.
Queued online users are seated by `queuedAt` up to `maxPlayers`; overflow users
remain queued and spectate this round. Explicit watchers also spectate this
round. Unqueued users stay in the room lobby. AI seats are added only when
`aiFill: true`.

## Big Dee MVP

`bigDee` supports local single-player and short-code room play.

- `supportsSingle: true`
- `supportsMultiplayer: true`
- `maxPlayers: 4`
- `minRoomPlayers: 2`
- `aiFill: true`
- Four seats: real players first, then AI fill.
- Queued extra room members become spectators/queue; unqueued members remain in
  the room lobby.
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
- Queued extra room members become spectators/queue; unqueued members remain in
  the room lobby.
- Uses 54 cards with small joker and big joker.
- Bidding supports pass, 1, 2, and 3 points.
- Highest bidder becomes landlord and receives the 3 bottom cards.
- Supports the standard 13 hand families listed in the game spec, including rocket, bombs, straights, pair chains, airplanes, and four-with-two.
- Bombs and rockets double the final multiplier.
- AI reads all hands and uses a teammate-aware strategy instead of random play.

## Blackjack MVP

`blackjack` supports local single-player and short-code room play.

- `supportsSingle: true`
- `supportsMultiplayer: true`
- `minPlayers: 1`
- `minRoomPlayers: 1`
- `maxPlayers: 6`
- `allowSpectators: true`
- `aiFill: false`
- Every seated player plays their own hand against the same dealer.
- Dealer hits until 17 or above.
- Aces count as 11 when possible, otherwise 1.
- Room players submit hit/stand actions through Firebase `gameActions`; the host
  applies them and publishes `gameState`.
- Results write room history and room leaderboard deltas.

## 2048 MVP

`tile2048` supports local single-player and short-code room play.

- `maxPlayers: 8`
- `minRoomPlayers: 1`
- `aiFill: false`
- Single-player uses a normal private 2048 board.
- Room mode uses one shared cooperative board; queued players rotate one move at a time.
- There is no max tile cap; 4096, 8192, 16384 and beyond remain playable.
- Single-player active progress is saved locally and can be resumed after refresh.
- Reverse restores the previous board snapshot, with up to 50 steps retained.
- Room round ends when the shared board is stuck.

## Color Shift MVP

`colorShift` is an UNO-like card game without using the UNO brand.

- `maxPlayers: 6`
- `minRoomPlayers: 2`
- `aiFill: true`
- Supports numbers, skip, reverse, draw two, wild, and wild draw four.

## Baccarat MVP

`baccarat` supports local single-player and short-code room play.

- `maxPlayers: 6`
- `minRoomPlayers: 1`
- `aiFill: false`
- Every seated player starts with `$1000`.
- Each round accepts `$100-$500` bets on 閒, 莊, or 和.
- The house/banker hand is AI-controlled by the game state, not a human player.
- Public deals and settlement are written to room chat and history.

## Sic Bo / 大小 MVP

`sicBo` supports local single-player and short-code room play.

- `maxPlayers: 8`
- `minRoomPlayers: 1`
- `aiFill: false`
- Every seated player starts with `$1000`.
- Each round accepts `$50-$500` bets on 大 or 小.
- Triples are treated as house wins against 大/小 bets.
- Public dice results and settlement are written to room chat and history.
- Click playable cards directly; draw when blocked.
- Wild cards auto-pick the color most common in the player's remaining hand.

## Snap Stack MVP

`snapStack` is the casual 冚棉胎 MVP.

- `maxPlayers: 8`
- `minRoomPlayers: 2`
- `aiFill: true`
- Players rotate flipping cards from a shared deck.
- If the latest two cards share a rank, anyone can press `冚`; correct slap
  scores the pile, wrong slap loses one point.
- Firebase arrival order decides room slap order; this is casual, not a strict
  latency-fair competitive mode.

## 9Upper MVP

`nineUpper` is a prompt-answer-vote party game.

- `maxPlayers: 6`
- `minRoomPlayers: 2`
- `aiFill: true`
- Built-in prompt deck, anonymous answer reveal, voting, and five-round scoring.
- Single-player uses bot answers and bot votes.

## Global Game Contract

All new games should declare:

- `minPlayers`: minimum human player seats before AI fill.
- `maxPlayers`: legal player seat cap; extra room members become spectators.
- `allowSpectators: true` unless a game has a hard reason to block watching.
- `aiFill: true` when empty player seats can be filled by AI.

Room games should treat spectators as read-only full-state viewers. When a game
uses AI fill, AI should make the best available decision from known state rather
than random legal moves.

During room play, every game must also support these disconnect semantics:

- `room_update.players` may mark a real player as `online: false`.
- If an offline real player owns a seat, the active host should treat that seat
  as AI-controlled until the player returns.
- If `room_update.isHost` changes to true, the game instance is now the room
  authority and must process actions, schedule AI, and publish snapshots.
- When the disconnected player returns, the same seat should become human
  controlled again.

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
node tests/run-tests.js
node --check js/firebaseConfig.js
node --check js/signaling.js
node --check js/lobby.js
node --check games/guessColor/guessColor.js
node --check games/bigDee/bigDee.js
node --check games/douDizhu/douDizhu.js
node --check games/blackjack/blackjack.js
node --check games/tile2048/tile2048.js
node --check games/colorShift/colorShift.js
node --check games/snapStack/snapStack.js
node --check games/nineUpper/nineUpper.js
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
- Queued overflow users and explicit watchers remain spectators; unqueued users
  remain in the room lobby.
- If a non-host player refreshes/leaves mid-card-game, host sees AI takeover and
  the game continues.
- If the host refreshes/leaves while another browser is online, host authority
  migrates and the game continues.
- `admin.html` shows rooms, online members, AI takeover state, history,
  and leaderboard rows.

## Agent Notes

Read these before changing room or game lifecycle code:

- `docs/AGENT_LOGIC.md`
- `docs/ROOM_SPEC.md`
- `docs/PLATFORM_SPEC.md`
- `docs/UI_UX_BACKLOG.md`
- `games/tile2048/rules.md`
- `games/tile2048/state-machine.md`
- `games/blackjack/rules.md`
- `games/blackjack/state-machine.md`
