# UI / UX Polish Status

本文件記錄 UI/UX 改良完成狀態。新的基礎設計位於 `css/redesign.css`，它是 app-wide final override layer。

## Batch 1: Safety And Focus — Done

- Boss / Focus mode 防誤觸：輸入框、聊天室、textarea focus 時不使用雙 Shift 觸發。
- Boss / Focus mode 替代快捷鍵：`Ctrl/Command + Shift + B`。
- Focus mode 開啟時保持 browser title 為 `Workspace Brief`，遊戲 turn title 不可覆蓋。
- 危險操作確認：離開遊戲、離開房間、返回首頁前需確認。

## Batch 2: Shared Interaction — Done For Core Card Games

- 全局快捷鍵基礎：
  - `S`: 推薦 / Suggest
  - `P`: Pass
  - `Space`: 主要確認 / 出牌
  - `Esc`: 取消選牌
- 鋤大DEE、鬥地主、轉色牌、21點、2048 等已按自身操作模型接入可行快捷鍵。

## Batch 3: Unified Game Chrome — Foundation Done

- 所有遊戲 topbar 統一格式：
  - game name
  - role / status
  - Chat
  - Info
  - leave button
- 現有遊戲已由 `redesign.css` 統一 topbar 視覺。
- 新共用 helper 已提供：
  - `App.Common.renderGameChrome(options)`
  - `App.Common.renderInfoDrawer(options)`
  - `App.Common.renderActionBar(actions)`
  - `App.Common.renderPlayerBadge(person)`
- 後續新遊戲應直接使用 helper；舊遊戲可逐步從自家 HTML 遷移，但現有 visual contract 已一致。

## Batch 4: Visual QA — Checklist Ready, Browser Runtime Needed

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
- Browser plugin / local browser runtime 不可用時，使用 `docs/VISUAL_QA_CHECKLIST.md` 做人工驗收。

## Batch 5: Office Theme Refinement — Done

- 降低遊戲網站感，收斂為內部工具風格。
- 保留明顯操作 feedback，尤其是輪到你、可出牌、選牌、未讀 chat。
- 避免 infinite flashing animation。
- 動畫只在狀態真的改變時播放。
- `redesign.css` 已統一 Home、Party Room、Choose Game、Chat、結果畫面、卡牌桌面與操作列。

## Batch 6: Chat And Notifications — Done For MVP

- 遊戲中 Chat button 顯示 unread badge。
- Chat drawer 與 Lobby 共用同一 Firebase room chat stream。
- 輪到你時 toast 不應狂彈，只在 turn key 改變時提示。
- Mention / turn title / unread badge 已由 Lobby 與遊戲狀態處理。

## Batch 7: Vote / Confirm — Done For MVP

- Party Room 多人危險操作改為 vote：
  - change game
  - reset game
  - close room
  - force settle
- 單人本機模式保留 confirmation dialog。
