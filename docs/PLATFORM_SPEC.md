# Party Room 多人遊戲平台統一化規格

本文是下一階段平台重構的權威規格，保留使用者口語原文作參考，方便日後 agents 不需要回溯對話。

## User Original Notes

```text
幫我加上2048的配色而且不設上限，可以一直玩下去保存紀錄和Reverse功能，方便行錯Step而返回
完善2048 動畫，現在有奇怪的感覺

UNO的配色可以明顯一點，可以根據UNO 的顏色，可以的話都用ICON而不是文字

21點會出現卡死嘅BUG，爆點數後沒有再發牌等等

現在我希望可以統一全部卡牌遊戲

排行榜 / History 統一化 ，在遊戲中的介面都要有一個現有嘅資訊框，方便查看

加入投票更換遊戲或其他行為，防止錯誤操作如F5 或按下X 離開

現在所有遊戲都缺失了跟真實遊戲中嘅Feel 和動畫，沒有動畫看起來很LAG 不是一個遊戲

把所有可行的動作都放到Admin Page

把所有Logic 等等都寫入Markdown
```

## Platform Goals

- 所有遊戲使用同一個 Party Room model：players、spectators、queue、AI takeover、history、leaderboard。
- 所有多人狀態透過 Firebase Realtime Database 同步，不使用 WebRTC 或自建 WebSocket server。
- Animation 只存在 client render layer，不把每一 frame 寫入 Firebase。
- 每個遊戲都要有可讀的 Markdown logic documentation，讓 AI agent 可先讀規格再改 code。

## Unified Game Screen Contract

每個遊戲畫面應包含：

- Header：遊戲名稱、目前狀態、離開/Chat/Info。
- Player Info：玩家、AI 接管、觀戰、分數或剩餘資源。
- Action Area：只放當前可操作按鈕，未可用的按鈕使用 disabled 而不是消失。
- Info Panel：房間、玩家、回合、History、Ranking 入口。
- Notification：輪到你、AI 接管、玩家重連、遊戲開始/結束。

Mobile first target 是 iPhone 16 Pro 直屏。主操作畫面不應依賴上下 scroll；History、Ranking、Chat 可以在 drawer 內部 scroll。

## Firebase State Rules

Critical mutation should be either host-authoritative or transaction based.

```text
Client action
  |
  v
rooms/{code}/gameActions/{actionId}
  |
  v
Host authority validates action
  |
  v
rooms/{code}/gameState
  |
  v
All clients render from gameState
```

Do not store:

- animation frames
- hover state
- local selected cards
- transient drawer open/closed state

Store:

- deterministic game state
- round history
- scoring results
- player online / AI takeover
- vote state

## Voting Contract

Dangerous room actions should use vote state:

```text
vote:
  type: change_game | reset_game | close_room | force_settle
  initiatorId
  initiatorName
  createdAt
  expireAt
  agree: { playerId: true }
  reject: { playerId: true }
  status: pending | accepted | rejected | expired
```

Single-player local games may use direct confirmation. Party Room games should not allow one non-admin click to silently reset everyone.

## Admin Scope

Admin page should gradually absorb all maintenance actions:

- inspect room state
- inspect gameState and pending actions
- force settle / reset / repair stuck turn
- transfer host
- remove player
- mark stale player offline
- inspect history and leaderboard
- animation debug toggle

Admin security must be handled by Firebase rules / deployment controls before public use.

## Animation Rules

- Use CSS transform and opacity; avoid animating left/top.
- Use short 120ms to 700ms animations.
- Never block input on decorative animation.
- Use subtle office-friendly highlight: muted green, blue, orange, neutral glow.
- Card games should show table pile, hand movement, selected raise, played-card scatter, and turn highlight.
- Selection animation must not be attached to elements that are rebuilt on every
  render unless it is gated by a one-time class.
- Hand containers must allow vertical overflow when selected cards raise above
  the hand row.
- Infinite turn glow should be avoided; use stable office-friendly highlight
  unless the user explicitly asks for animated alerts.

## Focus / Boss Mode

The app supports a global Focus Mode triggered by pressing `Shift` twice within
520ms when the current focus is not an input field. It can also be toggled with
`Ctrl/Command + Shift + B`.

Behavior:

- visually covers the game with a neutral `Workspace Brief` screen
- hides toast messages while active
- changes browser title to `Workspace Brief`
- keeps the app state alive underneath
- `Escape` or another double `Shift` returns to the game
- input fields and chat boxes do not trigger double-Shift focus mode

This is intentionally styled like a quiet internal dashboard instead of a black
screen, because sudden blank pages look suspicious and are less usable.

## Global Shortcuts

Games can expose `handleShortcut(action)`.

Current shared actions:

```text
S      -> suggest
P      -> pass
Space  -> primary action / play
Esc    -> cancel selected cards
```

Shortcut handlers must ignore input fields, chat fields, and Focus Mode.

## Documentation Rule

For new or significantly changed games, create:

```text
games/<game-id>/rules.md
games/<game-id>/state-machine.md
games/<game-id>/scoring.md
games/<game-id>/animation.md
games/<game-id>/edge-cases.md
```

Existing games can be migrated incrementally, but any future bug fix touching core logic should update the corresponding Markdown.
