"use strict";

/* ============================================================
   LOCAL NETWORK ACCESS GATE + BROWSER SUPPORT DETECTION
   ------------------------------------------------------------
   On load, applyMode() decides between:

     • "granted"  → hide gate, app works (old way); fires
                    window.__onLanGranted so main.js can process
                    a pending ?device= / ?load= deep link.
     • hard modes → SHOW gate immediately (this is the
                    "redirect to permission screen"):
                      chrome-prompt, chrome-denied,
                      https-blocked, file-origin, public-origin
     • soft modes → hide gate, show banner (Brave / Samsung /
                    Firefox / Safari / generic Chromium / unknown).

   Permission is REQUESTED only from:
     • 🌐 badge        (every click, if not granted)
     • ⚙️ Settings btn (every click, if not granted)
     • the gate's own Allow / Test buttons

   Gate is dismissable (Escape / backdrop click) → page stays
   usable; scanning will just not work until granted.
   ============================================================ */

const LN_PERM    = "local-network-access";
const LN_ACK_KEY = "lnAcknowledged";
const BSB_KEY    = "bsbDismissed";

const MIN_CHROME_VERSION = 141;
const MIN_EDGE_VERSION   = 141;

const localNetGate = {
  isBrave: false, isSamsung: false, isChrome: false,
  isEdge: false, isOpera: false, isFirefox: false, isSafari: false,
  isChromiumFamily: false, isHttps: false, isFileOrigin: false,
  isLocalOrigin: false, isPublicOrigin: false,
  version: { chrome: 0, edge: 0, firefox: 0, samsung: 0, opera: 0 },

  permissionState: "unknown",
  mode:   "unknown",
  status: "unknown",

  acknowledged: false,
  scanVerified: false,
  probing: false,

  gateEl: null, titleEl: null, msgEl: null, helpEl: null, stepsEl: null,
  statusEl: null, retryEl: null, testEl: null,
  badgeEl: null,
  bannerEl: null, bsbIconEl: null, bsbTitleEl: null, bsbMsgEl: null,
  bsbTestEl: null, bsbDismissEl: null
};

/* ---------- fetch helper ---------- */
function fetchWithTimeout(url, opts, ms){
  if(window.AbortSignal && AbortSignal.timeout){
    return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(t));
}

/* ---------- permission query with retry ---------- */
async function queryPermissionOnce(){
  if(!navigator.permissions || typeof navigator.permissions.query !== "function"){
    return "unsupported";
  }
  try{
    const st = await navigator.permissions.query({ name: LN_PERM });
    st.onchange = () => {
      localNetGate.permissionState = st.state;
      applyMode(recomputeMode());
    };
    return st.state || "unknown";
  }catch(_){
    return "unsupported";
  }
}

async function queryPermission(){
  let st = await queryPermissionOnce();
  if(st === "unsupported"){
    await new Promise(r => setTimeout(r, 150));
    st = await queryPermissionOnce();
    if(st === "unsupported"){
      await new Promise(r => setTimeout(r, 300));
      st = await queryPermissionOnce();
    }
  }
  return st;
}

async function refreshPermission(){
  const before = localNetGate.permissionState;
  const now = await queryPermission();
  localNetGate.permissionState = now;
  return { before, now };
}

/* ---------- environment ---------- */
async function detectBrave(){
  if(!navigator.brave || typeof navigator.brave.isBrave !== "function") return false;
  try{
    const v = navigator.brave.isBrave();
    return (typeof v === "boolean") ? v : await v;
  }catch(_){ return false; }
}

