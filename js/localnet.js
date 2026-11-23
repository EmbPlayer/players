"use strict";

/* ============================================================
   LOCAL NETWORK ACCESS GATE + BROWSER SUPPORT DETECTION
   ------------------------------------------------------------
   Badge states (truthful):
     🟢 granted  → navigator.permissions says "granted"
                   (Chrome/Edge 141+) OR a scan in this session
                   found ≥ 1 device.
     🔴 blocked  → permission denied, HTTPS origin, file:// origin
     🟡 warn     → every soft-mode browser (Brave, Samsung,
                   Firefox, Safari, other Chromium, unknown).
                   Stays yellow until a real scan succeeds —
                   probe-test success does NOT count as proof.

   NON-FORCING: the permission gate is NEVER shown on page load.
   It only appears when the user actually tries to scan (or taps
   the badge). When access is blocked, opening a device skips the
   iframe and redirects straight to http://<ip>:<port>/main.

   Public API used by scan.js / ui.js / main.js:
     • localNetReady  (promise — detection finished)
     • localNetBlocked()
     • showLocalNetGate()
     • reportScanSuccess(count)
     • reportScanFailure()
   ============================================================ */

/* Chrome 142+ exposes "local-network"; older builds used "local-network-access". */
const LN_PERM_NAMES = ["local-network", "local-network-access"];
const LN_ACK_KEY = "lnAcknowledged";
const BSB_KEY    = "bsbDismissed";

const MIN_CHROME_VERSION = 141;
const MIN_EDGE_VERSION   = 141;

const localNetGate = {
  isBrave: false, isSamsung: false, isChrome: false,
  isEdge: false, isOpera: false, isFirefox: false, isSafari: false,
  isChromiumFamily: false, isHttps: false, isFileOrigin: false,
  version: { chrome: 0, edge: 0, firefox: 0, samsung: 0, opera: 0 },

  permissionState: "unknown",
  mode:   "unknown",
  status: "unknown",

  acknowledged: false,
  scanVerified: false,   // ← true ONLY after a scan found devices (this session)
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
  for(const name of LN_PERM_NAMES){
    try{
      const st = await navigator.permissions.query({ name });
      st.onchange = () => {
        localNetGate.permissionState = st.state;
        applyMode(recomputeMode());
      };
      return st.state || "unknown";
    }catch(_){ /* try next name */ }
  }
  return "unsupported";
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
}

/* ---------- public API ---------- */
function localNetBlocked(){
  const m = localNetGate.mode;
  return m === "chrome-prompt" ||
         m === "chrome-denied" ||
         m === "https-blocked" ||
         m === "file-origin";
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
  g.dismissEl  = document.getElementById("lnDismiss");
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
  if(localNetBlocked()) renderGateContent(localNetGate.mode);
  localNetGate.gateEl.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  hideBanner();
}
function hideLocalNetGate(){
  if(!localNetGate.gateEl) return;
  localNetGate.gateEl.classList.add("hidden");
  document.body.style.overflow = "";
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

  if(g.isFileOrigin) return "file-origin";

  if(g.permissionState === "granted") return "granted";
  if(g.permissionState === "prompt")  return "chrome-prompt";

  if(g.permissionState === "denied"){
    if(g.isBrave) return "brave";
    return "chrome-denied";
  }

  /* No LNA permission API: an HTTPS page can't reach http:// LAN devices. */
  if(g.isHttps) return "https-blocked";

  if(g.isBrave)          return "brave";
  if(g.isFirefox)        return "firefox";
  if(g.isSamsung)        return "samsung";
  if(g.isSafari)         return "safari";
  if(g.isChromiumFamily) return "generic-chromium";
  return "unknown";
}

/* Badge state — the ONLY place that decides green vs yellow. */
function effectiveStatus(){
  const g = localNetGate;

  /* Green ONLY for real proof: explicit permission OR a scan
     that actually found devices in this session. */
  if(g.permissionState === "granted") return "granted";
  if(g.scanVerified)                  return "granted";

  /* Hard blockers */
  const m = g.mode;
  if(m === "chrome-prompt" || m === "chrome-denied" ||
     m === "https-blocked" || m === "file-origin") return m;

  /* Every soft mode stays yellow. */
  return "warn";
}

/* ---------- gate content (hard modes only) ---------- */
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
}

