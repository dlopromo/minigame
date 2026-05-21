# Title Notifications, Guess Visibility & WebRTC Retry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser title notifications for game state, improve 2P guess display with merged co-op timeline and player names, and add manual WebRTC retry without leaving the screen.

**Architecture:** Three independent improvements to `guessColor.html`. (1) A `setTitle()` utility called from all state-change points. (2) Co-op mode merges both players' guesses into one timeline with color-coded rows and name labels; versus mode shows opponent's full color pins instead of just dots. (3) When WebRTC disconnects, show a "重試連線" button on the host/join screen instead of going home.

**Tech Stack:** Vanilla JavaScript, HTML5, CSS3 — single file, no dependencies.

---

## File Structure

| File | Changes |
|------|---------|
| `guessColor.html` | Add setTitle, CSS for player-row styles, co-op merged rendering, versus opponent rendering, manual retry UI |

---

### Task 1: Browser Title Notifications

**Files:**
- Modify: `guessColor.html`

Adds a `setTitle()` utility that updates `document.title` with emoji prefixes. Called from every state-change point so the browser tab always reflects current game state.

- [ ] **Step 1: Add setTitle utility**

Insert after the `showToast` function (after line 329):

```javascript
// ===== Title =====
function setTitle(text) {
  document.title = text ? text + ' - GuessColor' : 'GuessColor';
}
```

- [ ] **Step 2: Call setTitle from updateTurnIndicator**

In the `updateTurnIndicator` function, add `setTitle` calls in every branch. Replace the entire function with:

```javascript
function updateTurnIndicator() {
  var el = document.getElementById('game-turn-indicator');
  var inputArea = document.getElementById('input-area');
  if (gameOver) {
    el.className = 'game-header waiting';
    el.textContent = '遊戲結束';
    inputArea.style.display = 'none';
    return;
  }
  if (gameMode === 'single') {
    el.className = 'game-header my-turn';
    el.textContent = '第 ' + (myGuesses.length + 1) + ' / ' + MAX_ROWS + ' 次嘗試';
    inputArea.style.display = 'block';
    setTitle('🎯 第 ' + (myGuesses.length + 1) + '/' + MAX_ROWS + ' 次嘗試');
  } else if (gameMode === 'coop') {
    var totalAttempts = myGuesses.length + opponentGuesses.length;
    if (myTurn) {
      el.className = 'game-header my-turn';
      el.textContent = '你的回合（共 ' + (totalAttempts + 1) + ' / ' + MAX_ROWS + ' 次）';
      inputArea.style.display = 'block';
      setTitle('🔔 輪到你了');
    } else {
      el.className = 'game-header their-turn';
      var waitingName = opponentName || '隊友';
      el.textContent = waitingName + ' 思考中...';
      inputArea.style.display = 'none';
      setTitle('⏳ 等待 ' + waitingName);
    }
  } else {
    if (myTurn) {
      el.className = 'game-header my-turn';
      el.textContent = '你的回合（第 ' + (myGuesses.length + 1) + ' 次）';
      inputArea.style.display = 'block';
      setTitle('🔔 輪到你了');
    } else {
      el.className = 'game-header their-turn';
      var waitingName2 = opponentName || '對方';
      el.textContent = waitingName2 + ' 思考中...';
      inputArea.style.display = 'none';
      setTitle('⏳ 等待 ' + waitingName2);
    }
  }
  renderGuessInput();
}
```

- [ ] **Step 3: Call setTitle from showResult**

At the start of `showResult`, after `gameOver = true;`, add:

```javascript
function showResult(iWin) {
  gameOver = true;
  if (gameMode === 'single') {
    setTitle(iWin ? '🎉 你贏了！' : '😞 你輸了...');
  } else if (gameMode === 'coop') {
    setTitle(iWin ? '🎉 你們贏了！' : '😞 你們輸了...');
  } else {
    setTitle(iWin ? '🎉 你贏了！' : '😞 你輸了...');
  }
  showScreen('result');
  // ... rest of existing function unchanged
```

- [ ] **Step 4: Call setTitle from other screens**

Add `setTitle` calls in these functions:

In `initSetupScreen`, add at the start:
```javascript
setTitle('🔐 設定密碼');
```

In `resetState`, add at the end:
```javascript
setTitle('');
```

In `selectTwoPlayer`, add before `showScreen('connect')`:
```javascript
setTitle(mode === 'versus' ? '雙人對戰' : '雙人合作');
```

- [ ] **Step 5: Verify**

Open `guessColor.html` in browser. Check:
- Home screen: browser tab shows "GuessColor"
- Single player: tab shows "🎯 第 1/12 次嘗試"
- Win: tab shows "🎉 你贏了！"
- Lose: tab shows "😞 你輸了..."
- Setup (2P): tab shows "🔐 設定密碼"

---

### Task 2: Better 2P Guess Display

**Files:**
- Modify: `guessColor.html`

Two improvements: (a) Versus mode shows opponent's full color pins, not just dots. (b) Co-op mode merges both players' guesses into one timeline with color-coded backgrounds and name labels.

