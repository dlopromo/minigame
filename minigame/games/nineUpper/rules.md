# 9UPPER Rules

9UPPER is a prompt-answer-vote party game.

- Each round starts with one prompt from the enabled question bank.
- Every seated player submits one short answer.
- Answers are revealed together for voting.
- Each player votes for one answer that is not their own.
- A vote gives 1 point to the answer owner.
- Highest score after `maxRounds` wins.

Question bank contract:

```js
{
  id: "hk-office-001",
  version: "hk-office-v1",
  category: "office",
  text: "...",
  enabled: true
}
```

Question selection avoids repeats inside the same cycle. A new cycle starts only
after all enabled questions have been used.