function detectEnvironment(){
  const ua = navigator.userAgent;
  const g = localNetGate;

  g.version = {
    chrome:  Number((ua.match(/Chrome\/(\d+)/) || [0, 0])[1]) || 0,
    edge:    Number((ua.match(/Edg\/(\d+)/) || [0, 0])[1]) || 0,
    firefox: Number((ua.match(/(?:Firefox|FxiOS)\/(\d+)/) || [0, 0])[1]) || 0,
    samsung: Number((ua.match(/SamsungBrowser\/(\d+)/) || [0, 0])[1]) || 0,
    opera:   Number((ua.match(/(?:OPR|Opera)\/(\d+)/) || [0, 0])[1]) || 0
  };

  g.isSamsung  = /SamsungBrowser\//.test(ua);
  g.isEdge     = /Edg\//.test(ua);
  g.isOpera    = /OPR\/|Opera\//.test(ua);
  g.isFirefox  = /Firefox\/|FxiOS\//.test(ua);
  g.isSafari   = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\//.test(ua);
  g.isChrome   = /Chrome\//.test(ua) && !g.isSamsung && !g.isEdge && !g.isOpera;
  g.isChromiumFamily = !!window.chrome || /Chrome\//.test(ua);

  g.isHttps      = location.protocol === "https:";
  g.isFileOrigin = location.protocol === "file:";

  const h = location.hostname;
  g.isLocalOrigin =
    h === "localhost" || h === "127.0.0.1" ||
    h === "[::1]"     || h === "::1" ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(h);

  g.isPublicOrigin = !g.isLocalOrigin && !g.isFileOrigin;
}

/* ---------- public API ---------- */
function localNetBlocked(){
  const m = localNetGate.mode;
  return m === "chrome-prompt" ||
         m === "chrome-denied" ||
         m === "https-blocked" ||
         m === "file-origin" ||
         m === "public-origin";
}

/* True when Chrome will block the iframe regardless of permission. */
function isViewerBlockedByBrowser(){
  const m = localNetGate.mode;
  return m === "public-origin" || m === "https-blocked" || m === "file-origin";
}

/* ---------- DOM ---------- */
function cacheEls(){
  const g = localNetGate;
  g.gateEl     = document.getElementById("localNetGate");
  g.titleEl    = document.getElementById("lnTitle");
  g.msgEl      = document.getElementById("lnMsg");
  g.helpEl     = document.getElementById("lnDeniedHelp");
  g.stepsEl    = document.getElementById("lnSteps");
  g.statusEl   = document.getElementById("lnStatus");
  g.retryEl    = document.getElementById("lnRetry");
  g.testEl     = document.getElementById("lnTest");
  g.badgeEl    = document.getElementById("lnBadge");

  g.bannerEl     = document.getElementById("browserSupportBanner");
  g.bsbIconEl    = document.getElementById("bsbIcon");
  g.bsbTitleEl   = document.getElementById("bsbTitle");
  g.bsbMsgEl     = document.getElementById("bsbMsg");
  g.bsbTestEl    = document.getElementById("bsbTest");
  g.bsbDismissEl = document.getElementById("bsbDismiss");
}

function showLocalNetGate(){
  if(!localNetGate.gateEl) return;
  localNetGate.gateEl.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  hideBanner();
}
/* userDismissed === true when the user actively closed the gate
   (Escape / backdrop) — main.js uses this to drop a pending
   ?device= / ?load= request. */
function hideLocalNetGate(userDismissed){
  if(!localNetGate.gateEl) return;
  localNetGate.gateEl.classList.add("hidden");
  document.body.style.overflow = "";
  if(userDismissed && typeof window.__onLanGateDismissed === "function"){
    try{ window.__onLanGateDismissed(); }catch(_){}
  }
}
function hideBanner(){
  if(!localNetGate.bannerEl) return;
  localNetGate.bannerEl.classList.add("hidden");
}

function resetGateButtons(){
  const g = localNetGate;
  if(g.retryEl){ g.retryEl.classList.add("hidden"); g.retryEl.disabled = false; }
  if(g.testEl){  g.testEl.classList.add("hidden");  g.testEl.disabled  = false; }
}

function setBadge(state){
  const b = localNetGate.badgeEl;
  if(!b) return;
  b.classList.remove(
    "ln-badge--granted","ln-badge--prompt","ln-badge--denied",
    "ln-badge--unknown","ln-badge--warn"
  );
  b.textContent = "🌐";
  b.classList.add("ln-badge--" + state);
  const labels = {
    granted: "Verified — LAN access works",
    prompt:  "Needs permission",
    denied:  "Blocked",
    warn:    "Not verified — may be blocked",
    unknown: "Unknown"
  };
  b.title = "Local network access: " + (labels[state] || state);
}