- [ ] **Step 1: Add CSS for player-distinguished rows**

Add these CSS rules after the `.opponent-row` rule (after line 108):

```css
.guess-row.player-me{background:rgba(52,152,219,.08)}
.guess-row.player-opponent{background:rgba(231,76,60,.08)}
.guess-row .player-name{
  font-size:.7rem;font-weight:600;padding:2px 6px;border-radius:4px;
  margin-right:4px;flex-shrink:0;min-width:32px;text-align:center
}
.guess-row.player-me .player-name{background:rgba(52,152,219,.2);color:#2980b9}
.guess-row.player-opponent .player-name{background:rgba(231,76,60,.2);color:#c0392b}
```

- [ ] **Step 2: Improve versus mode renderOpponentGuesses to show full pins**

Replace the entire `renderOpponentGuesses` function with:

```javascript
function renderOpponentGuesses() {
  var c = document.getElementById('opponent-guesses');
  c.innerHTML = '';
  if (opponentGuesses.length === 0) {
    var emptyText = (gameMode === 'coop') ? '隊友尚未猜測' : '對方尚未猜測';
    c.innerHTML = '<div style="font-size:.85rem;color:var(--muted);padding:4px">' + emptyText + '</div>';
    return;
  }
  for (var i = 0; i < opponentGuesses.length; i++) {
    var g = opponentGuesses[i];
    var row = document.createElement('div');
    row.className = 'guess-row';
    var num = document.createElement('div');
    num.className = 'row-num';
    num.textContent = i + 1;
    row.appendChild(num);
    var pins = document.createElement('div');
    pins.className = 'pins';
    for (var j = 0; j < SLOTS; j++) {
      var pin = document.createElement('div');
      pin.className = 'pin';
      if (g.colors[j]) pin.dataset.color = g.colors[j];
      pins.appendChild(pin);
    }
    row.appendChild(pins);
    var result = document.createElement('div');
    result.className = 'result';
    for (var h = 0; h < g.hits; h++) result.appendChild(dot('hit-dot'));
    for (var b = 0; b < g.blows; b++) result.appendChild(dot('blow-dot'));
    for (var e = 0; e < SLOTS - g.hits - g.blows; e++) result.appendChild(dot('empty-dot'));
    row.appendChild(result);
    c.appendChild(row);
  }
}
```

- [ ] **Step 3: Add co-op merged rendering**

Insert this new function after `renderOpponentGuesses`:

```javascript
function renderCoopMergedGuesses() {
  var c = document.getElementById('my-guesses');
  c.innerHTML = '';

  // Build merged timeline
  var merged = [];
  var myIdx = 0, oppIdx = 0;
  for (var turn = 0; turn < myGuesses.length + opponentGuesses.length; turn++) {
    var isMySlot = isHost ? (turn % 2 === 0) : (turn % 2 === 1);
    if (isMySlot && myIdx < myGuesses.length) {
      merged.push({guess: myGuesses[myIdx], isMe: true, name: playerName || '你'});
      myIdx++;
    } else if (oppIdx < opponentGuesses.length) {
      merged.push({guess: opponentGuesses[oppIdx], isMe: false, name: opponentName || '隊友'});
      oppIdx++;
    }
  }

  var totalSlots = MAX_ROWS;
  for (var i = 0; i < totalSlots; i++) {
    var row = document.createElement('div');
    var isCurrent = (i === merged.length && !gameOver && myTurn);
    row.className = 'guess-row' + (isCurrent ? ' current' : '');
    if (i < merged.length) {
      row.classList.add(merged[i].isMe ? 'player-me' : 'player-opponent');
    }

    var num = document.createElement('div');
    num.className = 'row-num';
    num.textContent = i + 1;
    row.appendChild(num);

    if (i < merged.length) {
      var nameTag = document.createElement('div');
      nameTag.className = 'player-name';
      nameTag.textContent = merged[i].name.substring(0, 4);
      row.appendChild(nameTag);
    }

    var pins = document.createElement('div');
    pins.className = 'pins';
    for (var j = 0; j < SLOTS; j++) {
      var pin = document.createElement('div');
      pin.className = 'pin';
      if (i < merged.length && merged[i].guess.colors[j]) pin.dataset.color = merged[i].guess.colors[j];
      pins.appendChild(pin);
    }
    row.appendChild(pins);

    var result = document.createElement('div');
    result.className = 'result';
    if (i < merged.length) {
      var g = merged[i].guess;
      for (var h = 0; h < g.hits; h++) result.appendChild(dot('hit-dot'));
      for (var b = 0; b < g.blows; b++) result.appendChild(dot('blow-dot'));
      for (var e = 0; e < SLOTS - g.hits - g.blows; e++) result.appendChild(dot('empty-dot'));
    }
    row.appendChild(result);
    c.appendChild(row);
  }
}
```

- [ ] **Step 4: Modify renderGameBoard for co-op merged view**

Replace the existing `renderGameBoard` function with:

