// The bridge between the app's windows and the main part. Only these few, safe actions are allowed.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pv", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  uex: (endpoint, params, ttl) => ipcRenderer.invoke("uex", endpoint, params, ttl),
  open: (url) => ipcRenderer.invoke("open", url),
  openFolder: () => ipcRenderer.invoke("openFolder"),
  hide: () => ipcRenderer.invoke("panel:hide"),
  pauseHotkey: (on) => ipcRenderer.invoke("panel:pauseHotkey", on),
  onSettings: (fn) => ipcRenderer.on("settings", (e, s) => fn(s)),
  onShown: (fn) => ipcRenderer.on("shown", () => fn()),
  onLocated: (fn) => ipcRenderer.on("located", (e, r) => fn(r)),
  onNav: (fn) => ipcRenderer.on("nav", (e, d) => fn(d))
});
