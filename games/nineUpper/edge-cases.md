# 9UPPER Edge Cases

- `submissions` and `votes` must always normalize to objects.
- Old room snapshots without `questionId` are upgraded by selecting a valid
  question and inserting it into `playedQuestionIds`.
- Firebase may deserialize arrays as objects; readers should normalize ID lists.
- AI players submit and vote only from the host authority.
- Non-host players send actions through Firebase `gameActions`; host validates
  and writes `gameState`.
- Duplicate result saves are blocked with `resultSaved`.
