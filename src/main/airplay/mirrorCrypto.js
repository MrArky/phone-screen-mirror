'use strict';

/**
 * Mirror stream AES key derivation + decryption (ported from RPiPlay
 * mirror_buffer.c, GPLv3).
 *
 * The FairPlay-decrypted 16-byte `aeskey` is NOT used directly. It is combined
 * with the pair-verify ECDH shared secret and the per-stream connection id via
 * SHA-512 to produce the actual AES-128-CTR key + IV:
 *
 *   eaeskey16 = SHA512(aeskey16 || ecdhSecret32)[0:16]
 *   streamKey = SHA512("AirPlayStreamKey"+id || eaeskey16)[0:16]
 *   streamIV  = SHA512("AirPlayStreamIV" +id || eaeskey16)[0:16]
 *
 * The stream is CTR with a position-continuous keystream across packets;
 * mirror_buffer_decrypt carries the partial-block keystream between calls via
 * `og` / `nextDecryptCount`. Node's aes-128-ctr decipher maintains the counter
 * across update() calls, so this maps 1:1.
 */

const crypto = require('crypto');

function sha512(...parts) {
  const h = crypto.createHash('sha512');
  for (const p of parts) h.update(p);
  return h.digest();
}

/**
 * @param {Buffer} aeskey 16-byte FairPlay-decrypted key
 * @param {Buffer} ecdhSecret 32-byte pair-verify shared secret
 * @param {string} streamId decimal string of the uint64 streamConnectionID
 * @returns {{key: Buffer, iv: Buffer}}
 */
function deriveStreamKeys(aeskey, ecdhSecret, streamId) {
  const eaeskey16 = sha512(aeskey.subarray(0, 16), ecdhSecret.subarray(0, 32)).subarray(0, 16);
  const key = sha512(Buffer.from(`AirPlayStreamKey${streamId}`, 'ascii'), eaeskey16).subarray(0, 16);
  const iv = sha512(Buffer.from(`AirPlayStreamIV${streamId}`, 'ascii'), eaeskey16).subarray(0, 16);
  return { key: Buffer.from(key), iv: Buffer.from(iv) };
}

class MirrorDecryptor {
  constructor(key, iv) {
    this.decipher = crypto.createDecipheriv('aes-128-ctr', key, iv);
    this.decipher.setAutoPadding(false);
    this.nextDecryptCount = 0;
    this.og = Buffer.alloc(16);
  }

  /**
   * Decrypt one mirror payload. Returns a new Buffer of the same length.
   * Mirrors mirror_buffer_decrypt exactly.
   */
  decrypt(input) {
    const inputLen = input.length;
    const output = Buffer.alloc(inputLen);
    const ndc = this.nextDecryptCount;

    // Leftover keystream from the previous packet's partial block.
    for (let i = 0; i < ndc; i++) output[i] = input[i] ^ this.og[16 - ndc + i];

    // Full 16-byte blocks go through the CTR cipher (always block-aligned here).
    const encryptlen = Math.floor((inputLen - ndc) / 16) * 16;
    if (encryptlen > 0) {
      const dec = this.decipher.update(input.subarray(ndc, ndc + encryptlen));
      dec.copy(output, ndc);
    }

    // Tail: decrypt a zero-padded block; keep its unused keystream for next time.
    const restlen = (inputLen - ndc) % 16;
    const reststart = inputLen - restlen;
    this.nextDecryptCount = 0;
    if (restlen > 0) {
      this.og.fill(0);
      input.copy(this.og, 0, reststart, reststart + restlen);
      const decOg = this.decipher.update(this.og); // 16 bytes
      decOg.copy(this.og, 0);
      for (let j = 0; j < restlen; j++) output[reststart + j] = this.og[j];
      this.nextDecryptCount = 16 - restlen;
    }
    return output;
  }
}

module.exports = { deriveStreamKeys, MirrorDecryptor };
