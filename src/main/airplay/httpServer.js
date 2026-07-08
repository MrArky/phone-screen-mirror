'use strict';

/**
 * AirPlay control transport (HTTP/RTSP over raw TCP).
 *
 * Responsibilities (transport only — protocol logic lives in session.js):
 *   - parse the HTTP/RTSP-like request framing (request line, headers, body),
 *   - create one AirPlaySession per connection and delegate handle(req),
 *   - serialize the response, echoing CSeq and the request's protocol token,
 *   - dump every request/response as hex to data/session-log.txt (recon).
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const { hexDump } = require('./util');
const { dataDir } = require('./paths');

const TRANSCRIPT = path.join(dataDir(), 'session-log.txt');

class AirPlayHttpServer {
  /**
   * @param {(msg:string)=>void} log
   * @param {(opts:{socket:net.Socket})=>{handle:Function}} createSession
   */
  constructor(log, createSession) {
    this.log = log || console.log;
    this.createSession = createSession;
    this.server = null;
    try {
      fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
      fs.writeFileSync(TRANSCRIPT, `=== AirPlay session log (started ${new Date().toISOString()}) ===\n`);
    } catch (_) {
      /* ignore */
    }
  }

  _transcript(text) {
    try {
      fs.appendFileSync(TRANSCRIPT, text + '\n');
    } catch (_) {
      /* ignore */
    }
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this._onConnection(socket));
      this.server.on('error', reject);
      this.server.listen(port, () => {
        const bound = this.server.address().port;
        this.log(`[http] AirPlay control server listening on ${bound}`);
        resolve(bound);
      });
    });
  }

  _onConnection(socket) {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    this.log(`[http] connection from ${peer}`);
    this._transcript(`\n--- connection from ${peer} @ ${new Date().toISOString()} ---`);

    const session = this.createSession({ socket, peer });
    let buffer = Buffer.alloc(0);
    let busy = false;

    const pump = async () => {
      if (busy) return;
      busy = true;
      try {
        for (;;) {
          const sep = buffer.indexOf('\r\n\r\n');
          if (sep === -1) break;
          const head = buffer.subarray(0, sep).toString('utf8');
          const lines = head.split('\r\n');
          const requestLine = lines[0] || '';
          const [method, rawPath, protocol] = requestLine.split(' ');
          const headers = {};
          for (const line of lines.slice(1)) {
            const idx = line.indexOf(':');
            if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
          }
          const contentLength = parseInt(headers['content-length'] || '0', 10);
          const bodyStart = sep + 4;
          if (buffer.length < bodyStart + contentLength) break; // need more bytes
          const body = buffer.subarray(bodyStart, bodyStart + contentLength);
          buffer = buffer.subarray(bodyStart + contentLength);

          const req = { method, path: rawPath || '', protocol: protocol || 'HTTP/1.1', headers, body };
          await this._dispatch(socket, session, req);
        }
      } finally {
        busy = false;
      }
    };

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      pump().catch((err) => this.log(`[http] pump error: ${err.stack || err.message}`));
    });
    socket.on('error', (err) => this.log(`[http] socket error (${peer}): ${err.message}`));
    socket.on('close', () => {
      this.log(`[http] connection closed ${peer}`);
      this._transcript(`--- closed ${peer} ---`);
      if (session && typeof session.cleanup === 'function') session.cleanup();
    });
  }

  async _dispatch(socket, session, req) {
    // Log + transcript the incoming request.
    this.log(`[http] >>> ${req.method} ${req.path} ${req.protocol}`);
    const reqDump =
      `>>> ${req.method} ${req.path} ${req.protocol}\n` +
      Object.entries(req.headers)
        .map(([k, v]) => `    ${k}: ${v}`)
        .join('\n') +
      (req.body.length ? `\n  body (${req.body.length} bytes):\n${hexDump(req.body)}` : '');
    this._transcript(reqDump);

    let resp;
    try {
      resp = await session.handle(req);
    } catch (err) {
      this.log(`[http] handler error: ${err.stack || err.message}`);
      resp = { status: 500, body: Buffer.alloc(0) };
    }
    resp = resp || { status: 200, body: Buffer.alloc(0) };
    this._writeResponse(socket, req, resp);
  }

  _writeResponse(socket, req, resp) {
    const body = resp.body || Buffer.alloc(0);
    const isRtsp = /^RTSP/.test(req.protocol);
    const statusText = resp.statusText || (resp.status === 200 ? 'OK' : 'Error');
    const statusLine = `${isRtsp ? 'RTSP/1.0' : 'HTTP/1.1'} ${resp.status} ${statusText}`;

    const headers = Object.assign({ Server: 'AirTunes/220.68' }, resp.headers || {});
    headers['Content-Length'] = String(body.length);
    if (req.headers['cseq'] !== undefined) headers['CSeq'] = req.headers['cseq'];

    const headerText = Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    socket.write(`${statusLine}\r\n${headerText}\r\n\r\n`);
    if (body.length) socket.write(body);

    this._transcript(
      `<<< ${statusLine}\n` +
        Object.entries(headers)
          .map(([k, v]) => `    ${k}: ${v}`)
          .join('\n') +
        (body.length ? `\n  body (${body.length} bytes):\n${hexDump(body)}` : '')
    );
  }

  close() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = { AirPlayHttpServer };
