# Game Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single player mode (vs computer-generated code) and two-player cooperative mode (both players vs computer code) while preserving existing two-player versus mode.

**Architecture:** A new `gameMode` state variable (`'single'` / `'versus'` / `'coop'`) controls flow through the app. Single player skips all networking and the setup screen. Co-op reuses the existing WebRTC connection but skips setup — the host generates a computer code and shares it with the guest. The game screen renders differently per mode: single player hides the opponent section, co-op relabels it as "隊友進度". Players enter their name on the connect screen; names are exchanged via WebRTC and shown in the game UI (e.g., "隊友 小明 思考中..."). All changes are in the single `index.html` file.

**Tech Stack:** Vanilla JavaScript, HTML5, CSS3 — no new dependencies. `file://` compatible.

---

## File Structure

All changes in a single file:

| File | Changes |
|------|---------|
| `index.html` | Modify: add mode selection, state, single player logic, co-op logic, update rendering/result/rematch |

---

### Task 1: Mode Selection & Foundation

**Files:**
- Modify: `index.html`

This task adds the mode selection UI, state variables, computer code generation, and a new "connect" screen for 2P modes. After this task, the home screen shows 3 mode buttons and clicking a 2P mode navigates to the connect screen.

- [ ] **Step 1: Add state variables**

At line 271 (after `let pendingGuess = null;`), add `gameMode`, `computerCode`, `playerName`, and `opponentName`:

```javascript
let pendingGuess = null;
let gameMode = null; // 'single' | 'versus' | 'coop'
let computerCode = [];
let playerName = '';
let opponentName = '';
```

- [ ] **Step 2: Update resetState to include new variables**

Replace the existing `resetState` function (lines 289-295) with:

```javascript
function resetState() {
  myCode = []; opponentCode = []; myGuesses = []; opponentGuesses = [];
  myTurn = true; codeLocked = false; opponentCodeLocked = false; gameOver = false;
  pendingGuess = null; gameMode = null; computerCode = [];
  playerName = ''; opponentName = '';
  setupSelection = [null,null,null,null]; setupActiveSlot = 0;
  guessSelection = [null,null,null,null]; guessActiveSlot = 0;
}
```

- [ ] **Step 3: Modify home screen HTML**

Replace the entire `screen-home` div (lines 151-177) with:

```html
<div id="screen-home" class="screen active">
  <div class="card">
    <h1>猜顏色</h1>
    <p class="subtitle">Hit &amp; Blow</p>
    <button class="btn btn-primary" onclick="startSinglePlayer()">單人模式</button>
    <button class="btn btn-secondary" onclick="selectTwoPlayer('versus')">雙人對戰</button>
    <button class="btn btn-secondary" onclick="selectTwoPlayer('coop')">雙人合作</button>
  </div>
  <div class="card">
    <h2>遊戲規則</h2>
    <p style="font-size:.85rem;line-height:1.6;color:var(--muted)">
      從 6 色中選 4 色作為秘密代碼（可重複）。<br>
      每次猜完會得到提示：<br>
      <strong style="color:var(--hit)">全對 (Hit)</strong>：顏色＋位置都正確<br>
      <strong style="color:var(--blow)">半對 (Blow)</strong>：顏色對但位置錯<br>
      <span id="rules-mode-text">單人模式：8 次機會破解電腦的密碼！<br>雙人對戰：輪流猜對方的密碼，先猜中者勝！<br>雙人合作：合力破解電腦的密碼！</span>
    </p>
  </div>
  <div class="card">
    <h2>連線說明（雙人模式）</h2>
    <p style="font-size:.85rem;line-height:1.6;color:var(--muted)">
      雙方需在同一 WiFi / 區域網路內。<br>
      玩家 A 創建房間後，複製邀請碼傳給玩家 B。<br>
      玩家 B 貼上邀請碼產生回應碼，再傳回給玩家 A。<br>
      玩家 A 貼上回應碼即可連線。
    </p>
  </div>
</div>
```

