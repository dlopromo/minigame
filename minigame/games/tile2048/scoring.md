# 2048 Race Scoring

Score is the sum of all merged tile values.

Ranking tie-break:

1. Highest max tile
2. Highest score
3. Earlier finished time

Room leaderboard currently writes:

```text
score = player.score
win = player.id === winnerId
```

Future leaderboard normalization should store both `score` and `maxTile` per room result.
