'use strict';

/**
 * Mirror video data stream server (ported from RPiPlay raop_rtp_mirror.c).
 *
 * iOS opens a TCP connection to this port and streams framed H.264:
 *   [128-byte header][payload]
 *   header: payloadSize=u32le@0, payloadType=u16le@4 & 0xff
 *   type 0 = encrypted H.264 video (AES-CTR); NALs are 4-byte big-endian
 *            length-prefixed (AVCC) -> rewrite prefixes to 00 00 00 01 (Annex-B).
 *   type 1 = SPS/PPS codec config (NOT encrypted) -> build Annex-B sps+pps.
 *   other  = heartbeat/misc, ignored.
 *
 * Emits 'video' with { data: Buffer(annexb), keyframe: bool, kind: 'config'|'frame' }.
 * Also emits 'nalcheck' the first time a video frame is decrypted, reporting
 * whether the NAL length prefixes partition the payload — a direct check that
 * the FairPlay/mirror key (and thus the playfair port) is correct.
 */

const net = require('net');
const { EventEmitter } = require('events');

const HEADER_SIZE = 128;

class MirrorStreamServer extends EventEmitter {
  constructor(decryptor, log = () => {}) {
    super();
    this.decryptor = decryptor;
    this.log = log;
    this.server = null;
    this.nalChecked = false;
  }

  /** @returns {Promise<number>} bound data port */
  listen() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this._onConnection(socket));
      this.server.on('error', reject);
      this.server.listen(0, () => resolve(this.server.address().port));
    });
  }

  _onConnection(socket) {
    this.log(`[mirror] data connection from ${socket.remoteAddress}:${socket.remotePort}`);
    let buf = Buffer.alloc(0);
    let header = null; // parsed header awaiting its payload

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (!header) {
          if (buf.length < HEADER_SIZE) break;
          const packet = buf.subarray(0, HEADER_SIZE);
          header = {
            packet: Buffer.from(packet),
            size: packet.readUInt32LE(0),
            type: packet.readUInt16LE(4) & 0xff,
          };
          buf = buf.subarray(HEADER_SIZE);
        }
        if (buf.length < header.size) break;
        const payload = buf.subarray(0, header.size);
        buf = buf.subarray(header.size);
        try {
          this._handlePayload(header, Buffer.from(payload));
        } catch (err) {
          this.log(`[mirror] payload error: ${err.message}`);
        }
        header = null;
      }
    });
    socket.on('error', (e) => this.log(`[mirror] socket error: ${e.message}`));
    socket.on('close', () => this.log('[mirror] data connection closed'));
  }

  _handlePayload(header, payload) {
    if (header.type === 0) this._handleVideo(payload);
    else if (header.type === 1) this._handleCodecConfig(payload);
    // other types: ignore
  }

  _handleVideo(payload) {
    // Capture the first raw (still-encrypted) payload once, for offline analysis.
    if (!this._rawEmitted) {
      this._rawEmitted = true;
      this.emit('rawpayload', Buffer.from(payload));
    }
    const decrypted = this.decryptor.decrypt(payload);

    // Convert AVCC (4-byte BE length prefixes) to Annex-B, and validate that
    // the prefixes exactly partition the payload (playfair correctness signal).
    let pos = 0;
    let nalus = 0;
    let valid = true;
    while (pos + 4 <= decrypted.length) {
      const nalLen = decrypted.readUInt32BE(pos);
      if (nalLen <= 0 || pos + 4 + nalLen > decrypted.length) {
        valid = false;
        break;
      }
      decrypted[pos] = 0;
      decrypted[pos + 1] = 0;
      decrypted[pos + 2] = 0;
      decrypted[pos + 3] = 1;
      pos += 4 + nalLen;
      nalus++;
    }
    valid = valid && pos === decrypted.length;

    if (!this.nalChecked) {
      this.nalChecked = true;
      const firstNalType = decrypted.length > 4 ? decrypted[4] & 0x1f : -1;
      this.emit('nalcheck', { valid, nalus, payloadSize: decrypted.length, firstNalType });
      this.log(
        `[mirror] first video frame: NAL partition ${valid ? 'VALID ✓ (playfair key correct)' : 'INVALID ✗ (wrong key?)'}, ` +
          `nalus=${nalus}, size=${decrypted.length}, firstNalType=${firstNalType}`
      );
    }

    // keyframe if any NAL is an IDR (type 5)
    let keyframe = false;
    let p = 0;
    while (p + 5 <= decrypted.length) {
      if (decrypted[p] === 0 && decrypted[p + 1] === 0 && decrypted[p + 2] === 0 && decrypted[p + 3] === 1) {
        if ((decrypted[p + 4] & 0x1f) === 5) keyframe = true;
      }
      // advance to next start code (linear scan is fine; frames are small)
      p++;
    }
    this.emit('video', { data: decrypted, keyframe, kind: 'frame' });
  }

  _handleCodecConfig(payload) {
    const spsSize = ((payload[6] & 0xff) << 8) + (payload[7] & 0xff);
    const sps = payload.subarray(8, 8 + spsSize);
    const ppsSize = (payload[spsSize + 9] << 8) | payload[spsSize + 10];
    const pps = payload.subarray(spsSize + 11, spsSize + 11 + ppsSize);
    const startCode = Buffer.from([0, 0, 0, 1]);
    const annexb = Buffer.concat([startCode, sps, startCode, pps]);
    this.log(`[mirror] codec config: sps=${spsSize}B pps=${ppsSize}B`);
    this.emit('video', { data: annexb, keyframe: false, kind: 'config', spsSize, ppsSize });
  }

  close() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = { MirrorStreamServer };
