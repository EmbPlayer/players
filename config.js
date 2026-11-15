"use strict";

/* ============================================================
   SHARED CONFIG: DOM refs, storage keys, app state
   Loaded first — every other module depends on these globals.
   ============================================================ */

const $ = (id) => document.getElementById(id);

/* ---------- DOM: header / top bar ---------- */
const topDeviceUrl = $("topDeviceUrl");
const btnOpenConfig = $("btnOpenConfig");
const btnRunScan = $("btnRunScan");

/* ---------- DOM: config modal ---------- */
const configModal   = $("configModal");
const btnModalClose = $("btnModalClose");
const btnModalCancel = $("btnModalCancel");
const btnModalSave  = $("btnModalSave");
const timeoutInput  = $("timeout");
const concInput     = $("conc");
const watchToggle   = $("watchMode");
const watchInput    = $("watchInterval");

/* ---------- DOM: progress / results ---------- */
const stopBtn = $("stopBtn");
const progressContainer = $("progressContainer");
const progressBar = $("progressBar").firstElementChild;
const statusText = $("statusText");
const summaryEl = $("summary");
const resultsTableWrapper = $("resultsTableWrapper");
const tableEl = $("resultsTable");
const tbody = tableEl.querySelector("tbody");
const emptyState = $("emptyState");
const resultsContainer = $("resultsContainer");
const btnToggleResults = $("btnToggleResults");

/* ---------- DOM: saved devices ---------- */
const savedTableWrapper = $("savedTableWrapper");
const savedTable = $("savedTable");
const savedTbody = $("savedTbody");
const savedEmptyState = $("savedEmptyState");

/* ---------- DOM: misc ---------- */
const httpsWarn = $("httpsWarn");
const viewer = $("viewer");
const viewerFrame = $("viewerFrame");
const viewerReload = $("viewerReload");
const viewerClose = $("viewerClose");
const toastHost = $("toasts");

/* ---------- localStorage keys ---------- */
const LSK = {
  url: "lanScanner.url",
  subnet: "lanScanner.subnet",
  port: "lanScanner.port",
  labels: "lanScanner.labels",
  saved: "lanScanner.savedLinks",
  viewerState: "lanScanner.viewerState",
  resultsVisible: "lanScanner.resultsVisible",
  lastList: "lanScanner.lastList",
  lastPort: "lanScanner.lastPort"
};

/* ---------- global app state ---------- */
const state = {
  running: false,
  stopRequested: false,
  watchTimer: null,
  resultsVisible: false,
  labels: {},
  savedLinks: [],
  lastOpenList: [],
  currentViewerUrl: null,
  parsed: null,
  storedSubnet: null,
  storedPort: null,
  targetIp: null,
  targetPort: null,
  resultCount: 0
};