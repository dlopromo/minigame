var App = window.App || {};

App.WebRTC = (function() {
  var pc = null;
  var dc = null;
  var connected = false;
  var isHost = false;
  var retryCount = 0;
  var MAX_RETRIES = 5;

  var listeners = {
    'open': [],
    'close': [],
    'message': [],
    'error': []
  };

  function on(event, fn) {
    listeners[event].push(fn);
  }

  function off(event, fn) {
    listeners[event] = listeners[event].filter(function(f) { return f !== fn; });
  }

  function emit(event, data) {
    listeners[event].forEach(function(fn) { try { fn(data); } catch(e) {} });
  }

  function createPC() {
    var conn = new RTCPeerConnection({ iceServers: [] });

    conn.oniceconnectionstatechange = function() {
      if (conn.iceConnectionState === 'disconnected' && connected) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          App.Common.showToast('連線不穩，正在重試（' + retryCount + '/' + MAX_RETRIES + '）...', 'error');
          conn.restartIce();
        } else {
          App.Common.showToast('連線已中斷', 'error');
          emit('close');
        }
      } else if (conn.iceConnectionState === 'failed' && connected) {
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          App.Common.showToast('連線失敗，重試中（' + retryCount + '/' + MAX_RETRIES + '）...', 'error');
          setTimeout(function() { try { conn.restartIce(); } catch(e) {} }, 1000);
        } else {
          App.Common.showToast('連線失敗，已達重試上限', 'error');
          emit('close');
        }
      } else if (conn.iceConnectionState === 'connected' || conn.iceConnectionState === 'completed') {
        retryCount = 0;
      }
    };

    pc = conn;
    return conn;
  }

  function waitGathering(conn) {
    return new Promise(function(resolve) {
      if (conn.iceGatheringState === 'complete') return resolve();
      conn.addEventListener('icegatheringstatechange', function check() {
        if (conn.iceGatheringState === 'complete') {
          conn.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      });
      setTimeout(resolve, 10000);
    });
  }

  function bindChannel(channel) {
    dc = channel;
    channel.onopen = function() {
      connected = true;
      emit('open');
    };
    channel.onclose = function() {
      if (connected) {
        connected = false;
        emit('close');
      }
    };
    channel.onmessage = function(e) {
      try {
        emit('message', JSON.parse(e.data));
      } catch(err) {}
    };
  }

  function send(msg) {
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(msg));
    }
  }

  function createOffer() {
    isHost = true;
    var conn = createPC();
    bindChannel(conn.createDataChannel('game'));
    return conn.createOffer().then(function(offer) {
      return conn.setLocalDescription(offer);
    }).then(function() {
      return waitGathering(conn);
    }).then(function() {
      if (conn.localDescription) {
        return App.Common.encodeSDP(conn.localDescription.sdp);
      }
      throw new Error('Failed to create offer');
    });
  }

  function acceptAnswer(answerB64) {
    if (!pc || pc.signalingState !== 'have-local-offer') {
      throw new Error('Invalid state');
    }
    var sdp = App.Common.decodeSDP(answerB64);
    return pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sdp }));
  }

  function createAnswer(offerB64) {
    isHost = false;
    var sdp = App.Common.decodeSDP(offerB64);
    var conn = createPC();
    conn.ondatachannel = function(e) { bindChannel(e.channel); };
    return conn.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdp })).then(function() {
      return conn.createAnswer();
    }).then(function(answer) {
      return conn.setLocalDescription(answer);
    }).then(function() {
      return waitGathering(conn);
    }).then(function() {
      if (conn.localDescription) {
        return App.Common.encodeSDP(conn.localDescription.sdp);
      }
      throw new Error('Failed to create answer');
    });
  }

  function cleanDisconnect() {
    if (pc) { try { pc.close(); } catch(e) {} }
    pc = null; dc = null; connected = false; retryCount = 0;
  }

  function getIsHost() { return isHost; }
  function isConnected() { return connected; }

  return {
    on: on,
    off: off,
    send: send,
    createOffer: createOffer,
    acceptAnswer: acceptAnswer,
    createAnswer: createAnswer,
    cleanDisconnect: cleanDisconnect,
    getIsHost: getIsHost,
    isConnected: isConnected
  };
})();

window.App = App;
