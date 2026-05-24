# 轉色牌 Edge Cases

- Clicking a hand card must only select it; it must not auto-play.
- `出牌` is enabled only when a legal selected card exists.
- Wild color selection is automatic in MVP, based on the player's remaining hand.
- When draw pile is empty, discard pile is recycled while preserving the top card.
- Non-host room players send actions through Firebase `gameActions`.
- Host validates turn and legal play before writing shared `gameState`.
