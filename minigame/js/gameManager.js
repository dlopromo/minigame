var App = window.App || {};

App.GameManager = (function() {
  var games = {};
  var activeGame = null;
  var onGameEnd = null;

  function register(gameDef) {
    games[gameDef.id] = gameDef;
  }

  function getGames() {
    return Object.values(games);
  }

  function getGame(id) {
    return games[id] || null;
  }

  function loadGame(id) {
    return new Promise(function(resolve, reject) {
      if (games[id]) {
        resolve(games[id]);
        return;
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'games/' + id + '/' + id + '.css';
      document.head.appendChild(link);

      var script = document.createElement('script');
      script.src = 'games/' + id + '/' + id + '.js';
      script.onload = function() {
        if (games[id]) {
          resolve(games[id]);
        } else {
          reject(new Error('Game ' + id + ' did not register itself'));
        }
      };
      script.onerror = function() {
        reject(new Error('Failed to load game: ' + id));
      };
      document.body.appendChild(script);
    });
  }

  function startGame(id, container, opts, endCallback) {
    var game = games[id];
    if (!game) throw new Error('Game not found: ' + id);
    activeGame = game;
    onGameEnd = endCallback;
    container.innerHTML = '';
    try {
      game.init(container, opts);
    } catch (e) {
      activeGame = null;
      container.innerHTML = '<div class="card"><h2>遊戲啟動失敗</h2><p style="color:#667085;font-size:.85rem">' +
        (window.App && App.Common && App.Common.escapeHtml ? App.Common.escapeHtml(e.message) : 'Unknown error') +
        '</p></div>';
      throw e;
    }
  }

  function handleMessage(msg) {
    if (activeGame && activeGame.handleMessage) {
      activeGame.handleMessage(msg);
    }
  }

  function endGame(options) {
    options = options || {};
    if (activeGame && !options.skipConfirm && App.Common && !App.Common.confirmDanger('要離開目前遊戲嗎？')) {
      return false;
    }
    if (activeGame && activeGame.destroy) {
      activeGame.destroy();
    }
    activeGame = null;
    if (onGameEnd) {
      if (App.Common) App.Common.suppressNextDangerConfirm = true;
      onGameEnd();
      onGameEnd = null;
    }
    return true;
  }

  function getActiveGame() { return activeGame; }

  function handleShortcut(action) {
    if (!activeGame || !activeGame.handleShortcut) return false;
    return !!activeGame.handleShortcut(action);
  }

  return {
    register: register,
    getGames: getGames,
    getGame: getGame,
    loadGame: loadGame,
    startGame: startGame,
    handleMessage: handleMessage,
    endGame: endGame,
    handleShortcut: handleShortcut,
    getActiveGame: getActiveGame
  };
})();

window.App = App;
