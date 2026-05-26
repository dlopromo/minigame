(function() {
  var MIN_BET = 50;
  var MAX_BET = 500;
  var START_BALANCE = 1000;
  var SIDES = { small: '小', big: '大' };
  var container = null;
  var opts = null;
  var state = null;
  var selectedSide = 'big';
  var selectedAmount = 100;

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function rollDice() {
    return [
      1 + Math.floor(Math.random() * 6),
      1 + Math.floor(Math.random() * 6),
      1 + Math.floor(Math.random() * 6)
    ];
  }

  function diceTotal(dice) {
    return (dice || []).reduce(function(total, value) { return total + Number(value || 0); }, 0);
  }

  function isTriple(dice) {
    return dice && dice.length === 3 && dice[0] === dice[1] && dice[1] === dice[2];
  }

  function outcomeForDice(dice) {
    if (!dice || dice.length !== 3) return '';
    if (isTriple(dice)) return 'triple';
    var total = diceTotal(dice);
    if (total >= 4 && total <= 10) return 'small';
    if (total >= 11 && total <= 17) return 'big';
    return '';
  }

  function makePlayers(seats) {
    return (seats && seats.length ? seats : [{ id: 'human', name: opts && opts.playerName || '你' }]).slice(0, 8).map(function(seat, index) {
      var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
      return {
        id: seat.id || (isAI ? 'ai-' + index : 'human'),
        name: seat.name || (isAI ? 'AI ' + index : '玩家'),
        playerColor: seat.playerColor || '',
        playerIcon: seat.playerIcon || '',
        isAI: isAI,
        ai: isAI,
        online: seat.online !== false,
        balance: Number(seat.balance || START_BALANCE),
        bet: null,
        lastDelta: 0,
        stats: seat.stats || { rounds: 0, wins: 0 }
      };
    });
  }

  function buildInitialState(seats) {
    return {
      players: makePlayers(seats),
      dice: [],
      phase: 'betting',
      status: 'playing',
      outcome: '',
      resultSaved: false,
      roundNumber: 1,
      history: [{ name: '系統', text: '大小開始，請下注' }],
      startedAt: Date.now(),
      finishedAt: 0
    };
  }

  function buildNextRoundState() {
    var players = (state.players || []).map(function(player) {
      return {
        id: player.id,
        name: player.name,
        playerColor: player.playerColor || '',
        playerIcon: player.playerIcon || '',
        isAI: player.isAI || player.ai,
        online: player.online !== false,
        balance: Math.max(0, Number(player.balance || 0)),
        stats: player.stats || { rounds: 0, wins: 0 }
      };
    });
    var next = buildInitialState(players);
    next.roundNumber = Number(state.roundNumber || 1) + 1;
    next.history = [{ name: '系統', text: '第 ' + next.roundNumber + ' 局大小開始' }];
    return next;
  }

  function setupGame() {
    selectedSide = 'big';
    selectedAmount = 100;
    if (opts && opts.initialState && opts.initialState.state) state = clone(opts.initialState.state);
    else state = buildInitialState();
    normalizeState();
  }

  function normalizeState() {
    if (!state) return;
    state.players = state.players || [];
    state.dice = state.dice || [];
    state.history = state.history || [];
    state.phase = state.phase || 'betting';
    state.status = state.status || 'playing';
    state.players.forEach(function(player) {
      player.balance = Number(player.balance == null ? START_BALANCE : player.balance);
      player.lastDelta = Number(player.lastDelta || 0);
      player.stats = player.stats || { rounds: 0, wins: 0 };
    });
  }

  function serializeState() { return { gameId: 'sicBo', mode: opts.mode || 'room', roundId: opts.roundId || '', state: clone(state) }; }
  function publishState() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.setGameState) return;
    App.Signaling.setGameState(serializeState());
  }
  function applyState(snapshot) {
    if (!snapshot || !snapshot.state) return;
    if (opts && opts.roundId && snapshot.roundId && snapshot.roundId !== opts.roundId) return;
    state = clone(snapshot.state);
    normalizeState();
    render();
  }
  function commit() {
    if (!isHostAuthority()) return;
    publishState();
    render();
  }

  function record(name, text) {
    state.history.push({ name: name, text: text });
    if (state.history.length > 30) state.history = state.history.slice(state.history.length - 30);
    if (isRoomMode() && opts.isHost && App.Lobby && App.Lobby.logRoomEvent) {
      App.Lobby.logRoomEvent('game', name + '：' + text, 'game_action');
    }
  }

  function selfPlayer() {
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }

  function activeBetters() {
    return state.players.filter(function(player) { return !player.ai && player.balance >= MIN_BET; });
  }

  function allBetsReady() {
    var players = activeBetters();
    return players.length > 0 && players.every(function(player) { return player.bet && player.bet.amount; });
  }

  function clampBet(amount, player) {
    var max = Math.min(MAX_BET, Number(player && player.balance || START_BALANCE));
    return Math.max(MIN_BET, Math.min(max, Number(amount || MIN_BET)));
  }

  function placeBet(playerId, side, amount) {
    if (!state || state.status !== 'playing' || state.phase !== 'betting') return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player || player.ai || player.balance < MIN_BET) return;
    side = SIDES[side] ? side : 'big';
    amount = clampBet(amount, player);
    player.bet = { side: side, amount: amount };
    record(player.name, '下注 ' + SIDES[side] + ' $' + amount);
    if (allBetsReady()) rollRound();
    commit();
  }

  function rollRound() {
    state.phase = 'rolling';
    state.dice = rollDice();
    state.outcome = outcomeForDice(state.dice);
    settleRound();
  }

  function settleRound() {
    var total = diceTotal(state.dice);
    state.players.forEach(function(player) {
      var delta = 0;
      if (player.bet && player.bet.amount) {
        delta = player.bet.side === state.outcome ? player.bet.amount : -player.bet.amount;
        player.balance += delta;
        player.lastDelta = delta;
        player.stats.rounds = Number(player.stats.rounds || 0) + 1;
        if (delta > 0) player.stats.wins = Number(player.stats.wins || 0) + 1;
      }
    });
    state.phase = 'result';
    state.status = 'settled';
    state.finishedAt = Date.now();
    record('系統', '開出 ' + state.dice.join('-') + '，合計 ' + total + '，' + (state.outcome === 'triple' ? '圍骰通殺' : SIDES[state.outcome] + '勝'));
    saveRoomResult();
  }

  function sendRoomAction(payload) {
    if (!isRoomMode() || !App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({ roundId: opts.roundId || '', gameId: 'sicBo', mode: opts.mode || 'room', payload: payload });
  }

  function humanBet() {
    var player = selfPlayer();
    if (!player || isSpectator() || state.phase !== 'betting' || state.status !== 'playing') return;
    var amount = clampBet(selectedAmount, player);
    if (isRoomMode() && !opts.isHost) sendRoomAction({ type: 'sb_bet', playerId: opts.selfId, side: selectedSide, amount: amount });
    else placeBet(player.id, selectedSide, amount);
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !opts.isHost || !msg) return;
    if (msg.type === 'sb_bet') placeBet(msg.playerId, msg.side, msg.amount);
  }

  function saveRoomResult() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || state.resultSaved) return;
    state.resultSaved = true;
    if (App.Signaling.appendHistory) {
      App.Signaling.appendHistory({
        status: 'completed',
        gameId: 'sicBo',
        mode: opts.mode || 'room',
        roundId: opts.roundId || '',
        summary: '大小完成：' + (state.outcome === 'triple' ? '圍骰' : SIDES[state.outcome]),
        results: state.players.map(function(player) { return { id: player.id, name: player.name, balance: player.balance, delta: player.lastDelta }; })
      });
    }
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', score: player.lastDelta, win: player.lastDelta > 0 };
      }));
    }
  }

  function startNewRound() {
    if (isRoomMode() && !opts.isHost) return false;
    state = buildNextRoundState();
    normalizeState();
    commit();
    return true;
  }

  function renderPlayer(player) {
    var self = selfPlayer() && selfPlayer().id === player.id;
    return '<article class="sb-player' + (self ? ' active' : '') + '">' +
      '<strong>' + (App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(player) : '') + escapeHtml(player.name) + '</strong>' +
      '<span>$' + player.balance + (player.bet ? ' · ' + SIDES[player.bet.side] + ' $' + player.bet.amount : ' · 未下注') + '</span>' +
      '<span>' + (player.lastDelta ? (player.lastDelta > 0 ? '+' : '') + player.lastDelta : '±0') + '</span>' +
    '</article>';
  }

  function resultLabel() {
    if (!state.outcome) return '等待開骰';
    if (state.outcome === 'triple') return '圍骰';
    return SIDES[state.outcome] + '勝';
  }

  function render() {
    if (!container || !state) return;
    var player = selfPlayer();
    var canBet = !!player && !isSpectator() && state.status === 'playing' && state.phase === 'betting' && player.balance >= MIN_BET && !player.bet;
    if (state.status === 'settled') {
      var ranked = state.players.slice().sort(function(a, b) { return b.balance - a.balance || b.lastDelta - a.lastDelta; });
      var actions = isRoomMode()
        ? ''
        : '<button class="sb-btn secondary" id="sb-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回</span></button>' +
          '<button class="sb-btn primary" id="sb-new"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>再來一局</span></button>';
      container.innerHTML = '<div class="sb-shell">' + App.Common.renderResultPanel({
        eyebrow: '大小結算',
        title: resultLabel(),
        subtitle: '骰子 ' + state.dice.join('-') + ' · 合計 ' + diceTotal(state.dice),
        rows: ranked.map(function(row, index) {
          return { rank: '#' + (index + 1), name: row.name, person: row, primary: '$' + row.balance, secondary: (row.lastDelta > 0 ? '+' : '') + row.lastDelta };
        }),
        history: state.history.slice().reverse().map(function(row) { return { label: row.name, text: row.text }; }),
        actionsHtml: actions
      }) + '</div>';
      bindControls();
      if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('大小結算');
      return;
    }
    container.innerHTML =
      '<div class="sb-shell">' +
        '<div class="sb-topbar"><div class="sb-title">大小 · ' + (canBet ? '請下注' : '等待下注') + '</div><div class="sb-actions">' + (isRoomMode() ? '<button class="sb-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="sb-icon" onclick="App.GameManager.endGame()" aria-label="離開"><i class="fa-solid fa-xmark"></i></button></div></div>' +
        '<section class="sb-table"><div class="sb-dice-zone"><div class="sb-dice">' + (state.dice.length ? state.dice.map(function(value) { return '<span class="sb-die">' + value + '</span>'; }).join('') : '<span class="sb-die">?</span><span class="sb-die">?</span><span class="sb-die">?</span>') + '</div><div class="sb-result">結果：<strong>' + resultLabel() + '</strong></div></div><section class="sb-players">' + state.players.map(renderPlayer).join('') + '</section></section>' +
        '<div class="sb-controls"><div class="sb-hint">' + escapeHtml(state.history[state.history.length - 1].name + '：' + state.history[state.history.length - 1].text) + '</div>' +
          ['small','big'].map(function(side) { return '<button class="sb-btn secondary" data-side="' + side + '"' + (canBet ? '' : ' disabled') + '>' + SIDES[side] + '</button>'; }).join('') +
          [50,100,500].map(function(amount) { return '<button class="sb-btn secondary" data-amount="' + amount + '"' + (canBet ? '' : ' disabled') + '>$' + amount + '</button>'; }).join('') +
          '<button class="sb-btn primary" id="sb-bet"' + (canBet ? '' : ' disabled') + '>下注 ' + SIDES[selectedSide] + ' $' + selectedAmount + '</button>' +
        '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle(canBet ? '輪到你 - 大小' : '大小');
  }

  function bindControls() {
    Array.prototype.forEach.call(container.querySelectorAll('[data-side]'), function(button) {
      button.addEventListener('click', function() { selectedSide = button.getAttribute('data-side') || 'big'; render(); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-amount]'), function(button) {
      button.addEventListener('click', function() { selectedAmount = Number(button.getAttribute('data-amount') || 100); render(); });
    });
    var bet = container.querySelector('#sb-bet');
    var back = container.querySelector('#sb-back');
    var next = container.querySelector('#sb-new');
    if (bet) bet.addEventListener('click', humanBet);
    if (back) back.addEventListener('click', function() { App.GameManager.endGame(); });
    if (next) next.addEventListener('click', startNewRound);
  }

  App.SicBoRules = {
    outcomeForDice: outcomeForDice,
    diceTotal: diceTotal,
    isTriple: isTriple,
    buildInitialState: buildInitialState
  };

  App.GameManager.register({
    id: 'sicBo',
    name: '大小',
    icon: '骰',
    description: '玩家下注大小，AI 莊家開骰',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 8,
    allowSpectators: true,
    aiFill: false,
    multiplayerModes: ['room'],
    buildRoomStart: function(roomOpts) { return { state: buildInitialState(roomOpts.players || []) }; },
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
        opts.role = msg.role || opts.role;
        opts.isHost = !!msg.isHost;
        applyState(msg.gameState);
        return;
      }
      handleRoomAction(msg);
    },
    handleShortcut: function(action) {
      if (action === 'primary') {
        if (state && state.status === 'settled') return startNewRound();
        humanBet();
        return true;
      }
      return false;
    },
    destroy: function() {
      container = null;
      opts = null;
      state = null;
    }
  });
})();
