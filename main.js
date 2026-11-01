// Paralax Verse Companion: the "main" part of the app.
//
// It makes two see-through windows that sit on top of Star Citizen:
//   - the PANEL: the companion itself (Light, Spots, Trade, Photo, Settings). A hotkey shows and hides it.
//   - the HUD: a small strip in a corner showing the light where you are. Clicks pass straight through it to the game.
// Star Citizen must be in "Borderless" window mode for anything to show on top of it.
//
// Safety: the app never touches the game. It doesn't read the game's memory or files, and doesn't inject anything.
// It only draws its own windows on top, the same way Discord or Steam pop-ups do.

const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, shell, screen, nativeImage, clipboard } = require("electron");
const path = require("path");
const fs = require("fs");

// ---------- Settings (saved in the app's own folder on the PC) ----------
const DEFAULTS = {
  hotkey: "Control+Shift+P",   // shows / hides the panel
  hud: true,                   // the small light strip in the corner
  hudCorner: "top-right",
  veil: "medium",              // how see-through the panel is: light, medium or dark
  system: "Stanton", body: "Hurston", place: "Lorville",   // the place the HUD watches
  alertMins: 5,                // flash the HUD this many minutes before golden hour
  uexToken: "",                // free key from uexcorp.space (for the Trade tab)
  shotsFolder: "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\ScreenShots",
  startWithWindows: false,
  autoLocation: true,          // follow /showlocation from the game (via the clipboard)
  lastLocation: null           // { text, at, kind } the last place /showlocation told us
};
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { ...DEFAULTS };
function loadSettings() { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch (e) { settings = { ...DEFAULTS }; } }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); } }

let panel = null, hud = null, tray = null, hotkeyOk = true;

// ---------- The panel ----------
function createPanel() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 460, h = Math.min(780, wa.height - 80);
  panel = new BrowserWindow({
    width: w, height: h, x: wa.x + wa.width - w, y: wa.y + Math.round((wa.height - h) / 2),   // docked to the right edge, in the middle
    frame: false, transparent: true, resizable: false, movable: true, alwaysOnTop: true, skipTaskbar: true,
    show: false, fullscreenable: false, backgroundColor: "#00000000", title: "Paralax Verse Companion",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  panel.setAlwaysOnTop(true, "screen-saver");      // above full-screen-style (borderless) games
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(__dirname, "app", "index.html"));
  panel.on("close", (e) => { if (!app.isQuitting) { e.preventDefault(); panel.hide(); } });  // closing just hides it
}
function togglePanel(force) {
  if (!panel) return;
  const show = force === undefined ? !panel.isVisible() : force;
  if (show) { panel.show(); panel.focus(); panel.webContents.send("shown"); }
  else panel.hide();   // Windows hands the keyboard back to the game
  // The panel already shows the light, so the corner strip steps aside while it's open (they'd overlap otherwise)
  if (hud && !hud.isDestroyed()) { if (show) hud.hide(); else if (settings.hud) hud.showInactive(); }
}

