# Star Map

A free, interactive star map you can drop on a website. One self-contained file,
no build step at deploy time, no external services except a satellite feed.

**Live at [zubinray.com/starmap](https://zubinray.com/starmap/).**

This folder lives inside the `zubinray.com` repository, which publishes through
GitHub's branch-based Pages: anything committed to `master` appears on the site
a minute or two later. `starmap/index.html` is the whole application (~660 KB,
about 234 KB over the wire once gzipped) and `starmap/satellites.json` is the
mirrored satellite feed beside it.

`.github/workflows/starmap-satellites.yml` at the repository root refreshes that
feed every day at 04:17 UTC and commits it, which republishes the site. Nothing
else on zubinray.com is touched.

---

## What it does

- **Real sky, real time.** Opens on the sky above you right now, facing north.
  Star positions come from the HYG catalogue (Hipparcos / Yale Bright Star),
  precessed from J2000 to the date being shown.
- **Constellation figures** for all 88 constellations, with a "major only"
  default that shows the 46 well-known ones — zodiac, Orion, Cygnus, Draco,
  Cassiopeia, Crux, Centaurus and the rest — and hides the faint clutter.
- **Deep sky objects**: all 110 Messier objects plus ~740 NGC/IC objects down to
  magnitude 11, drawn at true angular size with catalogue-style symbols.
- **Sun, Moon and planets** with correct phase, illuminated fraction, apparent
  size and magnitude. The Moon's terminator and bright-limb angle are computed,
  not faked.
- **Satellites**: the ISS and Tiangong are always shown and labelled; the ~150
  brightest catalogued satellites appear when they are sunlit and your sky is
  dark. Object panels give the next visible pass, when there is one.
- **Daylight and twilight**: the sky brightens and dims from the real solar
  altitude, so daytime looks like daytime. Constellation figures stay faintly
  drawn through the daylight, and the one the Sun is currently sitting in is
  picked out in amber with a ☉ against its name. Can be switched off entirely to
  see the stars behind the Sun at any hour.
- **See below the horizon.** A button on the right makes the ground translucent
  so you can look straight through the Earth at the half of the sky you are
  missing. Searching for something that has set turns this on automatically
  rather than flying you into a blank patch of ground.
- **A north marker** floats at the edge of the screen whenever the horizon's own
  N has scrolled out of view, with an arrow pointing the way — so you always know
  which way you are facing while dragging around.
- **Any time, any place.** Jump to a date and time, run the clock at up to a day
  per second, or step by hour/day/week/month/year. Set your location by GPS, by
  city (126 presets, correct time zones), or by typing coordinates.
- **Search** across stars, Messier and NGC/IC objects, planets, satellites and
  constellations. Selecting a result flies the view there, zooms in far enough to
  see the object in context, and shows RA/Dec in J2000 and of-date, altitude and
  azimuth, rise/set/transit times and which constellation it sits in — the
  numbers you would type into a telescope. Objects below the horizon get the
  same detail plus their rise time, and are clearly marked as not currently
  visible rather than simply refusing to show.
- **Searched objects are remembered** in the browser and marked on the chart on
  later visits. The saved list lives in the settings panel.
- **Full-screen and mobile-first.** Drag or swipe to look around, pinch or scroll
  to zoom, or use the on-screen arrow pad and zoom buttons. Everything is stored
  in `localStorage`, nothing is sent anywhere.

## Controls

| Action | How |
|---|---|
| Look around | Drag with finger or mouse, arrow pad, or arrow keys |
| Zoom | Pinch, scroll wheel, the +/− buttons, or `+` / `-` |
| Face north | The compass button |
| Turn around 180° | The ⟲ button in the middle of the arrow pad |
| See below the horizon | The horizon button on the right |
| Search | The magnifier, or `/` |
| Object details | Tap or click anything in the sky |
| Play / pause time | The ⏸ button or space bar |
| Jump to a date | Tap the clock in the time bar |
| Layers, location, saved objects | The ☰ menu |

## Accuracy

Checked against JPL Horizons (astrometric J2000, geocentric) across five dates
spanning 2024–2049. Worst error over that set:

| Body | Worst error |
|---|---|
| Sun | 8″ |
| Moon | 56″ |
| Mercury, Venus, Mars | under 30″ |
| Uranus, Neptune | under 70″ |
| Jupiter, Saturn | 5′ and 7′ |

Jupiter and Saturn are the documented limit of the JPL Keplerian element set
used here; the error is well under one pixel at normal zoom. Planets use JPL's
"Approximate Positions of the Planets" (valid 1800–2050), the Moon a truncated
ELP-2000/82 series, and stars IAU 1976 precession.

The constellation boundary lookup was checked against HYG's own per-star
constellation assignments: 8,921 stars, 2 disagreements (0.02%), both on
boundary lines.

The satellite propagator is SGP4 (near-Earth branch), cross-checked against
`satellite.js` over 1,099 propagations of 157 satellites out to seven days past
epoch: worst position difference 0.33 km, worst look-angle difference 0.01°.
Deep-space objects (period over 225 minutes) are rejected rather than propagated
incorrectly.

## Rebuilding

Only needed if you want to change the code or refresh the catalogues.

```bash
cd starmap && node build/build.js
```

That reassembles `src/*` and `build/skydata.js` into `starmap/index.html`. Commit
the result and it goes live. The daily workflow also runs this, so a change to
`src/` reaches the site within a day even if you forget.

To regenerate the embedded catalogue data (downloads ~36 MB of source
catalogues into `build/catalogues/` and caches them there — git-ignored):

```bash
cd starmap && node build/build_data.js
```

### Layout

```
starmap/index.html    the deployable page — generated, do not edit by hand
starmap/src/astro.js  time scales, precession, Sun, Moon, planets
src/sgp4.js           satellite propagator
src/scene.js          catalogues, stereographic camera, all drawing
src/ui.js             state, interaction, panels, search
src/cities.js         preset observing sites
src/shell.html        the DOM chrome
src/style.css         styling
build/build.js        bundles the above into index.html
build/build_data.js   turns the raw catalogues into build/skydata.js
build/fetch_satellites.js  refreshes satellites.json from CelesTrak
starmap/satellites.json    the mirrored satellite feed, refreshed daily
.github/workflows/starmap-satellites.yml   the daily refresh job
```

`src/astro.js` and `src/sgp4.js` export themselves under Node, so they can be
tested directly; the bundler strips those footers.

## Data sources and licensing

All four sources permit public and commercial use. One of them is **share-alike**
rather than MIT-style, which is worth understanding before you publish.

| Source | Used for | Licence | What it obliges you to do |
|---|---|---|---|
| [HYG Database](https://github.com/astronexus/HYG-Database) | 8,920 stars | **CC BY-SA 4.0** | Credit it, **and** license any adapted version of the *database* under CC BY-SA 4.0 |
| [d3-celestial](https://github.com/ofrohn/d3-celestial) | constellation figures, Messier and NGC/IC objects | **BSD-3-Clause** | Keep the copyright notice; don't imply endorsement |
| [Roman (1987), VizieR VI/42](https://cdsarc.cds.unistra.fr/viz-bin/cat/VI/42) | IAU constellation boundaries | Public scientific catalogue via CDS | Acknowledge CDS/VizieR |
| [CelesTrak](https://celestrak.org/) | satellite orbital elements | No licence; a [usage policy](https://celestrak.org/usage-policy.php) | Don't hammer their servers — mirror the feed, see below |

**The one thing to be aware of.** HYG is CC BY-SA 4.0, not MIT. Attribution and
commercial use are both fine, so publishing this is not a problem. The
share-alike clause bites on *adaptations of the database*: the filtered star
table baked into `index.html` is such an adaptation, so it stays CC BY-SA 4.0.
The standard reading is that this does not make your surrounding code or site
CC BY-SA — CC BY-SA 4.0 §4(b) attaches share-alike to the database, and the
"collection" provision keeps separate material separate. That reading is
mainstream but it is an interpretation, not a court ruling, and I am not a
lawyer. Two ways to be certain:

- **Keep HYG** (recommended) and credit it plainly in the page, as the app
  already does in its settings panel. This is what comparable free star maps do.
- **Or swap the catalogue** for a source with no share-alike clause — the Yale
  Bright Star Catalogue (VizieR V/50) covers exactly the same magnitude 6.5
  limit. The swap is cheap because constellation figures are matched to stars
  *by position*, not by catalogue ID, so nothing else would need rewriting.

Everything else is unambiguously permissive.

## Hosting the satellite feed yourself

CelesTrak has no licence restriction, but their usage policy asks sites not to
have every visitor query them directly: *"Only download the data you need, when
you are going to use it, and only download data once per update"*, and heavy
users should *"set up a proxy to cache these queries"*. Repeated abuse gets IPs
firewalled. Mirroring the feed fixes this and makes the page faster.

This is already set up here: `.github/workflows/starmap-satellites.yml` runs

```bash
node starmap/build/fetch_satellites.js
```

every day and commits the result, so visitors only ever hit zubinray.com. The
page loads `satellites.json` if it is present and falls back to querying
CelesTrak directly only if it is missing.

| What is deployed | What visitors' browsers hit |
|---|---|
| `index.html` alone | CelesTrak, once per browser per 6 hours |
| `index.html` + `satellites.json` refreshed daily | only zubinray.com |

To run it by hand at any point, use the **Actions** tab on the repository and
trigger *Refresh star map satellites*, or run the command above locally and
commit `starmap/satellites.json`.

### Why daily and not monthly

Accuracy is not the reason. Measured directly: ISS elements 17 hours apart put
the satellite within **0.29 km** of each other, which is nothing. Two other
things force the pace:

- The page **refuses elements more than 14 days past their epoch**, because
  beyond that SGP4 predictions genuinely stop being trustworthy. On a monthly
  refresh the satellite layer would be dead for roughly half of every month.
- The ISS **raises its orbit roughly monthly**. Drag is gradual and SGP4 models
  it; a reboost is a step change that makes earlier elements wrong at once.

Daily is two requests a day, leaves a fortnight of margin, and survives several
failed runs. If the mirror does go stale the settings panel says so once the
elements pass a week old, and individual satellites explain themselves rather
than silently disappearing.

## Known limits

- The star catalogue stops at magnitude 6.5 (naked-eye limit), so zooming to a
  very narrow field shows a sparse view rather than a telescopic one.
- No Milky Way band, comets, asteroids or meteor shower radiants.
- Planetary positions are valid 1800–2050; the app will still draw outside that
  range but the planets drift.
- Time zones are exact for the preset cities and for GPS-derived locations;
  hand-typed coordinates fall back to an offset estimated from longitude and are
  labelled as such.

