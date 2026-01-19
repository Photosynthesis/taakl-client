# "Today" View Feature Implementation Plan

## Overview
Add a new "Today" view that displays tasks organized into three sections:
1. **Top section**: Uncompleted tasks with both `#daily` AND `#morning` tags
2. **Middle section**: Starred tasks (uncompleted) that don't belong to top/bottom sections
3. **Bottom section**: Uncompleted tasks with both `#daily` AND `#evening` tags

This requires implementing a tag parsing system (tags extracted from task name) and a new view with sectioned display.

---

## Prerequisites

The codebase currently has no tag system. Tags will be parsed from the existing `name` field on tasks, using hashtag syntax (e.g., `Buy groceries #daily #morning`). A future enhancement will parse the name input and store tags separately.

---

## 1. Tag Parsing System

### Location: `js/timetracker.js`, utility functions section (around line 3380)

Create a function to extract hashtags from a string (task name):

```javascript
/**
 * Extract hashtags from a string
 * @param {string} text - The text to parse (e.g., task name)
 * @returns {array} - Array of lowercase tag names without the # symbol
 */
function extractTags(text){
  if(!text || typeof text !== "string"){
    return [];
  }
  var tagRegex = /#([a-zA-Z0-9_]+)/g;
  var tags = [];
  var match;
  while((match = tagRegex.exec(text)) !== null){
    tags.push(match[1].toLowerCase());
  }
  return tags;
}

/**
 * Check if a task has all specified tags (parsed from task name)
 * @param {object} task - The task object
 * @param {array} requiredTags - Array of tag names to check for
 * @returns {boolean} - True if task has ALL required tags
 */
function taskHasTags(task, requiredTags){
  var taskTags = extractTags(task.name);
  for(var i = 0; i < requiredTags.length; i++){
    if(taskTags.indexOf(requiredTags[i].toLowerCase()) === -1){
      return false;
    }
  }
  return true;
}
```

---

## 2. Create Today View Object

### Location: `js/timetracker.js`, after `analyze = {}` declaration (around line 25)

Declare the todayView object:

```javascript
todayView = {};
```

---

## 3. Add Today View HTML Container

### Location: `index.html`, after the analyze-view div (around line 223)

```html
<!-- Today View -->
<div id="todayView-view" class="view-container" style="display: none">
  <h3>Today</h3>

  <div id="today-morning-section" class="today-section">
    <div class="today-section-header">
      <i class="fa fa-sun-o"></i> Morning
    </div>
    <div class="today-section-tasks" id="today-morning-tasks">
      <!-- Morning tasks rendered here -->
    </div>
  </div>

  <div id="today-starred-section" class="today-section">
    <div class="today-section-header">
      <i class="fa fa-star"></i> Starred
    </div>
    <div class="today-section-tasks" id="today-starred-tasks">
      <!-- Starred tasks rendered here -->
    </div>
  </div>

  <div id="today-evening-section" class="today-section">
    <div class="today-section-header">
      <i class="fa fa-moon-o"></i> Evening
    </div>
    <div class="today-section-tasks" id="today-evening-tasks">
      <!-- Evening tasks rendered here -->
    </div>
  </div>

  <div id="today-no-tasks" style="display: none;">
    <div style="font-size: 1.2em; color: #aaa; text-align: center; padding: 20px;">
      No tasks for today. Add #daily #morning or #daily #evening tags to task names.
    </div>
  </div>
</div>
```

---

## 4. Add Today View Navigation Link

### Location: `index.html`, in view-links div (around line 28-38)

Add a link to the Today view in the header navigation:

```html
<a href="#void" class="view-switch" onClick="setView('todayView')">
  <i class="fa fa-calendar-check-o fa-lg"></i><span>Today</span>
</a>
```

Place this before or after the existing "Track" link.

---

## 5. Implement todayView.show()

### Location: `js/timetracker.js`, after other view implementations (around line 2000)

```javascript
todayView.show = function(){
  // Hide client/project controls - not needed for today view
  gebi("client-project-controls").style.display = "none";

  // Initialize task containers
  todayView.morningTasks = [];
  todayView.starredTasks = [];
  todayView.eveningTasks = [];

  // Register event watchers
  addEventWatcher('task', 'updated', function(){
    todayView.update();
  }, 'todayView');

  addEventWatcher('task', 'added', function(){
    todayView.update();
  }, 'todayView');

  addEventWatcher('task', 'deleted', function(){
    todayView.update();
  }, 'todayView');

  addEventWatcher('server', 'synch', function(){
    todayView.update();
  }, 'todayView');

  todayView.update();
};
```

---

## 6. Implement todayView.hide()

### Location: `js/timetracker.js`, after `todayView.show()`

```javascript
todayView.hide = function(){
  removeEventWatchers('todayView');

  // Show client/project controls again
  gebi("client-project-controls").style.display = "block";
};
```

