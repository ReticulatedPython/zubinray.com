/* --------------------------------------------------------------------- ui --
   Application state, interaction, panels and the animation loop.
---------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);
const STORE = 'starmap.v1';

const APP = {
  loc: { lat: 51.4769, lon: -0.0005, elev: 0, name: 'Greenwich', region: 'United Kingdom', tz: 'Europe/London', approx: true },
  view: { az: 0, alt: 35, fov: 100 },
  time: { live: true, paused: false, rate: 1, ms: Date.now() },
  layers: {
    constellations: true, starNames: true, planets: true, dso: true,
    satellites: true, ground: true, atmosphere: true, grid: false, ecliptic: false,
  },
  majorOnly: true,
  seeThrough: false,
  density: 0,
  saved: [],
  savedKeys: new Set(),
  selected: null,
  env: null,
  anim: null,
};

/* ------------------------------------------------------------- persistence */
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) || '{}');
    if (p.loc && isFinite(p.loc.lat)) APP.loc = Object.assign(APP.loc, p.loc);
    if (p.layers) Object.assign(APP.layers, p.layers);
    if (typeof p.majorOnly === 'boolean') APP.majorOnly = p.majorOnly;
    if (typeof p.seeThrough === 'boolean') APP.seeThrough = p.seeThrough;
    if (isFinite(p.density)) APP.density = p.density;
    if (Array.isArray(p.saved)) APP.saved = p.saved;
    if (p.view && isFinite(p.view.fov)) APP.view.fov = clamp(p.view.fov, 0.25, 170);
    APP.hasVisited = !!p.hasVisited;
  } catch (e) { /* corrupted storage is not worth crashing over */ }
  rebuildSavedKeys();
}
function savePrefs() {
  try {
    localStorage.setItem(STORE, JSON.stringify({
      loc: APP.loc, layers: APP.layers, majorOnly: APP.majorOnly,
      seeThrough: APP.seeThrough,
      density: APP.density, saved: APP.saved, view: { fov: APP.view.fov },
      hasVisited: true,
    }));
  } catch (e) { /* private mode */ }
}
function rebuildSavedKeys() {
  APP.savedKeys = new Set(APP.saved.map(t => t.kind + ':' + t.ref));
}

/* Saved objects are stored by catalogue identifier rather than array index, so
   they survive a rebuild of the embedded data. */
function stableKey(t) {
  if (t.kind === 'dso') return SKY.dso[t.ref] ? SKY.dso[t.ref].d : null;
  if (t.kind === 'star') {
    const L = SKY.labels[t.ref];
    if (!L) return null;
    return L.h ? 'HIP' + L.h : (L.n || L.d || null);
  }
  if (t.kind === 'con') return SKY.figures[t.ref] ? SKY.figures[t.ref].id : null;
  return String(t.ref);
}
function resolveKey(kind, key) {
  if (key == null) return null;
  if (kind === 'dso') {
    const i = SKY.dso.findIndex(d => d.d === key);
    return i >= 0 ? i : null;
  }
  if (kind === 'star') {
    const hip = /^HIP(\d+)$/.exec(key);
    for (const k in SKY.labels) {
      const L = SKY.labels[k];
      if (hip ? L.h === +hip[1] : (L.n === key || L.d === key)) return +k;
    }
    return null;
  }
  if (kind === 'con') {
    const i = SKY.figures.findIndex(f => f.id === key);
    return i >= 0 ? i : null;
  }
  if (kind === 'sat') return +key;
  return key;
}
/* Run once the catalogues exist; drops anything that no longer resolves. */
function resolveSaved() {
  APP.saved = APP.saved.map(s => {
    if (s.key == null) return s;               // written before keys existed
    const ref = resolveKey(s.kind, s.key);
    return ref === null ? null : Object.assign({}, s, { ref });
  }).filter(Boolean);
  rebuildSavedKeys();
}

