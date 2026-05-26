# MVP Status

本文件記錄目前 Party Room 平台 MVP 的完成狀態，方便後續 agent 接手時不用重新推斷。

## Current State

- Multiplayer transport: Firebase Realtime Database only.
- WebRTC: removed from active room/game flow.
- Room code: 4 digit numeric code.
- Browser identity: stable client id stored in browser storage.
- Chatroom: room-level standard feature, shared by lobby, game screen, and result screens.
- Game action log: public actions are written to room chat; hidden state is not written.
- Tests: `minigame/tests/run-tests.js` covers rules, room seating, stale member reclaim, registry contract, and chat contract.

## Completed MVP Items

1. Refresh identity
   - Same browser keeps the same client id and room resume ticket.
   - Player identity is separated from display name in room member records.

2. Room/game start stability
   - Game selection uses Firebase room state.
   - Games expose `buildRoomStart`.
   - Every registered game has a room start path and spectator support.

3. Missing default state protection
   - 9Upper initializes `submissions`.
   - Registry tests assert all games can build room start state.
   - Game code uses fallback checks before reading nested state in active paths.

4. Player color/icon identity
   - Room member records support player color and icon.
   - Lobby, chat, leaderboard, and result panels consume player identity metadata.

5. Result and restart flow
   - All current games render a formal result panel.
   - Local games provide replay where supported.
   - Room games return to the Party Room flow after completion.

6. Room scoreboard
   - Room leaderboard updates through `addLeaderboardResults`.
   - Admin and room surfaces can read leaderboard data.

7. Card game table feel
   - Big Dee, Dou Dizhu, Color Shift, Blackjack, and Snap Stack use CSS cards.
   - Card games have selected-card lift, latest-card emphasis, or table pile feedback where relevant.
   - Big Dee and Dou Dizhu include enlarged central play areas and layered card piles.
   - Main card games now share a muted reference-style tabletop skin: diamond felt, translucent seats, darker card backs, enlarged central play cards, and clearer action buttons.

8. 2048 controls and persistence
   - Desktop keyboard and mobile swipe are supported.
   - Local progress persists.
   - Reverse keeps up to 50 snapshots.
   - There is no max tile cap.
   - Room mode uses one shared cooperative board and rotates one move per queued player.
   - Tile animation distinguishes movement, new tile spawn, and merge pulse.

9. Color Shift / UNO-like flow
   - Card click selects the card.
   - Play is submitted through the action button.
   - Wild color is resolved by game logic.
   - Result panel is present.

10. 9Upper question cycle
    - Questions have ids, versions, categories, enabled flags, and source notes.
    - Played questions are tracked.
    - The picker avoids repeats until the enabled pool is exhausted.

11. Chatroom MVP
    - Waiting room has chat.
    - Game screen has chat.
    - Result screens keep the room chat entry.
    - Room events and public game actions are logged.
    - Firebase chat messages support `player`, `system`, and `game` kinds.

12. Admin MVP
    - Admin page can inspect rooms, members, game state summary, history, leaderboard, and recent chat.

13. Betting game MVP
    - `baccarat` adds 百家樂 with `$1000` starting bankroll and `$100-$500` bets.
    - `sicBo` adds 大小 with `$1000` starting bankroll and `$50-$500` bets.
    - Both games support local play, Firebase Party Room play, spectators, room chat logs, room history, and room leaderboard deltas.

## Known Non-Blocking Gaps

- Full Firebase multi-browser E2E still requires manual browser testing against a real Firebase project.
- Admin hardening is still limited. A production build should use Firebase Auth/custom claims or a stronger deployment-level gate.
- Visual QA should be repeated in an actual browser for:
  - `402x874`
  - `402x740`
  - `820x1180`
  - `1440x900`
- Replay and analytics are intentionally out of MVP scope.

## Verification Commands

```bash
node --check minigame/js/common.js
node --check minigame/js/lobby.js
node --check minigame/js/signaling.js
node --check minigame/js/admin.js
for f in minigame/games/*/*.js; do node --check "$f"; done
node --check minigame/tests/run-tests.js
node minigame/tests/run-tests.js
git diff --check
```
