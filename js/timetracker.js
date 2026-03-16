var current_session;

var ttData;

var feedbackElement;

// Server configuration
var serverConfig = {
  baseUrl: 'https://api.taakl.app',
  endpoints: {
    register: '/api/register',
    login: '/api/login',
    logout: '/api/logout',
    me: '/api/me',
    sync: '/api/sync',
    syncFull: '/api/sync/full',
    settings: '/api/settings'
  }
};

// Auth state
var authToken = localStorage.authToken || null;

var eventWatchers = [];

var startDate;
var nowDate;
var counterId;
var currentDuration;

var defaultSettings = {
  top_level_title : "Client",
  show_billability : true,
  auto_synch : false,
  reminder_interval : false,
  reminder_title : "Pomodoro Complete!",
  reminder_message : "Please take a five minute break. <b>Breathe, stretch, look around!</b>",
  reminder_delay : 1
};

analyze = {};
treeView = {};
settingsView = {};
todayView = {};
aidaChat = {};

var currentView = treeView;

var flatData = [];

var reminderDelay = 0;

var estimateAlert90Triggered = false;
var estimateAlert100Triggered = false;

var endPicker = '';
var startPicker = '';

// Audio notification functions for estimate alerts
function playEstimateDing() {
  var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  var oscillator = audioCtx.createOscillator();
  var gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.frequency.value = 880; // A5 note
  oscillator.type = 'sine';
  gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + 0.5);
}

function playEstimateAlarm() {
  var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  var oscillator = audioCtx.createOscillator();
  var gainNode = audioCtx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.type = 'square';
  gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);

  // Alternating tones for alarm effect
  oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
  oscillator.frequency.setValueAtTime(880, audioCtx.currentTime + 0.2);
  oscillator.frequency.setValueAtTime(440, audioCtx.currentTime + 0.4);
  oscillator.frequency.setValueAtTime(880, audioCtx.currentTime + 0.6);
  oscillator.frequency.setValueAtTime(440, audioCtx.currentTime + 0.8);

  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.0);

  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + 1.0);
}

var types = ['user','client','project','task','session'];

var editFields = {
  settings : {
    top_level_title : {
      label : "Top level title",
      type : "text",
    },
    show_billability : {
      label : "Show billability",
      type : "boolean"
    },
    auto_synch : {
      label : "Synch automatically",
      type : "boolean"
    },
    reminder_interval : {
      label : "Reminder interval",
      type : "text"
    },
    reminder_title : {
      label : "Reminder title",
      type : "text"
    },
    reminder_message : {
      label : "Reminder message",
      type : "textarea"
    },
    reminder_delay : {
      label : "Reminder delay",
      type : "text"
    },
    default_task_sort : {
      label : "Default task sort",
      type : "select",
      options :{"name":"Name", "priority":"Priority", "status":"Status", "time":"Time","Session count":"sessionCount","lastSessionTime":"Most recent session"}
    },
    default_task_sort_direction : {
      label : "Default task sort direction",
      type : "select",
      options :{"asc":"Ascending", "desc":"Descending"}
    }
  },
  task : {
    name : {
      label : "Name",
      type : "text"
    },
    id : {
      label : "ID",
      type : "text"
    },
    status : {
      label : "Status",
      type : "select",
      //options : [{text:"On hold", value:"onHold"},{text:"New", value:"new"},{text:"In process", value:"inProcess"},{text:"Completed", value:"completed"}]
      options :{"onHold":"On hold", "new":"New", inProcess:"In process", completed:"Completed"}
    },
    due : {
      label : "Due by",
      type : "date",
    },
    priority : {
      label : "Priority",
      type : "select",
      options :{"1":"1", "2":"2", "3":"3", "4":"4", "5":"5"},
      callback : function(){

      }
    },
    billable : {
      label : "Billable",
      type : "select",
      options : {"1":"Yes", "0":"No"}
    },
    notes : {
      label : "Notes",
      type : "textarea",
    },
    estimate : {
      label : "Estimate (minutes)",
      type : "text"
    }
  },
  session : {
    start_time : {
      label : "Start time",
      type: "text"
    },
    end_time : {
      label : "End time",
      type: "text"
    },
    notes : {
      label : "Notes",
      type : "textarea",
    }

  }
};

/* ###################### TASK AUTOCOMPLETE FUNCTIONS ###################### */

// Helper function to escape HTML
function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Minimal XHR wrapper (replaces $.ajax)
function ajaxReq(opts) {
  var xhr = new XMLHttpRequest();
  var url = opts.url;
  if (opts.cache === false) {
    url += (url.indexOf('?') === -1 ? '?' : '&') + '_=' + new Date().getTime();
  }
  xhr.open(opts.type || 'GET', url, true);
  if (opts.contentType) {
    xhr.setRequestHeader('Content-Type', opts.contentType);
  }
  if (opts.headers) {
    for (var key in opts.headers) {
      if (opts.headers.hasOwnProperty(key)) {
        xhr.setRequestHeader(key, opts.headers[key]);
      }
    }
  }
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4) return;
    if (xhr.status >= 200 && xhr.status < 300) {
      var result;
      try { result = JSON.parse(xhr.responseText); }
      catch(e) { result = xhr.responseText; }
      if (opts.success) opts.success(result);
    } else {
      if (opts.error) opts.error(xhr, '', xhr.statusText);
    }
  };
  xhr.send(opts.data || null);
}

/**
 * Factory: folder autocomplete triggered by "/" in an input field
 * @param {string} inputId - ID of the text input element
 * @param {string} dropdownId - ID of the dropdown container element
 * @param {string} chipId - ID of the parent chip element
 * @returns {object} - Autocomplete controller with init/reset methods
 */
function createFolderAutocomplete(inputId, dropdownId, chipId) {
  var ac = {
    selectedParentId: null,
    slashPosition: -1,
    items: [],
    selectedIndex: -1,
    isOpen: false
  };

  ac.init = function() {
    var input = gebi(inputId);
    if (!input) return;

    input.addEventListener('input', function() {
      ac.handleInput();
    });

    input.addEventListener('keydown', function(e) {
      ac.handleKeydown(e);
    });

    input.addEventListener('blur', function() {
      setTimeout(function() { ac.hide(); }, 200);
    });

    gebi(dropdownId).addEventListener('click', function(e) {
      var item = e.target.closest('.folder-ac-item');
      if (!item) return;
      var idx = parseInt(item.getAttribute('data-index'), 10);
      ac.selectItem(idx);
    });
  };

  ac.handleInput = function() {
    var input = gebi(inputId);
    var val = input.value;
    var cursorPos = input.selectionStart;

    // Scan backward from cursor for a "/" trigger
    var slashPos = -1;
    for (var i = cursorPos - 1; i >= 0; i--) {
      if (val[i] === '/') {
        // Only trigger if slash is at start or preceded by a space
        if (i === 0 || val[i - 1] === ' ') {
          slashPos = i;
        }
        break;
      }
      // Stop if we hit a space (the search text shouldn't contain spaces before the slash)
      if (val[i] === ' ') break;
    }

    if (slashPos === -1) {
      ac.hide();
      return;
    }

    ac.slashPosition = slashPos;
    var searchText = val.substring(slashPos + 1, cursorPos);
    var matches = ac.getMatchingFolders(searchText);
    ac.renderDropdown(matches);
  };

  ac.handleKeydown = function(e) {
    if (!ac.isOpen) return;

    if (e.keyCode === 40) { // Down
      e.preventDefault();
      if (ac.selectedIndex < ac.items.length - 1) {
        ac.selectedIndex++;
        ac.updateSelection();
      }
    } else if (e.keyCode === 38) { // Up
      e.preventDefault();
      if (ac.selectedIndex > 0) {
        ac.selectedIndex--;
        ac.updateSelection();
      }
    } else if (e.keyCode === 13 || e.keyCode === 9) { // Enter or Tab
      if (ac.items.length > 0 && ac.selectedIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        ac.selectItem(ac.selectedIndex);
      }
    } else if (e.keyCode === 27) { // Escape
      e.preventDefault();
      ac.hide();
    }
  };

  ac.getMatchingFolders = function(text) {
    var folders = getAllFolderNodes();
    var lowerText = text.toLowerCase();
    var matches = [];

    for (var i = 0; i < folders.length; i++) {
      var folder = folders[i];
      if (!folder.name) continue;
      if (text === '' || folder.name.toLowerCase().indexOf(lowerText) !== -1) {
        var path = getNodePath(folder.id);
        var breadcrumb = [];
        for (var j = 0; j < path.length; j++) {
          breadcrumb.push(path[j].name || '(untitled)');
        }
        matches.push({
          id: folder.id,
          name: folder.name,
          breadcrumb: breadcrumb.join(' > ')
        });
      }
    }

    matches.sort(function(a, b) {
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

    return matches.slice(0, 10);
  };

  ac.renderDropdown = function(matches) {
    var dropdown = gebi(dropdownId);
    if (!dropdown) return;

    ac.items = matches;
    ac.selectedIndex = matches.length > 0 ? 0 : -1;

    var html = '';
    if (matches.length === 0) {
      html = '<div class="folder-ac-empty">No matching folders</div>';
    } else {
      for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        var selectedClass = i === 0 ? ' selected' : '';
        var pathHtml = '';
        if (m.breadcrumb !== m.name) {
          pathHtml = '<div class="folder-ac-path">' + escapeHtml(m.breadcrumb) + '</div>';
        }
        html += '<div class="folder-ac-item' + selectedClass + '" data-index="' + i + '">' +
          '<i class="fa fa-folder-o folder-ac-icon"></i>' +
          '<span class="folder-ac-name">' + escapeHtml(m.name) + '</span>' +
          pathHtml +
          '</div>';
      }
    }

    dropdown.innerHTML = html;
    dropdown.style.display = 'block';
    ac.isOpen = true;
  };

  ac.updateSelection = function() {
    var dropdown = gebi(dropdownId);
    if (!dropdown) return;
    var items = dropdown.querySelectorAll('.folder-ac-item');
    for (var i = 0; i < items.length; i++) {
      if (i === ac.selectedIndex) {
        items[i].classList.add('selected');
        // Scroll into view if needed
        var itemTop = items[i].offsetTop;
        var itemBottom = itemTop + items[i].offsetHeight;
        if (itemBottom > dropdown.scrollTop + dropdown.clientHeight) {
          dropdown.scrollTop = itemBottom - dropdown.clientHeight;
        } else if (itemTop < dropdown.scrollTop) {
          dropdown.scrollTop = itemTop;
        }
      } else {
        items[i].classList.remove('selected');
      }
    }
  };

  ac.selectItem = function(index) {
    if (index < 0 || index >= ac.items.length) return;
    var item = ac.items[index];
    var input = gebi(inputId);

    // Remove the /searchText from the input
    var val = input.value;
    var cursorPos = input.selectionStart;
    var before = val.substring(0, ac.slashPosition);
    var after = val.substring(cursorPos);
    input.value = (before + after).trim();

    ac.selectedParentId = item.id;
    ac.renderChip(item.id);
    ac.hide();
    input.focus();
  };

  ac.renderChip = function(nodeId) {
    var chip = gebi(chipId);
    if (!chip) return;
    var path = getNodePath(nodeId);
    var breadcrumb = [];
    for (var i = 0; i < path.length; i++) {
      breadcrumb.push(path[i].name || '(untitled)');
    }
    chip.innerHTML = '<i class="fa fa-folder-o"></i> ' +
      escapeHtml(breadcrumb.join(' > ')) +
      ' <span class="parent-chip-clear" onclick="todayFolderAc.clearParent()">&times;</span>';
    chip.style.display = 'inline-block';
  };

  ac.clearParent = function() {
    ac.selectedParentId = null;
    var chip = gebi(chipId);
    if (chip) {
      chip.style.display = 'none';
      chip.innerHTML = '';
    }
  };

  ac.reset = function() {
    ac.selectedParentId = null;
    ac.slashPosition = -1;
    ac.items = [];
    ac.selectedIndex = -1;
    ac.isOpen = false;
    var chip = gebi(chipId);
    if (chip) {
      chip.style.display = 'none';
      chip.innerHTML = '';
    }
    var dropdown = gebi(dropdownId);
    if (dropdown) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }
  };

  ac.hide = function() {
    var dropdown = gebi(dropdownId);
    if (dropdown) {
      dropdown.style.display = 'none';
      dropdown.innerHTML = '';
    }
    ac.items = [];
    ac.selectedIndex = -1;
    ac.isOpen = false;
  };

  return ac;
}

var todayFolderAc = createFolderAutocomplete('today-new-task-input', 'today-folder-dropdown', 'today-parent-chip');

// Load Node HTTP module, if available
if(typeof require === "function"){
  var http = require('http');
}

if(typeof Notification == "object"){
  Notification.requestPermission();
}



/* ############################### INITIALIZE ################################# */

// Global variable for current node in tree view
var current_node = null;
var current_node_path = [];

/**
 * Initialize fresh data structure (v2 node-based)
 */
function initFreshData() {
  ttData = {
    dataVersion: 2,
    userKey: newId(),
    userName: '',
    nodes: {},
    rootOrder: [],
    settings: defaultSettings,
    synchQueue: [],
    lastSyncTime: null
  };
  ttSave();
}

function ttInit(){
  nativeBridge.init(function() {
    ttInitCore();
  });
}

function ttInitCore(){

    feedbackElement = document.getElementById('feedback');

    var isFirstVisit = !localStorage.ttData;

    if(!localStorage.ttData){
      // Fresh start - initialize with v2 node structure
      initFreshData();
      // Don't return early - continue to set up the view
    }else{
      console.log('[INIT] Loading ttData from localStorage');
      ttData = JSON.parse(localStorage.ttData);
      console.log('[INIT] Loaded nodes count:', ttData.nodes ? Object.keys(ttData.nodes).length : 0);

      // Log sessions in loaded data
      if(ttData.nodes) {
        var totalSessions = 0;
        for(var nodeId in ttData.nodes) {
          if(ttData.nodes[nodeId].sessions) {
            var sessionCount = Object.keys(ttData.nodes[nodeId].sessions).length;
            if(sessionCount > 0) {
              console.log('[INIT] Loaded node', nodeId, 'with', sessionCount, 'sessions:',
                ttData.nodes[nodeId].sessions);
              totalSessions += sessionCount;
            }
          }
        }
        console.log('[INIT] Total sessions loaded:', totalSessions);
      }

      if(!ttData.settings){
         ttData.settings = defaultSettings;
         ttSave();
      }

      // Restore current node from localStorage
      if (localStorage.ttCurrentNodeId) {
        current_node = getNode(localStorage.ttCurrentNodeId);
        if (current_node) {
          current_node_path = getNodePath(current_node.id);
        }
      }

      // Check for active session
      if (localStorage.ttSessionId && current_node && current_node.sessions) {
        current_session = current_node.sessions[localStorage.ttSessionId];
      }
    }

   var forms = document.getElementsByTagName('form');
   for (var fi = 0; fi < forms.length; fi++) {
     forms[fi].addEventListener('keypress', function(e) {

       if (e.keyCode == 13) {

          dbg(document.activeElement,'Active element');

          // Tree view inputs
          if(document.activeElement.id == 'tree-add-input'){
             treeView.saveNewNode();
             e.preventDefault();
             return;
          }

          if(document.activeElement.id == 'today-new-task-input'){
             treeView.saveNewTaskFromToday();
          }

          e.preventDefault();
       }

     });
   }

   resetDailyTasks();

   todayFolderAc.init();

   setView('taskList');

   if(current_session){
      continueSession();
   }

   /* Load plugins! */
   for (pluginId in plugins){
     var scriptEl = document.createElement('script');
     scriptEl.src = "plugins/"+plugins[pluginId].name+"/"+plugins[pluginId].name+".conf.js";
     document.getElementsByTagName("head")[0].appendChild(scriptEl);
   }


   // Update auth UI on init
   updateAuthUI();

   if(getSetting("auto_synch") == "yes" && isLoggedIn()){
     synchToServer();
   }

   // Prompt login on first visit (no existing data and not logged in)
   if (isFirstVisit && !isLoggedIn()) {
     // Brief delay to let the UI render first
     setTimeout(function() {
       showAuthModal('login');
     }, 500);
   }

   // Global event watcher: sync node updates to server queue
   addEventWatcher('node', 'updated', function(nodeId) {
     if (nodeId) {
       var node = getNode(nodeId);
       if (node && node.name && node.name.trim()) {
         synchQueue.add("update", "node", nodeId, node.parentId);
       }
     }
   }, 'global');

   // Initialize swipe navigation for view transitions
   initSwipeNavigation();

}

/* ######################### TRACK SESSION CONTROL ########################## */


function continueSession(){
  startDate = moment(current_session.start_time);
  counterId = setInterval(incrementCurrentDuration, 1000);
  showNodeInSession();
}


function fitDurationText(){
  var container = document.getElementById('current_duration');
  if(!container) return;

  // Reset font size first to get accurate container width
  container.style.fontSize = '10px';

  // Get container width from the centered-box parent
  var containerWidth = container.parentElement.offsetWidth * 0.9; // 90% of parent width

  // Create a temporary span to measure text width
  var testSpan = document.createElement('span');
  testSpan.style.visibility = 'hidden';
  testSpan.style.position = 'absolute';
  testSpan.style.whiteSpace = 'nowrap';
  testSpan.style.fontFamily = 'sans-serif';
  testSpan.style.fontWeight = 'bold';
  testSpan.innerHTML = '00:00:00'; // Always use fixed reference string
  document.body.appendChild(testSpan);

  // Binary search for the right font size
  var minSize = 10;
  var maxSize = 300;
  while(maxSize - minSize > 1){
    var fontSize = Math.floor((minSize + maxSize) / 2);
    testSpan.style.fontSize = fontSize + 'px';
    if(testSpan.offsetWidth > containerWidth){
      maxSize = fontSize;
    } else {
      minSize = fontSize;
    }
  }

  document.body.removeChild(testSpan);
  container.style.fontSize = minSize + 'px';
}