/* --------------------------------------------------------------- time zone */
const TZ = {
  offset(ms) {
    const tz = APP.loc.tz;
    if (!tz) return Math.round(APP.loc.lon / 15) * 3600000;
    try {
      const f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
        day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      const m = {};
      for (const p of f.formatToParts(new Date(ms))) m[p.type] = p.value;
      return Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second) - ms;
    } catch (e) { return Math.round(APP.loc.lon / 15) * 3600000; }
  },
  label(ms) {
    const off = this.offset(ms) / 3600000;
    const sign = off < 0 ? '−' : '+';
    const a = Math.abs(off);
    const h = Math.floor(a), mn = Math.round((a - h) * 60);
    return 'UTC' + sign + h + (mn ? ':' + String(mn).padStart(2, '0') : '');
  },
  parts(ms) {
    const d = new Date(ms + this.offset(ms));
    return {
      y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(),
      h: d.getUTCHours(), mi: d.getUTCMinutes(), dow: d.getUTCDay(),
    };
  },
  toInput(ms) {
    const p = this.parts(ms);
    const z = (n) => String(n).padStart(2, '0');
    return `${p.y}-${z(p.mo + 1)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;
  },
  fromInput(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str);
    if (!m) return null;
    const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let utc = wall - this.offset(wall);
    utc = wall - this.offset(utc);   // settle across DST edges
    return utc;
  },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtClock(ms) {
  const p = TZ.parts(ms);
  const z = (n) => String(n).padStart(2, '0');
  return {
    t: `${z(p.h)}:${z(p.mi)}`,
    d: `${DAYS[p.dow]} ${p.d} ${MONTHS[p.mo]} ${p.y}`,
  };
}

/* ------------------------------------------------------------- formatting */
/* Sexagesimal with the rounding carried, so 12h 39m 60s never appears. */
function sexagesimal(value, unitMax) {
  let ticks = Math.round(value * 36000);      // tenths of a second
  let s = ticks % 600; ticks = (ticks - s) / 600;
  let m = ticks % 60; ticks = (ticks - m) / 60;
  let big = ticks;
  if (big >= unitMax) big -= unitMax;
  return [big, m, (s / 10)];
}
function fmtRa(deg) {
  const [h, m, s] = sexagesimal(norm360(deg) / 15, 24);
  return `${h}h ${String(m).padStart(2, '0')}m ${s.toFixed(1).padStart(4, '0')}s`;
}
function fmtDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  const [d, m, s] = sexagesimal(Math.abs(deg), 360);
  return `${sign}${d}° ${String(m).padStart(2, '0')}′ ${s.toFixed(1).padStart(4, '0')}″`;
}
function fmtDeg(v, n = 1) { return v.toFixed(n) + '°'; }
function compassName(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(norm360(az) / 22.5) % 16];
}
function fmtLat(v) { return Math.abs(v).toFixed(3) + '° ' + (v >= 0 ? 'N' : 'S'); }
function fmtLon(v) { return Math.abs(v).toFixed(3) + '° ' + (v >= 0 ? 'E' : 'W'); }

/* ------------------------------------------------------------------- boot */
let canvas, env = {}, dpr = 1;

function boot() {
  canvas = $('sky');
  ctx = canvas.getContext('2d', { alpha: false });
  loadPrefs();
  $('splashmsg').textContent = 'Placing ' + SKYDATA.starCount.toLocaleString() + ' stars…';

  prepareSky(SKYDATA);
  resolveSaved();
  applyPrefsToControls();
  resize();
  wireEvents();
  if (APP.loc.approx && !APP.hasVisited) requestGeolocation(true);
  updateLocationChip();
  loadSatellites();
  requestAnimationFrame(loop);
  setTimeout(() => $('splash').classList.add('gone'), 260);
  setTimeout(() => $('hint').classList.add('gone'), 7000);
  if (APP.saved.length) renderSaved();
  $('about').innerHTML =
    'Planets use JPL Keplerian elements, the Moon a truncated ELP-2000 series, and ' +
    'satellites SGP4.<br><br>' +
    'Star positions: <a href="https://github.com/astronexus/HYG-Database" target="_blank" ' +
    'rel="noopener">HYG Database</a> (CC BY-SA 4.0). ' +
    'Constellation figures and deep sky objects: <a href="https://github.com/ofrohn/d3-celestial" ' +
    'target="_blank" rel="noopener">d3-celestial</a> by Olaf Frohn (BSD-3-Clause). ' +
    'Constellation boundaries: Roman (1987), via CDS/VizieR. ' +
    'Satellite orbits: <a href="https://celestrak.org/" target="_blank" rel="noopener">CelesTrak</a>.';
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  env.w = w; env.h = h; env.dpr = dpr;
  invalidate();
  if (!APP.hasVisited && !APP.viewInit) {
    APP.view.fov = h > w ? 105 : 82;
    APP.viewInit = true;
  }
}

/* ------------------------------------------------------------------- loop */
let lastFrame = 0, lastDraw = 0;
/* Interactions call this so a frozen sky still repaints on demand. */
function invalidate() { APP.dirty = true; }

function loop(ts) {
  const dt = lastFrame ? Math.min(ts - lastFrame, 200) : 16;
  lastFrame = ts;

  const T = APP.time;
  if (T.live) T.ms = Date.now();
  else if (!T.paused) T.ms += dt * T.rate;

  stepAnimation(ts);

  // With the clock stopped and nothing moving on screen there is nothing to
  // redraw; the 500 ms floor keeps a missed invalidate from freezing the view.
  const moving = T.live || !T.paused || APP.anim || APP.selected
    || (APP.layers.satellites && SATS.list.length);
  if (!moving && !APP.dirty && ts - lastDraw < 500) {
    requestAnimationFrame(loop);
    return;
  }
  APP.dirty = false;
  lastDraw = ts;

  const jd = jdFromDate(new Date(T.ms));
  env.jd = jd;
  env.solar = solarSystemState(jd, APP.loc.lat, APP.loc.lon, APP.loc.elev);
  updateCamera(jd, APP.loc.lat, APP.loc.lon, APP.view, env.w, env.h);

  const sunAA = vecToAltAz(applyMat(CAM.Mh, env.solar.Sun.vec));
  env.sunAlt = sunAA.alt;
  env.sunScreen = projectRaw(env.solar.Sun.vec);

  const fov = APP.view.fov;
  env.fov = fov;
  env.limitMag = clamp(4.55 + 0.8 * Math.log2(105 / fov) + APP.density, 0.5, 6.5);
  env.nameLimit = clamp(2.6 + 0.85 * Math.log2(105 / fov) + APP.density * 0.8, 1.2, 5.4);
  env.dsoLimit = clamp(5.6 + 1.15 * Math.log2(105 / fov) + APP.density, 4.5, 12);
  env.dsoNameLimit = clamp(4.2 + 1.1 * Math.log2(105 / fov), 3.6, 11);
  env.satNames = fov < 45;
  env.sunCon = APP.layers.constellations ? constellationOfVec(env.solar.Sun.vec) : null;
  APP.env = env;

  drawFrame(env);
  updateClock();
  updateCompass();
  requestAnimationFrame(loop);
}

function updateClock() {
  const c = fmtClock(APP.time.ms);
  $('clockt').textContent = c.t;
  $('clockd').textContent = c.d;
  const T = APP.time;
  $('livebtn').classList.toggle('on', T.live);
  $('play').textContent = (T.live || !T.paused) ? '⏸' : '▶';
  $('ratelabel').textContent = T.live ? 'live' : (T.paused ? 'paused' : rateLabel(T.rate));
}
function rateLabel(r) {
  const a = Math.abs(r), s = r < 0 ? '−' : '';
  if (a === 1) return s + 'real';
  if (a < 3600) return s + a + '×';
  if (a < 86400) return s + (a / 3600) + 'h/s';
  return s + (a / 86400).toFixed(a % 86400 ? 1 : 0) + 'd/s';
}
function updateCompass() {
  $('compass').style.setProperty('--r', APP.view.az);
  const n = $('compass').querySelector('.needle');
  n.style.transform = `rotate(${-APP.view.az}deg)`;
  n.style.transformOrigin = '3px 18px';
}

/* -------------------------------------------------------- view animation */
function stepAnimation(ts) {
  const a = APP.anim;
  if (!a) return;
  const t = clamp((ts - a.t0) / a.dur, 0, 1);
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  APP.view.az = norm360(a.az0 + a.dAz * e);
  APP.view.alt = a.alt0 + (a.alt1 - a.alt0) * e;
  APP.view.fov = Math.exp(Math.log(a.fov0) + (Math.log(a.fov1) - Math.log(a.fov0)) * e);
  if (t >= 1) APP.anim = null;
}
function flyTo(az, alt, fov, dur = 900) {
  let dAz = norm360(az) - norm360(APP.view.az);
  if (dAz > 180) dAz -= 360; else if (dAz < -180) dAz += 360;
  APP.anim = {
    t0: performance.now(), dur,
    az0: APP.view.az, dAz,
    alt0: APP.view.alt, alt1: clamp(alt, -88, 88),
    fov0: APP.view.fov, fov1: clamp(fov ?? APP.view.fov, 0.25, 170),
  };
}

/* -------------------------------------------------------------- pointers */
function wireEvents() {
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  const pts = new Map();
  let dragged = false, pinchStart = null, downAt = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { dragged = false; downAt = Date.now(); APP.anim = null; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: APP.view.fov };
    }
    canvas.classList.add('dragging');
    $('hint').classList.add('gone');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (pts.size >= 2 && pinchStart) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 8) {
        APP.view.fov = clamp(pinchStart.fov * pinchStart.d / d, 0.25, 170);
        invalidate();
        dragged = true;
      }
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
    look(dx, dy);
  });

  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinchStart = null;
    if (pts.size === 0) {
      canvas.classList.remove('dragging');
      if (!dragged && Date.now() - downAt < 700) pick(e.clientX, e.clientY);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    APP.anim = null;
    APP.view.fov = clamp(APP.view.fov * Math.exp(e.deltaY * 0.0016), 0.25, 170);
    invalidate();
    savePrefsSoon();
  }, { passive: false });

  // zoom, compass, nudge pad
  $('zin').onclick = () => zoomBy(1 / 1.6);
  $('zout').onclick = () => zoomBy(1.6);
  $('seethru').onclick = () => {
    setSeeThrough(!APP.seeThrough);
    toast(APP.seeThrough
      ? 'Looking through the ground — objects below the horizon are now shown'
      : 'Back to the visible sky above the horizon');
  };
  $('flipbtn').onclick = () => flyTo(APP.view.az + 180, APP.view.alt, APP.view.fov, 700);
  $('compass').onclick = () => flyTo(0, clamp(Math.abs(APP.loc.lat) * 0.7, 20, 50), APP.view.fov, 700);
  for (const b of document.querySelectorAll('#dpad button[data-nudge]')) {
    let timer = null;
    const dir = b.dataset.nudge;
    const step = () => nudge(dir);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); APP.anim = null; step();
      timer = setInterval(step, 90);
    });
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
    b.addEventListener('pointercancel', stop);
  }

  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const k = e.key;
    if (k === 'ArrowLeft') nudge('left');
    else if (k === 'ArrowRight') nudge('right');
    else if (k === 'ArrowUp') nudge('up');
    else if (k === 'ArrowDown') nudge('down');
    else if (k === '+' || k === '=') zoomBy(1 / 1.6);
    else if (k === '-' || k === '_') zoomBy(1.6);
    else if (k === ' ') { togglePlay(); e.preventDefault(); }
    else if (k === '/' || k === 'f') { openSheet('searchsheet'); $('q').focus(); e.preventDefault(); }
    else if (k === 'Escape') closeSheets();
    else return;
    if (k.startsWith('Arrow')) e.preventDefault();
  });

  wirePanels();
}

function look(dx, dy) {
  const perDeg = CAM.pxPerDeg || 10;
  const v = APP.view;
  v.alt = clamp(v.alt + dy / perDeg, -88, 88);
  const shrink = Math.max(Math.cos(v.alt * D2R), 0.28);
  v.az = norm360(v.az - dx / perDeg / shrink);
  invalidate();
}
function nudge(dir) {
  const s = APP.view.fov * 0.14;
  const v = APP.view;
  if (dir === 'left') v.az = norm360(v.az - s);
  else if (dir === 'right') v.az = norm360(v.az + s);
  else if (dir === 'up') v.alt = clamp(v.alt + s, -88, 88);
  else v.alt = clamp(v.alt - s, -88, 88);
  invalidate();
}
function setSeeThrough(on) {
  APP.seeThrough = !!on;
  $('l_seethru').checked = APP.seeThrough;
  $('seethru').classList.toggle('on', APP.seeThrough);
  invalidate();
  savePrefs();
}
function zoomBy(f) {
  APP.anim = null;
  APP.view.fov = clamp(APP.view.fov * f, 0.25, 170);
  invalidate();
  savePrefsSoon();
}

let saveTimer = null;
function savePrefsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePrefs, 600);
}

/* ---------------------------------------------------------------- picking */
function pick(cx, cy) {
  let best = null, bestD = 34 * 34;
  for (const p of pickables) {
    const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
    const rr = Math.max(p.r, 14) ** 2;
    if (d < rr && d < bestD && !belowGround(p.x, p.y)) { bestD = d; best = p; }
  }
  if (!best) {
    // nothing there: clear the selection rather than leaving a stale marker
    if (APP.selected) { APP.selected = null; closeSheet('infosheet'); }
    return;
  }
  selectTarget({ kind: best.kind, ref: best.ref });
}

function selectTarget(t, opts = {}) {
  APP.selected = t;
  showInfo(t);
  if (opts.fly) {
    const v = targetVector(t, env);
    if (v) {
      const aa = vecToAltAz(applyMat(CAM.Mh, v));
      flyTo(aa.az, aa.alt, opts.fov, 950);
    }
  }
}

/* ------------------------------------------------------------ object info */
function targetInfo(t) {
  const e = env;
  const out = { kind: t.kind, ref: t.ref, facts: [], notes: [] };
  const v = targetVector(t, e);
  out.vec = v;

  if (t.kind === 'star') {
    const i = t.ref, L = SKY.labels[i] || {};
    out.title = L.n || L.d || 'Star';
    out.sub = L.n && L.d ? L.d : 'star';
    out.kindLabel = 'Star';
    out.facts.push(['Magnitude', SKY.mag[i].toFixed(2)]);
    if (L.s) out.facts.push(['Spectral type', L.s]);
    if (L.p) out.facts.push(['Distance', L.p >= 1000
      ? (L.p / 1000).toFixed(1) + ' thousand light years' : L.p.toFixed(1) + ' light years']);
    if (L.h) out.facts.push(['Catalogue', 'HIP ' + L.h]);
  } else if (t.kind === 'dso') {
    const d = SKY.dso[t.ref];
    out.title = d.a || d.d;
    out.sub = [d.a ? d.d : '', d.id2].filter(Boolean).join(' · ');
    out.kindLabel = d.t;
    if (d.m < 90) out.facts.push(['Magnitude', d.m.toFixed(1)]);
    if (d.s) out.facts.push(['Apparent size', d.s.replace('x', '′ × ') + '′']);
  } else if (t.kind === 'con') {
    const f = SKY.figures[t.ref];
    out.title = f.name;
    out.sub = 'constellation';
    out.kindLabel = 'Constellation';
  } else if (t.kind === 'solar') {
    const b = e.solar[t.ref], info = SOLAR[t.ref];
    out.title = t.ref;
    out.sub = info.kind;
    out.kindLabel = info.kind;
    out.facts.push(['Magnitude', b.mag.toFixed(1)]);
    if (t.ref !== 'Sun') out.facts.push(['Illuminated', (b.k * 100).toFixed(0) + '%']);
    const semi = Math.atan(info.radiusKm / (b.distAu * AU_KM)) * R2D * 2 * 60;
    out.facts.push(['Apparent size', semi >= 1 ? semi.toFixed(1) + '′' : (semi * 60).toFixed(1) + '″']);
    out.facts.push(['Distance', t.ref === 'Moon'
      ? Math.round(b.distAu * AU_KM).toLocaleString() + ' km'
      : b.distAu.toFixed(3) + ' AU (' + (b.distAu * 8.317).toFixed(1) + ' light minutes)']);
    if (t.ref === 'Moon') out.notes.push(moonPhaseName(b));
  } else if (t.kind === 'sat') {
    const s = SATS.list.find(s => s.noradId === t.ref);
    if (!s) {
      return {
        kind: t.kind, ref: t.ref, facts: [], notes: [],
        title: 'Satellite', kindLabel: 'Satellite',
        problem: SATS.error
          ? 'Satellite orbital data could not be downloaded, so this object cannot be placed. Everything else on the map still works; reload once you have a connection.'
          : (SATS.loaded ? 'No orbital data is available for this satellite.'
                         : 'Satellite orbits are still downloading — try again in a moment.'),
      };
    }
    const st = satelliteState(s, e.jd, e);
    out.title = s.shortName;
    out.sub = s.name + ' · NORAD ' + s.noradId;
    out.kindLabel = 'Satellite';
    if (st && st.error) {
      out.problem = st.error === 'stale'
        ? 'The orbital elements for this satellite are from ' +
          dateFromJd(s.rec.epochJd).toISOString().slice(0, 10) +
          ', too far from the date you are viewing to place it accurately. ' +
          'Satellite positions are only reliable within about two weeks of now.'
        : 'This satellite has no usable orbit for this date — it may have re-entered.';
    } else if (st) {
      const r = Math.hypot(...st.teme);
      out.facts.push(['Height above Earth', Math.round(r - 6378) + ' km']);
      out.facts.push(['Range from you', Math.round(st.range) + ' km']);
      out.facts.push(['Sunlit', !st.sunlit ? 'no — in Earth’s shadow'
        : st.alt > 0 ? 'yes — visible if your sky is dark'
        : 'yes, but it is below your horizon']);
    }
    out.facts.push(['Orbits per day', (1440 / (TAU / s.rec.no)).toFixed(2)]);
    const pass = out.problem ? null : nextPass(s);
    const p = pass && (pass.visible || pass.any);
    if (p) {
      out.facts.push([pass.visible ? 'Next visible pass' : 'Next pass overhead',
        fmtClock(p.start).t + ' ' + (shortDay(p.start) || 'today') +
        ', rising in the ' + compassName(p.startAz), true]);
      out.facts.push(['That pass peaks at', fmtDeg(p.maxAlt) + ' towards ' + compassName(p.maxAz)]);
      out.facts.push(['Pass lasts', Math.round(p.duration / 60000) + ' min']);
      if (!pass.visible) out.notes.push(
        'Every pass over the next three days happens in daylight or with the satellite ' +
        'in Earth’s shadow, so none of them are visible from here. Visible passes come ' +
        'and go in runs of a few days as the orbit drifts.');
    } else if (!out.problem) {
      out.notes.push('This satellite does not rise above 10° here in the next three days.');
    }
    out.notes.push('Orbital elements from CelesTrak, epoch ' +
      dateFromJd(s.rec.epochJd).toISOString().slice(0, 16).replace('T', ' ') + ' UTC.');
  }

  if (v) {
    const j2000 = vecToRaDec(v);
    const P = precessionMatrix(e.jd);
    const ofDate = vecToRaDec([
      P[0] * v[0] + P[1] * v[1] + P[2] * v[2],
      P[3] * v[0] + P[4] * v[1] + P[5] * v[2],
      P[6] * v[0] + P[7] * v[1] + P[8] * v[2],
    ]);
    const aa = vecToAltAz(applyMat(CAM.Mh, v));
    out.j2000 = j2000; out.ofDate = ofDate; out.altaz = aa;
    out.rs = riseSet(t);
    if (t.kind !== 'con') {
      const c = constellationAt(j2000.ra, j2000.dec);
      if (c) out.constellation = c;
    }
  }
  return out;
}

function moonPhaseName(b) {
  // waxing when the Moon is east of the Sun
  const s = env.solar._sunGeo;
  const m = b.geo;
  const cross = s[0] * m[1] - s[1] * m[0];
  const waxing = cross > 0;
  const k = b.k;
  if (k < 0.02) return 'New Moon';
  if (k > 0.98) return 'Full Moon';
  if (Math.abs(k - 0.5) < 0.04) return waxing ? 'First Quarter' : 'Last Quarter';
  const nm = k < 0.5 ? 'crescent' : 'gibbous';
  return (waxing ? 'Waxing ' : 'Waning ') + nm + ' · ' + (k * 100).toFixed(0) + '% lit';
}

/* Scan the next three days for the first pass above ten degrees, tracking
   separately whether it is one you could actually see: satellite sunlit while
   the observer's own sky is dark. */
function nextPass(s) {
  const start = APP.time.ms;
  const STEP = 30000;
  const SPAN = 3 * 86400000;
  let open = null, best = { any: null, visible: null };

  const close = () => {
    if (!open) return;
    open.duration = open.end - open.start + STEP;
    if (!best.any) best.any = open;
    if (open.observable && !best.visible) best.visible = open;
    open = null;
  };

  for (let ms = start; ms < start + SPAN && !(best.any && best.visible); ms += STEP) {
    const jd = jdFromDate(new Date(ms));
    const r = sgp4(s.rec, (jd - s.rec.epochJd) * 1440);
    if (!r) break;
    const la = satelliteLookAngles(r.r, jd, APP.loc.lat, APP.loc.lon, APP.loc.elev);
    if (la.alt <= 10) { close(); continue; }

    const sunV = sunGeocentric(jd);
    const sl = Math.hypot(sunV[0], sunV[1], sunV[2]);
    const su = [sunV[0] / sl, sunV[1] / sl, sunV[2] / sl];
    const dot = r.r[0] * su[0] + r.r[1] * su[1] + r.r[2] * su[2];
    let sunlit = true;
    if (dot < 0) {
      const perp = Math.hypot(r.r[0] - dot * su[0], r.r[1] - dot * su[1], r.r[2] - dot * su[2]);
      sunlit = perp > 6378.137 + 40;
    }
    const sunAlt = vecToAltAz(applyMat(skyMatrix(jd, APP.loc.lat, APP.loc.lon), su)).alt;

    if (!open) open = { start: ms, startAz: la.az, maxAlt: la.alt, maxAz: la.az, observable: false };
    if (la.alt > open.maxAlt) { open.maxAlt = la.alt; open.maxAz = la.az; }
    if (sunlit && sunAlt < -6) open.observable = true;
    open.end = ms;
  }
  close();
  return best;
}

/* Next rise, transit and set, scanning from the current instant. */
function riseSet(t) {
  const h0 = t.kind === 'solar' && t.ref === 'Sun' ? -0.833
           : t.kind === 'solar' && t.ref === 'Moon' ? 0.125 : -0.5666;
  if (t.kind === 'sat') return null;
  const start = APP.time.ms;
  const fixed = t.kind === 'solar' ? null : targetVector(t, env);
  if (!fixed && t.kind !== 'solar') return null;
  const altAt = (ms) => {
    const jd = jdFromDate(new Date(ms));
    const v = fixed || bodyVecAt(t.ref, jd);
    const M = skyMatrix(jd, APP.loc.lat, APP.loc.lon);
    return vecToAltAz(applyMat(M, v)).alt;
  };
  const STEP = 6 * 60000;              // six minutes
  const SPAN = 30 * 60 * 60000;        // thirty hours
  const first = altAt(start);
  let prev = first, prevMs = start;
  let rise = null, set = null, transit = null, maxAlt = prev;
  for (let ms = start + STEP; ms <= start + SPAN; ms += STEP) {
    const a = altAt(ms);
    if (a > maxAlt) { maxAlt = a; transit = ms; }
    if (rise === null && prev < h0 && a >= h0) rise = refine(altAt, prevMs, ms, h0);
    if (set === null && prev >= h0 && a < h0) set = refine(altAt, prevMs, ms, h0);
    prev = a; prevMs = ms;
  }
  return { rise, set, transit, maxAlt, nowUp: first > h0 };
}
/* Bisect a bracketed horizon crossing. */
function refine(f, lo, hi, h0) {
  let flo = f(lo) - h0;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid) - h0;
    if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

function showInfo(t) {
  const d = targetInfo(t);
  if (!d) {
    $('infotitle').textContent = 'Object';
    $('infobody').innerHTML = '<p class="note">Nothing is known about that object.</p>';
    openSheet('infosheet');
    return;
  }
  $('infotitle').textContent = d.title;
  const saved = APP.savedKeys.has(t.kind + ':' + t.ref);
  const up = d.altaz && d.altaz.alt > 0;

  let html = `<div class="hd"><h2>${esc(d.title)}</h2><span class="kind">${esc(d.kindLabel || '')}</span></div>`;
  if (d.sub) html += `<div class="note" style="margin-top:2px">${esc(d.sub)}</div>`;

  // A missing position is a data problem, not a visibility one — say which.
  if (d.problem) html += `<div class="updn nodata">${esc(d.problem)}</div>`;

  if (d.altaz) {
    html += `<div class="updn ${up ? 'up' : 'down'}">${up
      ? `Above the horizon now — ${fmtDeg(d.altaz.alt)} up, towards ${compassName(d.altaz.az)} (${fmtDeg(d.altaz.az)})`
      : `Not visible from your location right now — it is ${fmtDeg(-d.altaz.alt)} below your horizon` +
        (d.rs && d.rs.rise ? `, rising at ${fmtClock(d.rs.rise).t} ${shortDay(d.rs.rise)}` : '')}</div>`;
  }

  html += '<div class="facts">';
  if (d.constellation) html += fact('Constellation', d.constellation.name);
  for (const [k, v] of d.facts) html += fact(k, v);
  if (d.j2000) {
    html += fact('Right ascension (J2000)', fmtRa(d.j2000.ra), true);
    html += fact('Declination (J2000)', fmtDec(d.j2000.dec), true);
    html += fact('RA / Dec of date', fmtRa(d.ofDate.ra) + '   ' + fmtDec(d.ofDate.dec), true);
    html += fact('Altitude', fmtDeg(d.altaz.alt, 2));
    html += fact('Azimuth', fmtDeg(d.altaz.az, 2) + ' ' + compassName(d.altaz.az));
  }
  if (d.rs) {
    const f = (ms) => ms ? fmtClock(ms).t + ' ' + shortDay(ms) : '—';
    if (d.rs.rise === null && d.rs.set === null) {
      html += fact(d.rs.nowUp ? 'Visibility' : 'Visibility',
        d.rs.nowUp ? 'Always above the horizon' : 'Never rises from here', true);
    } else {
      html += fact('Rises', f(d.rs.rise));
      html += fact('Sets', f(d.rs.set));
    }
    if (d.rs.transit) html += fact('Highest', f(d.rs.transit) + ' at ' + fmtDeg(d.rs.maxAlt), true);
  }
  html += '</div>';

  for (const n of d.notes) html += `<p class="note">${esc(n)}</p>`;

  const belowNow = d.altaz && d.altaz.alt <= 0;
  html += '<div class="btnrow" style="margin-top:14px">';
  if (d.vec) html += `<button class="act primary" id="centrebtn">Centre and zoom</button>`;
  html += `<button class="act" id="savebtn">${saved ? '★ Saved' : '☆ Save'}</button></div>`;
  if (belowNow && !APP.seeThrough) {
    html += `<button class="act" id="seethrubtn" style="width:100%;margin-top:8px">Look through the ground to find it</button>`;
  }

  $('infobody').innerHTML = html;
  if ($('centrebtn')) $('centrebtn').onclick = () => {
    const v = targetVector(t, env);
    if (!v) return;
    if (vecToAltAz(applyMat(CAM.Mh, v)).alt <= 0 && APP.layers.ground) setSeeThrough(true);
    const aa = vecToAltAz(applyMat(CAM.Mh, v));
    flyTo(aa.az, aa.alt, suggestedFov(t), 950);
    closeSheet('infosheet');
  };
  if ($('seethrubtn')) $('seethrubtn').onclick = () => {
    setSeeThrough(true);
    const v = targetVector(t, env);
    if (v) {
      const aa = vecToAltAz(applyMat(CAM.Mh, v));
      flyTo(aa.az, aa.alt, suggestedFov(t), 950);
    }
    closeSheet('infosheet');
  };
  $('savebtn').onclick = () => { toggleSaved(t); showInfo(t); };
  openSheet('infosheet');
}
function fact(k, v, wide) {
  return `<div class="${wide ? 'wide' : ''}"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
}
function shortDay(ms) {
  const a = TZ.parts(ms), b = TZ.parts(APP.time.ms);
  return (a.d === b.d && a.mo === b.mo) ? '' : `(${a.d} ${MONTHS[a.mo]})`;
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
/* Close enough to see the object, wide enough to keep its surroundings. */
function suggestedFov(t) {
  if (t.kind === 'con') return 65;
  if (t.kind === 'dso') {
    // wide enough that surrounding stars still give the object a context
    const arcmin = parseFloat(SKY.dso[t.ref].s) || 10;
    return clamp(arcmin / 60 * 14, 18, 45);
  }
  if (t.kind === 'solar') {
    if (t.ref === 'Moon' || t.ref === 'Sun') return 3;
    return 7;
  }
  if (t.kind === 'sat') return 25;
  return 14;
}

/* ------------------------------------------------------------ saved items */
function toggleSaved(t) {
  const key = t.kind + ':' + t.ref;
  const i = APP.saved.findIndex(s => s.kind + ':' + s.ref === key);
  if (i >= 0) { APP.saved.splice(i, 1); toast('Removed from your saved objects'); }
  else {
    const d = targetInfo(t);
    APP.saved.unshift({
      kind: t.kind, ref: t.ref, key: stableKey(t), name: d ? d.title : 'Object',
    });
    APP.saved = APP.saved.slice(0, 60);
    toast('Saved — it will be marked on your chart next time');
  }
  rebuildSavedKeys();
  invalidate();
  savePrefs();
  renderSaved();
}
function renderSaved() {
  const ul = $('savedlist');
  if (!APP.saved.length) {
    ul.innerHTML = '<li class="empty">Nothing saved yet. Search for an object and tap Save to pin it to your chart.</li>';
    return;
  }
  ul.innerHTML = APP.saved.map((s, i) => `
    <li data-saved="${i}">
      <span class="ic">${kindIcon(s.kind)}</span>
      <span class="tx"><b>${esc(s.name)}</b><span>${esc(s.kind === 'dso' ? 'deep sky object' : s.kind)}</span></span>
      <span class="star on" data-unsave="${i}">★</span>
    </li>`).join('');
  ul.querySelectorAll('[data-saved]').forEach(li => {
    li.onclick = (e) => {
      if (e.target.dataset.unsave !== undefined) return;
      const s = APP.saved[+li.dataset.saved];
      closeSheets();
      selectTarget({ kind: s.kind, ref: s.ref }, { fly: true, fov: suggestedFov(s) });
    };
  });
  ul.querySelectorAll('[data-unsave]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const s = APP.saved[+b.dataset.unsave];
      toggleSaved({ kind: s.kind, ref: s.ref });
    };
  });
}
function kindIcon(k) {
  return { star: '✦', dso: '◎', solar: '☉', con: '⁂', sat: '🛰' }[k] || '•';
}

