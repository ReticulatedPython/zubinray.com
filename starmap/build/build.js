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

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#05070d">
<meta name="color-scheme" content="dark">
<title>Star Map — the sky above you, right now</title>
<meta name="description" content="A free interactive star map: constellations, planets, the Moon, deep sky objects and satellites for any place on Earth and any date.">
<meta name="apple-mobile-web-app-capable" content="yes">
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
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log('wrote', OUT, (html.length / 1024).toFixed(0) + ' KB');
