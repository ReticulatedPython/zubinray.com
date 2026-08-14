// Mirror CelesTrak's orbital elements onto your own host.
//
//   node build/fetch_satellites.js
//
// Writes satellites.json next to index.html. The page loads that file if it is
// there and only falls back to querying CelesTrak directly if it is missing, so
// running this on a schedule means your visitors never touch CelesTrak at all.
//
// Run it once a day. Orbital elements stay accurate for far longer than that
// (a day-old ISS element set is within about 0.3 km), but the page refuses
// elements more than 14 days past their epoch, and the ISS raises its orbit
// roughly monthly — which invalidates older elements in one step. Daily leaves
// plenty of margin for a few failed runs.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'satellites.json');

const SOURCES = [
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json',
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json',
];

// Only the fields SGP4 actually needs, which keeps the file small.
const KEEP = [
  'OBJECT_NAME', 'NORAD_CAT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY',
  'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR',
];

// An identifiable agent is the polite convention and makes us easier to
// whitelist than an anonymous one.
const UA = 'star-map/1.0 (+https://github.com/ReticulatedPython/starmap)';

/* CelesTrak asks clients to stop on a non-200 rather than retry blindly, so
   only genuine transport failures are retried, and slowly. */
async function get(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status + ' ' + res.statusText), { fatal: true });
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      const cause = e.cause ? ` (${e.cause.code || e.cause.message})` : '';
      console.error(`  attempt ${attempt}/3 failed: ${e.message}${cause}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 5000));
    }
  }
  const cause = lastErr && lastErr.cause
    ? ' — underlying cause: ' + (lastErr.cause.code || lastErr.cause.message) : '';
  throw new Error(url + ': ' + lastErr.message + cause);
}

async function main() {
  const merged = new Map();
  for (const url of SOURCES) {
    const list = await get(url);
    if (!Array.isArray(list)) throw new Error(url + ' did not return a JSON array');
    for (const s of list) {
      const id = +s.NORAD_CAT_ID;
      if (!id || merged.has(id)) continue;
      const rec = {};
      for (const k of KEEP) rec[k] = s[k];
      merged.set(id, rec);
    }
    await new Promise(r => setTimeout(r, 1000)); // be a polite client
  }

  const sats = [...merged.values()];
  if (!sats.length) throw new Error('no satellites returned; refusing to overwrite');

  const newest = sats.reduce((a, s) => Math.max(a, Date.parse(s.EPOCH + 'Z') || 0), 0);
  const payload = { fetched: new Date().toISOString(), sats };

  // Write via a temporary file so a half-finished download can never be served.
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, OUT);

  console.log('wrote ' + OUT);
  console.log('  ' + sats.length + ' satellites, ' +
    (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB');
  console.log('  newest element epoch: ' + new Date(newest).toISOString() +
    ' (' + ((Date.now() - newest) / 3600000).toFixed(1) + ' hours old)');
}

main().catch(e => {
  console.error('fetch_satellites failed:', e.message);
  console.error('The existing satellites.json has been left untouched.');
  process.exit(1);
});
