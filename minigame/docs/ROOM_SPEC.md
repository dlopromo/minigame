# MiniGame Room Spec

This spec describes the Firebase short-code room flow used by multiplayer games.

## Goals

- Let friends join with a 4-digit room code.
- Keep GitHub Pages as a static frontend.
- Use Firebase RTDB as room, round-start, action, and snapshot state.
- Keep WebRTC DataChannel as optional acceleration/manual-mode transport, not as a room-mode requirement.
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

## Firebase Rules

Rules live at the repo root:

```text
firebase.json
database.rules.json
```

Deployment command:

```bash
firebase deploy --only database
```

Current MVP rules are designed for private friends-only rooms:

- Default root read/write is denied.
- `rooms/{roomCode}` is readable/writable only for authenticated Firebase users.
- `roomCode` must be exactly 4 digits.
- Username fields must be 1-12 Chinese/English/digit characters.
- Player and spectator records must keep the expected `role`.
- SDP blobs are allowed but capped in size.
- `gameStart`, `gameState`, and `gameActions` must keep the expected top-level shape.

These rules reduce accidental misuse, but they are not an anti-cheat server. Any
anonymous authenticated user who knows a room code can still write validly-shaped
room data. For public competitive play, move game validation to a real server.

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

Guess Color stores:

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

鋤大DEE and 鬥地主 store full host-authored snapshots:

```js
{
  players: [
    { id, name, ai, hand, passed, role, lastBid }
  ],
  currentPlayer: number,
  lastPlay: object | null,
  history: object[],
  gameOver: boolean,
  savedAt: number
}
```

Card games add game-specific fields such as `bottomCards`, `phase`, `bid`,
`placements`, and scoring notes. Non-host clients render snapshots and do not
mutate shared state directly.

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
  - if the game declares `aiFill: true`, empty seats are filled with AI records
    inside `gameStart.players`.
- Users who join after `status !== "lobby"` become spectators.
- Spectators cannot submit actions.
- Spectator visibility is game-defined. Guess Color shows the full answer; card
  games show a compact god-view hand list while preserving iPhone layout.

## Game Definition Extensions

Multiplayer games should register:

```js
{
  minPlayers: 1,
  maxPlayers: 2,
  allowSpectators: true,
  aiFill: false,
  supportsManualMultiplayer: true,
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

Rules:

- `maxPlayers` is the hard player-seat cap; extra room members become spectators.
- `minPlayers` is the minimum human seat count before AI fill is considered.
- `allowSpectators` should default to true for this app's friends-room model.
- `aiFill` means a game can add AI seats when humans are fewer than the legal
  player count.
- `supportsManualMultiplayer: false` hides Firebase-first room games from the
  legacy manual WebRTC selector.
- `minRoomPlayers` can override `minPlayers` for room play. Guess Color uses
  this to require 2 real humans in coop/race while still allowing single-player
  locally.
- AI must use available game state to choose beneficial legal actions rather than
  random actions.
- Game screens should target iPhone 16 Pro portrait with no vertical page scroll.

Guess Color example:

```js
{ computerCode: ['red', 'blue', 'green', 'orange'] }
```

Card-game room-start example:

```js
{
  state: {
    players: [
      { id: 'client-1', name: 'David', ai: false, hand: [] },
      { id: 'ai-2', name: 'AI 2', ai: true, hand: [] }
    ],
    currentPlayer: 0,
    history: []
  }
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
- For room games, Firebase state must be sufficient for correctness. WebRTC is
  optional acceleration only.

## Firebase Game Actions

Short-code room games use Firebase-first action delivery. This avoids the
half-open WebRTC case where `send()` appears to succeed but another browser does
not update.

```text
Player action
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
          |
          v
   Host removes gameActions/{actionId}
```

Rules:

- `gameActions` are delivery queue messages, not authoritative history.
- Host ignores actions from old `roundId`.
- Host deletes processed and stale `gameActions` to keep the queue small.
- Game modules should make action handling idempotent where practical.
- `gameState` remains the restore source after refresh.
- Manual two-player mode may still use direct WebRTC `game_msg`.

Card-game room actions are intentionally small:

```js
{ type: 'bd_play', playerId, cardIds }
{ type: 'bd_pass', playerId }
{ type: 'ddz_bid', playerId, bid }
{ type: 'ddz_play', playerId, cardIds }
{ type: 'ddz_pass', playerId }
```

Only the host should accept and apply these actions.

Detailed host flow:

```text
rooms/{code}/gameActions child_added
   |
   +-- from self ---------------------- ignore
   |
   +-- missing payload ---------------- ignore
   |
   +-- old roundId -------------------- delete action
   |
   +-- duplicate actionId ------------- ignore
   |
   v
mark actionId as seen
   |
   v
App.GameManager.handleMessage(payload)
   |
   v
App.WebRTC.broadcast(game_msg, except sender)
   |
   v
delete rooms/{code}/gameActions/{actionId}
```

## Room Info Panel

The room lobby intentionally exposes a small diagnostic panel so future agents
and users can see why a room is stuck without reading Firebase manually.

```text
+----------------+----------------+----------------+
| 狀態           | 傳輸           | 房主           |
| Lobby/Playing  | Firebase/WebRTC| username       |
+----------------+----------------+----------------+
| 回合           | Peers          | Queue          |
| round suffix   | open/known     | pending action |
+----------------+----------------+----------------+
```

Player rows also show:

- `房主`
- `你`
- `WebRTC` when the direct data channel is open
- `Firebase` when the room is relying on Firebase state/fallback

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
