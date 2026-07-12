/* ###################### AIDA CHAT VIEW ###################### */
/*
 * AIDA personal assistant chat interface for Taakl.
 *
 * Globals defined here:
 *   aidaChat  — view object (show/hide/update lifecycle)
 *   aidaWs    — WebSocket connection manager
 *   aidaApi   — REST API wrapper
 *
 * Depends on: ajaxReq(), gebi(), escapeHtml(), setFeedback(),
 *             removeEventWatchers() — all from timetracker.js
 */

/* ---- Configuration ---- */

var aidaConfig = {
  defaultUrl: 'https://aida.taakl.app',
  defaultKey: '',

  getUrl: function() {
    return localStorage.aidaApiUrl || aidaConfig.defaultUrl;
  },
  getKey: function() {
    return localStorage.aidaApiKey || aidaConfig.defaultKey;
  }
};


/* ###################### REST API WRAPPER ###################### */

var aidaApi = {};

// callback signature: callback(err, result, statusCode)
aidaApi._request = function(method, path, data, callback, timeout) {
  var opts = {
    url: aidaConfig.getUrl() + path,
    type: method,
    contentType: 'application/json',
    headers: {
      'X-API-Key': aidaConfig.getKey()
    },
    success: function(result) {
      if (callback) callback(null, result, 200);
    },
    error: function(xhr, opts, statusText) {
      var errMsg = statusText || 'Request failed';
      try {
        var body = JSON.parse(xhr.responseText);
        if (body.message) errMsg = body.message;
        if (body.detail) errMsg = body.detail;
      } catch(e) {}
      if (callback) callback(errMsg, null, xhr.status);
    }
  };
  if (timeout) opts.timeout = timeout;
  if (data) {
    opts.data = JSON.stringify(data);
  }
  ajaxReq(opts);
};

aidaApi.fetchHistory = function(callback) {
  aidaApi._request('GET', '/api/v1/messages/history?limit=30', null, callback);
};

aidaApi.fetchPending = function(callback) {
  aidaApi._request('GET', '/api/v1/messages/pending', null, callback);
};

aidaApi.sendMessage = function(content, callback) {
  // A5: an agent turn can take minutes, so give the synchronous send a very
  // long timeout. A1/A3 (reconnect + pending pull) are the real backstop if
  // the connection is cut before the reply returns.
  aidaApi._request('POST', '/api/v1/messages/send', {content: content}, callback, 300000);
};

/* ---- Approval gate (Part B) ---- */

aidaApi.fetchPendingApprovals = function(callback) {
  aidaApi._request('GET', '/api/v1/approvals/pending', null, callback);
};

aidaApi.getApproval = function(id, callback) {
  aidaApi._request('GET', '/api/v1/approvals/' + encodeURIComponent(id), null, callback);
};

aidaApi.approveRequest = function(id, callback) {
  aidaApi._request('POST', '/api/v1/approvals/' + encodeURIComponent(id) + '/approve', null, callback);
};

aidaApi.rejectRequest = function(id, callback) {
  aidaApi._request('POST', '/api/v1/approvals/' + encodeURIComponent(id) + '/reject', null, callback);
};

aidaApi.triggerCommand = function(name, callback) {
  aidaApi._request('POST', '/api/v1/trigger/' + name, null, callback);
};

aidaApi.draftAction = function(draftId, action, editedContent, callback) {
  var body = {draft_id: draftId, action: action};
  if (action === 'edit' && editedContent) {
    body.edited_content = editedContent;
  }
  aidaApi._request('POST', '/api/v1/drafts/action', body, callback);
};

// Upload a recorded audio blob for transcription. Sent as multipart/form-data
// so the API key stays server-side (the backend calls the speech-to-text
// provider). Returns { text: "..." } on success.
aidaApi.transcribe = function(blob, filename, callback) {
  var form = new FormData();
  form.append('audio', blob, filename);
  ajaxReq({
    url: aidaConfig.getUrl() + '/api/v1/transcribe',
    type: 'POST',
    // No contentType: let the browser set the multipart boundary header.
    headers: {
      'X-API-Key': aidaConfig.getKey()
    },
    data: form,
    timeout: 60000,
    success: function(result) {
      if (callback) callback(null, result);
    },
    error: function(xhr, opts, statusText) {
      var errMsg = statusText || 'Transcription failed';
      try {
        var body = JSON.parse(xhr.responseText);
        if (body.message) errMsg = body.message;
        if (body.detail) errMsg = body.detail;
      } catch(e) {}
      if (callback) callback(errMsg, null);
    }
  });
};


/* ###################### WEBSOCKET MANAGER ###################### */

var aidaWs = {};

aidaWs._socket = null;
aidaWs._keepaliveInterval = null;
aidaWs._pongTimeout = null;
aidaWs._reconnectTimer = null;
aidaWs._retryDelay = 500;
aidaWs._maxRetryDelay = 10000;
aidaWs._intentionalClose = false;
aidaWs._authenticated = false;

aidaWs.connect = function() {
  if (aidaWs._socket && aidaWs._socket.readyState <= 1) {
    return; // already connecting or open
  }

  aidaWs._intentionalClose = false;
  aidaWs._authenticated = false;

  var wsUrl = aidaConfig.getUrl().replace(/^http/, 'ws') + '/api/v1/ws';
  aidaChat.setConnectionStatus('connecting');

  try {
    aidaWs._socket = new WebSocket(wsUrl);
  } catch(e) {
    aidaChat.setConnectionStatus('disconnected');
    aidaWs._scheduleReconnect();
    return;
  }

  aidaWs._socket.onopen = function() {
    aidaWs._retryDelay = 500;
    aidaWs._authenticate();
  };

  aidaWs._socket.onmessage = function(event) {
    var data;
    try {
      data = JSON.parse(event.data);
    } catch(e) {
      return;
    }
    aidaWs._handleMessage(data);
  };

  aidaWs._socket.onclose = function() {
    aidaWs._stopKeepalive();
    aidaWs._authenticated = false;
    if (!aidaWs._intentionalClose) {
      aidaChat.setConnectionStatus('disconnected');
      aidaWs._scheduleReconnect();
    }
  };

  aidaWs._socket.onerror = function() {
    // onclose will fire after this
  };
};

