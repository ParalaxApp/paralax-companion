// Paralax Verse Companion: the "main" part of the app.
//
// It makes two see-through windows that sit on top of Star Citizen:
//   - the PANEL: the companion itself (Light, Spots, Trade, Photo, Settings). A hotkey shows and hides it.
//   - the HUD: a small strip in a corner showing the light where you are. Clicks pass straight through it to the game.
// Star Citizen must be in "Borderless" window mode for anything to show on top of it.
//
// Safety: the app never touches the game. It doesn't read the game's memory or files, and doesn't inject anything.
// It only draws its own windows on top, the same way Discord or Steam pop-ups do.

const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, shell, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

// ---------- Settings (saved in the app's own folder on the PC) ----------
const DEFAULTS = {
  hotkey: "Control+Shift+P",   // shows / hides the panel
  hud: true,                   // the small light strip in the corner
  hudCorner: "top-right",
  system: "Stanton", body: "Hurston", place: "Lorville",   // the place the HUD watches
  alertMins: 5,                // flash the HUD this many minutes before golden hour
  uexToken: "",                // free key from uexcorp.space (for the Trade tab)
  shotsFolder: "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\ScreenShots",
  startWithWindows: false
};
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { ...DEFAULTS };
function loadSettings() { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; } catch (e) { settings = { ...DEFAULTS }; } }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { console.error(e); } }

let panel = null, hud = null, tray = null, hotkeyOk = true;

// ---------- The panel ----------
function createPanel() {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 460, h = Math.min(820, wa.height - 40);
  panel = new BrowserWindow({
    width: w, height: h, x: wa.x + wa.width - w - 20, y: wa.y + 20,
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
}

// ---------- The HUD strip ----------
function hudBounds() {
  const wa = screen.getPrimaryDisplay().workArea, w = 340, h = 74, m = 16;
  const right = settings.hudCorner.includes("right"), bottom = settings.hudCorner.includes("bottom");
  return { width: w, height: h, x: right ? wa.x + wa.width - w - m : wa.x + m, y: bottom ? wa.y + wa.height - h - m : wa.y + m };
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
  hud.once("ready-to-show", () => { if (settings.hud) hud.showInactive(); });
}
function updateHud() {
  if (!hud) return;
  hud.setBounds(hudBounds());
  if (settings.hud) hud.showInactive(); else hud.hide();
}

// ---------- Hotkey ----------
function registerHotkey() {
  globalShortcut.unregisterAll();
  try { hotkeyOk = globalShortcut.register(settings.hotkey, () => togglePanel()); } catch (e) { hotkeyOk = false; }
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
ipcMain.handle("panel:pauseHotkey", (e, on) => { if (on) globalShortcut.unregisterAll(); else registerHotkey(); });  // while picking a new hotkey

// ---------- Start ----------
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => togglePanel(true));
app.whenReady().then(() => {
  loadSettings();
  createPanel(); createHud(); createTray(); registerHotkey();
  togglePanel(true);  // show it once at start, so people know it's running
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (e) => e.preventDefault());  // keep running in the tray
