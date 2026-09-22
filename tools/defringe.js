'use strict';
// Removes the pale halo left around characters cut from a white sheet.
//
// THE PROBLEM
// tools/slice-character.js keys a WHITE backdrop, and it keys it timidly on
// purpose: TOL is 10, because a looser tolerance leaks through the antialiased
// edge of the artwork's own linework and eats near-white ART — the boy's white cap
// panel, his socks, the whites of his eyes, the dog's cream fur. The cost of that
// caution is that the outermost ring of each figure is still part backdrop. Those
// pixels are written fully opaque, so on a transparent always-on-top window they
// read as a white outline drawn around the character. Measured on the shipped art,
// 25-60% of every silhouette edge pixel on boy, girl, hanu and dog is near-white.
// Raj is unaffected: his sheet has a dark navy backdrop, and 0% of his edge is.
//
// WHY NOT JUST DELETE THOSE PIXELS
// Because some of them are real. The dog is cream — its true outline IS near-white,
// which is exactly why it shows the lowest halo percentage of the four. Deleting
// near-white edge pixels would shave the dog's fur and the boy's shoes.
//
// WHAT THIS DOES INSTEAD
// Treats each edge pixel as what it is: a blend of the art colour underneath and
// the backdrop, P = a*C + (1-a)*B. C is estimated from the neighbouring interior
// pixels, which for a one-pixel fringe is the dark linework the artist drew, so the
// recovered edge stays dark rather than turning into a guess. Then a is solved per
// channel and the pixel is rewritten as that colour at that coverage. The halo
// stops being an opaque white ring and becomes a soft edge of the right colour.
//
// THE GUARD THAT MATTERS
// If the interior colour is itself close to the backdrop, the equation has no
// signal — dividing by (B - C) would amplify noise into nonsense. Those pixels are
// left exactly as they are. That is what protects genuinely white art.

const DEFAULTS = {
  backdrop: [255, 255, 255],
  // Interior colour must differ from the backdrop by at least this much on some
  // channel before its coverage can be solved for. Below it, the pixel is left
  // alone as real art.
  minContrast: 25,
  // A pixel already this opaque by the estimate is art, not spill, so leave it.
  keepAbove: 0.97,
  // Each pass softens the current outer ring, which exposes the ring behind it. On
  // this art the halo is one to three pixels thick: two passes leave a little
  // behind the arms, four clears it, and six changes only four more pixels on the
  // frame measured, so four is where it converges. The cream cap panel, the white
  // socks and the dog's fur survive all of them — the contrast guard, not the pass
  // count, is what protects them.
  passes: 4,
};

// Has this frame already been through the pass? The slicers write a binary mask —
// every pixel is alpha 0 or alpha 255 — so a single partially transparent pixel
// means the edge has already been softened.
//
// This matters because the pass is NOT idempotent. A softened pixel reads as
// transparent to the next run's edge test, so the ring behind it becomes the new
// edge and is softened in turn: run it twice and the sprite quietly erodes.
function alreadyDefringed(rgba) {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] > 0 && rgba[i] < 255) return true;
  }
  return false;
}

function isOpaque(rgba, i) { return rgba[i + 3] > 127; }

// Every opaque pixel that touches a transparent one.
function edgeMask(rgba, w, h) {
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!isOpaque(rgba, p * 4)) continue;
      const n = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of n) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { edge[p] = 1; break; }
        if (!isOpaque(rgba, (ny * w + nx) * 4)) { edge[p] = 1; break; }
      }
    }
  }
  return edge;
}

// Mean colour of the opaque, non-edge pixels around (x, y): the art underneath the
// fringe. Widens the search once before giving up, for a pixel on a thin limb.
function interiorColour(rgba, w, h, edge, x, y) {
  for (const r of [1, 2]) {
    let n = 0, sr = 0, sg = 0, sb = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const p = ny * w + nx;
        if (edge[p]) continue;
        const i = p * 4;
        if (!isOpaque(rgba, i)) continue;
        sr += rgba[i]; sg += rgba[i + 1]; sb += rgba[i + 2]; n++;
      }
    }
    if (n > 0) return [sr / n, sg / n, sb / n];
  }
  return null;
}

// Rewrites rgba in place. Returns how many pixels were changed and how many were
// left alone because the art underneath was itself backdrop-coloured.
function defringe(rgba, w, h, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const B = opt.backdrop;
  let changed = 0;
  let protectedPx = 0;

  for (let pass = 0; pass < opt.passes; pass++) {
    const edge = edgeMask(rgba, w, h);
    // Collected first, applied after, so a pixel's neighbours are not read after
    // they have already been rewritten this pass.
    const writes = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!edge[p]) continue;
        const i = p * 4;
        const C = interiorColour(rgba, w, h, edge, x, y);
        if (!C) continue;

        let sum = 0, n = 0;
        for (let k = 0; k < 3; k++) {
          const denom = B[k] - C[k];
          if (Math.abs(denom) < opt.minContrast) continue;
          sum += (B[k] - rgba[i + k]) / denom;
          n++;
        }
        if (n === 0) { protectedPx++; continue; }

        const a = Math.max(0, Math.min(1, sum / n));
        if (a >= opt.keepAbove) continue;
        writes.push([i, C, a]);
      }
    }
    for (const [i, C, a] of writes) {
      rgba[i] = Math.round(C[0]);
      rgba[i + 1] = Math.round(C[1]);
      rgba[i + 2] = Math.round(C[2]);
      rgba[i + 3] = Math.round(255 * a);
      changed++;
    }
  }
  return { changed, protectedPx };
}

module.exports = { defringe, alreadyDefringed, DEFAULTS };
