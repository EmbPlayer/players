"use strict";

/* ============================================================
   SCAN: probe function, run-scan orchestration,
   stop button, watch mode.
   ============================================================ */

/* ---------- single probe ---------- */
async function probe(ip, port, timeout){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const start = performance.now();

  try{
    await fetch(`http://${ip}:${port}/`, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: ctrl.signal
    });
    return { ip, open: true, ms: performance.now() - start };
  }catch(err){
    return { ip, open: false, ms: performance.now() - start, err: err.name };
  }finally{
    clearTimeout(t);
  }
}

/* ---------- run scan ---------- */
btnRunScan.addEventListener("click", async () => {
  if(state.running) return;

  /* --- local network access gate (must be granted to scan) --- */
  if(typeof localNetBlocked === "function" && localNetBlocked()){
    showLocalNetGate();
    notify("Allow local network access before scanning.", "error");
    return;
  }

  if(topDeviceUrl.value.trim()){
    handleUrlInput(topDeviceUrl.value);
  }

  let subnet = null, port = 8080, targetIp = null;
  if(state.parsed && !state.parsed.error){
    subnet = state.parsed.subnet;
    port = state.parsed.port;
    targetIp = state.parsed.ip;
  }else if(state.storedSubnet && state.storedPort){
    subnet = state.storedSubnet;
    port = state.storedPort;
    targetIp = state.targetIp;
  }

  if(!subnet){
    notify("Enter a valid device URL with a port first.", "error");
    topDeviceUrl.focus();
    return;
  }

  const timeout = parseInt(timeoutInput.value, 10);
  const concurrency = parseInt(concInput.value, 10);

  if(!(timeout >= 100 && timeout <= 10000)){
    notify("Invalid timeout (100–10000 ms).", "error"); return;
  }
  if(!(concurrency >= 1 && concurrency <= 200)){
    notify("Invalid concurrency (1–200).", "error"); return;
  }

  // NOTE: The Scan Results dropdown is intentionally NOT auto-opened here.
  // It is only ever toggled by the "▶ Scan Results" button.

  state.running = true;
  state.stopRequested = false;
  btnRunScan.disabled = true;
  btnOpenConfig.disabled = true;
  topDeviceUrl.disabled = true;
  stopBtn.disabled = false;

  progressContainer.classList.remove("hidden");
  progressBar.style.width = "0%";

  let openDevices = [];
  renderList(openDevices, port, true);

  statusText.textContent = `Probing target link first...`;

  if(targetIp){
    const targetProbe = await probe(targetIp, port, timeout);
    if(targetProbe.open){
      openDevices.push({ ip: targetIp });
      state.lastOpenList = [...openDevices];
      renderList(openDevices, port, true);
    }
  }

  statusText.textContent = `Scanning subnet ${subnet}.0/24 on port ${port}…`;

  const t0 = performance.now();
  let last = 0;

  try{
    const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
    let cursor = 0, done = 0;

    async function worker(){
      while(cursor < ips.length && !state.stopRequested){
        const ip = ips[cursor++];
        const r = await probe(ip, port, timeout);
        done++;

        if(r.open){
          if(!openDevices.some(d => d.ip === ip)){
            openDevices.push({ ip });
            openDevices.sort(
              (a, b) => +a.ip.split(".").pop() - +b.ip.split(".").pop()
            );
            state.lastOpenList = [...openDevices];
            renderList(openDevices, port, true);
          }
        }

        const now = performance.now();
        if(now - last > 120 || done === ips.length){
          last = now;
          statusText.textContent =
            `${done}/${ips.length} scanned — found ${openDevices.length} device(s)`;
          progressBar.style.width = ((done / ips.length) * 100).toFixed(1) + "%";
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, ips.length) }, worker)
    );

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    progressBar.style.width = "100%";
    statusText.textContent =
      (state.stopRequested ? "Stopped" : "Done") +
      ` — ${openDevices.length} device(s) found in ${elapsed}s.`;

    state.lastOpenList = openDevices;
    renderList(openDevices, port, false);

    /* Tell the LNA layer what happened. A successful scan is the ONLY
       proof that LAN access works; a failed scan resets the badge so it
       can never falsely claim success. */
    if(!state.stopRequested){
      if(openDevices.length > 0){
        if(typeof reportScanSuccess === "function"){
          reportScanSuccess(openDevices.length);
        }
      }else{
        if(typeof reportScanFailure === "function"){
          reportScanFailure();
        }
      }
    }

  }catch(e){
    statusText.textContent = "❌ Scan failed: " + e.message;
    notify("Scan failed: " + e.message, "error");
  }finally{
    state.running = false;
    btnRunScan.disabled = false;
    btnOpenConfig.disabled = false;
    topDeviceUrl.disabled = false;
    stopBtn.disabled = true;
  }
});

/* ---------- stop ---------- */
stopBtn.addEventListener("click", () => { state.stopRequested = true; });

/* ---------- watch mode ---------- */
function scheduleWatch(){
  if(state.watchTimer){ clearInterval(state.watchTimer); state.watchTimer = null; }
  if(!watchToggle.checked) return;

  const secs = Math.max(5, Math.min(600, parseInt(watchInput.value, 10) || 30));
  state.watchTimer = setInterval(() => {
    if(state.running) return;
    /* Don't pop the permission gate from a background timer. */
    if(typeof localNetBlocked === "function" && localNetBlocked()) return;
    btnRunScan.click();
  }, secs * 1000);
}

watchToggle.addEventListener("change", scheduleWatch);
watchInput.addEventListener("change", scheduleWatch);
