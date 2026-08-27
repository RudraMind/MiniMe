export const COLOR_SWATCHES = {
  red: '#c23b3b',
  blue: '#3b62c2',
  yellow: '#d1b23a',
  black: '#26262b',
  green: '#3f9153',
  orange: '#d1793a',
};

const FRAME_BASE = '../assets/pal/';
const SHIRT_ZONE_FRACTION = 0.58; // upper portion of each frame's bbox = shirt, rest = pants
const MIN_ALPHA = 200;
const MAX_SATURATION_SPAN = 14; // skip skin/hair (saturated) pixels
const MIN_GARMENT_LUM = 25;  // skip near-black shoes/outline
const MAX_GARMENT_LUM = 215; // skip near-white highlights/trim

const frameCache = new Map();
const outputCache = new Map();

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4; break;
  }
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

async function loadBaseFrame(frameName) {
  if (frameCache.has(frameName)) return frameCache.get(frameName);
  const img = new Image();
  img.src = FRAME_BASE + frameName + '.png';
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;

  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const entry = { data, width, height, bbox: { minX, maxX, minY, maxY } };
  frameCache.set(frameName, entry);
  return entry;
}

export async function getRecoloredFrameSrc(frameName, shirtKey, pantKey) {
  const shirtOn = shirtKey && shirtKey !== 'default';
  const pantOn = pantKey && pantKey !== 'default';
  if (!shirtOn && !pantOn) return FRAME_BASE + frameName + '.png';

  const cacheKey = `${frameName}|${shirtKey}|${pantKey}`;
  if (outputCache.has(cacheKey)) return outputCache.get(cacheKey);

  const base = await loadBaseFrame(frameName);
  const { data: src, width, height, bbox } = base;
  const out = new Uint8ClampedArray(src);

  const shirtHsl = shirtOn ? rgbToHsl(...hexToRgb(COLOR_SWATCHES[shirtKey])) : null;
  const pantHsl = pantOn ? rgbToHsl(...hexToRgb(COLOR_SWATCHES[pantKey])) : null;

  const bboxH = Math.max(bbox.maxY - bbox.minY, 1);
  const splitY = bbox.minY + bboxH * SHIRT_ZONE_FRACTION;

  for (let y = bbox.minY; y <= bbox.maxY; y++) {
    for (let x = bbox.minX; x <= bbox.maxX; x++) {
      const i = (y * width + x) * 4;
      if (src[i + 3] < MIN_ALPHA) continue;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx - mn > MAX_SATURATION_SPAN) continue;
      const lum = (r + g + b) / 3;
      if (lum < MIN_GARMENT_LUM || lum > MAX_GARMENT_LUM) continue;

      const target = y <= splitY ? shirtHsl : pantHsl;
      if (!target) continue;

      const l = (mx + mn) / 2 / 255;
      const [nr, ng, nb] = hslToRgb(target[0], target[1], l);
      out[i] = nr; out[i + 1] = ng; out[i + 2] = nb;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(out, width, height), 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  outputCache.set(cacheKey, dataUrl);
  return dataUrl;
}

export async function prefetchFrameSet(frameNames, shirtKey, pantKey) {
  const entries = await Promise.all(
    frameNames.map(async (name) => [name, await getRecoloredFrameSrc(name, shirtKey, pantKey)])
  );
  return Object.fromEntries(entries);
}
