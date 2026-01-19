# Feature Plan: Move Projects Between Clients & Tasks Between Projects

## Overview

Add the ability to reassign projects to different clients and tasks to different projects via the existing edit form system.

---

## Current Architecture

### Data Structure
```
ttData.clients = {
  "client_id": {
    id, name,
    projects: {
      "project_id": {
        id, name,
        tasks: {
          "task_id": {
            id, name, status, sessions: {...}
          }
        }
      }
    }
  }
}
```

### Key Functions
| Function | Location | Purpose |
|----------|----------|---------|
| `editFields` | Line 93 | Defines editable fields per type |
| `showGeneralEditForm()` | Line 1022 | Generates edit popup dynamically |
| `saveGeneralEditForm()` | Line 931 | Saves form values to data structure |
| `getItemById()` | Line 3005 | Retrieves item by traversing hierarchy |
| `getBranchById()` | Line 3019 | Retrieves item with full parent context |
| `updateItemById()` | Line 3033 | Updates item in place (no parent change) |
| `deleteItemById()` | Line 3055 | Removes item from parent collection |

---

## Implementation Steps

### Step 1: Add Parent ID Fields to `editFields`

Add new select fields for parent selection in `editFields` object (around line 93):

```javascript
project : {
  name : { label : "Name", type : "text" },
  id : { label : "ID", type : "text" },
  // NEW: Client selector for moving projects
  _client : {
    label : "Client",
    type : "select",
    dynamicOptions : "clients"
  }
},
task : {
  // ... existing fields ...
  // NEW: Project selector for moving tasks
  _project : {
    label : "Project",
    type : "select",
    dynamicOptions : "projects"
  }
}
```

**Note:** Using underscore prefix (`_client`, `_project`) to distinguish these as special parent-reference fields that require custom handling.

---

### Step 2: Create Helper Function to Build Dynamic Options

Add a new function to generate select options from current data:

```javascript
function buildDynamicOptions(optionType, currentItemId) {
  var options = {};

  if(optionType === "clients") {
    // All clients for project parent selection
    for(var clientId in ttData.clients) {
      options[clientId] = ttData.clients[clientId].name;
    }
  }
  else if(optionType === "projects") {
    // All projects across all clients for task parent selection
    for(var clientId in ttData.clients) {
      var client = ttData.clients[clientId];
      if(client.projects) {
        for(var projectId in client.projects) {
          // Format: "Client Name > Project Name"
          options[projectId] = client.name + " > " + client.projects[projectId].name;
        }
      }
    }
  }

  return options;
}
```

---

### Step 3: Modify `showGeneralEditForm()` for Dynamic Options

Update the select field rendering (around line 1060) to handle dynamic options:

```javascript
}else if(field.type == "select"){

  var fieldDiv = document.createElement('div');
  fieldDiv.className = "edit-field";
  fieldDiv.innerHTML = field.label;

  var select = document.createElement('select');
  select.id = type+'-'+key+'-edit-input';

  // NEW: Handle dynamic options
  var options;
  if(field.dynamicOptions) {
    options = buildDynamicOptions(field.dynamicOptions, id);

    // Set current value from parent context
    if(key === "_client" && type === "project") {
      var branch = getBranchById("project", id);
      val = branch.client.id;
    } else if(key === "_project" && type === "task") {
      var branch = getBranchById("task", id);
      val = branch.project.id;
    }
  } else {
    options = field.options;
  }

  for (var optkey in options){
    var option = new Option(options[optkey], optkey);
    select.options.add(option);
  }

  select.value = val;

  fieldDiv.appendChild(select);
  $("#edit-popup").append(fieldDiv);

}
```

---

### Step 4: Create Move Functions

Add dedicated functions for moving items between parents:

```javascript
/**
 * Move a project from one client to another
 * @param {string} projectId - The project to move
 * @param {string} newClientId - The destination client
 * @returns {boolean} Success status
 */
function moveProjectToClient(projectId, newClientId) {
  var branch = getBranchById("project", projectId);
  if(!branch.project) {
    console.error("Project not found:", projectId);
    return false;
  }

  var oldClientId = branch.client.id;

  // Don't move if same client
  if(oldClientId === newClientId) {
    return true;
  }

  // Validate destination client exists
  if(!ttData.clients[newClientId]) {
    console.error("Destination client not found:", newClientId);
    return false;
  }

  // Get the project data
  var projectData = branch.project;

  // Remove from old client
  delete ttData.clients[oldClientId].projects[projectId];

  // Ensure new client has projects object
  if(!ttData.clients[newClientId].projects) {
    ttData.clients[newClientId].projects = {};
  }

  // Add to new client
  ttData.clients[newClientId].projects[projectId] = projectData;

  // Update current_project if it was the moved project
  if(current_project && current_project.id === projectId) {
    current_project = ttData.clients[newClientId].projects[projectId];
    current_client = ttData.clients[newClientId];
  }

  console.log("Moved project", projectId, "from client", oldClientId, "to", newClientId);
  return true;
}

/**
 * Move a task from one project to another
 * @param {string} taskId - The task to move
 * @param {string} newProjectId - The destination project
 * @returns {boolean} Success status
 */
function moveTaskToProject(taskId, newProjectId) {
  var branch = getBranchById("task", taskId);
  if(!branch.task) {
    console.error("Task not found:", taskId);
    return false;
  }

  var oldProjectId = branch.project.id;
  var oldClientId = branch.client.id;

  // Don't move if same project
  if(oldProjectId === newProjectId) {
    return true;
  }

  // Find the new project's client
  var newBranch = getBranchById("project", newProjectId);
  if(!newBranch.project) {
    console.error("Destination project not found:", newProjectId);
    return false;
  }
  var newClientId = newBranch.client.id;

  // Get the task data
  var taskData = branch.task;

  // Remove from old project
  delete ttData.clients[oldClientId].projects[oldProjectId].tasks[taskId];

  // Ensure new project has tasks object
  if(!ttData.clients[newClientId].projects[newProjectId].tasks) {
    ttData.clients[newClientId].projects[newProjectId].tasks = {};
  }

  // Add to new project
  ttData.clients[newClientId].projects[newProjectId].tasks[taskId] = taskData;

  // Update current_task if it was the moved task
  if(current_task && current_task.id === taskId) {
    current_task = ttData.clients[newClientId].projects[newProjectId].tasks[taskId];
    current_project = ttData.clients[newClientId].projects[newProjectId];
    current_client = ttData.clients[newClientId];
  }

  console.log("Moved task", taskId, "from project", oldProjectId, "to", newProjectId);
  return true;
}
```

