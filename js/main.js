"use strict";

/* ============================================================
   MAIN: app initialisation — restore last scan, saved devices,
   URL query params (?device=… / ?load=…), stored URL and
   viewer session.

   Permission gating:
     • Already granted        → old way, no gate, everything runs.
     • Not granted (hard mode) → gate shows on load; the deep link
       is stored as `pendingNav` and fires only once permission
       is granted (window.__onLanGranted).
     • User dismisses gate    → pendingNav is dropped.
     • Soft browsers          → no permission to grant → old way,
       no gate, deep link fires immediately.
   ============================================================ */

(function(){
  /* ---------- restore last scan results ---------- */
  const restored = loadLastList();
  if(restored){
    state.lastOpenList = restored.list;
    renderList(restored.list, restored.port, false);
  }

  /* ---------- restore results panel visibility ---------- */
  const rv = localStorage.getItem(LSK.resultsVisible);
  setResultsVisible(rv === "1");

  /* ---------- ?device= / ?load= deep link (deferred) ---------- */
  const params = new URLSearchParams(location.search);
  const deviceParam = params.get("device");
  const loadParam   = params.get("load");
  const targetParam = deviceParam || loadParam;

  let pendingNav = targetParam
    ? { url: targetParam, openViewer: !!deviceParam }
    : null;

  function processNav(nav){
    try{ history.replaceState(null, "", location.pathname + location.hash); }catch(_){}
    topDeviceUrl.value = nav.url;
    handleUrlInput(nav.url);
    if(state.parsed && !state.parsed.error){
      const { ip, port } = state.parsed;
      state.lastOpenList = [{ ip, isDirect: true }];
      renderList(state.lastOpenList, port, false);
      if(nav.openViewer){
        openViewer(ip, port);
      }
    }
    renderSavedList();
  }

  /* Called by localnet.js applyMode("granted"). */
  window.__onLanGranted = function(){
    if(!pendingNav) return;
    const nav = pendingNav;
    pendingNav = null;
    processNav(nav);
  };

  /* Called by localnet.js hideLocalNetGate(true) — user skip. */
  window.__onLanGateDismissed = function(){
    pendingNav = null;
  };

  /* ---------- after permission check → decide what to show ---------- */
  (async function(){
    if(typeof localNetGateReady !== "undefined"){
      try{ await localNetGateReady; }catch(_){}
    }

    /* 1. Deep link path. */
    if(pendingNav){
      const blocked = (typeof localNetBlocked === "function") && localNetBlocked();
      if(blocked){
        /* Gate is up — defer to __onLanGranted. */
        return;
      }
      const nav = pendingNav;
      pendingNav = null;
      processNav(nav);
      return;
    }

    /* 2. No deep link — restore stored URL + saved list (old way). */
    const storedUrl = loadStored();
    if(storedUrl){
      topDeviceUrl.value = storedUrl;
      handleUrlInput(storedUrl);
    }

    renderSavedList();

    /* 3. Restore viewer session only when nothing is blocking. */
    if(!(typeof localNetBlocked === "function" && localNetBlocked())){
      const viewerState = loadViewerState();
      if(viewerState){
        openViewer(viewerState.ip, viewerState.port);
      }
    }
  })();
})();