function incrementCurrentDuration() {

    currentDurationSeconds = moment().diff(startDate)/1000;
    currentDuration = timeFromSeconds(currentDurationSeconds);
    document.getElementById('current_duration').innerHTML = currentDuration;
    fitDurationText();
    document.title = currentDuration + ' - Timetracker';

    // Check estimate thresholds if task has an estimate
    if(current_node && current_node.estimate && current_node.estimate > 0){
      var existingTime = current_node.time || 0;
      var totalTimeSpent = existingTime + currentDurationSeconds;
      var percentUsed = (totalTimeSpent / current_node.estimate) * 100;

      // 90% warning ding
      if(!estimateAlert90Triggered && percentUsed >= 90 && percentUsed < 100){
        playEstimateDing();
        estimateAlert90Triggered = true;
        desktopNotify('90% of estimated time used for: ' + current_node.name, 'Time Estimate Warning');
      }

      // 100% alarm
      if(!estimateAlert100Triggered && percentUsed >= 100){
        playEstimateAlarm();
        estimateAlert100Triggered = true;
        desktopNotify('Estimated time exceeded for: ' + current_node.name, 'Time Estimate Exceeded');
      }
    }

    if(getSetting('reminder_interval') && (currentDurationSeconds/60) > (parseFloat(getSetting('reminder_interval'))+reminderDelay)){

      desktopNotify(getSetting('reminder_message'),getSetting('reminder_title'));

      reminderDelay += parseFloat(getSetting('reminder_delay'));

    }
}


/* ####################### FEEDBACK & NOTIFICATIONS ######################### */


function hideFeedback(){
  gebi('feedback').style.display = 'none';
}

function setFeedback(message,type,stayVisible){

  type || (type = "notice");

  stayVisible || (stayVisible = false);

  feedbackElement.innerHTML = message;
  feedbackElement.className = type;
  feedbackElement.style.display = 'block';

  if(!stayVisible){
    setTimeout(hideFeedback,8000);
  }
}

function desktopNotify(message,title,icon) {
  title || (title = "Timetracker notification");

  options = {
      body: message,
      icon: icon
  };
  new Notification(title,options);
}


function saveUserKey(){
  // Legacy function - kept for compatibility
  key_val = gebi('add-userkey-input').value;
  ttData.userKey = key_val;
  ttSave();
  hideModal();
  ttInit();
}

/* ############################# AUTH FUNCTIONS ############################# */

function showAuthModal(mode) {
  mode = mode || 'login';
  var html = '<div id="auth-modal">';
  html += '<h3 id="auth-title">' + (mode === 'login' ? 'Login' : 'Create Account') + '</h3>';
  html += '<div id="auth-error" style="color: red; margin-bottom: 10px; display: none;"></div>';
  html += '<form id="auth-form" onsubmit="return false;">';
  html += '<input type="text" id="auth-username" placeholder="Username" autocomplete="username" required />';
  html += '<input type="password" id="auth-password" placeholder="Password" autocomplete="current-password" required />';
  if (mode === 'register') {
    html += '<input type="email" id="auth-email" placeholder="Email (optional)" autocomplete="email" />';
  }
  html += '<div style="margin-top: 15px;">';
  if (mode === 'login') {
    html += '<a class="button" onclick="doLogin()">Login</a>';
    html += '<a class="button" onclick="showAuthModal(\'register\')" style="margin-left: 10px;">Create Account</a>';
  } else {
    html += '<a class="button" onclick="doRegister()">Create Account</a>';
    html += '<a class="button" onclick="showAuthModal(\'login\')" style="margin-left: 10px;">Back to Login</a>';
  }
  html += '</div>';
  html += '</form>';
  html += '<div style="margin-top: 15px; font-size: 12px; color: #666;">';
  html += '<a href="javascript:void(0)" onclick="skipAuth()">Skip for now (local only)</a>';
  html += '</div>';
  html += '</div>';

  gebi('edit-popup').innerHTML = html;
  gebi('modal-bg').style.display = 'block';
  gebi('edit-popup').style.display = 'block';
  gebi('auth-username').focus();
}

function hideModal() {
  gebi('modal-bg').style.display = 'none';
  gebi('edit-popup').style.display = 'none';
  gebi('edit-popup').innerHTML = '';
}

function showAuthError(message) {
  var el = gebi('auth-error');
  el.textContent = message;
  el.style.display = 'block';
}

function doLogin() {
  var username = gebi('auth-username').value.trim();
  var password = gebi('auth-password').value;

  if (!username || !password) {
    showAuthError('Please enter username and password');
    return;
  }

  gebi('auth-error').style.display = 'none';
  setFeedback('Logging in...', 'notice');

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.login,
    type: 'POST',
    contentType: 'application/json',
    data: JSON.stringify({ username: username, password: password }),
    success: function(result) {
      if (result.success) {
        authToken = result.token;
        localStorage.authToken = authToken;
        ttData.userKey = result.user.uuid;
        ttData.userName = result.user.username;
        ttSave();
        if (nativeBridge.ready) nativeBridge.persist();
        setFeedback('Logged in successfully');
        hideModal();
        // Sync from server after login
        synchFromServer();
        ttInit();
      } else {
        showAuthError(result.error || 'Login failed');
      }
    },
    error: function(xhr) {
      var error = 'Login failed';
      try {
        var resp = JSON.parse(xhr.responseText);
        error = resp.error || error;
      } catch(e) {}
      showAuthError(error);
    }
  });
}

function doRegister() {
  var username = gebi('auth-username').value.trim();
  var password = gebi('auth-password').value;
  var email = gebi('auth-email').value.trim();

  if (!username || !password) {
    showAuthError('Please enter username and password');
    return;
  }

  if (password.length < 8) {
    showAuthError('Password must be at least 8 characters');
    return;
  }

  gebi('auth-error').style.display = 'none';
  setFeedback('Creating account...', 'notice');

  var data = { username: username, password: password };
  if (email) data.email = email;

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.register,
    type: 'POST',
    contentType: 'application/json',
    data: JSON.stringify(data),
    success: function(result) {
      if (result.success) {
        authToken = result.token;
        localStorage.authToken = authToken;
        ttData.userKey = result.user.uuid;
        ttData.userName = result.user.username;
        ttSave();
        if (nativeBridge.ready) nativeBridge.persist();
        setFeedback('Account created successfully');
        hideModal();
        ttInit();
      } else {
        showAuthError(result.error || 'Registration failed');
      }
    },
    error: function(xhr) {
      var error = 'Registration failed';
      try {
        var resp = JSON.parse(xhr.responseText);
        error = resp.error || error;
      } catch(e) {}
      showAuthError(error);
    }
  });
}

function skipAuth() {
  hideModal();
  setFeedback('Working in local-only mode. Login to sync across devices.');
  ttInit();
}

function doLogout() {
  if (!authToken) {
    setFeedback('Not logged in');
    return;
  }

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.logout,
    type: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + authToken },
    success: function() {
      authToken = null;
      delete localStorage.authToken;
      ttData.userName = '';
      ttSave();
      if (nativeBridge.ready) nativeBridge.persist();
      setFeedback('Logged out successfully');
      updateAuthUI();
    },
    error: function() {
      // Logout locally even if server fails
      authToken = null;
      delete localStorage.authToken;
      ttData.userName = '';
      ttSave();
      if (nativeBridge.ready) nativeBridge.persist();
      setFeedback('Logged out');
      updateAuthUI();
    }
  });
}

function showLoginModal() {
  showAuthModal('login');
}

function updateAuthUI() {
  var userMenu = document.getElementById('user-menu');
  if (!userMenu) return;

  if (authToken && ttData.userName) {
    userMenu.innerHTML = '<span class="username">' + ttData.userName + '</span> <a href="javascript:void(0)" onclick="doLogout()">Logout</a>';
  } else {
    userMenu.innerHTML = '<a href="javascript:void(0)" onclick="showLoginModal()">Login</a>';
  }
}

function isLoggedIn() {
  return !!authToken;
}

function deleteLocalStorage(){
  if(confirm("Are you sure you would like to delete all your local time and task data?")){
    delete localStorage.ttData;
    delete localStorage.ttSessionId;
    delete localStorage.ttCurrentNodeId;
    if (nativeBridge.ready) nativeBridge.clear();
    setFeedback('LocalStorage deleted. Refresh to see changes.');
  }
}


/* ############################# EDIT FUNCTIONS ############################# */


function editJson(){
  /*
  var dldLink = document.createElement('a');
  dldLink.href = "data:application/json;charset=utf-8,"+JSON.stringify(ttData);
  dldLink.download = "Timetracker-Data-"+moment().format("YYYY-MM-DD_HH-mm-ss")+".JSON";
  dldLink.className = "button";
  dldLink.innerHTML = "Download JSON data";
  gebi('json-output').appendChild(dldLink);
  */
  gebi('json-output').innerHTML = '';
  var jsonForm = document.createElement('form');
  jsonForm.innerHTML = '<textarea id="edit-json-textarea">'+JSON.stringify(ttData,null,'   ')+'</textarea>';
  gebi('json-output').appendChild(jsonForm);

  gebi('json-output').innerHTML += '<a href="#void" class="button" onClick="saveJson()">Save</a>';
  gebi('json-output').style.display = "block";
}

function downloadJson(){
  dbg("Download JSON called");

  var json = JSON.stringify(ttData,null,'  ');
  var filename = "Timetracker-Data-"+moment().format("YYYY-MM-DD_HH-mm-ss")+".json";

  // Native save dialog when running inside Tauri
  if (window.__TAURI__) {
    window.__TAURI__.dialog.save({
      defaultPath: filename,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }).then(function(path) {
      if (path) {
        window.__TAURI__.fs.writeTextFile(path, json);
      }
    });
    return;
  }

  // Browser fallback
  var blob = new Blob([json], {type: "application/json"});
  var url  = URL.createObjectURL(blob);

  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  gebi('json-output').appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
}

function saveJson(){
   input_json = gebi('edit-json-textarea').value;

   try{
      input_data = JSON.parse(input_json);
   }catch(err){
      setFeedback('Oops! JSON input is invalid. Error: '+err,'error');
      return;
   }

   ttData = input_data;
   ttSave();
   setFeedback('JSON data saved.');
   gebi('json-output').style.display = 'none';
}


function cancelEditForm(){
  gebi('edit-popup').innerHTML = '';
  gebi('modal-bg').style.display = 'none';
  gebi('edit-popup').style.display = 'none';
}


function saveGeneralEditForm(type,id){

  if(type == 'settings'){
    var item = ttData.settings;
  }else if(type == 'session'){
    var item = getSessionById(id);
  }else{
    return; // Only settings and sessions use this form in v2
  }

  for (key in editFields[type]){
    if(document.getElementById(type+"-"+key+"-edit-input")){
      item[key] = document.getElementById(type+"-"+key+"-edit-input").value;
    }else{
      dbg("Field not found in edit form:",key);
    }
  }

  // Update session in node structure
  if(type == "session"){
    for(var nodeId in ttData.nodes){
      if(ttData.nodes[nodeId].sessions && ttData.nodes[nodeId].sessions[id]){
        ttData.nodes[nodeId].sessions[id] = item;
        if(ttData.nodes[nodeId].time !== undefined){
          delete ttData.nodes[nodeId].time;
        }
        break;
      }
    }
  }

  ttSave();
  setFeedback('Item updated');
  cancelEditForm();

  if(typeof currentView.update == "function"){
    currentView.update();
  }
}

function deleteConfirm(msg,yesCallback,noCallback){
  gebi("delete-confirm-message").innerHTML = msg;
  gebi("delete-confirm-yes").onclick = yesCallback;
  gebi("delete-confirm-no").onclick = noCallback;
  gebi('modal-bg').style.display = 'block';
  gebi('delete-confirm').style.display = 'block';

}

function deleteGeneralFromEditForm(type,id){

  if(confirm("Are you sure you would like to delete this "+type+" (and all sub items)?")){

    dbg('deleteGeneralFromEditForm() with:',[type,id]);

    if(type == "session"){
      // Delete session from node structure
      for(var nodeId in ttData.nodes){
        if(ttData.nodes[nodeId].sessions && ttData.nodes[nodeId].sessions[id]){
          delete ttData.nodes[nodeId].sessions[id];
          break;
        }
      }
    }else if(ttData.nodes[id]){
      // Delete node
      deleteNodeLocally(id);
    }

    ttSave();
    setFeedback(type+' deleted.');

    emitEvent(type,"delete",id);
    cancelEditForm();
  }
}

/* Edit form that doesn't require current values to be set */

function showGeneralEditForm(type,id){

  if(!id){
    setFeedback("No item ID or current item in edit!","error");
    return;
  }

  edit_element = document.getElementById("edit-popup");

  edit_element.innerHTML = "<h3>Edit "+type+"</h3><form>";

  if(type == 'session'){
    properties = getSessionById(id);
  }else{
    properties = {};
  }

  for (key in editFields[type]){

    var field = editFields[type][key];

    if(typeof properties[key] != "object" && properties[key]){
      var val = properties[key];
    }else if(field.defaultVal){
      var val = field.defaultVal;
    }else{
      var val = "";
    }

    if(field.type == "text"){
         edit_element.insertAdjacentHTML('beforeend', '<div class="edit-field">'+field.label+' <input type="text" value="'+val+'" id="'+type+'-'+key+'-edit-input"/></div>');
    }else if(field.type == "select"){

      var fieldDiv = document.createElement('div');
      fieldDiv.className = "edit-field";
      fieldDiv.innerHTML = field.label

      var select = document.createElement('select');
      select.id = type+'-'+key+'-edit-input';

      var options = field.options;

      for (var optkey in options){
        var option = new Option(options[optkey],optkey);
        select.options.add(option);
      }

      select.value = val;

      fieldDiv.appendChild(select);
      edit_element.appendChild(fieldDiv);

    }else if(field.type == "textarea"){
      edit_element.insertAdjacentHTML('beforeend', '<div class="edit-field">'+field.label+' <textarea id="'+type+'-'+key+'-edit-input">'+val+'</textarea></div>');
    }

  }

  edit_element.insertAdjacentHTML('beforeend', '<div>');
  edit_element.insertAdjacentHTML('beforeend', '<a class="button" onClick="saveGeneralEditForm(\''+type+'\',\''+id+'\')">Save</a>');
  edit_element.insertAdjacentHTML('beforeend', '<a class="button" onClick="cancelEditForm()">Cancel</a>');

  if(type != "settings"){
    edit_element.insertAdjacentHTML('beforeend', '<a class="button red" onClick="deleteGeneralFromEditForm(\''+type+'\',\''+id+'\')">Delete Item</a></div></form>');
  }

  gebi('modal-bg').style.display = 'block';
  edit_element.style.display = 'block';

}





var viewOrder = ['taskList', 'todayView', 'assistantView', 'analyze'];
var viewTransitioning = false;

function getViewObj(name) {
  var map = { analyze: analyze, taskList: treeView, settingsView: settingsView, todayView: todayView, assistantView: aidaChat };
  return map[name];
}

// Track current view name for transition logic
var currentViewName = null;

function setView(view){

    if (viewTransitioning) return;
    if (view === currentViewName) return;

    var oldViewName = currentViewName;
    var oldIdx = viewOrder.indexOf(oldViewName);
    var newIdx = viewOrder.indexOf(view);
    var shouldAnimate = oldIdx !== -1 && newIdx !== -1;

    // Check prefers-reduced-motion
    if (shouldAnimate && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shouldAnimate = false;
    }

    var oldEl = document.getElementById(oldViewName + '-view');
    var newEl = document.getElementById(view + '-view');

    // Call hide on old view
    if(currentView && typeof currentView.hide == "function"){
      currentView.hide();
    }

    // Update currentView reference
    currentView = getViewObj(view);
    currentViewName = view;

    if (shouldAnimate && oldEl && newEl) {
      // Animated transition
      viewTransitioning = true;
      var goingRight = newIdx > oldIdx; // new view is to the right

      // Show new view
      newEl.style.display = 'block';

      // Add transitioning + animation classes
      oldEl.classList.add('view-transitioning');
      newEl.classList.add('view-transitioning');
      oldEl.classList.add(goingRight ? 'view-slide-out-left' : 'view-slide-out-right');
      newEl.classList.add(goingRight ? 'view-slide-in-right' : 'view-slide-in-left');

      // Clean up after animation
      var cleanup = function() {
        oldEl.classList.remove('view-transitioning', 'view-slide-out-left', 'view-slide-out-right');
        newEl.classList.remove('view-transitioning', 'view-slide-in-right', 'view-slide-in-left');
        oldEl.style.display = 'none';
        viewTransitioning = false;
        if(typeof currentView.show == "function"){
          currentView.show();
        }
      };

      newEl.addEventListener('animationend', function onEnd() {
        newEl.removeEventListener('animationend', onEnd);
        cleanup();
      });

      // Fallback timeout in case animationend doesn't fire
      setTimeout(function() {
        if (viewTransitioning) cleanup();
      }, 400);

    } else {
      // Instant switch (settings or non-ordered views)
      var viewElements = document.getElementsByClassName("view-container");
      for (var i = 0; i < viewElements.length; ++i){
        if(viewElements[i].id == view+"-view"){
          viewElements[i].style.display = "block";
        }else{
          viewElements[i].style.display = "none";
        }
      }

      if(typeof currentView.show == "function"){
        currentView.show();
      }
    }
}

// Swipe navigation between views
var swipeState = { startX: 0, startY: 0, tracking: false };

function initSwipeNavigation() {
  var viewArea = document.getElementById('view-area');
  if (!viewArea) return;

  viewArea.addEventListener('touchstart', function(e) {
    if (viewTransitioning) return;
    // Don't track if touching an input or textarea
    var tag = e.target.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    // Also skip if target is inside the aida input bar
    if (e.target.closest && e.target.closest('#aida-input-bar')) return;

    swipeState.startX = e.touches[0].clientX;
    swipeState.startY = e.touches[0].clientY;
    swipeState.tracking = true;
  }, { passive: true });

  viewArea.addEventListener('touchmove', function(e) {
    if (!swipeState.tracking) return;
    var dx = e.touches[0].clientX - swipeState.startX;
    var dy = e.touches[0].clientY - swipeState.startY;
    // If vertical movement dominates, cancel swipe tracking
    if (Math.abs(dy) > Math.abs(dx)) {
      swipeState.tracking = false;
    }
  }, { passive: true });

  viewArea.addEventListener('touchend', function(e) {
    if (!swipeState.tracking) return;
    swipeState.tracking = false;
    if (viewTransitioning) return;

    var endX = e.changedTouches[0].clientX;
    var dx = endX - swipeState.startX;
    if (Math.abs(dx) < 50) return; // threshold

    var curIdx = viewOrder.indexOf(currentViewName);
    if (curIdx === -1) return;

    var targetIdx;
    if (dx < 0) {
      // Swipe left → next view
      targetIdx = curIdx + 1;
    } else {
      // Swipe right → previous view
      targetIdx = curIdx - 1;
    }

    if (targetIdx >= 0 && targetIdx < viewOrder.length) {
      setView(viewOrder[targetIdx]);
    }
  }, { passive: true });
}



