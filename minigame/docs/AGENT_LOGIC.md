# MiniGame Agent Logic Notes

This document records the current implemented behavior so future agents can understand the app without re-discovering the full flow from scratch.

Related room lifecycle specs:

- `minigame/docs/ROOM_SPEC.md`
- `minigame/docs/ROOM_RESUME_SPEC.md`

## Architecture

- `index.html` owns the static screens and loads scripts in this order:
  Firebase compat CDN, `common.js`, `roomSession.js`, `firebaseConfig.js`, `signaling.js`, `webrtc.js`, `gameManager.js`, game modules, then `lobby.js`.
- `App.Common` owns shared UI utilities:
  toast display, clipboard copy, SDP encode/decode, and screen switching.
- `App.WebRTC` owns peer connection setup and the data channel.
  It supports the original single peer connection and the newer host-mesh peer map.
  It uses public STUN servers so Firebase-signaled peers can connect across WAN
  when NAT traversal succeeds. TURN is not configured.
- `App.Signaling` owns Firebase Realtime Database room signaling for 4-digit numeric room codes.
  It uses Anonymous Auth and stores temporary room/lobby/round-start/SDP data.
  Firebase `auth.uid` is stored as metadata, but room seats use a stable browser client id so refresh can resume the same seat.
  It also exposes Firebase `gameActions` as room-mode action delivery. Host
  deletes processed actions so the queue does not become history.
- `App.RoomSession` owns the `localStorage` resume ticket used by short-code rooms.
- `App.GameManager` registers games and starts the active game module in `#game-container`.
- `App.Lobby` owns app-level flow:
  local play, multiplayer connection, game selection, multiplayer mode selection, and launching games.
- Each game module owns its own rules, rendering, and `game_msg` message handling.

## Lobby Flow

The home screen has three entry points:

- `本機遊玩`
  - Sets lobby context to `single`.
  - Shows game selection.
  - Starts selected game with `mode: "single"`.
- `短碼房間`
  - Uses Firebase RTDB when `js/firebaseConfig.js` is filled.
  - Host creates a 4-digit numeric room code.
  - Joiners enter the room code and a required username.
  - Lobby stores users under `players` or `spectators`.
  - Host creates a WebRTC data channel to each online non-host user.
  - Host chooses game and mode, writes `gameStart` to Firebase, then launches the game.
- `手動雙人`
  - Shows the manual WebRTC offer/answer flow.
  - Host creates an offer.
  - Joiner pastes the offer and creates an answer.
  - Host accepts the answer.
  - After the data channel opens, host chooses game and mode.

After multiplayer connection opens:

- Both peers exchange `{ type: "player_info", name }`.
- Host sees multiplayer game selection.
- Joiner sees waiting screen.
- Host selects a game.
- Lobby sends `{ type: "game_select", gameId }`.
- If the game has more than one multiplayer mode, host chooses mode.
- Lobby sends:
  - `{ type: "mode_select", mode }`
  - `{ type: "game_start", gameId, mode }`
- Both peers then call `App.GameManager.startGame(gameId, opts)`.

Current Guess Color multiplayer modes:

- `coop`: cooperative turn-based play.
- `race`: simultaneous race play.

Current Big Dee / 鋤大DEE mode:

- `single`: local four-seat game, human player versus AI fill.
- `room`: short-code room play, real players seated first, empty seats filled by
  AI, extras as spectators/queue. Host applies actions and writes `gameState`.

Current Dou Dizhu / 鬥地主 mode:

- `single`: local three-seat game, human player versus AI fill.
- `room`: short-code three-player room play, real players seated first, empty
  seats filled by AI, extras as spectators/queue. Four-player 鬥地主 is out of
  scope. Host applies bids/plays/passes and writes `gameState`.

## WebRTC Message Layers

Short-code room state:

- `rooms/{roomCode}`
  - `hostId`
  - `status`: `"lobby"`, `"starting"`, or `"playing"`
  - `gameId`
  - `mode`
  - `roundId`
  - `maxPlayers`
  - `players/{clientId}`
  - `spectators/{clientId}`
  - `offers/{clientId}`
  - `answers/{clientId}`
