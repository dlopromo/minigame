# 鋤大DEE Edge Cases

- Opening player cannot pass.
- First play must include `3♦` only for the first round opening rule.
- Five-card hands can beat only five-card hands, following type rank first.
- Same hand type comparison must use the shared analyzer/comparator path.
- Non-host clients submit actions to Firebase; host validates before writing state.
- Spectators cannot act.
