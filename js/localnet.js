"use strict";

/* ============================================================
   LOCAL NETWORK ACCESS GATE + BROWSER SUPPORT DETECTION
   ------------------------------------------------------------
   Fully supported  → Chrome 141+ / Edge 141+ (permission API)
   Brave            → may expose LNA internally but often
                      throws on navigator.permissions.query.
                      → soft banner with "Enable / Test" button;
                        clicking it probes a LAN IP (which fires
                        Brave's native prompt), then re-queries
                        the permission and unlocks if granted.
   Others           → soft banner (may have problems).
   Hard-blockers    → permission denied / HTTPS / file://.
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
  version: { chrome: 0, edge: 0, firefox: 0, samsung: 0, opera: 0 },

  permissionState: "unknown",   // unknown | granted | prompt | denied | unsupported
  mode:   "unknown",
  status: "unknown",
  acknowledged: false,
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

/* Brave / some Chromium forks throw on the first query while the
   permission manager initializes. Retry twice before giving up. */
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

/* Re-query and return { before, now } so callers can tell whether
   the permission state changed after a probe. */
async function refreshPermission(){
  const before = localNetGate.permissionState;
  const now = await queryPermission();
  localNetGate.permissionState = now;
  return { before, now };
}

/* ---------- environment detection ---------- */
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

/* ---------- public API (used by scan.js / ui.js) ---------- */
function localNetBlocked(){
  const m = localNetGate.mode;
  return m === "chrome-prompt" ||
         m === "chrome-denied" ||
         m === "https-blocked" ||
         m === "file-origin";
}

/* ---------- DOM refs ---------- */
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
function hideLocalNetGate(){
  if(!localNetGate.gateEl) return;
  localNetGate.gateEl.classList.add("hidden");
  document.body.style.overflow = "";
}
function hideBanner(){
  if(!localNetGate.bannerEl) return;
  localNetGate.bannerEl.classList.add("hidden");
}

/* Null-safe: works whether or not #lnTest exists in the HTML. */
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
    granted: "OK",
    prompt:  "Needs permission",
    denied:  "Blocked",
    warn:    "May have problems",
    unknown: "Unknown"
  };
  b.title = "Local network access: " + (labels[state] || state);
}

/* ---------- mode ---------- */
function recomputeMode(){
  const g = localNetGate;

  if(g.isFileOrigin) return "file-origin";
  if(g.isHttps && g.permissionState !== "granted") return "https-blocked";

  if(g.permissionState === "granted") return "granted";
  if(g.permissionState === "prompt")  return "chrome-prompt";

  /* Real denial on Chrome → chrome-denied.
     But on Brave, a "denied" default often just reflects Shields,
     so route through the Brave soft-gate instead of the Chrome
     instructions that don't apply. */
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

  if(g.permissionState === "granted" || g.permissionState === "prompt"){
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
           `You're on Chrome ${v.chrome}. Upgrade for best results.` };
  }
  if(g.isEdge && v.edge > 0 && v.edge < MIN_EDGE_VERSION){
    return { level: "warn",
      title: `Edge ${v.edge} may have problems`,
      msg: `Local Network Access is fully supported from ` +
           `<strong>Edge ${MIN_EDGE_VERSION}+</strong>. Upgrade for best results.` };
  }
  if(g.isBrave){
    return { level: "warn",
      title: "Brave may have problems",
      msg: "Brave blocks LAN requests through Shields and does not expose " +
           "the LNA permission to JavaScript. Click <strong>Enable / Test</strong> " +
           "below — if your Brave supports LNA, the browser's own " +
           "<em>access local network</em> prompt will appear. If not, turn off " +
           "Shields for this site (🦁 lion icon) and click again. " +
           "For best results, use <strong>Google Chrome " + MIN_CHROME_VERSION + "+</strong>." };
  }
  if(g.isSamsung){
    return { level: "warn",
      title: "Samsung Internet may have problems",
      msg: "Samsung Internet usually allows LAN access but lacks the LNA " +
           "permission. Click <strong>Enable / Test</strong> to check; if it " +
           "fails, use <strong>Google Chrome " + MIN_CHROME_VERSION + "+</strong>." };
  }
  if(g.isFirefox){
    return { level: "warn",
      title: "Firefox may have problems",
      msg: "Firefox does not support the LNA permission. Scanning usually " +
           "works from <code>http://localhost</code> but may be blocked by " +
           "Enhanced Tracking Protection. Use <strong>Test</strong> to check. " +
           "For best results, use <strong>Google Chrome " + MIN_CHROME_VERSION + "+</strong>." };
  }
  if(g.isSafari){
    return { level: "warn",
      title: "Safari may have problems",
      msg: "Safari does not support the LNA permission. On iOS, verify " +
           "Settings → Privacy → Local Network allows Safari. Use " +
           "<strong>Test</strong> to check. For best results, use " +
           "<strong>Google Chrome " + MIN_CHROME_VERSION + "+</strong>." };
  }
  if(g.isChromiumFamily){
    return { level: "warn",
      title: "This browser may have problems",
      msg: "This Chromium browser does not expose the LNA permission. " +
           "Click <strong>Enable / Test</strong> to trigger the browser's " +
           "native prompt (if supported) or verify connectivity. " +
           "For best results, use <strong>Google Chrome " + MIN_CHROME_VERSION + "+</strong>." };
  }
  return { level: "warn",
    title: "Browser may have problems",
    msg: "LAN scanning may not work in this browser. Use <strong>Test</strong> " +
         "to check. For best results, use " +
         "<strong>Google Chrome " + MIN_CHROME_VERSION + "+</strong>." };
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
  if(g.bsbTestEl){
    g.bsbTestEl.style.display = info.level === "error" ? "none" : "";
    /* Clearer label for browsers where clicking triggers the prompt */
    g.bsbTestEl.textContent =
      (g.isBrave || g.isChromiumFamily) ? "Enable / Test" : "Test";
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
    showLocalNetGate();
    renderGateContent(mode);
    renderSupportBanner();
    return;
  }

  /* Soft "may have problems": app stays usable, banner only. */
  g.status = "granted";
  setBadge("warn");
  hideLocalNetGate();
  renderSupportBanner();
}

