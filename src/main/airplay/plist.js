'use strict';

/**
 * Apple property-list (plist) codec helpers.
 *
 * AirPlay uses binary plists for /info responses and for the bodies of SETUP /
 * SET_PARAMETER / RECORD requests. iOS sends `Content-Type:
 * application/x-apple-binary-plist`; we both parse and produce that format.
 */

const bplistCreator = require('bplist-creator');
const bplistParser = require('bplist-parser');

/** Encode a JS object into a binary plist Buffer. */
function encode(obj) {
  return bplistCreator(obj);
}

/**
 * Decode a binary plist Buffer into a JS object.
 * bplistParser returns an array of top-level objects; we want the first.
 */
function decode(buf) {
  if (!buf || buf.length === 0) return null;
  try {
    const parsed = bplistParser.parseBuffer(buf);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (err) {
    return { __parseError: err.message };
  }
}

/** Is this body a binary plist? (magic "bplist00") */
function isBinaryPlist(buf) {
  return buf && buf.length >= 8 && buf.subarray(0, 6).toString('ascii') === 'bplist';
}

module.exports = { encode, decode, isBinaryPlist };
