/* The light strip: shows the light at your chosen place, and glows when golden hour is close. */
(function () {
  const api = window.pv, DN = window.DN;
  let s = null;
  const inText = (d) => { const m = Math.max(0, Math.round((d - Date.now()) / 6e4)); return m < 1 ? "now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const set = (id, html) => { document.getElementById(id).innerHTML = html; };
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function draw() {
    if (!s || document.getElementById("hud").classList.contains("loc") && Date.now() - ((s.lastLocation && s.lastLocation.at) || 0) < 5500) return;
    const place = DN.findPlace(s.place, s.body), hud = document.getElementById("hud");
    hud.className = "hud";
    hud.dataset.side = (s.hudCorner || "top-right").includes("left") ? "left" : "right";  // which screen edge it sits against
    if (!place) { set("k", "Paralax Verse"); set("v", `Pick a place · <em>${esc(s.hotkey)}</em>`); return; }
    const x = DN.sunAt(place);
    set("k", `${esc(place[0])} · ${esc(place[1])}`);
    if (!x) { set("v", "No day and night here"); return; }
    if (x.golden) { hud.classList.add("gold"); set("v", `<em>Golden hour</em> · now`); return; }
    if (x.nextGolden) {
      const mins = (x.nextGolden - Date.now()) / 6e4;
      if (mins <= (s.alertMins || 0)) hud.classList.add("soon");
      set("v", `${esc(x.status.replace(/ golden hour/i, ""))} · gold <em>${inText(x.nextGolden)}</em>`);
    } else set("v", esc(x.status));
  }
  // /showlocation picked up: show where for a few seconds, then back to the light
  let flash = 0;
  if (api.onLocated) api.onLocated((r) => {
    clearTimeout(flash); const hud = document.getElementById("hud");
    hud.className = "hud loc"; set("k", "📍 Location updated"); set("v", esc(r.text));
    flash = setTimeout(draw, 6000);
  });
  api.getSettings().then((v) => { s = v; draw(); });
  api.onSettings((v) => { s = v; draw(); });
  setInterval(draw, 15000);
})();
