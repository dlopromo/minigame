# 9UPPER Scoring

- Each vote is worth 1 point.
- Scores are cumulative across the round set.
- At final settlement, the player with highest score wins.
- Room leaderboard receives:
  - `score`: final game score
  - `win`: true for winner
  - `playerColor`
  - `playerIcon`

Tie-breaker is not formalized yet. Current MVP uses first player in sorted score
order if scores are exactly equal.
