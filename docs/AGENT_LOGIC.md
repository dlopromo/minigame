# MiniGame Agent Logic Notes

This document records the current implemented behavior so future agents can understand the app without re-discovering the full flow from scratch.

Related room lifecycle specs:

- `docs/ROOM_SPEC.md`
- `docs/ROOM_RESUME_SPEC.md`

## Architecture

- `index.html` owns the static screens and loads scripts in this order:
  Firebase compat CDN, `common.js`, `roomSession.js`, `firebaseConfig.js`, `signaling.js`, `gameManager.js`, game modules, then `lobby.js`.
- `App.Common` owns shared UI utilities:
  toast display, clipboard copy, and screen switching.
- `App.Signaling` owns Firebase Realtime Database Party Rooms for 4-digit numeric room codes.
  It uses Anonymous Auth and stores room members, queue, chat, round-start data,
  Firebase actions, and snapshots.
  Firebase `auth.uid` is stored as metadata, but room seats use a stable browser client id so refresh can resume the same seat.
  It also exposes Firebase `gameActions` as room-mode action delivery. Host
  deletes processed actions so the queue does not become history.
- `App.RoomSession` owns the `localStorage` resume ticket used by short-code rooms.
- `App.GameManager` registers games and starts the active game module in `#game-container`.
- `App.Lobby` owns app-level flow:
  local play, Party Room, queue, chat, game selection, multiplayer mode selection, and launching games.
- Each game module owns its own rules, rendering, and Firebase action handling.

## Lobby Flow

The home screen has two entry points:

- `本機遊玩`
  - Sets lobby context to `single`.
  - Shows game selection.
  - Starts selected game with `mode: "single"`.
- `Party Room`
  - Uses Firebase RTDB when `js/firebaseConfig.js` is filled.
  - Host creates a 4-digit numeric room code.
  - Joiners enter the room code and a required username.
  - Lobby stores users under `members`.
  - Users press `加入隊列` to be seated in the next round.
  - Unqueued and overflow users remain spectators.
  - Room chat persists across games.
  - Host chooses game and mode, writes `gameStart` to Firebase, then launches the game.

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

## Firebase Room Layers

Short-code room state:

- `rooms/{roomCode}`
  - `hostId`
  - `status`: `"lobby"`, `"starting"`, or `"playing"`
  - `gameId`
  - `mode`
  - `roundId`
  - `maxPlayers`
  - `members/{clientId}`
  - `queue/{clientId}`
  - `chat/{messageId}`
  - `currentRound`
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

Games should use `initialState` to enter the first game screen in Party Rooms.
Firebase `gameStart` is the only room-start authority so each client builds a
payload with its own `selfId`, role, and player name.

Room roles:

- `player`
  - Can interact with the active game.
- `spectator`
  - Can watch with a full god view.
  - Cannot submit game actions.
  - Joins as spectator when the game is full or already started.

During an active Party Room game, lobby watchers forward Firebase room
membership changes into the active game as a local `room_update` message. Games
should refresh room info UI from `players` and `spectators` without treating it
as an in-game action.
The same `room_update` payload includes `gameState`, so games can restore or
refresh their Firebase snapshot.

Game modules should send non-host player actions through:

```js
App.Lobby.sendRoomGameAction(msg);
```

In Party Rooms, correctness is Firebase-first. Non-host clients send game
actions through `App.Lobby.sendRoomGameAction()`, which writes
`rooms/{code}/gameActions`. Host watches those actions, applies them locally,
and writes `gameState`. Processed and stale actions are removed by the host after
handling.

Short-code room lobby has a Room Info panel:

```text
狀態 / 傳輸 / 房主
回合 / 隊列 / Queue
```

Use this first when debugging stuck rooms. A rising action `Queue` means actions
are arriving but not being cleared by the host.

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

## 21點 MVP

21點 is registered as `blackjack`.

- Modes:
  - `single`: one human versus dealer.
  - `room`: seated players independently play against the same dealer; spectators watch.