/* ---------------------------------------------------------------- search */
function wireSearch() {
  const q = $('q');
  const run = () => {
    const res = searchSky(q.value);
    const ul = $('results');
    if (!q.value.trim()) { ul.innerHTML = ''; return; }
    if (!res.length) {
      ul.innerHTML = '<li class="empty">Nothing matched. Try a Messier number (M31), an NGC number, a star name or a planet.</li>';
      return;
    }
    ul.innerHTML = res.map((r, i) => {
      const saved = APP.savedKeys.has(r.kind + ':' + r.ref);
      return `<li data-i="${i}">
        <span class="ic">${kindIcon(r.kind)}</span>
        <span class="tx"><b>${esc(r.name)}</b><span>${esc(r.sub || r.kind)}</span></span>
        <span class="star ${saved ? 'on' : ''}" data-save="${i}">${saved ? '★' : '☆'}</span>
      </li>`;
    }).join('');
    ul.querySelectorAll('li[data-i]').forEach(li => {
      li.onclick = (e) => {
        const r = res[+li.dataset.i];
        if (e.target.dataset.save !== undefined) {
          toggleSaved({ kind: r.kind, ref: r.ref }); run(); return;
        }
        closeSheets();
        goToResult(r);
      };
    });
  };
  q.addEventListener('input', run);
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const res = searchSky(q.value);
      if (res.length) { closeSheets(); goToResult(res[0]); }
    }
  });
  APP.rerunSearch = run;

  const quick = ['Moon', 'Saturn', 'Jupiter', 'M31', 'Orion Nebula', 'Sombrero Galaxy',
    'Pleiades', 'Vega', 'ISS', 'Omega Centauri'];
  $('quickchips').innerHTML = quick.map(s => `<button data-q="${esc(s)}">${esc(s)}</button>`).join('');
  $('quickchips').querySelectorAll('button').forEach(b => {
    b.onclick = () => { q.value = b.dataset.q; run(); };
  });
}

