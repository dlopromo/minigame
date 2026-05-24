# UI / UX Polish Backlog

本文件記錄所有已排程的 UI/UX 改良。除非使用者明確叫停，後續 agent 可以按此順序繼續實作，不需要再逐項詢問。

## Batch 1: Safety And Focus

- Boss / Focus mode 防誤觸：輸入框、聊天室、textarea focus 時不使用雙 Shift 觸發。
- Boss / Focus mode 替代快捷鍵：`Ctrl/Command + Shift + B`。
- Focus mode 開啟時保持 browser title 為 `Workspace Brief`，遊戲 turn title 不可覆蓋。
- 危險操作確認：離開遊戲、離開房間、返回首頁前需確認。

## Batch 2: Shared Interaction

- 全局快捷鍵基礎：
  - `S`: Suggest
  - `P`: Pass
  - `Space`: 主要確認 / 出牌
  - `Esc`: 取消選牌
- 目前先接入鋤大DEE與鬥地主；其他遊戲後續按同一 contract 補。

## Batch 3: Unified Game Chrome

- 所有遊戲 topbar 統一格式：
  - game name
  - role / status
  - Chat
  - Info
  - leave button
- 所有遊戲都應有同一個 Info panel 入口。
- Info panel 內容至少包含：玩家、分數、History、Ranking、房間資訊。

## Batch 4: Visual QA

需要使用 browser 實測以下 viewport：

```text
402x874   iPhone 16 Pro-like
402x740   shorter mobile
820x1180  tablet portrait
1440x900  desktop
```

每個 viewport 至少檢查：

- Home
- Party Room
- Choose Game
- 鋤大DEE
- 鬥地主
- 21點
- 2048
- 轉色牌

Current local note:

- If the workspace has no Playwright/Chrome runtime, do not block code changes.
- Record the missing runtime in the final response and run visual QA in the next
  browser-capable session.

## Batch 5: Office Theme Refinement

- 降低遊戲網站感，收斂為內部工具風格。
- 保留明顯操作 feedback，尤其是輪到你、可出牌、選牌、未讀 chat。
- 避免 infinite flashing animation。
- 動畫只在狀態真的改變時播放。

## Batch 6: Chat And Notifications

- 遊戲中 Chat button 顯示 unread badge。
- Chat drawer 增加最後一條 preview。
- 輪到你時 toast 不應狂彈，只在 turn key 改變時提示。

## Batch 7: Vote / Confirm

- Party Room 多人危險操作改為 vote：
  - change game
  - reset game
  - close room
  - force settle
- 單人本機模式保留 confirmation dialog。