---

## 7. Implement todayView.filter()

### Location: `js/timetracker.js`, after `todayView.hide()`

This function collects tasks into three categories:

```javascript
todayView.filter = function(){
  todayView.morningTasks = [];
  todayView.starredTasks = [];
  todayView.eveningTasks = [];

  // Track task IDs already categorized to avoid duplicates
  var categorizedIds = {};

  loopData([], function(){
    if(this.level == "task"){
      var task = this.task;

      // Skip completed tasks
      if(task.status == "completed"){
        return;
      }

      // Add metadata for display
      task.truncateName = truncateTaskName(task.name, 55);
      task.client = this.client.name;
      task.project = this.project.name;

      if(task.project && task.client){
        task.metaParentage = "<span>" + task.client + " > " + task.project + "</span>";
      } else if(task.project){
        task.metaParentage = "<span>" + task.project + "</span>";
      } else {
        task.metaParentage = "";
      }

      // Calculate time
      task.time = 0;
      for(var sid in task.sessions){
        var session = task.sessions[sid];
        if(session.start_time && session.end_time){
          task.time += timeDiffSecsFromString(session.start_time, session.end_time);
        }
      }
      task.metaPrettyTime = (task.time > 0) ? " | " + prettyTime(task.time) : "";

      // Check for morning tasks (#daily + #morning in name)
      if(taskHasTags(task, ["daily", "morning"])){
        todayView.morningTasks.push(task);
        categorizedIds[task.id] = true;
        return;
      }

      // Check for evening tasks (#daily + #evening in name)
      if(taskHasTags(task, ["daily", "evening"])){
        todayView.eveningTasks.push(task);
        categorizedIds[task.id] = true;
        return;
      }

      // Check for starred tasks (not already categorized)
      if(task.starred == "1" && !categorizedIds[task.id]){
        todayView.starredTasks.push(task);
        categorizedIds[task.id] = true;
      }
    }
  });
};
```

---

## 8. Implement todayView.refresh()

### Location: `js/timetracker.js`, after `todayView.filter()`

```javascript
todayView.refresh = function(){
  var morningContainer = gebi("today-morning-tasks");
  var starredContainer = gebi("today-starred-tasks");
  var eveningContainer = gebi("today-evening-tasks");
  var noTasksMsg = gebi("today-no-tasks");

  // Clear containers
  morningContainer.innerHTML = "";
  starredContainer.innerHTML = "";
  eveningContainer.innerHTML = "";

  // Render morning tasks
  todayView.morningTasks.forEach(function(task){
    morningContainer.appendChild(todayView.createTaskElement(task));
  });

  // Render starred tasks
  todayView.starredTasks.forEach(function(task){
    starredContainer.appendChild(todayView.createTaskElement(task));
  });

  // Render evening tasks
  todayView.eveningTasks.forEach(function(task){
    eveningContainer.appendChild(todayView.createTaskElement(task));
  });

  // Show/hide sections based on content
  gebi("today-morning-section").style.display =
    todayView.morningTasks.length > 0 ? "block" : "none";
  gebi("today-starred-section").style.display =
    todayView.starredTasks.length > 0 ? "block" : "none";
  gebi("today-evening-section").style.display =
    todayView.eveningTasks.length > 0 ? "block" : "none";

  // Show "no tasks" message if all sections empty
  var totalTasks = todayView.morningTasks.length +
                   todayView.starredTasks.length +
                   todayView.eveningTasks.length;
  noTasksMsg.style.display = (totalTasks === 0) ? "block" : "none";
};
```

---

## 9. Implement todayView.createTaskElement()

### Location: `js/timetracker.js`, after `todayView.refresh()`

Helper function to create a task DOM element (reusing the existing task template pattern):

```javascript
todayView.createTaskElement = function(task){
  var taskDiv = document.createElement("div");
  taskDiv.className = "today-task-item";
  taskDiv.setAttribute("data-task-id", task.id);

  // Checkbox for completion
  var checkedAttr = (task.status == "completed") ? "checked" : "";
  var checkCompleted = "<input type='checkbox' class='task-checkbox' " +
    checkedAttr + " onChange=\"setTaskComplete('" + task.id + "', this)\" />";

  // Star icon
  var starClass = (task.starred == "1") ? "starred" : "";
  var starIcon = "<i class='fa fa-star task-star " + starClass +
    "' onClick=\"toggleTaskStar('" + task.id + "')\"></i>";

  // Play button
  var playIcon = "<i onClick=\"startGeneralSession('" + task.id +
    "')\" style='cursor:pointer; color:#77aa88;' class='fa fa-play-circle fa-lg'></i>";

  taskDiv.innerHTML =
    "<div class='today-task-content' onDblClick=\"showGeneralEditForm('task','" + task.id + "')\">" +
      "<div class='today-task-main'>" +
        checkCompleted + " " + starIcon + " " + task.truncateName +
        "<span class='task-meta'>" + task.metaParentage + task.metaPrettyTime + "</span>" +
      "</div>" +
      "<div class='today-task-actions'>" + playIcon + "</div>" +
    "</div>";

  return taskDiv;
};
```

