'use strict';

/**
 * AirPlay capability advertising.
 *
 * The single most important thing in M0 is the mDNS TXT record — specifically
 * the `features` bitmask. If it's wrong, iOS either won't list this device
 * under Control Center > Screen Mirroring, or will refuse to connect.
 *
 * The values below are the well-known-good set used by RPiPlay / UxPlay to
 * present as an AppleTV3,2-class receiver that supports video + mirroring.
 * Treat FEATURES / SRCVERS / MODEL as the primary tuning knobs while getting
 * the device to appear and connect. See:
 *   https://openairplay.github.io/airplay-spec/features.html
 */

// 64-bit features bitmask, published as two 32-bit halves "low,high".
// 0x5A7FFEE6 advertises (among others): Video, Photo, Screen mirroring,
// Audio, FairPlay auth, RTSP/2 pairing, etc.
const FEATURES_LOW = 0x5a7ffee6;
const FEATURES_HIGH = 0x00000000;
const FEATURES = `0x${FEATURES_LOW.toString(16).toUpperCase()},0x${FEATURES_HIGH.toString(16)}`;

const SRCVERS = '220.68'; // AirPlay source version we mimic.
const MODEL = 'AppleTV3,2'; // Receiver model we present as.
const STATUS_FLAGS = '0x4'; // 0x4 = "device available/ready".

/**
 * TXT record for the `_airplay._tcp` service — this is what makes the device
 * show up in the Screen Mirroring list.
 */
function airplayTxt(identity) {
  return {
    deviceid: identity.deviceId,
    features: FEATURES,
    flags: STATUS_FLAGS,
    model: MODEL,
    srcvers: SRCVERS,
    vv: '2',
    pk: identity.publicKeyHex,
    pi: identity.deviceId, // public instance id; reuse deviceid for now
  };
}

/**
 * TXT record for the `_raop._tcp` (Remote Audio Output Protocol) service.
 * Not strictly required to appear in the mirroring list, but iOS expects a
 * matching RAOP service for the audio channel, so we advertise it too.
 */
function raopTxt(identity) {
  return {
    txtvers: '1',
    ch: '2', // channels
    cn: '0,1,2,3', // supported compression (PCM, ALAC, AAC, AAC-ELD)
    et: '0,3,5', // supported encryption types
    ft: FEATURES, // same features bitmask
    md: '0,1,2', // supported metadata types
    am: MODEL,
    pk: identity.publicKeyHex,
    sf: STATUS_FLAGS,
    tp: 'UDP',
    vn: '65537',
    vs: SRCVERS,
    vv: '2',
    sr: '44100', // sample rate
    ss: '16', // sample size
  };
}

module.exports = {
  FEATURES,
  SRCVERS,
  MODEL,
  airplayTxt,
  raopTxt,
};
