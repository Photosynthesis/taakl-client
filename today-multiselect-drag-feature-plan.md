# Feature plan: multi-select + block drag in the Today view

Status: proposed, not built. (2026-09-25)

## What it is

Select several **adjacent** tasks in the Today starred section and drag them
as one block to a new position, to lay out the day's sequence quickly.
Composes with the dividers plan (`today-dividers-feature-plan.md`): both
operate on the same ordered entry list, and a block can be dropped across a
divider boundary.

## Selection model

Contiguity is a hard requirement of the feature ("multiple adjacent tasks"),
so enforce it by construction — selection is always a **range**:

- State: `todayView.selection = { anchorId: null, headId: null }`; the
  selected set is every task row between anchor and head (inclusive) in the
  current rendered order. No set bookkeeping, no normalization pass.
- **Desktop**: click selects (anchor = head = row); shift-click moves the
  head, extending the range. Click on empty space or Esc clears. Plain click
  on a different row re-anchors. (Clicks on the checkbox, star, flame, play,
  and name-edit targets keep their current meanings — selection clicks bind
  on the row background only.)
- **Mobile**: long-press (≈450ms, no move) on a row enters selection mode
  (row highlights, faint haptic via `navigator.vibrate` where available);
  a subsequent tap on another row sets the head, selecting the range between;
  tapping inside the range shrinks it to the tapped row; tap outside any row
  or a "✕ n selected" chip clears. Long-press must suppress the click that
  iOS fires on release and must cancel if the finger moves (so scrolling
  still works).
- Visual: `.today-selected` class on rows (token-based tint, e.g.
  `--bg-hover` + inset accent edge); a small "n selected ✕" chip appears in
  the starred section header while active.
- Any refresh re-derives the range from ids; if either endpoint vanished
  (unstarred/completed elsewhere), clear the selection.

## Drag behavior

Extend the existing per-row HTML5 drag (`todayView.addDragHandlers`,
`dragState`) rather than adding a second mechanism:

- `dragstart` on a row **inside the selection** → `dragState = { taskIds:
  [...] }` (the range, in order). On a row outside the selection → clear
  selection and fall back to today's single-task drag.
- **Drag image**: build an offscreen stacked-cards ghost (first row's name +
  "+ n more" badge) and pass it to `e.dataTransfer.setDragImage()`. Cheap and
  makes the block-ness legible.
- While dragging, add `.today-dragging` to all selected rows (they dim in
  place, as the single-drag does today).
- **Drop**: existing above/below midpoint logic on the target row is
  unchanged; the reorder becomes: splice all selected ids out of the entry
  array (preserving their relative order), then insert the block at the
  adjusted target index (indices shift after removal — compute the target
  position on the post-removal array). Then `saveStarredOrder()` + refresh,
  exactly like single drag.
- Dropping onto a selected row / no-op positions: detect and skip the save.
- **Touch dragging**: iOS Safari ≥15 fires native HTML5 drag from a
  long-press on `draggable` elements, which collides with long-press-to-
  select. Resolution: in selection mode the long-press is consumed by
  selection; dragging a block on touch starts from a **drag handle** (≡)
  that appears on selected rows only. Desktop needs no handle.

## Scope guards

- Starred section only in v1 (morning/evening order is tag/derived; same as
  dividers). The mechanism generalizes later if wanted.
- No multi-select actions beyond drag in v1 (no bulk complete/star) — keep
  the surface small; the selection chip leaves room to add these later.
- Dividers inside a selected range: v1 disallows it implicitly — ranges are
  computed over task rows only, and the splice ignores divider entries, so a
  range spanning a divider "picks up" only the tasks. Document this; if it
  feels wrong in use, switch to including the divider in the block.

## Code touchpoints (`js/timetracker.js`)

1. `todayView.refresh` — row rendering adds selection classes + handle;
   header chip.
2. New `todayView.selectionHandlers(el, taskId)` — click/shift-click,
   long-press timers; wired where `addDragHandlers` is wired.
3. `todayView.addDragHandlers` — branch on selection membership; block splice
   in the drop handler (shared helper with single-drag path).
4. `saveStarredOrder`/`applyStarredOrder` — unchanged (order array in, order
   array out).
5. CSS: `.today-selected`, selection chip, drag handle, stacked ghost.

## Sizing

~200–250 lines JS, ~50 lines CSS, no server work. Ship after (or together
with) dividers since both refactor the same drop/splice path — doing dividers
first gives the entry-list abstraction for free.
