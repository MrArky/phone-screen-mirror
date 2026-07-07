'use strict';
/**
 * Round 2: broaden cipher MODES (CBC/ECB in addition to CTR) and add
 * HKDF-from-ecdh (AirPlay-2 style) key derivations. Same NAL oracle.
 *   node test/derive-bruteforce2.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'debug-capture.json'), 'utf8'));
const fpKey = Buffer.from(cap.fairplayKey, 'hex');
const ecdh = Buffer.from(cap.ecdhSecret, 'hex');
const raw = Buffer.from(cap.rawPayload, 'hex');
const eiv = Buffer.from('a6480b0b29acfd7c0b6b5743838036e0', 'hex');
const idU = cap.streamId;

function sha(algo, ...p) { const h = crypto.createHash(algo); for (const x of p) h.update(x); return h.digest(); }
const B = (s) => Buffer.from(s, 'ascii');

function looksLikeNAL(out) {
  if (out.length < 5) return false;
  const len = out.readUInt32BE(0);
  if (len <= 0 || len + 4 > out.length) return false;
  if (out[4] & 0x80) return false;
  const t = out[4] & 0x1f;
  return (t === 1 || t === 5 || t === 6 || t === 7 || t === 8);
}
function fullPartition(out) {
  let pos = 0, n = 0;
  while (pos + 4 <= out.length) { const l = out.readUInt32BE(pos); if (l <= 0 || pos + 4 + l > out.length || (out[pos + 4] & 0x80)) return 0; pos += 4 + l; n++; }
  return pos === out.length ? n : 0;
}
let hits = 0, tries = 0;
function test(label, key, iv, mode) {
  tries++;
  try {
    const d = crypto.createDecipheriv(mode, key.subarray(0, 16), mode === 'aes-128-ecb' ? null : iv.subarray(0, 16));
    d.setAutoPadding(false);
    let out;
    if (mode === 'aes-128-cbc' || mode === 'aes-128-ecb') {
      const usable = raw.subarray(0, Math.floor(raw.length / 16) * 16);
      out = Buffer.concat([d.update(usable), d.final()]);
    } else out = Buffer.concat([d.update(raw), d.final()]);
    const fp = fullPartition(out);
    if (fp || looksLikeNAL(out)) { hits++; console.log(`  [HIT] ${label} [${mode}] full=${fp} firstLen=${out.readUInt32BE(0)} type=${out[4] & 0x1f} head=${out.subarray(0, 8).toString('hex')}`); }
  } catch (e) {}
}

// key candidates
const keys = {
  fpKey,
  'sha512(fp||ecdh)[16]': sha('sha512', fpKey, ecdh).subarray(0, 16),
  'sha512(ecdh||fp)[16]': sha('sha512', ecdh, fpKey).subarray(0, 16),
  'streamKey(RPiPlay)': sha('sha512', Buffer.concat([B('AirPlayStreamKey'), B(idU)]), sha('sha512', fpKey, ecdh).subarray(0, 16)).subarray(0, 16),
};
// HKDF-SHA512 from ecdh with common AirPlay-2 salt/info pairs
const hkdfPairs = [
  ['Control-Salt', 'Control-Read-Encryption-Key'],
  ['Control-Salt', 'Control-Write-Encryption-Key'],
  ['DataStream-Salt', 'DataStream-Output-Encryption-Key'],
  ['DataStream-Salt', 'DataStream-Input-Encryption-Key'],
  ['Events-Salt', 'Events-Read-Encryption-Key'],
  ['MediaRemote-Salt', 'MediaRemote-Read-Encryption-Key'],
  ['AirPlayStreamKey', 'AirPlayStreamKey'],
  ['', 'AirPlayStreamKey'],
];
for (const [salt, info] of hkdfPairs) {
  try {
    const k = Buffer.from(crypto.hkdfSync('sha512', ecdh, B(salt), B(info + idU), 16));
    keys[`hkdf(ecdh,${info})`] = k;
    const kf = Buffer.from(crypto.hkdfSync('sha512', Buffer.concat([fpKey, ecdh]), B(salt), B(info + idU), 16));
    keys[`hkdf(fp||ecdh,${info})`] = kf;
  } catch (e) {}
}

const ivs = { eiv, zero: Buffer.alloc(16), 'streamIV(RPiPlay)': sha('sha512', Buffer.concat([B('AirPlayStreamIV'), B(idU)]), sha('sha512', fpKey, ecdh).subarray(0, 16)).subarray(0, 16) };
for (const [kn, k] of Object.entries(keys))
  for (const [ivn, iv] of Object.entries(ivs))
    for (const mode of ['aes-128-ctr', 'aes-128-cbc'])
      test(`key=${kn} iv=${ivn}`, k, iv, mode);
for (const [kn, k] of Object.entries(keys)) test(`key=${kn}`, k, eiv, 'aes-128-ecb');

console.log(`\ntried ${tries}, hits ${hits}`);
