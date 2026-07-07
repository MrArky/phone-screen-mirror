'use strict';

/**
 * AirPlay receiver orchestrator.
 *
 * Wires together the pieces of the receiver:
 *   identity  -> stable deviceid + Ed25519 key pair
 *   http      -> AirPlay control server (must bind first so we know the port)
 *   mdns      -> advertise _airplay._tcp / _raop._tcp pointing at that port
 *
 * Emits log lines via the injected `log` callback so the Electron UI can show
 * them. Later milestones add pairing, FairPlay, and the mirror stream.
 */

const { EventEmitter } = require('events');
const { loadOrCreateIdentity } = require('./identity');
const { MdnsAdvertiser } = require('./mdns');
const { AirPlayHttpServer } = require('./httpServer');

const DEFAULT_PORT = 7000; // conventional AirPlay port

class AirPlayReceiver extends EventEmitter {
  /** @param {{name?: string, port?: number}} [opts] */
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'PC Screen Mirror';
    this.port = opts.port || DEFAULT_PORT;
    this.log = (msg) => this.emit('log', msg);
    this.identity = null;
    this.http = new AirPlayHttpServer(this.log);
    this.mdns = new MdnsAdvertiser(this.log);
  }

  async start() {
    this.identity = loadOrCreateIdentity(this.name);
    this.log(`[receiver] starting as "${this.name}"`);

    const boundPort = await this.http.listen(this.port);
    this.port = boundPort;

    this.mdns.start({ name: this.name, port: boundPort, identity: this.identity });

    this.emit('status', { running: true, name: this.name, port: boundPort });
    this.log('[receiver] ready — look for this device under iPhone Screen Mirroring');
  }

  stop() {
    this.mdns.stop();
    this.http.close();
    this.emit('status', { running: false });
    this.log('[receiver] stopped');
  }
}

module.exports = { AirPlayReceiver };