function goToResult(r) {
  const t = { kind: r.kind, ref: r.ref };
  const v = targetVector(t, env);
  if (!v) { toast(unavailableReason(t, r.name)); return; }
  const aa = vecToAltAz(applyMat(CAM.Mh, v));
  APP.selected = t;
  flyTo(aa.az, aa.alt, suggestedFov(t), 1000);
  // remember what people look for, as requested
  if (!APP.savedKeys.has(t.kind + ':' + t.ref)) toggleSaved(t);
  setTimeout(() => showInfo(t), 1050);
  if (aa.alt < 0) {
    // no point flying somewhere the ground is covering — open it up
    if (!APP.seeThrough && APP.layers.ground) {
      setSeeThrough(true);
      toast(r.name + ' is below your horizon now — looking through the ground so you can see where it is.');
    } else {
      toast(r.name + ' is below your horizon at this time.');
    }
  }
}

/* Why an object has no position: missing data reads very differently from
   "you cannot see it from here", so never collapse the two. */
function unavailableReason(t, name) {
  if (t.kind !== 'sat') return 'Could not work out where ' + name + ' is right now.';
  if (SATS.error) return 'Satellite data could not be downloaded, so ' + name +
    ' cannot be placed. Check your connection and reload.';
  if (!SATS.loaded) return 'Still downloading satellite orbits — try again in a moment.';
  const s = SATS.list.find(x => x.noradId === t.ref);
  if (!s) return 'No orbital data available for ' + name + '.';
  const st = satelliteState(s, env.jd, env);
  if (st && st.error === 'stale') return 'The orbital data for ' + name +
    ' is too old for this date to be accurate. Reload to fetch fresh elements.';
  if (st && st.error === 'decayed') return name +
    ' has no usable orbit for this date — it may have re-entered.';
  return 'Could not work out where ' + name + ' is right now.';
}

