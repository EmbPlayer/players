"use strict";

/* ============================================================
   PWA bootstrap:
     • registers sw.js
     • on every load fetches version.json (fresh)
     • if it differs from the version stored in localStorage,
       wipes the SW cache and reloads once so the new files
       are fetched fresh (and re-cached by the SW).
   ============================================================ */

(function () {
  const VERSION_KEY = "appVersion";
  const CACHE_NAME  = "embplayers-app";   // keep in sync with sw.js

  if (!("serviceWorker" in navigator)) {
    console.warn("[pwa] Service workers unavailable — offline disabled.");
    return;
  }

  /* ---- register the SW ---- */
  navigator.serviceWorker
    .register("./sw.js", { scope: "./", updateViaCache: "none" })
    .catch((err) => console.warn("[pwa] SW registration failed:", err));

  /* ---- version check + optional update ---- */
  (async () => {
    let remoteVersion = null;
    try {
      const res = await fetch("./version.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.version) remoteVersion = String(data.version);
      }
    } catch (_) { /* offline — can't check, skip */ }

    if (!remoteVersion) return;

    const storedVersion = localStorage.getItem(VERSION_KEY);

    // First ever visit: remember the version; SW is precaching now.
    if (!storedVersion) {
      localStorage.setItem(VERSION_KEY, remoteVersion);
      return;
    }

    if (storedVersion === remoteVersion) return;   // up to date

    /* ---- new version detected ---- */
    console.info(`[pwa] Updating ${storedVersion} → ${remoteVersion}`);

    try { await navigator.serviceWorker.ready; } catch (_) {}

    const controller = navigator.serviceWorker.controller;

    if (controller) {
      await new Promise((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve();
        try { controller.postMessage({ type: "clearCache" }, [ch.port2]); }
        catch (_) { resolve(); }
        setTimeout(resolve, 2500);          // safety net
      });
    } else {
      // Fresh-install path: no controller yet — clear cache directly.
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k === CACHE_NAME).map((k) => caches.delete(k))
        );
      } catch (_) {}
    }

    localStorage.setItem(VERSION_KEY, remoteVersion);
    location.reload();
  })();
})();