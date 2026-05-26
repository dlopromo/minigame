# 鬥地主 State Machine

```text
bidding
  |
  | highest bid selected / bid 3
  v
playing
  |
  | player plays / passes
  v
playing
  |
  | two consecutive passes
  v
free lead
  |
  | any hand empty
  v
settled
```

Host validates all multiplayer actions and writes the shared Firebase snapshot.
