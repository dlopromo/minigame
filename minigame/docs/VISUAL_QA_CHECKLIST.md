# Visual QA Checklist

本文件用於沒有 browser automation runtime 時的人工驗收。若 Browser plugin 或 Playwright 可用，請用同一清單做 screenshot QA。

## Viewports

```text
402x874   iPhone 16 Pro-like
402x740   shorter mobile
820x1180  tablet portrait
1440x900  desktop
```

## Screens

每個 viewport 檢查：

- Home
- Party Room connect
- Party Room lobby
- Choose Game
- Mode Select
- Game screen
- Result screen
- Chat drawer
- Focus mode

## Game Screens

至少檢查：

- Guess Color
- 鋤大DEE
- 鬥地主
- 21點
- 2048
- 轉色牌
- 冚棉胎
- 9Upper
- 百家樂
- 大小

## Acceptance Criteria

- 主畫面不需要 body scroll；只允許 Chat / Info / History 內部 scroll。
- iPhone 16 Pro-like viewport 可以看清主要操作。
- PC 版不出現過大空白或操作列遠離主遊戲。
- 卡牌遊戲選牌時牌會浮起，且不被桌面或 action bar 蓋住。
- 最新出牌比手牌更明顯。
- 已出牌堆疊不遮擋可操作手牌。
- 操作按鈕 disabled / enabled 狀態清楚。
- 輪到你、可出牌、未讀 Chat 的提示明顯但不刺眼。
- Browser title 回到 Home / Party Room 時恢復正常。
- Focus mode 開啟時 title 保持 `Workspace Brief`。

## Runtime Notes

如果本地沒有 Browser plugin session 或 Playwright/Chrome runtime：

1. 仍需跑 static checks 和 HTTP smoke checks。
2. 在 final report 註明 visual QA 需要人工或 browser-capable session 補跑。
3. 不應因缺少 browser runtime 阻塞已完成的 code / CSS / docs commit。
