# Taakl: Native iOS + Desktop Apps via Tauri 2.0

## Context

Taakl is a vanilla ES5 JavaScript SPA served as static files with no build system. All state lives in `localStorage`. The goal is to ship it as a native iOS app (primary) and later Mac/Linux desktop apps, while keeping one web codebase as the source of truth.

## Framework Choice: Tauri 2.0

**Tauri** wraps the existing HTML/CSS/JS in the OS's native webview (WKWebView on iOS/macOS, WebKitGTK on Linux). One framework covers all three targets.

Why Tauri over Capacitor:
- Covers iOS **and** Mac/Linux desktop — Capacitor only covers mobile
- No npm/Node.js required — the existing no-build-system philosophy is preserved
- `withGlobalTauri: true` config injects `window.__TAURI__` into the webview, so vanilla ES5 can call native APIs without imports
- Tiny bundle size (~10MB vs Electron's 100MB+)
- Tauri 2.0 has stable iOS support

## Project Structure (new files only)

```
taakl-client/
  js/tauri-bridge.js            # NEW — native storage bridge (~80 lines)
  css/font-awesome.min.css      # NEW — local copy of FA 4.5.0
  fonts/                        # NEW — FA font files (woff2, woff, ttf)
  src-tauri/                    # NEW — Tauri scaffolding
    Cargo.toml                  #   Rust dependencies
    tauri.conf.json             #   App config (frontendDist, plugins, window)
    capabilities/default.json   #   Permission grants for plugins
    src/lib.rs                  #   Mobile entry point
    src/main.rs                 #   Desktop entry point
    gen/apple/                  #   Auto-generated Xcode project (cargo tauri ios init)
    icons/                      #   App icons
```

All existing files stay in place. `index.html` remains the entry point.

## Prerequisites

- **Rust**: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Tauri CLI**: `cargo install tauri-cli --version "^2.0" --locked`
- **Xcode** (full, not just CLI tools) — launched once to accept license
- **iOS Rust targets**: `rustup target add aarch64-apple-ios aarch64-apple-ios-sim`
- **Cocoapods**: `brew install cocoapods`
- **Apple Developer account** for device testing / App Store

## Implementation Steps

### Step 1: Bundle Font Awesome locally

The only CDN dependency. Download FA 4.5.0, place `css/font-awesome.min.css` and `fonts/` directory at project root. Change `index.html` line 9:

```html
<!-- FROM -->
<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/font-awesome/4.5.0/css/font-awesome.min.css">
<!-- TO -->
<link rel="stylesheet" href="css/font-awesome.min.css" type="text/css">
```

Works in both browser and Tauri. No functional change.

### Step 2: Initialize Tauri scaffolding

```bash
cargo tauri init
```

Prompts: App name = `Taakl`, frontendDist = `../`, no dev/build commands.

Key `tauri.conf.json` settings:
- `"withGlobalTauri": true` — exposes `window.__TAURI__` to vanilla JS
- `"frontendDist": "../"` — serves existing project root as web content
- `"identifier": "app.taakl.timetracker"`
- `"dragDropEnabled": false` — so existing HTML5 drag-drop keeps working

Plugins in `Cargo.toml`: `tauri-plugin-store` (persistent key-value store).

Capabilities: `core:default`, `store:default`.

### Step 3: Create `js/tauri-bridge.js` — native storage bridge

**The core problem:** iOS WKWebView can evict `localStorage` under memory pressure. The bridge dual-writes: localStorage stays the synchronous hot path, and an async Tauri store persists to a JSON file on the native filesystem.

On startup, if localStorage is empty but the Tauri store has data, it restores from the native store before `ttInit()` proceeds.

Key design:
- `nativeBridge.init(callback)` — loads the Tauri store, restores if needed, then calls back. No-ops when not in Tauri.
- `nativeBridge.persist()` — debounced (500ms) async write of all localStorage keys to the native store.
- Covers all 6 localStorage keys: `ttData`, `ttCurrentNodeId`, `ttSessionId`, `authToken`, `todayStarredOrder`, `ttLastDailyReset`
- Uses `Promise` (safe: only runs inside WKWebView which supports Promises natively)

Add `<script src="js/tauri-bridge.js">` to `index.html` after `timetracker.js`.

### Step 4: Modify `ttInit()` and `ttSave()` in `timetracker.js`

**`ttInit()`:** Wrap the body so the bridge initializes first:
```javascript
function ttInit(){
  nativeBridge.init(function() {
    ttInitCore();
  });
}
function ttInitCore(){
  // ... existing ttInit body moves here unchanged ...
}
```

**`ttSave()`:** Add one line:
```javascript
function ttSave(){
  localStorage.ttData = JSON.stringify(ttData);
  if (nativeBridge.ready) nativeBridge.persist();
}
```

**Other localStorage writes (~8 locations):** Add `if (nativeBridge.ready) nativeBridge.persist();` after each. These include `authToken` writes (login/logout), `ttCurrentNodeId`/`ttSessionId` (session start/end), `todayStarredOrder`, and `ttLastDailyReset`.

### Step 5: iOS-specific CSS adjustments

**Safe area insets** in `css/timetracker-flat.css` for notch devices:
```css
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
}
```

**Viewport meta** in `index.html`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

### Step 6: Init iOS target and test on simulator

```bash
cargo tauri ios init    # generates Xcode project in src-tauri/gen/apple/
cargo tauri ios dev     # builds and launches in iOS simulator
```

First build takes ~5-10 minutes (compiling Rust). Subsequent builds are incremental.

### Step 7: Handle file export for native

`downloadJson()` uses Blob + anchor click, which is unreliable in WKWebView. Add a Tauri-specific path using `tauri-plugin-dialog` + `tauri-plugin-fs`:

```javascript
if (window.__TAURI__) {
  window.__TAURI__.dialog.save({ ... }).then(function(path) {
    if (path) window.__TAURI__.fs.writeTextFile(path, json);
  });
  return;
}
// ... existing browser code as fallback ...
```

Requires adding `tauri-plugin-dialog` and `tauri-plugin-fs` to Cargo.toml and capabilities.

## Known Issues & Mitigations

| Issue | Impact | Mitigation |
|---|---|---|
| **HTML5 drag-drop doesn't work on iOS** | Tree reordering, Today starred reordering | Add `mobile-drag-drop` polyfill (~5KB) that translates touch → drag events. Zero code changes to existing handlers. |
| **Web Audio requires user gesture on iOS** | Estimate alert sounds may fail silently | Create a shared `AudioContext` on first `touchstart`, reuse it in `playEstimateDing()`/`playEstimateAlarm()` |
| **Notification API absent in WKWebView** | Desktop notifications won't fire | Already guarded by `typeof Notification == "object"` check. Optionally add `tauri-plugin-notification` later. |
| **Virtual keyboard on iOS** | May obscure edit modals | Test on simulator; add `visualViewport` resize listener if needed |

## Later: Mac + Linux Desktop

Once the Tauri scaffolding exists, desktop builds require **zero additional code changes**:

```bash
# macOS
cargo tauri build --target universal-apple-darwin   # outputs .dmg

# Linux
cargo tauri build                                    # outputs .deb + .AppImage
```

The window config in `tauri.conf.json` applies to desktop (ignored on iOS). The native bridge works identically on all platforms.

## Summary of Changes to Existing Code

| File | Change |
|---|---|
| `index.html` | Change FA link to local path, add viewport-fit=cover, add tauri-bridge.js script tag |
| `js/timetracker.js` | Wrap `ttInit` body in bridge callback (~5 lines), add persist call to `ttSave` (1 line), add persist calls at ~8 other localStorage write sites, add Tauri path in `downloadJson` (~10 lines) |
| `css/timetracker-flat.css` | Add safe area inset padding on body |

New files: `js/tauri-bridge.js` (~80 lines), `css/font-awesome.min.css` + `fonts/` (downloaded), `src-tauri/` (generated + configured).

## Verification

1. `cargo tauri ios dev` — app loads in iOS simulator
2. Add/edit tasks, restart app — data persists (native store working)
3. Switch views (Today, Tree, Review) — all render correctly
4. Test drag-drop with polyfill — reordering works via touch
5. Run a timer — tab title updates, estimate alerts sound
6. Export JSON — native save dialog appears
7. `cargo tauri dev` on desktop — same app runs as desktop window
