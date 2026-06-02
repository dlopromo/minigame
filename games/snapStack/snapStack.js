(function() {
  var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  var SUITS = ['D','C','H','S'];
  var SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠' };
  var container = null;
  var opts = null;
  var state = null;
  var aiTimer = null;

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clearTimer(timer) { if (timer) clearTimeout(timer); return null; }

  function makeDeck() {
    var deck = [];
    SUITS.forEach(function(suit) {
      RANKS.forEach(function(rank) {
        deck.push({ id: rank + suit + '-' + Math.random().toString(36).slice(2, 8), rank: rank, suit: suit });
      });
    });
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    return deck;
  }

  function makePlayers(seats) {
    return (seats && seats.length ? seats : [
      { id: 'human', name: opts && opts.playerName || '你' },
      { id: 'ai-1', name: 'AI 1', isAI: true },
      { id: 'ai-2', name: 'AI 2', isAI: true },
      { id: 'ai-3', name: 'AI 3', isAI: true }
    ]).slice(0, 8).map(function(seat, index) {
      var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
      return { id: seat.id || (isAI ? 'ai-' + index : 'human'), name: seat.name || (isAI ? 'AI ' + index : '玩家'), playerColor: seat.playerColor || '', playerIcon: seat.playerIcon || '', isAI: isAI, ai: isAI, score: 0, online: seat.online !== false };
    });
  }

  function isSnap(pile) {
    if (!pile || pile.length < 2) return false;
    return pile[pile.length - 1].rank === pile[pile.length - 2].rank;
  }

  function buildInitialState(seats) {
    return {
      players: makePlayers(seats),
      deck: makeDeck(),
      pile: [],
      currentIndex: 0,
      snapOpen: false,
      status: 'playing',
      winnerId: '',
      resultSaved: false,
      history: [{ name: '系統', text: '冚棉胎開始' }],
      startedAt: Date.now(),
      finishedAt: 0
    };
  }

  function setupGame() {
    if (opts && opts.initialState && opts.initialState.state) state = clone(opts.initialState.state);
    else state = buildInitialState();
    normalizeState();
  }

  function restartSingle() {
    if (isRoomMode()) return false;
    state = buildInitialState();
    render();
    scheduleAI();
    return true;
  }

  function serializeState() { return { gameId: 'snapStack', roundId: opts.roundId || '', state: clone(state) }; }
  function applyState(snapshot) {
    if (!snapshot || !snapshot.state) return;
    var expectedRoundId = (opts && opts.roundId) || (opts && opts.gameState && opts.gameState.roundId) || '';
    if (expectedRoundId && snapshot.roundId && snapshot.roundId !== expectedRoundId) return;
    state = clone(snapshot.state);
    normalizeState();
    render();
  }
  function normalizeState() {
    if (!state) state = buildInitialState();
    state.players = state.players || [];
    state.deck = Array.isArray(state.deck) ? state.deck : [];
    state.pile = Array.isArray(state.pile) ? state.pile : [];
    state.currentIndex = Number(state.currentIndex || 0);
    state.snapOpen = !!state.snapOpen;
    state.status = state.status || 'playing';
    state.winnerId = state.winnerId || '';
    state.history = Array.isArray(state.history) ? state.history : [];
    state.startedAt = state.startedAt || Date.now();
    state.finishedAt = Number(state.finishedAt || 0);
    state.resultSaved = !!state.resultSaved;
  }
  function publishState() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.setGameState) return;
    App.Signaling.setGameState(serializeState());
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
  function activePlayer() { return state.players[state.currentIndex]; }
  function nextTurn() { state.currentIndex = (state.currentIndex + 1) % state.players.length; }
  function commit() {
    if (isHostAuthority() || (opts && opts.localEcho)) {
      publishState();
      render();
      scheduleAI();
    }
  }

  function flip(playerId) {
    if (state.status !== 'playing') return;
    var player = activePlayer();
    if (!player || player.id !== playerId || state.snapOpen) return;
    if (!state.deck.length) return settle();
    var card = state.deck.pop();
    state.pile.push(card);
    state.snapOpen = isSnap(state.pile);
    record(player.name, '翻出 ' + card.rank + SUIT_SYMBOLS[card.suit]);
    nextTurn();
    if (!state.deck.length && !state.snapOpen) settle();
    commit();
  }

  function slap(playerId) {
    if (state.status !== 'playing') return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player) return;
    if (state.snapOpen && isSnap(state.pile)) {
      player.score += state.pile.length;
      record(player.name, '冚中 +' + state.pile.length);
      state.pile = [];
      state.snapOpen = false;
    } else {
      player.score -= 1;
      record(player.name, '冚錯 -1');
    }
    if (!state.deck.length && !state.pile.length) settle();
    commit();
  }

  function settle() {
    var winner = state.players.slice().sort(function(a, b) { return b.score - a.score; })[0];
    state.status = 'settled';
    state.winnerId = winner ? winner.id : '';
    state.finishedAt = Date.now();
    record('系統', (winner ? winner.name : '玩家') + ' 勝出');
    saveRoomResult();
    commit();
  }

  function selfPlayer() {
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }

  function canFlip() {
    var self = selfPlayer();
    return !!self && !isSpectator() && state.status === 'playing' && activePlayer() && activePlayer().id === self.id && !state.snapOpen && !self.ai;
  }
  function canSlap() {
    var self = selfPlayer();
    return !!self && !isSpectator() && state.status === 'playing' && !self.ai;
  }

  function sendRoomAction(payload) {
    if (!isRoomMode()) return;
    if (App.Lobby && typeof App.Lobby.sendRoomGameAction === 'function') {
      App.Lobby.sendRoomGameAction(payload);
      return;
    }
    if (!App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({ roundId: opts.roundId || '', gameId: 'snapStack', mode: opts.mode || 'room', payload: payload });
  }
  function humanFlip() {
    var self = selfPlayer();
    if (!self || !canFlip()) return;
    if (isRoomMode() && !opts.isHost) sendRoomAction({ type: 'ss_flip', playerId: opts.selfId });
    else flip(self.id);
  }
  function humanSlap() {
    var self = selfPlayer();
    if (!self || !canSlap()) return;
    if (isRoomMode() && !opts.isHost) sendRoomAction({ type: 'ss_slap', playerId: opts.selfId });
    else slap(self.id);
  }
  function handleRoomAction(msg) {
    if (!isRoomMode() || !msg || (!opts.isHost && !msg.localEcho) || (opts.isHost && msg.localEcho)) return;
    if (msg.type === 'ss_flip') flip(msg.playerId);
    if (msg.type === 'ss_slap') slap(msg.playerId);
  }

  function scheduleAI() {
    aiTimer = clearTimer(aiTimer);
    if (!isHostAuthority() || !state || state.status !== 'playing') return;
    if (state.snapOpen) {
      var ai = state.players.filter(function(player) { return player.ai; })[0];
      if (ai) aiTimer = setTimeout(function() { aiTimer = null; slap(ai.id); }, 520);
      return;
    }
    var player = activePlayer();
    if (player && player.ai) aiTimer = setTimeout(function() { aiTimer = null; flip(player.id); }, 720);
  }

  function saveRoomResult() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling) return;
    if (state.resultSaved) return;
    state.resultSaved = true;
    if (App.Signaling.appendHistory) App.Signaling.appendHistory({ status: 'completed', gameId: 'snapStack', mode: opts.mode || 'room', roundId: opts.roundId || '', summary: '冚棉胎完成', winnerId: state.winnerId });
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', score: player.score, win: player.id === state.winnerId };
      }));
    }
  }

  function renderCard(card, index, total) {
    if (!card) return '<div class="ss-empty">等待翻牌</div>';
    var red = card.suit === 'D' || card.suit === 'H';
    var latest = index === total - 1;
    return '<span class="ss-card' + (red ? ' red' : '') + (latest ? ' latest' : '') + '" style="--i:' + index + '"><b>' + escapeHtml(card.rank) + '</b><em>' + SUIT_SYMBOLS[card.suit] + '</em></span>';
  }
  function renderPlayer(player) {
    var active = activePlayer() && activePlayer().id === player.id;
    var self = selfPlayer() && selfPlayer().id === player.id;
    return '<article class="ss-player' + (active ? ' active' : '') + (self ? ' self' : '') + '"><strong>' + escapeHtml(player.name) + '</strong><span>' + player.score + ' 分' + (player.ai ? ' · AI' : '') + '</span></article>';
  }
  function render() {
    if (!container || !state) return;
    if (state.status === 'settled') {
      var ranked = state.players.slice().sort(function(a, b) { return b.score - a.score || String(a.name).localeCompare(String(b.name)); });
      var actions = '<button class="ss-btn secondary" id="ss-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回</span></button>' +
        (isRoomMode() ? '' : '<button class="ss-btn" id="ss-new"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>再來一局</span></button>');
      container.innerHTML = '<div class="ss-shell">' + App.Common.renderResultDialog({
        eyebrow: '冚棉胎結算',
        title: titleText(),
        subtitle: '得分最高者勝出',
        rows: ranked.map(function(player, index) {
          return {
            rank: '#' + (index + 1),
            name: player.name,
            person: player,
            primary: player.score + ' 分',
            secondary: player.ai ? 'AI' : '玩家'
          };
        }),
        history: state.history.slice().reverse().map(function(row) {
          return { label: row.name, text: row.text };
        }),
        actionsHtml: actions
      }) + '</div>';
      bindControls();
      if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('冚棉胎結算');
      return;
    }
    var recent = state.pile.slice(-8);
    container.innerHTML =
      '<div class="ss-shell">' +
        '<div class="ss-topbar"><div class="ss-title' + (canFlip() || (state.snapOpen && canSlap()) ? ' my-turn' : '') + '">' + titleText() + '</div><div class="ss-actions">' + (isRoomMode() ? '<button class="ss-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="ss-icon" onclick="(App.Lobby && App.Lobby.handleGameCloseAction ? App.Lobby.handleGameCloseAction() : App.GameManager.endGame())" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></div>' +
        '<section class="ss-scoreboard">' + state.players.map(renderPlayer).join('') + '</section>' +
        '<section class="ss-table' + (state.snapOpen ? ' snap-open' : '') + '"><div class="ss-pile">' + (recent.length ? recent.map(function(card, index) { return renderCard(card, index, recent.length); }).join('') : renderCard(null, 0, 0)) + '</div><div class="ss-deck">' + state.deck.length + ' 張</div></section>' +
        '<div class="ss-controls"><div class="ss-hint">' + escapeHtml(state.history[state.history.length - 1].name + '：' + state.history[state.history.length - 1].text) + '</div>' +
          '<button class="ss-btn secondary" id="ss-flip"' + (canFlip() ? '' : ' disabled') + '><i class="fa-solid fa-clone" aria-hidden="true"></i><span>翻牌</span></button><button class="ss-btn" id="ss-slap"' + (canSlap() ? '' : ' disabled') + '><i class="fa-solid fa-hand" aria-hidden="true"></i><span>冚</span></button>' +
        '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle((canFlip() || (state.snapOpen && canSlap())) ? '輪到你 - 冚棉胎' : '冚棉胎');
  }
  function titleText() {
    if (state.status === 'settled') {
      var winner = state.players.filter(function(player) { return player.id === state.winnerId; })[0];
      return (winner ? winner.name : '玩家') + ' 勝出';
    }
    if (state.snapOpen) return '可以冚！';
    return activePlayer().name + ' 翻牌';
  }
  function bindControls() {
    var flipBtn = container.querySelector('#ss-flip');
    var slapBtn = container.querySelector('#ss-slap');
    var backBtn = container.querySelector('#ss-back');
    var newBtn = container.querySelector('#ss-new');
    if (flipBtn) flipBtn.addEventListener('click', humanFlip);
    if (slapBtn) slapBtn.addEventListener('click', humanSlap);
    if (backBtn) backBtn.addEventListener('click', function() { if (App.Lobby && App.Lobby.handleGameCloseAction) App.Lobby.handleGameCloseAction(); else App.GameManager.endGame(); });
    if (newBtn) newBtn.addEventListener('click', restartSingle);
  }

  App.SnapStackRules = { isSnap: isSnap, buildInitialState: buildInitialState };

  App.GameManager.register({
    id: 'snapStack',
    name: '冚棉胎',
    icon: '啪',
    description: '翻牌同點即搶冚，casual 派對反應遊戲',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 8,
    allowSpectators: true,
    aiFill: true,
    multiplayerModes: ['room'],
    buildRoomStart: function(roomOpts) { return { state: buildInitialState(roomOpts.players || []) }; },
    getStateSnapshot: function() {
      return serializeState();
    },
    init: function(gameContainer, gameOpts) {
      container = gameContainer;
      opts = gameOpts || {};
      setupGame();
      render();
      if (isRoomMode() && opts.isHost && !(opts.gameState && opts.gameState.roundId === opts.roundId)) publishState();
      if (opts.gameState) applyState(opts.gameState);
      scheduleAI();
    },
    handleMessage: function(msg) {
      if (!msg) return;
      if (msg.type === 'room_update') {
      if (msg.gameState && opts.ignoreNextRoomSnapshot && (!opts.ignoreNextRoomSnapshotRoundId || msg.gameState.roundId === opts.ignoreNextRoomSnapshotRoundId)) {
        opts.ignoreNextRoomSnapshot = false;
        return;
      }
        opts.players = msg.players || opts.players;
        opts.spectators = msg.spectators || opts.spectators;
        opts.role = msg.role || opts.role;
        opts.selfId = msg.selfId || opts.selfId;
        opts.isHost = !!msg.isHost;
        applyState(msg.gameState);
        scheduleAI();
        return;
      }
      if (msg.localEcho) {
        if (msg.stateSnapshot) {
          opts.ignoreNextRoomSnapshot = true;
          opts.ignoreNextRoomSnapshotRoundId = (msg.roundId || (opts && opts.roundId) || (opts && opts.gameState && opts.gameState.roundId) || '');
        }
        opts.localEcho = true;
        handleRoomAction(msg);
        opts.localEcho = false;
        return;
      }
      handleRoomAction(msg);
    },
    destroy: function() {
      aiTimer = clearTimer(aiTimer);
      container = null;
      opts = null;
      state = null;
    },
    handleShortcut: function(action) {
      if (action === 'primary' && state && state.status === 'settled' && !isRoomMode()) return restartSingle();
      if (action === 'primary' && canFlip()) {
        humanFlip();
        return true;
      }
      if (action === 'pass' && canSlap()) {
        humanSlap();
        return true;
      }
      return false;
    }
  });
})();