/** ############################ The Big Ugly Traffic Controller ############################### **/
/** Which takes pseudo-events from the input functions and updates views (or calls other input
 * functions) accordingly. This is sort of a placeholder, and should probably be replaced with proper
 * event listening at some future date.
 **/


function emitEvent(type,action,value){

  dbg("Event emitted",type+" "+action+" "+value);
  //Testing a different approach...
  // This could also be done as a structured object (so directly "addressable" items), but we'll do
  // it this way for now for simplicity
  for(var i = 0; i < eventWatchers.length; i++){
    var eW = eventWatchers[i];
    if(eW.type == type && eW.action == action){
      if(typeof eW.callback === "function"){
        eW.callback.call(eW,value);
      }
    }
  }

}


function addEventWatcher(type,action,callback,owner){
  if(typeof type == "object"){
    eventWatchers.push(type);
  }else{
     eventWatchers.push({type:type, action:action,callback:callback,owner:owner});
  }
}

function addEventWatchers(watchers){
  for(var i = 0; i < watchers.length; i++){
    eventWatchers.push(watchers[i]);
  }
}

function removeEventWatchers(owner){
  for(var i = 0; i < eventWatchers.length; i++){
    var eW = eventWatchers[i];
    if(eW.owner == owner){
      eventWatchers.splice(i,1);
    }
  }
}

function getEventWatchers(owner){
  var ownerWatchers = [];
  for(var i = 0; i < eventWatchers.length; i++){
    var eW = eventWatchers[i];
    if(eW.owner == owner){
      ownerWatchers.push(eW);
    }
  }
  return ownerWatchers;
}


/* ################################ TREE VIEW (v2) - Outliner Style ################################ */

var treeView = {};

// State
treeView.searchFilter = '';
treeView.hideCompleted = true;
treeView.focusedNodeId = null;
treeView.viewingNodeId = null; // null = full tree, set = node detail view
treeView.originalValues = {}; // Store original values for change detection
treeView.updateScheduled = false; // Prevent redundant updates
treeView._isRendering = false; // True during DOM rebuild (suppresses blur side-effects)
treeView.recentFilter = false;   // whether Recent filter is active
treeView.recentPreset = 'today'; // which preset is selected

// Helper: create a metadata label/value pair element
treeView._metaItem = function(label, value) {
  var item = document.createElement('div');
  item.className = 'node-view-meta-item';
  var lbl = document.createElement('span');
  lbl.className = 'node-view-meta-label';
  lbl.textContent = label;
  var val = document.createElement('span');
  val.className = 'node-view-meta-value';
  if (typeof value === 'string') {
    val.textContent = value;
  } else {
    val.appendChild(value);
  }
  item.appendChild(lbl);
  item.appendChild(val);
  return item;
};

// Render session history for a task node
treeView._renderSessionHistory = function(nodeId) {
  var node = getNode(nodeId);
  if (!node || !node.sessions) return null;

  var sessionIds = Object.keys(node.sessions);
  if (sessionIds.length === 0) return null;

  // Sort by start_time descending
  sessionIds.sort(function(a, b) {
    var sa = node.sessions[a].start_time || 0;
    var sb = node.sessions[b].start_time || 0;
    return sb - sa;
  });

  var section = document.createElement('div');
  section.className = 'node-view-sessions';

  var toggle = document.createElement('div');
  toggle.className = 'node-view-sessions-toggle';
  var caret = document.createElement('i');
  caret.className = 'fa fa-caret-right node-view-sessions-caret';
  toggle.appendChild(caret);
  toggle.appendChild(document.createTextNode(' Sessions (' + sessionIds.length + ')'));
  section.appendChild(toggle);

  var content = document.createElement('div');
  content.className = 'node-view-sessions-content';
  content.style.display = 'none';

  toggle.onclick = function() {
    var open = content.style.display !== 'none';
    content.style.display = open ? 'none' : 'block';
    caret.className = 'fa ' + (open ? 'fa-caret-right' : 'fa-caret-down') + ' node-view-sessions-caret';
  };

  for (var i = 0; i < sessionIds.length; i++) {
    var sid = sessionIds[i];
    var sess = node.sessions[sid];
    var row = document.createElement('div');
    row.className = 'node-view-session-row';
    row.setAttribute('data-session-id', sid);

    var dateStr = sess.start_time ? moment(sess.start_time).format('MMM D, YYYY') : '';
    var startStr = sess.start_time ? moment(sess.start_time).format('h:mm a') : '';
    var endStr = sess.end_time ? moment(sess.end_time).format('h:mm a') : '';
    var dur = (sess.start_time && sess.end_time) ? moment(sess.end_time).diff(moment(sess.start_time), 'seconds') : 0;

    var dateEl = document.createElement('span');
    dateEl.className = 'session-date';
    dateEl.textContent = dateStr;
    row.appendChild(dateEl);

    var timeRange = document.createElement('span');
    timeRange.className = 'session-time-range';
    timeRange.textContent = startStr + ' \u2013 ' + endStr;
    row.appendChild(timeRange);

    var durEl = document.createElement('span');
    durEl.className = 'session-duration';
    durEl.textContent = prettyTime(dur);
    row.appendChild(durEl);

    // Double-click to edit session
    (function(sessionId) {
      row.ondblclick = function() {
        showGeneralEditForm('session', sessionId);
      };
    })(sid);

    content.appendChild(row);

    // Session notes
    if (sess.notes) {
      var noteEl = document.createElement('div');
      noteEl.className = 'session-notes';
      noteEl.textContent = sess.notes;
      content.appendChild(noteEl);
    }
  }

  section.appendChild(content);
  return section;
};

// Render the node view header (breadcrumb, title, metadata, notes, sessions)
treeView._renderNodeViewHeader = function(container, nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  var isTask = nodeIsTask(nodeId);
  var header = document.createElement('div');
  header.className = 'node-view-header';

  // Breadcrumb
  var breadcrumb = document.createElement('div');
  breadcrumb.className = 'node-view-breadcrumb';

  var allLink = document.createElement('span');
  allLink.className = 'breadcrumb-item';
  allLink.textContent = 'All';
  allLink.onclick = function() {
    treeView.viewingNodeId = null;
    treeView.update();
  };
  breadcrumb.appendChild(allLink);

  var path = getNodePath(nodeId);
  for (var i = 0; i < path.length; i++) {
    var sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '\u203A';
    breadcrumb.appendChild(sep);

    if (i < path.length - 1) {
      // Ancestor — clickable
      (function(ancestorId) {
        var link = document.createElement('span');
        link.className = 'breadcrumb-item';
        link.textContent = path[i].name || '(unnamed)';
        link.onclick = function() {
          treeView.viewingNodeId = ancestorId;
          treeView.update();
        };
        breadcrumb.appendChild(link);
      })(path[i].id);
    } else {
      // Current node — bold, not clickable
      var current = document.createElement('span');
      current.style.fontWeight = 'bold';
      current.textContent = node.name || '(unnamed)';
      breadcrumb.appendChild(current);
    }
  }
  header.appendChild(breadcrumb);

  // Title
  var title = document.createElement('h2');
  title.className = 'node-view-title';
  title.textContent = node.name || '(unnamed)';
  header.appendChild(title);

  // Metadata grid
  var meta = document.createElement('div');
  meta.className = 'node-view-meta';

  var time = calculateNodeTime(nodeId);
  if (time > 0) {
    meta.appendChild(treeView._metaItem('Time logged', prettyTime(time)));
  }

  if (isTask) {
    if (node.estimate && node.estimate > 0) {
      meta.appendChild(treeView._metaItem('Estimate', prettyTime(node.estimate)));
    }
    if (node.status && node.status !== 'new') {
      var statusLabels = {inProcess: 'In Process', completed: 'Completed', onHold: 'On Hold'};
      meta.appendChild(treeView._metaItem('Status', statusLabels[node.status] || node.status));
    }
    if (node.priority && node.priority !== '3') {
      var priorityLabels = {'1': '1 (Highest)', '2': '2 (High)', '4': '4 (Low)', '5': '5 (Lowest)'};
      meta.appendChild(treeView._metaItem('Priority', priorityLabels[node.priority] || node.priority));
    }
    if (node.due) {
      meta.appendChild(treeView._metaItem('Due', moment(node.due).format('MMM D, YYYY')));
    }
    if (node.starred === '1') {
      var starEl = document.createElement('span');
      starEl.innerHTML = '<i class="fa fa-star" style="color:#f5a623"></i> Yes';
      meta.appendChild(treeView._metaItem('Starred', starEl));
    }
    if (node.billable === '0') {
      meta.appendChild(treeView._metaItem('Billable', 'No'));
    }
  } else {
    // Folder metadata
    var childCount = (node.childOrder || []).length;
    meta.appendChild(treeView._metaItem('Children', String(childCount)));

    // Count total descendant tasks
    var taskCount = 0;
    var totalEstimate = 0;
    function countDescendants(nid) {
      var n = getNode(nid);
      if (!n) return;
      if (nodeIsTask(nid)) {
        taskCount++;
        totalEstimate += (n.estimate || 0);
      }
      var co = n.childOrder || [];
      for (var j = 0; j < co.length; j++) {
        countDescendants(co[j]);
      }
    }
    var co = node.childOrder || [];
    for (var j = 0; j < co.length; j++) {
      countDescendants(co[j]);
    }
    if (taskCount > 0) {
      meta.appendChild(treeView._metaItem('Total tasks', String(taskCount)));
    }
    if (totalEstimate > 0) {
      meta.appendChild(treeView._metaItem('Total estimate', prettyTime(totalEstimate)));
    }
  }

  if (meta.children.length > 0) {
    header.appendChild(meta);
  }

  // Notes section (collapsible)
  var notesSection = document.createElement('div');
  notesSection.className = 'node-view-notes-section';

  var hasNotes = node.notes && node.notes.trim();
  var notesToggle = document.createElement('div');
  notesToggle.className = 'node-view-notes-toggle';
  var notesCaret = document.createElement('i');
  notesCaret.className = 'fa ' + (hasNotes ? 'fa-caret-down' : 'fa-caret-right') + ' node-view-notes-caret';
  notesToggle.appendChild(notesCaret);
  notesToggle.appendChild(document.createTextNode(' Notes'));
  notesSection.appendChild(notesToggle);

  var notesContent = document.createElement('div');
  notesContent.className = 'node-view-notes-content';
  notesContent.style.display = hasNotes ? 'block' : 'none';

  var notesTextarea = document.createElement('textarea');
  notesTextarea.className = 'node-view-notes-textarea';
  notesTextarea.value = node.notes || '';
  notesTextarea.placeholder = 'Add notes...';
  notesTextarea.oninput = function() {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
  };
  notesTextarea.onblur = function() {
    var val = this.value;
    if (val !== (node.notes || '')) {
      node.notes = val;
      ttSave();
      emitEvent('node', 'updated', nodeId);
    }
  };
  notesContent.appendChild(notesTextarea);
  notesSection.appendChild(notesContent);

  notesToggle.onclick = function() {
    var open = notesContent.style.display !== 'none';
    notesContent.style.display = open ? 'none' : 'block';
    notesCaret.className = 'fa ' + (open ? 'fa-caret-right' : 'fa-caret-down') + ' node-view-notes-caret';
    if (!open) {
      // Auto-size textarea when opening
      notesTextarea.style.height = 'auto';
      notesTextarea.style.height = notesTextarea.scrollHeight + 'px';
    }
  };

  header.appendChild(notesSection);

  // Session history (tasks only)
  if (isTask) {
    var sessSection = treeView._renderSessionHistory(nodeId);
    if (sessSection) {
      header.appendChild(sessSection);
    }
  }

  // Children separator
  var sep = document.createElement('div');
  sep.className = 'node-view-children-header';
  sep.textContent = isTask ? '' : 'Children';
  header.appendChild(sep);

  container.appendChild(header);
};

/**
 * Check if a node is a "task" (leaf node with no children)
 * A node is a task if it has no children. Otherwise it's a folder.
 */
function nodeIsTask(nodeId) {
  var node = getNode(nodeId);
  if (!node) return false;
  return !node.childOrder || node.childOrder.length === 0;
}

treeView.show = function() {
  addEventWatcher('server', 'synch', function() {
    treeView.update();
  }, 'treeView');

  addEventWatcher('node', 'updated', function() {
    treeView.update();
  }, 'treeView');

  var treeDateRange = gebi('tree-date-range');
  if (treeDateRange) {
    treeDateRange.onclick = function(e) {
      if (e.target.classList.contains('range-btn')) {
        treeView.setRecentPreset(e.target.getAttribute('data-preset'));
      }
    };
  }

  treeView.update();
};

treeView.hide = function() {
  removeEventWatchers('treeView');
};

treeView.update = function() {
  // Debounce: if update is already scheduled, skip this call
  if (treeView.updateScheduled) return;

  treeView.updateScheduled = true;
  setTimeout(function() {
    treeView.updateScheduled = false;
    treeView._doUpdate();
  }, 0);
};

