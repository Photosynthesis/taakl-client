# Time Estimate Feature Implementation Plan

## Overview
Add the ability to set and display time estimates for tasks. Users can input estimates when creating tasks using shorthand notation like `(23 m)` for 23 minutes or `(1.2 h)` for 1.2 hours, and edit estimates in the task edit view.

---

## 1. Data Model Changes

### Location: `js/timetracker.js`

Add `estimate` field to the task data structure. The estimate will be stored in **seconds** (consistent with how `time` is stored).

**Affected code:**
- `saveNewTask()` function (line 503) - set estimate when creating task
- `editFields.task` object (line 109) - add estimate as editable field

---

## 2. Input Parsing Function

### Location: `js/timetracker.js`

Create a new function `parseEstimateFromInput(input)` that:
1. Searches the input string for patterns like `(X m)`, `(X h)`, `(Xm)`, `(Xh)`, `(X min)`, `(X hr)`, etc.
2. Extracts the numeric value and unit
3. Converts to seconds
4. Returns an object with the cleaned task name and estimate in seconds

**Supported patterns:**
| Pattern | Example | Meaning |
|---------|---------|---------|
| `(X m)` | `(30 m)` | 30 minutes |
| `(Xm)` | `(30m)` | 30 minutes |
| `(X min)` | `(30 min)` | 30 minutes |
| `(X h)` | `(1.5 h)` | 1.5 hours |
| `(Xh)` | `(2h)` | 2 hours |
| `(X hr)` | `(2 hr)` | 2 hours |
| `(X hrs)` | `(2 hrs)` | 2 hours |

**Example implementation:**
```javascript
function parseEstimateFromInput(input) {
  // Pattern matches: (number unit) where unit is m/min/h/hr/hrs
  // Number can be integer or decimal
  var pattern = /\((\d+\.?\d*)\s*(m|min|mins|h|hr|hrs|hour|hours)\)/i;
  var match = input.match(pattern);

  if (match) {
    var value = parseFloat(match[1]);
    var unit = match[2].toLowerCase();
    var seconds = 0;

    if (unit === 'm' || unit === 'min' || unit === 'mins') {
      seconds = value * 60;
    } else if (unit === 'h' || unit === 'hr' || unit === 'hrs' || unit === 'hour' || unit === 'hours') {
      seconds = value * 3600;
    }

    // Remove the estimate pattern from the task name
    var cleanName = input.replace(pattern, '').trim();

    return {
      name: cleanName,
      estimate: seconds
    };
  }

  return {
    name: input,
    estimate: 0
  };
}
```

---

## 3. Modify Task Creation

### Location: `js/timetracker.js`, function `saveNewTask()` (line 503)

**Changes:**
1. Before creating the task object, call `parseEstimateFromInput()` on the task name
2. Use the cleaned name for the task
3. Set the `estimate` property on the new task object

**Code modification (around line 526-536):**
```javascript
if(!task_name){
  task_name = document.getElementById('new-task-input').value;
  document.getElementById('new-task-input').value = '';
}

// Parse estimate from task name
var parsed = parseEstimateFromInput(task_name);
task_name = parsed.name;

var new_task = {
  'id' : newId(task_name,'task'),
  'name' : task_name,
  'status' : 'new',
  'sessions' : {},
  'estimate' : parsed.estimate  // Add estimate field
};
```

---

## 4. Add Estimate to Edit Form

### Location: `js/timetracker.js`, object `editFields.task` (line 109)

Add a new field definition for estimate. The edit field should accept human-readable input (minutes or hours) and convert to/from seconds.

**Add after the `notes` field (line 144):**
```javascript
estimate : {
  label : "Estimate (minutes)",
  type : "text"
}
```

**Note:** The estimate will be displayed/edited in minutes for user convenience. We'll need to:
1. Convert from seconds to minutes when displaying in edit form
2. Convert from minutes to seconds when saving

This requires modifying `showGeneralEditForm()` and `saveGeneralEditForm()` to handle the conversion, or alternatively, store and display in minutes consistently.

**Simpler approach:** Store estimate in seconds but display as "X min" or "X h" in the edit form by creating a helper function.

---

## 5. Display Estimate in Task List

### Location: `index.html`, task list template (line 109-120)

Add estimate display to the task meta section.

**Modify the template (line 113):**
```html
<span class="task-meta">
  {{task.metaParentage}}
  {{task.metaEstimate}}
  {{task.metaPrettyTime}}
  <span class="fa-stack billability" ...>
</span>
```

### Location: `js/timetracker.js`, function `taskList.filter()` (line 1413)

Add logic to format the estimate for display.

**Add after line 1485 (where `metaPrettyTime` is set):**
```javascript
if(this.task.estimate > 0){
  this.task.metaEstimate = "<span>Est: "+prettyTime(this.task.estimate)+"</span>";
}else{
  this.task.metaEstimate = '';
}
```

---

## 6. Optional: Show Progress Indicator

Consider showing how much time has been logged vs estimated:
- If estimate exists and time > 0: show "45 min / 2 hrs est" or a progress bar
- Color coding: green if under estimate, yellow if near, red if over

**Add to `taskList.filter()` after estimate formatting:**
```javascript
if(this.task.estimate > 0 && this.task.time > 0){
  var percent = Math.round((this.task.time / this.task.estimate) * 100);
  this.task.metaProgress = "<span class='estimate-progress'>" + percent + "% of est</span>";
}else{
  this.task.metaProgress = '';
}
```

---

## 7. CSS Styling (Optional)

### Location: `css/timetracker-flat.css`

Add styling for estimate display:
```css
.task-meta .estimate-progress {
  color: #888;
  font-size: 0.85em;
}
.task-meta .estimate-progress.over {
  color: #c44;
}
```

---

## Implementation Order

1. **Add `parseEstimateFromInput()` function** - Core parsing logic
2. **Modify `saveNewTask()`** - Use parsing function when creating tasks
3. **Add estimate to `editFields.task`** - Enable editing estimates
4. **Modify edit form display/save** - Handle seconds ↔ minutes conversion
5. **Update `taskList.filter()`** - Add `metaEstimate` formatting
6. **Update HTML template** - Display `{{task.metaEstimate}}`
7. **Test all functionality**
8. **Optional: Add progress indicator and styling**

---

## Test Cases

1. Create task "Fix bug (30 m)" → name: "Fix bug", estimate: 1800 seconds
2. Create task "Build feature (2 h)" → name: "Build feature", estimate: 7200 seconds
3. Create task "Quick fix (1.5h)" → name: "Quick fix", estimate: 5400 seconds
4. Create task "No estimate task" → name: "No estimate task", estimate: 0
5. Edit task and change estimate
6. Verify estimate displays correctly in task list
7. Verify estimate persists after page reload
8. Verify estimate syncs to server correctly

---

## Files to Modify

| File | Changes |
|------|---------|
| `js/timetracker.js` | Add parsing function, modify `saveNewTask()`, add to `editFields.task`, modify `taskList.filter()`, modify edit form handlers |
| `index.html` | Add `{{task.metaEstimate}}` to task template |
| `css/timetracker-flat.css` | (Optional) Add styling for estimate display |
