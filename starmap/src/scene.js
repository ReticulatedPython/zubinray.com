/* ------------------------------------------------------------------ scene --
   Catalogue preparation, the stereographic camera, and every drawn layer.
---------------------------------------------------------------------------- */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

/* --------------------------------------------------------------- colours -- */
/* B-V colour index -> approximate blackbody RGB. */
function bvToRgb(bv) {
  const b = clamp(bv, -0.4, 2.0);
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const x = clamp(t, 1000, 40000) / 100;
  let r, g, bl;
  if (x <= 66) { r = 255; g = 99.47 * Math.log(x) - 161.12; }
  else { r = 329.7 * Math.pow(x - 60, -0.1332); g = 288.12 * Math.pow(x - 60, -0.0755); }
  if (x >= 66) bl = 255;
  else if (x <= 19) bl = 0;
  else bl = 138.52 * Math.log(x - 10) - 305.04;
  // pull towards white: stars only show strong colour when very bright
  const mix = 0.62;
  r = lerp(255, clamp(r, 0, 255), mix);
  g = lerp(255, clamp(g, 0, 255), mix);
  bl = lerp(255, clamp(bl, 0, 255), mix);
  return [Math.round(r), Math.round(g), Math.round(bl)];
}

/* ------------------------------------------------------------------ prep -- */
const SKY = {
  n: 0,
  vec: null,      // Float32Array 3n, J2000 unit vectors
  mag: null,      // Float32Array n
  col: null,      // Uint8Array 3n
  colStr: null,   // per-star rgb string, built lazily per bucket
  keep: null,     // Uint8Array n — always draw (constellation vertices)
  labels: {},     // index -> {n,d,h,s,p}
  figures: [],    // {id, name, rank, centre:[vec], segs:[[idx,...]]}
  dso: [],        // {d,a,t,m,s,ra,dec,vec}
  index: [],      // search index
};

function prepareSky(data) {
  const n = data.starCount;
  SKY.n = n;
  SKY.vec = new Float32Array(n * 3);
  SKY.mag = new Float32Array(n);
  SKY.col = new Uint8Array(n * 3);
  SKY.keep = new Uint8Array(n);
  SKY.labels = data.SL;

  const S = data.S;
  const bvCache = new Map();
  for (let i = 0; i < n; i++) {
    const ra = S[i * 4] * D2R, dec = S[i * 4 + 1] * D2R;
    const cd = Math.cos(dec);
    SKY.vec[i * 3] = cd * Math.cos(ra);
    SKY.vec[i * 3 + 1] = cd * Math.sin(ra);
    SKY.vec[i * 3 + 2] = Math.sin(dec);
    SKY.mag[i] = S[i * 4 + 2];
    const key = Math.round(S[i * 4 + 3] * 10);
    let c = bvCache.get(key);
    if (!c) { c = bvToRgb(key / 10); bvCache.set(key, c); }
    SKY.col[i * 3] = c[0]; SKY.col[i * 3 + 1] = c[1]; SKY.col[i * 3 + 2] = c[2];
  }

  // Spatial hash so constellation vertices can be snapped onto real stars.
  const CELL = 2; // degrees
  const grid = new Map();
  const key = (ra, dec) => (Math.floor(ra / CELL) * 1000 + Math.floor((dec + 90) / CELL));
  for (let i = 0; i < n; i++) {
    if (SKY.mag[i] > 6.0) continue;
    const k = key(S[i * 4], S[i * 4 + 1]);
    let a = grid.get(k); if (!a) grid.set(k, a = []);
    a.push(i);
  }
  const nearestStar = (ra, dec) => {
    let best = -1, bestD = 0.25 * 0.25; // within 0.25 degrees
    const cra = Math.cos(dec * D2R);
    for (let dr = -1; dr <= 1; dr++) for (let dd = -1; dd <= 1; dd++) {
      const k = (Math.floor(ra / CELL) + dr) * 1000 + (Math.floor((dec + 90) / CELL) + dd);
      const a = grid.get(k); if (!a) continue;
      for (const i of a) {
        let dra = S[i * 4] - ra;
        if (dra > 180) dra -= 360; else if (dra < -180) dra += 360;
        const d = (dra * cra) ** 2 + (S[i * 4 + 1] - dec) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  };

  for (const c of data.C) {
    const segs = [];
    for (const seg of c.l) {
      const idx = [];
      for (const [ra, dec] of seg) {
        const i = nearestStar(ra, dec);
        // fall back to a synthetic vertex when no catalogue star is close
        idx.push(i >= 0 ? i : { v: raDecToVec(ra, dec) });
        if (i >= 0) SKY.keep[i] = 1;
      }
      if (idx.length > 1) segs.push(idx);
    }
    SKY.figures.push({
      id: c.id, name: c.n, rank: c.r,
      centre: raDecToVec(c.c[0], c.c[1]), segs,
    });
  }

  // Stars held by a constellation figure are drawn no matter how faint, so the
  // outlines always land on something.
  SKY.keepList = [];
  for (let i = 0; i < n; i++) if (SKY.keep[i]) SKY.keepList.push(i);

  for (const d of data.D) {
    SKY.dso.push(Object.assign({}, d, { vec: raDecToVec(d.ra, d.dec) }));
  }

  buildSearchIndex();
}

/* ------------------------------------------------ constellation boundaries --
   Roman (1987): scan the table in order and the first row containing the point
   names its constellation. Boundaries are defined for equinox B1875, so the
   position is precessed back before the lookup.                              */
const JD_B1875 = 2405889.25888;
let B1875 = null;

function constellationAt(raDeg, decDeg) {
  const B = SKYDATA.B;
  if (!B) return null;
  if (!B1875) B1875 = precessionMatrix(JD_B1875);
  const v = raDecToVec(raDeg, decDeg), M = B1875;
  const rd = vecToRaDec([
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ]);
  const raH = rd.ra / 15, dec = rd.dec, R = B.r;
  for (let i = 0; i < R.length; i += 4) {
    if (dec < R[i + 2]) continue;
    if (raH < R[i] || raH >= R[i + 1]) continue;
    return { abbr: B.a[R[i + 3]], name: B.n[R[i + 3]] };
  }
  return null;
}
/* Same, for a J2000 direction vector. */
function constellationOfVec(v) {
  const rd = vecToRaDec(v);
  return constellationAt(rd.ra, rd.dec);
}

function buildSearchIndex() {
  const idx = [];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const push = (name, sub, kind, ref, sort) =>
    idx.push({ name, sub, kind, ref, sort, key: norm(name), key2: norm(sub || '') });

  for (const p of Object.keys(SOLAR)) push(p, SOLAR[p].kind, 'solar', p, SOLAR[p].order);
  for (const k in SKY.labels) {
    const L = SKY.labels[k], i = +k;
    const m = SKY.mag[i];
    if (L.n) push(L.n, L.d ? L.d + (L.s ? ' · ' + L.s : '') : '', 'star', i, m);
    else if (L.d) push(L.d, '', 'star', i, m + 10);
  }
  for (let i = 0; i < SKY.dso.length; i++) {
    const d = SKY.dso[i];
    const label = d.a ? d.a : d.d;
    const sub = d.a ? d.d + (d.id2 ? ' · ' + d.id2 : '') + ' · ' + d.t
                    : (d.id2 ? d.id2 + ' · ' : '') + d.t;
    push(label, sub, 'dso', i, d.m + (d.a ? -3 : 0));
    if (d.a) push(d.d, d.a + ' · ' + d.t, 'dso', i, d.m - 2);
    if (d.id2) push(d.id2, label + ' · ' + d.t, 'dso', i, d.m + 1);
  }
  for (let i = 0; i < SKY.figures.length; i++) {
    const f = SKY.figures[i];
    push(f.name, 'constellation', 'con', i, f.rank * 2 + 1);
  }
  SKY.index = idx;
}

function searchSky(query, limit = 40) {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!q) return [];
  const out = [];
  for (const e of SKY.index) {
    let score;
    if (e.key === q) score = 0;
    else if (e.key.startsWith(q)) score = 1;
    else if (e.key2 && e.key2.startsWith(q)) score = 2;
    else if (e.key.includes(q)) score = 3;
    else if (e.key2 && e.key2.includes(q)) score = 4;
    else continue;
    out.push({ e, score: score * 100 + e.sort });
  }
  // satellites are propagated live, so they are matched separately
  const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const s of SATS.list) {
    const k = flat(s.name), k2 = flat(s.shortName), k3 = flat(s.alias || '');
    if (!k.includes(q) && !k2.includes(q) && !(k3 && k3.includes(q))) continue;
    out.push({
      e: {
        name: s.shortName,
        sub: (s.name !== s.shortName ? s.name + ' · ' : '') + 'satellite · NORAD ' + s.noradId,
        kind: 'sat', ref: s.noradId,
      },
      score: (k2.startsWith(q) || k.startsWith(q) || k3.startsWith(q) ? 100 : 300)
        - (s.featured ? 60 : 0),
    });
  }
  out.sort((a, b) => a.score - b.score);
  const seen = new Set(), res = [];
  for (const o of out) {
    const id = o.e.kind + ':' + o.e.ref;
    if (seen.has(id)) continue;
    seen.add(id);
    res.push(o.e);
    if (res.length >= limit) break;
  }
  return res;
}

