'use strict';

/**
 * mDNS / Bonjour advertising.
 *
 * We use `bonjour-service` (pure-JS multicast DNS) so we do NOT depend on the
 * Apple Bonjour SDK headers to build. The Apple Bonjour daemon may also be
 * running and bound to UDP 5353; multicast-dns binds with SO_REUSEADDR so the
 * two coexist for the purpose of answering queries.
 *
 * The receiver announces two services:
 *   _airplay._tcp  -> makes the PC appear under "Screen Mirroring"
 *   _raop._tcp     -> the audio channel iOS expects to accompany it
 */

const os = require('os');
const { Bonjour } = require('bonjour-service');
const { airplayTxt, raopTxt } = require('./features');

/**
 * The SRV target host MUST be a name that iOS can resolve to this machine's LAN
 * IP. bonjour-service defaults to `os.hostname()` with no domain, producing a
 * bare "hostname." target that resolves to nothing — iOS then fails to open the
 * TCP connection before it ever reaches us. We force the mDNS "<host>.local"
 * name, for which the Apple Bonjour daemon already publishes a correct A record.
 */
function mdnsHost() {
  const h = os.hostname().replace(/\.local\.?$/i, '').replace(/\.$/, '');
  return `${h}.local`;
}

class MdnsAdvertiser {
  constructor(log = console.log) {
    this.log = log;
    this.bonjour = null;
    this.services = [];
  }

  /**
   * @param {object} opts
   * @param {string} opts.name      Friendly device name shown on the iPhone.
   * @param {number} opts.port      TCP port the AirPlay HTTP server listens on.
   * @param {object} opts.identity  From identity.loadOrCreateIdentity().
   */
  start({ name, port, identity }) {
    this.stop();
    this.bonjour = new Bonjour();
    const host = mdnsHost();

    // For _airplay._tcp the Bonjour service NAME must be the device id
    // (colon-separated MAC) followed by "@" and the friendly name is carried
    // separately; iOS reads the human name from the service instance name.
    const airplay = this.bonjour.publish({
      name,
      type: 'airplay',
      protocol: 'tcp',
      port,
      host,
      txt: airplayTxt(identity),
    });
    this.services.push(airplay);

    // _raop._tcp instance name convention is "<deviceid-hex>@<name>".
    const raopName = `${identity.deviceId.replace(/:/g, '')}@${name}`;
    const raop = this.bonjour.publish({
      name: raopName,
      type: 'raop',
      protocol: 'tcp',
      port,
      host,
      txt: raopTxt(identity),
    });
    this.services.push(raop);

    this.log(`[mdns] advertising "${name}" _airplay._tcp / _raop._tcp on port ${port} (host ${host})`);
    this.log(`[mdns] deviceid=${identity.deviceId} pk=${identity.publicKeyHex.slice(0, 16)}…`);
  }

  stop() {
    if (this.bonjour) {
      try {
        this.bonjour.unpublishAll();
        this.bonjour.destroy();
      } catch (_) {
        /* ignore */
      }
      this.bonjour = null;
      this.services = [];
    }
  }
}

module.exports = { MdnsAdvertiser };
