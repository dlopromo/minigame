# 鋤大DEE State Machine

```text
playing
  |
  | player plays / passes
  v
playing
  |
  | all others pass
  v
free lead
  |
  | player hand empty
  v
settled
```

Important state:

- `players`
- `currentPlayer`
- `lastPlay`
- `passSet`
- `history`
- `mustIncludeThreeDiamond`
- `winnerIndex`

Host is authoritative in Party Room mode.