/* ---------------------------------------------------------------- camera -- */
const CAM = {
  M: null,        // J2000 -> camera basis (rows: right, up, forward)
  Mh: null,       // J2000 -> horizontal (north, east, zenith)
  k: 1, cx: 0, cy: 0, w: 0, h: 0,
  zenithCam: [0, 0, 1],
};

function updateCamera(jd, lat, lon, view, w, h) {
  const Mh = skyMatrix(jd, lat, lon);
  const az = view.az * D2R, alt = view.alt * D2R;
  const ca = Math.cos(alt), sa = Math.sin(alt), cz = Math.cos(az), sz = Math.sin(az);
  const R = [
    -sz, cz, 0,                       // right
    -sa * cz, -sa * sz, ca,           // up
    ca * cz, ca * sz, sa,             // forward
  ];
  const M = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let q = 0; q < 3; q++) s += R[i * 3 + q] * Mh[q * 3 + j];
      M[i * 3 + j] = s;
    }
  CAM.M = M; CAM.Mh = Mh; CAM.w = w; CAM.h = h;
  CAM.cx = w / 2; CAM.cy = h / 2;
  CAM.k = (h / 2) / (2 * Math.tan(view.fov * D2R / 4));
  CAM.lst = Mh.lst;
  // zenith expressed in camera coordinates: third column of R
  CAM.zenithCam = [R[2], R[5], R[8]];
  CAM.pxPerDeg = CAM.k * D2R;
}

/* J2000 vector -> screen. Returns null when behind the projection pole or off
   canvas. `pad` widens the accepted margin for things that draw large. */
function project(v, pad = 60) {
  const M = CAM.M;
  const Z = M[6] * v[0] + M[7] * v[1] + M[8] * v[2];
  const d = 1 + Z;
  if (d < 0.02) return null;
  const X = M[0] * v[0] + M[1] * v[1] + M[2] * v[2];
  const Y = M[3] * v[0] + M[4] * v[1] + M[5] * v[2];
  const f = 2 * CAM.k / d;
  const x = CAM.cx + f * X, y = CAM.cy - f * Y;
  if (x < -pad || y < -pad || x > CAM.w + pad || y > CAM.h + pad) return null;
  return [x, y, Z];
}
/* Same, but never rejects for being off-screen (used for label anchors). */
function projectRaw(v) {
  const M = CAM.M;
  const Z = M[6] * v[0] + M[7] * v[1] + M[8] * v[2];
  const d = 1 + Z;
  if (d < 0.02) return null;
  const X = M[0] * v[0] + M[1] * v[1] + M[2] * v[2];
  const Y = M[3] * v[0] + M[4] * v[1] + M[5] * v[2];
  const f = 2 * CAM.k / d;
  return [CAM.cx + f * X, CAM.cy - f * Y, Z];
}

/* Stereographic images of small circles are circles. For the circle
   { p : p·n = c } with n a unit normal in camera coordinates. */
function projectCircle(n, c) {
  const den = n[2] + c;
  if (Math.abs(den) < 1e-7) return null; // degenerates to a straight line
  const k2 = 2 * CAM.k;
  return {
    x: CAM.cx + k2 * n[0] / den,
    y: CAM.cy - k2 * n[1] / den,
    r: Math.abs(k2 * Math.sqrt(Math.max(0, 1 - c * c)) / den),
    inside: den > 0, // true when the forward direction lies inside the circle
  };
}

