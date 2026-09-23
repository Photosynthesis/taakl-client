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
    settings: '/api/settings',
    shares: '/api/shares'
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
  auto_synch : "yes",
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
  xhr.timeout = opts.timeout || 30000;
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
    if (xhr.status === 0) {
      // Network failure (offline, DNS error, CORS block, etc.)
      if (opts.error) opts.error(xhr, '', 'Network unavailable');
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      var result;
      try { result = JSON.parse(xhr.responseText); }
      catch(e) { result = xhr.responseText; }
      if (opts.success) opts.success(result);
    } else {
      if (opts.error) opts.error(xhr, '', xhr.statusText);
    }
  };
  xhr.ontimeout = function() {
    if (opts.error) opts.error(xhr, '', 'Request timed out');
  };
  xhr.onerror = function() {
    if (opts.error) opts.error(xhr, '', 'Network error');
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
      synchQueue.restore();
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

   // Once a day, restart the pull cursor: the epoch re-pull re-delivers every
   // row, healing any divergence a cursor-based pull can never see (changes
   // that were dropped, rejected, or missed while this device was offline)
   var repullDay = moment().format('YYYY-MM-DD');
   if (isLoggedIn() && localStorage.ttLastFullRepull !== repullDay) {
     ttData.lastSyncTime = null;
     ttSave();
     localStorage.ttLastFullRepull = repullDay;
     if (nativeBridge.ready) nativeBridge.persist();
   }

   if(getSetting("auto_synch") == "yes" && isLoggedIn()){
     synchToServer();
     startAutoSync();
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


/* --- Collapsible session timer --- */

function isSessionCollapsed(){
  // The collapsed top bar is the default; '0' means the user expanded to fullscreen
  return localStorage.ttSessionCollapsed !== '0';
}

function toggleSessionCollapse(){
  if(isSessionCollapsed()){
    expandSessionTimer();
  }else{
    collapseSessionTimer();
  }
}

function collapseSessionTimer(){
  localStorage.ttSessionCollapsed = '1';
  applySessionLayout();
}

function expandSessionTimer(){
  localStorage.ttSessionCollapsed = '0';
  applySessionLayout();
}

// Sync the #active-session overlay and page layout with the collapsed flag
function applySessionLayout(){
  var overlay = gebi('active-session');
  if(!overlay) return;

  var collapsed = isSessionCollapsed();
  overlay.classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('session-collapsed', collapsed);

  var btn = gebi('session-collapse-btn');
  if(btn){
    btn.className = 'fa ' + (collapsed ? 'fa-expand' : 'fa-compress');
    btn.title = collapsed ? 'Expand timer' : 'Collapse timer';
  }

  var dur = gebi('current_duration');
  if(dur){
    if(collapsed){
      dur.style.fontSize = ''; // bar mode: stylesheet owns the size
    }else{
      setTimeout(fitDurationText, 10);
    }
  }
}


function fitDurationText(){
  if(isSessionCollapsed()) return;

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
    var durEl = document.getElementById('current_duration');
    if(durEl) durEl.innerHTML = currentDuration;
    fitDurationText(); // no-op while collapsed
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
        // Different account than this device last synced with: restart the
        // sync cursor so the first pull bootstraps the whole account
        if (ttData.userKey && ttData.userKey !== result.user.uuid) {
          ttData.lastSyncTime = null;
        }
        ttData.userKey = result.user.uuid;
        ttData.userName = result.user.username;
        ttSave();
        if (nativeBridge.ready) nativeBridge.persist();
        setFeedback('Logged in successfully');
        hideModal();
        // Sync after login (bootstraps via epoch pull if never synced)
        synchToServer();
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
        synchQueue.add("update", "node_session", id, nodeId);
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
          synchQueue.add("delete", "node_session", id, nodeId);
          break;
        }
      }
    }else if(ttData.nodes[id]){
      // Delete node
      var parentId = ttData.nodes[id].parentId;
      deleteNodeLocally(id);
      synchQueue.add("delete", "node", id, parentId);
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

  // The running session record is owned by the live timer — no editing until it ends
  if(type == 'session' && current_session && id == localStorage.ttSessionId){
    setFeedback('This session is in progress — end it before editing.', 'error');
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
         var extraBtn = (type == 'session' && key == 'start_time') ? ' <a class="button" onClick="fillLastSessionEnd(\''+id+'\')">Last session end</a>' : '';
         edit_element.insertAdjacentHTML('beforeend', '<div class="edit-field">'+field.label+' <input type="text" value="'+val+'" id="'+type+'-'+key+'-edit-input"/>'+extraBtn+'</div>');
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

      // Show new view. Clear the inline display rather than forcing 'block' so
      // the stylesheet decides how each view lays out — the assistant view needs
      // display:flex (its inline block was overriding it and breaking the
      // internal message scroll); every other view falls back to block anyway.
      newEl.style.display = '';

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
          // Clear inline display so per-view stylesheet layout applies
          // (assistant view = flex); others default to block.
          viewElements[i].style.display = "";
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


/* ############################# SHARE LINK FUNCTIONS ############################# */

// Create a read-only share link for a node branch and show it in a modal.
// Shares serve server-side data, so viewers see the owner's last-synced state.
function shareNode(nodeId) {
  if (!isLoggedIn()) {
    showAuthModal('login');
    return;
  }

  var node = getNode(nodeId);
  if (!node) return;

  showShareModal(node.name || '(unnamed)');

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.shares,
    type: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + authToken },
    data: JSON.stringify({ nodeUuid: nodeId }),
    success: function(result) {
      if (result.success && result.url) {
        var input = gebi('share-link-input');
        if (input) {
          input.value = result.url;
        }
        var copyBtn = gebi('share-copy-btn');
        if (copyBtn) copyBtn.style.display = '';
        // Push any pending local changes so viewers see recent edits
        var hasLocalChanges = (ttData.synchQueue && ttData.synchQueue.length > 0) ||
                              (typeof synchQueue !== 'undefined' && synchQueue.queue && synchQueue.queue.length > 0);
        if (hasLocalChanges) synchToServer();
      } else {
        shareModalError(result.error || 'Could not create share link');
      }
    },
    error: function(xhr) {
      var msg = 'Could not create share link';
      var code = null;
      try {
        var resp = JSON.parse(xhr.responseText);
        msg = resp.error || msg;
        code = resp.code;
      } catch(e) {}
      if (code === 'node_not_synced') {
        msg = 'This item has not been synced yet. Syncing now — try Share again in a moment.';
        synchToServer();
      }
      shareModalError(msg);
    }
  });
}

function showShareModal(nodeName) {
  var html = '<div id="share-modal">';
  html += '<h3>Share “' + escapeHtml(nodeName) + '”</h3>';
  html += '<div id="share-modal-error" style="color: red; margin-bottom: 10px; display: none;"></div>';
  html += '<input type="text" id="share-link-input" readonly placeholder="Creating link…" onclick="this.select()" />';
  html += '<div style="margin-top: 12px;">';
  html += '<a class="button" id="share-copy-btn" style="display:none" onclick="copyShareLink()">Copy Link</a>';
  html += '<a class="button" onclick="hideModal()" style="margin-left: 10px;">Done</a>';
  html += '</div>';
  html += '<div style="margin-top: 12px; font-size: 12px; color: #666;">';
  html += 'Anyone with this link can view this branch (read-only). ';
  html += 'Viewers see your last-synced data. Manage links under Tweak → Shared links.';
  html += '</div>';
  html += '</div>';

  gebi('edit-popup').innerHTML = html;
  gebi('modal-bg').style.display = 'block';
  gebi('edit-popup').style.display = 'block';
}

function shareModalError(message) {
  var el = gebi('share-modal-error');
  if (el) {
    el.textContent = message;
    el.style.display = 'block';
  }
}

function copyShareLink() {
  var input = gebi('share-link-input');
  if (!input || !input.value) return;
  input.select();

  var done = function() { setFeedback('Share link copied'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(done, function() {
      document.execCommand('copy');
      done();
    });
  } else {
    document.execCommand('copy');
    done();
  }
}

// Settings > Shared links
function loadSharesList() {
  var container = gebi('settings-shares-list');
  if (!container) return;

  if (!isLoggedIn()) {
    container.textContent = 'Login to manage shared links.';
    return;
  }

  container.textContent = 'Loading…';

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.shares,
    type: 'GET',
    cache: false,
    headers: { 'Authorization': 'Bearer ' + authToken },
    success: function(result) {
      if (!result.success) {
        container.textContent = 'Could not load shared links.';
        return;
      }
      var shares = result.shares || [];
      if (shares.length === 0) {
        container.textContent = 'No active shared links.';
        return;
      }

      container.innerHTML = '';
      for (var i = 0; i < shares.length; i++) {
        (function(share) {
          var row = document.createElement('div');
          row.className = 'settings-share-row';

          var name = document.createElement('span');
          name.className = 'settings-share-name';
          name.textContent = share.node_name || '(deleted item)';
          row.appendChild(name);

          var meta = document.createElement('span');
          meta.className = 'settings-share-meta';
          meta.textContent = 'created ' + String(share.created_at || '').slice(0, 10) +
            ' · ' + (share.access_count || 0) + ' views';
          row.appendChild(meta);

          var btn = document.createElement('a');
          btn.className = 'button settings-share-revoke';
          btn.textContent = 'Turn off';
          btn.onclick = function() { revokeShare(share.id); };
          row.appendChild(btn);

          container.appendChild(row);
        })(shares[i]);
      }
    },
    error: function() {
      container.textContent = 'Could not load shared links.';
    }
  });
}

