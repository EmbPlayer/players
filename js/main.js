"use strict";

/* ============================================================
   MAIN: app initialisation — restore last scan, saved devices,
   URL query params (?device=… / ?load=…), stored URL and
   viewer session. Loaded last, after all helpers are defined.

   Query params:
     ?device=<url>  → parse, render, AND open the fullscreen viewer
     ?load=<url>    → parse, render only (no viewer launch)

   If both are present, ?device= wins.
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

  /* ---------- ?device=… / ?load=… deep link ---------- */
  const params = new URLSearchParams(location.search);
  const deviceParam = params.get("device");
  const loadParam   = params.get("load");

  /* ?device wins if both are present (stronger action). */
  const targetParam      = deviceParam || loadParam;
  const shouldOpenViewer = !!deviceParam;

  if(targetParam){
    try{
      history.replaceState(null, "", location.pathname + location.hash);
    }catch(_){}

    topDeviceUrl.value = targetParam;
    handleUrlInput(targetParam);

    if(state.parsed && !state.parsed.error){
      const { ip, port } = state.parsed;
      state.lastOpenList = [{ ip, isDirect: true }];
      renderList(state.lastOpenList, port, false);
      if(shouldOpenViewer){
        openViewer(ip, port);
      }
    }
    renderSavedList();
    return;
  }

  /* ---------- restore stored device URL ---------- */
  const storedUrl = loadStored();
  if(storedUrl){
    topDeviceUrl.value = storedUrl;
    handleUrlInput(storedUrl);
  }

  renderSavedList();

  /* ---------- restore viewer session ---------- */
  const viewerState = loadViewerState();
  if(viewerState){
    openViewer(viewerState.ip, viewerState.port);
  }
})();