/* ------------------------------------------------------------------ draw -- */
let ctx = null, labelBoxes = [], pickables = [];

function drawFrame(env) {
  const { w, h } = env;
  ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
  labelBoxes.length = 0;
  pickables.length = 0;

  drawSkyBackground(env);
  if (APP.layers.grid) drawGrid(env);
  if (APP.layers.ecliptic) drawEcliptic(env);
  if (APP.layers.constellations) drawFigures(env);
  drawStars(env);
  if (APP.layers.dso) drawDsos(env);
  if (APP.layers.planets) drawSolarSystem(env);
  if (APP.layers.satellites) drawSatellites(env);
  if (APP.layers.ground) drawGround(env);
  drawSavedMarkers(env);
  computeNorthBadge(env);
  drawLabels(env);
  drawSelection(env);
  drawCardinals(env);
  drawNorthMarker(env);
}

/* -------------------------------------------------------------- sky wash -- */
function drawSkyBackground(env) {
  const { w, h } = env;
  const sunAlt = env.sunAlt;
  const atmos = APP.layers.atmosphere;
  const day = atmos ? clamp((sunAlt + 2) / 8, 0, 1) : 0;
  const twi = atmos ? clamp((sunAlt + 18) / 20, 0, 1) : 0;

  // zenith and horizon colours blended through night -> twilight -> day
  const night = [5, 7, 13], nightH = [10, 14, 26];
  const duskZ = [22, 34, 68], duskH = [92, 60, 74];
  const dayZ = [58, 122, 199], dayH = [166, 200, 232];
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  let zen = mix(night, duskZ, twi), hor = mix(nightH, duskH, twi);
  zen = mix(zen, dayZ, day); hor = mix(hor, dayH, day);
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;

  // altitude at the top and bottom of the screen drives a vertical gradient
  const aTop = screenAltitude(CAM.cx, 0), aBot = screenAltitude(CAM.cx, h);
  const f = (a) => clamp((a + 12) / 60, 0, 1);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(mix(hor, zen, f(aTop))));
  g.addColorStop(0.5, css(mix(hor, zen, f(screenAltitude(CAM.cx, h / 2)))));
  g.addColorStop(1, css(mix(hor, zen, f(aBot))));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  env.starAlpha = clamp(1 - twi * 1.75, 0, 1);
  env.skyDay = day;

  // glow around the Sun when it is up
  if (atmos && sunAlt > -8 && env.sunScreen) {
    const [sx, sy] = env.sunScreen;
    const rad = Math.max(w, h) * (0.35 + 0.45 * day);
    const gg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
    const a = clamp((sunAlt + 8) / 14, 0, 1);
    gg.addColorStop(0, `rgba(255,240,205,${0.75 * a})`);
    gg.addColorStop(0.25, `rgba(255,205,140,${0.30 * a})`);
    gg.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, w, h);
  }
}

/* True when a screen point falls on the ground and should stay uncluttered.
   In see-through mode the ground stops hiding anything. */
function belowGround(x, y) {
  return APP.layers.ground && !APP.seeThrough && screenAltitude(x, y) < -0.3;
}

/* Altitude of the sky direction under a screen point, degrees. */
function screenAltitude(sx, sy) {
  const X = (sx - CAM.cx) / (2 * CAM.k), Y = -(sy - CAM.cy) / (2 * CAM.k);
  const r2 = X * X + Y * Y, den = 1 + r2;
  const cam = [2 * X / den, 2 * Y / den, (1 - r2) / den];
  const z = CAM.zenithCam;
  return Math.asin(clamp(cam[0] * z[0] + cam[1] * z[1] + cam[2] * z[2], -1, 1)) * R2D;
}

/* ---------------------------------------------------------------- ground -- */
function drawGround(env) {
  const { w, h } = env;
  const n = CAM.zenithCam;
  const c = projectCircle(n, 0);
  ctx.save();
  const d = env.skyDay;
  const groundTop = d > 0.1 ? `rgb(${34 + d * 38 | 0},${40 + d * 40 | 0},${34 + d * 30 | 0})` : '#12161b';
  const groundBot = d > 0.1 ? `rgb(${12 + d * 16 | 0},${16 + d * 18 | 0},${13 + d * 12 | 0})` : '#07090c';

  ctx.beginPath();
  if (!c) {
    // Horizon degenerates to a straight line through the centre. Altitude
    // increases along (n0, -n1) in screen space, so the ground is the
    // half-plane on the other side of it.
    const mx = n[0], my = -n[1];
    const ml = Math.hypot(mx, my) || 1;
    const ux = mx / ml, uy = my / ml;         // towards the sky
    const dx = -uy, dy = ux;                  // along the horizon
    const B = (w + h) * 2;
    ctx.moveTo(CAM.cx + dx * B, CAM.cy + dy * B);
    ctx.lineTo(CAM.cx - dx * B, CAM.cy - dy * B);
    ctx.lineTo(CAM.cx - dx * B - ux * B, CAM.cy - dy * B - uy * B);
    ctx.lineTo(CAM.cx + dx * B - ux * B, CAM.cy + dy * B - uy * B);
    ctx.closePath();
  } else if (c.inside) {
    // sky is inside the circle -> ground is everything outside it
    ctx.rect(0, 0, w, h);
    ctx.arc(c.x, c.y, c.r, 0, TAU, true);
  } else {
    ctx.arc(c.x, c.y, c.r, 0, TAU);
  }
  ctx.clip('evenodd');
  // See-through mode keeps the ground readable as ground but lets everything
  // below the horizon show through it.
  if (APP.seeThrough) ctx.globalAlpha = 0.55;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, groundTop); g.addColorStop(1, groundBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.restore();

  if (c) {
    ctx.strokeStyle = env.skyDay > 0.4 ? 'rgba(255,255,255,.45)' : 'rgba(140,175,220,.65)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
  }
}

/* ------------------------------------------------------ north indicator --
   A compass mark pinned to the edge of the screen, so which way is north is
   never more than a glance away while dragging the sky around.             */
let northBadge = null;

/* Work out where the badge goes before labels are placed, so a label never
   ends up underneath it. */
