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
    fullhouse: '葫蘆',
    fourkind: '四條',
    straightflush: '同花順'
  };

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

  function setupGame() {
    var deck = makeDeck();
    players = [
      { id: 'human', name: opts.playerName || '你', hand: [], ai: false, passed: false },
      { id: 'ai-1', name: 'AI 1', hand: [], ai: true, passed: false },
      { id: 'ai-2', name: 'AI 2', hand: [], ai: true, passed: false },
      { id: 'ai-3', name: 'AI 3', hand: [], ai: true, passed: false }
    ];
    deck.forEach(function(card, index) { players[index % 4].hand.push(card); });
    players.forEach(function(player) { player.hand.sort(byCard); });
    currentPlayer = players.findIndex(function(player) {
      return player.hand.some(function(card) { return card.id === '3D'; });
    });
    lastPlay = null;
    firstPlay = true;
    selectedIds = {};
    history = [{ player: '系統', text: players[currentPlayer].name + ' 持有 3♦ 先手' }];
    gameOver = false;
    placements = [];
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
    var values = cards.map(function(card) { return rankValue(card.rank); }).sort(function(a, b) { return a - b; });
    for (var i = 1; i < values.length; i++) {
      if (values[i] === values[i - 1]) return null;
      if (values[i] !== values[i - 1] + 1) return null;
    }
    if (values[values.length - 1] >= rankValue('2')) return null;
    return highCard(cards);
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
      return { valid: true, count: count, type: 'triple', primary: rankValue(cards[0].rank), cards: cards };
    }
    if (count !== 5) return { valid: false, reason: '只支援單張、一對、三條或五張牌型' };

    var flush = cards.every(function(card) { return card.suit === cards[0].suit; });
    var straightHigh = straightInfo(cards);
    if (straightHigh && flush) {
      return { valid: true, count: count, type: 'straightflush', primary: cardValue(straightHigh), cards: cards };
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
    if (straightHigh) {
      return { valid: true, count: count, type: 'straight', primary: cardValue(straightHigh), cards: cards };
    }
    return { valid: false, reason: '五張牌必須是順子、同花、葫蘆、四條或同花順' };
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
    if (firstPlay && !cards.some(function(card) { return card.id === '3D'; })) {
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
  }

  function playCards(index, cards) {
    var player = players[index];
    var check = canPlay(cards);
    if (!check.ok) return false;
    removeCards(player, cards);
    lastPlay = {
      playerIndex: index,
      playerName: player.name,
      cards: cloneCards(cards).sort(byCard),
      combo: check.combo
    };
    firstPlay = false;
    clearPasses();
    recordHistory(player.name, '出了 ' + COMBO_NAMES[check.combo.type] + '（' + cardsToText(cards) + '）');
    selectedIds = {};
    if (player.hand.length === 0) {
      finishGame(index);
      return true;
    }
    currentPlayer = nextPlayerIndex(index);
    render();
    scheduleAI();
    return true;
  }

  function passTurn(index) {
    if (!lastPlay || index !== currentPlayer) return;
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
    render();
    scheduleAI();
  }

  function finishGame(winnerIndex) {
    gameOver = true;
    aiTimer = clearTimer(aiTimer);
    placements = [winnerIndex].concat(players.map(function(_, index) { return index; }).filter(function(index) {
      return index !== winnerIndex;
    }).sort(function(a, b) {
      return players[a].hand.length - players[b].hand.length;
    }));
    renderResult();
  }

  function clearTimer(timer) {
    if (timer) clearTimeout(timer);
    return null;
  }

  function getSelectedCards() {
    return players[0].hand.filter(function(card) { return selectedIds[card.id]; });
  }

  function toggleCard(cardId) {
    if (gameOver || currentPlayer !== 0) return;
    if (selectedIds[cardId]) delete selectedIds[cardId];
    else selectedIds[cardId] = true;
    render();
  }

  function submitHumanPlay() {
    if (currentPlayer !== 0 || gameOver) return;
    playCards(0, getSelectedCards());
  }

  function humanPass() {
    if (currentPlayer !== 0 || gameOver || !lastPlay) return;
    selectedIds = {};
    passTurn(0);
  }

  function scheduleAI() {
    if (gameOver || currentPlayer === 0) return;
    aiTimer = clearTimer(aiTimer);
    aiTimer = setTimeout(function() {
      aiTimer = null;
      aiMove(currentPlayer);
    }, 520);
  }

  function aiMove(index) {
    if (gameOver || index !== currentPlayer) return;
    var candidates = legalCandidates(players[index].hand);
    if (candidates.length) {
      playCards(index, candidates[0].cards);
    } else {
      passTurn(index);
    }
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
    container.innerHTML =
      '<div class="bd-shell">' +
        '<div class="bd-topbar">' +
          '<div class="bd-title">' + escapeHtml(statusTitle()) + '</div>' +
          '<div class="bd-actions"><button class="bd-icon-btn" onclick="App.GameManager.endGame()">×</button></div>' +
        '</div>' +
        '<div class="bd-board">' +
          renderOpponentSeats() +
          renderTable() +
        '</div>' +
        renderHandPanel(check) +
      '</div>';
    bindHand();
    bindControls();
  }

  function statusTitle() {
    if (currentPlayer === 0) return lastPlay ? '輪到你：出同張數牌或 Pass' : '輪到你開新一輪';
    return players[currentPlayer].name + ' 思考中...';
  }

  function renderOpponentSeats() {
    return renderSeat(1, 'left') + renderSeat(2, 'top') + renderSeat(3, 'right');
  }

  function renderSeat(index, position) {
    var player = players[index];
    var cls = 'bd-seat ' + position + (currentPlayer === index ? ' active' : '') + (player.passed ? ' passed' : '');
    return '<div class="' + cls + '">' +
      '<div class="bd-player-name">' + escapeHtml(player.name) + '</div>' +
      '<div class="bd-seat-meta">' + player.hand.length + ' 張' + (player.passed ? ' · Pass' : '') + '</div>' +
    '</div>';
  }

  function renderTable() {
    var last = lastPlay
      ? lastPlay.cards.map(function(card) { return renderCard(card); }).join('') +
        '<div class="bd-pill">' + escapeHtml(lastPlay.playerName) + ' · ' + COMBO_NAMES[lastPlay.combo.type] + '</div>'
      : '<div class="bd-last-empty">新一輪，可以自由出牌</div>';
    return '<div class="bd-table">' +
      '<div class="bd-status"><span>' + escapeHtml(firstPlay ? '第一手必須包含 3♦' : '上一手') + '</span><span class="bd-pill">' + players[0].hand.length + ' 張手牌</span></div>' +
      '<div class="bd-last-play">' + last + '</div>' +
      '<div class="bd-history">' + history.slice().reverse().map(function(row) {
        return '<div class="bd-history-row"><span>' + escapeHtml(row.player) + '</span><span>' + escapeHtml(row.text) + '</span></div>';
      }).join('') + '</div>' +
    '</div>';
  }

  function renderHandPanel(check) {
    var hint = currentPlayer === 0 ? check.reason : '等待 AI 出牌';
    var canSubmit = currentPlayer === 0 && check.ok;
    var canPass = currentPlayer === 0 && !!lastPlay;
    return '<div class="bd-hand-panel">' +
      '<div class="bd-hand-scroll">' + players[0].hand.map(renderHandCard).join('') + '</div>' +
      '<div class="bd-controls">' +
        '<div class="bd-hint">' + escapeHtml(hint) + '</div>' +
        '<button class="bd-action-btn secondary" id="bd-pass-btn"' + (canPass ? '' : ' disabled') + '>Pass</button>' +
        '<button class="bd-action-btn" id="bd-play-btn"' + (canSubmit ? '' : ' disabled') + '>出牌</button>' +
      '</div>' +
    '</div>';
  }

  function renderHandCard(card) {
    var selected = selectedIds[card.id] ? ' selected' : '';
    return renderCard(card, 'bd-hand-card' + selected, 'data-card-id="' + card.id + '"');
  }

  function renderCard(card, extraClass, attrs) {
    var red = card.suit === 'D' || card.suit === 'H';
    return '<button class="bd-card ' + (red ? 'red ' : '') + (extraClass || '') + '" ' + (attrs || '') + '>' +
      '<span class="bd-card-corner">' + escapeHtml(card.rank) + '</span>' +
      '<span class="bd-card-suit">' + SUIT_SYMBOLS[card.suit] + '</span>' +
      '<span class="bd-card-mini">' + SUIT_SYMBOLS[card.suit] + '</span>' +
    '</button>';
  }

  function bindHand() {
    Array.prototype.forEach.call(container.querySelectorAll('[data-card-id]'), function(button) {
      button.addEventListener('click', function() { toggleCard(button.getAttribute('data-card-id')); });
    });
  }

  function bindControls() {
    var playBtn = container.querySelector('#bd-play-btn');
    var passBtn = container.querySelector('#bd-pass-btn');
    if (playBtn) playBtn.addEventListener('click', submitHumanPlay);
    if (passBtn) passBtn.addEventListener('click', humanPass);
  }

  function renderResult() {
    var winner = players[placements[0]];
    container.innerHTML =
      '<div class="bd-shell"><div class="bd-result">' +
        '<h2>' + escapeHtml(winner.name) + ' 勝出</h2>' +
        '<div class="bd-result-grid">' + placements.map(function(playerIndex, index) {
          var player = players[playerIndex];
          return '<div class="bd-result-card">' +
            '<div class="bd-result-rank">第 ' + (index + 1) + ' 名</div>' +
            '<div class="bd-result-name">' + escapeHtml(player.name) + '</div>' +
            '<div class="bd-result-left">剩 ' + player.hand.length + ' 張</div>' +
          '</div>';
        }).join('') + '</div>' +
        '<div class="bd-history">' + history.slice().reverse().map(function(row) {
          return '<div class="bd-history-row"><span>' + escapeHtml(row.player) + '</span><span>' + escapeHtml(row.text) + '</span></div>';
        }).join('') + '</div>' +
        '<button class="bd-action-btn" id="bd-new-game">再來一局</button>' +
        '<button class="bd-action-btn secondary" id="bd-back-lobby">返回大廳</button>' +
      '</div></div>';
    container.querySelector('#bd-new-game').addEventListener('click', function() {
      setupGame();
      render();
      scheduleAI();
    });
    container.querySelector('#bd-back-lobby').addEventListener('click', function() {
      App.GameManager.endGame();
    });
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  App.GameManager.register({
    id: 'bigDee',
    name: '鋤大DEE',
    icon: '♠',
    description: '單人四人局，玩家對 3 個 AI',
    supportsSingle: true,
    supportsMultiplayer: false,
    maxPlayers: 4,
    multiplayerModes: [],
    init: function(gameContainer, gameOpts) {
      container = gameContainer;
      opts = gameOpts || {};
      setupGame();
      render();
      scheduleAI();
    },
    handleMessage: function() {},
    destroy: function() {
      aiTimer = clearTimer(aiTimer);
      container = null;
      opts = null;
    }
  });
})();
