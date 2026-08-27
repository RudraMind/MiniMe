'use strict';
const fs = require('fs');
const path = require('path');
let sharp, toIco;
try {
  sharp = require('sharp');
  toIco = require('to-ico');
} catch {
  console.error('This script needs "sharp" and "to-ico", which are optional dependencies.');
  console.error('Install them with:  npm install sharp to-ico');
  console.error('You only need them to regenerate icons — the app ships with assets/icon.ico already generated.');
  process.exit(1);
}

const ASSETS = path.join(__dirname, '..', 'assets');
const PAL_STAND = path.join(ASSETS, 'pal', 'stand_01.png');

async function main() {
  if (!fs.existsSync(PAL_STAND)) {
    console.error(`FATAL: ${PAL_STAND} missing. Run "npm run slice" first.`);
    process.exit(1);
  }

  // App/tray icon: pal sprite composited onto a rounded navy tile.
  const size = 256;
  const bg = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 23, g: 29, b: 38, alpha: 255 } },
  }).png().toBuffer();

  const palResized = await sharp(PAL_STAND).resize(200, 200, { kernel: 'nearest' }).toBuffer();

  const iconPng = await sharp(bg)
    .composite([{ input: palResized, left: 28, top: 40 }])
    .png()
    .toBuffer();

  fs.writeFileSync(path.join(ASSETS, 'icon.png'), iconPng);

  const sizes = [16, 32, 48, 256];
  const pngBuffers = await Promise.all(
    sizes.map((s) => sharp(iconPng).resize(s, s, { kernel: 'nearest' }).png().toBuffer())
  );
  const icoBuffer = await toIco(pngBuffers);
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), icoBuffer);

  const trayPng = await sharp(iconPng).resize(32, 32, { kernel: 'nearest' }).png().toBuffer();
  fs.writeFileSync(path.join(ASSETS, 'tray.png'), trayPng);

  console.log('Wrote assets/icon.png, assets/icon.ico, assets/tray.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
