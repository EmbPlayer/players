"use strict";

/* ============================================================
   URL: parse device address, validate private LAN IPs,
   keep the main scan target in sync with the input field.
   ============================================================ */

function isPrivateIp(ip){
  const p = ip.split(".").map(Number);
  if(p.length !== 4 || p.some(n => isNaN(n))) return false;
  return p[0] === 10
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168);
}

function parseDeviceUrl(input){
  if(!input) return { error: "empty" };
  let s = String(input).trim();
  if(!s) return { error: "empty" };
  if(!/^https?:\/\//i.test(s)) s = "http://" + s;

  let u;
  try{ u = new URL(s); }catch{ return { error: "Invalid URL" }; }

  const ip = u.hostname;
  if(!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip))
    return { error: "Host is not an IPv4 address" };
  if(ip.split(".").some(n => +n > 255))
    return { error: "Invalid IPv4 octet" };

  let port;
  if(u.port) port = parseInt(u.port, 10);
  else port = u.protocol === "https:" ? 443 : 80;
  if(!(port >= 1 && port <= 65535)) return { error: "Invalid port" };

  const subnet = ip.split(".").slice(0, 3).join(".");
  if(!isPrivateIp(ip))
    return { error: "Not a private LAN address (need 10.x, 172.16–31.x, or 192.168.x)" };

  return { ip, port, subnet, url: u.href, protocol: u.protocol };
}

/* ---------- sync target with parsed input ---------- */
function updateMainTarget(){
  if(state.parsed && !state.parsed.error){
    state.targetIp = state.parsed.ip;
    state.targetPort = state.parsed.port;
  }else if(state.storedSubnet && state.storedPort){
    state.targetIp = null;
    state.targetPort = state.storedPort;
  }else{
    state.targetIp = null;
    state.targetPort = null;
  }
  renderSavedList();   // defined in saved.js
}

function handleUrlInput(raw){
  if(!raw.trim()){
    state.parsed = null;
    clearStored();
    updateMainTarget();
    return;
  }

  state.parsed = parseDeviceUrl(raw);
  if(state.parsed && !state.parsed.error){
    saveStored(state.parsed.url, state.parsed.subnet, state.parsed.port);
    state.storedSubnet = state.parsed.subnet;
    state.storedPort = state.parsed.port;
  }
  updateMainTarget();
}

/* ---------- input listeners ---------- */
let urlDebounce = null;

topDeviceUrl.addEventListener("input", (e) => {
  clearTimeout(urlDebounce);
  urlDebounce = setTimeout(() => handleUrlInput(e.target.value), 200);
});

topDeviceUrl.addEventListener("blur", (e) => handleUrlInput(e.target.value));

topDeviceUrl.addEventListener("keydown", (e) => {
  if(e.key === "Enter"){
    handleUrlInput(e.target.value);
    btnRunScan.click();
  }
});