---

## 10. Implement todayView.update()

### Location: `js/timetracker.js`, after `todayView.createTaskElement()`

```javascript
todayView.update = function(){
  todayView.filter();
  todayView.refresh();
};
```

---

## 11. Add truncateTaskName Helper (if not exists)

### Location: `js/timetracker.js`, utility functions section

Check if this helper exists; if not, add it:

```javascript
function truncateTaskName(name, maxLength){
  if(!name) return "";
  if(name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + "...";
}
```

---

## 12. CSS Styling

### Location: `css/timetracker-flat.css`

Add styles for the Today view:

```css
/* Today View Styles */
#todayView-view h3 {
  margin-bottom: 20px;
  color: #555;
}

.today-section {
  margin-bottom: 25px;
  border: 1px solid #e0e0e0;
  border-radius: 5px;
  overflow: hidden;
}

.today-section-header {
  background: #f5f5f5;
  padding: 10px 15px;
  font-weight: bold;
  color: #666;
  border-bottom: 1px solid #e0e0e0;
}

.today-section-header i {
  margin-right: 8px;
}

#today-morning-section .today-section-header {
  background: #fff8e1;
  border-bottom-color: #ffe082;
}

#today-starred-section .today-section-header {
  background: #fff3e0;
  border-bottom-color: #ffcc80;
}

#today-evening-section .today-section-header {
  background: #e8eaf6;
  border-bottom-color: #9fa8da;
}

.today-section-tasks {
  padding: 5px 0;
}

.today-task-item {
  padding: 8px 15px;
  border-bottom: 1px solid #f0f0f0;
}

.today-task-item:last-child {
  border-bottom: none;
}

.today-task-item:hover {
  background: #fafafa;
}

.today-task-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.today-task-main {
  flex: 1;
}

.today-task-actions {
  flex: 0 0 30px;
  text-align: right;
}

.today-task-item .task-checkbox {
  margin-right: 8px;
}

.today-task-item .task-meta {
  font-size: 0.85em;
  color: #999;
  margin-left: 10px;
}
```

---

## 13. Register Today View in setView()

### Location: `js/timetracker.js`, in `setView()` function (around line 1306)

Ensure the view switcher handles `todayView`. The existing `setView()` function should already work if it uses dynamic lookup, but verify the view container ID matches the pattern `[viewName]-view`.

---

## Implementation Order

1. **Add tag parsing functions** (`extractTags()`, `taskHasTags()`)
2. **Declare `todayView = {}`** at top of file
3. **Add HTML container** for Today view in index.html
4. **Add navigation link** in header
5. **Implement `todayView.show()`** - Initialize and register watchers
6. **Implement `todayView.hide()`** - Cleanup watchers
7. **Implement `todayView.filter()`** - Categorize tasks
8. **Implement `todayView.createTaskElement()`** - Task DOM creation
9. **Implement `todayView.refresh()`** - Render to DOM
10. **Implement `todayView.update()`** - Combined filter + refresh
11. **Add CSS styling**
12. **Test all functionality**

---

## Files to Modify

| File | Changes |
|------|---------|
| `js/timetracker.js` | Add `extractTags()`, `taskHasTags()`, declare `todayView`, implement all `todayView` methods |
| `index.html` | Add Today view HTML container, add navigation link |
| `css/timetracker-flat.css` | Add `.today-section`, `.today-task-item` and related styles |

---

## Test Cases

1. Task with `#daily #morning` in name appears in Morning section
2. Task with `#daily #evening` in name appears in Evening section
3. Starred task (without daily tags) appears in Starred section
4. Completed tasks do not appear in any section
5. Task with `#daily #morning` that is also starred appears ONLY in Morning section (no duplicates)
6. Task with only `#daily` (no morning/evening) does not appear in Today view
7. Empty sections are hidden
8. "No tasks" message shows when all sections are empty
9. Clicking checkbox completes task and removes from view
10. Clicking star toggles star state and may move task between sections
11. Clicking play button starts a session
12. Double-clicking task opens edit form
13. View updates when tasks are added/edited/deleted
14. Tags are case-insensitive (`#Daily` = `#daily`)
15. Tags can appear anywhere in the name (e.g., `#daily Buy groceries #morning`)

---

## Future Enhancements (Out of Scope)

- Parse tags from name input and store separately on task object
- Dedicated tag input field on tasks
- Tag autocomplete
- Other time-based sections (afternoon, etc.)
- Drag-and-drop reordering within sections
- Persistence of section collapse state
- Strip tags from displayed task name (show clean name)
