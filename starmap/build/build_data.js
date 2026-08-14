// Build compact astronomical data blobs for the star map app.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'catalogues');

// Upstream catalogues, fetched once into build/catalogues/ and cached there.
const SOURCES = {
  'hyg.csv': 'https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv',
  'constellations.lines.json': 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.lines.json',
  'constellations.json': 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/constellations.json',
  'messier.json': 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/messier.json',
  'dsos.14.json': 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/dsos.14.json',
  // Roman (1987), VizieR VI/42: IAU constellation boundaries arranged for
  // point lookup. Boundaries are given for equinox B1875.
  'boundaries.dat': 'https://cdsarc.cds.unistra.fr/ftp/VI/42/data.dat',
};

async function ensureSources() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  for (const [name, url] of Object.entries(SOURCES)) {
    const f = path.join(DIR, name);
    if (fs.existsSync(f) && fs.statSync(f).size > 1000) continue;
    process.stderr.write('downloading ' + name + ' ... ');
    const r = await fetch(url);
    if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    process.stderr.write('ok\n');
  }
}

const r = (n, d) => {
  const v = +(+n).toFixed(d);
  return Object.is(v, -0) ? 0 : v;
};
const lonToRa = (lon) => { let x = +lon % 360; if (x < 0) x += 360; return x; };