/* ---------- mode ---------- */
function recomputeMode(){
  const g = localNetGate;

  if(g.isFileOrigin)   return "file-origin";
  if(!g.isLocalOrigin) return "public-origin";
  if(g.isHttps)        return "https-blocked";

  if(g.permissionState === "granted") return "granted";
  if(g.permissionState === "prompt")  return "chrome-prompt";

  if(g.permissionState === "denied"){
    if(g.isBrave) return "brave";
    return "chrome-denied";
  }

  if(g.isBrave)          return "brave";
  if(g.isFirefox)        return "firefox";
  if(g.isSamsung)        return "samsung";
  if(g.isSafari)         return "safari";
  if(g.isChromiumFamily) return "generic-chromium";
  return "unknown";
}

function effectiveStatus(){
  const g = localNetGate;

  if(g.permissionState === "granted") return "granted";
  if(g.scanVerified)                  return "granted";

  const m = g.mode;
  if(m === "public-origin") return "denied";
  if(m === "chrome-prompt" || m === "chrome-denied" ||
     m === "https-blocked" || m === "file-origin") return m;

  return "warn";
}

/* ---------- gate content ---------- */
function renderGateContent(mode){
  const g = localNetGate;
  if(!g.gateEl) return;
  resetGateButtons();

  if(mode === "chrome-prompt"){
    if(g.titleEl) g.titleEl.textContent = "Local network access required";
    if(g.msgEl) g.msgEl.innerHTML =
      "Chrome needs permission to <strong>access devices on your " +
      "local network</strong>. Without it, scanning cannot work.";
    if(g.helpEl) g.helpEl.classList.add("hidden");
    if(g.stepsEl){
      g.stepsEl.classList.remove("hidden");
      g.stepsEl.innerHTML =
        "<li>Click <strong>Allow access</strong> below.</li>" +
        "<li>Chrome will show a prompt — choose <strong>Allow</strong>.</li>" +
        "<li>The app unlocks automatically once granted.</li>";
    }
    if(g.retryEl){
      g.retryEl.classList.remove("hidden");
      g.retryEl.textContent = "Allow access";
    }
    if(g.testEl) g.testEl.classList.remove("hidden");
    if(g.statusEl) g.statusEl.textContent = "";
  }
  else if(mode === "chrome-denied"){
    if(g.titleEl) g.titleEl.textContent = "Local network access denied";
    if(g.msgEl) g.msgEl.innerHTML =
      "Chrome has <strong>denied</strong> access to devices on your " +
      "local network. Scanning will not work until you allow it.";
    if(g.helpEl){
      g.helpEl.classList.remove("hidden");
      g.helpEl.innerHTML =
        "Click the lock/tune icon in the address bar → " +
        "<strong>Site settings</strong> → set " +
        "<strong>Local network access</strong> to <strong>Allow</strong>.";
    }
    if(g.stepsEl) g.stepsEl.classList.add("hidden");
    if(g.retryEl){
      g.retryEl.classList.remove("hidden");
      g.retryEl.textContent = "Try again";
    }
    if(g.testEl) g.testEl.classList.remove("hidden");
    if(g.statusEl) g.statusEl.textContent = "";
  }
  else if(mode === "https-blocked"){
    if(g.titleEl) g.titleEl.textContent = "Serve this page over http://localhost";
    if(g.msgEl) g.msgEl.innerHTML =
      "You're on <strong>HTTPS</strong>. Browsers block requests to " +
      "<code>http://192.168.x.x</code> from HTTPS pages as mixed content.";
    if(g.helpEl){
      g.helpEl.classList.remove("hidden");
      g.helpEl.innerHTML =
        "Serve this page from a local HTTP server, e.g. " +
        "<code>python3 -m http.server 8000</code>, then open " +
        "<code>http://localhost:8000/</code>.";
    }
    if(g.stepsEl) g.stepsEl.classList.add("hidden");
    if(g.testEl) g.testEl.classList.remove("hidden");
    if(g.statusEl) g.statusEl.textContent = "";
  }
  else if(mode === "file-origin"){
    if(g.titleEl) g.titleEl.textContent = "Serve this page over http://localhost";
    if(g.msgEl) g.msgEl.innerHTML =
      "You opened <code>index.html</code> directly from disk. " +
      "Browsers block network access from <code>file://</code> pages.";
    if(g.helpEl){
      g.helpEl.classList.remove("hidden");
      g.helpEl.innerHTML =
        "Start a local server in the app folder:<br><br>" +
        "Python 3: <code>python3 -m http.server 8000</code><br>" +
        "Node: <code>npx serve .</code><br>" +
        "PHP: <code>php -S localhost:8000</code><br><br>" +
        "Then open <code>http://localhost:8000/</code>.";
    }
    if(g.stepsEl) g.stepsEl.classList.add("hidden");
    if(g.testEl) g.testEl.classList.remove("hidden");
    if(g.statusEl) g.statusEl.textContent = "";
  }
  else if(mode === "public-origin"){
    if(g.titleEl) g.titleEl.textContent = "Serve this page over http://localhost";
    if(g.msgEl) g.msgEl.innerHTML =
      "This page is served from a <strong>public origin</strong>. " +
      "Chrome blocks connections from public pages to devices on your " +
      "local network — this is a browser security policy.";
    if(g.helpEl){
      g.helpEl.classList.remove("hidden");
      g.helpEl.innerHTML =
        "Serve the app from a local HTTP server:<br><br>" +
        "Python 3: <code>python3 -m http.server 8000</code><br>" +
        "Node: <code>npx serve .</code><br>" +
        "PHP: <code>php -S localhost:8000</code><br><br>" +
        "Then open <code>http://localhost:8000/</code>.";
    }
    if(g.stepsEl) g.stepsEl.classList.add("hidden");
    if(g.testEl) g.testEl.classList.add("hidden");
    if(g.statusEl) g.statusEl.textContent = "";
  }
}

