"use strict";

/* ============================================================
   SERVICE WORKER — precaches the app on install, serves
   cache-first for assets, network-first for version.json.
   ============================================================ */

const APP_CACHE = "embplayers-app";
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/config.js",
  "./js/storage.js",
  "./js/ui.js",
  "./js/url.js",
  "./js/saved.js",
  "./js/results.js",
  "./js/scan.js",
  "./js/main.js",
  "./js/pwa.js",
  "./version.json"
];

/* ---------- install: precache everything ---------- */
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "reload" });
        if (res && res.ok) await cache.put(url, res);
      } catch (_) { /* skip individual failures */ }
    }));
  })());
});

/* ---------- activate: take over ---------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ---------- messages from the page ---------- */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "clearCache") return;

  event.waitUntil((async () => {
    try { await caches.delete(APP_CACHE); } catch (_) {}
    const port = event.ports && event.ports[0];
    if (port) port.postMessage({ type: "cacheCleared" });
    else if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: "cacheCleared" });
    }
  })());
});

/* ---------- fetch ---------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  // Never intercept cross-origin (LAN probes, viewer iframes, etc.)
  if (url.origin !== self.location.origin) return;

  /* version.json → network-first (always try to get the freshest) */
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-store" });
        if (res && res.ok) {
          try {
            const cache = await caches.open(APP_CACHE);
            cache.put(req, res.clone());
          } catch (_) {}
        }
        return res;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response("", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  /* App assets → cache-first, network fallback (+ re-cache) */
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (res && res.ok) {
        try {
          const cache = await caches.open(APP_CACHE);
          cache.put(req, res.clone());
        } catch (_) {}
      }
      return res;
    } catch (_) {
      // SPA fallback for navigations
      if (req.mode === "navigate") {
        const fb = await caches.match("./index.html");
        if (fb) return fb;
      }
      return new Response("Offline — resource not cached.", {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});