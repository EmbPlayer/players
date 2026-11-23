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

btnOpenConfig.addEventListener("click", async () => {
  if(typeof localNetGate !== "undefined" &&
     typeof triggerAllow === "function" &&
     localNetGate.permissionState !== "granted" &&
     !localNetGate.scanVerified){

    if(localNetGate.mode === "public-origin" ||
       localNetGate.mode === "https-blocked" ||
       localNetGate.mode === "file-origin"){
      notify("Serve from http://localhost to enable LAN access", "error");
      openConfigModal();
      return;
    }

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
   Permission granted  → embed in the iframe (old way).
   No permission       → top-level redirect to the device.

   Also redirects from any public HTTPS origin — mixed content
   blocks the iframe there regardless of permission.              */
function openViewer(ip, port){
  const url = `http://${ip}:${port}${DEVICE_PATH}`;

  const granted =
    typeof effectiveStatus === "function" && effectiveStatus() === "granted";

  const publicHttps =
    location.protocol === "https:" ||
    (typeof localNetGate !== "undefined" && localNetGate.isPublicOrigin);

  if(!granted || publicHttps){
    /* No LNA permission, or impossible mixed content → redirect. */
    notify("Redirecting to device…");
    location.href = url;
    return;
  }

  /* Permission granted + local origin → embed in the iframe. */
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