/* ---------- probing ---------- */
function buildProbes(){
  const port = (state.parsed && state.parsed.port) || state.storedPort || 80;
  const out = [];
  if(state.parsed && state.parsed.ip){
    out.push({ ip: state.parsed.ip, port });
  }
  if(state.storedSubnet){
    out.push({ ip: `${state.storedSubnet}.1`,   port });
    out.push({ ip: `${state.storedSubnet}.254`, port });
  }
  out.push({ ip: "192.168.1.1", port: 80 });
  out.push({ ip: "192.168.0.1", port: 80 });
  out.push({ ip: "10.0.0.1",    port: 80 });
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

/* ---------- actions ---------- */

/* Shared: fire probes, wait a moment, re-query permission.
   Returns { probes, permissionNow }. */
async function probeAndRefresh(timeoutMs){
  const r = await probeAll(timeoutMs);
  /* Give the browser a moment to process the user's answer to its
     native LNA prompt (if one appeared). */
  await new Promise(res => setTimeout(res, 400));
  await refreshPermission();
  return r;
}

/* Called by the gate's "Allow access" / "Try again" button
   (chrome-prompt / chrome-denied / etc). */
async function triggerAllow(){
  if(localNetGate.probing) return;
  localNetGate.probing = true;
  if(localNetGate.retryEl)  localNetGate.retryEl.disabled = true;
  if(localNetGate.statusEl) localNetGate.statusEl.textContent = "Requesting permission…";

  const r = await probeAndRefresh(2500);
  localNetGate.probing = false;
  if(localNetGate.retryEl) localNetGate.retryEl.disabled = false;

  /* 1. Permission granted → full success. */
  if(localNetGate.permissionState === "granted"){
    applyMode("granted");
    notify("Local network access granted ✓");
    return;
  }
  /* 2. Permission now exposed and still pending → re-render gate. */
  if(localNetGate.permissionState === "prompt"){
    applyMode("chrome-prompt");
    return;
  }
  /* 3. Query still "unsupported" but probes worked → the browser
        clearly let us through. Unlock via acknowledgment. */
  if(r.ok > 0){
    acknowledge(true);
    notify("Local network access enabled ✓");
    return;
  }
  /* 4. Nothing worked — re-apply mode to show updated instructions. */
  applyMode(recomputeMode());
  if(localNetGate.statusEl){
    localNetGate.statusEl.textContent =
      "Still not accessible — follow the instructions above.";
  }
}

/* Called by the banner's "Enable / Test" button. This is the path
   that makes Brave work: clicking fires a probe, which triggers
   Brave's native LNA prompt (if that Brave supports it), then we
   re-query the permission and unlock. */
async function testFromBanner(){
  if(localNetGate.bsbTestEl) localNetGate.bsbTestEl.disabled = true;
  const prevLabel = localNetGate.bsbTestEl
    ? localNetGate.bsbTestEl.textContent : "";
  if(localNetGate.bsbTestEl) localNetGate.bsbTestEl.textContent = "Checking…";

  const r = await probeAndRefresh(2000);

  if(localNetGate.bsbTestEl){
    localNetGate.bsbTestEl.disabled = false;
    localNetGate.bsbTestEl.textContent = prevLabel || "Enable / Test";
  }

  if(localNetGate.permissionState === "granted"){
    acknowledge(true);
    notify("Local network access granted ✓");
    return;
  }
  if(localNetGate.permissionState === "prompt"){
    applyMode("chrome-prompt");
    notify("Permission requested — allow it in the browser prompt", "error");
    return;
  }
  if(r.ok > 0){
    acknowledge(true);
    notify(`✓ ${r.ok}/${r.total} probes succeeded — LAN access works`);
    return;
  }

  /* Update the banner message with the failure reason */
  const g = localNetGate;
  if(g.bsbMsgEl){
    const original = g.bsbMsgEl.innerHTML;
    if(!original.startsWith("✗")){
      g.bsbMsgEl.innerHTML =
        "✗ Still not accessible. " +
        (g.isBrave
          ? "Turn <strong>Shields down</strong> for this site (🦁 lion icon) " +
            "and click <strong>Enable / Test</strong> again. If your Brave " +
            "supports LNA, a native prompt should appear."
          : "Check your browser's privacy settings for this site.");
    }
  }
  notify(`✗ 0/${r.total} probes succeeded — still blocked`, "error");
}

function acknowledge(silent){
  try{ localStorage.setItem(LN_ACK_KEY, "1"); }catch{}
  localNetGate.acknowledged = true;
  localNetGate.status = "granted";
  setBadge("granted");
  hideLocalNetGate();
  hideBanner();
  if(!silent) notify("Local network access enabled ✓");
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
    if(localNetGate.mode === "granted"){
      notify("Local network access is OK ✓");
      return;
    }
    if(localNetBlocked()){
      applyMode(recomputeMode());
      return;
    }
    if(localNetGate.bannerEl &&
       localNetGate.bannerEl.classList.contains("hidden")){
      renderSupportBanner();
    }
  });
}