/* ---------- banner ---------- */
function getSupportInfo(){
  const g = localNetGate;
  const v = g.version;

  /* Real success (permission granted OR scan verified) */
  if(g.permissionState === "granted" || g.scanVerified){
    return { level: "ok" };
  }
  if(g.permissionState === "denied" && !g.isBrave){
    return { level: "error",
      title: "Local network access is blocked",
      msg: "Open this site's settings (lock icon in the address bar) and set " +
           "<strong>Local network access</strong> to Allow." };
  }
  if(g.permissionState === "prompt" && !g.isFileOrigin){
    return { level: "warn",
      title: "Local network access not granted yet",
      msg: "You can use the app without it: devices will open by " +
           "<strong>direct redirect</strong> instead of an embedded frame. " +
           "Permission is only requested when you press <strong>Run Scan</strong>." };
  }
  if(g.isFileOrigin){
    return { level: "error",
      title: "Serve this page over http://localhost",
      msg: "Browsers block network access from <code>file://</code> pages. " +
           "Start a local server (e.g. <code>python3 -m http.server 8000</code>) " +
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
           `<strong>Google Chrome ${MIN_CHROME_VERSION}+</strong>.` };
  }
  if(g.isEdge && v.edge > 0 && v.edge < MIN_EDGE_VERSION){
    return { level: "warn",
      title: `Edge ${v.edge} may have problems`,
      msg: `Local Network Access is fully supported from ` +
           `<strong>Edge ${MIN_EDGE_VERSION}+</strong>.` };
  }
  if(g.isBrave){
    return { level: "warn",
      title: "Brave — LAN access not verified",
      msg: "Brave blocks LAN requests through Shields and does not expose " +
           "the LNA permission to JavaScript. Click <strong>Test connection</strong> " +
           "below — if your Brave supports LNA, the browser's own " +
           "<em>access local network</em> prompt will appear. If it still fails, " +
           "turn off Shields for this site (🦁 lion icon). " +
           "The badge only turns green once a scan actually finds a device." };
  }
  if(g.isSamsung){
    return { level: "warn",
      title: "Samsung Internet — LAN access not verified",
      msg: "Samsung Internet does not expose the LNA permission, so the app " +
           "cannot confirm access. Click <strong>Test connection</strong> for " +
           "a diagnostic, then <strong>Run Scan</strong> — the badge turns " +
           "green only if a scan finds a device. If the scan finds nothing, " +
           "verify your phone is on <strong>Wi-Fi</strong> (not mobile data) " +
           "and the target is powered on." };
  }
  if(g.isFirefox){
    return { level: "warn",
      title: "Firefox — LAN access not verified",
      msg: "Firefox does not support the LNA permission. Click " +
           "<strong>Test connection</strong>, then <strong>Run Scan</strong>. " +
           "If blocked, disable <em>Enhanced Tracking Protection</em> for this " +
           "site (🛡️ shield icon)." };
  }
  if(g.isSafari){
    return { level: "warn",
      title: "Safari — LAN access not verified",
      msg: "Safari does not support the LNA permission. On iOS, verify " +
           "Settings → Privacy → Local Network allows Safari. Click " +
           "<strong>Test connection</strong>, then <strong>Run Scan</strong>." };
  }
  if(g.isChromiumFamily){
    return { level: "warn",
      title: "Browser — LAN access not verified",
      msg: "This Chromium browser does not expose the LNA permission. " +
           "Click <strong>Test connection</strong>, then <strong>Run Scan</strong> " +
           "— the badge turns green only when a scan finds a device." };
  }
  return { level: "warn",
    title: "Browser — LAN access not verified",
    msg: "Click <strong>Test connection</strong>, then <strong>Run Scan</strong> " +
         "— the badge turns green only when a scan finds a device." };
}

function renderSupportBanner(){
  const g = localNetGate;
  const banner = g.bannerEl;
  if(!banner) return;

  const info = getSupportInfo();

  if(info.level === "ok"){ hideBanner(); return; }
  /* acknowledged (via Continue anyway) only hides the banner — the
     badge stays yellow so the app never falsely claims success. */
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
  if(g.bsbTestEl){
    g.bsbTestEl.style.display = info.level === "error" ? "none" : "";
    g.bsbTestEl.textContent = "Test connection";
  }
}