function computeNorthBadge(env) {
  northBadge = null;
  const n = camDirection(0, 0);              // the north point, in camera space
  let dx = n[0], dy = -n[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return;
  dx /= l; dy /= l;

  // If the horizon's own "N" is comfortably on screen it already says this.
  const onScreen = project(camFromAltAz(0, 0), -46);
  if (onScreen && APP.layers.ground) return;

  // Inset far enough that the whole badge, arrow included, stays on screen and
  // clear of the top bar and the time bar.
  const w = CAM.w, h = CAM.h;
  const side = Math.min(52, w * 0.16);
  const t = Math.min(
    dx !== 0 ? Math.abs((w / 2 - side) / dx) : Infinity,
    dy !== 0 ? Math.abs((h / 2 - (dy > 0 ? 116 : 100)) / dy) : Infinity);
  northBadge = { x: w / 2 + dx * t, y: h / 2 + dy * t, dx, dy };
}

function drawNorthMarker(env) {
  if (!northBadge) return;
  const { x, y, dx, dy } = northBadge;
  ctx.save();
  ctx.translate(x, y);

  ctx.beginPath();
  ctx.arc(0, 0, 17, 0, TAU);
  ctx.fillStyle = 'rgba(8,12,20,.82)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.45)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // arrow sits outside the disc so it never fights with the letter
  ctx.rotate(Math.atan2(dy, dx));
  ctx.beginPath();
  ctx.moveTo(27, 0); ctx.lineTo(19, 5.4); ctx.lineTo(19, -5.4);
  ctx.closePath();
  ctx.fillStyle = '#ff6b6b';
  ctx.fill();
  ctx.rotate(-Math.atan2(dy, dx));

  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,.6)';
  ctx.strokeText('N', 0, 0.5);
  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.fillText('N', 0, 0.5);
  ctx.restore();
}

