/* ------------------------------------------------------------------ astro --
   Time scales, precession, horizontal coordinates, Sun, Moon and planets.
   Positions are computed in the J2000 mean equatorial frame and precessed to
   the epoch of date, so everything shares one rotation matrix at draw time.
---------------------------------------------------------------------------- */
const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;
const AU_KM = 149597870.7;

const norm360 = (d) => { d %= 360; return d < 0 ? d + 360 : d; };
const normRad = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };

function jdFromDate(date) { return date.getTime() / 86400000 + 2440587.5; }
function dateFromJd(jd) { return new Date((jd - 2440587.5) * 86400000); }
function centuries(jd) { return (jd - 2451545.0) / 36525; }

/* Greenwich mean sidereal time, degrees. */
function gmst(jd) {
  const T = centuries(jd);
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - T * T * T / 38710000);
}

/* Mean obliquity of the ecliptic, radians (IAU 1980). */
function obliquity(jd) {
  const T = centuries(jd);
  return (23.439291111 - 0.0130041667 * T - 1.6667e-7 * T * T + 5.02778e-7 * T * T * T) * D2R;
}

/* --------------------------------------------------------------- vectors -- */
function raDecToVec(raDeg, decDeg) {
  const ra = raDeg * D2R, dec = decDeg * D2R, c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}
function vecToRaDec(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { ra: norm360(Math.atan2(v[1], v[0]) * R2D), dec: Math.asin(v[2] / r) * R2D, dist: r };
}
function eclToEq(lonDeg, latDeg, distance, eps) {
  const l = lonDeg * D2R, b = latDeg * D2R;
  const cb = Math.cos(b);
  const x = cb * Math.cos(l), y = cb * Math.sin(l), z = Math.sin(b);
  const ce = Math.cos(eps), se = Math.sin(eps);
  return [distance * x, distance * (y * ce - z * se), distance * (y * se + z * ce)];
}

/* ------------------------------------------------------------ precession --
   IAU 1976 rotation from mean equator/equinox of J2000 to that of date.     */
function precessionMatrix(jd) {
  const T = centuries(jd);
  const s = 1 / 3600 * D2R;
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * s;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * s;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * s;
  const cz = Math.cos(zeta), sz = Math.sin(zeta);
  const cZ = Math.cos(z), sZ = Math.sin(z);
  const ct = Math.cos(theta), st = Math.sin(theta);
  return [
    cz * ct * cZ - sz * sZ, -sz * ct * cZ - cz * sZ, -st * cZ,
    cz * ct * sZ + sz * cZ, -sz * ct * sZ + cz * cZ, -st * sZ,
    cz * st, -sz * st, ct,
  ];
}

/* ------------------------------------------------------------- horizontal --
   Combined matrix: J2000 equatorial vector -> (north, east, zenith).
   Folding precession in means star vectors never have to be recomputed.     */
function skyMatrix(jd, latDeg, lonDeg) {
  const lst = norm360(gmst(jd) + lonDeg) * D2R;
  const lat = latDeg * D2R;
  const cl = Math.cos(lst), sl = Math.sin(lst);
  const cp = Math.cos(lat), sp = Math.sin(lat);
  // equatorial-of-date -> horizontal
  const H = [
    -sp * cl, -sp * sl, cp,
    -sl, cl, 0,
    cp * cl, cp * sl, sp,
  ];
  const P = precessionMatrix(jd);
  const M = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += H[i * 3 + k] * P[k * 3 + j];
      M[i * 3 + j] = s;
    }
  M.lst = lst * R2D;
  return M;
}

function applyMat(M, v) {
  return [
    M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
    M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
    M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
  ];
}

/* Horizontal unit vector -> altitude/azimuth in degrees. */
function vecToAltAz(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return {
    alt: Math.asin(v[2] / r) * R2D,
    az: norm360(Math.atan2(v[1], v[0]) * R2D),
  };
}
function altAzToVec(altDeg, azDeg) {
  const a = altDeg * D2R, z = azDeg * D2R, ca = Math.cos(a);
  return [ca * Math.cos(z), ca * Math.sin(z), Math.sin(a)];
}