aidaWs.disconnect = function() {
  aidaWs._intentionalClose = true;
  aidaWs._stopKeepalive();
  if (aidaWs._reconnectTimer) {
    clearTimeout(aidaWs._reconnectTimer);
    aidaWs._reconnectTimer = null;
  }
  if (aidaWs._socket) {
    aidaWs._socket.close();
    aidaWs._socket = null;
  }
  aidaWs._authenticated = false;
  aidaWs._retryDelay = 500;
};

aidaWs.send = function(obj) {
  if (aidaWs._socket && aidaWs._socket.readyState === 1) {
    aidaWs._socket.send(JSON.stringify(obj));
    return true;
  }
  return false;
};

aidaWs._authenticate = function() {
  aidaWs.send({type: 'auth', api_key: aidaConfig.getKey()});
};

aidaWs._handleMessage = function(data) {
  switch (data.type) {
    case 'auth':
      if (data.status === 'ok') {
        aidaWs._authenticated = true;
        aidaChat.setConnectionStatus('connected');
        aidaWs._startKeepalive();
        // A1: on every (re)connect, pull anything queued while we were away so
        // a reply generated during a disconnect shows up within seconds.
        aidaChat._fetchPendingMessages();
        aidaApprovals.fetchPending();
      } else {
        aidaChat.setConnectionStatus('disconnected');
        aidaChat._showSystemMessage('Authentication failed. Check your API key in Settings.');
      }
      break;

    case 'message':
      aidaWs._renderIncoming(data);
      break;

    case 'typing':
      aidaChat._setTyping(data.status);
      break;

    case 'approval_request':
      // Part B — a pending human-approval gate request.
      aidaApprovals.handlePush(data.approval);
      break;

    case 'pong':
      if (aidaWs._pongTimeout) {
        clearTimeout(aidaWs._pongTimeout);
        aidaWs._pongTimeout = null;
      }
      break;

    case 'error':
      aidaChat._showSystemMessage('Error: ' + (data.message || 'Unknown error'));
      break;

    default:
      // Defense-in-depth (§2.3): the envelope is normalized to type:"message",
      // but still accept any frame carrying both role and content as a chat
      // message. Dedupe by id keeps this safe.
      if (data.role && typeof data.content === 'string') {
        aidaWs._renderIncoming(data);
      }
  }
};

aidaWs._renderIncoming = function(data) {
  aidaChat.addMessage({
    id: data.id,
    role: data.role || 'assistant',
    type: data.msg_type || 'chat',
    content: data.content,
    metadata: data.metadata || null,
    created_at: data.created_at || new Date().toISOString()
  });
};

aidaWs._startKeepalive = function() {
  aidaWs._stopKeepalive();
  // A2: ping every ~22s to keep the socket alive through proxies across a
  // multi-minute turn; if no pong arrives within ~10s the connection is dead.
  aidaWs._keepaliveInterval = setInterval(function() {
    if (!aidaWs.send({type: 'ping'})) return;
    if (aidaWs._pongTimeout) clearTimeout(aidaWs._pongTimeout);
    aidaWs._pongTimeout = setTimeout(function() {
      // No pong received — treat as disconnected and reconnect.
      if (aidaWs._socket) {
        aidaWs._socket.close();
      }
    }, 10000);
  }, 22000);
};

aidaWs._stopKeepalive = function() {
  if (aidaWs._keepaliveInterval) {
    clearInterval(aidaWs._keepaliveInterval);
    aidaWs._keepaliveInterval = null;
  }
  if (aidaWs._pongTimeout) {
    clearTimeout(aidaWs._pongTimeout);
    aidaWs._pongTimeout = null;
  }
};

aidaWs._scheduleReconnect = function() {
  if (aidaWs._intentionalClose) return;
  if (aidaWs._reconnectTimer) return;

  // A1: exponential backoff (0.5s → 1s → 2s → … cap 10s) plus jitter so a
  // fleet of reconnecting clients doesn't stampede the server in lockstep.
  var jitter = Math.floor(Math.random() * 400);
  var delay = aidaWs._retryDelay + jitter;

  aidaWs._reconnectTimer = setTimeout(function() {
    aidaWs._reconnectTimer = null;
    aidaWs.connect();
  }, delay);

  aidaWs._retryDelay = Math.min(aidaWs._retryDelay * 2, aidaWs._maxRetryDelay);
};


/* ###################### MARKDOWN RENDERER ###################### */

