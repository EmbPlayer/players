"use strict";

/* ============================================================
   MAIN: app initialisation — restore last scan, saved devices,
   URL query param (?device=…), stored URL and viewer session.
   Loaded last, after all helpers are defined.
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

  /* ---------- ?device=… deep link ---------- */
  const params = new URLSearchParams(location.search);
  const deviceParam = params.get("device");

  if(deviceParam){
    try{
      history.replaceState(null, "", location.pathname + location.hash);
    }catch(_){}

    topDeviceUrl.value = deviceParam;
    handleUrlInput(deviceParam);

    if(state.parsed && !state.parsed.error){
      const { ip, port } = state.parsed;
      state.lastOpenList = [{ ip, isDirect: true }];
      renderList(state.lastOpenList, port, false);
      openViewer(ip, port);
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