'use strict';

/**
 * Offline verification harness for the FairPlay/mirror decryption chain.
 * Uses a real captured (keyMessage, ekey, ecdhSecret, streamId, rawPayload)
 * from data/debug-capture.json so we can iterate on playfair.js WITHOUT
 * needing the iPhone to reconnect. Oracle = do the decrypted NAL length
 * prefixes exactly partition the payload (valid H.264)?
 *
 *   node test/playfair-offline.js
 */

const fs = require('fs');
const path = require('path');
const { playfairDecrypt } = require('../src/main/airplay/playfair');
const { deriveStreamKeys, MirrorDecryptor } = require('../src/main/airplay/mirrorCrypto');

const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'debug-capture.json'), 'utf8'));
const keyMessage = Buffer.from(cap.keyMessage, 'hex');
const ekey = Buffer.from(cap.ekey, 'hex');
const ecdh = Buffer.from(cap.ecdhSecret, 'hex');
const raw = Buffer.from(cap.rawPayload, 'hex');
const streamId = String(cap.streamId);

const fpKey = playfairDecrypt(keyMessage, ekey);
console.log('FairPlay key :', fpKey.toString('hex'));
console.log('  (captured) :', cap.fairplayKey, fpKey.toString('hex') === cap.fairplayKey ? '(same as capture)' : '(CHANGED)');

const { key, iv } = deriveStreamKeys(fpKey, ecdh, streamId);
console.log('stream key   :', key.toString('hex'));
console.log('stream iv    :', iv.toString('hex'));

const dec = new MirrorDecryptor(key, iv);
const out = dec.decrypt(raw);

// NAL partition check
let pos = 0;
let nalus = 0;
let valid = true;
const types = [];
while (pos + 4 <= out.length) {
  const nalLen = out.readUInt32BE(pos);
  if (nalLen <= 0 || pos + 4 + nalLen > out.length) {
    valid = false;
    break;
  }
  types.push(out[pos + 4] & 0x1f);
  pos += 4 + nalLen;
  nalus++;
}
valid = valid && pos === out.length;
console.log(`\nNAL partition: ${valid ? 'VALID ✓✓✓  playfair CORRECT' : 'INVALID ✗'}`);
console.log(`  nalus=${nalus} pos=${pos}/${out.length} firstLen=${out.readUInt32BE(0)} nalTypes=[${types.slice(0, 8)}]`);
console.log(`  decrypted[0..15]: ${out.subarray(0, 16).toString('hex')}`);