/* ---------- apply mode ---------- */
function applyMode(mode){
  const g = localNetGate;
  g.mode = mode;

  if(mode === "granted"){
    g.status = "granted";
    setBadge("granted");
    hideLocalNetGate();
    hideBanner();
    return;
  }

  if(mode === "chrome-prompt" || mode === "chrome-denied" ||
     mode === "https-blocked" || mode === "file-origin"){
    g.status = mode;
    setBadge(mode);

    /* Never force the gate. Only refresh it if the user already opened it
       (scan attempt / badge tap); otherwise just show the soft banner. */
    const gateOpen = g.gateEl && !g.gateEl.classList.contains("hidden");
    if(gateOpen) renderGateContent(mode);
    renderSupportBanner();
    return;
  }

  /* Soft mode: badge is warn unless scan-verified (see effectiveStatus). */
  g.status = effectiveStatus();
  setBadge(g.status);
  hideLocalNetGate();
  renderSupportBanner();
}

/* ---------- probes (diagnostic only — NOT proof of access) ---------- */
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
      /* NOTE: on Samsung, opaque resolves even for a failed connection,
         so "ok" here means "no exception thrown", not "server exists". */
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

/* ---------- automatic permission request (page load) ---------- */
async function autoRequestPermission(){
  const g = localNetGate;
  if(g.permissionState === "granted" || g.permissionState === "denied") return;
  if(g.isFileOrigin) return;                      // probes can't work there
  if(g.probing) return;
  /* "prompt" → ask. "unsupported"/"unknown" → probe anyway: some Chromium
     builds show the browser prompt even though they hide the permission API. */

  g.probing = true;
  try{
    /* A probe to a LAN address makes the browser show its native prompt. */
    await probeAndRefresh(8000);
  }catch(_){}
  g.probing = false;

  if(g.permissionState === "granted"){
    applyMode("granted");
    notify("Local network access granted ✓");
  }else{
    applyMode(recomputeMode());   // denied/prompt → badge + soft banner only
  }
}

/* ---------- actions ---------- */
async function probeAndRefresh(timeoutMs){
  const r = await probeAll(timeoutMs);
  await new Promise(res => setTimeout(res, 400));
  await refreshPermission();
  return r;
}

async function triggerAllow(){
  if(localNetGate.probing) return;
  localNetGate.probing = true;
  if(localNetGate.retryEl)  localNetGate.retryEl.disabled = true;
  if(localNetGate.statusEl) localNetGate.statusEl.textContent = "Requesting permission…";

  const r = await probeAndRefresh(2500);
  localNetGate.probing = false;
  if(localNetGate.retryEl) localNetGate.retryEl.disabled = false;

  if(localNetGate.permissionState === "granted"){
    applyMode("granted");
    notify("Local network access granted ✓");
    return;
  }
  if(localNetGate.permissionState === "prompt"){
    applyMode("chrome-prompt");
    return;
  }
  applyMode(recomputeMode());
  if(localNetGate.statusEl){
    localNetGate.statusEl.textContent = r.ok > 0
      ? `${r.ok}/${r.total} probes responded. If access is still blocked, ` +
        `check the browser's site settings.`
      : "No addresses responded — still blocked.";
  }
}

async function testFromBanner(){
  const g = localNetGate;
  if(g.bsbTestEl) g.bsbTestEl.disabled = true;
  const prev = g.bsbTestEl ? g.bsbTestEl.textContent : "";
  if(g.bsbTestEl) g.bsbTestEl.textContent = "Checking…";

  const r  = await probeAndRefresh(2000);
  const cfg = configuredSubnetPort();

  if(g.bsbTestEl){
    g.bsbTestEl.disabled = false;
    g.bsbTestEl.textContent = prev || "Test connection";
  }

  /* Permission granted → that IS proof. */
  if(g.permissionState === "granted"){
    applyMode("granted");
    notify("Local network access granted ✓");
    return;
  }

  /* Even if probes "responded", we do NOT claim verified — because
     on Samsung, opaque may mean the browser blocked the request.
     Only a real scan can prove access. */
  if(r.ok > 0){
    const targetDesc = cfg
      ? `${cfg.subnet}.0/24 port <strong>${cfg.port}</strong>`
      : "your LAN";
    if(g.bsbMsgEl){
      g.bsbMsgEl.innerHTML =
        `⚠️ <strong>${r.ok}/${r.total} probes responded</strong> on ${targetDesc}. ` +
        `That does <strong>not</strong> guarantee LAN access — some browsers ` +
        `return "success" even when they block the request. ` +
        `<strong>Run a scan</strong> to confirm — the badge will turn green ` +
        `only if a device is found.`;
    }
    notify(`${r.ok}/${r.total} probes responded — run a scan to confirm`);
    return;
  }

  /* Failure: no probes responded. Update the banner honestly. */
  if(g.bsbMsgEl){
    const targetDesc = cfg
      ? `${cfg.subnet}.0/24 port <strong>${cfg.port}</strong>`
      : "any LAN address (no target configured)";
    g.bsbMsgEl.innerHTML =
      `✗ <strong>Test failed.</strong> No response from ${targetDesc}. ` +
      (g.isSamsung
        ? "Check that your phone is on <strong>Wi-Fi</strong> (not mobile data), " +
          "the target is powered on, and the port is correct. "
        : g.isBrave
        ? "Turn <strong>Shields down</strong> for this site (🦁 lion icon). "
        : "") +
      "Tap <strong>Test connection</strong> to retry, or <strong>Run Scan</strong>.";
  }
  notify(`✗ 0/${r.total} probes responded`, "error");
}