treeView._doUpdate = function() {
  var container = gebi('node-tree');
  if (!container) return;

  treeView._isRendering = true;
  container.innerHTML = '';

  // Pre-compute which nodes match or contain matches for search filter
  treeView._searchMatchIds = null;
  if (treeView.searchFilter) {
    var search = treeView.searchFilter.toLowerCase();
    var matchIds = {};
    // Walk all nodes; for each match, mark it and all ancestors
    for (var nid in ttData.nodes) {
      var n = ttData.nodes[nid];
      if (n.name && n.name.toLowerCase().indexOf(search) !== -1) {
        matchIds[nid] = true;
        var pid = n.parentId;
        while (pid) {
          matchIds[pid] = true;
          var pn = getNode(pid);
          pid = pn ? pn.parentId : null;
        }
      }
    }
    treeView._searchMatchIds = matchIds;
  }

  // Pre-compute which nodes match the Recent date filter
  treeView._recentMatchIds = null;
  if (treeView.recentFilter) {
    var range = analyze.getDateRange(treeView.recentPreset);
    var startBound = range.start + 'T00:00:00';
    var endBound = range.end + 'T23:59:59';
    var recentIds = {};
    for (var nid in ttData.nodes) {
      var cd = ttData.nodes[nid].creation_date;
      if (cd && cd >= startBound && cd <= endBound) {
        recentIds[nid] = true;
        var pid = ttData.nodes[nid].parentId;
        while (pid) {
          recentIds[pid] = true;
          var pn = getNode(pid);
          pid = pn ? pn.parentId : null;
        }
      }
    }
    treeView._recentMatchIds = recentIds;
  }

  // Node view mode: drill-down into a single node
  if (treeView.viewingNodeId) {
    var viewNode = getNode(treeView.viewingNodeId);
    if (!viewNode) {
      // Node was deleted, fall back to full tree
      treeView.viewingNodeId = null;
    } else {
      container.onclick = null;
      treeView._renderNodeViewHeader(container, treeView.viewingNodeId);

      var children = viewNode.childOrder || [];
      if (children.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'tree-empty';
        empty.textContent = 'Click here to add a child item';
        empty.onclick = function() { treeView.addFirstChild(treeView.viewingNodeId); };
        container.appendChild(empty);
      } else {
        for (var i = 0; i < children.length; i++) {
          treeView.renderNode(container, children[i], 0);
        }
      }

      treeView._isRendering = false;

      // Auto-size all textareas
      var textareas = container.querySelectorAll('.tree-text');
      for (var i = 0; i < textareas.length; i++) {
        textareas[i].style.height = 'auto';
        textareas[i].style.height = textareas[i].scrollHeight + 'px';
      }

      // Auto-size notes textarea
      var notesTA = container.querySelector('.node-view-notes-textarea');
      if (notesTA) {
        notesTA.style.height = 'auto';
        notesTA.style.height = notesTA.scrollHeight + 'px';
      }

      // Restore focus
      if (treeView.focusedNodeId) {
        var input = container.querySelector('[data-node-id="' + treeView.focusedNodeId + '"] .tree-text');
        if (input) {
          input.focus();
          var len = input.value.length;
          input.setSelectionRange(len, len);
        }
      }
      return;
    }
  }

  // Full tree mode (default)
  // Empty tree case
  if ((ttData.rootOrder || []).length === 0) {
    container.innerHTML = '<div class="tree-empty">Click here to add your first item<div class="tree-empty-hint">Press Enter to add more, Tab to indent</div></div>';
    container.onclick = function() { treeView.addFirst(); };
  } else {
    container.onclick = null;

    // Render all root nodes (including provisional)
    var rootOrder = ttData.rootOrder || [];
    for (var i = 0; i < rootOrder.length; i++) {
      treeView.renderNode(container, rootOrder[i], 0);
    }
  }
  treeView._isRendering = false;

  // Auto-size all textareas now that the full tree is in the DOM
  var textareas = container.querySelectorAll('.tree-text');
  for (var i = 0; i < textareas.length; i++) {
    textareas[i].style.height = 'auto';
    textareas[i].style.height = textareas[i].scrollHeight + 'px';
  }

  // Restore focus
  if (treeView.focusedNodeId) {
    var input = container.querySelector('[data-node-id="' + treeView.focusedNodeId + '"] .tree-text');
    if (input) {
      input.focus();
      var len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }
};

treeView.renderNode = function(container, nodeId, depth) {
  var node = getNode(nodeId);
  if (!node) return;

  var isTask = nodeIsTask(nodeId);
  var hasChildren = !isTask;
  var isCompleted = node.status === 'completed';
  var isProvisional = !!node.provisional;

  // Skip filters for provisional nodes
  if (!isProvisional) {
    // Apply filters
    if (treeView.hideCompleted && isTask && isCompleted) {
      // Check if any descendants match (for folders)
      if (!hasChildren) return;
    }

    if (treeView._searchMatchIds) {
      if (!treeView._searchMatchIds[nodeId]) return;
    }

    if (treeView._recentMatchIds) {
      if (!treeView._recentMatchIds[nodeId]) return;
    }
  }

  // Create row
  var row = document.createElement('div');
  var headingClass = '';
  if (hasChildren) {
    var level = Math.min(depth, 3) + 1; // depth 0 = h1, depth 1 = h2, ... depth 3+ = h4
    headingClass = ' tree-h' + level;
  }
  row.className = 'tree-row' + headingClass + (isCompleted ? ' completed' : '') + (isProvisional ? ' tree-row-provisional' : '');
  row.setAttribute('data-node-id', nodeId);
  row.setAttribute('data-depth', depth);

  // Double-click to drill into node view
  if (!isProvisional) {
    row.ondblclick = function(e) {
      if (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'I' || e.target.className.indexOf('tree-bullet') !== -1) return;
      e.preventDefault();
      treeView.viewingNodeId = nodeId;
      treeView.update();
    };
  }

  // Bullet/toggle (also serves as drag handle)
  var bullet = document.createElement('span');
  bullet.className = 'tree-bullet' + (hasChildren ? ' has-children' : '') + (node.collapsed ? ' collapsed' : '');
  bullet.innerHTML = hasChildren ? '&#9660;' : '&#8226;';

  // Skip drag handlers for provisional nodes
  if (!isProvisional) {
    bullet.setAttribute('draggable', 'true');
    bullet.ondragstart = function(e) {
      treeView.dragState = { nodeId: nodeId };
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', nodeId);
      setTimeout(function() { row.classList.add('dragging'); }, 0);
    };
    bullet.ondragend = function() {
      row.classList.remove('dragging');
      treeView.dragClearIndicators();
      treeView.dragState = null;
    };
  }

  bullet.onclick = function(e) {
    e.stopPropagation();
    if (hasChildren) {
      treeView.toggle(nodeId);
    }
  };
  row.appendChild(bullet);

  // Drop zone handlers on the row (skip for provisional)
  if (!isProvisional) {
    row.ondragover = function(e) {
      if (!treeView.dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      treeView.dragClearIndicators();

      var rect = row.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var h = rect.height;

      if (y < h * 0.25) {
        row.classList.add('drop-above');
        treeView.dragState.dropType = 'above';
      } else if (y > h * 0.75) {
        row.classList.add('drop-below');
        treeView.dragState.dropType = 'below';
      } else {
        row.classList.add('drop-into');
        treeView.dragState.dropType = 'into';
      }
      treeView.dragState.dropNodeId = nodeId;
    };
    row.ondragleave = function(e) {
      // Only clear if actually leaving this element
      if (!row.contains(e.relatedTarget)) {
        row.classList.remove('drop-above', 'drop-below', 'drop-into');
      }
    };
    row.ondrop = function(e) {
      e.preventDefault();
      treeView.dragDrop();
    };
  }

  // Checkbox for tasks (skip for provisional nodes)
  if (isTask && !isProvisional) {
    var check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'tree-check';
    check.checked = isCompleted;
    check.onclick = function(e) {
      e.stopPropagation();
      treeView.toggleComplete(nodeId, this);
    };
    row.appendChild(check);
  }

  // Editable text input
  var text = document.createElement('textarea');
  text.rows = 1;
  text.className = 'tree-text';
  text.value = node.name;
  text.placeholder = 'Type here...';
  text.setAttribute('data-node-id', nodeId);

  // Auto-resize textarea height to fit content
  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  // Handle input changes - update node but don't save yet (save on blur/Enter)
  text.oninput = function() {
    autoResize(this);
    node.name = this.value;

    // Promote provisional node to real when content added (don't parse estimate yet)
    if (node.provisional && this.value.trim()) {
      delete node.provisional;

      // Now sync it (estimate will be parsed on blur or Enter)
      synchQueue.add("insert", "node", node.id, node.parentId);

      // Sync parent to update childOrder
      if (node.parentId) {
        synchQueue.add("update", "node", node.parentId, getNode(node.parentId).parentId);
      }

      ttSave();

      // Re-render to show checkbox/buttons
      treeView.update();
    }
  };

  // Handle keyboard
  text.onkeydown = function(e) {
    treeView.handleKeydown(e, nodeId, depth);
  };

  text.onfocus = function() {
    treeView.focusedNodeId = nodeId;
    row.classList.add('editing');
    // Store original values for change detection (survives re-renders)
    treeView.originalValues[nodeId] = {
      name: node.name,
      estimate: node.estimate || 0
    };
  };

  text.onblur = function() {
    // Ignore blur caused by DOM rebuild in _doUpdate()
    if (treeView._isRendering) return;

    row.classList.remove('editing');
    treeView.focusedNodeId = null;

    // Delete provisional nodes if empty
    if (node.provisional && !node.name.trim()) {
      deleteNodeLocally(nodeId);  // Don't sync (never was synced)
      treeView.update();
      return;
    }

    // Parse estimate and save changes (emits 'node' 'updated' event which triggers refresh)
    treeView.finalizeNode(nodeId);

    // Clean up empty nodes on blur (for non-provisional nodes)
    if (!node.provisional && !node.name.trim() && nodeIsTask(nodeId)) {
      // Don't delete if it's the only node
      var siblings = node.parentId ? getNode(node.parentId).childOrder : ttData.rootOrder;
      if (siblings.length > 1) {
        deleteNode(nodeId, true);
        setTimeout(function() { treeView.update(); }, 10);
      }
    }
  };

  row.appendChild(text);

  // Meta info, play button, star (skip for provisional)
  if (!isProvisional) {
    // Meta info (time + estimate)
    var time = calculateNodeTime(nodeId);
    var estimate = node.estimate || 0;
    if (time > 0 || estimate > 0) {
      var meta = document.createElement('span');
      meta.className = 'tree-meta';
      var parts = [];
      if (time > 0) parts.push('<span class="time">' + prettyTime(time) + '</span>');
      if (estimate > 0) parts.push('<span class="tree-estimate">est ' + prettyTime(estimate) + '</span>');
      meta.innerHTML = parts.join(' ');
      row.appendChild(meta);
    }

    // Star and play button for tasks
    if (isTask) {
      var star = document.createElement('i');
      star.className = 'fa fa-star tree-star' + (node.starred === '1' ? ' starred' : '');
      star.onclick = function(e) {
        e.stopPropagation();
        treeView.toggleStar(nodeId);
      };
      row.appendChild(star);

      var play = document.createElement('i');
      play.className = 'fa fa-play-circle tree-play';
      play.onclick = function(e) {
        e.stopPropagation();
        treeView.startSession(nodeId);
      };
      row.appendChild(play);
    }
  }

  container.appendChild(row);

  // Render children (force-expand when search filter matches descendants)
  if (hasChildren && (!node.collapsed || treeView._searchMatchIds || treeView._recentMatchIds)) {
    var childContainer = document.createElement('div');
    childContainer.className = 'tree-children';

    for (var i = 0; i < node.childOrder.length; i++) {
      treeView.renderNode(childContainer, node.childOrder[i], depth + 1);
    }

    if (childContainer.children.length > 0) {
      container.appendChild(childContainer);
    }
  }
};

// Finalize a node: parse estimate from name and save changes
// This is called automatically on blur, so no need to call manually in most cases
treeView.finalizeNode = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  // Get original values from storage (survives re-renders)
  var original = treeView.originalValues[nodeId];
  if (!original) {
    // No original values stored, nothing to compare
    return;
  }

  var originalName = original.name || '';
  var originalEstimate = original.estimate || 0;

  // Parse estimate from name (e.g. "Fix bug (30 m)" or "Fix bug 30m")
  if (node.name) {
    var parsed = parseEstimateFromInput(node.name);
    if (parsed.estimate > 0) {
      node.name = parsed.name;
      node.estimate = parsed.estimate;
    }
  }

  // Check if anything changed and save
  if (node.name !== originalName || node.estimate !== originalEstimate) {
    ttSave();
    emitEvent('node', 'updated', nodeId);
  }

  // Clean up stored values
  delete treeView.originalValues[nodeId];
};

treeView.handleKeydown = function(e, nodeId, depth) {
  var node = getNode(nodeId);
  if (!node) return;

  // Enter: Create new sibling below (blur will finalize automatically)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    treeView.addSibling(nodeId);
    return;
  }

  // Tab: Indent (blur will finalize automatically)
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    treeView.indent(nodeId);
    return;
  }

  // Shift+Tab: Outdent (blur will finalize automatically)
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    treeView.outdent(nodeId);
    return;
  }

  // Backspace on empty: Delete and focus previous
  if (e.key === 'Backspace' && e.target.value === '') {
    e.preventDefault();
    treeView.deleteAndFocusPrev(nodeId);
    return;
  }

  // Arrow Up: Focus previous (blur will finalize automatically)
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    treeView.focusPrev(nodeId);
    return;
  }

  // Arrow Down: Focus next (blur will finalize automatically)
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    treeView.focusNext(nodeId);
    return;
  }
};

// Add first node when tree is empty
treeView.addFirst = function() {
  var node = createNode(null, {type: 'task'}, true);  // true = provisional
  treeView.focusedNodeId = node.id;
  treeView.update();
};

// Add sibling after current node
treeView.addSibling = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  // Finalize current node before moving on (blur is suppressed during re-render)
  treeView.finalizeNode(nodeId);

  // Create provisional sibling
  var newNode = createNode(node.parentId, {type: 'task'}, true);

  // Position after current node
  var siblings = node.parentId ? getNode(node.parentId).childOrder : ttData.rootOrder;
  var newIdx = siblings.indexOf(newNode.id);
  var afterIdx = siblings.indexOf(nodeId);
  siblings.splice(newIdx, 1);
  siblings.splice(afterIdx + 1, 0, newNode.id);

  ttSave();
  treeView.focusedNodeId = newNode.id;
  treeView.update();
};

// Finalize a pending node by creating it in data
// Indent: Make this node a child of the previous sibling
treeView.indent = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  treeView.finalizeNode(nodeId);

  var parentId = node.parentId;
  var siblings = parentId ? getNode(parentId).childOrder : ttData.rootOrder;
  var idx = siblings.indexOf(nodeId);

  // Can't indent first item
  if (idx === 0) return;

  var newParentId = siblings[idx - 1];
  moveNode(nodeId, newParentId, -1);

  // Expand the new parent
  var newParent = getNode(newParentId);
  if (newParent) newParent.collapsed = false;

  ttSave();
  treeView.focusedNodeId = nodeId;
  treeView.update();
};

// Outdent: Move this node up one level
treeView.outdent = function(nodeId) {
  var node = getNode(nodeId);
  if (!node || !node.parentId) return; // Can't outdent root items
  if (treeView.viewingNodeId && node.parentId === treeView.viewingNodeId) return;

  treeView.finalizeNode(nodeId);

  var parent = getNode(node.parentId);
  var grandparentId = parent.parentId;

  // Find parent's position in grandparent
  var parentSiblings = grandparentId ? getNode(grandparentId).childOrder : ttData.rootOrder;
  var parentIdx = parentSiblings.indexOf(parent.id);

  // Move after parent
  moveNode(nodeId, grandparentId, parentIdx + 1);

  ttSave();
  treeView.focusedNodeId = nodeId;
  treeView.update();
};

// Delete node and focus previous
treeView.deleteAndFocusPrev = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  // Find previous node to focus
  var prevId = treeView.getPrevNodeId(nodeId);

  // Don't delete if it's the only node
  var siblings = node.parentId ? getNode(node.parentId).childOrder : ttData.rootOrder;
  if (siblings.length === 1 && !node.parentId) return;

  deleteNode(nodeId, true);
  treeView.focusedNodeId = prevId;
  treeView.update();
  emitEvent('task', 'deleted');
};

// Get all visible node IDs in order
treeView.getVisibleNodeIds = function() {
  var ids = [];

  function collect(parentId) {
    var children = parentId ? getNode(parentId).childOrder : ttData.rootOrder;
    if (!children) return;

    for (var i = 0; i < children.length; i++) {
      var nid = children[i];
      var n = getNode(nid);
      if (!n) continue;

      // Skip filtered
      if (treeView.hideCompleted && nodeIsTask(nid) && n.status === 'completed') continue;

      ids.push(nid);

      // Recurse if not collapsed
      if (!nodeIsTask(nid) && !n.collapsed) {
        collect(nid);
      }
    }
  }

  collect(treeView.viewingNodeId);
  return ids;
};

treeView.getPrevNodeId = function(nodeId) {
  var ids = treeView.getVisibleNodeIds();
  var idx = ids.indexOf(nodeId);
  return idx > 0 ? ids[idx - 1] : null;
};

treeView.getNextNodeId = function(nodeId) {
  var ids = treeView.getVisibleNodeIds();
  var idx = ids.indexOf(nodeId);
  return idx < ids.length - 1 ? ids[idx + 1] : null;
};

treeView.focusPrev = function(nodeId) {
  var prevId = treeView.getPrevNodeId(nodeId);
  if (prevId) {
    treeView.focusedNodeId = prevId;
    var input = document.querySelector('[data-node-id="' + prevId + '"].tree-text');
    if (input) input.focus();
  }
};

treeView.focusNext = function(nodeId) {
  var nextId = treeView.getNextNodeId(nodeId);
  if (nextId) {
    treeView.focusedNodeId = nextId;
    var input = document.querySelector('[data-node-id="' + nextId + '"].tree-text');
    if (input) input.focus();
  }
};

treeView.toggle = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;
  node.collapsed = !node.collapsed;
  ttSave();
  emitEvent('node', 'updated', nodeId);
  treeView.update();
};

treeView.toggleComplete = function(nodeId, checkbox) {
  var node = getNode(nodeId);
  if (!node) return;
  node.status = checkbox.checked ? 'completed' : 'inProcess';
  if (checkbox.checked) { recordCompletion(node); } else { undoCompletion(node); }
  ttSave();
  emitEvent('node', 'updated', nodeId);
  if (treeView.hideCompleted) {
    treeView.update();
  }
};

treeView.toggleStar = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;
  node.starred = node.starred === '1' ? '0' : '1';
  ttSave();
  treeView.update();
  emitEvent('node', 'updated', nodeId);
};

treeView.startSession = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  // Can only track time on leaf nodes
  if (!nodeIsTask(nodeId)) {
    setFeedback('Can only track time on items without children', 'error');
    return;
  }

  current_node = node;
  current_node_path = getNodePath(nodeId);
  startNodeSession();
};

// --- Drag and Drop ---
treeView.dragState = null;

treeView.dragClearIndicators = function() {
  var rows = document.querySelectorAll('.tree-row');
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.remove('drop-above', 'drop-below', 'drop-into');
  }
};

treeView.dragDrop = function() {
  var state = treeView.dragState;
  if (!state || !state.dropNodeId || state.nodeId === state.dropNodeId) return;

  var dragId = state.nodeId;
  var dropId = state.dropNodeId;
  var dropType = state.dropType;
  var dropNode = getNode(dropId);
  if (!dropNode) return;

  // Prevent dropping into own descendants
  var path = getNodePath(dropId);
  for (var i = 0; i < path.length; i++) {
    if (path[i].id === dragId) return;
  }

  if (dropType === 'into') {
    // Make it a child of the drop target
    moveNode(dragId, dropId, 0);
    // Expand so the moved node is visible
    var parent = getNode(dropId);
    if (parent) parent.collapsed = false;
  } else {
    // Place above or below the drop target as a sibling
    var parentId = dropNode.parentId;
    var siblings = parentId ? getNode(parentId).childOrder : ttData.rootOrder;
    var dropIdx = siblings.indexOf(dropId);
    var insertIdx = dropType === 'below' ? dropIdx + 1 : dropIdx;
    moveNode(dragId, parentId, insertIdx);
  }

  ttSave();
  treeView.dragState = null;
  treeView.update();
  emitEvent('task', 'updated');
};

treeView.filterBySearch = function() {
  treeView.searchFilter = gebi('tree-search').value;
  treeView.update();
};

treeView.toggleHideCompleted = function() {
  treeView.hideCompleted = gebi('tree-hide-completed').checked;
  treeView.update();
};

treeView.toggleRecent = function() {
  treeView.recentFilter = !treeView.recentFilter;
  var btn = gebi('tree-recent-btn');
  var bar = gebi('tree-date-range');
  if (treeView.recentFilter) {
    btn.classList.add('active');
    bar.style.display = 'flex';
  } else {
    btn.classList.remove('active');
    bar.style.display = 'none';
  }
  treeView.update();
};

treeView.setRecentPreset = function(preset) {
  treeView.recentPreset = preset;
  var buttons = document.querySelectorAll('#tree-date-range .range-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].getAttribute('data-preset') === preset);
  }
  treeView.update();
};

// For today view compatibility
treeView.saveNewTaskFromToday = function() {
  var input = gebi('today-new-task-input');
  if (!input) return;

  var name = input.value.trim();
  // Strip any unresolved /text from the name
  name = name.replace(/\/\S*/g, '').trim();
  if (!name) return;

  var parentId = todayFolderAc.selectedParentId;
  var parsed = parseEstimateFromInput(name);

  createNode(parentId, {
    name: parsed.name,
    type: 'task',
    estimate: parsed.estimate,
    starred: '1'
  });

  input.value = '';
  todayFolderAc.reset();
  emitEvent('task', 'added');

  if (parentId) {
    var parentNode = getNode(parentId);
    setFeedback('Task created in ' + (parentNode ? parentNode.name : 'folder'));
  } else {
    setFeedback('Task created');
  }
};

// Add first child to a node (used by empty state in node view)
treeView.addFirstChild = function(parentId) {
  var node = createNode(parentId, {type: 'task'}, true);
  var parent = getNode(parentId);
  if (parent) parent.collapsed = false;
  treeView.focusedNodeId = node.id;
  treeView.update();
};

// Drill into a node's detail view (called by todayView ondblclick)
treeView.showEditForm = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;
  if (currentView !== treeView) {
    setView('taskList');
  }
  treeView.viewingNodeId = nodeId;
  treeView.update();
};


/* ######################### NODE SESSION FUNCTIONS ######################### */

/**
 * Start a session on current_node
 */
function startNodeSession() {
  if (!current_node || current_node.type !== 'task') {
    setFeedback('Can only track time on tasks', 'error');
    return;
  }

  startDate = moment();

  // Reset estimate alert flags
  estimateAlert90Triggered = false;
  estimateAlert100Triggered = false;

  current_session = {
    id: newId(),
    start_time: startDate.format("YYYY-MM-DD HH:mm:ss")
  };

  // Add session to node
  if (!current_node.sessions) current_node.sessions = {};
  current_node.sessions[current_session.id] = current_session;

  // Queue for sync
  synchQueue.add("insert", "node_session", current_session.id, current_node.id);

  // Save current node ID
  localStorage.ttCurrentNodeId = current_node.id;
  localStorage.ttSessionId = current_session.id;
  if (nativeBridge.ready) nativeBridge.persist();

  counterId = setInterval(incrementCurrentDuration, 1000);
  showNodeInSession();
  ttSave();
}

/**
 * Continue an existing session on current_node
 */
function continueNodeSession() {
  if (!current_node || !current_session) return;

  startDate = moment(current_session.start_time);
  counterId = setInterval(incrementCurrentDuration, 1000);
  showNodeInSession();
}

/**
 * Show in-session UI for node-based tracking
 */
