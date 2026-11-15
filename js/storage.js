"use strict";

/* ============================================================
   STORAGE: persistence helpers for labels, saved links,
   device URL, viewer session and last scan list.
   ============================================================ */

/* ---------- initial load ---------- */
try{ state.labels = JSON.parse(localStorage.getItem(LSK.labels) || "{}") || {}; }catch{}
try{ state.savedLinks = JSON.parse(localStorage.getItem(LSK.saved) || "[]") || []; }catch{}

/* ---------- labels / saved links ---------- */
const saveLabels = () => {
  try{ localStorage.setItem(LSK.labels, JSON.stringify(state.labels)); }catch{}
};

const saveSavedLinks = () => {
  try{ localStorage.setItem(LSK.saved, JSON.stringify(state.savedLinks)); }catch{}
};

/* ---------- device url / subnet / port ---------- */
const saveStored = (url, subnet, port) => {
  try{
    localStorage.setItem(LSK.url, url);
    localStorage.setItem(LSK.subnet, subnet);
    localStorage.setItem(LSK.port, String(port));
  }catch{}
};

const loadStored = () => {
  try{
    state.storedSubnet = localStorage.getItem(LSK.subnet) || null;
    const p = localStorage.getItem(LSK.port);
    state.storedPort = p ? parseInt(p, 10) : null;
    return localStorage.getItem(LSK.url) || null;
  }catch{ return null; }
};

const clearStored = () => {
  try{
    localStorage.removeItem(LSK.url);
    localStorage.removeItem(LSK.subnet);
    localStorage.removeItem(LSK.port);
  }catch{}
  state.storedSubnet = null;
  state.storedPort = null;
  state.parsed = null;
  state.targetIp = null;
  state.targetPort = null;
};

/* ---------- viewer session ---------- */
const saveViewerState = (ip, port) => {
  try{ localStorage.setItem(LSK.viewerState, JSON.stringify({ ip, port })); }catch{}
};

const clearViewerState = () => {
  try{ localStorage.removeItem(LSK.viewerState); }catch{}
};

const loadViewerState = () => {
  try{
    const s = localStorage.getItem(LSK.viewerState);
    if(!s) return null;
    const v = JSON.parse(s);
    if(!v || !v.ip || !v.port) return null;
    if(!isPrivateIp(v.ip)) return null;
    return v;
  }catch{ return null; }
};

/* ---------- last scan list ---------- */
const saveLastList = (list, port) => {
  try{
    localStorage.setItem(LSK.lastList, JSON.stringify(list.map(o => ({ ip: o.ip }))));
    localStorage.setItem(LSK.lastPort, String(port));
  }catch{}
};

const loadLastList = () => {
  try{
    const rawList = localStorage.getItem(LSK.lastList);
    const rawPort = localStorage.getItem(LSK.lastPort);
    if(!rawList || !rawPort) return null;
    const list = JSON.parse(rawList);
    const port = parseInt(rawPort, 10);
    if(!Array.isArray(list) || !list.length) return null;
    if(!(port >= 1 && port <= 65535)) return null;
    const clean = list.filter(o => o && typeof o.ip === "string" && isPrivateIp(o.ip));
    if(!clean.length) return null;
    return { list: clean, port };
  }catch{ return null; }
};