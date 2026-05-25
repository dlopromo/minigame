(function() {
  var SIZE = 4;
  var container = null;
  var opts = null;
  var state = null;
  var STORAGE_KEY = 'party-room-2048-progress-v1';

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function lcg(seed) {
    var value = Number(seed || 1) % 2147483647;
    if (value <= 0) value += 2147483646;
    return function() {
      value = value * 16807 % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  function emptyBoard() {
    var board = [];
    for (var y = 0; y < SIZE; y++) {
      var row = [];
      for (var x = 0; x < SIZE; x++) row.push(0);
      board.push(row);
    }
    return board;
  }

  function openCells(board) {
    var cells = [];
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        if (!board[y][x]) cells.push({ x: x, y: y });
      }
    }
    return cells;
  }

  function addTile(board, rng) {
    var cells = openCells(board);
    if (!cells.length) return false;
    var cell = cells[Math.floor(rng() * cells.length)];
    board[cell.y][cell.x] = rng() < 0.9 ? 2 : 4;
    return true;
  }

  function initialBoard(seed) {
    var board = emptyBoard();
    var rng = lcg(seed);
    addTile(board, rng);
    addTile(board, rng);
    return board;
  }

  function compressLine(line) {
    var values = line.filter(Boolean);
    var result = [];
    var score = 0;
    for (var i = 0; i < values.length; i++) {
      if (values[i] === values[i + 1]) {
        result.push(values[i] * 2);
        score += values[i] * 2;
        i++;
      } else {
        result.push(values[i]);
      }
    }
    while (result.length < SIZE) result.push(0);
    return { line: result, score: score };
  }

  function sameBoard(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function moveBoard(board, dir) {
    var next = emptyBoard();
    var score = 0;
    for (var i = 0; i < SIZE; i++) {
      var line = [];
      for (var j = 0; j < SIZE; j++) {
        if (dir === 'left') line.push(board[i][j]);
        if (dir === 'right') line.push(board[i][SIZE - 1 - j]);
        if (dir === 'up') line.push(board[j][i]);
        if (dir === 'down') line.push(board[SIZE - 1 - j][i]);
      }
      var packed = compressLine(line);
      score += packed.score;
      for (var k = 0; k < SIZE; k++) {
        if (dir === 'left') next[i][k] = packed.line[k];
        if (dir === 'right') next[i][SIZE - 1 - k] = packed.line[k];
        if (dir === 'up') next[k][i] = packed.line[k];
        if (dir === 'down') next[SIZE - 1 - k][i] = packed.line[k];
      }
    }
    return { board: next, score: score, moved: !sameBoard(board, next) };
  }

  function maxTile(board) {
    return Math.max.apply(null, [].concat.apply([], board));
  }

  function canMove(board) {
    if (openCells(board).length) return true;
    for (var y = 0; y < SIZE; y++) {
      for (var x = 0; x < SIZE; x++) {
        var v = board[y][x];
        if (x < SIZE - 1 && board[y][x + 1] === v) return true;
        if (y < SIZE - 1 && board[y + 1][x] === v) return true;
      }
    }
    return false;
  }

  function makePlayer(seed, seat) {
    var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
    return {
      id: seat.id || 'human',
      name: seat.name || '玩家',
      playerColor: seat.playerColor || '',
      playerIcon: seat.playerIcon || '',
      isAI: isAI,
      online: seat.online !== false,
      board: initialBoard(seed),
      score: 0,
      moves: 0,
      maxTile: 2,
      undoStack: [],
      lastMove: '',
      lastGain: 0,
      status: 'playing',
      finishedAt: 0
    };
  }

  function buildInitialState(seats, seed) {
    var baseSeed = seed || Date.now();
    var players = (seats && seats.length ? seats : [{ id: 'human', name: opts && opts.playerName || '你' }]).slice(0, 8).map(function(seat) {
      return makePlayer(baseSeed, seat);
    });
    return {
      seed: baseSeed,
      players: players,
      status: 'playing',
      winnerId: '',
      resultSaved: false,
      history: [{ name: '系統', text: '2048 Race 開始' }],
      startedAt: Date.now(),
      finishedAt: 0
    };
  }

  function setupGame() {
    if (opts && opts.initialState && opts.initialState.state) {
      state = clone(opts.initialState.state);
      normalizeState();
      return;
    }
    if (!isRoomMode()) {
      var saved = loadLocalProgress();
      if (saved) {
        state = saved;
        normalizeState();
        return;
      }
    }
    state = buildInitialState([{ id: 'human', name: opts.playerName || '你' }]);
    normalizeState();
  }

  function serializeState() {
    return { gameId: 'tile2048', roundId: opts.roundId || '', state: clone(state) };
  }

  function applyState(snapshot) {
    if (!snapshot || !snapshot.state) return;
    if (opts && opts.roundId && snapshot.roundId && snapshot.roundId !== opts.roundId) return;
    state = clone(snapshot.state);
    normalizeState();
    render();
  }

  function normalizeState() {
    if (!state) return;
    state.status = state.status || 'playing';
    state.resultSaved = !!state.resultSaved;
    state.players = state.players || [];
    state.players.forEach(function(player) {
      player.undoStack = Array.isArray(player.undoStack) ? player.undoStack : [];
      player.maxTile = player.maxTile || maxTile(player.board || emptyBoard());
      player.lastMove = player.lastMove || '';
      player.lastGain = player.lastGain || 0;
      player.status = player.status || 'playing';
    });
  }

  function publishState() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.setGameState) return;
    App.Signaling.setGameState(serializeState());
  }

  function loadLocalProgress() {
    try {
      var raw = window.localStorage && window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      if (!saved || saved.gameId !== 'tile2048' || !saved.state || saved.state.status !== 'playing') return null;
      return saved.state;
    } catch (e) {
      return null;
    }
  }

  function saveLocalProgress() {
    if (isRoomMode() || !window.localStorage || !state) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ gameId: 'tile2048', savedAt: Date.now(), state: state }));
    } catch (e) {}
  }

  function clearLocalProgress() {
    if (window.localStorage) window.localStorage.removeItem(STORAGE_KEY);
  }

  function record(name, text) {
    state.history.push({ name: name, text: text });
    if (state.history.length > 30) state.history = state.history.slice(state.history.length - 30);
    logGameChat(name, text);
  }

  function logGameChat(name, text) {
    if (!isRoomMode() || !opts.isHost || !App.Lobby || !App.Lobby.logRoomEvent) return;
    App.Lobby.logRoomEvent('game', name + '：' + text, 'game_action');
  }

  function settleIfNeeded(player) {
    if (!canMove(player.board)) {
      player.status = 'gameover';
      player.finishedAt = Date.now();
      record(player.name, '無法再移動');
    }
    if (state.players.every(function(p) { return p.status !== 'playing'; })) {
      var winner = state.players.slice().sort(function(a, b) {
        return b.maxTile - a.maxTile || b.score - a.score || a.finishedAt - b.finishedAt;
      })[0];
      state.status = 'settled';
      state.winnerId = winner ? winner.id : '';
      state.finishedAt = Date.now();
      record('系統', '全部完成，最高分者勝');
      saveRoomResult();
      if (!isRoomMode()) clearLocalProgress();
    }
  }

  function commit() {
    if (isHostAuthority()) {
      publishState();
      saveLocalProgress();
      render();
    }
  }

  function move(playerId, dir) {
    if (state.status !== 'playing') return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player || player.status !== 'playing') return;
    var result = moveBoard(player.board, dir);
    if (!result.moved) return;
    player.undoStack.push({
      board: clone(player.board),
      score: player.score,
      moves: player.moves,
      maxTile: player.maxTile
    });
    if (player.undoStack.length > 50) player.undoStack = player.undoStack.slice(player.undoStack.length - 50);
    player.board = result.board;
    player.score += result.score;
    player.moves += 1;
    player.lastMove = dir;
    player.lastGain = result.score;
    var rng = lcg((state.seed || 1) + player.moves * 7919 + player.id.length * 17 + player.score);
    addTile(player.board, rng);
    player.maxTile = maxTile(player.board);
    settleIfNeeded(player);
    commit();
  }

  function undo(playerId) {
    if (state.status !== 'playing') return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player || player.status !== 'playing' || !player.undoStack || !player.undoStack.length) return;
    var previous = player.undoStack.pop();
    player.board = previous.board;
    player.score = previous.score;
    player.moves = previous.moves;
    player.maxTile = previous.maxTile;
    player.lastMove = 'undo';
    player.lastGain = 0;
    record(player.name, 'Reverse 返回上一手');
    commit();
  }

  function selfPlayer() {
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }

  function canControlSelf() {
    var player = selfPlayer();
    return !!player && !isSpectator() && player.status === 'playing' && state.status === 'playing';
  }

  function sendRoomAction(dir) {
    if (!isRoomMode() || !App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({
      roundId: opts.roundId || '',
      gameId: 'tile2048',
      mode: opts.mode || 'room',
      payload: { type: '2048_move', playerId: opts.selfId, dir: dir }
    });
  }

  function sendUndoAction() {
    if (!isRoomMode() || !App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({
      roundId: opts.roundId || '',
      gameId: 'tile2048',
      mode: opts.mode || 'room',
      payload: { type: '2048_undo', playerId: opts.selfId }
    });
  }

  function humanMove(dir) {
    if (!canControlSelf()) return;
    if (isRoomMode() && !opts.isHost) sendRoomAction(dir);
    else move(selfPlayer().id, dir);
  }

  function humanUndo() {
    if (!canControlSelf()) return;
    if (isRoomMode() && !opts.isHost) sendUndoAction();
    else undo(selfPlayer().id);
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !opts.isHost || !msg) return;
    if (msg.type === '2048_move') move(msg.playerId, msg.dir);
    if (msg.type === '2048_undo') undo(msg.playerId);
  }

  function saveRoomResult() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling) return;
    if (state.resultSaved) return;
    state.resultSaved = true;
    if (App.Signaling.appendHistory) {
      App.Signaling.appendHistory({
        status: 'completed',
        gameId: 'tile2048',
        mode: opts.mode || 'room',
        roundId: opts.roundId || '',
        summary: '2048 Race 完成',
        results: state.players.map(function(player) {
          return { id: player.id, name: player.name, score: player.score, maxTile: player.maxTile, moves: player.moves };
        })
      });
    }
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', score: player.score, win: player.id === state.winnerId };
      }));
    }
  }

  function tileClass(value) {
    if (!value) return 'empty';
    if (value <= 2048) return 'v' + value;
    return 'v-super';
  }

  function renderTile(value) {
    return '<span class="t2048-tile ' + tileClass(value) + '" data-value="' + value + '">' + (value || '') + '</span>';
  }

  function renderBoard(player) {
    var moveClass = player.lastMove ? ' move-' + player.lastMove : '';
    var gainClass = player.lastGain ? ' has-merge' : '';
    return '<div class="t2048-board' + moveClass + gainClass + '">' + player.board.map(function(row) {
      return row.map(renderTile).join('');
    }).join('') + '</div>';
  }

  function renderPlayer(player) {
    var isSelf = selfPlayer() && selfPlayer().id === player.id;
    return '<article class="t2048-player' + (isSelf ? ' self' : '') + '">' +
      '<div class="t2048-head"><strong>' + escapeHtml(player.name) + '</strong><span>' + player.score + ' 分 · ' + player.maxTile + '</span></div>' +
      renderBoard(player) +
      '<div class="t2048-meta">' + (player.status === 'playing' ? player.moves + ' moves' + (player.lastGain ? ' · +' + player.lastGain : '') : '完成') + '</div>' +
    '</article>';
  }

  function render() {
    if (!container || !state) return;
    var player = selfPlayer();
    var canAct = canControlSelf();
    var canUndo = canAct && player && player.undoStack && player.undoStack.length;
    if (state.status === 'settled') {
      var ranked = state.players.slice().sort(function(a, b) {
        return b.maxTile - a.maxTile || b.score - a.score || a.moves - b.moves;
      });
      var actions = '<button class="t2048-btn ghost" id="t2048-back">返回</button>' +
        (!isRoomMode() ? '<button class="t2048-btn ghost" id="t2048-new">New</button>' : '');
      container.innerHTML = '<div class="t2048-shell">' + App.Common.renderResultPanel({
        eyebrow: '2048 Race 結算',
        title: winnerText(),
        subtitle: '最高 tile、分數、步數共同排序',
        rows: ranked.map(function(item, index) {
          return {
            rank: '#' + (index + 1),
            name: item.name,
            person: item,
            primary: item.score + ' 分',
            secondary: '最高 ' + item.maxTile + ' · ' + item.moves + ' moves'
          };
        }),
        history: state.history.slice().reverse().map(function(row) {
          return { label: row.name, text: row.text };
        }),
        actionsHtml: actions
      }) + '</div>';
      bindControls();
      if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('2048 Race 結算');
      return;
    }
    container.innerHTML =
      '<div class="t2048-shell">' +
        '<div class="t2048-topbar"><div class="t2048-title' + (canAct ? ' my-turn' : '') + '">' + (state.status === 'settled' ? '2048 Race 結算' : canAct ? '你的 2048 Race' : '2048 Race 觀戰') + '</div>' +
        '<div class="t2048-actions">' + (isRoomMode() ? '<button class="t2048-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="t2048-icon" onclick="App.GameManager.endGame()" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></div>' +
        '<section class="t2048-grid">' + state.players.map(renderPlayer).join('') + '</section>' +
        '<div class="t2048-controls">' +
          '<div class="t2048-hint">' + escapeHtml(state.status === 'settled' ? winnerText() : player ? player.score + ' 分 · 最高 ' + player.maxTile : '觀戰中') + '</div>' +
          ['up','left','down','right'].map(function(dir) {
            var label = { up: '↑', left: '←', down: '↓', right: '→' }[dir];
            return '<button class="t2048-btn" data-dir="' + dir + '"' + (canAct ? '' : ' disabled') + '>' + label + '</button>';
          }).join('') +
          '<button class="t2048-btn secondary" id="t2048-undo"' + (canUndo ? '' : ' disabled') + '>↶</button>' +
          (!isRoomMode() ? '<button class="t2048-btn ghost" id="t2048-new">New</button>' : '') +
        '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle(canAct ? '輪到你 - 2048' : '2048 Race');
  }

  function winnerText() {
    var winner = state.players.filter(function(player) { return player.id === state.winnerId; })[0];
    return winner ? winner.name + ' 勝出 · ' + winner.score + ' 分' : '已完成';
  }

  function bindControls() {
    var touchStart = null;
    Array.prototype.forEach.call(container.querySelectorAll('[data-dir]'), function(button) {
      button.addEventListener('click', function() { humanMove(button.getAttribute('data-dir')); });
    });
    var undoBtn = container.querySelector('#t2048-undo');
    var newBtn = container.querySelector('#t2048-new');
    var backBtn = container.querySelector('#t2048-back');
    if (undoBtn) undoBtn.addEventListener('click', humanUndo);
    if (backBtn) backBtn.addEventListener('click', function() { App.GameManager.endGame(); });
    if (newBtn) newBtn.addEventListener('click', function() {
      clearLocalProgress();
      state = buildInitialState([{ id: 'human', name: opts.playerName || '你' }]);
      normalizeState();
      commit();
    });
    container.onkeydown = function(e) {
      var map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
      if (map[e.key]) {
        e.preventDefault();
        humanMove(map[e.key]);
      }
    };
    Array.prototype.forEach.call(container.querySelectorAll('.t2048-board'), function(board) {
      board.addEventListener('touchstart', function(e) {
        if (!e.touches || !e.touches[0]) return;
        touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }, { passive: true });
      board.addEventListener('touchmove', function(e) {
        if (touchStart) e.preventDefault();
      }, { passive: false });
      board.addEventListener('touchend', function(e) {
        if (!touchStart || !e.changedTouches || !e.changedTouches[0]) return;
        var dx = e.changedTouches[0].clientX - touchStart.x;
        var dy = e.changedTouches[0].clientY - touchStart.y;
        touchStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
        humanMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
      }, { passive: true });
    });
    container.tabIndex = 0;
    container.focus();
  }

  App.Tile2048Rules = {
    initialBoard: initialBoard,
    moveBoard: moveBoard,
    handValue: maxTile,
    canMove: canMove,
    buildInitialState: buildInitialState
  };

  App.GameManager.register({
    id: 'tile2048',
    name: '2048 Race',
    icon: '2048',
    description: '同局種子競速，鬥高分與最高 tile',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 8,
    allowSpectators: true,
    aiFill: false,
    multiplayerModes: ['room'],
    buildRoomStart: function(roomOpts) {
      return { state: buildInitialState(roomOpts.players || [], Date.now()) };
    },
    init: function(gameContainer, gameOpts) {
      container = gameContainer;
      opts = gameOpts || {};
      setupGame();
      render();
      if (isRoomMode() && opts.isHost && !(opts.gameState && opts.gameState.roundId === opts.roundId)) publishState();
      if (opts.gameState) applyState(opts.gameState);
    },
    handleMessage: function(msg) {
      if (!msg) return;
      if (msg.type === 'room_update') {
        opts.players = msg.players || opts.players;
        opts.spectators = msg.spectators || opts.spectators;
        opts.role = msg.role || opts.role;
        opts.isHost = !!msg.isHost;
        applyState(msg.gameState);
        return;
      }
      handleRoomAction(msg);
    },
    destroy: function() {
      container = null;
      opts = null;
      state = null;
    }
  });
})();