function showNodeInSession() {
  // Build path display
  var pathStr = '';
  for (var i = 0; i < current_node_path.length; i++) {
    if (i > 0) pathStr += ' > ';
    pathStr += '<b>' + escapeHtml(current_node_path[i].name) + '</b>';
  }

  // Build estimate display
  var estimateHtml = '';
  if (current_node.estimate && current_node.estimate > 0) {
    estimateHtml = '<div id="session-estimate">' +
      '<span class="estimate-label">EST</span>' +
      '<span class="estimate-value">' + prettyTime(current_node.estimate) + '</span>' +
      '</div>';
  }

  var html = '<div class="centered-box">' +
    '<div id="current-info">' + pathStr + '</div>' +
    '<div id="current_duration"><span style="color:#dddddd">00:00:00</span></div>' +
    estimateHtml +
    '<div id="session-buttons">' +
      '<a class="button session-end-btn" onclick="endNodeSession(false)">End&nbsp;Session</a>' +
      '<a class="button session-complete-btn" onclick="endNodeSession(true)">Task&nbsp;Complete</a>' +
    '</div>' +
    '<input type="text" id="session-notes-input" placeholder="Add notes..." />' +
  '</div>';

  gebi('active-session').innerHTML = html;
  gebi('active-session').style.display = 'block';

  setTimeout(fitDurationText, 10);
  window.addEventListener('resize', fitDurationText);
}

/**
 * End session on current_node
 */
function endNodeSession(markComplete) {
  clearInterval(counterId);
  window.removeEventListener('resize', fitDurationText);

  current_session.end_time = moment().format("YYYY-MM-DD HH:mm:ss");
  current_session.notes = gebi('session-notes-input').value;

  var task_complete_feedback = '';
  var feedback_class = 'notice';

  if (markComplete) {
    current_node.status = 'completed';
    recordCompletion(current_node);
    task_complete_feedback = ' <b>Task complete!</b>';
    feedback_class = 'success';
  } else {
    if (current_node.status === 'new') {
      current_node.status = 'inProcess';
    }
  }

  // Save the updated session back to the node (explicitly to ttData.nodes)
  var pastSessionId = current_session.id;
  console.log('[SESSION END] Saving session:', {
    sessionId: pastSessionId,
    nodeId: current_node.id,
    session: current_session,
    hasEndTime: !!current_session.end_time
  });

  if (!ttData.nodes[current_node.id].sessions) {
    console.log('[SESSION END] Creating sessions object');
    ttData.nodes[current_node.id].sessions = {};
  }

  console.log('[SESSION END] Sessions object before assignment:', ttData.nodes[current_node.id].sessions);
  ttData.nodes[current_node.id].sessions[pastSessionId] = current_session;
  console.log('[SESSION END] Sessions object after assignment:', ttData.nodes[current_node.id].sessions);

  console.log('[SESSION END] Session saved to node:', {
    nodeId: current_node.id,
    sessionCount: Object.keys(ttData.nodes[current_node.id].sessions).length,
    savedSession: ttData.nodes[current_node.id].sessions[pastSessionId]
  });

  console.log('[SESSION END] Verifying in ttData.nodes directly:',
    ttData.nodes[current_node.id].sessions[pastSessionId]);

  // Queue session and node updates for sync
  synchQueue.add("update", "node_session", pastSessionId, current_node.id);
  synchQueue.add("update", "node", current_node.id, current_node.parentId);

  console.log('[SESSION END] After sync queue, sessions still there?',
    ttData.nodes[current_node.id].sessions[pastSessionId]);

  current_session = '';
  delete localStorage.ttSessionId;
  if (nativeBridge.ready) nativeBridge.persist();

  console.log('[SESSION END] After clearing current_session, sessions still in ttData?',
    ttData.nodes[current_node.id].sessions[pastSessionId]);

  console.log('[SESSION END] About to call ttSave()');
  console.log('[SESSION END] Final check - ttData.nodes[current_node.id].sessions:',
    ttData.nodes[current_node.id].sessions);
  ttSave();
  console.log('[SESSION END] ttSave() completed');

  gebi('active-session').style.display = 'none';
  document.title = 'Taakl';

  var edit_button = '<form style="display:inline"><a class="button" onClick="showGeneralEditForm(\'session\',\'' + pastSessionId + '\')">Edit session</a></form>';
  setFeedback('Session Ended. Duration was ' + currentDuration + task_complete_feedback + edit_button, feedback_class);

  treeView.update();

  emitEvent('session', 'ended');

  if (getSetting("auto_synch") == "yes" && isLoggedIn()) {
    synchToServer();
  }
}


/* ################################ ANALYZE VIEW ################################ */

// State
analyze.preset = 'week';
analyze.dateRange = { start: '', end: '' };
analyze.drillPath = [];
analyze.activeTab = 'overview';
analyze.timelineZoom = 1;
analyze.sessions = [];
analyze.aggregated = [];
analyze.chartInstance = null;
analyze.startPicker = null;
analyze.endPicker = null;

// Color palette for nodes (muted, deterministic)
analyze.colorPalette = [
  '#5b8c85', '#7a6c5d', '#8b7355', '#6b8e9f', '#9b8b7a',
  '#7d9b84', '#8e7f6d', '#6a8b7a', '#8b9b6b', '#7b8a9a'
];

/**
 * Get date range from preset
 */
analyze.getDateRange = function(preset) {
  var now = moment();
  var start, end;

  switch (preset) {
    case 'today':
      start = now.clone().startOf('day');
      end = now.clone().endOf('day');
      break;
    case 'yesterday':
      start = now.clone().subtract(1, 'day').startOf('day');
      end = now.clone().subtract(1, 'day').endOf('day');
      break;
    case 'week':
      start = now.clone().startOf('isoWeek');
      end = now.clone();
      break;
    case 'lastweek':
      start = now.clone().subtract(1, 'week').startOf('isoWeek');
      end = now.clone().subtract(1, 'week').endOf('isoWeek');
      break;
    case 'month':
      start = now.clone().startOf('month');
      end = now.clone();
      break;
    case 'lastmonth':
      start = now.clone().subtract(1, 'month').startOf('month');
      end = now.clone().subtract(1, 'month').endOf('month');
      break;
    case 'custom':
      return analyze.dateRange;
    default:
      start = now.clone().startOf('isoWeek');
      end = now.clone();
  }

  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD')
  };
};

/**
 * Get all sessions within date range
 */
analyze.getSessionsInRange = function(start, end) {
  var sessions = [];
  var startBound = start + ' 00:00:00';
  var endBound = end + ' 23:59:59';
  var allNodes = ttData.nodes || {};

  for (var nodeId in allNodes) {
    var node = allNodes[nodeId];
    if (!node.sessions) continue;

    var path = getNodePath(nodeId);

    for (var sesId in node.sessions) {
      var ses = node.sessions[sesId];
      if (!ses.start_time || !ses.end_time) continue;
      if (ses.start_time < startBound || ses.start_time > endBound) continue;

      var durationSecs = timeDiffSecsFromString(ses.start_time, ses.end_time);

      sessions.push({
        id: sesId,
        taskId: nodeId,
        taskName: node.name,
        start_time: ses.start_time,
        end_time: ses.end_time,
        durationSecs: durationSecs,
        path: path
      });
    }
  }

  return sessions;
};

/**
 * Find immediate child of parentId in a path
 */
analyze.findChildAtLevel = function(path, parentId) {
  if (parentId === null) {
    return path[0] ? path[0].id : null;
  }

  for (var i = 0; i < path.length; i++) {
    if (path[i].id === parentId && path[i + 1]) {
      return path[i + 1].id;
    }
  }

  return null;
};

/**
 * Aggregate sessions by immediate children of parentId
 */
analyze.aggregateByLevel = function(sessions, parentId) {
  var groups = {};

  for (var i = 0; i < sessions.length; i++) {
    var ses = sessions[i];
    var childId = analyze.findChildAtLevel(ses.path, parentId);

    if (!childId) continue;

    if (!groups[childId]) {
      var node = getNode(childId);
      groups[childId] = {
        nodeId: childId,
        nodeName: node ? node.name : 'Unknown',
        totalSecs: 0,
        sessionCount: 0,
        sessions: [],
        isLeaf: nodeIsTask(childId)
      };
    }

    groups[childId].totalSecs += ses.durationSecs;
    groups[childId].sessionCount++;
    groups[childId].sessions.push(ses);
  }

  var result = [];
  for (var id in groups) {
    result.push(groups[id]);
  }

  result.sort(function(a, b) {
    return b.totalSecs - a.totalSecs;
  });

  return result;
};

/**
 * Get current parent ID from drill path
 */
analyze.getCurrentParentId = function() {
  if (analyze.drillPath.length === 0) return null;
  return analyze.drillPath[analyze.drillPath.length - 1];
};

/**
 * Get deterministic color for node ID
 */
analyze.getNodeColor = function(nodeId) {
  var hash = 0;
  for (var i = 0; i < nodeId.length; i++) {
    hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
    hash = hash & hash;
  }
  var idx = Math.abs(hash) % analyze.colorPalette.length;
  return analyze.colorPalette[idx];
};

/**
 * Format seconds as "Xh Ym"
 */
analyze.formatDuration = function(secs) {
  var hours = Math.floor(secs / 3600);
  var mins = Math.floor((secs % 3600) / 60);
  if (hours > 0) {
    return hours + 'h ' + mins + 'm';
  }
  return mins + 'm';
};

/**
 * Show the analyze view
 */
analyze.show = function() {
  analyze.preset = 'week';
  analyze.drillPath = [];
  analyze.activeTab = 'overview';
  analyze.timelineZoom = 1;

  analyze.initPickers();
  analyze.bindEvents();

  addEventWatcher('task', 'updated', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('task', 'added', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('task', 'deleted', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('server', 'synch', function() { analyze.refresh(); }, 'analyze');

  analyze.refresh();
};

/**
 * Hide the analyze view
 */
analyze.hide = function() {
  removeEventWatchers('analyze');
  if (analyze.chartInstance) {
    analyze.chartInstance.destroy();
    analyze.chartInstance = null;
  }
};

/**
 * Update the analyze view
 */
analyze.update = function() {
  analyze.refresh();
};

/**
 * Initialize Pikaday pickers
 */
analyze.initPickers = function() {
  var startField = gebi('analyze-start-date');
  var endField = gebi('analyze-end-date');

  if (startField && !analyze.startPicker) {
    analyze.startPicker = new Pikaday({
      field: startField,
      format: 'YYYY-MM-DD',
      onSelect: function() {
        analyze.setCustomDates();
      }
    });
  }

  if (endField && !analyze.endPicker) {
    analyze.endPicker = new Pikaday({
      field: endField,
      format: 'YYYY-MM-DD',
      onSelect: function() {
        analyze.setCustomDates();
      }
    });
  }
};

/**
 * Bind click events
 */
analyze.bindEvents = function() {
  var rangeBar = gebi('analyze-range-bar');
  if (rangeBar) {
    rangeBar.onclick = function(e) {
      if (e.target.classList.contains('range-btn')) {
        analyze.setPreset(e.target.dataset.preset);
      }
    };
  }

  var tabs = gebi('analyze-tabs');
  if (tabs) {
    tabs.onclick = function(e) {
      if (e.target.classList.contains('analyze-tab')) {
        analyze.setTab(e.target.dataset.tab);
      }
    };
  }
};

/**
 * Set time range preset
 */
analyze.setPreset = function(preset) {
  analyze.preset = preset;

  var buttons = document.querySelectorAll('#analyze-range-bar .range-btn');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].dataset.preset === preset);
  }

  var customDates = gebi('analyze-custom-dates');
  if (customDates) {
    customDates.style.display = preset === 'custom' ? 'flex' : 'none';
  }

  if (preset !== 'custom') {
    analyze.dateRange = analyze.getDateRange(preset);
  }

  analyze.drillPath = [];
  analyze.refresh();
};

/**
 * Set custom dates from picker inputs
 */
analyze.setCustomDates = function() {
  var startField = gebi('analyze-start-date');
  var endField = gebi('analyze-end-date');

  if (startField && endField && startField.value && endField.value) {
    analyze.dateRange = {
      start: startField.value,
      end: endField.value
    };
    analyze.refresh();
  }
};

/**
 * Drill into a node
 */
analyze.drillInto = function(nodeId) {
  if (!nodeId) return;
  analyze.drillPath.push(nodeId);
  analyze.refresh();
};

/**
 * Drill to a specific level
 */
analyze.drillTo = function(level) {
  analyze.drillPath = analyze.drillPath.slice(0, level);
  analyze.refresh();
};

/**
 * Handle dropdown change
 */
analyze.onDropdownChange = function(level, nodeId) {
  analyze.drillPath = analyze.drillPath.slice(0, level);
  if (nodeId !== 'all') {
    analyze.drillPath.push(nodeId);
  }
  analyze.refresh();
};

/**
 * Set active tab
 */
analyze.setTab = function(tab) {
  analyze.activeTab = tab;

  var tabs = document.querySelectorAll('#analyze-tabs .analyze-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].dataset.tab === tab);
  }

  var overview = gebi('analyze-overview');
  var timeline = gebi('analyze-timeline');

  if (overview) overview.style.display = tab === 'overview' ? 'block' : 'none';
  if (timeline) timeline.style.display = tab === 'timeline' ? 'block' : 'none';

  analyze.renderActiveTab();
};

/**
 * Render breadcrumb navigation
 */
analyze.renderBreadcrumb = function() {
  var container = gebi('analyze-breadcrumb');
  if (!container) return;

  var html = '<span class="breadcrumb-item" onclick="analyze.drillTo(0)">All</span>';

  for (var i = 0; i < analyze.drillPath.length; i++) {
    var node = getNode(analyze.drillPath[i]);
    var name = node ? node.name : 'Unknown';
    html += ' <span class="breadcrumb-sep">&gt;</span> ';
    html += '<span class="breadcrumb-item" onclick="analyze.drillTo(' + (i + 1) + ')">' + name + '</span>';
  }

  container.innerHTML = html;
};

/**
 * Render cascading dropdown selectors
 */
analyze.renderDropdowns = function() {
  var container = gebi('analyze-dropdowns');
  if (!container) return;

  var html = '';
  var parentId = null;

  for (var level = 0; level <= analyze.drillPath.length; level++) {
    var children = getNodeChildren(parentId);
    var nonLeafChildren = children.filter(function(c) { return !nodeIsTask(c.id); });

    if (nonLeafChildren.length === 0 && level > 0) break;

    var selectedId = analyze.drillPath[level] || 'all';

    html += '<select class="analyze-dropdown" onchange="analyze.onDropdownChange(' + level + ', this.value)">';
    html += '<option value="all"' + (selectedId === 'all' ? ' selected' : '') + '>All</option>';

    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var selected = child.id === selectedId ? ' selected' : '';
      html += '<option value="' + child.id + '"' + selected + '>' + child.name + '</option>';
    }

    html += '</select>';

    if (analyze.drillPath[level]) {
      parentId = analyze.drillPath[level];
    } else {
      break;
    }
  }

  container.innerHTML = html;
};

/**
 * Render summary line
 */
analyze.renderSummary = function() {
  var container = gebi('analyze-summary');
  if (!container) return;

  var totalSecs = 0;
  for (var i = 0; i < analyze.aggregated.length; i++) {
    totalSecs += analyze.aggregated[i].totalSecs;
  }

  var itemCount = analyze.aggregated.length;
  var timeStr = analyze.formatDuration(totalSecs);

  container.innerHTML = timeStr + ' tracked across ' + itemCount + ' item' + (itemCount !== 1 ? 's' : '');
};

/**
 * Master refresh function
 */
analyze.refresh = function() {
  if (analyze.preset !== 'custom') {
    analyze.dateRange = analyze.getDateRange(analyze.preset);
  }

  analyze.sessions = analyze.getSessionsInRange(analyze.dateRange.start, analyze.dateRange.end);
  analyze.aggregated = analyze.aggregateByLevel(analyze.sessions, analyze.getCurrentParentId());

  analyze.renderBreadcrumb();
  analyze.renderDropdowns();
  analyze.renderSummary();

  var noData = gebi('analyze-no-data');
  var overview = gebi('analyze-overview');
  var timeline = gebi('analyze-timeline');
  var tabs = gebi('analyze-tabs');

  if (analyze.aggregated.length === 0) {
    if (noData) noData.style.display = 'block';
    if (overview) overview.style.display = 'none';
    if (timeline) timeline.style.display = 'none';
    if (tabs) tabs.style.display = 'none';
  } else {
    if (noData) noData.style.display = 'none';
    if (tabs) tabs.style.display = 'flex';
    analyze.renderActiveTab();
  }
};

/**
 * Render the currently active tab
 */
analyze.renderActiveTab = function() {
  if (analyze.activeTab === 'overview') {
    analyze.renderOverviewChart();
    analyze.renderOverviewTable();
    var overview = gebi('analyze-overview');
    if (overview) overview.style.display = 'block';
    var timeline = gebi('analyze-timeline');
    if (timeline) timeline.style.display = 'none';
  } else if (analyze.activeTab === 'timeline') {
    analyze.renderTimeline();
    var overview = gebi('analyze-overview');
    if (overview) overview.style.display = 'none';
    var timeline = gebi('analyze-timeline');
    if (timeline) timeline.style.display = 'block';
  }
};

/**
 * Render horizontal bar chart
 */
analyze.renderOverviewChart = function() {
  var canvas = gebi('analyze-chart-canvas');
  if (!canvas) return;

  if (analyze.chartInstance) {
    analyze.chartInstance.destroy();
    analyze.chartInstance = null;
  }

  var labels = [];
  var data = [];
  var colors = [];
  var nodeIds = [];

  for (var i = 0; i < analyze.aggregated.length; i++) {
    var item = analyze.aggregated[i];
    labels.push(item.nodeName);
    data.push(Math.round(item.totalSecs / 60));
    colors.push(analyze.getNodeColor(item.nodeId));
    nodeIds.push(item.nodeId);
  }

  var ctx = canvas.getContext('2d');
  analyze.chartInstance = new Chart(ctx, {
    type: 'horizontalBar',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      legend: { display: false },
      scales: {
        xAxes: [{
          ticks: {
            beginAtZero: true,
            callback: function(value) {
              var hours = Math.floor(value / 60);
              var mins = value % 60;
              if (hours > 0) return hours + 'h ' + mins + 'm';
              return mins + 'm';
            }
          }
        }]
      },
      onClick: function(evt) {
        var activePoints = analyze.chartInstance.getElementsAtEvent(evt);
        if (activePoints.length > 0) {
          var idx = activePoints[0]._index;
          var nodeId = nodeIds[idx];
          var item = analyze.aggregated[idx];
          if (!item.isLeaf) {
            analyze.drillInto(nodeId);
          }
        }
      },
      tooltips: {
        callbacks: {
          label: function(tooltipItem) {
            return analyze.formatDuration(tooltipItem.xLabel * 60);
          }
        }
      }
    }
  });
};