/* ---------- banner ---------- */
function getSupportInfo(){
  const g = localNetGate;
  const v = g.version;

  if(g.permissionState === "granted" || g.scanVerified){
    return { level: "ok" };
  }
  if(g.permissionState === "denied" && !g.isBrave){
    return { level: "error",
      title: "Local network access is blocked",
      msg: "Open this site's settings (lock icon in the address bar) and set " +
           "<strong>Local network access</strong> to Allow." };
  }
  if(g.isFileOrigin){
    return { level: "error",
      title: "Serve this page over http://localhost",
      msg: "Browsers block network access from <code>file://</code> pages. " +
           "Start a local server (e.g. <code>python3 -m http.server 8000</code>) " +
           "and open <code>http://localhost:8000/</code>." };
  }
  if(g.isPublicOrigin){
    return { level: "error",
      title: "Serve this page over http://localhost",
      msg: "You're on a <strong>public origin</strong>. Chrome blocks " +
           "connections from public pages to devices on your local network. " +
           "Serve the app from <code>http://localhost</code> " +
           "(e.g. <code>python3 -m http.server 8000</code>) " +
           "and open <code>http://localhost:8000/</code>." };
  }
  if(g.isHttps){
    return { level: "error",
      title: "Serve this page over http://localhost",
      msg: "HTTPS pages cannot access <code>http://192.168.x.x</code> " +
           "(mixed content). Serve the app from " +
           "<code>http://localhost</code> instead." };
  }
  if(g.isChrome && v.chrome > 0 && v.chrome < MIN_CHROME_VERSION){
    return { level: "warn",
      title: `Chrome ${v.chrome} may have problems`,
      msg: `Local Network Access is fully supported from ` +
           `<strong>Google Chrome ${MIN_CHROME_VERSION}+</strong>. ` +
           `Click the 🌐 badge to try anyway.` };
  }
  if(g.isEdge && v.edge > 0 && v.edge < MIN_EDGE_VERSION){
    return { level: "warn",
      title: `Edge ${v.edge} may have problems`,
      msg: `Local Network Access is fully supported from ` +
           `<strong>Edge ${MIN_EDGE_VERSION}+</strong>. ` +
           `Click the 🌐 badge to try anyway.` };
  }
  if(g.isBrave){
    return { level: "warn",
      title: "Brave — LAN access not verified",
      msg: "Click the <strong>🌐 badge</strong> to try — if your Brave " +
           "supports LNA, the browser's own <em>access local network</em> " +
           "prompt will appear. If it still fails, turn off Shields for this " +
           "site (🦁 lion icon). The badge only turns green once a scan " +
           "actually finds a device." };
  }
  if(g.isSamsung){
    return { level: "warn",
      title: "Samsung Internet — LAN access not verified",
      msg: "Click the <strong>🌐 badge</strong>, then <strong>Run Scan</strong> " +
           "— the badge turns green only if a scan finds a device. If the " +
           "scan finds nothing, verify your phone is on <strong>Wi-Fi</strong> " +
           "(not mobile data) and the target is powered on." };
  }
  if(g.isFirefox){
    return { level: "warn",
      title: "Firefox — LAN access not verified",
      msg: "Click the <strong>🌐 badge</strong>, then <strong>Run Scan</strong>. " +
           "If blocked, disable <em>Enhanced Tracking Protection</em> for this " +
           "site (🛡️ shield icon)." };
  }
  if(g.isSafari){
    return { level: "warn",
      title: "Safari — LAN access not verified",
      msg: "On iOS, verify Settings → Privacy → Local Network allows Safari. " +
           "Click the <strong>🌐 badge</strong>, then <strong>Run Scan</strong>." };
  }
  if(g.isChromiumFamily){
    return { level: "warn",
      title: "Browser — LAN access not verified",
      msg: "Click the <strong>🌐 badge</strong>, then <strong>Run Scan</strong> " +
           "— the badge turns green only when a scan finds a device." };
  }
  return { level: "warn",
    title: "Browser — LAN access not verified",
    msg: "Click the <strong>🌐 badge</strong>, then <strong>Run Scan</strong> " +
         "— the badge turns green only when a scan finds a device." };
}