- State machine phases:
  - `DEALING`
  - `PLAYER_TURN`
  - `PLAYER_BUST`
  - `DEALER_TURN`
  - `RESULT`
- Dealer rules:
  - Dealer draws until 17 or above.
  - Dealer second card is hidden during player turns unless the viewer is a spectator in future god-view work.
- Player actions:
  - `抽牌`
  - `停牌`
  - `推薦`
- Bust handling:
  - A bust immediately marks that player `bust`.
  - The turn advances; the game must not stall on a busted player.
- Settlement:
  - Blackjack pays `+1.5`.
  - Normal win pays `+1`.
  - Push pays `0`.
  - Loss pays `-1`.
  - Local score chips keep cumulative rounds, wins, losses, pushes, blackjacks, and points.
  - Result controls include `返回` and, where allowed, `再來一局`.

## 2048 Race MVP

2048 Race is registered as `tile2048`.

- Modes:
  - `single`: local endless 2048 with saved progress.
  - `room`: multiple players race on boards generated from the same room seed.
- There is no max tile cap. Values above 2048 continue to merge and use the
  `v-super` visual style.
- Local progress is saved to `localStorage` while the game is still playing.
- Undo:
  - Each player has an `undoStack`.
  - The stack stores board, score, move count, and max tile.
  - Maximum retained steps: 50.
- Mobile:
  - Swipe on the board maps to up/down/left/right.
  - Board uses `touch-action: none` so swiping the board does not scroll the page.
- Desktop:
  - Arrow keys and WASD move the board when the game container is focused.
- Settlement:
  - A player is done when no legal move remains.
  - Winner is highest max tile, then score, then earlier finish.

## 轉色牌 MVP

轉色牌 is registered as `colorShift`.

- It is an UNO-like game using original naming and UI, not official UNO assets.
- Card colors: red, blue, green, yellow, and wild.
- Action cards:
  - skip
  - reverse
  - draw2
  - wild
  - wild4
- UX contract:
  - Clicking a hand card only selects it.
  - The player must press `出牌` to commit.
  - `推薦` selects a legal card but never auto-submits.
  - `抽牌` advances the turn after drawing.
- AI uses the same scoring heuristic as the player suggestion, preferring finish,
  draw/wild actions, and then useful high cards.
- Single-player settlement has `返回` and `再來一局`.

## 冚棉胎 MVP

冚棉胎 is registered as `snapStack`.

- A shared deck is flipped into a central pile.
- If the last two ranks match, `snapOpen` becomes true and any active non-AI
  player can press `冚`.
- Correct slap:
  - Player gains the whole pile size as score.
  - Pile clears.
- Wrong slap:
  - Player loses 1 score.
- AI:
  - AI flips on its turn.
  - When `snapOpen` is true, an AI reacts after a short delay.
- Settlement:
  - When deck and pile are empty, highest score wins.
  - Room leaderboard receives each player score and winner.

## 9UPPER MVP

9UPPER is registered as `nineUpper`.

- It is a prompt-answer-vote party game.
- Prompt data is stored as question objects:

```js
{
  id,
  version,
  category,
  text,
  enabled
}
```

- Default question bank is original Hong Kong / office-friendly content.
- The game tracks:
  - `questionId`
  - `questionVersion`
  - `questionCategory`
  - `playedQuestionIds`
  - `questionCycle`
- Question picking:
  - Prefer enabled questions not already in `playedQuestionIds`.
  - Only reset the cycle when the enabled question pool is exhausted.
  - On reset, avoid immediately repeating the previous question when possible.
- Round flow:
  - `submit`: every player submits an answer.
  - `vote`: answers are revealed in anonymized text order; players vote.
  - `result`: votes are counted and scores are added.
  - After `maxRounds`, status becomes `settled`.

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
- Party Room mode stores it in `gameStart.initialState.computerCode`.
- Host starts first.
- Players alternate turns.
- There is no 12-guess failure limit.
- The board only displays the latest visible rows, but the result history keeps all guesses.
- Game ends when either player gets 4 hits.
- Both players see the same computer answer.
- Result screen shows the merged turn history.

