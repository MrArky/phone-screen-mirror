'use strict';

/**
 * Builds the `GET /info` response plist.
 *
 * iOS queries /info right after you tap the device and uses it to decide the
 * receiver's capabilities and target display geometry. If this plist is missing
 * required keys, iOS aborts before it ever sends pair-setup — so getting /info
 * right is the gate that unlocks the rest of M1.
 *
 * Values mirror an AppleTV3,2-class receiver (see features.js). The `displays`
 * entry tells iOS what resolution to mirror at; we advertise 1080p60 for now.
 */

const plist = require('./plist');

const FEATURES_INT = 0x5a7ffee6; // low 32 bits; high bits are 0 (see features.js)

function buildInfoResponse(identity, { width = 1920, height = 1080, refreshRate = 60 } = {}) {
  const pkRaw = Buffer.from(identity.publicKeyHex, 'hex');

  const obj = {
    name: identity.name,
    deviceID: identity.deviceId,
    features: FEATURES_INT,
    statusFlags: 0x44, // 0x4 available + 0x40 (PIN not required)
    model: 'AppleTV3,2',
    srcvers: '220.68',
    vv: 2,
    pi: identity.deviceId,
    pk: pkRaw, // raw 32-byte Ed25519 public key (plist "data")
    keepAliveLowPower: 1,
    keepAliveSendStatsAsBody: 1,
    audioFormats: [
      {
        type: 100,
        audioInputFormats: 0x01000000,
        audioOutputFormats: 0x01000000,
      },
    ],
    audioLatencies: [
      {
        type: 100,
        audioType: 'default',
        inputLatencyMicros: 0,
        outputLatencyMicros: 0,
      },
    ],
    displays: [
      {
        width,
        height,
        widthPixels: width,
        heightPixels: height,
        widthPhysical: false,
        heightPhysical: false,
        refreshRate,
        maxFPS: refreshRate,
        overscanned: false,
        rotation: false,
        features: 14,
        primaryInputDevice: 1,
        uuid: 'e5f7a668-cf9a-4a5a-8b8c-000000000001',
      },
    ],
  };

  return plist.encode(obj);
}

module.exports = { buildInfoResponse, FEATURES_INT };
