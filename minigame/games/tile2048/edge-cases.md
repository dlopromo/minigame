# 2048 Race Edge Cases

- Invalid move: ignored, no tile spawn, no undo snapshot.
- Reverse with empty stack: ignored.
- Refresh in single-player: resume from `localStorage` if active state exists.
- Refresh in room: resume from Firebase `gameState`.
- Tile over 2048: continue playing.
- Full board with no merge: player becomes `gameover`.
- Spectator: can view but cannot move or reverse.