/* Cardinal letters sit on the horizon at their azimuths. */
const CARDINALS = [[0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
                   [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW']];
function drawCardinals(env) {
  if (!APP.layers.ground) return;
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [az, name] of CARDINALS) {
    const p = project(camFromAltAz(0, az), 20);
    if (!p) continue;
    const major = name.length === 1;
    ctx.font = major ? '700 15px system-ui, sans-serif' : '600 11.5px system-ui, sans-serif';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.strokeText(name, p[0], p[1] - 12);
    ctx.fillStyle = major ? 'rgba(255,255,255,.95)' : 'rgba(206,220,240,.7)';
    ctx.fillText(name, p[0], p[1] - 12);
  }
}

/* Build a J2000-frame vector from horizontal alt/az by inverting Mh. */
function camFromAltAz(alt, az) {
  const v = altAzToVec(alt, az), M = CAM.Mh;
  return [
    M[0] * v[0] + M[3] * v[1] + M[6] * v[2],
    M[1] * v[0] + M[4] * v[1] + M[7] * v[2],
    M[2] * v[0] + M[5] * v[1] + M[8] * v[2],
  ];
}

/* ------------------------------------------------------------------ grid -- */
function drawGrid(env) {
  ctx.strokeStyle = 'rgba(110,150,205,.20)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  const n = CAM.zenithCam;
  for (let alt = -60; alt <= 80; alt += 20) {
    if (alt === 0) continue;
    const c = projectCircle(n, Math.sin(alt * D2R));
    if (!c || c.r > 1e5) continue;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
  }
  // azimuth great circles: normal is horizontal, perpendicular to the azimuth
  for (let az = 0; az < 360; az += 30) {
    const nrm = camDirection(0, az + 90);
    const c = projectCircle(nrm, 0);
    if (!c || c.r > 1e5) continue;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
  }
  ctx.setLineDash([]);
}

/* Direction (alt,az) expressed in camera coordinates. */
function camDirection(alt, az) {
  const v = camFromAltAz(alt, az), M = CAM.M;
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}

function drawEcliptic(env) {
  // pole of the ecliptic in J2000 equatorial coordinates
  const eps = obliquity(2451545.0);
  const pole = [0, -Math.sin(eps), Math.cos(eps)];
  const M = CAM.M;
  const n = [
    M[0] * pole[0] + M[1] * pole[1] + M[2] * pole[2],
    M[3] * pole[0] + M[4] * pole[1] + M[5] * pole[2],
    M[6] * pole[0] + M[7] * pole[1] + M[8] * pole[2],
  ];
  const c = projectCircle(n, 0);
  if (!c || c.r > 1e6) return;
  ctx.strokeStyle = 'rgba(255,198,92,.34)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([7, 6]);
  ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke();
  ctx.setLineDash([]);
}

/* --------------------------------------------------------- constellations -- */
function drawFigures(env) {
  // Kept legible in daylight as well as at night: the floor stops the figures
  // disappearing once the sky washes out.
  const alpha = Math.max(0.32, 0.58 * env.starAlpha);
  const nameAlpha = Math.max(0.46, 0.8 * env.starAlpha);
  const majorOnly = APP.majorOnly;
  const scratch = [];
  const sunCon = env.sunCon ? env.sunCon.abbr : null;

  for (const fig of SKY.figures) {
    if (majorOnly && fig.rank > 2) continue;
    const isSun = fig.id === sunCon;
    ctx.lineWidth = isSun ? 1.9 : 1.35;
    ctx.strokeStyle = isSun
      ? `rgba(255,201,110,${Math.min(1, alpha + 0.3)})`
      : `rgba(150,190,240,${alpha})`;
    let drew = false;
    ctx.beginPath();
    for (const seg of fig.segs) {
      let prev = null;
      for (const node of seg) {
        const v = typeof node === 'number'
          ? [SKY.vec[node * 3], SKY.vec[node * 3 + 1], SKY.vec[node * 3 + 2]]
          : node.v;
        const p = projectRaw(v);
        if (!p || Math.abs(p[0]) > 2e4 || Math.abs(p[1]) > 2e4) { prev = null; continue; }
        if (prev) { ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); drew = true; }
        prev = p;
      }
    }
    if (drew) ctx.stroke();

    const p = project(fig.centre, -30);
    if (p) scratch.push({ p, fig, isSun });
  }

  for (const { p, fig, isSun } of scratch) {
    pushLabel(p[0], p[1], isSun ? fig.name.toUpperCase() + '  ☉' : fig.name.toUpperCase(), {
      priority: isSun ? -40 : 30 + fig.rank, size: isSun ? 12 : 11.5,
      weight: isSun ? 700 : 600, letterSpacing: 1.4,
      colour: isSun
        ? `rgba(255,214,140,${Math.min(1, nameAlpha + 0.25)})`
        : `rgba(176,205,245,${nameAlpha})`,
    });
  }
}

/* ----------------------------------------------------------------- stars -- */
function drawStars(env) {
  const a0 = env.starAlpha;
  if (a0 < 0.02) return;
  const limit = env.limitMag;
  const vec = SKY.vec, mag = SKY.mag, col = SKY.col, keep = SKY.keep;
  const M = CAM.M, k2 = 2 * CAM.k, cx = CAM.cx, cy = CAM.cy, w = CAM.w, h = CAM.h;
  const nameLimit = env.nameLimit;
  const showNames = APP.layers.starNames;
  // the magnitude limit saturates at the catalogue floor, so grow the discs
  // instead once the view is tighter than that
  const sizeBoost = clamp(1 + 0.34 * Math.log2(105 / (env.fov || 105)), 1, 2.8);

  const fade = limit + 1.2;
  const one = (i) => {
    const m = mag[i];
    const x0 = vec[i * 3], y0 = vec[i * 3 + 1], z0 = vec[i * 3 + 2];
    const Z = M[6] * x0 + M[7] * y0 + M[8] * z0;
    const d = 1 + Z;
    if (d < 0.02) return;
    const f = k2 / d;
    const x = cx + f * (M[0] * x0 + M[1] * y0 + M[2] * z0);
    if (x < -8 || x > w + 8) return;
    const y = cy - f * (M[3] * x0 + M[4] * y0 + M[5] * z0);
    if (y < -8 || y > h + 8) return;

    let r = sizeBoost * 0.55 * Math.pow(1.42, limit - m);
    if (r > 11) r = 11;
    if (r < 0.5) r = 0.5;
    let a = a0;
    if (m > limit) { a *= clamp(1 - (m - limit) / 1.2, 0.22, 1) * 0.8; if (a <= 0.02) return; }
    if (r < 0.9) a *= 0.55 + 0.5 * r;

    const cr = col[i * 3], cg = col[i * 3 + 1], cb = col[i * 3 + 2];
    if (m < 1.8 && r > 2.2) {
      const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
      gl.addColorStop(0, `rgba(${cr},${cg},${cb},${0.5 * a})`);
      gl.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(x, y, r * 3.4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();

    if (r > 2.4) pickables.push({ x, y, r: Math.max(r, 8), kind: 'star', ref: i, drawR: r });

    if (showNames && m <= nameLimit) {
      const L = SKY.labels[i];
      if (L && (L.n || (L.d && m <= nameLimit - 1.2))) {
        pushLabel(x + r + 4, y, L.n || L.d, {
          priority: m, size: L.n ? 12.5 : 11.5, align: 'left', offset: r + 4,
          weight: L.n ? 600 : 500,
          colour: L.n ? `rgba(244,249,255,${a0})` : `rgba(200,216,240,${0.88 * a0})`,
        });
      }
    }
  };

  // The catalogue is sorted by brightness, so the main sweep can stop early.
  for (let i = 0; i < SKY.n; i++) {
    if (mag[i] > fade) break;
    one(i);
  }
  for (const i of SKY.keepList) if (mag[i] > fade) one(i);
}

/* ------------------------------------------------------------ deep sky --- */
const DSO_STYLE = {
  'galaxy': ['#ffd08a', 'ellipse'],
  'globular cluster': ['#ffe9a8', 'circleplus'],
  'open cluster': ['#c8f0b0', 'dashed'],
  'planetary nebula': ['#8ff0e0', 'circleplus'],
  'bright nebula': ['#9fd8ff', 'square'],
  'emission nebula': ['#ffb0c0', 'square'],
  'reflection nebula': ['#a8c8ff', 'square'],
  'nebula': ['#9fd8ff', 'square'],
  'supernova remnant': ['#d0b0ff', 'dashsquare'],
  'dark nebula': ['#7d8a9c', 'square'],
  'galaxy cluster': ['#ffd08a', 'ellipse'],
};
function dsoStyle(t) { return DSO_STYLE[t] || ['#bcd0e8', 'circle']; }

function drawDsos(env) {
  const a0 = env.starAlpha;
  if (a0 < 0.05) return;
  const limit = env.dsoLimit;
  ctx.lineWidth = 1.1;
  for (let i = 0; i < SKY.dso.length; i++) {
    const d = SKY.dso[i];
    const saved = APP.savedKeys.has('dso:' + i);
    if (d.m > limit && !saved) continue;
    const p = project(d.vec, 30);
    if (!p) continue;
    const [colour, shape] = dsoStyle(d.t);
    // draw at true angular size once that exceeds the symbol size
    const arcmin = parseFloat(d.s) || 0;
    let r = clamp(arcmin / 60 * CAM.pxPerDeg / 2, 4, 260);
    const a = a0 * (saved ? 1 : clamp(1 - (d.m - limit + 2) / 3.5, 0.35, 1));
    ctx.strokeStyle = hexA(colour, a * 0.85);
    if (shape === 'dashed' || shape === 'dashsquare') ctx.setLineDash([3, 3]);
    ctx.beginPath();
    if (shape === 'ellipse') ctx.ellipse(p[0], p[1], r, r * 0.55, 0, 0, TAU);
    else if (shape === 'square' || shape === 'dashsquare') ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2);
    else ctx.arc(p[0], p[1], r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (shape === 'circleplus') {
      ctx.beginPath();
      ctx.moveTo(p[0] - r, p[1]); ctx.lineTo(p[0] + r, p[1]);
      ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0], p[1] + r);
      ctx.stroke();
    }
    pickables.push({ x: p[0], y: p[1], r: Math.max(r, 11), kind: 'dso', ref: i, drawR: r });
    if (d.m <= env.dsoNameLimit || saved) {
      // Messier objects are what people actually look for, so they win ties
      const fame = (/^M\d/.test(d.d) ? 4 : 0) + (d.a ? 1.5 : 0) + (saved ? 20 : 0);
      pushLabel(p[0] + r + 4, p[1], d.a || d.d, {
        priority: 20 + d.m - fame, size: 11.5, align: 'left', offset: r + 4,
        weight: 600, colour: hexA(colour, Math.min(1, 1.15 * a0)),
      });
    }
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1).toFixed(3)})`;
}

/* ---------------------------------------------------------- solar system -- */
const SOLAR = {
  Sun: { kind: 'star', colour: '#fff3c4', radiusKm: 696000, order: -3 },
  Moon: { kind: 'natural satellite', colour: '#e8e6df', radiusKm: 1737.4, order: -2 },
  Mercury: { kind: 'planet', colour: '#b9b0a4', radiusKm: 2439.7, order: 4 },
  Venus: { kind: 'planet', colour: '#f5e6c0', radiusKm: 6051.8, order: 1 },
  Mars: { kind: 'planet', colour: '#e08060', radiusKm: 3396.2, order: 3 },
  Jupiter: { kind: 'planet', colour: '#e8d9b8', radiusKm: 71492, order: 2 },
  Saturn: { kind: 'planet', colour: '#e6d5a0', radiusKm: 60268, order: 5 },
  Uranus: { kind: 'planet', colour: '#9fd8e0', radiusKm: 25559, order: 6 },
  Neptune: { kind: 'planet', colour: '#7f9fe8', radiusKm: 24764, order: 7 },
};

/* Geometry for every solar system body at a given instant. */
function solarSystemState(jd, lat, lon, elev) {
  const out = {};
  const obs = observerVec(jd, lat, lon, elev);
  const sunG = sunGeocentric(jd);
  const sunTopo = [sunG[0] - obs[0], sunG[1] - obs[1], sunG[2] - obs[2]];
  out.Sun = { vec: unit(sunTopo), distAu: len(sunTopo), geo: sunG, k: 1, phaseAngle: 0, mag: -26.7 };

  const mo = moonGeocentric(jd);
  const mTopo = [mo.vec[0] - obs[0], mo.vec[1] - obs[1], mo.vec[2] - obs[2]];
  const mp = phaseOf(mo.vec, sunG);
  out.Moon = {
    vec: unit(mTopo), distAu: len(mTopo), distKm: len(mTopo) * AU_KM, geo: mo.vec,
    k: mp.k, phaseAngle: mp.phaseAngle,
    mag: -12.7 + 5 * Math.log10(len(mTopo) * AU_KM / 384400) - 2.5 * Math.log10(Math.max(mp.k, 0.002)),
  };

  for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune']) {
    const g = planetGeocentric(name, jd);
    const topo = [g.eq[0] - obs[0], g.eq[1] - obs[1], g.eq[2] - obs[2]];
    const ph = phaseOf(g.eq, sunG);
    const r = len(g.helio), D = len(topo), i = ph.phaseAngle;
    out[name] = {
      vec: unit(topo), distAu: D, sunDistAu: r, geo: g.eq,
      k: ph.k, phaseAngle: i, mag: planetMagnitude(name, r, D, i),
    };
  }
  out._sunGeo = sunG;
  out._obs = obs;
  return out;
}

/* Topocentric direction of one solar system body — cheap enough to sweep. */
function bodyVecAt(name, jd) {
  const obs = observerVec(jd, APP.loc.lat, APP.loc.lon, APP.loc.elev);
  let g;
  if (name === 'Sun') g = sunGeocentric(jd);
  else if (name === 'Moon') g = moonGeocentric(jd).vec;
  else g = planetGeocentric(name, jd).eq;
  return unit([g[0] - obs[0], g[1] - obs[1], g[2] - obs[2]]);
}

function planetMagnitude(name, r, D, i) {
  const b = 5 * Math.log10(r * D);
  switch (name) {
    case 'Mercury': return -0.42 + b + 0.0380 * i - 0.000273 * i * i + 2e-6 * i * i * i;
    case 'Venus': return -4.40 + b + 0.0009 * i + 2.39e-4 * i * i - 6.5e-7 * i * i * i;
    case 'Mars': return -1.52 + b + 0.016 * i;
    case 'Jupiter': return -9.40 + b + 0.005 * i;
    case 'Saturn': return -8.88 + b + 0.044 * i;
    case 'Uranus': return -7.19 + b;
    default: return -6.87 + b;
  }
}

const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const len = (v) => Math.hypot(v[0], v[1], v[2]);

function drawSolarSystem(env) {
  const S = env.solar;
  const order = ['Neptune', 'Uranus', 'Saturn', 'Jupiter', 'Mars', 'Venus', 'Mercury', 'Moon', 'Sun'];
  for (const name of order) {
    const b = S[name];
    if (!b) continue;
    const p = project(b.vec, 120);
    if (!p) continue;
    const info = SOLAR[name];
    const semi = Math.atan(info.radiusKm / (b.distAu * AU_KM)); // radians
    const rTrue = semi * CAM.k;
    const rMin = name === 'Sun' || name === 'Moon' ? 3.2 : (b.mag < 1 ? 3.0 : 2.2);
    const r = Math.max(rTrue, rMin);
    const visible = name === 'Sun' || name === 'Moon'
      ? 1 : clamp(env.starAlpha + (b.mag < 2 ? 0.45 : 0), 0, 1);
    if (visible < 0.05) continue;

    ctx.save();
    ctx.globalAlpha = visible;
    if (name === 'Sun') drawSun(p, r);
    else if (name === 'Moon') drawPhasedDisc(p, r, b, info.colour, env, true);
    else if (r > 2.6 && (name === 'Venus' || name === 'Mercury'))
      drawPhasedDisc(p, r, b, info.colour, env, false);
    else drawPlanetDisc(p, r, info.colour, b, name);
    ctx.restore();

    pickables.push({ x: p[0], y: p[1], r: Math.max(r + 6, 14), kind: 'solar', ref: name, drawR: r });
    const showName = name === 'Sun' || name === 'Moon' || b.mag < 6.2;
    if (showName) {
      pushLabel(p[0] + r + 5, p[1], name, {
        priority: -10 + (info.order || 0), size: 13, weight: 700, align: 'left',
        offset: r + 5, colour: `rgba(255,240,200,${0.75 + 0.25 * visible})`,
      });
    }
  }
}

function drawSun(p, r) {
  const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 7);
  g.addColorStop(0, 'rgba(255,246,214,.95)');
  g.addColorStop(0.14, 'rgba(255,214,120,.5)');
  g.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(p[0], p[1], r * 7, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff8d8';
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
}

function drawPlanetDisc(p, r, colour, b, name) {
  if (r > 3) {
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3.2);
    g.addColorStop(0, hexA(colour, 0.42)); g.addColorStop(1, hexA(colour, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p[0], p[1], r * 3.2, 0, TAU); ctx.fill();
  }
  if (name === 'Saturn' && r > 3.5) {
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.rotate(northAngle(b.vec) + 0.35);
    ctx.strokeStyle = hexA(colour, 0.8);
    ctx.lineWidth = Math.max(1, r * 0.28);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 2.25, r * 0.72, 0, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = colour;
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
}

/* Screen rotation that puts celestial north "up" at a given direction. */
function northAngle(v) {
  const p0 = projectRaw(v);
  const npole = [0, 0, 1];
  // a point a little way towards the celestial pole
  const d = [npole[0] - v[0] * v[2], npole[1] - v[1] * v[2], npole[2] - v[2] * v[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (!p0 || l < 1e-6) return 0;
  const e = 0.004;
  const p1 = projectRaw(unit([v[0] + d[0] / l * e, v[1] + d[1] / l * e, v[2] + d[2] / l * e]));
  if (!p1) return 0;
  return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) + Math.PI / 2;
}

/* Disc with a terminator: the lit region is bounded by a limb semicircle and
   a half ellipse whose width is (2k-1) times the radius. */
function drawPhasedDisc(p, r, b, colour, env, isMoon) {
  const x = 2 * b.k - 1;
  const chi = brightLimbAngle(b, env);
  ctx.save();
  ctx.translate(p[0], p[1]);

  if (isMoon && r > 2.5) {
    const g = ctx.createRadialGradient(0, 0, r, 0, 0, r * 4.5);
    g.addColorStop(0, `rgba(220,226,240,${0.20 * b.k + 0.03})`);
    g.addColorStop(1, 'rgba(200,210,235,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r * 4.5, 0, TAU); ctx.fill();
  }

  // unlit side, faintly visible (earthshine for the Moon)
  ctx.fillStyle = isMoon ? 'rgba(78,84,104,.55)' : hexA(colour, 0.18);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();

  ctx.rotate(chi);
  ctx.fillStyle = isMoon ? '#e9e7e0' : colour;
  ctx.beginPath();
  const N = 36;
  for (let i = 0; i <= N; i++) {           // bright limb
    const t = Math.PI * i / N;
    ctx.lineTo(r * Math.sin(t), -r * Math.cos(t));
  }
  for (let i = N; i >= 0; i--) {           // terminator
    const t = Math.PI * i / N;
    ctx.lineTo(r * x * Math.sin(t), -r * Math.cos(t));
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* Screen angle of the bright limb, measured from screen "up". */
function brightLimbAngle(b, env) {
  const sun = env.solar._sunGeo;
  const v = b.vec;
  // component of the sun direction perpendicular to the body direction
  const s = unit(sun);
  const dot = s[0] * v[0] + s[1] * v[1] + s[2] * v[2];
  const d = [s[0] - dot * v[0], s[1] - dot * v[1], s[2] - dot * v[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-9) return 0;
  const p0 = projectRaw(v);
  const p1 = projectRaw(unit([v[0] + d[0] / l * 0.004, v[1] + d[1] / l * 0.004, v[2] + d[2] / l * 0.004]));
  if (!p0 || !p1) return 0;
  // local +x is the bright limb, so point it straight at the Sun
  return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
}

/* ------------------------------------------------------------ satellites -- */
const SATS = { list: [], loaded: false, error: null, fetchedAt: 0 };

function drawSatellites(env) {
  if (!SATS.list.length) return;
  // Satellites are only observable once the sky itself is dark.
  const vis = clamp(env.starAlpha * 1.15, 0, 1);
  if (vis < 0.08) return;
  const jd = env.jd;
  ctx.globalAlpha = vis;
  ctx.font = '600 11px system-ui, sans-serif';
  for (const s of SATS.list) {
    const st = satelliteState(s, jd, env);
    if (!st || st.error || st.alt < -1) continue;
    if (!st.sunlit && !s.featured) continue;
    const p = project(st.vec, 20);
    if (!p) continue;

    const bright = st.sunlit;
    const r = s.featured ? 3.2 : 1.9;
    const col = s.featured ? (bright ? '#8affc0' : '#4d6b58') : (bright ? '#9fd2ea' : '#5a7180');
    if (bright && s.featured) {
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 3.5);
      g.addColorStop(0, hexA(col, 0.5)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p[0], p[1], r * 3.5, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
    // a tiny cross-tick keeps satellites distinguishable from stars
    ctx.strokeStyle = hexA(col, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p[0] - r * 2.6, p[1]); ctx.lineTo(p[0] - r * 1.5, p[1]);
    ctx.moveTo(p[0] + r * 1.5, p[1]); ctx.lineTo(p[0] + r * 2.6, p[1]);
    ctx.stroke();

    // short leading track so the motion direction reads at a glance
    if (s.featured) {
      ctx.strokeStyle = hexA(col, 0.45);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let dt = 0; dt <= 8; dt += 2) {
        const q = satelliteState(s, jd + dt / 1440, env);
        if (!q || q.error) break;
        const pp = project(q.vec, 20);
        if (!pp) break;
        if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
        ctx.lineTo(pp[0], pp[1]);
      }
      if (started) ctx.stroke();
    }

    pickables.push({ x: p[0], y: p[1], r: 13, kind: 'sat', ref: s.noradId });
    if (s.featured || env.satNames) {
      pushLabel(p[0] + r + 6, p[1], s.shortName, {
        priority: s.featured ? -5 : 40, size: 11, align: 'left',
        colour: hexA(col, 0.95), weight: 600,
      });
    }
  }
  ctx.globalAlpha = 1;
}

/* Position, look angles and illumination for one satellite. Returns
   { error } when the orbit cannot be trusted, rather than a position — a
   satellite that is merely below the horizon still returns a full state. */
function satelliteState(s, jd, env) {
  const tmin = (jd - s.rec.epochJd) * 1440;
  if (Math.abs(tmin) > 20160) return { error: 'stale' };  // TLEs rot after ~2 weeks
  const r = sgp4(s.rec, tmin);
  if (!r) return { error: 'decayed' };
  const la = satelliteLookAngles(r.r, jd, APP.loc.lat, APP.loc.lon, APP.loc.elev);
  // Earth shadow test against the geocentric Sun direction
  const sv = env.solar._sunGeo;
  const sl = Math.hypot(sv[0], sv[1], sv[2]);
  const su = [sv[0] / sl, sv[1] / sl, sv[2] / sl];
  const dot = r.r[0] * su[0] + r.r[1] * su[1] + r.r[2] * su[2];
  let sunlit = true;
  if (dot < 0) {
    const perp = Math.hypot(r.r[0] - dot * su[0], r.r[1] - dot * su[1], r.r[2] - dot * su[2]);
    sunlit = perp > 6378.137 + 40;
  }
  return { vec: camFromAltAz(la.alt, la.az), alt: la.alt, az: la.az, range: la.range, sunlit, teme: r.r };
}

/* ------------------------------------------------------------ saved marks -- */
function drawSavedMarkers(env) {
  if (!APP.saved.length) return;
  ctx.lineWidth = 1.3;
  for (const t of APP.saved) {
    const v = targetVector(t, env);
    if (!v) continue;
    const p = project(v, 10);
    if (!p) continue;
    ctx.strokeStyle = 'rgba(255,198,92,.75)';
    ctx.beginPath();
    const R = 11;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.moveTo(p[0] + Math.cos(a) * R * 0.55, p[1] + Math.sin(a) * R * 0.55);
      ctx.lineTo(p[0] + Math.cos(a) * R, p[1] + Math.sin(a) * R);
    }
    ctx.stroke();
  }
}

/* ---------------------------------------------------------------- labels -- */
function pushLabel(x, y, text, opt) {
  labelBoxes.push({ x, y, text, ...opt });
}
function drawLabels(env) {
  labelBoxes.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const placed = [];
  if (northBadge) {
    placed.push([northBadge.x - 30, northBadge.y - 22, northBadge.x + 30, northBadge.y + 22]);
  }
  ctx.textBaseline = 'middle';
  for (const L of labelBoxes) {
    const size = L.size || 12;
    ctx.font = `${L.weight || 500} ${size}px system-ui, -apple-system, sans-serif`;
    const w = ctx.measureText(L.text).width + (L.letterSpacing ? L.text.length * L.letterSpacing : 0);
    let align = L.align || 'center';
    let ax = L.x;
    // flip a trailing label to the other side rather than letting it run off
    if (align === 'left' && ax + w + 4 > CAM.w) { align = 'right'; ax = L.x - (L.offset || 0) * 2; }
    const x0 = align === 'left' ? ax : (align === 'right' ? ax - w : ax - w / 2);
    const box = [x0 - 2, L.y - size * 0.62, x0 + w + 2, L.y + size * 0.62];
    // a half-visible label reads as a typo, so require the whole thing to fit
    if (box[0] < 0 || box[2] > CAM.w || box[3] < 0 || box[1] > CAM.h) continue;
    if (belowGround(ax, L.y)) continue;   // nothing floats over the ground
    let hit = false;
    for (const q of placed) {
      if (box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1]) { hit = true; break; }
    }
    if (hit) continue;
    placed.push(box);
    ctx.textAlign = align;
    if (L.letterSpacing && ctx.letterSpacing !== undefined) ctx.letterSpacing = L.letterSpacing + 'px';
    // A dark halo keeps text readable against both a black sky at low screen
    // brightness and a bright blue daytime sky.
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.62)';
    ctx.strokeText(L.text, ax, L.y);
    ctx.fillStyle = L.colour || 'rgba(240,246,255,.95)';
    ctx.fillText(L.text, ax, L.y);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
  }
}

/* ------------------------------------------------------------- selection -- */
function drawSelection(env) {
  const sel = APP.selected;
  if (!sel) return;
  const v = targetVector(sel, env);
  if (!v) return;
  const p = project(v, 40);
  if (!p) { drawOffscreenArrow(v); return; }
  const t = (Date.now() % 2000) / 2000;
  // sit outside whatever the object was actually drawn at
  let drawn = 0;
  for (const q of pickables) {
    if (q.kind === sel.kind && q.ref === sel.ref) { drawn = q.drawR || 0; break; }
  }
  const R = Math.max(17, drawn + 11) + Math.sin(t * TAU) * 2.5;
  ctx.strokeStyle = 'rgba(255,198,92,.95)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a0 = i * Math.PI / 2 + 0.32, a1 = (i + 1) * Math.PI / 2 - 0.32;
    ctx.arc(p[0], p[1], R, a0, a1);
    ctx.moveTo(p[0] + Math.cos(a1 + 0.32) * R, p[1] + Math.sin(a1 + 0.32) * R);
  }
  ctx.stroke();
}

function drawOffscreenArrow(v) {
  const p = projectRaw(v);
  if (!p) return;
  const dx = p[0] - CAM.cx, dy = p[1] - CAM.cy;
  const a = Math.atan2(dy, dx);
  const R = Math.min(CAM.w, CAM.h) * 0.42;
  const x = CAM.cx + Math.cos(a) * R, y = CAM.cy + Math.sin(a) * R;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = 'rgba(255,198,92,.85)';
  ctx.beginPath();
  ctx.moveTo(11, 0); ctx.lineTo(-7, 7); ctx.lineTo(-7, -7);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/* Resolve any selectable target to a current J2000 direction. */
function targetVector(t, env) {
  env = env || APP.env;
  if (!env) return null;
  switch (t.kind) {
    case 'star': return [SKY.vec[t.ref * 3], SKY.vec[t.ref * 3 + 1], SKY.vec[t.ref * 3 + 2]];
    case 'dso': return SKY.dso[t.ref].vec;
    case 'con': return SKY.figures[t.ref].centre;
    case 'solar': return env.solar[t.ref] ? env.solar[t.ref].vec : null;
    case 'sat': {
      const s = SATS.list.find(s => s.noradId === t.ref);
      if (!s) return null;
      const st = satelliteState(s, env.jd, env);
      return st && !st.error ? st.vec : null;
    }
  }
  return null;
}