- `gameStart`
- `gameState`
  - `gameActions/{actionId}`

`gameStart` is the authoritative start payload in short-code rooms:

- `gameId`
- `mode`
- `roundId`
- `hostId`
- `players`
- `spectators`
- `rolesByClientId`
- `initialState`

Games should use `initialState` to enter the first game screen in short-code rooms.
They must not wait for WebRTC `round_start` before rendering the round.
They must also ignore WebRTC `game_start` while in short-code room context.
Firebase `gameStart` is the only room-start authority so each client builds a
payload with its own `selfId`, role, and player name.

Room roles:

- `player`
  - Can interact with the active game.
- `spectator`
  - Can watch with a full god view.
  - Cannot submit game actions.
  - Joins as spectator when the game is full or already started.

During an active short-code room game, lobby watchers forward Firebase room
membership changes into the active game as a local `room_update` message. Games
should refresh room info UI from `players` and `spectators` without treating it
as an in-game action.
The same `room_update` payload includes `gameState`, so games can restore or
refresh their Firebase snapshot.

Top-level lobby messages:

- `player_info`
  - Payload: `{ name }`
  - Updates opponent display name.
- `game_select`
  - Payload: `{ gameId }`
  - Lets joiner know the host selected a game.
- `mode_select`
  - Payload: `{ mode }`
  - Informational mode selection message.
- `game_start`
  - Payload: `{ gameId, mode, room? }`
  - Starts the selected game on the receiving peer.
- `game_msg`
  - Payload: arbitrary game-owned message.
  - Routed to `App.GameManager.handleMessage`.

Game modules should only send game-specific messages through:

```js
App.WebRTC.send({ type: 'game_msg', payload: msg });
```

In short-code rooms, correctness is Firebase-first. Guess Color non-host clients
send game actions through `App.Lobby.sendRoomGameAction()`, which writes
`rooms/{code}/gameActions`. Host watches those actions, applies them locally,
and writes `gameState`. Processed and stale actions are removed by the host after
handling. WebRTC can still exist in the room, but the game must not depend on it
for turn progression.

Short-code room lobby has a Room Info panel:

```text
狀態 / 傳輸 / 房主
回合 / Peers / Queue
```

Use this first when debugging stuck rooms. A rising `Queue` means fallback
actions are arriving but not being cleared; `Firebase` transport means the room
is relying on RTDB fallback rather than an open WebRTC data channel.

## Guess Color Shared Rules

Guess Color is a 4-slot color code game.

- Colors: red, blue, yellow, green, orange, purple.
- Repeated colors are allowed.
- Feedback pegs:
  - Green: correct color and correct position.
  - Orange: correct color but wrong position.
  - Light gray: no match.
- A guess is scored using the usual Hit & Blow logic:
  - First count exact position matches.
  - Then count remaining color-only matches.
- Selecting an already-filled input peg removes it and makes that slot active again.

## Big Dee MVP

鋤大DEE is registered as `bigDee`.

- Local single-player only for now.
- Four seats: human player plus `AI 1`, `AI 2`, and `AI 3`.
- Deck order:
  - Rank low to high: `3,4,5,6,7,8,9,10,J,Q,K,A,2`.
  - Suit low to high: `♦, ♣, ♥, ♠`.
- Deal:
  - 52 cards shuffled locally.
  - Each seat receives 13 cards.
  - Holder of `3♦` starts.
  - First play must include `3♦`.
- Supported hands:
  - Single.
  - Pair.
  - Triple.
  - Five-card hands: straight, flush, full house, four of a kind, straight flush.
- Straight rules:
  - `A2345` is the largest straight.
  - `23456` is the second largest straight.
  - `10JQKA` is the third largest straight.
  - `34567` is the smallest straight.
  - If two straights use the same ranks, compare the suit of the highest-ranked card used for that straight pattern.
- Turn rules:
  - If there is an active previous play, players must play the same card count
    and beat it, or pass.
  - A player cannot pass when opening a new round.
  - When every other active player passes, the last player who played cards opens
    the next round freely.
  - First player to empty their hand ends the game immediately.
