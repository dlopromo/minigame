# Party Room Flow Debug Guide

This note documents the current multiplayer room flow so future agents can debug quickly without re-learning the architecture.

## 1. Core State Sources

Room state is synchronized through Firebase RTDB under `rooms/{code}`:

- `status`: `lobby | starting | playing | closed`
- `roundId`: current round id
- `gameStart`: launch payload (`gameId`, `mode`, `players`, `spectators`, `rolesByClientId`, `initialState`)
- `gameState`: host-authored snapshot from active game
- `gameActions`: guest->host action queue
- `members/{id}`: `presence`, `queueStatus`, `online`, profile
- `queue/{id}`: queue order for player seats

Single source of truth:

1. Lobby decides room lifecycle (`status`, `roundId`, seat assignment).
2. Host is authority for processing `gameActions`.
3. Active game host writes `gameState`.

## 2. Entry / Re-entry Rules

Re-entry must always start neutral:

- `presence = lobby`
- `queueStatus = none`

No auto-queue on reconnect.

## 3. Queue vs Spectator

Player intent model:

1. User joins room -> stays in lobby (not auto-queue, not auto-spectate).
2. User clicks `加入隊列` to join seats.
3. User clicks `觀戰本局` to explicitly spectate.
4. Leaving queue does not force spectate; returns to lobby presence.

## 4. Game Launch Gate

Room can auto-open game screen only when:

- `status === playing`
- `gameStart` exists and has `gameId`, `mode`
- self role is `player`, or self is explicit spectator (`presence === spectating` or queued spectator policy)

Users not in this round should remain in room lobby screen.

## 5. Exit Semantics

In room mode:

- Top-right `X` -> `App.Lobby.handleGameCloseAction()`
- Host `X`: immediate `endRoomRound('host_return_lobby')` sync for all players
- Guest `X`: mark current `roundId` as locally left, set member presence back
  to `lobby`, and return this browser to the room lobby without closing the
  room.
- A player who leaves the active round but stays online should be treated as
  AI-controlled by turn/card games until a future round starts.

Outside room mode:

- `X` -> normal `App.GameManager.endGame()`

## 6. Action Queue Contract

Guest game action must be sent with current `roundId`:

- `App.Lobby.sendRoomGameAction({ ...payload })`
- Lobby wrapper attaches `roundId`, `gameId`, `mode`

Host processing constraints:

1. Ignore if no payload.
2. Ignore and clear if missing `roundId`.
3. Ignore and clear if `action.roundId !== roomState.roundId`.
4. Process once only (`roomActionIds[actionId]`).

## 7. Known Desync Symptoms and Checks

### Symptom A: "P1 submitted, P2 stuck"

Check:

1. Does host process `gameActions` continuously (not only on host promotion)?
2. Are incoming actions filtered out by self-id incorrectly?
3. Is action missing `roundId`?
4. Does game host publish new `gameState` after applying action?

### Symptom B: "random return to lobby/home"

Check:

1. `handleRoomState(null)` should use debounce/grace window.
2. `gameActive` + room `status` transitions should call `endGame(..., noCallback:true)` to avoid callback races.
3. Ignore stale game end callbacks when local round id no longer matches room round id.

### Symptom C: "host exits game, others not synced"

Check:

1. Host close action path must call `endRoomRound`.
2. Result page "return room" button must use same close path.

## 8. Minimal Manual Regression Checklist

1. Join room as two browsers.
2. Confirm reconnect does not auto-queue.
3. Toggle spectate manually; verify no forced game entry when not queued/spectating.
4. Start GuessColor coop:
   - P1 submit -> P2 can submit next.
5. Start BigDee:
   - P1 play/pass -> P2 turn progresses.
6. Host presses game `X`:
   - both clients return to room lobby.
7. Keep game select screen open 1-2 minutes:
   - no unexpected return home.

## 9. Files Most Relevant to Multiplayer Bugs

- `js/lobby.js`
- `js/signaling.js`
- `js/roomSeating.js`
- `games/guessColor/guessColor.js`
- `games/bigDee/bigDee.js`
