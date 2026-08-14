/* ------------------------------------------------------------------- sgp4 --
   Near-Earth SGP4 (Vallado, "Revisiting Spacetrack Report #3"). Deep-space
   secular/resonance terms are omitted, so satellites with a period above
   225 minutes are rejected at init — every visually observable target
   (ISS, CSS, Starlink, the classic bright LEO objects) is well inside that.
---------------------------------------------------------------------------- */
const SGP4_MU = 398600.5;
const SGP4_RE = 6378.137;
const SGP4_XKE = 60.0 / Math.sqrt(SGP4_RE * SGP4_RE * SGP4_RE / SGP4_MU);
const SGP4_J2 = 0.00108262998905;
const SGP4_J3 = -0.00000253215306;
const SGP4_J4 = -0.00000161098761;
const SGP4_J3OJ2 = SGP4_J3 / SGP4_J2;
const X2O3 = 2 / 3;

/* Build a propagator from CelesTrak "OMM" JSON (or equivalent TLE fields). */
function sgp4init(omm) {
  const s = {};
  s.name = omm.OBJECT_NAME;
  s.noradId = omm.NORAD_CAT_ID;
  s.bstar = +omm.BSTAR;
  s.ecco = +omm.ECCENTRICITY;
  s.inclo = +omm.INCLINATION * Math.PI / 180;
  s.nodeo = +omm.RA_OF_ASC_NODE * Math.PI / 180;
  s.argpo = +omm.ARG_OF_PERICENTER * Math.PI / 180;
  s.mo = +omm.MEAN_ANOMALY * Math.PI / 180;
  const no = +omm.MEAN_MOTION * 2 * Math.PI / 1440; // rad/min
  s.epochJd = new Date(omm.EPOCH + (omm.EPOCH.endsWith('Z') ? '' : 'Z')).getTime()
    / 86400000 + 2440587.5;

  if (!isFinite(no) || no <= 0) return null;
  if (2 * Math.PI / no > 225) return null;   // deep space — not supported
  if (s.ecco < 0 || s.ecco >= 1) return null;

  const ss = 78 / SGP4_RE + 1;
  const qzms2t = Math.pow((120 - 78) / SGP4_RE, 4);

  const cosio = Math.cos(s.inclo), theta2 = cosio * cosio;
  const x3thm1 = 3 * theta2 - 1;
  const eosq = s.ecco * s.ecco;
  const betao2 = 1 - eosq, betao = Math.sqrt(betao2);

  // un-Kozai the mean motion (the classic 1.5*CK2 form, and CK2 = J2/2)
  const a1 = Math.pow(SGP4_XKE / no, X2O3);
  const del1 = 0.75 * SGP4_J2 * x3thm1 / (a1 * a1 * betao * betao2);
  const ao0 = a1 * (1 - del1 * (1 / 3 + del1 * (1 + 134 / 81 * del1)));
  const delo = 0.75 * SGP4_J2 * x3thm1 / (ao0 * ao0 * betao * betao2);
  s.no = no / (1 + delo);
  const ao = Math.pow(SGP4_XKE / s.no, X2O3);

  const sinio = Math.sin(s.inclo);
  const po = ao * betao2, posq = po * po;
  const con42 = 1 - 5 * theta2;
  s.con41 = -con42 - theta2 - theta2;
  s.x1mth2 = 1 - theta2;
  s.x7thm1 = 7 * theta2 - 1;
  s.cosio = cosio; s.sinio = sinio;

  const rp = ao * (1 - s.ecco);
  if (rp < 1) return null; // sub-surface perigee: decayed
  s.isimp = rp < (220 / SGP4_RE + 1);

  let sfour = ss, qzms24 = qzms2t;
  const perige = (rp - 1) * SGP4_RE;
  if (perige < 156) {
    sfour = perige < 98 ? 20 : perige - 78;
    qzms24 = Math.pow((120 - sfour) / SGP4_RE, 4);
    sfour = sfour / SGP4_RE + 1;
  }

  const pinvsq = 1 / posq;
  const tsi = 1 / (ao - sfour);
  const eta = ao * s.ecco * tsi, etasq = eta * eta, eeta = s.ecco * eta;
  const psisq = Math.abs(1 - etasq);
  const coef = qzms24 * Math.pow(tsi, 4);
  const coef1 = coef / Math.pow(psisq, 3.5);
  s.eta = eta;

  const cc2 = coef1 * s.no * (ao * (1 + 1.5 * etasq + eeta * (4 + etasq))
    + 0.375 * SGP4_J2 * tsi / psisq * s.con41 * (8 + 3 * etasq * (8 + etasq)));
  s.cc1 = s.bstar * cc2;
  const cc3 = s.ecco > 1e-4
    ? -2 * coef * tsi * SGP4_J3OJ2 * s.no * sinio / s.ecco : 0;
  s.cc4 = 2 * s.no * coef1 * ao * betao2 * (eta * (2 + 0.5 * etasq)
    + s.ecco * (0.5 + 2 * etasq)
    - SGP4_J2 * tsi / (ao * psisq) * (-3 * s.con41 * (1 - 2 * eeta + etasq * (1.5 - 0.5 * eeta))
      + 0.75 * s.x1mth2 * (2 * etasq - eeta * (1 + etasq)) * Math.cos(2 * s.argpo)));
  s.cc5 = 2 * coef1 * ao * betao2 * (1 + 2.75 * (etasq + eeta) + eeta * etasq);

  const cosio4 = theta2 * theta2;
  const temp1 = 1.5 * SGP4_J2 * pinvsq * s.no;
  const temp2 = 0.5 * temp1 * SGP4_J2 * pinvsq;
  const temp3 = -0.46875 * SGP4_J4 * pinvsq * pinvsq * s.no;

  s.mdot = s.no + 0.5 * temp1 * betao * s.con41
    + 0.0625 * temp2 * betao * (13 - 78 * theta2 + 137 * cosio4);
  s.argpdot = -0.5 * temp1 * con42 + 0.0625 * temp2 * (7 - 114 * theta2 + 395 * cosio4)
    + temp3 * (3 - 36 * theta2 + 49 * cosio4);
  const xhdot1 = -temp1 * cosio;
  s.nodedot = xhdot1 + (0.5 * temp2 * (4 - 19 * theta2) + 2 * temp3 * (3 - 7 * theta2)) * cosio;

  s.omgcof = s.bstar * cc3 * Math.cos(s.argpo);
  s.xmcof = s.ecco > 1e-4 ? -X2O3 * coef * s.bstar / eeta : 0;
  s.nodecf = 3.5 * betao2 * xhdot1 * s.cc1;
  s.t2cof = 1.5 * s.cc1;
  s.xlcof = Math.abs(cosio + 1) > 1.5e-12
    ? -0.25 * SGP4_J3OJ2 * sinio * (3 + 5 * cosio) / (1 + cosio)
    : -0.25 * SGP4_J3OJ2 * sinio * (3 + 5 * cosio) / 1.5e-12;
  s.aycof = -0.5 * SGP4_J3OJ2 * sinio;
  s.delmo = Math.pow(1 + eta * Math.cos(s.mo), 3);
  s.sinmao = Math.sin(s.mo);

  if (!s.isimp) {
    const cc1sq = s.cc1 * s.cc1;
    s.d2 = 4 * ao * tsi * cc1sq;
    const temp = s.d2 * tsi * s.cc1 / 3;
    s.d3 = (17 * ao + sfour) * temp;
    s.d4 = 0.5 * temp * ao * tsi * (221 * ao + 31 * sfour) * s.cc1;
    s.t3cof = s.d2 + 2 * cc1sq;
    s.t4cof = 0.25 * (3 * s.d3 + s.cc1 * (12 * s.d2 + 10 * cc1sq));
    s.t5cof = 0.2 * (3 * s.d4 + 12 * s.cc1 * s.d3 + 6 * s.d2 * s.d2
      + 15 * cc1sq * (2 * s.d2 + cc1sq));
  }
  return s;
}