- Opening rule:
  - First local round uses `3♦` holder starts and first play must include `3♦`.
  - In local rematches with the same four seats, the previous winner starts and
    may play any legal hand.
- Scoring:
  - Base stake is `1`.
  - Loser base loss is remaining cards times multiplier.
  - Multipliers: fewer than 8 cards x1, 8 or more x2, 10 or more x3, 13 x4.
  - Result screen shows score delta and top-card penalty notes.
- Top-card / 頂大:
  - If the next player has one card left, the current player should play their
    strongest legal response.
  - Human player is not blocked from violating this; the violation is recorded
    and scored at result time.
  - AI automatically plays the strongest legal response in this situation.
- AI:
  - Uses the same `analyze()` and `compareCombos()` rule path as the player.
  - Plays the smallest legal response.
  - In a top-card situation, plays the strongest legal response.
  - Opens with the lowest-cost legal hand, so the first AI opener with `3♦` will
    usually play single `3♦`.
  - No memory or advanced defensive play yet.

## Dou Dizhu MVP

鬥地主 is registered as `douDizhu`.

- Local single-player only for now.
- Three seats: human player plus `AI 1` and `AI 2`.
- Deck:
  - 54 cards.
  - Normal card order: `3,4,5,6,7,8,9,10,J,Q,K,A,2`.
  - Jokers: small joker, big joker; big joker is highest.
  - Suits do not affect comparison.
- Deal:
  - 17 cards to each player.
  - 3 bottom cards stay hidden during bidding.
- Bidding:
  - Current options are pass, 1, 2, and 3.
  - Highest bidder becomes landlord.
  - Landlord receives the 3 bottom cards.
  - Bottom cards are then visible.
- Supported hand families:
  - Single.
  - Pair.
  - Triple.
  - Triple with single.
  - Triple with pair.
  - Straight: at least 5 cards, `3` through `A`; no `2` or jokers.
  - Pair chain: at least 3 consecutive pairs; no `2` or jokers.
  - Triple chain.
  - Airplane with singles.
  - Airplane with pairs.
  - Bomb.
  - Rocket.
  - Four with two singles.
  - Four with two pairs.
- Play rules:
  - Landlord leads first.
  - Follow with same type/shape and higher primary rank.
  - Rocket beats all.
  - Bomb beats all non-rocket, non-bomb hands and can be beaten by bigger bombs.
  - Two consecutive passes reset the trick and the last player leads freely.
- Scoring:
  - Base score is the winning bid.
  - Each bomb or rocket doubles the multiplier.
  - Landlord wins or loses against each farmer; farmers share the same result.
- AI:
  - AI can inspect all hands.
  - Farmers avoid covering a farmer teammate unless they can finish or the landlord is dangerous.
  - AI prioritizes finishing, blocking near-empty landlord/farmers, and then lowest-cost legal play.

## Global Game Contract

Every existing and future game should preserve these room assumptions:

- Declare `minPlayers`, `maxPlayers`, `allowSpectators`, and `aiFill`.
- Extra room members above `maxPlayers` become spectators.
- If the game can start below `maxPlayers`, fill empty seats with AI when `aiFill`
  is true.
- Spectators are read-only and may receive full-state views for friends-only play.
- AI should use the known game state to choose the most beneficial legal move,
  not random legal moves.
- Main gameplay UI must be designed around iPhone 16 Pro portrait with no page
  vertical scrolling; PC/tablet layouts should rebalance space instead of merely
  scaling the mobile layout.

## Guess Color Single Mode

Single mode behavior:

- Local browser generates the computer code.
- Player guesses alone.
- Maximum attempts: `MAX_ROWS` currently equals `12`.
- Game ends when:
  - Player gets 4 hits, or
  - Player reaches 12 guesses.
- Result screen shows:
  - Win/loss.
  - Computer answer.
  - Full local guess history.

## Guess Color Coop Mode

Coop mode behavior:

