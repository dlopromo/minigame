(function() {
  var QUESTIONS = [
    { id: 'hk-office-001', version: 'hk-office-v1', category: 'office', text: '如果公司突然多一條離奇規矩，會係咩？', enabled: true },
    { id: 'hk-office-002', version: 'hk-office-v1', category: 'office', text: '最似老闆會講但其實無意思的一句說話？', enabled: true },
    { id: 'hk-office-003', version: 'hk-office-v1', category: 'office', text: '如果今日要用一個藉口早走，最有創意係咩？', enabled: true },
    { id: 'hk-office-004', version: 'hk-office-v1', category: 'office', text: '辦公室最神秘消失嘅物件係咩？', enabled: true },
    { id: 'hk-office-005', version: 'hk-office-v1', category: 'office', text: '如果茶水間有隱藏技能，會係咩？', enabled: true },
    { id: 'hk-office-006', version: 'hk-office-v1', category: 'office', text: '同事突然開會開到變魔法，第一招係咩？', enabled: true },
    { id: 'hk-office-007', version: 'hk-office-v1', category: 'office', text: 'Printer 如果識講嘢，最想投訴邊件事？', enabled: true },
    { id: 'hk-office-008', version: 'hk-office-v1', category: 'office', text: '如果公司群組有一個隱藏 Boss，會係邊個 emoji？', enabled: true },
    { id: 'hk-daily-001', version: 'hk-daily-v1', category: 'daily', text: '如果港鐵廣播突然講真心話，會講咩？', enabled: true },
    { id: 'hk-daily-002', version: 'hk-daily-v1', category: 'daily', text: '一個最不像請假理由但又好合理嘅理由係咩？', enabled: true },
    { id: 'hk-food-001', version: 'hk-food-v1', category: 'food', text: '如果茶餐廳餐牌有隱藏技能，會係咩？', enabled: true },
    { id: 'hk-food-002', version: 'hk-food-v1', category: 'food', text: '邊款午餐最似一個職場人格？點解？', enabled: true }
  ];
  var BOT_ANSWERS = ['我部電腦需要情緒支援', '會議太努力所以要休息', '茶水間杯麵開咗董事會', 'Printer 決定轉行', 'Keyboard 今日放 AL'];
  var container = null;
  var opts = null;
  var state = null;
  var aiTimer = null;
  var answerDraft = '';

  function isRoomMode() { return opts && opts.roomId; }
  function isSpectator() { return opts && opts.role === 'spectator'; }
  function isHostAuthority() { return !isRoomMode() || opts.isHost; }
  function escapeHtml(value) { return App.Common.escapeHtml(value); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clearTimer(timer) { if (timer) clearTimeout(timer); return null; }

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

  function enabledQuestions() {
    return QUESTIONS.filter(function(question) { return question.enabled !== false; });
  }

  function questionById(questionId) {
    return enabledQuestions().filter(function(question) { return question.id === questionId; })[0] || null;
  }

  function normalizeIdList(value) {
    var raw = [];
    if (Array.isArray(value)) raw = value;
    else if (value && typeof value === 'object') {
      raw = Object.keys(value).map(function(key) {
        return typeof value[key] === 'string' ? value[key] : key;
      });
    }
    var seen = {};
    return raw.map(function(id) { return String(id || ''); }).filter(function(id) {
      if (!id || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function pickQuestion(playedQuestionIds, previousQuestionId, round, currentCycle) {
    var questions = enabledQuestions();
    var played = normalizeIdList(playedQuestionIds);
    var playedMap = {};
    played.forEach(function(id) { playedMap[id] = true; });
    var pool = questions.filter(function(question) { return !playedMap[question.id]; });
    var cycle = Number(currentCycle || 1);
    var resetCycle = false;
    if (!pool.length) {
      resetCycle = true;
      cycle += 1;
      played = [];
      pool = questions.filter(function(question) {
        return questions.length <= 1 || question.id !== previousQuestionId;
      });
    }
    var fallback = questions[0] || { id: 'fallback', version: 'local', category: 'general', text: '講一個最 9upper 嘅答案。' };
    var index = pool.length ? Math.abs((Number(round || 1) - 1) % pool.length) : 0;
    var question = pool[index] || fallback;
    var nextPlayed = played.concat([question.id]);
    return {
      question: question,
      questionId: question.id,
      questionVersion: question.version || 'local',
      questionCategory: question.category || 'general',
      prompt: question.text,
      playedQuestionIds: nextPlayed,
      questionCycle: cycle,
      resetCycle: resetCycle
    };
  }

  function promptFor(round) {
    var questions = enabledQuestions();
    var question = questions[(round - 1) % questions.length] || QUESTIONS[0];
    return question ? question.text : '講一個最 9upper 嘅答案。';
  }

  function buildInitialState(seats) {
    var players = makePlayers(seats);
    var picked = pickQuestion([], '', 1, 1);
    return {
      players: players,
      round: 1,
      maxRounds: 5,
      phase: 'submit',
      prompt: picked.prompt,
      questionId: picked.questionId,
      questionVersion: picked.questionVersion,
      questionCategory: picked.questionCategory,
      questionCycle: picked.questionCycle,
      playedQuestionIds: picked.playedQuestionIds,
      submissions: {},
      votes: {},
      revealed: [],
      status: 'playing',
      winnerId: '',
      resultSaved: false,
      history: [{ name: '系統', text: '9Upper 開始' }],
      startedAt: Date.now(),
      finishedAt: 0
    };
  }

  function setupGame() {
    if (opts && opts.initialState && opts.initialState.state) state = clone(opts.initialState.state);
    else state = buildInitialState();
    answerDraft = '';
    normalizeState();
  }

  function restartSingle() {
    if (isRoomMode()) return false;
    state = buildInitialState();
    normalizeState();
    render();
    scheduleAI();
    return true;
  }

  function serializeState() { return { gameId: 'nineUpper', roundId: opts.roundId || '', state: clone(state) }; }
  function applyState(snapshot) {
    if (!snapshot || !snapshot.state) return;
    var expectedRoundId = (opts && opts.roundId) || (opts && opts.gameState && opts.gameState.roundId) || '';
    if (expectedRoundId && snapshot.roundId && snapshot.roundId !== expectedRoundId) return;
    state = clone(snapshot.state);
    if (state.phase !== 'submit') answerDraft = '';
    normalizeState();
    render();
  }

  function normalizeState() {
    state = state || {};
    state.players = Array.isArray(state.players) ? state.players : makePlayers();
    state.round = Number(state.round || 1);
    state.maxRounds = Number(state.maxRounds || 5);
    state.phase = state.phase || 'submit';
    state.playedQuestionIds = normalizeIdList(state.playedQuestionIds);
    state.questionCycle = Number(state.questionCycle || 1);
    var existingQuestion = questionById(state.questionId);
    if (!existingQuestion) {
      var picked = pickQuestion(state.playedQuestionIds, state.questionId, state.round, state.questionCycle);
      state.prompt = picked.prompt;
      state.questionId = picked.questionId;
      state.questionVersion = picked.questionVersion;
      state.questionCategory = picked.questionCategory;
      state.questionCycle = picked.questionCycle;
      state.playedQuestionIds = picked.playedQuestionIds;
    } else {
      state.prompt = state.prompt || existingQuestion.text;
      state.questionVersion = state.questionVersion || existingQuestion.version || 'local';
      state.questionCategory = state.questionCategory || existingQuestion.category || 'general';
      if (state.playedQuestionIds.indexOf(existingQuestion.id) === -1) state.playedQuestionIds.push(existingQuestion.id);
    }
    state.submissions = state.submissions && typeof state.submissions === 'object' ? state.submissions : {};
    state.votes = state.votes && typeof state.votes === 'object' ? state.votes : {};
    state.revealed = Array.isArray(state.revealed) ? state.revealed : [];
    state.status = state.status || 'playing';
    state.winnerId = state.winnerId || '';
    state.resultSaved = !!state.resultSaved;
    state.history = Array.isArray(state.history) ? state.history : [{ name: '系統', text: '9Upper 開始' }];
    state.startedAt = Number(state.startedAt || Date.now());
    state.finishedAt = Number(state.finishedAt || 0);
    state.players.forEach(function(player, index) {
      player.id = player.id || 'player-' + index;
      player.name = player.name || '玩家';
      player.playerColor = player.playerColor || '';
      player.playerIcon = player.playerIcon || '';
      player.score = Number(player.score || 0);
      player.ai = !!player.ai || !!player.isAI;
      player.online = player.online !== false;
    });
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
  function commit() {
    if (isHostAuthority() || (opts && opts.localEcho)) {
      publishState();
      render();
      scheduleAI();
    }
  }

  function submit(playerId, text) {
    normalizeState();
    if (state.phase !== 'submit') return;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    if (!player) return;
    text = String(text || '').trim().slice(0, 80);
    if (!text) return;
    answerDraft = '';
    state.submissions[playerId] = { playerId: playerId, name: player.name, text: text };
    record(player.name, '已提交答案');
    if (state.players.every(function(p) { return state.submissions[p.id]; })) {
      startVoting();
    }
    commit();
  }

  function startVoting() {
    normalizeState();
    state.phase = 'vote';
    state.votes = {};
    state.revealed = state.players.map(function(player) {
      return state.submissions[player.id];
    }).filter(Boolean).sort(function(a, b) {
      return a.text.localeCompare(b.text);
    });
    record('系統', '答案已匿名公開，開始投票');
  }

  function vote(playerId, targetId) {
    normalizeState();
    if (state.phase !== 'vote' || playerId === targetId) return;
    if (!state.submissions[playerId] || !state.submissions[targetId]) return;
    state.votes[playerId] = targetId;
    var player = state.players.filter(function(item) { return item.id === playerId; })[0];
    record(player ? player.name : '玩家', '已投票');
    if (state.players.every(function(p) { return state.votes[p.id] || p.id === targetId && !state.submissions[p.id]; }) || Object.keys(state.votes).length >= state.players.length) {
      scoreRound();
    }
    commit();
  }

  function scoreRound() {
    normalizeState();
    var counts = {};
    Object.keys(state.votes).forEach(function(id) {
      counts[state.votes[id]] = (counts[state.votes[id]] || 0) + 1;
    });
    state.players.forEach(function(player) {
      player.score += counts[player.id] || 0;
    });
    state.phase = 'result';
    record('系統', '第 ' + state.round + ' 回合完成');
    if (state.round >= state.maxRounds) settle();
  }

  function nextRound() {
    normalizeState();
    if (state.phase !== 'result' || state.status !== 'playing') return;
    state.round += 1;
    state.phase = 'submit';
    var picked = pickQuestion(state.playedQuestionIds, state.questionId, state.round, state.questionCycle);
    state.prompt = picked.prompt;
    state.questionId = picked.questionId;
    state.questionVersion = picked.questionVersion;
    state.questionCategory = picked.questionCategory;
    state.questionCycle = picked.questionCycle;
    state.playedQuestionIds = picked.playedQuestionIds;
    state.submissions = {};
    state.votes = {};
    state.revealed = [];
    record('系統', '第 ' + state.round + ' 回合開始');
    commit();
  }

  function settle() {
    var winner = state.players.slice().sort(function(a, b) { return b.score - a.score; })[0];
    state.status = 'settled';
    state.winnerId = winner ? winner.id : '';
    state.finishedAt = Date.now();
    record('系統', (winner ? winner.name : '玩家') + ' 勝出');
    saveRoomResult();
  }

  function selfPlayer() {
    normalizeState();
    if (!isRoomMode()) return state.players[0];
    return state.players.filter(function(player) { return player.id === opts.selfId; })[0] || null;
  }
  function canSubmit() {
    var self = selfPlayer();
    return !!self && !isSpectator() && !self.ai && state.phase === 'submit' && !state.submissions[self.id] && state.status === 'playing';
  }
  function canVote() {
    var self = selfPlayer();
    return !!self && !isSpectator() && !self.ai && state.phase === 'vote' && !state.votes[self.id] && state.status === 'playing';
  }
  function isHostPlayer() { return !isRoomMode() || opts.isHost; }

  function sendRoomAction(payload) {
    if (!isRoomMode()) return;
    if (App.Lobby && typeof App.Lobby.sendRoomGameAction === 'function') {
      App.Lobby.sendRoomGameAction(payload);
      return;
    }
    if (!App.Signaling || !App.Signaling.sendGameAction) return;
    App.Signaling.sendGameAction({ roundId: opts.roundId || '', gameId: 'nineUpper', mode: opts.mode || 'room', payload: payload });
  }

  function sendRoomActionWithSnapshot(payload) {
    sendRoomAction(Object.assign({}, payload, { stateSnapshot: serializeState() }));
  }

  function humanSubmit() {
    var input = container.querySelector('#nu-answer');
    var text = input ? input.value : '';
    var self = selfPlayer();
    if (!self || !canSubmit()) return;
    answerDraft = String(text || '');
    if (isRoomMode() && !opts.isHost) {
      opts.localEcho = true;
      submit(self.id, text);
      opts.localEcho = false;
      sendRoomActionWithSnapshot({ type: 'nu_submit', playerId: opts.selfId, text: text, skipLocalEcho: true });
    } else submit(self.id, text);
  }
  function humanVote(targetId) {
    var self = selfPlayer();
    if (!self || !canVote()) return;
    if (isRoomMode() && !opts.isHost) {
      opts.localEcho = true;
      vote(self.id, targetId);
      opts.localEcho = false;
      sendRoomActionWithSnapshot({ type: 'nu_vote', playerId: opts.selfId, targetId: targetId, skipLocalEcho: true });
    } else vote(self.id, targetId);
  }
  function humanNext() {
    if (!isHostPlayer()) return;
    if (isRoomMode() && !opts.isHost) return;
    nextRound();
  }
  function handleRoomAction(msg) {
    if (!isRoomMode() || !msg || (!opts.isHost && !msg.localEcho) || (opts.isHost && msg.localEcho)) return;
    if (msg.stateSnapshot && msg.stateSnapshot.state) {
      state = clone(msg.stateSnapshot.state);
      normalizeState();
    }
    if (msg.type === 'nu_submit') submit(msg.playerId, msg.text);
    if (msg.type === 'nu_vote') vote(msg.playerId, msg.targetId);
  }

  function scheduleAI() {
    aiTimer = clearTimer(aiTimer);
    if (!isHostAuthority() || !state || state.status !== 'playing') return;
    aiTimer = setTimeout(function() {
      aiTimer = null;
      var changed = false;
      state.players.forEach(function(player, index) {
        if (!player.ai) return;
        if (state.phase === 'submit' && !state.submissions[player.id]) {
          submit(player.id, BOT_ANSWERS[(state.round + index) % BOT_ANSWERS.length]);
          changed = true;
        } else if (state.phase === 'vote' && !state.votes[player.id]) {
          var options = state.players.filter(function(p) { return p.id !== player.id && state.submissions[p.id]; });
          if (options.length) {
            vote(player.id, options[(state.round + index) % options.length].id);
            changed = true;
          }
        }
      });
      if (!changed) render();
    }, 700);
  }

  function saveRoomResult() {
    if (!isRoomMode() || !opts.isHost || !App.Signaling) return;
    if (state.resultSaved) return;
    state.resultSaved = true;
    if (App.Signaling.appendHistory) App.Signaling.appendHistory({ status: 'completed', gameId: 'nineUpper', mode: opts.mode || 'room', roundId: opts.roundId || '', summary: '9Upper 完成', winnerId: state.winnerId });
    if (App.Signaling.addLeaderboardResults) {
      App.Signaling.addLeaderboardResults(state.players.map(function(player) {
        return { id: player.id, name: player.name, playerColor: player.playerColor || '', playerIcon: player.playerIcon || '', score: player.score, win: player.id === state.winnerId };
      }));
    }
  }

  function renderScore(player) {
    return '<article class="nu-player"><strong>' + escapeHtml(player.name) + '</strong><span>' + player.score + ' 分' + (player.ai ? ' · AI' : '') + '</span></article>';
  }
  function renderSubmit() {
    var self = selfPlayer();
    var submitted = self && state.submissions[self.id];
    return '<section class="nu-main"><h2>' + escapeHtml(state.prompt) + '</h2>' +
      (canSubmit()
        ? '<textarea id="nu-answer" maxlength="80" placeholder="寫一句夠 9upper 嘅答案...">' + escapeHtml(answerDraft || '') + '</textarea><button class="nu-btn" id="nu-submit">提交</button>'
        : '<p>' + (submitted ? '你已提交，等待其他人。' : '等待提交中...') + '</p>') +
    '</section>';
  }
  function renderVote() {
    var self = selfPlayer();
    return '<section class="nu-main"><h2>投票：邊個答案最 9upper？</h2><div class="nu-answers">' + state.revealed.map(function(item, index) {
      var disabled = !canVote() || (self && self.id === item.playerId);
      return '<button class="nu-answer" data-vote-id="' + item.playerId + '"' + (disabled ? ' disabled' : '') + '><b>#' + (index + 1) + '</b><span>' + escapeHtml(item.text) + '</span></button>';
    }).join('') + '</div></section>';
  }
  function renderResult() {
    var counts = {};
    Object.keys(state.votes).forEach(function(id) { counts[state.votes[id]] = (counts[state.votes[id]] || 0) + 1; });
    return '<section class="nu-main"><h2>' + (state.status === 'settled' ? '最終結果' : '本回合結果') + '</h2><div class="nu-answers">' + state.revealed.map(function(item) {
      return '<div class="nu-answer result"><b>' + (counts[item.playerId] || 0) + ' 票</b><span>' + escapeHtml(item.text) + '</span><em>' + escapeHtml(item.name) + '</em></div>';
    }).join('') + '</div>' + (state.status === 'playing' && isHostPlayer() ? '<button class="nu-btn" id="nu-next">下一回合</button>' : '') +
      (state.status === 'settled' ? '<div class="nu-result-actions"><button class="nu-btn secondary" id="nu-back">返回</button>' + (isRoomMode() ? '' : '<button class="nu-btn" id="nu-new">再來一局</button>') + '</div>' : '') + '</section>';
  }
  function renderMain() {
    if (state.phase === 'submit') return renderSubmit();
    if (state.phase === 'vote') return renderVote();
    return renderResult();
  }
  function render() {
    if (!container || !state) return;
    if (state.status === 'settled') {
      var ranked = state.players.slice().sort(function(a, b) {
        return b.score - a.score || String(a.name).localeCompare(String(b.name));
      });
      var actions = '<button class="nu-btn secondary" id="nu-back">返回</button>' +
        (isRoomMode() ? '' : '<button class="nu-btn" id="nu-new">再來一局</button>');
      container.innerHTML = '<div class="nu-shell">' + App.Common.renderResultDialog({
        eyebrow: '9Upper 結算',
        title: winnerText(),
        subtitle: '總分最高者勝出',
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
      if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle('9Upper 結算');
      return;
    }
    container.innerHTML =
      '<div class="nu-shell">' +
        '<div class="nu-topbar"><div class="nu-title">' + (state.status === 'settled' ? winnerText() : '9Upper · Round ' + state.round + '/' + state.maxRounds) + '</div><div class="nu-actions">' + (isRoomMode() ? '<button class="nu-icon game-chat-trigger" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>' : '') + '<button class="nu-icon" onclick="(App.Lobby && App.Lobby.handleGameCloseAction ? App.Lobby.handleGameCloseAction() : App.GameManager.endGame())" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div></div>' +
        '<section class="nu-score">' + state.players.map(renderScore).join('') + '</section>' +
        renderMain() +
        '<div class="nu-foot">' + escapeHtml(state.history[state.history.length - 1].name + '：' + state.history[state.history.length - 1].text) + '</div>' +
      '</div>';
    bindControls();
    if (App.Lobby && App.Lobby.setTitle) App.Lobby.setTitle(canSubmit() || canVote() ? '輪到你 - 9Upper' : '9Upper');
  }
  function winnerText() {
    var winner = state.players.filter(function(player) { return player.id === state.winnerId; })[0];
    return winner ? winner.name + ' 勝出' : '9Upper 結算';
  }
  function bindControls() {
    var submitBtn = container.querySelector('#nu-submit');
    var nextBtn = container.querySelector('#nu-next');
    var backBtn = container.querySelector('#nu-back');
    var newBtn = container.querySelector('#nu-new');
    var input = container.querySelector('#nu-answer');
    if (input) {
      input.addEventListener('input', function() {
        answerDraft = input.value || '';
      });
    }
    if (submitBtn) submitBtn.addEventListener('click', humanSubmit);
    if (nextBtn) nextBtn.addEventListener('click', humanNext);
    if (backBtn) backBtn.addEventListener('click', function() { if (App.Lobby && App.Lobby.handleGameCloseAction) App.Lobby.handleGameCloseAction(); else App.GameManager.endGame(); });
    if (newBtn) newBtn.addEventListener('click', restartSingle);
    Array.prototype.forEach.call(container.querySelectorAll('[data-vote-id]'), function(button) {
      button.addEventListener('click', function() { humanVote(button.getAttribute('data-vote-id')); });
    });
  }

  App.NineUpperRules = {
    buildInitialState: buildInitialState,
    enabledQuestions: enabledQuestions,
    pickQuestion: pickQuestion,
    promptFor: promptFor
  };

  App.GameManager.register({
    id: 'nineUpper',
    name: '9Upper',
    icon: '9U',
    description: '吹水答案匿名投票派對遊戲',
    supportsSingle: true,
    supportsMultiplayer: true,
    minPlayers: 1,
    minRoomPlayers: 1,
    maxPlayers: 6,
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
      if (action === 'primary' && canSubmit()) {
        humanSubmit();
        return true;
      }
      return false;
    }
  });
})();
