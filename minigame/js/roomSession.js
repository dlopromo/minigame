var App = window.App || {};

App.RoomSession = (function() {
  var KEY = 'minigame.roomSession';
  var MAX_AGE_MS = 6 * 60 * 60 * 1000;

  function normalizeTicket(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var ticket = {
      roomCode: String(raw.roomCode || '').replace(/\D/g, '').slice(0, 4),
      clientId: String(raw.clientId || ''),
      authUid: String(raw.authUid || ''),
      username: String(raw.username || '').trim().slice(0, 12),
      isHost: !!raw.isHost,
      lastRole: raw.lastRole === 'spectator' ? 'spectator' : 'player',
      savedAt: Number(raw.savedAt || 0)
    };
    if (ticket.roomCode.length !== 4) return null;
    if (!/^[A-Za-z0-9-]{8,80}$/.test(ticket.clientId)) return null;
    if (!/^[A-Za-z0-9\u4e00-\u9fff]+$/.test(ticket.username)) return null;
    if (!ticket.savedAt || Date.now() - ticket.savedAt > MAX_AGE_MS) return null;
    return ticket;
  }

  function get() {
    try {
      return normalizeTicket(JSON.parse(localStorage.getItem(KEY) || 'null'));
    } catch(e) {
      return null;
    }
  }

  function save(ticket) {
    var normalized = normalizeTicket({
      roomCode: ticket.roomCode,
      clientId: ticket.clientId,
      authUid: ticket.authUid || '',
      username: ticket.username,
      isHost: !!ticket.isHost,
      lastRole: ticket.lastRole || 'player',
      savedAt: Date.now()
    });
    if (!normalized) return;
    localStorage.setItem(KEY, JSON.stringify(normalized));
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  return {
    get: get,
    save: save,
    clear: clear
  };
})();

window.App = App;