- Host generates one computer code.
- Manual two-player mode sends it to joiner using `round_start`.
- Short-code room mode stores it in `gameStart.initialState.computerCode`.
- Host starts first.
- Players alternate turns.
- There is no 12-guess failure limit.
- The board only displays the latest visible rows, but the result history keeps all guesses.
- Game ends when either player gets 4 hits.
- Both players see the same computer answer.
- Result screen shows the merged turn history.

Coop game messages:

- `round_start`
  - Payload: `{ code }`
  - Sent by host when a multiplayer round starts.
- `coop_guess`
  - Payload: `{ colors, hits, blows, code? }`
  - Sent after a coop guess.
  - `code` is included when the guess ends the game.
- `game_over`
  - Payload: `{ winner: "team", code }`
  - Ends the coop round for the peer.

## Guess Color Race Mode

Race mode behavior:

- Host generates one computer code.
- Manual two-player mode sends it to joiner using `round_start`.
- Short-code room mode stores it in `gameStart.initialState.computerCode`.
- Both players can guess at the same time.
- There is no turn lock.
- First player to guess 4 hits wins.
- Attempts are statistics only; fewer attempts does not beat a faster finish.
- During the race, the opponent panel only shows:
  - Opponent attempt count.
  - Opponent elapsed time.
  - Whether opponent has finished.
- It does not reveal opponent guess colors during play.
- Result screen shows:
  - Winner/loser text.
  - Both players' attempts and elapsed time.
  - Computer answer.
  - Local guess history and opponent guess history.

Race game messages:

- `round_start`
  - Payload: `{ code }`
  - Sent by host when a race starts.
- `race_progress`
  - Payload: `{ attempts, elapsed, finished }`
  - Sent after every local guess.
  - Used only for the compact opponent status panel.
- `race_finish`
  - Payload: `{ attempts, elapsed, guesses, code }`
  - Sent when a player finishes.
  - Ends the race for the opponent and supplies final history.

## Guess Color Spectator Mode

Guess Color accepts `opts.role`.

- `role: "player"`
  - Normal interactive gameplay.
- `role: "spectator"`
  - Input panel is hidden.
  - Guess submission and rematch are disabled.
  - The computer answer is shown during the round.
  - Incoming game messages still update the visible board/result state.

## Rematch Behavior

- Single rematch:
  - Generates a new local code.
  - Starts a fresh single round.
- Multiplayer rematch:
  - Non-host sends `rematch` and waits.
  - Host receives `rematch`, generates a new code, sends `round_start`, and starts the new round.
  - Host can also press rematch directly and start a new round.
- Short-code room rematch currently returns to room/lobby flow rather than using direct in-game rematch.

## Username Rules

- Multiplayer username is required.
- Trimmed username must not be empty.
- Username is capped at 12 characters.
- Username may only contain Chinese characters, English letters, or digits.
- Spaces, punctuation, emoji, and symbols are rejected before joining any
  multiplayer flow.
- Render usernames using `textContent` or escaping helpers.
- UI should show the full 12-character value when possible and use ellipsis only when space is constrained.

## UI Principles

The current design direction is Office Calm:

- Light background.
- Minimal controls.
- No dark board.
- No decorative secret rack.
- Compact game surface for work-break play.
- iPhone-like `402 x 680` viewport should not require page scrolling during the main game.
- Desktop keeps the color picker below the board.

## Known Constraints

- Short room codes require Firebase config in `js/firebaseConfig.js`.
  Without it, the short-code UI stays visible but shows a setup warning.
- Host-generated answer is shared with the peer.
  This is acceptable for friendly play but is not cheat-resistant.
- Short-code multiplayer uses host mesh and has no host migration.
- Short-code rooms support refresh resume: same room, same seat, automatic WebRTC rebuild.
- Guess Color supports Level 2 snapshot restore through Firebase `gameState`.
- Firebase is signaling/lobby only; it is not an authoritative game server.
- Full multi-tab Firebase/WebRTC behavior should be manually tested with a real Firebase project before release.
- `.DS_Store` may appear locally and should not be committed unless intentionally ignored or removed.
