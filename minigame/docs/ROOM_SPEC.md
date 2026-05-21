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
      joinedAt: serverTimestamp
    }
  },
  spectators: {
    [clientId]: {
      name: string,
      role: 'spectator',
      online: boolean,
      authUid: string,
      joinedAt: serverTimestamp
    }
  },
  offers: {
    [clientId]: { from: string, sdp: string, createdAt: serverTimestamp }
  },
  answers: {
    [clientId]: { from: string, sdp: string, createdAt: serverTimestamp }
  },
  gameStart: null | GameStart
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

## Refresh And Resume

Browser refresh cannot preserve the old WebRTC DataChannel, but the app can
preserve the room identity and automatically rebuild WebRTC.
The current implementation supports Level 1 resume: room/seat restore plus
automatic WebRTC rebuild. Full game action history restore is not implemented.

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
