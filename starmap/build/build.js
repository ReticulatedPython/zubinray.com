// Assemble ../src/* and skydata.js into the single deployable ../index.html.
//   node build/build.js
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'index.html');

const read = (p) => fs.readFileSync(p, 'utf8');
// the node-only export footers exist so the modules can be unit tested
const strip = (js) => js.replace(/\nif \(typeof module !== 'undefined'\) module\.exports = \{[\s\S]*?\};\n/g, '\n');

const css = read(path.join(SRC, 'style.css'));
const shell = read(path.join(SRC, 'shell.html'));
const parts = ['astro.js', 'sgp4.js', 'cities.js', 'scene.js', 'ui.js']
  .map(f => '/* ===== ' + f + ' ===== */\n' + strip(read(path.join(SRC, f))));

const dataFile = path.join(HERE, 'skydata.js');
if (!fs.existsSync(dataFile)) {
  console.error('build/skydata.js is missing — run: node build/build_data.js');
  process.exit(1);
}
const data = read(dataFile);

// schema.org structured data. This is what search engines and the crawlers
// behind AI assistants read to understand what the page actually is.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': 'https://zubinray.com/starmap/#app',
      name: 'Star Map',
      alternateName: 'Star Map — interactive night sky chart',
      url: 'https://zubinray.com/starmap/',
      applicationCategory: 'EducationalApplication',
      applicationSubCategory: 'Astronomy',
      operatingSystem: 'Any',
      browserRequirements: 'Requires JavaScript and a browser with HTML5 canvas',
      isAccessibleForFree: true,
      inLanguage: 'en-GB',
      image: 'https://zubinray.com/starmap/og-image.png',
      description:
        "An interactive star map showing the night sky in real time for any location on Earth " +
        "and any date. Shows the 88 constellations with joined figures, the Sun, Moon and " +
        "planets with their correct phase, 110 Messier objects and around 740 NGC/IC deep sky " +
        "objects, and live satellite tracking including the International Space Station and " +
        "Tiangong. Gives telescope coordinates in right ascension, declination, altitude and " +
        "azimuth for anything you search for.",
      author: { '@type': 'Person', name: 'Zubin Ray', url: 'https://zubinray.com/' },
      offers: {
        '@type': 'Offer', price: '0', priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
      },
      featureList: [
        'Real-time night sky for your location',
        '88 constellations with joined figures and IAU boundaries',
        'Sun, Moon and planets with correct phase and position',
        '110 Messier objects and around 740 NGC/IC deep sky objects',
        'Live satellite tracking including the ISS and Tiangong',
        'Travel to any date, past or future',
        'Search with telescope coordinates in RA/Dec and altitude/azimuth',
        'Works on mobile, drag to look around and pinch to zoom',
      ],
    },
    {
      // The questions people actually type into a search box.
      '@type': 'FAQPage',
      '@id': 'https://zubinray.com/starmap/#faq',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What stars and planets can I see tonight?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Star Map shows the sky above your exact location at the current moment. ' +
              'It labels the visible planets, the Moon and its phase, the brighter stars and ' +
              'the constellations they form, and marks which are above the horizon right now.',
          },
        },
        {
          '@type': 'Question',
          name: 'How do I find the International Space Station?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Search for the ISS. Star Map propagates its orbit from current CelesTrak ' +
              'orbital elements and shows where it is, whether it is sunlit, and the time and ' +
              'direction of its next pass visible from your location.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can I see the night sky on a different date?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. You can jump to any date and time, past or future, or run the clock ' +
              'forward at up to a day per second to watch the sky turn.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does it give coordinates I can use with a telescope?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Selecting any object shows its right ascension and declination in both ' +
              'J2000 and coordinates of date, along with its current altitude and azimuth and ' +
              'its rise, set and transit times.',
          },
        },
      ],
    },
  ],
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#05070d">
<meta name="color-scheme" content="dark">
<title>Star Map — the night sky above you, right now</title>
<meta name="description" content="A free interactive star map of tonight's sky. Identify constellations, planets, the Moon's phase and Messier objects from any location on Earth and any date, and track the ISS and Tiangong overhead.">
<link rel="canonical" href="https://zubinray.com/starmap/">
<meta name="author" content="Zubin Ray">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">

<meta property="og:type" content="website">
<meta property="og:site_name" content="Zubin Ray">
<meta property="og:title" content="Star Map — the night sky above you, right now">
<meta property="og:description" content="Identify constellations, planets, the Moon's phase and deep sky objects from any location on Earth and any date. Track the ISS and Tiangong overhead. Free, no sign-up.">
<meta property="og:url" content="https://zubinray.com/starmap/">
<meta property="og:locale" content="en_GB">
<meta property="og:image" content="https://zubinray.com/starmap/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="A star chart showing labelled constellations and planets over a dark horizon.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Star Map — the night sky above you, right now">
<meta name="twitter:description" content="Identify constellations, planets, the Moon's phase and deep sky objects from anywhere on Earth, on any date. Free, no sign-up.">
<meta name="twitter:image" content="https://zubinray.com/starmap/og-image.png">

<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Star Map">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%2305070d'/><circle cx='16' cy='13' r='3.2' fill='%23ffc65c'/><circle cx='8' cy='22' r='1.4' fill='%23fff'/><circle cx='24' cy='21' r='1.7' fill='%23fff'/><circle cx='22' cy='8' r='1.1' fill='%23fff'/><circle cx='9' cy='9' r='1.3' fill='%23fff'/></svg>">
<style>
${css}</style>
</head>
<body>
${shell}
<script>
${data}
</script>
<script>
"use strict";
${parts.join('\n\n')}
</script>
<script type="application/ld+json">
${JSON.stringify(structuredData, null, 2)}
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log('wrote', OUT, (html.length / 1024).toFixed(0) + ' KB');