function aidaRenderMarkdown(text) {
  if (!text) return '';

  // Escape HTML first to prevent XSS
  var html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```([\s\S]*?)```/g, function(match, code) {
    return '<pre class="aida-code-block"><code>' + code.trim() + '</code></pre>';
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="aida-inline-code">$1</code>');

  // Headings (must be at start of line)
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Unordered lists — collect consecutive lines starting with "- "
  html = html.replace(/(^- .+$(\n|$))+/gm, function(block) {
    var items = block.trim().split('\n');
    var listHtml = '<ul>';
    for (var i = 0; i < items.length; i++) {
      listHtml += '<li>' + items[i].replace(/^- /, '') + '</li>';
    }
    listHtml += '</ul>';
    return listHtml;
  });

  // Ordered lists — collect consecutive lines starting with "1. ", "2. ", etc.
  html = html.replace(/(^\d+\. .+$(\n|$))+/gm, function(block) {
    var items = block.trim().split('\n');
    var listHtml = '<ol>';
    for (var i = 0; i < items.length; i++) {
      listHtml += '<li>' + items[i].replace(/^\d+\. /, '') + '</li>';
    }
    listHtml += '</ol>';
    return listHtml;
  });

  // Line breaks (convert remaining newlines to <br>, but not inside block elements)
  html = html.replace(/\n/g, '<br>');

  // Clean up extra <br> after block elements
  html = html.replace(/<\/(h[234]|ul|ol|pre|hr)><br>/g, '</$1>');
  html = html.replace(/<hr><br>/g, '<hr>');

  return html;
}


/* ###################### CHAT VIEW ###################### */

var aidaChat = window.aidaChat || {};

aidaChat.messages = [];
aidaChat._messageIds = {};
aidaChat._isTyping = false;
aidaChat._sendQueue = [];

// A4: "thinking…" placeholder state machine
aidaChat._turnOutstanding = false;
aidaChat._failsafeTimer = null;
aidaChat._FAILSAFE_MS = 300000; // 5 min

// Backstop poll for pending messages/approvals while the panel is open
aidaChat._pollTimer = null;
aidaChat._POLL_MS = 30000;


/* ---- View Lifecycle ---- */

aidaChat.show = function() {
  // Reset state
  aidaChat.messages = [];
  aidaChat._messageIds = {};
  aidaChat._isTyping = false;
  aidaChat._clearThinking();
  aidaApprovals.reset();

  // Clear message area
  var msgContainer = gebi('aida-messages');
  if (msgContainer) msgContainer.innerHTML = '';

  // Set up input handlers
  aidaChat._initInput();

  // A1: reconnect the moment the tab comes back to the foreground.
  document.addEventListener('visibilitychange', aidaChat._onVisibility);

  // Backstop poll (in addition to the WS push + reconnect pulls).
  if (aidaChat._pollTimer) clearInterval(aidaChat._pollTimer);
  aidaChat._pollTimer = setInterval(function() {
    if (aidaWs._authenticated) {
      aidaChat._fetchPendingMessages();
      aidaApprovals.fetchPending();
    }
  }, aidaChat._POLL_MS);

  // Set initial connection status
  aidaChat.setConnectionStatus('connecting');

  // Startup sequence: fetch history, then connect WebSocket
  aidaApi.fetchHistory(function(err, result) {
    if (err) {
      aidaChat._showSystemMessage('Could not load history: ' + err);
      aidaWs.connect();
      return;
    }
    var msgs = (result && result.messages) ? result.messages : [];
    // Client-side cap: keep only the most recent 30
    if (msgs.length > 30) msgs = msgs.slice(msgs.length - 30);
    aidaChat._addMessageBatch(msgs);
    // Land at the most recent message once the DOM has actually laid out.
    aidaChat._scrollToBottomSoon();
    aidaWs.connect();
  });

  // Focus input
  var input = gebi('aida-input');
  if (input) input.focus();
};

aidaChat.hide = function() {
  // Stop any in-progress recording without sending it for transcription
  aidaChat._abortRecording();

  // Disconnect WebSocket
  aidaWs.disconnect();

  // Tear down timers/listeners
  document.removeEventListener('visibilitychange', aidaChat._onVisibility);
  if (aidaChat._pollTimer) {
    clearInterval(aidaChat._pollTimer);
    aidaChat._pollTimer = null;
  }
  aidaChat._clearThinking();
  aidaApprovals.reset();

  // Stop any in-flight initial-load scroll pin.
  if (aidaChat._scrollPinRaf) {
    cancelAnimationFrame(aidaChat._scrollPinRaf);
    aidaChat._scrollPinRaf = null;
  }
  aidaChat._stopScrollPin();

  // Clean up event watchers
  removeEventWatchers('aidaChat');
};

aidaChat._onVisibility = function() {
  if (document.visibilityState !== 'visible') return;
  // If the socket isn't open/connecting, reconnect immediately.
  if (!aidaWs._socket || aidaWs._socket.readyState > 1) {
    aidaWs._retryDelay = 500;
    aidaWs.connect();
  }
};

aidaChat.update = function() {
  // No-op for now — messages are rendered incrementally
};


/* ---- Startup helpers ---- */

aidaChat._fetchPendingMessages = function() {
  aidaApi.fetchPending(function(err, result) {
    if (err) return;
    var msgs = (result && result.messages) ? result.messages : [];
    for (var i = 0; i < msgs.length; i++) {
      aidaChat.addMessage(msgs[i]);
    }
  });
};


/* ---- Input handling ---- */

aidaChat._inputInitialized = false;

aidaChat._initInput = function() {
  var input = gebi('aida-input');
  if (!input) return;

  // Reset
  input.value = '';
  input.style.height = 'auto';

  // Only bind events once
  if (aidaChat._inputInitialized) return;
  aidaChat._inputInitialized = true;

  input.addEventListener('keydown', function(e) {
    if (e.keyCode === 13 && !e.shiftKey) {
      e.preventDefault();
      aidaChat.sendMessage();
    }
  });

  input.addEventListener('input', function() {
    // Auto-resize textarea
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Hide the mic button if this browser can't record audio
  if (!aidaChat._voiceSupported()) {
    var micBtn = gebi('aida-mic-btn');
    if (micBtn) micBtn.style.display = 'none';
  }
};


/* ---- Voice input (record -> transcribe -> drop into the input box) ---- */

aidaChat._recorder = null;
aidaChat._recStream = null;
aidaChat._recChunks = [];
aidaChat._recording = false;

aidaChat._voiceSupported = function() {
  return !!(navigator.mediaDevices &&
            navigator.mediaDevices.getUserMedia &&
            typeof MediaRecorder !== 'undefined');
};

aidaChat.toggleRecording = function() {
  if (aidaChat._recording) {
    aidaChat._stopRecording();
  } else {
    aidaChat._startRecording();
  }
};

aidaChat._startRecording = function() {
  if (!aidaChat._voiceSupported()) {
    aidaChat._showSystemMessage('Voice input is not supported in this browser.');
    return;
  }
  navigator.mediaDevices.getUserMedia({audio: true}).then(function(stream) {
    aidaChat._recStream = stream;
    aidaChat._recChunks = [];

    var rec;
    try {
      rec = new MediaRecorder(stream);
    } catch(e) {
      aidaChat._cleanupRecording();
      aidaChat._showSystemMessage('Could not start recording: ' + e.message);
      return;
    }
    aidaChat._recorder = rec;

    rec.ondataavailable = function(e) {
      if (e.data && e.data.size > 0) aidaChat._recChunks.push(e.data);
    };
    rec.onstop = function() {
      aidaChat._handleRecordingStop();
    };

    rec.start();
    aidaChat._recording = true;
    aidaChat._setMicState('recording');
  }).catch(function(err) {
    aidaChat._cleanupRecording();
    var msg = (err && err.name === 'NotAllowedError')
      ? 'Microphone permission denied.'
      : 'Could not access microphone.';
    aidaChat._showSystemMessage(msg);
  });
};

aidaChat._stopRecording = function() {
  if (aidaChat._recorder && aidaChat._recorder.state !== 'inactive') {
    aidaChat._recording = false;
    aidaChat._setMicState('transcribing');
    aidaChat._recorder.stop(); // fires onstop -> _handleRecordingStop
  } else {
    aidaChat._cleanupRecording();
  }
};

// Stop recording without transcribing (used when leaving the view).
aidaChat._abortRecording = function() {
  if (aidaChat._recorder && aidaChat._recorder.state !== 'inactive') {
    aidaChat._recorder.onstop = null;
    try { aidaChat._recorder.stop(); } catch(e) {}
  }
  aidaChat._cleanupRecording();
};

aidaChat._handleRecordingStop = function() {
  var chunks = aidaChat._recChunks;
  var mime = (aidaChat._recorder && aidaChat._recorder.mimeType)
    ? aidaChat._recorder.mimeType : 'audio/webm';

  // Release the microphone now that we have the data
  aidaChat._stopStream();
  aidaChat._recChunks = [];

  if (!chunks.length) {
    aidaChat._setMicState('idle');
    return;
  }

  var blob = new Blob(chunks, {type: mime});

  // Pick a filename extension the backend / STT provider will recognise.
  var ext = 'webm';
  if (mime.indexOf('mp4') !== -1 || mime.indexOf('aac') !== -1 || mime.indexOf('m4a') !== -1) {
    ext = 'm4a';
  } else if (mime.indexOf('ogg') !== -1) {
    ext = 'ogg';
  } else if (mime.indexOf('wav') !== -1) {
    ext = 'wav';
  }

  aidaApi.transcribe(blob, 'recording.' + ext, function(err, result) {
    aidaChat._setMicState('idle');
    if (err) {
      aidaChat._showSystemMessage('Transcription failed: ' + err);
      return;
    }
    var text = (result && (result.text || result.transcript)) || '';
    text = text.trim();
    if (!text) {
      aidaChat._showSystemMessage('No speech detected.');
      return;
    }
    aidaChat._insertTranscript(text);
  });
};

// Append transcribed text to whatever is already in the input box, so you
// can review/edit before sending (deliberately does NOT auto-send).
aidaChat._insertTranscript = function(text) {
  var input = gebi('aida-input');
  if (!input) return;
  var existing = input.value.trim();
  input.value = existing ? (existing + ' ' + text) : text;
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch(e) {}
};

aidaChat._stopStream = function() {
  if (aidaChat._recStream) {
    var tracks = aidaChat._recStream.getTracks();
    for (var i = 0; i < tracks.length; i++) tracks[i].stop();
    aidaChat._recStream = null;
  }
};

aidaChat._cleanupRecording = function() {
  aidaChat._recording = false;
  aidaChat._stopStream();
  aidaChat._recorder = null;
  aidaChat._recChunks = [];
  aidaChat._setMicState('idle');
};

aidaChat._setMicState = function(state) {
  var btn = gebi('aida-mic-btn');
  if (!btn) return;
  var icon = btn.querySelector('i');
  btn.classList.remove('recording', 'transcribing');

  if (state === 'recording') {
    btn.classList.add('recording');
    btn.disabled = false;
    btn.title = 'Stop recording';
    if (icon) icon.className = 'fa fa-stop';
  } else if (state === 'transcribing') {
    btn.classList.add('transcribing');
    btn.disabled = true;
    btn.title = 'Transcribing…';
    if (icon) icon.className = 'fa fa-spinner fa-spin';
  } else { // idle
    btn.disabled = false;
    btn.title = 'Record voice';
    if (icon) icon.className = 'fa fa-microphone';
  }
};


/* ---- Sending messages ---- */

aidaChat.sendMessage = function() {
  var input = gebi('aida-input');
  if (!input) return;

  var text = input.value.trim();
  if (!text) return;

  // Clear input
  input.value = '';
  input.style.height = 'auto';

  // Check for slash commands
  if (text === '/morning' || text === '/briefing') {
    aidaChat.triggerAction('morning');
    return;
  }
  if (text === '/week' || text === '/weekly') {
    aidaChat.triggerAction('weekly-review');
    return;
  }
  if (text === '/email') {
    aidaChat.triggerAction('email');
    return;
  }

  // Add user message to chat (optimistic render)
  var userMsg = {
    id: 'local-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6),
    role: 'user',
    type: 'chat',
    content: text,
    metadata: null,
    created_at: new Date().toISOString()
  };
  aidaChat.addMessage(userMsg);

  // A4: a turn is now outstanding — show the "thinking…" placeholder and arm
  // the failsafe so the spinner can never stick.
  aidaChat._showThinking();

  // Send via WebSocket if connected, else REST fallback
  var sent = aidaWs.send({type: 'message', content: text});
  if (!sent) {
    // REST fallback
    aidaApi.sendMessage(text, function(err, result) {
      if (err) {
        aidaChat._clearThinking();
        aidaChat._showSystemMessage('Failed to send: ' + err);
        return;
      }
      if (result) {
        aidaChat.addMessage({
          id: result.id,
          role: result.role || 'assistant',
          type: result.type || 'chat',
          content: result.content,
          metadata: null,
          created_at: new Date().toISOString()
        });
      }
    });
  }
};


/* ---- Quick action triggers ---- */

aidaChat.triggerAction = function(name) {
  // Find the button and show loading state
  var btns = document.querySelectorAll('.aida-action-btn');
  var btn = null;
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute('data-action') === name) {
      btn = btns[i];
      break;
    }
  }
  if (btn) {
    btn.classList.add('loading');
    btn.disabled = true;
  }

  aidaApi.triggerCommand(name, function(err) {
    if (btn) {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
    if (err) {
      aidaChat._showSystemMessage('Could not trigger ' + name + ': ' + err);
    }
    // Response will arrive via WebSocket as a new message
  });
};


/* ---- Message management ---- */

aidaChat.addMessage = function(msg) {
  if (!msg || !msg.id) return;

  // Deduplicate by ID
  if (aidaChat._messageIds[msg.id]) return;
  aidaChat._messageIds[msg.id] = true;

  aidaChat.messages.push(msg);

  // A4: any assistant chat reply (live or via pending) resolves an outstanding
  // turn — clear the "thinking…" placeholder.
  var role = msg.role || 'assistant';
  var kind = msg.type || msg.msg_type || 'chat';
  if (role !== 'user' && role !== 'system' && kind === 'chat') {
    aidaChat._clearThinking();
  }

  // Render and append
  var el = aidaChat._renderMessage(msg);
  var container = gebi('aida-messages');
  if (container && el) {
    container.appendChild(el);
    aidaChat._scrollToBottom();
  }
};

aidaChat._addMessageBatch = function(msgs) {
  var container = gebi('aida-messages');
  if (!container) return;
  var frag = document.createDocumentFragment();
  for (var i = 0; i < msgs.length; i++) {
    var msg = msgs[i];
    if (!msg || !msg.id || aidaChat._messageIds[msg.id]) continue;
    aidaChat._messageIds[msg.id] = true;
    aidaChat.messages.push(msg);
    var el = aidaChat._renderMessage(msg);
    if (el) frag.appendChild(el);
  }
  container.appendChild(frag);
};

aidaChat._showSystemMessage = function(text) {
  var container = gebi('aida-messages');
  if (!container) return;

  var div = document.createElement('div');
  div.className = 'aida-msg aida-msg-system';
  div.textContent = text;
  container.appendChild(div);
  aidaChat._scrollToBottom();
};

aidaChat._scrollToBottom = function() {
  var container = gebi('aida-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
};

// Land on the newest message on first load and KEEP it there while the layout
// settles. A fixed rAF/timeout burst isn't enough: right after the view-slide
// transition the flex height may still be 0, and markdown content, late icon
// fonts and images can grow the scroll height tens/hundreds of ms later —
// pushing the newest message back below the fold and leaving the panel at the
// top. So we pin the container to the bottom on every frame for a short window,
// re-pin whenever an image inside finishes loading, and bail out the moment the
// user scrolls up themselves (so this never fights a deliberate scroll-back).
aidaChat._SCROLL_PIN_MS = 800;

aidaChat._scrollToBottomSoon = function() {
  var container = gebi('aida-messages');
  if (!container) return;

  // Cancel any pin already in flight (e.g. re-entering the view quickly).
  aidaChat._stopScrollPin();

  var deadline = new Date().getTime() + aidaChat._SCROLL_PIN_MS;
  var userScrolled = false;
  var expectedTop = 0; // the scrollTop value we last set ourselves

  var pinToBottom = function() {
    container.scrollTop = container.scrollHeight;
    expectedTop = container.scrollTop; // clamped value the browser settled on
  };

  var onUserScroll = function() {
    // Appending/reflow keeps scrollTop at the value we set (only scrollHeight
    // grows), so it never dips below expectedTop. A genuine scroll-up does —
    // that's the user grabbing the bar, so stop fighting them.
    if (container.scrollTop < expectedTop - 4) userScrolled = true;
  };
  container.addEventListener('scroll', onUserScroll);

  var onImgLoad = function() { if (!userScrolled) pinToBottom(); };
  var imgs = container.getElementsByTagName('img');
  for (var i = 0; i < imgs.length; i++) {
    if (!imgs[i].complete) imgs[i].addEventListener('load', onImgLoad);
  }

  var stop = function() {
    container.removeEventListener('scroll', onUserScroll);
    for (var j = 0; j < imgs.length; j++) imgs[j].removeEventListener('load', onImgLoad);
    aidaChat._scrollPinRaf = null;
    aidaChat._stopScrollPin = function() {};
  };
  aidaChat._stopScrollPin = stop;

  var tick = function() {
    if (userScrolled || new Date().getTime() > deadline) { stop(); return; }
    pinToBottom();
    aidaChat._scrollPinRaf = requestAnimationFrame(tick);
  };
  pinToBottom();
  aidaChat._scrollPinRaf = requestAnimationFrame(tick);
};

// No-op until a pin is armed; replaced by the live stopper above while pinning.
aidaChat._stopScrollPin = function() {};


/* ---- Typing indicator ---- */

// Server typing frames: typing:true (re-sent ~every 15s as a heartbeat) means
// "still working" — refresh the placeholder; typing:false means the turn ended.
aidaChat._setTyping = function(isTyping) {
  aidaChat._isTyping = isTyping;
  if (isTyping) {
    aidaChat._showThinking();
  } else {
    aidaChat._clearThinking();
  }
};

// Show / refresh the "AIDA is thinking…" placeholder and (re)arm the failsafe.
// Idempotent: repeated calls never stack multiple placeholders.
aidaChat._showThinking = function() {
  aidaChat._turnOutstanding = true;
  var indicator = gebi('aida-typing');
  if (indicator) {
    indicator.innerHTML =
      '<span class="aida-typing-dots"><span>.</span><span>.</span><span>.</span></span> AIDA is thinking...';
    indicator.style.display = 'block';
  }
  aidaChat._scrollToBottom();

  if (aidaChat._failsafeTimer) clearTimeout(aidaChat._failsafeTimer);
  aidaChat._failsafeTimer = setTimeout(aidaChat._onThinkingFailsafe, aidaChat._FAILSAFE_MS);
};

// Clear the placeholder and disarm the failsafe.
aidaChat._clearThinking = function() {
  aidaChat._turnOutstanding = false;
  if (aidaChat._failsafeTimer) {
    clearTimeout(aidaChat._failsafeTimer);
    aidaChat._failsafeTimer = null;
  }
  var indicator = gebi('aida-typing');
  if (indicator) indicator.style.display = 'none';
};

// Failsafe: never leave a spinner up indefinitely. Swap it for soft copy and
// pull pending once more; the reconnect/backstop polls keep looking after that.
aidaChat._onThinkingFailsafe = function() {
  aidaChat._failsafeTimer = null;
  if (!aidaChat._turnOutstanding) return;
  var indicator = gebi('aida-typing');
  if (indicator) {
    indicator.innerHTML =
      'This is taking longer than expected — it’ll appear here when it’s ready.';
    indicator.style.display = 'block';
  }
  aidaChat._fetchPendingMessages();
};


/* ---- Connection status ---- */

aidaChat.setConnectionStatus = function(state) {
  var dot = gebi('aida-status-dot');
  var text = gebi('aida-status-text');
  if (!dot || !text) return;

  dot.className = 'aida-dot';

  switch (state) {
    case 'connected':
      dot.classList.add('aida-dot-connected');
      text.textContent = '';
      break;
    case 'connecting':
      dot.classList.add('aida-dot-connecting');
      text.textContent = 'Connecting...';
      break;
    case 'disconnected':
      dot.classList.add('aida-dot-disconnected');
      text.textContent = 'Reconnecting...';
      break;
  }
};


/* ---- Message rendering ---- */

aidaChat._renderMessage = function(msg) {
  var div = document.createElement('div');
  div.className = 'aida-msg';
  div.setAttribute('data-message-id', msg.id);

  var msgType = msg.type || msg.msg_type || 'chat';
  var role = msg.role || 'assistant';

  // Role-based class
  if (role === 'user') {
    div.classList.add('aida-msg-user');
  } else if (role === 'system') {
    div.classList.add('aida-msg-system');
  } else {
    div.classList.add('aida-msg-assistant');
  }

  // Type-based class
  if (msgType === 'briefing') {
    div.classList.add('aida-msg-briefing');
  } else if (msgType === 'alert') {
    div.classList.add('aida-msg-alert');
  } else if (msgType === 'draft') {
    div.classList.add('aida-msg-draft');
  }

  // Timestamp
  var timeEl = document.createElement('div');
  timeEl.className = 'aida-msg-time';
  if (msg.created_at) {
    var d = new Date(msg.created_at);
    timeEl.textContent = aidaChat._formatTime(d);
  }

  // Content
  var contentEl = document.createElement('div');
  contentEl.className = 'aida-msg-content';

  if (role === 'user') {
    contentEl.textContent = msg.content;
  } else {
    contentEl.innerHTML = aidaRenderMarkdown(msg.content);
  }

  div.appendChild(contentEl);
  div.appendChild(timeEl);

  // Draft actions
  if (msgType === 'draft' && msg.metadata && msg.metadata.draft_id) {
    var actionsEl = aidaChat._renderDraftActions(msg.metadata.draft_id, msg.content);
    div.appendChild(actionsEl);
  }

  return div;
};

aidaChat._formatTime = function(date) {
  var h = date.getHours();
  var m = date.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
};


/* ---- Draft actions ---- */

aidaChat._renderDraftActions = function(draftId, content) {
  var actionsDiv = document.createElement('div');
  actionsDiv.className = 'aida-draft-actions';
  actionsDiv.setAttribute('data-draft-id', draftId);

  var approveBtn = document.createElement('button');
  approveBtn.className = 'aida-draft-btn aida-draft-approve';
  approveBtn.innerHTML = '<i class="fa fa-check"></i> Send';
  approveBtn.onclick = function() {
    aidaChat._handleDraftAction(draftId, 'approve', null);
  };

  var editBtn = document.createElement('button');
  editBtn.className = 'aida-draft-btn aida-draft-edit';
  editBtn.innerHTML = '<i class="fa fa-pencil"></i> Edit';
  editBtn.onclick = function() {
    aidaChat._showDraftEditor(draftId, content);
  };

  var rejectBtn = document.createElement('button');
  rejectBtn.className = 'aida-draft-btn aida-draft-reject';
  rejectBtn.innerHTML = '<i class="fa fa-times"></i> Skip';
  rejectBtn.onclick = function() {
    aidaChat._handleDraftAction(draftId, 'reject', null);
  };

  actionsDiv.appendChild(approveBtn);
  actionsDiv.appendChild(editBtn);
  actionsDiv.appendChild(rejectBtn);

  return actionsDiv;
};

aidaChat._handleDraftAction = function(draftId, action, editedContent) {
  // Disable buttons immediately
  var actionsDiv = document.querySelector('[data-draft-id="' + draftId + '"]');
  if (!actionsDiv) return;

  var buttons = actionsDiv.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].disabled = true;
  }

  aidaApi.draftAction(draftId, action, editedContent, function(err) {
    if (err) {
      aidaChat._showSystemMessage('Draft action failed: ' + err);
      // Re-enable buttons
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].disabled = false;
      }
      return;
    }

    // Replace actions with status
    var statusText = '';
    if (action === 'approve') statusText = 'Sent \u2713';
    else if (action === 'edit') statusText = 'Edited and sent \u2713';
    else if (action === 'reject') statusText = 'Skipped';

    actionsDiv.innerHTML = '';
    actionsDiv.className = 'aida-draft-status';
    actionsDiv.textContent = statusText;
  });
};

