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
      return clientId;
    }
    var randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    clientId = uid.slice(0, 8) + '-' + randomPart;
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
    data.players = data.players || {};
    data.spectators = data.spectators || {};
    data.offers = data.offers || {};
    data.answers = data.answers || {};
    data.gameActions = data.gameActions || {};
    data.gameStart = data.gameStart || null;
    data.gameState = data.gameState || null;
    return data;
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
            return {
              hostId: uid,
              status: 'lobby',
              gameId: '',
              mode: '',
              roundId: '',
              gameStart: null,
              gameState: null,
              maxPlayers: 2,
              createdAt: firebase.database.ServerValue.TIMESTAMP,
              updatedAt: firebase.database.ServerValue.TIMESTAMP,
              players: {},
              spectators: {}
            };
          }
          return;
        }).then(function(result) {
          if (!result.committed && attempts < 8) return tryCreate();
          if (!result.committed) throw new Error('房間碼碰撞，請再試一次');
          roomCode = code;
          selfRole = 'player';
          return ref('rooms/' + code + '/players/' + uid).set({
            name: username,
            role: 'player',
            online: true,
            authUid: authUid,
            joinedAt: firebase.database.ServerValue.TIMESTAMP,
            lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
            connectionVersion: 1
          }).then(function() {
            ref('rooms/' + code + '/players/' + uid + '/online').onDisconnect().set(false);
            return { code: code, selfId: uid, role: 'player', isHost: true, connectionVersion: 1 };
          });
        });
      }
      return cleanupExpiredRooms().then(tryCreate);
    });
  }

  function joinRoom(code, username) {
    username = requireUsername(username);
    return initFirebase().then(function(uid) {
      isHost = false;
      code = requireRoomCode(code);
      return ref('rooms/' + code).once('value').then(function(snapshot) {
        if (!snapshot.exists()) throw new Error('找不到房間');
        var data = normalizeRoom(snapshot);
        var now = Date.now();
        if (data.createdAt && now - data.createdAt > ROOM_TTL_MS) throw new Error('房間已過期');
        roomCode = code;
        var playerCount = Object.keys(data.players || {}).length;
        var status = data.status || 'lobby';
        var maxPlayers = data.maxPlayers || 2;
        var role = status === 'lobby' && playerCount < maxPlayers ? 'player' : 'spectator';
        selfRole = role;
        var path = 'rooms/' + code + '/' + (role === 'player' ? 'players' : 'spectators') + '/' + uid;
        return ref(path).set({
          name: username,
          role: role,
          online: true,
          authUid: authUid,
          joinedAt: firebase.database.ServerValue.TIMESTAMP,
          lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
          connectionVersion: 1
        }).then(function() {
          ref(path + '/online').onDisconnect().set(false);
          return { code: code, selfId: uid, role: role, isHost: false, connectionVersion: 1 };
        });
      });
    });
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
      var playerRecord = data.players && data.players[selfId];
      var spectatorRecord = data.spectators && data.spectators[selfId];
      var role = playerRecord ? 'player' : spectatorRecord ? 'spectator' : '';
      if (!role) throw new Error('房間身份已失效，請重新加入');
      if (ticket.isHost && data.hostId !== selfId) throw new Error('房主身份已失效，請重新建立房間');
      isHost = data.hostId === selfId;
      roomCode = code;
      selfRole = role;
      var record = playerRecord || spectatorRecord || {};
      var path = 'rooms/' + code + '/' + (role === 'player' ? 'players' : 'spectators') + '/' + selfId;
      var version = Number(record.connectionVersion || 0) + 1;
      return ref(path).update({
        name: username,
        role: role,
        online: true,
        authUid: authUid,
        lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
        connectionVersion: version
      }).then(function() {
        ref(path + '/online').onDisconnect().set(false);
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

  function watchOffers(fn) {
    if (!roomCode || !selfId) return;
    onValue('rooms/' + roomCode + '/offers/' + selfId, function(snapshot) {
      if (snapshot.exists()) fn(snapshot.val());
    });
  }

  function watchAnswers(fn) {
    if (!roomCode) return;
    onValue('rooms/' + roomCode + '/answers', function(snapshot) {
      var answers = snapshot.val() || {};
      Object.keys(answers).forEach(function(peerId) {
        fn(peerId, answers[peerId]);
      });
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

  function setOffer(peerId, offer, connectionVersion) {
    return ref('rooms/' + roomCode + '/offers/' + peerId).set({
      from: selfId,
      sdp: offer,
      connectionVersion: connectionVersion || 0,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function setAnswer(answer, connectionVersion) {
    return ref('rooms/' + roomCode + '/answers/' + selfId).set({
      from: selfId,
      sdp: answer,
      connectionVersion: connectionVersion || 0,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function updateRoom(values) {
    if (!roomCode) return Promise.resolve();
    values.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    return ref('rooms/' + roomCode).update(values);
  }

  function setGameState(snapshot) {
    if (!roomCode || !snapshot) return Promise.resolve();
    snapshot.updatedBy = selfId;
    snapshot.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    return ref('rooms/' + roomCode + '/gameState').set(snapshot);
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
    roomCode = '';
    selfRole = '';
    if (!db || !code || !uid || !role) return Promise.resolve();
    var collection = role === 'spectator' ? 'spectators' : 'players';
    return ref('rooms/' + code + '/' + collection + '/' + uid + '/online').set(false);
  }

  function getRoomCode() { return roomCode; }
  function getSelfId() { return selfId; }
  function getAuthUid() { return authUid; }
  function getIsHost() { return isHost; }

  return {
    isConfigured: isConfigured,
    initFirebase: initFirebase,
    createRoom: createRoom,
    joinRoom: joinRoom,
    resumeRoom: resumeRoom,
    watchRoom: watchRoom,
    watchOffers: watchOffers,
    watchAnswers: watchAnswers,
    watchGameActions: watchGameActions,
    setOffer: setOffer,
    setAnswer: setAnswer,
    updateRoom: updateRoom,
    setGameState: setGameState,
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
