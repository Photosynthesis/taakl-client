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

- **Vanilla ES5 JavaScript** — no modules, no transpilation, globals on `window`
- **jQuery 1.6.4** — DOM manipulation
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
- Direct DOM manipulation with `document.createElement()` and jQuery
- camelCase for functions and variables
- UUIDs generated client-side for node and session IDs

## Special Syntax in Task Names

- `(30m)` or `(1.5h)` — time estimate, parsed and stored as seconds
- `#daily #morning` / `#daily #evening` — tags used by Today view for categorization
- Starred tasks appear in the Today view middle section
