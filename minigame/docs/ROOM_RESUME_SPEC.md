# Room Resume And Auto Reconnect Spec

This spec describes how short-code Firebase rooms should survive browser refresh.

The main idea:

- Refresh can keep the same room, username, and client identity.
- Refresh cannot keep the same WebRTC DataChannel alive.
- The app should hide that detail by automatically rebuilding WebRTC after restore.

## Goals

- Host refresh returns to the same room as host.
- Joiner refresh returns to the same room as the same player or spectator.
- User does not need to re-enter room code or username after refresh.
- Firebase room state remains the source of truth for room membership and game start.
- WebRTC is rebuilt automatically after refresh.
- Future games can restore initial round state from `gameStart.initialState`.

## Non-Goals

- Do not preserve the exact old WebRTC connection across refresh.
- Do not add a server-authoritative game engine.
- Do not implement host migration.
- Do not guarantee full in-game action history restore in the first version.

## Storage Contract

Use `localStorage` for a lightweight resume ticket.

```js
minigame.roomSession = {
  roomCode: '1234',
  clientId: 'stable-client-id',
  authUid: 'firebase-auth-uid',
  username: 'David',
  isHost: true,
  lastRole: 'player',
  savedAt: 1710000000000
}
```

Rules:

- `clientId` must stay stable across refresh for the same browser tab/device.
- `username` must pass the normal username validation rules.
- `roomCode` must be exactly 4 digits.
- Clear the ticket when the user explicitly leaves the room.
- Ignore stale tickets when the room is missing, expired, or the user record no longer exists.

## Refresh Reality

```text
Before refresh:

  Browser JS runtime
        |
        +-- Firebase listener alive
        |
        +-- WebRTC DataChannel alive
        |
        +-- Game UI state alive

After refresh:

  Browser JS runtime is new
        |
        +-- Firebase listener must be created again
        |
        +-- WebRTC DataChannel is gone
        |
        +-- Game UI state must be reconstructed
```

So the product promise should be:

```text
"Refresh returns you to the same room automatically."

Not:

"Refresh keeps the old peer connection alive."
```

## Resume Flow

```text
Page Load
   |
   v
App.Lobby.init()
   |
   v
Read localStorage minigame.roomSession
   |
   +-- No ticket --------------------------+
   |                                      |
   v                                      v
Show normal home screen              User starts normally

   |
   +-- Ticket exists
          |
          v
   Validate local ticket format
          |
          +-- Invalid / stale local data -> clear ticket -> home
          |
          v
   App.Signaling.resumeRoom(ticket)
          |
          +-- Room missing / expired ------> clear ticket -> home + toast
          |
          +-- User no longer in room ------> clear ticket -> home + toast
          |
          v
   Reattach Firebase listeners
          |
          v
   Mark user online
          |
          v
   Render room lobby OR active game from Firebase room state
```

## Host Resume Flow

```text
Host refreshes
   |
   v
Load resume ticket: isHost = true
   |
   v
Sign in anonymously
   |
   v
Recover stable clientId
   |
   v
Read rooms/{roomCode}
   |
   +-- hostId != clientId
   |      |
   |      v
   |   Cannot resume as host
   |      |
   |      v
   |   Clear ticket -> home
   |
   v
Mark host online
   |
   v
Watch room state
   |
   v
For every online non-host member:
   |
   v
Create new WebRTC offer
   |
   v
Write rooms/{code}/offers/{peerId}
   |
   v
Accept answers as they appear
   |
   v
Room continues
```

## Joiner Resume Flow

```text
Joiner refreshes
   |
   v
Load resume ticket: isHost = false
   |
   v
Sign in anonymously
   |
   v
Recover stable clientId
   |
   v
Read rooms/{roomCode}
   |
   +-- clientId found in players/spectators
   |      |
   |      v
   |   Mark online
   |
   +-- clientId not found
          |
          v
       Cannot safely resume
          |
          v
       Clear ticket -> home

After mark online:
   |
   v
Watch rooms/{code}/offers/{clientId}
   |
   v
When host writes offer:
   |
   v
Create WebRTC answer
   |
   v
Write rooms/{code}/answers/{clientId}
   |
   v
DataChannel opens automatically
```

## Active Game Resume

```text
Room state after resume
   |
   +-- status = lobby
   |      |
   |      v
   |   Render room lobby
   |
   +-- status = starting
   |      |
   |      v
   |   Render room lobby with "starting" status
   |
   +-- status = playing AND gameStart exists
          |
          v
   Build client-specific game opts:
          |
          +-- selfId
          +-- role
          +-- players
          +-- spectators
          +-- gameId
          +-- mode
          +-- roundId
          +-- initialState
          |
          v
   Start game from Firebase gameStart
```

Important:

- Short-code room games must not wait for WebRTC `round_start`.
- Short-code room games must ignore WebRTC `game_start`.
- If WebRTC is not open yet, the game can render, but interactive actions may need a "reconnecting" disabled state.

## Reconnect Version

To make repeated refreshes reliable, each client should write a connection version.

```js
players/{clientId}: {
  online: true,
  connectionVersion: 5,
  lastSeenAt: serverTimestamp
}
```

Same for `spectators/{clientId}`.

Host behavior:

```text
Room member appears online
   |
   v
connectionVersion changed OR no open DataChannel
   |
   v
Create new offer for that client
   |
   v
Write offer with matching connectionVersion
```

Joiner behavior:

```text
Resume starts
   |
   v
Increment own connectionVersion
   |
   v
Wait for offer that matches current or newer version
   |
   v
Create answer
```

## Game State Restore Levels

### Level 1: Room Resume

This is the recommended MVP.

```text
Refresh
   |
   v
Return to same room
   |
   v
Auto rebuild WebRTC
   |
   v
Render current game from gameStart.initialState
```

Limit:

- Guess Color answer survives because it is in `gameStart.initialState`.
- Guess history and current turn may not fully restore unless they are stored elsewhere.

### Level 2: Game Snapshot Restore

Store game-owned snapshots in Firebase.

```js
rooms/{roomCode}/gameState: {
  roundId: string,
  updatedBy: clientId,
  updatedAt: serverTimestamp,
  state: object
}
```

For Guess Color this could include:

```js
{
  guesses: [
    { playerId: '...', colors: ['red','blue','green','yellow'], hits: 1, blows: 2 }
  ],
  turnClientId: '...',
  finished: false,
  winner: null
}
```

Use this only after Level 1 is stable.

## Recommended MVP Implementation Tasks

Implemented Level 1:

1. `App.RoomSession` helper around `localStorage`.
2. `App.Signaling` reuses a stored `clientId`.
3. `resumeRoom(ticket)` in `App.Signaling`.
4. Room create/join saves a room session ticket.
5. Explicit leave clears the room session ticket.
6. `App.Lobby.init()` attempts resume automatically.
7. `connectionVersion` is stored on player/spectator records.
8. Host recreates offers when member connection version changes.
9. Joiner recreates answer after refresh.
10. Guess Color shows a reconnecting state while room WebRTC is not open.

Still future Level 2:

- Store full game action history in Firebase.
- Restore Guess Color guesses and current turn after refresh.
- Add game-owned snapshot contracts for future games.

## Safety Notes

- Do not trust localStorage alone; always verify the Firebase room record.
- Do not let a refreshed joiner become host unless `room.hostId === clientId`.
- Do not create a new player record during resume if the original `clientId` is missing.
- Do not clear `gameStart` during resume.
- Do not start a second copy of the same `roundId`.
