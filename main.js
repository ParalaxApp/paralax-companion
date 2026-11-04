// Paralax Verse Companion: the "main" part of the app.
//
// It makes two see-through windows that sit on top of Star Citizen:
//   - the PANEL: the companion itself (Light, Spots, Trade, Photo, Settings). A hotkey shows and hides it.
//   - the HUD: a small strip in a corner showing the light where you are. Clicks pass straight through it to the game.
// Star Citizen must be in "Borderless" window mode for anything to show on top of it.
//
// Safety: the app never touches the game. It doesn't read the game's memory or files, and doesn't inject anything.
// It only draws its own windows on top, the same way Discord or Steam pop-ups do.
// Privacy (0.6.3): the keyboard listener and the clipboard check ONLY run while Star Citizen is running.
// When the game isn't running, both are switched off completely (the normal Windows hotkey still opens the panel).

const { app, BrowserWindow, globalShortcut, Tray, Menu, ipcMain, shell, screen, nativeImage, clipboard, safeStorage, Notification, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// ---------- Locking the windows down ----------
// The app's windows can only ever show the app's own pages: no opening new windows, no following links inside
// them, no loading a dropped file, and no asking for the camera, microphone, location and so on.
app.on("web-contents-created", (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.on("will-attach-webview", (e) => e.preventDefault());
});
const APP_URL = pathToFileURL(path.join(__dirname, "app")).href + "/";
const fromApp = (e) => { try { return !!(e.senderFrame && e.senderFrame.url.startsWith(APP_URL)); } catch (er) { return false; } };

// ---------- Settings (saved in the app's own folder on the PC) ----------
const DEFAULTS = {
  hotkey: "Insert",            // shows / hides the panel (one key, no Ctrl/Shift: those are crouch and sprint in game)
  hud: true,                   // the small light strip in the corner
  hudCorner: "top-right",
  veil: "medium",              // how see-through the panel is: light, medium or dark
  system: "Stanton", body: "Hurston", place: "Lorville",   // the place the HUD watches
  alertMins: 5,                // flash the HUD this many minutes before golden hour
  uexToken: "",                // free key from uexcorp.space (for the Trade tab)
  shotsFolder: "C:\\Program Files\\Roberts Space Industries\\StarCitizen\\LIVE\\ScreenShots",
  startWithWindows: false,
  autoLocation: true,          // follow /showlocation from the game (via the clipboard)
  shareFeedback: null,         // anonymous feedback data: version + Windows/Linux + "opened". null = not asked yet, so nothing is sent
  installId: "",               // a random ID made on this PC, so one person opening it 10 times counts once
  lastLocation: null,          // { text, at, kind } the last place /showlocation told us
  feedbackAskedV2: false       // internal: we've reset the usage-data question for 0.7.0
};
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings = { ...DEFAULTS };
// The UEX key is never written to disk as plain text: it's locked with Windows' own encryption (DPAPI, tied to
// your Windows account) and saved as "uexTokenEnc". Only this app, running as you, can unlock it.
// On Linux it uses the desktop's keyring. If there's no real keyring, the key is NOT saved at all: it only lasts
// until the app closes (Settings says so).
const canEncrypt = () => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
      const b = safeStorage.getSelectedStorageBackend();
      if (b === "basic_text" || b === "unknown") return false;   // no real keyring: don't pretend it's locked
    }
    return true;
  } catch (e) { return false; }
};
let keptEnc = null;   // a saved key we couldn't unlock right now (keyring not ready): kept as it is, never thrown away
function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch (e) { raw = {}; }
  settings = { ...DEFAULTS, ...raw };
  delete settings.uexTokenEnc;
  if (raw.uexTokenEnc) {
    settings.uexToken = "";
    try { if (canEncrypt()) settings.uexToken = safeStorage.decryptString(Buffer.from(raw.uexTokenEnc, "base64")); } catch (e) { settings.uexToken = ""; }
    if (!settings.uexToken) keptEnc = raw.uexTokenEnc;
  }
  if (settings.hotkey === "Control+Shift+P") settings.hotkey = DEFAULTS.hotkey;   // the old default clashed with crouch
  // 0.7.0: older versions sent usage data without asking first. Everyone gets asked once now.
  // Anyone who'd already said no stays a no. A new random ID is made, so new data can't be linked to the old.
  if (!raw.feedbackAskedV2) { if (raw.shareFeedback !== false) settings.shareFeedback = null; settings.installId = ""; settings.feedbackAskedV2 = true; }
  // 0.7.0: older versions kept a log of /showlocation readings. Not needed any more, so it's removed.
  try { fs.unlinkSync(path.join(app.getPath("userData"), "locations.log")); } catch (e) { /* not there */ }
  saveSettings();   // re-saves straight away, so an old plain-text key gets locked (or removed, if it can't be locked)
}
function saveSettings() {
  const out = { ...settings };
  delete out.uexToken;                                   // the plain key is never written
  try {
    if (settings.uexToken && canEncrypt()) { out.uexTokenEnc = safeStorage.encryptString(settings.uexToken).toString("base64"); keptEnc = null; }
    else if (!settings.uexToken && keptEnc) out.uexTokenEnc = keptEnc;   // couldn't unlock it this time: keep it for next time
  } catch (e) { console.error(e); if (keptEnc) out.uexTokenEnc = keptEnc; }
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2)); } catch (e) { console.error(e); }
}
// What the windows are allowed to see: everything except the UEX key itself (they only need to know there is one)
function publicSettings() { const p = { ...settings, hotkeyOk, gameRunning, hasUex: !!settings.uexToken, tokenLocked: canEncrypt(), tokenStuck: !settings.uexToken && !!keptEnc, update: latest, version: app.getVersion() }; delete p.uexToken; return p; }

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
// ---------- Bringing the panel to the front ----------
// Windows doesn't let an app jump in front of a game by itself, so the panel used to appear without a mouse cursor
// or keyboard. These standard Windows calls (the same ones launchers and overlays use) bring it properly to the front;
// the game then lets go of the mouse. When the panel hides, the game is put back in front.
// Nothing is sent to the game: no key presses, no clicks.
let win32 = null, gameWindow = null;
function loadWin32() {
  if (win32 !== null || process.platform !== "win32") return win32;
  try {
    const koffi = require("koffi");
    const u = koffi.load("user32.dll"), k = koffi.load("kernel32.dll");
    win32 = {
      GetForegroundWindow: u.func("uintptr_t __stdcall GetForegroundWindow()"),
      GetWindowThreadProcessId: u.func("uint32_t __stdcall GetWindowThreadProcessId(uintptr_t, void *)"),
      AttachThreadInput: u.func("bool __stdcall AttachThreadInput(uint32_t, uint32_t, bool)"),
      SetForegroundWindow: u.func("bool __stdcall SetForegroundWindow(uintptr_t)"),
      BringWindowToTop: u.func("bool __stdcall BringWindowToTop(uintptr_t)"),
      IsWindow: u.func("bool __stdcall IsWindow(uintptr_t)"),
      GetCurrentThreadId: k.func("uint32_t __stdcall GetCurrentThreadId()")
    };
  } catch (e) { console.error("can't load Windows helpers", e); win32 = false; }
  return win32;
}
const handleOf = (w) => { const b = w.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0)); };
function bringToFront(target) {   // target: a window handle
  const w = loadWin32(); if (!w || !target) return false;
  try {
    const fg = w.GetForegroundWindow();
    const fgThread = fg ? w.GetWindowThreadProcessId(fg, null) : 0, me = w.GetCurrentThreadId();
    const attach = fgThread && fgThread !== me && w.AttachThreadInput(fgThread, me, true);   // share input with the front app for a moment
    w.BringWindowToTop(target); const ok = w.SetForegroundWindow(target);
    if (attach) w.AttachThreadInput(fgThread, me, false);
    return ok;
  } catch (e) { console.error(e); return false; }
}
function togglePanel(force) {
  if (!panel) return;
  const show = force === undefined ? !panel.isVisible() : force;
  if (show) {
    const w = loadWin32(), mine = handleOf(panel);
    if (w) { const fg = w.GetForegroundWindow(); if (fg && fg !== mine && fg !== handleOf(hud)) gameWindow = fg; }   // remember the game, to give it back later
    panel.show(); bringToFront(mine); panel.focus(); panel.webContents.send("shown");
  } else {
    panel.hide();
    const w = loadWin32();   // hand the game its mouse and keyboard back
    if (w && gameWindow && w.IsWindow(gameWindow)) bringToFront(gameWindow);
  }
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
  const NAV = { [UiohookKey.ArrowLeft]: "left", [UiohookKey.ArrowRight]: "right", [UiohookKey.ArrowUp]: "up", [UiohookKey.ArrowDown]: "down" };
  uIOhook.on("keydown", (e) => {
    if (hookPaused) return;
    // backup: panel open but Windows kept the game in front -> arrow keys still move the panel
    if (NAV[e.keycode] && panel && panel.isVisible() && !panel.isFocused()) panel.webContents.send("nav", NAV[e.keycode]);
    const h = parseHotkey(settings.hotkey), code = UiohookKey[NAMES[h.key] || h.key];
    if (code === undefined || e.keycode !== code) return;
    if (!!e.ctrlKey === h.ctrl && !!e.altKey === h.alt && !!e.shiftKey === h.shift) toggleOnce();
  });
  keyHook = uIOhook;
  app.on("will-quit", () => setKeyListener(false));
}
// Switch the keyboard listener on or off. It's only on while Star Citizen is running (see "Is the game running?").
let keyHook = null;
function setKeyListener(on) {
  if (!keyHook || on === keyListenerOn) return;
  try { if (on) keyHook.start(); else keyHook.stop(); keyListenerOn = on; } catch (e) { console.error(e); }
  registerHotkey();   // refreshes the tray tip
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (hookPaused) return;   // picking a new hotkey right now
  try { hotkeyOk = globalShortcut.register(settings.hotkey, () => toggleOnce()); } catch (e) { hotkeyOk = false; }
  if (!hotkeyOk && keyHook) hotkeyOk = true;   // the keyboard listener still hears it, even if Windows says it's taken
  if (tray) tray.setToolTip(`Paralax Verse Companion · ${hotkeyOk ? settings.hotkey + " to open" : "hotkey not available, pick another in Settings"}${gameRunning ? " · Star Citizen running" : ""}`);
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
function broadcast() { [panel, hud].forEach((w) => w && !w.isDestroyed() && w.webContents.send("settings", publicSettings())); }

// ---------- Trade data from UEX (fetched here, not in the window, and kept for a while to go easy on their servers) ----------
const cache = new Map();
async function uex(endpoint, params, ttlMin) {
  if (!/^[a-z_]+$/.test(endpoint)) return { error: "bad request" };
  const q = new URLSearchParams(params || {}).toString();
  const key = endpoint + "?" + q, hit = cache.get(key);
  const ttl = Number.isFinite(ttlMin) ? Math.max(0, Math.min(ttlMin, 1440)) : 10;   // minutes (0 = fresh)
  if (hit && Date.now() - hit.at < ttl * 60e3) return hit.data;
  if (!settings.uexToken) return { error: "no-token" };
  try {
    const res = await fetch(`https://api.uexcorp.uk/2.0/${endpoint}${q ? "?" + q : ""}`, { headers: { Authorization: "Bearer " + settings.uexToken, Accept: "application/json" } });
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
// We don't even keep a copy to compare with: only a fingerprint (a hash), so we can tell when it changes.
// And it only runs while Star Citizen is running.
// Still hands off the game: the game itself puts the text on the clipboard when YOU type the command.
global.window = global.window || {};
require("./app/dn.js"); require("./app/geo.js"); require("./app/locate.js");
const LOC = global.window.LOC;
let lastClip = null;   // fingerprint of the clipboard last time we looked (never the text itself)
const fingerprint = (t) => require("crypto").createHash("sha256").update(t).digest("hex");
function watchClipboard() {
  let busy = false;
  setInterval(async () => {
    if (busy) return;   // the last check hasn't finished yet
    busy = true;
    try { await checkClipboard(); } catch (e) { console.error("clipboard check", e); }   // a problem here must never crash the app
    busy = false;
  }, 1000);
}
async function checkClipboard() {
  if (!settings.autoLocation || !gameRunning) { lastClip = null; return; }   // game closed: don't look at all
  // Newer Electron versions hand the clipboard back a moment later (a "promise"), older ones straight away:
  // "await" works for both. (0.7.0 forgot this and crashed: fixed in 0.7.1.)
  let text = "";
  try { text = await clipboard.readText(); } catch (e) { return; }
  if (typeof text !== "string") return;
  const fp = fingerprint(text);
  if (fp === lastClip) { text = ""; return; }
  const first = lastClip === null; lastClip = fp;
  const xyz = first ? null : LOC.parse(text);  // whatever was there when the game started is old news
  text = "";                                   // done with it: only the three numbers (if it was a /showlocation line) are kept
  if (!xyz) return;
  const at = Date.now(), r = LOC.locate(xyz, at);
  const found = r ? { text: r.text, at, kind: r.kind } : { text: "Somewhere we don't have on the map yet", at, kind: "unknown" };
  if (r) { settings.system = r.system; settings.body = r.body; if (r.place) settings.place = r.place; }
  settings.lastLocation = found;
  saveSettings(); broadcast();
  [panel, hud].forEach((w) => w && !w.isDestroyed() && w.webContents.send("located", found));
}

// ---------- Is the game running? ----------
// Every 5 seconds we check the list of running programs for StarCitizen.exe (just its name, nothing inside it).
// The keyboard listener and the clipboard check only run while it's there.
let gameRunning = false;
const { execFile } = require("child_process");
function checkGame() {
  return new Promise((done) => {
    if (process.platform === "win32") {
      execFile("tasklist", ["/FI", "IMAGENAME eq StarCitizen.exe", "/NH", "/FO", "CSV"], { windowsHide: true, timeout: 4000 },
        (err, out) => done(!err && /"StarCitizen\.exe"/i.test(out || "")));
    } else {
      // Linux (Wine / Proton): the game shows up as a process called StarCitizen.exe
      try { done(fs.readdirSync("/proc").some((d) => /^\d+$/.test(d) && (() => { try { return /StarCitizen\.exe/i.test(fs.readFileSync(`/proc/${d}/comm`, "utf8")); } catch (e) { return false; } })())); }
      catch (e) { done(false); }
    }
  });
}
async function watchGame() {
  const now = await checkGame();
  if (now !== gameRunning) {
    gameRunning = now;
    setKeyListener(now);
    if (!now) lastClip = null;
    broadcast();
  }
  setTimeout(watchGame, 5000);
}

// ---------- New version check ----------
// Once at start and every 6 hours: asks GitHub for the newest public release (just its version number).
// If there's a newer one, the panel shows a "new version" bar and Windows shows one notification.
let latest = null;
const newer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate() {
  try {
    const res = await fetch("https://api.github.com/repos/ParalaxApp/paralax-companion-download/releases/latest", { headers: { Accept: "application/vnd.github+json", "User-Agent": "Paralax-Verse-Companion" } });
    if (!res.ok) return;
    const tag = String((await res.json()).tag_name || "").replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(tag) || !newer(tag, app.getVersion())) return;
    if (latest !== tag) {
      latest = tag; broadcast();
      try { if (Notification.isSupported()) { const n = new Notification({ title: "Paralax Verse Companion", body: `Version ${tag} is out. Click to download it.` }); n.on("click", () => shell.openExternal("https://paralaxverse.com/companion")); n.show(); } } catch (e) { /* ignore */ }
    }
  } catch (e) { /* offline: try again later */ }
}

// ---------- Anonymous feedback data ----------
// When the companion opens (and every 6 hours while it runs) it tells paralaxverse.com: "a copy of version X
// is in use on Windows/Linux", with a random ID made on this PC. Nothing about the person, their account or
// their game. It helps us see how many people use it and which versions are out there. Off switch in Settings.
const SUPABASE_URL = "https://hiqbxmvhqaqhpyixmvqx.supabase.co";
const SUPABASE_KEY = "sb_publishable_xEpHsvE-JsCbfoIR60M-zg_69nM8kr4";   // the site's public key (read-only by design)
function sendFeedback() {
  if (settings.shareFeedback !== true) return;   // only if the person said yes
  if (!settings.installId) { settings.installId = require("crypto").randomUUID(); saveSettings(); }
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "mac" : "linux";
  fetch(`${SUPABASE_URL}/rest/v1/rpc/companion_ping`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_id: settings.installId, p_version: app.getVersion(), p_os: os })
  }).catch(() => { /* offline: no problem */ });
}

