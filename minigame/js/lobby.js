var App = window.App || {};

App.Lobby = (function() {
  var playContext = null;
  var selectedGameId = null;
  var playerName = '';
  var opponentName = '';
  var isHost = false;
  var gameActive = false;
  var roomState = null;
  var selfId = '';
  var roomRole = 'player';
  var peerOffers = {};
  var peerAnswers = {};
  var roomActionIds = {};
  var launchedRoomGameKey = '';

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

  function normalizeUsername(value) {
    return String(value || '').trim().slice(0, 12);
  }

  function isValidUsername(name) {
    return /^[A-Za-z0-9\u4e00-\u9fff]+$/.test(name);
  }

  function requireUsername(value) {
    var name = normalizeUsername(value);
    if (!name) {
      App.Common.showToast('請輸入你的名字', 'error');
      return '';
    }
    if (!isValidUsername(name)) {
      App.Common.showToast('名字只可使用中文、英文或數字', 'error');
      return '';
    }
    return name;
  }

  function normalizeRoomCode(value) {
    return App.Signaling && App.Signaling.normalizeRoomCode
      ? App.Signaling.normalizeRoomCode(value)
      : String(value || '').replace(/\D/g, '').slice(0, 4);
  }

  function getRoomCodeInput() {
    var input = document.getElementById('room-code-input');
    return input ? normalizeRoomCode(input.value) : '';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showScreen(id) {
    App.Common.showScreen(id);
  }

  function setTitle(text) {
    document.title = text ? text + ' - MiniGame' : 'MiniGame';
  }

  function saveRoomSession(room) {
    if (!App.RoomSession || !room || !room.code || !room.selfId) return;
    App.RoomSession.save({
      roomCode: room.code,
      clientId: room.selfId,
      authUid: App.Signaling.getAuthUid ? App.Signaling.getAuthUid() : '',
      username: playerName,
      isHost: isHost,
      lastRole: room.role || roomRole || 'player'
    });
  }

  function clearRoomSession() {
    if (App.RoomSession && App.RoomSession.clear) App.RoomSession.clear();
  }

  function selectMode(mode) {
    selectedGameId = null;
    if (mode === 'single') {
      playContext = 'single';
      setTitle('本機遊玩');
      showGameSelect('single');
      return;
    }

    if (mode === 'room') {
      playContext = 'room';
      setTitle('短碼房間');
      showRoomConnect();
      return;
    }

    playContext = 'multiplayer';
    showScreen('connect');
    var titleEl = document.getElementById('connect-title');
    var descEl = document.getElementById('connect-desc');
    if (titleEl) titleEl.textContent = '手動雙人連線';
    if (descEl) descEl.textContent = '先完成連線，連線後由房主選擇遊戲和玩法。';
    setTitle('手動雙人連線');
  }

  function showRoomConnect() {
    var note = document.getElementById('room-config-note');
    if (note) {
      note.className = 'room-config-note' + (!App.Signaling.isConfigured() ? ' error' : '');
      note.textContent = App.Signaling.isConfigured()
        ? 'Firebase 已設定，可使用短碼房間。'
        : 'Firebase 尚未設定：請先填寫 js/firebaseConfig.js。';
    }
    showScreen('room-connect');
  }

  function getPeople(map) {
    return Object.keys(map || {}).map(function(id) {
      var item = map[id] || {};
      item.id = id;
      return item;
    }).sort(function(a, b) {
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
  }

  function getRoomPlayers() {
    return getPeople(roomState && roomState.players);
  }

  function getRoomSpectators() {
    return getPeople(roomState && roomState.spectators);
  }

  function getGameMaxPlayers(gameId) {
    var game = App.GameManager.getGame(gameId);
    return (game && game.maxPlayers) || 2;
  }

  function getSelfRole() {
    if (!roomState || !selfId) return 'player';
    if (roomState.players && roomState.players[selfId]) return 'player';
    return 'spectator';
  }

  function getSelfName() {
    if (!roomState || !selfId) return playerName;
    var record = (roomState.players && roomState.players[selfId]) || (roomState.spectators && roomState.spectators[selfId]);
    return (record && record.name) || playerName;
  }

  function renderPeople(targetId, people) {
    var target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = '';
    if (people.length === 0) {
      target.innerHTML = '<p class="room-list-empty">暫時沒有</p>';
      return;
    }
    people.forEach(function(person) {
      var row = el('div');
      row.className = 'room-person' + (person.online === false ? ' offline' : '');
      var info = el('div');
      info.appendChild(el('div', 'room-person-name', person.name || '玩家'));
      info.appendChild(el('div', 'room-person-meta', person.online === false ? '離線' : '在線'));
      var badges = el('div');
      if (roomState && person.id === roomState.hostId) badges.appendChild(el('span', 'room-badge host', '房主'));
      if (person.id === selfId) badges.appendChild(el('span', 'room-badge self', '你'));
      row.appendChild(info);
      row.appendChild(badges);
      target.appendChild(row);
    });
  }

  function renderRoomLobby() {
    if (!roomState) return;
    roomRole = getSelfRole();
    var codeLabel = document.getElementById('room-code-label');
    if (codeLabel) codeLabel.textContent = roomState.code || App.Signaling.getRoomCode() || '----';
    var roleLabel = document.getElementById('room-role-label');
    if (roleLabel) {
      var roleText = roomRole === 'player' ? '玩家' : '觀戰';
      var statusText = roomState.status === 'playing'
        ? '遊戲進行中'
        : roomState.status === 'starting'
          ? '遊戲準備中'
          : '等待房主選擇遊戲';
      roleLabel.textContent = '你目前是：' + roleText + '　' + statusText;
    }
    renderPeople('room-player-list', getRoomPlayers());
    renderPeople('room-spectator-list', getRoomSpectators());
    var actions = document.getElementById('room-host-actions');
    if (actions) actions.style.display = isHost ? 'block' : 'none';
    showScreen('room-lobby');
  }

  function notifyRoomUpdateToGame() {
    if (!gameActive || playContext !== 'room') return;
    App.GameManager.handleMessage({
      type: 'room_update',
      roomId: roomState ? roomState.code : '',
      selfId: selfId,
      role: getSelfRole(),
      players: getRoomPlayers(),
      spectators: getRoomSpectators(),
      gameState: roomState ? roomState.gameState : null
    });
  }

  function copyRoomCode() {
    var code = roomState && roomState.code ? roomState.code : App.Signaling.getRoomCode();
    if (!code) return;
    navigator.clipboard.writeText(code).then(function() {
      App.Common.showToast('已複製房間碼', 'success');
    }).catch(function() {
      App.Common.showToast(code, 'success');
    });
  }

  function watchRoomAsHost() {
    App.Signaling.watchRoom(function(state) {
      if (!state) {
        App.Common.showToast('房間已關閉', 'error');
        goHome();
        return;
      }
      roomState = state;
      notifyRoomUpdateToGame();
      maybeLaunchRoomGameFromState();
      if (!gameActive) renderRoomLobby();
      ensureHostOffers();
    });
    App.Signaling.watchAnswers(function(peerId, answer) {
      var version = answer && (answer.connectionVersion || answer.createdAt || 0);
      if (!answer || !answer.sdp || peerAnswers[peerId] === version) return;
      peerAnswers[peerId] = version;
      App.WebRTC.acceptPeerAnswer(peerId, answer.sdp).catch(function(e) {
        App.Common.showToast('連線回應失敗：' + e.message, 'error');
        peerAnswers[peerId] = null;
      });
    });
    App.Signaling.watchGameActions(function(actionId, action) {
      if (roomActionIds[actionId] || !action || !action.payload) return;
      if (roomState && action.roundId && action.roundId !== roomState.roundId) return;
      roomActionIds[actionId] = true;
      App.GameManager.handleMessage(action.payload);
      App.WebRTC.broadcast({ type: 'game_msg', payload: action.payload }, action.from);
    });
  }

  function watchRoomAsGuest() {
    App.Signaling.watchRoom(function(state) {
      if (!state) {
        App.Common.showToast('房間已關閉', 'error');
        goHome();
        return;
      }
      roomState = state;
      notifyRoomUpdateToGame();
      maybeLaunchRoomGameFromState();
      if (!gameActive) renderRoomLobby();
    });
    App.Signaling.watchOffers(function(offer) {
      var version = offer && (offer.connectionVersion || offer.createdAt || 0);
      if (!offer || !offer.sdp || peerAnswers[selfId] === version) return;
      peerAnswers[selfId] = version;
      App.WebRTC.createPeerAnswer(roomState.hostId || 'host', offer.sdp).then(function(answer) {
        return App.Signaling.setAnswer(answer, version);
      }).catch(function(e) {
        App.Common.showToast('房間連線失敗：' + e.message, 'error');
        peerAnswers[selfId] = null;
      });
    });
  }

  function ensureHostOffers() {
    if (!isHost || !roomState) return;
    var people = getRoomPlayers().concat(getRoomSpectators());
    people.forEach(function(person) {
      var version = person.connectionVersion || 0;
      if (person.id === selfId || person.online === false) return;
      if (peerOffers[person.id] === version) return;
      peerOffers[person.id] = version;
      App.WebRTC.createPeerOffer(person.id).then(function(offer) {
        return App.Signaling.setOffer(person.id, offer, version);
      }).catch(function(e) {
        App.Common.showToast('建立玩家連線失敗：' + e.message, 'error');
        peerOffers[person.id] = null;
      });
    });
  }

  async function createShortRoom() {
    var input = document.getElementById('room-player-name-input');
    playerName = requireUsername(input ? input.value : '');
    if (!playerName) return;
    if (!App.Signaling.isConfigured()) {
      App.Common.showToast('Firebase 尚未設定，請先填寫 js/firebaseConfig.js', 'error');
      return;
    }
    try {
      var room = await App.Signaling.createRoom(playerName);
      playContext = 'room';
      isHost = true;
      selfId = room.selfId;
      peerOffers = {};
      peerAnswers = {};
      roomActionIds = {};
      saveRoomSession(room);
      watchRoomAsHost();
      setTitle('房間 ' + room.code);
      App.Common.showToast('房間已建立', 'success');
    } catch (e) {
      App.Common.showToast(e.message, 'error');
    }
  }

  async function joinShortRoom() {
    var nameInput = document.getElementById('room-player-name-input');
    var codeInput = document.getElementById('room-code-input');
    playerName = requireUsername(nameInput ? nameInput.value : '');
    if (!playerName) return;
    var code = getRoomCodeInput();
    if (codeInput) codeInput.value = code;
    if (code.length !== 4) {
      App.Common.showToast('請輸入 4 位房間碼', 'error');
      return;
    }
    if (!App.Signaling.isConfigured()) {
      App.Common.showToast('Firebase 尚未設定，請先填寫 js/firebaseConfig.js', 'error');
      return;
    }
    try {
      var room = await App.Signaling.joinRoom(code, playerName);
      playContext = 'room';
      isHost = false;
      selfId = room.selfId;
      roomRole = room.role;
      peerAnswers = {};
      roomActionIds = {};
      saveRoomSession(room);
      watchRoomAsGuest();
      setTitle('房間 ' + room.code);
    } catch (e) {
      App.Common.showToast(e.message, 'error');
    }
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
      selectTitle.textContent = playContext === 'single' ? '選擇本機遊戲' : '選擇房間遊戲';
    }
    showScreen('game-select');
  }

  function onGameSelected(gameId) {
    selectedGameId = gameId;
    if (playContext === 'single') {
      launchSingleGame(gameId);
      return;
    }

    var hostAllowed = playContext === 'room' ? isHost : App.WebRTC.getIsHost();
    if (!hostAllowed) return;
    var game = App.GameManager.getGame(gameId);
    var modes = game && game.multiplayerModes ? game.multiplayerModes : ['coop'];
    if (playContext === 'multiplayer') App.WebRTC.send({ type: 'game_select', gameId: gameId });
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

  function rebalanceRoomForGame(gameId) {
    if (!roomState) return Promise.resolve();
    var maxPlayers = getGameMaxPlayers(gameId);
    var ordered = getRoomPlayers().concat(getRoomSpectators()).filter(function(person) {
      return person.online !== false;
    });
    var updates = {};
    ordered.forEach(function(person, index) {
      var target = index < maxPlayers ? 'players' : 'spectators';
      var other = target === 'players' ? 'spectators' : 'players';
      var record = {
        name: person.name || '玩家',
        role: target === 'players' ? 'player' : 'spectator',
        online: person.online !== false,
        authUid: person.authUid || '',
        joinedAt: person.joinedAt || Date.now(),
        lastSeenAt: person.lastSeenAt || Date.now(),
        connectionVersion: person.connectionVersion || 0
      };
      updates[other + '/' + person.id] = null;
      updates[target + '/' + person.id] = record;
    });
    updates.maxPlayers = maxPlayers;
    return App.Signaling.updateRoom(updates).then(function() {
      return {
        players: ordered.slice(0, maxPlayers).map(function(person) {
          return {
            id: person.id,
            name: person.name,
            role: 'player',
            online: person.online !== false,
            authUid: person.authUid || '',
            joinedAt: person.joinedAt || Date.now(),
            lastSeenAt: person.lastSeenAt || Date.now(),
            connectionVersion: person.connectionVersion || 0
          };
        }),
        spectators: ordered.slice(maxPlayers).map(function(person) {
          return {
            id: person.id,
            name: person.name,
            role: 'spectator',
            online: person.online !== false,
            authUid: person.authUid || '',
            joinedAt: person.joinedAt || Date.now(),
            lastSeenAt: person.lastSeenAt || Date.now(),
            connectionVersion: person.connectionVersion || 0
          };
        }),
        maxPlayers: maxPlayers
      };
    });
  }

  function makeRoundId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function buildRoomStart(gameId, mode, seating) {
    var game = App.GameManager.getGame(gameId);
    var roles = {};
    seating.players.forEach(function(person) { roles[person.id] = 'player'; });
    seating.spectators.forEach(function(person) { roles[person.id] = 'spectator'; });
    var initialState = {};
    if (game && typeof game.buildRoomStart === 'function') {
      initialState = game.buildRoomStart({
        gameId: gameId,
        mode: mode,
        hostId: selfId,
        players: seating.players,
        spectators: seating.spectators
      }) || {};
    }
    return {
      gameId: gameId,
      mode: mode,
      roundId: makeRoundId(),
      hostId: selfId,
      players: seating.players,
      spectators: seating.spectators,
      rolesByClientId: roles,
      initialState: initialState
    };
  }

  function selectMultiplayerMode(mode) {
    if (!selectedGameId) return;
    if (playContext === 'room') {
      if (!isHost) return;
      var roomStart = null;
      App.Signaling.updateRoom({ status: 'starting' }).then(function() {
        return rebalanceRoomForGame(selectedGameId);
      }).then(function(seating) {
        roomStart = buildRoomStart(selectedGameId, mode, seating);
        return App.Signaling.updateRoom({
          status: 'playing',
          gameId: selectedGameId,
          mode: mode,
          roundId: roomStart.roundId,
          gameStart: roomStart,
          gameState: null,
          gameActions: null
        });
      }).then(function() {
        var payload = makeGameStartPayload(roomStart);
        if (!gameActive) launchRoomGame(selectedGameId, mode, payload);
      }).catch(function(e) {
        App.Common.showToast('開始遊戲失敗：' + e.message, 'error');
        App.Signaling.updateRoom({ status: 'lobby' });
      });
      return;
    }

    if (!App.WebRTC.getIsHost()) return;
    App.WebRTC.send({ type: 'mode_select', mode: mode });
    App.WebRTC.send({ type: 'game_start', gameId: selectedGameId, mode: mode });
    launchMultiplayerGame(selectedGameId, mode);
  }

  function makeGameStartPayload(roomStart) {
    var start = roomStart || (roomState && roomState.gameStart) || {};
    var roles = start.rolesByClientId || {};
    return {
      roomId: roomState ? roomState.code : '',
      hostId: start.hostId || (roomState ? roomState.hostId : ''),
      selfId: selfId,
      players: start.players || getRoomPlayers(),
      spectators: start.spectators || getRoomSpectators(),
      role: roles[selfId] || getSelfRole(),
      gameId: start.gameId || (roomState ? roomState.gameId : ''),
      mode: start.mode || (roomState ? roomState.mode : ''),
      roundId: start.roundId || (roomState ? roomState.roundId : ''),
      initialState: start.initialState || {},
      gameState: roomState && roomState.gameState && roomState.gameState.roundId === start.roundId ? roomState.gameState : null,
      initialCode: start.initialState && start.initialState.computerCode ? start.initialState.computerCode : null
    };
  }

  function makeGameOpts(mode, extra) {
    var players = extra && extra.players ? extra.players : [];
    var spectators = extra && extra.spectators ? extra.spectators : [];
    var peerName = opponentName || '對方';
    if (players.length > 1) {
      var other = players.filter(function(p) { return p.id !== selfId; })[0];
      if (other) peerName = other.name || peerName;
    }
    return {
      mode: mode,
      isHost: isHost,
      role: (extra && extra.role) || 'player',
      roomId: extra && extra.roomId ? extra.roomId : '',
      selfId: selfId,
      players: players,
      spectators: spectators,
      playerName: getSelfName(),
      opponentName: peerName,
      initialState: extra && extra.initialState ? extra.initialState : {},
      gameState: extra && extra.gameState ? extra.gameState : null,
      initialCode: extra && extra.initialCode ? extra.initialCode : null,
      roundId: extra && extra.roundId ? extra.roundId : ''
    };
  }

  function launchSingleGame(gameId) {
    showScreen('game');
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    App.GameManager.startGame(gameId, container, {
      mode: 'single',
      isHost: true,
      role: 'player',
      playerName: playerName || '玩家',
      opponentName: '',
      players: [],
      spectators: []
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
      role: 'player',
      playerName: playerName || '玩家',
      opponentName: opponentName || '對方',
      players: [],
      spectators: []
    }, function() {
      gameActive = false;
      if (App.WebRTC.isConnected() && isHost) showGameSelect('multiplayer');
      else if (App.WebRTC.isConnected()) showWaiting();
      else goHome();
    });
  }

  function launchRoomGame(gameId, mode, roomPayload) {
    var payload = roomPayload || makeGameStartPayload(roomState && roomState.gameStart);
    roomRole = payload.role || getSelfRole();
    showScreen('game');
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    launchedRoomGameKey = payload.roundId || (gameId + ':' + mode + ':' + (roomState && roomState.updatedAt || ''));
    App.GameManager.startGame(gameId, container, makeGameOpts(mode, payload), function() {
      gameActive = false;
      if (playContext === 'room') {
        if (isHost) {
          App.Signaling.updateRoom({ status: 'lobby', gameId: '', mode: '', roundId: '', gameStart: null, gameState: null });
        }
        renderRoomLobby();
      } else {
        goHome();
      }
    });
  }

  function maybeLaunchRoomGameFromState() {
    if (!roomState || gameActive) return;
    if (roomState.status !== 'playing' || !roomState.gameStart || !roomState.gameStart.gameId || !roomState.gameStart.mode) return;
    var key = roomState.gameStart.roundId || (roomState.gameStart.gameId + ':' + roomState.gameStart.mode + ':' + (roomState.updatedAt || ''));
    if (launchedRoomGameKey === key) return;
    launchRoomGame(roomState.gameStart.gameId, roomState.gameStart.mode, makeGameStartPayload(roomState.gameStart));
  }

  async function startHost() {
    playerName = requireUsername(document.getElementById('player-name-input').value);
    if (!playerName) return;
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
    playerName = requireUsername(document.getElementById('player-name-input').value);
    if (!playerName) return;
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
    if (playContext === 'room') {
      notifyRoomUpdateToGame();
      return;
    }
    playContext = 'multiplayer';
    App.WebRTC.send({ type: 'player_info', name: playerName });
    if (App.WebRTC.getIsHost()) {
      showGameSelect('multiplayer');
    } else {
      showWaiting();
    }
  }

  function onConnectionClose() {
    if (playContext === 'room') return;
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
    if (playContext === 'room' && isHost && msg._from && msg.type === 'game_msg') {
      App.WebRTC.broadcast(stripInternalFields(msg), msg._from);
    }
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
        if (playContext === 'room') return;
        selectedGameId = msg.gameId;
        launchMultiplayerGame(msg.gameId, msg.mode);
        break;
      case 'game_msg':
        App.GameManager.handleMessage(msg.payload);
        break;
    }
  }

  function stripInternalFields(msg) {
    var copy = {};
    Object.keys(msg).forEach(function(key) {
      if (key.charAt(0) !== '_') copy[key] = msg[key];
    });
    return copy;
  }

  function goHome() {
    if (playContext === 'room') clearRoomSession();
    if (playContext === 'room') App.Signaling.leave();
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
    roomState = null;
    selfId = '';
    roomRole = 'player';
    peerOffers = {};
    peerAnswers = {};
    roomActionIds = {};
    launchedRoomGameKey = '';
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

    var roomCodeInput = document.getElementById('room-code-input');
    if (roomCodeInput) {
      roomCodeInput.addEventListener('input', function() {
        roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
      });
    }

    window.addEventListener('beforeunload', function(e) {
      if (playContext === 'room') App.Signaling.leave();
      if (playContext !== 'room' && App.WebRTC.isConnected() && gameActive) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    attemptRoomResume();
  }

  function sendRoomGameAction(payload) {
    if (playContext !== 'room' || !payload || !roomState || !roomState.roundId) return false;
    if (!App.Signaling || !App.Signaling.sendGameAction) return false;
    App.Signaling.sendGameAction({
      roundId: roomState.roundId,
      gameId: roomState.gameId || '',
      mode: roomState.mode || '',
      payload: payload
    }).catch(function(e) {
      App.Common.showToast('同步動作失敗：' + e.message, 'error');
    });
    return true;
  }

  function attemptRoomResume() {
    if (!App.RoomSession || !App.Signaling || !App.Signaling.isConfigured()) return;
    var ticket = App.RoomSession.get();
    if (!ticket) return;
    setTitle('恢復房間...');
    App.Signaling.resumeRoom(ticket).then(function(room) {
      playContext = 'room';
      isHost = !!room.isHost;
      selfId = room.selfId;
      playerName = ticket.username;
      roomRole = room.role;
      peerOffers = {};
      peerAnswers = {};
      roomActionIds = {};
      launchedRoomGameKey = '';
      saveRoomSession(room);
      if (isHost) watchRoomAsHost();
      else watchRoomAsGuest();
      setTitle('房間 ' + room.code);
      App.Common.showToast('已返回房間 ' + room.code, 'success');
    }).catch(function(e) {
      clearRoomSession();
      setTitle('');
      App.Common.showToast('未能恢復房間：' + e.message, 'error');
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
    createShortRoom: createShortRoom,
    joinShortRoom: joinShortRoom,
    copyRoomCode: copyRoomCode,
    goHome: goHome,
    launchMultiplayerGame: launchMultiplayerGame,
    sendRoomGameAction: sendRoomGameAction,
    setTitle: setTitle
  };
})();

window.App = App;
