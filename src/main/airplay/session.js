'use strict';

/**
 * Per-connection AirPlay protocol state machine.
 *
 * The transport (httpServer.js) parses a request and calls `handle(req)`, which
 * routes by method + path and returns a response object:
 *   { status, statusText?, headers?, body?: Buffer }
 *
 * M1 recon phase: /info is implemented (so iOS proceeds past discovery); the
 * pairing / FairPlay / SETUP endpoints log their request bodies and return a
 * minimal reply. Each is filled in for real once we've captured what the actual
 * iPhone sends. State that must persist across requests on this connection
 * (ephemeral keys, shared secrets, the stream AES key) lives on `this`.
 */

const plist = require('./plist');
const { buildInfoResponse } = require('./info');
const { Pairing } = require('./pairing');
const { FairPlay } = require('./fairplay');
const { deriveStreamKeys, MirrorDecryptor } = require('./mirrorCrypto');
const { MirrorStreamServer } = require('./mirrorStream');
const { RaopNtpClient } = require('./raopNtp');

class AirPlaySession {
  /**
   * @param {object} opts
   * @param {object} opts.identity  device identity (deviceid + keys)
   * @param {(msg: string) => void} opts.log
   * @param {object} [opts.hooks]   { onVideo(frame), onStreamStart(info), onStreamStop() }
   */
  constructor({ identity, log, hooks, controlPort, socket, peer }) {
    this.identity = identity;
    this.log = log || (() => {});
    this.hooks = hooks || {};
    this.controlPort = controlPort || 7000; // reported to iOS as the event port
    this.socket = socket || null;
    this.peer = peer || '';
    // Device address for the timing (NTP) exchange. socket.remoteAddress
    // includes the IPv6 zone id (e.g. fe80::…%4), which dgram needs to reach a
    // link-local peer.
    this.remoteAddress = (socket && socket.remoteAddress) || null;
    // Per-connection protocol state.
    this.pairing = new Pairing(identity, this.log);
    this.fairplay = new FairPlay(this.log);
    this.aeskey = null; // FairPlay-decrypted 16-byte key (from SETUP 1)
    this.servers = { timing: null, mirror: null };
  }

  /** Release any ports/servers this connection opened. */
  cleanup() {
    if (this.servers.timing) this.servers.timing.stop();
    if (this.servers.mirror) this.servers.mirror.close();
    this.servers = { timing: null, mirror: null };
    if (this.hooks.onStreamStop) this.hooks.onStreamStop();
  }

  /**
   * @param {{method:string, path:string, protocol:string, headers:object, body:Buffer}} req
   * @returns {Promise<{status:number, statusText?:string, headers?:object, body?:Buffer}>}
   */
  async handle(req) {
    const route = `${req.method} ${req.path.split('?')[0]}`;
    switch (route) {
      case 'GET /info':
      case 'POST /info':
        return this._info(req);
      case 'POST /pair-setup':
        return this._pairSetup(req);
      case 'POST /pair-verify':
        return this._pairVerify(req);
      case 'POST /fp-setup':
        return this._fpSetup(req);
      case 'SETUP /stream': // path varies; handled below via method check too
        return this._setup(req);
      default:
        // RTSP verbs (SETUP/RECORD/TEARDOWN/...) have arbitrary paths.
        if (req.method === 'SETUP') return this._setup(req);
        if (req.method === 'GET_PARAMETER') return this._getParameter(req);
        if (req.method === 'SET_PARAMETER') return { status: 200, body: Buffer.alloc(0) };
        if (req.method === 'RECORD') return { status: 200, headers: { 'Audio-Latency': '0' }, body: Buffer.alloc(0) };
        if (req.method === 'OPTIONS') {
          return {
            status: 200,
            headers: { Public: 'SETUP, RECORD, PAUSE, FLUSH, TEARDOWN, OPTIONS, GET_PARAMETER, SET_PARAMETER' },
            body: Buffer.alloc(0),
          };
        }
        if (req.method === 'TEARDOWN') {
          this.cleanup();
          return { status: 200, body: Buffer.alloc(0) };
        }
        if (req.method === 'FLUSH') return { status: 200, body: Buffer.alloc(0) };
        return this._stub(route, req);
    }
  }