/* Propagate to `tmin` minutes past epoch. Returns TEME position/velocity, km. */
function sgp4(s, tmin) {
  const t = tmin, t2 = t * t;
  const xmdf = s.mo + s.mdot * t;
  const argpdf = s.argpo + s.argpdot * t;
  const nodedf = s.nodeo + s.nodedot * t;
  let argpm = argpdf, mm = xmdf;
  const nodem0 = nodedf + s.nodecf * t2;

  let tempa = 1 - s.cc1 * t;
  let tempe = s.bstar * s.cc4 * t;
  let templ = s.t2cof * t2;

  if (!s.isimp) {
    const delomg = s.omgcof * t;
    const delmtemp = 1 + s.eta * Math.cos(xmdf);
    const delm = s.xmcof * (delmtemp * delmtemp * delmtemp - s.delmo);
    const tmp = delomg + delm;
    mm = xmdf + tmp;
    argpm = argpdf - tmp;
    const t3 = t2 * t, t4 = t3 * t;
    tempa = tempa - s.d2 * t2 - s.d3 * t3 - s.d4 * t4;
    tempe = tempe + s.bstar * s.cc5 * (Math.sin(mm) - s.sinmao);
    templ = templ + s.t3cof * t3 + t4 * (s.t4cof + t * s.t5cof);
  }

  let nm = s.no;
  let em = s.ecco - tempe;
  const am = Math.pow(SGP4_XKE / nm, X2O3) * tempa * tempa;
  nm = SGP4_XKE / Math.pow(am, 1.5);
  if (em >= 1 || em < -0.001) return null; // decayed / diverged
  if (em < 1e-6) em = 1e-6;
  mm = mm + s.no * templ;

  let xlm = mm + argpm + nodem0;
  const emsq = em * em, temp = 1 - emsq;
  const nodem = ((nodem0 % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  argpm = ((argpm % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  xlm = ((xlm % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  mm = ((xlm - argpm - nodem) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  // long-period periodics
  const axnl = em * Math.cos(argpm);
  const tempInv = 1 / (am * temp);
  const aynl = em * Math.sin(argpm) + tempInv * s.aycof;
  const xl = mm + argpm + nodem + tempInv * s.xlcof * axnl;

  // Kepler's equation
  let u = ((xl - nodem) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  let eo1 = u, tem5 = 9999.9, ktr = 1, sineo1 = 0, coseo1 = 0;
  while (Math.abs(tem5) >= 1e-12 && ktr <= 10) {
    sineo1 = Math.sin(eo1); coseo1 = Math.cos(eo1);
    tem5 = 1 - coseo1 * axnl - sineo1 * aynl;
    tem5 = (u - aynl * coseo1 + axnl * sineo1 - eo1) / tem5;
    if (Math.abs(tem5) >= 0.95) tem5 = tem5 > 0 ? 0.95 : -0.95;
    eo1 += tem5;
    ktr++;
  }

  const ecose = axnl * coseo1 + aynl * sineo1;
  const esine = axnl * sineo1 - aynl * coseo1;
  const el2 = axnl * axnl + aynl * aynl;
  const pl = am * (1 - el2);
  if (pl < 0) return null;

  const rl = am * (1 - ecose);
  const rdotl = Math.sqrt(am) * esine / rl;
  const rvdotl = Math.sqrt(pl) / rl;
  const betal = Math.sqrt(1 - el2);
  const tmp3 = esine / (1 + betal);
  const sinu = am / rl * (sineo1 - aynl - axnl * tmp3);
  const cosu = am / rl * (coseo1 - axnl + aynl * tmp3);
  let su = Math.atan2(sinu, cosu);
  const sin2u = (cosu + cosu) * sinu;
  const cos2u = 1 - 2 * sinu * sinu;

  const tInv = 1 / pl;
  const tp1 = 0.5 * SGP4_J2 * tInv;
  const tp2 = tp1 * tInv;

  // short-period periodics
  const mrt = rl * (1 - 1.5 * tp2 * betal * s.con41) + 0.5 * tp1 * s.x1mth2 * cos2u;
  su = su - 0.25 * tp2 * s.x7thm1 * sin2u;
  const xnode = nodem + 1.5 * tp2 * s.cosio * sin2u;
  const xinc = s.inclo + 1.5 * tp2 * s.cosio * s.sinio * cos2u;
  const mvt = rdotl - nm * tp1 * s.x1mth2 * sin2u / SGP4_XKE;
  const rvdot = rvdotl + nm * tp1 * (s.x1mth2 * cos2u + 1.5 * s.con41) / SGP4_XKE;

  if (mrt < 1) return null; // fell below the surface

  const sinsu = Math.sin(su), cossu = Math.cos(su);
  const snod = Math.sin(xnode), cnod = Math.cos(xnode);
  const sini = Math.sin(xinc), cosi = Math.cos(xinc);
  const xmx = -snod * cosi, xmy = cnod * cosi;
  const ux = xmx * sinsu + cnod * cossu;
  const uy = xmy * sinsu + snod * cossu;
  const uz = sini * sinsu;
  const vx = xmx * cossu - cnod * sinsu;
  const vy = xmy * cossu - snod * sinsu;
  const vz = sini * cossu;

  const vkmps = SGP4_RE * SGP4_XKE / 60;
  return {
    r: [mrt * ux * SGP4_RE, mrt * uy * SGP4_RE, mrt * uz * SGP4_RE],
    v: [(mvt * ux + rvdot * vx) * vkmps, (mvt * uy + rvdot * vy) * vkmps,
        (mvt * uz + rvdot * vz) * vkmps],
  };
}

/* TEME position -> topocentric alt/az for an observer. */
function satelliteLookAngles(rTeme, jd, latDeg, lonDeg, elevM) {
  const d2r = Math.PI / 180;
  // TEME differs from PEF only by the equation of the equinoxes; using GMST
  // rather than GAST costs at most ~1.1 arcsec of azimuth, far below a pixel.
  const theta = ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360 + 360) % 360 * d2r;
  const c = Math.cos(theta), sN = Math.sin(theta);
  const x = rTeme[0] * c + rTeme[1] * sN;      // ECEF
  const y = -rTeme[0] * sN + rTeme[1] * c;
  const z = rTeme[2];

  const lat = latDeg * d2r, lon = lonDeg * d2r;
  const f = 1 / 298.257223563, aE = 6378.137;
  const C = 1 / Math.sqrt(Math.cos(lat) ** 2 + (1 - f) ** 2 * Math.sin(lat) ** 2);
  const S = (1 - f) ** 2 * C;
  const ox = (aE * C + elevM / 1000) * Math.cos(lat) * Math.cos(lon);
  const oy = (aE * C + elevM / 1000) * Math.cos(lat) * Math.sin(lon);
  const oz = (aE * S + elevM / 1000) * Math.sin(lat);

  const dx = x - ox, dy = y - oy, dz = z - oz;
  // ECEF -> topocentric south/east/zenith
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const so = Math.sin(lon), co = Math.cos(lon);
  const south = sl * co * dx + sl * so * dy - cl * dz;
  const east = -so * dx + co * dy;
  const zen = cl * co * dx + cl * so * dy + sl * dz;
  const range = Math.hypot(dx, dy, dz);
  return {
    alt: Math.asin(zen / range) * 180 / Math.PI,
    az: ((Math.atan2(east, -south) * 180 / Math.PI) % 360 + 360) % 360,
    range,
    ecef: [x, y, z],
  };
}

if (typeof module !== 'undefined') module.exports = { sgp4init, sgp4, satelliteLookAngles };
