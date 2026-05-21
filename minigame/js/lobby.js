var App = window.App || {};

App.Lobby = (function() {
  var gameMode = null;
  var playerName = '';
  var opponentName = '';
  var isHost = false;
  var gameActive = false;

  function showScreen(id) {
    App.Common.showScreen(id);
  }

  function setTitle(text) {
    document.title = text ? text + ' - MiniGame' : 'MiniGame';
  }

  function selectMode(mode) {
    gameMode = mode;
    if (mode === 'single') {
      showGameSelect('single');
    } else {
      showScreen('connect');
      var titleEl = document.getElementById('connect-title');
      var descEl = document.getElementById('connect-desc');
      if (mode === 'versus') {
        titleEl.textContent = '雙人對戰';
        descEl.textContent = '輪流猜測對方的秘密代碼，先猜中者勝！';
      } else {
        titleEl.textContent = '雙人合作';
        descEl.textContent = '合力破解電腦的秘密代碼！';
      }
      setTitle(mode === 'versus' ? '雙人對戰' : '雙人合作');
    }
  }

  function showGameSelect(modeFilter) {
    var grid = document.getElementById('game-grid');
    grid.innerHTML = '';
    var games = App.GameManager.getGames();
    games.forEach(function(game) {
      var supported = false;
      if (modeFilter === 'single' && game.supportsSingle) supported = true;
      if (modeFilter !== 'single' && game.supportsMultiplayer) supported = true;
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
      selectTitle.textContent = modeFilter === 'single' ? '選擇遊戲' : '選擇遊戲';
    }
    showScreen('game-select');
  }

  function onGameSelected(gameId) {
    if (gameMode === 'single') {
      launchSingleGame(gameId);
    } else {
      if (App.WebRTC.getIsHost()) {
        App.WebRTC.send({ type: 'game_select', gameId: gameId });
        launchMultiplayerGame(gameId);
      }
    }
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

  function launchMultiplayerGame(gameId) {
    showScreen('game');
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    App.GameManager.startGame(gameId, container, {
      mode: gameMode,
      isHost: isHost,
      playerName: playerName,
      opponentName: opponentName
    }, function() {
      gameActive = false;
      showGameSelect(gameMode);
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

  function onConnectionOpen() {
    App.WebRTC.send({ type: 'player_info', name: playerName });
    if (App.WebRTC.getIsHost()) {
      showGameSelect(gameMode);
    } else {
      showScreen('waiting');
      setTitle('等待房主選擇遊戲...');
    }
  }

  function onConnectionClose() {
    if (gameActive) {
      App.GameManager.endGame();
      gameActive = false;
    }
    App.Common.showToast('連線已中斷，可按重試重新連線', 'error');
    if (isHost) {
      document.getElementById('host-retry-card').style.display = 'block';
    } else {
      document.getElementById('join-retry-card').style.display = 'block';
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'player_info':
        opponentName = msg.name;
        break;
      case 'game_select':
        launchMultiplayerGame(msg.gameId);
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
    gameMode = null;
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
