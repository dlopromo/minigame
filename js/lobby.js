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
  var leftRoundIds = {};
  var chatDrawerOpen = false;
  var roomChatOpen = false;
  var globalGameChatVisible = false;
  var lastSeenChatCount = 0;
  var lastMentionNoticeKey = '';
  var lastHostNoticeEpoch = 0;
  var processedVoteIds = {};
  var titleFlashTimer = null;
  var titleFlashBase = 'MiniGame';
  var titleFlashOn = false;
  var mentionState = { target: '', query: '', index: 0, people: [] };
  var missingRoomSince = 0;

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
    return String(value || '').trim().normalize('NFKC');
  }

  function isValidUsername(name) {
    return /^[A-Za-z0-9\u4e00-\u9fff]+$/.test(name);
  }

  function weightedNameLength(name) {
    if (App.Signaling && App.Signaling.weightedNameLength) return App.Signaling.weightedNameLength(name);
    return Array.from(String(name || '')).reduce(function(total, ch) {
      return total + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1);
    }, 0);
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
    if (weightedNameLength(name) > 12) {
      App.Common.showToast('名字最多 12 個英數長度，中文字會計 2 格', 'error');
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

  function isScreenActive(id) {
    var screen = document.getElementById('screen-' + id);
    return !!(screen && screen.classList.contains('active'));
  }

  function shouldRefreshRoomLobby() {
    return isScreenActive('room-lobby') || isScreenActive('waiting') || isScreenActive('room-connect');
  }

  function setTitle(text) {
    var title = text ? text + ' - MiniGame' : 'MiniGame';
    titleFlashBase = title;
    if (App.Common && App.Common.focusModeActive) {
      App.Common.focusModePreviousTitle = title;
      return;
    }
    document.title = title;
    var needsAttention = /輪到你|你的回合|Your Turn/i.test(text || '');
    if (needsAttention && document.hidden) startTitleFlash(title);
    else stopTitleFlash(title);
  }

  function startTitleFlash(title) {
    if (App.Common && App.Common.focusModeActive) return;
    if (titleFlashTimer) return;
    titleFlashTimer = setInterval(function() {
      if (App.Common && App.Common.focusModeActive) return;
      titleFlashOn = !titleFlashOn;
      document.title = titleFlashOn ? '(你的回合!) ' + title : title;
    }, 900);
  }

  function stopTitleFlash(title) {
    if (titleFlashTimer) clearInterval(titleFlashTimer);
    titleFlashTimer = null;
    titleFlashOn = false;
    if (App.Common && App.Common.focusModeActive) {
      App.Common.focusModePreviousTitle = title || titleFlashBase || 'MiniGame';
      return;
    }
    document.title = title || titleFlashBase || 'MiniGame';
  }

  function setRoomTitle(code) {
    stopTitleFlash('房間 ' + (code || roomState && roomState.code || App.Signaling.getRoomCode() || ''));
  }

  function setHomeTitle() {
    stopTitleFlash('MiniGame');
  }

  function saveRoomSession(room) {
    if (!App.RoomSession || !room || !room.code || !room.selfId) return;
    App.RoomSession.save({
      roomCode: room.code,
      clientId: room.selfId,
      authUid: App.Signaling.getAuthUid ? App.Signaling.getAuthUid() : '',
      username: playerName,
      isHost: !!(room.isHost || isHost),
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
        : 'Firebase 尚未設定：GitHub Pages 請設定 FIREBASE_CONFIG_JSON secret；本機開發請建立 js/firebaseConfig.local.js。';
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
    return getPeople(roomState && roomState.members).filter(function(person) {
      return person.online !== false && !person.isAI && !/^ai-/.test(person.id || '');
    });
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
        playerColor: member.playerColor || item.playerColor || '',
        playerIcon: member.playerIcon || item.playerIcon || '',
        presence: member.presence || 'lobby',
        queueStatus: 'queued'
      };
    }).filter(function(person) {
      return person.online !== false && !person.isAI && !/^ai-/.test(person.id || '');
    }).sort(function(a, b) {
      return (a.queuedAt || 0) - (b.queuedAt || 0);
    });
  }

  function getRoomPlayers() {
    if (roomState && roomState.gameStart && roomState.gameStart.players) return enrichRoundPeople(roomState.gameStart.players);
    return [];
  }

  function getRoomSpectators() {
    if (roomState && roomState.gameStart && roomState.gameStart.spectators) return enrichRoundPeople(roomState.gameStart.spectators);
    return getRoomMembers().filter(function(person) {
      return !(roomState && roomState.queue && roomState.queue[person.id]);
    });
  }

  function enrichRoundPeople(people) {
    var members = roomState && roomState.members ? roomState.members : {};
    return (people || []).map(function(person) {
      var member = members[person.id] || {};
      var isAI = !!person.isAI || /^ai-/.test(person.id || '');
      return Object.assign({}, person, {
        name: member.name || person.name || (isAI ? 'AI' : '玩家'),
        online: isAI ? true : member.online !== false,
        authUid: member.authUid || person.authUid || '',
        playerColor: member.playerColor || person.playerColor || '',
        playerIcon: member.playerIcon || person.playerIcon || '',
        joinedAt: member.joinedAt || person.joinedAt || 0,
        lastSeenAt: member.lastSeenAt || person.lastSeenAt || 0,
        presence: member.presence || person.presence || '',
        queueStatus: member.queueStatus || person.queueStatus || 'none',
        connectionVersion: member.connectionVersion || person.connectionVersion || 0,
        controlledByAI: !isAI && (member.online === false || (member.presence && member.presence !== 'playing' && person.role === 'player'))
      });
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
    if (roomState.gameStart && roomState.gameStart.players && roomState.gameStart.players.some(function(person) {
      return person && person.id === selfId;
    })) {
      return 'player';
    }
    if (roomState.gameStart && roomState.gameStart.spectators && roomState.gameStart.spectators.some(function(person) {
      return person && person.id === selfId;
    })) {
      return 'spectator';
    }
    if (roomState.members && roomState.members[selfId]) return roomState.members[selfId].role || 'member';
    return 'spectator';
  }

  function getSelfName() {
    if (!roomState || !selfId) return playerName;
    var record = roomState.members && roomState.members[selfId];
    return (record && record.name) || playerName;
  }

  function getSelfMember() {
    return roomState && roomState.members && roomState.members[selfId] ? roomState.members[selfId] : null;
  }

  function isSelfQueued() {
    return !!(roomState && roomState.queue && roomState.queue[selfId]);
  }

  function isSelfSpectating() {
    var member = getSelfMember();
    return !!(member && member.presence === 'spectating');
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
      var color = App.Common && App.Common.getPlayerColor ? App.Common.getPlayerColor(person.playerColor) : { value: '#d9e1ea' };
      row.className = 'room-person with-avatar' + (person.online === false ? ' offline' : '');
      row.style.setProperty('--player-color', color.value);
      row.innerHTML = App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(person) : '';
      var info = el('div');
      var nameNode = el('div', 'room-person-name', person.name || '玩家');
      nameNode.title = person.name || '玩家';
      info.appendChild(nameNode);
      var meta = person.online === false ? '離線' : (options.queue || person.queueStatus === 'queued' ? '隊列中' : person.presence === 'playing' ? '遊戲中' : '觀戰 / 房間中');
      info.appendChild(el('div', 'room-person-meta', meta));
      var badges = el('div');
      badges.className = 'room-person-badges';
      if (roomState && person.id === roomState.hostId) badges.appendChild(el('span', 'room-badge host', '房主'));
      if (person.id === selfId) badges.appendChild(el('span', 'room-badge self', '你'));
      if (options.queue || person.queueStatus === 'queued') badges.appendChild(el('span', 'room-badge queue', '排隊'));
      if (person.isAI) badges.appendChild(el('span', 'room-badge ai', 'AI'));
      if (person.controlledByAI) badges.appendChild(el('span', 'room-badge ai', 'AI接管'));
      row.appendChild(info);
      row.appendChild(badges);
      target.appendChild(row);
    });
  }

  function renderProfileControls() {
    var member = getSelfMember();
    var summary = document.getElementById('room-profile-summary');
    var status = document.getElementById('room-profile-status');
    var colorTarget = document.getElementById('room-color-options');
    var iconTarget = document.getElementById('room-icon-options');
    if (!summary || !colorTarget || !iconTarget) return;
    if (!member) {
      summary.innerHTML = '<span>等待身份同步</span>';
      return;
    }
    if (status) status.textContent = member.online === false ? '離線' : '在線';
    summary.innerHTML = (App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(member) : '') +
      '<span title="' + App.Common.escapeHtml(member.name || '玩家') + '">' + App.Common.escapeHtml(member.name || '玩家') + '</span>';
    var members = getRoomMembers().filter(function(person) { return person.id !== selfId && person.online !== false; });
    var usedColors = {};
    var usedIcons = {};
    members.forEach(function(person) {
      if (person.playerColor) usedColors[person.playerColor] = true;
      if (person.playerIcon) usedIcons[person.playerIcon] = true;
    });
    colorTarget.innerHTML = '';
    (App.Common.playerColors || []).forEach(function(color) {
      var btn = el('button', 'room-profile-choice color' + (member.playerColor === color.id ? ' active' : ''));
      btn.type = 'button';
      btn.style.setProperty('--choice-color', color.value);
      btn.title = color.name + (usedColors[color.id] ? '（已被使用）' : '');
      btn.disabled = !!usedColors[color.id] && member.playerColor !== color.id;
      btn.setAttribute('aria-label', color.name);
      btn.onclick = function() { updateRoomProfile({ playerColor: color.id }); };
      colorTarget.appendChild(btn);
    });
    iconTarget.innerHTML = '';
    (App.Common.playerIcons || []).forEach(function(icon) {
      var btn = el('button', 'room-profile-choice icon' + (member.playerIcon === icon.id ? ' active' : ''));
      btn.type = 'button';
      btn.title = icon.name + (usedIcons[icon.id] ? '（已被使用）' : '');
      btn.disabled = !!usedIcons[icon.id] && member.playerIcon !== icon.id;
      btn.textContent = icon.value;
      btn.onclick = function() { updateRoomProfile({ playerIcon: icon.id }); };
      iconTarget.appendChild(btn);
    });
  }

  function renderLeaderboard() {
    var target = document.getElementById('room-leaderboard-list');
    var count = document.getElementById('room-mvp-count');
    if (!target || !roomState) return;
    var rows = Object.keys(roomState.leaderboard || {}).map(function(id) {
      var row = roomState.leaderboard[id] || {};
      var member = roomState.members && roomState.members[id] ? roomState.members[id] : {};
      return Object.assign({ id: id }, row, {
        name: member.name || row.name || '玩家',
        playerColor: member.playerColor || row.playerColor || '',
        playerIcon: member.playerIcon || row.playerIcon || ''
      });
    }).sort(function(a, b) {
      return Number(b.wins || 0) - Number(a.wins || 0) || Number(b.score || 0) - Number(a.score || 0) || String(a.name).localeCompare(String(b.name));
    });
    if (count) count.textContent = String(rows.length);
    if (!rows.length) {
      target.innerHTML = '<p class="room-list-empty">未有賽果</p>';
      return;
    }
    target.innerHTML = rows.slice(0, 6).map(function(row, index) {
      var plays = Number(row.plays || 0);
      var wins = Number(row.wins || 0);
      var winRate = plays ? Math.round(wins / plays * 100) : 0;
      return '<div class="room-mvp-row">' +
        '<span class="room-mvp-rank">#' + (index + 1) + '</span>' +
        '<div class="room-mvp-name">' + (App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(row) : '') + ' ' + App.Common.escapeHtml(row.name || '玩家') + '</div>' +
        '<span class="room-mvp-score">' + wins + 'W · ' + winRate + '%</span>' +
      '</div>';
    }).join('');
  }

  function onlineHumanIds() {
    return getRoomMembers().filter(function(person) {
      return person.online !== false && !person.isAI && !/^ai-/.test(person.id || '');
    }).map(function(person) { return person.id; });
  }

  function voteDecision(vote) {
    if (App.Signaling && App.Signaling._test && App.Signaling._test.voteDecision) {
      return App.Signaling._test.voteDecision(vote, onlineHumanIds(), Date.now());
    }
    return { done: false, status: vote && vote.status };
  }

  function voteCounts(vote) {
    var ids = onlineHumanIds();
    var eligible = {};
    ids.forEach(function(id) { eligible[id] = true; });
    var agree = 0;
    var reject = 0;
    Object.keys((vote && vote.votes) || {}).forEach(function(id) {
      if (ids.length && !eligible[id]) return;
      if ((vote.votes[id] || {}).agree === true) agree++;
      if ((vote.votes[id] || {}).agree === false) reject++;
    });
    return {
      agree: agree,
      reject: reject,
      total: Math.max(1, ids.length),
      needed: Math.floor(Math.max(1, ids.length) / 2) + 1
    };
  }

  function renderVotePanel() {
    renderVotePanelTarget('room-vote-panel', false);
    renderVotePanelTarget('game-vote-panel', true);
  }

  function renderVotePanelTarget(targetId, inGame) {
    var target = document.getElementById(targetId);
    if (!target) return;
    var vote = roomState && roomState.vote ? roomState.vote : null;
    var active = vote && vote.status === 'pending';
    var canStartReturnVote = !!(roomState && roomState.gameStart && !active && roomState.status !== 'closed');
    if (!active && !canStartReturnVote) {
      target.hidden = true;
      target.innerHTML = '';
      return;
    }
    target.hidden = false;
    target.className = 'room-vote-panel ' + (inGame ? 'game-vote-panel ' : '') + (vote && vote.status ? vote.status : 'pending');
    if (!active) {
      target.innerHTML =
        '<div class="room-vote-copy">' +
          '<div class="room-vote-title">需要處理目前遊戲？</div>' +
          '<div class="room-vote-meta">多人房間會先投票，避免誤關或誤重開。</div>' +
        '</div>' +
        '<div class="room-vote-actions">' +
          '<button class="btn-small btn-copy" onclick="App.Lobby.requestRoomAction(&quot;return_lobby&quot;)"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span class="btn-label">返回房間</span></button>' +
          '<button class="btn-small btn-copy" onclick="App.Lobby.requestRoomAction(&quot;restart_round&quot;)"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span class="btn-label">重開</span></button>' +
          '<button class="btn-small btn-copy" onclick="App.Lobby.requestRoomAction(&quot;change_game&quot;)"><i class="fa-solid fa-gamepad" aria-hidden="true"></i><span class="btn-label">換遊戲</span></button>' +
          '<button class="btn-small btn-danger" onclick="App.Lobby.requestRoomAction(&quot;close_room&quot;)"><i class="fa-solid fa-lock" aria-hidden="true"></i><span class="btn-label">關房</span></button>' +
        '</div>';
      return;
    }
    var counts = voteCounts(vote);
    var own = vote.votes && vote.votes[selfId] ? vote.votes[selfId].agree : null;
    var seconds = Math.max(0, Math.ceil((Number(vote.expireAt || 0) - Date.now()) / 1000));
    target.innerHTML =
      '<div class="room-vote-copy">' +
        '<div class="room-vote-title">' + App.Common.escapeHtml(vote.title || '房間投票') + '</div>' +
        '<div class="room-vote-meta">' + App.Common.escapeHtml(vote.initiatorName || '玩家') + ' 發起 · ' + seconds + 's · 需要 ' + counts.needed + ' 票</div>' +
      '</div>' +
      '<div class="room-vote-actions">' +
        '<span class="room-vote-count">同意 ' + counts.agree + '/' + counts.total + '</span>' +
        '<span class="room-vote-count">反對 ' + counts.reject + '</span>' +
        '<button class="btn-small btn-copy" ' + (own === true ? 'disabled' : '') + ' onclick="App.Lobby.castRoomVote(true)">同意</button>' +
        '<button class="btn-small btn-danger" ' + (own === false ? 'disabled' : '') + ' onclick="App.Lobby.castRoomVote(false)">反對</button>' +
      '</div>';
  }

  function renderRoomLobby() {
    if (!roomState) return;
    setRoomTitle(roomState.code || App.Signaling.getRoomCode() || '');
    roomRole = getSelfRole();
    var codeLabel = document.getElementById('room-code-label');
    if (codeLabel) codeLabel.textContent = roomState.code || App.Signaling.getRoomCode() || '----';
    var roleLabel = document.getElementById('room-role-label');
    if (roleLabel) {
      var roleText = roomRole === 'player' ? '玩家' : '房間中';
      if (roomRole === 'host') roleText = '房主';
      if (roomRole === 'member') roleText = isSelfQueued() ? '隊列中' : (isSelfSpectating() ? '觀戰中' : '房間中');
      var statusText = roomState.status === 'playing'
        ? '遊戲進行中'
        : roomState.status === 'starting'
          ? '遊戲準備中'
          : 'Party Room';
      roleLabel.textContent = '你目前是：' + roleText + '　' + statusText;
    }
    var members = getRoomMembers();
    var queue = getRoomQueue();
    renderPeople('room-player-list', members);
    renderPeople('room-spectator-list', queue, { queue: true });
    renderProfileControls();
    renderLeaderboard();
    setText('room-member-count', String(members.length));
    setText('room-queue-count', String(queue.length));
    renderRoomChatPanelState();
    renderRoomChat();
    renderVotePanel();
    renderRoomDebug();
    var actions = document.getElementById('room-host-actions');
    if (actions) actions.style.display = isHost ? 'block' : 'none';
    var queueBtn = document.getElementById('room-queue-toggle');
    if (queueBtn) {
      queueBtn.innerHTML = isSelfQueued()
        ? '<i class="fa-solid fa-user-minus" aria-hidden="true"></i> 離開隊列'
        : '<i class="fa-solid fa-list-ol" aria-hidden="true"></i> 加入隊列';
      queueBtn.className = isSelfQueued() ? 'btn btn-secondary' : 'btn btn-primary';
    }
    var spectateBtn = document.getElementById('room-spectate-toggle');
    if (spectateBtn) {
      spectateBtn.innerHTML = isSelfSpectating()
        ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i> 取消觀戰'
        : '<i class="fa-solid fa-eye" aria-hidden="true"></i> 觀戰本局';
      spectateBtn.className = isSelfSpectating() ? 'btn btn-secondary' : 'btn btn-ghost';
    }
    showScreen('room-lobby');
  }

  function setText(id, text) {
    var node = document.getElementById(id);
    if (node) node.textContent = text;
  }

  function renderRoomChat() {
    if (!roomState) return;
    var messages = getPeople(roomState.chat).sort(function(a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    setText('room-chat-count', String(messages.length));
    renderChatTarget('room-chat-list', messages);
    renderChatTarget('game-chat-list', messages);
    updateChatBadge(messages.length);
    notifyMention(messages);
    renderVotePanel();
    renderRoomChatPanelState();
  }

  function notifyMention(messages) {
    if (!selfId || !messages || !messages.length) return;
    var latest = messages.filter(function(msg) {
      return msg.from !== selfId && mentionList(msg.mentions).indexOf(selfId) !== -1;
    }).pop();
    if (!latest || latest.id === lastMentionNoticeKey) return;
    lastMentionNoticeKey = latest.id;
    if (App.Common && App.Common.showToast) App.Common.showToast((latest.name || '玩家') + ' 提到了你', 'success');
    startTitleFlash('有人 @ 你 - MiniGame');
  }

  function renderRoomChatPanelState() {
    var card = document.querySelector('.room-chat-card');
    var toggle = document.getElementById('room-chat-toggle');
    if (!card) return;
    var compact = window.matchMedia && window.matchMedia('(max-width:480px)').matches;
    var collapsed = compact && !roomChatOpen;
    card.classList.toggle('is-collapsed', collapsed);
    if (toggle) {
      var count = Object.keys((roomState && roomState.chat) || {}).length;
      toggle.innerHTML = (collapsed ? '開啟 ' : '收起 ') + '<span id="room-chat-count">' + count + '</span>';
    }
  }

  function renderChatTarget(targetId, messages) {
    var target = document.getElementById(targetId);
    if (!target) return;
    target.innerHTML = messages.length ? '' : '<p class="room-list-empty">未有訊息</p>';
    messages.forEach(function(msg) {
      var kind = msg.kind || 'player';
      var row = el('div', 'room-chat-message ' + kind);
      if (mentionList(msg.mentions).indexOf(selfId) !== -1) row.className += ' mentioned';
      var name = el('strong', msg.playerColor ? 'has-color' : '', msg.name || '玩家');
      if (msg.playerColor && App.Common.getPlayerColor) {
        name.style.setProperty('--player-color', App.Common.getPlayerColor(msg.playerColor).value);
      }
      row.appendChild(name);
      var body = el('span');
      body.innerHTML = renderMentions(msg.text || '');
      row.appendChild(body);
      target.appendChild(row);
    });
    target.scrollTop = target.scrollHeight;
  }

  function mentionList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value && typeof value === 'object') {
      return Object.keys(value).map(function(key) {
        return typeof value[key] === 'string' ? value[key] : key;
      }).filter(Boolean);
    }
    return [];
  }

  function renderMentions(text) {
    var escaped = App.Common.escapeHtml(text || '');
    var members = getRoomMembers();
    members.forEach(function(member) {
      if (!member.name) return;
      var color = App.Common.getPlayerColor ? App.Common.getPlayerColor(member.playerColor).value : '#3498DB';
      var pattern = new RegExp('@' + escapeRegExp(member.name), 'g');
      escaped = escaped.replace(pattern, '<span class="chat-mention" style="--mention-color:' + color + '">@' + App.Common.escapeHtml(member.name) + '</span>');
    });
    return escaped;
  }

  function mentionParts(input) {
    var value = input ? input.value : '';
    var cursor = input && typeof input.selectionStart === 'number' ? input.selectionStart : value.length;
    var before = value.slice(0, cursor);
    var match = before.match(/(^|\s)@([A-Za-z0-9\u4e00-\u9fff]*)$/);
    if (!match) return null;
    return {
      start: cursor - match[2].length - 1,
      end: cursor,
      query: match[2] || '',
      value: value
    };
  }

  function mentionPanel(target) {
    return document.getElementById(target === 'game' ? 'game-mention-panel' : 'room-mention-panel');
  }

  function hideMentionPanel(target) {
    var panel = mentionPanel(target);
    if (panel) {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      panel.innerHTML = '';
    }
    if (!target || mentionState.target === target) mentionState = { target: '', query: '', index: 0, people: [] };
  }

  function renderMentionPanel(target, input) {
    var panel = mentionPanel(target);
    if (!panel || !roomState) return;
    var parts = mentionParts(input);
    if (!parts) {
      hideMentionPanel(target);
      return;
    }
    var query = parts.query.toLowerCase();
    var people = getRoomMembers().filter(function(person) {
      if (!person.name || person.id === selfId) return false;
      return !query || String(person.name).toLowerCase().indexOf(query) !== -1;
    }).slice(0, 6);
    if (!people.length) {
      hideMentionPanel(target);
      return;
    }
    mentionState = {
      target: target,
      query: parts.query,
      index: Math.min(mentionState.target === target ? mentionState.index : 0, people.length - 1),
      people: people
    };
    panel.innerHTML = people.map(function(person, index) {
      return '<button type="button" class="mention-option' + (index === mentionState.index ? ' active' : '') + '" data-mention-id="' + person.id + '">' +
        (App.Common.renderPlayerAvatar ? App.Common.renderPlayerAvatar(person) : '') +
        '<span>' + App.Common.escapeHtml(person.name || '玩家') + '</span>' +
      '</button>';
    }).join('');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    Array.prototype.forEach.call(panel.querySelectorAll('[data-mention-id]'), function(button) {
      button.addEventListener('mousedown', function(e) {
        e.preventDefault();
        chooseMention(target, input, button.getAttribute('data-mention-id'));
      });
    });
  }

  function chooseMention(target, input, id) {
    var person = getRoomMembers().filter(function(item) { return item.id === id; })[0];
    var parts = mentionParts(input);
    if (!person || !parts || !input) return false;
    var insert = '@' + person.name + ' ';
    input.value = parts.value.slice(0, parts.start) + insert + parts.value.slice(parts.end);
    var caret = parts.start + insert.length;
    input.setSelectionRange(caret, caret);
    hideMentionPanel(target);
    input.focus();
    return true;
  }

  function handleMentionKey(target, input, e) {
    if (mentionState.target !== target || !mentionState.people.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      var delta = e.key === 'ArrowDown' ? 1 : -1;
      mentionState.index = (mentionState.index + delta + mentionState.people.length) % mentionState.people.length;
      renderMentionPanel(target, input);
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      return chooseMention(target, input, mentionState.people[mentionState.index].id);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideMentionPanel(target);
      return true;
    }
    return false;
  }

  function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function updateChatBadge(count) {
    var unread = Math.max(0, count - lastSeenChatCount);
    Array.prototype.forEach.call(document.querySelectorAll('.game-chat-unread'), function(node) {
      node.textContent = unread > 9 ? '9+' : String(unread);
      node.classList.toggle('has-unread', unread > 0 && !chatDrawerOpen);
    });
  }

  function setGlobalGameChatVisible(visible) {
    globalGameChatVisible = !!visible;
    var button = document.getElementById('global-game-chat-button');
    if (button) button.hidden = !globalGameChatVisible;
  }

  function logRoomEvent(kind, text, eventType) {
    if (playContext !== 'room' || !App.Signaling) return Promise.resolve();
    if (kind === 'game' && App.Signaling.sendGameMessage) return App.Signaling.sendGameMessage(text, eventType).catch(function() {});
    if (App.Signaling.sendSystemMessage) return App.Signaling.sendSystemMessage(text, eventType).catch(function() {});
    return Promise.resolve();
  }

  function notifyRoomUpdateToGame() {
    if (!gameActive || playContext !== 'room') return;
    var start = roomState && roomState.gameStart ? roomState.gameStart : null;
    var role = getSelfRole();
    if ((!role || role === 'member') && start) {
      if ((start.players || []).some(function(person) { return person && person.id === selfId; })) role = 'player';
      else if ((start.spectators || []).some(function(person) { return person && person.id === selfId; })) role = 'spectator';
    }
    var gameState = roomState ? roomState.gameState : null;
    App.GameManager.handleMessage({
      type: 'room_update',
      roomId: roomState ? roomState.code : '',
      selfId: selfId,
      role: role,
      players: start && start.players ? enrichRoundPeople(start.players) : getRoomPlayers(),
      spectators: start && start.spectators ? enrichRoundPeople(start.spectators) : getRoomSpectators(),
      gameState: gameState,
      isHost: isHost,
      hostId: roomState ? roomState.hostId : ''
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

  function refreshHostFlag(state) {
    var wasHost = isHost;
    isHost = !!(state && state.hostId === selfId);
    roomRole = getSelfRole();
    if (isHost && !wasHost) {
      App.Common.showToast('房主已自動轉移給你', 'success');
      logRoomEvent('system', '房主已轉移給 ' + getSelfName(), 'host_migration');
      saveRoomSession({ code: state.code, selfId: selfId, role: 'host', isHost: true });
    } else if (!isHost && wasHost) {
      saveRoomSession({ code: state.code, selfId: selfId, role: roomRole, isHost: false });
    }
    return isHost && !wasHost;
  }

  function notifyHostNotice(state) {
    var notice = state && state.hostNotice;
    var epoch = notice ? Number(notice.epoch || 0) : 0;
    if (!epoch) return;
    if (!roomState) {
      lastHostNoticeEpoch = epoch;
      return;
    }
    if (epoch === lastHostNoticeEpoch) return;
    lastHostNoticeEpoch = epoch;
    var newHost = notice.hostName || '新房主';
    var oldHost = notice.previousHostName || '房主';
    App.Common.showToast(oldHost + ' 已離開，' + newHost + ' 已成為新房主', 'success');
  }

  function maybeClaimHost(state) {
    if (!state || !App.Signaling || !App.Signaling.claimHost || state.hostId === selfId) return;
    var members = getPeople(state.members);
    var currentHost = state.members && state.members[state.hostId];
    if (currentHost && currentHost.online !== false) return;
    var candidate = members.filter(function(person) {
      return person.online !== false;
    }).sort(function(a, b) {
      var aSpectator = a.role === 'spectator' || a.presence === 'spectating';
      var bSpectator = b.role === 'spectator' || b.presence === 'spectating';
      if (aSpectator !== bSpectator) return aSpectator ? 1 : -1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    })[0];
    if (!candidate || candidate.id !== selfId) return;
    App.Signaling.claimHost().catch(function(e) {
      App.Common.showToast('房主轉移失敗：' + e.message, 'error');
    });
  }

  function maybeResolveVote(state) {
    if (!isHost || !state || !state.vote || state.vote.status !== 'pending') return;
    var decision = voteDecision(state.vote);
    if (!decision.done || !App.Signaling.finishVote) return;
    App.Signaling.finishVote(state.vote.voteId, decision.status).catch(function(e) {
      App.Common.showToast('投票結算失敗：' + e.message, 'error');
    });
  }

  function maybeApplyResolvedVote(state) {
    if (!isHost || !state || !state.vote || state.vote.status === 'pending') return;
    var vote = state.vote;
    if (!vote.voteId || processedVoteIds[vote.voteId]) return;
    processedVoteIds[vote.voteId] = true;
    if (vote.status === 'rejected') {
      setTimeout(function() {
        if (App.Signaling.clearVote) App.Signaling.clearVote(vote.voteId).catch(function() {});
      }, 900);
      return;
    }
    applyRoomVoteAction(vote.type, vote.payload || {}, vote).catch(function(e) {
      App.Common.showToast('投票動作失敗：' + e.message, 'error');
      if (App.Signaling.clearVote) App.Signaling.clearVote(vote.voteId).catch(function() {});
    });
  }

  function endRoomRound(reason, vote) {
    if (!roomState || !App.Signaling) return Promise.resolve();
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
      vote: null
    };
    getRoomMembers().forEach(function(person) {
      updates['members/' + person.id + '/presence'] = 'lobby';
    });
    var history = roomState.roundId ? App.Signaling.appendHistory({
      gameId: roomState.gameId || '',
      gameName: roomState.gameId || '遊戲',
      mode: roomState.mode || '',
      roundId: roomState.roundId,
      status: 'interrupted',
      reason: reason || 'returned_to_lobby',
      voteId: vote && vote.voteId ? vote.voteId : ''
    }) : Promise.resolve();
    return history.then(function() {
      logRoomEvent('system', '返回 Party Room', 'return_lobby');
      return App.Signaling.updateRoom(updates);
    });
  }

  function handleRoomState(state) {
    if (!state) {
      if (playContext !== 'room') return;
      if (!missingRoomSince) {
        missingRoomSince = Date.now();
        return;
      }
      if (Date.now() - missingRoomSince < 1600) return;
      App.Common.showToast('房間已關閉', 'error');
      goHome();
      return;
    }
    missingRoomSince = 0;
    notifyHostNotice(state);
    roomState = state;
    maybeClaimHost(state);
    var becameHost = refreshHostFlag(state);
    maybeResolveVote(state);
    maybeApplyResolvedVote(state);
    if (gameActive && (state.status === 'lobby' || state.status === 'closed')) {
      App.GameManager.endGame({ skipConfirm: true, noCallback: true });
      gameActive = false;
      setGlobalGameChatVisible(false);
      if (state.status === 'closed') {
        App.Common.showToast('房間已關閉', 'error');
        goHome();
        return;
      }
      setTitle('房間 ' + (state.code || App.Signaling.getRoomCode() || ''));
      renderRoomLobby();
      return;
    }
    notifyRoomUpdateToGame();
    renderRoomChat();
    if (isHost) processPendingRoomActions(state);
    maybeLaunchRoomGameFromState();
    if (!gameActive && shouldRefreshRoomLobby()) renderRoomLobby();
  }

  function handleRoomAction(actionId, action) {
    if (!isHost || roomActionIds[actionId] || !action || !action.payload) return;
    if (!action.roundId) {
      if (App.Signaling.clearGameAction) App.Signaling.clearGameAction(actionId).catch(function() {});
      return;
    }
    if (roomState && action.roundId !== roomState.roundId) {
      if (App.Signaling.clearGameAction) App.Signaling.clearGameAction(actionId).catch(function() {});
      return;
    }
    roomActionIds[actionId] = true;
    App.GameManager.handleMessage(action.payload);
    if (action.payload.stateSnapshot && App.Signaling && App.Signaling.setGameState) {
      var snapshot = action.payload.stateSnapshot;
      var resolvedState = snapshot && snapshot.state ? snapshot : {
        gameId: action.payload.gameId || roomState.gameId || '',
        mode: action.payload.mode || roomState.mode || '',
        roundId: action.roundId || roomState.roundId || '',
        state: snapshot
      };
      if (resolvedState && resolvedState.state) {
        App.Signaling.setGameState(resolvedState).catch(function(e) {
          App.Common.showToast('同步遊戲狀態失敗：' + e.message, 'error');
        });
      }
    }
    if (!action.payload.stateSnapshot && App.GameManager && typeof App.GameManager.getActiveGameSnapshot === 'function' && App.Signaling && App.Signaling.setGameState) {
      var currentSnapshot = App.GameManager.getActiveGameSnapshot();
      if (currentSnapshot) {
        var resolvedSnapshot = currentSnapshot && currentSnapshot.state ? currentSnapshot : {
          gameId: action.payload.gameId || roomState.gameId || '',
          mode: action.payload.mode || roomState.mode || '',
          roundId: action.roundId || roomState.roundId || '',
          state: currentSnapshot
        };
        if (resolvedSnapshot && resolvedSnapshot.state) {
          App.Signaling.setGameState(resolvedSnapshot).catch(function(e) {
            App.Common.showToast('同步遊戲狀態失敗：' + e.message, 'error');
          });
        }
      }
    }
    if (App.Signaling.clearGameAction) App.Signaling.clearGameAction(actionId).catch(function(e) {
      App.Common.showToast('清理同步佇列失敗：' + e.message, 'error');
    });
  }

  function processPendingRoomActions(state) {
    if (!state || !state.gameActions) return;
    Object.keys(state.gameActions).sort(function(a, b) {
      return (state.gameActions[a].createdAt || 0) - (state.gameActions[b].createdAt || 0);
    }).forEach(function(actionId) {
      handleRoomAction(actionId, state.gameActions[actionId]);
    });
  }

  function watchRoomAsHost() {
    App.Signaling.watchRoom(function(state) {
      handleRoomState(state);
    });
    App.Signaling.watchGameActions(function(actionId, action) {
      handleRoomAction(actionId, action);
    });
  }

  function watchRoomAsGuest() {
    App.Signaling.watchRoom(function(state) {
      handleRoomState(state);
    });
    App.Signaling.watchGameActions(function(actionId, action) {
      handleRoomAction(actionId, action);
    });
  }

  async function createShortRoom() {
    var input = document.getElementById('room-player-name-input');
    playerName = requireUsername(input ? input.value : '');
    if (!playerName) return;
    if (!App.Signaling.isConfigured()) {
      App.Common.showToast('Firebase 尚未設定，請設定 FIREBASE_CONFIG_JSON secret 或本機 firebaseConfig.local.js', 'error');
      return;
    }
    try {
      var room = await App.Signaling.createRoom(playerName);
      playContext = 'room';
      isHost = !!room.isHost;
      selfId = room.selfId;
      roomActionIds = {};
      processedVoteIds = {};
      saveRoomSession(room);
      if (isHost) watchRoomAsHost();
      else watchRoomAsGuest();
      setTitle('房間 ' + room.code);
      App.Common.showToast('房間已建立', 'success');
      logRoomEvent('system', playerName + ' 建立並進入房間', 'room_join');
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
      App.Common.showToast('Firebase 尚未設定，請設定 FIREBASE_CONFIG_JSON secret 或本機 firebaseConfig.local.js', 'error');
      return;
    }
    try {
      var room = App.Signaling.enterRoom
        ? await App.Signaling.enterRoom(code, playerName)
        : await App.Signaling.joinRoom(code, playerName);
      playContext = 'room';
      isHost = !!room.isHost;
      selfId = room.selfId;
      roomRole = room.role;
      roomActionIds = {};
      processedVoteIds = {};
      saveRoomSession(room);
      if (isHost) watchRoomAsHost();
      else watchRoomAsGuest();
      setTitle('房間 ' + room.code);
      App.Common.showToast(room.created ? '房間不存在，已建立新房間' : '已進入房間', 'success');
      logRoomEvent('system', playerName + (room.created ? ' 建立並進入房間' : ' 進入房間'), 'room_join');
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
      var badges = [];
      if (playContext === 'room') {
        badges.push('玩家 ' + (game.minRoomPlayers || game.minPlayers || 1) + '-' + (game.maxPlayers || 2));
        if (game.aiFill) badges.push('AI 補位');
        if (game.allowSpectators) badges.push('可觀戰');
        if (roomState) {
          var ready = getRoomQueue().length >= getGameMinRoomPlayers(game.id);
          badges.push(ready ? '可開始' : '隊列不足');
        }
      } else {
        badges.push('單人');
        if (game.maxPlayers > 1) badges.push('AI 對手');
      }
      card.innerHTML =
        '<div class="game-icon">' + game.icon + '</div>' +
        '<div class="game-name">' + game.name + '</div>' +
        '<div class="game-desc">' + game.description + '</div>' +
        '<div class="game-card-meta">' + badges.map(function(badge) {
          return '<span class="game-badge">' + badge + '</span>';
        }).join('') + '</div>';
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
    var game = App.GameManager.getGame(gameId);
    var seating = App.RoomSeating && App.RoomSeating.build
      ? App.RoomSeating.build(roomState, game)
      : null;
    if (!seating) return Promise.reject(new Error('Room seating module not ready'));
    var members = getRoomMembers().filter(function(person) { return person.online !== false; });
    var seatedIds = {};
    seating.players.forEach(function(person) { if (!person.isAI) seatedIds[person.id] = true; });
    var updates = { players: null, spectators: null };
    members.forEach(function(person) {
      // Only queued/selected players enter the game scene automatically.
      // Non-selected people stay in room lobby unless they explicitly queue.
      updates['members/' + person.id + '/presence'] = seatedIds[person.id] ? 'playing' : 'lobby';
    });
    updates.maxPlayers = seating.maxPlayers;
    return App.Signaling.updateRoom(updates).then(function() {
      return {
        players: seating.players,
        spectators: seating.spectators,
        waitingQueue: seating.waitingQueue,
        rolesByClientId: seating.rolesByClientId,
        maxPlayers: seating.maxPlayers
      };
    });
  }

  function makeRoundId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function buildRoomStart(gameId, mode, seating) {
    var game = App.GameManager.getGame(gameId);
    var roles = {};
    if (seating.rolesByClientId) {
      roles = Object.assign({}, seating.rolesByClientId);
    } else {
      seating.players.forEach(function(person) { roles[person.id] = 'player'; });
      seating.spectators.forEach(function(person) { roles[person.id] = 'spectator'; });
    }
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
      waitingQueue: seating.waitingQueue || [],
      rolesByClientId: roles,
      initialState: initialState
    };
  }

  function startRoomRound(gameId, mode) {
    if (playContext !== 'room' || !isHost || !roomState || !gameId) return Promise.resolve(false);
    var game = App.GameManager.getGame(gameId);
    var roomStart = null;
    return App.Signaling.updateRoom({ status: 'starting' }).then(function() {
      return rebalanceRoomForGame(gameId);
    }).then(function(seating) {
      roomStart = buildRoomStart(gameId, mode || 'room', seating);
      return App.Signaling.updateRoom({
        status: 'playing',
        gameId: gameId,
        mode: mode || 'room',
        activeGameId: gameId,
        activeMode: mode || 'room',
        roundId: roomStart.roundId,
        gameStart: roomStart,
        currentRound: {
          gameId: gameId,
          mode: mode || 'room',
          roundId: roomStart.roundId,
          players: seating.players,
          spectators: seating.spectators,
          waitingQueue: seating.waitingQueue || [],
          startedAt: Date.now()
        },
        gameState: null,
        gameActions: null
      });
    }).then(function() {
      var gameName = game && game.name ? game.name : gameId;
      logRoomEvent('system', '新一局開始：' + gameName + '（' + (mode || 'room') + '）', 'game_start');
      var payload = makeGameStartPayload(roomStart);
      if (gameActive) App.GameManager.endGame({ skipConfirm: true, noCallback: true });
      launchRoomGame(gameId, mode || 'room', payload);
      return true;
    }).catch(function(e) {
      App.Common.showToast('開始新一局失敗：' + e.message, 'error');
      return App.Signaling.updateRoom({ status: 'lobby' }).then(function() { return false; });
    });
  }

  function restartRoomGame() {
    if (!roomState) return;
    if (!isHost) {
      App.Common.showToast('只有房主可以直接開新一局', 'error');
      return;
    }
    var start = roomState.gameStart || {};
    var gameId = start.gameId || roomState.gameId || roomState.activeGameId;
    var mode = start.mode || roomState.mode || roomState.activeMode || 'room';
    requestRoomAction('restart_round', { gameId: gameId, mode: mode });
  }

  function roomResultActionsHtml() {
    if (playContext !== 'room' || !roomState) return '';
    return '<button class="result-action secondary" type="button" onclick="App.Lobby.handleGameCloseAction()"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i><span>返回房間</span></button>' +
      '<button class="result-action" type="button" onclick="App.Lobby.restartRoomGame()"><i class="fa-solid fa-rotate-right" aria-hidden="true"></i><span>' + (isHost ? '開新一局' : '發起重開') + '</span></button>';
  }

  function returnToRoomLobby() {
    if (roomState && roomState.roundId) {
      leftRoundIds[roomState.roundId] = true;
      if (selfId && App.Signaling && App.Signaling.updateRoom) {
        var updates = {};
        updates['members/' + selfId + '/presence'] = 'lobby';
        updates['members/' + selfId + '/queueStatus'] = 'none';
        updates['members/' + selfId + '/lastSeenAt'] = Date.now();
        App.Signaling.updateRoom(updates).catch(function() {});
      }
    }
    if (gameActive) App.GameManager.endGame({ skipConfirm: true, noCallback: true });
    gameActive = false;
    setGlobalGameChatVisible(false);
    setRoomTitle(roomState && roomState.code || App.Signaling.getRoomCode() || '');
    renderRoomLobby();
  }

  function handleGameCloseAction() {
    if (playContext !== 'room') {
      App.GameManager.endGame();
      return;
    }
    if (isHost) {
      // Host exit from active game should sync immediately for all players.
      endRoomRound('host_return_lobby').catch(function(e) {
        App.Common.showToast('同步返回房間失敗：' + e.message, 'error');
      });
      return;
    }
    returnToRoomLobby();
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
      startRoomRound(selectedGameId, mode);
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
      initialCode: start.initialState && start.initialState.computerCode ? start.initialState.computerCode : null,
      isHost: isHost
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
    setGlobalGameChatVisible(false);
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
    var launchedRoundId = payload.roundId || '';
    roomRole = payload.role || getSelfRole();
    if (playContext === 'room' && selfId && roomRole === 'player' && App.Signaling && App.Signaling.updateRoom && !leftRoundIds[launchedRoundId]) {
      var presenceUpdates = {};
      presenceUpdates['members/' + selfId + '/presence'] = 'playing';
      presenceUpdates['members/' + selfId + '/lastSeenAt'] = Date.now();
      App.Signaling.updateRoom(presenceUpdates).catch(function() {});
    }
    showScreen('game');
    setTitle('載入中...');
    var container = document.getElementById('game-container');
    gameActive = true;
    setGlobalGameChatVisible(true);
    lastSeenChatCount = Object.keys((roomState && roomState.chat) || {}).length;
    launchedRoomGameKey = payload.roundId || (gameId + ':' + mode + ':' + (roomState && roomState.updatedAt || ''));
    App.GameManager.startGame(gameId, container, makeGameOpts(mode, payload), function() {
      gameActive = false;
      setGlobalGameChatVisible(false);
      if (playContext === 'room') {
        if (isHost) {
          var latestRoundId = roomState && roomState.roundId ? roomState.roundId : '';
          var latestStatus = roomState && roomState.status ? roomState.status : '';
          // Ignore stale end callbacks after room state has already switched rounds or lobby.
          if (launchedRoundId && latestRoundId && launchedRoundId !== latestRoundId) {
            setTitle('房間 ' + (roomState && roomState.code || App.Signaling.getRoomCode() || ''));
            renderRoomLobby();
            return;
          }
          var activeState = roomState && roomState.gameState && roomState.gameState.state;
          if (activeState && activeState.status === 'settled') {
            renderRoomLobby();
            return;
          }
          if (latestStatus && latestStatus !== 'playing') {
            renderRoomLobby();
            return;
          }
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
        setTitle('房間 ' + (roomState && roomState.code || App.Signaling.getRoomCode() || ''));
        renderRoomLobby();
      } else if (playContext === 'single' || !playContext) {
        goHome();
      } else {
        // Defensive fallback: avoid unexpected home redirect when context is transitioning.
        setTitle('');
        showScreen('home');
      }
    });
  }

  function maybeLaunchRoomGameFromState() {
    if (!roomState || gameActive) return;
    if (roomState.status !== 'playing' || !roomState.gameStart || !roomState.gameStart.gameId || !roomState.gameStart.mode) return;
    var roundId = roomState.gameStart.roundId || roomState.roundId || '';
    if (roundId && leftRoundIds[roundId]) return;
    var role = getSelfRole();
    var start = roomState.gameStart;
    var isParticipant = !!(start.players && start.players.some(function(person) { return person && person.id === selfId; })) ||
      !!(start.spectators && start.spectators.some(function(person) { return person && person.id === selfId; }));
    if (!isParticipant && role !== 'player' && role !== 'spectator') return;
    if (!isParticipant && role === 'spectator') {
      var me = getSelfMember();
      if (me && me.presence !== 'spectating' && me.queueStatus !== 'queued') return;
    }
    var key = roomState.gameStart.roundId || (roomState.gameStart.gameId + ':' + roomState.gameStart.mode + ':' + (roomState.updatedAt || ''));
    if (launchedRoomGameKey === key) return;
    launchRoomGame(roomState.gameStart.gameId, roomState.gameStart.mode, makeGameStartPayload(roomState.gameStart));
  }

  function goHome() {
    if ((playContext === 'room' || gameActive) && App.Common && !App.Common.confirmDanger('要離開目前房間 / 遊戲嗎？')) return;
    if (playContext === 'room' && roomState) logRoomEvent('system', getSelfName() + ' 離開房間', 'room_leave');
    if (playContext === 'room') clearRoomSession();
    if (playContext === 'room') App.Signaling.leave();
    if (gameActive) {
      App.GameManager.endGame({ skipConfirm: true });
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
    leftRoundIds = {};
    processedVoteIds = {};
    launchedRoomGameKey = '';
    lastHostNoticeEpoch = 0;
    setGlobalGameChatVisible(false);
    setHomeTitle();
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
      chatInput.addEventListener('input', function() { renderMentionPanel('room', chatInput); });
      chatInput.addEventListener('blur', function() { setTimeout(function() { hideMentionPanel('room'); }, 120); });
      chatInput.addEventListener('keydown', function(e) {
        if (handleMentionKey('room', chatInput, e)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          sendRoomChat();
        }
      });
    }
    var gameChatInput = document.getElementById('game-chat-input');
    if (gameChatInput) {
      gameChatInput.addEventListener('input', function() { renderMentionPanel('game', gameChatInput); });
      gameChatInput.addEventListener('blur', function() { setTimeout(function() { hideMentionPanel('game'); }, 120); });
      gameChatInput.addEventListener('keydown', function(e) {
        if (handleMentionKey('game', gameChatInput, e)) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          sendGameChat();
        }
      });
    }

    window.addEventListener('beforeunload', function(e) {
      if (playContext !== 'room' && !gameActive) return;
      e.preventDefault();
      e.returnValue = '';
      return '';
    });

    attemptRoomResume();
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) stopTitleFlash(titleFlashBase);
      else if (/輪到你|你的回合|Your Turn/i.test(titleFlashBase)) startTitleFlash(titleFlashBase);
    });
  }

  function sendRoomGameAction(payload) {
    if (playContext !== 'room' || !payload || !roomState || !roomState.roundId) return false;
    if (!App.Signaling || !App.Signaling.sendGameAction) return false;
    var action = {
      roundId: roomState.roundId,
      gameId: roomState.gameId || '',
      mode: roomState.mode || '',
      payload: payload
    };
    App.Signaling.sendGameAction(action).catch(function(e) {
      App.Common.showToast('同步動作失敗：' + e.message, 'error');
    });
    if (!isHost && App.GameManager && typeof App.GameManager.handleMessage === 'function' && !payload.skipLocalEcho) {
      try {
        App.GameManager.handleMessage(Object.assign({
          localEcho: true,
          roundId: roomState.roundId || '',
          gameId: roomState.gameId || '',
          mode: roomState.mode || ''
        }, payload));
      } catch (e) {
        // Ignore optimistic local application errors; host snapshot will reconcile state.
      }
    }
    if (!isHost && payload && payload.stateSnapshot && App.Signaling && App.Signaling.setGameState) {
      var snapshot = payload.stateSnapshot;
      var resolvedSnapshot = snapshot && snapshot.state ? snapshot : {
        gameId: payload.gameId || roomState.gameId || '',
        mode: payload.mode || roomState.mode || '',
        roundId: roomState.roundId || '',
        state: snapshot
      };
      if (resolvedSnapshot && resolvedSnapshot.state) {
        App.Signaling.setGameState(resolvedSnapshot).catch(function(e) {
          App.Common.showToast('同步遊戲狀態失敗：' + e.message, 'error');
        });
      }
    }
    return true;
  }

  function startRoomVote(type) {
    if (playContext !== 'room' || !roomState || !App.Signaling || !App.Signaling.startVote) return;
    var titleMap = {
      return_lobby: '返回 Party Room',
      restart_round: '開新一局',
      change_game: '更換遊戲',
      close_room: '關閉房間',
      force_settle: '強制結算'
    };
    var payload = {
      gameId: roomState.gameId || '',
      mode: roomState.mode || '',
      roundId: roomState.roundId || ''
    };
    var extra = arguments.length > 1 && arguments[1] ? arguments[1] : {};
    Object.keys(extra).forEach(function(key) { payload[key] = extra[key]; });
    App.Signaling.startVote(type || 'return_lobby', payload, titleMap[type] || '房間投票', 30000).then(function() {
      App.Common.showToast('投票已發起', 'success');
      logRoomEvent('system', getSelfName() + ' 發起投票：' + (titleMap[type] || '房間投票'), 'vote_start');
    }).catch(function(e) {
      App.Common.showToast(e.message || '未能發起投票', 'error');
    });
  }

  function castRoomVote(agree) {
    if (playContext !== 'room' || !roomState || !App.Signaling || !App.Signaling.castVote) return;
    App.Signaling.castVote(!!agree).then(function() {
      logRoomEvent('system', getSelfName() + (agree ? ' 同意投票' : ' 反對投票'), 'vote_cast');
    }).catch(function(e) {
      App.Common.showToast('投票失敗：' + e.message, 'error');
    });
  }

  function requestRoomAction(type, payload) {
    if (playContext !== 'room' || !roomState) return;
    if (!isHost && ['change_game', 'close_room', 'force_settle'].indexOf(type) >= 0) {
      App.Common.showToast('只有房主可以發起這個動作', 'error');
      return;
    }
    var multiHuman = onlineHumanIds().length > 1;
    var voteActions = {
      return_lobby: true,
      restart_round: true,
      change_game: true,
      close_room: true,
      force_settle: true
    };
    var needsVote = multiHuman && !!voteActions[type];
    if (needsVote) {
      startRoomVote(type, payload || {});
      return;
    }
    applyRoomVoteAction(type, payload || {}, null).catch(function(e) {
      App.Common.showToast('房間動作失敗：' + e.message, 'error');
    });
  }

  function applyRoomVoteAction(type, payload, vote) {
    payload = payload || {};
    if (type === 'return_lobby') {
      return endRoomRound(vote ? 'vote_return_lobby' : 'return_lobby', vote);
    }
    if (type === 'force_settle') {
      return endRoomRound(vote ? 'vote_force_settle' : 'force_settle', vote);
    }
    if (type === 'restart_round') {
      var gameId = payload.gameId || (roomState && (roomState.gameId || roomState.activeGameId)) || '';
      var mode = payload.mode || (roomState && (roomState.mode || roomState.activeMode)) || 'room';
      if (!gameId) return Promise.reject(new Error('沒有可重開的遊戲'));
      if (vote && App.Signaling.clearVote) App.Signaling.clearVote(vote.voteId).catch(function() {});
      return startRoomRound(gameId, mode);
    }
    if (type === 'change_game') {
      return endRoomRound(vote ? 'vote_change_game' : 'change_game', vote).then(function() {
        showGameSelect('room');
      });
    }
    if (type === 'close_room') {
      logRoomEvent('system', '房間已關閉', 'room_closed');
      return App.Signaling.updateRoom({
        status: 'closed',
        closedAt: Date.now(),
        vote: null
      });
    }
    if (vote && App.Signaling.clearVote) return App.Signaling.clearVote(vote.voteId);
    return Promise.resolve();
  }

  function toggleQueue() {
    if (playContext !== 'room' || !roomState || !App.Signaling || !App.Signaling.setQueueStatus) return;
    var next = !isSelfQueued();
    App.Signaling.setQueueStatus(next).then(function() {
      logRoomEvent('system', getSelfName() + (next ? ' 加入隊列' : ' 離開隊列'), next ? 'queue_join' : 'queue_leave');
    }).catch(function(e) {
      App.Common.showToast('更新隊列失敗：' + e.message, 'error');
    });
  }

  function toggleSpectate() {
    if (playContext !== 'room' || !roomState || !selfId || !App.Signaling) return;
    if (isSelfQueued()) {
      App.Common.showToast('你已在隊列中，請先離開隊列再切換觀戰', 'error');
      return;
    }
    var member = getSelfMember();
    var next = !(member && member.presence === 'spectating');
    var updates = {};
    updates['members/' + selfId + '/presence'] = next ? 'spectating' : 'lobby';
    updates['members/' + selfId + '/lastSeenAt'] = Date.now();
    App.Signaling.updateRoom(updates).then(function() {
      logRoomEvent('system', getSelfName() + (next ? ' 切換為觀戰' : ' 退出觀戰'), next ? 'spectate_on' : 'spectate_off');
    }).catch(function(e) {
      App.Common.showToast('更新觀戰狀態失敗：' + e.message, 'error');
    });
  }

  function updateRoomProfile(profile) {
    if (playContext !== 'room' || !roomState || !App.Signaling || !App.Signaling.updateProfile) return;
    App.Signaling.updateProfile(profile).then(function() {
      App.Common.showToast('身份標記已更新', 'success');
    }).catch(function(e) {
      App.Common.showToast(e.message || '更新身份標記失敗', 'error');
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

  function sendGameChat() {
    var input = document.getElementById('game-chat-input');
    var text = input ? input.value : '';
    if (!String(text || '').trim()) return;
    App.Signaling.sendChat(text).then(function() {
      if (input) input.value = '';
      lastSeenChatCount = Object.keys((roomState && roomState.chat) || {}).length;
      updateChatBadge(lastSeenChatCount);
    }).catch(function(e) {
      App.Common.showToast('送出訊息失敗：' + e.message, 'error');
    });
  }

  function toggleGameChat(force) {
    var drawer = document.getElementById('game-chat-drawer');
    if (!drawer) return;
    chatDrawerOpen = force === undefined ? !chatDrawerOpen : !!force;
    drawer.classList.toggle('open', chatDrawerOpen);
    drawer.setAttribute('aria-hidden', chatDrawerOpen ? 'false' : 'true');
    if (chatDrawerOpen) {
      lastSeenChatCount = Object.keys((roomState && roomState.chat) || {}).length;
      renderRoomChat();
      var input = document.getElementById('game-chat-input');
      if (input) setTimeout(function() { input.focus(); }, 40);
    } else {
      updateChatBadge(Object.keys((roomState && roomState.chat) || {}).length);
    }
  }

  function toggleRoomChat(force) {
    roomChatOpen = force === undefined ? !roomChatOpen : !!force;
    renderRoomChatPanelState();
  }

  function backFromGameSelect() {
    if (playContext === 'room') {
      // In room context, avoid accidental home redirect during transient room-state updates.
      if (roomState) {
        renderRoomLobby();
      } else {
        showScreen('room-lobby');
      }
      return;
    }
    goHome();
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
      processedVoteIds = {};
      launchedRoomGameKey = '';
      saveRoomSession(room);
      if (isHost) watchRoomAsHost();
      else watchRoomAsGuest();
      setTitle('房間 ' + room.code);
      App.Common.showToast('已返回房間 ' + room.code, 'success');
      logRoomEvent('system', playerName + ' 重新連線', 'room_resume');
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
    toggleSpectate: toggleSpectate,
    toggleRoomChat: toggleRoomChat,
    updateRoomProfile: updateRoomProfile,
    sendRoomChat: sendRoomChat,
    sendGameChat: sendGameChat,
    toggleGameChat: toggleGameChat,
    startRoomVote: startRoomVote,
    requestRoomAction: requestRoomAction,
    castRoomVote: castRoomVote,
    backFromGameSelect: backFromGameSelect,
    renderRoomLobby: renderRoomLobby,
    restartRoomGame: restartRoomGame,
    returnToRoomLobby: returnToRoomLobby,
    handleGameCloseAction: handleGameCloseAction,
    roomResultActionsHtml: roomResultActionsHtml,
    goHome: goHome,
    sendRoomGameAction: sendRoomGameAction,
    logRoomEvent: logRoomEvent,
    setTitle: setTitle
  };
})();

window.App = App;
