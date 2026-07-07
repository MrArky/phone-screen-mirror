'use strict';
/**
 * Structural analysis of the raw (still-encrypted) mirror payload.
 * Looks for: overall entropy, and whether plausible 4-byte BE length prefixes
 * appear at positions that would partition the buffer if only NAL *bodies*
 * were encrypted (partial-encryption schemes leave the length prefixes clear).
 *   node test/payload-analyze.js
 */
const fs = require('fs');
const path = require('path');
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'debug-capture.json'), 'utf8'));
const raw = Buffer.from(cap.rawPayload, 'hex');
console.log('payload bytes:', raw.length);

// Shannon entropy over the whole buffer
const freq = new Array(256).fill(0);
for (const b of raw) freq[b]++;
let H = 0;
for (const f of freq) if (f) { const p = f / raw.length; H -= p * Math.log2(p); }
console.log('entropy (bits/byte):', H.toFixed(4), '(8.0 = fully random)');

// entropy of first 64 bytes vs rest (header often lower entropy)
function ent(buf) { const fr = new Array(256).fill(0); for (const b of buf) fr[b]++; let h = 0; for (const f of fr) if (f) { const p = f / buf.length; h -= p * Math.log2(p); } return h; }
console.log('entropy first 64B:', ent(raw.subarray(0, 64)).toFixed(3), ' last 64B:', ent(raw.subarray(raw.length - 64)).toFixed(3));

// Treat buffer as clear 4-byte BE length prefixes + encrypted bodies:
// pos=0 -> len@pos, skip len bytes, repeat. See if it partitions.
function tryClearPrefix(startOff) {
  let pos = startOff, n = 0;
  const lens = [];
  while (pos + 4 <= raw.length) {
    const len = raw.readUInt32BE(pos);
    if (len <= 0 || pos + 4 + len > raw.length) return null;
    lens.push(len); pos += 4 + len; n++;
    if (n > 200) return null;
  }
  if (pos === raw.length) return { n, lens: lens.slice(0, 10) };
  return null;
}
for (const off of [0, 4, 8, 16, 20, 24, 32]) {
  const r = tryClearPrefix(off);
  if (r) console.log(`clear-4B-prefix @off=${off}: partitions! nalus=${r.n} lens=${r.lens}`);
}
// same but 2-byte and little-endian
function tryClear(startOff, size, le) {
  let pos = startOff, n = 0;
  while (pos + size <= raw.length) {
    const len = size === 4 ? (le ? raw.readUInt32LE(pos) : raw.readUInt32BE(pos)) : (le ? raw.readUInt16LE(pos) : raw.readUInt16BE(pos));
    if (len <= 0 || pos + size + len > raw.length) return null;
    pos += size + len; n++; if (n > 500) return null;
  }
  return pos === raw.length ? n : null;
}
for (const size of [2, 4]) for (const le of [false, true]) for (const off of [0, 4, 8]) {
  const r = tryClear(off, size, le); if (r) console.log(`clear ${size}B ${le ? 'LE' : 'BE'} @${off}: partitions nalus=${r}`);
}

console.log('first 32 bytes:', raw.subarray(0, 32).toString('hex'));
console.log('bytes[0..3] as BE u32:', raw.readUInt32BE(0), ' LE:', raw.readUInt32LE(0));