```javascript
function renderGameBoard() {
  var opponentSection = document.getElementById('opponent-section');
  var myGuessesTitle = document.getElementById('my-guesses-title');

  if (gameMode === 'single') {
    opponentSection.style.display = 'none';
    myGuessesTitle.textContent = '猜測記錄';
    renderMyGuesses();
    renderGuessInput();
  } else if (gameMode === 'coop') {
    opponentSection.style.display = 'none';
    myGuessesTitle.textContent = '合力猜測';
    renderCoopMergedGuesses();
    renderGuessInput();
  } else {
    opponentSection.style.display = 'block';
    myGuessesTitle.textContent = '我的猜測';
    var opponentLabel = document.getElementById('opponent-label');
    opponentLabel.textContent = opponentName ? opponentName + ' 的進度' : '對方進度';
    renderMyGuesses();
    renderOpponentGuesses();
    renderGuessInput();
  }
}
```

- [ ] **Step 5: Verify**

Test versus mode:
- Both players see their own full guess history with color pins
- Opponent section now shows full color pins (not just dots) for each guess

Test co-op mode:
- One merged timeline showing all guesses in turn order
- Each row has a colored name tag (blue = you, red = teammate)
- Background color distinguishes players
- Turn order correct (host first, then guest, alternating)

---

### Task 3: WebRTC Manual Retry

**Files:**
- Modify: `guessColor.html`

When WebRTC disconnects, instead of going home immediately, show a "重試連線" button on the current screen. Clicking it regenerates the offer/answer codes without navigating away. Keeps game mode and player name.

- [ ] **Step 1: Add retry UI to host and join screens**

In the host screen (after the answer-input card, before the return button), add a retry section:

Find the host screen's `← 返回` button (around line 228) and add before it:

```html
<div class="card" id="host-retry-card" style="display:none">
  <p style="text-align:center;color:var(--muted);font-size:.9rem;margin-bottom:12px">連線已中斷</p>
  <button class="btn btn-primary" id="btn-retry-host" onclick="retryHost()">重新產生邀請碼</button>
</div>
```

Find the join screen's `← 返回` button (around line 250) and add before it:

```html
<div class="card" id="join-retry-card" style="display:none">
  <p style="text-align:center;color:var(--muted);font-size:.9rem;margin-bottom:12px">連線已中斷</p>
  <button class="btn btn-primary" id="btn-retry-join" onclick="retryJoin()">重新產生回應碼</button>
</div>
```

- [ ] **Step 2: Modify disconnect handling to show retry instead of going home**

Replace the `channel.onclose` handler in `bindChannel` with:

```javascript
channel.onclose = function() {
  if (connected && !gameOver) {
    connected = false;
    showToast('連線已中斷，可按重試重新連線', 'error');
    if (isHost) {
      document.getElementById('host-retry-card').style.display = 'block';
    } else {
      document.getElementById('join-retry-card').style.display = 'block';
    }
  }
};
```

- [ ] **Step 3: Add retryHost function**

Insert after the `connectHost` function:

```javascript
async function retryHost() {
  var savedMode = gameMode;
  var savedName = playerName;
  cleanDisconnect();
  gameMode = savedMode;
  playerName = savedName;
  isHost = true;

  document.getElementById('host-retry-card').style.display = 'none';
  document.getElementById('offer-code').value = '產生中...';
  document.getElementById('answer-input').value = '';
  document.getElementById('btn-connect-host').disabled = false;

  var conn = createPC();
  bindChannel(conn.createDataChannel('game'));

  var offer = await conn.createOffer();
  await conn.setLocalDescription(offer);
  await waitGathering(conn);

  if (conn.localDescription) {
    document.getElementById('offer-code').value = encodeSDP(conn.localDescription.sdp);
  }
}
```

- [ ] **Step 4: Add retryJoin function**

Insert after the `retryHost` function:

```javascript
async function retryJoin() {
  var savedMode = gameMode;
  var savedName = playerName;
  cleanDisconnect();
  gameMode = savedMode;
  playerName = savedName;
  isHost = false;

  document.getElementById('join-retry-card').style.display = 'none';
  document.getElementById('offer-input').value = '';
  document.getElementById('answer-code').value = '';
  document.getElementById('join-answer-card').style.display = 'none';
  document.getElementById('btn-gen-answer').disabled = false;
}
```

- [ ] **Step 5: Hide retry cards when going home**

In `goHome` function, add after `showScreen('home')`:

```javascript
function goHome() {
  cleanDisconnect();
  resetState();
  showScreen('home');
  document.getElementById('host-retry-card').style.display = 'none';
  document.getElementById('join-retry-card').style.display = 'none';
}
```

- [ ] **Step 6: Verify**

Test disconnect handling:
- Connect two tabs
- Close one tab
- Other tab sees toast "連線已中斷" and a retry card appears
- Click "重新產生邀請碼" (host) → new offer code generated on same screen
- Partner can paste the new offer and reconnect without navigating away
- "← 返回" still works to go home and reset everything
