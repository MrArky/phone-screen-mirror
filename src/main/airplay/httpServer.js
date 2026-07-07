'use strict';

/**
 * AirPlay control server (M0 scope: observe + stub).
 *
 * AirPlay speaks an HTTP-like protocol that also uses RTSP verbs
 * (SETUP, RECORD, TEARDOWN, GET_PARAMETER, ...), so Node's `http` module can't
 * parse it reliably. We use a raw TCP server with a tiny request parser.
 *
 * For M0 we only need to:
 *   - accept the connection iOS makes when you tap this device, and
 *   - LOG every request line + headers.
 * That log is our reconnaissance for M1 (pairing + FairPlay). We reply 200 with
 * an empty body so iOS doesn't immediately error; real handlers come in M1.
 */

const net = require('net');

class AirPlayHttpServer {
  constructor(log = console.log) {
    this.log = log;
    this.server = null;
  }

  /** @returns {Promise<number>} the actually-bound port */
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
    let buffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Process as many complete request headers as are buffered.
      let sep;
      while ((sep = buffer.indexOf('\r\n\r\n')) !== -1) {
        const head = buffer.subarray(0, sep).toString('utf8');
        const lines = head.split('\r\n');
        const requestLine = lines[0] || '';
        const headers = {};
        for (const line of lines.slice(1)) {
          const idx = line.indexOf(':');
          if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }

        const contentLength = parseInt(headers['content-length'] || '0', 10);
        const bodyStart = sep + 4;
        if (buffer.length < bodyStart + contentLength) break; // wait for full body
        const body = buffer.subarray(bodyStart, bodyStart + contentLength);
        buffer = buffer.subarray(bodyStart + contentLength);

        this._handleRequest(socket, requestLine, headers, body);
      }
    });

    socket.on('error', (err) => this.log(`[http] socket error (${peer}): ${err.message}`));
    socket.on('close', () => this.log(`[http] connection closed ${peer}`));
  }

  _handleRequest(socket, requestLine, headers, body) {
    this.log(`[http] >>> ${requestLine}`);
    for (const [k, v] of Object.entries(headers)) this.log(`[http]     ${k}: ${v}`);
    if (body.length) this.log(`[http]     body: ${body.length} bytes`);

    // M0 stub reply. RTSP replies echo CSeq; HTTP requests just get 200.
    const cseq = headers['cseq'];
    const isRtsp = /RTSP\/1\.0\s*$/.test(requestLine);
    const statusLine = isRtsp ? 'RTSP/1.0 200 OK' : 'HTTP/1.1 200 OK';
    const respHeaders = ['Content-Length: 0', 'Server: AirTunes/220.68'];
    if (cseq !== undefined) respHeaders.push(`CSeq: ${cseq}`);
    socket.write(`${statusLine}\r\n${respHeaders.join('\r\n')}\r\n\r\n`);
  }

  close() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = { AirPlayHttpServer };