aidaChat._showDraftEditor = function(draftId, content) {
  var actionsDiv = document.querySelector('[data-draft-id="' + draftId + '"]');
  if (!actionsDiv) return;

  // Extract just the body text from the draft content (after the ---\nReply line)
  var draftText = content || '';
  var separatorIdx = draftText.lastIndexOf('---');
  if (separatorIdx > 0) {
    draftText = draftText.substring(0, separatorIdx).trim();
  }

  actionsDiv.innerHTML = '';
  actionsDiv.className = 'aida-draft-editor';

  var textarea = document.createElement('textarea');
  textarea.className = 'aida-draft-textarea';
  textarea.value = draftText;
  textarea.rows = 6;

  var btnRow = document.createElement('div');
  btnRow.className = 'aida-draft-editor-btns';

  var saveBtn = document.createElement('button');
  saveBtn.className = 'aida-draft-btn aida-draft-approve';
  saveBtn.innerHTML = '<i class="fa fa-check"></i> Send edited';
  saveBtn.onclick = function() {
    aidaChat._handleDraftAction(draftId, 'edit', textarea.value);
  };

  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'aida-draft-btn aida-draft-reject';
  cancelBtn.innerHTML = '<i class="fa fa-times"></i> Cancel';
  cancelBtn.onclick = function() {
    // Restore original action buttons
    var parent = actionsDiv.parentNode;
    var msgDiv = parent;
    var msgId = msgDiv.getAttribute('data-message-id');
    var originalMsg = null;
    for (var i = 0; i < aidaChat.messages.length; i++) {
      if (aidaChat.messages[i].id === msgId) {
        originalMsg = aidaChat.messages[i];
        break;
      }
    }
    if (originalMsg && originalMsg.metadata && originalMsg.metadata.draft_id) {
      var newActions = aidaChat._renderDraftActions(originalMsg.metadata.draft_id, originalMsg.content);
      actionsDiv.parentNode.replaceChild(newActions, actionsDiv);
    }
  };

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);

  actionsDiv.appendChild(textarea);
  actionsDiv.appendChild(btnRow);

  textarea.focus();
};


