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

/* ⚙️ Settings is one of the two explicit permission entry points.
   Every click while not granted fires a LAN probe (which is what
   triggers Chrome's native LNA prompt when state is "prompt").
   The gate — if it happened to be open from a prior badge click —
   is hidden so the modal is not trapped underneath it.
   The modal ALWAYS opens, so the user is never blocked from
   configuring scan options. */
btnOpenConfig.addEventListener("click", async () => {
  if(typeof localNetGate !== "undefined" &&
     typeof triggerAllow === "function" &&
     localNetGate.permissionState !== "granted" &&
     !localNetGate.scanVerified){
    const r = await triggerAllow();
    if(typeof hideLocalNetGate === "function") hideLocalNetGate();
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

const viewerLabelBtn = document.getElementById("viewerLabel");

/* ---------- open viewer ----------
   Opens the device directly. NO permission check, NO gate, NO
   toast — a link loaded via ?load= / ?device=, a click on a
   scan result, and a click on a saved device all use this path.
   If the browser happens to allow the iframe (which is common
   from http://localhost even without LNA), it just works.       */
function openViewer(ip, port){
  const url = `http://${ip}:${port}${DEVICE_PATH}`;
  state.currentViewerUrl = url;
  viewerFrame.src = url;
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
  state.currentViewerUrl = null;
  state.currentViewerLabel = "";
  document.body.style.overflow = "";
  clearViewerState();
  updateViewerLabel("", 0);
}

viewerClose.addEventListener("click", closeViewer);

/* Escape: dismiss gate first (so user can skip and keep using the
   site), then viewer, then config modal. */
document.addEventListener("keydown", (e) => {
  if(e.key !== "Escape") return;

  const gate = document.getElementById("localNetGate");
  if(gate && !gate.classList.contains("hidden")){
    hideLocalNetGate();
    return;
  }

  if(!viewer.classList.contains("hidden")) closeViewer();
  if(!configModal.classList.contains("hidden")) closeConfigModal();
});

viewerReload.addEventListener("click", () => {
  const u = state.currentViewerUrl;
  if(!u) return;
  viewerFrame.src = "about:blank";
  requestAnimationFrame(() => { viewerFrame.src = u; });
});
