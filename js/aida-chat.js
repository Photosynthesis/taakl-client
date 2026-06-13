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

aidaApi._request = function(method, path, data, callback) {
  var opts = {
    url: aidaConfig.getUrl() + path,
    type: method,
    contentType: 'application/json',
    headers: {
      'X-API-Key': aidaConfig.getKey()
    },
    success: function(result) {
      if (callback) callback(null, result);
    },
    error: function(xhr, opts, statusText) {
      var errMsg = statusText || 'Request failed';
      try {
        var body = JSON.parse(xhr.responseText);
        if (body.message) errMsg = body.message;
        if (body.detail) errMsg = body.detail;
      } catch(e) {}
      if (callback) callback(errMsg, null);
    }
  };
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
  aidaApi._request('POST', '/api/v1/messages/send', {content: content}, callback);
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


/* ###################### WEBSOCKET MANAGER ###################### */

var aidaWs = {};

aidaWs._socket = null;
aidaWs._keepaliveInterval = null;
aidaWs._pongTimeout = null;
aidaWs._reconnectTimer = null;
aidaWs._retryDelay = 1000;
aidaWs._maxRetryDelay = 30000;
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
    aidaWs._retryDelay = 1000;
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
  aidaWs._retryDelay = 1000;
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
        // Fetch pending messages after auth to catch up
        aidaChat._fetchPendingMessages();
      } else {
        aidaChat.setConnectionStatus('disconnected');
        aidaChat._showSystemMessage('Authentication failed. Check your API key in Settings.');
      }
      break;

    case 'message':
      aidaChat.addMessage({
        id: data.id,
        role: data.role || 'assistant',
        type: data.msg_type || 'chat',
        content: data.content,
        metadata: data.metadata || null,
        created_at: new Date().toISOString()
      });
      break;

    case 'typing':
      aidaChat._setTyping(data.status);
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
  }
};

aidaWs._startKeepalive = function() {
  aidaWs._stopKeepalive();
  aidaWs._keepaliveInterval = setInterval(function() {
    if (!aidaWs.send({type: 'ping'})) return;
    aidaWs._pongTimeout = setTimeout(function() {
      // No pong received — connection is dead
      if (aidaWs._socket) {
        aidaWs._socket.close();
      }
    }, 5000);
  }, 30000);
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

  aidaWs._reconnectTimer = setTimeout(function() {
    aidaWs._reconnectTimer = null;
    aidaWs.connect();
  }, aidaWs._retryDelay);

  // Exponential backoff
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


/* ---- View Lifecycle ---- */

aidaChat.show = function() {
  // Reset state
  aidaChat.messages = [];
  aidaChat._messageIds = {};
  aidaChat._isTyping = false;

  // Clear message area
  var msgContainer = gebi('aida-messages');
  if (msgContainer) msgContainer.innerHTML = '';

  // Set up input handlers
  aidaChat._initInput();

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
    // Scroll after browser has laid out the DOM
    requestAnimationFrame(function() { aidaChat._scrollToBottom(); });
    aidaWs.connect();
  });

  // Focus input
  var input = gebi('aida-input');
  if (input) input.focus();
};

aidaChat.hide = function() {
  // Disconnect WebSocket
  aidaWs.disconnect();

  // Clean up event watchers
  removeEventWatchers('aidaChat');
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

  // Send via WebSocket if connected, else REST fallback
  var sent = aidaWs.send({type: 'message', content: text});
  if (!sent) {
    // REST fallback
    aidaApi.sendMessage(text, function(err, result) {
      if (err) {
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


/* ---- Typing indicator ---- */

aidaChat._setTyping = function(isTyping) {
  aidaChat._isTyping = isTyping;
  var indicator = gebi('aida-typing');
  if (indicator) {
    indicator.style.display = isTyping ? 'block' : 'none';
  }
  // Disable/enable input while typing
  var sendBtn = gebi('aida-send-btn');
  if (sendBtn) {
    sendBtn.disabled = isTyping;
  }
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