/* ---- Settings ---- */

aidaChat.loadSettings = function() {
  var urlInput = gebi('aida-settings-url');
  var keyInput = gebi('aida-settings-key');
  if (urlInput) urlInput.value = localStorage.aidaApiUrl || aidaConfig.defaultUrl;
  if (keyInput) keyInput.value = localStorage.aidaApiKey || aidaConfig.defaultKey;
};

aidaChat.saveSettings = function() {
  var urlInput = gebi('aida-settings-url');
  var keyInput = gebi('aida-settings-key');
  if (urlInput && urlInput.value.trim()) {
    localStorage.aidaApiUrl = urlInput.value.trim();
  }
  if (keyInput && keyInput.value.trim()) {
    localStorage.aidaApiKey = keyInput.value.trim();
  }
  setFeedback('AIDA settings saved');
};


/* ###################### APPROVAL GATE (Part B) ###################### */
/*
 * Human-approval UI for off-allowlist agent actions (web fetches / emails).
 * AIDA blocks the agent turn (up to 120s) waiting for an Approve/Reject
 * decision made here, out-of-band and authenticated, so a prompt injection
 * can't approve on Adam's behalf.
 *
 * Requests arrive via the chat WebSocket (`approval_request` frame) and are
 * also backfilled from GET /approvals/pending on every (re)connect and on the
 * periodic backstop poll. Cards self-expire after 120s.
 *
 * Dormant until the AIDA server runs with APPROVALS_ENABLED=true — inert
 * until then (no endpoints are exercised).
 */