function renderSupportBanner(){
  const g = localNetGate;
  const banner = g.bannerEl;
  if(!banner) return;

  const info = getSupportInfo();

  if(info.level === "ok"){ hideBanner(); return; }
  if(info.level === "warn" && g.acknowledged){ hideBanner(); return; }
  if(info.level === "warn"){
    try{ if(localStorage.getItem(BSB_KEY) === "1"){ hideBanner(); return; } }catch(_){}
  }
  if(g.gateEl && !g.gateEl.classList.contains("hidden")){ hideBanner(); return; }

  if(g.bsbIconEl)  g.bsbIconEl.textContent  = info.level === "error" ? "⛔" : "⚠️";
  if(g.bsbTitleEl) g.bsbTitleEl.textContent = info.title;
  if(g.bsbMsgEl)   g.bsbMsgEl.innerHTML     = info.msg;

  banner.className = "support-banner support-banner--" + info.level;
  banner.classList.remove("hidden");

  if(g.bsbDismissEl){
    g.bsbDismissEl.style.display = info.level === "error" ? "none" : "";
  }
  /* Test connection is never a permission trigger anymore. */
  if(g.bsbTestEl){
    g.bsbTestEl.style.display = "none";
  }
}

/* ---------- apply mode ----------
   "granted"       → hide gate + fire __onLanGranted (old way)
   hard modes      → SHOW gate immediately (redirect)
   soft modes      → hide gate, banner only                        */
function applyMode(mode){
  const g = localNetGate;
  g.mode = mode;

  if(mode === "granted"){
    g.status = "granted";
    setBadge("granted");
    hideLocalNetGate(false);
    hideBanner();
    if(typeof window.__onLanGranted === "function"){
      try{ window.__onLanGranted(); }catch(_){}
    }
    return;
  }

  if(mode === "chrome-prompt" || mode === "chrome-denied" ||
     mode === "https-blocked" || mode === "file-origin" ||
     mode === "public-origin"){
    g.status = mode;
    setBadge(mode);
    renderGateContent(mode);
    showLocalNetGate();     // ← the "redirect" to permission screen
    return;
  }

  g.status = effectiveStatus();
  setBadge(g.status);
  hideLocalNetGate(false);
  renderSupportBanner();
}

