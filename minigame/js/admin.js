var App = window.App || {};

(function() {
  var rooms = {};
  var selectedCode = '';
  var db = null;
  var unlocked = false;

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function people(map) {
    return Object.keys(map || {}).map(function(id) {
      var item = map[id] || {};
      item.id = id;
      return item;
    }).sort(function(a, b) {
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
  }

  function formatTime(ms) {
    if (!ms) return '-';
    var d = new Date(ms);
    return d.toLocaleString('zh-HK', { hour12: false });
  }

  function init() {
    var cfg = App.FirebaseConfig || {};
    if (!window.firebase || !cfg.apiKey || !cfg.databaseURL) {
      App.Common.showToast('Firebase 尚未設定', 'error');
      return;
    }
    firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    db = firebase.database();
    firebase.auth().signInAnonymously().then(function() {
      restoreUnlock();
      db.ref('rooms').on('value', function(snapshot) {
        rooms = snapshot.val() || {};
        renderAdminLock();
        renderSummary();
        renderRoomList();
        renderSelectedRoom();
      });
    }).catch(function(error) {
      App.Common.showToast('Admin 連線失敗：' + error.message, 'error');
    });
  }

  function restoreUnlock() {
    var expected = String((App.FirebaseConfig && App.FirebaseConfig.adminPin) || '');
    if (!expected) {
      unlocked = true;
      return;
    }
    try {
      unlocked = window.sessionStorage.getItem('minigame.admin.unlocked') === expected;
    } catch(e) {
      unlocked = false;
    }
  }

  function unlock() {
    var expected = String((App.FirebaseConfig && App.FirebaseConfig.adminPin) || '');
    var input = document.getElementById('admin-pin-input');
    var value = String(input && input.value || '');
    if (!expected) {
      unlocked = true;
      renderAdminLock();
      App.Common.showToast('Admin PIN 未設定，已以本機 gate 模式進入', 'success');
      return;
    }
    if (value !== expected) {
      App.Common.showToast('Admin PIN 不正確', 'error');
      return;
    }
    unlocked = true;
    try { window.sessionStorage.setItem('minigame.admin.unlocked', expected); } catch(e) {}
    renderAdminLock();
    renderRoomList();
    renderSelectedRoom();
  }

  function renderAdminLock() {
    var lock = document.getElementById('admin-lock');
    var note = document.getElementById('admin-lock-note');
    if (!lock) return;
    var expected = String((App.FirebaseConfig && App.FirebaseConfig.adminPin) || '');
    lock.style.display = unlocked ? 'none' : 'grid';
    if (note) {
      note.textContent = expected
        ? '需要 Admin PIN。正式安全請配合 Firebase Rules。'
        : '未設定 adminPin：目前只適合私人測試，正式公開前請加 Firebase Rules。';
      note.className = 'room-config-note' + (expected ? '' : ' error');
    }
  }

  function renderSummary() {
    var target = document.getElementById('admin-summary');
    if (!target) return;
    var codes = Object.keys(rooms);
    var onlinePlayers = 0;
    var playingRooms = 0;
    var aiTakeovers = 0;
    codes.forEach(function(code) {
      var room = rooms[code] || {};
      if (room.status === 'playing') playingRooms++;
      people(room.members).forEach(function(member) {
        if (member.online !== false) onlinePlayers++;
      });
      var players = room.gameStart && room.gameStart.players ? room.gameStart.players : [];
      players.forEach(function(player) {
        var member = room.members && room.members[player.id];
        if (!player.isAI && member && member.online === false) aiTakeovers++;
      });
    });
    target.innerHTML =
      '<div><span>房間</span><strong>' + codes.length + '</strong></div>' +
      '<div><span>在線真人</span><strong>' + onlinePlayers + '</strong></div>' +
      '<div><span>遊戲中</span><strong>' + playingRooms + '</strong></div>' +
      '<div><span>AI 接管</span><strong>' + aiTakeovers + '</strong></div>' +
      '<div><span>資料源</span><strong>Firebase RTDB</strong></div>' +
      '<div><span>Admin</span><strong>' + (unlocked ? 'Unlocked' : 'Locked') + '</strong></div>';
  }

  function renderRoomList() {
    var target = document.getElementById('admin-room-list');
    if (!target) return;
    if (!unlocked) {
      target.innerHTML = '<p class="room-list-empty">請先解鎖 Admin</p>';
      return;
    }
    var codes = Object.keys(rooms).sort(function(a, b) {
      return (rooms[b].updatedAt || 0) - (rooms[a].updatedAt || 0);
    });
    if (!codes.length) {
      target.innerHTML = '<p class="room-list-empty">未有房間</p>';
      return;
    }
    target.innerHTML = codes.map(function(code) {
      var room = rooms[code] || {};
      var members = people(room.members);
      var online = members.filter(function(member) { return member.online !== false; }).length;
      var active = code === selectedCode ? ' active' : '';
      return '<button class="room-person admin-room-row' + active + '" data-room-code="' + escapeHtml(code) + '">' +
        '<div><div class="room-person-name">' + escapeHtml(code) + ' · ' + escapeHtml(room.status || 'lobby') + '</div>' +
        '<div class="room-person-meta">' + online + '/' + members.length + ' 真人在線 · ' + escapeHtml(room.gameId || '未選遊戲') + '</div></div>' +
        '<div class="room-person-badges"><span class="room-badge host">查看</span></div>' +
      '</button>';
    }).join('');
    Array.prototype.forEach.call(target.querySelectorAll('[data-room-code]'), function(btn) {
      btn.addEventListener('click', function() {
        selectedCode = btn.getAttribute('data-room-code');
        renderRoomList();
        renderSelectedRoom();
      });
    });
  }

  function renderSelectedRoom() {
    var title = document.getElementById('admin-room-title');
    var target = document.getElementById('admin-room-detail');
    if (!target) return;
    if (!unlocked) {
      if (title) title.textContent = '房間詳情';
      target.innerHTML = '<p class="room-list-empty">請先解鎖 Admin</p>';
      return;
    }
    if (!selectedCode || !rooms[selectedCode]) {
      if (title) title.textContent = '房間詳情';
      target.innerHTML = '<p class="room-list-empty">選擇一個房間</p>';
      return;
    }
    var room = rooms[selectedCode];
    var members = people(room.members);
    var players = room.gameStart && room.gameStart.players ? room.gameStart.players : [];
    var history = people(room.history).sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var chat = people(room.chat).sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    var leaderboard = people(room.leaderboard);
    var host = room.members && room.members[room.hostId] ? room.members[room.hostId].name : room.hostId;
    if (title) title.textContent = '房間 ' + selectedCode;
    target.innerHTML =
      '<div class="room-debug-panel admin-debug-panel">' +
        '<div><span>狀態</span><strong>' + escapeHtml(room.status || '-') + '</strong></div>' +
        '<div><span>房主</span><strong>' + escapeHtml(host || '-') + '</strong></div>' +
        '<div><span>遊戲</span><strong>' + escapeHtml(room.gameId || '-') + '</strong></div>' +
        '<div><span>回合</span><strong>' + escapeHtml(room.roundId || '-') + '</strong></div>' +
        '<div><span>更新</span><strong>' + escapeHtml(formatTime(room.updatedAt)) + '</strong></div>' +
        '<div><span>Epoch</span><strong>' + escapeHtml(room.hostEpoch || 0) + '</strong></div>' +
      '</div>' +
      '<div class="admin-actions">' +
        '<button class="btn-small btn-copy" data-admin-action="repair">修復房主</button>' +
        '<button class="btn-small btn-copy" data-admin-action="reset-lobby">返回 Lobby</button>' +
        '<button class="btn-small btn-copy" data-admin-action="clear-actions">清理 Actions</button>' +
        '<button class="btn-small btn-copy" data-admin-action="clear-vote">清理投票</button>' +
        '<button class="btn-small btn-copy" data-admin-action="interrupt">標記中斷</button>' +
        '<button class="btn-small btn-danger" data-admin-action="close">強制關閉</button>' +
      '</div>' +
      '<h3 class="admin-subtitle">在線 / 離線真人</h3>' +
      renderPeopleBlock(members, room.hostId) +
      '<h3 class="admin-subtitle">本局座位 / AI 接管</h3>' +
      renderPlayersBlock(players, room.members || {}) +
      '<h3 class="admin-subtitle">排行榜</h3>' +
      renderLeaderboard(leaderboard) +
      '<h3 class="admin-subtitle">Chatroom</h3>' +
      renderChat(chat) +
      '<h3 class="admin-subtitle">歷史紀錄</h3>' +
      renderHistory(history);
    bindAdminActions();
  }

  function renderPeopleBlock(members, hostId) {
    if (!members.length) return '<p class="room-list-empty">暫時沒有</p>';
    return '<div class="room-list">' + members.map(function(member) {
      return '<div class="room-person' + (member.online === false ? ' offline' : '') + '">' +
        '<div><div class="room-person-name">' + escapeHtml(member.name || '玩家') + '</div>' +
        '<div class="room-person-meta">' + (member.online === false ? '離線' : '在線') + ' · ' + escapeHtml(member.presence || 'lobby') + '</div></div>' +
        '<div class="room-person-badges">' + (member.id === hostId ? '<span class="room-badge host">房主</span>' : '') +
          (member.id !== hostId ? '<button class="room-badge admin-host" data-host-id="' + escapeHtml(member.id) + '">設房主</button>' : '') +
          '<button class="room-badge admin-kick" data-kick-id="' + escapeHtml(member.id) + '">踢出</button></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderPlayersBlock(players, members) {
    if (!players.length) return '<p class="room-list-empty">未開局</p>';
    return '<div class="room-list">' + players.map(function(player) {
      var member = members[player.id] || {};
      var ai = player.isAI || /^ai-/.test(player.id || '');
      var takeover = !ai && member.online === false;
      return '<div class="room-person' + (takeover ? ' offline' : '') + '">' +
        '<div><div class="room-person-name">' + escapeHtml(player.name || '玩家') + '</div>' +
        '<div class="room-person-meta">' + (ai ? 'AI 玩家' : takeover ? '真人斷線，AI 接管' : '真人玩家') + '</div></div>' +
        '<div class="room-person-badges">' + (takeover || ai ? '<span class="room-badge ai">AI</span>' : '<span class="room-badge self">真人</span>') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderLeaderboard(items) {
    if (!items.length) return '<p class="room-list-empty">未有排行榜資料</p>';
    return '<div class="room-list">' + items.map(function(item) {
      return '<div class="room-person"><div><div class="room-person-name">' + escapeHtml(item.name || item.id) + '</div>' +
        '<div class="room-person-meta">分數 ' + escapeHtml(item.score || 0) + ' · 勝 ' + escapeHtml(item.wins || 0) + '</div></div></div>';
    }).join('') + '</div>';
  }

  function renderHistory(history) {
    if (!history.length) return '<p class="room-list-empty">未有遊戲紀錄</p>';
    return '<div class="room-list">' + history.slice(0, 30).map(function(item) {
      return '<div class="room-person"><div><div class="room-person-name">' + escapeHtml(item.gameName || item.gameId || '遊戲') + ' · ' + escapeHtml(item.status || '') + '</div>' +
        '<div class="room-person-meta">' + escapeHtml(item.winnerName || item.winner || '未有勝者') + ' · ' + escapeHtml(formatTime(item.createdAt)) + '</div></div></div>';
    }).join('') + '</div>';
  }

  function renderChat(messages) {
    if (!messages.length) return '<p class="room-list-empty">未有 Chat 訊息</p>';
    return '<div class="room-list">' + messages.slice(0, 40).map(function(item) {
      var kind = item.kind || 'player';
      var label = kind === 'system' ? '系統' : kind === 'game' ? '遊戲' : (item.name || '玩家');
      return '<div class="room-person"><div><div class="room-person-name">' + escapeHtml(label) + ' · ' + escapeHtml(item.eventType || 'chat') + '</div>' +
        '<div class="room-person-meta">' + escapeHtml(item.text || '') + ' · ' + escapeHtml(formatTime(item.createdAt)) + '</div></div></div>';
    }).join('') + '</div>';
  }

  function bindAdminActions() {
    var detail = document.getElementById('admin-room-detail');
    if (!detail) return;
    Array.prototype.forEach.call(detail.querySelectorAll('[data-admin-action]'), function(btn) {
      btn.addEventListener('click', function() {
        runRoomAction(btn.getAttribute('data-admin-action'));
      });
    });
    Array.prototype.forEach.call(detail.querySelectorAll('[data-kick-id]'), function(btn) {
      btn.addEventListener('click', function() {
        kickPlayer(btn.getAttribute('data-kick-id'));
      });
    });
    Array.prototype.forEach.call(detail.querySelectorAll('[data-host-id]'), function(btn) {
      btn.addEventListener('click', function() {
        transferHost(btn.getAttribute('data-host-id'));
      });
    });
  }

  function roomRef() {
    if (!selectedCode) return null;
    return db.ref('rooms/' + selectedCode);
  }

  function runRoomAction(action) {
    if (!unlocked || !selectedCode || !db) return;
    if (action === 'close') {
      roomRef().update({
        status: 'closed',
        closedAt: firebase.database.ServerValue.TIMESTAMP,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      }).then(function() {
        App.Common.showToast('房間已關閉', 'success');
      }).catch(showAdminError);
      return;
    }
    if (action === 'interrupt') {
      var room = rooms[selectedCode] || {};
      var entry = {
        gameId: room.gameId || '',
        gameName: room.gameId || '未完成遊戲',
        mode: room.mode || '',
        roundId: room.roundId || '',
        status: 'interrupted',
        reason: 'admin_marked_interrupted',
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      var updates = {
        status: 'lobby',
        gameStart: null,
        gameState: null,
        currentRound: null,
        gameActions: null,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
      roomRef().child('history').push(entry).then(function() {
        return roomRef().update(updates);
      }).then(function() {
        App.Common.showToast('已標記中斷並返回 Lobby', 'success');
      }).catch(showAdminError);
      return;
    }
    if (action === 'reset-lobby') {
      resetToLobby('admin_reset_lobby');
      return;
    }
    if (action === 'clear-actions') {
      roomRef().update({
        gameActions: null,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      }).then(function() {
        App.Common.showToast('Actions 已清理', 'success');
      }).catch(showAdminError);
      return;
    }
    if (action === 'clear-vote') {
      roomRef().update({
        vote: null,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      }).then(function() {
        App.Common.showToast('投票已清理', 'success');
      }).catch(showAdminError);
      return;
    }
    if (action === 'repair') {
      repairHost();
    }
  }

  function resetToLobby(reason) {
    var room = rooms[selectedCode] || {};
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
      gameActions: null,
      vote: null,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    people(room.members).forEach(function(member) {
      updates['members/' + member.id + '/presence'] = 'lobby';
    });
    var entry = room.roundId ? {
      gameId: room.gameId || '',
      gameName: room.gameId || '未完成遊戲',
      mode: room.mode || '',
      roundId: room.roundId || '',
      status: 'interrupted',
      reason: reason || 'admin_reset_lobby',
      createdAt: firebase.database.ServerValue.TIMESTAMP
    } : null;
    var job = entry ? roomRef().child('history').push(entry) : Promise.resolve();
    job.then(function() {
      return roomRef().update(updates);
    }).then(function() {
      App.Common.showToast('已返回 Lobby', 'success');
    }).catch(showAdminError);
  }

  function repairHost() {
    roomRef().transaction(function(room) {
      if (!room || !room.members) return room;
      var candidate = people(room.members).filter(function(member) {
        return member.online !== false;
      }).sort(function(a, b) {
        var aSpectator = a.role === 'spectator' || a.presence === 'spectating';
        var bSpectator = b.role === 'spectator' || b.presence === 'spectating';
        if (aSpectator !== bSpectator) return aSpectator ? 1 : -1;
        return (a.joinedAt || 0) - (b.joinedAt || 0);
      })[0];
      if (!candidate) return room;
      var oldHostId = room.hostId || '';
      var oldHost = room.members[oldHostId] || {};
      room.hostId = candidate.id;
      room.hostEpoch = Number(room.hostEpoch || 0) + 1;
      room.hostNotice = {
        hostId: candidate.id,
        hostName: candidate.name || '玩家',
        previousHostId: oldHostId,
        previousHostName: oldHost.name || '',
        epoch: room.hostEpoch,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      Object.keys(room.members).forEach(function(id) {
        room.members[id].role = id === candidate.id ? 'host' : 'member';
      });
      room.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      return room;
    }).then(function() {
      App.Common.showToast('房主已修復', 'success');
    }).catch(showAdminError);
  }

  function kickPlayer(playerId) {
    if (!playerId || !selectedCode) return;
    var updates = {};
    updates['members/' + playerId + '/online'] = false;
    updates['members/' + playerId + '/presence'] = 'kicked';
    updates['members/' + playerId + '/kickedAt'] = firebase.database.ServerValue.TIMESTAMP;
    updates['queue/' + playerId] = null;
    updates.updatedAt = firebase.database.ServerValue.TIMESTAMP;
    roomRef().update(updates).then(function() {
      App.Common.showToast('玩家已標記踢出', 'success');
    }).catch(showAdminError);
  }

  function transferHost(playerId) {
    if (!playerId || !selectedCode) return;
    roomRef().transaction(function(room) {
      if (!room || !room.members || !room.members[playerId]) return room;
      var oldHostId = room.hostId || '';
      var oldHost = room.members[oldHostId] || {};
      var nextHost = room.members[playerId] || {};
      room.hostId = playerId;
      room.hostEpoch = Number(room.hostEpoch || 0) + 1;
      room.hostNotice = {
        hostId: playerId,
        hostName: nextHost.name || '玩家',
        previousHostId: oldHostId,
        previousHostName: oldHost.name || '',
        epoch: room.hostEpoch,
        createdAt: firebase.database.ServerValue.TIMESTAMP
      };
      Object.keys(room.members).forEach(function(id) {
        room.members[id].role = id === playerId ? 'host' : 'member';
      });
      if (room.gameStart) room.gameStart.hostId = playerId;
      room.updatedAt = firebase.database.ServerValue.TIMESTAMP;
      return room;
    }).then(function() {
      App.Common.showToast('房主已轉移', 'success');
    }).catch(showAdminError);
  }

  function showAdminError(error) {
    App.Common.showToast('Admin 操作失敗：' + error.message, 'error');
  }

  document.addEventListener('DOMContentLoaded', init);
  App.Admin = { unlock: unlock };
})();