var aidaApprovals = {};

aidaApprovals._cards = {};          // id -> { data, timer }
aidaApprovals._EXPIRY_MS = 120000;  // server default approval_timeout_seconds

// Clear all cards and their timers (view teardown / reset).
aidaApprovals.reset = function() {
  for (var id in aidaApprovals._cards) {
    if (aidaApprovals._cards.hasOwnProperty(id) && aidaApprovals._cards[id].timer) {
      clearTimeout(aidaApprovals._cards[id].timer);
    }
  }
  aidaApprovals._cards = {};
  var container = gebi('aida-approvals');
  if (container) container.innerHTML = '';
};

// Backfill path: pull anything awaiting a decision (on connect / poll).
aidaApprovals.fetchPending = function() {
  aidaApi.fetchPendingApprovals(function(err, result) {
    if (err) return;
    var list = (result && result.approvals) ? result.approvals : [];
    for (var i = 0; i < list.length; i++) {
      aidaApprovals.handlePush(list[i]);
    }
  });
};

// Render a request (from a WS push or a backfill). Dedupes by id.
aidaApprovals.handlePush = function(approval) {
  if (!approval || !approval.id) return;
  // Only pending requests are actionable; anything decided/expired clears.
  if (approval.status && approval.status !== 'pending') {
    aidaApprovals._removeCard(approval.id);
    return;
  }
  if (aidaApprovals._cards[approval.id]) return; // already shown
  aidaApprovals._renderCard(approval);
};

