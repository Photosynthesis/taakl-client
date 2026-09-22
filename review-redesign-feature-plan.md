# Review View Redesign — Implementation Plan

> **Status: implemented** on this branch (see the three commits following the
> plan commit). Remaining before merge: manual testing against real data per
> the checklist below, a Tauri build check, and a sync round-trip test.
> Deviations from the plan: none substantive; Step 11's dead-code removal
> happened alongside the earlier steps (the old renderers were replaced
> wholesale), and `#analyze-controls` CSS from the pre-2024 review UI was
> removed as well.

Replace the current Review (analyze) view's Overview/Timeline tabs with two new
lenses on the same data:

- **Calendar** — time as the primary lens. Google-Calendar-style day / week /
  month views showing session blocks (lowest-level task + parent hierarchy),
  completion markers, and a scoped stats panel. Answers "what did I do with this
  day/week/month?"
- **Projects** — the tree as the primary lens. Pick a node (breadcrumb
  drill-down) + a date range; see totals, a breakdown across immediate
  children, a daily trend, completions, and a session ledger **grouped by
  immediate child** (= invoice line items) with billable hours, rounding, rate,
  and CSV export. Answers "what does this client/area cost me?" and produces
  billing figures.

**Reference:** `mockups/review-redesign.html` — standalone interactive mockup
(static sample data, no dependencies). Open it directly in a browser. Deep
links: `#day` `#week` `#month` `#projects` `#projects/<name>/<name>`. The
mockup is the spec for layout, interaction, and content; visual styling will be
adapted to the app's existing flat theme (see Step 10).

---

## Verified data facts (what the implementation builds on)

| Fact | Where |
|---|---|
| Sessions live on nodes: `node.sessions[id] = {start_time, end_time}`, **local time** strings `YYYY-MM-DD HH:mm:ss` (written via `moment().format(...)` in `startNodeSession` / session end) | `js/timetracker.js` ~3226, ~3319 |
| Completions are recorded per event in `node.completed_at` — an **array of UTC ISO strings** pushed by `recordCompletion()` / popped by `undoCompletion()`; synced to server | ~6190 |
| Per-node `billable` flag, `'1'`/`'0'` string, default billable (`node.billable !== '0'`) | ~2064, ~5696 |
| Live session: `current_session` exists in `node.sessions` with `start_time` but **no `end_time`** until stopped | `startNodeSession` |
| `analyze.getSessionsInRange(start, end)` walks all nodes once, returns `{id, taskId, taskName, start_time, end_time, durationSecs, path[]}` with `path` from `getNodePath()` | ~3521 |
| `analyze.aggregateByLevel(sessions, parentId)` groups sessions by the immediate child of `parentId` (via `findChildAtLevel`), returns `{nodeId, nodeName, totalSecs, sessionCount, sessions[], isLeaf}` sorted desc — **this is exactly the Projects breakdown/ledger grouping** | ~3575 |
| `analyze.getNodeColor(nodeId)` — deterministic hash into `analyze.colorPalette` (10 muted colors) | ~3624 |
| `analyze.getDateRange(preset)` — presets today/yesterday/week/lastweek/month/lastmonth/custom; **duplicated in `taakl-server/share/share.js`** (do not change semantics without porting; we only add, not change) | ~3476 |
| Pikaday pickers already wired in `analyze.initPickers()`; Moment.js loaded | ~3687 |
| Chart.js is used **only** by the old Overview chart (`analyze.chartInstance`, one `new Chart` call) — the new design uses pure-div bars, so this usage goes away | ~3977 |

No server or sync-protocol changes are needed: sessions, `completed_at`, and
`billable` all sync already (unknown fields ride in the `meta` column).

## Architecture decisions

- Keep the `analyze` singleton and its `.show()/.hide()/.update()` lifecycle,
  event watchers, and `setView('analyze')` routing. Rewrite its internals.
- Rendering: direct DOM / `innerHTML` string building, matching current
  `analyze` + `treeView` patterns. **ES5 only** (var/function, no template
  literals, no arrows). The mockup's JS is already ES5-style — port, don't
  transliterate.
