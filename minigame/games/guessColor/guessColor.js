(function() {
  var COLORS = ['red','blue','yellow','green','orange','purple'];
  var SLOTS = 4;
  var MAX_ROWS = 12;

  var container = null;
  var opts = null;
  var myGuesses = [], opponentGuesses = [];
  var myTurn = true, gameOver = false;
  var pendingGuess = null;
  var computerCode = [];
  var startTime = 0;
  var finishedAt = 0;
  var opponentProgress = { attempts: 0, elapsed: 0, finished: false };
  var guessSelection = [null,null,null,null], guessActiveSlot = 0;
  var applyingRoomSnapshot = false;

  function isSpectator() {
    return opts && opts.role === 'spectator';
  }

  function isRoomMode() {
    return opts && opts.roomId;
  }

  function canUseFirebaseActionFallback() {
    return isRoomMode() && App.Lobby && typeof App.Lobby.sendRoomGameAction === 'function';
  }

  function isRoomReconnecting() {
    return isRoomMode() && !isSpectator() && opts.mode !== 'single' && !App.WebRTC.isConnected() && !canUseFirebaseActionFallback();
  }

  function getPlayerIndex() {
    var players = opts && opts.players ? opts.players : [];
    if (players.length && opts.selfId) {
      for (var i = 0; i < players.length; i++) {
        if (players[i].id === opts.selfId) return i;
      }
    }
    if (isSpectator()) return -1;
    return opts && opts.isHost ? 0 : 1;
  }

  function getPlayerCount() {
    var players = opts && opts.players ? opts.players : [];
    return Math.max(2, players.length || 2);
  }

  function isMyCoopSlot(turnIndex) {
    var playerIndex = getPlayerIndex();
    return playerIndex >= 0 && playerIndex === (turnIndex % getPlayerCount());
  }

  function getPlayerById(id) {
    var players = opts && opts.players ? opts.players : [];
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === id) return players[i];
    }
    return null;
  }

  function getOpponentPlayer() {
    var players = opts && opts.players ? opts.players : [];
    for (var i = 0; i < players.length; i++) {
      if (players[i].id !== opts.selfId) return players[i];
    }
    return null;
  }

  function hasGuessRecord(list, msg) {
    if (!msg || !msg.createdAt) return false;
    return list.some(function(g) {
      return g.createdAt === msg.createdAt && (!msg.playerId || g.playerId === msg.playerId);
    });
  }

  function resetGameState() {
    myGuesses = []; opponentGuesses = [];
    myTurn = true;
    gameOver = false; pendingGuess = null; computerCode = [];
    startTime = 0; finishedAt = 0;
    opponentProgress = { attempts: 0, elapsed: 0, finished: false };
    guessSelection = [null,null,null,null]; guessActiveSlot = 0;
    applyingRoomSnapshot = false;
  }

  function generateComputerCode() {
    var code = [];
    for (var i = 0; i < SLOTS; i++) {
      code.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
    }
    return code;
  }

  function send(msg) {
    if (isSpectator()) return;
    if (isRoomMode() && !opts.isHost && canUseFirebaseActionFallback()) {
      App.Lobby.sendRoomGameAction(msg);
      return;
    }
    if (isRoomMode() && opts.isHost) {
      return;
    }
    var sent = App.WebRTC.send({ type: 'game_msg', payload: msg });
    if (!sent && canUseFirebaseActionFallback()) {
      App.Lobby.sendRoomGameAction(msg);
    }
  }

  function makeGuessRecord(colors, result, extra) {
    extra = extra || {};
    return {
      playerId: opts.selfId || '',
      playerName: opts.playerName || '玩家',
      colors: colors.slice(),
      hits: result.hits,
      blows: result.blows,
      elapsed: extra.elapsed || 0,
      finished: !!extra.finished,
      createdAt: Date.now()
    };
  }

  function getRoomGuessRows() {
    var rows = [];
    myGuesses.forEach(function(g) {
      rows.push({
        playerId: opts.selfId || '',
        playerName: opts.playerName || '玩家',
        colors: (g.colors || []).slice(),
        hits: g.hits || 0,
        blows: g.blows || 0,
        elapsed: g.elapsed || 0,
        finished: g.hits === SLOTS,
        createdAt: g.createdAt || 0
      });
    });
    var opponent = getOpponentPlayer();
    opponentGuesses.forEach(function(g) {
      rows.push({
        playerId: (g.playerId || (opponent && opponent.id) || 'opponent'),
        playerName: (g.playerName || opts.opponentName || '對方'),
        colors: (g.colors || []).slice(),
        hits: g.hits || 0,
        blows: g.blows || 0,
        elapsed: g.elapsed || 0,
        finished: g.hits === SLOTS,
        createdAt: g.createdAt || 0
      });
    });
    return rows.sort(function(a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  }

  function currentTurnClientIdFromGuesses(guesses) {
    var players = opts && opts.players ? opts.players : [];
    if (!players.length || opts.mode !== 'coop') return '';
    return players[guesses.length % players.length].id;
  }

  function saveRoomSnapshot(stateOverride) {
    if (!isRoomMode() || !opts.isHost || applyingRoomSnapshot || !App.Signaling || !App.Signaling.setGameState) return;
    var guesses = stateOverride && stateOverride.guesses ? stateOverride.guesses : getRoomGuessRows();
    var raceProgress = stateOverride && stateOverride.raceProgressByPlayerId ? stateOverride.raceProgressByPlayerId : {};
    if (opts.mode === 'race') {
      raceProgress[opts.selfId] = raceProgress[opts.selfId] || {
        attempts: myGuesses.length,
        elapsed: finishedAt || elapsedMs(),
        finished: !!finishedAt
      };
      var opponent = getOpponentPlayer();
      if (opponent && !raceProgress[opponent.id]) raceProgress[opponent.id] = opponentProgress;
    }
    var state = {
      computerCode: computerCode.slice(),
      guesses: guesses,
      gameOver: stateOverride && stateOverride.gameOver !== undefined ? !!stateOverride.gameOver : gameOver,
      winner: stateOverride && stateOverride.winner ? stateOverride.winner : '',
      winnerPlayerId: stateOverride && stateOverride.winnerPlayerId ? stateOverride.winnerPlayerId : '',
      turnClientId: stateOverride && stateOverride.turnClientId !== undefined ? stateOverride.turnClientId : currentTurnClientIdFromGuesses(guesses),
      raceProgressByPlayerId: raceProgress,
      savedAt: Date.now()
    };
    App.Signaling.setGameState({
      gameId: 'guessColor',
      mode: opts.mode,
      roundId: opts.roundId || '',
      state: state
    }).catch(function(e) {
      App.Common.showToast('同步房間狀態失敗：' + e.message, 'error');
    });
  }

  function setTitle(text) {
    App.Lobby.setTitle(text ? text + ' - 猜顏色' : '猜顏色');
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function dot(cls) {
    return el('div', cls);
  }

  function elapsedMs() {
    return startTime ? Date.now() - startTime : 0;
  }

  function formatTime(ms) {
    var total = Math.max(0, Math.floor(ms / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
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

  function appendGuessRow(parent, item, idx, label) {
    var row = el('div', 'guess-row result-history-row');
    row.appendChild(el('div', 'row-num', idx + 1));
    if (label) row.appendChild(el('div', 'player-name', label));
    var pins = el('div', 'pins');
    for (var j = 0; j < SLOTS; j++) {
      var pin = el('div', 'pin');
      if (item.colors[j]) pin.dataset.color = item.colors[j];
      pins.appendChild(pin);
    }
    row.appendChild(pins);
    var result = el('div', 'result');
    for (var h = 0; h < item.hits; h++) result.appendChild(dot('hit-dot'));
    for (var b = 0; b < item.blows; b++) result.appendChild(dot('blow-dot'));
    for (var e = 0; e < SLOTS - item.hits - item.blows; e++) result.appendChild(dot('empty-dot'));
    row.appendChild(result);
    parent.appendChild(row);
  }

  function appendHistorySection(parent, title, guesses, label) {
    var section = el('div', 'result-history-section');
    section.appendChild(el('h3', null, title));
    if (guesses.length === 0) {
      section.appendChild(el('p', 'result-history-empty', '沒有作答紀錄'));
    } else {
      guesses.forEach(function(g, idx) {
        appendGuessRow(section, g, idx, label);
      });
    }
    parent.appendChild(section);
  }

  function renderResultHistory() {
    var target = document.getElementById('gc-result-history');
    if (!target) return;
    target.innerHTML = '';
    if (opts.mode === 'coop') {
      var merged = [];
      var myIdx = 0, oppIdx = 0;
      var total = myGuesses.length + opponentGuesses.length;
      for (var turn = 0; turn < total; turn++) {
        var isMySlot = isMyCoopSlot(turn);
        if (isMySlot && myIdx < myGuesses.length) {
          merged.push({ guess: myGuesses[myIdx], label: opts.playerName || '你' });
          myIdx++;
        } else if (oppIdx < opponentGuesses.length) {
          merged.push({ guess: opponentGuesses[oppIdx], label: opponentGuesses[oppIdx].playerName || opts.opponentName || '隊友' });
          oppIdx++;
        }
      }
      var section = el('div', 'result-history-section');
      section.appendChild(el('h3', null, '作答紀錄'));
      if (merged.length === 0) {
        section.appendChild(el('p', 'result-history-empty', '沒有作答紀錄'));
      } else {
        merged.forEach(function(item, idx) {
          appendGuessRow(section, item.guess, idx, item.label);
        });
      }
      target.appendChild(section);
    } else if (opts.mode === 'single') {
      appendHistorySection(target, '作答紀錄', myGuesses);
    } else if (opts.mode === 'race') {
      appendHistorySection(target, '我的作答（' + myGuesses.length + ' 次 / ' + formatTime(finishedAt || elapsedMs()) + '）', myGuesses);
      appendHistorySection(target, (opts.opponentName || '對方') + ' 的作答（' + opponentProgress.attempts + ' 次 / ' + formatTime(opponentProgress.elapsed) + '）', opponentGuesses);
    } else {
      appendHistorySection(target, '我的作答', myGuesses);
      appendHistorySection(target, (opts.opponentName || '對方') + ' 的作答', opponentGuesses);
    }
  }

  // ===== Game Screen =====
  function showGameScreen() {
    container.innerHTML =
      '<div class="gc-shell">' +
        '<div class="gc-topbar">' +
          '<div>' +
            '<div class="gc-title" id="gc-turn-indicator">你的回合</div>' +
          '</div>' +
          '<div class="gc-actions">' +
            '<button class="gc-icon-btn" id="gc-btn-leave-game" aria-label="離開遊戲">×</button>' +
          '</div>' +
        '</div>' +
        '<div class="gc-room-info" id="gc-room-info"></div>' +
        '<div class="gc-playfield">' +
          '<section class="gc-board-panel">' +
            '<div class="spectator-answer" id="gc-spectator-answer" style="display:none"></div>' +
            '<div class="gc-board-head">' +
              '<h2 id="gc-my-title">我的猜測</h2>' +
              '<span id="gc-attempt-label">1/' + MAX_ROWS + '</span>' +
            '</div>' +
            '<div class="guess-area" id="gc-my-guesses"></div>' +
          '</section>' +
          '<section class="opponent-section" id="gc-opponent-section">' +
            '<h3 id="gc-opponent-label">對方進度</h3>' +
            '<div id="gc-opponent-guesses"></div>' +
          '</section>' +
          '<section class="gc-input-panel" id="gc-input-area">' +
            '<div class="selection-display" id="gc-guess-display"></div>' +
            '<div class="color-palette" id="gc-guess-palette"></div>' +
            '<button class="btn btn-primary" id="gc-btn-submit" disabled>確認猜測</button>' +
          '</section>' +
        '</div>' +
      '</div>';

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
    renderRoomInfo();
    renderSpectatorAnswer();

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
    } else if (mode === 'race') {
      oppSection.style.display = 'block';
      myTitle.textContent = '我的競速';
      document.getElementById('gc-opponent-label').textContent = opts.opponentName || '對方';
      renderMyGuesses();
      renderRaceProgress();
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

  function renderSpectatorAnswer() {
    var target = document.getElementById('gc-spectator-answer');
    if (!target) return;
    if (!isSpectator()) {
      target.style.display = 'none';
      return;
    }
    target.style.display = 'block';
    target.innerHTML = '<span>觀戰答案</span><div class="reveal-row" id="gc-spectator-code"></div>';
    renderCodeReveal(document.getElementById('gc-spectator-code'), computerCode);
  }

  function renderRoomInfo() {
    var target = document.getElementById('gc-room-info');
    if (!target) return;
    var players = opts && opts.players ? opts.players : [];
    var spectators = opts && opts.spectators ? opts.spectators : [];
    if (!isRoomMode() && players.length === 0 && spectators.length === 0) {
      target.style.display = 'none';
      return;
    }
    target.style.display = 'flex';
    target.innerHTML = '';

    function addGroup(label, people, emptyText) {
      var group = el('div', 'gc-room-group');
      group.appendChild(el('span', 'gc-room-group-title', label));
      if (!people.length) {
        group.appendChild(el('span', 'gc-room-empty', emptyText));
      } else {
        people.forEach(function(person) {
          var cls = 'gc-room-person';
          if (person.id === opts.selfId) cls += ' self';
          if (person.online === false) cls += ' offline';
          group.appendChild(el('span', cls, person.name || '玩家'));
        });
      }
      target.appendChild(group);
    }

    addGroup('玩家', players, '暫無');
    addGroup('觀戰', spectators, '暫無');
  }

  function renderMyGuesses() {
    var c = document.getElementById('gc-my-guesses');
    if (!c) return;
    c.innerHTML = '';
    var unlimited = opts.mode === 'race';
    var visibleStart = unlimited ? Math.max(0, myGuesses.length - MAX_ROWS + 1) : 0;
    for (var i = 0; i < MAX_ROWS; i++) {
      var guessIdx = visibleStart + i;
      var isCurrent = guessIdx === myGuesses.length && !gameOver && myTurn;
      var row = el('div', 'guess-row' + (isCurrent ? ' current' : ''));
      row.appendChild(el('div', 'row-num', guessIdx + 1));
      var pins = el('div', 'pins');
      for (var j = 0; j < SLOTS; j++) {
        var pin = el('div', 'pin');
        if (guessIdx < myGuesses.length) pin.dataset.color = myGuesses[guessIdx].colors[j];
        pins.appendChild(pin);
      }
      row.appendChild(pins);
      var result = el('div', 'result');
      if (guessIdx < myGuesses.length) {
        var g = myGuesses[guessIdx];
        for (var h = 0; h < g.hits; h++) result.appendChild(dot('hit-dot'));
        for (var b = 0; b < g.blows; b++) result.appendChild(dot('blow-dot'));
        for (var e = 0; e < SLOTS - g.hits - g.blows; e++) result.appendChild(dot('empty-dot'));
      }
      row.appendChild(result);
      c.appendChild(row);
    }
  }

  function renderRaceProgress() {
    var c = document.getElementById('gc-opponent-guesses');
    if (!c) return;
    c.innerHTML =
      '<div class="race-status-grid">' +
        '<div><span>我的次數</span><strong>' + myGuesses.length + '</strong></div>' +
        '<div><span>我的時間</span><strong>' + formatTime(finishedAt || elapsedMs()) + '</strong></div>' +
        '<div><span>對方次數</span><strong>' + opponentProgress.attempts + '</strong></div>' +
        '<div><span>對方時間</span><strong>' + formatTime(opponentProgress.elapsed) + '</strong></div>' +
      '</div>' +
      (opponentProgress.finished ? '<p class="race-finished-note">對方已完成</p>' : '');
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
    var merged = [];
    var myIdx = 0, oppIdx = 0;
    var total = myGuesses.length + opponentGuesses.length;
    for (var turn = 0; turn < total; turn++) {
      var isMySlot = isMyCoopSlot(turn);
      if (isMySlot && myIdx < myGuesses.length) {
        merged.push({guess: myGuesses[myIdx], isMe: true, name: opts.playerName || '你'});
        myIdx++;
      } else if (oppIdx < opponentGuesses.length) {
        merged.push({guess: opponentGuesses[oppIdx], isMe: false, name: opponentGuesses[oppIdx].playerName || opts.opponentName || '隊友'});
        oppIdx++;
      }
    }
    var visibleStart = Math.max(0, total - MAX_ROWS + 1);
    var visibleMerged = merged.slice(visibleStart, visibleStart + MAX_ROWS);
    for (var i = 0; i < MAX_ROWS; i++) {
      var rowIdx = visibleStart + i;
      var mergedIdx = i;
      var row = el('div', 'guess-row' + (rowIdx === total && !gameOver && myTurn ? ' current' : ''));
      if (mergedIdx < visibleMerged.length) {
        row.classList.add(visibleMerged[mergedIdx].isMe ? 'player-me' : 'player-opponent');
      }
      row.appendChild(el('div', 'row-num', rowIdx + 1));
      if (mergedIdx < visibleMerged.length) {
        var nameTag = el('div', 'player-name', visibleMerged[mergedIdx].name);
        row.appendChild(nameTag);
      }
      var pins = el('div', 'pins');
      for (var j = 0; j < SLOTS; j++) {
        var pin = el('div', 'pin');
        if (mergedIdx < visibleMerged.length && visibleMerged[mergedIdx].guess.colors[j]) pin.dataset.color = visibleMerged[mergedIdx].guess.colors[j];
        pins.appendChild(pin);
      }
      row.appendChild(pins);
      var result = el('div', 'result');
      if (mergedIdx < visibleMerged.length) {
        var g = visibleMerged[mergedIdx].guess;
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
    var canInteract = !isSpectator() && !isRoomReconnecting() && myTurn && !gameOver;
    var inputArea = document.getElementById('gc-input-area');
    if (inputArea) inputArea.classList.toggle('is-disabled', !canInteract);
    c.innerHTML = '';
    for (var i = 0; i < SLOTS; i++) {
      var pin = el('div', 'selection-pin' + (guessSelection[i] ? ' filled' : '') + (i === guessActiveSlot ? ' active-slot' : ''));
      if (guessSelection[i]) pin.dataset.color = guessSelection[i];
      else pin.textContent = i + 1;
      (function(idx) {
        pin.onclick = function() {
          if (canInteract) {
            if (guessSelection[idx]) {
              guessSelection[idx] = null;
              guessActiveSlot = idx;
            } else {
              guessActiveSlot = idx;
            }
            renderGuessInput();
          }
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
        if (canInteract) {
          guessSelection[guessActiveSlot] = color;
          guessActiveSlot = (guessActiveSlot + 1) % SLOTS;
          renderGuessInput();
        }
      };
      palette.appendChild(btn);
    });
    var submitBtn = document.getElementById('gc-btn-submit');
    if (submitBtn) {
      submitBtn.disabled = !canInteract || !guessSelection.every(function(s) { return s !== null; });
    }
  }

  function updateTurnIndicator() {
    var indicator = document.getElementById('gc-turn-indicator');
    var inputArea = document.getElementById('gc-input-area');
    var attemptLabel = document.getElementById('gc-attempt-label');
    if (!indicator || !inputArea) return;

    if (gameOver) {
      indicator.className = 'gc-title waiting';
      indicator.textContent = '遊戲結束';
      inputArea.style.display = 'block';
      renderGuessInput();
      return;
    }

    if (isSpectator()) {
      indicator.className = 'gc-title waiting';
      indicator.textContent = '觀戰中';
      inputArea.style.display = 'block';
      if (attemptLabel) attemptLabel.textContent = '觀戰';
      setTitle('觀戰中');
      renderSpectatorAnswer();
      renderGuessInput();
      return;
    }

    if (isRoomReconnecting()) {
      indicator.className = 'gc-title waiting';
      indicator.textContent = '重新連線中...';
      inputArea.style.display = 'block';
      setTitle('重新連線中');
      renderGuessInput();
      return;
    }

    var mode = opts.mode;
    if (mode === 'single') {
      indicator.className = 'gc-title my-turn';
      indicator.textContent = '第 ' + (myGuesses.length + 1) + ' 次嘗試';
      if (attemptLabel) attemptLabel.textContent = (myGuesses.length + 1) + '/' + MAX_ROWS;
      inputArea.style.display = 'block';
      setTitle('🎯 第 ' + (myGuesses.length + 1) + '/' + MAX_ROWS + ' 次嘗試');
    } else if (mode === 'coop') {
      var totalAttempts = myGuesses.length + opponentGuesses.length;
      if (attemptLabel) attemptLabel.textContent = String(totalAttempts + 1);
      if (myTurn) {
        indicator.className = 'gc-title my-turn';
        indicator.textContent = '你的回合';
        inputArea.style.display = 'block';
        setTitle('🔔 輪到你了');
      } else {
        indicator.className = 'gc-title their-turn';
        var waitName = opts.opponentName || '隊友';
        indicator.textContent = waitName + ' 思考中...';
        inputArea.style.display = 'block';
        setTitle('⏳ 等待 ' + waitName);
      }
    } else if (mode === 'race') {
      indicator.className = 'gc-title my-turn';
      indicator.textContent = gameOver ? '競速結束' : '競速中 ' + formatTime(elapsedMs());
      if (attemptLabel) attemptLabel.textContent = myGuesses.length + ' 次';
      inputArea.style.display = gameOver ? 'none' : 'block';
      setTitle('競速中 ' + formatTime(elapsedMs()));
      renderRaceProgress();
    } else {
      if (attemptLabel) attemptLabel.textContent = (myGuesses.length + 1) + '/' + MAX_ROWS;
      if (myTurn) {
        indicator.className = 'gc-title my-turn';
        indicator.textContent = '你的回合';
        inputArea.style.display = 'block';
        setTitle('🔔 輪到你了');
      } else {
        indicator.className = 'gc-title their-turn';
        var waitName2 = opts.opponentName || '對方';
        indicator.textContent = waitName2 + ' 思考中...';
        inputArea.style.display = 'block';
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
    if (gameOver || isSpectator()) return;
    if (isRoomReconnecting()) {
      App.Common.showToast('正在重新連線，請稍候', 'error');
      return;
    }
    var colors = guessSelection.slice();
    if (colors.some(function(c) { return c === null; })) return;

    if (opts.mode === 'single') {
      submitSingleGuess(colors);
    } else if (opts.mode === 'coop') {
      submitCoopGuess(colors);
    } else if (opts.mode === 'race') {
      submitRaceGuess(colors);
    } else {
      submitCoopGuess(colors);
    }
  }

  function showAnswer() {
    if (gameOver) return;
    gameOver = true;
    if (opts.mode !== 'single') {
      send({ type: 'game_over', winner: opts.mode === 'coop' ? 'none' : 'opponent' });
      send({ type: 'reveal', code: computerCode });
    }
    updateTurnIndicator();
    showResult(false);
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

  function submitCoopGuess(colors) {
    if (!myTurn || gameOver) return;
    var result = calculateHitBlow(colors, computerCode);
    var guessRecord = makeGuessRecord(colors, result, { finished: result.hits === SLOTS });
    myGuesses.push(guessRecord);
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    if (result.hits === SLOTS) {
      gameOver = true;
      send({ type: 'coop_guess', playerId: opts.selfId, playerName: opts.playerName, colors: colors, hits: result.hits, blows: result.blows, code: computerCode, createdAt: guessRecord.createdAt });
      send({ type: 'game_over', winner: 'team', code: computerCode });
      saveRoomSnapshot({ gameOver: true, winner: 'team', winnerPlayerId: opts.selfId, turnClientId: '' });
      renderGameBoard();
      updateTurnIndicator();
      showResult(true);
    } else {
      send({ type: 'coop_guess', playerId: opts.selfId, playerName: opts.playerName, colors: colors, hits: result.hits, blows: result.blows, createdAt: guessRecord.createdAt });
      myTurn = false;
      saveRoomSnapshot();
      renderGameBoard();
      updateTurnIndicator();
    }
  }

  function submitRaceGuess(colors) {
    if (gameOver) return;
    var result = calculateHitBlow(colors, computerCode);
    var elapsed = elapsedMs();
    var guessRecord = makeGuessRecord(colors, result, { elapsed: elapsed, finished: result.hits === SLOTS });
    myGuesses.push(guessRecord);
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    var raceProgress = {};
    raceProgress[opts.selfId] = {
      attempts: myGuesses.length,
      elapsed: elapsed,
      finished: result.hits === SLOTS
    };
    send({
      type: 'race_progress',
      playerId: opts.selfId,
      attempts: myGuesses.length,
      elapsed: elapsed,
      finished: result.hits === SLOTS,
      guesses: myGuesses
    });
    if (result.hits === SLOTS) {
      finishedAt = elapsed;
      gameOver = true;
      send({
        type: 'race_finish',
        playerId: opts.selfId,
        playerName: opts.playerName,
        attempts: myGuesses.length,
        elapsed: finishedAt,
        guesses: myGuesses,
        code: computerCode
      });
      saveRoomSnapshot({ gameOver: true, winner: 'me', winnerPlayerId: opts.selfId, raceProgressByPlayerId: raceProgress });
      renderGameBoard();
      updateTurnIndicator();
      showResult(!opponentProgress.finished || finishedAt <= opponentProgress.elapsed);
    } else {
      saveRoomSnapshot({ raceProgressByPlayerId: raceProgress });
      renderGameBoard();
      updateTurnIndicator();
    }
  }

  // ===== Message Handling =====
  function handleMessage(msg) {
    switch (msg.type) {
      case 'game_over':
        handleGameOver(msg);
        break;
      case 'reveal':
        computerCode = msg.code || computerCode;
        var revealEl = document.getElementById('gc-reveal-opp-code');
        if (revealEl) renderCodeReveal(revealEl, computerCode);
        break;
      case 'rematch':
        if (opts.mode === 'single') {
          startSingleGame();
        } else if (opts.isHost) {
          startMultiplayerRound(true);
        } else {
          showWaitingForStart();
        }
        break;
      case 'round_start':
        computerCode = msg.code;
        startMultiplayerRound(false);
        break;
      case 'coop_guess':
        handleCoopGuess(msg);
        break;
      case 'race_progress':
        handleRaceProgress(msg);
        break;
      case 'race_finish':
        handleRaceFinish(msg);
        break;
      case 'room_update':
        handleRoomUpdate(msg);
        break;
    }
  }

  function handleRoomUpdate(msg) {
    if (!opts) return;
    opts.players = msg.players || opts.players || [];
    opts.spectators = msg.spectators || opts.spectators || [];
    opts.role = msg.role || opts.role;
    opts.selfId = msg.selfId || opts.selfId;
    applyRoomSnapshot(msg.gameState);
    renderRoomInfo();
    updateTurnIndicator();
  }

  function applyRoomSnapshot(gameState) {
    if (!isRoomMode() || !gameState || gameState.roundId !== opts.roundId || !gameState.state) return;
    var state = gameState.state;
    applyingRoomSnapshot = true;
    if (state.computerCode && state.computerCode.length === SLOTS) computerCode = state.computerCode.slice();
    var guesses = (state.guesses || []).slice().sort(function(a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    myGuesses = [];
    opponentGuesses = [];
    guesses.forEach(function(g) {
      var item = {
        playerId: g.playerId || '',
        playerName: g.playerName || ((g.playerId === opts.selfId) ? opts.playerName : opts.opponentName) || '玩家',
        colors: (g.colors || []).slice(),
        hits: g.hits || 0,
        blows: g.blows || 0,
        elapsed: g.elapsed || 0,
        createdAt: g.createdAt || 0
      };
      if (item.playerId === opts.selfId) myGuesses.push(item);
      else opponentGuesses.push(item);
    });
    gameOver = !!state.gameOver;
    if (opts.mode === 'coop') {
      myTurn = !gameOver && (state.turnClientId || currentTurnClientIdFromGuesses(guesses)) === opts.selfId;
    } else if (opts.mode === 'race') {
      myTurn = !gameOver;
      var progress = state.raceProgressByPlayerId || {};
      var myProgress = progress[opts.selfId] || {};
      var opponentId = getOpponentPlayer() && getOpponentPlayer().id;
      var oppProgress = opponentId ? progress[opponentId] : null;
      if (!oppProgress) {
        Object.keys(progress).some(function(id) {
          if (id !== opts.selfId) {
            oppProgress = progress[id];
            return true;
          }
          return false;
        });
      }
      finishedAt = myProgress.finished ? (myProgress.elapsed || 0) : 0;
      opponentProgress = oppProgress || {
        attempts: opponentGuesses.length,
        elapsed: opponentGuesses.length ? opponentGuesses[opponentGuesses.length - 1].elapsed || 0 : 0,
        finished: false
      };
    }
    applyingRoomSnapshot = false;
    if (gameOver) {
      showResult(state.winnerPlayerId ? state.winnerPlayerId === opts.selfId : state.winner === 'team' || state.winner === 'me');
    } else {
      renderGameBoard();
      updateTurnIndicator();
    }
  }

  function handleCoopGuess(msg) {
    if (gameOver) return;
    if (hasGuessRecord(opponentGuesses, msg)) return;
    opponentGuesses.push({
      playerId: msg.playerId || '',
      playerName: msg.playerName || opts.opponentName || '隊友',
      colors: msg.colors,
      hits: msg.hits,
      blows: msg.blows,
      createdAt: msg.createdAt || Date.now()
    });
    renderOpponentGuesses();
    if (msg.hits === SLOTS) {
      gameOver = true;
      computerCode = msg.code || computerCode;
      saveRoomSnapshot({ gameOver: true, winner: 'team', winnerPlayerId: msg.playerId || '', turnClientId: '' });
      updateTurnIndicator();
      showResult(true);
    } else {
      myTurn = true;
      saveRoomSnapshot();
      updateTurnIndicator();
    }
  }

  function handleRaceProgress(msg) {
    opponentProgress = {
      attempts: msg.attempts || 0,
      elapsed: msg.elapsed || 0,
      finished: !!msg.finished
    };
    if (msg.guesses) {
      opponentGuesses = msg.guesses.map(function(g) {
        g.playerId = g.playerId || msg.playerId || '';
        g.playerName = g.playerName || opts.opponentName || '對方';
        return g;
      });
    }
    var raceProgress = {};
    raceProgress[opts.selfId] = {
      attempts: myGuesses.length,
      elapsed: finishedAt || elapsedMs(),
      finished: !!finishedAt
    };
    if (msg.playerId) raceProgress[msg.playerId] = opponentProgress;
    saveRoomSnapshot({ raceProgressByPlayerId: raceProgress });
    if (!gameOver) {
      renderRaceProgress();
      updateTurnIndicator();
    }
  }

  function handleRaceFinish(msg) {
    opponentProgress = {
      attempts: msg.attempts || 0,
      elapsed: msg.elapsed || 0,
      finished: true
    };
    opponentGuesses = (msg.guesses || opponentGuesses).map(function(g) {
      g.playerId = g.playerId || msg.playerId || '';
      g.playerName = g.playerName || msg.playerName || opts.opponentName || '對方';
      return g;
    });
    computerCode = msg.code || computerCode;
    var raceProgress = {};
    raceProgress[opts.selfId] = {
      attempts: myGuesses.length,
      elapsed: finishedAt || elapsedMs(),
      finished: !!finishedAt
    };
    if (msg.playerId) raceProgress[msg.playerId] = opponentProgress;
    if (!gameOver) {
      gameOver = true;
      saveRoomSnapshot({ gameOver: true, winner: 'opponent', winnerPlayerId: msg.playerId || '', raceProgressByPlayerId: raceProgress });
      updateTurnIndicator();
      showResult(false);
    } else {
      saveRoomSnapshot({ gameOver: true, winner: 'me', winnerPlayerId: opts.selfId, raceProgressByPlayerId: raceProgress });
      renderResultHistory();
      var summary = document.getElementById('gc-race-result-summary');
      if (summary) {
        summary.textContent = '你：' + myGuesses.length + ' 次 / ' + formatTime(finishedAt || elapsedMs()) + '　對方：' + opponentProgress.attempts + ' 次 / ' + formatTime(opponentProgress.elapsed);
      }
    }
  }

  function handleGameOver(msg) {
    if (gameOver) return;
    gameOver = true;
    if (msg.code) computerCode = msg.code;
    updateTurnIndicator();
    if (opts.mode === 'coop') {
      showResult(msg.winner === 'team');
    } else if (opts.mode === 'race') {
      showResult(msg.winner === 'me');
    } else {
      showResult(msg.winner === 'opponent');
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
    } else if (mode === 'race') {
      setTitle(iWin ? '🎉 你贏了！' : '⏱ 對方先完成');
    } else {
      setTitle(iWin ? '🎉 你贏了！' : '😞 你輸了...');
    }

    var oppCodeLabel = '電腦的答案';

    container.innerHTML =
      '<div class="card">' +
        '<div class="result-title ' + (iWin ? 'result-win' : 'result-lose') + '">' +
          (mode === 'coop'
            ? (iWin ? '你們贏了！用了 ' + (myGuesses.length + opponentGuesses.length) + ' 次' : '你們輸了...')
            : mode === 'race'
              ? (iWin ? '你先猜中了！' : '對方先猜中了')
              : (iWin ? '你贏了！用了 ' + myGuesses.length + ' 次' : '你輸了...')) +
        '</div>' +
        (mode === 'race' ? '<p class="race-result-summary" id="gc-race-result-summary">你：' + myGuesses.length + ' 次 / ' + formatTime(finishedAt || elapsedMs()) + '　對方：' + opponentProgress.attempts + ' 次 / ' + formatTime(opponentProgress.elapsed) + '</p>' : '') +
        '<p style="font-size:.85rem;color:var(--muted);text-align:center;margin:12px 0">' + oppCodeLabel + '</p>' +
        '<div class="reveal-row" id="gc-reveal-opp-code"></div>' +
        '<div class="result-history" id="gc-result-history"></div>' +
        (isSpectator() || isRoomMode() ? '' : '<button class="btn btn-primary" style="margin-top:16px" id="gc-btn-rematch">再來一局</button>') +
        '<button class="btn btn-secondary" id="gc-btn-back-home">返回大廳</button>' +
      '</div>';

    var rematchBtn = document.getElementById('gc-btn-rematch');
    if (rematchBtn) rematchBtn.onclick = rematch;
    document.getElementById('gc-btn-back-home').onclick = function() {
      App.GameManager.endGame();
    };

    renderCodeReveal(document.getElementById('gc-reveal-opp-code'), computerCode);
    renderResultHistory();
  }

  // ===== Rematch =====
  function rematch() {
    if (isSpectator() || isRoomMode()) return;
    if (opts.mode === 'single') {
      computerCode = generateComputerCode();
      startSingleGame();
    } else if (opts.isHost) {
      send({ type: 'rematch' });
      startMultiplayerRound(true);
    } else {
      send({ type: 'rematch' });
      showWaitingForStart();
    }
  }

  function resetRoundState() {
    myGuesses = []; opponentGuesses = [];
    gameOver = false; pendingGuess = null;
    guessSelection = [null,null,null,null]; guessActiveSlot = 0;
    finishedAt = 0;
    opponentProgress = { attempts: 0, elapsed: 0, finished: false };
    startTime = Date.now();
  }

  function showWaitingForStart() {
    container.innerHTML = '<div class="card"><div class="waiting-text"><span class="spinner"></span>等待房主開始遊戲...</div></div>';
  }

  function startMultiplayerRound(shouldSend) {
    resetRoundState();
    myTurn = isSpectator() ? false : (opts.mode === 'race' ? true : getPlayerIndex() === 0);
    if (opts.isHost && shouldSend) {
      computerCode = generateComputerCode();
      send({ type: 'round_start', code: computerCode });
    }
    showGameScreen();
    if (isRoomMode() && opts.isHost && !(opts.gameState && opts.gameState.roundId === opts.roundId)) {
      saveRoomSnapshot({ turnClientId: opts.mode === 'coop' ? currentTurnClientIdFromGuesses([]) : '' });
    }
  }

  function startSingleGame() {
    myGuesses = [];
    gameOver = false;
    pendingGuess = null;
    finishedAt = 0;
    opponentProgress = { attempts: 0, elapsed: 0, finished: false };
    startTime = Date.now();
    guessSelection = [null,null,null,null];
    guessActiveSlot = 0;
    showGameScreen();
  }

  // ===== Game Module API =====
  function init(containerEl, gameOpts) {
    container = containerEl;
    opts = gameOpts;
    resetGameState();
    var initialCode = (opts.initialState && opts.initialState.computerCode) || opts.initialCode;

    if (opts.mode === 'single') {
      computerCode = generateComputerCode();
      startSingleGame();
    } else if (opts.mode === 'coop' || opts.mode === 'race') {
      if (initialCode && initialCode.length === SLOTS) {
        computerCode = initialCode.slice();
        startMultiplayerRound(false);
        applyRoomSnapshot(opts.gameState);
      } else if (opts.isHost && !isSpectator()) {
        computerCode = generateComputerCode();
        send({ type: 'round_start', code: computerCode });
        startMultiplayerRound(false);
      } else {
        showWaitingForStart();
      }
    } else {
      showWaitingForStart();
    }
  }

  function destroy() {
    container = null;
    opts = null;
    resetGameState();
  }

  App.GameManager.register({
    id: 'guessColor',
    name: '猜顏色',
    icon: '🎨',
    description: 'Hit & Blow',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    maxPlayers: 2,
    allowSpectators: true,
    aiFill: false,
    multiplayerModes: ['coop', 'race'],
    buildRoomStart: function() {
      return { computerCode: generateComputerCode() };
    },
    init: init,
    handleMessage: handleMessage,
    destroy: destroy
  });
})();
