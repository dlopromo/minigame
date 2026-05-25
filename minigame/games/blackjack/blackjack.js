(function() {
  var SUITS = ['D','C','H','S'];
  var SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠' };
  var RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  var container = null;
  var opts = null;
  var state = null;
  var aiTimer = null;
  var suggestedAction = '';
  var PHASES = {
    DEALING: 'DEALING',
    PLAYER_TURN: 'PLAYER_TURN',
    PLAYER_BUST: 'PLAYER_BUST',
    DEALER_TURN: 'DEALER_TURN',
    RESULT: 'RESULT'
  };

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function clearTimer(timer) { if (timer) clearTimeout(timer); return null; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  function makeDeck() {
    var deck = [];
    SUITS.forEach(function(suit) {
      RANKS.forEach(function(rank) {
        deck.push({ id: rank + suit, rank: rank, suit: suit });
      });
    });
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    return deck;
  }

  function handValue(hand) {
    var total = 0;
    var aces = 0;
    (hand || []).forEach(function(card) {
      if (card.rank === 'A') {
        aces++;
        total += 11;
      } else if (['J','Q','K'].indexOf(card.rank) >= 0) {
        total += 10;
      } else {
        total += Number(card.rank);
      }
    });
    while (total > 21 && aces > 0) {
      total -= 10;
      aces--;
    }
    return total;
  }

  function isBlackjack(hand) {
    return hand && hand.length === 2 && handValue(hand) === 21;
  }

  function defaultSeats() {
    return [{ id: 'human', name: opts.playerName || '你', isAI: false }];
  }

  function makePlayersFromSeats(seats) {
    return (seats && seats.length ? seats : defaultSeats()).slice(0, 6).map(function(seat, index) {
      var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
      return {
        id: seat.id || (isAI ? 'ai-' + (index + 1) : 'human'),
        name: seat.name || (isAI ? 'AI ' + (index + 1) : '玩家'),
        isAI: isAI,
        ai: isAI,
        online: seat.online !== false,
        playerColor: seat.playerColor || '',
        playerIcon: seat.playerIcon || '',
        hand: [],
        status: 'playing',
        outcome: '',
        payout: 0,
        stats: cloneStats(seat.stats)
      };
    });
  }

  function defaultStats() {
    return { rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, points: 0 };
  }

  function cloneStats(stats) {
    var base = defaultStats();
    stats = stats || {};
    Object.keys(base).forEach(function(key) {
      base[key] = Number(stats[key] || 0);
    });
    return base;
  }

  function drawCard() {
    if (!state.deck.length) state.deck = makeDeck();
    return state.deck.pop();
  }

  function buildInitialState(seats) {
    var players = makePlayersFromSeats(seats);
    var initial = {
      deck: makeDeck(),
      dealer: { hand: [], status: 'hidden' },
      players: players,
      currentIndex: 0,
      status: 'playing',
      phase: PHASES.DEALING,
      history: [],
      roundNumber: 1,
      startedAt: Date.now(),
      finishedAt: 0,
      resultSaved: false
    };
    state = initial;
    players.forEach(function(player) { player.hand.push(drawCard()); });
    initial.dealer.hand.push(drawCard());
    players.forEach(function(player) { player.hand.push(drawCard()); });
    initial.dealer.hand.push(drawCard());
    players.forEach(function(player) {
      if (isBlackjack(player.hand)) player.status = 'stand';
    });
    initial.history.push({ name: '系統', text: '新一局 21點開始' });
    initial.phase = PHASES.PLAYER_TURN;
    advanceTurn();
    return clone(initial);
  }

  function buildNextRoundState() {
    var previous = state || {};
    var seats = (previous.players || []).map(function(player) {
      return {
        id: player.id,
        name: player.name,
        isAI: player.isAI || (/^ai-/.test(player.id || '') && player.id !== (opts && opts.selfId)),
        online: player.online !== false,
        playerColor: player.playerColor || '',
        playerIcon: player.playerIcon || '',
        stats: cloneStats(player.stats)
      };
    });
    var next = buildInitialState(seats);
    next.roundNumber = Number(previous.roundNumber || 1) + 1;
    next.history = [{ name: '系統', text: '第 ' + next.roundNumber + ' 局 21點開始' }];
    return next;
  }

  function setupGame() {
    suggestedAction = '';
    if (opts && opts.initialState && opts.initialState.state) {
      state = clone(opts.initialState.state);
      normalizeState();
      return;
    }
    state = buildInitialState(defaultSeats());
    normalizeState();
  }

  function serializeState() {
    return {
      gameId: 'blackjack',
      roundId: opts.roundId || '',
      state: clone(state)
    };
  }

  function applyState(snapshot) {
    if (!snapshot || !snapshot.state) return;
    if (opts && opts.roundId && snapshot.roundId && snapshot.roundId !== opts.roundId) return;
    state = clone(snapshot.state);
    suggestedAction = '';
    normalizeState();
    render();
  }

  function normalizeState() {
    if (!state) return;
    state.phase = state.phase || (state.status === 'settled' ? PHASES.RESULT : PHASES.PLAYER_TURN);
    state.history = state.history || [];
    state.players = state.players || [];
    state.players.forEach(function(player) {
      player.status = player.status || 'playing';
      player.outcome = player.outcome || '';
      player.payout = Number(player.payout || 0);
      player.ai = !!player.ai || !!player.isAI;
      player.playerColor = player.playerColor || '';
      player.playerIcon = player.playerIcon || '';
      player.stats = cloneStats(player.stats);
    });
    state.roundNumber = Number(state.roundNumber || 1);
    if (state.status === 'settled') state.phase = PHASES.RESULT;
  }

  function publishState() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.setGameState) return;
    App.Signaling.setGameState(serializeState());
  }

  function commit() {
    if (isHostAuthority()) {
      publishState();
      render();
      scheduleAI();
    }
  }

  function activePlayer() {
    return state.players[state.currentIndex] || null;
  }

  function canControlPlayer(player) {
    if (!player || state.status !== 'playing' || player.status !== 'playing') return false;
    if (!activePlayer() || activePlayer().id !== player.id) return false;
    if (isSpectator() || player.ai) return false;
    if (!isRoomMode()) return player.id === 'human';
    return player.id === opts.selfId;
  }

  function selfPlayer() {
    if (!state) return null;
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }

  function record(name, text) {
    state.history.push({ name: name, text: text });
    if (state.history.length > 24) state.history = state.history.slice(state.history.length - 24);
    logGameChat(name, text);
  }

  function logGameChat(name, text) {
    if (!isRoomMode() || !opts.isHost || !App.Lobby || !App.Lobby.logRoomEvent) return;
    App.Lobby.logRoomEvent('game', name + '：' + text, 'game_action');
  }

  function hit(playerId) {
    if (!state || state.status !== 'playing' || state.phase !== PHASES.PLAYER_TURN) return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player || player.status !== 'playing' || !activePlayer() || activePlayer().id !== player.id) return;
    suggestedAction = '';
    player.hand.push(drawCard());
    var value = handValue(player.hand);
    record(player.name, '抽牌至 ' + value + ' 點');
    if (value > 21) {
      player.status = 'bust';
      state.phase = PHASES.PLAYER_BUST;
      record(player.name, '爆牌');
      advanceTurn();
    } else if (value === 21) {
      player.status = 'stand';
      advanceTurn();
    }
    commit();
  }

  function stand(playerId) {
    if (!state || state.status !== 'playing' || state.phase !== PHASES.PLAYER_TURN) return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player || player.status !== 'playing' || !activePlayer() || activePlayer().id !== player.id) return;
    suggestedAction = '';
    player.status = 'stand';
    record(player.name, '停牌 ' + handValue(player.hand) + ' 點');
    advanceTurn();
    commit();
  }

  function advanceTurn() {
    if (!state || state.status !== 'playing') return;
    state.phase = PHASES.PLAYER_TURN;
    while (state.players[state.currentIndex] && state.players[state.currentIndex].status !== 'playing') {
      state.currentIndex++;
    }
    if (state.currentIndex >= state.players.length) {
      dealerPlay();
      settleRound();
    }
  }

  function dealerPlay() {
    if (state.status !== 'playing') return;
    state.phase = PHASES.DEALER_TURN;
    state.dealer.status = 'playing';
    while (handValue(state.dealer.hand) < 17) {
      state.dealer.hand.push(drawCard());
    }
    state.dealer.status = handValue(state.dealer.hand) > 21 ? 'bust' : 'stand';
  }

  function settleRound() {
    if (state.status === 'settled') return;
    var dealerValue = handValue(state.dealer.hand);
    var dealerBust = dealerValue > 21;
    state.players.forEach(function(player) {
      var value = handValue(player.hand);
      if (value > 21) {
        player.outcome = 'lose';
        player.payout = -1;
      } else if (isBlackjack(player.hand) && !isBlackjack(state.dealer.hand)) {
        player.outcome = 'blackjack';
        player.payout = 1.5;
      } else if (dealerBust || value > dealerValue) {
        player.outcome = 'win';
        player.payout = 1;
      } else if (value === dealerValue) {
        player.outcome = 'push';
        player.payout = 0;
      } else {
        player.outcome = 'lose';
        player.payout = -1;
      }
      player.status = 'done';
      applyRoundStats(player);
    });
    state.status = 'settled';
    state.phase = PHASES.RESULT;
    state.finishedAt = Date.now();
    record('莊家', '以 ' + dealerValue + ' 點結算');
    saveRoomResult();
  }

  function applyRoundStats(player) {
    player.stats = cloneStats(player.stats);
    player.stats.rounds += 1;
    player.stats.points += Number(player.payout || 0);
    if (player.outcome === 'blackjack') {
      player.stats.blackjacks += 1;
      player.stats.wins += 1;
    } else if (player.outcome === 'win') {
      player.stats.wins += 1;
    } else if (player.outcome === 'push') {
      player.stats.pushes += 1;
    } else {
      player.stats.losses += 1;
    }
  }

  function saveRoomResult() {
    if (!state || state.resultSaved) return;
    state.resultSaved = true;
    if (!isRoomMode() || !opts.isHost || !App.Signaling) return;
    if (App.Signaling.appendHistory) {
      App.Signaling.appendHistory({
        status: 'completed',
        gameId: 'blackjack',
        mode: opts.mode || 'room',
        roundId: opts.roundId || '',
        summary: '21點完成',
        results: state.players.map(function(player) {
          return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', outcome: player.outcome, score: player.payout };
        })
      });
    }
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return {
          id: player.id,
          name: player.name,
          playerColor: player.playerColor || '',
          playerIcon: player.playerIcon || '',
          score: player.payout,
          win: player.outcome === 'win' || player.outcome === 'blackjack'
        };
      }));
    }
  }

  function sendRoomAction(action) {
    if (!isRoomMode() || !App.Signaling || !App.Signaling.sendGameAction) return;
    action.roundId = opts.roundId || '';
    App.Signaling.sendGameAction({
      roundId: opts.roundId || '',
      gameId: 'blackjack',
      mode: opts.mode || 'room',
      payload: action
    });
  }

  function playerAction(action) {
    var player = selfPlayer();
    if (!canControlPlayer(player)) return;
    suggestedAction = '';
    if (isRoomMode() && !opts.isHost) {
      sendRoomAction({ type: 'bj_action', playerId: opts.selfId, action: action });
      return;
    }
    if (action === 'hit') hit(player.id);
    else stand(player.id);
  }

  function dealerUpValue() {
    var card = state && state.dealer && state.dealer.hand && state.dealer.hand[0];
    if (!card) return 10;
    if (card.rank === 'A') return 11;
    if (['J','Q','K'].indexOf(card.rank) >= 0) return 10;
    return Number(card.rank);
  }

  function recommendedAction(player) {
    var value = handValue(player && player.hand);
    var dealer = dealerUpValue();
    if (value <= 11) return 'hit';
    if (value >= 17) return 'stand';
    if (value >= 13 && dealer <= 6) return 'stand';
    if (value === 12 && dealer >= 4 && dealer <= 6) return 'stand';
    return 'hit';
  }

  function suggestAction() {
    var player = selfPlayer();
    if (!canControlPlayer(player)) return false;
    suggestedAction = recommendedAction(player);
    render();
    if (App.Common && App.Common.showToast) {
      App.Common.showToast(suggestedAction === 'hit' ? '建議抽牌' : '建議停牌', 'success');
    }
    return true;
  }

  function canStartNewRound() {
    if (!state || state.status !== 'settled') return false;
    if (isSpectator()) return false;
    return !isRoomMode() || opts.isHost;
  }

  function startNewRound() {
    if (!canStartNewRound()) return false;
    suggestedAction = '';
    state = buildNextRoundState();
    normalizeState();
    commit();
    return true;
  }

  function backToLobby() {
    if (App.GameManager) App.GameManager.endGame({ skipConfirm: true });
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !opts.isHost || !msg || msg.type !== 'bj_action') return;
    var player = state.players.filter(function(item) { return item.id === msg.playerId; })[0];
    if (!player || player.id !== (activePlayer() && activePlayer().id) || player.ai || state.phase !== PHASES.PLAYER_TURN) return;
    if (msg.action === 'hit') hit(player.id);
    if (msg.action === 'stand') stand(player.id);
  }

  function syncPlayerPresence(roomPlayers) {
    if (!state || !roomPlayers) return;
    var changed = false;
    state.players.forEach(function(player) {
      var remote = roomPlayers.filter(function(item) { return item.id === player.id; })[0];
      if (!remote || player.isAI) return;
      var takeover = remote.online === false;
      if (!!player.ai !== takeover) {
        player.ai = takeover;
        record('系統', player.name + (takeover ? ' 斷線，AI 接管' : ' 已重連'));
        changed = true;
      }
      player.online = remote.online !== false;
      player.name = remote.name || player.name;
      player.playerColor = remote.playerColor || player.playerColor || '';
      player.playerIcon = remote.playerIcon || player.playerIcon || '';
    });
    if (changed) commit();
  }

  function scheduleAI() {
    aiTimer = clearTimer(aiTimer);
    if (!isHostAuthority() || !state || state.status !== 'playing') return;
    var player = activePlayer();
    if (!player || !player.ai) return;
    aiTimer = setTimeout(function() {
      aiTimer = null;
      if (!state || state.status !== 'playing') return;
      if (!activePlayer() || activePlayer().id !== player.id) return;
      if (handValue(player.hand) < 16) hit(player.id);
      else stand(player.id);
    }, 680);
  }

  function renderCard(card, hidden) {
    if (hidden) return '<span class="bj-card back">?</span>';
    var red = card.suit === 'D' || card.suit === 'H';
    return '<span class="bj-card' + (red ? ' red' : '') + '">' +
      '<b>' + escapeHtml(card.rank) + '</b><em>' + SUIT_SYMBOLS[card.suit] + '</em>' +
    '</span>';
  }

  function renderHand(hand, hideSecond) {
    return (hand || []).map(function(card, index) {
      return renderCard(card, hideSecond && index === 1);
    }).join('');
  }

  function statusText(player) {
    if (player.status === 'bust') return '爆牌';
    if (player.status === 'stand') return '停牌';
    if (player.status === 'done') {
      return { win: '勝', blackjack: 'Blackjack', lose: '負', push: '和' }[player.outcome] || '完成';
    }
    if (activePlayer() && activePlayer().id === player.id) return '行動中';
    return '等待';
  }

  function titleText() {
    if (state.status === 'settled') return '21點結算';
    var player = activePlayer();
    if (!player) return '莊家結算中';
    return canControlPlayer(player) ? '輪到你：抽牌或停牌' : player.name + ' 行動中';
  }

  function render() {
    if (!container || !state) return;
    container.setAttribute('data-active-game', 'blackjack');
    var player = selfPlayer();
    var canAct = canControlPlayer(player);
    try {
      var dealerHtml = renderHand(state.dealer.hand, state.phase === PHASES.PLAYER_TURN && state.status === 'playing' && !isSpectator());
      var playersHtml = state.players.map(renderPlayer).join('');
      var isSettled = state.status === 'settled';
      var hintHtml = escapeHtml(isSettled ? resultHint() : canAct ? handValue(player.hand) + ' 點，請選擇操作' : latestHint());
      if (isSettled) {
        var actions = '<button class="bj-btn secondary" id="bj-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回</span></button>' +
          '<button class="bj-btn" id="bj-new-round"' + (canStartNewRound() ? '' : ' disabled') + '><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>' + (isRoomMode() && !opts.isHost ? '等待房主' : '再來一局') + '</span></button>';
        container.textContent = '';
        container.insertAdjacentHTML('beforeend',
          '<div class="bj-shell">' + App.Common.renderResultPanel({
            eyebrow: '21點結算',
            title: blackjackResultTitle(),
            subtitle: resultHint(),
            rows: state.players.map(function(rowPlayer, index) {
              rowPlayer.stats = cloneStats(rowPlayer.stats);
              return {
                rank: '#' + (index + 1),
                name: rowPlayer.name,
                person: rowPlayer,
                primary: statusText(rowPlayer) + ' ' + formatPayout(rowPlayer.payout),
                secondary: formatPoints(rowPlayer.stats.points) + ' 分 · ' + rowPlayer.stats.wins + '勝'
              };
            }),
            history: state.history.slice().reverse().map(function(row) {
              return { label: row.name, text: row.text };
            }),
            actionsHtml: actions
          }) + '</div>'
        );
        bindControls();
        if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('21點結算');
        return;
      }
      var html =
        '<div class="bj-shell">' +
          '<div class="bj-topbar">' +
            '<div class="bj-title' + (canAct ? ' my-turn' : '') + '">' + escapeHtml(titleText()) + '</div>' +
            '<div class="bj-actions">' +
              (isRoomMode() ? '<button class="bj-icon-btn game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') +
              '<button class="bj-icon-btn" onclick="App.GameManager.endGame()" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
            '</div>' +
          '</div>' +
          renderScoreboard() +
          '<div class="bj-table">' +
            '<section class="bj-dealer"><div><strong>莊家</strong><span>' + (state.phase === PHASES.PLAYER_TURN && state.status === 'playing' ? '明牌 ' + handValue([state.dealer.hand[0]]) : handValue(state.dealer.hand) + ' 點') + '</span></div><div class="bj-hand">' + dealerHtml + '</div></section>' +
            '<section class="bj-players">' + playersHtml + '</section>' +
          '</div>' +
          '<div class="bj-controlbar">' +
            '<div class="bj-hint">' + hintHtml + '</div>' +
            ('<button class="bj-btn secondary" id="bj-suggest"' + (canAct ? '' : ' disabled') + '><i class="fa-regular fa-lightbulb" aria-hidden="true"></i><span>推薦</span></button>' +
                '<button class="bj-btn secondary' + (suggestedAction === 'hit' ? ' recommended' : '') + '" id="bj-hit"' + (canAct ? '' : ' disabled') + '><i class="fa-solid fa-plus" aria-hidden="true"></i><span>抽牌</span></button>' +
                '<button class="bj-btn' + (suggestedAction === 'stand' ? ' recommended' : '') + '" id="bj-stand"' + (canAct ? '' : ' disabled') + '><i class="fa-solid fa-hand" aria-hidden="true"></i><span>停牌</span></button>') +
          '</div>' +
        '</div>';
      container.textContent = '';
      container.insertAdjacentHTML('beforeend', html);
      if (App.Lobby && App.Lobby.setTitle) {
        App.Lobby.setTitle(canAct ? '輪到你 - 21點' : '21點');
      }
    } catch (e) {
      container.textContent = '21點畫面錯誤：' + e.message;
      container.innerHTML = '<div class="card"><h2>21點畫面錯誤</h2><p>' + escapeHtml(e.message) + '</p></div>';
      throw e;
    }
    bindControls();
  }

  function renderPlayer(player) {
    var active = activePlayer() && activePlayer().id === player.id;
    var cls = 'bj-player' + (active ? ' active' : '') + (player.id === (opts && opts.selfId) || (!isRoomMode() && player.id === 'human') ? ' self' : '');
    var color = App.Common && App.Common.getPlayerColor ? App.Common.getPlayerColor(player.playerColor).value : '#d9e1ea';
    return '<article class="' + cls + '">' +
      '<div class="bj-player-head" style="--player-color:' + color + '">' +
        '<div class="bj-player-name">' + (App.Common && App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(player) : '') + '<strong>' + escapeHtml(player.name) + '</strong></div>' +
        '<span>' + statusText(player) + (player.ai ? ' · AI' : '') + '</span>' +
      '</div>' +
      '<div class="bj-hand">' + renderHand(player.hand, false) + '</div>' +
      '<div class="bj-score"><span>' + handValue(player.hand) + ' 點</span><strong>' + formatPayout(player.payout) + '</strong></div>' +
    '</article>';
  }

  function renderScoreboard() {
    return '<section class="bj-scoreboard">' + state.players.map(function(player) {
      player.stats = cloneStats(player.stats);
      var winRate = player.stats.rounds ? Math.round(player.stats.wins / player.stats.rounds * 100) : 0;
      return '<article class="bj-score-chip">' +
        '<strong>' + (App.Common && App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(player, 'mini') : '') + escapeHtml(player.name) + '</strong>' +
        '<span>' + formatPoints(player.stats.points) + ' 分 · ' + player.stats.wins + '勝 · ' + winRate + '%</span>' +
      '</article>';
    }).join('') + '</section>';
  }

  function formatPayout(value) {
    value = Number(value || 0);
    if (!value) return '±0';
    return (value > 0 ? '+' : '') + value;
  }

  function formatPoints(value) {
    value = Number(value || 0);
    if (!value) return '0';
    return (value > 0 ? '+' : '') + value;
  }

  function resultHint() {
    var dealerValue = handValue(state.dealer.hand);
    return '第 ' + state.roundNumber + ' 局完成 · 莊家 ' + dealerValue + ' 點';
  }

  function blackjackResultTitle() {
    var self = selfPlayer();
    if (!self) return '21點完成';
    if (self.outcome === 'win' || self.outcome === 'blackjack') return '你贏了';
    if (self.outcome === 'push') return '和局';
    return '莊家勝出';
  }

  function latestHint() {
    var row = state.history[state.history.length - 1];
    return row ? row.name + '：' + row.text : '等待行動';
  }

  function bindControls() {
    var hitBtn = container.querySelector('#bj-hit');
    var standBtn = container.querySelector('#bj-stand');
    var suggestBtn = container.querySelector('#bj-suggest');
    var newRoundBtn = container.querySelector('#bj-new-round');
    var backBtn = container.querySelector('#bj-back');
    if (hitBtn) hitBtn.addEventListener('click', function() { playerAction('hit'); });
    if (standBtn) standBtn.addEventListener('click', function() { playerAction('stand'); });
    if (suggestBtn) suggestBtn.addEventListener('click', suggestAction);
    if (newRoundBtn) newRoundBtn.addEventListener('click', startNewRound);
    if (backBtn) backBtn.addEventListener('click', backToLobby);
  }

  App.BlackjackRules = {
    handValue: handValue,
    isBlackjack: isBlackjack,
    buildInitialState: buildInitialState,
    phases: PHASES
  };

  App.GameManager.register({
    id: 'blackjack',
    name: '21點',
    icon: '21',
    description: '多人各自挑戰同一莊家',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 6,
    allowSpectators: true,
    aiFill: false,
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
      if (action === 'suggest') return suggestAction();
      if (action === 'primary' && canStartNewRound()) return startNewRound();
      if (action === 'primary' && suggestedAction && canControlPlayer(selfPlayer())) {
        playerAction(suggestedAction);
        return true;
      }
      if (action === 'cancel' && suggestedAction) {
        suggestedAction = '';
        render();
        return true;
      }
      return false;
    },
    destroy: function() {
      aiTimer = clearTimer(aiTimer);
      container = null;
      opts = null;
      state = null;
      suggestedAction = '';
    }
  });
})();