/* ---------- init ---------- */
(async function initLocalNetGate(){
  cacheEls();
  detectEnvironment();
  localNetGate.isBrave = await detectBrave();
  try{ localNetGate.acknowledged = localStorage.getItem(LN_ACK_KEY) === "1"; }catch(_){}

  /* Initial query with retry — some Chromium forks throw once
     while their permission manager warms up. */
  localNetGate.permissionState = await queryPermission();

  /* Wire gate buttons */
  if(localNetGate.retryEl)
    localNetGate.retryEl.addEventListener("click", triggerAllow);
  /* Gate's "Test connectivity" button behaves like Allow — it fires
     probes which trigger the browser's native prompt. */
  if(localNetGate.testEl)
    localNetGate.testEl.addEventListener("click", triggerAllow);

  /* Wire banner buttons */
  if(localNetGate.bsbTestEl)
    localNetGate.bsbTestEl.addEventListener("click", testFromBanner);
  if(localNetGate.bsbDismissEl)
    localNetGate.bsbDismissEl.addEventListener("click", dismissBanner);

  wireBadge();

  applyMode(recomputeMode());

  /* Late re-check: some Chromium forks (Brave) report
     "unsupported" on first call but start answering after the
     permission manager has fully initialized. */
  if(localNetGate.permissionState === "unsupported"){
    setTimeout(async () => {
      const { before, now } = await refreshPermission();
      if(now !== before && now !== "unsupported"){
        applyMode(recomputeMode());
      }
    }, 800);
  }
})();
