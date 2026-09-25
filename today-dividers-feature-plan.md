# Feature plan: draggable dividers in the Today starred section

Status: proposed, not built. (2026-09-25)

## What it is

User-created horizontal dividers that split the starred section of the Today
view into visual groups (e.g. "before lunch / after lunch", "deep work /
admin"). Dividers are inserted, dragged to reposition, optionally labeled, and
deleted. Tasks keep their existing per-task drag behavior; a divider is just
another draggable row in the same ordered list.

## Data model — dividers live inside `todayStarredOrder`

The starred ordering is already a synced, account-global array of task uuids
(`ttData.globalState.todayStarredOrder`, mirrored to
`localStorage.todayStarredOrder`). Extend it to a **mixed array**:

```js
todayStarredOrder: [
  "task-uuid-1",
  { divider: "d-<uuid>", label: "Afternoon" },   // divider entry
  "task-uuid-2",
  ...
]
```

- String entry → task uuid (unchanged).
- Object entry → divider; `divider` holds a client-generated uuid (`newId()`),
  `label` is optional user text ('' allowed).

Why here and not as nodes: dividers are a Today-view presentation concern, not
tasks — putting them in `ttData.nodes` would leak them into the Plan tree,
sync as nodes, and need type handling everywhere. The globalState value is
opaque JSON to the server (`user_global_state` table), so **no server change
and no migration** — it already syncs cross-device last-write-wins.

Backward compatibility: an old client reading a mixed array looks up
`taskMap[entry]` per entry (`applyStarredOrder`); object entries match nothing
and are silently dropped from its rendering, and its next `saveStarredOrder()`
writes a strings-only array — dividers would be lost after an old client
reorders. Acceptable: single-user feature, caches expire in 30 days, and the
cost is cosmetic. Call this out in the commit message.

## Code touchpoints (all in `js/timetracker.js`)

1. **`todayView.getStarredOrder` / `saveStarredOrder`** — today
   `saveStarredOrder` rebuilds the array from `todayView.starredTasks` (tasks
   only). Change the in-memory representation to keep the mixed list:
   `todayView.starredEntries` = ordered array of `{task}` and `{divider}`
   items, with `starredTasks` derived from it (so `getSectionTotals`, section
   rendering, and other consumers keep working untouched).
2. **`todayView.applyStarredOrder`** — walk the saved mixed array: task ids
   resolve as now; divider objects pass through verbatim; unknown/stale task
   ids drop; newly-starred tasks not in the saved order append at the end
   (existing behavior; new tasks from the Today input prepend, added
   2026-09-25).
3. **`todayView.refresh`** — when walking the starred container, render
   divider entries as a `.today-divider` row: drag handle (≡), label
   (contenteditable-style inline input on click), delete (×, no confirm —
   dividers are cheap). Styled in the base stylesheet with tokens
   (`--hairline`, `--ink-faint`); themes may restyle later.
4. **`todayView.addDragHandlers`** — already generic per-row
   (`dragState = { taskId }`). Generalize to `dragState = { entryId }` where
   entryId is a task uuid or divider id; drop logic already computes
   above/below by row midpoint, and reordering becomes a splice on
   `starredEntries` followed by `saveStarredOrder()`. Dividers are both
   draggable and valid drop targets (dropping a task "above a divider" is the
   same splice as above a task row).
5. **Insertion affordance** — a small "+ divider" control in the starred
   section header (next to the totals). Inserts at the **top** of the section;
   the user drags it into place (matches the requested "grab and drag into
   place" flow and avoids inventing a between-rows hover affordance on
   touch). Keyboard/desktop bonus: also accept a drop of the header control
   directly at a position.

## Interactions & edge cases

- **Totals**: section-header totals unchanged (whole section). Natural
  follow-up (not in v1): per-group subtotals rendered on each divider row —
  `getSectionTotals` already takes a task slice, so it's cheap.
- **Empty groups**: a divider with no tasks under it stays until deleted —
  it's a planning marker, not derived state.
- **Hide-done / filters**: dividers always render; tasks hide as today.
- **Unstar/complete**: task entries vanish from the list on refresh (they
  already do); dividers are untouched.
- **Drag of dividers across sections**: not allowed — dividers exist only in
  the starred section; morning/evening are tag-driven.
- **Sync conflict**: whole-array last-write-wins per globalState semantics —
  same as today's ordering, no new conflict surface.

## Sizing

~120–180 lines of JS (entry model + render + drag generalization), ~40 lines
of CSS, no server work. One deployable commit; bump JS + CSS cache-busters.