/* ---------- scan result callbacks (called from scan.js) ---------- */

/* A scan actually found ≥ 1 device → that IS real proof of LAN access. */
function reportScanSuccess(count){
  const g = localNetGate;
  if(!count || count <= 0) return;
  if(g.permissionState === "granted") return; // already green

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

/* A scan found 0 devices → reset any false "verified" state. */
function reportScanFailure(){
  const g = localNetGate;

  /* Chrome with granted permission stays green — no LAN issue there,
     the target just didn't respond (wrong subnet / device off). */
  if(g.permissionState === "granted") return;

  /* Hard blockers already handled by the gate. */
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
      "Tap <strong>Test connection</strong> to diagnose.";
  }
}

function acknowledge(silent){
  try{ localStorage.setItem(LN_ACK_KEY, "1"); }catch{}
  localNetGate.acknowledged = true;

  /* Acknowledge NEVER claims success — badge stays as-is. */
  localNetGate.status = effectiveStatus();
  setBadge(localNetGate.status);
  hideLocalNetGate();
  if(!silent){
    notify("Continuing — badge stays yellow until a scan succeeds");
  }
}

function dismissGate(){
  hideLocalNetGate();
  renderSupportBanner();
  notify("Skipped — devices will open by direct redirect");
}

function dismissBanner(){
  try{ localStorage.setItem(BSB_KEY, "1"); }catch{}
  hideBanner();
}

/* ---------- badge ---------- */
function wireBadge(){
  const b = localNetGate.badgeEl;
  if(!b) return;
  b.addEventListener("click", () => {
    try{ localStorage.removeItem(BSB_KEY); }catch{}
    const st = effectiveStatus();
    if(st === "granted"){
      notify("LAN access verified ✓");
      return;
    }
    if(localNetBlocked()){
      showLocalNetGate();
      return;
    }
    renderSupportBanner();
  });
}

/* ---------- init ---------- */
const localNetReady = (async function initLocalNetGate(){
  cacheEls();
  detectEnvironment();
  localNetGate.isBrave = await detectBrave();
  try{ localNetGate.acknowledged = localStorage.getItem(LN_ACK_KEY) === "1"; }catch(_){}
  localNetGate.permissionState = await queryPermission();

  if(localNetGate.retryEl)
    localNetGate.retryEl.addEventListener("click", triggerAllow);
  if(localNetGate.testEl)
    localNetGate.testEl.addEventListener("click", triggerAllow);
  if(localNetGate.dismissEl)
    localNetGate.dismissEl.addEventListener("click", dismissGate);
  if(localNetGate.bsbTestEl)
    localNetGate.bsbTestEl.addEventListener("click", testFromBanner);
  if(localNetGate.bsbDismissEl)
    localNetGate.bsbDismissEl.addEventListener("click", dismissBanner);

  wireBadge();
  applyMode(recomputeMode());

  /* Ask for permission automatically on page load — but quietly:
     only the browser's own prompt appears, never our blocking gate.
     If the user denies or ignores it, the app keeps working
     (devices open by direct redirect). */
  await autoRequestPermission();

  /* Late re-check for slow-to-init Chromium forks. */
  if(localNetGate.permissionState === "unsupported"){
    setTimeout(async () => {
      const { before, now } = await refreshPermission();
      if(now !== before && now !== "unsupported"){
        applyMode(recomputeMode());
      }
    }, 800);
  }
})();