// ---------- The HUD strip ----------
function hudBounds() {
  const wa = screen.getPrimaryDisplay().workArea, w = 380, h = 74, m = 16;
  const right = settings.hudCorner.includes("right"), bottom = settings.hudCorner.includes("bottom");
  return { width: w, height: h, x: right ? wa.x + wa.width - w : wa.x, y: bottom ? wa.y + wa.height - h - m : wa.y + m };  // touches the screen edge, like the panel
}
function createHud() {
  hud = new BrowserWindow({
    ...hudBounds(), frame: false, transparent: true, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true,
    focusable: false, show: false, backgroundColor: "#00000000",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  hud.setAlwaysOnTop(true, "screen-saver");
  hud.setIgnoreMouseEvents(true);                   // clicks go straight through to the game
  hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hud.loadFile(path.join(__dirname, "app", "hud.html"));
  hud.once("ready-to-show", () => { if (settings.hud && !(panel && panel.isVisible())) hud.showInactive(); });
}
function updateHud() {
  if (!hud) return;
  hud.setBounds(hudBounds());
  if (settings.hud && !(panel && panel.isVisible())) hud.showInactive(); else hud.hide();  // stays hidden while the panel is open
}

// ---------- Hotkey ----------
// Two ways of hearing the hotkey, because Star Citizen blocks normal Windows hotkeys while it's in front:
//   1. Windows' own hotkey (works on the desktop and in most apps)
//   2. a keyboard listener (the same kind Discord and OBS use for push-to-talk). It only listens:
//      it never presses keys, and never touches the game.
// If both hear the same key press, it only counts once.
let lastToggle = 0, hookPaused = false, keyListenerOn = false;
function toggleOnce() { if (Date.now() - lastToggle < 350) return; lastToggle = Date.now(); togglePanel(); }
function parseHotkey(acc) {   // "Control+Shift+F9" -> { ctrl, alt, shift, key: "F9" }
  const parts = String(acc || "").split("+");
  const key = parts.pop();
  return { ctrl: parts.includes("Control") || parts.includes("CommandOrControl"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key };
}
function startKeyListener() {
  let hook;
  try { hook = require("uiohook-napi"); } catch (e) { console.error("keyboard listener not available", e); return; }
  const { uIOhook, UiohookKey } = hook;
  const NAMES = { Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Space: "Space", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown" };
  uIOhook.on("keydown", (e) => {
    if (hookPaused) return;
    const h = parseHotkey(settings.hotkey), code = UiohookKey[NAMES[h.key] || h.key];
    if (code === undefined || e.keycode !== code) return;
    if (!!e.ctrlKey === h.ctrl && !!e.altKey === h.alt && !!e.shiftKey === h.shift) toggleOnce();
  });
  try { uIOhook.start(); keyListenerOn = true; app.on("will-quit", () => { try { uIOhook.stop(); } catch (er) { /* ignore */ } }); } catch (e) { console.error(e); }
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  try { hotkeyOk = globalShortcut.register(settings.hotkey, () => toggleOnce()); } catch (e) { hotkeyOk = false; }
  if (!hotkeyOk && keyListenerOn) hotkeyOk = true;   // the keyboard listener still hears it, even if Windows says it's taken
  if (tray) tray.setToolTip(`Paralax Verse Companion · ${hotkeyOk ? settings.hotkey + " to open" : "hotkey not available, pick another in Settings"}`);
}

// ---------- Tray icon (bottom-right of Windows) ----------
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "app", "tray.png")));
  const menu = () => Menu.buildFromTemplate([
    { label: "Show / hide companion", click: () => togglePanel() },
    { label: "Light strip (HUD)", type: "checkbox", checked: settings.hud, click: (i) => { settings.hud = i.checked; saveSettings(); updateHud(); broadcast(); } },
    { type: "separator" },
    { label: "Open paralaxverse.com", click: () => shell.openExternal("https://paralaxverse.com") },
    { label: "Quit", click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu());
  tray.on("click", () => togglePanel());
  tray.on("right-click", () => tray.setContextMenu(menu()));
}
function broadcast() { [panel, hud].forEach((w) => w && !w.isDestroyed() && w.webContents.send("settings", { ...settings, hotkeyOk })); }

// ---------- Trade data from UEX (fetched here, not in the window, and kept for a while to go easy on their servers) ----------
const cache = new Map();
async function uex(endpoint, params, ttlMin) {
  if (!/^[a-z_]+$/.test(endpoint)) return { error: "bad request" };
  const q = new URLSearchParams(params || {}).toString();
  const key = endpoint + "?" + q, hit = cache.get(key);
  if (hit && Date.now() - hit.at < (ttlMin || 10) * 60e3) return hit.data;
  if (!settings.uexToken) return { error: "no-token" };
  try {
    const res = await fetch(`https://api.uexcorp.space/2.0/${endpoint}${q ? "?" + q : ""}`, { headers: { Authorization: "Bearer " + settings.uexToken, Accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json) return { error: (json && (json.message || json.status)) || "HTTP " + res.status };
    if (json.status && json.status !== "ok") return { error: json.status };
    cache.set(key, { at: Date.now(), data: json });
    return json;
  } catch (e) { return { error: "offline" }; }
}

// ---------- Auto location from /showlocation ----------
// In Star Citizen, typing /showlocation in chat copies your position to the clipboard. We look at the clipboard
// once a second: if it's a /showlocation line, we work out where that is and switch the Light and Spots tabs to it.
// Anything else on the clipboard is ignored: it isn't kept, logged or sent anywhere.
// Still hands off the game: the game itself puts the text on the clipboard when YOU type the command.
global.window = global.window || {};
require("./app/dn.js"); require("./app/geo.js"); require("./app/locate.js");
const LOC = global.window.LOC;
let lastClip = null;
function logLocation(line) {   // a small local log of /showlocation readings, to help fix any wrong guesses
  try { fs.appendFileSync(path.join(app.getPath("userData"), "locations.log"), line + "\n"); } catch (e) { /* ignore */ }
}
function watchClipboard() {
  setInterval(() => {
    if (!settings.autoLocation) return;
    let text = "";
    try { text = clipboard.readText(); } catch (e) { return; }
    if (text === lastClip) return;
    const first = lastClip === null; lastClip = text;
    if (first) return;                          // whatever was there when the app started is old news
    const xyz = LOC.parse(text); if (!xyz) return;
    const at = Date.now(), r = LOC.locate(xyz, at);
    logLocation(`${new Date(at).toISOString()}\t${xyz.join(" ")}\t${r ? r.text : "unknown"}`);
    const found = r ? { text: r.text, at, kind: r.kind } : { text: "Somewhere we don't have on the map yet", at, kind: "unknown" };
    if (r) { settings.system = r.system; settings.body = r.body; if (r.place) settings.place = r.place; }
    settings.lastLocation = found;
    saveSettings(); broadcast();
    [panel, hud].forEach((w) => w && !w.isDestroyed() && w.webContents.send("located", found));
  }, 1000);
}

// ---------- Messages from the windows ----------
ipcMain.handle("settings:get", () => ({ ...settings, hotkeyOk, version: app.getVersion() }));
ipcMain.handle("settings:set", (e, patch) => {
  const allowed = Object.keys(DEFAULTS);
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) settings[k] = patch[k];
  saveSettings();
  if ("hotkey" in patch) registerHotkey();
  if ("hud" in patch || "hudCorner" in patch) updateHud();
  if ("startWithWindows" in patch) app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows });
  if ("uexToken" in patch) cache.clear();
  broadcast();
  return { ...settings, hotkeyOk };
});
ipcMain.handle("uex", (e, endpoint, params, ttl) => uex(endpoint, params, ttl));
ipcMain.handle("open", (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle("openFolder", () => shell.openPath(settings.shotsFolder));
ipcMain.handle("panel:hide", () => togglePanel(false));
ipcMain.handle("panel:pauseHotkey", (e, on) => { hookPaused = !!on; if (on) globalShortcut.unregisterAll(); else registerHotkey(); });  // while picking a new hotkey

// ---------- Start ----------
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => togglePanel(true));
app.whenReady().then(() => {
  loadSettings();
  createPanel(); createHud(); createTray(); startKeyListener(); registerHotkey(); watchClipboard();
  togglePanel(true);  // show it once at start, so people know it's running
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (e) => e.preventDefault());  // keep running in the tray
