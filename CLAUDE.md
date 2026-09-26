# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Taakl is a lightweight, offline-first time tracking and productivity app. It's a vanilla JavaScript single-page application with no build system, no package manager, and no transpilation. All code runs directly in the browser.

## Development

**No build step required.** Serve the directory with any static HTTP server and open `index.html`:

```bash
# e.g. using Python
python3 -m http.server 8000
# or PHP
php -S localhost:8000
```

There are no tests, no linter, and no CI pipeline. All testing is manual via the browser.

## Technology Stack

- **Vanilla ES5 JavaScript** — no modules, no transpilation, no jQuery, globals on `window`
- **Moment.js** — date/time formatting
- **Pikaday** — date picker
- **Chart.js v2.1.6** — still loaded but currently unused (the old Review charts were replaced by pure-DOM rendering)
- **Font Awesome 4.5.0** (CDN) — icons

## Architecture

### Key Files

- **`js/timetracker.js`** (~4,600 lines) — entire application logic: data model, views, sync, event system
- **`index.html`** — single-page shell, loads all scripts, contains all HTML structure
- **`css/timetracker-flat.css`** — base stylesheet (design tokens + all structural rules)
- **`css/themes/*.css`** — optional theme stylesheets (see Themes below)

### Data Model (Node Structure)

```
ttData = {
  dataVersion: 2,
  nodes: {                          // flat map of all nodes
    "uuid": {
      id, name, type: "folder"|"task",
      parentId, childOrder: [],     // tree structure
      collapsed, starred, status, priority,
      billable, estimate, due, notes, goal,
      sessions: { "session-uuid": { start_time, end_time, duration } }
    }
  },
  rootOrder: ["uuid", ...],         // top-level ordering
  settings: {},
  synchQueue: [],
  lastSyncTime: null
}
```

**Data persistence:** `ttData` is JSON-stringified into `localStorage.ttData`. Call `ttSave()` after mutations.

### View System

Views are singleton objects with a `.show()` / `.hide()` / `.update()` lifecycle:

| Object | Purpose |
|---|---|
| `treeView` | Primary outliner UI (tree with indent/outdent, drag-drop, inline editing) |
| `todayView` | Daily focus view (starred tasks + `#daily` tagged tasks) |
| `analyze` | Review view with two lenses: Calendar (day/week/month with session blocks + completion markers) and Projects (drillable billing/audit view with a session ledger) |
| `settingsView` | Account, import/export, settings |

`setView(name)` switches views. The "taskList" view name routes to `treeView`.

### Event System

Custom pub/sub via `emitEvent(type, action, value)` / `addEventWatcher(type, action, callback, owner)`. Views register watchers in `.show()` and clean up in `.hide()` using the `owner` tag via `removeEventWatchers(owner)`.

Common events: `node/updated`, `node/added`, `node/deleted`, `session/ended`, `server/synch`.

### Node Helpers

- `getNode(id)` — lookup by UUID
- `getNodePath(id)` — ancestor chain
- `getNodeChildren(id)` — immediate children
- `getAllTaskNodes()` — all nodes where `type === "task"`
- `nodeIsTask(id)` — check type

### Server Sync

