(function() {
  var RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2'];
  var SUITS = ['D','C','H','S'];
  var SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠' };
  var FIVE_KIND_VALUE = { straight: 1, flush: 2, fullhouse: 3, fourkind: 4, straightflush: 5 };
  var COMBO_NAMES = {
    single: '單張',
    pair: '一對',
    triple: '三條',
    straight: '順子',
    flush: '同花',
    fullhouse: '夫佬',
    fourkind: '四條',
    straightflush: '同花順'
  };
  var STRAIGHT_ORDER = {
    '3,4,5,6,7': 1,
    '4,5,6,7,8': 2,
    '5,6,7,8,9': 3,
    '6,7,8,9,10': 4,
    '7,8,9,10,J': 5,
    '8,9,10,J,Q': 6,
    '9,10,J,Q,K': 7,
    '10,J,Q,K,A': 8,
    '2,3,4,5,6': 9,
    'A,2,3,4,5': 10
  };
  var BASE_STAKE = 1;

  var container = null;
  var opts = null;
  var players = [];
  var currentPlayer = 0;
  var lastPlay = null;
  var firstPlay = true;
  var selectedIds = {};
  var history = [];
  var gameOver = false;
  var placements = [];
  var aiTimer = null;
  var roundNumber = 0;
  var previousWinnerIndex = null;
  var openingRule = 'winner';
  var firstPlayRequiresDiamondThree = true;
  var topDaRecords = [];
  var infoOpen = false;
  var lastTurnNotice = '';
  var playedPiles = [];
  var handIntroDone = false;
  var lastAnimatedPlayKey = '';
  var resultSaved = false;

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function rankValue(rank) { return RANKS.indexOf(rank); }
  function suitValue(suit) { return SUITS.indexOf(suit); }
  function cardValue(card) { return rankValue(card.rank) * 4 + suitValue(card.suit); }
  function byCard(a, b) { return cardValue(a) - cardValue(b); }
  function cloneCards(cards) { return cards.map(function(card) { return Object.assign({}, card); }); }

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

  function defaultSeats() {
    return [
      { id: 'human', name: opts.playerName || '你', isAI: false },
      { id: 'ai-1', name: 'AI 1', isAI: true },
      { id: 'ai-2', name: 'AI 2', isAI: true },
      { id: 'ai-3', name: 'AI 3', isAI: true }
    ];
  }

  function makePlayersFromSeats(seats) {
    return seats.slice(0, 4).map(function(seat, index) {
      var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
      return {
        id: seat.id || (isAI ? 'ai-' + (index + 1) : 'human'),
        name: seat.name || (isAI ? 'AI ' + (index + 1) : '玩家'),
        playerColor: seat.playerColor || '',
        playerIcon: seat.playerIcon || '',
        hand: [],
        ai: isAI,
        passed: false
      };
    });
  }

  function setupGame() {
    if (opts && opts.initialState && opts.initialState.state) {
      applyState(opts.initialState.state);
      return;
    }
    setupFreshGame(defaultSeats());
  }

  function setupFreshGame(seats) {
    var deck = makeDeck();
    players = makePlayersFromSeats(seats && seats.length ? seats : defaultSeats());
    deck.forEach(function(card, index) { players[index % 4].hand.push(card); });
    players.forEach(function(player) { player.hand.sort(byCard); });
    roundNumber++;
    firstPlayRequiresDiamondThree = roundNumber === 1 || openingRule === 'diamond3' || previousWinnerIndex === null;
    currentPlayer = firstPlayRequiresDiamondThree
      ? players.findIndex(function(player) {
          return player.hand.some(function(card) { return card.id === '3D'; });
        })
      : previousWinnerIndex;
    lastPlay = null;
    firstPlay = true;
    selectedIds = {};
    topDaRecords = [];
    playedPiles = [];
    handIntroDone = false;
    lastAnimatedPlayKey = '';
    resultSaved = false;
    history = [{ player: '系統', text: firstPlayRequiresDiamondThree ? players[currentPlayer].name + ' 持有 3♦ 先手' : '續局由上局勝出者 ' + players[currentPlayer].name + ' 先手' }];
    gameOver = false;
    placements = [];
  }

  function buildInitialState(seats) {
    setupFreshGame(seats);
    return serializeState();
  }

  function serializeState() {
    return {
      players: players.map(function(player) {
        return {
          id: player.id,
          name: player.name,
          playerColor: player.playerColor || '',
          playerIcon: player.playerIcon || '',
          ai: !!player.ai,
          hand: cloneCards(player.hand),
          passed: !!player.passed
        };
      }),
      currentPlayer: currentPlayer,
      lastPlay: lastPlay ? {
        playerIndex: lastPlay.playerIndex,
        playerName: lastPlay.playerName,
        cards: cloneCards(lastPlay.cards),
        combo: lastPlay.combo
      } : null,
      firstPlay: !!firstPlay,
      history: history.slice(),
      gameOver: !!gameOver,
      placements: placements.slice(),
      roundNumber: roundNumber,
      previousWinnerIndex: previousWinnerIndex,
      openingRule: openingRule,
      firstPlayRequiresDiamondThree: !!firstPlayRequiresDiamondThree,
      topDaRecords: topDaRecords.slice(),
      playedPiles: playedPiles.map(function(pile) {
        return {
          playerName: pile.playerName,
          cards: cloneCards(pile.cards || []),
          comboType: pile.comboType || '',
          createdAt: pile.createdAt || 0
        };
      }),
      savedAt: Date.now()
    };
  }

  function applyState(state) {
    if (!state) return;
    players = (state.players || []).map(function(player) {
      return {
        id: player.id,
        name: player.name,
        ai: !!player.ai,
        hand: cloneCards(player.hand || []).sort(byCard),
        passed: !!player.passed
      };
    });
    currentPlayer = state.currentPlayer || 0;
    lastPlay = state.lastPlay ? {
      playerIndex: state.lastPlay.playerIndex,
      playerName: state.lastPlay.playerName,
      cards: cloneCards(state.lastPlay.cards || []).sort(byCard),
      combo: state.lastPlay.combo
    } : null;
    firstPlay = !!state.firstPlay;
    history = (state.history || []).slice();
    gameOver = !!state.gameOver;
    placements = (state.placements || []).slice();
    roundNumber = state.roundNumber || roundNumber || 1;
    previousWinnerIndex = state.previousWinnerIndex === undefined ? null : state.previousWinnerIndex;
    openingRule = state.openingRule || openingRule;
    firstPlayRequiresDiamondThree = !!state.firstPlayRequiresDiamondThree;
    topDaRecords = (state.topDaRecords || []).slice();
    playedPiles = (state.playedPiles || []).map(function(pile) {
      return {
        playerName: pile.playerName || '',
        cards: cloneCards(pile.cards || []).sort(byCard),
        comboType: pile.comboType || '',
        createdAt: pile.createdAt || 0
      };
    });
  }

  function publishState() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.setGameState) return;
    App.Signaling.setGameState({
      gameId: 'bigDee',
      mode: opts.mode,
      roundId: opts.roundId || '',
      state: serializeState()
    }).catch(function(e) {
      App.Common.showToast('同步牌局失敗：' + e.message, 'error');
    });
  }

  function commitTable() {
    if (!isHostAuthority() && !(opts && opts.localEcho)) return;
    publishState();
    render();
    notifyTurn();
    scheduleAI();
  }

  function notifyTurn() {
    if (!container || gameOver || isSpectator()) return;
    if (App.Lobby && App.Lobby.setTitle) {
      App.Lobby.setTitle(canControlCurrent() ? '輪到你 - 鋤大DEE' : players[currentPlayer].name + ' 思考中 - 鋤大DEE');
    }
    var key = currentPlayer + ':' + (lastPlay ? lastPlay.playerIndex : 'free') + ':' + players[currentPlayer].hand.length;
    if (canControlCurrent() && lastTurnNotice !== key) {
      lastTurnNotice = key;
      App.Common.showToast('輪到你出牌', 'success');
    }
  }

  function selfPlayerIndex() {
    if (isSpectator()) return -1;
    if (!isRoomMode()) return 0;
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === opts.selfId) return i;
    }
    return -1;
  }

  function syncPlayerPresence(roomPlayers) {
    if (!isRoomMode() || !roomPlayers || !roomPlayers.length || !players.length) return;
    var byId = {};
    roomPlayers.forEach(function(person) { byId[person.id] = person; });
    var changed = false;
    players.forEach(function(player) {
      var remote = byId[player.id];
      var nativeAI = /^ai-/.test(player.id || '');
      if (!remote || nativeAI) return;
      var leftActiveRound = !!(remote.presence && remote.presence !== 'playing');
      var shouldAI = remote.online === false || leftActiveRound;
      if (!!player.ai !== shouldAI) {
        player.ai = shouldAI;
        changed = true;
        recordHistory('系統', player.name + (shouldAI ? ' 離開本局，AI 接管' : ' 已重連，恢復真人操作'));
        App.Common.showToast(player.name + (shouldAI ? ' AI 接管中' : ' 已重連'), shouldAI ? '' : 'success');
      }
      player.online = remote.online !== false && !leftActiveRound;
      player.name = remote.name || player.name;
    });
    if (changed) {
      if (opts.isHost) publishState();
      render();
      scheduleAI();
    }
  }

  function canControlCurrent() {
    var index = selfPlayerIndex();
    return index >= 0 && index === currentPlayer && !gameOver && players[index] && !players[index].ai;
  }

  function groupByRank(cards) {
    return cards.reduce(function(map, card) {
      if (!map[card.rank]) map[card.rank] = [];
      map[card.rank].push(card);
      return map;
    }, {});
  }

  function highCard(cards) {
    return cards.slice().sort(byCard).pop();
  }

  function straightInfo(cards) {
    var ranks = cards.map(function(card) { return card.rank; });
    var uniqueRanks = ranks.filter(function(rank, index) { return ranks.indexOf(rank) === index; });
    if (uniqueRanks.length !== 5) return null;
    var hasRank = function(rank) { return uniqueRanks.indexOf(rank) !== -1; };
    var key = '';
    if (['A','2','3','4','5'].every(hasRank)) {
      key = 'A,2,3,4,5';
    } else if (['2','3','4','5','6'].every(hasRank)) {
      key = '2,3,4,5,6';
    } else {
      var sortedRanks = uniqueRanks.slice().sort(function(a, b) {
        return rankValue(a) - rankValue(b);
      });
      for (var i = 1; i < sortedRanks.length; i++) {
        if (rankValue(sortedRanks[i]) !== rankValue(sortedRanks[i - 1]) + 1) return null;
      }
      if (hasRank('2')) return null;
      key = sortedRanks.join(',');
    }
    var order = STRAIGHT_ORDER[key];
    if (!order) return null;
    var highestRank = key === 'A,2,3,4,5'
      ? '5'
      : key === '2,3,4,5,6'
        ? '6'
        : key.split(',').pop();
    var highestCards = cards.filter(function(card) { return card.rank === highestRank; });
    return { order: order, highCard: highCard(highestCards), key: key };
  }

  function flushPrimary(cards) {
    var sorted = cards.slice().sort(byCard);
    var score = 0;
    sorted.forEach(function(card, index) {
      score += cardValue(card) * Math.pow(60, index);
    });
    return score;
  }

  function analyze(cards) {
    cards = cards.slice().sort(byCard);
    var count = cards.length;
    var groups = groupByRank(cards);
    var groupRanks = Object.keys(groups).sort(function(a, b) {
      return rankValue(a) - rankValue(b);
    });

    if (count === 1) {
      return { valid: true, count: count, type: 'single', primary: cardValue(cards[0]), cards: cards };
    }
    if (count === 2 && groupRanks.length === 1) {
      return { valid: true, count: count, type: 'pair', primary: cardValue(highCard(cards)), cards: cards };
    }
    if (count === 3 && groupRanks.length === 1) {
      return { valid: true, count: count, type: 'triple', primary: cardValue(highCard(cards)), cards: cards };
    }
    if (count !== 5) return { valid: false, reason: '只支援單張、一對、三條或五張牌型' };

    var flush = cards.every(function(card) { return card.suit === cards[0].suit; });
    var straight = straightInfo(cards);
    if (straight && flush) {
      return { valid: true, count: count, type: 'straightflush', primary: straight.order * 4 + suitValue(straight.highCard.suit), cards: cards };
    }

    var sizes = groupRanks.map(function(rank) { return groups[rank].length; }).sort(function(a, b) { return b - a; });
    if (sizes[0] === 4) {
      var quadRank = groupRanks.filter(function(rank) { return groups[rank].length === 4; })[0];
      return { valid: true, count: count, type: 'fourkind', primary: rankValue(quadRank), cards: cards };
    }
    if (sizes[0] === 3 && sizes[1] === 2) {
      var tripleRank = groupRanks.filter(function(rank) { return groups[rank].length === 3; })[0];
      return { valid: true, count: count, type: 'fullhouse', primary: rankValue(tripleRank), cards: cards };
    }
    if (flush) {
      return { valid: true, count: count, type: 'flush', primary: flushPrimary(cards), cards: cards };
    }
    if (straight) {
      return { valid: true, count: count, type: 'straight', primary: straight.order * 4 + suitValue(straight.highCard.suit), cards: cards };
    }
    return { valid: false, reason: '五張牌必須是蛇、同花、夫佬、四條或同花順' };
  }

  function compareCombos(a, b) {
    if (!a || !a.valid) return -1;
    if (!b) return 1;
    if (a.count !== b.count) return -1;
    if (a.count === 5) {
      var typeDiff = FIVE_KIND_VALUE[a.type] - FIVE_KIND_VALUE[b.type];
      if (typeDiff !== 0) return typeDiff;
    } else if (a.type !== b.type) {
      return -1;
    }
    return a.primary - b.primary;
  }

  function canPlay(cards) {
    var combo = analyze(cards);
    if (!combo.valid) return { ok: false, combo: combo, reason: combo.reason };
    if (firstPlay && firstPlayRequiresDiamondThree && !cards.some(function(card) { return card.id === '3D'; })) {
      return { ok: false, combo: combo, reason: '第一手必須包含 3♦' };
    }
    if (lastPlay && compareCombos(combo, lastPlay.combo) <= 0) {
      return { ok: false, combo: combo, reason: '需要同張數並壓過上一手' };
    }
    return { ok: true, combo: combo, reason: COMBO_NAMES[combo.type] };
  }

  function removeCards(player, cards) {
    var ids = {};
    cards.forEach(function(card) { ids[card.id] = true; });
    player.hand = player.hand.filter(function(card) { return !ids[card.id]; });
  }

  function nextPlayerIndex(from) {
    for (var step = 1; step <= players.length; step++) {
      var index = (from + step) % players.length;
      if (players[index].hand.length === 0) continue;
      if (lastPlay && players[index].passed) continue;
      return index;
    }
    return from;
  }

  function clearPasses() {
    players.forEach(function(player) { player.passed = false; });
  }

  function recordHistory(playerName, text) {
    history.push({ player: playerName, text: text });
    if (history.length > 7) history = history.slice(history.length - 7);
    logGameChat(playerName, text);
  }

  function logGameChat(playerName, text) {
    if (!isRoomMode() || !opts.isHost || !App.Lobby || !App.Lobby.logRoomEvent) return;
    App.Lobby.logRoomEvent('game', playerName + '：' + text, 'game_action');
  }

  function playCards(index, cards) {
    var player = players[index];
    var check = canPlay(cards);
    if (!check.ok) return false;
    recordTopDaIfNeeded(index, cards, check.combo, false);
    removeCards(player, cards);
    lastPlay = {
      playerIndex: index,
      playerName: player.name,
      cards: cloneCards(cards).sort(byCard),
      combo: check.combo
    };
    playedPiles.push({
      playerName: player.name,
      cards: cloneCards(cards).sort(byCard),
      comboType: check.combo.type,
      createdAt: Date.now()
    });
    if (playedPiles.length > 18) playedPiles = playedPiles.slice(playedPiles.length - 18);
    firstPlay = false;
    clearPasses();
    recordHistory(player.name, '出了 ' + COMBO_NAMES[check.combo.type] + '（' + cardsToText(cards) + '）');
    selectedIds = {};
    if (player.hand.length === 0) {
      finishGame(index);
      return true;
    }
    currentPlayer = nextPlayerIndex(index);
    commitTable();
    return true;
  }

  function passTurn(index) {
    if (!lastPlay || index !== currentPlayer) return;
    recordTopDaIfNeeded(index, [], null, true);
    players[index].passed = true;
    recordHistory(players[index].name, 'Pass');
    var activeOthers = players.filter(function(player, playerIndex) {
      return playerIndex !== lastPlay.playerIndex && player.hand.length > 0 && !player.passed;
    });
    if (activeOthers.length === 0) {
      currentPlayer = lastPlay.playerIndex;
      recordHistory('系統', players[currentPlayer].name + ' 取得新一輪出牌權');
      lastPlay = null;
      clearPasses();
    } else {
      currentPlayer = nextPlayerIndex(index);
    }
    commitTable();
  }

  function finishGame(winnerIndex) {
    gameOver = true;
    aiTimer = clearTimer(aiTimer);
    previousWinnerIndex = winnerIndex;
    placements = [winnerIndex].concat(players.map(function(_, index) { return index; }).filter(function(index) {
      return index !== winnerIndex;
    }).sort(function(a, b) {
      return players[a].hand.length - players[b].hand.length;
    }));
    publishState();
    appendRoomHistory(winnerIndex, false);
    renderResult();
  }

  function appendRoomHistory(winnerIndex, interrupted) {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.appendHistory) return;
    if (resultSaved) return;
    resultSaved = true;
    var scoring = calculateScores(winnerIndex);
    App.Signaling.appendHistory({
      gameId: 'bigDee',
      gameName: '鋤大DEE',
      mode: opts.mode || 'room',
      roundId: opts.roundId || '',
      status: interrupted ? 'interrupted' : 'completed',
      winnerId: players[winnerIndex] && players[winnerIndex].id,
      winnerName: players[winnerIndex] && players[winnerIndex].name,
      players: players.map(function(player, index) {
        return {
          id: player.id,
          name: player.name,
          playerColor: player.playerColor || '',
          playerIcon: player.playerIcon || '',
          ai: !!player.ai,
          left: player.hand.length,
          score: scoring[index] ? scoring[index].delta : 0
        };
      }),
      history: history.slice(),
      topDaRecords: topDaRecords.slice()
    }).catch(function() {});
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(players.map(function(player, index) {
        return {
          id: player.id,
          name: player.name,
          playerColor: player.playerColor || '',
          playerIcon: player.playerIcon || '',
          score: scoring[index] ? scoring[index].delta : 0,
          win: index === winnerIndex
        };
      })).catch(function() {});
    }
  }

  function clearTimer(timer) {
    if (timer) clearTimeout(timer);
    return null;
  }

  function getSelectedCards() {
    var index = selfPlayerIndex();
    if (index < 0 || !players[index]) return [];
    return players[index].hand.filter(function(card) { return selectedIds[card.id]; });
  }

  function toggleCard(cardId) {
    if (!canControlCurrent()) return;
    if (selectedIds[cardId]) delete selectedIds[cardId];
    else selectedIds[cardId] = true;
    render();
  }

  function submitHumanPlay() {
    if (!canControlCurrent()) return;
    var index = selfPlayerIndex();
    var cards = getSelectedCards();
    if (isRoomMode() && !opts.isHost) {
      sendRoomAction({ type: 'bd_play', playerId: opts.selfId, cardIds: cards.map(function(card) { return card.id; }) });
      selectedIds = {};
      render();
      return;
    }
    playCards(index, cards);
  }

  function humanPass() {
    if (!canControlCurrent() || !lastPlay) return;
    var index = selfPlayerIndex();
    selectedIds = {};
    if (isRoomMode() && !opts.isHost) {
      sendRoomAction({ type: 'bd_pass', playerId: opts.selfId });
      render();
      return;
    }
    passTurn(index);
  }

  function scheduleAI() {
    if (gameOver || !isHostAuthority() || !players[currentPlayer] || !players[currentPlayer].ai) return;
    aiTimer = clearTimer(aiTimer);
    aiTimer = setTimeout(function() {
      aiTimer = null;
      aiMove(currentPlayer);
    }, 720);
  }

  function sendRoomAction(action) {
    if (!App.Lobby || typeof App.Lobby.sendRoomGameAction !== 'function') return false;
    return App.Lobby.sendRoomGameAction(action);
  }

  function aiMove(index) {
    if (gameOver || index !== currentPlayer) return;
    var candidates = legalCandidates(players[index].hand);
    if (candidates.length) {
      playCards(index, pickBestCandidate(index, candidates).cards);
    } else {
      passTurn(index);
    }
  }

  function pickBestCandidate(index, candidates) {
    if (shouldTopDa(index)) return strongestCandidate(candidates);
    return candidates.slice().sort(function(a, b) {
      return scoreCandidate(index, b) - scoreCandidate(index, a) || a.combo.primary - b.combo.primary;
    })[0] || candidates[0];
  }

  function scoreCandidate(index, candidate) {
    var hand = players[index].hand;
    if (candidate.cards.length === hand.length) return 10000;
    var score = candidate.cards.length * (lastPlay ? 24 : 130);
    if (candidate.combo.count === 5) score += 150 + FIVE_KIND_VALUE[candidate.combo.type] * 14;
    if (candidate.combo.type === 'triple') score += 70;
    if (candidate.combo.type === 'pair') score += 35;
    if (candidate.combo.type === 'single') score -= 18;
    score -= candidate.combo.primary * (lastPlay ? 2 : 1);
    if (firstPlay && firstPlayRequiresDiamondThree && candidate.cards.some(function(card) { return card.id === '3D'; })) score += 80;
    return score;
  }

  function suggestPlay() {
    if (!canControlCurrent()) return;
    var index = selfPlayerIndex();
    var candidates = legalCandidates(players[index].hand);
    selectedIds = {};
    if (!candidates.length) {
      App.Common.showToast(lastPlay ? '沒有可出的組合，建議 Pass' : '請選擇可出的牌', 'error');
      render();
      return;
    }
    pickBestCandidate(index, candidates).cards.forEach(function(card) { selectedIds[card.id] = true; });
    App.Common.showToast('已建議一組可出的牌');
    render();
  }

  function clearSelection() {
    if (!Object.keys(selectedIds).length) return false;
    selectedIds = {};
    render();
    return true;
  }

  function legalCandidates(hand) {
    var combos = enumerateCombos(hand).filter(function(item) {
      return canPlay(item.cards).ok;
    });
    combos.sort(function(a, b) {
      var aHasDiamondThree = a.cards.some(function(card) { return card.id === '3D'; });
      var bHasDiamondThree = b.cards.some(function(card) { return card.id === '3D'; });
      if (!lastPlay && aHasDiamondThree !== bHasDiamondThree) return aHasDiamondThree ? -1 : 1;
      if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
      var typeDiff = comboSortValue(a.combo) - comboSortValue(b.combo);
      if (typeDiff !== 0) return typeDiff;
      return a.combo.primary - b.combo.primary;
    });
    return combos;
  }

  function comboSortValue(combo) {
    if (combo.count === 1) return 1;
    if (combo.count === 2) return 2;
    if (combo.count === 3) return 3;
    return 10 + FIVE_KIND_VALUE[combo.type];
  }

  function strongestCandidate(candidates) {
    return candidates.slice().sort(function(a, b) {
      var typeDiff = comboSortValue(b.combo) - comboSortValue(a.combo);
      if (typeDiff !== 0) return typeDiff;
      return b.combo.primary - a.combo.primary;
    })[0];
  }

  function nextSeat(index) {
    return (index + 1) % players.length;
  }

  function shouldTopDa(index) {
    var next = players[nextSeat(index)];
    return next && next.hand.length === 1;
  }

  function recordTopDaIfNeeded(index, cards, combo, isPass) {
    if (!shouldTopDa(index)) return;
    var candidates = legalCandidates(players[index].hand);
    if (!candidates.length) return;
    var strongest = strongestCandidate(candidates);
    var usedStrongest = !isPass && combo && cards.length === strongest.cards.length && compareCombos(combo, strongest.combo) === 0;
    if (usedStrongest) return;
    topDaRecords.push({
      offenderIndex: index,
      offenderName: players[index].name,
      targetIndex: nextSeat(index),
      targetName: players[nextSeat(index)].name,
      expected: cardsToText(strongest.cards),
      actual: isPass ? 'Pass' : cardsToText(cards)
    });
    recordHistory('頂大', players[index].name + ' 未頂 ' + players[nextSeat(index)].name);
  }

  function enumerateCombos(hand) {
    var sorted = hand.slice().sort(byCard);
    var combos = [];
    var groups = groupByRank(sorted);
    function add(cards) {
      var combo = analyze(cards);
      if (combo.valid) combos.push({ cards: cards.slice().sort(byCard), combo: combo });
    }
    sorted.forEach(function(card) { add([card]); });
    Object.keys(groups).forEach(function(rank) {
      var group = groups[rank].sort(byCard);
      combinations(group, 2).forEach(add);
      combinations(group, 3).forEach(add);
    });
    combinations(sorted, 5).forEach(add);
    return combos;
  }

  function combinations(list, size) {
    var result = [];
    function walk(start, picked) {
      if (picked.length === size) {
        result.push(picked.slice());
        return;
      }
      for (var i = start; i <= list.length - (size - picked.length); i++) {
        picked.push(list[i]);
        walk(i + 1, picked);
        picked.pop();
      }
    }
    walk(0, []);
    return result;
  }

  function cardsToText(cards) {
    return cards.slice().sort(byCard).map(function(card) {
      return card.rank + SUIT_SYMBOLS[card.suit];
    }).join(' ');
  }

  function render() {
    if (!container || gameOver) return;
    var selected = getSelectedCards();
    var check = selected.length ? canPlay(selected) : { ok: false, reason: lastPlay ? '選擇可壓過上一手的牌' : '請出一手牌' };
    var playKey = currentPlayAnimationKey();
    var animatePlay = !!playKey && playKey !== lastAnimatedPlayKey;
    container.innerHTML =
      '<div class="bd-shell">' +
        '<div class="bd-topbar">' +
          '<div class="bd-title' + (canControlCurrent() ? ' my-turn' : '') + '">' + escapeHtml(statusTitle()) + '</div>' +
          '<div class="bd-actions">' +
            (isRoomMode() ? '<button class="bd-icon-btn game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') +
            '<button class="bd-icon-btn" id="bd-info-btn" aria-label="牌局資訊"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>' +
            '<button class="bd-icon-btn" onclick="' + (isRoomMode() ? 'App.Lobby.handleGameCloseAction()' : 'App.GameManager.endGame()') + '" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="bd-board">' +
          renderOpponentSeats() +
          renderTable(animatePlay) +
        '</div>' +
        renderHandPanel(check) +
        renderInfoDrawer() +
      '</div>';
    bindHand();
    bindControls();
    handIntroDone = true;
    if (animatePlay) lastAnimatedPlayKey = playKey;
    notifyTurn();
  }

  function currentPlayAnimationKey() {
    if (!lastPlay || !lastPlay.cards) return '';
    return [
      lastPlay.playerIndex,
      lastPlay.cards.map(function(card) { return card.id; }).join('-'),
      playedPiles.length
    ].join(':');
  }

  function statusTitle() {
    if (isSpectator()) return players[currentPlayer].name + ' 出牌中（觀戰）';
    if (canControlCurrent()) return lastPlay ? '輪到你：出同張數牌或 Pass' : '輪到你開新一輪';
    return players[currentPlayer].name + ' 思考中...';
  }

  function renderOpponentSeats() {
    var self = selfPlayerIndex();
    var indexes = players.map(function(_, index) { return index; }).filter(function(index) { return index !== self; });
    var positions = ['left', 'top', 'right'];
    return indexes.map(function(index, slot) {
      return renderSeat(index, positions[slot] || 'right');
    }).join('');
  }

  function renderSeat(index, position) {
    var player = players[index];
    var cls = 'bd-seat ' + position + (currentPlayer === index ? ' active' : '') + (player.passed ? ' passed' : '');
    return '<div class="' + cls + '">' +
      '<div class="bd-player-line"><div class="bd-player-name">' + escapeHtml(player.name) + '</div><div class="bd-seat-meta">' + player.hand.length + ' 張</div></div>' +
      '<div class="bd-card-backs">' + renderCardBacks(player.hand.length) + '</div>' +
      '<div class="bd-seat-badges">' +
        (currentPlayer === index ? '<span class="bd-seat-badge turn">輪到</span>' : '') +
        (player.passed ? '<span class="bd-seat-badge">Pass</span>' : '') +
        (player.ai ? '<span class="bd-seat-badge ai">AI</span>' : '') +
      '</div>' +
    '</div>';
  }

  function renderCardBacks(count) {
    var shown = Math.min(10, count);
    var html = '';
    for (var i = 0; i < shown; i++) html += '<span class="bd-card-back"></span>';
    return html;
  }

  function renderTable(animatePlay) {
    var self = selfPlayerIndex();
    var selfHandCount = self >= 0 && players[self] ? players[self].hand.length : 0;
    var last = lastPlay
      ? lastPlay.cards.map(function(card, index) { return renderTableCard(card, index, lastPlay.playerName, animatePlay); }).join('') +
        '<div class="bd-pill">' + escapeHtml(lastPlay.playerName) + ' · ' + COMBO_NAMES[lastPlay.combo.type] + '</div>'
      : '<div class="bd-last-empty">新一輪，可以自由出牌</div>';
    return '<div class="bd-table">' +
      '<div class="bd-status"><span>' + escapeHtml(openingRuleText()) + '</span><span class="bd-pill">' + (isSpectator() ? '觀戰' : selfHandCount + ' 張手牌') + '</span></div>' +
      renderDiscardPiles() +
      '<div class="bd-last-play">' + last + '</div>' +
    '</div>';
  }

  function renderDiscardPiles() {
    var piles = playedPiles.slice(0, lastPlay ? -1 : playedPiles.length).slice(-4);
    if (!piles.length) return '<div class="bd-discard-strip empty">已出牌堆</div>';
    return '<div class="bd-discard-strip">' + piles.map(function(pile, pileIndex) {
      var cards = (pile.cards || []).slice(-5);
      return '<div class="bd-discard-pile" style="--pile-i:' + pileIndex + '">' +
        '<div class="bd-discard-stack">' + cards.map(function(card, cardIndex) {
          return renderMiniPileCard(card, cardIndex, pile.playerName);
        }).join('') + '</div>' +
        '<span>' + escapeHtml(pile.playerName || '玩家') + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderHandPanel(check) {
    var self = selfPlayerIndex();
    var hand = self >= 0 && players[self] ? players[self].hand : [];
    var canControl = canControlCurrent();
    var hint = isSpectator() ? '觀戰模式：不可操作' : canControl ? check.reason : '未輪到你，操作暫時鎖定';
    var canSubmit = canControl && check.ok;
    var canPass = canControl && !!lastPlay;
    var canSuggest = canControl && legalCandidates(hand).length > 0;
    return '<div class="bd-hand-panel' + (canControl ? ' active' : '') + '">' +
      '<div class="bd-hand-scroll">' + (isSpectator() ? renderSpectatorHands() : hand.map(renderHandCard).join('')) + '</div>' +
      '<div class="bd-controls">' +
        '<div class="bd-hint">' + escapeHtml(hint) + '</div>' +
        '<button class="bd-action-btn secondary" id="bd-suggest-btn"' + (canSuggest ? '' : ' disabled') + '><i class="fa-regular fa-lightbulb" aria-hidden="true"></i><span>推薦</span></button>' +
        '<button class="bd-action-btn secondary" id="bd-pass-btn"' + (canPass ? '' : ' disabled') + '><i class="fa-solid fa-forward-step" aria-hidden="true"></i><span>Pass</span></button>' +
        '<button class="bd-action-btn" id="bd-play-btn"' + (canSubmit ? '' : ' disabled') + '><i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>出牌</span></button>' +
      '</div>' +
    '</div>';
  }

  function renderSpectatorHands() {
    return '<div class="bd-spectator-hands">' + players.map(function(player) {
      return '<div><strong>' + escapeHtml(player.name) + '</strong><span>' + escapeHtml(cardsToText(player.hand)) + '</span></div>';
    }).join('') + '</div>';
  }

  function renderHandCard(card, index) {
    var selected = selectedIds[card.id] ? ' selected' : '';
    var intro = handIntroDone ? '' : ' bd-hand-intro';
    return renderCard(card, 'bd-hand-card' + selected + intro, 'data-card-id="' + card.id + '" style="--bd-i:' + index + '"');
  }

  function renderCard(card, extraClass, attrs) {
    var red = card.suit === 'D' || card.suit === 'H';
    return '<button class="bd-card ' + (red ? 'red ' : '') + (extraClass || '') + '" ' + (attrs || '') + '>' +
      '<span class="bd-card-corner">' + escapeHtml(card.rank) + '</span>' +
      '<span class="bd-card-suit">' + SUIT_SYMBOLS[card.suit] + '</span>' +
      '<span class="bd-card-mini">' + SUIT_SYMBOLS[card.suit] + '</span>' +
    '</button>';
  }

  function renderTableCard(card, index, playerName, animatePlay) {
    var seed = seededRandom(playerName + '-' + card.id + '-' + index);
    var rotate = Math.round(seed * 24 - 12);
    var x = Math.round(seededRandom(card.id + '-x-' + index) * 20 - 10);
    var y = Math.round(seededRandom(card.id + '-y-' + playerName) * 14 - 7);
    return renderCard(card, 'bd-table-card' + (animatePlay ? ' bd-animate-play' : ''), 'style="--bd-rot:' + rotate + 'deg;--bd-x:' + x + 'px;--bd-y:' + y + 'px;--bd-z:' + (index + 1) + '"');
  }

  function renderMiniPileCard(card, index, playerName) {
    var red = card.suit === 'D' || card.suit === 'H';
    var seed = seededRandom('pile-' + playerName + '-' + card.id + '-' + index);
    var rotate = Math.round(seed * 28 - 14);
    var x = Math.round(seededRandom(card.id + '-pile-x-' + index) * 14 - 7);
    var y = Math.round(seededRandom(card.id + '-pile-y-' + playerName) * 10 - 5);
    return '<span class="bd-mini-card ' + (red ? 'red' : '') + '" style="--mini-rot:' + rotate + 'deg;--mini-x:' + x + 'px;--mini-y:' + y + 'px;--mini-z:' + (index + 1) + '">' +
      '<b>' + escapeHtml(card.rank) + '</b><em>' + SUIT_SYMBOLS[card.suit] + '</em></span>';
  }

  function seededRandom(seed) {
    var value = 0;
    seed = String(seed || '');
    for (var i = 0; i < seed.length; i++) {
      value = (value * 31 + seed.charCodeAt(i)) >>> 0;
    }
    value = (value ^ (value << 13)) >>> 0;
    value = (value ^ (value >>> 17)) >>> 0;
    value = (value ^ (value << 5)) >>> 0;
    return (value >>> 0) / 4294967295;
  }

  function openingRuleText() {
    if (firstPlay && firstPlayRequiresDiamondThree) return '開局規則：3♦ 先手';
    if (firstPlay) return '開局規則：上局勝出者先手';
    return '上一手';
  }

  function bindHand() {
    Array.prototype.forEach.call(container.querySelectorAll('[data-card-id]'), function(button) {
      button.addEventListener('click', function() { toggleCard(button.getAttribute('data-card-id')); });
    });
  }

  function bindControls() {
    var playBtn = container.querySelector('#bd-play-btn');
    var passBtn = container.querySelector('#bd-pass-btn');
    var suggestBtn = container.querySelector('#bd-suggest-btn');
    var infoBtn = container.querySelector('#bd-info-btn');
    var closeInfoBtn = container.querySelector('#bd-info-close');
    if (playBtn) playBtn.addEventListener('click', submitHumanPlay);
    if (passBtn) passBtn.addEventListener('click', humanPass);
    if (suggestBtn) suggestBtn.addEventListener('click', suggestPlay);
    if (infoBtn) infoBtn.addEventListener('click', function() { infoOpen = !infoOpen; render(); });
    if (closeInfoBtn) closeInfoBtn.addEventListener('click', function() { infoOpen = false; render(); });
  }

  function renderInfoDrawer() {
    return '<aside class="bd-info-drawer' + (infoOpen ? ' open' : '') + '">' +
      '<div class="bd-info-head"><strong>牌局資訊</strong><button class="bd-icon-btn" id="bd-info-close" aria-label="關閉資訊"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>' +
      '<div class="bd-info-body">' +
        '<section class="bd-info-section"><h3>玩家</h3>' + players.map(function(player) {
          return '<div class="bd-info-row"><span>' + escapeHtml(player.name) + '</span><strong>' + player.hand.length + ' 張' + (player.ai ? ' · AI' : '') + '</strong></div>';
        }).join('') + '</section>' +
        '<section class="bd-info-section"><h3>紀錄</h3>' + history.slice().reverse().map(function(row) {
          return '<div class="bd-info-row"><span>' + escapeHtml(row.player) + '</span><span>' + escapeHtml(row.text) + '</span></div>';
        }).join('') + '</section>' +
        '<section class="bd-info-section"><h3>頂大</h3>' + (topDaRecords.length ? topDaRecords.map(function(record) {
          return '<div>' + escapeHtml(record.offenderName + ' 未頂大：應出 ' + record.expected + '，實際 ' + record.actual) + '</div>';
        }).join('') : '<div>未有紀錄</div>') + '</section>' +
      '</div></aside>';
  }

  function renderResult() {
    var winner = players[placements[0]];
    var scoring = calculateScores(placements[0]);
    var actions = (isRoomMode() ? '' : '<button class="bd-action-btn" id="bd-new-game">再來一局</button>') +
      '<button class="bd-action-btn secondary" id="bd-back-lobby"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回大廳</span></button>';
    container.innerHTML =
      '<div class="bd-shell">' + App.Common.renderResultDialog({
        eyebrow: '鋤大DEE 結算',
        title: winner.name + ' 勝出',
        subtitle: topDaRecords.length ? '頂大紀錄 ' + topDaRecords.length + ' 宗，已計入分數' : '未有頂大罰分',
        rows: placements.map(function(playerIndex, index) {
          var player = players[playerIndex];
          return {
            rank: '#' + (index + 1),
            name: player.name,
            person: player,
            primary: '剩 ' + player.hand.length + ' 張',
            secondary: formatScore(scoring[playerIndex])
          };
        }),
        history: history.slice().reverse().map(function(row) {
          return { label: row.player, text: row.text };
        }),
        actionsHtml: actions
      }) + '</div>';
    var newGameBtn = container.querySelector('#bd-new-game');
    if (newGameBtn) newGameBtn.addEventListener('click', function() {
      setupGame();
      render();
      scheduleAI();
    });
    container.querySelector('#bd-back-lobby').addEventListener('click', function() {
      if (isRoomMode() && App.Lobby && App.Lobby.handleGameCloseAction) App.Lobby.handleGameCloseAction();
      else App.GameManager.endGame();
    });
  }

  function calculateScores(winnerIndex) {
    var scores = players.map(function(player, index) {
      var left = player.hand.length;
      var multiplier = scoreMultiplier(left);
      var baseLoss = index === winnerIndex ? 0 : left * multiplier * BASE_STAKE;
      return { delta: -baseLoss, baseLoss: baseLoss, penalty: 0, label: scoreLabel(left), left: left };
    });
    topDaRecords.forEach(function(record) {
      var offender = scores[record.offenderIndex];
      if (!offender || record.offenderIndex === winnerIndex) return;
      var extra = scores.reduce(function(sum, item, index) {
        return index !== winnerIndex && index !== record.offenderIndex ? sum + item.baseLoss : sum;
      }, 0);
      offender.penalty += extra;
      offender.delta -= extra;
    });
    var winnerGain = scores.reduce(function(sum, item, index) {
      return index === winnerIndex ? sum : sum - item.delta;
    }, 0);
    scores[winnerIndex].delta = winnerGain;
    return scores;
  }

  function scoreMultiplier(left) {
    if (left >= 13) return 4;
    if (left >= 10) return 3;
    if (left >= 8) return 2;
    return 1;
  }

  function scoreLabel(left) {
    if (left >= 13) return '四炒';
    if (left >= 10) return '三炒';
    if (left >= 8) return '雙炒';
    return '';
  }

  function formatScore(item) {
    var sign = item.delta > 0 ? '+' : '';
    var label = item.label ? ' · ' + item.label : '';
    var penalty = item.penalty ? ' · 頂大罰 ' + item.penalty : '';
    return sign + item.delta + ' 分' + label + penalty;
  }

  function renderTopDaSummary() {
    if (!topDaRecords.length) return '<p class="bd-score-note">沒有頂大罰分紀錄</p>';
    return '<div class="bd-score-note">' + topDaRecords.map(function(record) {
      return escapeHtml(record.offenderName + ' 未頂大：應出 ' + record.expected + '，實際 ' + record.actual);
    }).join('<br>') + '</div>';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function handleRoomSnapshot(gameState) {
    var expectedRoundId = opts.roundId || (opts.gameState && opts.gameState.roundId) || '';
    if (!isRoomMode() || !gameState || !gameState.state) return;
    if (expectedRoundId && gameState.roundId && gameState.roundId !== expectedRoundId) return;
    applyState(gameState.state);
    selectedIds = {};
    if (gameOver) renderResult();
    else {
      render();
      scheduleAI();
    }
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !msg || (!opts.isHost && !msg.localEcho) || (opts.isHost && msg.localEcho)) return;
    var index = players.findIndex(function(player) { return player.id === msg.playerId; });
    if (index < 0 || index !== currentPlayer || players[index].ai) return;
    if (msg.type === 'bd_pass') {
      passTurn(index);
      return;
    }
    if (msg.type === 'bd_play') {
      var ids = {};
      (msg.cardIds || []).forEach(function(id) { ids[id] = true; });
      var cards = players[index].hand.filter(function(card) { return ids[card.id]; });
      playCards(index, cards);
    }
  }

  App.GameManager.register({
    id: 'bigDee',
    name: '鋤大DEE',
    icon: '♠',
    description: '四人局，可真人加 AI 補位',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 4,
    allowSpectators: true,
    aiFill: true,
    multiplayerModes: ['room'],
    buildRoomStart: function(roomOpts) {
      return { state: buildInitialState(roomOpts.players || []) };
    },
    getStateSnapshot: function() {
      return serializeState();
    },
    init: function(gameContainer, gameOpts) {
      container = gameContainer;
      opts = gameOpts || {};
      setupGame();
      render();
      if (isRoomMode() && opts.isHost && !(opts.gameState && opts.gameState.roundId === opts.roundId)) publishState();
      if (opts.gameState) handleRoomSnapshot(opts.gameState);
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
        handleRoomSnapshot(msg.gameState);
        syncPlayerPresence(opts.players);
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
    handleShortcut: function(action) {
      if (action === 'suggest') {
        if (!canControlCurrent()) return false;
        suggestPlay();
        return true;
      }
      if (action === 'pass') {
        if (!canControlCurrent() || !lastPlay) return false;
        humanPass();
        return true;
      }
      if (action === 'primary') {
        if (!canControlCurrent()) return false;
        var selected = getSelectedCards();
        if (selected.length && canPlay(selected).ok) {
          submitHumanPlay();
          return true;
        }
        return false;
      }
      if (action === 'cancel') return clearSelection();
      return false;
    },
    destroy: function() {
      aiTimer = clearTimer(aiTimer);
      container = null;
      opts = null;
    }
  });
})();
