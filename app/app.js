/* Paralax Verse Companion: the panel.
   Five tabs: Light (golden hour where you are), Spots (scenic spots on this planet or moon, from paralaxverse.com),
   Trade (where to buy and sell, from UEX), Photo (photo mode keys) and Settings.
   Same pattern as the website: state -> render() -> HTML. All text from outside is escaped with esc(). */
(function () {
  const SUPABASE_URL = "https://hiqbxmvhqaqhpyixmvqx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_xEpHsvE-JsCbfoIR60M-zg_69nM8kr4";  // the public website key: read-only by design
  const SITE = "https://paralaxverse.com";
  const DN = window.DN;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = window.pv || {  // when opened outside the app (for testing), a stand-in that does nothing
    getSettings: async () => ({ hotkey: "Control+Shift+P", hud: true, hudCorner: "top-right", system: "Stanton", body: "Hurston", place: "Lorville", alertMins: 5, uexToken: "", hotkeyOk: true, version: "dev" }),
    setSettings: async (p) => Object.assign(state.settings, p), uex: async () => ({ error: "no-token" }), open: async (u) => window.open(u), openFolder: async () => {}, hide: async () => {}, pauseHotkey: async () => {}, onSettings: () => {}, onShown: () => {}
  };

  const state = { tab: "light", settings: null, spots: {}, comms: null, commQ: "", comm: null, prices: {}, err: "", recording: false, check: "" };

  /* ---------- helpers ---------- */
  const systems = () => [...new Set(Object.values(DN.BODIES).map((b) => b[0]))];
  const bodiesIn = (sys) => Object.keys(DN.BODIES).filter((n) => DN.BODIES[n][0] === sys && DN.BODIES[n][1]);
  const placesOn = (body) => DN.PLACES.filter((p) => p[1] === body);
  const pad = (n) => String(n).padStart(2, "0");
  const timeText = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const inText = (d) => { const m = Math.max(0, Math.round((d - Date.now()) / 6e4)); return m < 1 ? "now" : m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60} min`; };
  const clockText = (h) => `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`;
  const ago = (s) => { if (!s) return ""; const t = typeof s === "number" ? s * 1000 : Date.parse(s); const m = Math.round((Date.now() - t) / 6e4); return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const money = (n) => Math.round(Number(n)).toLocaleString("en-GB");
  const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };

  /* ---------- LIGHT: golden hour where you are ---------- */
  function viewLight() {
    const s = state.settings, place = DN.findPlace(s.place, s.body) || placesOn(s.body)[0];
    let h = `<div class="scene">Light · ${esc(s.system)}</div>`;
    // where /showlocation last put you (or how to use it)
    const L = s.lastLocation;
    h += s.autoLocation === false ? "" : L ? `<div class="loc"><b>📍 ${esc(L.text)}</b><span>From /showlocation · ${ago(Math.round(L.at / 1000))}</span></div>`
      : `<div class="loc hint-loc"><b>📍 Set your place automatically</b><span>In game, type <code>/showlocation</code> in chat. The companion picks it up from there.</span></div>`;
    h += `<div class="row"><select class="in" id="l-sys" aria-label="System">${systems().map((x) => `<option${x === s.system ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>` +
      `<select class="in" id="l-body" aria-label="Planet or moon">${bodiesIn(s.system).map((x) => `<option${x === s.body ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`;
    h += `<label class="f"><span>Place</span><select class="in" id="l-place">${placesOn(s.body).map((p) => `<option${place && p[0] === place[0] ? " selected" : ""}>${esc(p[0])}</option>`).join("")}</select></label>`;
    if (!place) return h + `<p class="empty">No places listed on ${esc(s.body)} yet.</p>`;
    const x = DN.sunAt(place);
    if (!x) return h + `<p class="empty">${esc(s.body)} doesn't spin, so the light never changes there.</p>`;
    const cls = x.golden ? "gold" : /Night/.test(x.status) ? "night" : "";
    h += `<div class="now ${cls}"><div class="sub">${esc(place[0])} · right now</div><div class="st">${esc(x.status)}</div><div class="clk">Local time ${clockText(x.clock)} · a day here lasts ${Math.round(x.dayHours * 60)} min</div>` +
      (x.golden ? `<div class="big">Golden hour now. Go!</div>` : x.nextGolden ? `<div class="big">Golden hour ${inText(x.nextGolden)}</div>` : "") +
      `<div class="bar"><i style="left:${(x.clock / 24 * 100).toFixed(1)}%"></i></div></div>`;
    h += `<div class="scene">Coming up</div><div class="evs">${x.events.map((e) => `<div class="ev"><b>${esc(e.label)}</b><span>${timeText(e.at)}<br><em>${inText(e.at)}</em></span></div>`).join("")}</div>`;
    h += `<p class="hint" style="margin-top:10px">Times are on your PC's clock. The light strip in the corner of your screen watches this place for you${s.hud ? "" : " (it's off: switch it on in Settings)"}.</p>`;
    return h;
  }

  /* ---------- SPOTS: scenic spots here, from paralaxverse.com ---------- */
  async function loadSpots(body) {
    if (state.spots[body] && state.spots[body] !== "err") return;
    state.spots[body] = "loading"; render();
    try {
      const q = `select=id,name,place,light,shot,tip,thumb_path,photo_path,fankit,profiles!spots_user_id_fkey(callsign)&status=eq.approved&body=eq.${encodeURIComponent(body)}&order=created_at.desc&limit=40`;
      const res = await fetch(`${SUPABASE_URL}/rest/v1/spots?${q}`, { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      state.spots[body] = await res.json();
    } catch (e) { console.error(e); state.spots[body] = "err"; }
    render();
  }
  const imgUrl = (p) => !p ? "" : p[0] === "/" ? SITE + p : `${SUPABASE_URL}/storage/v1/object/public/shots/${p}`;
  function viewSpots() {
    const s = state.settings, list = state.spots[s.body];
    let h = `<div class="scene">Spots on ${esc(s.body)}</div>`;
    h += `<div class="row"><select class="in" id="l-sys" aria-label="System">${systems().map((x) => `<option${x === s.system ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>` +
      `<select class="in" id="l-body" aria-label="Planet or moon">${bodiesIn(s.system).map((x) => `<option${x === s.body ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></div><div style="height:10px"></div>`;
    if (list === undefined) { loadSpots(s.body); return h; }
    if (list === "loading") return h + `<p class="p"><span class="spin"></span>Finding spots…</p>`;
    if (list === "err") return h + `<p class="err">Couldn't reach Paralax Verse. Check your connection.</p>`;
    if (!list.length) return h + `<p class="empty">No spots on ${esc(s.body)} yet. Found a good one? <button class="link" data-open="${SITE}/add">Post it on Paralax Verse</button>.</p>`;
    h += list.map((sp) => `<button class="spot${sp.fankit ? " fk" : ""}" data-open="${SITE}/s/${esc(sp.id)}"><img src="${esc(imgUrl(sp.thumb_path || sp.photo_path))}" alt="" loading="lazy">` +
      `<span class="t"><small>${esc([sp.place, sp.light, sp.shot].filter(Boolean).join(" · "))}</small><b>${esc(sp.name)}</b>${sp.tip ? `<span class="tip">${esc(sp.tip.length > 110 ? sp.tip.slice(0, 108) + "…" : sp.tip)}</span>` : ""}</span></button>`).join("");
    return h + `<p class="hint">Tap a spot to open it on paralaxverse.com.</p>`;
  }

  /* ---------- TRADE: where to buy and sell, from UEX ---------- */
  async function loadCommodities() {
    if (state.comms && state.comms !== "err") return;
    state.comms = "loading"; render();
    const r = await api.uex("commodities", {}, 24 * 60);
    state.comms = r.error ? { error: r.error } : (r.data || []);
    render();
  }
  async function loadPrices(id) {
    if (state.prices[id] && !state.prices[id].error) return;
    state.prices[id] = "loading"; render();
    const r = await api.uex("commodities_prices", { id_commodity: id }, 10);
    state.prices[id] = r.error ? { error: r.error } : (r.data || []);
    render();
  }
  function where(r) {
    const parts = [pick(r, "terminal_name", "terminal_nickname"), pick(r, "space_station_name", "outpost_name", "city_name"), pick(r, "moon_name", "planet_name", "orbit_name"), pick(r, "star_system_name")];
    return [...new Set(parts.filter(Boolean))];
  }
  function tradeError(e) {
    if (e === "no-token") return `<div class="empty"><b>Add your free UEX key to see prices.</b><br>1. Sign in at uexcorp.space<br>2. Open <b>API</b> → <b>My Apps</b> and create an app<br>3. Copy its key into <b>Settings</b> here.<br><br><button class="ghost" data-open="https://uexcorp.space/api/apps">Open UEX</button> <button class="ghost" data-tab="settings">Settings</button></div>`;
    if (e === "offline") return `<p class="err">Can't reach UEX right now. Check your connection.</p>`;
    if (e === "requests_limit_reached") return `<p class="err">UEX says we've asked too often. Give it a minute.</p>`;
    return `<p class="err">UEX said: ${esc(e)}. If this keeps happening, check your key in Settings.</p>`;
  }
  function viewTrade() {
    let h = `<div class="scene">Trade · data from UEX</div>`;
    const c = state.comms;
    if (c === null || c === undefined) { loadCommodities(); return h + `<p class="p"><span class="spin"></span>Loading…</p>`; }
    if (c === "loading") return h + `<p class="p"><span class="spin"></span>Loading commodities…</p>`;
    if (c.error) return h + tradeError(c.error);
    if (state.comm) {
      const cm = c.find((x) => x.id === state.comm) || {}, pr = state.prices[state.comm];
      h += `<button class="link" data-act="back">‹ All commodities</button><h1>${esc(cm.name)}</h1><div class="sub">${esc(cm.kind || "")}${cm.is_illegal ? ` <span class="tag">Illegal</span>` : ""}</div>`;
      if (!pr || pr === "loading") { if (!pr) loadPrices(state.comm); return h + `<p class="p"><span class="spin"></span>Finding prices…</p>`; }
      if (pr.error) return h + tradeError(pr.error);
      const buy = pr.filter((r) => Number(r.price_buy) > 0).sort((a, b) => a.price_buy - b.price_buy).slice(0, 6);
      const sell = pr.filter((r) => Number(r.price_sell) > 0).sort((a, b) => b.price_sell - a.price_sell).slice(0, 6);
      const row = (r, k) => { const w = where(r), stock = k === "buy" ? pick(r, "scu_buy") : pick(r, "scu_sell_stock", "scu_sell");
        return `<div class="li"><span class="n"><b>${esc(w[0] || "Terminal")}</b><small>${esc(w.slice(1).join(" · "))}${stock ? ` · ${money(stock)} SCU` : ""}${pick(r, "date_modified") ? ` · ${ago(pick(r, "date_modified"))}` : ""}</small></span><span class="v${k === "sell" ? " sell" : ""}">${money(k === "buy" ? r.price_buy : r.price_sell)}<small>aUEC/SCU</small></span></div>`; };
      h += `<div class="scene">Cheapest to buy</div><div class="list">${buy.length ? buy.map((r) => row(r, "buy")).join("") : `<p class="hint">Nowhere sells this right now.</p>`}</div>`;
      h += `<div class="scene">Best to sell</div><div class="list">${sell.length ? sell.map((r) => row(r, "sell")).join("") : `<p class="hint">Nowhere buys this right now.</p>`}</div>`;
      if (buy[0] && sell[0]) h += `<div class="now gold" style="margin-top:12px"><div class="sub">Best margin</div><div class="st">${money(sell[0].price_sell - buy[0].price_buy)} <small style="font-size:14px">aUEC per SCU</small></div><div class="clk">Buy at ${esc(where(buy[0])[0] || "")}, sell at ${esc(where(sell[0])[0] || "")}</div></div>`;
      return h + `<p class="credit">Prices reported by players on <a href="#" data-open="https://uexcorp.space">UEX</a>. They can be out of date: check the terminal.</p>`;
    }
    h += `<input class="in" id="t-q" type="search" placeholder="Search: Quantanium, Laranite, Medical supplies…" value="${esc(state.commQ)}" autocomplete="off">`;
    const q = state.commQ.trim().toLowerCase();
    const list = c.filter((x) => !q || String(x.name).toLowerCase().includes(q) || String(x.code || "").toLowerCase() === q).slice(0, q ? 40 : 25);
    h += `<div class="list" style="margin-top:6px">${list.map((x) => `<button class="li" data-comm="${esc(x.id)}"><span class="n"><b>${esc(x.name)}${x.is_illegal ? `<span class="tag">Illegal</span>` : ""}</b><small>${esc([x.code, x.kind].filter(Boolean).join(" · "))}</small></span><span class="v">›</span></button>`).join("")}</div>`;
    if (!list.length) h += `<p class="hint">Nothing called that.</p>`;
    return h + `<p class="credit">Data from <a href="#" data-open="https://uexcorp.space">UEX</a> · reported by players</p>`;
  }

  /* ---------- PHOTO: photo mode keys ---------- */
  function viewPhoto() {
    const keys = [
      ["Print Scr", "<b>Take a screenshot.</b> It's saved in your Star Citizen folder, under ScreenShots."],
      ["F4", "<b>Camera views.</b> Third person on foot, and cycles the camera views in your ship."],
      ["Hold F4 / Z", "<b>Line up the shot.</b> Hold it and move the mouse to swing the camera round."],
      ["Num + / −", "<b>Zoom</b> while you're swinging the camera."],
      ["Home / End", "<b>Depth of field.</b> Blur the background or the foreground."]
    ];
    let h = `<div class="scene">Photo mode</div><div class="keys">${keys.map(([k, t]) => `<div class="key"><kbd>${esc(k)}</kbd><p>${t}</p></div>`).join("")}</div>`;
    h += `<div class="scene">Tips</div><p class="p">Shoot in golden hour (check the Light tab), keep the sun behind or beside you, and put something in the foreground: a ship, a rock, a pilot.</p>`;
    h += `<div class="row" style="margin-top:12px"><button class="ghost" data-act="folder">Open screenshots</button><button class="btn" data-open="${SITE}/add">Post a spot</button></div>`;
    return h + `<p class="hint" style="margin-top:8px">Screenshots folder can be changed in Settings if yours is somewhere else.</p>`;
  }

  /* ---------- SETTINGS ---------- */
  function viewSettings() {
    const s = state.settings;
    let h = `<div class="scene">Hotkey</div><div class="row"><span class="hk${state.recording ? " rec" : ""}">${state.recording ? "Press your keys…" : esc(s.hotkey.replace(/\+/g, " + "))}</span><button class="ghost" data-act="rec" style="flex:0 0 auto">${state.recording ? "Cancel" : "Change"}</button></div>` +
      (s.hotkeyOk ? `<p class="hint">Press it in game to show or hide this panel. Pick keys Star Citizen doesn't use.</p>` : `<p class="err">That hotkey is already used by something else. Pick another.</p>`);
    h += `<div class="scene">Light strip</div><div class="chips"><button class="chip" data-hud="1" aria-pressed="${!!s.hud}">On</button><button class="chip" data-hud="0" aria-pressed="${!s.hud}">Off</button></div>` +
      `<label class="f"><span>Corner</span><select class="in" id="s-corner">${["top-right", "top-left", "bottom-right", "bottom-left"].map((c) => `<option value="${c}"${s.hudCorner === c ? " selected" : ""}>${c.replace("-", " ")}</option>`).join("")}</select></label>` +
      `<label class="f"><span>Warn me before golden hour (minutes)</span><input class="in" id="s-alert" type="number" min="0" max="60" value="${esc(s.alertMins)}"></label>`;
    // how much of the game shows through the panel
    h += `<div class="scene">See-through</div><div class="chips veil">${[["light", "More game"], ["medium", "Balanced"], ["dark", "Easier to read"]].map(([k, l]) => `<button class="chip" data-veil="${k}" aria-pressed="${(s.veil || "medium") === k}">${l}</button>`).join("")}</div>`;
    h += `<div class="scene">Trade data (UEX)</div><label class="f"><span>Your UEX app key</span><input class="in" id="s-uex" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your key from uexcorp.space" value="${esc(s.uexToken)}"></label>` +
      `<div class="row"><button class="ghost" data-act="saveUex">Save key</button><button class="ghost" data-act="checkUex">Check connection</button></div>${state.check ? `<p class="hint">${esc(state.check)}</p>` : ""}` +
      `<p class="hint">Free from uexcorp.space → API → My Apps. It stays on this PC.</p>`;
    h += `<div class="scene">Auto location</div><div class="chips"><button class="chip" data-autoloc="1" aria-pressed="${s.autoLocation !== false}">On</button><button class="chip" data-autoloc="0" aria-pressed="${s.autoLocation === false}">Off</button></div>` +
      `<p class="hint">Type <code>/showlocation</code> in Star Citizen's chat and the companion switches to where you are. It only looks for that line on your clipboard and ignores everything else.</p>`;
    h += `<div class="scene">Other</div><label class="f"><span>Screenshots folder</span><input class="in" id="s-shots" value="${esc(s.shotsFolder)}" spellcheck="false"></label>` +
      `<div class="chips"><button class="chip" data-start="1" aria-pressed="${!!s.startWithWindows}">Start with Windows</button></div>`;
    h += `<div class="scene">Good to know</div><p class="hint">Run Star Citizen in <b>Borderless</b> window mode, or the companion can't appear over it. This app never touches the game: it only draws its own window on top. Unofficial fan project, not affiliated with Cloud Imperium Games.</p>`;
    return h;
  }

  /* ---------- drawing ---------- */
  const TABS = [["light", "Light"], ["spots", "Spots"], ["trade", "Trade"], ["photo", "Photo"], ["settings", "Settings"]];
  function render() {
    if (!state.settings) return;
    document.body.dataset.veil = state.settings.veil || "medium";  // see-through level
    $("#tabs").innerHTML = TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}</button>`).join("");
    const keepQ = document.activeElement && document.activeElement.id === "t-q" ? document.activeElement.selectionStart : null;
    const v = { light: viewLight, spots: viewSpots, trade: viewTrade, photo: viewPhoto, settings: viewSettings }[state.tab];
    $("#view").innerHTML = v();
    if (keepQ !== null) { const i = $("#t-q"); if (i) { i.focus(); i.setSelectionRange(keepQ, keepQ); } }
    $("#foot").innerHTML = `<span>Hotkey <b>${esc(state.settings.hotkey.replace(/\+/g, " + "))}</b></span><span>v${esc(state.settings.version || "")} · Unofficial fan app</span>`;
  }

  /* ---------- taps and typing ---------- */
  document.addEventListener("click", async (e) => {
    const t = e.target.closest("button, a"); if (!t) return;
    if (t.tagName === "A") e.preventDefault();
    const s = state.settings;
    if (t.id === "close") return api.hide();
    if (t.dataset.tab) { state.tab = t.dataset.tab; state.err = ""; render(); return; }
    if (t.dataset.open) return api.open(t.dataset.open);
    if (t.dataset.comm) { state.comm = Number(t.dataset.comm) || t.dataset.comm; render(); $("#view").scrollTop = 0; return; }
    if (t.dataset.hud) { await save({ hud: t.dataset.hud === "1" }); return; }
    if (t.dataset.veil) { await save({ veil: t.dataset.veil }); return; }
    if (t.dataset.autoloc) { await save({ autoLocation: t.dataset.autoloc === "1" }); return; }
    if (t.dataset.start) { await save({ startWithWindows: !s.startWithWindows }); return; }
    switch (t.dataset.act) {
      case "back": state.comm = null; render(); break;
      case "folder": api.openFolder(); break;
      case "rec": state.recording = !state.recording; api.pauseHotkey(state.recording); render(); break;
      case "saveUex": { await save({ uexToken: $("#s-uex").value.trim() }); state.comms = null; state.prices = {}; state.check = "Key saved."; render(); break; }
      case "checkUex": {
        await save({ uexToken: $("#s-uex").value.trim() }); state.comms = null; state.prices = {};
        state.check = "Checking…"; render();
        const r = await api.uex("commodities", {}, 0);
        state.check = r.error ? (r.error === "no-token" ? "Add your key first." : "Didn't work: " + r.error) : `Connected. UEX lists ${(r.data || []).length} commodities.`;
        render(); break;
      }
    }
  });
  document.addEventListener("change", async (e) => {
    const id = e.target.id, v = e.target.value;
    if (id === "l-sys") { const b = bodiesIn(v)[0]; const p = placesOn(b)[0]; await save({ system: v, body: b, place: p ? p[0] : "" }); }
    if (id === "l-body") { const p = placesOn(v)[0]; await save({ body: v, place: p ? p[0] : "" }); }
    if (id === "l-place") await save({ place: v });
    if (id === "s-corner") await save({ hudCorner: v });
    if (id === "s-alert") await save({ alertMins: Math.max(0, Math.min(60, Number(v) || 0)) });
    if (id === "s-shots") await save({ shotsFolder: v.trim() });
  });
  document.addEventListener("input", (e) => { if (e.target.id === "t-q") { state.commQ = e.target.value; render(); } });
  // Recording a new hotkey: the next key press (with any Ctrl / Alt / Shift) becomes the hotkey.
  document.addEventListener("keydown", async (e) => {
    if (state.recording) {
      e.preventDefault();
      const mods = ["Control", "Alt", "Shift", "Meta"];
      if (mods.includes(e.key)) return;  // wait for the main key
      const name = e.key === " " ? "Space" : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : { Escape: null, ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Insert: "Insert", Delete: "Delete", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown" }[e.key];
      state.recording = false;
      if (!name) { api.pauseHotkey(false); render(); return; }   // Escape cancels
      const acc = [e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift", name].filter(Boolean).join("+");
      await save({ hotkey: acc });
      return;
    }
    if (e.key === "Escape") api.hide();
  });
  async function save(patch) { state.settings = await api.setSettings(patch); render(); }

  /* ---------- start ---------- */
  api.onSettings((s) => { state.settings = { ...state.settings, ...s }; render(); });
  // each time the panel opens: redraw, and swing it out from the screen edge
  api.onShown(() => { render(); const p = $("#panel"); p.classList.remove("open"); void p.offsetWidth; p.classList.add("open"); });
  api.getSettings().then((s) => { state.settings = s; render(); });
  // /showlocation picked up: jump to the Light tab so you see where it put you
  if (api.onLocated) api.onLocated(() => { state.tab = "light"; render(); });
  setInterval(() => { if (state.tab === "light" && !document.hidden) render(); }, 20000);  // keep the countdowns fresh
})();
