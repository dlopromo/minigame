(function() {
  var COLORS = ['red','blue','yellow','green','orange','pink'];
  var SLOTS = 4;
  var MAX_ROWS = 12;

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

  // ===== Setup Screen =====
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
      '<button class="btn-leave" id="gc-btn-show-answer" style="color:#c0392b">看答案</button>' +
      '<button class="btn-leave" id="gc-btn-leave-game">離開遊戲</button>';

    document.getElementById('gc-btn-submit').onclick = submitGuess;
    document.getElementById('gc-btn-show-answer').onclick = showAnswer;
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

  function showAnswer() {
    if (gameOver) return;
    gameOver = true;
    if (opts.mode !== 'single') {
      send({ type: 'game_over', winner: opts.mode === 'coop' ? 'none' : 'opponent' });
      send({ type: 'reveal', code: myCode });
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
            ? (iWin ? '你們贏了！用了 ' + (myGuesses.length + opponentGuesses.length) + ' 次' : '你們輸了...')
            : (iWin ? '你贏了！用了 ' + myGuesses.length + ' 次' : '你輸了...')) +
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
      if (opts.isHost) {
        computerCode = generateComputerCode();
        send({ type: 'coop_start', code: computerCode });
        startCoopGameBoard();
      } else {
        container.innerHTML = '<div class="card"><div class="waiting-text"><span class="spinner"></span>等待遊戲開始...</div></div>';
      }
    } else {
      showSetupScreen();
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
    init: init,
    handleMessage: handleMessage,
    destroy: destroy
  });
})();