/**
 * Render overview table
 */
analyze.renderOverviewTable = function() {
  var container = gebi('analyze-table-container');
  if (!container) return;

  var totalSecs = 0;
  for (var i = 0; i < analyze.aggregated.length; i++) {
    totalSecs += analyze.aggregated[i].totalSecs;
  }

  var html = '<table class="analyze-table"><thead><tr><th>Name</th><th>Time</th><th>%</th></tr></thead><tbody>';

  for (var i = 0; i < analyze.aggregated.length; i++) {
    var item = analyze.aggregated[i];
    var pct = totalSecs > 0 ? Math.round((item.totalSecs / totalSecs) * 100) : 0;
    var clickable = !item.isLeaf ? ' class="clickable" onclick="analyze.drillInto(\'' + item.nodeId + '\')"' : '';

    html += '<tr' + clickable + '>';
    html += '<td>' + item.nodeName + '</td>';
    html += '<td>' + analyze.formatDuration(item.totalSecs) + '</td>';
    html += '<td>' + pct + '%</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  container.innerHTML = html;
};

/**
 * Render timeline view
 */
analyze.renderTimeline = function() {
  var container = gebi('analyze-timeline-content');
  if (!container) return;

  if (analyze.sessions.length === 0) {
    container.innerHTML = '<div class="timeline-empty">No sessions to display</div>';
    return;
  }

  var startMoment = moment(analyze.dateRange.start + ' 00:00:00');
  var endMoment = moment(analyze.dateRange.end + ' 23:59:59');
  var totalHours = endMoment.diff(startMoment, 'hours') + 1;

  var pixelsPerHour = 30 * analyze.timelineZoom;
  var contentWidth = pixelsPerHour * totalHours;
  var labelWidth = 120;

  var html = '<div class="timeline-header" style="margin-left: ' + labelWidth + 'px; width: ' + contentWidth + 'px;">';
  html += analyze.renderTimeAxis(startMoment, totalHours, pixelsPerHour);
  html += '</div>';

  html += '<div class="timeline-body">';

  for (var i = 0; i < analyze.aggregated.length; i++) {
    var item = analyze.aggregated[i];
    var color = analyze.getNodeColor(item.nodeId);
    var clickable = !item.isLeaf ? ' onclick="analyze.drillInto(\'' + item.nodeId + '\')"' : '';
    var clickableClass = !item.isLeaf ? ' clickable' : '';

    html += '<div class="timeline-row">';
    html += '<div class="timeline-label' + clickableClass + '"' + clickable + '>' + item.nodeName + '</div>';
    html += '<div class="timeline-track" style="width: ' + contentWidth + 'px;">';

    for (var j = 0; j < item.sessions.length; j++) {
      var ses = item.sessions[j];
      var sesStart = moment(ses.start_time);
      var sesEnd = moment(ses.end_time);

      var offsetHours = sesStart.diff(startMoment, 'hours', true);
      var durationHours = sesEnd.diff(sesStart, 'hours', true);

      var left = offsetHours * pixelsPerHour;
      var width = Math.max(durationHours * pixelsPerHour, 3);

      html += '<div class="timeline-block" style="left: ' + left + 'px; width: ' + width + 'px; background-color: ' + color + ';" ';
      html += 'title="' + ses.taskName + ': ' + analyze.formatDuration(ses.durationSecs) + '"></div>';
    }

    html += '</div></div>';
  }

  html += '</div>';

  container.innerHTML = html;
};

/**
 * Render time axis for timeline
 */
analyze.renderTimeAxis = function(startMoment, totalHours, pixelsPerHour) {
  var html = '';
  var interval = 6;
  if (totalHours <= 24) interval = 1;
  else if (totalHours <= 72) interval = 3;
  else if (totalHours <= 168) interval = 6;
  else interval = 24;

  for (var h = 0; h < totalHours; h += interval) {
    var m = startMoment.clone().add(h, 'hours');
    var label = interval >= 24 ? m.format('MMM D') : m.format('HH:mm');
    var left = h * pixelsPerHour;

    html += '<div class="timeline-tick" style="left: ' + left + 'px;">' + label + '</div>';
  }

  return html;
};

/**
 * Zoom timeline in
 */
analyze.zoomIn = function() {
  if (analyze.timelineZoom < 10) {
    analyze.timelineZoom *= 1.5;
    analyze.renderTimeline();
  }
};

/**
 * Zoom timeline out
 */
analyze.zoomOut = function() {
  if (analyze.timelineZoom > 1) {
    analyze.timelineZoom /= 1.5;
    if (analyze.timelineZoom < 1) analyze.timelineZoom = 1;
    analyze.renderTimeline();
  }
};


/* ###################### SETTINGS VIEW ############################## */


settingsView.show = function(){

  dbg("settings",ttData.settings);

  if(ttData.settings.length != defaultSettings.length){
      for (key in defaultSettings){
        if(!ttData.settings[key]){
           ttData.settings[key] = defaultSettings[key]
        }
      }
  }

  var templateData = [];

  /* This is a really annoying hack, because the .outerHTML doesn't include voodoo like the current value
  of <select> elements, so we can't spit the inputs into the template as strings; template gets filled with placehoder divs,
  which then get replaced. Ew */

  var inputs = {};

  for(field in editFields.settings){



       inputs[field] = makeFormInput(editFields.settings[field].type,{
         "value":ttData.settings[field],
         "id": "settings-"+field+"input",
         "options" : editFields.settings[field].options
       });

       var templateRow = {
       label: editFields.settings[field].label,
       input: '<div id="settings-'+field+'-input-placeholder"></div>'
     };

     templateData.push(templateRow);

  }


  template(templateData,"settings-item-template");

  // Hack continues...
  for(field in editFields.settings){
    var phDiv = gebi('settings-'+field+'-input-placeholder');
    phDiv.parentNode.replaceChild(inputs[field], phDiv);
  }

  // Update account status section
  var accountStatus = gebi('settings-account-status');
  if (accountStatus) {
    if (isLoggedIn() && ttData.userName) {
      accountStatus.innerHTML = '<p>Logged in as <strong>' + ttData.userName + '</strong></p>' +
        '<a href="#void" onClick="doLogout()" class="button">Logout</a>';
    } else {
      accountStatus.innerHTML = '<p>Not logged in</p>' +
        '<a href="#void" onClick="showAuthModal(\'login\')" class="button">Login</a> ' +
        '<a href="#void" onClick="showAuthModal(\'register\')" class="button">Create Account</a>';
    }
  }


  // Load AIDA settings if the function exists
  if (typeof aidaChat.loadSettings === 'function') {
    aidaChat.loadSettings();
  }

}


settingsView.hide = function(){
}

settingsView.save = function(){

  for(field in editFields.settings){
     ttData.settings[field] = gebi("settings-"+field+"input").value;
  }

  dbg("Settings after save",ttData.settings);
  ttSave();
  setFeedback('Settings updated');
}


/* ################################ TODAY VIEW ################################ */

todayView.show = function(){
  // Initialize task containers
  todayView.morningTasks = [];
  todayView.starredTasks = [];
  todayView.eveningTasks = [];

  // Register event watchers
  addEventWatcher('task', 'updated', function(){
    todayView.update();
  }, 'todayView');

  addEventWatcher('task', 'added', function(){
    todayView.update();
  }, 'todayView');

  addEventWatcher('task', 'deleted', function(){
    todayView.update();
  }, 'todayView');

  addEventWatcher('server', 'synch', function(){
    todayView.update();
  }, 'todayView');

  todayFolderAc.reset();

  todayView.update();
};

todayView.hide = function(){
  removeEventWatchers('todayView');
};

todayView.filter = function(){
  todayView.morningTasks = [];
  todayView.starredTasks = [];
  todayView.eveningTasks = [];

  // Track task IDs already categorized to avoid duplicates
  var categorizedIds = {};

  var allTasks = getAllTaskNodes();

  var today = moment().subtract(3, 'hours').format('YYYY-MM-DD');

  for (var i = 0; i < allTasks.length; i++) {
    var task = allTasks[i];

    // Skip completed tasks unless completed today
    if (task.status === 'completed') {
      var ca = task.completed_at;
      if (!Array.isArray(ca) || ca.length === 0) continue;
      var lastDone = moment(ca[ca.length - 1]).subtract(3, 'hours').format('YYYY-MM-DD');
      if (lastDone !== today) continue;
    }

    // Add metadata for display
    task.truncateName = truncate(task.name, 55);

    // Build path for display
    var path = getNodePath(task.id);
    if (path.length > 1) {
      var pathNames = [];
      for (var p = 0; p < path.length - 1; p++) {
        pathNames.push(path[p].name);
      }
      task.metaParentage = '<span>' + escapeHtml(pathNames.join(' > ')) + '</span>';
    } else {
      task.metaParentage = '';
    }

    // Calculate time and estimate
    task.time = calculateNodeTime(task.id);
    task.metaPrettyTime = (task.time > 0) ? ' | ' + prettyTime(task.time) : '';
    task.metaEstimate = (task.estimate > 0) ? ' | est ' + prettyTime(task.estimate) : '';

    // Check for morning tasks (#daily + #morning in name)
    if (taskHasTags(task, ['daily', 'morning'])) {
      todayView.morningTasks.push(task);
      categorizedIds[task.id] = true;
      continue;
    }

    // Check for evening tasks (#daily + #evening in name)
    if (taskHasTags(task, ['daily', 'evening'])) {
      todayView.eveningTasks.push(task);
      categorizedIds[task.id] = true;
      continue;
    }

    // Check for starred tasks (not already categorized)
    if (task.starred === '1' && !categorizedIds[task.id]) {
      todayView.starredTasks.push(task);
      categorizedIds[task.id] = true;
    }
  }
};

todayView.createTaskElement = function(task){
  var taskDiv = document.createElement("div");
  taskDiv.className = "today-task-item" + (task.status === "completed" ? " today-task-completed" : "");
  taskDiv.setAttribute("data-task-id", task.id);

  // Checkbox for completion
  var checkedAttr = (task.status == "completed") ? "checked" : "";
  var checkCompleted = "<input type='checkbox' class='task-checkbox' " +
    checkedAttr + " onchange=\"todayView.toggleNodeComplete('" + task.id + "', this)\" />";

  // Star icon
  var starClass = (task.starred == "1") ? "starred" : "";
  var starIcon = "<i class='fa fa-star task-star " + starClass +
    "' onclick=\"todayView.toggleNodeStar('" + task.id + "')\"></i>";

  // Play button
  var playIcon = "<i onclick=\"treeView.startSession('" + task.id + "')\" style='cursor:pointer; color:#77aa88;' class='fa fa-play-circle fa-lg'></i>";

  // Edit handler
  var editHandler = "treeView.showEditForm('" + task.id + "')";

  taskDiv.innerHTML =
    "<div class='today-task-content' ondblclick=\"" + editHandler + "\">" +
      "<div class='today-task-main'>" +
        checkCompleted + " " + starIcon + " " + escapeHtml(task.truncateName) +
        "<span class='task-meta'>" + task.metaParentage + task.metaPrettyTime + (task.metaEstimate || '') + "</span>" +
      "</div>" +
      "<div class='today-task-actions'>" + playIcon + "</div>" +
    "</div>";

  return taskDiv;
};

// Helper functions for today view node operations
todayView.toggleNodeComplete = function(nodeId, checkbox) {
  var node = getNode(nodeId);
  if (!node) return;

  node.status = checkbox.checked ? 'completed' : 'inProcess';
  if (checkbox.checked) { recordCompletion(node); } else { undoCompletion(node); }
  ttSave();
  todayView.update();
  emitEvent('node', 'updated', nodeId);
};

todayView.toggleNodeStar = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  node.starred = node.starred === '1' ? '0' : '1';
  ttSave();
  todayView.update();
  emitEvent('node', 'updated', nodeId);
};

todayView.getSectionTotals = function(tasks) {
  var estimate = 0;
  var logged = 0;
  for (var i = 0; i < tasks.length; i++) {
    if (tasks[i].status !== 'completed' && tasks[i].estimate > 0) {
      estimate += tasks[i].estimate;
    }
    if (tasks[i].time > 0) {
      logged += tasks[i].time;
    }
  }
  return { estimate: estimate, logged: logged };
};

todayView.formatSectionTotals = function(totals) {
  var parts = [];
  if (totals.estimate > 0) {
    parts.push("est " + prettyTime(totals.estimate));
  }
  if (totals.logged > 0) {
    parts.push("logged " + prettyTime(totals.logged));
  }
  return parts.join(" | ");
};

todayView.refresh = function(){
  var morningContainer = gebi("today-morning-tasks");
  var starredContainer = gebi("today-starred-tasks");
  var eveningContainer = gebi("today-evening-tasks");
  var noTasksMsg = gebi("today-no-tasks");

  // Clear containers
  morningContainer.innerHTML = "";
  starredContainer.innerHTML = "";
  eveningContainer.innerHTML = "";

  // Apply saved starred order
  todayView.applyStarredOrder();

  // Render morning tasks
  todayView.morningTasks.forEach(function(task){
    morningContainer.appendChild(todayView.createTaskElement(task));
  });

  // Render starred tasks with drag-and-drop
  todayView.starredTasks.forEach(function(task){
    var el = todayView.createTaskElement(task);
    todayView.addDragHandlers(el, task.id, starredContainer);
    starredContainer.appendChild(el);
  });

  // Render evening tasks
  todayView.eveningTasks.forEach(function(task){
    eveningContainer.appendChild(todayView.createTaskElement(task));
  });

  // Update section totals
  var morningTotals = todayView.getSectionTotals(todayView.morningTasks);
  gebi("today-morning-totals").innerHTML = todayView.formatSectionTotals(morningTotals);
  var starredTotals = todayView.getSectionTotals(todayView.starredTasks);
  gebi("today-starred-totals").innerHTML = todayView.formatSectionTotals(starredTotals);
  var eveningTotals = todayView.getSectionTotals(todayView.eveningTasks);
  gebi("today-evening-totals").innerHTML = todayView.formatSectionTotals(eveningTotals);

  // Show/hide sections based on content
  gebi("today-morning-section").style.display =
    todayView.morningTasks.length > 0 ? "block" : "none";
  gebi("today-starred-section").style.display =
    todayView.starredTasks.length > 0 ? "block" : "none";
  gebi("today-evening-section").style.display =
    todayView.eveningTasks.length > 0 ? "block" : "none";

  // Show "no tasks" message if all sections empty
  var totalTasks = todayView.morningTasks.length +
                   todayView.starredTasks.length +
                   todayView.eveningTasks.length;
  noTasksMsg.style.display = (totalTasks === 0) ? "block" : "none";
};

// --- Starred section ordering ---

todayView.getStarredOrder = function() {
  try {
    return JSON.parse(localStorage.todayStarredOrder || '[]');
  } catch(e) { return []; }
};

todayView.saveStarredOrder = function() {
  var order = todayView.starredTasks.map(function(t) { return t.id; });
  localStorage.todayStarredOrder = JSON.stringify(order);
  if (nativeBridge.ready) nativeBridge.persist();
};

todayView.applyStarredOrder = function() {
  var savedOrder = todayView.getStarredOrder();
  if (savedOrder.length === 0) return;

  // Build a map of current starred tasks
  var taskMap = {};
  todayView.starredTasks.forEach(function(t) { taskMap[t.id] = t; });

  var ordered = [];
  // First add tasks in saved order (if they still exist in starred)
  savedOrder.forEach(function(id) {
    if (taskMap[id]) {
      ordered.push(taskMap[id]);
      delete taskMap[id];
    }
  });
  // Then append any new starred tasks not in saved order
  for (var id in taskMap) {
    ordered.push(taskMap[id]);
  }

  todayView.starredTasks = ordered;
};

// --- Starred drag and drop ---
todayView.dragState = null;