/* -------------------------------------------------------------- panels */
function openSheet(id) {
  closeSheets(id);
  const el = $(id);
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
}
function closeSheet(id) {
  const el = $(id);
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
}
function closeSheets(except) {
  for (const el of document.querySelectorAll('.sheet')) {
    if (el.id === except) continue;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }
}

function wirePanels() {
  document.querySelectorAll('[data-close]').forEach(b => {
    b.onclick = () => closeSheet(b.closest('.sheet').id);
  });
  $('menubtn').onclick = () => openSheet('menusheet');
  $('searchbtn').onclick = () => { openSheet('searchsheet'); setTimeout(() => $('q').focus(), 260); };
  $('locchip').onclick = () => openSheet('menusheet');
  $('clock').onclick = () => { $('dtin').value = TZ.toInput(APP.time.ms); openSheet('timesheet'); };

  // layer toggles
  const map = {
    l_con: 'constellations', l_starnames: 'starNames', l_planets: 'planets',
    l_dso: 'dso', l_sat: 'satellites', l_ground: 'ground', l_atmos: 'atmosphere',
    l_grid: 'grid', l_ecl: 'ecliptic',
  };
  for (const id in map) {
    $(id).onchange = () => { APP.layers[map[id]] = $(id).checked; invalidate(); savePrefs(); };
  }
  $('l_major').onchange = () => { APP.majorOnly = $('l_major').checked; invalidate(); savePrefs(); };
  $('l_seethru').onchange = () => setSeeThrough($('l_seethru').checked);
  $('density').oninput = () => {
    APP.density = +$('density').value;
    $('densitylabel').textContent = densityWord(APP.density);
    invalidate();
    savePrefsSoon();
  };

  // time controls
  $('livebtn').onclick = () => goLive();
  $('play').onclick = () => togglePlay();
  $('rew').onclick = () => stepRate(-1);
  $('ff').onclick = () => stepRate(1);
  $('dtgo').onclick = () => {
    const ms = TZ.fromInput($('dtin').value);
    if (ms === null) { toast('Please pick a date and time'); return; }
    APP.time.live = false; APP.time.paused = true; APP.time.ms = ms;
    closeSheet('timesheet');
  };
  $('dtnow').onclick = () => { goLive(); closeSheet('timesheet'); };

  const jumps = [
    ['Tonight 22:00', () => setTonight(22)],
    ['Tomorrow 22:00', () => setTonight(22, 1)],
    ['+1 hour', () => shiftTime(3600e3)],
    ['−1 hour', () => shiftTime(-3600e3)],
    ['+1 day', () => shiftTime(86400e3)],
    ['+1 week', () => shiftTime(7 * 86400e3)],
    ['+1 month', () => shiftTime(30 * 86400e3)],
    ['+1 year', () => shiftTime(365.25 * 86400e3)],
    ['−1 year', () => shiftTime(-365.25 * 86400e3)],
  ];
  $('jumpchips').innerHTML = jumps.map((j, i) => `<button data-j="${i}">${esc(j[0])}</button>`).join('');
  $('jumpchips').querySelectorAll('button').forEach(b => {
    b.onclick = () => { jumps[+b.dataset.j][1](); };
  });

  const rates = [['Real time', 1], ['1 min/s', 60], ['10 min/s', 600], ['1 hour/s', 3600],
                 ['6 hours/s', 21600], ['1 day/s', 86400], ['Reverse', -3600]];
  $('ratechips').innerHTML = rates.map((r, i) => `<button data-r="${i}">${esc(r[0])}</button>`).join('');
  $('ratechips').querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      APP.time.rate = rates[+b.dataset.r][1];
      APP.time.live = false; APP.time.paused = false;
    };
  });

  // location
  $('geobtn').onclick = () => requestGeolocation(false);
  $('citybtn').onclick = () => {
    const w = $('citywrap');
    w.style.display = w.style.display === 'none' ? 'block' : 'none';
    if (w.style.display === 'block') { renderCities(''); $('citysearch').focus(); }
  };
  $('citysearch').oninput = () => renderCities($('citysearch').value);
  $('applyloc').onclick = () => {
    const lat = parseFloat($('latin').value), lon = parseFloat($('lonin').value);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast('Please enter a latitude between −90 and 90 and a longitude between −180 and 180');
      return;
    }
    setLocation({
      lat, lon, elev: 0, name: fmtLat(lat) + ' ' + fmtLon(lon), region: '',
      tz: null, approx: false,
    });
    toast('Location set. Times are shown at ' + TZ.label(APP.time.ms) + '.');
  };

  wireSearch();
  renderSaved();
}

