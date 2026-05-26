# 9UPPER State Machine

```text
submit
  |
  | all players submitted
  v
vote
  |
  | all / enough votes received
  v
result
  |
  | host starts next round
  +----> submit
  |
  | round >= maxRounds
  v
settled
```

Required state fields:

- `players`
- `round`
- `maxRounds`
- `phase`
- `prompt`
- `questionId`
- `questionVersion`
- `questionCategory`
- `questionCycle`
- `playedQuestionIds`
- `submissions`
- `votes`
- `revealed`
- `status`
- `winnerId`
- `resultSaved`
- `history`
