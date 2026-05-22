var App = window.App || {};

App.Lobby = (function() {
  var playContext = null;
  var selectedGameId = null;
  var playerName = '';
  var isHost = false;
  var gameActive = false;
  var roomState = null;
  var selfId = '';
  var roomRole = 'member';
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

    showRoomConnect();
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

  function getRoomMembers() {
    return getPeople(roomState && roomState.members);
  }

  function getRoomQueue() {
    var queue = roomState && roomState.queue ? roomState.queue : {};
    var members = roomState && roomState.members ? roomState.members : {};
    return Object.keys(queue).map(function(id) {
      var item = queue[id] || {};
      var member = members[id] || {};
      return {
        id: id,
        name: item.name || member.name || '玩家',
        queuedAt: item.queuedAt || 0,
        online: member.online !== false,
        role: member.role || 'member',
        presence: member.presence || 'lobby',
        queueStatus: 'queued'
      };
    }).filter(function(person) {
      return person.online !== false;
    }).sort(function(a, b) {
      return (a.queuedAt || 0) - (b.queuedAt || 0);
    });
  }

  function getRoomPlayers() {
    if (roomState && roomState.gameStart && roomState.gameStart.players) return roomState.gameStart.players;
    return [];
  }

  function getRoomSpectators() {
    if (roomState && roomState.gameStart && roomState.gameStart.spectators) return roomState.gameStart.spectators;
    return getRoomMembers().filter(function(person) {
      return !(roomState && roomState.queue && roomState.queue[person.id]);
    });
  }

  function getGameMaxPlayers(gameId) {
    var game = App.GameManager.getGame(gameId);
    return (game && game.maxPlayers) || 2;
  }

  function getGameMinRoomPlayers(gameId) {
    var game = App.GameManager.getGame(gameId);
    return (game && (game.minRoomPlayers || game.minPlayers)) || 1;
  }

  function getSelfRole() {
    if (!roomState || !selfId) return 'member';
    if (roomState.gameStart && roomState.gameStart.rolesByClientId && roomState.gameStart.rolesByClientId[selfId]) {
      return roomState.gameStart.rolesByClientId[selfId];
    }
    if (roomState.members && roomState.members[selfId]) return roomState.members[selfId].role || 'member';
    return 'spectator';
  }

  function getSelfName() {
    if (!roomState || !selfId) return playerName;
    var record = roomState.members && roomState.members[selfId];
    return (record && record.name) || playerName;
  }

  function isSelfQueued() {
    return !!(roomState && roomState.queue && roomState.queue[selfId]);
  }

  function renderRoomDebug() {
    if (!roomState) return;
    var status = document.getElementById('room-status-pill');
    var transport = document.getElementById('room-transport-pill');
    var round = document.getElementById('room-round-label');
    var queueLabel = document.getElementById('room-queue-label');
    var actions = document.getElementById('room-actions-label');
    var host = document.getElementById('room-host-label');
    var statusMap = { lobby: 'Party', starting: 'Starting', playing: 'Playing', result: 'Result' };
    var actionCount = Object.keys(roomState.gameActions || {}).length;

    if (status) status.textContent = statusMap[roomState.status] || (roomState.status || 'Party');
    if (transport) transport.textContent = 'Firebase';
    if (round) round.textContent = roomState.roundId ? roomState.roundId.slice(-8) : '未開始';
    if (queueLabel) queueLabel.textContent = getRoomQueue().length + ' 人';
    if (actions) actions.textContent = String(actionCount);
    if (host) {
      var hostRecord = roomState.members && roomState.members[roomState.hostId];
      host.textContent = hostRecord && hostRecord.name ? hostRecord.name : '未知';
    }
  }

  function renderPeople(targetId, people, options) {
    options = options || {};
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
      var meta = person.online === false ? '離線' : (options.queue || person.queueStatus === 'queued' ? '隊列中' : person.presence === 'playing' ? '遊戲中' : '觀戰 / 房間中');
      info.appendChild(el('div', 'room-person-meta', meta));
      var badges = el('div');
      badges.className = 'room-person-badges';
      if (roomState && person.id === roomState.hostId) badges.appendChild(el('span', 'room-badge host', '房主'));
      if (person.id === selfId) badges.appendChild(el('span', 'room-badge self', '你'));
      if (options.queue || person.queueStatus === 'queued') badges.appendChild(el('span', 'room-badge queue', '排隊'));
      if (person.isAI) badges.appendChild(el('span', 'room-badge ai', 'AI'));
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
      if (roomRole === 'host') roleText = '房主';
      if (roomRole === 'member') roleText = isSelfQueued() ? '隊列中' : '觀戰';
      var statusText = roomState.status === 'playing'
        ? '遊戲進行中'
        : roomState.status === 'starting'
          ? '遊戲準備中'
          : 'Party Room';
      roleLabel.textContent = '你目前是：' + roleText + '　' + statusText;
    }
    renderPeople('room-player-list', getRoomMembers());
    renderPeople('room-spectator-list', getRoomQueue(), { queue: true });
    renderRoomChat();
    renderRoomDebug();
    var actions = document.getElementById('room-host-actions');
    if (actions) actions.style.display = isHost ? 'block' : 'none';
    var queueBtn = document.getElementById('room-queue-toggle');
    if (queueBtn) {
      queueBtn.textContent = isSelfQueued() ? '離開隊列' : '加入隊列';
      queueBtn.className = isSelfQueued() ? 'btn btn-secondary' : 'btn btn-primary';
    }
    showScreen('room-lobby');
  }

  function renderRoomChat() {
    var target = document.getElementById('room-chat-list');
    if (!target || !roomState) return;
    var messages = getPeople(roomState.chat).sort(function(a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    }).slice(-60);
    target.innerHTML = messages.length ? '' : '<p class="room-list-empty">未有訊息</p>';
    messages.forEach(function(msg) {
      var row = el('div', 'room-chat-message');
      row.appendChild(el('strong', '', msg.name || '玩家'));
      row.appendChild(el('span', '', msg.text || ''));
      target.appendChild(row);
    });
    target.scrollTop = target.scrollHeight;
  }

  function notifyRoomUpdateToGame() {
    if (!gameActive || playContext !== 'room') return;
    var start = roomState && roomState.gameStart ? roomState.gameStart : null;
    App.GameManager.handleMessage({
      type: 'room_update',
      roomId: roomState ? roomState.code : '',
      selfId: selfId,
      role: getSelfRole(),
      players: start && start.players ? start.players : getRoomPlayers(),
      spectators: start && start.spectators ? start.spectators : getRoomSpectators(),
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
      if (gameActive && state.status !== 'playing') {
        App.GameManager.endGame();
        return;
      }
      notifyRoomUpdateToGame();
      maybeLaunchRoomGameFromState();
      if (!gameActive) renderRoomLobby();
    });
    App.Signaling.watchGameActions(function(actionId, action) {
      if (roomActionIds[actionId] || !action || !action.payload) return;
      if (roomState && action.roundId && action.roundId !== roomState.roundId) {
        if (App.Signaling.clearGameAction) App.Signaling.clearGameAction(actionId).catch(function() {});
        return;
      }
      roomActionIds[actionId] = true;
      App.GameManager.handleMessage(action.payload);
      if (App.Signaling.clearGameAction) App.Signaling.clearGameAction(actionId).catch(function(e) {
        App.Common.showToast('清理同步佇列失敗：' + e.message, 'error');
      });
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
      if (gameActive && state.status !== 'playing') {
        App.GameManager.endGame();
        return;
      }
      notifyRoomUpdateToGame();
      maybeLaunchRoomGameFromState();
      if (!gameActive) renderRoomLobby();
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

    var hostAllowed = playContext === 'room' ? isHost : false;
    if (!hostAllowed) return;
    var game = App.GameManager.getGame(gameId);
    var modes = game && game.multiplayerModes ? game.multiplayerModes : ['coop'];
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
    var game = App.GameManager.getGame(gameId);
    var members = getRoomMembers().filter(function(person) { return person.online !== false; });
    var queue = getRoomQueue();
    var seatedRealPlayers = queue.slice(0, maxPlayers);
    var seatedIds = {};
    seatedRealPlayers.forEach(function(person) { seatedIds[person.id] = true; });
    var spectators = members.filter(function(person) { return !seatedIds[person.id]; });
    var gamePlayers = seatedRealPlayers.map(function(person) {
      return {
        id: person.id,
        name: person.name,
        role: 'player',
        isAI: false,
        online: person.online !== false,
        authUid: person.authUid || '',
        joinedAt: person.joinedAt || Date.now(),
        lastSeenAt: person.lastSeenAt || Date.now(),
        connectionVersion: person.connectionVersion || 0
      };
    });
    if (game && game.aiFill) {
      while (gamePlayers.length < maxPlayers) {
        var aiNumber = gamePlayers.length + 1;
        gamePlayers.push({
          id: 'ai-' + aiNumber,
          name: 'AI ' + aiNumber,
          role: 'player',
          isAI: true,
          online: true,
          joinedAt: Date.now(),
          lastSeenAt: Date.now(),
          connectionVersion: 0
        });
      }
    }
    var updates = { players: null, spectators: null };
    members.forEach(function(person) {
      updates['members/' + person.id + '/presence'] = seatedIds[person.id] ? 'playing' : 'spectating';
    });
    updates.maxPlayers = maxPlayers;
    return App.Signaling.updateRoom(updates).then(function() {
      return {
        players: gamePlayers,
        spectators: spectators.map(function(person) {
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
      var realPlayerCount = getRoomQueue().length;
      var game = App.GameManager.getGame(selectedGameId);
      var minRoomPlayers = getGameMinRoomPlayers(selectedGameId);
      if (realPlayerCount < minRoomPlayers) {
        App.Common.showToast('這個玩法需要至少 ' + minRoomPlayers + ' 位玩家加入隊列', 'error');
        return;
      }
      var roomStart = null;
      App.Signaling.updateRoom({ status: 'starting' }).then(function() {
        return rebalanceRoomForGame(selectedGameId);
      }).then(function(seating) {
        roomStart = buildRoomStart(selectedGameId, mode, seating);
        return App.Signaling.updateRoom({
          status: 'playing',
          gameId: selectedGameId,
          mode: mode,
          activeGameId: selectedGameId,
          activeMode: mode,
          roundId: roomStart.roundId,
          gameStart: roomStart,
          currentRound: {
            gameId: selectedGameId,
            mode: mode,
            roundId: roomStart.roundId,
            players: seating.players,
            spectators: seating.spectators,
            startedAt: Date.now()
          },
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
    var otherName = '對方';
    if (players.length > 1) {
      var other = players.filter(function(p) { return p.id !== selfId; })[0];
      if (other) otherName = other.name || otherName;
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
      opponentName: otherName,
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
          var updates = {
            status: 'lobby',
            gameId: '',
            mode: '',
            activeGameId: '',
            activeMode: '',
            roundId: '',
            gameStart: null,
            gameState: null,
            currentRound: null,
            gameActions: null
          };
          getRoomMembers().forEach(function(person) {
            updates['members/' + person.id + '/presence'] = 'lobby';
          });
          App.Signaling.updateRoom(updates);
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

  function goHome() {
    if (playContext === 'room') clearRoomSession();
    if (playContext === 'room') App.Signaling.leave();
    if (gameActive) {
      App.GameManager.endGame();
      gameActive = false;
    }
    playContext = null;
    selectedGameId = null;
    playerName = '';
    isHost = false;
    roomState = null;
    selfId = '';
    roomRole = 'member';
    roomActionIds = {};
    launchedRoomGameKey = '';
    setTitle('');
    showScreen('home');
  }

  function init() {
    var roomCodeInput = document.getElementById('room-code-input');
    if (roomCodeInput) {
      roomCodeInput.addEventListener('input', function() {
        roomCodeInput.value = normalizeRoomCode(roomCodeInput.value);
      });
    }
    var chatInput = document.getElementById('room-chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          sendRoomChat();
        }
      });
    }

    window.addEventListener('beforeunload', function(e) {
      if (playContext === 'room') App.Signaling.leave();
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

  function toggleQueue() {
    if (playContext !== 'room' || !roomState || !App.Signaling || !App.Signaling.setQueueStatus) return;
    App.Signaling.setQueueStatus(!isSelfQueued()).catch(function(e) {
      App.Common.showToast('更新隊列失敗：' + e.message, 'error');
    });
  }

  function sendRoomChat() {
    var input = document.getElementById('room-chat-input');
    var text = input ? input.value : '';
    if (!String(text || '').trim()) return;
    App.Signaling.sendChat(text).then(function() {
      if (input) input.value = '';
    }).catch(function(e) {
      App.Common.showToast('送出訊息失敗：' + e.message, 'error');
    });
  }

  function backFromGameSelect() {
    if (playContext === 'room' && roomState) {
      renderRoomLobby();
    } else {
      goHome();
    }
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
    createShortRoom: createShortRoom,
    joinShortRoom: joinShortRoom,
    copyRoomCode: copyRoomCode,
    toggleQueue: toggleQueue,
    sendRoomChat: sendRoomChat,
    backFromGameSelect: backFromGameSelect,
    renderRoomLobby: renderRoomLobby,
    goHome: goHome,
    sendRoomGameAction: sendRoomGameAction,
    setTitle: setTitle
  };
})();

window.App = App;