function densityWord(d) {
  if (d <= -1) return 'Very sparse — bright stars only';
  if (d < -0.2) return 'Sparse';
  if (d < 0.3) return 'Balanced';
  if (d < 1.2) return 'Rich';
  return 'Everything down to naked-eye limit';
}

function applyPrefsToControls() {
  const map = {
    l_con: 'constellations', l_starnames: 'starNames', l_planets: 'planets',
    l_dso: 'dso', l_sat: 'satellites', l_ground: 'ground', l_atmos: 'atmosphere',
    l_grid: 'grid', l_ecl: 'ecliptic',
  };
  for (const id in map) $(id).checked = APP.layers[map[id]];
  $('l_major').checked = APP.majorOnly;
  $('l_seethru').checked = APP.seeThrough;
  $('seethru').classList.toggle('on', APP.seeThrough);
  $('density').value = APP.density;
  $('densitylabel').textContent = densityWord(APP.density);
  $('latin').value = APP.loc.lat.toFixed(4);
  $('lonin').value = APP.loc.lon.toFixed(4);
  APP.view.az = 0;
  APP.view.alt = clamp(Math.abs(APP.loc.lat) * 0.7, 20, 50);
}

/* -------------------------------------------------------------- location */
function setLocation(loc) {
  APP.loc = Object.assign({ elev: 0 }, loc);
  $('latin').value = loc.lat.toFixed(4);
  $('lonin').value = loc.lon.toFixed(4);
  updateLocationChip();
  invalidate();
  savePrefs();
}
function updateLocationChip() {
  $('locname').textContent = APP.loc.name;
  $('locdet').textContent = APP.loc.region ? '· ' + APP.loc.region : '';
}
function requestGeolocation(silent) {
  if (!navigator.geolocation) { if (!silent) toast('This browser cannot share a location'); return; }
  if (!silent) toast('Asking your browser for your location…');
  navigator.geolocation.getCurrentPosition((pos) => {
    let tz = null;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { }
    setLocation({
      lat: pos.coords.latitude, lon: pos.coords.longitude,
      elev: pos.coords.altitude || 0,
      name: 'My location', region: fmtLat(pos.coords.latitude) + ' ' + fmtLon(pos.coords.longitude),
      tz, approx: false,
    });
    APP.view.alt = clamp(Math.abs(APP.loc.lat) * 0.7, 20, 50);
    if (!silent) toast('Showing the sky from your location');
  }, (err) => {
    if (!silent) toast('Could not get your location — pick a city or type coordinates instead');
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
}
function renderCities(q) {
  const s = q.trim().toLowerCase();
  const list = (s ? CITIES.filter(c => c[0].toLowerCase().includes(s) || c[1].toLowerCase().includes(s))
                  : CITIES).slice(0, 60);
  $('cityresults').innerHTML = list.map((c, i) =>
    `<li data-c="${CITIES.indexOf(c)}"><span class="ic">🌍</span>
      <span class="tx"><b>${esc(c[0])}</b><span>${esc(c[1])} · ${fmtLat(c[2])} ${fmtLon(c[3])}</span></span></li>`
  ).join('') || '<li class="empty">No city matched — type coordinates below instead.</li>';
  $('cityresults').querySelectorAll('li[data-c]').forEach(li => {
    li.onclick = () => {
      const c = CITIES[+li.dataset.c];
      setLocation({ lat: c[2], lon: c[3], elev: 0, name: c[0], region: c[1], tz: c[4], approx: false });
      APP.view.alt = clamp(Math.abs(c[2]) * 0.7, 20, 50);
      $('citywrap').style.display = 'none';
      toast('Now showing the sky from ' + c[0]);
    };
  });
}

/* ------------------------------------------------------------------ time */
function goLive() {
  APP.time.live = true; APP.time.paused = false; APP.time.rate = 1;
  APP.time.ms = Date.now();
}
function togglePlay() {
  const T = APP.time;
  if (T.live) { T.live = false; T.paused = true; return; }
  T.paused = !T.paused;
}
function stepRate(dir) {
  const steps = [-86400, -21600, -3600, -600, -60, -1, 1, 60, 600, 3600, 21600, 86400];
  const T = APP.time;
  T.live = false; T.paused = false;
  let i = steps.indexOf(T.rate);
  if (i < 0) i = steps.indexOf(1);
  T.rate = steps[clamp(i + dir, 0, steps.length - 1)];
}
function shiftTime(ms) {
  APP.time.live = false; APP.time.paused = true;
  APP.time.ms += ms;
  $('dtin').value = TZ.toInput(APP.time.ms);
}
function setTonight(hour, dayOffset = 0) {
  const p = TZ.parts(Date.now());
  const wall = Date.UTC(p.y, p.mo, p.d + dayOffset, hour, 0);
  let utc = wall - TZ.offset(wall);
  utc = wall - TZ.offset(utc);
  APP.time.live = false; APP.time.paused = true; APP.time.ms = utc;
  $('dtin').value = TZ.toInput(utc);
}

/* ------------------------------------------------------------ satellites */
const SAT_NAMES = {
  25544: 'ISS', 48274: 'Tiangong', 20580: 'Hubble', 25338: 'NOAA 15',
  28654: 'NOAA 18', 33591: 'NOAA 19', 27424: 'Aqua', 25994: 'Terra',
};
// extra search words for the two headline stations
const SAT_ALIAS = {
  25544: 'International Space Station Zarya',
  48274: 'Chinese Space Station CSS Tianhe',
};
const FEATURED = new Set([25544, 48274]);

/* ---------------------------------------------------------------------------
   Where satellite orbital elements come from.

   First choice is satellites.json sitting next to this page — run
   build/fetch_satellites.js on a daily cron to keep it fresh and your visitors
   never touch CelesTrak at all, which is what their usage policy asks of busy
   sites. If that file is absent the page falls back to querying CelesTrak
   directly, so a bare index.html with nothing alongside it still works.
--------------------------------------------------------------------------- */
const SAT_MIRROR = 'satellites.json';
const SAT_SOURCES = [
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json',
];

async function fetchMirror() {
  try {
    const r = await fetch(SAT_MIRROR, { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.sats;
    return Array.isArray(list) && list.length ? list : null;
  } catch (e) { return null; }   // no mirror deployed; that is fine
}

async function fetchCelestrak() {
  const parts = await Promise.all(SAT_SOURCES.map(u =>
    fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : [])));
  const all = [].concat(...parts);
  return all.length ? all : null;
}

async function loadSatellites() {
  const CACHE = 'starmap.sats.v1';
  const MAXAGE = 6 * 3600 * 1000;
  let raw = null;
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (c && Date.now() - c.at < MAXAGE && Array.isArray(c.data)) {
      raw = c.data;
      SATS.source = 'cache';
    }
  } catch (e) { }

  if (!raw) {
    raw = await fetchMirror();
    if (raw) SATS.source = 'mirror';
  }
  if (!raw) {
    try {
      raw = await fetchCelestrak();
      if (raw) SATS.source = 'celestrak';
    } catch (e) { raw = null; }
  }
  if (!raw) {
    SATS.error = 'Satellite orbital elements could not be downloaded.';
    noteSatelliteProblem();
    return;
  }
  if (SATS.source !== 'cache') {
    try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), data: raw })); }
    catch (e) { /* quota or private mode */ }
  }

  const seen = new Set();
  for (const omm of raw) {
    const id = +omm.NORAD_CAT_ID;
    if (seen.has(id)) continue;
    seen.add(id);
    const rec = sgp4init(omm);
    if (!rec) continue;
    SATS.list.push({
      rec, noradId: id, name: omm.OBJECT_NAME,
      shortName: SAT_NAMES[id] || omm.OBJECT_NAME.replace(/\s*\(.*\)$/, ''),
      alias: SAT_ALIAS[id] || '',
      featured: FEATURED.has(id),
    });
  }
  SATS.loaded = true;
  SATS.fetchedAt = Date.now();

  // Elements go unusable after 14 days, so surface a stalling mirror early
  // rather than letting satellites quietly vanish.
  const newest = SATS.list.reduce((a, s) => Math.max(a, s.rec.epochJd), 0);
  SATS.ageDays = newest ? (jdFromDate(new Date()) - newest) : null;
  if (SATS.ageDays > 7) {
    SATS.error = 'The satellite orbital elements are ' + SATS.ageDays.toFixed(0) +
      ' days old. They stop being usable after 14 days' +
      (SATS.source === 'mirror' ? ' — the satellites.json mirror needs refreshing.' : '.');
    noteSatelliteProblem();
  }
}

function noteSatelliteProblem() {
  if (!SATS.error) return;
  const el = $('about');
  if (el && !el.dataset.warned) {
    el.dataset.warned = '1';
    el.insertAdjacentHTML('beforebegin',
      '<p class="note" style="color:#ffb0b0">' + esc(SATS.error) +
      ' Everything else works offline; satellites need a connection to celestrak.org.</p>');
  }
}

/* ----------------------------------------------------------------- toast */
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3600);
}

let booted = false;
function bootOnce() { if (!booted) { booted = true; boot(); } }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootOnce);
else bootOnce();