- Colors: consistent + deterministic everywhere via the existing
  `getNodeColor`:
  - Calendar blocks/markers: color of the **top-level ancestor**
    (`getNodeColor(path[0].id)`) so a day reads by area at a glance.
  - Projects children/trend/ledger groups: `getNodeColor(childId)`.
  (Improvement over the mockup, which assigns palette colors by rank.)
- Date math with Moment.js. Weeks start Monday (`isoWeek`, consistent with
  existing presets).
- Chart.js no longer used by analyze; leave the library loaded (harmless,
  avoids touching `index.html` script tags) — note for a later cleanup.
- Billing prefs (`round15`, `rate`) are device-local, not synced:
  `localStorage.ttReviewPrefs` (JSON). Rates/invoicing as first-class synced
  data is out of scope.

## State model (replaces old analyze state)

```
analyze.tab        'calendar' | 'projects'
// calendar
analyze.calView    'day' | 'week' | 'month'
analyze.anchor     'YYYY-MM-DD'          (defaults to today)
// projects
analyze.projPath   []                    (array of nodeIds, [] = all roots)
analyze.projPreset 'week'|'lastweek'|'month'|'lastmonth'|'custom'
analyze.projRange  {start, end}          (derived; custom via Pikaday)
analyze.billing    {round15: true, rate: 0}   (from localStorage.ttReviewPrefs)
```

Old state removed: `activeTab`, `drillPath`, `timelineZoom`, `chartInstance`,
`preset`/`dateRange` (superseded by projPreset/projRange), `aggregated`.

## Data layer additions (Step 2)

- `analyze.getCompletionsInRange(start, end)` — walk all nodes; for each entry
  in `node.completed_at`, convert UTC ISO → local via `moment(iso)`, keep those
  inside the range. Return `{nodeId, name, path, localDate 'YYYY-MM-DD',
  minutes-of-day}`. Each array entry is a separate completion event (repeatable
  daily tasks count each time).
- `analyze.getCalendarDays(start, end)` — one `getSessionsInRange` +
  `getCompletionsInRange` call, bucketed into per-day structures
  `{sessions:[{startMin, endMin, live, session}], completions:[...]}` for
  positioning. **Split sessions that cross midnight** into two display
  segments. Synthesize the live session (no `end_time`) with `end = now` and
  `live: true` when the range includes today.
- `analyze.isBillable(nodeId)` — `getNode(id).billable !== '0'`.
- Reused as-is: `getSessionsInRange`, `aggregateByLevel`, `findChildAtLevel`,
  `getNodeColor`, `formatDuration`, `getNodePath`, `prettyTime`.

Perf: every view = one pass over all sessions (the existing
`getSessionsInRange` cost), then O(sessions) bucketing. No per-day scans.

## Implementation steps (one commit each, on `feature/review-redesign`)

1. **Scaffolding.** Rewrite `#analyze-view` in `index.html`: tab bar
   (Calendar | Projects), calendar controls (Day/Week/Month segmented control +
   prev/Today/next), projects controls (range pills + custom Pikaday inputs —
   reuse the existing `analyze-start-date`/`analyze-end-date` inputs and
   `initPickers`), and empty containers per pane. Wire tab/state switching in
   `analyze.refresh()`. Old panes removed from HTML; old render functions
   temporarily orphaned (deleted in Step 11).
2. **Data layer** (above). No UI.
3. **Calendar day view + stats panel.** Hour gutter sized to the day's span
   (min 6h), absolutely positioned session blocks (leaf name, parent
   breadcrumb, time range, duration; slim/mid/tall layouts by block height),
   dashed completion lines with ✓ chips (flag "no session" ones), red now-line
   + pulsing live block for today. Stats: total, sessions, completed, first
   start / last stop, longest/avg session, per-top-level-category bars,
   timestamped completed list. Two-column layout on desktop (stats aside),
   stacked on mobile.
4. **Week view.** 7 columns, shared hour gutter/axis, compact blocks (name
   only when tall enough, tooltip otherwise), completion dashes, per-day totals
   in clickable headers (→ day view), today column highlight. Week-scoped
   stats below (adds active days, avg/active day, busiest day, daily-rhythm
   mini bars).
5. **Month view.** Monday-start grid; each cell: date, top-3 **top-level
   category** chips with hours, `✓n` badge, daily total; today outlined;
   future dimmed; cells click through to day view. Month-scoped stats below.
