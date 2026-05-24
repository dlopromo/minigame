# 冚棉胎 State Machine

```text
playing
  |
  | flip creates no snap
  v
playing
  |
  | flip creates snap
  v
snapOpen
  |
  | correct slap
  v
playing
  |
  | deck and pile empty
  v
settled
```

Implementation keeps `snapOpen` as a boolean inside `status: "playing"` rather
than a separate status value.
