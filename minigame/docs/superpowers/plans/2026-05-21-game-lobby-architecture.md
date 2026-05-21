# Game Lobby Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the single-game guessColor.html into a multi-game SPA with a lobby where users select mode (single/multiplayer), connect via WebRTC, and the host picks which game to play.

**Architecture:** SPA shell (`index.html`) manages the lobby, WebRTC connection, and game lifecycle. Shared modules (`common.js`, `webrtc.js`, `gameManager.js`, `lobby.js`) provide reusable infrastructure. Each game lives in `games/<id>/` and registers via a standard API. The lobby handles mode selection → connection → game selection → launches the game module into a shared container div. Games communicate via a message routing layer that wraps game-specific messages.

**Tech Stack:** Vanilla JavaScript (no build tools, no ES modules — uses `<script>` tags for file:// compatibility), HTML5, CSS3. WebRTC DataChannel for P2P.

---

## File Structure

| Path | Responsibility |
|------|---------------|
| `index.html` | SPA shell: loads all scripts, contains screen containers |
| `css/common.css` | Shared styles: CSS variables, buttons, cards, toast, color utilities |
| `css/lobby.css` | Lobby-specific styles: game grid, mode selection, waiting screen |
| `js/common.js` | Utilities: `showToast()`, `copyText()`, `encodeSDP()`, `decodeSDP()` |
| `js/webrtc.js` | WebRTC module: connection creation, SDP exchange, ICE handling |
| `js/gameManager.js` | Game registry, lifecycle, dynamic loading, message routing |
| `js/lobby.js` | Lobby screens, mode selection, connection flow, game selection |
| `games/guessColor/guessColor.css` | Game-specific styles (extracted from guessColor.html) |
| `games/guessColor/guessColor.js` | Game logic + rendering (extracted from guessColor.html) |
| `guessColor.html` | Redirects to `index.html` (backward compatibility) |

### Game Registration API

Each game module calls `App.GameManager.register()` with this shape:

```js
App.GameManager.register({
  id: 'guessColor',           // unique identifier, matches folder name
  name: '猜顏色',              // display name
  icon: '🎨',                  // emoji icon
  description: 'Hit & Blow',  // short description
  supportsSingle: true,       // can play solo
  supportsMultiplayer: true,  // can play with a friend
  init(container, opts) {},   // called to start the game
  handleMessage(msg) {},      // called on P2P message for this game
  destroy() {}                // called to clean up
});
```

The `opts` passed to `init()`:
```js
{
  mode: 'single' | 'versus' | 'coop',
  isHost: boolean,
  playerName: string,
  opponentName: string       // empty for single player
}
```

### Message Routing

Lobby-level messages (handled by lobby.js before game starts):
- `player_info` — exchange names
- `game_select` — host tells joiner which game was selected

Game-level messages (wrapped in envelope after game starts):
```json
{ "type": "game_msg", "payload": { ... } }
```

The `gameManager` unwraps `game_msg` and passes `payload` to the active game's `handleMessage()`.

---

### Task 1: Directory Structure & Shared CSS

**Files:**
- Create: `css/common.css`
- Create: `css/lobby.css`

- [ ] **Step 1: Create directory structure**

Run:
```bash
cd minigame
mkdir -p css js games/guessColor
```

- [ ] **Step 2: Create `css/common.css`**

Extract shared styles from `guessColor.html` lines 8-173 into a standalone CSS file. This is a 1:1 extraction of the CSS custom properties, reset, and shared component styles:

```css
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f0f0f0;--card:#fff;--shadow:0 4px 16px rgba(0,0,0,.1);
  --radius:12px;--text:#333;--muted:#888;
  --red:#E74C3C;--blue:#3498DB;--yellow:#F1C40F;
  --green:#2ECC71;--orange:#E67E22;--pink:#E91E8C;
  --hit:#2ECC71;--blow:#F39C12;
}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:var(--bg);color:var(--text);min-height:100vh;
  display:flex;justify-content:center;align-items:center;
}
.screen{display:none;width:100%;max-width:600px;padding:20px}
.screen.active{display:block}
.card{
  background:var(--card);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:28px;margin-bottom:16px;
}
h1{font-size:1.6rem;text-align:center;margin-bottom:8px}
h2{font-size:1.2rem;margin-bottom:12px}
.subtitle{text-align:center;color:var(--muted);margin-bottom:20px;font-size:.9rem}
.btn{
  display:block;width:100%;padding:14px;border:none;border-radius:var(--radius);
  font-size:1rem;font-weight:600;cursor:pointer;transition:transform .1s;
  margin-bottom:10px;text-align:center;
}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:#333;color:#fff}
.btn-primary:hover:not(:disabled){background:#444}
.btn-secondary{background:#e0e0e0;color:#333}
.btn-secondary:hover:not(:disabled){background:#d0d0d0}
.btn-small{
  display:inline-block;width:auto;padding:8px 16px;font-size:.85rem;
  border-radius:8px;border:none;cursor:pointer;font-weight:600;
}
.btn-copy{background:#e0e0e0;color:#333}
.btn-copy:hover{background:#d0d0d0}
.code-area{
  width:100%;height:100px;border:2px solid #ddd;border-radius:8px;
  padding:10px;font-size:.85rem;font-family:monospace;resize:none;margin-bottom:8px;
}
.code-area:focus{outline:none;border-color:#999}
.text-input{
  width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;
  font-size:1rem;margin-bottom:12px;text-align:center;
}
.text-input:focus{outline:none;border-color:#999}
.toast-container{
  position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;
  display:flex;flex-direction:column;gap:8px;pointer-events:none;width:90%;max-width:400px
}
.toast{
  background:#333;color:#fff;padding:12px 20px;border-radius:10px;
  font-size:.9rem;text-align:center;pointer-events:auto;
  animation:toastIn .3s ease-out;box-shadow:0 4px 12px rgba(0,0,0,.2)
}
.toast.toast-error{background:#c0392b}
.toast.toast-success{background:#27ae60}
@keyframes toastIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
.btn-leave{
  display:block;width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;
  background:transparent;color:var(--muted);font-size:.85rem;cursor:pointer;
  margin-top:8px;text-align:center
}
.btn-leave:hover{background:rgba(0,0,0,.04);color:var(--text)}
.spinner{
  display:inline-block;width:16px;height:16px;
  border:2px solid #ccc;border-top-color:#333;
  border-radius:50%;animation:spin .6s linear infinite;
  vertical-align:middle;margin-right:6px
}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:480px){
  .screen{padding:12px}
  .card{padding:18px}
  h1{font-size:1.3rem}
}
```

- [ ] **Step 3: Create `css/lobby.css`**

Lobby-specific styles for the game selection grid and mode selection:

```css
.mode-buttons{display:flex;gap:10px;margin-bottom:20px}
.mode-buttons .btn{flex:1}
.game-grid{
  display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:16px 0
}
@media(max-width:380px){.game-grid{grid-template-columns:1fr}}
.game-card{
  background:var(--card);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:20px 12px;
  text-align:center;cursor:pointer;transition:transform .1s,box-shadow .1s;
  border:2px solid transparent;
}
.game-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.15)}
.game-card:active{transform:scale(.97)}
.game-card.disabled{opacity:.4;cursor:not-allowed;pointer-events:none}
.game-card .game-icon{font-size:2rem;margin-bottom:8px}
.game-card .game-name{font-size:.95rem;font-weight:600;color:var(--text)}
.game-card .game-desc{font-size:.75rem;color:var(--muted);margin-top:4px}
.waiting-text{
  text-align:center;padding:40px 20px;color:var(--muted);font-size:1rem
}
.waiting-text .spinner{width:24px;height:24px;border-width:3px;margin-right:8px}
```

- [ ] **Step 4: Verify**

Open browser, check that `css/common.css` and `css/lobby.css` are valid CSS (no syntax errors). No visual test yet.

---

### Task 2: Shared Utilities Module

**Files:**
- Create: `js/common.js`

- [ ] **Step 1: Create `js/common.js`**

Extract utility functions from `guessColor.html` into a shared namespace:

```js
var App = window.App || {};

App.Common = {
  showToast: function(message, type) {
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  },

  copyText: function(id) {
    var el = document.getElementById(id);
    el.select();
    navigator.clipboard.writeText(el.value).catch(function() { document.execCommand('copy'); });
  },

  encodeSDP: function(sdp) {
    return btoa(unescape(encodeURIComponent(sdp)));
  },

  decodeSDP: function(b64) {
    return decodeURIComponent(escape(atob(b64)));
  },

  showScreen: function(id) {
    document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
    var el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
  }
};

window.App = App;
```

- [ ] **Step 2: Commit**

```bash
git add js/common.js css/common.css css/lobby.css
git commit -m "feat: add shared CSS and common utilities module"
```

---

### Task 3: WebRTC Module

**Files:**
- Create: `js/webrtc.js`

This module encapsulates the WebRTC connection management. It exposes an event-based API so the lobby can react to connection state changes.

- [ ] **Step 1: Create `js/webrtc.js`**

```js
var App = window.App || {};

App.WebRTC = (function() {
  var pc = null;
  var dc = null;
  var connected = false;
  var isHost = false;
  var retryCount = 0;
  var MAX_RETRIES = 5;

  var listeners = {
    'open': [],
    'close': [],
    'message': [],
    'error': []
  };

  function on(event, fn) {
    listeners[event].push(fn);
  }

  function off(event, fn) {
    listeners[event] = listeners[event].filter(function(f) { return f !== fn; });
  }

  function emit(event, data) {
    listeners[event].forEach(function(fn) { try { fn(data); } catch(e) {} });
  }

  function createPC() {
    var conn = new RTCPeerConnection({ iceServers: [] });

    conn.oniceconnectionstatechange = function() {
      if (conn.iceConnectionState === 'disconnected' && connected) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          App.Common.showToast('連線不穩，正在重試（' + retryCount + '/' + MAX_RETRIES + '）...', 'error');
          conn.restartIce();
        } else {
          App.Common.showToast('連線已中斷', 'error');
          emit('close');
        }
      } else if (conn.iceConnectionState === 'failed' && connected) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          App.Common.showToast('連線失敗，重試中（' + retryCount + '/' + MAX_RETRIES + '）...', 'error');
          setTimeout(function() { try { conn.restartIce(); } catch(e) {} }, 1000);
        } else {
          App.Common.showToast('連線失敗，已達重試上限', 'error');
          emit('close');
        }
      } else if (conn.iceConnectionState === 'connected' || conn.iceConnectionState === 'completed') {
        retryCount = 0;
      }
    };

    pc = conn;
    return conn;
  }

  function waitGathering(conn) {
    return new Promise(function(resolve) {
      if (conn.iceGatheringState === 'complete') return resolve();
      conn.addEventListener('icegatheringstatechange', function check() {
        if (conn.iceGatheringState === 'complete') {
          conn.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      });
      setTimeout(resolve, 10000);
    });
  }

  function bindChannel(channel) {
    dc = channel;
    channel.onopen = function() {
      connected = true;
      emit('open');
    };
    channel.onclose = function() {
      if (connected) {
        connected = false;
        emit('close');
      }
    };
    channel.onmessage = function(e) {
      try {
        emit('message', JSON.parse(e.data));
      } catch(err) {}
    };
  }

  function send(msg) {
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(msg));
    }
  }

  // Host: create offer, return SDP string for sharing
  function createOffer() {
    isHost = true;
    var conn = createPC();
    bindChannel(conn.createDataChannel('game'));
    return conn.createOffer().then(function(offer) {
      return conn.setLocalDescription(offer);
    }).then(function() {
      return waitGathering(conn);
    }).then(function() {
      if (conn.localDescription) {
        return App.Common.encodeSDP(conn.localDescription.sdp);
      }
      throw new Error('Failed to create offer');
    });
  }

  // Host: accept answer SDP from joiner
  function acceptAnswer(answerB64) {
    if (!pc || pc.signalingState !== 'have-local-offer') {
      throw new Error('Invalid state');
    }
    var sdp = App.Common.decodeSDP(answerB64);
    return pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sdp }));
  }

  // Joiner: process offer, create answer, return answer SDP
  function createAnswer(offerB64) {
    isHost = false;
    var sdp = App.Common.decodeSDP(offerB64);
    var conn = createPC();
    conn.ondatachannel = function(e) { bindChannel(e.channel); };
    return conn.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdp })).then(function() {
      return conn.createAnswer();
    }).then(function(answer) {
      return conn.setLocalDescription(answer);
    }).then(function() {
      return waitGathering(conn);
    }).then(function() {
      if (conn.localDescription) {
        return App.Common.encodeSDP(conn.localDescription.sdp);
      }
      throw new Error('Failed to create answer');
    });
  }

  function cleanDisconnect() {
    if (pc) { try { pc.close(); } catch(e) {} }
    pc = null; dc = null; connected = false; retryCount = 0;
  }

  function getIsHost() { return isHost; }
  function isConnected() { return connected; }

  return {
    on: on,
    off: off,
    send: send,
    createOffer: createOffer,
    acceptAnswer: acceptAnswer,
    createAnswer: createAnswer,
    cleanDisconnect: cleanDisconnect,
    getIsHost: getIsHost,
    isConnected: isConnected
  };
})();

window.App = App;
```

- [ ] **Step 2: Commit**

```bash
git add js/webrtc.js
git commit -m "feat: add WebRTC connection module"
```

---

### Task 4: Game Manager Module

**Files:**
- Create: `js/gameManager.js`

This module manages game registration, dynamic loading, and message routing between the lobby and the active game.

- [ ] **Step 1: Create `js/gameManager.js`**

```js
var App = window.App || {};

App.GameManager = (function() {
  var games = {};
  var activeGame = null;
  var onGameEnd = null;

  function register(gameDef) {
    games[gameDef.id] = gameDef;
  }

  function getGames() {
    return Object.values(games);
  }

  function getGame(id) {
    return games[id] || null;
  }

  // Load a game's CSS and JS dynamically
  function loadGame(id) {
    return new Promise(function(resolve, reject) {
      if (games[id]) {
        resolve(games[id]);
        return;
      }
      // Load CSS
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'games/' + id + '/' + id + '.css';
      document.head.appendChild(link);

      // Load JS
      var script = document.createElement('script');
      script.src = 'games/' + id + '/' + id + '.js';
      script.onload = function() {
        if (games[id]) {
          resolve(games[id]);
        } else {
          reject(new Error('Game ' + id + ' did not register itself'));
        }
      };
      script.onerror = function() {
        reject(new Error('Failed to load game: ' + id));
      };
      document.body.appendChild(script);
    });
  }

  function startGame(id, container, opts, endCallback) {
    var game = games[id];
    if (!game) throw new Error('Game not found: ' + id);
    activeGame = game;
    onGameEnd = endCallback;
    container.innerHTML = '';
    game.init(container, opts);
  }

  function handleMessage(msg) {
    if (activeGame && activeGame.handleMessage) {
      activeGame.handleMessage(msg);
    }
  }

  function endGame() {
    if (activeGame && activeGame.destroy) {
      activeGame.destroy();
    }
    activeGame = null;
    if (onGameEnd) {
      onGameEnd();
      onGameEnd = null;
    }
  }

  function getActiveGame() { return activeGame; }

  return {
    register: register,
    getGames: getGames,
    getGame: getGame,
    loadGame: loadGame,
    startGame: startGame,
    handleMessage: handleMessage,
    endGame: endGame,
    getActiveGame: getActiveGame
  };
})();

window.App = App;
```

- [ ] **Step 2: Commit**

```bash
git add js/gameManager.js
git commit -m "feat: add game manager module with registry and lifecycle"
```

---

### Task 5: Lobby Module

**Files:**
- Create: `js/lobby.js`

This is the main lobby logic: mode selection, connection flow, game selection, and game launching. It orchestrates `App.WebRTC` and `App.GameManager`.

- [ ] **Step 1: Create `js/lobby.js`**

```js
var App = window.App || {};

App.Lobby = (function() {
  // State
  var gameMode = null;       // 'single' | 'versus' | 'coop'
  var playerName = '';
  var opponentName = '';
  var isHost = false;
  var gameActive = false;

  // ===== Navigation =====
  function showScreen(id) {
    App.Common.showScreen(id);
  }

  function setTitle(text) {
    document.title = text ? text + ' - MiniGame' : 'MiniGame';
  }

  // ===== Mode Selection =====
  function selectMode(mode) {
    gameMode = mode;
    if (mode === 'single') {
      showGameSelect('single');
    } else {
      showScreen('connect');
      var titleEl = document.getElementById('connect-title');
      var descEl = document.getElementById('connect-desc');
      if (mode === 'versus') {
        titleEl.textContent = '雙人對戰';
        descEl.textContent = '輪流猜測對方的秘密代碼，先猜中者勝！';
      } else {
        titleEl.textContent = '雙人合作';
        descEl.textContent = '合力破解電腦的秘密代碼！';
      }
      setTitle(mode === 'versus' ? '雙人對戰' : '雙人合作');
    }
  }

  // ===== Game Selection =====
  function showGameSelect(modeFilter) {
    var grid = document.getElementById('game-grid');
    grid.innerHTML = '';
    var games = App.GameManager.getGames();
    games.forEach(function(game) {
      var supported = false;
      if (modeFilter === 'single' && game.supportsSingle) supported = true;
      if (modeFilter !== 'single' && game.supportsMultiplayer) supported = true;
      if (!supported) return;

      var card = document.createElement('div');
      card.className = 'game-card';
      card.innerHTML =
        '<div class="game-icon">' + game.icon + '</div>' +
        '<div class="game-name">' + game.name + '</div>' +
        '<div class="game-desc">' + game.description + '</div>';
      card.onclick = function() { onGameSelected(game.id); };
      grid.appendChild(card);
    });

    var selectTitle = document.getElementById('game-select-title');
    if (selectTitle) {
      selectTitle.textContent = modeFilter === 'single' ? '選擇遊戲' : '選擇遊戲';
    }
    showScreen('game-select');
  }

  function onGameSelected(gameId) {
    if (gameMode === 'single') {
      launchSingleGame(gameId);
    } else {
      // Multiplayer: host selects, joiner waits
      if (App.WebRTC.getIsHost()) {
        App.WebRTC.send({ type: 'game_select', gameId: gameId });
        launchMultiplayerGame(gameId);
      }
    }
  }

  // ===== Single Player =====
  function launchSingleGame(gameId) {
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    App.GameManager.startGame(gameId, container, {
      mode: 'single',
      isHost: true,
      playerName: playerName || '玩家',
      opponentName: ''
    }, function() {
      gameActive = false;
      goHome();
    });
  }

  // ===== Multiplayer =====
  function launchMultiplayerGame(gameId) {
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    App.GameManager.startGame(gameId, container, {
      mode: gameMode,
      isHost: isHost,
      playerName: playerName,
      opponentName: opponentName
    }, function() {
      gameActive = false;
      showGameSelect(gameMode);
    });
  }

  // ===== Host Flow =====
  async function startHost() {
    var nameInput = document.getElementById('player-name-input').value.trim();
    playerName = nameInput || '玩家';
    isHost = true;
    showScreen('host');
    document.getElementById('offer-code').value = '產生中...';
    document.getElementById('answer-input').value = '';
    document.getElementById('host-retry-card').style.display = 'none';
    document.getElementById('btn-connect-host').disabled = false;

    try {
      var offerCode = await App.WebRTC.createOffer();
      document.getElementById('offer-code').value = offerCode;
    } catch (e) {
      App.Common.showToast('創建失敗：' + e.message, 'error');
    }
  }

  async function connectHost() {
    var raw = document.getElementById('answer-input').value.trim();
    if (!raw) { App.Common.showToast('請貼上對方的回應碼', 'error'); return; }
    document.getElementById('btn-connect-host').disabled = true;
    try {
      await App.WebRTC.acceptAnswer(raw);
    } catch (e) {
      App.Common.showToast('回應碼錯誤：' + e.message, 'error');
      document.getElementById('btn-connect-host').disabled = false;
    }
  }

  async function retryHost() {
    document.getElementById('host-retry-card').style.display = 'none';
    App.WebRTC.cleanDisconnect();
    isHost = true;
    document.getElementById('offer-code').value = '產生中...';
    document.getElementById('answer-input').value = '';
    document.getElementById('btn-connect-host').disabled = false;
    try {
      var offerCode = await App.WebRTC.createOffer();
      document.getElementById('offer-code').value = offerCode;
    } catch (e) {
      App.Common.showToast('重試失敗：' + e.message, 'error');
    }
  }

  // ===== Join Flow =====
  async function startJoin() {
    var nameInput = document.getElementById('player-name-input').value.trim();
    playerName = nameInput || '玩家';
    isHost = false;
    showScreen('join');
    document.getElementById('offer-input').value = '';
    document.getElementById('answer-code').value = '';
    document.getElementById('join-answer-card').style.display = 'none';
    document.getElementById('btn-gen-answer').disabled = false;
    document.getElementById('join-retry-card').style.display = 'none';
  }

  async function generateAnswer() {
    var raw = document.getElementById('offer-input').value.trim();
    if (!raw) { App.Common.showToast('請貼上對方的邀請碼', 'error'); return; }
    document.getElementById('btn-gen-answer').disabled = true;
    try {
      var answerCode = await App.WebRTC.createAnswer(raw);
      document.getElementById('answer-code').value = answerCode;
      document.getElementById('join-answer-card').style.display = 'block';
    } catch (e) {
      App.Common.showToast('邀請碼錯誤：' + e.message, 'error');
      document.getElementById('btn-gen-answer').disabled = false;
    }
  }

  function retryJoin() {
    App.WebRTC.cleanDisconnect();
    isHost = false;
    document.getElementById('join-retry-card').style.display = 'none';
    document.getElementById('offer-input').value = '';
    document.getElementById('answer-code').value = '';
    document.getElementById('join-answer-card').style.display = 'none';
    document.getElementById('btn-gen-answer').disabled = false;
  }

  // ===== Connection Events =====
  function onConnectionOpen() {
    // Send player name to opponent
    App.WebRTC.send({ type: 'player_info', name: playerName });
    // Host shows game selection, joiner waits
    if (App.WebRTC.getIsHost()) {
      showGameSelect(gameMode);
    } else {
      showScreen('waiting');
      setTitle('等待房主選擇遊戲...');
    }
  }

  function onConnectionClose() {
    if (gameActive) {
      App.GameManager.endGame();
      gameActive = false;
    }
    App.Common.showToast('連線已中斷，可按重試重新連線', 'error');
    if (isHost) {
      document.getElementById('host-retry-card').style.display = 'block';
    } else {
      document.getElementById('join-retry-card').style.display = 'block';
    }
  }

  // ===== P2P Message Routing =====
  function handleMessage(msg) {
    switch (msg.type) {
      case 'player_info':
        opponentName = msg.name;
        break;
      case 'game_select':
        // Joiner receives game selection from host
        launchMultiplayerGame(msg.gameId);
        break;
      case 'game_msg':
        // Route game-specific messages to active game
        App.GameManager.handleMessage(msg.payload);
        break;
    }
  }

  // ===== Home =====
  function goHome() {
    App.WebRTC.cleanDisconnect();
    if (gameActive) {
      App.GameManager.endGame();
      gameActive = false;
    }
    gameMode = null;
    playerName = '';
    opponentName = '';
    isHost = false;
    setTitle('');
    showScreen('home');
    // Reset retry cards
    var hostRetry = document.getElementById('host-retry-card');
    if (hostRetry) hostRetry.style.display = 'none';
    var joinRetry = document.getElementById('join-retry-card');
    if (joinRetry) joinRetry.style.display = 'none';
  }

  // ===== Init =====
  function init() {
    // Bind WebRTC events
    App.WebRTC.on('open', onConnectionOpen);
    App.WebRTC.on('close', onConnectionClose);
    App.WebRTC.on('message', handleMessage);

    // Page unload warning
    window.addEventListener('beforeunload', function(e) {
      if (App.WebRTC.isConnected() && gameActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  return {
    init: init,
    selectMode: selectMode,
    showGameSelect: showGameSelect,
    startHost: startHost,
    connectHost: connectHost,
    retryHost: retryHost,
    startJoin: startJoin,
    generateAnswer: generateAnswer,
    retryJoin: retryJoin,
    goHome: goHome,
    launchMultiplayerGame: launchMultiplayerGame,
    setTitle: setTitle
  };
})();

window.App = App;
```

- [ ] **Step 2: Commit**

```bash
git add js/lobby.js
git commit -m "feat: add lobby module with mode selection and connection flow"
```

---

### Task 6: SPA Shell (index.html)

**Files:**
- Create: `index.html`

The SPA shell that loads all modules and contains the screen containers. This is the main entry point.

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MiniGame</title>
<link rel="stylesheet" href="css/common.css">
<link rel="stylesheet" href="css/lobby.css">
</head>
<body>
<div class="toast-container" id="toast-container"></div>

<!-- Home Screen -->
<div id="screen-home" class="screen active">
  <div class="card">
    <h1>MiniGame</h1>
    <p class="subtitle">選擇遊戲模式</p>
    <div class="mode-buttons">
      <button class="btn btn-primary" onclick="App.Lobby.selectMode('single')">單人遊戲</button>
      <button class="btn btn-secondary" onclick="App.Lobby.selectMode('versus')">雙人對戰</button>
    </div>
    <button class="btn btn-secondary" onclick="App.Lobby.selectMode('coop')">雙人合作</button>
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

<!-- Game Selection Screen -->
<div id="screen-game-select" class="screen">
  <div class="card">
    <h2 id="game-select-title">選擇遊戲</h2>
    <div class="game-grid" id="game-grid"></div>
  </div>
  <button class="btn btn-secondary" onclick="App.Lobby.goHome()">← 返回</button>
</div>

<!-- Connect Screen (enter name, host/join) -->
<div id="screen-connect" class="screen">
  <div class="card">
    <h2 id="connect-title">雙人模式</h2>
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px" id="connect-desc"></p>
    <input type="text" id="player-name-input" placeholder="輸入你的名字" maxlength="12"
      class="text-input">
    <button class="btn btn-primary" onclick="App.Lobby.startHost()">創建房間</button>
    <button class="btn btn-secondary" onclick="App.Lobby.startJoin()">加入房間</button>
  </div>
  <button class="btn btn-secondary" onclick="App.Lobby.goHome()">← 返回</button>
</div>

<!-- Host Screen -->
<div id="screen-host" class="screen">
  <div class="card">
    <h2>創建房間</h2>
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">
      步驟 1：複製下方邀請碼，傳給對方
    </p>
    <textarea id="offer-code" class="code-area" readonly placeholder="產生中..."></textarea>
    <button class="btn-small btn-copy" onclick="App.Common.copyText('offer-code')">複製邀請碼</button>
  </div>
  <div class="card">
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">
      步驟 2：貼上對方的回應碼，然後按連線
    </p>
    <textarea id="answer-input" class="code-area" placeholder="貼上對方的回應碼..."></textarea>
    <button class="btn btn-primary" id="btn-connect-host" onclick="App.Lobby.connectHost()">連線</button>
  </div>
  <div class="card" id="host-retry-card" style="display:none">
    <p style="text-align:center;color:var(--muted);font-size:.9rem;margin-bottom:12px">連線已中斷</p>
    <button class="btn btn-primary" onclick="App.Lobby.retryHost()">重新產生邀請碼</button>
  </div>
  <button class="btn btn-secondary" onclick="App.Lobby.goHome()">← 返回</button>
</div>

<!-- Join Screen -->
<div id="screen-join" class="screen">
  <div class="card">
    <h2>加入房間</h2>
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">
      步驟 1：貼上對方的邀請碼，然後按產生回應碼
    </p>
    <textarea id="offer-input" class="code-area" placeholder="貼上對方的邀請碼..."></textarea>
    <button class="btn btn-primary" id="btn-gen-answer" onclick="App.Lobby.generateAnswer()">產生回應碼</button>
  </div>
  <div class="card" id="join-answer-card" style="display:none">
    <p style="font-size:.85rem;color:var(--muted);margin-bottom:12px">
      步驟 2：複製下方回應碼，傳給對方，等他連線
    </p>
    <textarea id="answer-code" class="code-area" readonly></textarea>
    <button class="btn-small btn-copy" onclick="App.Common.copyText('answer-code')">複製回應碼</button>
    <p style="text-align:center;margin-top:12px;color:var(--muted);font-size:.85rem">
      <span class="spinner"></span>等待對方連線...
    </p>
  </div>
  <div class="card" id="join-retry-card" style="display:none">
    <p style="text-align:center;color:var(--muted);font-size:.9rem;margin-bottom:12px">連線已中斷</p>
    <button class="btn btn-primary" onclick="App.Lobby.retryJoin()">重新輸入邀請碼</button>
  </div>
  <button class="btn btn-secondary" onclick="App.Lobby.goHome()">← 返回</button>
</div>

<!-- Waiting Screen (joiner waits for host to select game) -->
<div id="screen-waiting" class="screen">
  <div class="card">
    <div class="waiting-text">
      <span class="spinner"></span>等待房主選擇遊戲...
    </div>
  </div>
  <button class="btn btn-secondary" onclick="App.Lobby.goHome()">← 返回</button>
</div>

<!-- Game Container (game modules render here) -->
<div id="screen-game" class="screen">
  <div id="game-container"></div>
</div>

<!-- Scripts: load order matters -->
<script src="js/common.js"></script>
<script src="js/webrtc.js"></script>
<script src="js/gameManager.js"></script>
<script src="js/lobby.js"></script>
<script>
// Load all game modules, then init lobby
(function() {
  var gamesToLoad = ['guessColor'];
  var loaded = 0;

  gamesToLoad.forEach(function(id) {
    // Load game CSS
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'games/' + id + '/' + id + '.css';
    document.head.appendChild(link);

    // Load game JS
    var script = document.createElement('script');
    script.src = 'games/' + id + '/' + id + '.js';
    script.onload = function() {
      loaded++;
      if (loaded === gamesToLoad.length) {
        App.Lobby.init();
      }
    };
    script.onerror = function() {
      console.warn('Failed to load game: ' + id);
      loaded++;
      if (loaded === gamesToLoad.length) {
        App.Lobby.init();
      }
    };
    document.body.appendChild(script);
  });
})();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add SPA shell with lobby screens"
```

---

### Task 7: Extract GuessColor Game Module

**Files:**
- Create: `games/guessColor/guessColor.css`
- Create: `games/guessColor/guessColor.js`

This is the most substantial task. We extract the game-specific logic from `guessColor.html` into a module that registers with `App.GameManager`. The key changes:

1. **CSS**: Extract game-specific styles (color palette, pins, guess rows, selection display, game header, opponent section, result display)
2. **JS**: Wrap all game logic in a module, use `App.WebRTC.send()` instead of local `send()`, route messages via `App.GameManager`, render into the `container` element

- [ ] **Step 1: Create `games/guessColor/guessColor.css`**

Extract game-specific styles (NOT the shared ones already in common.css). These are the color palette, pin, guess row, selection display, game header, opponent section, and result styles:

```css
/* Color palette & pins */
.color-palette{
  display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin:16px 0
}
.color-btn{
  width:48px;height:48px;border-radius:50%;border:3px solid transparent;
  cursor:pointer;transition:transform .15s,border-color .15s;
}
.color-btn:hover{transform:scale(1.1)}
.color-btn[data-color="red"]{background:var(--red)}
.color-btn[data-color="blue"]{background:var(--blue)}
.color-btn[data-color="yellow"]{background:var(--yellow)}
.color-btn[data-color="green"]{background:var(--green)}
.color-btn[data-color="orange"]{background:var(--orange)}
.color-btn[data-color="pink"]{background:var(--pink)}
.pin{
  width:36px;height:36px;border-radius:50%;border:2px solid #ccc;
  display:flex;align-items:center;justify-content:center;font-size:.7rem;color:#999
}
.pin[data-color="red"]{background:var(--red);border-color:var(--red)}
.pin[data-color="blue"]{background:var(--blue);border-color:var(--blue)}
.pin[data-color="yellow"]{background:var(--yellow);border-color:var(--yellow)}
.pin[data-color="green"]{background:var(--green);border-color:var(--green)}
.pin[data-color="orange"]{background:var(--orange);border-color:var(--orange)}
.pin[data-color="pink"]{background:var(--pink);border-color:var(--pink)}

/* Game header */
.game-header{
  text-align:center;padding:12px;font-weight:700;font-size:1rem;
  border-radius:var(--radius);margin-bottom:12px;
}
.game-header.my-turn{background:#d4edda;color:#155724}
.game-header.their-turn{background:#f8d7da;color:#721c24}
.game-header.waiting{background:#fff3cd;color:#856404}

/* Guess area */
.guess-area{margin-bottom:12px}
.guess-row{
  display:flex;align-items:center;gap:6px;padding:6px 8px;
  border-radius:8px;margin-bottom:4px;background:rgba(0,0,0,.03)
}
.guess-row.current{background:rgba(0,0,0,.07);border:1px dashed #ccc}
.guess-row .row-num{
  width:22px;text-align:center;font-size:.75rem;color:var(--muted);flex-shrink:0
}
.guess-row .pins{display:flex;gap:4px;flex-shrink:0}
.guess-row .pins .pin{width:30px;height:30px}
.guess-row .result{display:flex;gap:3px;margin-left:auto;flex-shrink:0}
.hit-dot,.blow-dot,.empty-dot{
  width:14px;height:14px;border-radius:50%;display:inline-block
}
.hit-dot{background:var(--hit)}
.blow-dot{background:var(--blow)}
.empty-dot{border:1px solid #ddd}

/* Opponent section */
.opponent-section{
  padding:12px;border-radius:var(--radius);background:rgba(0,0,0,.04);margin-bottom:12px
}
.opponent-section h3{font-size:.9rem;margin-bottom:8px;color:var(--muted)}

/* Player-tagged rows (co-op) */
.guess-row.player-me{background:rgba(52,152,219,.08)}
.guess-row.player-opponent{background:rgba(231,76,60,.08)}
.guess-row .player-name{
  font-size:.7rem;font-weight:600;padding:2px 6px;border-radius:4px;
  margin-right:4px;flex-shrink:0;min-width:32px;text-align:center
}
.guess-row.player-me .player-name{background:rgba(52,152,219,.2);color:#2980b9}
.guess-row.player-opponent .player-name{background:rgba(231,76,60,.2);color:#c0392b}

/* Selection display */
.selection-display{
  display:flex;justify-content:center;gap:8px;margin:12px 0
}
.selection-pin{
  width:44px;height:44px;border-radius:50%;border:3px dashed #ccc;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:.7rem;color:#bbb;transition:border-color .15s
}
.selection-pin.filled{border-style:solid}
.selection-pin.active-slot{border-color:#333;border-width:3px}
.selection-pin[data-color="red"]{background:var(--red);border-color:var(--red)}
.selection-pin[data-color="blue"]{background:var(--blue);border-color:var(--blue)}
.selection-pin[data-color="yellow"]{background:var(--yellow);border-color:var(--yellow)}
.selection-pin[data-color="green"]{background:var(--green);border-color:var(--green)}
.selection-pin[data-color="orange"]{background:var(--orange);border-color:var(--orange)}
.selection-pin[data-color="pink"]{background:var(--pink);border-color:var(--pink)}

/* Status & reveal */
.status-bar{
  text-align:center;padding:8px;font-size:.85rem;color:var(--muted);margin-top:8px
}
.reveal-row{display:flex;justify-content:center;gap:8px;margin:12px 0}
.reveal-row .pin{width:40px;height:40px}
.result-title{font-size:1.4rem;text-align:center;margin-bottom:16px}
.result-win{color:var(--hit)}
.result-lose{color:var(--red)}

/* Responsive */
@media(max-width:480px){
  .color-btn{width:42px;height:42px}
  .pin{width:30px;height:30px}
  .selection-pin{width:38px;height:38px}
}
```

- [ ] **Step 2: Create `games/guessColor/guessColor.js`**

This is the core extraction. The game logic is nearly identical to `guessColor.html` lines 313-1279, but wrapped in a module that:
- Registers with `App.GameManager`
- Uses `App.WebRTC.send()` for P2P messages
- Renders into a container element instead of using hardcoded screen IDs
- Uses `App.Common.showToast()` and `App.Lobby.setTitle()`

```js
(function() {
  var COLORS = ['red','blue','yellow','green','orange','pink'];
  var SLOTS = 4;
  var MAX_ROWS = 12;

  // State
  var container = null;
  var opts = null;
  var myCode = [], opponentCode = [];
  var myGuesses = [], opponentGuesses = [];
  var myTurn = true, codeLocked = false, opponentCodeLocked = false, gameOver = false;
  var pendingGuess = null;
  var computerCode = [];
  var setupSelection = [null,null,null,null], setupActiveSlot = 0;
  var guessSelection = [null,null,null,null], guessActiveSlot = 0;

  function resetGameState() {
    myCode = []; opponentCode = [];
    myGuesses = []; opponentGuesses = [];
    myTurn = true; codeLocked = false; opponentCodeLocked = false;
    gameOver = false; pendingGuess = null; computerCode = [];
    setupSelection = [null,null,null,null]; setupActiveSlot = 0;
    guessSelection = [null,null,null,null]; guessActiveSlot = 0;
  }

  function generateComputerCode() {
    var code = [];
    for (var i = 0; i < SLOTS; i++) {
      code.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
    }
    return code;
  }

  function send(msg) {
    App.WebRTC.send({ type: 'game_msg', payload: msg });
  }

  function setTitle(text) {
    App.Lobby.setTitle(text ? text + ' - 猜顏色' : '猜顏色');
  }

  // ===== Rendering helpers =====
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function dot(cls) {
    return el('div', cls);
  }

  function renderCodeReveal(parent, code) {
    parent.innerHTML = '';
    if (code.length === SLOTS) {
      code.forEach(function(c) {
        var p = el('div', 'pin');
        p.dataset.color = c;
        parent.appendChild(p);
      });
    } else {
      parent.innerHTML = '<span style="color:var(--muted)">等待揭曉...</span>';
    }
  }

  // ===== Screen rendering =====
  // The game renders screens dynamically into the container.
  // Each "screen" is just different HTML injected into container.

  function showSetupScreen() {
    setTitle('🔐 設定密碼');
    setupSelection = [null,null,null,null];
    setupActiveSlot = 0;
    codeLocked = false;

    container.innerHTML =
      '<div class="card">' +
        '<h2>設定你的秘密代碼</h2>' +
        '<p style="font-size:.85rem;color:var(--muted);margin-bottom:8px">選 4 色（可重複）</p>' +
        '<div class="selection-display" id="gc-setup-display"></div>' +
        '<div class="color-palette" id="gc-setup-palette"></div>' +
        '<button class="btn btn-primary" id="gc-btn-lock" disabled>確認鎖定</button>' +
        '<div class="status-bar" id="gc-setup-status">等待雙方設定密碼...</div>' +
      '</div>' +
      '<button class="btn-leave" id="gc-btn-leave-setup">離開遊戲</button>';

    document.getElementById('gc-btn-lock').onclick = lockCode;
    document.getElementById('gc-btn-leave-setup').onclick = function() {
      App.Lobby.goHome();
    };

    renderSetupDisplay();
    renderSetupPalette();
    updateSetupStatus();
  }

  function renderSetupDisplay() {
    var c = document.getElementById('gc-setup-display');
    if (!c) return;
    c.innerHTML = '';
    for (var i = 0; i < SLOTS; i++) {
      var pin = el('div', 'selection-pin' + (setupSelection[i] ? ' filled' : '') + (i === setupActiveSlot ? ' active-slot' : ''));
      if (setupSelection[i]) pin.dataset.color = setupSelection[i];
      else pin.textContent = i + 1;
      (function(idx) {
        pin.onclick = function() {
          if (!codeLocked) { setupActiveSlot = idx; renderSetupDisplay(); }
        };
      })(i);
      c.appendChild(pin);
    }
  }

  function renderSetupPalette() {
    var c = document.getElementById('gc-setup-palette');
    if (!c) return;
    c.innerHTML = '';
    COLORS.forEach(function(color) {
      var btn = el('div', 'color-btn');
      btn.dataset.color = color;
      btn.onclick = function() { selectSetupColor(color); };
      c.appendChild(btn);
    });
  }

  function selectSetupColor(color) {
    if (codeLocked) return;
    setupSelection[setupActiveSlot] = color;
    setupActiveSlot = (setupActiveSlot + 1) % SLOTS;
    renderSetupDisplay();
    var lockBtn = document.getElementById('gc-btn-lock');
    if (lockBtn) lockBtn.disabled = !setupSelection.every(function(s) { return s !== null; });
  }

  function lockCode() {
    if (setupSelection.some(function(s) { return s === null; })) return;
    myCode = setupSelection.slice();
    codeLocked = true;
    send({ type: 'code_ready' });
    var lockBtn = document.getElementById('gc-btn-lock');
    if (lockBtn) { lockBtn.disabled = true; lockBtn.textContent = '已鎖定'; }
    updateSetupStatus();
    if (opponentCodeLocked) startVersusGame();
  }

  function updateSetupStatus() {
    var el = document.getElementById('gc-setup-status');
    if (!el) return;
    if (codeLocked && opponentCodeLocked) el.textContent = '雙方已就緒！';
    else if (codeLocked) el.innerHTML = '<span class="spinner"></span>等待對方設定密碼...';
    else if (opponentCodeLocked) el.textContent = '對方已就緒，請設定你的密碼';
    else el.textContent = '等待雙方設定密碼...';
  }

  // ===== Game Screen =====
  function showGameScreen() {
    container.innerHTML =
      '<div class="game-header my-turn" id="gc-turn-indicator">你的回合</div>' +
      '<div class="card">' +
        '<h2 id="gc-my-title" style="font-size:1rem;margin-bottom:8px">我的猜測</h2>' +
        '<div class="guess-area" id="gc-my-guesses"></div>' +
      '</div>' +
      '<div class="opponent-section" id="gc-opponent-section">' +
        '<h3 id="gc-opponent-label">對方進度</h3>' +
        '<div id="gc-opponent-guesses"></div>' +
      '</div>' +
      '<div class="card" id="gc-input-area">' +
        '<div class="selection-display" id="gc-guess-display"></div>' +
        '<div class="color-palette" id="gc-guess-palette"></div>' +
        '<button class="btn btn-primary" id="gc-btn-submit" disabled>確認猜測</button>' +
      '</div>' +
      '<button class="btn-leave" id="gc-btn-leave-game">離開遊戲</button>';

    document.getElementById('gc-btn-submit').onclick = submitGuess;
    document.getElementById('gc-btn-leave-game').onclick = function() {
      App.Lobby.goHome();
    };

    renderGameBoard();
    updateTurnIndicator();
  }

  function renderGameBoard() {
    var mode = opts.mode;
    var oppSection = document.getElementById('gc-opponent-section');
    var myTitle = document.getElementById('gc-my-title');

    if (mode === 'single') {
      oppSection.style.display = 'none';
      myTitle.textContent = '猜測記錄';
      renderMyGuesses();
      renderGuessInput();
    } else if (mode === 'coop') {
      oppSection.style.display = 'none';
      myTitle.textContent = '合力猜測';
      renderCoopMergedGuesses();
      renderGuessInput();
    } else {
      oppSection.style.display = 'block';
      myTitle.textContent = '我的猜測';
      var label = opts.opponentName ? opts.opponentName + ' 的進度' : '對方進度';
      document.getElementById('gc-opponent-label').textContent = label;
      renderMyGuesses();
      renderOpponentGuesses();
      renderGuessInput();
    }
  }

  function renderMyGuesses() {
    var c = document.getElementById('gc-my-guesses');
    if (!c) return;
    c.innerHTML = '';
    for (var i = 0; i < MAX_ROWS; i++) {
      var row = el('div', 'guess-row' + (i === myGuesses.length && !gameOver && myTurn ? ' current' : ''));
      row.appendChild(el('div', 'row-num', i + 1));
      var pins = el('div', 'pins');
      for (var j = 0; j < SLOTS; j++) {
        var pin = el('div', 'pin');
        if (i < myGuesses.length) pin.dataset.color = myGuesses[i].colors[j];
        pins.appendChild(pin);
      }
      row.appendChild(pins);
      var result = el('div', 'result');
      if (i < myGuesses.length) {
        var g = myGuesses[i];
        for (var h = 0; h < g.hits; h++) result.appendChild(dot('hit-dot'));
        for (var b = 0; b < g.blows; b++) result.appendChild(dot('blow-dot'));
        for (var e = 0; e < SLOTS - g.hits - g.blows; e++) result.appendChild(dot('empty-dot'));
      }
      row.appendChild(result);
      c.appendChild(row);
    }
  }

  function renderOpponentGuesses() {
    var c = document.getElementById('gc-opponent-guesses');
    if (!c) return;
    c.innerHTML = '';
    if (opponentGuesses.length === 0) {
      c.innerHTML = '<div style="font-size:.85rem;color:var(--muted);padding:4px">對方尚未猜測</div>';
      return;
    }
    for (var i = 0; i < opponentGuesses.length; i++) {
      var g = opponentGuesses[i];
      var row = el('div', 'guess-row');
      row.appendChild(el('div', 'row-num', i + 1));
      var pins = el('div', 'pins');
      for (var j = 0; j < SLOTS; j++) {
        var pin = el('div', 'pin');
        if (g.colors[j]) pin.dataset.color = g.colors[j];
        pins.appendChild(pin);
      }
      row.appendChild(pins);
      var result = el('div', 'result');
      for (var h = 0; h < g.hits; h++) result.appendChild(dot('hit-dot'));
      for (var b = 0; b < g.blows; b++) result.appendChild(dot('blow-dot'));
      for (var e = 0; e < SLOTS - g.hits - g.blows; e++) result.appendChild(dot('empty-dot'));
      row.appendChild(result);
      c.appendChild(row);
    }
  }

  function renderCoopMergedGuesses() {
    var c = document.getElementById('gc-my-guesses');
    if (!c) return;
    c.innerHTML = '';
    var isHost = opts.isHost;
    var merged = [];
    var myIdx = 0, oppIdx = 0;
    var total = myGuesses.length + opponentGuesses.length;
    for (var turn = 0; turn < total; turn++) {
      var isMySlot = isHost ? (turn % 2 === 0) : (turn % 2 === 1);
      if (isMySlot && myIdx < myGuesses.length) {
        merged.push({guess: myGuesses[myIdx], isMe: true, name: opts.playerName || '你'});
        myIdx++;
      } else if (oppIdx < opponentGuesses.length) {
        merged.push({guess: opponentGuesses[oppIdx], isMe: false, name: opts.opponentName || '隊友'});
        oppIdx++;
      }
    }
    for (var i = 0; i < MAX_ROWS; i++) {
      var row = el('div', 'guess-row' + (i === merged.length && !gameOver && myTurn ? ' current' : ''));
      if (i < merged.length) {
        row.classList.add(merged[i].isMe ? 'player-me' : 'player-opponent');
      }
      row.appendChild(el('div', 'row-num', i + 1));
      if (i < merged.length) {
        var nameTag = el('div', 'player-name', merged[i].name.substring(0, 4));
        row.appendChild(nameTag);
      }
      var pins = el('div', 'pins');
      for (var j = 0; j < SLOTS; j++) {
        var pin = el('div', 'pin');
        if (i < merged.length && merged[i].guess.colors[j]) pin.dataset.color = merged[i].guess.colors[j];
        pins.appendChild(pin);
      }
      row.appendChild(pins);
      var result = el('div', 'result');
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

  function renderGuessInput() {
    var c = document.getElementById('gc-guess-display');
    if (!c) return;
    c.innerHTML = '';
    for (var i = 0; i < SLOTS; i++) {
      var pin = el('div', 'selection-pin' + (guessSelection[i] ? ' filled' : '') + (i === guessActiveSlot ? ' active-slot' : ''));
      if (guessSelection[i]) pin.dataset.color = guessSelection[i];
      else pin.textContent = i + 1;
      (function(idx) {
        pin.onclick = function() {
          if (myTurn && !gameOver) { guessActiveSlot = idx; renderGuessInput(); }
        };
      })(i);
      c.appendChild(pin);
    }
    var palette = document.getElementById('gc-guess-palette');
    if (!palette) return;
    palette.innerHTML = '';
    COLORS.forEach(function(color) {
      var btn = el('div', 'color-btn');
      btn.dataset.color = color;
      btn.onclick = function() {
        if (myTurn && !gameOver) {
          guessSelection[guessActiveSlot] = color;
          guessActiveSlot = (guessActiveSlot + 1) % SLOTS;
          renderGuessInput();
        }
      };
      palette.appendChild(btn);
    });
    var submitBtn = document.getElementById('gc-btn-submit');
    if (submitBtn) {
      submitBtn.disabled = !guessSelection.every(function(s) { return s !== null; }) || !myTurn || gameOver;
    }
  }

  function updateTurnIndicator() {
    var indicator = document.getElementById('gc-turn-indicator');
    var inputArea = document.getElementById('gc-input-area');
    if (!indicator || !inputArea) return;

    if (gameOver) {
      indicator.className = 'game-header waiting';
      indicator.textContent = '遊戲結束';
      inputArea.style.display = 'none';
      return;
    }

    var mode = opts.mode;
    if (mode === 'single') {
      indicator.className = 'game-header my-turn';
      indicator.textContent = '第 ' + (myGuesses.length + 1) + ' / ' + MAX_ROWS + ' 次嘗試';
      inputArea.style.display = 'block';
      setTitle('🎯 第 ' + (myGuesses.length + 1) + '/' + MAX_ROWS + ' 次嘗試');
    } else if (mode === 'coop') {
      var totalAttempts = myGuesses.length + opponentGuesses.length;
      if (myTurn) {
        indicator.className = 'game-header my-turn';
        indicator.textContent = '你的回合（共 ' + (totalAttempts + 1) + ' / ' + MAX_ROWS + ' 次）';
        inputArea.style.display = 'block';
        setTitle('🔔 輪到你了');
      } else {
        indicator.className = 'game-header their-turn';
        var waitName = opts.opponentName || '隊友';
        indicator.textContent = waitName + ' 思考中...';
        inputArea.style.display = 'none';
        setTitle('⏳ 等待 ' + waitName);
      }
    } else {
      if (myTurn) {
        indicator.className = 'game-header my-turn';
        indicator.textContent = '你的回合（第 ' + (myGuesses.length + 1) + ' 次）';
        inputArea.style.display = 'block';
        setTitle('🔔 輪到你了');
      } else {
        indicator.className = 'game-header their-turn';
        var waitName2 = opts.opponentName || '對方';
        indicator.textContent = waitName2 + ' 思考中...';
        inputArea.style.display = 'none';
        setTitle('⏳ 等待 ' + waitName2);
      }
    }
    renderGuessInput();
  }

  // ===== Game Logic =====
  function calculateHitBlow(guess, secret) {
    var hits = 0, blows = 0;
    var sc = secret.slice(), gc = guess.slice();
    for (var i = 0; i < SLOTS; i++) {
      if (gc[i] === sc[i]) { hits++; sc[i] = null; gc[i] = null; }
    }
    for (var i = 0; i < SLOTS; i++) {
      if (gc[i] === null) continue;
      var idx = sc.indexOf(gc[i]);
      if (idx !== -1) { blows++; sc[idx] = null; }
    }
    return { hits: hits, blows: blows };
  }

  function submitGuess() {
    if (gameOver) return;
    var colors = guessSelection.slice();
    if (colors.some(function(c) { return c === null; })) return;

    if (opts.mode === 'single') {
      submitSingleGuess(colors);
    } else if (opts.mode === 'coop') {
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

  // ===== Message Handling =====
  function handleMessage(msg) {
    switch (msg.type) {
      case 'code_ready':
        opponentCodeLocked = true;
        updateSetupStatus();
        if (codeLocked && opponentCodeLocked) startVersusGame();
        break;
      case 'guess':
        handleOpponentGuess(msg);
        break;
      case 'guess_result':
        handleMyGuessResult(msg);
        break;
      case 'game_over':
        handleGameOver(msg);
        break;
      case 'reveal':
        opponentCode = msg.code;
        var revealEl = document.getElementById('gc-reveal-opp-code');
        if (revealEl) renderCodeReveal(revealEl, opponentCode);
        break;
      case 'rematch':
        if (opts.mode === 'coop') {
          startCoopRematch();
        } else {
          resetForRematch();
        }
        break;
      case 'coop_start':
        computerCode = msg.code;
        startCoopGameBoard();
        break;
      case 'coop_guess':
        handleCoopGuess(msg);
        break;
    }
  }

  function handleOpponentGuess(msg) {
    var result = calculateHitBlow(msg.colors, myCode);
    opponentGuesses.push({ colors: msg.colors, hits: result.hits, blows: result.blows });
    send({ type: 'guess_result', row: msg.row, hits: result.hits, blows: result.blows });
    if (result.hits === SLOTS) {
      gameOver = true;
      send({ type: 'game_over', winner: 'opponent' });
      send({ type: 'reveal', code: myCode });
      renderOpponentGuesses();
      showResult(false);
    } else {
      renderOpponentGuesses();
      myTurn = true;
      updateTurnIndicator();
    }
  }

  function handleMyGuessResult(msg) {
    if (!pendingGuess) return;
    myGuesses.push({ colors: pendingGuess, hits: msg.hits, blows: msg.blows });
    pendingGuess = null;
    renderMyGuesses();
    if (msg.hits === SLOTS) {
      gameOver = true;
      send({ type: 'game_over', winner: 'me' });
      send({ type: 'reveal', code: myCode });
      updateTurnIndicator();
      showResult(true);
    } else if (myGuesses.length >= MAX_ROWS) {
      gameOver = true;
      send({ type: 'game_over', winner: 'draw' });
      send({ type: 'reveal', code: myCode });
      updateTurnIndicator();
      showResult(false);
    } else {
      updateTurnIndicator();
    }
  }

  function handleCoopGuess(msg) {
    if (gameOver) return;
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

  function handleGameOver(msg) {
    if (gameOver) return;
    gameOver = true;
    send({ type: 'reveal', code: myCode });
    updateTurnIndicator();
    if (opts.mode === 'coop') {
      showResult(msg.winner === 'team');
    } else {
      showResult(msg.winner === 'me');
    }
  }

  // ===== Result =====
  function showResult(iWin) {
    gameOver = true;
    var mode = opts.mode;
    if (mode === 'single') {
      setTitle(iWin ? '🎉 你贏了！' : '😞 你輸了...');
    } else if (mode === 'coop') {
      setTitle(iWin ? '🎉 你們贏了！' : '😞 你們輸了...');
    } else {
      setTitle(iWin ? '🎉 你贏了！' : '😞 你輸了...');
    }

    var myCodeLabel, oppCodeLabel;
    if (mode === 'single' || mode === 'coop') {
      myCodeLabel = '';
      oppCodeLabel = '電腦的答案';
    } else {
      myCodeLabel = '你的秘密代碼';
      oppCodeLabel = '對方的秘密代碼';
    }

    container.innerHTML =
      '<div class="card">' +
        '<div class="result-title ' + (iWin ? 'result-win' : 'result-lose') + '">' +
          (mode === 'coop'
            ? (iWin ? '你們贏了！' : '你們輸了...')
            : (iWin ? '你贏了！' : '你輸了...')) +
        '</div>' +
        (myCodeLabel ? '<p style="font-size:.85rem;color:var(--muted);text-align:center;margin-bottom:12px">' + myCodeLabel + '</p>' : '') +
        (myCodeLabel ? '<div class="reveal-row" id="gc-reveal-my-code"></div>' : '') +
        '<p style="font-size:.85rem;color:var(--muted);text-align:center;margin:12px 0">' + oppCodeLabel + '</p>' +
        '<div class="reveal-row" id="gc-reveal-opp-code"></div>' +
        '<button class="btn btn-primary" style="margin-top:16px" id="gc-btn-rematch">再來一局</button>' +
        '<button class="btn btn-secondary" id="gc-btn-back-home">返回大廳</button>' +
      '</div>';

    document.getElementById('gc-btn-rematch').onclick = rematch;
    document.getElementById('gc-btn-back-home').onclick = function() {
      App.GameManager.endGame();
    };

    // Reveal codes
    if (myCodeLabel) {
      renderCodeReveal(document.getElementById('gc-reveal-my-code'), myCode);
    }
    var revealTarget = (mode === 'single' || mode === 'coop') ? computerCode : (opponentCode.length === SLOTS ? opponentCode : []);
    renderCodeReveal(document.getElementById('gc-reveal-opp-code'), revealTarget);
  }

  // ===== Rematch =====
  function rematch() {
    if (opts.mode === 'single') {
      computerCode = generateComputerCode();
      startSingleGame();
    } else if (opts.mode === 'coop') {
      send({ type: 'rematch' });
      startCoopRematch();
    } else {
      send({ type: 'rematch' });
      resetForRematch();
    }
  }

  function resetForRematch() {
    myCode = []; opponentCode = [];
    myGuesses = []; opponentGuesses = [];
    myTurn = true; codeLocked = false; opponentCodeLocked = false;
    gameOver = false; pendingGuess = null;
    setupSelection = [null,null,null,null]; setupActiveSlot = 0;
    guessSelection = [null,null,null,null]; guessActiveSlot = 0;
    showSetupScreen();
  }

  function startCoopRematch() {
    myGuesses = []; opponentGuesses = [];
    gameOver = false; pendingGuess = null;
    myTurn = opts.isHost;
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    if (opts.isHost) {
      computerCode = generateComputerCode();
      send({ type: 'coop_start', code: computerCode });
    }
    showGameScreen();
  }

  function startSingleGame() {
    myGuesses = [];
    gameOver = false;
    pendingGuess = null;
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    showGameScreen();
  }

  function startVersusGame() {
    myTurn = opts.isHost;
    myGuesses = []; opponentGuesses = [];
    gameOver = false; pendingGuess = null;
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    showGameScreen();
  }

  function startCoopGameBoard() {
    myGuesses = []; opponentGuesses = [];
    gameOver = false; pendingGuess = null;
    myTurn = opts.isHost;
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    showGameScreen();
  }

  // ===== Game Module API =====
  function init(containerEl, gameOpts) {
    container = containerEl;
    opts = gameOpts;
    resetGameState();

    if (opts.mode === 'single') {
      computerCode = generateComputerCode();
      startSingleGame();
    } else if (opts.mode === 'coop') {
      // Co-op: host generates code and shares; skip setup screen
      if (opts.isHost) {
        computerCode = generateComputerCode();
        send({ type: 'coop_start', code: computerCode });
        startCoopGameBoard();
      } else {
        // Guest waits for coop_start message via handleMessage
        container.innerHTML = '<div class="card"><div class="waiting-text"><span class="spinner"></span>等待遊戲開始...</div></div>';
      }
    } else {
      // Versus: both set secret codes
      showSetupScreen();
    }
  }

  function destroy() {
    container = null;
    opts = null;
    resetGameState();
  }

  // Register with game manager
  App.GameManager.register({
    id: 'guessColor',
    name: '猜顏色',
    icon: '🎨',
    description: 'Hit & Blow',
    supportsSingle: true,
    supportsMultiplayer: true,
    init: init,
    handleMessage: handleMessage,
    destroy: destroy
  });
})();
```

- [ ] **Step 3: Commit**

```bash
git add games/guessColor/guessColor.js games/guessColor/guessColor.css
git commit -m "feat: extract guessColor into game module"
```

---

### Task 8: Backward Compatibility Redirect

**Files:**
- Modify: `guessColor.html`

- [ ] **Step 1: Replace guessColor.html with redirect**

Replace the entire `guessColor.html` with a simple redirect to `index.html`:

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=index.html">
<title>Redirecting...</title>
</head>
<body>
<p>Redirecting to <a href="index.html">MiniGame</a>...</p>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add guessColor.html
git commit -m "feat: redirect guessColor.html to new SPA lobby"
```

---

### Task 9: Integration Testing

No automated tests exist for this project. Manual browser testing is required.

- [ ] **Step 1: Test single player flow**

1. Open `index.html` in browser
2. Verify home screen shows: "MiniGame" title, 3 mode buttons, connection instructions
3. Click "單人遊戲"
4. Verify game grid shows "猜顏色 🎨" card
5. Click the card
6. Verify game starts immediately with guess input
7. Play a full game, verify hit/blow feedback
8. Win or lose, verify result screen shows correct code reveal
9. Click "再來一局", verify new game starts
10. Click "返回大廳", verify returns to home screen

Expected: All single player flows work identically to original guessColor.html

- [ ] **Step 2: Test multiplayer versus flow**

1. Open two browser tabs with `index.html`
2. Tab 1: Click "雙人對戰" → enter name → "創建房間"
3. Copy offer code from Tab 1
4. Tab 2: Click "雙人對戰" → enter name → "加入房間" → paste offer → "產生回應碼"
5. Copy answer code from Tab 2
6. Tab 1: Paste answer code → "連線"
7. Tab 1 should show game selection grid (host)
8. Tab 2 should show "等待房主選擇遊戲..."
9. Tab 1: Click "猜顏色 🎨"
10. Both tabs should show setup screen (set secret codes)
11. Both set codes → game starts → play through → result → rematch

Expected: Full versus flow works end-to-end

- [ ] **Step 3: Test multiplayer co-op flow**

1. Open two browser tabs with `index.html`
2. Tab 1: Click "雙人合作" → enter name → "創建房間"
3. Tab 2: Click "雙人合作" → enter name → "加入房間"
4. Connect via SDP exchange
5. Tab 1 (host) sees game grid, selects "猜顏色"
6. Both tabs should show co-op game board immediately (no setup)
7. Play alternating turns, verify merged guess display with player names
8. Win or lose, verify result

Expected: Full co-op flow works end-to-end

- [ ] **Step 4: Test backward compatibility**

1. Open `guessColor.html` directly
2. Should redirect to `index.html` immediately

- [ ] **Step 5: Test edge cases**

1. Disconnect during game: close one tab, verify other shows retry UI
2. Cancel during connection: click "← 返回" from host/join screens
3. Quick mode switching: go home, switch modes rapidly

Expected: All edge cases handled gracefully

---

## Self-Review

### Spec Coverage
- Mode selection (single/versus/coop): Task 6 (index.html) + Task 5 (lobby.js)
- Host game selection after connect: Task 5 (onConnectionOpen → showGameSelect)
- Joiner waits until game starts: Task 5 (waiting screen) + Task 6 (screen-waiting HTML)
- WebRTC connection: Task 3 (webrtc.js) + Task 5 (lobby.js host/join flow)
- Game module architecture: Task 4 (gameManager.js) + Task 7 (guessColor module)
- Backward compatibility: Task 8 (redirect)
- Testing: Task 9

### Placeholder Scan
No TBD, TODO, "implement later", or placeholder patterns found. All code is complete.

### Type Consistency
- `App.GameManager.register()` called with `{ id, name, icon, description, supportsSingle, supportsMultiplayer, init, handleMessage, destroy }` — consistent across Task 4 definition and Task 7 usage
- `App.WebRTC.send({ type: 'game_msg', payload: msg })` in Task 7 matches `handleMessage(msg.payload)` routing in Task 5
- Game `init(container, opts)` with `opts.mode/isHost/playerName/opponentName` — consistent between Task 5 (launchSingleGame/launchMultiplayerGame) and Task 7 (init function)
- All element IDs in Task 7 use `gc-` prefix to avoid collision with lobby IDs in Task 6
