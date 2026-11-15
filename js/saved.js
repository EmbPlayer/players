"use strict";

/* ============================================================
   SAVED: saved-device list — check, toggle, render.
   ============================================================ */

function isLinkSaved(ip, port){
  const url = `http://${ip}:${port}/`;
  return state.savedLinks.some(item => item.url === url);
}

function toggleSaveLink(ip, port){
  const url = `http://${ip}:${port}/`;
  const existingLabel = (state.labels[ip] && state.labels[ip].label)
    ? state.labels[ip].label : "";

  const idx = state.savedLinks.findIndex(item => item.url === url);
  if(idx >= 0){
    state.savedLinks.splice(idx, 1);
    notify("Removed from saved devices");
  } else {
    state.savedLinks.push({ url, ip, port, label: existingLabel });
    notify("Saved to your devices ⭐");
  }

  saveSavedLinks();
  renderSavedList();

  if(!state.running && state.targetPort){
    renderList(state.lastOpenList, state.targetPort, false);
  }
}

function renderSavedList(){
  if(!state.savedLinks.length){
    savedTableWrapper.classList.add("hidden");
    savedEmptyState.classList.remove("hidden");
    return;
  }

  savedEmptyState.classList.add("hidden");
  savedTableWrapper.classList.remove("hidden");
  savedTbody.innerHTML = "";

  for(const item of state.savedLinks){
    const tr = document.createElement("tr");
    const port = item.port || 8080;

    /* ----- URL cell ----- */
    const tdUrl = document.createElement("td");
    tdUrl.className = "ip";
    tdUrl.textContent = item.url;
    tdUrl.title = `Open ${item.url} fullscreen`;
    tdUrl.addEventListener("click", () => openViewer(item.ip, port));

    /* ----- label cell ----- */
    const tdLabel = document.createElement("td");
    const cellActions = document.createElement("div");
    cellActions.className = "cell-actions";

    const labelText = document.createElement("span");
    labelText.textContent = item.label || "Add label...";
    labelText.className = item.label ? "label-text" : "label-text empty";
    labelText.addEventListener("click", () => {
      if(item.label) openViewer(item.ip, port);
    });

    const editBtn = document.createElement("button");
    editBtn.className = "edit-icon";
    editBtn.innerHTML = "✏️";
    editBtn.title = "Edit label";

    const editContainer = document.createElement("div");
    editContainer.className = "label-edit-container";

    const editInput = document.createElement("input");
    editInput.type = "text";
    editInput.className = "label-input";
    editInput.value = item.label || "";
    editInput.placeholder = "Enter label...";

    const submitBtn = document.createElement("button");
    submitBtn.className = "primary";
    submitBtn.style.padding = "6px 12px";
    submitBtn.style.fontSize = "12px";
    submitBtn.textContent = "Submit";

    editContainer.append(editInput, submitBtn);

    function startEdit(){
      labelText.style.display = "none";
      editBtn.style.display = "none";
      editContainer.style.display = "flex";
      editInput.focus();
    }

    function finishEdit(){
      editContainer.style.display = "none";
      labelText.style.display = "block";
      editBtn.style.display = "block";

      const newVal = editInput.value.trim();
      item.label = newVal;

      if(state.labels[item.ip]){
        state.labels[item.ip].label = newVal;
        saveLabels();
      }
      saveSavedLinks();

      labelText.textContent = newVal || "Add label...";
      labelText.className = newVal ? "label-text" : "label-text empty";

      if(!state.running && state.targetPort){
        renderList(state.lastOpenList, state.targetPort, false);
      }
    }

    editBtn.addEventListener("click", startEdit);
    submitBtn.addEventListener("click", finishEdit);

    editInput.addEventListener("keydown", (e) => {
      if(e.key === "Enter") finishEdit();
      else if(e.key === "Escape"){
        editInput.value = item.label || "";
        editContainer.style.display = "none";
        labelText.style.display = "block";
        editBtn.style.display = "block";
      }
    });

    cellActions.append(labelText, editBtn, editContainer);
    tdLabel.appendChild(cellActions);

    /* ----- action cell ----- */
    const tdAction = document.createElement("td");
    tdAction.style.textAlign = "right";

    const actionDiv = document.createElement("div");
    actionDiv.className = "saved-actions";

    const removeBtn = document.createElement("button");
    removeBtn.className = "delete-icon";
    removeBtn.innerHTML = "🗑️";
    removeBtn.title = "Remove from saved links";
    removeBtn.addEventListener("click", () => {
      state.savedLinks = state.savedLinks.filter(s => s.url !== item.url);
      saveSavedLinks();
      renderSavedList();
      if(!state.running && state.targetPort){
        renderList(state.lastOpenList, state.targetPort, false);
      }
    });

    actionDiv.appendChild(removeBtn);
    tdAction.appendChild(actionDiv);

    tr.append(tdUrl, tdLabel, tdAction);
    savedTbody.appendChild(tr);
  }
}