- [ ] **Step 4: Add screen-connect HTML**

Insert this new screen right after `screen-home` (after the closing `</div>` of screen-home, before `screen-host`):

```html
<div id="screen-connect" class="screen">
  <div class="card">
    <h2 id="connect-title">雙人模式</h2>
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px" id="connect-desc"></p>
    <input type="text" id="player-name-input" placeholder="輸入你的名字" maxlength="12"
      style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:12px;text-align:center">
    <button class="btn btn-primary" onclick="startHost()">創建房間</button>
    <button class="btn btn-secondary" onclick="startJoin()">加入房間</button>
  </div>
  <button class="btn btn-secondary" onclick="goHome()">← 返回</button>
</div>
```

- [ ] **Step 5: Add mode selection functions**

Insert these functions after `resetState` (after step 2's code):

```javascript
function generateComputerCode() {
  var code = [];
  for (var i = 0; i < SLOTS; i++) {
    code.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
  return code;
}

function selectTwoPlayer(mode) {
  gameMode = mode;
  var titleEl = document.getElementById('connect-title');
  var descEl = document.getElementById('connect-desc');
  if (mode === 'versus') {
    titleEl.textContent = '雙人對戰';
    descEl.textContent = '輪流猜測對方的秘密代碼，先猜中者勝！';
  } else {
    titleEl.textContent = '雙人合作';
    descEl.textContent = '合力破解電腦的秘密代碼！';
  }
  showScreen('connect');
}
```

- [ ] **Step 6: Update existing startHost / startJoin to work with new flow**

The existing `startHost()` (line 356) already sets `isHost = true` and calls `resetState()`. We need `resetState` to NOT reset `gameMode` when called from these functions. Actually, `resetState` is called at the beginning of `startHost`/`startJoin`, but we set `gameMode` before calling them via `selectTwoPlayer`. The problem is `resetState()` clears `gameMode = null`.

Fix: save and restore gameMode and playerName around resetState in startHost and startJoin.

Replace `startHost` function (lines 356-373) with:

```javascript
async function startHost() {
  var savedMode = gameMode;
  var nameInput = document.getElementById('player-name-input').value.trim();
  playerName = nameInput || '玩家';
  isHost = true;
  resetState();
  gameMode = savedMode;
  playerName = nameInput || '玩家';
  showScreen('host');
  document.getElementById('offer-code').value = '產生中...';
  document.getElementById('answer-input').value = '';

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

Replace `startJoin` function (lines 394-402) with:

```javascript
async function startJoin() {
  var savedMode = gameMode;
  var nameInput = document.getElementById('player-name-input').value.trim();
  playerName = nameInput || '玩家';
  isHost = false;
  resetState();
  gameMode = savedMode;
  playerName = nameInput || '玩家';
  showScreen('join');
  document.getElementById('offer-input').value = '';
  document.getElementById('answer-code').value = '';
  document.getElementById('join-answer-card').style.display = 'none';
  document.getElementById('btn-gen-answer').disabled = false;
}
```

- [ ] **Step 7: Add CSS for name input focus**

Add this CSS rule alongside the existing `.code-area:focus` rule (around line 51):

```css
#player-name-input:focus{outline:none;border-color:#999}
```

- [ ] **Step 8: Verify**

Open `index.html` in browser. Check:
- Home screen shows 3 buttons: 單人模式, 雙人對戰, 雙人合作
- Clicking 雙人對戰 shows connect screen with title "雙人對戰" and name input
- Clicking 雙人合作 shows connect screen with title "雙人合作" and name input
- ← 返回 goes back to home screen
- Clicking 創建房間/加入房間 on connect screen proceeds to existing host/join flow

---

### Task 2: Single Player Mode

**Files:**
- Modify: `index.html`

This task implements the complete single player flow: start game, play, result, rematch. After this task, single player mode is fully playable.

- [ ] **Step 1: Add startSinglePlayer function**

Insert after the `selectTwoPlayer` function:

```javascript
function startSinglePlayer() {
  gameMode = 'single';
  resetState();
  gameMode = 'single';
  computerCode = generateComputerCode();
  startSingleGame();
}

function startSingleGame() {
  myGuesses = [];
  gameOver = false;
  pendingGuess = null;
  guessSelection = [null,null,null,null];
  guessActiveSlot = 0;
  showScreen('game');
  renderGameBoard();
  updateTurnIndicator();
}
```

- [ ] **Step 2: Modify bindChannel to handle mode-based flow**

Replace the existing `bindChannel` function (lines 342-353) with:

```javascript
function bindChannel(channel) {
  dc = channel;
  channel.onopen = function() {
    connected = true;
    send({ type: 'player_info', name: playerName });
    if (gameMode === 'coop') {
      startCoopAfterConnect();
    } else {
      showScreen('setup');
      initSetupScreen();
    }
  };
  channel.onclose = function() {
    if (connected && !gameOver) { alert('對方已斷線'); goHome(); }
  };
  channel.onmessage = function(e) { handleMessage(JSON.parse(e.data)); };
}
```

- [ ] **Step 3: Modify renderGameBoard for all modes**

Replace the existing `renderGameBoard` function (lines 537-541) with:

```javascript
function renderGameBoard() {
  var opponentSection = document.getElementById('opponent-section');
  var myGuessesTitle = document.getElementById('my-guesses-title');

  if (gameMode === 'single') {
    opponentSection.style.display = 'none';
    myGuessesTitle.textContent = '猜測記錄';
  } else {
    opponentSection.style.display = 'block';
    myGuessesTitle.textContent = '我的猜測';
    var opponentLabel = document.getElementById('opponent-label');
    var label = (gameMode === 'coop') ? '隊友進度' : '對方進度';
    if (opponentName) label = (gameMode === 'coop') ? '隊友 ' + opponentName + ' 的進度' : opponentName + ' 的進度';
    opponentLabel.textContent = label;
  }

  renderMyGuesses();
  renderOpponentGuesses();
  renderGuessInput();
}
```

- [ ] **Step 4: Add IDs to game screen HTML elements**

Modify the game screen HTML (lines 233-248). Add `id="opponent-section"` to the opponent-section div, `id="my-guesses-title"` to the h2, and `id="opponent-label"` to the h3 inside opponent-section:

```html
<div id="screen-game" class="screen">
  <div class="game-header my-turn" id="game-turn-indicator">你的回合</div>
  <div class="card">
    <h2 id="my-guesses-title" style="font-size:1rem;margin-bottom:8px">我的猜測</h2>
    <div class="guess-area" id="my-guesses"></div>
  </div>
  <div class="opponent-section" id="opponent-section">
    <h3 id="opponent-label">對方進度</h3>
    <div id="opponent-guesses"></div>
  </div>
  <div class="card" id="input-area">
    <div class="selection-display" id="guess-display"></div>
    <div class="color-palette" id="guess-palette"></div>
    <button class="btn btn-primary" id="btn-submit-guess" onclick="submitGuess()" disabled>確認猜測</button>
  </div>
</div>
```

- [ ] **Step 5: Modify updateTurnIndicator for all modes**

Replace the existing `updateTurnIndicator` function (lines 624-643) with:

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
  } else if (myTurn) {
    el.className = 'game-header my-turn';
    el.textContent = '你的回合（第 ' + (myGuesses.length + 1) + ' 次）';
    inputArea.style.display = 'block';
  } else {
    el.className = 'game-header their-turn';
    var waitingName = opponentName || (gameMode === 'coop' ? '隊友' : '對方');
    el.textContent = waitingName + ' 思考中...';
    inputArea.style.display = 'none';
  }
  renderGuessInput();
}
```

- [ ] **Step 6: Modify submitGuess to handle all modes**

Replace the existing `submitGuess` function (lines 660-669) with:

```javascript
function submitGuess() {
  if (gameOver) return;
  var colors = [];
  for (var i = 0; i < guessSelection.length; i++) colors.push(guessSelection[i]);
  if (colors.some(function(c) { return c === null; })) return;

  if (gameMode === 'single') {
    submitSingleGuess(colors);
  } else if (gameMode === 'coop') {
    submitCoopGuess(colors);
  } else {
    submitVersusGuess(colors);
  }
}

function submitSingleGuess(colors) {
  var result = calculateHitBlow(colors, computerCode);
  myGuesses.push({ colors: colors, hits: result.hits, blows: result.blows });
  guessSelection = [null,null,null,null];
  guessActiveSlot = 0;

  if (result.hits === SLOTS) {
    gameOver = true;
    renderGameBoard();
    updateTurnIndicator();
    showResult(true);
  } else if (myGuesses.length >= MAX_ROWS) {
    gameOver = true;
    renderGameBoard();
    updateTurnIndicator();
    showResult(false);
  } else {
    renderGameBoard();
    updateTurnIndicator();
  }
}

function submitVersusGuess(colors) {
  if (!myTurn) return;
  pendingGuess = colors;
  myTurn = false;
  send({ type: 'guess', colors: colors, row: myGuesses.length });
  guessSelection = [null,null,null,null];
  guessActiveSlot = 0;
  updateTurnIndicator();
}
```

- [ ] **Step 7: Modify showResult for all modes**

Replace the existing `showResult` function (lines 717-727) with:

```javascript
function showResult(iWin) {
  gameOver = true;
  showScreen('result');
  var title = document.getElementById('result-title');
  var myCodeLabel = document.getElementById('result-my-code-label');
  var revealMyCode = document.getElementById('reveal-my-code-row');
  var oppCodeLabel = document.getElementById('result-opponent-code-label');
  var revealOppCode = document.getElementById('reveal-opponent-code-row');

  if (gameMode === 'single') {
    title.textContent = iWin ? '你贏了！' : '你輸了...';
    title.className = 'result-title ' + (iWin ? 'result-win' : 'result-lose');
    myCodeLabel.style.display = 'none';
    revealMyCode.style.display = 'none';
    oppCodeLabel.textContent = '電腦的答案';
    oppCodeLabel.style.display = 'block';
    revealOppCode.style.display = 'flex';
    renderCodeReveal(revealOppCode, computerCode);
  } else if (gameMode === 'coop') {
    title.textContent = iWin ? '你們贏了！' : '你們輸了...';
    title.className = 'result-title ' + (iWin ? 'result-win' : 'result-lose');
    myCodeLabel.style.display = 'none';
    revealMyCode.style.display = 'none';
    oppCodeLabel.textContent = '電腦的答案';
    oppCodeLabel.style.display = 'block';
    revealOppCode.style.display = 'flex';
    renderCodeReveal(revealOppCode, computerCode);
  } else {
    title.textContent = iWin ? '你贏了！' : '你輸了...';
    title.className = 'result-title ' + (iWin ? 'result-win' : 'result-lose');
    myCodeLabel.textContent = '你的秘密代碼';
    myCodeLabel.style.display = 'block';
    revealMyCode.style.display = 'flex';
    renderCodeReveal(revealMyCode, myCode);
    oppCodeLabel.textContent = '對方的秘密代碼';
    oppCodeLabel.style.display = 'block';
    revealOppCode.style.display = 'flex';
    renderCodeReveal(revealOppCode, opponentCode.length === SLOTS ? opponentCode : []);
  }
}

function renderCodeReveal(container, code) {
  container.innerHTML = '';
  if (code.length === SLOTS) {
    code.forEach(function(c) {
      var p = document.createElement('div');
      p.className = 'pin';
      p.dataset.color = c;
      container.appendChild(p);
    });
  } else {
    container.innerHTML = '<span style="color:var(--muted)">等待揭曉...</span>';
  }
}
```

- [ ] **Step 8.5: Update renderRevealOpponent to use new IDs**

The existing `renderRevealOpponent` (lines 729-738) references old ID `reveal-opponent-code`. Replace it with:

```javascript
function renderRevealOpponent() {
  var el = document.getElementById('reveal-opponent-code-row');
  if (!el) return;
  renderCodeReveal(el, opponentCode);
}
```

- [ ] **Step 8: Modify result screen HTML to support all modes**

Replace the result screen HTML (lines 250-260) with:

```html
<div id="screen-result" class="screen">
  <div class="card">
    <div id="result-title" class="result-title"></div>
    <p id="result-my-code-label" style="font-size:.85rem;color:var(--muted);text-align:center;margin-bottom:12px">你的秘密代碼</p>
    <div class="reveal-row" id="reveal-my-code-row"></div>
    <p id="result-opponent-code-label" style="font-size:.85rem;color:var(--muted);text-align:center;margin:12px 0">對方的秘密代碼</p>
    <div class="reveal-row" id="reveal-opponent-code-row"></div>
    <button class="btn btn-primary" style="margin-top:16px" onclick="rematch()">再來一局</button>
    <button class="btn btn-secondary" onclick="goHome()">回首頁</button>
  </div>
</div>
```

- [ ] **Step 9: Modify rematch for all modes**

Replace the existing `rematch` and `resetForRematch` functions (lines 740-753) with:

```javascript
function rematch() {
  if (gameMode === 'single') {
    computerCode = generateComputerCode();
    startSingleGame();
  } else if (gameMode === 'coop') {
    send({ type: 'rematch' });
    startCoopRematch();
  } else {
    send({ type: 'rematch' });
    resetForRematch();
  }
}

function resetForRematch() {
  myCode = []; opponentCode = []; myGuesses = []; opponentGuesses = [];
  myTurn = true; codeLocked = false; opponentCodeLocked = false;
  gameOver = false; pendingGuess = null;
  setupSelection = [null,null,null,null]; setupActiveSlot = 0;
  guessSelection = [null,null,null,null]; guessActiveSlot = 0;
  showScreen('setup');
  initSetupScreen();
}

function startCoopRematch() {
  myGuesses = []; opponentGuesses = [];
  gameOver = false; pendingGuess = null;
  myTurn = isHost;
  guessSelection = [null,null,null,null]; guessActiveSlot = 0;
  if (isHost) {
    computerCode = generateComputerCode();
    send({ type: 'coop_start', code: computerCode });
  }
  showScreen('game');
  renderGameBoard();
  updateTurnIndicator();
}
```

- [ ] **Step 10: Update handleMessage for co-op rematch**

In the existing `handleMessage` function (line 437), replace the `rematch` case:

```javascript
case 'rematch':
  if (gameMode === 'coop') {
    startCoopRematch();
  } else {
    resetForRematch();
  }
  break;
```

- [ ] **Step 11: Verify single player**

Open `index.html` in browser. Check:
- Home screen → 單人模式 → Game starts immediately
- Can select colors and submit guesses
- Hit/blow feedback displays correctly
- Win when all 4 hits, lose after 8 failed attempts
- Result shows "你贏了/你輸了" and reveals computer code
- 再來一局 restarts with new computer code
- 回首頁 returns to home screen

---

### Task 3: Co-op Connection Flow

**Files:**
- Modify: `index.html`

This task modifies the WebRTC flow so that after connection in co-op mode, the setup screen is skipped and the host generates/shares a computer code. After this task, two players can connect in co-op mode and the game starts automatically.

- [ ] **Step 1: Add co-op message types to handleMessage**

Add these cases to the `handleMessage` switch statement (after the existing `rematch` case):

```javascript
case 'player_info':
  opponentName = msg.name;
  break;
case 'coop_start':
  computerCode = msg.code;
  startCoopGameBoard();
  break;
case 'coop_guess':
  handleCoopGuess(msg);
  break;
```

- [ ] **Step 2: Add startCoopAfterConnect function**

This function is called from `bindChannel.onopen` (added in Task 2 Step 2). Insert it after `bindChannel`:

```javascript
function startCoopAfterConnect() {
  if (isHost) {
    computerCode = generateComputerCode();
    send({ type: 'coop_start', code: computerCode });
    startCoopGameBoard();
  }
  // Guest waits for coop_start message from host
}
```

- [ ] **Step 3: Add startCoopGameBoard function**

```javascript
function startCoopGameBoard() {
  myGuesses = []; opponentGuesses = [];
  gameOver = false; pendingGuess = null;
  myTurn = isHost;
  guessSelection = [null,null,null,null];
  guessActiveSlot = 0;
  showScreen('game');
  renderGameBoard();
  updateTurnIndicator();
}
```

- [ ] **Step 4: Verify co-op connection**

Open two browser tabs with `index.html`:
- Tab 1: 雙人合作 → 創建房間 → copy offer code
- Tab 2: 雙人合作 → 加入房間 → paste offer → generate answer → copy answer
- Tab 1: paste answer → connect
- Both tabs should show game screen (no setup screen)
- Host's turn indicator: "你的回合"
- Guest's turn indicator: "隊友思考中..."

---

### Task 4: Co-op Game Logic & Result

**Files:**
- Modify: `index.html`

This task implements the complete co-op game logic: guess submission, result handling, turn switching, and game over. After this task, co-op mode is fully playable end-to-end.

- [ ] **Step 1: Add submitCoopGuess function**

Insert after `submitVersusGuess`:

```javascript
function submitCoopGuess(colors) {
  if (!myTurn || gameOver) return;
  var result = calculateHitBlow(colors, computerCode);
  myGuesses.push({ colors: colors, hits: result.hits, blows: result.blows });
  send({ type: 'coop_guess', colors: colors, hits: result.hits, blows: result.blows });
  guessSelection = [null,null,null,null];
  guessActiveSlot = 0;

  if (result.hits === SLOTS) {
    gameOver = true;
    send({ type: 'game_over', winner: 'team' });
    renderGameBoard();
    updateTurnIndicator();
    showResult(true);
  } else if (myGuesses.length + opponentGuesses.length >= MAX_ROWS) {
    gameOver = true;
    send({ type: 'game_over', winner: 'none' });
    renderGameBoard();
    updateTurnIndicator();
    showResult(false);
  } else {
    myTurn = false;
    renderGameBoard();
    updateTurnIndicator();
  }
}
```

- [ ] **Step 2: Add handleCoopGuess function**

```javascript
function handleCoopGuess(msg) {
  opponentGuesses.push({ colors: msg.colors, hits: msg.hits, blows: msg.blows });
  renderOpponentGuesses();

  if (msg.hits === SLOTS) {
    gameOver = true;
    updateTurnIndicator();
    showResult(true);
  } else if (myGuesses.length + opponentGuesses.length >= MAX_ROWS) {
    gameOver = true;
    updateTurnIndicator();
    showResult(false);
  } else {
    myTurn = true;
    updateTurnIndicator();
  }
}
```

- [ ] **Step 3: Modify handleGameOver for co-op**

The existing `handleGameOver` function (lines 711-715) handles versus mode. Replace it with:

```javascript
function handleGameOver(msg) {
  gameOver = true;
  updateTurnIndicator();
  if (gameMode === 'coop') {
    showResult(msg.winner === 'team');
  } else {
    showResult(msg.winner === 'me');
  }
}
```

- [ ] **Step 4: Modify renderGuessInput to work for co-op**

The existing `renderGuessInput` function (lines 599-620) already checks `myTurn && !gameOver` for the submit button disabled state. For co-op, this works the same way. But we need to make sure the color click handlers also check properly.

The existing function already handles this correctly — the `onclick` checks `if (myTurn && !gameOver)` and the submit button checks `!guessSelection.every(s => s !== null) || !myTurn || gameOver`. No changes needed for the rendering.

However, update the submit button disabled check to work with single player mode (where `myTurn` is always true during play). The existing code already works because in single player, `myTurn` stays `true` and `gameOver` controls the state.

- [ ] **Step 5: Add combined attempt count to co-op turn indicator**

The `updateTurnIndicator` from Task 2 Step 5 already handles co-op. Let's enhance it to show combined attempts. Modify the `myTurn` branch inside `updateTurnIndicator`:

For co-op, change the my-turn text to show combined attempts. Update the co-op branch in `updateTurnIndicator`:

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
  } else if (gameMode === 'coop') {
    var totalAttempts = myGuesses.length + opponentGuesses.length;
    if (myTurn) {
      el.className = 'game-header my-turn';
      el.textContent = '你的回合（共 ' + (totalAttempts + 1) + ' / ' + MAX_ROWS + ' 次）';
      inputArea.style.display = 'block';
    } else {
      el.className = 'game-header their-turn';
      var waitingName = opponentName || '隊友';
      el.textContent = waitingName + ' 思考中...';
      inputArea.style.display = 'none';
    }
  } else {
    if (myTurn) {
      el.className = 'game-header my-turn';
      el.textContent = '你的回合（第 ' + (myGuesses.length + 1) + ' 次）';
      inputArea.style.display = 'block';
    } else {
      el.className = 'game-header their-turn';
      el.textContent = '對方思考中...';
      inputArea.style.display = 'none';
    }
  }
  renderGuessInput();
}
```

- [ ] **Step 6: Verify co-op game end-to-end**

Open two browser tabs with `index.html`:
- Tab 1: 雙人合作 → 創建房間
- Tab 2: 雙人合作 → 加入房間
- Connect via SDP exchange
- Host sees "你的回合" and can guess
- After host guesses, guest sees "你的回合"
- Alternate turns, combined attempt count shown
- If someone gets 4 hits: both see "你們贏了！"
- If 8 total attempts used: both see "你們輸了..."
- Result reveals computer code
- 再來一局: host generates new code, game restarts
- Both 回首頁 returns to home

---

### Task 5: Final Polish & Edge Cases

**Files:**
- Modify: `index.html`

This task handles edge cases and ensures all three modes work smoothly together.

- [ ] **Step 1: Ensure goHome fully resets for all modes**

The existing `goHome` function (lines 283-287) already calls `resetState()` which clears all state including `gameMode` and `computerCode`. Verify this works — no changes needed.

- [ ] **Step 2: Handle versus mode startGame call**

The existing `startGame` function (lines 527-535) is only called from `lockCode` when both players lock codes. It sets `myTurn = isHost`. This only runs in versus mode — co-op skips it. Verify that `lockCode` still works for versus. No changes needed since co-op flow doesn't reach `lockCode`.

- [ ] **Step 3: Verify disconnect handling for co-op**

The existing `channel.onclose` handler calls `goHome()` via alert. This works for both versus and co-op. No changes needed.

- [ ] **Step 4: Full regression test**

Test all three modes:
1. **Single player**: Home → 單人模式 → Play → Win/Lose → Rematch → Back
2. **2P Versus**: Home → 雙人對戰 → Host/Join → Connect → Setup codes → Play → Win/Lose → Rematch → Back
3. **2P Co-op**: Home → 雙人合作 → Host/Join → Connect → Play → Win/Lose → Rematch → Back
4. **Disconnect during game**: Works for both 2P modes
5. **Cancel during QR exchange**: Returns to connect screen, then home
