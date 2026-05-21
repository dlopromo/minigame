var App = window.App || {};

App.WebRTC = (function() {
  var pc = null;
  var dc = null;
  var peers = {};
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

  function createPC(peerId) {
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

    if (!peerId) pc = conn;
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

  function bindChannel(channel, peerId) {
    dc = channel;
    channel.onopen = function() {
      connected = true;
      if (peerId && peers[peerId]) peers[peerId].connected = true;
      emit('open', { peerId: peerId || null });
    };
    channel.onclose = function() {
      if (peerId && peers[peerId]) peers[peerId].connected = false;
      if (connected && !hasOpenChannel()) {
        connected = false;
        emit('close', { peerId: peerId || null });
      }
    };
    channel.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        if (peerId) msg._from = peerId;
        emit('message', msg);
      } catch(err) {}
    };
  }

  function send(msg) {
    if (Object.keys(peers).length > 0 && isHost) {
      return broadcast(msg);
    }
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function sendTo(peerId, msg) {
    var peer = peers[peerId];
    if (peer && peer.dc && peer.dc.readyState === 'open') {
      peer.dc.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  function broadcast(msg, exceptPeerId) {
    var sent = false;
    Object.keys(peers).forEach(function(peerId) {
      if (peerId !== exceptPeerId && sendTo(peerId, msg)) sent = true;
    });
    return sent;
  }

  function hasOpenChannel() {
    if (dc && dc.readyState === 'open') return true;
    return Object.keys(peers).some(function(peerId) {
      return peers[peerId].dc && peers[peerId].dc.readyState === 'open';
    });
  }

  function ensurePeer(peerId, hostFlag) {
    if (!peers[peerId]) {
      peers[peerId] = {
        id: peerId,
        pc: createPC(peerId),
        dc: null,
        connected: false,
        isHostSide: !!hostFlag
      };
    }
    return peers[peerId];
  }

  function resetPeer(peerId) {
    if (!peers[peerId]) return;
    if (peers[peerId].pc) { try { peers[peerId].pc.close(); } catch(e) {} }
    delete peers[peerId];
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

  function createPeerOffer(peerId) {
    isHost = true;
    resetPeer(peerId);
    var peer = ensurePeer(peerId, true);
    peer.dc = peer.pc.createDataChannel('game-' + peerId);
    bindChannel(peer.dc, peerId);
    return peer.pc.createOffer().then(function(offer) {
      return peer.pc.setLocalDescription(offer);
    }).then(function() {
      return waitGathering(peer.pc);
    }).then(function() {
      if (peer.pc.localDescription) {
        return App.Common.encodeSDP(peer.pc.localDescription.sdp);
      }
      throw new Error('Failed to create peer offer');
    });
  }

  function acceptPeerAnswer(peerId, answerB64) {
    var peer = peers[peerId];
    if (!peer || !peer.pc || peer.pc.signalingState !== 'have-local-offer') {
      throw new Error('Invalid peer state');
    }
    var sdp = App.Common.decodeSDP(answerB64);
    return peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: sdp }));
  }

  function createPeerAnswer(peerId, offerB64) {
    isHost = false;
    resetPeer(peerId);
    var peer = ensurePeer(peerId, false);
    var sdp = App.Common.decodeSDP(offerB64);
    peer.pc.ondatachannel = function(e) {
      peer.dc = e.channel;
      bindChannel(e.channel, peerId);
    };
    return peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: sdp })).then(function() {
      return peer.pc.createAnswer();
    }).then(function(answer) {
      return peer.pc.setLocalDescription(answer);
    }).then(function() {
      return waitGathering(peer.pc);
    }).then(function() {
      if (peer.pc.localDescription) {
        return App.Common.encodeSDP(peer.pc.localDescription.sdp);
      }
      throw new Error('Failed to create peer answer');
    });
  }

  function cleanDisconnect() {
    if (pc) { try { pc.close(); } catch(e) {} }
    Object.keys(peers).forEach(function(peerId) {
      if (peers[peerId].pc) { try { peers[peerId].pc.close(); } catch(e) {} }
    });
    peers = {};
    pc = null; dc = null; connected = false; retryCount = 0;
  }

  function getIsHost() { return isHost; }
  function isConnected() { return connected; }
  function getPeerIds() { return Object.keys(peers); }
  function isPeerConnected(peerId) {
    return !!(peers[peerId] && peers[peerId].dc && peers[peerId].dc.readyState === 'open');
  }

  return {
    on: on,
    off: off,
    send: send,
    sendTo: sendTo,
    broadcast: broadcast,
    createOffer: createOffer,
    acceptAnswer: acceptAnswer,
    createAnswer: createAnswer,
    createPeerOffer: createPeerOffer,
    acceptPeerAnswer: acceptPeerAnswer,
    createPeerAnswer: createPeerAnswer,
    cleanDisconnect: cleanDisconnect,
    getIsHost: getIsHost,
    isConnected: isConnected,
    getPeerIds: getPeerIds,
    isPeerConnected: isPeerConnected
  };
})();

window.App = App;