  /** Dump the first encrypted payload + all key material for offline analysis. */
  _writeDebugCapture(streamId, key, iv, rawPayload) {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, '..', '..', '..', 'data', 'debug-capture.json');
      fs.writeFileSync(
        file,
        JSON.stringify(
          {
            keyMessage: this.fairplay.keyMessage ? this.fairplay.keyMessage.toString('hex') : null,
            ekey: this._ekeyHex,
            ecdhSecret: this.pairing.sharedSecret ? this.pairing.sharedSecret.toString('hex') : null,
            fairplayKey: this.aeskey ? this.aeskey.toString('hex') : null,
            streamId,
            streamKey: key.toString('hex'),
            streamIv: iv.toString('hex'),
            rawPayload: rawPayload.toString('hex'),
          },
          null,
          2
        )
      );
      this.log(`[session] wrote data/debug-capture.json (${rawPayload.length}B payload) for offline analysis`);
    } catch (e) {
      this.log(`[session] debug capture error: ${e.message}`);
    }
  }

  // --- GET_PARAMETER (volume etc.) ----------------------------------------
  _getParameter(req) {
    const body = req.body.toString('utf8');
    if (body.includes('volume')) {
      return {
        status: 200,
        headers: { 'Content-Type': 'text/parameters' },
        body: Buffer.from('volume: 0.0\r\n', 'utf8'),
      };
    }
    return { status: 200, body: Buffer.alloc(0) };
  }

  // --- GET /info -----------------------------------------------------------
  _info(req) {
    const body = buildInfoResponse(this.identity);
    this.log(`[session] /info -> ${body.length}-byte plist`);
    return {
      status: 200,
      headers: { 'Content-Type': 'application/x-apple-binary-plist' },
      body,
    };
  }

  // --- POST /pair-setup ---------------------------------------------------
  _pairSetup(req) {
    const body = this.pairing.pairSetup(req.body);
    return { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body };
  }

  // --- POST /pair-verify --------------------------------------------------
  _pairVerify(req) {
    const body = this.pairing.pairVerify(req.body);
    return { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body };
  }

  // --- POST /fp-setup -----------------------------------------------------
  _fpSetup(req) {
    const body = this.fairplay.fpSetup(req.body);
    return { status: 200, headers: { 'Content-Type': 'application/octet-stream' }, body };
  }

  // --- SETUP --------------------------------------------------------------
  async _setup(req) {
    const parsed = plist.isBinaryPlist(req.body) ? plist.decode(req.body) : {};
    this._logPlist('SETUP', parsed);
    let resp;
    if (Array.isArray(parsed.streams)) {
      resp = await this._setupStreams(parsed, req.body);
    } else {
      resp = await this._setupSession(parsed);
    }
    return { status: 200, headers: { 'Content-Type': 'application/x-apple-binary-plist' }, body: plist.encode(resp) };
  }

  /** SETUP 1: decrypt the stream key, report event + timing ports. */
  async _setupSession(parsed) {
    if (parsed.ekey) {
      const ekey = Buffer.from(parsed.ekey);
      this._ekeyHex = ekey.toString('hex');
      this.aeskey = this.fairplay.decryptKey(ekey);
      this.log(`[session] SETUP session: decrypted stream key ${this.aeskey.toString('hex')}`);
    }
    // eventPort: RPiPlay reports the main control port; iOS opens an extra
    // connection to it, which our transport handles like any other.
    const eventPort = this.controlPort;

    // timing: we're the NTP *client* and iOS gates the stream SETUP on us
    // actually starting the exchange. Read the device's timingPort and begin
    // sending NTP requests to it; report our own local port back.
    const deviceTimingPort = Number(parsed.timingPort) || 0;
    let timingPort = 0;
    if (deviceTimingPort && this.remoteAddress) {
      const ntp = new RaopNtpClient(this.remoteAddress, deviceTimingPort, this.log);
      timingPort = await ntp.start();
      this.servers.timing = ntp;
    } else {
      this.log(`[session] WARN: no device timingPort (${deviceTimingPort}) or address (${this.remoteAddress}); skipping NTP`);
    }

    this.log(`[session] SETUP session ports: event=${eventPort} timing=${timingPort}`);
    return { eventPort, timingPort };
  }

  /** SETUP 2: for the mirror video stream (type 110), open a data port. */
  async _setupStreams(parsed, rawBody) {
    const resStreams = [];
    for (const stream of parsed.streams) {
      const type = Number(stream.type);
      if (type === 110) {
        // bplist-parser truncates 8-byte integers to 32 bits, but
        // streamConnectionID is a full uint64 that keys the stream cipher — a
        // truncated value silently produces undecryptable video. Recover the
        // true 64-bit value from the raw plist bytes.
        const fullId = recoverU64(rawBody, stream.streamConnectionID);
        const streamId = streamIdToString(fullId);
        this.log(`[session] SETUP stream type=110 streamConnectionID=${streamId}`);
        if (!this.aeskey) {
          this.log('[session] ERROR: mirror SETUP before session key was decrypted');
          continue;
        }
        const ecdh = this.pairing.sharedSecret;
        const { key, iv } = deriveStreamKeys(this.aeskey, ecdh, streamId);
        const decryptor = new MirrorDecryptor(key, iv);
        const mirror = new MirrorStreamServer(decryptor, this.log);
        mirror.on('video', (frame) => this.hooks.onVideo && this.hooks.onVideo(frame));
        mirror.on('nalcheck', (info) => this.hooks.onStreamStart && this.hooks.onStreamStart(info));
        mirror.on('rawpayload', (raw) => this._writeDebugCapture(streamId, key, iv, raw));
        const dataPort = await mirror.listen();
        this.servers.mirror = mirror;
        this.log(`[session] mirror data port = ${dataPort}`);
        resStreams.push({ type: 110, dataPort });
      } else {
        this.log(`[session] SETUP stream type=${type} (ignored)`);
      }
    }
    return { streams: resStreams };
  }

  /** Debug: print a plist's top-level keys with type/value summaries. */
  _logPlist(tag, obj) {
    const summarize = (v) => {
      if (Buffer.isBuffer(v)) return `<Buffer ${v.length}B ${v.subarray(0, 8).toString('hex')}${v.length > 8 ? '…' : ''}>`;
      if (Array.isArray(v)) return `[${v.map(summarize).join(', ')}]`;
      if (v && typeof v === 'object') {
        return `{${Object.keys(v).map((k) => `${k}: ${summarize(v[k])}`).join(', ')}}`;
      }
      if (typeof v === 'string' && v.length > 40) return `"${v.slice(0, 40)}…"`;
      return JSON.stringify(v);
    };
    if (!obj || typeof obj !== 'object') {
      this.log(`[plist] ${tag}: (not a plist)`);
      return;
    }
    for (const k of Object.keys(obj)) {
      this.log(`[plist] ${tag}.${k} = ${summarize(obj[k])}`);
    }
  }

  _stub(route, req) {
    this.log(`[session] ${route} (stub, no handler yet)`);
    return { status: 200, body: Buffer.alloc(0) };
  }
}