/* ---------- probes ---------- */
function configuredSubnetPort(){
  if(state.parsed && state.parsed.subnet && state.parsed.port){
    return { subnet: state.parsed.subnet, port: state.parsed.port,
             targetIp: state.parsed.ip || null };
  }
  if(state.storedSubnet && state.storedPort){
    return { subnet: state.storedSubnet, port: state.storedPort,
             targetIp: null };
  }
  return null;
}

function buildProbes(){
  const cfg = configuredSubnetPort();
  const out = [];

  if(cfg){
    if(cfg.targetIp) out.push({ ip: cfg.targetIp, port: cfg.port, isTarget: true });
    out.push({ ip: `${cfg.subnet}.1`,   port: cfg.port });
    out.push({ ip: `${cfg.subnet}.254`, port: cfg.port });
    for(let i = 2; i <= 10; i++) out.push({ ip: `${cfg.subnet}.${i}`, port: cfg.port });
  }

  out.push({ ip: "192.168.1.1", port: 80, isFallback: true });
  out.push({ ip: "192.168.0.1", port: 80, isFallback: true });
  out.push({ ip: "10.0.0.1",    port: 80, isFallback: true });

  return out;
}

async function probeAll(timeoutMs){
  const probes = buildProbes();
  const results = [];
  let ok = 0;
  for(const p of probes){
    const t0 = performance.now();
    try{
      const res = await fetchWithTimeout(`http://${p.ip}:${p.port}/`, {
        mode: "no-cors", cache: "no-store",
        credentials: "omit", referrerPolicy: "no-referrer"
      }, timeoutMs);
      const okNow = res && (res.type === "opaque" || res.ok);
      results.push({ ...p, ok: !!okNow, ms: +(performance.now() - t0).toFixed(0) });
      if(okNow) ok++;
    }catch(e){
      results.push({
        ...p, ok: false,
        ms: +(performance.now() - t0).toFixed(0),
        error: e.name || "fetch-error"
      });
    }
  }
  return { ok, total: probes.length, results };
}

async function probeAndRefresh(timeoutMs){
  const r = await probeAll(timeoutMs);
  await new Promise(res => setTimeout(res, 400));
  await refreshPermission();
  return r;
}

/* ---------- trigger permission ----------
   Only called by: 🌐 badge, ⚙️ Settings, gate's own buttons.
   Fires LAN probes (Chrome 141+ shows the native prompt).        */
async function triggerAllow(){
  if(localNetGate.mode === "public-origin") return null;
  if(localNetGate.probing) return null;
  localNetGate.probing = true;
  if(localNetGate.retryEl)  localNetGate.retryEl.disabled = true;
  if(localNetGate.statusEl) localNetGate.statusEl.textContent = "Requesting permission…";

  const r = await probeAndRefresh(2500);
  localNetGate.probing = false;
  if(localNetGate.retryEl) localNetGate.retryEl.disabled = false;

  if(localNetGate.permissionState === "granted"){
    applyMode("granted");
  } else {
    applyMode(recomputeMode());
  }

  const gateVisible = localNetGate.gateEl &&
                      !localNetGate.gateEl.classList.contains("hidden");
  if(gateVisible && localNetGate.statusEl){
    localNetGate.statusEl.textContent = r.ok > 0
      ? `${r.ok}/${r.total} probes responded — if still blocked, check site settings.`
      : "No addresses responded — access still blocked.";
  }

  return r;
}

/* ---------- scan result callbacks ---------- */
function reportScanSuccess(count){
  const g = localNetGate;
  if(!count || count <= 0) return;
  if(g.permissionState === "granted") return;

  const wasVerified = g.scanVerified;
  g.scanVerified = true;
  g.status = "granted";
  setBadge("granted");
  hideBanner();
  try{ localStorage.removeItem(BSB_KEY); }catch(_){}

  if(!wasVerified){
    notify(`✓ LAN access confirmed — ${count} device${count === 1 ? "" : "s"} found`);
  }
}

