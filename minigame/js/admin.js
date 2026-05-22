var App = window.App || {};

(function() {
  var rooms = {};
  var selectedCode = '';
  var db = null;

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
      db.ref('rooms').on('value', function(snapshot) {
        rooms = snapshot.val() || {};
        renderRoomList();
        renderSelectedRoom();
      });
    }).catch(function(error) {
      App.Common.showToast('Admin 連線失敗：' + error.message, 'error');
    });
  }

  function renderRoomList() {
    var target = document.getElementById('admin-room-list');
    if (!target) return;
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
    if (!selectedCode || !rooms[selectedCode]) {
      if (title) title.textContent = '房間詳情';
      target.innerHTML = '<p class="room-list-empty">選擇一個房間</p>';
      return;
    }
    var room = rooms[selectedCode];
    var members = people(room.members);
    var players = room.gameStart && room.gameStart.players ? room.gameStart.players : [];
    var history = people(room.history).sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
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
      '<h3 class="admin-subtitle">在線 / 離線真人</h3>' +
      renderPeopleBlock(members, room.hostId) +
      '<h3 class="admin-subtitle">本局座位 / AI 接管</h3>' +
      renderPlayersBlock(players, room.members || {}) +
      '<h3 class="admin-subtitle">排行榜</h3>' +
      renderLeaderboard(leaderboard) +
      '<h3 class="admin-subtitle">歷史紀錄</h3>' +
      renderHistory(history);
  }

  function renderPeopleBlock(members, hostId) {
    if (!members.length) return '<p class="room-list-empty">暫時沒有</p>';
    return '<div class="room-list">' + members.map(function(member) {
      return '<div class="room-person' + (member.online === false ? ' offline' : '') + '">' +
        '<div><div class="room-person-name">' + escapeHtml(member.name || '玩家') + '</div>' +
        '<div class="room-person-meta">' + (member.online === false ? '離線' : '在線') + ' · ' + escapeHtml(member.presence || 'lobby') + '</div></div>' +
        '<div class="room-person-badges">' + (member.id === hostId ? '<span class="room-badge host">房主</span>' : '') + '</div>' +
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

  document.addEventListener('DOMContentLoaded', init);
})();
