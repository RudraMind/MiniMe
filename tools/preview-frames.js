'use strict';
// Diagnostic: magnify frames onto a loud magenta backdrop so transparent
// pixels are obvious, and tile them into one sheet for eyeballing. Magenta
// because it appears nowhere in the palettes, so anything pink is a hole.
// Not part of the build.
//
// Usage: node tools/preview-frames.js out.png 8 assets/pal/walk_01.png ...

const sharp = require('sharp');

async function main() {
  const [out, zoomArg, ...files] = process.argv.slice(2);
  const zoom = Number(zoomArg) || 8;
  const tiles = [];
  let maxW = 0, maxH = 0;
  for (const f of files) {
    const buf = await sharp(f)
      .flatten({ background: { r: 255, g: 0, b: 255 } })
      .resize({ width: null, height: null, kernel: 'nearest' })
      .metadata()
      .then(async (m) => sharp(f)
        .flatten({ background: { r: 255, g: 0, b: 255 } })
        .resize(m.width * zoom, m.height * zoom, { kernel: 'nearest' })
        .png().toBuffer());
    const m = await sharp(buf).metadata();
    maxW = Math.max(maxW, m.width); maxH = Math.max(maxH, m.height);
    tiles.push({ buf, w: m.width, h: m.height, f });
  }
  const cols = Math.min(tiles.length, 5);
  const rows = Math.ceil(tiles.length / cols);
  const pad = 8;
  const W = cols * (maxW + pad) + pad;
  const H = rows * (maxH + pad) + pad;
  const comp = tiles.map((t, i) => ({
    input: t.buf,
    left: pad + (i % cols) * (maxW + pad),
    top: pad + Math.floor(i / cols) * (maxH + pad),
  }));
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 1 } } })
    .composite(comp).png().toFile(out);
  console.log(`${out}  ${W}x${H}  ${tiles.length} tiles (${cols}x${rows}), zoom ${zoom}x`);
  tiles.forEach((t, i) => console.log(`  [${Math.floor(i / cols)},${i % cols}] ${t.f}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