/* Bennett's refraction formula; apparent minus true altitude, degrees. */
function refraction(altDeg) {
  if (altDeg < -2) return 0;
  const a = Math.max(altDeg, -0.5);
  return (1.02 / Math.tan((a + 10.3 / (a + 5.11)) * D2R)) / 60;
}

/* ---------------------------------------------------------------- planets --
   Keplerian elements and centennial rates, JPL "Approximate Positions of the
   Planets" (valid 1800-2050, good to roughly an arcminute).                 */
const PLANET_ELEMENTS = {
  Mercury: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593,
    0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  Venus: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255,
    0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  Earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0,
    0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  Mars: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891,
    0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  Jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909,
    -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  Saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448,
    -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  Uranus: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503,
    -0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  Neptune: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574,
    0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
};

/* Heliocentric position in the J2000 ecliptic frame, AU. */
function heliocentric(name, jd) {
  const e0 = PLANET_ELEMENTS[name];
  const T = centuries(jd);
  const a = e0[0] + e0[6] * T;
  const e = e0[1] + e0[7] * T;
  const I = (e0[2] + e0[8] * T) * D2R;
  const L = e0[3] + e0[9] * T;
  const wbar = e0[4] + e0[10] * T;
  const O = (e0[5] + e0[11] * T) * D2R;

  const w = (wbar - (e0[5] + e0[11] * T)) * D2R;      // argument of perihelion
  let M = norm360(L - wbar);
  if (M > 180) M -= 360;
  M *= D2R;

  // Kepler's equation, Newton-Raphson
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 12; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }

  // position in the orbital plane
  const xv = a * (Math.cos(E) - e);
  const yv = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(O), sO = Math.sin(O);
  const cI = Math.cos(I), sI = Math.sin(I);

  // rotate: perihelion -> node -> ecliptic
  const xh = (cw * cO - sw * sO * cI) * xv + (-sw * cO - cw * sO * cI) * yv;
  const yh = (cw * sO + sw * cO * cI) * xv + (-sw * sO + cw * cO * cI) * yv;
  const zh = (sw * sI) * xv + (cw * sI) * yv;
  return [xh, yh, zh];
}

/* Geocentric equatorial J2000 vector (AU) for a planet, light-time corrected. */
function planetGeocentric(name, jd) {
  const earth = heliocentric('Earth', jd);
  let p = heliocentric(name, jd);
  let g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];
  // one light-time iteration is plenty at this accuracy
  const lt = Math.hypot(g[0], g[1], g[2]) * 0.0057755183;
  p = heliocentric(name, jd - lt);
  g = [p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]];

  const eps = obliquity(2451545.0); // J2000 frame
  const ce = Math.cos(eps), se = Math.sin(eps);
  return {
    eq: [g[0], g[1] * ce - g[2] * se, g[1] * se + g[2] * ce],
    helio: p,
    earth,
  };
}

/* Sun: geocentric equatorial J2000 vector, AU. */
function sunGeocentric(jd) {
  const e = heliocentric('Earth', jd);
  const g = [-e[0], -e[1], -e[2]];
  const eps = obliquity(2451545.0);
  const ce = Math.cos(eps), se = Math.sin(eps);
  return [g[0], g[1] * ce - g[2] * se, g[1] * se + g[2] * ce];
}

/* ------------------------------------------------------------------- moon --
   Truncated ELP-2000/82 (Meeus ch. 47). Roughly 10 arcsec in longitude.     */
const MOON_LON = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];
const MOON_LAT = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
];

