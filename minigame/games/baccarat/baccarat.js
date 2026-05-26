(function() {
  var SUITS = ['D','C','H','S'];
  var SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠' };
  var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  var SIDES = { player: '閒', banker: '莊', tie: '和' };
  var MIN_BET = 100;
  var MAX_BET = 500;
  var START_BALANCE = 1000;

  var container = null;
  var opts = null;
  var state = null;
  var selectedSide = 'player';
  var selectedAmount = 100;

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function makeDeck() {
    var deck = [];
    for (var pack = 0; pack < 4; pack++) {
      SUITS.forEach(function(suit) {
        RANKS.forEach(function(rank) {
          deck.push({ id: rank + suit + '-' + pack + '-' + Math.random().toString(36).slice(2, 8), rank: rank, suit: suit });
        });
      });
    }
    shuffle(deck);
    return deck;
  }

  function shuffle(deck) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
  }

  function cardPoint(card) {
    if (!card) return 0;
    if (card.rank === 'A') return 1;
    if (['10','J','Q','K'].indexOf(card.rank) >= 0) return 0;
    return Number(card.rank || 0);
  }

  function handPoint(hand) {
    return (hand || []).reduce(function(total, card) { return total + cardPoint(card); }, 0) % 10;
  }

  function makePlayers(seats) {
    return (seats && seats.length ? seats : [{ id: 'human', name: opts && opts.playerName || '你' }]).slice(0, 6).map(function(seat, index) {
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
      deck: makeDeck(),
      playerHand: [],
      bankerHand: [],
      phase: 'betting',
      status: 'playing',
      outcome: '',
      resultSaved: false,
      roundNumber: 1,
      history: [{ name: '系統', text: '百家樂開始，請下注' }],
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
    next.history = [{ name: '系統', text: '第 ' + next.roundNumber + ' 局百家樂開始' }];
    return next;
  }

  function setupGame() {
    selectedSide = 'player';
    selectedAmount = 100;
    if (opts && opts.initialState && opts.initialState.state) state = clone(opts.initialState.state);
    else state = buildInitialState();
    normalizeState();
  }

  function normalizeState() {
    if (!state) return;
    state.players = state.players || [];
    state.deck = state.deck || makeDeck();
    state.playerHand = state.playerHand || [];
    state.bankerHand = state.bankerHand || [];
    state.history = state.history || [];
    state.phase = state.phase || 'betting';
    state.status = state.status || 'playing';
    state.players.forEach(function(player) {
      player.balance = Number(player.balance == null ? START_BALANCE : player.balance);
      player.lastDelta = Number(player.lastDelta || 0);
      player.stats = player.stats || { rounds: 0, wins: 0 };
    });
  }

  function serializeState() { return { gameId: 'baccarat', mode: opts.mode || 'room', roundId: opts.roundId || '', state: clone(state) }; }
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

  function drawCard() {
    if (state.deck.length < 12) state.deck = makeDeck();
    return state.deck.pop();
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
    side = SIDES[side] ? side : 'player';
    amount = clampBet(amount, player);
    player.bet = { side: side, amount: amount };
    record(player.name, '下注 ' + SIDES[side] + ' $' + amount);
    if (allBetsReady()) dealRound();
    commit();
  }

  function dealRound() {
    state.phase = 'dealing';
    state.playerHand = [drawCard(), drawCard()];
    state.bankerHand = [drawCard(), drawCard()];
    var p = handPoint(state.playerHand);
    var b = handPoint(state.bankerHand);
    if (p < 8 && b < 8) {
      var playerThird = null;
      if (p <= 5) {
        playerThird = drawCard();
        state.playerHand.push(playerThird);
        p = handPoint(state.playerHand);
      }
      var thirdPoint = playerThird ? cardPoint(playerThird) : null;
      var bankerDraw = false;
      if (!playerThird) bankerDraw = b <= 5;
      else if (b <= 2) bankerDraw = true;
      else if (b === 3) bankerDraw = thirdPoint !== 8;
      else if (b === 4) bankerDraw = thirdPoint >= 2 && thirdPoint <= 7;
      else if (b === 5) bankerDraw = thirdPoint >= 4 && thirdPoint <= 7;
      else if (b === 6) bankerDraw = thirdPoint === 6 || thirdPoint === 7;
      if (bankerDraw) {
        state.bankerHand.push(drawCard());
        b = handPoint(state.bankerHand);
      }
    }
    settleRound();
  }

  function settleRound() {
    var p = handPoint(state.playerHand);
    var b = handPoint(state.bankerHand);
    state.outcome = p > b ? 'player' : b > p ? 'banker' : 'tie';
    state.players.forEach(function(player) {
      var delta = 0;
      if (player.bet && player.bet.amount) {
        if (state.outcome === 'tie') {
          delta = player.bet.side === 'tie' ? player.bet.amount * 8 : 0;
        } else if (player.bet.side === state.outcome) {
          delta = state.outcome === 'banker' ? Math.floor(player.bet.amount * 0.95) : player.bet.amount;
        } else {
          delta = -player.bet.amount;
        }
        player.balance += delta;
        player.lastDelta = delta;
        player.stats.rounds = Number(player.stats.rounds || 0) + 1;
        if (delta > 0) player.stats.wins = Number(player.stats.wins || 0) + 1;
      }
    });
    state.phase = 'result';
    state.status = 'settled';
    state.finishedAt = Date.now();
    record('系統', SIDES[state.outcome] + '勝：閒 ' + p + ' 點，莊 ' + b + ' 點');
    saveRoomResult();
  }

  function sendRoomAction(payload) {
    if (!isRoomMode() || !App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({ roundId: opts.roundId || '', gameId: 'baccarat', mode: opts.mode || 'room', payload: payload });
  }

  function humanBet() {
    var player = selfPlayer();
    if (!player || isSpectator() || state.phase !== 'betting' || state.status !== 'playing') return;
    var amount = clampBet(selectedAmount, player);
    if (isRoomMode() && !opts.isHost) sendRoomAction({ type: 'bc_bet', playerId: opts.selfId, side: selectedSide, amount: amount });
    else placeBet(player.id, selectedSide, amount);
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !opts.isHost || !msg) return;
    if (msg.type === 'bc_bet') placeBet(msg.playerId, msg.side, msg.amount);
  }

  function saveRoomResult() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || state.resultSaved) return;
    state.resultSaved = true;
    if (App.Signaling.appendHistory) {
      App.Signaling.appendHistory({
        status: 'completed',
        gameId: 'baccarat',
        mode: opts.mode || 'room',
        roundId: opts.roundId || '',
        summary: '百家樂完成：' + SIDES[state.outcome] + '勝',
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

  function renderCard(card) {
    if (!card) return '';
    var red = card.suit === 'D' || card.suit === 'H';
    return '<span class="bc-card' + (red ? ' red' : '') + '"><b>' + escapeHtml(card.rank) + '</b><em>' + SUIT_SYMBOLS[card.suit] + '</em></span>';
  }

  function renderPlayer(player) {
    var self = selfPlayer() && selfPlayer().id === player.id;
    return '<article class="bc-player' + (self ? ' active' : '') + '">' +
      '<strong>' + (App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(player) : '') + escapeHtml(player.name) + '</strong>' +
      '<span>$' + player.balance + (player.bet ? ' · ' + SIDES[player.bet.side] + ' $' + player.bet.amount : ' · 未下注') + '</span>' +
      '<span>' + (player.lastDelta ? (player.lastDelta > 0 ? '+' : '') + player.lastDelta : '±0') + '</span>' +
    '</article>';
  }

  function resultTitle() {
    if (!state.outcome) return '百家樂';
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
        : '<button class="bc-btn secondary" id="bc-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回</span></button>' +
          '<button class="bc-btn primary" id="bc-new"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>再來一局</span></button>';
      container.innerHTML = '<div class="bc-shell">' + App.Common.renderResultPanel({
        eyebrow: '百家樂結算',
        title: resultTitle(),
        subtitle: '閒 ' + handPoint(state.playerHand) + ' 點 · 莊 ' + handPoint(state.bankerHand) + ' 點',
        rows: ranked.map(function(row, index) {
          return { rank: '#' + (index + 1), name: row.name, person: row, primary: '$' + row.balance, secondary: (row.lastDelta > 0 ? '+' : '') + row.lastDelta };
        }),
        history: state.history.slice().reverse().map(function(row) { return { label: row.name, text: row.text }; }),
        actionsHtml: actions
      }) + '</div>';
      bindControls();
      if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('百家樂結算');
      return;
    }
    container.innerHTML =
      '<div class="bc-shell">' +
        '<div class="bc-topbar"><div class="bc-title">百家樂 · ' + (canBet ? '請下注' : '等待下注') + '</div><div class="bc-actions">' + (isRoomMode() ? '<button class="bc-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="bc-icon" onclick="App.GameManager.endGame()" aria-label="離開"><i class="fa-solid fa-xmark"></i></button></div></div>' +
        '<section class="bc-table"><div class="bc-hands"><article class="bc-zone"><h3><span>閒</span><b>' + handPoint(state.playerHand) + ' 點</b></h3><div class="bc-cards">' + state.playerHand.map(renderCard).join('') + '</div></article><article class="bc-zone"><h3><span>莊</span><b>' + handPoint(state.bankerHand) + ' 點</b></h3><div class="bc-cards">' + state.bankerHand.map(renderCard).join('') + '</div></article></div><section class="bc-players">' + state.players.map(renderPlayer).join('') + '</section></section>' +
        '<div class="bc-controls"><div class="bc-hint">' + escapeHtml(state.history[state.history.length - 1].name + '：' + state.history[state.history.length - 1].text) + '</div>' +
          ['player','banker','tie'].map(function(side) { return '<button class="bc-btn secondary" data-side="' + side + '"' + (canBet ? '' : ' disabled') + '>' + SIDES[side] + '</button>'; }).join('') +
          [100,200,500].map(function(amount) { return '<button class="bc-btn secondary" data-amount="' + amount + '"' + (canBet ? '' : ' disabled') + '>$' + amount + '</button>'; }).join('') +
          '<button class="bc-btn primary" id="bc-bet"' + (canBet ? '' : ' disabled') + '>下注 ' + SIDES[selectedSide] + ' $' + selectedAmount + '</button>' +
        '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle(canBet ? '輪到你 - 百家樂' : '百家樂');
  }

  function bindControls() {
    Array.prototype.forEach.call(container.querySelectorAll('[data-side]'), function(button) {
      button.addEventListener('click', function() { selectedSide = button.getAttribute('data-side') || 'player'; render(); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-amount]'), function(button) {
      button.addEventListener('click', function() { selectedAmount = Number(button.getAttribute('data-amount') || 100); render(); });
    });
    var bet = container.querySelector('#bc-bet');
    var back = container.querySelector('#bc-back');
    var next = container.querySelector('#bc-new');
    if (bet) bet.addEventListener('click', humanBet);
    if (back) back.addEventListener('click', function() { App.GameManager.endGame(); });
    if (next) next.addEventListener('click', startNewRound);
  }

  App.BaccaratRules = {
    cardPoint: cardPoint,
    handPoint: handPoint,
    buildInitialState: buildInitialState
  };

  App.GameManager.register({
    id: 'baccarat',
    name: '百家樂',
    icon: '百',
    description: '玩家下注，永遠對 AI 莊家',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 6,
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
