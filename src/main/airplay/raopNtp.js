'use strict';

/**
 * RAOP NTP timing client (ported from RPiPlay raop_ntp.c, GPLv3).
 *
 * During SETUP 1 iOS reports its own `timingPort` and then WAITS for the
 * receiver to begin the NTP time-sync exchange before it will advance to the
 * stream SETUP (type 110) and open the video data connection. If we never send
 * timing requests, iOS stalls forever (spamming /feedback) and no video ever
 * flows — which is exactly the symptom we hit.
 *
 * We are the NTP *client*: every ~3s we send a 32-byte request to the device's
 * timing port and read its reply. The reply carries three timestamps (t0/t1/t2)
 * from which we compute the clock offset; iOS only needs to see the exchange
 * happening to proceed, but we compute the offset faithfully in case A/V sync
 * later needs it.
 *
 *   request[0..3] = 80 d2 00 07   (rest zero, send-time NTP timestamp @ offset 24)
 *   reply: t0 @ 8, t1 @ 16, t2 @ 24  (NTP timestamps, µs since 1900)
 */

const dgram = require('dgram');

const SECONDS_FROM_1900_TO_1970 = 2208988800n;

/** Write a µs-since-1970 time as an 8-byte NTP timestamp (big-endian). */
function putNtpTimestamp(buf, offset, usSince1970) {
  let seconds = usSince1970 / 1000000n + SECONDS_FROM_1900_TO_1970;
  const micro = usSince1970 % 1000000n;
  const fraction = (micro << 32n) / 1000000n;
  buf.writeUInt32BE(Number(seconds & 0xffffffffn), offset);
  buf.writeUInt32BE(Number(fraction & 0xffffffffn), offset + 4);
}

/** Read an 8-byte NTP timestamp as µs since the Unix epoch. */
function getNtpTimestamp(buf, offset) {
  const seconds = BigInt(buf.readUInt32BE(offset)) - SECONDS_FROM_1900_TO_1970;
  const fraction = BigInt(buf.readUInt32BE(offset + 4));
  return seconds * 1000000n + ((fraction * 1000000n) >> 32n);
}

class RaopNtpClient {
  /**
   * @param {string} remoteAddress device IP (may include %zone for IPv6 link-local)
   * @param {number} remotePort    device's timingPort from SETUP 1
   * @param {(m:string)=>void} log
   */
  constructor(remoteAddress, remotePort, log = () => {}) {
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.log = log;
    this.socket = null;
    this.timer = null;
    this.offset = 0n; // remote - local, in µs
    this._synced = false;
  }

  /** Bind our UDP socket and start the periodic exchange. @returns {Promise<number>} local port */
  async start() {
    const isV6 = this.remoteAddress.includes(':');
    this.socket = dgram.createSocket(isV6 ? 'udp6' : 'udp4');
    this.socket.on('message', (msg) => this._onResponse(msg));
    this.socket.on('error', (e) => this.log(`[ntp] socket error: ${e.message}`));
    await new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.bind(0, resolve);
    });
    const port = this.socket.address().port;
    this._send();
    this.timer = setInterval(() => this._send(), 3000);
    if (this.timer.unref) this.timer.unref();
    this.log(`[ntp] timing client on local port ${port} -> device ${this.remoteAddress}:${this.remotePort}`);
    return port;
  }

  _localTimeUs() {
    // CLOCK_REALTIME in µs. ms precision is plenty for sync purposes.
    return BigInt(Date.now()) * 1000n;
  }

  _send() {
    if (!this.socket) return;
    const req = Buffer.alloc(32);
    req[0] = 0x80;
    req[1] = 0xd2;
    req[2] = 0x00;
    req[3] = 0x07;
    putNtpTimestamp(req, 24, this._localTimeUs());
    this.socket.send(req, this.remotePort, this.remoteAddress, (err) => {
      if (err) this.log(`[ntp] send error: ${err.message}`);
    });
  }

  _onResponse(msg) {
    if (msg.length < 32) return;
    const t3 = this._localTimeUs();
    const t0 = getNtpTimestamp(msg, 8);
    const t1 = getNtpTimestamp(msg, 16);
    const t2 = getNtpTimestamp(msg, 24);
    this.offset = ((t1 - t0) + (t2 - t3)) / 2n;
    if (!this._synced) {
      this._synced = true;
      this.log(`[ntp] timing sync established (offset=${this.offset}µs)`);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_) {
        /* ignore */
      }
    }
    this.timer = null;
    this.socket = null;
  }
}

module.exports = { RaopNtpClient, putNtpTimestamp, getNtpTimestamp };