// ---------- Messages from the windows ----------
// Every request from a window is checked: it must come from one of the app's own pages
const handle = (name, fn) => ipcMain.handle(name, (e, ...args) => fromApp(e) ? fn(e, ...args) : undefined);
handle("settings:get", () => publicSettings());
handle("settings:set", (e, patch) => {
  if (!patch || typeof patch !== "object") return publicSettings();
  const allowed = Object.keys(DEFAULTS).filter((k) => !["installId", "feedbackAskedV2", "lastLocation"].includes(k));
  for (const k of Object.keys(patch || {})) {
    if (!allowed.includes(k)) continue;
    const v = patch[k], d = DEFAULTS[k];
    if (k === "shareFeedback") { if (v === true || v === false) settings[k] = v; continue; }   // only a real yes or no
    if (d !== null && typeof v !== typeof d) continue;                                          // wrong kind of value: ignore
    if (typeof v === "string" && v.length > 300) continue;
    if (k === "shotsFolder" && /^(\\\\|\/\/)/.test(v)) continue;   // no network paths (\\server\share): Windows would try to sign in to them
    settings[k] = v;
  }
  saveSettings();
  if ("hotkey" in patch) registerHotkey();
  if ("hud" in patch || "hudCorner" in patch) updateHud();
  if ("startWithWindows" in patch) app.setLoginItemSettings({ openAtLogin: !!settings.startWithWindows });
  if ("uexToken" in patch) cache.clear();
  if (patch.shareFeedback === true) sendFeedback();
  broadcast();
  return publicSettings();
});
handle("uex", (e, endpoint, params, ttl) => uex(endpoint, params, ttl));
// Links only open if they go to one of these sites (so nothing can make the app open anything else)
const LINK_HOSTS = ["paralaxverse.com", "uexcorp.space", "robertsspaceindustries.com", "github.com"];
handle("open", (e, url) => {
  try { const u = new URL(url); if (u.protocol === "https:" && LINK_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith("." + h))) shell.openExternal(u.href); } catch (er) { /* not a link */ }
});
// Only ever opens a FOLDER (never a file), so a mistyped path can't run a program
handle("openFolder", () => { try { if (fs.statSync(settings.shotsFolder).isDirectory()) return shell.openPath(settings.shotsFolder); } catch (e) { /* not there */ } return "not found"; });
handle("panel:hide", () => togglePanel(false));
handle("panel:pauseHotkey", (e, on) => { hookPaused = !!on; if (on) globalShortcut.unregisterAll(); else registerHotkey(); });  // while picking a new hotkey

