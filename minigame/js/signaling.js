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
  var CODE_DIGITS = '0123456789';
  var STALE_MEMBER_MS = 60 * 1000;

  function isConfigured() {
    var cfg = App.FirebaseConfig || {};
    return !!(window.firebase && cfg.apiKey && cfg.databaseURL && cfg.projectId && cfg.appId);
  }

  function initFirebase() {
    if (!isConfigured()) {
      return Promise.reject(new Error('Firebase 尚未設定，請設定 FIREBASE_CONFIG_JSON secret 或本機 firebaseConfig.local.js'));
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

  function normalizeNameKey(username) {
    return String(username || '').trim().normalize('NFKC').toLowerCase();
  }

  function weightedNameLength(username) {
    return Array.from(String(username || '')).reduce(function(total, ch) {
      return total + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1);
    }, 0);
  }

  function requireUsername(username) {
    var name = String(username || '').trim().normalize('NFKC');
    if (!name) throw new Error('請輸入你的名字');
    if (!/^[A-Za-z0-9\u4e00-\u9fff]+$/.test(name)) {
      throw new Error('名字只可使用中文、英文或數字');
    }
    if (weightedNameLength(name) > 12) {
      throw new Error('名字最多 12 個英數長度，中文字會計 2 格');
    }
    return name;
  }

  function requireClientId(id) {
    var value = String(id || '');
    if (!/^[A-Za-z0-9-]{8,80}$/.test(value)) throw new Error('房間身份已失效，請重新加入');
    return value;
  }

  function paletteColors() {
    return App.Common && App.Common.playerColors ? App.Common.playerColors : [
      { id: 'red', value: '#E74C3C' }, { id: 'blue', value: '#3498DB' },
      { id: 'green', value: '#2ECC71' }, { id: 'yellow', value: '#F1C40F' }
    ];
  }

  function paletteIcons() {
    return App.Common && App.Common.playerIcons ? App.Common.playerIcons : [
      { id: 'fox', value: '🦊' }, { id: 'cat', value: '🐱' },
      { id: 'dog', value: '🐶' }, { id: 'bear', value: '🐻' }
    ];
  }

  function normalizePaletteValue(value, list, fallbackIndex) {
    var id = String(value || '');
    var found = list.filter(function(item) { return item.id === id || item.value === id; })[0];
    return found ? found.id : list[fallbackIndex % list.length].id;
  }

  function usedProfileValues(members, ownId) {
    var used = { colors: {}, icons: {} };
    Object.keys(members || {}).forEach(function(id) {
      if (id === ownId) return;
      var member = members[id] || {};
      if (member.online === false) return;
      if (member.playerColor) used.colors[member.playerColor] = true;
      if (member.playerIcon) used.icons[member.playerIcon] = true;
    });
    return used;
  }

  function chooseAvailable(list, used, preferred, fallbackSeed) {
    var normalized = normalizePaletteValue(preferred, list, fallbackSeed || 0);
    if (!used[normalized]) return normalized;
    for (var i = 0; i < list.length; i++) {
      var index = ((fallbackSeed || 0) + i) % list.length;
      if (!used[list[index].id]) return list[index].id;
    }
    return normalized;
  }

  function profileForMembers(members, ownId, preferred) {
    preferred = preferred || {};
    var seed = Math.abs(String(ownId || '').split('').reduce(function(total, ch) {
      return total + ch.charCodeAt(0);
    }, 0));
    var used = usedProfileValues(members, ownId);
    return {
      playerColor: chooseAvailable(paletteColors(), used.colors, preferred.playerColor, seed),
      playerIcon: chooseAvailable(paletteIcons(), used.icons, preferred.playerIcon, seed + 3)
    };
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
    data.vote = data.vote || null;
    data.hostEpoch = Number(data.hostEpoch || 0);
    return data;
  }

  function memberRecord(username, role, extra) {
    extra = extra || {};
    var profile = profileForMembers(extra.members || {}, extra.ownId || selfId, extra);
    return {
      name: username,
      normalizedName: normalizeNameKey(username),
      role: role || 'member',
      online: true,
      authUid: authUid,
      playerColor: profile.playerColor,
      playerIcon: profile.playerIcon,
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
          return ref('rooms/' + code + '/members/' + uid).set(memberRecord(username, 'host', { ownId: uid })).then(function() {
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

  function timestampValue(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return 0;
  }

  function isStaleMember(member, now) {
    if (!member) return false;
    var lastSeen = timestampValue(member.lastSeenAt) || timestampValue(member.joinedAt);
    if (!lastSeen) return member.online === false;
    return now - lastSeen > STALE_MEMBER_MS;
  }

  function markStaleMembers(room, now) {
    if (!room || !room.members) return room;
    Object.keys(room.members).forEach(function(id) {
      var member = room.members[id] || {};
      if (isStaleMember(member, now)) {
        member.online = false;
        if (member.presence === 'playing') member.presence = 'spectating';
        room.members[id] = member;
      }
    });
    return room;
  }

  function hasDuplicateName(members, username, ownId, now) {
    var key = normalizeNameKey(username);
    now = now || Date.now();
    return Object.keys(members || {}).some(function(id) {
      if (id === ownId) return false;
      var member = members[id] || {};
      var memberKey = member.normalizedName || normalizeNameKey(member.name || '');
      return memberKey && memberKey === key && !isStaleMember(member, now);
    });
  }

  function enterRoom(code, username) {
    username = requireUsername(username);
    return initFirebase().then(function(uid) {
      code = requireRoomCode(code);
      var createdRoom = false;
      var duplicateName = false;
      return ref('rooms/' + code).transaction(function(current) {
        var now = Date.now();
        if (current === null || (current && current.status === 'closed')) {
          createdRoom = true;
          duplicateName = false;
          return emptyRoom(uid);
        }
        markStaleMembers(current, now);
        if (hasDuplicateName(current.members || {}, username, uid, now)) {
          duplicateName = true;
          return;
        }
        createdRoom = false;
        duplicateName = false;
        return current;
      }).then(function(result) {
        if (duplicateName) throw new Error('房間內已有相同名稱玩家');
        if (!result.committed) throw new Error('未能進入房間，請再試一次');
        return ref('rooms/' + code).once('value');
      }).then(function(snapshot) {
        var data = normalizeRoom(snapshot);
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
          ownId: uid,
          members: data.members || {},
          joinedAt: existing.joinedAt,
          presence: existing.presence || 'lobby',
          queueStatus: existing.queueStatus || 'none',
          playerColor: existing.playerColor,
          playerIcon: existing.playerIcon,
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
      var memberRecord = data.members && data.members[selfId];
      if (!memberRecord) throw new Error('房間身份已失效，請重新加入');
      if (hasDuplicateName(data.members || {}, username, selfId, Date.now())) throw new Error('房間內已有相同名稱玩家');
      isHost = data.hostId === selfId;
      roomCode = code;
      var role = isHost ? 'host' : 'member';
      selfRole = role;
      var record = memberRecord || {};
      var path = 'rooms/' + code + '/members/' + selfId;
      var version = Number(record.connectionVersion || 0) + 1;
      var profile = profileForMembers(data.members || {}, selfId, record);
      return ref(path).update({
        name: username,
        normalizedName: normalizeNameKey(username),
        role: role,
        online: true,
        authUid: authUid,
        playerColor: profile.playerColor,
        playerIcon: profile.playerIcon,
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
      return Object.assign({ id: id }, member);
    }).filter(function(member) {
      return member.online !== false;
    }).sort(function(a, b) {
      var aSpectator = a.role === 'spectator' || a.presence === 'spectating';
      var bSpectator = b.role === 'spectator' || b.presence === 'spectating';
      if (aSpectator !== bSpectator) return aSpectator ? 1 : -1;
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
      var oldHostId = current.hostId || '';
      var oldHost = current.members[oldHostId] || {};
      current.hostId = selfId;
      current.hostEpoch = Number(current.hostEpoch || 0) + 1;
      current.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      current.hostNotice = {
        hostId: selfId,
        hostName: candidate.name || '玩家',
        previousHostId: oldHostId,
        previousHostName: oldHost.name || '',
        epoch: current.hostEpoch,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
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
    return Promise.resolve();
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
          playerColor: member && member.playerColor ? member.playerColor : '',
          playerIcon: member && member.playerIcon ? member.playerIcon : '',
          queuedAt: firebase.database.ServerValue.TIMESTAMP
        };
      }
      return ref('rooms/' + roomCode).update(updates);
    });
  }

  function chatText(value) {
    return String(value || '').trim().slice(0, 120);
  }

  function pushChatMessage(message) {
    if (!roomCode || !selfId || !message) return Promise.resolve();
    var value = chatText(message.text);
    if (!value) return Promise.resolve();
    var code = roomCode;
    var kind = String(message.kind || 'player').match(/^(player|system|game)$/) ? String(message.kind || 'player') : 'player';
    var eventType = String(message.eventType || (kind === 'player' ? 'chat' : kind)).slice(0, 40);
    return ref('rooms/' + code).once('value').then(function(snapshot) {
      var data = normalizeRoom(snapshot);
      var member = data.members && data.members[selfId];
      var mentions = [];
      if (kind === 'player') {
        Object.keys(data.members || {}).forEach(function(id) {
          var target = data.members[id] || {};
          if (!target.name) return;
          if (value.indexOf('@' + target.name) !== -1) mentions.push(id);
        });
      }
      var payload = {
        from: selfId,
        name: kind === 'player' ? (member && member.name ? member.name : '玩家') : (kind === 'system' ? '系統' : '遊戲'),
        kind: kind,
        eventType: eventType,
        mentions: mentions,
        text: value,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      if (kind === 'player' && member && member.playerColor) payload.playerColor = member.playerColor;
      if (kind === 'player' && member && member.playerIcon) payload.playerIcon = member.playerIcon;
      return ref('rooms/' + code + '/chat').push(payload);
    });
  }

  function sendChat(text) {
    return pushChatMessage({ kind: 'player', eventType: 'chat', text: text });
  }

  function sendSystemMessage(text, eventType) {
    return pushChatMessage({ kind: 'system', eventType: eventType || 'room_event', text: text });
  }

  function sendGameMessage(text, eventType) {
    return pushChatMessage({ kind: 'game', eventType: eventType || 'game_action', text: text });
  }

  function updateProfile(profile) {
    if (!roomCode || !selfId || !profile) return Promise.resolve();
    return ref('rooms/' + roomCode).transaction(function(current) {
      if (!current || !current.members || !current.members[selfId]) return current;
      var member = current.members[selfId];
      var chosen = profileForMembers(current.members, selfId, {
        playerColor: profile.playerColor || member.playerColor,
        playerIcon: profile.playerIcon || member.playerIcon
      });
      if (profile.playerColor && chosen.playerColor !== normalizePaletteValue(profile.playerColor, paletteColors(), 0)) {
        return;
      }
      if (profile.playerIcon && chosen.playerIcon !== normalizePaletteValue(profile.playerIcon, paletteIcons(), 0)) {
        return;
      }
      member.playerColor = chosen.playerColor;
      member.playerIcon = chosen.playerIcon;
      member.lastSeenAt = firebase.database.ServerValue.TIMESTAMP;
      current.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      if (current.queue && current.queue[selfId]) {
        current.queue[selfId].playerColor = chosen.playerColor;
        current.queue[selfId].playerIcon = chosen.playerIcon;
      }
      return current;
    }).then(function(result) {
      if (!result.committed) throw new Error('這個顏色或圖示已被使用');
      return true;
    });
  }

  function setGameState(snapshot) {
    if (!roomCode || !snapshot) return Promise.resolve();
    snapshot.gameId = snapshot.gameId || '';
    snapshot.mode = snapshot.mode || '';
    snapshot.updatedBy = selfId;
    snapshot.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    if (snapshot.mode) return ref('rooms/' + roomCode + '/gameState').set(snapshot);
    return ref('rooms/' + roomCode).once('value').then(function(roomSnapshot) {
      var room = normalizeRoom(roomSnapshot);
      snapshot.mode = snapshot.mode || room.mode || room.activeMode || 'room';
      snapshot.gameId = snapshot.gameId || room.gameId || room.activeGameId || '';
      return ref('rooms/' + roomCode + '/gameState').set(snapshot);
    });
  }

  function appendHistory(entry) {
    if (!roomCode || !entry) return Promise.resolve();
    entry.createdAt = firebase.database.ServerValue.TIMESTAMP;
    entry.createdBy = selfId;
    return ref('rooms/' + roomCode + '/history').push(entry).then(function(result) {
      var status = String(entry.status || '');
      if (status === 'completed' || status === 'interrupted') {
        var title = entry.summary || ((entry.gameName || entry.gameId || '遊戲') + (status === 'completed' ? ' 完成' : ' 中斷'));
        if (entry.winnerName) title += '，勝出：' + entry.winnerName;
        sendGameMessage(title, status === 'completed' ? 'game_end' : 'game_interrupted').catch(function() {});
      }
      return result;
    });
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
        row.playerColor = result.playerColor || row.playerColor || '';
        row.playerIcon = result.playerIcon || row.playerIcon || '';
        row.score = Number(row.score || 0) + Number(result.score || 0);
        row.wins = Number(row.wins || 0) + (result.win ? 1 : 0);
        row.plays = Number(row.plays || 0) + 1;
        row.lastPlayedAt = firebase.database.ServerValue.TIMESTAMP;
        current[result.id] = row;
      });
      return current;
    });
  }

  function voteDecision(vote, eligibleIds, now) {
    if (!vote || vote.status !== 'pending') return { done: false, status: vote && vote.status };
    eligibleIds = (eligibleIds || []).filter(Boolean);
    var eligible = {};
    eligibleIds.forEach(function(id) { eligible[id] = true; });
    var total = Math.max(1, eligibleIds.length);
    var needed = Math.floor(total / 2) + 1;
    var agree = 0;
    var reject = 0;
    Object.keys(vote.votes || {}).forEach(function(id) {
      if (eligibleIds.length && !eligible[id]) return;
      if ((vote.votes[id] || {}).agree === true) agree++;
      if ((vote.votes[id] || {}).agree === false) reject++;
    });
    if (agree >= needed) return { done: true, status: 'accepted', agree: agree, reject: reject, needed: needed };
    if (reject >= needed) return { done: true, status: 'rejected', agree: agree, reject: reject, needed: needed };
    if (Number(vote.expireAt || 0) && Number(vote.expireAt || 0) <= (now || Date.now())) {
      return { done: true, status: agree > reject ? 'accepted' : 'rejected', agree: agree, reject: reject, needed: needed };
    }
    return { done: false, status: 'pending', agree: agree, reject: reject, needed: needed };
  }

  function startVote(type, payload, title, durationMs) {
    if (!roomCode || !selfId) return Promise.resolve(false);
    durationMs = Number(durationMs || 30000);
    return ref('rooms/' + roomCode).transaction(function(current) {
      if (!current || !current.members || !current.members[selfId]) return current;
      var now = Date.now();
      var active = current.vote && current.vote.status === 'pending' && Number(current.vote.expireAt || 0) > now;
      if (active) return;
      var member = current.members[selfId] || {};
      current.vote = {
        voteId: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
        type: String(type || 'generic').slice(0, 40),
        title: String(title || '房間投票').slice(0, 80),
        payload: payload || {},
        initiatorId: selfId,
        initiatorName: member.name || '玩家',
        status: 'pending',
        createdAt: now,
        expireAt: now + durationMs,
        votes: {}
      };
      current.vote.votes[selfId] = { agree: true, createdAt: now };
      current.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      return current;
    }).then(function(result) {
      if (!result.committed) throw new Error('已有投票進行中');
      return true;
    });
  }

  function castVote(agree) {
    if (!roomCode || !selfId) return Promise.resolve();
    return ref('rooms/' + roomCode + '/vote/votes/' + selfId).set({
      agree: !!agree,
      createdAt: Date.now()
    });
  }

  function finishVote(voteId, status) {
    if (!roomCode || !voteId) return Promise.resolve(false);
    return ref('rooms/' + roomCode + '/vote').transaction(function(vote) {
      if (!vote || vote.voteId !== voteId || vote.status !== 'pending') return vote;
      vote.status = status === 'accepted' ? 'accepted' : 'rejected';
      vote.resolvedAt = Date.now();
      return vote;
    }).then(function(result) {
      return !!result.committed;
    });
  }

  function clearVote(voteId) {
    if (!roomCode) return Promise.resolve();
    return ref('rooms/' + roomCode + '/vote').transaction(function(vote) {
      if (!vote) return vote;
      if (voteId && vote.voteId !== voteId) return vote;
      return null;
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
    sendSystemMessage: sendSystemMessage,
    sendGameMessage: sendGameMessage,
    setGameState: setGameState,
    appendHistory: appendHistory,
    updateLeaderboard: updateLeaderboard,
    addLeaderboardResults: addLeaderboardResults,
    startVote: startVote,
    castVote: castVote,
    finishVote: finishVote,
    clearVote: clearVote,
    updateProfile: updateProfile,
    sendGameAction: sendGameAction,
    clearGameAction: clearGameAction,
    leave: leave,
    normalizeRoomCode: normalizeRoomCode,
    requireRoomCode: requireRoomCode,
    requireUsername: requireUsername,
    normalizeNameKey: normalizeNameKey,
    weightedNameLength: weightedNameLength,
    _test: {
      hasDuplicateName: hasDuplicateName,
      isStaleMember: isStaleMember,
      markStaleMembers: markStaleMembers,
      selectHostCandidate: selectHostCandidate,
      voteDecision: voteDecision,
      chatText: chatText
    },
    getRoomCode: getRoomCode,
    getSelfId: getSelfId,
    getAuthUid: getAuthUid,
    getIsHost: getIsHost
  };
})();

window.App = App;
