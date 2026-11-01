/* Paralax Verse Companion: working out where you are from Star Citizen's /showlocation.
   In the game, typing /showlocation in chat copies a line like
     "Coordinates: x:12850441293.53 y:-825843.20 z:565661.08"
   to the clipboard. Those are metres from the centre of the star system.
   We find the nearest planet, moon or station, and on a planet's surface we take its spin into account
   (planets turn, the numbers don't) to find the nearest landing zone or outpost.
   Plain script: everything is on window.LOC. Uses window.GEO (positions) and window.DN (places). */
(function () {
  const G = window.GEO.GEO, STATIONS = window.GEO.STATIONS, DN = window.DN;
  const R = Math.PI / 180, START = Date.UTC(2020, 0, 1);
  const mod = (a, n) => ((a % n) + n) % n;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // Pull the three numbers out of the copied text (null if it isn't a /showlocation line)
  function parse(text) {
    const m = /Coordinates:\s*x:\s*(-?[\d.]+)\s*y:\s*(-?[\d.]+)\s*z:\s*(-?[\d.]+)/i.exec(String(text || ""));
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  // How far a planet has turned at time t (degrees). Matches the website's day/night maths,
  // and was checked against a real /showlocation taken at Lorville.
  function spin(b, t) { return b[6] ? mod((t - START) / 36e5 / b[6] * 360 + b[7] + 90, 360) : 0; }

  // Latitude and longitude on a planet or moon (longitude the same way the website's places list uses it)
  function latLon(b, p, t) {
    const x = p[0] - b[2], y = p[1] - b[3], z = p[2] - b[4];
    return { lat: Math.atan2(z, Math.hypot(x, y)) / R, lon: mod(Math.atan2(y, x) / R - spin(b, t), 360), alt: Math.hypot(x, y, z) - b[5] };
  }
  // Distance across the surface between two lat/lon points (km)
  function surfaceKm(r, a, b) {
    const d = Math.sin(a.lat * R) * Math.sin(b[2] * R) + Math.cos(a.lat * R) * Math.cos(b[2] * R) * Math.cos((a.lon - b[3]) * R);
    return r * Math.acos(Math.max(-1, Math.min(1, d)));
  }

  /* The main job. xyz in metres (as copied), t = when it was copied (ms).
     Returns { system, body, place, kind, text, km } where kind is "station", "surface", "orbit" or "space". */
  function locate(xyz, t) {
    const p = xyz.map((v) => v / 1000);  // to km
    // 1. Space stations (their own position, whatever's nearby)
    let best = null;
    for (const [name, parent, x, y, z] of STATIONS) {
      const c = G[parent]; if (!c) continue;
      const pos = [c[2] + x, c[3] + y, c[4] + z], d = dist(p, pos);
      if (d < 60 && (!best || d < best.d)) best = { name, parent, d, sys: c[0] };
    }
    if (best) {
      const host = G[best.parent][1] === "L" ? G[best.parent][8] : best.parent;
      return { system: best.sys, body: host, place: "", kind: "station", km: best.d, text: `At ${best.name}` + (G[best.parent][1] === "L" ? ` (${best.parent})` : "") };
    }
    // 2. Planets and moons: you're "at" one if you're within 3 of its radius from its middle
    let body = null;
    for (const [name, b] of Object.entries(G)) {
      if (b[1] === "L") continue;
      const d = dist(p, [b[2], b[3], b[4]]);
      if (d < b[5] * 3 && (!body || d - b[5] < body.alt)) body = { name, b, alt: d - b[5] };
    }
    if (body) {
      const { name, b } = body, ll = latLon(b, p, t);
      // the nearest listed place on the ground below you
      const near = (DN.PLACES || []).filter((x) => x[1] === name).map((x) => ({ x, km: surfaceKm(b[5], ll, x) })).sort((a, c) => a.km - c.km)[0];
      if (ll.alt < 15) {
        // on (or just above) the ground
        if (near) return { system: b[0], body: name, place: near.x[0], kind: "surface", km: near.km, lat: ll.lat, lon: ll.lon,
          text: near.km < 15 ? `At ${near.x[0]}, ${name}` : `${Math.round(near.km)} km from ${near.x[0]}, ${name}` };
        return { system: b[0], body: name, place: "", kind: "surface", km: 0, text: `On ${name}` };
      }
      // higher up: in the air or in orbit. The light tab still follows the place below you.
      return { system: b[0], body: name, place: near ? near.x[0] : "", kind: "orbit", km: ll.alt, text: `Above ${name}, ${Math.round(ll.alt)} km up` + (near ? ` (over ${near.x[0]})` : "") };
    }
    // 3. Deep space: the nearest of anything, so at least the system and area are right
    let near = null;
    for (const [name, b] of Object.entries(G)) {
      const d = dist(p, [b[2], b[3], b[4]]);
      if (!near || d < near.d) near = { name, b, d };
    }
    if (!near || near.d > 5e7) return null;  // too far from anything we know (Nyx isn't mapped yet)
    const host = near.b[1] === "L" ? near.b[8] : near.name;
    return { system: near.b[0], body: G[host] ? host : near.name, place: "", kind: "space", km: near.d,
      text: `In space, ${Math.round(near.d).toLocaleString("en-GB")} km from ${near.name}` };
  }

  window.LOC = { parse, locate };
})();
