# Blackjack State Machine

Blackjack keeps `status` for room compatibility and `phase` for explicit state-machine control.

## Phases

```text
DEALING
  |
  v
PLAYER_TURN
  |
  | hit > 21
  v
PLAYER_BUST
  |
  v
PLAYER_TURN
  |
  | no playable players remain
  v
DEALER_TURN
  |
  v
RESULT
```

`status` is `playing` until `RESULT`, then becomes `settled`.

## Turn Guard

A human action is valid only when:

- `status === "playing"`
- `phase === "PLAYER_TURN"`
- the player status is `playing`
- the player is the active player
- the player is not AI
- the viewer is not spectator

This prevents wrong-turn clicks from corrupting the round.
