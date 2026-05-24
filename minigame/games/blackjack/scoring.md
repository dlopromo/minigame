# Blackjack Scoring

Per-player payout:

- Blackjack: `+1.5`
- Win: `+1`
- Push: `0`
- Lose: `-1`

Room leaderboard writes:

```text
score = payout
win = outcome === "win" || outcome === "blackjack"
```

Future scoring can add chips and multi-round bankroll, but MVP stays per-round.
