var App = window.App || {};

App.RoomSeating = (function() {
  function toArray(map) {
    return Object.keys(map || {}).map(function(id) {
      var item = map[id] || {};
      return Object.assign({ id: id }, item);
    });
  }

  function personRecord(person, role) {
    var isAI = !!person.isAI || /^ai-/.test(person.id || '');
    return {
      id: person.id,
      name: person.name || (isAI ? 'AI' : '玩家'),
      role: role,
      isAI: isAI,
      online: isAI ? true : person.online !== false,
      authUid: person.authUid || '',
      playerColor: person.playerColor || '',
      playerIcon: person.playerIcon || '',
      joinedAt: person.joinedAt || Date.now(),
      lastSeenAt: person.lastSeenAt || Date.now(),
      connectionVersion: person.connectionVersion || 0
    };
  }

  function normalizeQueue(roomState) {
    var members = roomState && roomState.members ? roomState.members : {};
    return toArray(roomState && roomState.queue).map(function(item) {
      var member = members[item.id] || {};
      return Object.assign({}, member, item, {
        id: item.id,
        name: item.name || member.name || '玩家',
        queuedAt: item.queuedAt || member.joinedAt || 0,
        online: member.online !== false,
        playerColor: member.playerColor || item.playerColor || '',
        playerIcon: member.playerIcon || item.playerIcon || '',
        presence: member.presence || 'lobby',
        queueStatus: 'queued'
      });
    }).filter(function(person) {
      return person.online !== false;
    }).sort(function(a, b) {
      return (a.queuedAt || 0) - (b.queuedAt || 0);
    });
  }

  function normalizeMembers(roomState) {
    return toArray(roomState && roomState.members).sort(function(a, b) {
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
  }

  function pickSoloCandidate(roomState, members) {
    var hostId = roomState && roomState.hostId ? roomState.hostId : '';
    var preferred = members.filter(function(person) {
      return person.online !== false && person.presence !== 'spectating';
    }).sort(function(a, b) {
      if (a.id === hostId && b.id !== hostId) return -1;
      if (b.id === hostId && a.id !== hostId) return 1;
      return (a.joinedAt || 0) - (b.joinedAt || 0);
    });
    return preferred[0] || null;
  }

  function build(roomState, game) {
    var maxPlayers = Math.max(1, Number(game && game.maxPlayers || 2));
    var minRoomPlayers = Math.max(1, Number(game && (game.minRoomPlayers || game.minPlayers) || 1));
    var members = normalizeMembers(roomState).filter(function(person) { return person.online !== false; });
    var queue = normalizeQueue(roomState);
    var seatedRealPlayers = queue.slice(0, maxPlayers);
    if (!seatedRealPlayers.length && minRoomPlayers <= 1) {
      var fallback = pickSoloCandidate(roomState, members);
      if (fallback) {
        seatedRealPlayers = [Object.assign({}, fallback, {
          queuedAt: fallback.joinedAt || 0,
          queueStatus: fallback.queueStatus || 'auto'
        })];
      }
    }
    var seatedIds = {};
    seatedRealPlayers.forEach(function(person) { seatedIds[person.id] = true; });

    var players = seatedRealPlayers.map(function(person) {
      return personRecord(person, 'player');
    });
    if (game && game.aiFill) {
      while (players.length < maxPlayers) {
        var aiNumber = players.length + 1;
        players.push(personRecord({
          id: 'ai-' + aiNumber,
          name: 'AI ' + aiNumber,
          isAI: true,
          online: true
        }, 'player'));
      }
    }

    var queueMap = roomState && roomState.queue ? roomState.queue : {};
    var spectators = members.filter(function(person) {
      if (seatedIds[person.id]) return false;
      // Any remaining online member can spectate the current round.
      // This keeps solo-host rounds watchable without forcing extra真人入隊列.
      return true;
    }).map(function(person) {
      return personRecord(person, 'spectator');
    });

    var rolesByClientId = {};
    players.forEach(function(person) {
      if (!person.isAI) rolesByClientId[person.id] = 'player';
    });
    spectators.forEach(function(person) {
      rolesByClientId[person.id] = 'spectator';
    });

    return {
      canStart: seatedRealPlayers.length >= minRoomPlayers,
      minRoomPlayers: minRoomPlayers,
      maxPlayers: maxPlayers,
      queuedCount: queue.length,
      players: players,
      spectators: spectators,
      waitingQueue: queue.slice(maxPlayers),
      rolesByClientId: rolesByClientId
    };
  }

  return {
    build: build,
    normalizeQueue: normalizeQueue,
    normalizeMembers: normalizeMembers
  };
})();

window.App = App;
