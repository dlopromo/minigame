# MiniGame Party Room Spec

This app now uses Firebase-only multiplayer rooms. WebRTC is intentionally not
part of the active app flow.

## Goals

- Let friends join one persistent party room with a 4-digit code.
- Keep the room alive while the host switches games between rounds.
- Put unqueued or late users into spectator mode.
- Auto-seat queued users at the start of each new round.
- Fill empty legal seats with AI only when the game declares `aiFill: true`.
- Keep GitHub Pages as a static frontend.

## Room Code And Username

- Room codes are 4-digit numeric strings.
- Entering an existing code joins that Party Room.
- Entering a new code creates that Party Room.
- The lobby still offers a random-create helper, but the canonical flow is
  "enter code -> join or create".
- Username is required.
- Username is trimmed, capped at 12 characters, and must use only Chinese
  characters, English letters, or digits.
- Spaces, punctuation, emoji, and symbols are invalid.
- Duplicate usernames are blocked only while the matching member is active.
  If a same-name member is offline or has not sent heartbeat for more than
  60 seconds, a new client may enter with that name.

## Firebase Room Schema

```js
rooms/{roomCode}: {
  hostId: string,
  hostEpoch: number,
  status: 'lobby' | 'starting' | 'playing' | 'closed',
  gameId: string,
  mode: string,
  roundId: string,
  maxPlayers: number,
  activeGameId: string,
  activeMode: string,
  createdAt: serverTimestamp,
  updatedAt: serverTimestamp,

  members: {
    [clientId]: {
      name: string,
      role: 'host' | 'member',
      online: boolean,
      authUid: string,
      presence: 'lobby' | 'playing' | 'spectating',
      queueStatus: 'none' | 'queued',
      joinedAt: serverTimestamp,
      lastSeenAt: serverTimestamp,
      connectionVersion: number
    }
  },

  queue: {
    [clientId]: {
      name: string,
      queuedAt: serverTimestamp
    }
  },

  chat: {
    [messageId]: {
      from: clientId,
      name: string,
      text: string,
      createdAt: serverTimestamp
    }
  },

  currentRound: null | {
    gameId: string,
    mode: string,
    roundId: string,
    players: PlayerRecord[],
    spectators: PlayerRecord[],
    startedAt: number
  },

  gameStart: null | GameStart,
  gameState: null | GameStateSnapshot,
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

  history: {
    [entryId]: RoundHistory
  },

  leaderboard: {
    [clientId]: {
      name: string,
      score: number,
      wins: number,
      plays: number,
      lastPlayedAt: serverTimestamp
    }
  }
}
```

`players` and `spectators` at the room root are legacy placeholders only. New
code should use `members`, `queue`, and `gameStart`.

## Party Room Flow

```text
Home
 |
 v
Create / Join Party Room
 |
 v
Party Lobby
 |-- members
 |-- queue
 |-- chat
 |-- host game controls
 |
 v
Round Start
 |
 v
Game
 |
 v
Result / Back To Party Lobby
```

Rules:

- Joining a room creates or resumes `members/{clientId}`.
- New members are not automatically players.
- A user must press `加入隊列` to be considered for the next round.
- Users not in `queue` are spectators.
- During a game, new joiners stay in the party room as spectators until the next
  round.
- Host can choose another game after returning to lobby.

## Seating Rules

At round start, the shared `App.RoomSeating.build(roomState, gameDef)` helper is
the source of truth:

```text
online queue ordered by queuedAt
        |
        v
first maxPlayers queued users -> gameStart.players
queued users over maxPlayers  -> gameStart.spectators and remain queued
unqueued room members         -> gameStart.spectators
empty seats + aiFill          -> AI records in gameStart.players
```

Important:

- `queue` persists between rounds. A queued player who was not seated because
  the current game was full will automatically be considered again next round.
