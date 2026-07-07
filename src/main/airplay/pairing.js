'use strict';

/**
 * Legacy AirPlay pairing (Curve25519 ECDH + Ed25519 signatures).
 *
 * Confirmed against a real iPhone (AirPlay/890.79.1) capture — this is NOT the
 * HomeKit/TLV8 scheme. Flow on one TCP connection:
 *
 *   POST /pair-setup   body = client Ed25519 long-term pubkey (32)
 *                      resp = our  Ed25519 long-term pubkey (32)
 *
 *   POST /pair-verify  (step 1) body = flags(01 00 00 00) | clientCurvePub(32) | clientEdPub(32)
 *                      resp = ourCurvePub(32) | AES-CTR(sign(ourCurvePub|clientCurvePub))(64)   = 96
 *   POST /pair-verify  (step 2) body = flags(00 00 00 00) | AES-CTR(clientSig)(64)
 *                      resp = empty; we verify clientSig over (clientCurvePub|ourCurvePub)
 *
 * The AES-CTR keystream is continuous across the two verify steps (same key/IV),
 * so we keep the cipher object on the session between requests.
 */

const crypto = require('crypto');
const {
  ed25519PublicFromRaw,
  x25519PublicFromRaw,
  rawPublicKey,
} = require('./util');

/** SHA512(label || secret) truncated to 16 bytes — AirPlay's key/IV derivation. */
function derive16(label, secret) {
  return crypto
    .createHash('sha512')
    .update(Buffer.from(label, 'utf8'))
    .update(secret)
    .digest()
    .subarray(0, 16);
}

class Pairing {
  constructor(identity, log = () => {}) {
    this.identity = identity;
    this.log = log;
    this.verifyState = null; // set during pair-verify step 1
    this.sharedSecret = null; // ECDH secret, reused for later channel crypto if needed
  }

  /** POST /pair-setup -> return our 32-byte Ed25519 public key. */
  pairSetup(_body) {
    return Buffer.from(this.identity.publicKeyHex, 'hex');
  }

  /** POST /pair-verify -> 96 bytes (step 1) or empty (step 2). */
  pairVerify(body) {
    const isStep1 = (body[0] & 0x01) === 0x01;
    if (isStep1) return this._verifyStep1(body);
    return this._verifyStep2(body);
  }

  _verifyStep1(body) {
    const clientCurvePub = body.subarray(4, 36);
    const clientEdPub = body.subarray(36, 68);

    // Our ephemeral X25519 key pair + ECDH shared secret.
    const eph = crypto.generateKeyPairSync('x25519');
    const ourCurvePub = rawPublicKey(eph.publicKey);
    const shared = crypto.diffieHellman({
      privateKey: eph.privateKey,
      publicKey: x25519PublicFromRaw(clientCurvePub),
    });
    this.sharedSecret = shared;

    // Sign (ourCurvePub || clientCurvePub) with our long-term Ed25519 key.
    const signMsg = Buffer.concat([ourCurvePub, clientCurvePub]);
    const signature = crypto.sign(null, signMsg, this.identity.privateKey); // 64 bytes

    // Encrypt the signature with AES-128-CTR keyed from the shared secret.
    const aesKey = derive16('Pair-Verify-AES-Key', shared);
    const aesIv = derive16('Pair-Verify-AES-IV', shared);
    const cipher = crypto.createCipheriv('aes-128-ctr', aesKey, aesIv);
    const encSignature = cipher.update(signature);

    // Keep cipher + keys around; the CTR keystream continues into step 2.
    this.verifyState = { cipher, ourCurvePub, clientCurvePub, clientEdPub };
    this.log(`[pairing] pair-verify step1: ecdh ok, signed ${signMsg.length}B, out 96B`);

    return Buffer.concat([ourCurvePub, encSignature]); // 96 bytes
  }

  _verifyStep2(body) {
    if (!this.verifyState) {
      this.log('[pairing] pair-verify step2 without step1 — ignoring');
      return Buffer.alloc(0);
    }
    const { cipher, ourCurvePub, clientCurvePub, clientEdPub } = this.verifyState;
    const encClientSig = body.subarray(4, 68);
    // Continue the same CTR keystream to decrypt the client's signature.
    const clientSig = cipher.update(encClientSig);

    const signMsg = Buffer.concat([clientCurvePub, ourCurvePub]);
    let ok = false;
    try {
      ok = crypto.verify(null, signMsg, ed25519PublicFromRaw(clientEdPub), clientSig);
    } catch (err) {
      this.log(`[pairing] pair-verify step2 verify error: ${err.message}`);
    }
    this.log(`[pairing] pair-verify step2: client signature ${ok ? 'VALID ✓' : 'INVALID ✗'}`);
    return Buffer.alloc(0);
  }
}

module.exports = { Pairing };
