# Chatroom MVP Spec

This document defines the shared Party Room chat contract. Chat is a room feature, not a per-game feature.

## Scope

All Firebase Party Room screens use the same `rooms/{roomCode}/chat` stream:

- Room lobby / waiting state
- Game in progress
- Result / settlement state while still inside the same room

Games must not implement their own chat. They can ask `App.Lobby.logRoomEvent('game', text, eventType)` to write a public game action.

## Firebase Shape

```text
rooms/{roomCode}/chat/{messageId}
  from: clientId
  name: display label
  kind: player | system | game
  eventType: short event key
  text: public message text
  createdAt: server timestamp
  mentions: optional clientId list
  playerColor: optional player color id
  playerIcon: optional player icon id
```

`kind` decides presentation:

- `player`: manual player chat.
- `system`: room lifecycle event.
- `game`: public game action.

## Public Events

Room events written to chat:

- player creates / enters / resumes room
- player leaves room
- player joins / leaves queue
- vote start / vote cast
- game start
- host migration
- return to Party Room

Game events written to chat:

- public card play
- draw count when the drawn card is not public
- pass / skip
- public scoring or settlement note
- game completed / interrupted
- winner/result summary when available

## Hidden Information Rule

Never write private information to chat:

- other players' hands
- non-public draw result
- deck order
- hidden identity
- hidden state
- answer/secret code unless the game rules already reveal it to all players

Examples:

```text
OK: David 抽了 1 張牌
Bad: David 抽到紅色 7

OK: Sharon 提交了一次猜測
Bad: Sharon 猜了紅紅藍黃
```

## Implementation Points

- `App.Signaling.sendChat(text)` writes player messages.
- `App.Signaling.sendSystemMessage(text, eventType)` writes room lifecycle messages.
- `App.Signaling.sendGameMessage(text, eventType)` writes public game messages.
- `App.Lobby.logRoomEvent(kind, text, eventType)` is the game-facing wrapper.
- `App.Signaling.appendHistory(entry)` also writes a public completion/interruption message.

Only the host should log game action messages during multiplayer rounds. Non-host clients send game actions through `gameActions`; the host applies the action and logs the resulting public action once.

## Adding A New Game

1. Use the common game chat drawer; do not create a new chat UI.
2. Keep a local history list if useful for the game UI.
3. When adding a public local history record, call:

```js
if (isRoomMode() && opts.isHost && App.Lobby && App.Lobby.logRoomEvent) {
  App.Lobby.logRoomEvent('game', playerName + '：' + publicText, 'game_action');
}
```

4. Do not include private card identities or hidden state in `publicText`.
5. Persist final results with `App.Signaling.appendHistory(entry)` so history and chat stay aligned.
