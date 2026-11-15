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

/* ---------- https warning ---------- */
if(location.protocol === "https:") httpsWarn.classList.remove("hidden");

/* ---------- fullscreen viewer ---------- */
function openViewer(ip, port){
  /* --- local network access gate (must be granted to open devices) --- */
  if(typeof localNetBlocked === "function" && localNetBlocked()){
    showLocalNetGate();
    notify("Allow local network access before opening devices.", "error");
    return;
  }

  const url = `http://${ip}:${port}/`;
  state.currentViewerUrl = url;
  viewerFrame.src = url;
  viewer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  updateViewerLabel(ip, port);
  saveViewerState(ip, port);
}

/* ---------- viewer label chip + toggle ---------- */
function updateViewerLabel(ip, port){
  const chip = document.getElementById("viewerLabel");
  const btn  = document.getElementById("viewerLabelToggle");
  if(!chip || !btn) return;

  let label = "";

  /* First: label from the scanned-device label store */
  if(ip && state.labels && state.labels[ip] && state.labels[ip].label){
    label = state.labels[ip].label;
  }

  /* Fallback: label from the saved-links list */
  if(!label && ip && Array.isArray(state.savedLinks)){
    const saved = state.savedLinks.find(
      s => s.ip === ip && (s.port === port || (!s.port && port === 8080))
    );
    if(saved && saved.label) label = saved.label;
  }

  /* Remember current label so the toggle handler can use it. */
  state.currentViewerLabel = label;

  if(label){
    chip.textContent = "📌 " + label;
    chip.title = label;
    chip.classList.add("hidden");          /* starts hidden — user toggles */

    btn.classList.remove("hidden");
    btn.classList.remove("active");
    btn.disabled = false;
    btn.title = "Show label";
    btn.setAttribute("aria-label", "Show label");
  } else {
    chip.textContent = "";
    chip.removeAttribute("title");
    chip.classList.add("hidden");

    btn.classList.add("hidden");
    btn.classList.remove("active");
    btn.disabled = true;
    btn.title = "No label";
    btn.setAttribute("aria-label", "No label");
  }
}

function toggleViewerLabel(){
  const chip = document.getElementById("viewerLabel");
  const btn  = document.getElementById("viewerLabelToggle");
  if(!chip || !btn) return;

  if(!state.currentViewerLabel) return;   /* nothing to toggle */

  const isHidden = chip.classList.contains("hidden");
  if(isHidden){
    chip.classList.remove("hidden");
    btn.classList.add("active");
    btn.title = "Hide label";
    btn.setAttribute("aria-label", "Hide label");
  } else {
    chip.classList.add("hidden");
    btn.classList.remove("active");
    btn.title = "Show label";
    btn.setAttribute("aria-label", "Show label");
  }
}

function closeViewer(){
  viewer.classList.add("hidden");
  viewerFrame.src = "about:blank";
  state.currentViewerUrl = null;
  state.currentViewerLabel = "";
  document.body.style.overflow = "";
  clearViewerState();
  updateViewerLabel("", 0);   /* reset chip + toggle */
}

viewerClose.addEventListener("click", closeViewer);

/* Wire the label toggle button (element exists at script load time). */
(function wireViewerLabelToggle(){
  const btn = document.getElementById("viewerLabelToggle");
  if(btn) btn.addEventListener("click", toggleViewerLabel);
})();

document.addEventListener("keydown", (e) => {
  if(e.key !== "Escape") return;

  // If the local-network gate is open, do NOT let Escape dismiss
  // anything behind it — the user must grant permission first.
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
