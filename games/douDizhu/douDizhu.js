(function() {
  var RANKS = ['3','4','5','6','7','8','9','10','J','Q','K','A','2','SJ','BJ'];
  var SUITS = ['D','C','H','S'];
  var SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠', J: '★' };
  var TYPE_NAMES = {
    single: '單張',
    pair: '一對',
    triple: '三張',
    triple_single: '三帶一',
    triple_pair: '三帶一對',
    straight: '順子',
    pair_chain: '連對',
    triple_chain: '飛機',
    airplane_single: '飛機帶單',
    airplane_pair: '飛機帶對',
    bomb: '炸彈',
    rocket: '火箭',
    four_two_single: '四帶二',
    four_two_pair: '四帶兩對'
  };

  var container = null;
  var opts = null;
  var players = [];
  var bottomCards = [];
  var landlordIndex = -1;
  var currentPlayer = 0;
  var phase = 'bid';
  var selectedIds = {};
  var currentBid = 0;
  var currentBidder = -1;
  var bidStarter = 0;
  var bidTurns = 0;
  var passCount = 0;
  var lastPlay = null;
  var history = [];
  var bombCount = 0;
  var gameOver = false;
  var aiTimer = null;
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
  function cardValue(card) { return rankValue(card.rank); }
  function byCard(a, b) {
    var diff = cardValue(a) - cardValue(b);
    if (diff !== 0) return diff;
    return (SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
  }
  function cloneCards(cards) { return cards.map(function(card) { return Object.assign({}, card); }); }

  function makeDeck() {
    var deck = [];
    SUITS.forEach(function(suit) {
      RANKS.slice(0, 13).forEach(function(rank) {
        deck.push({ id: rank + suit, rank: rank, suit: suit });
      });
    });
    deck.push({ id: 'SJ', rank: 'SJ', suit: 'J' });
    deck.push({ id: 'BJ', rank: 'BJ', suit: 'J' });
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
      { id: 'ai-2', name: 'AI 2', isAI: true }
    ];
  }

  function makePlayersFromSeats(seats) {
    return seats.slice(0, 3).map(function(seat, index) {
      var isAI = !!seat.isAI || /^ai-/.test(seat.id || '');
      return {
        id: seat.id || (isAI ? 'ai-' + (index + 1) : 'human'),
        name: seat.name || (isAI ? 'AI ' + (index + 1) : '玩家'),
        playerColor: seat.playerColor || '',
        playerIcon: seat.playerIcon || '',
        ai: isAI,
        hand: [],
        role: 'farmer',
        passed: false,
        lastBid: null
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
    bottomCards = deck.slice(51);
    deck.slice(0, 51).forEach(function(card, index) {
      players[index % 3].hand.push(card);
    });
    players.forEach(sortHand);
    bidStarter = Math.floor(Math.random() * 3);
    currentPlayer = bidStarter;
    currentBid = 0;
    currentBidder = -1;
    bidTurns = 0;
    passCount = 0;
    landlordIndex = -1;
    lastPlay = null;
    history = [{ player: '系統', text: players[bidStarter].name + ' 先叫牌' }];
    selectedIds = {};
    bombCount = 0;
    gameOver = false;
    phase = 'bid';
    playedPiles = [];
    handIntroDone = false;
    lastAnimatedPlayKey = '';
    resultSaved = false;
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
          role: player.role,
          passed: !!player.passed,
          lastBid: player.lastBid
        };
      }),
      bottomCards: cloneCards(bottomCards),
      landlordIndex: landlordIndex,
      currentPlayer: currentPlayer,
      phase: phase,
      selectedIds: {},
      currentBid: currentBid,
      currentBidder: currentBidder,
      bidStarter: bidStarter,
      bidTurns: bidTurns,
      passCount: passCount,
      lastPlay: lastPlay ? {
        playerIndex: lastPlay.playerIndex,
        playerName: lastPlay.playerName,
        cards: cloneCards(lastPlay.cards),
        combo: lastPlay.combo
      } : null,
      history: history.slice(),
      bombCount: bombCount,
      gameOver: !!gameOver,
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
        role: player.role || 'farmer',
        passed: !!player.passed,
        lastBid: player.lastBid || null
      };
    });
    bottomCards = cloneCards(state.bottomCards || []);
    landlordIndex = state.landlordIndex === undefined ? -1 : state.landlordIndex;
    currentPlayer = state.currentPlayer || 0;
    phase = state.phase || 'bid';
    currentBid = state.currentBid || 0;
    currentBidder = state.currentBidder === undefined ? -1 : state.currentBidder;
    bidStarter = state.bidStarter || 0;
    bidTurns = state.bidTurns || 0;
    passCount = state.passCount || 0;
    lastPlay = state.lastPlay ? {
      playerIndex: state.lastPlay.playerIndex,
      playerName: state.lastPlay.playerName,
      cards: cloneCards(state.lastPlay.cards || []).sort(byCard),
      combo: state.lastPlay.combo
    } : null;
    history = (state.history || []).slice();
    bombCount = state.bombCount || 0;
    gameOver = !!state.gameOver;
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
      gameId: 'douDizhu',
      mode: opts.mode,
      roundId: opts.roundId || '',
      state: serializeState()
    }).catch(function(e) {
      App.Common.showToast('同步牌局失敗：' + e.message, 'error');
    });
  }

  function commitTable() {
    publishState();
    render();
    notifyTurn();
    scheduleAI();
  }

  function notifyTurn() {
    if (!container || gameOver || isSpectator()) return;
    if (App.Lobby && App.Lobby.setTitle) {
      App.Lobby.setTitle(canControlCurrent() ? '輪到你 - 鬥地主' : players[currentPlayer].name + (phase === 'bid' ? ' 叫牌中' : ' 思考中') + ' - 鬥地主');
    }
    var key = phase + ':' + currentPlayer + ':' + (lastPlay ? lastPlay.playerIndex : 'free') + ':' + players[currentPlayer].hand.length;
    if (canControlCurrent() && lastTurnNotice !== key) {
      lastTurnNotice = key;
      App.Common.showToast(phase === 'bid' ? '輪到你叫牌' : '輪到你出牌', 'success');
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
      var shouldAI = remote.online === false;
      if (!!player.ai !== shouldAI) {
        player.ai = shouldAI;
        changed = true;
        recordHistory('系統', player.name + (shouldAI ? ' 斷線，AI 接管' : ' 已重連，恢復真人操作'));
        App.Common.showToast(player.name + (shouldAI ? ' 斷線，AI 接管中' : ' 已重連'), shouldAI ? '' : 'success');
      }
      player.online = remote.online !== false;
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

  function sortHand(player) {
    player.hand.sort(byCard);
  }

  function groupByRank(cards) {
    return cards.reduce(function(map, card) {
      if (!map[card.rank]) map[card.rank] = [];
      map[card.rank].push(card);
      return map;
    }, {});
  }

  function rankCounts(cards) {
    var groups = groupByRank(cards);
    return Object.keys(groups).map(function(rank) {
      return { rank: rank, count: groups[rank].length, cards: groups[rank] };
    }).sort(function(a, b) { return rankValue(a.rank) - rankValue(b.rank); });
  }

  function isNormalChainRank(rank) {
    return rankValue(rank) >= rankValue('3') && rankValue(rank) <= rankValue('A');
  }

  function consecutiveRanks(ranks) {
    if (!ranks.length) return false;
    var values = ranks.map(rankValue).sort(function(a, b) { return a - b; });
    for (var i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) return false;
    }
    return true;
  }

  function analyze(cards) {
    cards = cards.slice().sort(byCard);
    var len = cards.length;
    if (!len) return { valid: false, reason: '請選擇牌' };
    var counts = rankCounts(cards);
    var countPattern = counts.map(function(item) { return item.count; }).sort(function(a, b) { return b - a; }).join(',');

    if (len === 2 && hasRank(cards, 'SJ') && hasRank(cards, 'BJ')) {
      return combo('rocket', len, 99, cards);
    }
    if (len === 1) return combo('single', len, rankValue(cards[0].rank), cards);
    if (len === 2 && counts.length === 1 && !isJokerRank(counts[0].rank)) return combo('pair', len, rankValue(counts[0].rank), cards);
    if (len === 3 && counts.length === 1) return combo('triple', len, rankValue(counts[0].rank), cards);
    if (len === 4 && counts.length === 1) return combo('bomb', len, rankValue(counts[0].rank), cards);

    if (len === 4 && countPattern === '3,1') {
      return combo('triple_single', len, triplePrimary(counts), cards);
    }
    if (len === 5 && countPattern === '3,2') {
      return combo('triple_pair', len, triplePrimary(counts), cards);
    }
    if (len >= 5 && counts.every(function(item) { return item.count === 1 && isNormalChainRank(item.rank); }) && consecutiveRanks(counts.map(function(item) { return item.rank; }))) {
      return combo('straight', len, rankValue(counts[counts.length - 1].rank), cards, { chain: counts.length });
    }
    if (len >= 6 && len % 2 === 0 && counts.every(function(item) { return item.count === 2 && isNormalChainRank(item.rank); }) && counts.length >= 3 && consecutiveRanks(counts.map(function(item) { return item.rank; }))) {
      return combo('pair_chain', len, rankValue(counts[counts.length - 1].rank), cards, { chain: counts.length });
    }
    if (len >= 6 && len % 3 === 0 && counts.every(function(item) { return item.count === 3 && isNormalChainRank(item.rank); }) && counts.length >= 2 && consecutiveRanks(counts.map(function(item) { return item.rank; }))) {
      return combo('triple_chain', len, rankValue(counts[counts.length - 1].rank), cards, { chain: counts.length });
    }

    var triples = counts.filter(function(item) { return item.count === 3 && isNormalChainRank(item.rank); });
    var tripleRanks = triples.map(function(item) { return item.rank; });
    if (triples.length >= 2 && consecutiveRanks(tripleRanks)) {
      if (len === triples.length * 4 && counts.filter(function(item) { return item.count !== 3; }).reduce(function(sum, item) { return sum + item.count; }, 0) === triples.length) {
        return combo('airplane_single', len, rankValue(triples[triples.length - 1].rank), cards, { chain: triples.length });
      }
      if (len === triples.length * 5 && counts.filter(function(item) { return item.count === 2; }).length === triples.length) {
        return combo('airplane_pair', len, rankValue(triples[triples.length - 1].rank), cards, { chain: triples.length });
      }
    }

    if (len === 6 && countPattern === '4,1,1') {
      return combo('four_two_single', len, fourPrimary(counts), cards);
    }
    if (len === 8 && countPattern === '4,2,2') {
      return combo('four_two_pair', len, fourPrimary(counts), cards);
    }

    return { valid: false, reason: '不是合法鬥地主牌型' };
  }

  function combo(type, count, primary, cards, extra) {
    return Object.assign({ valid: true, type: type, count: count, primary: primary, cards: cards }, extra || {});
  }
  function hasRank(cards, rank) { return cards.some(function(card) { return card.rank === rank; }); }
  function isJokerRank(rank) { return rank === 'SJ' || rank === 'BJ'; }
  function triplePrimary(counts) { return rankValue(counts.filter(function(item) { return item.count === 3; })[0].rank); }
  function fourPrimary(counts) { return rankValue(counts.filter(function(item) { return item.count === 4; })[0].rank); }

  function compareCombos(a, b) {
    if (!a || !a.valid) return -1;
    if (!b) return 1;
    if (a.type === 'rocket') return b.type === 'rocket' ? 0 : 1;
    if (b.type === 'rocket') return -1;
    if (a.type === 'bomb' && b.type !== 'bomb') return 1;
    if (b.type === 'bomb' && a.type !== 'bomb') return -1;
    if (a.type !== b.type || a.count !== b.count || (a.chain || 0) !== (b.chain || 0)) return -1;
    return a.primary - b.primary;
  }

  function canPlay(cards) {
    var combo = analyze(cards);
    if (!combo.valid) return { ok: false, combo: combo, reason: combo.reason };
    if (lastPlay && compareCombos(combo, lastPlay.combo) <= 0) {
      return { ok: false, combo: combo, reason: '需要壓過上一手' };
    }
    return { ok: true, combo: combo, reason: TYPE_NAMES[combo.type] };
  }

  function evaluateBid(player) {
    var score = 0;
    var groups = groupByRank(player.hand);
    score += (groups.BJ ? 7 : 0) + (groups.SJ ? 5 : 0);
    ['2','A','K'].forEach(function(rank) { score += (groups[rank] || []).length * (rank === '2' ? 3 : 1.5); });
    Object.keys(groups).forEach(function(rank) {
      if (groups[rank].length === 4) score += 7;
      if (groups[rank].length === 3) score += 2.2;
    });
    return score;
  }

  function aiBidValue(player) {
    var score = evaluateBid(player);
    var desired = score >= 20 ? 3 : score >= 15 ? 2 : score >= 10 ? 1 : 0;
    return desired > currentBid ? desired : 0;
  }

  function placeBid(value) {
    if (phase !== 'bid' || gameOver) return;
    players[currentPlayer].lastBid = value || 'pass';
    if (value > currentBid) {
      currentBid = value;
      currentBidder = currentPlayer;
      passCount = 0;
      recordHistory(players[currentPlayer].name, '叫 ' + value + ' 分');
    } else {
      passCount++;
      recordHistory(players[currentPlayer].name, '不叫');
    }
    bidTurns++;
    if (currentBid === 3 || (currentBidder !== -1 && passCount >= 2) || (currentBidder === -1 && bidTurns >= 3)) {
      finishBidding();
      return;
    }
    currentPlayer = (currentPlayer + 1) % 3;
    commitTable();
  }

  function finishBidding() {
    if (currentBidder === -1) {
      recordHistory('系統', '無人叫牌，重新發牌');
      setupFreshGame(opts && opts.players && opts.players.length ? opts.players : defaultSeats());
      commitTable();
      return;
    }
    landlordIndex = currentBidder;
    players.forEach(function(player, index) { player.role = index === landlordIndex ? 'landlord' : 'farmer'; });
    players[landlordIndex].hand = players[landlordIndex].hand.concat(cloneCards(bottomCards));
    sortHand(players[landlordIndex]);
    currentPlayer = landlordIndex;
    passCount = 0;
    lastPlay = null;
    selectedIds = {};
    phase = 'play';
    recordHistory('系統', players[landlordIndex].name + ' 成為地主，底分 ' + currentBid);
    commitTable();
  }

  function removeCards(player, cards) {
    var ids = {};
    cards.forEach(function(card) { ids[card.id] = true; });
    player.hand = player.hand.filter(function(card) { return !ids[card.id]; });
  }

  function playCards(index, cards) {
    var check = canPlay(cards);
    if (!check.ok) return false;
    var player = players[index];
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
    if (check.combo.type === 'bomb' || check.combo.type === 'rocket') bombCount++;
    passCount = 0;
    players.forEach(function(p) { p.passed = false; });
    selectedIds = {};
    recordHistory(player.name, '出了 ' + TYPE_NAMES[check.combo.type] + '（' + cardsToText(cards) + '）');
    if (player.hand.length === 0) {
      finishGame(index);
      return true;
    }
    currentPlayer = (index + 1) % 3;
    commitTable();
    return true;
  }

  function passTurn(index) {
    if (!lastPlay || index !== currentPlayer) return;
    players[index].passed = true;
    passCount++;
    recordHistory(players[index].name, 'Pass');
    if (passCount >= 2) {
      currentPlayer = lastPlay.playerIndex;
      recordHistory('系統', players[currentPlayer].name + ' 重新領出');
      lastPlay = null;
      passCount = 0;
      players.forEach(function(p) { p.passed = false; });
    } else {
      currentPlayer = (index + 1) % 3;
    }
    commitTable();
  }

  function finishGame(winnerIndex) {
    gameOver = true;
    aiTimer = clearTimer(aiTimer);
    publishState();
    var landlordWon = winnerIndex === landlordIndex;
    appendRoomHistory(winnerIndex, landlordWon, false);
    renderResult(landlordWon, winnerIndex);
  }

  function appendRoomHistory(winnerIndex, landlordWon, interrupted) {
    if (!isRoomMode() || !opts.isHost || !App.Signaling || !App.Signaling.appendHistory) return;
    if (resultSaved) return;
    resultSaved = true;
    var multiplier = Math.pow(2, bombCount);
    var score = currentBid * multiplier;
    App.Signaling.appendHistory({
      gameId: 'douDizhu',
      gameName: '鬥地主',
      mode: opts.mode || 'room',
      roundId: opts.roundId || '',
      status: interrupted ? 'interrupted' : 'completed',
      winnerId: players[winnerIndex] && players[winnerIndex].id,
      winnerName: players[winnerIndex] && players[winnerIndex].name,
      landlordWon: !!landlordWon,
      bid: currentBid,
      bombCount: bombCount,
      multiplier: multiplier,
      players: players.map(function(player, index) {
        return {
          id: player.id,
          name: player.name,
          playerColor: player.playerColor || '',
          playerIcon: player.playerIcon || '',
          role: player.role,
          ai: !!player.ai,
          left: player.hand.length,
          score: scoreDelta(index, landlordWon, score)
        };
      }),
      history: history.slice()
    }).catch(function() {});
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(players.map(function(player, index) {
        return {
          id: player.id,
          name: player.name,
          playerColor: player.playerColor || '',
          playerIcon: player.playerIcon || '',
          score: scoreDelta(index, landlordWon, score),
          win: index === winnerIndex
        };
      })).catch(function() {});
    }
  }

  function getSelectedCards() {
    var index = selfPlayerIndex();
    if (index < 0 || !players[index]) return [];
    return players[index].hand.filter(function(card) { return selectedIds[card.id]; });
  }

  function toggleCard(id) {
    if (phase !== 'play' || !canControlCurrent()) return;
    if (selectedIds[id]) delete selectedIds[id];
    else selectedIds[id] = true;
    render();
  }

  function humanPlay() {
    if (phase !== 'play' || !canControlCurrent()) return;
    var index = selfPlayerIndex();
    var cards = getSelectedCards();
    if (isRoomMode() && !opts.isHost) {
      sendRoomAction({ type: 'ddz_play', playerId: opts.selfId, cardIds: cards.map(function(card) { return card.id; }) });
      selectedIds = {};
      render();
      return;
    }
    playCards(index, cards);
  }

  function humanPass() {
    if (phase !== 'play' || !canControlCurrent() || !lastPlay) return;
    var index = selfPlayerIndex();
    selectedIds = {};
    if (isRoomMode() && !opts.isHost) {
      sendRoomAction({ type: 'ddz_pass', playerId: opts.selfId });
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
      if (phase === 'bid') placeBid(aiBidValue(players[currentPlayer]));
      else aiPlay(currentPlayer);
    }, 720);
  }

  function humanBid(value) {
    if (phase !== 'bid' || !canControlCurrent()) return;
    if (isRoomMode() && !opts.isHost) {
      sendRoomAction({ type: 'ddz_bid', playerId: opts.selfId, bid: value });
      return;
    }
    placeBid(value);
  }

  function sendRoomAction(action) {
    if (!App.Lobby || typeof App.Lobby.sendRoomGameAction !== 'function') return false;
    return App.Lobby.sendRoomGameAction(action);
  }

  function aiPlay(index) {
    var candidates = legalCandidates(players[index].hand);
    if (!candidates.length) {
      passTurn(index);
      return;
    }
    var chosen = chooseSmartPlay(index, candidates);
    if (chosen) playCards(index, chosen.cards);
    else passTurn(index);
  }

  function suggestPlay() {
    if (phase !== 'play' || !canControlCurrent()) return;
    var index = selfPlayerIndex();
    var candidates = legalCandidates(players[index].hand);
    selectedIds = {};
    if (!candidates.length) {
      App.Common.showToast(lastPlay ? '沒有可出的組合，建議 Pass' : '請選擇可出的牌', 'error');
      render();
      return;
    }
    var chosen = chooseSmartPlay(index, candidates) || candidates[0];
    chosen.cards.forEach(function(card) { selectedIds[card.id] = true; });
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
    return enumerateCombos(hand).filter(function(item) {
      return canPlay(item.cards).ok;
    }).sort(candidateSort);
  }

  function chooseSmartPlay(index, candidates) {
    var player = players[index];
    var isLandlord = player.role === 'landlord';
    var lastPlayer = lastPlay ? players[lastPlay.playerIndex] : null;
    var teammateLed = lastPlayer && player.role === 'farmer' && lastPlayer.role === 'farmer';
    var landlord = players[landlordIndex];
    if (teammateLed && players[lastPlay.playerIndex].hand.length <= player.hand.length && !canFinishWith(candidates)) {
      return null;
    }
    if (canFinishWith(candidates)) return canFinishWith(candidates);
    if (landlord && landlord.hand.length <= 2 && player.role === 'farmer') {
      return strongestCandidate(candidates);
    }
    if (isLandlord && players.some(function(p) { return p.role === 'farmer' && p.hand.length <= 2; })) {
      return strongestCandidate(candidates);
    }
    return candidates.slice().sort(function(a, b) {
      return scoreCandidate(index, b) - scoreCandidate(index, a) || candidateSort(a, b);
    })[0] || candidates[0];
  }

  function scoreCandidate(index, candidate) {
    var combo = candidate.combo;
    var player = players[index];
    var score = 0;
    if (candidate.cards.length === player.hand.length) return 10000;
    if (!lastPlay) {
      score += candidate.cards.length * 90;
      if (combo.type === 'airplane_pair' || combo.type === 'airplane_single') score += 180;
      if (combo.type === 'triple_chain') score += 160;
      if (combo.type === 'pair_chain') score += 120;
      if (combo.type === 'straight') score += 110;
      if (combo.type === 'triple_pair') score += 95;
      if (combo.type === 'triple_single') score += 85;
      if (combo.type === 'triple') score += 70;
      if (combo.type === 'pair') score += 35;
      if (combo.type === 'single') score -= 24;
      if (combo.type === 'bomb') score -= 180;
      if (combo.type === 'rocket') score -= 240;
      score -= combo.primary * 1.5;
      return score;
    }
    score += combo.type === 'bomb' || combo.type === 'rocket' ? -260 : 80;
    score -= combo.primary * 3;
    score -= candidate.cards.length;
    if (lastPlay && players[lastPlay.playerIndex] && players[lastPlay.playerIndex].role !== player.role) {
      score += players[lastPlay.playerIndex].hand.length <= 2 ? 260 : 0;
    }
    return score;
  }

  function canFinishWith(candidates) {
    return candidates.filter(function(item) {
      return item.cards.length === players[currentPlayer].hand.length;
    }).sort(candidateSort)[0] || null;
  }

  function candidateSort(a, b) {
    if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
    if (a.combo.type === 'bomb' && b.combo.type !== 'bomb') return 1;
    if (a.combo.type !== 'bomb' && b.combo.type === 'bomb') return -1;
    if (a.combo.type === 'rocket') return 1;
    if (b.combo.type === 'rocket') return -1;
    return a.combo.primary - b.combo.primary;
  }

  function strongestCandidate(candidates) {
    return candidates.slice().sort(function(a, b) {
      if (a.combo.type === 'rocket') return -1;
      if (b.combo.type === 'rocket') return 1;
      if (a.combo.type === 'bomb' && b.combo.type !== 'bomb') return -1;
      if (a.combo.type !== 'bomb' && b.combo.type === 'bomb') return 1;
      return b.combo.primary - a.combo.primary;
    })[0];
  }

  function enumerateCombos(hand) {
    var sorted = hand.slice().sort(byCard);
    var groups = groupByRank(sorted);
    var combos = [];
    function add(cards) {
      var combo = analyze(cards);
      if (combo.valid) combos.push({ cards: cards.slice().sort(byCard), combo: combo });
    }

    sorted.forEach(function(card) { add([card]); });
    Object.keys(groups).forEach(function(rank) {
      var cards = groups[rank].sort(byCard);
      if (cards.length >= 2 && !isJokerRank(rank)) add(cards.slice(0, 2));
      if (cards.length >= 3) add(cards.slice(0, 3));
      if (cards.length === 4) add(cards.slice(0, 4));
    });
    if (groups.SJ && groups.BJ) add([groups.SJ[0], groups.BJ[0]]);

    var tripleRanks = Object.keys(groups).filter(function(rank) { return groups[rank].length >= 3 && !isJokerRank(rank); }).sort(rankSort);
    var pairRanks = Object.keys(groups).filter(function(rank) { return groups[rank].length >= 2 && !isJokerRank(rank); }).sort(rankSort);
    var quadRanks = Object.keys(groups).filter(function(rank) { return groups[rank].length === 4; }).sort(rankSort);

    tripleRanks.forEach(function(tripleRank) {
      var triple = groups[tripleRank].slice(0, 3);
      sorted.forEach(function(card) {
        if (card.rank !== tripleRank) add(triple.concat([card]));
      });
      pairRanks.forEach(function(pairRank) {
        if (pairRank !== tripleRank) add(triple.concat(groups[pairRank].slice(0, 2)));
      });
    });

    quadRanks.forEach(function(quadRank) {
      var quad = groups[quadRank].slice(0, 4);
      var rest = sorted.filter(function(card) { return card.rank !== quadRank; });
      combinations(rest, 2).forEach(function(wings) { add(quad.concat(wings)); });
      combinations(pairRanks.filter(function(rank) { return rank !== quadRank; }), 2).forEach(function(pairSet) {
        add(quad.concat(groups[pairSet[0]].slice(0, 2), groups[pairSet[1]].slice(0, 2)));
      });
    });

    buildChains(sorted, groups).forEach(add);
    return dedupeCombos(combos);
  }

  function rankSort(a, b) {
    return rankValue(a) - rankValue(b);
  }

  function buildChains(sorted, groups) {
    var result = [];
    var normalRanks = RANKS.slice(0, 12).filter(function(rank) { return groups[rank]; });
    for (var start = 0; start < normalRanks.length; start++) {
      for (var end = start + 5; end <= normalRanks.length; end++) {
        var ranks = normalRanks.slice(start, end);
        if (ranks.length >= 5 && consecutiveRanks(ranks)) result.push(flatRanks(groups, ranks, 1));
      }
      for (var pairEnd = start + 3; pairEnd <= normalRanks.length; pairEnd++) {
        var pairRanks = normalRanks.slice(start, pairEnd);
        if (pairRanks.length >= 3 && consecutiveRanks(pairRanks) && pairRanks.every(function(rank) { return groups[rank].length >= 2; })) {
          result.push(flatRanks(groups, pairRanks, 2));
        }
      }
      for (var triEnd = start + 2; triEnd <= normalRanks.length; triEnd++) {
        var triRanks = normalRanks.slice(start, triEnd);
        if (triRanks.length >= 2 && consecutiveRanks(triRanks) && triRanks.every(function(rank) { return groups[rank].length >= 3; })) {
          var tripleBody = flatRanks(groups, triRanks, 3);
          result.push(tripleBody);
          var outsideSingles = Object.keys(groups).filter(function(rank) {
            return triRanks.indexOf(rank) === -1;
          }).reduce(function(cards, rank) {
            return cards.concat(groups[rank]);
          }, []);
          combinations(outsideSingles, triRanks.length).forEach(function(wings) {
            result.push(tripleBody.concat(wings));
          });
          var outsidePairs = Object.keys(groups).filter(function(rank) {
            return triRanks.indexOf(rank) === -1 && groups[rank].length >= 2 && !isJokerRank(rank);
          }).sort(rankSort);
          combinations(outsidePairs, triRanks.length).forEach(function(pairRanks) {
            var pairCards = [];
            pairRanks.forEach(function(rank) { pairCards = pairCards.concat(groups[rank].slice(0, 2)); });
            result.push(tripleBody.concat(pairCards));
          });
        }
      }
    }
    return result;
  }

  function flatRanks(groups, ranks, count) {
    var cards = [];
    ranks.forEach(function(rank) {
      cards = cards.concat(groups[rank].slice(0, count));
    });
    return cards;
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
    if (list.length >= size) walk(0, []);
    return result;
  }

  function dedupeCombos(combos) {
    var seen = {};
    return combos.filter(function(item) {
      var key = item.cards.map(function(card) { return card.id; }).sort().join('|');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
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

  function cardsToText(cards) {
    return cards.slice().sort(byCard).map(function(card) {
      return card.rank === 'SJ' ? '小王' : card.rank === 'BJ' ? '大王' : card.rank + SUIT_SYMBOLS[card.suit];
    }).join(' ');
  }

  function clearTimer(timer) {
    if (timer) clearTimeout(timer);
    return null;
  }

  function render() {
    if (!container || gameOver) return;
    var selected = getSelectedCards();
    var check = selected.length ? canPlay(selected) : { ok: false, reason: phase === 'bid' ? '叫牌階段' : lastPlay ? '選擇可壓過上一手的牌' : '可自由出牌' };
    var playKey = currentPlayAnimationKey();
    var animatePlay = !!playKey && playKey !== lastAnimatedPlayKey;
    container.innerHTML =
      '<div class="ddz-shell">' +
        '<div class="ddz-topbar">' +
          '<div class="ddz-title' + (canControlCurrent() ? ' my-turn' : '') + '">' + escapeHtml(titleText()) + '</div>' +
          '<div class="ddz-actions">' +
            (isRoomMode() ? '<button class="ddz-icon-btn game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') +
            '<button class="ddz-icon-btn" id="ddz-info-btn" aria-label="牌局資訊"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>' +
            '<button class="ddz-icon-btn" onclick="App.GameManager.endGame()" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="ddz-board">' + renderSeats() + renderTable(animatePlay) + '</div>' +
        renderHandPanel(check) +
        renderInfoDrawer() +
      '</div>';
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

  function titleText() {
    if (isSpectator()) return players[currentPlayer].name + (phase === 'bid' ? ' 叫牌中（觀戰）' : ' 出牌中（觀戰）');
    if (phase === 'bid') return canControlCurrent() ? '輪到你叫牌' : players[currentPlayer].name + ' 叫牌中...';
    return canControlCurrent() ? (lastPlay ? '輪到你：出牌或 Pass' : '輪到你領出') : players[currentPlayer].name + ' 思考中...';
  }

  function renderSeats() {
    var self = selfPlayerIndex();
    var indexes = players.map(function(_, index) { return index; }).filter(function(index) { return index !== self; });
    var positions = ['left', 'right'];
    return indexes.map(function(index, slot) {
      return slot < 2 ? renderSeat(index, positions[slot]) : '';
    }).join('') + renderTopStatus();
  }

  function renderTopStatus() {
    var text = phase === 'bid'
      ? '叫牌：' + players[currentPlayer].name
      : '地主：' + players[landlordIndex].name;
    var meta = phase === 'bid'
      ? '最高 ' + currentBid + ' 分'
      : '底牌已公開 · ' + currentBid + ' 分';
    return '<div class="ddz-seat top">' +
      '<div class="ddz-name">' + escapeHtml(text) + '</div>' +
      '<div class="ddz-meta">' + escapeHtml(meta) + '</div>' +
    '</div>';
  }

  function renderSeat(index, position) {
    var player = players[index];
    var role = player.role === 'landlord' ? '地主' : '農民';
    var bid = player.lastBid ? ' · ' + (player.lastBid === 'pass' ? '不叫' : player.lastBid + '分') : '';
    var cls = 'ddz-seat ' + position + (currentPlayer === index ? ' active' : '') + (player.passed ? ' pass' : '');
    return '<div class="' + cls + '">' +
      '<div class="ddz-name">' + escapeHtml(player.name) + '</div>' +
      '<div class="ddz-meta"><span class="ddz-role">' + role + '</span> · ' + player.hand.length + ' 張' + bid + '</div>' +
      '<div class="ddz-card-backs">' + renderCardBacks(player.hand.length) + '</div>' +
      '<div class="ddz-seat-badges">' +
        (currentPlayer === index ? '<span class="ddz-seat-badge turn">輪到</span>' : '') +
        (player.passed ? '<span class="ddz-seat-badge">Pass</span>' : '') +
        (player.ai ? '<span class="ddz-seat-badge ai">AI</span>' : '') +
      '</div>' +
    '</div>';
  }

  function renderCardBacks(count) {
    var shown = Math.min(10, count);
    var html = '';
    for (var i = 0; i < shown; i++) html += '<span class="ddz-card-back"></span>';
    return html;
  }

  function renderTable(animatePlay) {
    var last = lastPlay
      ? lastPlay.cards.map(function(card, index) { return renderTableCard(card, index, lastPlay.playerName, animatePlay); }).join('') + '<span class="ddz-pill">' + escapeHtml(lastPlay.playerName) + ' · ' + TYPE_NAMES[lastPlay.combo.type] + '</span>'
      : '<div class="ddz-empty">' + (phase === 'bid' ? '等待叫牌' : '自由出牌') + '</div>';
    return '<div class="ddz-table">' +
      '<div class="ddz-info"><span>底分 ' + currentBid + ' · 倍數 x' + Math.pow(2, bombCount) + '</span><span class="ddz-pill">' + phaseLabel() + '</span></div>' +
      renderDiscardPiles() +
      '<div class="ddz-last-play">' + last + '</div>' +
      '<div class="ddz-bottom-cards"><span class="ddz-bottom-label">底牌</span>' + (phase === 'bid' ? renderBackCards(3) : bottomCards.map(function(card) { return renderCard(card); }).join('')) + '</div>' +
    '</div>';
  }

  function renderDiscardPiles() {
    var piles = playedPiles.slice(0, lastPlay ? -1 : playedPiles.length).slice(-5);
    if (!piles.length) return '<div class="ddz-discard-area empty">已出牌堆</div>';
    return '<div class="ddz-discard-area">' + piles.map(function(pile, pileIndex) {
      var cards = (pile.cards || []).slice(-5);
      return '<div class="ddz-discard-pile" style="--pile-i:' + pileIndex + '">' +
        '<div class="ddz-discard-stack">' + cards.map(function(card, cardIndex) {
          return renderMiniPileCard(card, cardIndex, pile.playerName);
        }).join('') + '</div>' +
        '<span>' + escapeHtml(pile.playerName || '玩家') + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function phaseLabel() {
    return phase === 'bid' ? '叫牌' : landlordIndex >= 0 ? players[landlordIndex].name + ' 是地主' : '出牌';
  }

  function renderHandPanel(check) {
    var self = selfPlayerIndex();
    var hand = self >= 0 && players[self] ? players[self].hand : [];
    var canControl = canControlCurrent();
    var canBid = phase === 'bid' && canControl;
    var canPlayNow = phase === 'play' && canControl && check.ok;
    var canPass = phase === 'play' && canControl && !!lastPlay;
    var canSuggest = phase === 'play' && canControl && legalCandidates(hand).length > 0;
    return '<div class="ddz-hand-panel' + (canControl ? ' active' : '') + '">' +
      '<div class="ddz-hand">' + (isSpectator() ? renderSpectatorHands() : hand.map(renderHandCard).join('')) + '</div>' +
      (phase === 'bid'
        ? '<div class="ddz-bid-panel"><div class="ddz-hint">目前最高 ' + currentBid + ' 分</div>' +
          [0,1,2,3].map(function(value) {
            var label = value === 0 ? '不叫' : value + '分';
            var disabled = !canBid || (value > 0 && value <= currentBid);
            return '<button class="ddz-btn' + (value === 0 ? ' secondary' : '') + '" data-bid="' + value + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
          }).join('') + '</div>'
        : '<div class="ddz-controls"><div class="ddz-hint">' + escapeHtml(check.reason) + '</div>' +
          '<button class="ddz-btn secondary" id="ddz-suggest-btn"' + (canSuggest ? '' : ' disabled') + '><i class="fa-regular fa-lightbulb" aria-hidden="true"></i><span>推薦</span></button>' +
          '<button class="ddz-btn secondary" id="ddz-pass-btn"' + (canPass ? '' : ' disabled') + '><i class="fa-solid fa-forward-step" aria-hidden="true"></i><span>Pass</span></button>' +
          '<button class="ddz-btn" id="ddz-play-btn"' + (canPlayNow ? '' : ' disabled') + '><i class="fa-solid fa-paper-plane" aria-hidden="true"></i><span>出牌</span></button></div>') +
    '</div>';
  }

  function renderSpectatorHands() {
    return '<div class="ddz-spectator-hands">' + players.map(function(player) {
      return '<div><strong>' + escapeHtml(player.name) + '</strong><span>' + escapeHtml(cardsToText(player.hand)) + '</span></div>';
    }).join('') + '</div>';
  }

  function renderHandCard(card, index) {
    var intro = handIntroDone ? '' : ' ddz-hand-intro';
    return renderCard(card, 'ddz-hand-card' + (selectedIds[card.id] ? ' selected' : '') + intro, 'data-card-id="' + card.id + '" style="--ddz-i:' + index + '"');
  }

  function renderBackCards(count) {
    var html = '';
    for (var i = 0; i < count; i++) html += '<button class="ddz-card" disabled><span class="ddz-suit">?</span></button>';
    return html;
  }

  function renderCard(card, extraClass, attrs) {
    var red = card.suit === 'D' || card.suit === 'H';
    var joker = card.suit === 'J';
    var label = card.rank === 'SJ' ? '小王' : card.rank === 'BJ' ? '大王' : card.rank;
    var suit = joker ? '★' : SUIT_SYMBOLS[card.suit];
    return '<button class="ddz-card ' + (red ? 'red ' : '') + (joker ? 'joker ' : '') + (extraClass || '') + '" ' + (attrs || '') + '>' +
      '<span class="ddz-rank">' + label + '</span><span class="ddz-suit">' + suit + '</span><span class="ddz-mini">' + suit + '</span></button>';
  }

  function renderTableCard(card, index, playerName, animatePlay) {
    var seed = seededRandom(playerName + '-' + card.id + '-' + index);
    var rotate = Math.round(seed * 24 - 12);
    var x = Math.round(seededRandom(card.id + '-x-' + index) * 20 - 10);
    var y = Math.round(seededRandom(card.id + '-y-' + playerName) * 14 - 7);
    return renderCard(card, 'ddz-table-card' + (animatePlay ? ' ddz-animate-play' : ''), 'style="--ddz-rot:' + rotate + 'deg;--ddz-x:' + x + 'px;--ddz-y:' + y + 'px;--ddz-z:' + (index + 1) + '"');
  }

  function renderMiniPileCard(card, index, playerName) {
    var red = card.suit === 'D' || card.suit === 'H';
    var joker = card.suit === 'J';
    var label = card.rank === 'SJ' ? '小' : card.rank === 'BJ' ? '大' : card.rank;
    var suit = joker ? '★' : SUIT_SYMBOLS[card.suit];
    var seed = seededRandom('pile-' + playerName + '-' + card.id + '-' + index);
    var rotate = Math.round(seed * 28 - 14);
    var x = Math.round(seededRandom(card.id + '-pile-x-' + index) * 14 - 7);
    var y = Math.round(seededRandom(card.id + '-pile-y-' + playerName) * 10 - 5);
    return '<span class="ddz-mini-card ' + (red ? 'red ' : '') + (joker ? 'joker' : '') + '" style="--mini-rot:' + rotate + 'deg;--mini-x:' + x + 'px;--mini-y:' + y + 'px;--mini-z:' + (index + 1) + '">' +
      '<b>' + escapeHtml(label) + '</b><em>' + suit + '</em></span>';
  }

  function seededRandom(seed) {
    var value = 0;
    seed = String(seed || '');
    for (var i = 0; i < seed.length; i++) value = (value * 31 + seed.charCodeAt(i)) >>> 0;
    value = (value ^ (value << 13)) >>> 0;
    value = (value ^ (value >>> 17)) >>> 0;
    value = (value ^ (value << 5)) >>> 0;
    return (value >>> 0) / 4294967295;
  }

  function bindControls() {
    Array.prototype.forEach.call(container.querySelectorAll('[data-card-id]'), function(button) {
      button.addEventListener('click', function() { toggleCard(button.getAttribute('data-card-id')); });
    });
    Array.prototype.forEach.call(container.querySelectorAll('[data-bid]'), function(button) {
      button.addEventListener('click', function() { humanBid(Number(button.getAttribute('data-bid'))); });
    });
    var playBtn = container.querySelector('#ddz-play-btn');
    var passBtn = container.querySelector('#ddz-pass-btn');
    var suggestBtn = container.querySelector('#ddz-suggest-btn');
    var infoBtn = container.querySelector('#ddz-info-btn');
    var closeInfoBtn = container.querySelector('#ddz-info-close');
    if (playBtn) playBtn.addEventListener('click', humanPlay);
    if (passBtn) passBtn.addEventListener('click', humanPass);
    if (suggestBtn) suggestBtn.addEventListener('click', suggestPlay);
    if (infoBtn) infoBtn.addEventListener('click', function() { infoOpen = !infoOpen; render(); });
    if (closeInfoBtn) closeInfoBtn.addEventListener('click', function() { infoOpen = false; render(); });
  }

  function renderInfoDrawer() {
    return '<aside class="ddz-info-drawer' + (infoOpen ? ' open' : '') + '">' +
      '<div class="ddz-info-head"><strong>牌局資訊</strong><button class="ddz-icon-btn" id="ddz-info-close" aria-label="關閉資訊"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>' +
      '<div class="ddz-info-body">' +
        '<section class="ddz-info-section"><h3>局勢</h3>' +
          '<div class="ddz-info-row"><span>階段</span><strong>' + escapeHtml(phaseLabel()) + '</strong></div>' +
          '<div class="ddz-info-row"><span>底分</span><strong>' + currentBid + '</strong></div>' +
          '<div class="ddz-info-row"><span>炸彈/火箭</span><strong>' + bombCount + ' 次</strong></div>' +
        '</section>' +
        '<section class="ddz-info-section"><h3>玩家</h3>' + players.map(function(player) {
          return '<div class="ddz-info-row"><span>' + escapeHtml(player.name) + '</span><strong>' + escapeHtml(player.role === 'landlord' ? '地主' : '農民') + ' · ' + player.hand.length + ' 張' + (player.ai ? ' · AI' : '') + '</strong></div>';
        }).join('') + '</section>' +
        '<section class="ddz-info-section"><h3>紀錄</h3>' + history.slice().reverse().map(function(row) {
          return '<div class="ddz-info-row"><span>' + escapeHtml(row.player) + '</span><span>' + escapeHtml(row.text) + '</span></div>';
        }).join('') + '</section>' +
      '</div></aside>';
  }

  function renderResult(landlordWon, winnerIndex) {
    var multiplier = Math.pow(2, bombCount);
    var score = currentBid * multiplier;
    var actions = (isRoomMode() ? '' : '<button class="ddz-btn" id="ddz-new-game">再來一局</button>') +
      '<button class="ddz-btn secondary" id="ddz-back"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回大廳</span></button>';
    container.innerHTML =
      '<div class="ddz-shell">' + App.Common.renderResultPanel({
        eyebrow: '鬥地主結算',
        title: landlordWon ? '地主勝出' : '農民勝出',
        subtitle: '底分 ' + currentBid + ' · 炸彈/火箭 ' + bombCount + ' 次 · 倍數 x' + multiplier + ' · 勝出：' + players[winnerIndex].name,
        rows: players.map(function(player, index) {
          var delta = scoreDelta(index, landlordWon, score);
          return {
            rank: player.role === 'landlord' ? '地主' : '農民',
            name: player.name,
            person: player,
            primary: (delta > 0 ? '+' : '') + delta + ' 分',
            secondary: '剩 ' + player.hand.length + ' 張'
          };
        }),
        history: history.slice().reverse().map(function(row) {
          return { label: row.player, text: row.text };
        }),
        actionsHtml: actions
      }) + '</div>';
    var newGameBtn = container.querySelector('#ddz-new-game');
    if (newGameBtn) newGameBtn.addEventListener('click', function() {
      setupGame();
      render();
      scheduleAI();
    });
    container.querySelector('#ddz-back').addEventListener('click', function() { App.GameManager.endGame(); });
  }

  function scoreDelta(index, landlordWon, score) {
    var isLandlord = index === landlordIndex;
    if (isLandlord) return landlordWon ? score * 2 : -score * 2;
    return landlordWon ? -score : score;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function handleRoomSnapshot(gameState) {
    if (!isRoomMode() || !gameState || gameState.roundId !== opts.roundId || !gameState.state) return;
    applyState(gameState.state);
    selectedIds = {};
    if (gameOver) {
      var landlordWon = players.some(function(player, index) {
        return player.hand.length === 0 && index === landlordIndex;
      });
      var winnerIndex = players.findIndex(function(player) { return player.hand.length === 0; });
      renderResult(landlordWon, winnerIndex < 0 ? 0 : winnerIndex);
    } else {
      render();
      scheduleAI();
    }
  }

  function handleRoomAction(msg) {
    if (!isRoomMode() || !opts.isHost || !msg) return;
    var index = players.findIndex(function(player) { return player.id === msg.playerId; });
    if (index < 0 || index !== currentPlayer || players[index].ai) return;
    if (msg.type === 'ddz_bid') {
      placeBid(Number(msg.bid) || 0);
      return;
    }
    if (msg.type === 'ddz_pass') {
      passTurn(index);
      return;
    }
    if (msg.type === 'ddz_play') {
      var ids = {};
      (msg.cardIds || []).forEach(function(id) { ids[id] = true; });
      var cards = players[index].hand.filter(function(card) { return ids[card.id]; });
      playCards(index, cards);
    }
  }

  App.GameManager.register({
    id: 'douDizhu',
    name: '鬥地主',
    icon: '王',
    description: '三人鬥地主，可真人加 AI 補位',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 2,
    maxPlayers: 3,
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
      if (opts.gameState) handleRoomSnapshot(opts.gameState);
      scheduleAI();
    },
    handleMessage: function(msg) {
      if (!msg) return;
      if (msg.type === 'room_update') {
        opts.players = msg.players || opts.players;
        opts.spectators = msg.spectators || opts.spectators;
        opts.role = msg.role || opts.role;
        opts.isHost = !!msg.isHost;
        handleRoomSnapshot(msg.gameState);
        syncPlayerPresence(opts.players);
        return;
      }
      handleRoomAction(msg);
    },
    handleShortcut: function(action) {
      if (action === 'suggest') {
        if (phase !== 'play' || !canControlCurrent()) return false;
        suggestPlay();
        return true;
      }
      if (action === 'pass') {
        if (phase !== 'play' || !canControlCurrent() || !lastPlay) return false;
        humanPass();
        return true;
      }
      if (action === 'primary') {
        if (!canControlCurrent()) return false;
        if (phase === 'play') {
          var selected = getSelectedCards();
          if (selected.length && canPlay(selected).ok) {
            humanPlay();
            return true;
          }
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
