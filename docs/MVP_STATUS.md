# MVP Status

本文件記錄目前 Party Room 平台 MVP 的完成狀態，方便後續 agent 接手時不用重新推斷。

## Current State

- Multiplayer transport: Firebase Realtime Database only.
- WebRTC: removed from active room/game flow.
- Room code: 4 digit numeric code.
- Browser identity: stable client id stored in browser storage.
- Chatroom: room-level standard feature, shared by lobby, game screen, and result screens.
- Game action log: public actions are written to room chat; hidden state is not written.
- Tests: `tests/run-tests.js` covers rules, room seating, stale member reclaim, registry contract, and chat contract.
- UI shell: `css/redesign.css` is the final app-wide visual layer. It unifies Home, Party Room, game selection, result panels, card tables, action buttons, chat drawer, and office-friendly interaction states without changing game state schemas.

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

14. UI/UX redesign pass
    - `redesign.css` provides the current Office Party design system.
    - Home, Party Room, Choose Game, result panel, Chat drawer, and all current game shells inherit the unified spacing, panel, button, and focus styles.
    - Card games share the muted tabletop skin, lifted selected-card layer, enlarged central play area, and softer action highlighting.
    - Repeated hand-entry animation was reduced for Big Dee, Dou Dizhu, and Blackjack to avoid full-screen flicker.
    - Common helpers now exist in `App.Common`: `renderGameChrome`, `renderInfoDrawer`, `renderActionBar`, and `renderPlayerBadge`.

15. Vote / confirm MVP
    - Party Room dangerous in-game actions use the shared vote flow when more than one online human is present.
    - Covered actions: return to room, restart round, change game, close room, and force-settle/interruption.
    - Single-human or local flows still use direct action plus confirmation where relevant.

## Known Non-Blocking Gaps

- Full Firebase multi-browser E2E still requires manual browser testing against a real Firebase project.
- Admin inspection and repair tools exist, but production-grade hardening still depends on Firebase Auth/custom claims or a deployment-level gate.
- Visual QA should be repeated in an actual browser for:
  - `402x874`
  - `402x740`
  - `820x1180`
  - `1440x900`
- Current runtime note: when the Browser plugin reports no available browser session and no local Playwright/Chrome runtime is installed, visual QA is limited to HTTP/static smoke checks plus the manual checklist in `docs/VISUAL_QA_CHECKLIST.md`.
- Replay and analytics are intentionally out of MVP scope.

## Verification Commands

```bash
node --check js/common.js
node --check js/lobby.js
node --check js/signaling.js
node --check js/admin.js
for f in games/*/*.js; do node --check "$f"; done
node --check tests/run-tests.js
node tests/run-tests.js
git diff --check
```
