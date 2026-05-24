# Blackjack Edge Cases

- Player bust: immediately advances to the next playable player.
- All players bust or stand: dealer turn begins, then result.
- Starting Blackjack: player is auto-stand before the first turn.
- Duplicate action: ignored if the player is no longer active.
- Spectator: can see state but cannot act.
- Disconnected human: AI takeover may act only when that seat is active.
- Result saving is guarded by `resultSaved` to avoid duplicate history writes.