- `minRoomPlayers` is checked against queued real users.
- Guess Color uses `minRoomPlayers: 2`.
- 鋤大DEE and 鬥地主 use `minRoomPlayers: 2`; single-player should use local play.
- 21點 uses `minRoomPlayers: 1`, `maxPlayers: 6`, and no AI fill.
- 2048 Race uses `minRoomPlayers: 1`, `maxPlayers: 8`, and no AI fill.
- 轉色牌 uses `minRoomPlayers: 2`, `maxPlayers: 6`, and AI fill.
- 冚棉胎 uses `minRoomPlayers: 2`, `maxPlayers: 8`, and AI fill.
- 9Upper uses `minRoomPlayers: 2`, `maxPlayers: 6`, and AI fill.
- AI seats are not stored under `members`; they exist only in `gameStart` and
  game snapshots.

## GameStart Contract

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

Host creates `gameStart`; every client launches the same `roundId` from Firebase.

## Presence, Host Migration, And AI Takeover

Room identity uses a stable browser `clientId`, stored in `localStorage`. This
lets the same browser re-enter the same 4-digit room code and reclaim its member
record without re-pairing.

```text
member online=false
        |
        v
active game receives room_update
        |
        v
if the member owns a player seat:
  seat is treated as AI controlled
        |
        v
if the member returns:
  same seat becomes human controlled again
```

Name reclaim:

```text
same normalizedName exists
        |
        v
lastSeenAt within 60s -> block join
lastSeenAt over 60s   -> mark old member offline, allow join
```

Host migration is separate from player seats:

```text
current host offline
        |
        v
online clients inspect members by joinedAt
        |
        v
earliest online member tries Firebase transaction
        |
        v
transaction updates hostId, hostEpoch, member roles
        |
        v
new host applies gameActions, runs AI, writes gameState
```

The old host does not automatically regain host permissions. If they reconnect
while the round is active, they return as their normal player/spectator seat.

Important frontend-only limitation:

- A connected browser can migrate host and record AI takeover immediately after
  Firebase marks a member offline.
- If every browser disappears at exactly the same time, no client remains to run
  cleanup logic. A fully immediate "all users offline -> archive interrupted
  round" requires a small Cloud Function or another trusted worker. The current
  static MVP keeps recoverable room data in Firebase and can close/recover when
  a browser reconnects.

## GameState And Actions

Room games are Firebase-first:

```text
Non-host player action
        |
        v
rooms/{code}/gameActions push
        |
        v
Host validates/applies action
        |
        v
Host writes rooms/{code}/gameState
        |
        v
All clients render the same snapshot
        |
        v
Host clears processed action
```

Host players can apply actions locally and still write `gameState`. Non-host
clients must not mutate shared game state directly.

Card-game actions:

```js
{ type: 'bd_play', playerId, cardIds }
{ type: 'bd_pass', playerId }
{ type: 'ddz_bid', playerId, bid }
{ type: 'ddz_play', playerId, cardIds }
{ type: 'ddz_pass', playerId }
```

## Chat

- Chat is room-level, not game-level.
- Switching games does not clear chat.
- Messages are trimmed to 120 characters.
- UI renders the room chat history stored under the room code.

## History, Leaderboard, And Admin

- Completed room rounds append one record under `rooms/{code}/history`.
- Leaderboard rows are scoped to the same 4-digit room code and live under
  `rooms/{code}/leaderboard`.
- Current score support:
  - Guess Color: win count and +1 score for winning/team completion.
  - 鋤大DEE: room score deltas from remaining cards and top-card penalties.
  - 鬥地主: room score deltas from bid and bomb/rocket multiplier.
- `admin.html` is a friends-only Firebase monitor page. It lists rooms,
  online/offline humans, active AI takeover state, leaderboard rows, and history.
  It uses Anonymous Auth and RTDB reads; it is not a hardened private backoffice.

## Result And Return

- A game can call `App.GameManager.endGame()`.
- Host then clears `gameStart`, `gameState`, `currentRound`, and `gameActions`.
- The room returns to `lobby`.
- Queue remains, so the next round can start without rejoining.

## Firebase Rules

Rules live at the repo root:

```text
firebase.json
database.rules.json
```

They validate room code shape, username shape, `members`, `queue`, `chat`,
`gameStart`, `gameState`, and `gameActions`. They are friends-only MVP rules,
not anti-cheat server authority.
