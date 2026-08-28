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
- **Chart.js v2.1.6** — bar charts in the Review view
- **Font Awesome 4.5.0** (CDN) — icons

## Architecture

### Key Files

- **`js/timetracker.js`** (~4,600 lines) — entire application logic: data model, views, sync, event system
- **`index.html`** — single-page shell, loads all scripts, contains all HTML structure
- **`css/timetracker-flat.css`** — primary stylesheet

### Data Model (Node Structure)

```
ttData = {
  dataVersion: 2,
  nodes: {                          // flat map of all nodes
    "uuid": {
      id, name, type: "folder"|"task",
      parentId, childOrder: [],     // tree structure
      collapsed, starred, status, priority,
      billable, estimate, due, notes,
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
| `analyze` | Review/analytics view with Chart.js bar charts and timeline |
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

Optional sync to `https://api.taakl.app`. Changes are queued in `synchQueue` (action/type/uuid/data/timestamp) and sent via `synchToServer()`. JWT auth token stored in `localStorage.authToken`.

### Session Tracking

`startNodeSession()` → timer runs → `endNodeSession()`. Active session ID stored in `localStorage.ttSessionId`, active node in `localStorage.ttCurrentNodeId`. Elapsed time shows in the browser tab title.

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