aidaApprovals._renderCard = function(approval) {
  var container = gebi('aida-approvals');
  if (!container) return;

  var card = document.createElement('div');
  card.className = 'aida-approval-card';
  card.setAttribute('data-approval-id', approval.id);

  var header = document.createElement('div');
  header.className = 'aida-approval-header';
  var iconClass = approval.kind === 'send_email' ? 'fa-envelope' : 'fa-globe';
  var icon = document.createElement('i');
  icon.className = 'fa ' + iconClass;
  header.appendChild(icon);
  header.appendChild(document.createTextNode(' Approval needed'));
  card.appendChild(header);

  // `summary` is documented safe-to-render, but use textContent anyway.
  var summary = document.createElement('div');
  summary.className = 'aida-approval-summary';
  summary.textContent = approval.summary || '';
  card.appendChild(summary);

  var details = aidaApprovals._renderDetails(approval);
  if (details) card.appendChild(details);

  var btnRow = document.createElement('div');
  btnRow.className = 'aida-approval-btns';

  var approveBtn = document.createElement('button');
  approveBtn.className = 'aida-approval-btn aida-approval-approve';
  approveBtn.innerHTML = '<i class="fa fa-check"></i> Approve';
  approveBtn.onclick = function() { aidaApprovals._decide(approval.id, 'approve'); };

  var rejectBtn = document.createElement('button');
  rejectBtn.className = 'aida-approval-btn aida-approval-reject';
  rejectBtn.innerHTML = '<i class="fa fa-times"></i> Reject';
  rejectBtn.onclick = function() { aidaApprovals._decide(approval.id, 'reject'); };

  btnRow.appendChild(approveBtn);
  btnRow.appendChild(rejectBtn);
  card.appendChild(btnRow);

  container.appendChild(card);

  // Self-expiry after 120s from creation (fail-closed, matches the server).
  var remaining = aidaApprovals._EXPIRY_MS;
  if (approval.created_at) {
    var created = new Date(approval.created_at).getTime();
    if (!isNaN(created)) {
      remaining = Math.max(0, aidaApprovals._EXPIRY_MS - (Date.now() - created));
    }
  }
  var timer = setTimeout(function() { aidaApprovals._expire(approval.id); }, remaining);
  aidaApprovals._cards[approval.id] = { data: approval, timer: timer };
};