// ---------------------------------------------------------------- STARS ----
// HYG: ra is in decimal HOURS, dec in degrees, mag apparent V, ci = B-V.
function buildStars() {
  const raw = fs.readFileSync(path.join(DIR, 'hyg.csv'), 'utf8');
  const lines = raw.split('\n');
  const head = parseCsvLine(lines[0]);
  const ix = {};
  head.forEach((h, i) => ix[h.replace(/"/g, '')] = i);

  const MAGLIM = 6.5;
  const stars = [];
  for (let i = 1; i < lines.length; i++) {
    const L = lines[i];
    if (!L || L.length < 10) continue;
    const f = parseCsvLine(L);
    const mag = parseFloat(f[ix.mag]);
    if (!isFinite(mag) || mag > MAGLIM) continue;
    const id = f[ix.id];
    if (id === '0') continue; // Sol
    const ra = parseFloat(f[ix.ra]) * 15; // hours -> degrees
    const dec = parseFloat(f[ix.dec]);
    if (!isFinite(ra) || !isFinite(dec)) continue;
    let ci = parseFloat(f[ix.ci]);
    if (!isFinite(ci)) ci = 0.4;
    stars.push({
      ra, dec, mag, ci,
      hip: f[ix.hip] ? parseInt(f[ix.hip], 10) : 0,
      proper: (f[ix.proper] || '').trim(),
      bayer: (f[ix.bayer] || '').trim(),
      flam: (f[ix.flam] || '').trim(),
      con: (f[ix.con] || '').trim(),
      spect: (f[ix.spect] || '').trim(),
      dist: parseFloat(f[ix.dist]) || 0,
    });
  }
  // brightest first: lets the renderer bail out early on a magnitude cut
  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const GREEK = {
  Alp: 'α', Bet: 'β', Gam: 'γ', Del: 'δ', Eps: 'ε', Zet: 'ζ', Eta: 'η', The: 'θ',
  Iot: 'ι', Kap: 'κ', Lam: 'λ', Mu: 'μ', Nu: 'ν', Xi: 'ξ', Omi: 'ο', Pi: 'π',
  Rho: 'ρ', Sig: 'σ', Tau: 'τ', Ups: 'υ', Phi: 'φ', Chi: 'χ', Psi: 'ψ', Ome: 'ω',
};
const SUPER = { '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵' };

// HYG writes Bayer letters as "Alp", with a numbered component as "Alp-1".
function greekify(bayer) {
  if (!bayer) return '';
  const m = /^([A-Za-z]+)(?:-(\d))?$/.exec(bayer);
  if (!m) return bayer;
  const letter = GREEK[m[1]] || m[1];
  return letter + (m[2] ? (SUPER[m[2]] || m[2]) : '');
}

function main() {
  const stars = buildStars();
  console.error('stars <=6.5:', stars.length);

  // Packed numeric block: ra, dec, mag, ci per star.
  const nums = [];
  for (const s of stars) nums.push(r(s.ra, 4), r(s.dec, 4), r(s.mag, 2), r(s.ci, 2));

  // Sparse label table, only for stars worth naming.
  const labels = {};
  stars.forEach((s, i) => {
    const bayer = greekify(s.bayer);
    const desig = bayer && s.con ? bayer + ' ' + s.con
                : (s.flam && s.con ? s.flam + ' ' + s.con : '');
    if (!s.proper && !desig) return;
    if (!s.proper && s.mag > 4.6) return; // keep greek-letter labels to the brighter stars
    const e = {};
    if (s.proper) e.n = s.proper;
    if (desig) e.d = desig;
    if (s.hip) e.h = s.hip;
    if (s.spect) e.s = s.spect.slice(0, 4);
    if (s.dist && s.dist < 100000) e.p = r(s.dist * 3.26156, 1); // light years
    labels[i] = e;
  });
  console.error('labelled stars:', Object.keys(labels).length);

  // Index by HIP so constellation art can bind to catalogue rows.
  const hipIndex = {};
  stars.forEach((s, i) => { if (s.hip) hipIndex[s.hip] = i; });

  // -------------------------------------------------- CONSTELLATION LINES --
  const clines = JSON.parse(fs.readFileSync(path.join(DIR, 'constellations.lines.json'), 'utf8'));
  const cnames = JSON.parse(fs.readFileSync(path.join(DIR, 'constellations.json'), 'utf8'));

  // d3-celestial labels both Serpens halves "Serpens Cauda"; Ser1 is really Caput.
  const NAME_FIX = { Ser1: 'Serpens Caput', Ser2: 'Serpens Cauda' };

  const nameById = {};
  for (const f of cnames.features) {
    nameById[f.id] = {
      name: NAME_FIX[f.id] || f.properties.name,
      gen: f.properties.gen,
      rank: parseInt(f.properties.rank, 10) || 3,
      ra: r(lonToRa(f.geometry.coordinates[0]), 3),
      dec: r(f.geometry.coordinates[1], 3),
    };
  }

  const constellations = [];
  const byId = new Map();
  for (const f of clines.features) {
    const meta = nameById[f.id] || { name: f.id, rank: 3, ra: 0, dec: 0 };
    const segs = f.geometry.coordinates.map(seg =>
      seg.map(([lon, lat]) => [r(lonToRa(lon), 3), r(lat, 3)])
    );
    // Serpens ships as two features under one id; keep it as a single figure.
    const existing = byId.get(f.id);
    if (existing) { existing.l.push(...segs); continue; }
    const rec = { id: f.id, n: meta.name, r: meta.rank, c: [meta.ra, meta.dec], l: segs };
    byId.set(f.id, rec);
    constellations.push(rec);
  }
  console.error('constellations:', constellations.length,
    'rank1:', constellations.filter(c => c.r === 1).length,
    'rank2:', constellations.filter(c => c.r === 2).length);

  // ------------------------------------------------------ DEEP SKY OBJECTS --
  const messier = JSON.parse(fs.readFileSync(path.join(DIR, 'messier.json'), 'utf8'));
  const d14 = JSON.parse(fs.readFileSync(path.join(DIR, 'dsos.14.json'), 'utf8'));

  // Common names for popular non-Messier targets, keyed by catalogue designation.
  const NAMED = {
    'NGC 869': 'Double Cluster (h Persei)', 'NGC 884': 'Double Cluster (χ Persei)',
    'NGC 7000': 'North America Nebula', 'NGC 253': 'Sculptor Galaxy',
    'NGC 5128': 'Centaurus A', 'NGC 4755': 'Jewel Box Cluster',
    'NGC 3372': 'Carina Nebula', 'NGC 2070': 'Tarantula Nebula',
    'NGC 6543': "Cat's Eye Nebula", 'NGC 7293': 'Helix Nebula',
    'NGC 6960': 'Veil Nebula (West)', 'NGC 6992': 'Veil Nebula (East)',
    'NGC 2237': 'Rosette Nebula', 'IC 434': 'Horsehead Nebula',
    'NGC 2264': 'Christmas Tree Cluster', 'NGC 457': 'Owl Cluster',
    'NGC 104': '47 Tucanae', 'NGC 5139': 'Omega Centauri',
    'NGC 4565': 'Needle Galaxy', 'NGC 891': 'Silver Sliver Galaxy',
    'NGC 6946': 'Fireworks Galaxy', 'NGC 7331': 'Deer Lick Galaxy',
    'NGC 6822': "Barnard's Galaxy", 'IC 1396': 'Elephant Trunk Nebula',
    'NGC 1499': 'California Nebula', 'NGC 7635': 'Bubble Nebula',
    'NGC 6888': 'Crescent Nebula', 'NGC 281': 'Pacman Nebula',
    'NGC 2244': 'Rosette Cluster', 'NGC 3532': 'Wishing Well Cluster',
    'NGC 6231': 'Northern Jewel Box', 'NGC 2451': 'Puppis Cluster',
    'NGC 2477': 'Southern Beehive', 'NGC 6752': 'Great Peacock Globular',
    'NGC 2359': "Thor's Helmet", 'NGC 3242': "Ghost of Jupiter",
    'NGC 2392': 'Eskimo Nebula', 'NGC 40': 'Bow-Tie Nebula',
    'NGC 6826': 'Blinking Planetary', 'NGC 7009': 'Saturn Nebula',
    'NGC 3628': 'Hamburger Galaxy', 'NGC 4631': 'Whale Galaxy',
    'NGC 4656': 'Hockey Stick Galaxy', 'NGC 5907': 'Splinter Galaxy',
    'NGC 2903': 'Queen of Leo', 'NGC 1300': 'Barred Spiral NGC 1300',
    'NGC 300': 'Sculptor Pinwheel', 'NGC 55': 'String of Pearls Galaxy',
    'NGC 5866': 'Spindle Galaxy', 'NGC 6811': 'Hole in a Cluster',
    'IC 2602': 'Southern Pleiades', 'IC 2391': 'Omicron Velorum Cluster',
    'IC 4665': 'Summer Beehive', 'IC 5146': 'Cocoon Nebula',
    'NGC 6543': "Cat's Eye Nebula", 'NGC 1980': 'Lost Jewel of Orion',
    'NGC 3195': 'Chamaeleon Planetary', 'NGC 2438': 'Planetary in M46',
    'NGC 6934': 'Delphinus Globular', 'NGC 7789': "Caroline's Rose",
    'NGC 752': 'Golf Ball Cluster', 'NGC 1502': 'Kemble’s Cascade Cluster',
    'NGC 6885': 'Vulpecula Cluster', 'NGC 6210': 'Turtle Nebula',
    'NGC 7662': 'Blue Snowball', 'NGC 246': 'Skull Nebula',
    'NGC 1360': "Robin's Egg Nebula", 'NGC 3115': 'Spindle Galaxy (Sextans)',
    'NGC 4038': 'Antennae Galaxies', 'NGC 5194': 'Whirlpool Galaxy',
    'NGC 205': 'Le Gentil (M110)', 'NGC 1316': 'Fornax A',
    'NGC 1275': 'Perseus A', 'NGC 4486': 'Virgo A (M87)',
    'NGC 5236': 'Southern Pinwheel', 'NGC 6302': 'Butterfly Nebula',
    'NGC 6334': 'Cat’s Paw Nebula', 'NGC 6357': 'Lobster Nebula',
    'NGC 3576': 'Statue of Liberty Nebula', 'NGC 3603': 'NGC 3603 Cluster',
    'NGC 2070': 'Tarantula Nebula', 'NGC 602': 'SMC Cluster NGC 602',
    'NGC 2516': 'Southern Beehive (Diamond Cluster)',
    'NGC 6541': 'Corona Australis Globular', 'NGC 1851': 'Columba Globular',
    'NGC 362': 'Tucana Globular', 'NGC 288': 'Sculptor Globular',
  };

  const TYPE_MAP = {
    g: 'galaxy', gg: 'galaxy', s: 'galaxy', s0: 'galaxy', sd: 'galaxy',
    i: 'galaxy', e: 'galaxy', gcl: 'galaxy cluster', cg: 'galaxy',
    oc: 'open cluster', gc: 'globular cluster', pn: 'planetary nebula',
    dn: 'dark nebula', bn: 'bright nebula', sfr: 'nebula',
    rn: 'reflection nebula', en: 'emission nebula', snr: 'supernova remnant',
    ast: 'asterism', kt: 'knot', pd: 'part of galaxy', pos: 'position',
  };

  // Catalogue common names that read as ambiguous or clipped on their own.
  const ALT_FIX = {
    'Andromeda': 'Andromeda Galaxy', 'Triangulum': 'Triangulum Galaxy',
    'Sombrero': 'Sombrero Galaxy', 'Whirlpool': 'Whirlpool Galaxy',
    'Pinwheel': 'Pinwheel Galaxy', 'Southern Pinwheel': 'Southern Pinwheel Galaxy',
    'Spindle': 'Spindle Galaxy', 'Blackeye Galaxy': 'Black Eye Galaxy',
    'Bode´s Galaxy': "Bode's Galaxy", 'Cat’s Eye Galaxy': "Cat's Eye Galaxy",
    'Virgo A': 'Virgo A (M87)', 'Great Hercules Cluster': 'Great Globular Cluster in Hercules',
    'Milky Way patch': 'Sagittarius Star Cloud', 'Wild Duck': 'Wild Duck Cluster',
    'Butterfly': 'Butterfly Cluster', 'Beehive': 'Beehive Cluster',
    'Ptolemy´s Cluster': "Ptolemy's Cluster", 'Lagoon': 'Lagoon Nebula',
    'Trifid': 'Trifid Nebula', 'Eagle': 'Eagle Nebula', 'Omega': 'Omega Nebula',
    'Dumbbell': 'Dumbbell Nebula', 'Ring': 'Ring Nebula', 'Owl': 'Owl Nebula',
    'Little Dumbbell': 'Little Dumbbell Nebula', 'Wild Duck Cluster': 'Wild Duck Cluster',
  };

  const dsoMap = new Map(); // key: primary designation
  const addDso = (desig, alt, type, mag, dim, ra, dec, extraId) => {
    if (!isFinite(mag)) mag = 99;
    const key = desig;
    const prev = dsoMap.get(key);
    alt = alt ? (ALT_FIX[alt] || alt) : '';
    const rec = {
      d: desig,
      a: alt,
      t: TYPE_MAP[type] || type || '',
      m: r(mag, 1),
      s: dim || '',
      ra: r(ra, 4),
      dec: r(dec, 4),
      id2: extraId || '',
    };
    if (!prev || (!prev.a && rec.a)) dsoMap.set(key, rec);
  };

  // Messier first — richest metadata, and these are the headline objects.
  for (const f of messier.features) {
    const p = f.properties;
    addDso(p.name, p.alt, p.type, parseFloat(p.mag), p.dim,
      lonToRa(f.geometry.coordinates[0]), f.geometry.coordinates[1], p.desig);
  }

  // Everything else down to mag 10.5, plus anything we have a common name for.
  for (const f of d14.features) {
    const p = f.properties;
    const mag = parseFloat(p.mag);
    const desig = (p.desig || f.id || '').trim();
    if (!desig) continue;
    if (/^M ?\d+$/.test(desig)) continue; // Messier already loaded above
    const named = NAMED[f.id] || NAMED[desig] || '';
    // Only mainstream catalogues — the fringe ones list the illuminating star's
    // magnitude rather than the object's, which makes them useless to rank.
    if (!/^(NGC|IC|LMC|SMC) /.test(desig)) continue;
    if (!named && !(isFinite(mag) && mag <= 11)) continue;
    addDso(desig, named, p.type, mag, p.dim,
      lonToRa(f.geometry.coordinates[0]), f.geometry.coordinates[1], f.id !== desig ? f.id : '');
  }

  const dsos = [...dsoMap.values()].sort((a, b) => a.m - b.m);
  console.error('dsos:', dsos.length, 'named:', dsos.filter(d => d.a).length);

  // ------------------------------------------------ CONSTELLATION LOOKUP ----
  // "Lower RA, Upper RA, Lower Dec, abbreviation", ordered so the first row
  // that contains a point identifies its constellation.
  const bAbbr = [], bRows = [];
  const boundaryText = fs.readFileSync(path.join(DIR, 'boundaries.dat'), 'utf8');
  for (const line of boundaryText.split('\n')) {
    const m = /^\s*([\d.]+)\s+([\d.]+)\s+([-+]?[\d.]+)\s+([A-Za-z]{3})\s*$/.exec(line);
    if (!m) continue;
    const abbr = m[4];
    let i = bAbbr.indexOf(abbr);
    if (i < 0) { i = bAbbr.length; bAbbr.push(abbr); }
    bRows.push(r(+m[1], 4), r(+m[2], 4), r(+m[3], 4), i);
  }
  console.error('boundary rows:', bRows.length / 4, 'constellations:', bAbbr.length);

  // Full names, keyed by the same three letter abbreviations.
  const conNames = {};
  for (const c of constellations) conNames[c.id] = c.n;
  const bNames = bAbbr.map(a => conNames[a] || nameById[a]?.name || a);
  const missing = bAbbr.filter(a => !conNames[a]);
  if (missing.length) console.error('  no figure for:', missing.join(', '));

  // ---------------------------------------------------------------- EMIT ----
  const out = {
    starCount: stars.length,
    S: nums,
    SL: labels,
    HIP: hipIndex,
    C: constellations,
    D: dsos,
    B: { a: bAbbr, n: bNames, r: bRows },
  };
  const js = 'const SKYDATA=' + JSON.stringify(out) + ';';
  fs.writeFileSync(path.join(__dirname, 'skydata.js'), js);
  console.error('skydata.js bytes:', js.length);
}

ensureSources().then(main).catch(e => {
  console.error('build_data failed:', e.message);
  process.exit(1);
});
