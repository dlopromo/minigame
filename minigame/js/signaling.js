var App = window.App || {};

App.Signaling = (function() {
  var app = null;
  var auth = null;
  var db = null;
  var roomCode = '';
  var selfId = '';
  var clientId = '';
  var authUid = '';
  var selfRole = '';
  var isHost = false;
  var unsubscribers = [];
  var heartbeatTimer = null;
  var ROOM_TTL_MS = 6 * 60 * 60 * 1000;
  var CODE_DIGITS = '0123456789';

  function isConfigured() {
    var cfg = App.FirebaseConfig || {};
    return !!(window.firebase && cfg.apiKey && cfg.databaseURL && cfg.projectId && cfg.appId);
  }

  function initFirebase() {
    if (!isConfigured()) {
      return Promise.reject(new Error('Firebase 尚未設定，請先填寫 js/firebaseConfig.js'));
    }
    if (!app) {
      app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(App.FirebaseConfig);
      auth = firebase.auth();
      db = firebase.database();
    }
    if (auth.currentUser) {
      authUid = auth.currentUser.uid;
      selfId = getClientId(authUid);
      return Promise.resolve(selfId);
    }
    return auth.signInAnonymously().then(function(result) {
      authUid = result.user.uid;
      selfId = getClientId(authUid);
      return selfId;
    });
  }

  function getClientId(uid) {
    if (clientId) return clientId;
    var ticket = App.RoomSession && App.RoomSession.get ? App.RoomSession.get() : null;
    if (ticket && /^[A-Za-z0-9-]{8,80}$/.test(ticket.clientId)) {
      clientId = ticket.clientId;
      try { window.localStorage.setItem('minigame.clientId', clientId); } catch(e) {}
      return clientId;
    }
    try {
      var stored = window.localStorage.getItem('minigame.clientId');
      if (stored && /^[A-Za-z0-9-]{8,80}$/.test(stored)) {
        clientId = stored;
        return clientId;
      }
    } catch(e) {}
    var randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    clientId = uid.slice(0, 8) + '-' + randomPart;
    try { window.localStorage.setItem('minigame.clientId', clientId); } catch(e) {}
    return clientId;
  }

  function ref(path) {
    return db.ref(path);
  }

  function onValue(path, fn) {
    var r = ref(path);
    r.on('value', fn);
    unsubscribers.push(function() { r.off('value', fn); });
  }

  function onChildAdded(path, fn) {
    var r = ref(path);
    r.on('child_added', fn);
    unsubscribers.push(function() { r.off('child_added', fn); });
  }

  function offAll() {
    unsubscribers.forEach(function(fn) { try { fn(); } catch(e) {} });
    unsubscribers = [];
  }

  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function registerPresenceDisconnect(path) {
    ref(path).onDisconnect().update({
      online: false,
      lastSeenAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function startHeartbeat(path) {
    stopHeartbeat();
    heartbeatTimer = setInterval(function() {
      if (!roomCode || !selfId) return;
      ref(path).update({
        online: true,
        lastSeenAt: firebase.database.ServerValue.TIMESTAMP
      }).catch(function() {});
    }, 15000);
  }

  function makeCode() {
    var code = '';
    for (var i = 0; i < 4; i++) {
      code += CODE_DIGITS[Math.floor(Math.random() * CODE_DIGITS.length)];
    }
    return code;
  }

  function normalizeRoomCode(code) {
    return String(code || '').replace(/\D/g, '').slice(0, 4);
  }

  function requireRoomCode(code) {
    var normalized = normalizeRoomCode(code);
    if (normalized.length !== 4) throw new Error('請輸入 4 位房間碼');
    return normalized;
  }

  function requireUsername(username) {
    var name = String(username || '').trim().slice(0, 12);
    if (!name) throw new Error('請輸入你的名字');
    if (!/^[A-Za-z0-9\u4e00-\u9fff]+$/.test(name)) {
      throw new Error('名字只可使用中文、英文或數字');
    }
    return name;
  }

  function requireClientId(id) {
    var value = String(id || '');
    if (!/^[A-Za-z0-9-]{8,80}$/.test(value)) throw new Error('房間身份已失效，請重新加入');
    return value;
  }

  function normalizeRoom(snapshot) {
    var data = snapshot.val() || {};
    data.code = snapshot.key || roomCode;
    data.members = data.members || {};
    data.queue = data.queue || {};
    data.chat = data.chat || {};
    data.players = data.players || {};
    data.spectators = data.spectators || {};
    data.gameActions = data.gameActions || {};
    data.gameStart = data.gameStart || null;
    data.gameState = data.gameState || null;
    data.currentRound = data.currentRound || null;
    data.history = data.history || {};
    data.leaderboard = data.leaderboard || {};
    data.hostEpoch = Number(data.hostEpoch || 0);
    return data;
  }

  function memberRecord(username, role, extra) {
    extra = extra || {};
    return {
      name: username,
      role: role || 'member',
      online: true,
      authUid: authUid,
      presence: extra.presence || 'lobby',
      queueStatus: extra.queueStatus || 'none',
      joinedAt: extra.joinedAt || firebase.database.ServerValue.TIMESTAMP,
      lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
      connectionVersion: extra.connectionVersion || 1
    };
  }

  function emptyRoom(uid) {
    return {
      hostId: uid,
      hostEpoch: 1,
      status: 'lobby',
      gameId: '',
      mode: '',
      roundId: '',
      gameStart: null,
      gameState: null,
      currentRound: null,
      activeGameId: '',
      activeMode: '',
      maxPlayers: 2,
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      members: {},
      queue: {},
      chat: {},
      players: {},
      spectators: {},
      history: {},
      leaderboard: {}
    };
  }

  function createRoom(username) {
    username = requireUsername(username);
    return initFirebase().then(function(uid) {
      isHost = true;
      var attempts = 0;
      function tryCreate() {
        attempts++;
        var code = makeCode();
        return ref('rooms/' + code).transaction(function(current) {
          if (current === null) {
            return emptyRoom(uid);
          }
          return;
        }).then(function(result) {
          if (!result.committed && attempts < 8) return tryCreate();
          if (!result.committed) throw new Error('房間碼碰撞，請再試一次');
          roomCode = code;
          selfRole = 'host';
          return ref('rooms/' + code + '/members/' + uid).set(memberRecord(username, 'host')).then(function() {
            var path = 'rooms/' + code + '/members/' + uid;
            registerPresenceDisconnect(path);
            startHeartbeat(path);
            return { code: code, selfId: uid, role: 'host', isHost: true, connectionVersion: 1 };
          });
        });
      }
      return cleanupExpiredRooms().then(tryCreate);
    });
  }

  function enterRoom(code, username) {
    username = requireUsername(username);
    return initFirebase().then(function(uid) {
      code = requireRoomCode(code);
      var createdRoom = false;
      return ref('rooms/' + code).transaction(function(current) {
        if (current === null || (current && current.status === 'closed')) {
          createdRoom = true;
          return emptyRoom(uid);
        }
        createdRoom = false;
        return current;
      }).then(function() {
        return ref('rooms/' + code).once('value');
      }).then(function(snapshot) {
        var data = normalizeRoom(snapshot);
        var now = Date.now();
        if (data.createdAt && now - data.createdAt > ROOM_TTL_MS) throw new Error('房間已過期');
        roomCode = code;
        isHost = data.hostId === uid;
        var role = isHost ? 'host' : 'member';
        if (createdRoom) {
          isHost = true;
          role = 'host';
        }
        selfRole = role;
        var path = 'rooms/' + code + '/members/' + uid;
        var existing = data.members && data.members[uid] ? data.members[uid] : {};
        var version = Number(existing.connectionVersion || 0) + 1;
        return ref(path).set(memberRecord(username, role, {
          joinedAt: existing.joinedAt,
          presence: existing.presence || 'lobby',
          queueStatus: existing.queueStatus || 'none',
          connectionVersion: version
        })).then(function() {
          registerPresenceDisconnect(path);
          startHeartbeat(path);
          return { code: code, selfId: uid, role: role, isHost: isHost, connectionVersion: version, created: createdRoom };
        });
      });
    });
  }

  function joinRoom(code, username) {
    return enterRoom(code, username);
  }

  function resumeRoom(ticket) {
    if (!ticket) return Promise.reject(new Error('沒有可恢復的房間'));
    var code = requireRoomCode(ticket.roomCode);
    var username = requireUsername(ticket.username);
    var storedClientId = requireClientId(ticket.clientId);
    clientId = storedClientId;
    selfId = storedClientId;
    return initFirebase().then(function(uid) {
      selfId = uid;
      return ref('rooms/' + code).once('value');
    }).then(function(snapshot) {
      if (!snapshot.exists()) throw new Error('找不到房間');
      var data = normalizeRoom(snapshot);
      var now = Date.now();
      if (data.createdAt && now - data.createdAt > ROOM_TTL_MS) throw new Error('房間已過期');
      var memberRecord = data.members && data.members[selfId];
      if (!memberRecord) throw new Error('房間身份已失效，請重新加入');
      isHost = data.hostId === selfId;
      roomCode = code;
      var role = isHost ? 'host' : 'member';
      selfRole = role;
      var record = memberRecord || {};
      var path = 'rooms/' + code + '/members/' + selfId;
      var version = Number(record.connectionVersion || 0) + 1;
      return ref(path).update({
        name: username,
        role: role,
        online: true,
        authUid: authUid,
        lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
        connectionVersion: version
      }).then(function() {
        registerPresenceDisconnect(path);
        startHeartbeat(path);
        return {
          code: code,
          selfId: selfId,
          role: role,
          isHost: isHost,
          connectionVersion: version
        };
      });
    });
  }

  function selectHostCandidate(members) {
    var people = Object.keys(members || {}).map(function(id) {
      var member = members[id] || {};
      member.id = id;
      return member;
    }).filter(function(member) {
      return member.online !== false;
    }).sort(function(a, b) {
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
    return people.length ? people[0] : null;
  }

  function claimHost() {
    if (!roomCode || !selfId) return Promise.resolve(false);
    return ref('rooms/' + roomCode).transaction(function(current) {
      if (!current || !current.members || !current.members[selfId] || current.members[selfId].online === false) return current;
      var currentHost = current.members[current.hostId] || null;
      if (currentHost && currentHost.online !== false) return current;
      var candidate = selectHostCandidate(current.members);
      if (!candidate || candidate.id !== selfId) return current;
      current.hostId = selfId;
      current.hostEpoch = Number(current.hostEpoch || 0) + 1;
      current.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      Object.keys(current.members).forEach(function(id) {
        current.members[id].role = id === selfId ? 'host' : 'member';
      });
      if (current.gameStart) current.gameStart.hostId = selfId;
      return current;
    }).then(function(result) {
      if (!result.committed) return false;
      return ref('rooms/' + roomCode).once('value').then(function(snapshot) {
        var data = normalizeRoom(snapshot);
        isHost = data.hostId === selfId;
        selfRole = isHost ? 'host' : 'member';
        return isHost;
      });
    });
  }

  function cleanupExpiredRooms() {
    if (!db) return Promise.resolve();
    var cutoff = Date.now() - ROOM_TTL_MS;
    return ref('rooms').orderByChild('createdAt').endAt(cutoff).once('value').then(function(snapshot) {
      var updates = {};
      snapshot.forEach(function(child) {
        updates[child.key] = null;
      });
      if (Object.keys(updates).length === 0) return null;
      return ref('rooms').update(updates);
    });
  }

  function watchRoom(fn) {
    if (!roomCode) return;
    onValue('rooms/' + roomCode, function(snapshot) {
      fn(snapshot.exists() ? normalizeRoom(snapshot) : null);
    });
  }

  function watchGameActions(fn) {
    if (!roomCode) return;
    onChildAdded('rooms/' + roomCode + '/gameActions', function(snapshot) {
      var action = snapshot.val();
      if (!action || action.from === selfId) return;
      fn(snapshot.key, action);
    });
  }

  function updateRoom(values) {
    if (!roomCode) return Promise.resolve();
    values.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    return ref('rooms/' + roomCode).update(values);
  }

  function setQueueStatus(queued) {
    if (!roomCode || !selfId) return Promise.resolve();
    var updates = {};
    updates['members/' + selfId + '/queueStatus'] = queued ? 'queued' : 'none';
    updates['members/' + selfId + '/lastSeenAt'] = firebase.database.ServerValue.TIMESTAMP;
    if (!queued) updates['queue/' + selfId] = null;
    updates.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    return ref('rooms/' + roomCode).once('value').then(function(snapshot) {
      var data = normalizeRoom(snapshot);
      var member = data.members && data.members[selfId];
      if (queued) {
        updates['queue/' + selfId] = {
          name: member && member.name ? member.name : '玩家',
          queuedAt: firebase.database.ServerValue.TIMESTAMP
        };
      }
      return ref('rooms/' + roomCode).update(updates);
    });
  }

  function sendChat(text) {
    if (!roomCode || !selfId) return Promise.resolve();
    var value = String(text || '').trim().slice(0, 120);
    if (!value) return Promise.resolve();
    return ref('rooms/' + roomCode).once('value').then(function(snapshot) {
      var data = normalizeRoom(snapshot);
      var member = data.members && data.members[selfId];
      return ref('rooms/' + roomCode + '/chat').push({
        from: selfId,
        name: member && member.name ? member.name : '玩家',
        text: value,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
    });
  }

  function setGameState(snapshot) {
    if (!roomCode || !snapshot) return Promise.resolve();
    snapshot.updatedBy = selfId;
    snapshot.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    return ref('rooms/' + roomCode + '/gameState').set(snapshot);
  }

  function appendHistory(entry) {
    if (!roomCode || !entry) return Promise.resolve();
    entry.createdAt = firebase.database.ServerValue.TIMESTAMP;
    entry.createdBy = selfId;
    return ref('rooms/' + roomCode + '/history').push(entry);
  }

  function updateLeaderboard(updates) {
    if (!roomCode || !updates) return Promise.resolve();
    return ref('rooms/' + roomCode + '/leaderboard').update(updates);
  }

  function addLeaderboardResults(results) {
    if (!roomCode || !results || !results.length) return Promise.resolve();
    return ref('rooms/' + roomCode + '/leaderboard').transaction(function(current) {
      current = current || {};
      results.forEach(function(result) {
        if (!result || !result.id || /^ai-/.test(result.id)) return;
        var row = current[result.id] || { name: result.name || '玩家', score: 0, wins: 0, plays: 0 };
        row.name = result.name || row.name || '玩家';
        row.score = Number(row.score || 0) + Number(result.score || 0);
        row.wins = Number(row.wins || 0) + (result.win ? 1 : 0);
        row.plays = Number(row.plays || 0) + 1;
        row.lastPlayedAt = firebase.database.ServerValue.TIMESTAMP;
        current[result.id] = row;
      });
      return current;
    });
  }

  function sendGameAction(action) {
    if (!roomCode || !action) return Promise.resolve();
    action.from = selfId;
    action.createdAt = firebase.database.ServerValue.TIMESTAMP;
    return ref('rooms/' + roomCode + '/gameActions').push(action);
  }

  function clearGameAction(actionId) {
    if (!roomCode || !actionId) return Promise.resolve();
    return ref('rooms/' + roomCode + '/gameActions/' + actionId).remove();
  }

  function leave() {
    var code = roomCode;
    var uid = selfId;
    var role = selfRole;
    offAll();
    stopHeartbeat();
    roomCode = '';
    selfRole = '';
    if (!db || !code || !uid || !role) return Promise.resolve();
    return ref('rooms/' + code + '/members/' + uid).update({
      online: false,
      presence: 'lobby',
      lastSeenAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function getRoomCode() { return roomCode; }
  function getSelfId() { return selfId; }
  function getAuthUid() { return authUid; }
  function getIsHost() { return isHost; }

  return {
    isConfigured: isConfigured,
    initFirebase: initFirebase,
    createRoom: createRoom,
    enterRoom: enterRoom,
    joinRoom: joinRoom,
    resumeRoom: resumeRoom,
    watchRoom: watchRoom,
    watchGameActions: watchGameActions,
    claimHost: claimHost,
    updateRoom: updateRoom,
    setQueueStatus: setQueueStatus,
    sendChat: sendChat,
    setGameState: setGameState,
    appendHistory: appendHistory,
    updateLeaderboard: updateLeaderboard,
    addLeaderboardResults: addLeaderboardResults,
    sendGameAction: sendGameAction,
    clearGameAction: clearGameAction,
    leave: leave,
    normalizeRoomCode: normalizeRoomCode,
    requireRoomCode: requireRoomCode,
    requireUsername: requireUsername,
    getRoomCode: getRoomCode,
    getSelfId: getSelfId,
    getAuthUid: getAuthUid,
    getIsHost: getIsHost
  };
})();

window.App = App;
