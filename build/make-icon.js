'use strict';

/*
 * App-icon generator — zero dependencies (Node built-ins only).
 *
 * Draws an iPhone with a colourful app-grid screen (the "screen grid" look)
 * onto a high-res RGBA canvas using signed-distance rounded rectangles for
 * clean anti-aliased edges, box-downscales to every size Windows wants, and
 * writes:
 *   build/icon.ico   multi-size (16..256) icon for electron-builder / the .exe
 *   build/icon.png   512px master (Linux/mac targets, docs, README)
 *
 * Run:  npm run make-icon   (or: node build/make-icon.js)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = __dirname;
const MASTER = 1024; // logical + render resolution (SDF gives us clean edges at 1x)

// ---------------------------------------------------------------- canvas ----
// Straight (non-premultiplied) RGBA stored as Float32, 0..255 for colour, 0..1
// would be fine too — we keep colour 0..255 and alpha 0..1 for source-over.
function Canvas(w, h) {
  this.w = w;
  this.h = h;
  this.px = new Float32Array(w * h * 4); // r,g,b (0..255), a (0..1)
}

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Source-over blend of a straight-alpha source pixel onto the canvas.
function blend(cv, x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  const da = cv.px[i + 3];
  const oa = a + da * (1 - a);
  if (oa <= 0) return;
  cv.px[i] = (r * a + cv.px[i] * da * (1 - a)) / oa;
  cv.px[i + 1] = (g * a + cv.px[i + 1] * da * (1 - a)) / oa;
  cv.px[i + 2] = (b * a + cv.px[i + 2] * da * (1 - a)) / oa;
  cv.px[i + 3] = oa;
}

// Signed distance to a rounded rect (centre cx,cy; half extents hw,hh; radius rad).
function roundRectSDF(px, py, cx, cy, hw, hh, rad) {
  const dx = Math.abs(px - cx) - (hw - rad);
  const dy = Math.abs(py - cy) - (hh - rad);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - rad;
}

// Fill a rounded rect. `color` is {r,g,b}; `alpha` scales overall opacity.
// `shade` optionally tints top→bottom for a subtle gradient (t=0 top,1 bottom).
function fillRoundRect(cv, cx, cy, hw, hh, rad, color, alpha, shade) {
  const x0 = clamp(Math.floor(cx - hw - 2), 0, cv.w);
  const x1 = clamp(Math.ceil(cx + hw + 2), 0, cv.w);
  const y0 = clamp(Math.floor(cy - hh - 2), 0, cv.h);
  const y1 = clamp(Math.ceil(cy + hh + 2), 0, cv.h);
  const top = shade ? shade.top : null;
  const bot = shade ? shade.bottom : null;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = roundRectSDF(x + 0.5, y + 0.5, cx, cy, hw, hh, rad);
      const cov = clamp(0.5 - d, 0, 1); // 1px analytic AA band
      if (cov <= 0) continue;
      let r = color.r, g = color.g, b = color.b;
      if (shade) {
        const t = clamp((y - (cy - hh)) / (2 * hh), 0, 1);
        r = top.r + (bot.r - top.r) * t;
        g = top.g + (bot.g - top.g) * t;
        b = top.b + (bot.b - top.b) * t;
      }
      blend(cv, x, y, r, g, b, cov * (alpha == null ? 1 : alpha));
    }
  }
}

// ------------------------------------------------------------ the artwork ---
function drawIcon() {
  const cv = new Canvas(MASTER, MASTER);
  const C = MASTER / 2;

  // Background: deep-blue → near-black rounded square (matches app bg #0b0d12).
  fillRoundRect(cv, C, C, 512, 512, 224, { r: 0, g: 0, b: 0 }, 1, {
    top: hex('#1b3a63'),
    bottom: hex('#0a0c11'),
  });

  // Phone outer bezel (slightly larger, lighter) then body.
  const phoneCx = C;
  const phoneCy = 524;
  fillRoundRect(cv, phoneCx, phoneCy, 238, 436, 102, hex('#3a4152'), 1);
  fillRoundRect(cv, phoneCx, phoneCy, 232, 430, 96, hex('#141821'), 1, {
    top: hex('#1c2130'),
    bottom: hex('#0e1119'),
  });

  // Screen (near-black inset).
  const scHw = 202, scHh = 392, scRad = 62;
  fillRoundRect(cv, phoneCx, phoneCy, scHw, scHh, scRad, hex('#05060a'), 1);

  const scTop = phoneCy - scHh;

  // App grid: 3 columns × 4 rows of vibrant rounded tiles.
  const tiles = [
    '#3b82f6', '#22c55e', '#f59e0b',
    '#ef4444', '#a855f7', '#06b6d4',
    '#ec4899', '#14b8a6', '#fb923c',
    '#6366f1', '#84cc16', '#f43f5e',
  ];
  const cols = 3, rows = 4;
  const tile = 92, gap = 34, tRad = 22;
  const blockW = cols * tile + (cols - 1) * gap;
  const blockH = rows * tile + (rows - 1) * gap;
  const gridLeft = phoneCx - blockW / 2;
  const gridTop = scTop + 118; // leave room for the dynamic island
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = hex(tiles[r * cols + c]);
      const tx = gridLeft + c * (tile + gap) + tile / 2;
      const ty = gridTop + r * (tile + gap) + tile / 2;
      // faint drop shadow for depth
      fillRoundRect(cv, tx, ty + 4, tile / 2, tile / 2, tRad, { r: 0, g: 0, b: 0 }, 0.28);
      fillRoundRect(cv, tx, ty, tile / 2, tile / 2, tRad, col, 1, {
        top: { r: col.r, g: col.g, b: col.b },
        bottom: {
          r: col.r * 0.72,
          g: col.g * 0.72,
          b: col.b * 0.72,
        },
      });
    }
  }

  // Dynamic island pill.
  fillRoundRect(cv, phoneCx, scTop + 46, 54, 15, 15, hex('#0b0d13'), 1);

  // Home indicator bar.
  fillRoundRect(cv, phoneCx, phoneCy + scHh - 34, 58, 6, 6, hex('#5b6273'), 0.9);

  return cv;
}

// ------------------------------------------------------------- downscale ----
// Box filter over premultiplied alpha, then unpremultiply — correct at edges.
function downscale(src, size) {
  const dst = new Canvas(size, size);
  const sx = src.w / size, sy = src.h / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.floor((x + 1) * sx);
      const y0 = Math.floor(y * sy), y1 = Math.floor((y + 1) * sy);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.w + xx) * 4;
          const pa = src.px[i + 3];
          r += src.px[i] * pa;
          g += src.px[i + 1] * pa;
          b += src.px[i + 2] * pa;
          a += pa;
          n++;
        }
      }
      const o = (y * size + x) * 4;
      if (a > 0) {
        dst.px[o] = r / a;
        dst.px[o + 1] = g / a;
        dst.px[o + 2] = b / a;
      }
      dst.px[o + 3] = n > 0 ? a / n : 0;
    }
  }
  return dst;
}

// ------------------------------------------------------------ PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(cv) {
  const { w, h, px } = cv;
  const raw = Buffer.alloc(h * (1 + w * 4));
  let p = 0;
  for (let y = 0; y < h; y++) {
    raw[p++] = 0; // filter type 0 (none)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[p++] = clamp(Math.round(px[i]), 0, 255);
      raw[p++] = clamp(Math.round(px[i + 1]), 0, 255);
      raw[p++] = clamp(Math.round(px[i + 2]), 0, 255);
      raw[p++] = clamp(Math.round(px[i + 3] * 255), 0, 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ ICO encoder ---
// ICO with PNG-compressed entries (supported on Windows Vista+).
function encodeICO(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(count * 16);
  let offset = 6 + count * 16;
  const images = [];
  entries.forEach((e, idx) => {
    const o = idx * 16;
    dir[o] = e.size >= 256 ? 0 : e.size; // width  (0 == 256)
    dir[o + 1] = e.size >= 256 ? 0 : e.size; // height
    dir[o + 2] = 0; // palette
    dir[o + 3] = 0; // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32BE(0, o + 8); // (placeholder, overwritten below LE)
    dir.writeUInt32LE(e.png.length, o + 8); // bytes in resource
    dir.writeUInt32LE(offset, o + 12); // offset
    offset += e.png.length;
    images.push(e.png);
  });

  return Buffer.concat([header, dir, ...images]);
}

// ------------------------------------------------------------------ main ----
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const master = drawIcon();

  // 512 master PNG (README / non-Windows targets).
  const png512 = encodePNG(downscale(master, 512));
  fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png512);

  // ICO with the sizes Windows uses.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const entries = sizes.map((size) => ({
    size,
    png: encodePNG(size === MASTER ? master : downscale(master, size)),
  }));
  fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeICO(entries));

  console.log('wrote', path.join(OUT_DIR, 'icon.png'), `(${png512.length} B)`);
  console.log('wrote', path.join(OUT_DIR, 'icon.ico'), `(sizes: ${sizes.join(', ')})`);
}

main();
