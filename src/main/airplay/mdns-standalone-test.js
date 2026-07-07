'use strict';

/**
 * Standalone M0 verification: start the receiver WITHOUT Electron so we can
 * confirm mDNS advertising + the control server work headlessly.
 *
 *   npm run mdns:test
 *
 * Then in another terminal:
 *   dns-sd -B _airplay._tcp        (Windows/macOS, via Apple Bonjour)
 * and you should see this device listed. Or just open Control Center on an
 * iPhone on the same LAN and check Screen Mirroring.
 */

const { AirPlayReceiver } = require('./server');

const receiver = new AirPlayReceiver({ name: process.env.MIRROR_NAME || 'PC Screen Mirror' });
receiver.on('log', (m) => console.log(m));
receiver.on('status', (s) => console.log('[status]', JSON.stringify(s)));

receiver.start().catch((err) => {
  console.error('failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nshutting down…');
  receiver.stop();
  process.exit(0);
});
