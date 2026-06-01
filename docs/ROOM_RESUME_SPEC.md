# Party Room Refresh / Resume Spec

Refresh resume is Firebase-only.

## Stored Ticket

`App.RoomSession` stores:

```js
{
  roomCode,
  clientId,
  authUid,
  username,
  isHost,
  lastRole
}
```

The stable `clientId` is the room identity. Anonymous Auth may rehydrate, but
game seat restore should rely on `clientId`.

## Resume Flow

```text
Page loads
 |
 v
RoomSession ticket exists?
 |
 +-- no --> show Home
 |
 +-- yes
      |
      v
Sign in anonymously if needed
      |
      v
Load rooms/{roomCode}
      |
      +-- missing/expired --> clear ticket, show Home
      |
      v
Find members/{clientId}
      |
      +-- missing --> clear ticket, show Home
      |
      v
Mark member online
      |
      v
Watch room
      |
      +-- status playing + gameStart --> launch active round
      |
      +-- otherwise --> show Party Lobby
```

## Game Restore

- `gameStart.initialState` restores hidden opening state.
- `gameState.state` restores mutable round state.
- Games must ignore snapshots for another `roundId`.
- Host remains the only writer for shared card-game state.
- Re-entry marks the member as room-lobby presence with `queueStatus: none`.
  Users must opt into queue or spectate again, which prevents stale browser
  refreshes from silently taking a seat in the next round.

## Expected UX

- Refreshing as host returns to the same room and keeps host controls.
- Refreshing as joiner returns to the same member row.
- If the round is still active, the game screen opens again.
- If the host ended the round while the page was refreshing, the user lands in
  the party lobby.

## Refresh / Close Handling

`beforeunload` should not call `App.Signaling.leave()`.

Reason:

- Refresh is a normal recovery path and should keep the same room identity.
- Explicit `leave()` changes member presence to lobby/offline before the browser
  has a chance to resume, which can cause short-lived role and presence glitches.
- Firebase `onDisconnect()` and the heartbeat/stale-member flow own accidental
  disconnect detection.

The app may still set `event.returnValue` during an active room/game so the
browser shows a native confirmation for F5, tab close, or window close.