Optional sync to `https://api.taakl.app`. Bearer token in `localStorage.authToken`. There is **one** sync flow: `synch()` POSTs to `/api/sync` every 10s (auto-sync tick) and on manual sync (`synchToServer()` entry point), pushing whatever is queued in `synchQueue` (possibly nothing) and pulling changes since `lastSyncTime`. A device with no `lastSyncTime` bootstraps by pulling since the epoch. Robustness details that must be preserved: the pull cursor reaches `SYNC_OVERLAP_SECONDS` behind `lastSyncTime` (a concurrently-committing write can carry an `updated_at` just before the stored `serverTime` and would otherwise be missed forever); re-delivered identical batches are detected by signature (`syncLastBatchSig`) and skip re-render; only the first `sentCount` queue entries are spliced on success so changes queued mid-flight survive. Editing-vs-pull protection (keystrokes are mirrored into the node live but only queued on blur, so a pulled echo of an earlier push could wipe in-progress typing back to its first letter): queued payloads are re-snapshotted from current state at send time; `upsertNodeLocally` never overwrites the fields owned by a focused editor (`activeEditNodeId()` — name/estimate/due for the name editors, notes for the notes editor, goal for the goal editor); changes for uuids still in `synchQueue` are skipped entirely; and any deferred change clears `syncLastBatchSig` so the batch is re-examined on a later tick instead of being lost. Regression test: `python3 mockups/sync-clobber-test.py` (headless Chrome, needs `Emulation.setFocusEmulationEnabled` — focus/blur events don't fire in headless otherwise). The bulk `/api/sync/full` endpoints are deprecated server-side legacy — the client no longer calls them.

### Session Tracking

`startNodeSession()` → timer runs → `endNodeSession()`. Active session ID stored in `localStorage.ttSessionId`, active node in `localStorage.ttCurrentNodeId`. Elapsed time shows in the browser tab title.

**Estimate progress:** when the task has an estimate, the session UI shows tracked-vs-estimate state (fill bar + caption in fullscreen, hairline strip on the collapsed bar, and the timer itself changes color). Tracked = completed sessions on the task (`sessionTrackedBaseSecs`, set in `showNodeInSession`) + the live clock. `updateSessionProgress()` runs every tick and only sets *hooks*: an `est-ok`/`est-warn`/`est-over` class and `--est-fill`/`--est-tick` custom properties on `#active-session`, plus the `.sp-caption` text — all visuals live in the stylesheet (`#session-progress`/`.sp-*` rules), so themes restyle via the same hooks. The 90%/100% estimate alerts use the same tracked total.

**Cross-device running sessions:** the running session is published via the account-global state map `ttData.globalState` — `setGlobalState('tracking', { nodeId, sessionId })` on start, null ids on stop. Each entry is `{ value, updated_at }`; the map rides along on every sync and the server (`user_global_state` table) merges it last-write-wins per key by the client-stamped UTC `updated_at`. `applyServerGlobalState()` merges the returned map and runs key-specific handlers; `adoptRemoteTracking()` — only when this device is idle — adopts the remote session's timer UI via `continueNodeSession()`. A session ended elsewhere is stopped by `refreshSessionRefs()` (the synced `end_time` triggers the abort), never by the pointer. New roaming state = new key + client handler; no schema or server change. Other globalState keys: `todayStarredOrder` (manual Today-view starred ordering; `localStorage.todayStarredOrder` remains as a legacy fallback/mirror). Sync status is shown as a tooltip on `#synch-button`, not feedback banners (`synchStatusNote()`).

## Themes ("skins")

The visual design is themable via stylesheet swapping; the DOM is shared by all
themes and must stay design-neutral.

- **Design tokens:** `css/timetracker-flat.css` opens with a `:root` block of
  ~55 CSS custom properties (fonts, surface/ink ramps, semantic accents, Today
  section tints). The rest of the file references them via `var(--…)`. The
  default theme is just these tokens — no theme file.
- **Theme files:** a theme is `css/themes/<key>.css`, loaded *after* the base
  stylesheet, overriding tokens and (sparingly) component rules. Register it in
  `availableThemes` in `timetracker.js` — that map drives the Theme `<select>`
  in Settings. Bump `THEME_CSS_VERSION` when any theme file changes.
- **Switching:** `applyTheme(name)` manages the `<link id="theme-css">`, a
  `theme-<name>` class on `<body>`, and the `localStorage.ttTheme` mirror. An
  inline `<head>` script in `index.html` reads the mirror to apply the theme
  pre-paint (no flash of default). The chosen theme is stored in
  `ttData.settings.theme`, so it syncs across devices like any setting.
- **Project colors:** every tree row and Today task carries
  `--node-color` (inline CSS variable) — the deterministic color of its
  top-level ancestor from `analyze.getNodeColor(getRootAncestorId(id))`.
  The default theme ignores it; themes may use `var(--node-color)` for dots,
  tags, accents, etc.
- **Rules for new UI:** never put cosmetic values in inline styles or JS-built
  HTML — use classes styled in the base stylesheet with tokens. Structural
  rules (layout, drag indicators, display toggling) live only in the base
  stylesheet; themes override tokens and component *looks*, never behavior.
- `mockups/` holds static design-concept mockups (`design-concepts.html` is the
  index) and `test-drive.html`, an iframe harness that seeds sample tasks and
  drives views for headless screenshot testing
  (`?mode=plan|today|collapse|settings`).
- **Mobile layouts must be verified with real device emulation**, not narrow
  desktop windows: `python3 mockups/mobile-shot.py <url> <out.png> [setup-js]`
  drives headless Chrome over CDP with iPhone metrics (390×844, DPR 3, touch,
  mobile UA) and prints scroll-width/bar-height diagnostics. Narrow-window
  screenshots miss real-viewport flex/grid wrapping issues.

## Code Conventions

- ES5 style: `var`, `function`, no arrow functions, no template literals
- Global namespace — all view objects, helpers, and state are window-level variables
- Inline `onClick` handlers in HTML
- Direct DOM manipulation with `document.createElement()`, `gebi()` (getElementById shorthand), `insertAdjacentHTML()`, and `addEventListener()`
- AJAX via `ajaxReq()` helper (thin XMLHttpRequest wrapper matching $.ajax option shape)
- camelCase for functions and variables
- UUIDs generated client-side for node and session IDs

## Deployment

The client is hosted on DreamHost as a static site. No build step — just git pull.

**Host:** `iad1-shared-d12-02.dreamhost.com`
**User:** `taakl`
**Site root:** `~/taakl.app/`
**SSH credentials:** stored in `../ssh_info.md` (parent timetracker directory)

To deploy, SSH into the server and pull the desired branch:

```bash
ssh -o PubkeyAuthentication=no taakl@iad1-shared-d12-02.dreamhost.com
cd ~/taakl.app
git fetch origin
git checkout <branch-name>
git pull origin <branch-name>
```

Password auth is required (no pubkey). Use `sshpass` or `pexpect` if automating. Changes are live immediately after pull — no restart or cache invalidation needed.

## Share Links (read-only branch sharing)

Any node branch can be shared read-only via a secret link (Share button in the
node drilldown header; management under Tweak → Shared links). The client only
creates/lists/revokes links via `/api/shares`; the **viewer page is a separate
standalone app in the server repo** (`taakl-server/share/`) that deliberately
duplicates a few rendering behaviors from this codebase. If you change any of
these, port the change by hand to `taakl-server/share/share.js` (its header
comment lists the mapping):

- `treeView._doUpdate` search-match logic (name substring + ancestor marking)
- `treeView._doUpdate` Recent-filter logic and `analyze.getDateRange` presets
- `calculateNodeTime` roll-up semantics
- `prettyTime` formatting
- `treeView.renderNode` filter order (hide-done → search → recent, force-expand)

Shares serve **server-side** data — viewers see the owner's last-synced state.

## Special Syntax in Task Names

- `(30m)` or `(1.5h)` — time estimate, parsed and stored as seconds
- `#daily #morning` / `#daily #evening` — tags used by Today view for categorization
- Starred tasks appear in the Today view middle section
