# 2048 Race Rules

2048 Race is a deterministic 4x4 tile puzzle that can be played single-player or in a Party Room race.

## Board

- Board size is always 4x4.
- Each board starts with two tiles generated from the round seed.
- A move compresses all tiles in one direction.
- Equal adjacent tiles merge once per move.
- A new tile spawns after a successful move.

## No Maximum Tile

There is no winning cap at `2048`.

Valid tiles include:

```text
2048 -> 4096 -> 8192 -> 16384 -> ...
```

The game only ends when a player has no valid move. In multiplayer, the round settles after every active player is no longer playing.

## Reverse / Undo

Each player owns an `undoStack`.

- A snapshot is pushed before every successful move.
- The stack keeps the latest 50 snapshots.
- Reverse restores board, score, move count, and max tile.
- Reverse does not submit the move automatically for another player.

## Save Progress

Single-player mode stores active progress in `localStorage`.

Room mode stores progress in Firebase `gameState`; refresh resumes from the room snapshot.
