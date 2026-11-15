"use strict";

/* ============================================================
   RESULTS: render scan results table (labels, save buttons,
   target highlight, summary line).
   ============================================================ */

function renderList(openList, port, isScanning = false){
  state.resultCount = openList.length;

  if(openList.length === 0 && !isScanning){
    resultsTableWrapper.classList.add("hidden");
    emptyState.classList.remove("hidden");
    summaryEl.innerHTML =
      `No responsive devices found on port <strong>${port}</strong>.`;
    updateResultsToggleLabel();
    saveLastList([], port);
    return;
  }

  emptyState.classList.add("hidden");
  resultsTableWrapper.classList.remove("hidden");
  tbody.innerHTML = "";

  let list = [...openList];
  if(state.targetIp){
    let found = list.find(o => o.ip === state.targetIp);
    if(found) found.isDirect = true;
  }

  const now = new Date().toISOString();

  for(const item of list){
    const { ip, isDirect } = item;

    if(!state.labels[ip]){
      state.labels[ip] = { label: "", firstSeen: now, lastSeen: now };
    } else {
      state.labels[ip].lastSeen = now;
    }

    const tr = document.createElement("tr");
    tr.className = isDirect ? "target-row" : "known-row";

    /* ----- IP cell ----- */
    const tdIp = document.createElement("td");
    tdIp.className = "ip";
    tdIp.textContent = ip;
    tdIp.title = `Open http://${ip}:${port}/ fullscreen`;
    tdIp.addEventListener("click", () => openViewer(ip, port));

    /* ----- label / save cell ----- */
    const tdLabel = document.createElement("td");
    const cellActions = document.createElement("div");
    cellActions.className = "cell-actions";

    const isSaved = isLinkSaved(ip, port);

    if(isSaved){
      const savedItem = state.savedLinks.find(
        s => s.url === `http://${ip}:${port}/`
      );
      const indicator = document.createElement("span");
      indicator.className = "saved-indicator";
      indicator.textContent = savedItem && savedItem.label
        ? `Label: "${savedItem.label}" (Saved)`
        : "(Saved)";
      cellActions.appendChild(indicator);
    } else {
      const labelText = document.createElement("span");
      const currentLabel = state.labels[ip].label || "";
      labelText.textContent = currentLabel || "Add label...";
      labelText.className = currentLabel ? "label-text" : "label-text empty";
      labelText.addEventListener("click", () => {
        if(state.labels[ip] && state.labels[ip].label) openViewer(ip, port);
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
      editInput.value = currentLabel;
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
        state.labels[ip].label = newVal;
        saveLabels();

        labelText.textContent = newVal || "Add label...";
        labelText.className = newVal ? "label-text" : "label-text empty";
      }

      editBtn.addEventListener("click", startEdit);
      submitBtn.addEventListener("click", finishEdit);

      editInput.addEventListener("keydown", (e) => {
        if(e.key === "Enter") finishEdit();
        else if(e.key === "Escape"){
          editInput.value = state.labels[ip].label || "";
          editContainer.style.display = "none";
          labelText.style.display = "block";
          editBtn.style.display = "block";
        }
      });

      cellActions.append(labelText, editBtn, editContainer);
    }

    const saveBtn = document.createElement("button");
    saveBtn.className = isSaved ? "save-link-btn saved" : "save-link-btn";
    saveBtn.innerHTML = isSaved ? "⭐ Saved" : "☆ Save";
    saveBtn.title = isSaved ? "Remove from saved links" : "Save this link";
    saveBtn.addEventListener("click", () => { toggleSaveLink(ip, port); });

    cellActions.appendChild(saveBtn);
    tdLabel.appendChild(cellActions);

    tr.append(tdIp, tdLabel);
    tbody.appendChild(tr);
  }

  saveLabels();

  if(isScanning){
    summaryEl.innerHTML =
      `Scanning network… found <strong>${openList.length}</strong> ` +
      `device${openList.length === 1 ? "" : "s"} so far.`;
  } else {
    saveLastList(openList, port);
    const hasTargetHit = list.some(o => o.isDirect);
    const tgtTxt = hasTargetHit
      ? ` <span style="color:var(--muted)">(🎯 = target)</span>`
      : "";
    summaryEl.innerHTML =
      `Found <strong>${openList.length}</strong> ` +
      `device${openList.length === 1 ? "" : "s"} on port <strong>${port}</strong>.` +
      tgtTxt +
      ` <span style="color:var(--muted)">Click an IP to open it fullscreen.</span>`;
  }

  updateResultsToggleLabel();
}