# 轉色牌 State Machine

```text
playing
  |
  | player plays / draws
  v
playing
  |
  | player hand empty
  v
settled
```

Required state fields:

- `players`
- `drawPile`
- `discard`
- `activeColor`
- `currentIndex`
- `direction`
- `status`
- `winnerId`
- `resultSaved`
- `history`

Local selected card is UI-only and is not written to Firebase.
