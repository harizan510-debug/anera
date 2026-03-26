const sharp = require('sharp');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public', 'icons');

// Anera branded icon SVG — "A" monogram on blue gradient
function makeSVG(size, maskable) {
  const pad = maskable ? Math.round(size * 0.15) : 0;
  const r = maskable ? 0 : Math.round(size * 0.18);
  const fs = Math.round((size - pad * 2) * 0.42);
  const cx = size / 2;
  const cy = size / 2 + fs * 0.08;

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#5B9BD5"/>
      <stop offset="100%" stop-color="#2F72B3"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
  <text x="${cx}" y="${cy}" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central" letter-spacing="-1">anera</text>
</svg>`);
}

async function main() {
  const configs = [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'icon-maskable-192.png', size: 192, maskable: true },
    { name: 'icon-maskable-512.png', size: 512, maskable: true },
    { name: 'apple-touch-icon.png', size: 180, maskable: false },
  ];

  for (const c of configs) {
    await sharp(makeSVG(c.size, c.maskable))
      .png()
      .toFile(path.join(outDir, c.name));
    console.log(`✓ ${c.name}`);
  }
  console.log('Done!');
}

main().catch(console.error);