/**
 * streamConnectionID must become the exact unsigned-64-bit decimal string that
 * iOS used (it keys the stream cipher). bplist-parser may hand us a Number
 * (lossy above 2^53) or a BigInt; normalize both to an unsigned decimal string.
 */
function streamIdToString(v) {
  let b;
  if (typeof v === 'bigint') b = v;
  else if (typeof v === 'number') b = BigInt(Math.trunc(v));
  else if (typeof v === 'string') return v;
  else return String(v);
  if (b < 0n) b += 1n << 64n;
  return b.toString();
}

/**
 * Recover a full unsigned 64-bit integer that bplist-parser truncated to 32
 * bits. bplist-parser@0.3.2 reads 8-byte integers with JS 32-bit bitwise ops
 * (`acc = (acc << 8) | byte`), so only the low 32 bits survive. We rescan the
 * raw plist for an 8-byte-integer object (marker 0x13) whose low 32 bits match
 * the truncated value — self-verifying, and independent of the parser.
 * @param {Buffer} rawBody the binary plist body
 * @param {number|bigint} truncated the (possibly truncated) value bplist gave us
 * @returns {bigint}
 */
function recoverU64(rawBody, truncated) {
  const t = typeof truncated === 'bigint' ? truncated : BigInt(Math.trunc(Number(truncated) || 0));
  // If it already fits in 32 bits it may still be the real value; but if the
  // plist encoded it as an 8-byte int, prefer the full-width match below.
  const low32 = t & 0xffffffffn;
  if (Buffer.isBuffer(rawBody)) {
    for (let i = 0; i + 9 <= rawBody.length; i++) {
      if (rawBody[i] !== 0x13) continue; // int, 2^3 = 8 bytes
      const v = rawBody.readBigUInt64BE(i + 1);
      if ((v & 0xffffffffn) === low32) return v;
    }
  }
  return t < 0n ? t + (1n << 64n) : t;
}

module.exports = { AirPlaySession };