function revokeShare(shareId) {
  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.shares + '/' + shareId,
    type: 'DELETE',
    headers: { 'Authorization': 'Bearer ' + authToken },
    success: function() {
      setFeedback('Share link turned off');
      loadSharesList();
    },
    error: function() {
      setFeedback('Could not turn off share link', 'error');
    }
  });
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
    var isRunning = current_session && sid === localStorage.ttSessionId;
    var row = document.createElement('div');
    row.className = 'node-view-session-row' + (isRunning ? ' session-running' : '');
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
    timeRange.textContent = isRunning ? startStr + ' \u2013 in progress' : startStr + ' \u2013 ' + endStr;
    row.appendChild(timeRange);

    var durEl = document.createElement('span');
    durEl.className = 'session-duration';
    durEl.textContent = isRunning ? '\u2014' : prettyTime(dur);
    row.appendChild(durEl);

    // Double-click to edit session (not while it's running)
    if (!isRunning) {
      (function(sessionId) {
        row.ondblclick = function() {
          showGeneralEditForm('session', sessionId);
        };
      })(sid);
    }

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

  // Title (editable)
  var title = document.createElement('textarea');
  title.rows = 1;
  title.className = 'node-view-title';
  title.value = node.name || '';
  title.placeholder = 'Untitled';

  function autoResizeTitle(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  title.oninput = function() {
    autoResizeTitle(this);
    node.name = this.value;
  };

  title.onfocus = function() {
    treeView.originalValues[nodeId] = {
      name: node.name,
      estimate: node.estimate || 0,
      due: node.due || ''
    };
  };

  title.onblur = function() {
    treeView.finalizeNode(nodeId);
  };

  title.onkeydown = function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this.blur();
    }
  };

  header.appendChild(title);

  // Auto-size after appending to DOM
  setTimeout(function() { autoResizeTitle(title); }, 0);

  // Metadata grid
  var meta = document.createElement('div');
  meta.className = 'node-view-meta';

  var time = calculateNodeTime(nodeId);
  if (time > 0) {
    meta.appendChild(treeView._metaItem('Time logged', prettyTime(time)));
  }

  if (isTask) {
    // --- Status dropdown ---
    var statusSelect = document.createElement('select');
    statusSelect.className = 'node-view-meta-select';
    var statusOptions = [
      {value: 'new', label: 'New'},
      {value: 'inProcess', label: 'In Process'},
      {value: 'onHold', label: 'On Hold'},
      {value: 'completed', label: 'Completed'}
    ];
    for (var si = 0; si < statusOptions.length; si++) {
      var sopt = document.createElement('option');
      sopt.value = statusOptions[si].value;
      sopt.textContent = statusOptions[si].label;
      if ((node.status || 'new') === statusOptions[si].value) sopt.selected = true;
      statusSelect.appendChild(sopt);
    }
    statusSelect.onchange = function() {
      node.status = this.value;
      ttSave();
      emitEvent('node', 'updated', nodeId);
    };
    meta.appendChild(treeView._metaItem('Status', statusSelect));

    // --- Priority dropdown ---
    var prioritySelect = document.createElement('select');
    prioritySelect.className = 'node-view-meta-select';
    var priorityOptions = [
      {value: '1', label: '1 (Highest)'},
      {value: '2', label: '2 (High)'},
      {value: '3', label: '3 (Normal)'},
      {value: '4', label: '4 (Low)'},
      {value: '5', label: '5 (Lowest)'}
    ];
    for (var pi = 0; pi < priorityOptions.length; pi++) {
      var popt = document.createElement('option');
      popt.value = priorityOptions[pi].value;
      popt.textContent = priorityOptions[pi].label;
      if ((node.priority || '3') === priorityOptions[pi].value) popt.selected = true;
      prioritySelect.appendChild(popt);
    }
    prioritySelect.onchange = function() {
      node.priority = this.value;
      ttSave();
      emitEvent('node', 'updated', nodeId);
    };
    meta.appendChild(treeView._metaItem('Priority', prioritySelect));

    // --- Due date with Pikaday ---
    var dueWrap = document.createElement('span');
    dueWrap.className = 'node-view-meta-due-wrap';
    var dueInput = document.createElement('input');
    dueInput.type = 'text';
    dueInput.className = 'node-view-meta-input node-view-meta-due';
    dueInput.placeholder = 'None';
    dueInput.readOnly = true;
    dueInput.value = node.due ? moment(node.due).format('YYYY-MM-DD') : '';
    dueWrap.appendChild(dueInput);
    var dueClear = document.createElement('span');
    dueClear.className = 'node-view-meta-due-clear';
    dueClear.innerHTML = '&times;';
    dueClear.title = 'Clear due date';
    dueClear.style.display = node.due ? 'inline' : 'none';
    dueWrap.appendChild(dueClear);
    meta.appendChild(treeView._metaItem('Due', dueWrap));
    // Pikaday must be initialized after the input is in the DOM
    setTimeout(function() {
      var picker = new Pikaday({
        field: dueInput,
        format: 'YYYY-MM-DD',
        onSelect: function(date) {
          var val = moment(date).format('YYYY-MM-DD');
          node.due = val;
          dueInput.value = val;
          dueClear.style.display = 'inline';
          ttSave();
          emitEvent('node', 'updated', nodeId);
        }
      });
      dueClear.onclick = function() {
        node.due = '';
        dueInput.value = '';
        dueClear.style.display = 'none';
        picker.setDate(null);
        ttSave();
        emitEvent('node', 'updated', nodeId);
      };
    }, 0);

    // --- Estimate input ---
    var estInput = document.createElement('input');
    estInput.type = 'text';
    estInput.className = 'node-view-meta-input';
    estInput.placeholder = 'None';
    estInput.value = node.estimate && node.estimate > 0 ? prettyTime(node.estimate) : '';
    estInput.onblur = function() {
      var raw = this.value.trim();
      if (!raw) {
        if (node.estimate && node.estimate > 0) {
          node.estimate = 0;
          ttSave();
          emitEvent('node', 'updated', nodeId);
        }
        return;
      }
      var parsed = parseEstimateFromInput(raw);
      if (parsed.estimate > 0) {
        node.estimate = parsed.estimate;
        this.value = prettyTime(node.estimate);
        ttSave();
        emitEvent('node', 'updated', nodeId);
      } else {
        // Restore previous value if parsing fails
        this.value = node.estimate && node.estimate > 0 ? prettyTime(node.estimate) : '';
      }
    };
    estInput.onkeydown = function(e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    };
    meta.appendChild(treeView._metaItem('Estimate', estInput));

    // --- Starred toggle ---
    var starBtn = document.createElement('span');
    starBtn.className = 'node-view-meta-toggle' + (node.starred === '1' ? ' active' : '');
    starBtn.innerHTML = '<i class="fa fa-star"></i> ' + (node.starred === '1' ? 'Yes' : 'No');
    starBtn.onclick = function() {
      node.starred = node.starred === '1' ? '0' : '1';
      this.className = 'node-view-meta-toggle' + (node.starred === '1' ? ' active' : '');
      this.innerHTML = '<i class="fa fa-star"></i> ' + (node.starred === '1' ? 'Yes' : 'No');
      ttSave();
      emitEvent('node', 'updated', nodeId);
    };
    meta.appendChild(treeView._metaItem('Starred', starBtn));

    // --- Urgent toggle ---
    var urgentBtn = document.createElement('span');
    urgentBtn.className = 'node-view-meta-toggle' + (node.urgent === '1' ? ' active' : '');
    urgentBtn.innerHTML = '\uD83D\uDD25 ' + (node.urgent === '1' ? 'Yes' : 'No');
    urgentBtn.onclick = function() {
      node.urgent = node.urgent === '1' ? '0' : '1';
      this.className = 'node-view-meta-toggle' + (node.urgent === '1' ? ' active' : '');
      this.innerHTML = '\uD83D\uDD25 ' + (node.urgent === '1' ? 'Yes' : 'No');
      ttSave();
      emitEvent('node', 'updated', nodeId);
    };
    meta.appendChild(treeView._metaItem('Urgent', urgentBtn));

    // --- Billable toggle ---
    var billableBtn = document.createElement('span');
    var isBillable = node.billable !== '0';
    billableBtn.className = 'node-view-meta-toggle' + (isBillable ? ' active' : '');
    billableBtn.innerHTML = '<i class="fa fa-money"></i> ' + (isBillable ? 'Yes' : 'No');
    billableBtn.onclick = function() {
      var nowBillable = node.billable === '0';
      node.billable = nowBillable ? '1' : '0';
      this.className = 'node-view-meta-toggle' + (nowBillable ? ' active' : '');
      this.innerHTML = '<i class="fa fa-money"></i> ' + (nowBillable ? 'Yes' : 'No');
      ttSave();
      emitEvent('node', 'updated', nodeId);
    };
    meta.appendChild(treeView._metaItem('Billable', billableBtn));
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

  // --- Share link ---
  var shareBtn = document.createElement('span');
  shareBtn.className = 'node-view-meta-toggle';
  shareBtn.innerHTML = '<i class="fa fa-link"></i> Share link…';
  shareBtn.onclick = function() {
    shareNode(nodeId);
  };
  meta.appendChild(treeView._metaItem('Share', shareBtn));

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
  treeView.closeNodeMenu();
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

  treeView.closeNodeMenu();
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
    // Apply filters (a completed parent hides its whole subtree)
    if (treeView.hideCompleted && isCompleted) return;

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
      estimate: node.estimate || 0,
      due: node.due || ''
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
    if (time > 0 || estimate > 0 || node.due) {
      var meta = document.createElement('span');
      meta.className = 'tree-meta';
      var parts = [];
      if (time > 0) parts.push('<span class="time">' + prettyTime(time) + '</span>');
      if (estimate > 0) parts.push('<span class="tree-estimate">est ' + prettyTime(estimate) + '</span>');
      if (node.due) parts.push('<span class="tree-due">' + moment(node.due).format('MMM D') + '</span>');
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

      var urgentBtn = document.createElement('span');
      urgentBtn.className = 'tree-urgent' + (node.urgent === '1' ? ' urgent' : '');
      urgentBtn.textContent = '\uD83D\uDD25';
      urgentBtn.onclick = function(e) {
        e.stopPropagation();
        treeView.toggleUrgent(nodeId);
      };
      row.appendChild(urgentBtn);

      var play = document.createElement('i');
      var isTracking = current_session && current_node && current_node.id === nodeId;
      play.className = isTracking ? 'fa fa-clock-o tree-play tracking' : 'fa fa-play-circle tree-play';
      if (isTracking) play.title = 'Session in progress';
      play.onclick = function(e) {
        e.stopPropagation();
        treeView.startSession(nodeId);
      };
      row.appendChild(play);
    }

    // Three-dot menu for parent nodes (mark complete/incomplete)
    if (!isTask) {
      var menuBtn = document.createElement('span');
      menuBtn.className = 'tree-menu-btn';
      menuBtn.innerHTML = '&#8942;';
      menuBtn.title = 'More actions';
      menuBtn.onclick = function(e) {
        e.stopPropagation();
        treeView.openNodeMenu(nodeId, this);
      };
      row.appendChild(menuBtn);
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
  var originalDue = original.due || '';

  // Parse estimate from name (e.g. "Fix bug (30 m)" or "Fix bug 30m")
  if (node.name) {
    var parsed = parseEstimateFromInput(node.name);
    if (parsed.estimate > 0) {
      node.name = parsed.name;
      node.estimate = parsed.estimate;
    }
  }

  // Parse date hashtags from name (e.g. "Fix bug #tomorrow")
  if (node.name) {
    var dateParsed = parseDateFromInput(node.name);
    if (dateParsed.due) {
      node.name = dateParsed.name;
      node.due = dateParsed.due;
    }
  }

  // Check if anything changed and save
  if (node.name !== originalName || node.estimate !== originalEstimate || (node.due || '') !== originalDue) {
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

      // Skip filtered (completed parents hide their whole subtree)
      if (treeView.hideCompleted && n.status === 'completed') continue;

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

/**
 * Count descendant leaf tasks that are not completed (provisional nodes ignored)
 */
function countIncompleteSubtasks(nodeId) {
  var node = getNode(nodeId);
  if (!node || !node.childOrder) return 0;
  var count = 0;
  for (var i = 0; i < node.childOrder.length; i++) {
    var child = getNode(node.childOrder[i]);
    if (!child || child.provisional) continue;
    if (nodeIsTask(child.id)) {
      if (child.status !== 'completed') count++;
    } else {
      count += countIncompleteSubtasks(child.id);
    }
  }
  return count;
}

// Mark a parent node complete/incomplete (from the three-dot menu)
treeView.setNodeComplete = function(nodeId, completed) {
  var node = getNode(nodeId);
  if (!node) return;
  if (completed) {
    node.status = 'completed';
    recordCompletion(node);
  } else {
    node.status = 'inProcess';
    undoCompletion(node);
  }
  ttSave();
  emitEvent('node', 'updated', nodeId);
  treeView.update();
};

// --- Three-dot menu for parent rows ---
treeView.closeNodeMenu = function() {
  var menu = gebi('tree-node-menu');
  if (menu) menu.parentNode.removeChild(menu);
  if (treeView._menuCloseHandler) {
    document.removeEventListener('click', treeView._menuCloseHandler);
    document.removeEventListener('keydown', treeView._menuKeyHandler);
    treeView._menuCloseHandler = null;
    treeView._menuKeyHandler = null;
  }
};

treeView.openNodeMenu = function(nodeId, btn) {
  var node = getNode(nodeId);
  if (!node) return;

  // Toggle: clicking the same button while open closes the menu
  var existing = gebi('tree-node-menu');
  var wasForNode = existing && existing.getAttribute('data-node-id') === nodeId;
  treeView.closeNodeMenu();
  if (wasForNode) return;

  var menu = document.createElement('div');
  menu.id = 'tree-node-menu';
  menu.className = 'tree-node-menu';
  menu.setAttribute('data-node-id', nodeId);

  var isCompleted = node.status === 'completed';
  var item = document.createElement('div');
  item.className = 'tree-node-menu-item';

  if (isCompleted) {
    item.textContent = 'Mark incomplete';
    item.onclick = function(e) {
      e.stopPropagation();
      treeView.closeNodeMenu();
      treeView.setNodeComplete(nodeId, false);
    };
    menu.appendChild(item);
  } else {
    var incomplete = countIncompleteSubtasks(nodeId);
    item.textContent = 'Mark complete';
    if (incomplete > 0) {
      item.className += ' disabled';
      menu.appendChild(item);
      var hint = document.createElement('div');
      hint.className = 'tree-node-menu-hint';
      hint.textContent = incomplete + ' incomplete subtask' + (incomplete === 1 ? '' : 's');
      menu.appendChild(hint);
    } else {
      item.onclick = function(e) {
        e.stopPropagation();
        treeView.closeNodeMenu();
        treeView.setNodeComplete(nodeId, true);
      };
      menu.appendChild(item);
    }
  }

  // Position below the button (absolute in page coordinates)
  var rect = btn.getBoundingClientRect();
  menu.style.top = (rect.bottom + window.pageYOffset + 2) + 'px';
  document.body.appendChild(menu);
  var left = rect.right + window.pageXOffset - menu.offsetWidth;
  menu.style.left = Math.max(4, left) + 'px';

  // Close on outside click or Escape (deferred so this click doesn't trigger it)
  treeView._menuCloseHandler = function(e) {
    if (!menu.contains(e.target)) treeView.closeNodeMenu();
  };
  treeView._menuKeyHandler = function(e) {
    if (e.key === 'Escape') treeView.closeNodeMenu();
  };
  setTimeout(function() {
    document.addEventListener('click', treeView._menuCloseHandler);
    document.addEventListener('keydown', treeView._menuKeyHandler);
  }, 0);
};

treeView.toggleStar = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;
  node.starred = node.starred === '1' ? '0' : '1';
  ttSave();
  treeView.update();
  emitEvent('node', 'updated', nodeId);
};

treeView.toggleUrgent = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;
  node.urgent = node.urgent === '1' ? '0' : '1';
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

  // Already tracking this node: just re-open the full timer
  if (current_session && current_node && current_node.id === nodeId) {
    expandSessionTimer();
    return;
  }

  // Another session is running (reachable while the timer is collapsed):
  // end it before switching; the next session starts collapsed by default
  if (current_session) {
    endNodeSession(false);
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
  var dateParsed = parseDateFromInput(parsed.name);

  createNode(parentId, {
    name: dateParsed.name,
    type: 'task',
    estimate: parsed.estimate,
    due: dateParsed.due || '',
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

  // Publish the running session so other devices can adopt it on sync
  setGlobalState('tracking', { nodeId: current_node.id, sessionId: current_session.id });

  counterId = setInterval(incrementCurrentDuration, 1000);
  showNodeInSession();
  ttSave();
  treeView.update(); // show the tracking indicator on the active row
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

  var html = '<i id="session-collapse-btn" class="fa fa-compress" title="Collapse timer" onclick="toggleSessionCollapse()"></i>' +
  '<div class="centered-box">' +
    '<div id="current-info" onclick="if(isSessionCollapsed())expandSessionTimer()">' + pathStr + '</div>' +
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

  applySessionLayout();
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
  delete localStorage.ttSessionCollapsed; // next session starts collapsed (the default)
  if (nativeBridge.ready) nativeBridge.persist();

  // Clear the synced tracking pointer (fresh timestamp so LWW propagates the stop)
  setGlobalState('tracking', { nodeId: null, sessionId: null });

  console.log('[SESSION END] After clearing current_session, sessions still in ttData?',
    ttData.nodes[current_node.id].sessions[pastSessionId]);

  console.log('[SESSION END] About to call ttSave()');
  console.log('[SESSION END] Final check - ttData.nodes[current_node.id].sessions:',
    ttData.nodes[current_node.id].sessions);
  ttSave();
  console.log('[SESSION END] ttSave() completed');

  gebi('active-session').style.display = 'none';
  gebi('active-session').classList.remove('collapsed');
  document.body.classList.remove('session-collapsed');
  document.title = 'Taakl';

  var edit_button = '<form style="display:inline"><a class="button" onClick="showGeneralEditForm(\'session\',\'' + pastSessionId + '\')">Edit session</a></form>';
  setFeedback('Session Ended. Duration was ' + currentDuration + task_complete_feedback + edit_button, feedback_class);

  treeView.update();

  emitEvent('session', 'ended');
}

/**
 * Stop the running timer without writing session data. Used when sync reveals
 * the tracked node/session no longer exists or was ended on another device.
 */
function abortNodeSession(message) {
  clearInterval(counterId);
  window.removeEventListener('resize', fitDurationText);

  current_session = '';
  delete localStorage.ttSessionId;
  delete localStorage.ttSessionCollapsed;
  if (nativeBridge.ready) nativeBridge.persist();

  var overlay = gebi('active-session');
  overlay.style.display = 'none';
  overlay.classList.remove('collapsed');
  document.body.classList.remove('session-collapsed');
  document.title = 'Taakl';

  if (message) setFeedback(message, 'notice');
  treeView.update();
}

/**
 * Re-point current_node/current_session after sync rewrites ttData.nodes.
 * Sync can replace the node object or the whole sessions map
 * (upsertNodeLocally), leaving the globals dangling on dead objects —
 * mutations would then silently miss ttData.
 */
function refreshSessionRefs() {
  if (!current_session) return;

  var node = getNode(localStorage.ttCurrentNodeId);
  if (!node) {
    abortNodeSession('The task being tracked was deleted on another device — timer stopped.');
    return;
  }

  current_node = node;
  current_node_path = getNodePath(node.id);

  var sessId = localStorage.ttSessionId;
  if (!node.sessions) node.sessions = {};

  if (node.sessions[sessId]) {
    current_session = node.sessions[sessId];
    if (current_session.end_time) {
      abortNodeSession('This session was ended on another device.');
    }
  } else {
    // Merge dropped the open session (server copy predates it) — restore ours
    node.sessions[sessId] = current_session;
  }
}

/**
 * Set a key in the account-global synced state (ttData.globalState).
 * Entries are { value, updated_at } — the client-stamped UTC timestamp
 * drives last-write-wins merging on the server and other devices.
 */
function setGlobalState(key, value) {
  if (!ttData.globalState) ttData.globalState = {};
  ttData.globalState[key] = {
    value: value,
    updated_at: new Date().toISOString().replace('T', ' ').substr(0, 19)
  };
}

/**
 * Merge the account-global state map returned by the server (last-write-wins
 * per key against the local copy), then run the key-specific handler for each
 * key the server won. Returns true if anything changed.
 */
function applyServerGlobalState(serverState) {
  if (!serverState) return false;

  if (!ttData.globalState) ttData.globalState = {};
  var changed = false;

  for (var key in serverState) {
    var remote = serverState[key];
    if (!remote || !remote.updated_at) continue;

    var local = ttData.globalState[key];
    if (local && local.updated_at && local.updated_at >= remote.updated_at) {
      continue; // local entry is newer; it will be pushed on next sync
    }

    ttData.globalState[key] = remote;
    changed = true;

    if (key === 'tracking') adoptRemoteTracking(remote.value);
  }

  return changed;
}

/**
 * Handler for the synced 'tracking' key: adopt the remote running session's
 * timer UI, but only when this device is idle. A session ended elsewhere is
 * handled by refreshSessionRefs (the session's end_time syncs too), so this
 * only ever starts a timer, never stops one.
 */
function adoptRemoteTracking(tracking) {
  if (current_session || !tracking || !tracking.sessionId || !tracking.nodeId) return;

  var node = getNode(tracking.nodeId);
  var sess = node && node.sessions ? node.sessions[tracking.sessionId] : null;
  if (!sess || sess.end_time) return;

  current_node = node;
  current_node_path = getNodePath(node.id);
  current_session = sess;
  localStorage.ttCurrentNodeId = node.id;
  localStorage.ttSessionId = sess.id;
  if (nativeBridge.ready) nativeBridge.persist();

  continueNodeSession();
  treeView.update();
  setFeedback('Adopted running session from another device.', 'notice');
}


/* ################################ ANALYZE VIEW ################################ */

// State
analyze.tab = 'calendar';            // 'calendar' | 'projects'
analyze.calView = 'day';             // 'day' | 'week' | 'month'
analyze.anchor = '';                 // 'YYYY-MM-DD' focus date for the calendar lens
analyze.projPath = [];               // node-id drill path for the Projects lens ([] = all)
analyze.projPreset = 'month';        // 'week'|'lastweek'|'month'|'lastmonth'|'custom'
analyze.customRange = { start: '', end: '' };
analyze.billing = { round15: true, rate: 0, showNonBillable: true };
analyze.startPicker = null;
analyze.endPicker = null;
analyze._csvRows = [];

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
      if (!ses.start_time) continue;

      // The currently running session has no end_time yet: synthesize "now"
      // so it shows up live. Any other open-ended session is corrupt — skip.
      var endTime = ses.end_time;
      var live = false;
      if (!endTime) {
        if (localStorage.ttSessionId === sesId) {
          endTime = moment().format('YYYY-MM-DD HH:mm:ss');
          live = true;
        } else {
          continue;
        }
      }
      if (ses.start_time < startBound || ses.start_time > endBound) continue;

      var durationSecs = timeDiffSecsFromString(ses.start_time, endTime);

      sessions.push({
        id: sesId,
        taskId: nodeId,
        taskName: node.name,
        start_time: ses.start_time,
        end_time: endTime,
        durationSecs: durationSecs,
        live: live,
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
analyze.aggregateScope = function(sessions, parentId) {
  var groups = {};
  var order = [];

  for (var i = 0; i < sessions.length; i++) {
    var ses = sessions[i];
    var childId = analyze.findChildAtLevel(ses.path, parentId);
    var key;
    var direct = false;

    if (childId) {
      key = childId;
    } else if (parentId && ses.taskId === parentId) {
      // Session logged directly on the scope node itself
      key = '__direct__';
      direct = true;
    } else {
      continue;
    }

    if (!groups[key]) {
      var node = childId ? getNode(childId) : null;
      groups[key] = {
        nodeId: childId,   // null for the direct bucket
        nodeName: direct ? 'Logged directly here' : (node ? node.name : 'Unknown'),
        direct: direct,
        totalSecs: 0,
        sessionCount: 0,
        sessions: [],
        hasChildren: false
      };
      order.push(key);
    }

    var g = groups[key];
    g.totalSecs += ses.durationSecs;
    g.sessionCount++;
    g.sessions.push(ses);
    // Drillable only if some session sits deeper than the child node itself
    if (childId && ses.taskId !== childId) g.hasChildren = true;
  }

  var result = [];
  for (var j = 0; j < order.length; j++) {
    result.push(groups[order[j]]);
  }

  result.sort(function(a, b) {
    return b.totalSecs - a.totalSecs;
  });

  return result;
};

/**
 * Current Projects-lens scope node id (null = all roots)
 */
analyze.projParentId = function() {
  if (analyze.projPath.length === 0) return null;
  return analyze.projPath[analyze.projPath.length - 1];
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
 * Escape a string for an HTML attribute (escapeHtml doesn't cover quotes)
 */
analyze.escAttr = function(text) {
  return escapeHtml(text).replace(/"/g, '&quot;');
};

/**
 * '#rrggbb' -> 'rgba(r,g,b,a)'
 */
analyze.rgba = function(hex, alpha) {
  var r = parseInt(hex.substr(1, 2), 16);
  var g = parseInt(hex.substr(3, 2), 16);
  var b = parseInt(hex.substr(5, 2), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
};

/**
 * 'YYYY-MM-DD HH:mm:ss' -> minutes since local midnight
 */
analyze.minOfDay = function(ts) {
  return parseInt(ts.substr(11, 2), 10) * 60 + parseInt(ts.substr(14, 2), 10);
};

/**
 * Minutes since midnight -> 'HH:MM'
 */
analyze.fmtClock = function(min) {
  var h = Math.floor(min / 60);
  var m = Math.round(min % 60);
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
};

/* --- 3 AM day cutoff ---------------------------------------------------
 * Review uses the same day boundary as the Today view: a "day" runs from
 * 03:00 to 03:00, so late-night work counts toward the evening it belongs
 * to. Times are positioned in "display minutes" (minutes since the day's
 * 03:00 start); clockOf() converts back to wall-clock labels.
 */
analyze.CUTOFF_MIN = 180;

/**
 * 'YYYY-MM-DD HH:mm:ss' -> the cutoff-shifted day it belongs to
 */
analyze.dayOf = function(ts) {
  return moment(ts).subtract(3, 'hours').format('YYYY-MM-DD');
};

/**
 * Today under the cutoff (at 01:30 this is still "yesterday")
 */
analyze.reviewToday = function() {
  return moment().subtract(3, 'hours').format('YYYY-MM-DD');
};

/**
 * 'YYYY-MM-DD HH:mm:ss' -> minutes since its day's 03:00 start (0..1439)
 */
analyze.dispMinOf = function(ts) {
  var m = analyze.minOfDay(ts) - analyze.CUTOFF_MIN;
  return m < 0 ? m + 1440 : m;
};

/**
 * Display minutes -> wall-clock label ('23:40' for disp 1240)
 */
analyze.clockOf = function(disp) {
  return analyze.fmtClock((disp + analyze.CUTOFF_MIN) % 1440);
};

/**
 * Sessions whose cutoff-shifted day falls within [start, end]
 */
analyze.getSessionsForDays = function(start, end) {
  var qEnd = moment(end).add(1, 'day').format('YYYY-MM-DD');
  var sessions = analyze.getSessionsInRange(start, qEnd);
  var out = [];
  for (var i = 0; i < sessions.length; i++) {
    var ds = analyze.dayOf(sessions[i].start_time);
    if (ds >= start && ds <= end) out.push(sessions[i]);
  }
  return out;
};

/**
 * Seconds -> decimal hours string ('1.53')
 */
analyze.fmtDecH = function(secs) {
  return (secs / 3600).toFixed(2);
};

/**
 * Seconds -> short hours string ('3.2h')
 */
analyze.fmtH = function(secs) {
  return (secs / 3600).toFixed(1) + 'h';
};

/**
 * Join node names of path[from..to) with ' › '
 */
analyze.pathNames = function(path, from, to) {
  var names = [];
  for (var i = from; i < to; i++) names.push(path[i].name);
  return names.join(' › ');
};

analyze.pathHasNode = function(path, id) {
  for (var i = 0; i < path.length; i++) {
    if (path[i].id === id) return true;
  }
  return false;
};

/**
 * A session is billable unless any node on its path is flagged non-billable
 */
analyze.sessionBillable = function(path) {
  for (var i = 0; i < path.length; i++) {
    if (path[i].billable === '0') return false;
  }
  return true;
};

/**
 * All completion events (node.completed_at entries, UTC ISO) whose *local*
 * date falls within [start, end]. Each array entry is a separate event.
 */
analyze.getCompletionsInRange = function(start, end) {
  var out = [];
  var allNodes = ttData.nodes || {};

  for (var nodeId in allNodes) {
    var node = allNodes[nodeId];
    if (!Array.isArray(node.completed_at) || node.completed_at.length === 0) continue;

    var path = null;
    for (var i = 0; i < node.completed_at.length; i++) {
      var m = moment(node.completed_at[i]);
      if (!m.isValid()) continue;
      var shifted = m.clone().subtract(3, 'hours');
      var ds = shifted.format('YYYY-MM-DD');
      if (ds < start || ds > end) continue;
      if (!path) path = getNodePath(nodeId);
      out.push({
        nodeId: nodeId,
        name: node.name,
        path: path,
        ds: ds,
        disp: shifted.hours() * 60 + shifted.minutes()
      });
    }
  }

  out.sort(function(a, b) {
    return a.ds === b.ds ? a.disp - b.disp : (a.ds < b.ds ? -1 : 1);
  });
  return out;
};

/**
 * Bucket sessions + completions into per-day structures for calendar display.
 * Days follow the 3 AM cutoff; a session crossing its day's 03:00 end splits
 * into one segment per day. Segment positions are display minutes (minutes
 * since the day's 03:00 start).
 * Returns { 'YYYY-MM-DD': { segs: [{startMin, endMin, ses}], comps: [...] } }
 */
analyze.getCalendarDays = function(start, end) {
  var days = {};
  function bucket(ds) {
    if (!days[ds]) days[ds] = { segs: [], comps: [] };
    return days[ds];
  }

  var sessions = analyze.getSessionsForDays(start, end);
  for (var i = 0; i < sessions.length; i++) {
    var ses = sessions[i];
    var sDs = analyze.dayOf(ses.start_time);
    var eDs = analyze.dayOf(ses.end_time);
    var sMin = analyze.dispMinOf(ses.start_time);
    var eMin = analyze.dispMinOf(ses.end_time);

    if (sDs === eDs) {
      if (eMin > sMin) bucket(sDs).segs.push({ startMin: sMin, endMin: eMin, ses: ses });
    } else {
      bucket(sDs).segs.push({ startMin: sMin, endMin: 1440, ses: ses });
      var d = moment(sDs).add(1, 'day');
      var guard = 0;
      while (d.format('YYYY-MM-DD') < eDs && guard < 31) {
        bucket(d.format('YYYY-MM-DD')).segs.push({ startMin: 0, endMin: 1440, ses: ses });
        d.add(1, 'day');
        guard++;
      }
      if (eMin > 0 && eDs <= end) bucket(eDs).segs.push({ startMin: 0, endMin: eMin, ses: ses });
    }
  }

  var comps = analyze.getCompletionsInRange(start, end);
  for (var j = 0; j < comps.length; j++) bucket(comps[j].ds).comps.push(comps[j]);

  for (var ds in days) {
    days[ds].segs.sort(function(a, b) { return a.startMin - b.startMin; });
  }
  return days;
};

/* ------------------------------ lifecycle ------------------------------ */

/**
 * Show the analyze view
 */
analyze.show = function() {
  // Also repairs a corrupted anchor: controls are clickable during the view
  // slide-in before show() runs, and moment('') formats to 'Invalid date'
  if (!analyze.anchor || !moment(analyze.anchor).isValid()) {
    analyze.anchor = analyze.reviewToday();
  }

  try {
    var prefs = JSON.parse(localStorage.ttReviewPrefs || '{}');
    if (typeof prefs.round15 === 'boolean') analyze.billing.round15 = prefs.round15;
    if (typeof prefs.rate === 'number' && isFinite(prefs.rate)) analyze.billing.rate = prefs.rate;
    if (typeof prefs.showNonBillable === 'boolean') analyze.billing.showNonBillable = prefs.showNonBillable;
  } catch (e) {}

  analyze.initPickers();

  addEventWatcher('task', 'updated', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('task', 'added', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('task', 'deleted', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('node', 'updated', function() { analyze.refresh(); }, 'analyze');
  addEventWatcher('server', 'synch', function() { analyze.refresh(); }, 'analyze');

  // Keep the live session block / stats current while tracking
  analyze._tick = setInterval(function() {
    if (localStorage.ttSessionId) analyze.refresh();
  }, 60000);

  analyze.refresh();
};

/**
 * Hide the analyze view
 */
analyze.hide = function() {
  removeEventWatchers('analyze');
  if (analyze._tick) {
    clearInterval(analyze._tick);
    analyze._tick = null;
  }
};

/**
 * Update the analyze view
 */
analyze.update = function() {
  analyze.refresh();
};

/**
 * Initialize Pikaday pickers for the custom range
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
 * Read custom range from the picker inputs
 */
analyze.setCustomDates = function() {
  var startField = gebi('analyze-start-date');
  var endField = gebi('analyze-end-date');
  if (!startField || !endField || !startField.value || !endField.value) return;

  var s = startField.value;
  var e = endField.value;
  if (e < s) { var t = s; s = e; e = t; }
  analyze.customRange = { start: s, end: e };
  analyze.refresh();
};

/* ------------------------------ controls ------------------------------ */

analyze.setTab = function(tab) {
  analyze.tab = tab;
  analyze.refresh();
};

analyze.setCalView = function(view) {
  analyze.calView = view;
  analyze.refresh();
};

analyze.calNav = function(dir) {
  var unit = analyze.calView === 'day' ? 'day' : analyze.calView === 'week' ? 'week' : 'month';
  var m = moment(analyze.anchor);
  if (!m.isValid()) m = moment(analyze.reviewToday());
  analyze.anchor = m.add(dir, unit).format('YYYY-MM-DD');
  analyze.refresh();
};

analyze.calToday = function() {
  analyze.anchor = analyze.reviewToday();
  analyze.refresh();
};

/**
 * Jump to a specific day (from week headers / month cells)
 */
analyze.calGoto = function(ds) {
  analyze.tab = 'calendar';
  analyze.calView = 'day';
  analyze.anchor = ds;
  analyze.refresh();
};

analyze.setProjPreset = function(preset) {
  analyze.projPreset = preset;
  if (preset === 'custom' && (!analyze.customRange.start || !analyze.customRange.end)) {
    var r = analyze.getReviewRange('month');
    analyze.customRange = r;
    var sf = gebi('analyze-start-date');
    var ef = gebi('analyze-end-date');
    if (sf) sf.value = r.start;
    if (ef) ef.value = r.end;
  }
  analyze.refresh();
};

analyze.projDrill = function(nodeId) {
  analyze.projPath.push(nodeId);
  analyze.refresh();
};

analyze.projJump = function(level) {
  analyze.projPath = analyze.projPath.slice(0, level);
  analyze.refresh();
};

/**
 * Same presets as getDateRange, but "now" honors the 3 AM day cutoff.
 * getDateRange itself is shared (tree Recent filter, share viewer) and
 * keeps true calendar days.
 */
analyze.getReviewRange = function(preset) {
  var now = moment().subtract(3, 'hours');
  var start, end;

  switch (preset) {
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
    default:
      start = now.clone().startOf('month');
      end = now.clone();
  }

  return {
    start: start.format('YYYY-MM-DD'),
    end: end.format('YYYY-MM-DD')
  };
};

/**
 * Effective Projects-lens date range
 */
analyze.projRangeOf = function() {
  if (analyze.projPreset === 'custom') return analyze.customRange;
  return analyze.getReviewRange(analyze.projPreset);
};

/* ------------------------------ billing prefs ------------------------------ */

analyze.savePrefs = function() {
  try {
    localStorage.ttReviewPrefs = JSON.stringify(analyze.billing);
  } catch (e) {}
};

analyze.setRound = function(checked) {
  analyze.billing.round15 = !!checked;
  analyze.savePrefs();
  analyze.refresh();
};

analyze.setShowNonBillable = function(checked) {
  analyze.billing.showNonBillable = !!checked;
  analyze.savePrefs();
  analyze.refresh();
};

analyze.setRate = function(value) {
  var r = parseFloat(value);
  analyze.billing.rate = (isFinite(r) && r >= 0) ? r : 0;
  analyze.savePrefs();
  analyze.refresh();
};

/**
 * Billable seconds for one session, honoring the round-up-to-15-min toggle
 */
analyze.billSecs = function(secs) {
  if (!analyze.billing.round15) return secs;
  return Math.ceil(secs / 900) * 900;
};

analyze.formatMoney = function(amount) {
  return '$' + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/**
 * Download the current ledger as CSV
 */
analyze.exportCSV = function() {
  if (!analyze._csvRows.length) return;
  var lines = ['line_item,date,start,end,task,minutes,billable_hours'];
  for (var i = 0; i < analyze._csvRows.length; i++) {
    lines.push(analyze._csvRows[i].join(','));
  }
  var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  var a = document.createElement('a');
  var scopeName = 'all';
  var parentId = analyze.projParentId();
  if (parentId) {
    var node = getNode(parentId);
    if (node) scopeName = node.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }
  var range = analyze.projRangeOf();
  a.href = URL.createObjectURL(blob);
  a.download = 'taakl-' + scopeName + '-' + range.start + '-' + range.end + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

/* ------------------------------ refresh ------------------------------ */

/**
 * Master refresh: sync control states, render the active lens into #rv-body
 */
analyze.refresh = function() {
  var body = gebi('rv-body');
  if (!body) return;

  var isCal = analyze.tab === 'calendar';
  var i;

  var tabs = document.querySelectorAll('#analyze-tabs .analyze-tab');
  for (i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].dataset.tab === analyze.tab);
  }

  var calCtl = gebi('rv-cal-controls');
  var projCtl = gebi('rv-proj-controls');
  if (calCtl) calCtl.style.display = isCal ? 'flex' : 'none';
  if (projCtl) projCtl.style.display = isCal ? 'none' : 'block';

  if (isCal) {
    var segBtns = document.querySelectorAll('#rv-cal-seg .range-btn');
    for (i = 0; i < segBtns.length; i++) {
      segBtns[i].classList.toggle('active', segBtns[i].dataset.cal === analyze.calView);
    }
    var title = gebi('rv-cal-title');
    if (title) title.innerHTML = analyze.calTitle();

    if (analyze.calView === 'day') body.innerHTML = analyze.renderCalDay();
    else if (analyze.calView === 'week') body.innerHTML = analyze.renderCalWeek();
    else body.innerHTML = analyze.renderCalMonth();
  } else {
    var rangeBtns = document.querySelectorAll('#rv-proj-ranges .range-btn');
    for (i = 0; i < rangeBtns.length; i++) {
      rangeBtns[i].classList.toggle('active', rangeBtns[i].dataset.preset === analyze.projPreset);
    }
    var custom = gebi('analyze-custom-dates');
    if (custom) custom.style.display = analyze.projPreset === 'custom' ? 'flex' : 'none';

    body.innerHTML = analyze.renderProjects();
  }
};

analyze.calTitle = function() {
  var m = moment(analyze.anchor);
  if (analyze.calView === 'day') return m.format('dddd, MMMM D, YYYY');
  if (analyze.calView === 'week') {
    var a = m.clone().startOf('isoWeek');
    var b = a.clone().add(6, 'day');
    if (a.month() === b.month()) return a.format('MMMM D') + ' – ' + b.format('D, YYYY');
    return a.format('MMM D') + ' – ' + b.format('MMM D, YYYY');
  }
  return m.format('MMMM YYYY');
};

/* ------------------------------ calendar lens ------------------------------ */

analyze.DAY_PX = 56;   // px per hour in the day view
analyze.WEEK_PX = 42;  // px per hour in the week view (must match .rv-wg-lines CSS)

analyze.renderCalDay = function() {
  var ds = analyze.anchor;
  var days = analyze.getCalendarDays(ds, ds);
  var day = days[ds] || { segs: [], comps: [] };
  var isToday = ds === analyze.reviewToday();

  var html = '<div class="rv-day-layout">';
  html += '<div class="rv-card rv-cal-card">' + analyze.dayCanvasHTML(day, isToday) + '</div>';
  html += '<div class="rv-stats">' + analyze.calStatsHTML('day', [ds], days) + '</div>';
  html += '</div>';
  return html;
};

/**
 * The positioned day column: hour grid, session blocks, completion markers
 */
analyze.dayCanvasHTML = function(day, isToday) {
  var nowMin = analyze.dispMinOf(moment().format('YYYY-MM-DD HH:mm:ss'));
  var i;

  if (day.segs.length === 0 && day.comps.length === 0) {
    return '<div class="rv-empty">Nothing tracked this day.</div>';
  }

  var minM = 24 * 60, maxM = 0;
  for (i = 0; i < day.segs.length; i++) {
    if (day.segs[i].startMin < minM) minM = day.segs[i].startMin;
    if (day.segs[i].endMin > maxM) maxM = day.segs[i].endMin;
  }
  for (i = 0; i < day.comps.length; i++) {
    if (day.comps[i].disp < minM) minM = day.comps[i].disp;
    if (day.comps[i].disp > maxM) maxM = day.comps[i].disp;
  }
  if (isToday && nowMin > maxM) maxM = nowMin;

  var h0 = Math.max(0, Math.floor(minM / 60));
  var h1 = Math.min(24, Math.ceil(maxM / 60));
  if (h1 - h0 < 6) h1 = Math.min(24, h0 + 6);
  var px = analyze.DAY_PX;

  function y(min) { return Math.round((min - h0 * 60) / 60 * px); }

  var html = '<div class="rv-day-canvas" style="height:' + ((h1 - h0) * px + 14) + 'px">';

  for (var h = h0; h <= h1; h++) {
    html += '<div class="rv-hline" style="top:' + y(h * 60) + 'px"></div>';
    html += '<div class="rv-hlabel" style="top:' + y(h * 60) + 'px">' + analyze.clockOf(h * 60) + '</div>';
  }

  for (i = 0; i < day.segs.length; i++) {
    var seg = day.segs[i];
    var ses = seg.ses;
    var color = analyze.getNodeColor(ses.path[0].id);
    var ht = Math.max(12, y(seg.endMin) - y(seg.startMin) - 2);
    var size = ht >= 46 ? 'tall' : (ht >= 26 ? 'mid' : 'slim');
    var crumb = analyze.pathNames(ses.path, 0, ses.path.length - 1);
    var timeStr = analyze.clockOf(seg.startMin) + '–' + (ses.live ? 'now' : analyze.clockOf(seg.endMin));
    var durStr = analyze.formatDuration((seg.endMin - seg.startMin) * 60);
    var tip = analyze.pathNames(ses.path, 0, ses.path.length) + '\n' + timeStr + ' · ' + durStr +
              (ses.live ? ' · tracking now' : '');

    html += '<div class="rv-block rv-' + size + (ses.live ? ' rv-live' : '') + '"' +
            ' title="' + analyze.escAttr(tip) + '"' +
            ' style="top:' + y(seg.startMin) + 'px;height:' + ht + 'px;border-left-color:' + color +
            ';background:' + analyze.rgba(color, 0.12) + '">';
    html += '<div class="rv-block-line"><span class="rv-block-task">' + escapeHtml(ses.taskName) + '</span>' +
            '<span class="rv-block-time">' + timeStr + ' · ' + durStr + '</span></div>';
    if (size === 'tall' && crumb) {
      html += '<div class="rv-block-crumb">' + escapeHtml(crumb) + '</div>';
    }
    html += '</div>';
  }

  for (i = 0; i < day.comps.length; i++) {
    var c = day.comps[i];
    var ccolor = analyze.getNodeColor(c.path[0].id);
    var ctip = analyze.pathNames(c.path, 0, c.path.length) + '\nmarked complete at ' + analyze.clockOf(c.disp);
    html += '<div class="rv-comp-line" style="top:' + y(c.disp) + 'px;border-color:' + ccolor + '"></div>';
    html += '<div class="rv-comp-chip" title="' + analyze.escAttr(ctip) + '" style="top:' + y(c.disp) + 'px">' +
            '<span class="rv-comp-check" style="color:' + ccolor + '">✓</span>' + escapeHtml(c.name) +
            '<span class="rv-comp-time">' + analyze.clockOf(c.disp) + '</span></div>';
  }

  if (isToday && nowMin >= h0 * 60 && nowMin <= h1 * 60) {
    html += '<div class="rv-now-line" style="top:' + y(nowMin) + 'px"><span>' + analyze.clockOf(nowMin) + '</span></div>';
  }

  html += '</div>';
  return html;
};

analyze.renderCalWeek = function() {
  var mon = moment(analyze.anchor).startOf('isoWeek');
  var dayList = [];
  var i, j;
  for (i = 0; i < 7; i++) dayList.push(mon.clone().add(i, 'day').format('YYYY-MM-DD'));

  var days = analyze.getCalendarDays(dayList[0], dayList[6]);
  var today = analyze.reviewToday();

  var minM = 5 * 60, maxM = 15 * 60; /* display minutes: 08:00–18:00 wall clock */
  for (i = 0; i < 7; i++) {
    var dd = days[dayList[i]];
    if (!dd) continue;
    for (j = 0; j < dd.segs.length; j++) {
      if (dd.segs[j].startMin < minM) minM = dd.segs[j].startMin;
      if (dd.segs[j].endMin > maxM) maxM = dd.segs[j].endMin;
    }
    for (j = 0; j < dd.comps.length; j++) {
      if (dd.comps[j].disp < minM) minM = dd.comps[j].disp;
      if (dd.comps[j].disp > maxM) maxM = dd.comps[j].disp;
    }
  }
  var h0 = Math.floor(minM / 60);
  var h1 = Math.min(24, Math.ceil(maxM / 60));
  var px = analyze.WEEK_PX;
  var height = (h1 - h0) * px;

  function y(min) { return Math.round((min - h0 * 60) / 60 * px); }

  var html = '<div class="rv-card rv-cal-card">';

  html += '<div class="rv-week-head"><div></div>';
  for (i = 0; i < 7; i++) {
    var ds = dayList[i];
    var totSecs = 0;
    var dData = days[ds] || { segs: [], comps: [] };
    for (j = 0; j < dData.segs.length; j++) {
      totSecs += (dData.segs[j].endMin - dData.segs[j].startMin) * 60;
    }
    var dm = moment(ds);
    html += '<button class="rv-wh-day' + (ds === today ? ' rv-today' : '') + '" onclick="analyze.calGoto(\'' + ds + '\')">' +
            '<span class="rv-wh-name">' + dm.format('ddd') + '</span>' +
            '<span class="rv-wh-num">' + dm.date() + '</span>' +
            '<span class="rv-wh-tot">' + (totSecs ? analyze.formatDuration(totSecs) : '·') + '</span></button>';
  }
  html += '</div>';

  html += '<div class="rv-week-grid" style="height:' + height + 'px">';
  html += '<div class="rv-wg-lines"></div>';
  html += '<div class="rv-wg-gutter">';
  for (var h = h0; h < h1; h++) {
    html += '<div class="rv-hlabel" style="top:' + y(h * 60) + 'px">' + analyze.clockOf(h * 60) + '</div>';
  }
  html += '</div>';

  for (i = 0; i < 7; i++) {
    var colDs = dayList[i];
    var col = days[colDs] || { segs: [], comps: [] };
    var dow = moment(colDs).isoWeekday();
    html += '<div class="rv-wcol' + (dow >= 6 ? ' rv-wknd' : '') + (colDs === today ? ' rv-today' : '') + '">';

    for (j = 0; j < col.segs.length; j++) {
      var seg = col.segs[j];
      var color = analyze.getNodeColor(seg.ses.path[0].id);
      var ht = Math.max(4, y(seg.endMin) - y(seg.startMin) - 1);
      var tip = analyze.pathNames(seg.ses.path, 0, seg.ses.path.length) + '\n' +
                analyze.clockOf(seg.startMin) + '–' + (seg.ses.live ? 'now' : analyze.clockOf(seg.endMin)) +
                ' · ' + analyze.formatDuration((seg.endMin - seg.startMin) * 60);
      html += '<div class="rv-wblock" title="' + analyze.escAttr(tip) + '"' +
              ' style="top:' + y(seg.startMin) + 'px;height:' + ht + 'px;border-left-color:' + color +
              ';background:' + analyze.rgba(color, 0.16) + '">' +
              (ht >= 15 ? escapeHtml(seg.ses.taskName) : '') + '</div>';
    }

    for (j = 0; j < col.comps.length; j++) {
      var c = col.comps[j];
      var ccolor = analyze.getNodeColor(c.path[0].id);
      var ctip = analyze.pathNames(c.path, 0, c.path.length) + '\n✓ complete at ' + analyze.clockOf(c.disp);
      html += '<div class="rv-wcomp" title="' + analyze.escAttr(ctip) + '"' +
              ' style="top:' + y(c.disp) + 'px;border-color:' + ccolor + '"></div>';
    }

    html += '</div>';
  }
  html += '</div></div>';

  html += '<div class="rv-stats rv-stats-row">' + analyze.calStatsHTML('week', dayList, days) + '</div>';
  return html;
};

analyze.renderCalMonth = function() {
  var m0 = moment(analyze.anchor).startOf('month');
  var gridStart = m0.clone().startOf('isoWeek');
  var gridEnd = m0.clone().endOf('month').endOf('isoWeek');
  var days = analyze.getCalendarDays(gridStart.format('YYYY-MM-DD'), gridEnd.format('YYYY-MM-DD'));
  var today = analyze.reviewToday();
  var i, j;

  var html = '<div class="rv-card rv-cal-card">';
  html += '<div class="rv-month-dow">';
  var dowNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (i = 0; i < 7; i++) html += '<span>' + dowNames[i] + '</span>';
  html += '</div><div class="rv-month-grid">';

  var d = gridStart.clone();
  while (d.isSameOrBefore(gridEnd, 'day')) {
    var ds = d.format('YYYY-MM-DD');
    var inMonth = d.month() === m0.month();
    var future = ds > today;
    var day = days[ds] || { segs: [], comps: [] };

    // Aggregate the cell's time by top-level ancestor
    var cats = {};
    var catOrder = [];
    var totSecs = 0;
    for (j = 0; j < day.segs.length; j++) {
      var seg = day.segs[j];
      var secs = (seg.endMin - seg.startMin) * 60;
      totSecs += secs;
      var top = seg.ses.path[0];
      if (!cats[top.id]) {
        cats[top.id] = { id: top.id, name: top.name, secs: 0 };
        catOrder.push(top.id);
      }
      cats[top.id].secs += secs;
    }
    var catList = [];
    for (j = 0; j < catOrder.length; j++) catList.push(cats[catOrder[j]]);
    catList.sort(function(a, b) { return b.secs - a.secs; });

    var cls = (inMonth ? '' : ' rv-out') + (future ? ' rv-future' : '') + (ds === today ? ' rv-today' : '');
    html += '<div class="rv-mcell' + cls + '" onclick="analyze.calGoto(\'' + ds + '\')">';
    html += '<div class="rv-mc-top"><span class="rv-mc-num">' + d.date() + '</span>';
    if (day.comps.length) html += '<span class="rv-mc-done">✓' + day.comps.length + '</span>';
    html += '</div>';

    if (totSecs) {
      html += '<div class="rv-mc-chips">';
      for (j = 0; j < catList.length && j < 3; j++) {
        var cat = catList[j];
        var color = analyze.getNodeColor(cat.id);
        html += '<span class="rv-mchip" title="' + analyze.escAttr(cat.name + ' — ' + analyze.formatDuration(cat.secs)) + '">' +
                '<i style="background:' + color + '"></i>' + analyze.fmtH(cat.secs) +
                '<span class="rv-mc-cat">' + escapeHtml(cat.name) + '</span></span>';
      }
      if (catList.length > 3) {
        html += '<span class="rv-mchip"><span class="rv-mc-cat">+' + (catList.length - 3) + ' more</span></span>';
      }
      html += '</div>';
      html += '<div class="rv-mc-tot">' + analyze.formatDuration(totSecs) + '</div>';
    }
    html += '</div>';
    d.add(1, 'day');
  }
  html += '</div></div>';

  // Stats over the calendar month only (not the grid's out-of-month days)
  var dayList = [];
  var dm = m0.clone();
  for (i = 0; i < m0.daysInMonth(); i++) {
    dayList.push(dm.format('YYYY-MM-DD'));
    dm.add(1, 'day');
  }
  html += '<div class="rv-stats rv-stats-row">' + analyze.calStatsHTML('month', dayList, days) + '</div>';
  return html;
};

/**
 * Stats cards for the calendar lens; scope = 'day' | 'week' | 'month'
 */
analyze.calStatsHTML = function(scope, dayList, daysData) {
  var totalSecs = 0, compCount = 0, sesCount = 0;
  var sesSeen = {};
  var doneSeen = {}, estSecs = 0, actSecs = 0, estCount = 0;
  var cats = {}, catOrder = [];
  var firstMin = null, lastMin = null;
  var longest = null, live = null;
  var perDay = [];
  var i, j;

  for (i = 0; i < dayList.length; i++) {
    var ds = dayList[i];
    var day = daysData[ds] || { segs: [], comps: [] };
    var daySecs = 0;

    for (j = 0; j < day.segs.length; j++) {
      var seg = day.segs[j];
      var secs = (seg.endMin - seg.startMin) * 60;
      totalSecs += secs;
      daySecs += secs;

      var top = seg.ses.path[0];
      if (!cats[top.id]) {
        cats[top.id] = { id: top.id, name: top.name, secs: 0 };
        catOrder.push(top.id);
      }
      cats[top.id].secs += secs;

      if (!sesSeen[seg.ses.id]) {
        sesSeen[seg.ses.id] = true;
        sesCount++;
        if (!longest || seg.ses.durationSecs > longest.durationSecs) longest = seg.ses;
        if (seg.ses.live) live = seg.ses;
      }
      if (firstMin === null || seg.startMin < firstMin) firstMin = seg.startMin;
      if (lastMin === null || seg.endMin > lastMin) lastMin = seg.endMin;
    }

    compCount += day.comps.length;
    // Estimate vs actual for tasks completed in range (each node once);
    // "actual" is the node's lifetime tracked time incl. descendants.
    for (j = 0; j < day.comps.length; j++) {
      var dnId = day.comps[j].nodeId;
      if (doneSeen[dnId]) continue;
      doneSeen[dnId] = true;
      var dnode = getNode(dnId);
      if (dnode && dnode.estimate > 0) {
        estSecs += dnode.estimate;
        actSecs += calculateNodeTime(dnId);
        estCount++;
      }
    }
    perDay.push({ ds: ds, secs: daySecs, comps: day.comps.length });
  }

  var catList = [];
  for (i = 0; i < catOrder.length; i++) catList.push(cats[catOrder[i]]);
  catList.sort(function(a, b) { return b.secs - a.secs; });

  var html = '';

  // Hero card
  html += '<div class="rv-card rv-stat-card">';
  html += '<div class="rv-stat-label">Tracked</div>';
  html += '<div class="rv-stat-big">' + (totalSecs ? analyze.formatDuration(totalSecs) : '—') + '</div>';
  if (live) {
    html += '<div class="rv-live-line">Tracking now — <b>' + escapeHtml(live.taskName) + '</b> · since ' +
            analyze.fmtClock(analyze.minOfDay(live.start_time)) + '</div>';
  }
  html += '<div class="rv-stat-grid">';
  html += '<div><b>' + sesCount + '</b><span>sessions</span></div>';
  html += '<div><b>' + compCount + '</b><span>completed</span></div>';
  if (scope === 'day') {
    html += '<div><b>' + (firstMin !== null ? analyze.clockOf(firstMin) : '—') + '</b><span>first start</span></div>';
    html += '<div><b>' + (lastMin !== null ? analyze.clockOf(lastMin) : '—') + '</b><span>last stop</span></div>';
    html += '<div><b>' + (longest ? analyze.formatDuration(longest.durationSecs) : '—') + '</b><span>longest session</span></div>';
    html += '<div><b>' + (sesCount ? analyze.formatDuration(totalSecs / sesCount) : '—') + '</b><span>avg session</span></div>';
  } else {
    var activeDays = 0;
    var busiest = null;
    for (i = 0; i < perDay.length; i++) {
      if (perDay[i].secs > 0) activeDays++;
      if (!busiest || perDay[i].secs > busiest.secs) busiest = perDay[i];
    }
    html += '<div><b>' + activeDays + '</b><span>active days</span></div>';
    html += '<div><b>' + (activeDays ? analyze.formatDuration(totalSecs / activeDays) : '—') + '</b><span>avg / active day</span></div>';
    if (busiest && busiest.secs > 0) {
      html += '<div><b>' + moment(busiest.ds).format('ddd D') + '</b><span>busiest day</span></div>';
      html += '<div><b>' + analyze.formatDuration(busiest.secs) + '</b><span>on busiest day</span></div>';
    }
  }
  if (estCount) {
    html += '<div><b>' + analyze.formatDuration(estSecs) + '</b><span>estimated (completed)</span></div>';
    html += '<div><b class="' + (actSecs <= estSecs ? 'rv-under' : 'rv-over') + '">' +
            analyze.formatDuration(actSecs) + '</b><span>actual (completed)</span></div>';
  }
  html += '</div></div>';

  // Category card
  html += '<div class="rv-card rv-stat-card">';
  html += '<div class="rv-stat-label">By top-level item</div>';
  if (!catList.length) {
    html += '<div class="rv-empty-small">No time tracked.</div>';
  } else {
    var maxSecs = catList[0].secs;
    for (i = 0; i < catList.length; i++) {
      var cat = catList[i];
      var color = analyze.getNodeColor(cat.id);
      html += '<div class="rv-cat-row">' +
              '<span class="rv-cat-name"><i style="background:' + color + '"></i>' + escapeHtml(cat.name) + '</span>' +
              '<span class="rv-cat-bar"><em style="width:' + Math.round(cat.secs / maxSecs * 100) + '%;background:' + color + '"></em></span>' +
              '<span class="rv-cat-time">' + analyze.formatDuration(cat.secs) + '</span></div>';
    }
  }
  html += '</div>';

  // Third card: completed list (day) or daily rhythm (week/month)
  if (scope === 'day') {
    var comps = (daysData[dayList[0]] || { comps: [] }).comps;
    html += '<div class="rv-card rv-stat-card">';
    html += '<div class="rv-stat-label">Completed (' + comps.length + ')</div>';
    if (!comps.length) {
      html += '<div class="rv-empty-small">Nothing marked complete.</div>';
    } else {
      html += '<ul class="rv-done-list">';
      for (i = 0; i < comps.length; i++) {
        var c = comps[i];
        var crumb = analyze.pathNames(c.path, 0, c.path.length - 1);
        var estHtml = '';
        var cNode = getNode(c.nodeId);
        if (cNode && cNode.estimate > 0) {
          var cAct = calculateNodeTime(c.nodeId);
          estHtml = '<span class="rv-done-est">est ' + analyze.formatDuration(cNode.estimate) +
                    ' · <em class="' + (cAct <= cNode.estimate ? 'rv-under' : 'rv-over') + '">' +
                    analyze.formatDuration(cAct) + '</em></span>';
        }
        html += '<li><span class="rv-done-time">' + analyze.clockOf(c.disp) + '</span>' +
                '<span class="rv-done-check" style="color:' + analyze.getNodeColor(c.path[0].id) + '">✓</span>' +
                '<span>' + escapeHtml(c.name) +
                (crumb ? '<span class="rv-done-crumb">' + escapeHtml(crumb) + '</span>' : '') +
                estHtml + '</span></li>';
      }
      html += '</ul>';
    }
    html += '</div>';
  } else {
    var maxDay = 1;
    for (i = 0; i < perDay.length; i++) {
      if (perDay[i].secs > maxDay) maxDay = perDay[i].secs;
    }
    var todayDs = analyze.reviewToday();
    html += '<div class="rv-card rv-stat-card">';
    html += '<div class="rv-stat-label">Daily rhythm</div>';
    html += '<div class="rv-spark' + (scope === 'month' ? ' rv-spark-month' : '') + '">';
    for (i = 0; i < perDay.length; i++) {
      var pd = perDay[i];
      var pm = moment(pd.ds);
      var isWknd = pm.isoWeekday() >= 6;
      var tip = pm.format('ddd MMM D') + '\n' +
                (pd.secs ? analyze.formatDuration(pd.secs) + ' tracked' : 'nothing tracked') +
                (pd.comps ? ' · ' + pd.comps + ' done' : '');
      var label = scope === 'week' ? pm.format('dd').charAt(0) : String(pm.date());
      html += '<div class="rv-sp' + (isWknd ? ' rv-wknd' : '') + (pd.ds === todayDs ? ' rv-today' : '') + '"' +
              ' title="' + analyze.escAttr(tip) + '">' +
              '<b style="height:' + Math.max(2, Math.round(pd.secs / maxDay * 100)) + '%"></b>' +
              '<span>' + label + '</span></div>';
    }
    html += '</div></div>';
  }

  return html;
};

/* ------------------------------ projects lens ------------------------------ */

analyze.csvQuote = function(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
};

analyze.renderProjects = function() {
  var range = analyze.projRangeOf();
  var parentId = analyze.projParentId();
  var i, j;

  var sessions = analyze.getSessionsForDays(range.start, range.end);
  var scoped = [];
  for (i = 0; i < sessions.length; i++) {
    if (!parentId || analyze.pathHasNode(sessions[i].path, parentId)) scoped.push(sessions[i]);
  }

  var totalAllSecs = 0;
  for (i = 0; i < sessions.length; i++) totalAllSecs += sessions[i].durationSecs;

  var totalSecs = 0;
  var activeSet = {};
  var live = null;
  for (i = 0; i < scoped.length; i++) {
    totalSecs += scoped[i].durationSecs;
    activeSet[analyze.dayOf(scoped[i].start_time)] = true;
    if (scoped[i].live) live = scoped[i];
  }
  var activeDays = 0;
  for (var ak in activeSet) activeDays++;
  var totalDays = moment(range.end).diff(moment(range.start), 'days') + 1;

  var allComps = analyze.getCompletionsInRange(range.start, range.end);
  var comps = [];
  for (i = 0; i < allComps.length; i++) {
    if (!parentId || analyze.pathHasNode(allComps[i].path, parentId)) comps.push(allComps[i]);
  }

  var kids = analyze.aggregateScope(scoped, parentId);
  for (i = 0; i < kids.length; i++) {
    kids[i].color = kids[i].nodeId ? analyze.getNodeColor(kids[i].nodeId) : '#999999';
  }

  var html = '';

  /* breadcrumb */
  html += '<div class="rv-crumb-bar">';
  html += '<button class="rv-crumb' + (parentId ? '' : ' rv-here') + '" onclick="analyze.projJump(0)">All</button>';
  for (i = 0; i < analyze.projPath.length; i++) {
    var pn = getNode(analyze.projPath[i]);
    var here = i === analyze.projPath.length - 1;
    html += '<span class="rv-crumb-sep">›</span>';
    html += '<button class="rv-crumb' + (here ? ' rv-here' : '') + '" onclick="analyze.projJump(' + (i + 1) + ')">' +
            escapeHtml(pn ? pn.name : '?') + '</button>';
  }
  html += '</div>';

  /* hero strip */
  var share = totalAllSecs ? Math.round(totalSecs / totalAllSecs * 100) : 0;
  html += '<div class="rv-proj-hero">';
  html += '<div class="rv-ph-cell rv-lead"><b>' + (totalSecs ? analyze.formatDuration(totalSecs) : '—') + '</b><span>tracked in range</span></div>';
  html += '<div class="rv-ph-cell"><b>' + share + '%</b><span>of all tracked time</span></div>';
  html += '<div class="rv-ph-cell"><b>' + scoped.length + '</b><span>sessions</span></div>';
  html += '<div class="rv-ph-cell"><b>' + activeDays + '<em>/' + totalDays + '</em></b><span>active days</span></div>';
  html += '<div class="rv-ph-cell"><b>' + (activeDays ? analyze.formatDuration(totalSecs / activeDays) : '—') + '</b><span>avg / active day</span></div>';
  html += '<div class="rv-ph-cell"><b>' + comps.length + '</b><span>completed</span></div>';
  html += '</div>';
  if (live) {
    html += '<div class="rv-live-line rv-proj-live">Tracking now — <b>' + escapeHtml(live.taskName) + '</b> · since ' +
            analyze.fmtClock(analyze.minOfDay(live.start_time)) + '</div>';
  }

  html += '<div class="rv-proj-grid">';

  /* breakdown card */
  var anyDrill = false;
  for (i = 0; i < kids.length; i++) {
    if (kids[i].hasChildren) anyDrill = true;
  }
  html += '<div class="rv-card rv-pcard">';
  html += '<div class="rv-pcard-head"><span class="rv-stat-label">Where the time went</span>' +
          (anyDrill ? '<span class="rv-hint">click a row to drill in</span>' : '') + '</div>';
  if (!kids.length) {
    html += '<div class="rv-empty-small">No time tracked here in this range.</div>';
  } else {
    var maxSecs = kids[0].totalSecs;
    for (i = 0; i < kids.length; i++) {
      var g = kids[i];
      var open = g.hasChildren ?
        '<button class="rv-bd-row rv-drill" onclick="analyze.projDrill(\'' + g.nodeId + '\')">' :
        '<div class="rv-bd-row">';
      var close = g.hasChildren ? '</button>' : '</div>';
      html += open;
      html += '<span class="rv-bd-name"><i style="background:' + g.color + '"></i>' + escapeHtml(g.nodeName) +
              (g.hasChildren ? ' <em class="rv-bd-arrow">›</em>' : '') +
              ' <em class="rv-bd-count">' + g.sessionCount + '×</em></span>';
      html += '<span class="rv-bd-meta"><b>' + analyze.formatDuration(g.totalSecs) + '</b> · ' +
              (totalSecs ? Math.round(g.totalSecs / totalSecs * 100) : 0) + '%</span>';
      html += '<span class="rv-bd-track"><em style="width:' + Math.round(g.totalSecs / maxSecs * 100) + '%;background:' + g.color + '"></em></span>';
      html += close;
    }
  }
  html += '</div>';

  /* right column: trend + completed */
  html += '<div class="rv-proj-col">';

  html += '<div class="rv-card rv-pcard">';
  html += '<div class="rv-pcard-head"><span class="rv-stat-label">Daily trend</span>' +
          '<span class="rv-hint">stacked by the rows at left</span></div>';
  if (!scoped.length) {
    html += '<div class="rv-empty-small">Nothing to plot.</div>';
  } else {
    var dayKeys = [];
    var dcur = moment(range.start);
    var guard = 0;
    while (dcur.format('YYYY-MM-DD') <= range.end && guard < 400) {
      dayKeys.push(dcur.format('YYYY-MM-DD'));
      dcur.add(1, 'day');
      guard++;
    }

    var topKids = kids.slice(0, 5);
    var topSet = {};
    for (i = 0; i < topKids.length; i++) topSet[topKids[i].nodeId || '__direct__'] = topKids[i];

    var byDay = {};
    for (i = 0; i < scoped.length; i++) {
      var ses = scoped[i];
      var ck = analyze.findChildAtLevel(ses.path, parentId);
      var key = ck || '__direct__';
      if (!topSet[key]) key = '__other__';
      var ds = analyze.dayOf(ses.start_time);
      if (!byDay[ds]) byDay[ds] = {};
      byDay[ds][key] = (byDay[ds][key] || 0) + ses.durationSecs;
    }

    var maxDaySecs = 1;
    for (i = 0; i < dayKeys.length; i++) {
      var dTot = 0;
      var dRow = byDay[dayKeys[i]];
      if (dRow) for (var dk in dRow) dTot += dRow[dk];
      if (dTot > maxDaySecs) maxDaySecs = dTot;
    }

    var stackOrder = topKids.slice();
    stackOrder.push({ nodeId: '__other__', nodeName: 'Other', color: '#b5b5b5' });

    html += '<div class="rv-trend">';
    for (i = 0; i < dayKeys.length; i++) {
      var colDs = dayKeys[i];
      var colRow = byDay[colDs] || {};
      var colTot = 0;
      var segsHtml = '';
      var tipLines = [];
      for (j = 0; j < stackOrder.length; j++) {
        var sk = stackOrder[j];
        var skKey = j < topKids.length ? (sk.nodeId || '__direct__') : '__other__';
        var secs = colRow[skKey];
        if (!secs) continue;
        colTot += secs;
        segsHtml += '<div class="rv-tr-seg" style="height:' + (secs / maxDaySecs * 100) + '%;background:' + sk.color + '"></div>';
        tipLines.push(sk.nodeName + ' — ' + analyze.formatDuration(secs));
      }
      var colTip = moment(colDs).format('ddd MMM D') +
                   (colTot ? '\n' + analyze.formatDuration(colTot) + '\n' + tipLines.join(' · ') : '\nnothing tracked');
      html += '<div class="rv-tr-col" title="' + analyze.escAttr(colTip) + '">' + segsHtml + '</div>';
    }
    html += '</div><div class="rv-tr-axis">';
    for (i = 0; i < dayKeys.length; i++) {
      var am = moment(dayKeys[i]);
      var label = dayKeys.length <= 7 ? am.format('dd').charAt(0) :
                  ((am.isoWeekday() === 1 || am.date() === 1) ? String(am.date()) : '');
      html += '<span>' + label + '</span>';
    }
    html += '</div>';
    html += '<div class="rv-trend-legend">';
    for (i = 0; i < stackOrder.length; i++) {
      if (i >= topKids.length && kids.length <= topKids.length) break;
      html += '<span><i style="background:' + stackOrder[i].color + '"></i>' + escapeHtml(stackOrder[i].nodeName) + '</span>';
    }
    html += '</div>';
  }
  html += '</div>';

  /* completed card */
  html += '<div class="rv-card rv-pcard">';
  html += '<div class="rv-stat-label">Completed in range (' + comps.length + ')</div>';
  if (!comps.length) {
    html += '<div class="rv-empty-small">Nothing marked complete in this range.</div>';
  } else {
    html += '<ul class="rv-done-list">';
    for (i = 0; i < comps.length && i < 8; i++) {
      var c = comps[i];
      var crumb = analyze.pathNames(c.path, 0, c.path.length - 1);
      html += '<li><span class="rv-done-time">' + moment(c.ds).format('MMM D') + ' ' + analyze.fmtClock(c.min) + '</span>' +
              '<span class="rv-done-check" style="color:' + analyze.getNodeColor(c.path[0].id) + '">✓</span>' +
              '<span>' + escapeHtml(c.name) +
              (crumb ? '<span class="rv-done-crumb">' + escapeHtml(crumb) + '</span>' : '') + '</span></li>';
    }
    html += '</ul>';
    if (comps.length > 8) html += '<div class="rv-empty-small">+' + (comps.length - 8) + ' more</div>';
  }
  html += '</div>';

  html += '</div></div>'; /* /rv-proj-col /rv-proj-grid */

  /* session ledger, grouped by immediate child = invoice line items */
  html += analyze.ledgerHTML(kids, scoped, totalSecs, parentId, range);

  return html;
};

/**
 * The billing ledger: one group per immediate child of the scope, sessions
 * itemized inside, billable hours honoring the round-up and billable flags.
 */
analyze.ledgerHTML = function(kids, scoped, totalSecs, parentId, range) {
  var i, j;
  var depth = analyze.projPath.length;
  var rate = analyze.billing.rate;
  var scopeLabel = 'all items';
  if (parentId) {
    var names = [];
    for (i = 0; i < analyze.projPath.length; i++) {
      var n = getNode(analyze.projPath[i]);
      names.push(n ? n.name : '?');
    }
    scopeLabel = names.join(' › ');
  }

  analyze._csvRows = [];
  var billTotalSecs = 0;

  var html = '<div class="rv-card rv-ledger">';
  html += '<div class="rv-ledger-head">';
  html += '<span class="rv-stat-label">Session ledger · ' + escapeHtml(scopeLabel) + ' · grouped as line items</span>';
  html += '<div class="rv-ledger-opts">';
  html += '<label><input type="checkbox"' + (analyze.billing.round15 ? ' checked' : '') +
          ' onclick="analyze.setRound(this.checked)"> Round up to 15 min</label>';
  html += '<label><input type="checkbox"' + (analyze.billing.showNonBillable ? ' checked' : '') +
          ' onclick="analyze.setShowNonBillable(this.checked)"> Show non-billable</label>';
  html += '<button class="range-btn" onclick="analyze.exportCSV()">Export CSV</button>';
  html += '</div></div>';

  if (!scoped.length) {
    html += '<div class="rv-empty-small" style="padding:15px">No sessions in this range.</div>';
    html += '</div>';
    return html;
  }

  html += '<div class="rv-ledger-scroll"><table class="rv-ledger-table">';

  for (i = 0; i < kids.length; i++) {
    var g = kids[i];
    var rows = g.sessions.slice().sort(function(a, b) {
      return a.start_time < b.start_time ? -1 : (a.start_time > b.start_time ? 1 : 0);
    });

    var groupBillSecs = 0;
    var nonBillCount = 0;
    for (j = 0; j < rows.length; j++) {
      if (analyze.sessionBillable(rows[j].path)) {
        groupBillSecs += analyze.billSecs(rows[j].durationSecs);
      } else {
        nonBillCount++;
      }
    }
    billTotalSecs += groupBillSecs;

    html += '<tr class="rv-ld-group"><td colspan="2">' +
            '<i class="rv-ld-dot" style="background:' + g.color + '"></i>' + escapeHtml(g.nodeName) +
            ' <span class="rv-ld-n">' + g.sessionCount + '×</span>' +
            (nonBillCount ? ' <span class="rv-ld-nobill-note">' + nonBillCount + ' non-billable</span>' : '') +
            '</td>';
    html += '<td class="rv-ld-sub" colspan="2">' + analyze.formatDuration(g.totalSecs) +
            ' · ' + analyze.fmtDecH(groupBillSecs) + ' h' +
            (rate > 0 ? ' · ' + analyze.formatMoney(groupBillSecs / 3600 * rate) : '') + '</td></tr>';

    var relFrom = g.direct ? depth : depth + 1;
    for (j = 0; j < rows.length; j++) {
      var ses = rows[j];
      var billable = analyze.sessionBillable(ses.path);
      var bSecs = billable ? analyze.billSecs(ses.durationSecs) : 0;
      var sMin = analyze.minOfDay(ses.start_time);
      var eMin = analyze.minOfDay(ses.end_time);
      var rel = relFrom < ses.path.length - 1 ? analyze.pathNames(ses.path, relFrom, ses.path.length - 1) : '';

      analyze._csvRows.push([
        analyze.csvQuote(g.nodeName),
        analyze.dayOf(ses.start_time),
        analyze.fmtClock(sMin),
        ses.live ? 'now' : analyze.fmtClock(eMin),
        analyze.csvQuote(analyze.pathNames(ses.path, 0, ses.path.length)),
        Math.round(ses.durationSecs / 60),
        analyze.fmtDecH(bSecs)
      ]);

      if (!billable && !analyze.billing.showNonBillable) continue;

      html += '<tr' + (billable ? '' : ' class="rv-ld-nobill"') + '>';
      html += '<td class="rv-ld-time">' + moment(analyze.dayOf(ses.start_time)).format('MMM DD') + ' · ' +
              analyze.fmtClock(sMin) + '–' + (ses.live ? 'now' : analyze.fmtClock(eMin)) + '</td>';
      html += '<td class="rv-ld-task"><b>' + escapeHtml(ses.taskName) + '</b>' +
              (rel ? '<span>' + escapeHtml(rel) + '</span>' : '') +
              (billable ? '' : '<span class="rv-ld-nobill-note">non-billable</span>') + '</td>';
      html += '<td class="rv-ld-dur">' + analyze.formatDuration(ses.durationSecs) + '</td>';
      html += '<td class="rv-ld-dec">' + (billable ? analyze.fmtDecH(bSecs) + ' h' : '—') + '</td>';
      html += '</tr>';
    }
  }

  html += '</table></div>';

  html += '<div class="rv-ledger-foot">';
  html += '<div class="rv-lf-item"><span>Tracked</span><b>' + analyze.formatDuration(totalSecs) + '</b></div>';
  html += '<div class="rv-lf-item"><span>Billable</span><b>' + analyze.fmtDecH(billTotalSecs) + ' h</b></div>';
  html += '<div class="rv-lf-item"><span>Rate / h</span><input type="number" min="0" step="1" class="rv-rate-input" value="' +
          analyze.billing.rate + '" onchange="analyze.setRate(this.value)"></div>';
  html += '<div class="rv-lf-item"><span>Amount</span><b>' +
          (rate > 0 ? analyze.formatMoney(billTotalSecs / 3600 * rate) : '—') + '</b></div>';
  html += '</div>';

  html += '</div>';
  return html;
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

  loadSharesList();

}


settingsView.hide = function(){
}

settingsView.save = function(){

  for(field in editFields.settings){
     ttData.settings[field] = gebi("settings-"+field+"input").value;
  }

  dbg("Settings after save",ttData.settings);
  ttSave();

  if (getSetting("auto_synch") == "yes" && isLoggedIn()) {
    startAutoSync();
  } else {
    stopAutoSync();
  }

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

  // Urgent icon
  var urgentClass = (task.urgent == "1") ? "urgent" : "";
  var urgentIcon = "<span class='task-urgent " + urgentClass +
    "' onclick=\"todayView.toggleNodeUrgent('" + task.id + "')\">&#128293;</span>";

  // Play button (clock indicator when this task's session is running)
  var isTracking = current_session && current_node && current_node.id === task.id;
  var playIcon = isTracking
    ? "<i onclick=\"treeView.startSession('" + task.id + "')\" title='Session in progress' style='cursor:pointer; color:#d9534f;' class='fa fa-clock-o fa-lg'></i>"
    : "<i onclick=\"treeView.startSession('" + task.id + "')\" style='cursor:pointer; color:#77aa88;' class='fa fa-play-circle fa-lg'></i>";

  // Edit handler
  var editHandler = "treeView.showEditForm('" + task.id + "')";

  taskDiv.innerHTML =
    "<div class='today-task-content' ondblclick=\"" + editHandler + "\">" +
      "<div class='today-task-main'>" +
        checkCompleted + " " + starIcon + " " + urgentIcon + " " + escapeHtml(task.truncateName) +
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

todayView.toggleNodeUrgent = function(nodeId) {
  var node = getNode(nodeId);
  if (!node) return;

  node.urgent = node.urgent === '1' ? '0' : '1';
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
  var entry = ttData.globalState && ttData.globalState.todayStarredOrder;
  if (entry && Array.isArray(entry.value)) return entry.value;
  // Legacy device-local order (pre-globalState)
  try {
    return JSON.parse(localStorage.todayStarredOrder || '[]');
  } catch(e) { return []; }
};

todayView.saveStarredOrder = function() {
  var order = todayView.starredTasks.map(function(t) { return t.id; });
  setGlobalState('todayStarredOrder', order);
  localStorage.todayStarredOrder = JSON.stringify(order); // mirror for rollback safety
  ttSave();
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
var autoSyncIntervalId = null;
var syncInProgress = false;

synchQueue.restore = function() {
  if (ttData.synchQueue && ttData.synchQueue.length > 0) {
    synchQueue.queue = ttData.synchQueue;
    console.log('[SYNC] Restored', synchQueue.queue.length, 'queued changes from localStorage');
  }
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

  // Deduplicate: remove existing entries for the same (type, uuid)
  var preserveInsert = false;
  for (var i = synchQueue.queue.length - 1; i >= 0; i--) {
    if (synchQueue.queue[i].type === type && synchQueue.queue[i].uuid === id) {
      // If previous was an insert and new is an update, keep the insert action
      // (server needs to know it's a new record) but use latest data
      if (synchQueue.queue[i].action === 'insert' && action === 'update') {
        preserveInsert = true;
      }
      synchQueue.queue.splice(i, 1);
    }
  }
  if (preserveInsert) {
    change.action = 'insert';
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
    data.urgent = node.urgent;
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

// Sync status is surfaced as a hover tooltip on the sync icon, not as
// feedback banners. Only action-required messages (session expired) banner.
function synchStatusNote(text) {
  var btn = gebi('synch-button');
  if (btn) btn.title = text;
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

function startAutoSync() {
  stopAutoSync();
  autoSyncIntervalId = setInterval(synch, 10000);
}

function stopAutoSync() {
  if (autoSyncIntervalId) {
    clearInterval(autoSyncIntervalId);
    autoSyncIntervalId = null;
  }
}

// Manual sync entry point (header icon, settings button, post-login)
function synchToServer() {
  if (!isLoggedIn()) {
    showAuthModal('login');
    return;
  }
  synch();
}

// How far behind lastSyncTime each pull reaches. A write that commits while
// another device's sync is reading can carry an updated_at slightly before
// the serverTime that device stores, and an exact-cursor pull would then skip
// it forever. Re-applying already-seen changes is an idempotent upsert of
// current row state, so a short overlap is free insurance.
var SYNC_OVERLAP_SECONDS = 30;

// Signature of the last applied change batch: the overlap window re-delivers
// recent batches, and an identical batch must not re-render the views
var syncLastBatchSig = '';

/**
 * The one sync flow: push whatever is queued (possibly nothing) and pull
 * changes since lastSyncTime. A device with no lastSyncTime bootstraps by
 * pulling since the epoch — the server returns the whole account as ordinary
 * changes. Runs on the 10s auto-sync tick and on manual sync.
 */
function synch() {
  if (!isLoggedIn() || syncInProgress) return;
  syncInProgress = true;
  synchIconStatus("synching");

  // Snapshot the queue length; entries added while the request is in flight
  // stay queued for the next tick instead of being wiped by the clear below
  var sentCount = synchQueue.queue.length;

  var since = '1970-01-01 00:00:00';
  if (ttData.lastSyncTime) {
    since = moment.utc(ttData.lastSyncTime)
      .subtract(SYNC_OVERLAP_SECONDS, 'seconds').format('YYYY-MM-DD HH:mm:ss');
  }

  if (sentCount > 0) {
    console.log('[SYNC] Pushing', sentCount, 'change(s), pulling since', since);
  }

  ajaxReq({
    url: serverConfig.baseUrl + serverConfig.endpoints.sync,
    type: 'POST',
    contentType: 'application/json',
    headers: { 'Authorization': 'Bearer ' + authToken },
    data: JSON.stringify({
      lastSyncTime: since,
      changes: synchQueue.queue.slice(0, sentCount),
      globalState: ttData.globalState || null
    }),
    success: function(result) {
      syncInProgress = false;

      if (!result.success) {
        synchStatusNote('Sync error: ' + (result.error || 'Unknown'));
        synchIconStatus("error");
        return;
      }

      // Drop only what was sent; mid-flight additions remain queued
      synchQueue.queue.splice(0, sentCount);
      ttData.synchQueue = synchQueue.queue;

      var batchSig = JSON.stringify(result.changes || []);
      var freshChanges = result.changes && result.changes.length > 0 &&
                         batchSig !== syncLastBatchSig;
      syncLastBatchSig = batchSig;

      if (freshChanges) {
        applyServerChanges(result.changes);
        refreshSessionRefs();
        // Merge rootOrder: preserve local ordering, incorporate server additions/deletions
        if (result.rootOrder && Array.isArray(result.rootOrder)) {
          ttData.rootOrder = mergeRootOrder(ttData.rootOrder || [], result.rootOrder, ttData.nodes || {});
        }
      }

      var stateChanged = applyServerGlobalState(result.globalState);

      // Quiet ticks leave lastSyncTime alone (re-scanning the same window is
      // idempotent) and skip the save/emit so views don't re-render for nothing
      if (freshChanges || stateChanged || sentCount > 0) {
        ttData.lastSyncTime = result.serverTime;
        ttSave();
        emitEvent('server', 'synch');
      }

      var msg = 'Synced';
      if (sentCount > 0) msg += ' (sent ' + sentCount + ')';
      if (freshChanges) msg += ' (received ' + result.changes.length + ')';
      if (msg === 'Synced') msg = 'Up to date';
      synchStatusNote(msg + ' · ' + moment().format('HH:mm:ss'));
      synchIconStatus("done");
    },
    error: function(xhr, ajaxOptions, thrownError) {
      syncInProgress = false;
      if (xhr.status === 401) {
        // Always show session expiry — it needs user action
        setFeedback('Session expired. Please login again.', 'error');
        synchStatusNote('Session expired');
        authToken = null;
        delete localStorage.authToken;
        if (nativeBridge.ready) nativeBridge.persist();
        updateAuthUI();
      } else {
        synchStatusNote('Sync error: ' + thrownError);
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
  if (data.urgent !== undefined) node.urgent = data.urgent;
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

/* Latest end_time (any node) at or before the given session's own end,
   so back-editing an old session finds the session that preceded it. */
function getPreviousSessionEnd(sessionId) {
  var current = getSessionById(sessionId);
  var ref = current.end_time || current.start_time || "9999";
  var best = null;
  for (var nodeId in ttData.nodes) {
    var sessions = ttData.nodes[nodeId].sessions;
    if (!sessions) continue;
    for (var sid in sessions) {
      if (sid === sessionId) continue;
      var end = sessions[sid].end_time;
      if (end && end <= ref && (!best || end > best)) best = end;
    }
  }
  return best;
}

function fillLastSessionEnd(sessionId) {
  var end = getPreviousSessionEnd(sessionId);
  if (end) {
    gebi('session-start_time-edit-input').value = end;
  } else {
    setFeedback('No previous session found', 'error');
  }
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
    node.urgent = data.urgent || '0';
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

  // Block deleting the node being tracked (or an ancestor of it, when cascading)
  if (current_session && current_node) {
    var deleteBlocked = id === current_node.id;
    if (!deleteBlocked && cascade) {
      var trackedPath = getNodePath(current_node.id);
      for (var pi = 0; pi < trackedPath.length; pi++) {
        if (trackedPath[pi].id === id) { deleteBlocked = true; break; }
      }
    }
    if (deleteBlocked) {
      setFeedback('A session is in progress on this task — end it before deleting.', 'error');
      return false;
    }
  }

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
 * Parse date hashtags from input string (e.g. #tomorrow, #friday, #nextweek)
 * @param {string} input - The text to parse
 * @returns {object} - { name: cleanedName, due: 'YYYY-MM-DD' or null }
 */
function parseDateFromInput(input) {
  if (!input || typeof input !== 'string') {
    return { name: input || '', due: null };
  }

  var datePattern = /#(today|tomorrow|nextweek|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?!\w)/i;
  var match = datePattern.exec(input);

  if (!match) {
    return { name: input, due: null };
  }

  var keyword = match[1].toLowerCase();
  // Use 3am rollover for logical day (consistent with rest of app)
  var now = moment().subtract(3, 'hours');
  var due;

  if (keyword === 'today') {
    due = now.clone();
  } else if (keyword === 'tomorrow') {
    due = now.clone().add(1, 'day');
  } else if (keyword === 'nextweek') {
    // Next Monday
    due = now.clone().add(1, 'week').startOf('isoWeek');
  } else {
    // Day of week — find next occurrence, never today
    var dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    var targetDay = dayNames.indexOf(keyword);
    var currentDay = now.day();
    var daysAhead = targetDay - currentDay;
    if (daysAhead <= 0) daysAhead += 7;
    due = now.clone().add(daysAhead, 'days');
  }

  var cleanName = input.replace(datePattern, '').replace(/  +/g, ' ').trim();

  return {
    name: cleanName,
    due: due.format('YYYY-MM-DD')
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

    // Never reset a completion made within the current logical day. This runs
    // at startup against pre-sync local data, so without this guard a device
    // waking up would un-complete tasks finished today on another device.
    if (Array.isArray(node.completed_at) && node.completed_at.length > 0) {
      var lastDone = node.completed_at[node.completed_at.length - 1];
      if (moment(lastDone).subtract(3, 'hours').format('YYYY-MM-DD') === logicalDate) continue;
    }

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
