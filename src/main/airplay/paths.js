'use strict';

/**
 * Resolve the writable data directory.
 *
 * Dev / headless (`node ... mdns:test`, offline test scripts): use the project's
 * own `data/` folder next to the source, so captures and logs land in the repo.
 *
 * Packaged Electron app: the source lives inside a read-only `app.asar`, so
 * `__dirname/../../../data` would be un-writable and identity.json could not be
 * persisted (the iPhone would re-pair on every launch). Fall back to Electron's
 * per-user writable location instead.
 */

const path = require('path');

let cached = null;

function dataDir() {
  if (cached) return cached;

  // Only treat this as "packaged" when Electron says so. In a plain `node`
  // run, require('electron') resolves to the binary path (a string), so the
  // `app.isPackaged` guard below is false and we keep the repo's data dir.
  try {
    const electron = require('electron');
    const app = electron && electron.app;
    if (app && app.isPackaged) {
      cached = path.join(app.getPath('userData'), 'data');
      return cached;
    }
  } catch {
    /* not running under Electron — fall through to the dev path */
  }

  cached = path.join(__dirname, '..', '..', '..', 'data');
  return cached;
}

module.exports = { dataDir };
