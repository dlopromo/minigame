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
    if (!cells.length) return null;
    var cell = cells[Math.floor(rng() * cells.length)];
    var value = rng() < 0.9 ? 2 : 4;
    board[cell.y][cell.x] = value;
    return { x: cell.x, y: cell.y, value: value };
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
    var merges = [];
    for (var i = 0; i < values.length; i++) {
      if (values[i] === values[i + 1]) {
        merges.push(result.length);
        result.push(values[i] * 2);
        score += values[i] * 2;
        i++;
      } else {
        result.push(values[i]);
      }
    }
    while (result.length < SIZE) result.push(0);
    return { line: result, score: score, merges: merges };
  }

  function sameBoard(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function moveBoard(board, dir) {
    var next = emptyBoard();
    var score = 0;
    var merges = [];
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
      packed.merges.forEach(function(mergeIndex) {
        if (dir === 'left') merges.push({ x: mergeIndex, y: i });
        if (dir === 'right') merges.push({ x: SIZE - 1 - mergeIndex, y: i });
        if (dir === 'up') merges.push({ x: i, y: mergeIndex });
        if (dir === 'down') merges.push({ x: i, y: SIZE - 1 - mergeIndex });
      });
      for (var k = 0; k < SIZE; k++) {
        if (dir === 'left') next[i][k] = packed.line[k];
        if (dir === 'right') next[i][SIZE - 1 - k] = packed.line[k];
        if (dir === 'up') next[k][i] = packed.line[k];
        if (dir === 'down') next[SIZE - 1 - k][i] = packed.line[k];
      }
    }
    return { board: next, score: score, merges: merges, moved: !sameBoard(board, next) };
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
      lastSpawn: null,
      lastMerged: [],
      status: 'playing',
      finishedAt: 0
    };
  }

  function makeBoardState(seed) {
    return {
      board: initialBoard(seed),
      score: 0,
      moves: 0,
      maxTile: 2,
      undoStack: [],
      lastMove: '',
      lastGain: 0,
      lastSpawn: null,
      lastMerged: [],
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
      currentIndex: 0,
      shared: makeBoardState(baseSeed),
      status: 'playing',
      winnerId: '',
      resultSaved: false,
      history: [{ name: '系統', text: '2048 開始' }],
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
      player.lastSpawn = player.lastSpawn || null;
      player.lastMerged = Array.isArray(player.lastMerged) ? player.lastMerged : [];
      player.status = player.status || 'playing';
    });
    state.currentIndex = Number(state.currentIndex || 0);
    if (!state.shared) state.shared = makeBoardState(state.seed || Date.now());
    state.shared.undoStack = Array.isArray(state.shared.undoStack) ? state.shared.undoStack : [];
    state.shared.maxTile = state.shared.maxTile || maxTile(state.shared.board || emptyBoard());
    state.shared.lastMove = state.shared.lastMove || '';
    state.shared.lastGain = state.shared.lastGain || 0;
    state.shared.lastSpawn = state.shared.lastSpawn || null;
    state.shared.lastMerged = Array.isArray(state.shared.lastMerged) ? state.shared.lastMerged : [];
    state.shared.status = state.shared.status || 'playing';
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

  function activeRoomPlayer() {
    if (!state || !state.players || !state.players.length) return null;
    return state.players[state.currentIndex % state.players.length] || null;
  }

  function nextRoomTurn() {
    if (!state || !state.players || !state.players.length) return;
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
  }

  function settleIfNeeded(player, boardState) {
    var target = boardState || player;
    if (!canMove(target.board)) {
      target.status = 'gameover';
      target.finishedAt = Date.now();
      record(player && player.name ? player.name : '系統', '無法再移動');
    }
    var allDone = isRoomMode() ? state.shared.status !== 'playing' : state.players.every(function(p) { return p.status !== 'playing'; });
    if (allDone) {
      var winner = isRoomMode() ? activeRoomPlayer() : state.players.slice().sort(function(a, b) {
        return b.maxTile - a.maxTile || b.score - a.score || a.finishedAt - b.finishedAt;
      })[0];
      state.status = 'settled';
      state.winnerId = winner ? winner.id : '';
      state.finishedAt = Date.now();
      record('系統', isRoomMode() ? '合作盤完成' : '全部完成，最高分者勝');
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
    if (isRoomMode() && (!activeRoomPlayer() || activeRoomPlayer().id !== player.id)) return;
    var boardState = isRoomMode() ? state.shared : player;
    var result = moveBoard(boardState.board, dir);
    if (!result.moved) return;
    boardState.undoStack.push({
      board: clone(boardState.board),
      score: boardState.score,
      moves: boardState.moves,
      maxTile: boardState.maxTile,
      lastSpawn: boardState.lastSpawn,
      lastMerged: boardState.lastMerged,
      currentIndex: state.currentIndex
    });
    if (boardState.undoStack.length > 50) boardState.undoStack = boardState.undoStack.slice(boardState.undoStack.length - 50);
    boardState.board = result.board;
    boardState.score += result.score;
    boardState.moves += 1;
    boardState.lastMove = dir;
    boardState.lastGain = result.score;
    boardState.lastMerged = result.merges || [];
    var rng = lcg((state.seed || 1) + boardState.moves * 7919 + player.id.length * 17 + boardState.score);
    boardState.lastSpawn = addTile(boardState.board, rng);
    boardState.maxTile = maxTile(boardState.board);
    if (!isRoomMode()) {
      player.board = boardState.board;
      player.score = boardState.score;
      player.moves = boardState.moves;
      player.lastMove = boardState.lastMove;
      player.lastGain = boardState.lastGain;
      player.lastSpawn = boardState.lastSpawn;
      player.lastMerged = boardState.lastMerged;
      player.maxTile = boardState.maxTile;
    } else {
      record(player.name, '移動 ' + ({ up: '上', down: '下', left: '左', right: '右' }[dir] || dir) + (result.score ? ' +' + result.score : ''));
      nextRoomTurn();
    }
    settleIfNeeded(player, boardState);
    commit();
  }

  function undo(playerId) {
    if (state.status !== 'playing') return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    var boardState = isRoomMode() ? state.shared : player;
    if (!player || player.status !== 'playing' || !boardState.undoStack || !boardState.undoStack.length) return;
    if (isRoomMode() && (!activeRoomPlayer() || activeRoomPlayer().id !== player.id)) return;
    var previous = boardState.undoStack.pop();
    boardState.board = previous.board;
    boardState.score = previous.score;
    boardState.moves = previous.moves;
    boardState.maxTile = previous.maxTile;
    boardState.lastSpawn = previous.lastSpawn || null;
    boardState.lastMerged = previous.lastMerged || [];
    boardState.lastMove = 'undo';
    boardState.lastGain = 0;
    if (isRoomMode()) state.currentIndex = Number(previous.currentIndex || state.currentIndex || 0);
    else {
      player.board = boardState.board;
      player.score = boardState.score;
      player.moves = boardState.moves;
      player.maxTile = boardState.maxTile;
      player.lastSpawn = boardState.lastSpawn;
      player.lastMerged = boardState.lastMerged;
      player.lastMove = boardState.lastMove;
      player.lastGain = boardState.lastGain;
    }
    record(player.name, 'Reverse 返回上一手');
    commit();
  }

  function selfPlayer() {
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }

  function canControlSelf() {
    var player = selfPlayer();
    if (!player || isSpectator() || player.status !== 'playing' || state.status !== 'playing') return false;
    return !isRoomMode() || (activeRoomPlayer() && activeRoomPlayer().id === player.id);
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
        summary: isRoomMode() ? '2048 合作完成' : '2048 完成',
        results: state.players.map(function(player) {
          return { id: player.id, name: player.name, score: isRoomMode() ? state.shared.score : player.score, maxTile: isRoomMode() ? state.shared.maxTile : player.maxTile, moves: isRoomMode() ? state.shared.moves : player.moves };
        })
      });
    }
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', score: isRoomMode() ? state.shared.score : player.score, win: isRoomMode() ? true : player.id === state.winnerId };
      }));
    }
  }

  function tileClass(value) {
    if (!value) return 'empty';
    if (value <= 2048) return 'v' + value;
    return 'v-super';
  }

  function isCoordMatch(coord, x, y) {
    return !!coord && coord.x === x && coord.y === y;
  }

  function hasCoord(list, x, y) {
    return (list || []).some(function(coord) { return isCoordMatch(coord, x, y); });
  }

  function renderTile(value, x, y, player) {
    var classes = ['t2048-tile', tileClass(value)];
    if (value && isCoordMatch(player.lastSpawn, x, y)) classes.push('is-new');
    if (value && hasCoord(player.lastMerged, x, y)) classes.push('is-merged');
    return '<span class="' + classes.join(' ') + '" data-value="' + value + '">' + (value || '') + '</span>';
  }

  function renderBoard(player) {
    var moveClass = player.lastMove ? ' move-' + player.lastMove : '';
    var gainClass = player.lastGain ? ' has-merge' : '';
    return '<div class="t2048-board' + moveClass + gainClass + '">' + player.board.map(function(row, y) {
      return row.map(function(value, x) {
        return renderTile(value, x, y, player);
      }).join('');
    }).join('') + '</div>';
  }

  function renderPlayer(player) {
    var isSelf = selfPlayer() && selfPlayer().id === player.id;
    var active = isRoomMode() && activeRoomPlayer() && activeRoomPlayer().id === player.id;
    return '<article class="t2048-player' + (isSelf ? ' self' : '') + (active ? ' active' : '') + '">' +
      '<div class="t2048-head"><strong>' + escapeHtml(player.name) + '</strong><span>' + player.score + ' 分 · ' + player.maxTile + '</span></div>' +
      (isRoomMode() ? '<div class="t2048-meta">' + (active ? '輪到此玩家' : '等待') + '</div>' : renderBoard(player)) +
      '<div class="t2048-meta">' + (isRoomMode() ? (player.ai ? 'AI' : '玩家') : player.status === 'playing' ? player.moves + ' moves' + (player.lastGain ? ' · +' + player.lastGain : '') : '完成') + '</div>' +
    '</article>';
  }

  function render() {
    if (!container || !state) return;
    var player = selfPlayer();
    var canAct = canControlSelf();
    var boardState = isRoomMode() ? state.shared : player;
    var canUndo = canAct && boardState && boardState.undoStack && boardState.undoStack.length;
    if (state.status === 'settled') {
      var ranked = state.players.slice().sort(function(a, b) {
        return b.maxTile - a.maxTile || b.score - a.score || a.moves - b.moves;
      });
      var actions = '<button class="t2048-btn ghost" id="t2048-back">返回</button>' +
        (!isRoomMode() ? '<button class="t2048-btn ghost" id="t2048-new">New</button>' : '');
      container.innerHTML = '<div class="t2048-shell">' + App.Common.renderResultPanel({
        eyebrow: isRoomMode() ? '2048 合作結算' : '2048 結算',
        title: winnerText(),
        subtitle: isRoomMode() ? '合作盤分數、最高 tile 與步數' : '最高 tile、分數、步數共同排序',
        rows: ranked.map(function(item, index) {
          return {
            rank: '#' + (index + 1),
            name: item.name,
            person: item,
            primary: isRoomMode() ? state.shared.score + ' 分' : item.score + ' 分',
            secondary: isRoomMode() ? '合作最高 ' + state.shared.maxTile + ' · ' + state.shared.moves + ' moves' : '最高 ' + item.maxTile + ' · ' + item.moves + ' moves'
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
        '<div class="t2048-topbar"><div class="t2048-title' + (canAct ? ' my-turn' : '') + '">' + (state.status === 'settled' ? '2048 結算' : canAct ? (isRoomMode() ? '輪到你移動合作盤' : '你的 2048') : (isRoomMode() ? '2048 合作觀戰' : '2048')) + '</div>' +
        '<div class="t2048-actions">' + (isRoomMode() ? '<button class="t2048-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="t2048-icon" onclick="App.GameManager.endGame()" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></div>' +
        '<section class="t2048-grid">' + (isRoomMode()
          ? '<article class="t2048-player t2048-shared-board"><div class="t2048-head"><strong>合作盤</strong><span>' + state.shared.score + ' 分 · ' + state.shared.maxTile + '</span></div>' + renderBoard(state.shared) + '<div class="t2048-meta">' + state.shared.moves + ' moves' + (state.shared.lastGain ? ' · +' + state.shared.lastGain : '') + '</div></article><div class="t2048-roster">' + state.players.map(renderPlayer).join('') + '</div>'
          : state.players.map(renderPlayer).join('')) + '</section>' +
        '<div class="t2048-controls">' +
          '<div class="t2048-hint">' + escapeHtml(state.status === 'settled' ? winnerText() : isRoomMode() ? '合作盤 ' + state.shared.score + ' 分 · 最高 ' + state.shared.maxTile + ' · ' + (activeRoomPlayer() ? activeRoomPlayer().name + ' 行動' : '') : player ? player.score + ' 分 · 最高 ' + player.maxTile : '觀戰中') + '</div>' +
          ['up','left','down','right'].map(function(dir) {
            var label = { up: '↑', left: '←', down: '↓', right: '→' }[dir];
            return '<button class="t2048-btn" data-dir="' + dir + '"' + (canAct ? '' : ' disabled') + '>' + label + '</button>';
          }).join('') +
          '<button class="t2048-btn secondary" id="t2048-undo"' + (canUndo ? '' : ' disabled') + '>↶</button>' +
          (!isRoomMode() ? '<button class="t2048-btn ghost" id="t2048-new">New</button>' : '') +
        '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle(canAct ? '輪到你 - 2048' : (isRoomMode() ? '2048 合作' : '2048'));
  }

  function winnerText() {
    var winner = state.players.filter(function(player) { return player.id === state.winnerId; })[0];
    return isRoomMode() ? '合作完成 · ' + state.shared.score + ' 分' : winner ? winner.name + ' 勝出 · ' + winner.score + ' 分' : '已完成';
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
    name: '2048',
    icon: '2048',
    description: '單人無上限；房間模式合作輪流一步',
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
