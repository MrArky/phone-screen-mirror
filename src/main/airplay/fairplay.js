'use strict';

/**
 * FairPlay SAPv2 handshake (ported from RPiPlay lib/fairplay_playfair.c, GPLv3).
 *
 * Two phases happen at POST /fp-setup, distinguished by body length:
 *
 *   phase 1 (setup, 16-byte body):
 *     req[4] must be 0x03 (version); mode = req[14] (0..3).
 *     response = REPLY_MESSAGES[mode]  (142 bytes, a fixed reverse-engineered table)
 *
 *   phase 2 (handshake, 164-byte body):
 *     save the whole 164-byte message (needed later to decrypt the stream key).
 *     response = FP_HEADER(12) || req[144:164]  (32 bytes)
 *
 * Then, during SETUP, the client sends an encrypted stream key ("ekey"); we run
 * playfair_decrypt(savedMessage, ekey) to recover the 16-byte AES key. That last
 * step (the omg_hax/hand_garble transform) is implemented separately in
 * playfair.js and is only needed to actually decrypt video (M2).
 */

const { REPLY_MESSAGES, FP_HEADER } = require('./fairplay-data');

class FairPlay {
  constructor(log = () => {}) {
    this.log = log;
    this.keyMessage = null; // the 164-byte phase-2 message
  }

  /** POST /fp-setup phase 1 — 16-byte request in, 142-byte reply out. */
  setup(req) {
    if (req[4] !== 0x03) throw new Error(`unsupported FairPlay version 0x${req[4].toString(16)}`);
    const mode = req[14];
    if (mode < 0 || mode > 3) throw new Error(`invalid FairPlay mode ${mode}`);
    this.log(`[fairplay] setup phase1: mode=${mode} -> 142-byte reply`);
    return REPLY_MESSAGES[mode];
  }

  /** POST /fp-setup phase 2 — 164-byte request in, 32-byte reply out. */
  handshake(req) {
    if (req[4] !== 0x03) throw new Error(`unsupported FairPlay version 0x${req[4].toString(16)}`);
    this.keyMessage = Buffer.from(req.subarray(0, 164));
    const res = Buffer.concat([FP_HEADER, req.subarray(144, 164)]);
    this.log(`[fairplay] setup phase2: saved 164B key message -> 32-byte reply`);
    return res;
  }

  /**
   * Route a /fp-setup request by body length.
   * @returns {Buffer} response body
   */
  fpSetup(body) {
    if (body.length === 16) return this.setup(body);
    if (body.length === 164) return this.handshake(body);
    throw new Error(`unexpected fp-setup body length ${body.length}`);
  }

  /** Decrypt the stream AES key (72-byte ekey -> 16 bytes). Wired up with playfair.js. */
  decryptKey(ekey72) {
    if (!this.keyMessage) throw new Error('fp-setup phase 2 not completed');
    const { playfairDecrypt } = require('./playfair');
    return playfairDecrypt(this.keyMessage, ekey72);
  }
}

module.exports = { FairPlay };