// All `details` fields originate from untrusted web/email content — render as
// escaped plain text via textContent, never as HTML, never auto-navigable.
aidaApprovals._renderDetails = function(approval) {
  var d = approval.details || {};
  var wrap = document.createElement('div');
  wrap.className = 'aida-approval-details';

  if (approval.kind === 'web_fetch') {
    wrap.appendChild(aidaApprovals._detailRow('URL', d.url || ''));
    if (d.host) wrap.appendChild(aidaApprovals._detailRow('Host', d.host));
  } else if (approval.kind === 'send_email') {
    wrap.appendChild(aidaApprovals._detailRow('To', d.to || ''));
    wrap.appendChild(aidaApprovals._detailRow('Subject', d.subject || ''));
    if (d.body_preview) {
      var body = document.createElement('div');
      body.className = 'aida-approval-body';
      body.textContent = d.body_preview;
      wrap.appendChild(body);
    }
  } else {
    // Unknown kind — dump whatever details exist, still escaped.
    for (var k in d) {
      if (d.hasOwnProperty(k)) {
        aidaApprovals._appendRow(wrap, k, d[k]);
      }
    }
  }
  return wrap;
};

aidaApprovals._appendRow = function(wrap, label, value) {
  var v = (value === null || typeof value === 'undefined') ? '' : String(value);
  wrap.appendChild(aidaApprovals._detailRow(label, v));
};

aidaApprovals._detailRow = function(label, value) {
  var row = document.createElement('div');
  row.className = 'aida-approval-detail-row';
  var l = document.createElement('span');
  l.className = 'aida-approval-detail-label';
  l.textContent = label + ': ';
  var v = document.createElement('span');
  v.className = 'aida-approval-detail-value';
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
};

aidaApprovals._decide = function(id, action) {
  var card = aidaApprovals._cardEl(id);
  if (card) {
    var btns = card.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) btns[i].disabled = true;
  }

  var fn = (action === 'approve') ? aidaApi.approveRequest : aidaApi.rejectRequest;
  fn(id, function(err, result, status) {
    if (err) {
      // 409 → already decided/expired/unknown: clear the card, don't error.
      if (status === 409) {
        aidaApprovals._removeCard(id);
        return;
      }
      // Otherwise re-enable so Adam can retry.
      var c = aidaApprovals._cardEl(id);
      if (c) {
        var b = c.querySelectorAll('button');
        for (var j = 0; j < b.length; j++) b[j].disabled = false;
      }
      aidaChat._showSystemMessage('Could not ' + action + ' request: ' + err);
      return;
    }
    // 200 — optimistically remove; the agent's next chat reply reflects it.
    aidaApprovals._removeCard(id);
  });
};

// 120s elapsed with no server confirmation → treat as expired and clear.
aidaApprovals._expire = function(id) {
  aidaApprovals._removeCard(id);
};

aidaApprovals._cardEl = function(id) {
  var container = gebi('aida-approvals');
  if (!container) return null;
  var cards = container.querySelectorAll('.aida-approval-card');
  for (var i = 0; i < cards.length; i++) {
    if (cards[i].getAttribute('data-approval-id') === id) return cards[i];
  }
  return null;
};

aidaApprovals._removeCard = function(id) {
  var c = aidaApprovals._cards[id];
  if (c && c.timer) clearTimeout(c.timer);
  delete aidaApprovals._cards[id];
  var el = aidaApprovals._cardEl(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
};
