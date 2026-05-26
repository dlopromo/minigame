# 2048 Race State Machine

## States

```text
playing
  |
  | every player has no move
  v
settled
```

2048 does not enter `settled` when a player reaches `2048`.

## Player Status

```text
playing -> gameover
```

`gameover` means the board has no empty cell and no adjacent merge.

## Move Flow

```text
input direction
  |
  v
validate player can act
  |
  v
moveBoard()
  |
  | no movement
  v
ignore

moveBoard()
  |
  | moved
  v
push undo snapshot -> apply board -> add tile -> update score/maxTile -> save state
```

## Room Flow

Non-host clients send `2048_move` or `2048_undo` to Firebase game actions. The host authority applies the action and publishes `gameState`.
