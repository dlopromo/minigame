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

- Room codes are random 4-digit numeric strings.
- Username is required.
- Username is trimmed, capped at 12 characters, and must use only Chinese
  characters, English letters, or digits.
- Spaces, punctuation, emoji, and symbols are invalid.

## Firebase Room Schema

```js
rooms/{roomCode}: {
  hostId: string,
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

At round start:

```text
online queue ordered by queuedAt
        |
        v
first maxPlayers users -> gameStart.players
remaining room members -> gameStart.spectators
empty seats + aiFill   -> AI records in gameStart.players
```

Important:

- `queue` persists between rounds. A queued player will automatically be seated
  again in the next round if there is room.
- `minRoomPlayers` is checked against queued real users.
- Guess Color uses `minRoomPlayers: 2`.
- 鋤大DEE and 鬥地主 use `minRoomPlayers: 2`; single-player should use local play.
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
- UI renders recent messages only.

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