todayView.addDragHandlers = function(el, taskId, container) {
  el.setAttribute('draggable', 'true');
  el.style.cursor = 'grab';

  el.ondragstart = function(e) {
    todayView.dragState = { taskId: taskId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    setTimeout(function() { el.classList.add('today-dragging'); }, 0);
  };

  el.ondragend = function() {
    el.classList.remove('today-dragging');
    todayView.dragClearIndicators(container);
    todayView.dragState = null;
  };

  el.ondragover = function(e) {
    if (!todayView.dragState) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    todayView.dragClearIndicators(container);

    var rect = el.getBoundingClientRect();
    var y = e.clientY - rect.top;
    if (y < rect.height / 2) {
      el.classList.add('today-drop-above');
    } else {
      el.classList.add('today-drop-below');
    }
  };

  el.ondragleave = function(e) {
    if (!el.contains(e.relatedTarget)) {
      el.classList.remove('today-drop-above', 'today-drop-below');
    }
  };

  el.ondrop = function(e) {
    e.preventDefault();
    if (!todayView.dragState) return;

    var dragId = todayView.dragState.taskId;
    var dropId = taskId;
    if (dragId === dropId) return;

    var rect = el.getBoundingClientRect();
    var above = (e.clientY - rect.top) < rect.height / 2;

    // Reorder the starredTasks array
    var dragIdx = -1, dropIdx = -1;
    for (var i = 0; i < todayView.starredTasks.length; i++) {
      if (todayView.starredTasks[i].id === dragId) dragIdx = i;
      if (todayView.starredTasks[i].id === dropId) dropIdx = i;
    }
    if (dragIdx === -1 || dropIdx === -1) return;

    var dragged = todayView.starredTasks.splice(dragIdx, 1)[0];
    dropIdx = above
      ? todayView.starredTasks.indexOf(todayView.starredTasks.filter(function(t){ return t.id === dropId; })[0])
      : todayView.starredTasks.indexOf(todayView.starredTasks.filter(function(t){ return t.id === dropId; })[0]) + 1;
    todayView.starredTasks.splice(dropIdx, 0, dragged);

    todayView.saveStarredOrder();
    todayView.dragState = null;
    todayView.refresh();
  };
};

todayView.dragClearIndicators = function(container) {
  var items = container.querySelectorAll('.today-task-item');
  for (var i = 0; i < items.length; i++) {
    items[i].classList.remove('today-drop-above', 'today-drop-below');
  }
};

todayView.update = function(){
  todayView.filter();
  todayView.refresh();
};




/* ########################## Templating Functions (plus misc DOM helpers) ######################### */

/* Clear clones from a template (prior to updating) */
function clearTemplate(templateElId){
   var parent = gebi(templateElId).parentNode;
   var oldItems = parent.getElementsByClassName(templateElId+"-clone");

   while(oldItems.length > 0){
       oldItems[0].parentNode.removeChild(oldItems[0]);
   }
}

/** Main template population function
 *data: array of objects (in which case this function loops itself) or object with property name => value pairs to
 *with which to populate the template */


var template = function selfTemplate (data,templateElId){


   if(data instanceof Array){

      clearTemplate(templateElId);

      for(i= 0; i < data.length; i++){
        selfTemplate(data[i],templateElId);
      }
   }else{

     var template = gebi(templateElId);
     var parent = template.parentNode;
     var code = template.innerHTML;

     templateData = [];

     for(var name in data){
        templateData.push({placeholder: "{{"+name+"}}", value: data[name]})
     }


     var outputEl = template.cloneNode();

     outputEl.innerHTML = fillTemplate(templateData,code);

     /* if data contains an ID field, set the element ID accordingly */
     if(data.id){
        outputEl.id = data.id;
     }

     outputEl.className += " "+templateElId+"-clone";
     if(template.getAttribute("data-clone-display")){
        outputEl.style.display = template.getAttribute("data-clone-display");
     }else{
        outputEl.style.display = null;
     }

     parent.appendChild(outputEl);

   }

}

/* Helper to do the placeholder replacement */

function fillTemplate(data,code){

  for(var pairKey in data){
    var re = new RegExp (data[pairKey].placeholder, 'g');
    code = code.replace(re,data[pairKey].value);
  }
  return code;
}


function makeFormInput(type,attribs){

  dbg("Make form input type",type);
  dbg("Make form input attribs",attribs);

  var inputEl;

  if(type == "boolean"){
    attribs.options = {"no":"No","yes":"Yes"};
    type = "select";
  }

  if(type == "text"){
    inputEl = document.createElement("input");
    inputEl.type = "text";
  }else if(type == "select"){
    inputEl = document.createElement('select');
    for (var optkey in attribs.options){
      var option = new Option(attribs.options[optkey],optkey);
      inputEl.options.add(option);
    }
    inputEl.value = "yes";
    inputEl.selectedIndex = 2;
    inputEl.selected = true;
    if(attribs.value){
      inputEl.value = attribs.value;
    }
  }else if(type == "textarea"){
    inputEl = document.createElement("textarea");
    inputEl.innerHTML = attribs.value || "";
  }

  inputAttributes = ["id","value","name","className","style"];

  for (i = 0; i < inputAttributes.length; i++){

     var item = inputAttributes[i];

     if(attribs[item]){
        inputEl.setAttribute(item,attribs[item]);
     }
  }
  document.body.appendChild(inputEl);
  return inputEl;
}


function addTableHeaders(id,headers){
  table = gebi(id);
  header = table.createTHead();
  row = header.insertRow(0);

  count = 0;

  for(text in headers){
     cell = row.insertCell(count);
     cell.innerHTML = headers[text];
     count += 1;
  }

  table.appendChild(document.createElement('tbody'));

}

function addTableRow(id,data,position){

  position || (position = -1);

  var tbody = gebi(id).getElementsByTagName('tbody')[0];

  row = tbody.insertRow(position);

  count = 0;
  for(item in data){
     cell = row.insertCell(count);
     cell.innerHTML = data[item];
     count += 1;
  }

}



function makeSelectOptions(itemsObj,isForVue,prepend){

  options = [];

  if(prepend){
     options.push(prepend);
  }


  if(typeof itemsObj == "object"){
     if(getMemberCount(itemsObj) > 0){
      for (id in itemsObj){
        if(isForVue){
          option = {text:itemsObj[id].name,value:id};
        }else{
          option = [id,itemsObj[id].name];
        }

        options.push(option);

      }
      return options;
    }else{
      return false;
    }
  }else{
    return false;
  }
}


function updateSelectOptions(target_element,new_options,append){

    if(!append){
       while (target_element.options.length) {
           target_element.remove(0);
       }
    }

    for (var i = 0; i < new_options.length; i++) {
        var opt = new Option(new_options[i][1],new_options[i][0]);
        target_element.options.add(opt);
    }

}


/* ############################ SERVER SYNCHING ############################  */

// Sync queue for tracking changes
var synchQueue = {
  queue: []
};

synchQueue.add = function(action, type, id, parentId) {
  var timestamp = new Date().toISOString().replace('T', ' ').substr(0, 19);
  var change = {
    action: action,
    type: type,
    uuid: id,
    timestamp: timestamp
  };

  if (parentId) {
    change.parentUuid = parentId;
  }

  // Get the data for insert/update
  if (action !== 'delete') {
    change.data = getItemData(type, id);
  }

  synchQueue.queue.push(change);
  ttData.synchQueue = synchQueue.queue;
  dbg("Synch queue", synchQueue);
  ttSave();
};

// Helper to get item data for sync
function getItemData(type, id) {
  if (type === 'node') {
    return getNodeData(id);
  }

  if (type === 'node_session') {
    return getNodeSessionData(id);
  }

  return null;
}

// Helper to get node data for sync (v2 structure)
function getNodeData(id) {
  var node = getNode(id);
  if (!node) return null;

  var data = {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId: node.parentId,
    childOrder: node.childOrder || [],
    collapsed: node.collapsed || false,
    creation_date: node.creation_date || null
  };

  // Include task-specific fields
  if (node.type === 'task') {
    data.status = node.status;
    data.priority = node.priority;
    data.billable = node.billable;
    data.estimate = node.estimate;
    data.due = node.due;
    data.starred = node.starred;
    data.notes = node.notes;
    data.sessions = node.sessions || {};
    data.completed_at = node.completed_at || [];
  }

  return data;
}

// Helper to get node session data for sync (v2 structure)
function getNodeSessionData(sessionId) {
  // Search all nodes for the session
  if (!ttData.nodes) return null;

  for (var nodeId in ttData.nodes) {
    var node = ttData.nodes[nodeId];
    if (node.sessions && node.sessions[sessionId]) {
      var session = node.sessions[sessionId];
      return {
        id: session.id,
        start_time: session.start_time,
        end_time: session.end_time || null,
        notes: session.notes || ''
      };
    }
  }

  return null;
}

function synchIconStatus(status) {
  var icon = gebi("synch-icon");
  if (!icon) return;

  if (status == "synching") {
    icon.className = "fa fa-refresh fa-lg fa-spin fa-flip-horizontal";
    icon.style.color = "#669366";
  } else if (status == "error") {
    icon.className = "fa fa-refresh fa-lg";
    icon.style.color = "red";
  } else if (status == "normal") {
    icon.className = "fa fa-refresh fa-lg";
    icon.style.color = "";
  } else if (status == "bulge") {
    icon.className = "fa fa-refresh fa-2x";
    setTimeout(function() {
      synchIconStatus("normal");
    }, 200);
  } else if (status == "done") {
    icon.className = "fa fa-refresh fa-lg";
    icon.style.color = "green";
    setTimeout(function() {
      synchIconStatus("normal");
    }, 3000);
  }
}

// Main sync function
function synchToServer() {
  if (!isLoggedIn()) {
    showAuthModal('login');
    return;
  }

  // Check if we have local changes
  var hasLocalChanges = (ttData.synchQueue && ttData.synchQueue.length > 0) ||
                        (synchQueue.queue && synchQueue.queue.length > 0);

  // If there are local changes, use incremental sync to avoid overwriting server data
  if (hasLocalChanges) {
    console.log('[SYNC] Has local changes, using incremental sync');
    synchIncremental();
    return;
  }

  // No local changes - safe to do full download from server
  console.log('[SYNC] No local changes, downloading from server');
  synchFromServer();
}

// Download data from server
function synchFromServer() {
  if (!isLoggedIn()) {
    setFeedback('Please login to sync', 'error');
    synchIconStatus("error");
    return;
  }

  setFeedback('Synching from server...');
  synchIconStatus("synching");

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.syncFull,
    type: 'GET',
    cache: false,  // Prevent browser caching of sync data
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + authToken },
    success: function(result) {
      console.log('[SYNC] Download success:', result);

      if (result.success && result.ttData) {
        var serverData = result.ttData;

        // Preserve local auth info
        serverData.userKey = ttData.userKey;
        serverData.userName = ttData.userName;
        serverData.synchQueue = [];
        serverData.lastSyncTime = new Date().toISOString().replace('T', ' ').substr(0, 19);

        // Ensure settings exist
        if (!serverData.settings) {
          serverData.settings = defaultSettings;
        }

        // Ensure v2 data structure fields exist
        if (!serverData.dataVersion) {
          serverData.dataVersion = 2;
        }
        if (!serverData.nodes) {
          serverData.nodes = {};
        }
        if (!serverData.rootOrder) {
          serverData.rootOrder = [];
        }

        // Preserve local rootOrder through full sync
        var localRootOrder = ttData.rootOrder || [];

        ttData = serverData;

        // Merge: preserve local ordering, incorporate server additions/deletions
        ttData.rootOrder = mergeRootOrder(localRootOrder, serverData.rootOrder, ttData.nodes);

        ttSave();
        setFeedback('Data successfully synced from server.');
        synchIconStatus("done");
        emitEvent('server', 'synch');

      } else {
        setFeedback('Sync completed (no server data)', 'notice');
        synchIconStatus("done");
      }
    },
    error: function(xhr, ajaxOptions, thrownError) {
      console.log('[SYNC] Download error:', xhr.status, thrownError);
      if (xhr.status === 401) {
        setFeedback('Session expired. Please login again.', 'error');
        authToken = null;
        delete localStorage.authToken;
        if (nativeBridge.ready) nativeBridge.persist();
        updateAuthUI();
      } else {
        setFeedback('Error synching from server: ' + thrownError, 'error');
      }
      synchIconStatus("error");
    }
  });
}

// Incremental sync - sends only queued changes
function synchIncremental() {
  if (!isLoggedIn()) {
    setFeedback('Please login to sync', 'error');
    return;
  }

  if (!synchQueue.queue || synchQueue.queue.length === 0) {
    console.log('[SYNC] No changes to sync');
    synchFromServer(); // Still fetch updates
    return;
  }

  synchIconStatus("synching");
  console.log('[SYNC] Incremental sync with', synchQueue.queue.length, 'changes');

  var syncData = {
    lastSyncTime: ttData.lastSyncTime,
    changes: synchQueue.queue
  };

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.sync,
    type: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + authToken },
    data: JSON.stringify(syncData),
    success: function(result) {
      console.log('[SYNC] Incremental sync result:', result);

      if (result.success) {
        // Update last sync time
        ttData.lastSyncTime = result.serverTime;

        // Clear the queue
        synchQueue.queue = [];
        ttData.synchQueue = [];

        // Apply server changes
        if (result.changes && result.changes.length > 0) {
          applyServerChanges(result.changes);
        }

        // Merge rootOrder: preserve local ordering, incorporate server additions/deletions
        if (result.rootOrder && Array.isArray(result.rootOrder)) {
          ttData.rootOrder = mergeRootOrder(ttData.rootOrder || [], result.rootOrder, ttData.nodes || {});
        }

        ttSave();
        var msg = 'Synced';
        if (result.stats) {
          if (result.stats.accepted > 0) msg += ' (sent ' + result.stats.accepted + ')';
          if (result.stats.returned > 0) msg += ' (received ' + result.stats.returned + ')';
        }
        setFeedback(msg);
        synchIconStatus("done");
        emitEvent('server', 'synch');
      } else {
        setFeedback('Sync error: ' + (result.error || 'Unknown'), 'error');
        synchIconStatus("error");
      }
    },
    error: function(xhr, ajaxOptions, thrownError) {
      if (xhr.status === 401) {
        setFeedback('Session expired. Please login again.', 'error');
        authToken = null;
        delete localStorage.authToken;
        if (nativeBridge.ready) nativeBridge.persist();
        updateAuthUI();
      } else {
        setFeedback('Sync error: ' + thrownError, 'error');
      }
      synchIconStatus("error");
    }
  });
}

function mergeRootOrder(localOrder, serverOrder, nodes) {
  var merged = [];
  var seen = {};

  // Keep local items that still exist (preserves user's ordering)
  for (var i = 0; i < localOrder.length; i++) {
    if (nodes[localOrder[i]]) {
      merged.push(localOrder[i]);
      seen[localOrder[i]] = true;
    }
  }

  // Append server items not in local (new nodes from another device)
  for (var i = 0; i < serverOrder.length; i++) {
    if (!seen[serverOrder[i]] && nodes[serverOrder[i]]) {
      merged.push(serverOrder[i]);
      seen[serverOrder[i]] = true;
    }
  }

  // Safety net: catch any root nodes missing from both orders
  for (var id in nodes) {
    if (nodes[id].parentId === null && !seen[id]) {
      merged.push(id);
    }
  }

  return merged;
}

// Apply changes received from server
function applyServerChanges(changes) {
  for (var i = 0; i < changes.length; i++) {
    var change = changes[i];
    console.log('[SYNC] Applying server change:', change);

    if (change.action === 'delete') {
      deleteItemLocally(change.type, change.uuid);
    } else {
      upsertItemLocally(change.type, change.uuid, change.data, change.parentUuid);
    }
  }
}

// Delete item locally (used by sync)
function deleteItemLocally(type, uuid) {
  if (type === 'node') {
    deleteNodeLocally(uuid);
  } else if (type === 'node_session') {
    deleteNodeSessionLocally(uuid);
  }
}

// Delete node locally (used by sync for v2 structure)
function deleteNodeLocally(uuid) {
  if (!ttData.nodes || !ttData.nodes[uuid]) return;

  var node = ttData.nodes[uuid];

  // Remove from parent's childOrder or rootOrder
  if (node.parentId === null) {
    var idx = ttData.rootOrder.indexOf(uuid);
    if (idx > -1) ttData.rootOrder.splice(idx, 1);
  } else {
    var parent = ttData.nodes[node.parentId];
    if (parent && parent.childOrder) {
      var idx = parent.childOrder.indexOf(uuid);
      if (idx > -1) parent.childOrder.splice(idx, 1);
    }
  }

  delete ttData.nodes[uuid];
}

// Delete node session locally (used by sync for v2 structure)
function deleteNodeSessionLocally(sessionId) {
  if (!ttData.nodes) return;

  for (var nodeId in ttData.nodes) {
    var node = ttData.nodes[nodeId];
    if (node.sessions && node.sessions[sessionId]) {
      delete node.sessions[sessionId];
      return;
    }
  }
}

// Upsert item locally (used by sync)
function upsertItemLocally(type, uuid, data, parentUuid) {
  if (type === 'node') {
    upsertNodeLocally(uuid, data, parentUuid);
  } else if (type === 'node_session' && parentUuid) {
    upsertNodeSessionLocally(uuid, data, parentUuid);
  }
}

// Upsert node locally (used by sync for v2 structure)
function upsertNodeLocally(uuid, data, parentUuid) {
  if (!ttData.nodes) ttData.nodes = {};
  if (!ttData.rootOrder) ttData.rootOrder = [];

  var isNew = !ttData.nodes[uuid];

  if (isNew) {
    ttData.nodes[uuid] = {
      id: uuid,
      childOrder: [],
      sessions: {}
    };
  }

  // Update node properties
  var node = ttData.nodes[uuid];
  if (data.name !== undefined) node.name = data.name;
  if (data.type !== undefined) node.type = data.type;
  if (data.collapsed !== undefined) node.collapsed = data.collapsed;
  if (data.childOrder !== undefined) node.childOrder = data.childOrder;

  // Task-specific fields
  if (data.status !== undefined) node.status = data.status;
  if (data.priority !== undefined) node.priority = data.priority;
  if (data.billable !== undefined) node.billable = data.billable;
  if (data.estimate !== undefined) node.estimate = data.estimate;
  if (data.due !== undefined) node.due = data.due;
  if (data.starred !== undefined) node.starred = data.starred;
  if (data.notes !== undefined) node.notes = data.notes;
  if (data.sessions !== undefined) node.sessions = data.sessions;
  if (data.completed_at !== undefined) node.completed_at = data.completed_at;

  // Handle parent change or new node placement
  var oldParentId = node.parentId;
  var newParentId = parentUuid === undefined ? oldParentId : parentUuid;

  if (isNew || oldParentId !== newParentId) {
    // Remove from old parent
    if (!isNew) {
      if (oldParentId === null) {
        var idx = ttData.rootOrder.indexOf(uuid);
        if (idx > -1) ttData.rootOrder.splice(idx, 1);
      } else if (ttData.nodes[oldParentId]) {
        var oldParent = ttData.nodes[oldParentId];
        if (oldParent.childOrder) {
          var idx = oldParent.childOrder.indexOf(uuid);
          if (idx > -1) oldParent.childOrder.splice(idx, 1);
        }
      }
    }

    // Add to new parent
    node.parentId = newParentId;
    if (newParentId === null) {
      if (ttData.rootOrder.indexOf(uuid) === -1) {
        ttData.rootOrder.push(uuid);
      }
    } else if (ttData.nodes[newParentId]) {
      var newParent = ttData.nodes[newParentId];
      if (!newParent.childOrder) newParent.childOrder = [];
      if (newParent.childOrder.indexOf(uuid) === -1) {
        newParent.childOrder.push(uuid);
      }
    }
  }
}

// Upsert node session locally (used by sync for v2 structure)
function upsertNodeSessionLocally(sessionId, data, nodeId) {
  if (!ttData.nodes || !ttData.nodes[nodeId]) return;

  var node = ttData.nodes[nodeId];
  if (!node.sessions) node.sessions = {};

  if (!node.sessions[sessionId]) {
    node.sessions[sessionId] = { id: sessionId };
  }

  Object.assign(node.sessions[sessionId], data);
}



/* ######################### Data Handling Functions ######################### */

