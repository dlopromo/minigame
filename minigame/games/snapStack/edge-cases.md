# 冚棉胎 Edge Cases

- If the deck is empty and no snap is open, settle immediately.
- If the pile is cleared and deck is empty, settle immediately.
- AI flips only under host authority.
- AI can slap after a short delay when snap is open.
- Duplicate room result writes are guarded by `resultSaved`.
