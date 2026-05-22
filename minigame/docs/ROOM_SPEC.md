# MiniGame Room Spec

This spec describes the Firebase short-code room flow used by multiplayer games.

## Goals

- Let friends join with a 4-digit room code.
- Keep GitHub Pages as a static frontend.
- Use Firebase RTDB as room and round-start state.
- Use WebRTC DataChannel for in-game sync.
- Support future games with different player counts and spectator views.

## Room Code

- Room codes are random 4-digit numeric strings.
- Valid examples: `0000`, `1042`, `9876`.
- Join input accepts digits only.
- Less than 4 digits is invalid.
- Room path: `rooms/{roomCode}`.

## Username

- Username is required for all multiplayer entry points.
- Trim before validation.
- Empty or all-space values are invalid.
- Maximum length is 12 characters.
- Allowed characters are Chinese characters, English letters, and digits.
- Spaces, punctuation, emoji, and symbols are invalid.
- UI may use ellipsis if the container is too small, but game logic must keep the normalized name.
- Never render username with raw `innerHTML`.

## Room Schema

```js
rooms/{roomCode}: {
  hostId: string,
  status: 'lobby' | 'starting' | 'playing',
  gameId: string,
  mode: string,
  roundId: string,
  maxPlayers: number,
  createdAt: serverTimestamp,
  updatedAt: serverTimestamp,
  players: {
    [clientId]: {
      name: string,
      role: 'player',
      online: boolean,
      authUid: string,
      joinedAt: serverTimestamp,
      lastSeenAt: serverTimestamp,
      connectionVersion: number
    }
  },
  spectators: {
    [clientId]: {
      name: string,
      role: 'spectator',
      online: boolean,
      authUid: string,
      joinedAt: serverTimestamp,
      lastSeenAt: serverTimestamp,
      connectionVersion: number
    }
  },
  offers: {
    [clientId]: { from: string, sdp: string, connectionVersion: number, createdAt: serverTimestamp }
  },
  answers: {
    [clientId]: { from: string, sdp: string, connectionVersion: number, createdAt: serverTimestamp }
  },
  gameActions: {
    [actionId]: {
      from: clientId,
      roundId: string,
      gameId: string,
      mode: string,
      payload: object,
      createdAt: serverTimestamp
    }
  },
  gameStart: null | GameStart,
  gameState: null | GameStateSnapshot
}
```

## GameStart Contract

`gameStart` is the authoritative start payload for short-code rooms.

```js
{
  gameId: string,
  mode: string,
  roundId: string,
  hostId: string,
  players: PlayerRecord[],
  spectators: PlayerRecord[],
  rolesByClientId: {
    [clientId]: 'player' | 'spectator'
  },
  initialState: object
}
```

Rules:

- Host creates `gameStart`.
- Clients launch a game only when `status === "playing"` and `gameStart.roundId` is present.
- Clients must not launch the same `roundId` twice.
- Games must read opening state from `initialState`.
- DataChannel `round_start` is not required for short-code rooms.
- DataChannel `game_start` is ignored in short-code rooms. This prevents a joiner
  from accidentally launching with the host's client-specific payload.
- Firebase room membership changes are forwarded locally to the active game as
  `room_update` so in-game Room Info can show current players and spectators.

## GameState Snapshot Contract

`gameState` is optional game-owned restore data for active rounds.

```js
{
  gameId: string,
  mode: string,
  roundId: string,
  updatedBy: clientId,
  updatedAt: serverTimestamp,
  state: object
}
```

Rules:

- `gameStart.initialState` still owns hidden opening state.
- `gameState.state` owns mutable in-game restore state.
- Games must ignore snapshots for another `roundId`.
- The host should write snapshots after every accepted action to avoid peers
  overwriting each other's snapshot data.
- Room return-to-lobby clears `gameState`.

Guess Color currently stores:

```js
{
  computerCode: string[],
  guesses: [
    { playerId, playerName, colors, hits, blows, elapsed, finished, createdAt }
  ],
  gameOver: boolean,
  winner: string,
  winnerPlayerId: string,
  turnClientId: string,
  raceProgressByPlayerId: {
    [clientId]: { attempts, elapsed, finished }
  },
  savedAt: number
}
```

## Status Lifecycle

```text
lobby -> starting -> playing -> lobby
```

- `lobby`: users can join, host can choose game/mode.
- `starting`: host is rebalancing seats and writing `gameStart`.
- `playing`: clients launch and play the active round.
- Back to `lobby`: host ended the game or returned to room lobby.

## Player And Spectator Assignment

- Each game declares `maxPlayers`.
- When host starts a game:
  - online users are ordered by `joinedAt`.
  - first `maxPlayers` users become players.
  - remaining users become spectators.
- Users who join after `status !== "lobby"` become spectators.
- Spectators cannot submit actions.
- Spectator visibility is game-defined; Guess Color currently shows the full answer.

## Game Definition Extensions

Multiplayer games should register:

```js
{
  maxPlayers: 2,
  multiplayerModes: ['coop', 'race'],
  buildRoomStart: function(opts) {
    return {};
  }
}
```

`buildRoomStart(opts)` receives:

```js
{
  gameId: string,
  mode: string,
  hostId: string,
  players: PlayerRecord[],
  spectators: PlayerRecord[]
}
```

It returns the game-owned `initialState`.

Guess Color example:

```js
{ computerCode: ['red', 'blue', 'green', 'orange'] }
```

Future Big Dee example:

```js
{
  deckSeed: '...',
  handsByPlayerId: {},
  publicState: {}
}
```

## WebRTC Role

- Host creates one DataChannel per non-host room client.
- Host broadcasts game messages to all peers.
- Non-host clients send messages to host.
- Firebase is not an authoritative game server; it is room state and round-start state.
- If WebRTC is delayed, the game can still render initial state from Firebase.
- WebRTC uses public STUN servers for WAN/NAT traversal. Firebase lets peers
  exchange signaling over WAN, but it does not relay DataChannel traffic.
- Some restrictive networks still require TURN; TURN is not part of this MVP.

## Firebase Game Action Fallback

Short-code room games prefer WebRTC DataChannel for `game_msg`, but non-host
clients can fall back to Firebase when the DataChannel is not open.

```text
Player action
   |
   v
Try WebRTC game_msg
   |
   +-- sent ------------------------------> host receives via DataChannel
   |
   +-- not sent
          |
          v
   Push rooms/{code}/gameActions/{actionId}
          |
          v
   Host watches gameActions
          |
          v
   Host applies payload through GameManager
          |
          v
   Host writes gameState snapshot
```

Rules:

- `gameActions` are transport fallback messages, not authoritative history.
- Host ignores actions from old `roundId`.
- Game modules should make action handling idempotent where practical.
- `gameState` remains the restore source after refresh.

## Refresh And Resume

Browser refresh cannot preserve the old WebRTC DataChannel, but the app can
preserve the room identity and automatically rebuild WebRTC.
The current implementation supports Level 2 resume for Guess Color: room/seat
restore, automatic WebRTC rebuild, and Firebase snapshot restore for guesses,
turn, race progress, and result state.

Read the detailed resume contract here:

```text
minigame/docs/ROOM_RESUME_SPEC.md
```

## Failure Modes

- Missing Firebase config: short-code room shows setup warning.
- Missing username: show `請輸入你的名字`.
- Invalid room code: show `請輸入 4 位房間碼`.
- Room not found: show `找不到房間`.
- Expired room: show `房間已過期`.
- Missing `gameStart`: stay in room lobby or show a recoverable error, never wait forever.
