# Star/Favorite Task Feature Implementation Plan

## Overview
Add the ability to "star" tasks for quick priority filtering. Each task will have a clickable star icon that toggles between starred (yellow) and unstarred (light grey). A filter star at the top of the task list allows showing only starred tasks.

---

## 1. Data Model Changes

### Location: `js/timetracker.js`

Add `starred` field to tasks. This is a boolean-like field (`"1"` or `"0"` to match existing patterns like `billable`).

**No changes to `editFields.task` needed** - starring is done via click, not the edit form.

---

## 2. Add Toggle Star Function

### Location: `js/timetracker.js`, after `setTaskComplete()` (around line 600)

Create a new function `toggleTaskStar(task_id)` that:
1. Gets the task by ID
2. Toggles the `starred` property
3. Updates and saves the task
4. Emits an event to refresh the view

**Implementation:**
```javascript
function toggleTaskStar(task_id){
  var task = getItemById("task", task_id);

  if(task.starred == "1"){
    task.starred = "0";
  }else{
    task.starred = "1";
  }

  updateItemById("task", task_id, task);
  emitEvent("task", "updated");
  ttSave();
}
```

---

## 3. Add Star Icon to Task Template

### Location: `index.html`, task template (line 109-120)

Add a clickable star icon before the task name. The star will use Font Awesome's `fa-star` icon.

**Current template structure:**
```html
<div style="width: 80%; flex: 1">
  {{checkCompleted}} {{task.truncateName}}
  <span class="task-meta">...</span>
</div>
```

**Updated template structure:**
```html
<div style="width: 80%; flex: 1">
  {{checkCompleted}} {{starIcon}} {{task.truncateName}}
  <span class="task-meta">...</span>
</div>
```

---

## 4. Generate Star Icon in taskList.refresh()

### Location: `js/timetracker.js`, in `taskList.refresh()` (around line 1627)

Add logic to generate the star icon HTML with appropriate styling based on the task's starred state.

**Add after the `completedInput` generation:**
```javascript
var starClass = (task.starred == "1") ? "starred" : "";
var starIcon = "<i class='fa fa-star task-star " + starClass + "' onClick=\"toggleTaskStar('" + task.id + "')\"></i>";

templateData.push({placeholder:"{{starIcon}}", value: starIcon});
```

---

## 5. Add Filter Star to Task List Options

### Location: `index.html`, taskList-options section (around line 126)

Add a clickable star icon that toggles the "show only starred" filter.

**Add to the options area:**
```html
<div style="float: left; min-width: 50px;">
  <i class="fa fa-star" id="filter-starred" onClick="taskList.toggleStarFilter()"
     title="Show only starred tasks"></i>
</div>
```

---

## 6. Add Star Filter Function

### Location: `js/timetracker.js`, after `taskList.hideCompleted()` (around line 1657)

Create a new function `taskList.toggleStarFilter()` that:
1. Toggles the `showOnlyStarred` flag
2. Updates the filter icon styling
3. Refreshes the task list

**Implementation:**
```javascript
taskList.toggleStarFilter = function(){
  taskList.showOnlyStarred = !taskList.showOnlyStarred;

  var filterIcon = gebi("filter-starred");
  if(taskList.showOnlyStarred){
    filterIcon.classList.add("filter-active");
  }else{
    filterIcon.classList.remove("filter-active");
  }

  taskList.update();
}
```

---

## 7. Add Star Filtering Logic

### Location: `js/timetracker.js`, in `taskList.refresh()` (around line 1606)

Modify the existing filter condition to also check for starred status.

**Current logic:**
```javascript
if(taskList.hideCompletedTasks == false || task.status != "completed"){
```

**Updated logic:**
```javascript
var showTask = true;

// Hide completed filter
if(taskList.hideCompletedTasks && task.status == "completed"){
  showTask = false;
}

// Show only starred filter
if(taskList.showOnlyStarred && task.starred != "1"){
  showTask = false;
}

if(showTask){
```

---

## 8. CSS Styling

### Location: `css/timetracker-flat.css`

Add styles for the star icons:

```css
/* Task star icon */
.task-star {
  cursor: pointer;
  color: #ccc;
  margin-right: 5px;
  transition: color 0.2s ease;
}

.task-star:hover {
  color: #e8c547;
}

.task-star.starred {
  color: #e8c547;
}

/* Filter star icon */
#filter-starred {
  cursor: pointer;
  color: #ccc;
  font-size: 1.2em;
  transition: color 0.2s ease;
}

#filter-starred:hover {
  color: #e8c547;
}

#filter-starred.filter-active {
  color: #e8c547;
}
```

---

## Implementation Order

1. **Add `toggleTaskStar()` function** - Core toggle logic
2. **Add star icon generation in `taskList.refresh()`** - Display star on each task
3. **Update HTML template** - Add `{{starIcon}}` placeholder
4. **Add `taskList.toggleStarFilter()` function** - Filter toggle logic
5. **Modify filter logic in `taskList.refresh()`** - Apply star filter
6. **Add filter star icon to HTML** - UI for filter toggle
7. **Add CSS styling** - Visual appearance
8. **Test all functionality**

---

## Files to Modify

| File | Changes |
|------|---------|
| `js/timetracker.js` | Add `toggleTaskStar()`, add star icon generation, add `taskList.toggleStarFilter()`, modify filter logic |
| `index.html` | Add `{{starIcon}}` to template, add filter star icon to options |
| `css/timetracker-flat.css` | Add `.task-star` and `#filter-starred` styles |

---

## Test Cases

1. Click star on unstarred task → star turns yellow, task.starred = "1"
2. Click star on starred task → star turns grey, task.starred = "0"
3. Click filter star → only starred tasks shown, filter star turns yellow
4. Click filter star again → all tasks shown, filter star turns grey
5. Star state persists after page reload
6. Star state syncs to server correctly
7. Combining filters: hide completed + show starred works correctly