// ---------- Start ----------
// Safety net: if something unexpected goes wrong in a background job, note it and carry on,
// instead of showing a scary "JavaScript error" box over the game.
process.on("uncaughtException", (e) => console.error("Companion problem (carried on):", e));
process.on("unhandledRejection", (e) => console.error("Companion problem (carried on):", e));
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.exit(0);   // already running: this second copy stops straight away and does nothing else
if (process.platform === "win32") app.setAppUserModelId("com.paralaxverse.companion");   // so Windows notifications show our name
app.on("second-instance", () => togglePanel(true));
// Linux: see-through windows need this switch, and the desktop needs a moment before they're made
if (process.platform === "linux") { app.commandLine.appendSwitch("enable-transparent-visuals"); app.disableHardwareAcceleration(); }
const ready = () => process.platform === "linux" ? new Promise((r) => setTimeout(r, 400)) : Promise.resolve();
if (firstCopy) app.whenReady().then(ready).then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));   // never camera, mic, location...
  loadSettings();
  createPanel(); createHud(); createTray(); startKeyListener(); registerHotkey(); watchClipboard(); watchGame();
  sendFeedback(); setInterval(sendFeedback, 6 * 3600e3);
  checkUpdate(); setInterval(checkUpdate, 6 * 3600e3);
  togglePanel(true);  // show it once at start, so people know it's running
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", (e) => e.preventDefault());  // keep running in the tray