function reportScanFailure(){
  const g = localNetGate;
  if(g.permissionState === "granted") return;

  const softModes = ["brave","samsung","firefox","safari",
                     "generic-chromium","unknown"];
  if(!softModes.includes(g.mode)) return;

  g.acknowledged = false;
  g.scanVerified = false;
  g.status = "warn";
  setBadge("warn");
  try{
    localStorage.removeItem(LN_ACK_KEY);
    localStorage.removeItem(BSB_KEY);
  }catch(_){}

  renderSupportBanner();

  const cfg = configuredSubnetPort();
  if(g.bsbMsgEl && cfg){
    g.bsbMsgEl.innerHTML =
      `✗ <strong>Last scan found 0 devices</strong> on ` +
      `${cfg.subnet}.0/24 port <strong>${cfg.port}</strong>. ` +
      (g.isSamsung
        ? "Check that your phone is on <strong>Wi-Fi</strong> " +
          "(mobile data cannot reach your LAN). "
        : g.isBrave
        ? "Turn off <strong>Shields</strong> for this site (🦁 lion icon). "
        : "") +
      "Click the <strong>🌐 badge</strong> to try again.";
  }
}

function acknowledge(silent){
  try{ localStorage.setItem(LN_ACK_KEY, "1"); }catch{}
  localNetGate.acknowledged = true;
  localNetGate.status = effectiveStatus();
  setBadge(localNetGate.status);
  hideLocalNetGate(false);
  if(!silent) notify("Continuing — badge stays yellow until a scan succeeds");
}

function dismissBanner(){
  try{ localStorage.setItem(BSB_KEY, "1"); }catch{}
  hideBanner();
}

/* ---------- badge click → request permission ---------- */
function wireBadge(){
  const b = localNetGate.badgeEl;
  if(!b) return;
  b.addEventListener("click", async () => {
    try{ localStorage.removeItem(BSB_KEY); }catch{}

    if(effectiveStatus() === "granted"){
      notify("LAN access verified ✓");
      return;
    }
    if(localNetGate.mode === "public-origin"){
      showLocalNetGate();
      renderGateContent("public-origin");
      return;
    }

    const r = await triggerAllow();
    if(!r) return;

    if(effectiveStatus() === "granted"){
      notify("Local network access granted ✓");
      return;
    }
    if(localNetBlocked()){
      /* gate already visible */
    } else if(r.ok > 0){
      notify(`${r.ok}/${r.total} probes responded — run a scan to confirm`);
    } else {
      notify("No probes responded — check browser settings", "error");
    }
  });
}

/* ---------- gate's own buttons ---------- */
async function gateActionAttempt(){
  if(localNetGate.mode === "public-origin") return;
  const r = await triggerAllow();
  if(!r) return;
  if(effectiveStatus() === "granted"){
    notify("Local network access granted ✓");
  }
}

/* ---------- init ----------
   Exposed as `localNetGateReady` so main.js can await it before
   deciding whether to process a ?device= / ?load= deep link.     */
const localNetGateReady = (async function initLocalNetGate(){
  cacheEls();
  detectEnvironment();
  localNetGate.isBrave = await detectBrave();
  try{ localNetGate.acknowledged = localStorage.getItem(LN_ACK_KEY) === "1"; }catch(_){}
  localNetGate.permissionState = await queryPermission();

  if(localNetGate.retryEl)
    localNetGate.retryEl.addEventListener("click", gateActionAttempt);
  if(localNetGate.testEl)
    localNetGate.testEl.addEventListener("click", gateActionAttempt);
  if(localNetGate.bsbDismissEl)
    localNetGate.bsbDismissEl.addEventListener("click", dismissBanner);

  /* Backdrop click dismisses the gate (user skip). */
  if(localNetGate.gateEl){
    localNetGate.gateEl.addEventListener("click", (e) => {
      if(e.target === localNetGate.gateEl) hideLocalNetGate(true);
    });
  }

  wireBadge();

  /* Show gate now for hard modes; hide for granted/soft. */
  applyMode(recomputeMode());

  if(localNetGate.permissionState === "unsupported"){
    setTimeout(async () => {
      const { before, now } = await refreshPermission();
      if(now !== before && now !== "unsupported"){
        applyMode(recomputeMode());
      }
    }, 800);
  }

  return true;
})();
