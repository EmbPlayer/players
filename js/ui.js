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

/* ⚙️ Settings — one of the two explicit permission entry points.
   Every click while not granted triggers permission. The gate is
   hidden first so the modal is not trapped behind it. The modal
   ALWAYS opens — user is never blocked from configuring options. */
btnOpenConfig.addEventListener("click", async () => {
  if(typeof localNetGate !== "undefined" &&
     typeof triggerAllow === "function" &&
     localNetGate.permissionState !== "granted" &&
     !localNetGate.scanVerified){

    if(localNetGate.mode === "public-origin"){
      notify("Serve from http://localhost to scan", "error");
      openConfigModal();
      return;
    }

    const r = await triggerAllow();
    if(typeof hideLocalNetGate === "function") hideLocalNetGate(false);
    if(r && effectiveStatus() !== "granted"){
      notify("Permission not granted — scanning is disabled until allowed", "error");
    }
  }
  openConfigModal();
});

btnModalClose.addEventListener("click", closeConfigModal);
btnModalCancel.addEventListener("click", closeConfigModal);

btnModalSave.addEventListener("click", () => {
  closeConfigModal();
  updateMainTarget();   // defined in url.js
});

/* ============================================================
   FULLSCREEN VIEWER
   ============================================================ */

const viewerLabelBtn  = document.getElementById("viewerLabel");
const viewerBlockedEl = document.getElementById("viewerBlocked");

function showViewerBlocked(){
  if(viewerFrame) viewerFrame.src = "about:blank";
  if(viewerBlockedEl) viewerBlockedEl.classList.remove("hidden");
}
function hideViewerBlocked(){
  if(viewerBlockedEl) viewerBlockedEl.classList.add("hidden");
}

/* openViewer never requests permission, never shows the gate,
   never shows a toast — deep links, scan results, and saved
   devices all use this path and must open directly.

   If the page itself is a public origin (or HTTPS / file://),
   Chrome will block the iframe at the network level regardless
   of permission, so a placeholder is shown instead.              */
function openViewer(ip, port){
  const url = `http://${ip}:${port}${DEVICE_PATH}`;
  state.currentViewerUrl = url;

  if(typeof isViewerBlockedByBrowser === "function" && isViewerBlockedByBrowser()){
    showViewerBlocked();
  } else {
    hideViewerBlocked();
    viewerFrame.src = url;
  }

  viewer.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  updateViewerLabel(ip, port);
  saveViewerState(ip, port);
}

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

function updateViewerLabel(ip, port){
  if(!viewerLabelBtn) return;

  const label = resolveViewerLabel(ip, port);
  state.currentViewerLabel = label;

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

function closeViewer(){
  viewer.classList.add("hidden");
  viewerFrame.src = "about:blank";
  hideViewerBlocked();
  state.currentViewerUrl = null;
  state.currentViewerLabel = "";
  document.body.style.overflow = "";
  clearViewerState();
  updateViewerLabel("", 0);
}

viewerClose.addEventListener("click", closeViewer);

/* Escape: dismiss gate first (user skip), then viewer, then modal. */
document.addEventListener("keydown", (e) => {
  if(e.key !== "Escape") return;

  const gate = document.getElementById("localNetGate");
  if(gate && !gate.classList.contains("hidden")){
    hideLocalNetGate(true);
    return;
  }

  if(!viewer.classList.contains("hidden")) closeViewer();
  if(!configModal.classList.contains("hidden")) closeConfigModal();
});

viewerReload.addEventListener("click", () => {
  if(typeof isViewerBlockedByBrowser === "function" && isViewerBlockedByBrowser()){
    notify("Serve from http://localhost to fix this", "error");
    return;
  }
  const u = state.currentViewerUrl;
  if(!u) return;
  viewerFrame.src = "about:blank";
  requestAnimationFrame(() => { viewerFrame.src = u; });
});
