# Guess Color Edge Cases

- Guess evaluation must count exact matches before color-only matches.
- Coop must not end after 12 attempts; it continues until solved.
- Race must not reveal opponent guesses during play.
- Spectators can view the answer but cannot submit guesses.
- Joiners use Firebase `gameStart.initialState.computerCode`; they should not
  wait for WebRTC messages.
