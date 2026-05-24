# Guess Color State Machine

Single:

```text
playing -> solved | failed
```

Coop:

```text
playing
  |
  | current player guesses
  v
next turn
  |
  | any player hits 4
  v
settled
```

Race:

```text
playing
  |
  | any player hits 4
  v
settled
```

Party Room start state must include the host-generated `computerCode`.