6. **Projects: scope + breakdown.** Breadcrumb (`All › … › node`, click to
   jump up), hero strip (total, % of all tracked, sessions, active days,
   avg/active day, completed), "Where the time went" rows from
   `aggregateByLevel(sessions, currentParent)` — bar, %, session count; row
   click drills in (`projPath.push`). "Logged directly here" bucket for
   sessions on the scope node itself (`findChildAtLevel` returns null → keep,
   don't skip, when parent is the session's own node — small adaptation).
7. **Projects: trend + completed.** Stacked per-day columns (top 5 children +
   Other), legend, tooltips; completions-in-scope list with dates.
8. **Projects: ledger.** Grouped by immediate child (same order/colors as
   breakdown): group header = name, session count, summed duration, decimal
   billable hours, amount; rows = date, time range, leaf task + path relative
   to the group, duration, decimal hours. Footer: tracked total, billable
   hours, rate input, amount. "Round up to 15 min" toggle (per session,
   ceiling). Respect `billable`: non-billable nodes' rows greyed and excluded
   from billable totals, with a "show non-billable" toggle. CSV export
   (`line_item,date,start,end,task,minutes,billable_hours`) via Blob +
   `a.download`. Persist `{round15, rate}` to `localStorage.ttReviewPrefs`.
9. **Custom date range** for Projects (Pikaday, reusing existing picker wiring;
   swap-if-reversed, cap ~370 days).
10. **Styling pass.** Append a clearly-delimited section to
    `css/timetracker-flat.css`. Adapt the mockup's layout to the app's
    existing flat look: white cards, existing grays, `#4a90a4` accent,
    Roboto — do **not** ship the mockup's Fraunces/Plex fonts or paper
    texture (decision point: revisit if we want the whole app to move that
    direction). Responsive: day-stats beside → below at <1000px; month chips
    shrink to dots on small screens. Verify in Tauri iOS webview sizes.
11. **Cleanup.** Delete old Overview/Timeline render code, chart instance
    handling, cascading dropdowns; remove dead CSS. Keep
    `getDateRange`/`getSessionsInRange`/`aggregateByLevel` intact (shared +
    share-viewer parity).
12. **Docs.** Update `CLAUDE.md` (analyze description) and this plan's status.

## Edge cases to handle

- Sessions crossing midnight (split for display; count duration in the day the
  segment falls on; ledger keeps the raw session as one row).
- Sessions missing `end_time` that are *not* the live session (crashed
  timers): skip in calendar, show flagged in ledger with 0 duration.
- `completed_at` entries for nodes that were later deleted (soft-deleted nodes
  excluded — `getSessionsInRange` behavior already handles node lookup;
  completions walker must skip nodes with `deleted`/missing).
- Empty days/ranges (friendly empty states, as in mockup).
- DST transitions (Moment local handles; day column just has a 23/25h span —
  acceptable).
- Deep trees in ledger paths: truncate middle of long relative paths.
- Today view "3 AM day boundary" convention (`subtract(3,'hours')` used by
  todayView): **not** adopted here — Review uses true calendar days. Flagged
  in case it feels wrong in use.

## Testing checklist (manual, `php -S localhost:8000`)

- Seed a local account with: nested tree ≥3 levels, sessions on leaves and on
  a parent node, a midnight-crossing session, repeated `#daily` completions,
  a standalone completion (no session that day), a non-billable subtree, a
  running live session.
- Day: block positions match session times; live block grows; now-line;
  completion chips incl. no-session; stats math (compare against old view
  totals for same range).
- Week/month: totals match day view sums; click-through navigation.
- Projects: drill to a leaf and back; direct-time bucket; % of all tracked;
  ledger group sums = breakdown sums; rounding changes billable not tracked;
  rate math; CSV opens in a spreadsheet; billable exclusion.
- Custom range incl. reversed input; range > data span.
- Mobile width (~390px) and Tauri app.
- Sync round-trip: complete a task on device A, see the marker on device B.

## Out of scope (deliberate)

- Server/API changes — none needed.
- Synced billing config (rates per client, invoice numbering, PDF export).
- Excluding arbitrary subtrees from a billing scope beyond the existing
  `billable` flag.
- Share-viewer (`taakl-server/share/`) getting the new Review UI.
- Removing Chart.js from `index.html`.