---

### Step 5: Modify `saveGeneralEditForm()` to Handle Moves

Update the save function (around line 931) to detect and handle parent changes:

```javascript
function saveGeneralEditForm(type,id){

  if(type == 'settings'){
    var item = ttData.settings;
  }else{
    var item = getItemById(type,id);
  }

  // NEW: Track parent changes before extracting values
  var newClientId = null;
  var newProjectId = null;

  if(type === "project") {
    var clientInput = document.getElementById("project-_client-edit-input");
    if(clientInput) {
      newClientId = clientInput.value;
    }
  }

  if(type === "task") {
    var projectInput = document.getElementById("task-_project-edit-input");
    if(projectInput) {
      newProjectId = projectInput.value;
    }
  }

  // Extract standard field values
  for (key in editFields[type]){
    // Skip the parent selector fields (handled separately)
    if(key === "_client" || key === "_project") {
      continue;
    }
    if(document.getElementById(type+"-"+key+"-edit-input")){
      item[key] = document.getElementById(type+"-"+key+"-edit-input").value;
    }else{
      dbg("Field not found in edit form:",key);
    }
  }

  // Convert estimate from minutes to seconds for storage
  if(type == "task" && item.estimate){
    item.estimate = parseFloat(item.estimate) * 60;
  }

  if(type == "task"){
    item.displayStatus = editFields.task.status.options[item.status];
  }

  // NEW: Handle parent changes (move operations)
  var moved = false;

  if(type === "project" && newClientId) {
    moved = moveProjectToClient(id, newClientId);
    if(moved) {
      // Item was moved, update reference
      item = ttData.clients[newClientId].projects[id];
    }
  }

  if(type === "task" && newProjectId) {
    moved = moveTaskToProject(id, newProjectId);
    if(moved) {
      // Item was moved, get updated reference
      var newBranch = getBranchById("task", id);
      item = newBranch.task;
    }
  }

  // Update item properties (in new location if moved)
  if(!moved) {
    updateItemById(type,id,item);
  }

  /* Unset task time value if edited session */
  if(type == "session"){
    var branch = getBranchById(type,id);
    var parentTask = branch.task;
    delete parentTask.time;
    updateItemById("task",parentTask.id,parentTask);
  }

  if(type != "session" && type != "settings" && type != "task"){
    updateSelectOptionsFromData(type);
  }

  ttSave();
  setFeedback('Item updated');
  cancelEditForm();

  if(typeof currentView.update == "function"){
    currentView.update();
  }
}
```

---

## Testing Checklist

### Move Project to Different Client
- [ ] Edit popup shows "Client" dropdown with all clients
- [ ] Current client is pre-selected
- [ ] Selecting different client and saving moves project
- [ ] Project's tasks remain intact after move
- [ ] Task list view updates correctly
- [ ] `current_project` / `current_client` updated if moved project was selected

### Move Task to Different Project
- [ ] Edit popup shows "Project" dropdown with all projects (format: "Client > Project")
- [ ] Current project is pre-selected
- [ ] Selecting different project and saving moves task
- [ ] Task's sessions remain intact after move
- [ ] Can move task to project under different client
- [ ] Task list view updates correctly
- [ ] `current_task` / `current_project` / `current_client` updated if moved task was selected

### Edge Cases
- [ ] Moving to same parent (no-op, no error)
- [ ] Empty projects object on destination (auto-creates)
- [ ] Empty tasks object on destination (auto-creates)
- [ ] Synch queue updated for moved items

---

## Future Considerations

1. **Sync Queue Integration**: Add moved items to `synchQueue` for server sync
2. **Undo Support**: Consider storing previous parent for undo capability
3. **Bulk Move**: Select multiple tasks to move at once
4. **Drag & Drop**: Visual drag-and-drop in task list view
5. **Move Confirmation**: Optional confirmation dialog for moves

---

## Files to Modify

| File | Changes |
|------|---------|
| `js/timetracker.js` | Add `_client`/`_project` to `editFields`, add `buildDynamicOptions()`, add `moveProjectToClient()`, add `moveTaskToProject()`, modify `showGeneralEditForm()`, modify `saveGeneralEditForm()` |

---

## Estimated Scope

- **New Functions**: 3 (`buildDynamicOptions`, `moveProjectToClient`, `moveTaskToProject`)
- **Modified Functions**: 2 (`showGeneralEditForm`, `saveGeneralEditForm`)
- **Modified Objects**: 1 (`editFields`)
- **Lines of Code**: ~150-200 new/modified lines
