"use strict";

/* ============================================================
   LOCAL NETWORK ACCESS GATE
   ------------------------------------------------------------
   Browsers that implement Local Network Access (Chrome 138+)
   require the user to grant "Access devices on your local network"
   before a page may fetch private-IP resources. Without it, every
   LAN probe is silently blocked and scanning cannot work.

   This module:
     • queries the `local-network-access` permission
     • shows a blocking overlay when the permission is
       `prompt` or `denied`
     • triggers the browser prompt by probing a local address
     • re-checks and unblocks as soon as it is granted
   ============================================================ */

const LN_PERM = "local-network-access";

const localNetGate = {
  supported: false,
  status:    "unknown",   // unknown | granted | prompt | denied | unsupported
  probing:   false,
  gateEl:    null,
  msgEl:     null,
  helpEl:    null,
  statusEl:  null,
  btnEl:     null
};

/* ---------- helpers ---------- */
function localNetApiAvailable(){
  return !!(navigator.permissions && navigator.permissions.query);
}

function fetchWithTimeout(url, opts, ms){
  if(window.AbortSignal && AbortSignal.timeout){
    return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

async function queryLocalNetStatus(){
  if(!localNetApiAvailable()) return "unsupported";
  try{
    const st = await navigator.permissions.query({ name: LN_PERM });
    // Live react if the user flips it in site settings later.
    st.onchange = () => applyLocalNetState(st.state);
    return st.state || "unknown";
  }catch(_){
    return "unsupported";
  }
}

/* Used by scan.js / ui.js to block actions that need LAN access. */
function localNetBlocked(){
  return localNetGate.status === "prompt" ||
         localNetGate.status === "denied";
}

/* ---------- overlay wiring ---------- */
function cacheGateEls(){
  localNetGate.gateEl   = document.getElementById("localNetGate");
  localNetGate.msgEl    = document.getElementById("lnMsg");
  localNetGate.helpEl   = document.getElementById("lnDeniedHelp");
  localNetGate.statusEl = document.getElementById("lnStatus");
  localNetGate.btnEl    = document.getElementById("lnRetry");
}

function showLocalNetGate(){
  if(!localNetGate.gateEl) return;
  localNetGate.gateEl.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function hideLocalNetGate(){
  if(!localNetGate.gateEl) return;
  localNetGate.gateEl.classList.add("hidden");
  document.body.style.overflow = "";
}

function applyLocalNetState(st){
  localNetGate.status = st;

  if(st === "granted" || st === "unsupported" || st === "unknown"){
    hideLocalNetGate();
    return;
  }

  showLocalNetGate();

  if(st === "denied"){
    if(localNetGate.msgEl) localNetGate.msgEl.innerHTML =
      "Access to devices on your local network is <strong>blocked</strong>. " +
      "Scanning and opening devices will not work until you allow it.";
    if(localNetGate.helpEl) localNetGate.helpEl.classList.remove("hidden");
    if(localNetGate.btnEl) localNetGate.btnEl.textContent = "Try again";
    if(localNetGate.statusEl) localNetGate.statusEl.textContent =
      "If nothing happens, open your browser's site settings for this page " +
      "and set \"Local network access\" to Allow.";
  } else {
    if(localNetGate.msgEl) localNetGate.msgEl.innerHTML =
      "Embplayers must be granted permission to " +
      "<strong>access devices on your local network</strong>. " +
      "Without this, scanning cannot work.";
    if(localNetGate.helpEl) localNetGate.helpEl.classList.add("hidden");
    if(localNetGate.btnEl) localNetGate.btnEl.textContent = "Allow access";
    if(localNetGate.statusEl) localNetGate.statusEl.textContent = "";
  }
}

/* ---------- trigger the browser prompt ---------- */
async function triggerLocalNetPrompt(){
  if(localNetGate.probing) return;
  localNetGate.probing = true;
  if(localNetGate.btnEl)   localNetGate.btnEl.disabled = true;
  if(localNetGate.statusEl) localNetGate.statusEl.textContent = "Requesting permission…";

  const port = (state.parsed && state.parsed.port) || state.storedPort || 80;

  const probes = [];
  if(state.parsed && state.parsed.ip){
    probes.push({ ip: state.parsed.ip, port });
  } else if(state.storedSubnet){
    probes.push({ ip: `${state.storedSubnet}.1`, port });
  }
  probes.push({ ip: "192.168.0.1", port });
  probes.push({ ip: "192.168.1.1", port });
  probes.push({ ip: "10.0.0.1",   port });

  for(const p of probes){
    try{
      await fetchWithTimeout(`http://${p.ip}:${p.port}/`, {
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      }, 2500);
    }catch(_){ /* prompt fires regardless */ }
    // small pause so the browser can surface the prompt
    await new Promise(r => setTimeout(r, 250));
  }

  localNetGate.probing = false;
  if(localNetGate.btnEl) localNetGate.btnEl.disabled = false;

  const st = await queryLocalNetStatus();
  if(st === "granted"){
    hideLocalNetGate();
    notify("Local network access granted ✓");
  } else {
    applyLocalNetState(st);
  }
}

/* ---------- init ---------- */
(async function initLocalNetGate(){
  cacheGateEls();

  if(localNetGate.btnEl){
    localNetGate.btnEl.addEventListener("click", triggerLocalNetPrompt);
  }

  const st = await queryLocalNetStatus();
  if(st === "unsupported"){
    localNetGate.supported = false;
    applyLocalNetState("unsupported");   // leave app usable
    return;
  }
  localNetGate.supported = true;
  applyLocalNetState(st);
})();