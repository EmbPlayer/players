"use strict";

/* ============================================================
   UI: toasts, results-panel toggle, config modal,
   fullscreen viewer, keyboard shortcuts.
   ============================================================ */

/* ---------- toast ---------- */
function notify(msg, type){
  const el = document.createElement("div");
  el.className = "toast" + (type === "error" ? " error" : "");
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

/* ---------- results toggle ---------- */
function updateResultsToggleLabel(){
  const arrow = state.resultsVisible ? "▼" : "▶";
  const n = state.resultCount || 0;
  btnToggleResults.firstElementChild.textContent =
    `${arrow} Scan Results${n > 0 ? ` (${n})` : ""}`;
  btnToggleResults.setAttribute("aria-expanded", state.resultsVisible ? "true" : "false");
}

function setResultsVisible(visible){
  state.resultsVisible = visible;
  try{ localStorage.setItem(LSK.resultsVisible, visible ? "1" : "0"); }catch{}
  resultsContainer.style.display = visible ? "block" : "none";
  updateResultsToggleLabel();
}

btnToggleResults.addEventListener("click", () => {
  setResultsVisible(!state.resultsVisible);
});

/* ---------- config modal ---------- */
function openConfigModal(){
  configModal.classList.remove("hidden");
  timeoutInput.focus();
}
function closeConfigModal(){
  configModal.classList.add("hidden");
}

btnOpenConfig.addEventListener("click", openConfigModal);
btnModalClose.addEventListener("click", closeConfigModal);
btnModalCancel.addEventListener("click", closeConfigModal);

btnModalSave.addEventListener("click", () => {
  closeConfigModal();
  updateMainTarget();   // defined in url.js
});

/* ============================================================
   FULLSCREEN VIEWER
   ============================================================ */

/* Grab the label button once — it never leaves the DOM. */
const viewerLabelBtn = document.getElementById("viewerLabel");

/* ---------- open viewer ---------- */
function openViewer(ip, port){
  if(typeof localNetBlocked === "function" && localNetBlocked()){
    showLocalNetGate();
    notify("Allow local network access before opening devices.", "error");
    return;
  }

  /* Hidden DEVICE_PATH is appended here — the user never sees it. */
  const url = `http://${ip}:${port}${DEVICE_PATH}`;
  state.currentViewerUrl = url;
  viewerFrame.src = url;
  viewer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  updateViewerLabel(ip, port);
  saveViewerState(ip, port);
}

/* ---------- resolve label for the current ip/port ---------- */
function resolveViewerLabel(ip, port){
  if(!ip) return "";

  if(state.labels && state.labels[ip] && state.labels[ip].label){
    return state.labels[ip].label;
  }

  if(Array.isArray(state.savedLinks)){
    const saved = state.savedLinks.find(
      s => s.ip === ip && (s.port === port || (!s.port && port === 8080))
    );
    if(saved && saved.label) return saved.label;
  }

  return "";
}

/* ---------- refresh the label button for a new device ---------- */
function updateViewerLabel(ip, port){
  if(!viewerLabelBtn) return;

  const label = resolveViewerLabel(ip, port);
  state.currentViewerLabel = label;

  /* Always start in the collapsed "📌" state */
  viewerLabelBtn.classList.remove("active");
  viewerLabelBtn.setAttribute("aria-pressed", "false");
  viewerLabelBtn.textContent = "📌";

  if(!label){
    viewerLabelBtn.hidden = true;
    viewerLabelBtn.title = "No label set for this device";
    viewerLabelBtn.setAttribute("aria-label", "No label");
    return;
  }

  viewerLabelBtn.hidden = false;
  viewerLabelBtn.title = "Show label";
  viewerLabelBtn.setAttribute("aria-label", "Show label");
}

/* ---------- 📌 click → toggle between label text and icon ---------- */
function toggleViewerLabel(){
  if(!viewerLabelBtn || !state.currentViewerLabel) return;

  const nowActive = viewerLabelBtn.classList.toggle("active");
  viewerLabelBtn.setAttribute("aria-pressed", nowActive ? "true" : "false");

  if(nowActive){
    viewerLabelBtn.textContent = state.currentViewerLabel;
    viewerLabelBtn.title = "Hide label";
    viewerLabelBtn.setAttribute("aria-label", "Hide label");
  } else {
    viewerLabelBtn.textContent = "📌";
    viewerLabelBtn.title = "Show label";
    viewerLabelBtn.setAttribute("aria-label", "Show label");
  }
}

if(viewerLabelBtn){
  viewerLabelBtn.addEventListener("click", toggleViewerLabel);
}

/* ---------- close viewer ---------- */
function closeViewer(){
  viewer.classList.add("hidden");
  viewerFrame.src = "about:blank";
  state.currentViewerUrl = null;
  state.currentViewerLabel = "";
  document.body.style.overflow = "";
  clearViewerState();
  updateViewerLabel("", 0);
}

viewerClose.addEventListener("click", closeViewer);

document.addEventListener("keydown", (e) => {
  if(e.key !== "Escape") return;

  const gate = document.getElementById("localNetGate");
  if(gate && !gate.classList.contains("hidden")) return;

  if(!viewer.classList.contains("hidden")) closeViewer();
  if(!configModal.classList.contains("hidden")) closeConfigModal();
});

viewerReload.addEventListener("click", () => {
  const u = state.currentViewerUrl;
  if(!u) return;
  viewerFrame.src = "about:blank";
  requestAnimationFrame(() => { viewerFrame.src = u; });
});
