var App = window.App || {};

App.Common = {
  focusModeReady: false,
  focusModeActive: false,
  focusModeLastShift: 0,
  focusModePreviousTitle: '',
  shortcutsReady: false,
  suppressNextDangerConfirm: false,
  playerColors: [
    { id: 'red', name: '紅', value: '#E74C3C' },
    { id: 'blue', name: '藍', value: '#3498DB' },
    { id: 'green', name: '綠', value: '#2ECC71' },
    { id: 'yellow', name: '黃', value: '#F1C40F' },
    { id: 'purple', name: '紫', value: '#9B59B6' },
    { id: 'orange', name: '橙', value: '#E67E22' },
    { id: 'teal', name: '青綠', value: '#1ABC9C' },
    { id: 'pink', name: '粉紅', value: '#E84393' }
  ],
  playerIcons: [
    { id: 'fox', name: '狐狸', value: '🦊' },
    { id: 'cat', name: '貓', value: '🐱' },
    { id: 'dog', name: '狗', value: '🐶' },
    { id: 'bear', name: '熊', value: '🐻' },
    { id: 'rabbit', name: '兔', value: '🐰' },
    { id: 'panda', name: '熊貓', value: '🐼' },
    { id: 'penguin', name: '企鵝', value: '🐧' },
    { id: 'tiger', name: '老虎', value: '🐯' }
  ],

  isEditableTarget: function(target) {
    if (!target) return false;
    var tag = (target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  },

  showToast: function(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .3s';
      setTimeout(function() { toast.remove(); }, 300);
    }, 3000);
  },

  copyText: function(id) {
    var el = document.getElementById(id);
    el.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(el.value).catch(function() { document.execCommand('copy'); });
    } else {
      document.execCommand('copy');
    }
  },

  showScreen: function(id) {
    document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
    var el = document.getElementById('screen-' + id);
    if (el) el.classList.add('active');
    document.body.setAttribute('data-screen', id);
    if (id === 'home' && !this.focusModeActive) document.title = 'MiniGame';
  },

  escapeHtml: function(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  },

  getPlayerColor: function(id) {
    var found = this.playerColors.filter(function(item) { return item.id === id || item.value === id; })[0];
    return found || this.playerColors[0];
  },

  getPlayerIcon: function(id) {
    var found = this.playerIcons.filter(function(item) { return item.id === id || item.value === id; })[0];
    return found || this.playerIcons[0];
  },

  renderPlayerAvatar: function(person, extraClass) {
    person = person || {};
    var color = this.getPlayerColor(person.playerColor);
    var icon = this.getPlayerIcon(person.playerIcon);
    return '<span class="room-avatar ' + (extraClass || '') + '" style="--player-color:' + color.value + '" title="' +
      this.escapeHtml(icon.name + ' / ' + color.name) + '">' + this.escapeHtml(icon.value) + '</span>';
  },

  renderPlayerBadge: function(person, extraClass) {
    person = person || {};
    var color = this.getPlayerColor(person.playerColor);
    var name = person.name || person.displayName || '玩家';
    return '<span class="app-player-badge ' + (extraClass || '') + '" style="--player-color:' + color.value + '">' +
      this.renderPlayerAvatar(person) +
      '<span>' + this.escapeHtml(name) + '</span>' +
    '</span>';
  },

  renderGameBadge: function(gameId, label, extraClass) {
    var map = {
      blackjack: { icon: 'fa-solid fa-spade', text: '21' },
      baccarat: { icon: 'fa-solid fa-club', text: '百家樂' },
      sicBo: { icon: 'fa-solid fa-dice', text: '大小' },
      bigDee: { icon: 'fa-solid fa-layer-group', text: '鋤大Dee' },
      douDizhu: { icon: 'fa-solid fa-crown', text: '地主' },
      colorShift: { icon: 'fa-solid fa-arrows-rotate', text: '轉色牌' },
      snapStack: { icon: 'fa-solid fa-clone', text: '冚棉胎' },
      tile2048: { icon: 'fa-solid fa-grid-2', text: '2048' },
      nineUpper: { icon: 'fa-solid fa-comment-dots', text: '9UPPER' }
    };
    var item = map[gameId] || { icon: 'fa-solid fa-gamepad', text: label || 'MiniGame' };
    return '<span class="app-game-badge ' + (extraClass || '') + '" data-game-id="' + this.escapeHtml(gameId || '') + '">' +
      '<i class="' + this.escapeHtml(item.icon) + '" aria-hidden="true"></i>' +
      '<span>' + this.escapeHtml(label || item.text) + '</span>' +
    '</span>';
  },

  renderGameChrome: function(options) {
    options = options || {};
    var titleClass = options.myTurn ? ' my-turn' : '';
    var chatButton = options.roomMode
      ? '<button class="app-icon-btn game-chat-trigger" type="button" onclick="App.Lobby.toggleGameChat()" aria-label="Chat"><i class="fa-regular fa-comments" aria-hidden="true"></i><span class="chat-badge game-chat-unread"></span></button>'
      : '';
    var infoButton = options.infoId
      ? '<button class="app-icon-btn" type="button" onclick="document.getElementById(\'' + this.escapeHtml(options.infoId) + '\')?.classList.toggle(\'open\')" aria-label="資訊"><i class="fa-solid fa-circle-info" aria-hidden="true"></i></button>'
      : '';
    var closeAction = options.roomMode
      ? 'App.Lobby.handleGameCloseAction({skipConfirm:true})'
      : 'App.GameManager.endGame({skipConfirm:true})';
    return '<div class="app-game-topbar">' +
      '<div class="app-game-title' + titleClass + '">' + this.escapeHtml(options.title || 'MiniGame') + '</div>' +
      '<div class="app-game-tools">' + (options.toolsHtml || '') + chatButton + infoButton +
        '<button class="app-icon-btn" type="button" onclick="' + closeAction + '" aria-label="離開遊戲"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '</div>' +
    '</div>';
  },

  renderInfoDrawer: function(options) {
    options = options || {};
    var sections = (options.sections || []).map(function(section) {
      return '<section class="app-info-section">' +
        '<h3>' + App.Common.escapeHtml(section.title || '') + '</h3>' +
        '<div>' + (section.html || '') + '</div>' +
      '</section>';
    }).join('');
    return '<aside class="app-info-drawer" id="' + this.escapeHtml(options.id || 'game-info-drawer') + '">' +
      '<div class="app-info-head"><strong>' + this.escapeHtml(options.title || '資訊') + '</strong>' +
        '<button class="app-icon-btn" type="button" onclick="this.closest(\'.app-info-drawer\').classList.remove(\'open\')" aria-label="關閉"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button></div>' +
      '<div class="app-info-body">' + sections + '</div>' +
    '</aside>';
  },

  renderActionBar: function(actions) {
    return '<div class="app-action-bar">' + (actions || []).map(function(action) {
      var cls = action.primary ? ' primary' : action.warn ? ' warn' : '';
      return '<button class="app-action-btn' + cls + '" type="button" ' +
        (action.id ? 'id="' + App.Common.escapeHtml(action.id) + '" ' : '') +
        (action.disabled ? 'disabled ' : '') +
        (action.onClick ? 'onclick="' + App.Common.escapeHtml(action.onClick) + '" ' : '') +
        '>' + (action.icon ? '<i class="' + App.Common.escapeHtml(action.icon) + '" aria-hidden="true"></i>' : '') +
        '<span>' + App.Common.escapeHtml(action.label || '') + '</span></button>';
    }).join('') + '</div>';
  },

  renderResultPanel: function(options) {
    options = options || {};
    var rows = (options.rows || []).map(function(row) {
      var avatar = row.person ? App.Common.renderPlayerAvatar(row.person) : '';
      return '<div class="game-result-row">' +
        '<div class="game-result-rank">' + App.Common.escapeHtml(row.rank || '') + '</div>' +
        '<div class="game-result-name">' + avatar + '<span>' + App.Common.escapeHtml(row.name || '玩家') + '</span></div>' +
        '<div class="game-result-stat">' + App.Common.escapeHtml(row.primary || '') + '</div>' +
        '<div class="game-result-stat muted">' + App.Common.escapeHtml(row.secondary || '') + '</div>' +
      '</div>';
    }).join('');
    var history = (options.history || []).slice(0, 8).map(function(item) {
      return '<div class="game-result-history-row"><span>' + App.Common.escapeHtml(item.label || item.player || '') + '</span><span>' + App.Common.escapeHtml(item.text || '') + '</span></div>';
    }).join('');
    var roomActions = App.Lobby && App.Lobby.roomResultActionsHtml ? App.Lobby.roomResultActionsHtml() : '';
    var actionsHtml = (options.actionsHtml || '') + roomActions;
    return '<section class="game-result-panel">' +
      '<div class="game-result-hero">' +
        '<span>' + App.Common.escapeHtml(options.eyebrow || 'Result') + '</span>' +
        '<h2>' + App.Common.escapeHtml(options.title || '結算') + '</h2>' +
        (options.subtitle ? '<p>' + App.Common.escapeHtml(options.subtitle) + '</p>' : '') +
      '</div>' +
      '<div class="game-result-list">' + rows + '</div>' +
      (history ? '<div class="game-result-history">' + history + '</div>' : '') +
      (actionsHtml ? '<div class="game-result-actions">' + actionsHtml + '</div>' : '') +
    '</section>';
  },

  renderResultDialog: function(options) {
    options = options || {};
    var body = this.renderResultPanel(options);
    return '<section class="game-result-modal" role="dialog" aria-modal="true">' +
      '<div class="game-result-backdrop"></div>' +
      '<div class="game-result-dialog">' + body + '</div>' +
    '</section>';
  },

  initFocusMode: function() {
    if (this.focusModeReady) return;
    this.focusModeReady = true;
    var self = this;
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key || '').toLowerCase() === 'b') {
        e.preventDefault();
        self.setFocusMode(!self.focusModeActive);
        self.focusModeLastShift = 0;
        return;
      }
      if (e.key === 'Escape' && self.focusModeActive) {
        e.preventDefault();
        self.setFocusMode(false);
        return;
      }
      if (self.isEditableTarget(e.target)) return;
      if (e.key !== 'Shift' || e.repeat) return;
      var now = Date.now();
      if (now - self.focusModeLastShift < 520) {
        e.preventDefault();
        self.setFocusMode(!self.focusModeActive);
        self.focusModeLastShift = 0;
      } else {
        self.focusModeLastShift = now;
      }
    }, true);
  },

  setFocusMode: function(active) {
    var cover = document.getElementById('focus-cover');
    if (!cover) return;
    this.focusModeActive = !!active;
    document.body.classList.toggle('focus-mode-active', this.focusModeActive);
    cover.setAttribute('aria-hidden', this.focusModeActive ? 'false' : 'true');
    if (this.focusModeActive) {
      this.focusModePreviousTitle = document.title;
      document.title = 'Workspace Brief';
    } else if (this.focusModePreviousTitle) {
      document.title = this.focusModePreviousTitle;
    }
  },

  initGlobalShortcuts: function() {
    if (this.shortcutsReady) return;
    this.shortcutsReady = true;
    var self = this;
    document.addEventListener('keydown', function(e) {
      if (self.focusModeActive || self.isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      var action = '';
      var key = String(e.key || '').toLowerCase();
      if (key === ' ') action = 'primary';
      else if (key === 'p') action = 'pass';
      else if (key === 's') action = 'suggest';
      else if (key === 'escape') action = 'cancel';
      if (!action || !App.GameManager || !App.GameManager.handleShortcut) return;
      if (App.GameManager.handleShortcut(action)) e.preventDefault();
    }, true);
  },

  confirmDanger: function(message) {
    if (this.suppressNextDangerConfirm) {
      this.suppressNextDangerConfirm = false;
      return true;
    }
    return window.confirm(message || '確定要離開目前畫面？');
  }
};

window.App = App;
