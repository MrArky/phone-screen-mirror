'use strict';

/**
 * Device identity for the AirPlay receiver.
 *
 * AirPlay identifies a receiver by:
 *   - deviceid : a MAC-style ID (aa:bb:cc:dd:ee:ff). Must be stable so iOS
 *                remembers the pairing instead of re-pairing every time.
 *   - an Ed25519 key pair whose PUBLIC key is published in the mDNS TXT record
 *                as `pk` (hex) and later used in pair-setup/pair-verify (M1).
 *
 * We persist both to data/identity.json so the receiver keeps the same
 * identity across restarts.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dataDir } = require('./paths');

const DATA_DIR = dataDir();
const IDENTITY_FILE = path.join(DATA_DIR, 'identity.json');

/** Build a random, locally-administered MAC-style device id. */
function randomDeviceId() {
  const bytes = crypto.randomBytes(6);
  // Set the locally-administered bit and clear the multicast bit on the first octet.
  bytes[0] = (bytes[0] & 0xfe) | 0x02;
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':');
}

/**
 * Load the persisted identity, or create + persist a fresh one on first run.
 * @returns {{
 *   deviceId: string,
 *   name: string,
 *   publicKeyHex: string,
 *   privateKeyPem: string,
 *   publicKey: import('crypto').KeyObject,
 *   privateKey: import('crypto').KeyObject
 * }}
 */
function loadOrCreateIdentity(defaultName) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let record;
  if (fs.existsSync(IDENTITY_FILE)) {
    record = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
  } else {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    // Raw 32-byte Ed25519 public key -> hex, which is what AirPlay's `pk` expects.
    const rawPub = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
    record = {
      deviceId: randomDeviceId(),
      name: defaultName || 'PC Screen Mirror',
      publicKeyHex: rawPub.toString('hex'),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    };
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(record, null, 2));
  }

  const privateKey = crypto.createPrivateKey(record.privateKeyPem);
  const publicKey = crypto.createPublicKey(privateKey);

  return { ...record, publicKey, privateKey };
}

module.exports = { loadOrCreateIdentity };
