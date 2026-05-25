(function() {
  var COLORS = ['red','blue','green','yellow'];
  var COLOR_NAMES = { red: '紅', blue: '藍', green: '綠', yellow: '黃', wild: '萬用' };
  var ACTION_NAMES = { skip: '停', reverse: '轉', draw2: '+2', wild: '轉色', wild4: '+4' };
  var container = null;
  var opts = null;
  var state = null;
  var aiTimer = null;
  var suggestedCardId = '';
  var selectedWildColor = 'red';

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clearTimer(timer) { if (timer) clearTimeout(timer); return null; }

  function makeDeck() {
    var deck = [];
    COLORS.forEach(function(color) {
      deck.push(card(color, 'num', 0));
      for (var n = 1; n <= 9; n++) {
        deck.push(card(color, 'num', n));
        deck.push(card(color, 'num', n));
      }
      ['skip','reverse','draw2'].forEach(function(type) {
        deck.push(card(color, type, type));
        deck.push(card(color, type, type));
      });
    });
    for (var i = 0; i < 4; i++) {
      deck.push(card('wild', 'wild', 'wild'));
      deck.push(card('wild', 'wild4', 'wild4'));
    }
    shuffle(deck);
    return deck;
  }

  function card(color, type, value) {
    return { id: color + '-' + type + '-' + value + '-' + Math.random().toString(36).slice(2, 8), color: color, type: type, value: value };
  }

  function shuffle(deck) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
  }

  function normalizeTop(card) {
    return card ? { color: card.chosenColor || card.color, type: card.type, value: card.value } : null;
  }

  function canPlay(card, top, activeColor) {
    if (!card) return false;
    if (card.color === 'wild') return true;
    if (!top) return true;
    return card.color === activeColor || card.type === top.type || card.value === top.value;
  }

  function nextIndex(from, steps) {
    var index = from;
    var count = steps || 1;
    while (count-- > 0) {
      index = (index + state.direction + state.players.length) % state.players.length;
    }
    return index;
  }

  function drawCard() {
    if (!state.drawPile.length) {
      var top = state.discard.pop();
      state.drawPile = state.discard;
      state.discard = [top];
      shuffle(state.drawPile);
    }
    return state.drawPile.pop();
  }

  function chooseColor(hand) {
    var counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    (hand || []).forEach(function(card) { if (counts[card.color] !== undefined) counts[card.color]++; });
    return COLORS.slice().sort(function(a, b) { return counts[b] - counts[a]; })[0] || 'red';
  }

  function makePlayers(seats) {
    return (seats && seats.length ? seats : [
      { id: 'human', name: opts && opts.playerName || '你' },
      { id: 'ai-1', name: 'AI 1', isAI: true },
      { id: 'ai-2', name: 'AI 2', isAI: true },
      { id: 'ai-3', name: 'AI 3', isAI: true }
    ]).slice(0, 6).map(function(seat, index) {
      var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
      return { id: seat.id || (isAI ? 'ai-' + index : 'human'), name: seat.name || (isAI ? 'AI ' + index : '玩家'), playerColor: seat.playerColor || '', playerIcon: seat.playerIcon || '', isAI: isAI, ai: isAI, hand: [], online: seat.online !== false };
    });
  }

  function buildInitialState(seats) {
    var players = makePlayers(seats);
    var deck = makeDeck();
    players.forEach(function(player) {
      for (var i = 0; i < 7; i++) player.hand.push(deck.pop());
    });
    var first = deck.pop();
    while (first.color === 'wild') {
      deck.unshift(first);
      first = deck.pop();
    }
    return {
      players: players,
      drawPile: deck,
      discard: [first],
      activeColor: first.color,
      currentIndex: 0,
      direction: 1,
      status: 'playing',
      winnerId: '',
      resultSaved: false,
      history: [{ name: '系統', text: '轉色牌開始' }],
      startedAt: Date.now(),
      finishedAt: 0
    };
  }

  function setupGame() {
    suggestedCardId = '';
    selectedWildColor = 'red';
    if (opts && opts.initialState && opts.initialState.state) state = clone(opts.initialState.state);
    else state = buildInitialState();
  }

  function restartSingle() {
    if (isRoomMode()) return false;
    suggestedCardId = '';
    selectedWildColor = 'red';
    state = buildInitialState();
    render();
    scheduleAI();
    return true;
  }

  function serializeState() {
    return { gameId: 'colorShift', roundId: opts.roundId || '', state: clone(state) };
  }

  function applyState(snapshot) {
    if (!snapshot || !snapshot.state) return;
    if (opts && opts.roundId && snapshot.roundId && snapshot.roundId !== opts.roundId) return;
    state = clone(snapshot.state);
    suggestedCardId = '';
    render();
  }

  function publishState() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.setGameState) return;
    App.Signaling.setGameState(serializeState());
  }

  function record(name, text) {
    state.history.push({ name: name, text: text });
    if (state.history.length > 30) state.history = state.history.slice(state.history.length - 30);
  }

  function activePlayer() { return state.players[state.currentIndex]; }
  function topCard() { return state.discard[state.discard.length - 1]; }

  function syncPlayerPresence(roomPlayers) {
    if (!isRoomMode() || !roomPlayers || !roomPlayers.length || !state || !state.players) return;
    var byId = {};
    roomPlayers.forEach(function(person) { byId[person.id] = person; });
    var changed = false;
    state.players.forEach(function(player) {
      var remote = byId[player.id];
      var nativeAI = /^ai-/.test(player.id || '');
      if (!remote || nativeAI) return;
      var shouldAI = remote.online === false;
      if (!!player.ai !== shouldAI) {
        player.ai = shouldAI;
        player.isAI = shouldAI;
        changed = true;
        record('系統', player.name + (shouldAI ? ' 斷線，AI 接管' : ' 已重連，恢復真人操作'));
        App.Common.showToast(player.name + (shouldAI ? ' 斷線，AI 接管中' : ' 已重連'), shouldAI ? '' : 'success');
      }
      player.online = remote.online !== false;
      player.name = remote.name || player.name;
      player.playerColor = remote.playerColor || player.playerColor || '';
      player.playerIcon = remote.playerIcon || player.playerIcon || '';
    });
    if (changed) {
      if (opts.isHost) publishState();
      render();
      scheduleAI();
    }
  }

  function advance(extra) {
    state.currentIndex = nextIndex(state.currentIndex, extra || 1);
  }

  function applyAction(card, player, chosenColor) {
    var skip = 1;
    if (card.color === 'wild') {
      card.chosenColor = COLORS.indexOf(chosenColor) !== -1 ? chosenColor : chooseColor(player.hand);
      state.activeColor = card.chosenColor;
    } else {
      state.activeColor = card.color;
    }
    if (card.type === 'reverse') {
      state.direction *= -1;
      if (state.players.length === 2) skip = 2;
    }
    if (card.type === 'skip') skip = 2;
    if (card.type === 'draw2' || card.type === 'wild4') {
      var target = state.players[nextIndex(state.currentIndex, 1)];
      var count = card.type === 'draw2' ? 2 : 4;
      for (var i = 0; i < count; i++) target.hand.push(drawCard());
      record(target.name, '抽 ' + count + ' 張');
      skip = 2;
    }
    return skip;
  }

  function playCard(playerId, cardId, chosenColor) {
    if (state.status !== 'playing') return;
    var player = activePlayer();
    if (!player || player.id !== playerId) return;
    var index = player.hand.findIndex(function(card) { return card.id === cardId; });
    if (index < 0) return;
    var card = player.hand[index];
    var top = normalizeTop(topCard());
    if (!canPlay(card, top, state.activeColor)) return;
    suggestedCardId = '';
    selectedWildColor = 'red';
    player.hand.splice(index, 1);
    var skip = applyAction(card, player, chosenColor);
    state.discard.push(card);
    record(player.name, '出了 ' + labelCard(card));
    if (!player.hand.length) {
      state.status = 'settled';
      state.winnerId = player.id;
      state.finishedAt = Date.now();
      record(player.name, '勝出');
      saveRoomResult();
    } else {
      advance(skip);
    }
    commit();
  }

  function draw(playerId) {
    if (state.status !== 'playing') return;
    var player = activePlayer();
    if (!player || player.id !== playerId) return;
    player.hand.push(drawCard());
    suggestedCardId = '';
    record(player.name, '抽 1 張');
    advance(1);
    commit();
  }

  function commit() {
    if (isHostAuthority()) {
      publishState();
      render();
      scheduleAI();
    }
  }

  function selfPlayer() {
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }

  function canControl() {
    var player = selfPlayer();
    return !!player && !isSpectator() && state.status === 'playing' && activePlayer() && activePlayer().id === player.id && !player.ai;
  }

  function sendRoomAction(payload) {
    if (!isRoomMode() || !App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({
      roundId: opts.roundId || '',
      gameId: 'colorShift',
      mode: opts.mode || 'room',
      payload: payload
    });
  }

  function humanPlay(cardId) {
    var player = selfPlayer();
    if (!player || !canControl()) return;
    var card = player.hand.filter(function(item) { return item.id === cardId; })[0];
    var chosenColor = card && card.color === 'wild' ? selectedWildColor : '';
    if (card && card.color === 'wild' && COLORS.indexOf(chosenColor) === -1) {
      App.Common.showToast('請先選擇轉色顏色', 'error');
      return;
    }
    if (isRoomMode() && !opts.isHost) sendRoomAction({ type: 'cs_play', playerId: opts.selfId, cardId: cardId, chosenColor: chosenColor });
    else playCard(player.id, cardId, chosenColor);
  }

  function selectCard(cardId) {
    var player = selfPlayer();
    if (!player || !canControl()) return false;
    var card = player.hand.filter(function(item) { return item.id === cardId; })[0];
    if (!card || !canPlay(card, normalizeTop(topCard()), state.activeColor)) {
      suggestedCardId = '';
      render();
      if (App.Common && App.Common.showToast) App.Common.showToast('這張牌暫時不能出', 'error');
      return false;
    }
    suggestedCardId = suggestedCardId === cardId ? '' : cardId;
    if (suggestedCardId && card.color === 'wild' && COLORS.indexOf(selectedWildColor) === -1) selectedWildColor = chooseColor(player.hand);
    render();
    return true;
  }

  function humanDraw() {
    var player = selfPlayer();
    if (!player || !canControl()) return;
    if (isRoomMode() && !opts.isHost) sendRoomAction({ type: 'cs_draw', playerId: opts.selfId });
    else draw(player.id);
  }

  function scoreCandidate(card, hand) {
    var score = 0;
    if (!card) return score;
    if (hand && hand.length === 1) score += 1000;
    if (card.type === 'wild4') score += 45;
    else if (card.type === 'draw2') score += 38;
    else if (card.type === 'skip') score += 30;
    else if (card.type === 'reverse') score += 22;
    else if (card.type === 'wild') score += 18;
    else score += Number(card.value || 0);
    return score;
  }

  function suggestedCard(player) {
    if (!player) return null;
    var top = normalizeTop(topCard());
    return player.hand.filter(function(card) {
      return canPlay(card, top, state.activeColor);
    }).sort(function(a, b) {
      return scoreCandidate(b, player.hand) - scoreCandidate(a, player.hand);
    })[0] || null;
  }

  function suggestPlay() {
    var player = selfPlayer();
    if (!canControl() || !player) return false;
    var card = suggestedCard(player);
    if (!card) {
      suggestedCardId = '';
      render();
      if (App.Common && App.Common.showToast) App.Common.showToast('沒有可出的牌，建議抽牌', 'error');
      return false;
    }
    suggestedCardId = card.id;
    if (card.color === 'wild') selectedWildColor = chooseColor(player.hand);
    render();
    if (App.Common && App.Common.showToast) App.Common.showToast('已選出建議牌', 'success');
    return true;
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !opts.isHost || !msg) return;
    if (msg.type === 'cs_play') playCard(msg.playerId, msg.cardId, msg.chosenColor);
    if (msg.type === 'cs_draw') draw(msg.playerId);
  }

  function scheduleAI() {
    aiTimer = clearTimer(aiTimer);
    if (!isHostAuthority() || !state || state.status !== 'playing') return;
    var player = activePlayer();
    if (!player || !player.ai) return;
    aiTimer = setTimeout(function() {
      aiTimer = null;
      var card = suggestedCard(player);
      if (card) playCard(player.id, card.id, card.color === 'wild' ? chooseColor(player.hand) : '');
      else draw(player.id);
    }, 720);
  }

  function saveRoomResult() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling) return;
    if (state.resultSaved) return;
    state.resultSaved = true;
    if (App.Signaling.appendHistory) {
      App.Signaling.appendHistory({
        status: 'completed',
        gameId: 'colorShift',
        mode: opts.mode || 'room',
        roundId: opts.roundId || '',
        summary: '轉色牌完成',
        winnerId: state.winnerId
      });
    }
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', score: player.id === state.winnerId ? 10 : -player.hand.length, win: player.id === state.winnerId };
      }));
    }
  }

  function labelCard(card) {
    if (!card) return '';
    return card.color === 'wild' ? ACTION_NAMES[card.type] : COLOR_NAMES[card.color] + (card.type === 'num' ? card.value : ACTION_NAMES[card.type]);
  }

  function actionIcon(card) {
    if (!card || card.type === 'num') return '';
    if (card.type === 'skip') return '<i class="fa-solid fa-ban" aria-hidden="true"></i>';
    if (card.type === 'reverse') return '<i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>';
    if (card.type === 'draw2') return '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>2</span>';
    if (card.type === 'wild4') return '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>4</span>';
    if (card.type === 'wild') return '<i class="fa-solid fa-palette" aria-hidden="true"></i>';
    return '';
  }

  function renderCard(card, playable) {
    var suggested = suggestedCardId && suggestedCardId === card.id ? ' suggested' : '';
    var center = card.type === 'num' ? escapeHtml(card.value) : actionIcon(card);
    return '<button class="cs-card ' + card.color + (playable ? ' playable' : '') + suggested + '" data-card-id="' + card.id + '" aria-label="' + escapeHtml(labelCard(card)) + '">' +
      '<b>' + escapeHtml(card.color === 'wild' ? 'W' : COLOR_NAMES[card.color]) + '</b><span>' + center + '</span>' +
    '</button>';
  }

  function renderOpponent(player) {
    var active = activePlayer() && activePlayer().id === player.id;
    return '<article class="cs-seat' + (active ? ' active' : '') + '">' +
      '<strong>' + escapeHtml(player.name) + '</strong><span>' + player.hand.length + ' 張' + (player.ai ? ' · AI' : '') + '</span>' +
      '<div class="cs-backs">' + Array(Math.min(12, player.hand.length)).fill('<i></i>').join('') + '</div></article>';
  }

  function render() {
    if (!container || !state) return;
    var self = selfPlayer();
    var canAct = canControl();
    var top = normalizeTop(topCard());
    var opponents = state.players.filter(function(player) { return !self || player.id !== self.id; });
    var selectedSuggested = self && suggestedCardId && self.hand.some(function(card) { return card.id === suggestedCardId; });
    var selectedCard = self && suggestedCardId ? self.hand.filter(function(card) { return card.id === suggestedCardId; })[0] : null;
    var colorPicker = canAct && selectedCard && selectedCard.color === 'wild'
      ? '<div class="cs-color-picker" aria-label="選擇轉色顏色">' + COLORS.map(function(color) {
          return '<button type="button" class="cs-color-dot ' + color + (selectedWildColor === color ? ' active' : '') + '" data-wild-color="' + color + '" aria-label="' + COLOR_NAMES[color] + '"></button>';
        }).join('') + '</div>'
      : '';
    var settled = state.status === 'settled';
    if (settled) {
      var ranked = state.players.slice().sort(function(a, b) {
        if (a.id === state.winnerId) return -1;
        if (b.id === state.winnerId) return 1;
        return a.hand.length - b.hand.length;
      });
      var actions = '<button class="cs-btn secondary" id="cs-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回</span></button>' +
        (isRoomMode() ? '' : '<button class="cs-btn" id="cs-new"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>再來一局</span></button>');
      container.innerHTML = '<div class="cs-shell">' + App.Common.renderResultPanel({
        eyebrow: '轉色牌結算',
        title: winnerText(),
        subtitle: '剩牌越少排名越前',
        rows: ranked.map(function(player, index) {
          return {
            rank: '#' + (index + 1),
            name: player.name,
            person: player,
            primary: player.id === state.winnerId ? '勝出' : '剩 ' + player.hand.length + ' 張',
            secondary: player.ai ? 'AI' : '玩家'
          };
        }),
        history: state.history.slice().reverse().map(function(row) {
          return { label: row.name, text: row.text };
        }),
        actionsHtml: actions
      }) + '</div>';
      bindControls();
      if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('轉色牌結算');
      return;
    }
    container.innerHTML =
      '<div class="cs-shell">' +
        '<div class="cs-topbar"><div class="cs-title' + (canAct ? ' my-turn' : '') + '">' + (state.status === 'settled' ? winnerText() : canAct ? '輪到你出牌' : activePlayer().name + ' 出牌中') + '</div>' +
        '<div class="cs-actions">' + (isRoomMode() ? '<button class="cs-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="cs-icon" onclick="App.GameManager.endGame()" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></div>' +
        '<section class="cs-opponents">' + opponents.map(renderOpponent).join('') + '</section>' +
        '<section class="cs-table"><div class="cs-pile">' + renderCard(topCard(), false) + '</div><div class="cs-color ' + state.activeColor + '">' + COLOR_NAMES[state.activeColor] + '</div></section>' +
        '<section class="cs-hand">' + (self ? self.hand.map(function(card) { return renderCard(card, canAct && canPlay(card, top, state.activeColor)); }).join('') : '<p>觀戰中</p>') + '</section>' +
        '<div class="cs-controls"><div class="cs-hint">' + escapeHtml(state.history[state.history.length - 1].name + '：' + state.history[state.history.length - 1].text) + '</div>' + colorPicker +
          '<button class="cs-btn secondary" id="cs-suggest"' + (canAct ? '' : ' disabled') + '><i class="fa-regular fa-lightbulb" aria-hidden="true"></i><span>推薦</span></button>' +
          '<button class="cs-btn secondary" id="cs-draw"' + (canAct ? '' : ' disabled') + '><i class="fa-solid fa-hand" aria-hidden="true"></i><span>抽牌</span></button>' +
          '<button class="cs-btn" id="cs-play"' + (canAct && selectedSuggested ? '' : ' disabled') + '><i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>出牌</span></button>' + '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle(canAct ? '輪到你 - 轉色牌' : '轉色牌');
  }

  function winnerText() {
    var winner = state.players.filter(function(player) { return player.id === state.winnerId; })[0];
    return winner ? winner.name + ' 勝出' : '轉色牌結算';
  }

  function bindControls() {
    Array.prototype.forEach.call(container.querySelectorAll('[data-card-id]'), function(button) {
      button.addEventListener('click', function() {
        if (!button.closest('.cs-hand')) return;
        selectCard(button.getAttribute('data-card-id'));
      });
    });
    var drawBtn = container.querySelector('#cs-draw');
    var suggestBtn = container.querySelector('#cs-suggest');
    var playBtn = container.querySelector('#cs-play');
    var backBtn = container.querySelector('#cs-back');
    var newBtn = container.querySelector('#cs-new');
    if (drawBtn) drawBtn.addEventListener('click', humanDraw);
    if (suggestBtn) suggestBtn.addEventListener('click', suggestPlay);
    if (playBtn) playBtn.addEventListener('click', function() { if (suggestedCardId) humanPlay(suggestedCardId); });
    Array.prototype.forEach.call(container.querySelectorAll('[data-wild-color]'), function(button) {
      button.addEventListener('click', function() {
        selectedWildColor = button.getAttribute('data-wild-color') || 'red';
        render();
      });
    });
    if (backBtn) backBtn.addEventListener('click', function() { App.GameManager.endGame(); });
    if (newBtn) newBtn.addEventListener('click', restartSingle);
  }

  App.ColorShiftRules = {
    canPlay: canPlay,
    buildInitialState: buildInitialState,
    normalizeTop: normalizeTop
  };

  App.GameManager.register({
    id: 'colorShift',
    name: '轉色牌',
    icon: '色',
    description: 'UNO-like 顏色數字派對牌',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 2,
    maxPlayers: 6,
    allowSpectators: true,
    aiFill: true,
    multiplayerModes: ['room'],
    buildRoomStart: function(roomOpts) {
      return { state: buildInitialState(roomOpts.players || []) };
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
        opts.players = msg.players || opts.players;
        opts.spectators = msg.spectators || opts.spectators;
        opts.role = msg.role || opts.role;
        opts.isHost = !!msg.isHost;
        applyState(msg.gameState);
        syncPlayerPresence(opts.players);
        scheduleAI();
        return;
      }
      handleRoomAction(msg);
    },
    handleShortcut: function(action) {
      if (action === 'suggest') return suggestPlay();
      if (action === 'primary' && suggestedCardId && canControl()) {
        humanPlay(suggestedCardId);
        return true;
      }
      if (action === 'pass' && canControl()) {
        humanDraw();
        return true;
      }
      if (action === 'cancel' && suggestedCardId) {
        suggestedCardId = '';
        render();
        return true;
      }
      if (action === 'primary' && state && state.status === 'settled' && !isRoomMode()) return restartSingle();
      return false;
    },
    destroy: function() {
      aiTimer = clearTimer(aiTimer);
      container = null;
      opts = null;
      state = null;
      suggestedCardId = '';
    }
  });
})();
