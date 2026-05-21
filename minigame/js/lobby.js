var App = window.App || {};

App.Lobby = (function() {
  var playContext = null;
  var selectedGameId = null;
  var playerName = '';
  var opponentName = '';
  var isHost = false;
  var gameActive = false;

  var modeMeta = {
    coop: {
      name: '雙人合作',
      description: '輪流猜同一組電腦答案，不限次數，直到猜中。'
    },
    race: {
      name: '雙人對決',
      description: '同題即時競速，先猜中者勝，步數作統計。'
    }
  };

  function showScreen(id) {
    App.Common.showScreen(id);
  }

  function setTitle(text) {
    document.title = text ? text + ' - MiniGame' : 'MiniGame';
  }

  function selectMode(mode) {
    selectedGameId = null;
    if (mode === 'single') {
      playContext = 'single';
      setTitle('本機遊玩');
      showGameSelect('single');
      return;
    }

    playContext = 'multiplayer';
    showScreen('connect');
    var titleEl = document.getElementById('connect-title');
    var descEl = document.getElementById('connect-desc');
    if (titleEl) titleEl.textContent = '雙人連線';
    if (descEl) descEl.textContent = '先完成連線，連線後由房主選擇遊戲和玩法。';
    setTitle('雙人連線');
  }

  function showGameSelect(context) {
    if (context) playContext = context;
    var grid = document.getElementById('game-grid');
    grid.innerHTML = '';
    App.GameManager.getGames().forEach(function(game) {
      var supported = playContext === 'single' ? game.supportsSingle : game.supportsMultiplayer;
      if (!supported) return;

      var card = document.createElement('div');
      card.className = 'game-card';
      card.innerHTML =
        '<div class="game-icon">' + game.icon + '</div>' +
        '<div class="game-name">' + game.name + '</div>' +
        '<div class="game-desc">' + game.description + '</div>';
      card.onclick = function() { onGameSelected(game.id); };
      grid.appendChild(card);
    });

    var selectTitle = document.getElementById('game-select-title');
    if (selectTitle) {
      selectTitle.textContent = playContext === 'single' ? '選擇本機遊戲' : '選擇雙人遊戲';
    }
    showScreen('game-select');
  }

  function onGameSelected(gameId) {
    selectedGameId = gameId;
    if (playContext === 'single') {
      launchSingleGame(gameId);
      return;
    }

    if (!App.WebRTC.getIsHost()) return;
    var game = App.GameManager.getGame(gameId);
    var modes = game && game.multiplayerModes ? game.multiplayerModes : ['coop'];
    App.WebRTC.send({ type: 'game_select', gameId: gameId });
    if (modes.length === 1) {
      selectMultiplayerMode(modes[0]);
    } else {
      showModeSelect(gameId);
    }
  }

  function showModeSelect(gameId) {
    selectedGameId = gameId;
    var game = App.GameManager.getGame(gameId);
    var modes = game && game.multiplayerModes ? game.multiplayerModes : ['coop'];
    var grid = document.getElementById('mode-choice-grid');
    grid.innerHTML = '';
    modes.forEach(function(mode) {
      var meta = modeMeta[mode] || { name: mode, description: '' };
      var card = document.createElement('button');
      card.className = 'mode-choice-card';
      card.innerHTML =
        '<span class="mode-choice-name">' + meta.name + '</span>' +
        '<span class="mode-choice-desc">' + meta.description + '</span>';
      card.onclick = function() { selectMultiplayerMode(mode); };
      grid.appendChild(card);
    });
    var title = document.getElementById('mode-select-title');
    if (title) title.textContent = (game ? game.name : '遊戲') + ' 玩法';
    showScreen('mode-select');
  }

  function selectMultiplayerMode(mode) {
    if (!selectedGameId || !App.WebRTC.getIsHost()) return;
    App.WebRTC.send({ type: 'mode_select', mode: mode });
    App.WebRTC.send({ type: 'game_start', gameId: selectedGameId, mode: mode });
    launchMultiplayerGame(selectedGameId, mode);
  }

  function launchSingleGame(gameId) {
    showScreen('game');
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    App.GameManager.startGame(gameId, container, {
      mode: 'single',
      isHost: true,
      playerName: playerName || '玩家',
      opponentName: ''
    }, function() {
      gameActive = false;
      goHome();
    });
  }

  function launchMultiplayerGame(gameId, mode) {
    showScreen('game');
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    App.GameManager.startGame(gameId, container, {
      mode: mode,
      isHost: isHost,
      playerName: playerName || '玩家',
      opponentName: opponentName || '對方'
    }, function() {
      gameActive = false;
      if (App.WebRTC.isConnected() && isHost) showGameSelect('multiplayer');
      else if (App.WebRTC.isConnected()) showWaiting();
      else goHome();
    });
  }

  async function startHost() {
    var nameInput = document.getElementById('player-name-input').value.trim();
    playerName = nameInput || '玩家';
    isHost = true;
    showScreen('host');
    document.getElementById('offer-code').value = '產生中...';
    document.getElementById('answer-input').value = '';
    document.getElementById('host-retry-card').style.display = 'none';
    document.getElementById('btn-connect-host').disabled = false;

    try {
      var offerCode = await App.WebRTC.createOffer();
      document.getElementById('offer-code').value = offerCode;
    } catch (e) {
      App.Common.showToast('創建失敗：' + e.message, 'error');
    }
  }

  async function connectHost() {
    var raw = document.getElementById('answer-input').value.trim();
    if (!raw) { App.Common.showToast('請貼上對方的回應碼', 'error'); return; }
    document.getElementById('btn-connect-host').disabled = true;
    try {
      await App.WebRTC.acceptAnswer(raw);
    } catch (e) {
      App.Common.showToast('回應碼錯誤：' + e.message, 'error');
      document.getElementById('btn-connect-host').disabled = false;
    }
  }

  async function retryHost() {
    document.getElementById('host-retry-card').style.display = 'none';
    App.WebRTC.cleanDisconnect();
    isHost = true;
    document.getElementById('offer-code').value = '產生中...';
    document.getElementById('answer-input').value = '';
    document.getElementById('btn-connect-host').disabled = false;
    try {
      var offerCode = await App.WebRTC.createOffer();
      document.getElementById('offer-code').value = offerCode;
    } catch (e) {
      App.Common.showToast('重試失敗：' + e.message, 'error');
    }
  }

  async function startJoin() {
    var nameInput = document.getElementById('player-name-input').value.trim();
    playerName = nameInput || '玩家';
    isHost = false;
    showScreen('join');
    document.getElementById('offer-input').value = '';
    document.getElementById('answer-code').value = '';
    document.getElementById('join-answer-card').style.display = 'none';
    document.getElementById('btn-gen-answer').disabled = false;
    document.getElementById('join-retry-card').style.display = 'none';
  }

  async function generateAnswer() {
    var raw = document.getElementById('offer-input').value.trim();
    if (!raw) { App.Common.showToast('請貼上對方的邀請碼', 'error'); return; }
    document.getElementById('btn-gen-answer').disabled = true;
    try {
      var answerCode = await App.WebRTC.createAnswer(raw);
      document.getElementById('answer-code').value = answerCode;
      document.getElementById('join-answer-card').style.display = 'block';
    } catch (e) {
      App.Common.showToast('邀請碼錯誤：' + e.message, 'error');
      document.getElementById('btn-gen-answer').disabled = false;
    }
  }

  function retryJoin() {
    App.WebRTC.cleanDisconnect();
    isHost = false;
    document.getElementById('join-retry-card').style.display = 'none';
    document.getElementById('offer-input').value = '';
    document.getElementById('answer-code').value = '';
    document.getElementById('join-answer-card').style.display = 'none';
    document.getElementById('btn-gen-answer').disabled = false;
  }

  function showWaiting() {
    showScreen('waiting');
    setTitle('等待房主選擇遊戲...');
  }

  function onConnectionOpen() {
    playContext = 'multiplayer';
    App.WebRTC.send({ type: 'player_info', name: playerName });
    if (App.WebRTC.getIsHost()) {
      showGameSelect('multiplayer');
    } else {
      showWaiting();
    }
  }

  function onConnectionClose() {
    var wasHost = isHost;
    if (gameActive) {
      App.GameManager.endGame();
      gameActive = false;
    }
    App.Common.showToast('連線已中斷，可按重試重新連線', 'error');
    if (wasHost) {
      isHost = true;
      showScreen('host');
      document.getElementById('host-retry-card').style.display = 'block';
    } else {
      isHost = false;
      showScreen('join');
      document.getElementById('join-retry-card').style.display = 'block';
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'player_info':
        opponentName = msg.name || '對方';
        break;
      case 'game_select':
        selectedGameId = msg.gameId;
        showWaiting();
        break;
      case 'mode_select':
        break;
      case 'game_start':
        selectedGameId = msg.gameId;
        launchMultiplayerGame(msg.gameId, msg.mode);
        break;
      case 'game_msg':
        App.GameManager.handleMessage(msg.payload);
        break;
    }
  }

  function goHome() {
    App.WebRTC.cleanDisconnect();
    if (gameActive) {
      App.GameManager.endGame();
      gameActive = false;
    }
    playContext = null;
    selectedGameId = null;
    playerName = '';
    opponentName = '';
    isHost = false;
    setTitle('');
    showScreen('home');
    var hostRetry = document.getElementById('host-retry-card');
    if (hostRetry) hostRetry.style.display = 'none';
    var joinRetry = document.getElementById('join-retry-card');
    if (joinRetry) joinRetry.style.display = 'none';
  }

  function init() {
    App.WebRTC.on('open', onConnectionOpen);
    App.WebRTC.on('close', onConnectionClose);
    App.WebRTC.on('message', handleMessage);

    window.addEventListener('beforeunload', function(e) {
      if (App.WebRTC.isConnected() && gameActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  return {
    init: init,
    selectMode: selectMode,
    showGameSelect: showGameSelect,
    showModeSelect: showModeSelect,
    selectMultiplayerMode: selectMultiplayerMode,
    startHost: startHost,
    connectHost: connectHost,
    retryHost: retryHost,
    startJoin: startJoin,
    generateAnswer: generateAnswer,
    retryJoin: retryJoin,
    goHome: goHome,
    launchMultiplayerGame: launchMultiplayerGame,
    setTitle: setTitle
  };
})();

window.App = App;
