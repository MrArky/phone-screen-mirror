'use strict';
/**
 * Offline brute-force of stream-key derivations against the NAL-partition
 * oracle, using the real captured (fairplayKey, ecdh, eiv, streamId, rawPayload).
 * Goal: find ANY (key,iv,ctr-scheme) that makes decrypted[0] length-prefixes
 * partition the payload (valid AVCC H.264). Runs without the iPhone.
 *
 *   node test/derive-bruteforce.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'debug-capture.json'), 'utf8'));
const fpKey = Buffer.from(cap.fairplayKey, 'hex');            // 16
const ecdh = Buffer.from(cap.ecdhSecret, 'hex');              // 32
const raw = Buffer.from(cap.rawPayload, 'hex');
const eiv = Buffer.from('a6480b0b29acfd7c0b6b5743838036e0', 'hex'); // from SETUP, same session

// streamId variants
const idU = cap.streamId;                                     // unsigned decimal string
const idBig = BigInt(idU);
const idSigned = (idBig >= (1n << 63n)) ? (idBig - (1n << 64n)).toString() : idU;
const idBytesBE = Buffer.alloc(8); idBytesBE.writeBigUInt64BE(idBig);
const idBytesLE = Buffer.alloc(8); idBytesLE.writeBigUInt64LE(idBig);

function sha(algo, ...parts) { const h = crypto.createHash(algo); for (const p of parts) h.update(p); return h.digest(); }
const B = (s) => Buffer.from(s, 'ascii');

// NAL partition oracle over the full buffer (AES-CTR is deterministic from IV
// for the first packet, so standard CTR decrypt is valid here).
function nalScore(out) {
  let pos = 0, nalus = 0;
  while (pos + 4 <= out.length) {
    const n = out.readUInt32BE(pos);
    if (n <= 0 || pos + 4 + n > out.length) break;
    // sanity: NAL header byte forbidden_zero_bit must be 0
    const hdr = out[pos + 4];
    if (hdr & 0x80) break;
    pos += 4 + n; nalus++;
  }
  const full = pos === out.length && nalus > 0;
  return { full, nalus, consumed: pos, firstLen: out.readUInt32BE(0), firstType: out[4] & 0x1f };
}

function tryKeyIv(label, key, iv) {
  if (!key || key.length < 16 || !iv || iv.length < 16) return null;
  const d = crypto.createDecipheriv('aes-128-ctr', key.subarray(0, 16), iv.subarray(0, 16));
  d.setAutoPadding(false);
  const out = Buffer.concat([d.update(raw), d.final()]);
  const s = nalScore(out);
  if (s.full || s.nalus >= 3 || (s.firstLen > 0 && s.firstLen < raw.length && (s.firstType === 1 || s.firstType === 5 || s.firstType === 7))) {
    console.log(`  [HIT?] ${label}: full=${s.full} nalus=${s.nalus} consumed=${s.consumed}/${out.length} firstLen=${s.firstLen} firstType=${s.firstType}`);
  }
  return s;
}

// eaeskey (intermediate) candidates
const eaes = {
  'sha512(fp||ecdh)': sha('sha512', fpKey, ecdh).subarray(0, 16),
  'sha512(ecdh||fp)': sha('sha512', ecdh, fpKey).subarray(0, 16),
  'sha256(fp||ecdh)': sha('sha256', fpKey, ecdh).subarray(0, 16),
  'sha256(ecdh||fp)': sha('sha256', ecdh, fpKey).subarray(0, 16),
  'fpKey': fpKey,
  'sha512(fp)': sha('sha512', fpKey).subarray(0, 16),
};

const idVariants = {
  unsigned: B(idU), signed: B(idSigned), empty: Buffer.alloc(0),
  bytesBE: idBytesBE, bytesLE: idBytesLE, hex: B(idBig.toString(16)),
};

let best = { nalus: -1 };
let tries = 0;
function consider(label, key, iv) {
  const s = tryKeyIv(label, key, iv); tries++;
  if (s && (s.full || s.nalus > best.nalus)) best = { ...s, label };
}

console.log('=== direct key + eiv schemes ===');
consider('key=fpKey iv=eiv', fpKey, eiv);
for (const [en, ek] of Object.entries(eaes)) consider(`key=${en} iv=eiv`, ek, eiv);

console.log('=== SHA(constant+id || eaeskey) schemes (RPiPlay-family) ===');
for (const [en, ek] of Object.entries(eaes)) {
  for (const [idn, idb] of Object.entries(idVariants)) {
    for (const algo of ['sha512', 'sha256']) {
      // K1: SHA(const+id || eaeskey)
      const k1 = sha(algo, Buffer.concat([B('AirPlayStreamKey'), idb]), ek).subarray(0, 16);
      const v1 = sha(algo, Buffer.concat([B('AirPlayStreamIV'), idb]), ek).subarray(0, 16);
      consider(`K1 ${algo} eaes=${en} id=${idn}`, k1, v1);
      // K1 with eiv instead of derived iv
      consider(`K1key+eiv ${algo} eaes=${en} id=${idn}`, k1, eiv);
      // K2: SHA(eaeskey || const+id)
      const k2 = sha(algo, ek, Buffer.concat([B('AirPlayStreamKey'), idb])).subarray(0, 16);
      const v2 = sha(algo, ek, Buffer.concat([B('AirPlayStreamIV'), idb])).subarray(0, 16);
      consider(`K2 ${algo} eaes=${en} id=${idn}`, k2, v2);
    }
  }
}

console.log(`\ntried ${tries} combos`);
console.log('best:', best);