function makeFlatData(){
  flatData = {};

  var allTasks = getAllTaskNodes();

  for (var i = 0; i < allTasks.length; i++) {
    var task = allTasks[i];

    if (task.sessions && getMemberCount(task.sessions) > 0) {
      // Build path for context
      var path = getNodePath(task.id);
      var pathNames = [];
      for (var p = 0; p < path.length; p++) {
        pathNames.push(path[p].name);
      }

      // Use path parts for client/project columns
      var clientName = pathNames.length > 1 ? pathNames[0] : '';
      var projectName = pathNames.length > 2 ? pathNames.slice(1, -1).join(' > ') : (pathNames.length > 1 ? '' : '');
      var taskName = pathNames[pathNames.length - 1];

      for (var session_id in task.sessions) {
        var session = task.sessions[session_id];

        if (session.start_time && session.end_time) {
          flatData[session_id] = {
            "client_id": path.length > 1 ? path[0].id : '',
            "client": clientName,
            "project": projectName,
            "project_id": path.length > 2 ? path[path.length - 2].id : '',
            "task": taskName,
            "task_id": task.id,
            "billable": task.billable,
            "start_time": session.start_time,
            "end_time": session.end_time,
            "session_id": session_id,
            "duration": timeDiffSecsFromString(session.start_time, session.end_time),
            "durationHMS": timeFromSeconds(timeDiffSecsFromString(session.start_time, session.end_time)),
            "node_path": pathNames.join(' > ')
          };
        }
      }
    }
  }
}

/* This is kind of a silly function and should probably be removed */
function filterFlatData(fs,callback){

   var tempTableData = [];

   for (var row in flatData){

     if (fs.clientId && fs.clientId != "all" && flatData[row].client_id != fs.clientId){ continue; }
     if (fs.projectId && fs.projectId != "all" && flatData[row].project_id != fs.projectId){ continue; }
     if (fs.taskId && fs.taskId != "all"  && flatData[row].task_id != fs.taskId){ continue; }
     if (fs.startTime && fs.startTime != "all" && flatData[row].start_time < fs.startTime){ continue; }
     if (fs.endTime && fs.endTime && flatData[row].end_time > fs.endTime){ continue; }

     tempTableData.push(flatData[row]);

     if(typeof callback == "function"){
        callback.call(flatData[row]);
     }
   }
   return tempTableData;
}



/**
 * Get a session by ID from the node structure
 * @param {string} id - Session ID
 * @returns {object} - Session object or empty object
 */
function getSessionById(id) {
  if (!ttData.nodes) return {};
  for (var nodeId in ttData.nodes) {
    var node = ttData.nodes[nodeId];
    if (node.sessions && node.sessions[id]) {
      return node.sessions[id];
    }
  }
  return {};
}


/* ######################### NODE-BASED DATA FUNCTIONS ######################### */

/**
 * Get node by ID
 * @param {string} id - Node ID
 * @returns {object|null} - Node object or null if not found
 */
function getNode(id) {
  if (!ttData.nodes || !id) return null;
  return ttData.nodes[id] || null;
}

/**
 * Get array of ancestor nodes from root to the specified node (inclusive)
 * @param {string} id - Node ID
 * @returns {array} - Array of node objects from root to node
 */
function getNodePath(id) {
  var path = [];
  var node = getNode(id);

  while (node) {
    path.unshift(node);
    if (node.parentId) {
      node = getNode(node.parentId);
    } else {
      break;
    }
  }

  return path;
}

/**
 * Get immediate children of a node
 * @param {string} id - Node ID (null for root)
 * @returns {array} - Array of child node objects in order
 */
function getNodeChildren(id) {
  var children = [];

  if (id === null) {
    // Return root-level nodes
    var order = ttData.rootOrder || [];
    for (var i = 0; i < order.length; i++) {
      var node = getNode(order[i]);
      if (node) children.push(node);
    }
  } else {
    var parent = getNode(id);
    if (parent && parent.childOrder) {
      for (var i = 0; i < parent.childOrder.length; i++) {
        var node = getNode(parent.childOrder[i]);
        if (node) children.push(node);
      }
    }
  }

  return children;
}

/**
 * Get all descendants of a node recursively
 * @param {string} id - Node ID (null for all nodes)
 * @param {string} type - Optional filter by type ("folder" or "task")
 * @returns {array} - Array of descendant node objects
 */
function getNodeDescendants(id, type) {
  var descendants = [];
  var children = getNodeChildren(id);

  for (var i = 0; i < children.length; i++) {
    var child = children[i];

    if (!type || child.type === type) {
      descendants.push(child);
    }

    // Recurse into children
    var childDescendants = getNodeDescendants(child.id, type);
    descendants = descendants.concat(childDescendants);
  }

  return descendants;
}

/**
 * Create a new node
 * @param {string} parentId - Parent node ID (null for root)
 * @param {object} data - Node data (name, type required)
 * @param {boolean} isProvisional - If true, creates a provisional node that isn't synced until it has content
 * @returns {object} - Created node
 */
function createNode(parentId, data, isProvisional) {
  if (!ttData.nodes) ttData.nodes = {};
  if (!ttData.rootOrder) ttData.rootOrder = [];

  var node = {
    id: newId(),
    name: data.name || '',
    type: data.type || 'task',
    parentId: parentId,
    childOrder: [],
    collapsed: false,
    creation_date: new Date().toISOString()
  };

  // Mark as provisional if specified
  if (isProvisional) {
    node.provisional = true;
    node.name = '';  // Force empty name for provisional nodes
  }

  // Add task-specific fields
  if (node.type === 'task') {
    node.status = data.status || 'new';
    node.starred = data.starred || '0';
    node.billable = data.billable || '1';
    node.estimate = data.estimate || 0;
    node.notes = data.notes || '';
    node.due = data.due || '';
    node.priority = data.priority || '3';
    node.sessions = {};
  }

  // Add to nodes dictionary
  ttData.nodes[node.id] = node;

  // Add to parent's childOrder or rootOrder
  if (parentId === null) {
    ttData.rootOrder.push(node.id);
  } else {
    var parent = getNode(parentId);
    if (parent) {
      if (!parent.childOrder) parent.childOrder = [];
      parent.childOrder.push(node.id);
      // Sync parent to update its childOrder on server (only for non-provisional)
      if (!isProvisional) {
        synchQueue.add("update", "node", parentId, parent.parentId);
      }
    }
  }

  // Queue for sync (only non-provisional nodes)
  if (!isProvisional) {
    synchQueue.add("insert", "node", node.id, parentId);
  }

  ttSave();
  return node;
}

/**
 * Update node properties
 * @param {string} id - Node ID
 * @param {object} data - Properties to update
 * @returns {object|null} - Updated node or null
 */
function updateNode(id, data) {
  var node = getNode(id);
  if (!node) return null;

  for (var key in data) {
    if (data.hasOwnProperty(key) && key !== 'id') {
      node[key] = data[key];
    }
  }

  // Queue for sync
  synchQueue.add("update", "node", id, node.parentId);

  ttSave();
  return node;
}

/**
 * Delete a node and optionally its children
 * @param {string} id - Node ID
 * @param {boolean} cascade - If true, delete children; if false, move children up
 * @returns {boolean} - Success status
 */
function deleteNode(id, cascade) {
  var node = getNode(id);
  if (!node) return false;

  // Only add delete to sync queue if node was synced (not provisional)
  // Provisional nodes were never synced, so no need to send delete
  if (!node.provisional) {
    synchQueue.add("delete", "node", id, node.parentId);
  }

  if (cascade) {
    // Delete all children recursively
    var children = getNodeChildren(id);
    for (var i = 0; i < children.length; i++) {
      deleteNode(children[i].id, true);
    }
  } else {
    // Move children to this node's parent
    var children = getNodeChildren(id);
    for (var i = 0; i < children.length; i++) {
      children[i].parentId = node.parentId;
      // Queue move for sync
      synchQueue.add("update", "node", children[i].id, node.parentId);
      if (node.parentId === null) {
        // Add to root
        var idx = ttData.rootOrder.indexOf(id);
        ttData.rootOrder.splice(idx + 1 + i, 0, children[i].id);
      } else {
        var parent = getNode(node.parentId);
        if (parent) {
          var idx = parent.childOrder.indexOf(id);
          parent.childOrder.splice(idx + 1 + i, 0, children[i].id);
        }
      }
    }
  }

  // Remove from parent's childOrder or rootOrder
  if (node.parentId === null) {
    var idx = ttData.rootOrder.indexOf(id);
    if (idx > -1) ttData.rootOrder.splice(idx, 1);
  } else {
    var parent = getNode(node.parentId);
    if (parent && parent.childOrder) {
      var idx = parent.childOrder.indexOf(id);
      if (idx > -1) parent.childOrder.splice(idx, 1);
      // Sync parent's updated childOrder
      synchQueue.add("update", "node", node.parentId, parent.parentId);
    }
  }

  // Delete the node
  delete ttData.nodes[id];

  ttSave();
  return true;
}

/**
 * Move a node to a new parent at a specific position
 * @param {string} id - Node ID to move
 * @param {string} newParentId - New parent ID (null for root)
 * @param {number} index - Position in new parent's childOrder (-1 for end)
 * @returns {boolean} - Success status
 */
function moveNode(id, newParentId, index) {
  var node = getNode(id);
  if (!node) return false;

  // Prevent moving a node into itself or its descendants
  if (newParentId !== null) {
    var path = getNodePath(newParentId);
    for (var i = 0; i < path.length; i++) {
      if (path[i].id === id) return false;
    }
  }

  var oldParentId = node.parentId;

  // Remove from old parent
  if (node.parentId === null) {
    var idx = ttData.rootOrder.indexOf(id);
    if (idx > -1) ttData.rootOrder.splice(idx, 1);
  } else {
    var oldParent = getNode(node.parentId);
    if (oldParent && oldParent.childOrder) {
      var idx = oldParent.childOrder.indexOf(id);
      if (idx > -1) oldParent.childOrder.splice(idx, 1);
    }
  }

  // Update node's parent
  node.parentId = newParentId;

  // Add to new parent
  if (newParentId === null) {
    if (index < 0 || index >= ttData.rootOrder.length) {
      ttData.rootOrder.push(id);
    } else {
      ttData.rootOrder.splice(index, 0, id);
    }
  } else {
    var newParent = getNode(newParentId);
    if (newParent) {
      if (!newParent.childOrder) newParent.childOrder = [];
      if (index < 0 || index >= newParent.childOrder.length) {
        newParent.childOrder.push(id);
      } else {
        newParent.childOrder.splice(index, 0, id);
      }
    }
  }

  // Queue for sync - sync the moved node
  synchQueue.add("update", "node", id, newParentId);

  // Sync old parent's childOrder (if it was a non-root parent)
  if (oldParentId !== null) {
    var oldParent = getNode(oldParentId);
    if (oldParent) {
      synchQueue.add("update", "node", oldParentId, oldParent.parentId);
    }
  }

  // Sync new parent's childOrder (if it's a non-root parent)
  if (newParentId !== null) {
    var newParent = getNode(newParentId);
    if (newParent) {
      synchQueue.add("update", "node", newParentId, newParent.parentId);
    }
  }

  ttSave();
  return true;
}

/**
 * Calculate total session time for a node (recursive for folders)
 * @param {string} id - Node ID
 * @returns {number} - Total time in seconds
 */
function calculateNodeTime(id) {
  var node = getNode(id);
  if (!node) return 0;

  var totalTime = 0;

  if (node.type === 'task') {
    // Sum sessions for this task
    if (node.sessions) {
      for (var sesId in node.sessions) {
        var session = node.sessions[sesId];
        if (session.start_time && session.end_time) {
          totalTime += timeDiffSecsFromString(session.start_time, session.end_time);
        }
      }
    }
  } else {
    // Folder: sum time of all descendant tasks
    var descendants = getNodeDescendants(id, 'task');
    for (var i = 0; i < descendants.length; i++) {
      totalTime += calculateNodeTime(descendants[i].id);
    }
  }

  return totalTime;
}

/**
 * Get all task nodes (convenience function)
 * @returns {array} - Array of all task nodes
 */
function getAllTaskNodes() {
  var tasks = [];
  if (!ttData.nodes) return tasks;

  for (var id in ttData.nodes) {
    if (ttData.nodes[id].type === 'task') {
      tasks.push(ttData.nodes[id]);
    }
  }

  return tasks;
}

/**
 * Get all folder nodes (nodes with children or type === 'folder')
 * @returns {array} - Array of all folder nodes
 */
function getAllFolderNodes() {
  var folders = [];
  if (!ttData.nodes) return folders;
  for (var id in ttData.nodes) {
    var node = ttData.nodes[id];
    if (!node) continue;
    if ((node.childOrder && node.childOrder.length > 0) || node.type === 'folder') {
      folders.push(node);
    }
  }
  return folders;
}

function ttSave(){
  localStorage.ttData = JSON.stringify(ttData);
  if (nativeBridge.ready) nativeBridge.persist();
}




/* ####################### TIME & DATE FUNCTIONS ########################## */


function prettyTime(s){
    var hours = parseInt(s/3600) % 24;
    var minutes = parseInt(s/60) % 60;
    var seconds = parseInt(s) % 60;

    hrsTxt = " hr";
    minsTxt = " min";

    if(hours > 1){
      hrsTxt += "s";
    }

    if(minutes > 1){
      minsTxt += "s";
    }
    var out = '';

    if(hours){
      out += hours.toString()+hrsTxt+" ";
    }
    if(minutes){
      out += minutes.toString()+minsTxt;
    }
    if(!minutes && !hours){
      out = seconds.toString()+" sec";
    }

    return out;
}

function timeFromSeconds(s){

    var hours = parseInt(s/3600);
    var minutes = parseInt(s/60) % 60;
    var seconds = parseInt(s) % 60;

    return (hours < 10 ? "0" + hours : hours) + ":" + (minutes < 10 ? "0" + minutes : minutes) + ":" + (seconds  < 10 ? "0" + seconds : seconds);

}

function hoursFromSeconds(s,round){
  if(round){
    return (s/3600).toFixed(round);
  }else{
    return (s/3600);
  }
}


function timeDiffSecsFromString(dateStr1,dateStr2){

    date1 = new Date(dateStr1.replace(' ','T'));
    date2 = new Date(dateStr2.replace(' ','T'));

    diffMs = date2.getTime() - date1.getTime();

    return (diffMs/1000);

}



/* ####################### UTILITY FUNCTIONS ########################## */

/* Parse time estimate from task input string
 * Supports patterns like: (30 m), (2 h), (1.5h), (45 min), (2 hrs)
 * Returns object with cleaned name and estimate in seconds
 */
function parseEstimateFromInput(input) {
  // Match bracketed: (30 m), (2 h), (1.5 hrs), etc.
  // Match unbracketed: 30m, 2h (number immediately followed by single h or m, no space)
  var patterns = [
    /\((\d+\.?\d*)\s*(m|min|mins|h|hr|hrs|hour|hours)\)/i,
    /(\d+\.?\d*)(h|m)(?!\w)/i
  ];

  for (var p = 0; p < patterns.length; p++) {
    var match = input.match(patterns[p]);
    if (match) {
      var value = parseFloat(match[1]);
      var unit = match[2].toLowerCase();
      var seconds = 0;

      if (unit === 'm' || unit === 'min' || unit === 'mins') {
        seconds = value * 60;
      } else if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
        seconds = value * 3600;
      }

      var cleanName = input.replace(patterns[p], '').trim();

      return {
        name: cleanName,
        estimate: seconds
      };
    }
  }

  return {
    name: input,
    estimate: 0
  };
}

/**
 * Extract hashtags from a string
 * @param {string} text - The text to parse (e.g., task name)
 * @returns {array} - Array of lowercase tag names without the # symbol
 */
function extractTags(text){
  if(!text || typeof text !== "string"){
    return [];
  }
  var tagRegex = /#([a-zA-Z0-9_]+)/g;
  var tags = [];
  var match;
  while((match = tagRegex.exec(text)) !== null){
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

/**
 * Check if a task has all specified tags (parsed from task name)
 * @param {object} task - The task object
 * @param {array} requiredTags - Array of tag names to check for
 * @returns {boolean} - True if task has ALL required tags
 */
function taskHasTags(task, requiredTags){
  var taskTags = extractTags(task.name);
  for(var i = 0; i < requiredTags.length; i++){
    if(taskTags.indexOf(requiredTags[i].toLowerCase()) === -1){
      return false;
    }
  }
  return true;
}

/**
 * Get all unique tags from all tasks in the system
 * @returns {array} - Sorted array of unique tag names (lowercase, without #)
 */
function getAllTags(){
  var tagSet = {};
  var allTasks = getAllTaskNodes();
  for(var i = 0; i < allTasks.length; i++){
    var tags = extractTags(allTasks[i].name);
    for(var j = 0; j < tags.length; j++){
      tagSet[tags[j]] = true;
    }
  }
  return Object.keys(tagSet).sort();
}

function recordCompletion(node) {
  if (!Array.isArray(node.completed_at)) node.completed_at = [];
  node.completed_at.push(new Date().toISOString());
}

function undoCompletion(node) {
  if (Array.isArray(node.completed_at) && node.completed_at.length > 0) {
    node.completed_at.pop();
  }
}

function resetDailyTasks() {
  var logicalDate = moment().subtract(3, 'hours').format('YYYY-MM-DD');
  var lastReset = localStorage.ttLastDailyReset;
  if (lastReset === logicalDate) return;

  var activeNodeId = localStorage.ttCurrentNodeId || null;
  var anyReset = false;

  for (var id in ttData.nodes) {
    var node = ttData.nodes[id];
    if (node.type !== 'task') continue;
    if (node.status !== 'completed') continue;
    if (id === activeNodeId) continue;
    if (!taskHasTags(node, ['daily'])) continue;

    node.status = 'new';
    anyReset = true;
    synchQueue.add('update', 'node', id, node.parentId);
  }

  if (anyReset) ttSave();
  localStorage.ttLastDailyReset = logicalDate;
  if (nativeBridge.ready) nativeBridge.persist();
}

function gebi(id){
  return document.getElementById(id);
}


function pad(n){return n<10 ? '0'+n : n;}

function truncate(str, limit, pad) {
   pad = pad || "...";
   if(str.length > limit){
      return str.substring(0,limit)+pad;
   }else{
      return str;
   }
}



function newId(name,type){

  id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
    return v.toString(16);
});

  return id;
}


function dbg(text,test_data){
  if(test_data){
    console.log(text,test_data);
  }else{
    console.log(text);
  }
}

function getSetting(name){
  return ttData.settings[name];
}

// Safely count object members
function getMemberCount(object){
  member_count = 0;

  if(typeof object == "object"){
    for (item in object){
       member_count += 1;
    }
  }

  return member_count;
}

function addScript(src){
  var scriptEl = document.createElement('script');
  scriptEl.src = src;
  document.getElementsByTagName("head")[0].appendChild(scriptEl);
}
function addCss(src){
  var cssEl = document.createElement('link');
  cssEl.href = src;
  cssEl.rel = "stylesheet";
  cssEl.type = "text/css";
  document.getElementsByTagName("head")[0].appendChild(cssEl);
}