/* Geocentric ecliptic longitude/latitude (deg) and distance (km). */
function moonPosition(jd) {
  const T = centuries(jd);
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T * T
    + T * T * T / 538841 - T * T * T * T / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T * T
    + T * T * T / 545868 - T * T * T * T / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T * T
    + T * T * T / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T * T
    + T * T * T / 69699 - T * T * T * T / 14712000);
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T * T
    - T * T * T / 3526000 + T * T * T * T / 863310000);
  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.290 * T);
  const A3 = norm360(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;

  let sumL = 0, sumR = 0, sumB = 0;
  for (const [d, m, mp, f, cl, cr] of MOON_LON) {
    const arg = (d * D + m * M + mp * Mp + f * F) * D2R;
    const ecc = Math.abs(m) === 1 ? E : (Math.abs(m) === 2 ? E * E : 1);
    sumL += cl * ecc * Math.sin(arg);
    sumR += (cr || 0) * ecc * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of MOON_LAT) {
    const arg = (d * D + m * M + mp * Mp + f * F) * D2R;
    const ecc = Math.abs(m) === 1 ? E : (Math.abs(m) === 2 ? E * E : 1);
    sumB += cb * ecc * Math.sin(arg);
  }
  sumL += 3958 * Math.sin(A1 * D2R) + 1962 * Math.sin((Lp - F) * D2R)
    + 318 * Math.sin(A2 * D2R);
  sumB += -2235 * Math.sin(Lp * D2R) + 382 * Math.sin(A3 * D2R)
    + 175 * Math.sin((A1 - F) * D2R) + 175 * Math.sin((A1 + F) * D2R)
    + 127 * Math.sin((Lp - Mp) * D2R) - 115 * Math.sin((Lp + Mp) * D2R);

  return {
    lon: norm360(Lp + sumL / 1e6),
    lat: sumB / 1e6,
    dist: 385000.56 + sumR / 1000, // km
  };
}

/* Geocentric equatorial J2000 vector for the Moon, in AU. */
function moonGeocentric(jd) {
  const m = moonPosition(jd);
  const epsDate = obliquity(jd);
  const v = eclToEq(m.lon, m.lat, m.dist / AU_KM, epsDate);
  // ELP is referred to the ecliptic of date; rotate back to J2000.
  const P = precessionMatrix(jd);
  const inv = [P[0], P[3], P[6], P[1], P[4], P[7], P[2], P[5], P[8]];
  return {
    vec: [
      inv[0] * v[0] + inv[1] * v[1] + inv[2] * v[2],
      inv[3] * v[0] + inv[4] * v[1] + inv[5] * v[2],
      inv[6] * v[0] + inv[7] * v[1] + inv[8] * v[2],
    ],
    distKm: m.dist,
  };
}

/* Illuminated fraction and position angle of the bright limb. */
function phaseOf(bodyVec, sunVec) {
  const b = Math.hypot(...bodyVec), s = Math.hypot(...sunVec);
  // vector from body to Sun
  const bs = [sunVec[0] - bodyVec[0], sunVec[1] - bodyVec[1], sunVec[2] - bodyVec[2]];
  const bsLen = Math.hypot(...bs);
  const cosPhase = -(bodyVec[0] * bs[0] + bodyVec[1] * bs[1] + bodyVec[2] * bs[2]) / (b * bsLen);
  const phase = Math.acos(Math.max(-1, Math.min(1, cosPhase)));
  const k = (1 + Math.cos(phase)) / 2;
  return { k, phaseAngle: phase * R2D, sunDist: s, bodyDist: b };
}

/* Observer's geocentric position in the J2000 equatorial frame, AU. */
function observerVec(jd, latDeg, lonDeg, elevM = 0) {
  const lat = latDeg * D2R;
  const f = 1 / 298.257223563, aE = 6378.137;
  const C = 1 / Math.sqrt(Math.cos(lat) ** 2 + (1 - f) ** 2 * Math.sin(lat) ** 2);
  const S = (1 - f) ** 2 * C;
  const rho = (aE * C + elevM / 1000) / AU_KM;
  const rhoZ = (aE * S + elevM / 1000) / AU_KM;
  const lst = norm360(gmst(jd) + lonDeg) * D2R;
  const vDate = [rho * Math.cos(lat) * Math.cos(lst), rho * Math.cos(lat) * Math.sin(lst), rhoZ * Math.sin(lat)];
  const P = precessionMatrix(jd);
  return [
    P[0] * vDate[0] + P[3] * vDate[1] + P[6] * vDate[2],
    P[1] * vDate[0] + P[4] * vDate[1] + P[7] * vDate[2],
    P[2] * vDate[0] + P[5] * vDate[1] + P[8] * vDate[2],
  ];
}

if (typeof module !== 'undefined') module.exports = {
  D2R, R2D, AU_KM, norm360, jdFromDate, dateFromJd, gmst, obliquity,
  raDecToVec, vecToRaDec, precessionMatrix, skyMatrix, applyMat,
  vecToAltAz, altAzToVec, refraction, heliocentric, planetGeocentric,
  sunGeocentric, moonPosition, moonGeocentric, phaseOf, observerVec, eclToEq,
};
