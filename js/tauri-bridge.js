/**
 * tauri-bridge.js — Native storage bridge for Tauri (iOS / desktop)
 *
 * Dual-writes localStorage (synchronous hot path) and the Tauri store
 * plugin (persistent JSON file on the native filesystem). On iOS,
 * WKWebView can evict localStorage under memory pressure; the native
 * store acts as a durable backup.
 *
 * When not running inside Tauri the bridge is a harmless no-op.
 */

var nativeBridge = (function() {

  var STORE_NAME = 'taakl-data.json';
  var KEYS = [
    'ttData',
    'ttCurrentNodeId',
    'ttSessionId',
    'authToken',
    'todayStarredOrder',
    'ttLastDailyReset'
  ];

  var store = null;
  var ready = false;
  var persistTimer = null;

  /**
   * Initialise the bridge.  If we are inside Tauri, open (or create)
   * the native store and restore any keys that are missing from
   * localStorage.  Then call `callback()` so the app can continue
   * booting.  Outside Tauri the callback fires immediately.
   */
  function init(callback) {
    if (!window.__TAURI__) {
      callback();
      return;
    }

    var Store = window.__TAURI__.store.Store;

    Store.load(STORE_NAME).then(function(s) {
      store = s;
      return restoreIfNeeded();
    }).then(function() {
      ready = true;
      callback();
    }).catch(function(err) {
      console.error('[tauri-bridge] init error, falling back to localStorage only:', err);
      callback();
    });
  }

  /**
   * If localStorage is empty (evicted) but the native store has data,
   * copy every saved key back into localStorage before the app reads it.
   */
  function restoreIfNeeded() {
    // Only restore when localStorage looks empty
    if (localStorage.ttData) {
      return Promise.resolve();
    }

    var tasks = KEYS.map(function(key) {
      return store.get(key).then(function(val) {
        if (val !== null && val !== undefined) {
          console.log('[tauri-bridge] restoring', key, 'from native store');
          localStorage[key] = val;
        }
      });
    });

    return Promise.all(tasks);
  }

  /**
   * Persist all tracked localStorage keys to the native store.
   * Debounced — only the last call within 500 ms actually writes.
   */
  function persist() {
    if (!store) return;

    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(function() {
      persistNow();
    }, 500);
  }

  function persistNow() {
    if (!store) return;

    var tasks = KEYS.map(function(key) {
      var val = localStorage[key];
      if (val !== undefined) {
        return store.set(key, val);
      } else {
        return store.delete(key);
      }
    });

    Promise.all(tasks).then(function() {
      return store.save();
    }).catch(function(err) {
      console.error('[tauri-bridge] persist error:', err);
    });
  }

  /**
   * Clear all keys from the native store (mirrors deleteLocalStorage).
   */
  function clear() {
    if (!store) return;

    store.clear().then(function() {
      return store.save();
    }).catch(function(err) {
      console.error('[tauri-bridge] clear error:', err);
    });
  }

  return {
    ready: false,
    init: init,
    persist: persist,
    clear: clear,

    // Expose a getter so callers check the live value
    get ready() { return ready; }
  };

})();