Coop Firebase actions:

- `coop_guess`
  - Payload: `{ colors, hits, blows, code? }`
  - Sent after a coop guess.
  - `code` is included when the guess ends the game.
- `game_over`
  - Payload: `{ winner: "team", code }`
  - Ends the coop round for other clients through `gameState`.

## Guess Color Race Mode

Race mode behavior:

- Host generates one computer code.
- Party Room mode stores it in `gameStart.initialState.computerCode`.
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

Race Firebase actions:

- `race_progress`
  - Payload: `{ attempts, elapsed, finished }`
  - Sent after every local guess.
  - Used only for the compact opponent status panel.
- `race_finish`
  - Payload: `{ attempts, elapsed, guesses, code }`
  - Sent when a player finishes.
  - Ends the race for other clients through `gameState` and supplies final history.

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
- Party Room rematch currently returns to room/lobby flow; host starts the next
  round from the room.

## Username Rules

- Multiplayer username is required.
- Trimmed username must not be empty.
- Username is capped at 12 characters.
- Username may only contain Chinese characters, English letters, or digits.
- Spaces, punctuation, emoji, and symbols are rejected before joining any
  multiplayer flow.
- Render usernames using `textContent` or escaping helpers.
- UI should show the full 12-character value when possible and use ellipsis only when space is constrained.

## Disconnect / Host Migration Rules

Party Room authority is recoverable:

- `rooms/{code}/hostId` is the current room authority.
- `hostEpoch` increments when authority moves to another browser.
- Each browser has a stable `clientId` stored in `localStorage`, so re-entering
  the same 4-digit code from the same browser can resume the original member.
- When the current host is offline, online clients elect the earliest joined
  online member. Only that candidate attempts `App.Signaling.claimHost()`, and
  the claim uses a Firebase transaction.
- The old host returns as a normal member/player if they reconnect after host
  migration. They do not automatically regain host controls.

Game disconnect behavior:

- Lobby forwards enriched `room_update.players` into the active game.
- A real player with `online: false` should be treated as AI-controlled by the
  active host.
- When that player returns and `online` becomes true, the same seat should become
  human-controlled again.
- 鋤大DEE and 鬥地主 already convert disconnected real seats to AI and continue
  scheduling turns on the current host.
- Guess Color coop and race use a simple non-cheating random AI takeover for
  offline seats. The AI does not peek at the answer when choosing guesses.

Frontend-only limitation:

- If every browser is gone simultaneously, no client remains to archive the
  round immediately. Fully automatic all-offline archival requires Firebase
  Cloud Functions or another trusted worker.

## History / Leaderboard / Admin

- Room history lives at `rooms/{code}/history`.
- Room leaderboard lives at `rooms/{code}/leaderboard`.
- Room chat lives at `rooms/{code}/chat` and is shared by lobby, active game,
  and in-room result UI.
- Chat messages use `kind: player | system | game`.
- Games should log only public actions to chat through
  `App.Lobby.logRoomEvent('game', text, eventType)`.
- Do not write hidden data to chat: other players' hands, non-public draw
  results, deck order, secret code, hidden role, or hidden state.
- Guess Color records completion and simple win points.
- 鋤大DEE and 鬥地主 record room score deltas.
- `admin.html` is a lightweight monitor page for room state, AI takeover,
  online players, history, and leaderboard data. It is not a hardened private
  admin backoffice.

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
- Host-generated answer is stored in `gameStart.initialState`.
  This is acceptable for friendly play but is not cheat-resistant.
- Party Rooms support host migration while at least one real browser remains online.
- Party Rooms support refresh resume: same room, same member id, queue survives, and active game state restores from Firebase.
- Firebase is the room/action/snapshot transport, but it is still not a cheat-proof authoritative game server.
- Full multi-tab Firebase behavior should be manually tested with a real Firebase project before release.
- `.DS_Store` may appear locally and should not be committed unless intentionally ignored or removed.
