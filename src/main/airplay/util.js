'use strict';

const crypto = require('crypto');

/** Pretty multi-line hex+ASCII dump of a buffer (for recon logging). */
function hexDump(buf, indent = '    ') {
  if (!buf || buf.length === 0) return `${indent}(empty)`;
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const slice = buf.subarray(i, i + 16);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(47, ' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${indent}${i.toString(16).padStart(4, '0')}  ${hex}  ${ascii}`);
  }
  return lines.join('\n');
}

// --- Raw <-> KeyObject helpers for Ed25519 / X25519 ----------------------
// Node's crypto only imports these curves via DER; we prepend the fixed ASN.1
// prefixes so we can move between raw 32-byte keys (what AirPlay sends on the
// wire) and KeyObjects (what crypto.sign / crypto.diffieHellman need).

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

function ed25519PublicFromRaw(raw32) {
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw32]),
    format: 'der',
    type: 'spki',
  });
}
function ed25519PrivateFromRaw(raw32) {
  return crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, raw32]),
    format: 'der',
    type: 'pkcs8',
  });
}
function x25519PublicFromRaw(raw32) {
  return crypto.createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw32]),
    format: 'der',
    type: 'spki',
  });
}
function x25519PrivateFromRaw(raw32) {
  return crypto.createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw32]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Extract the raw 32-byte public key from an Ed25519/X25519 KeyObject. */
function rawPublicKey(keyObject) {
  return keyObject.export({ type: 'spki', format: 'der' }).subarray(-32);
}

module.exports = {
  hexDump,
  ed25519PublicFromRaw,
  ed25519PrivateFromRaw,
  x25519PublicFromRaw,
  x25519PrivateFromRaw,
  rawPublicKey,
};
