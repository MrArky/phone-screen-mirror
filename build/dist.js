'use strict';

/*
 * Windows build orchestrator.
 *
 * Why this isn't just `electron-builder`:
 *   electron-builder embeds the exe icon/version via `rcedit`, which it runs
 *   out of its `winCodeSign` vendor bundle. On a stock (non-admin) Windows box
 *   that bundle can't be extracted — its 7z contains macOS symlinks and 7-Zip
 *   fails with "client does not have the required privilege" (needs Developer
 *   Mode or an elevated shell). See build notes in README.
 *
 * So we sidestep it entirely:
 *   1. `electron-builder --dir` with win.signAndEditExecutable=false  → pack the
 *      app WITHOUT touching winCodeSign (default Electron icon for now).
 *   2. Stamp our icon + version strings onto the packed exe with a *standalone*
 *      rcedit.exe (a single file, no symlinks, no admin).
 *   3. `electron-builder --prepackaged <dir>` → wrap the already-stamped app
 *      into the NSIS installer + portable exe.
 *
 * Result: a fully self-contained build with the custom icon, no admin rights,
 * no Developer Mode. Run with `npm run dist`.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const UNPACKED = path.join(ROOT, 'dist', 'win-unpacked');
const ICON = path.join(__dirname, 'icon.ico');
const RCEDIT = path.join(__dirname, 'tools', 'rcedit-x64.exe');
const RCEDIT_URL =
  'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe';

const pkg = require(path.join(ROOT, 'package.json'));
const PRODUCT = pkg.build.productName;
const VERSION = pkg.version;

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // else electron.exe runs as plain node — breaks builds
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: ROOT, env });
  if (r.status !== 0) {
    throw new Error(`${cmd} exited with ${r.status}`);
  }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, depth) => {
      if (depth > 6) return reject(new Error('too many redirects'));
      https
        .get(u, { headers: { 'User-Agent': 'phone-screen-mirror-build' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return get(res.headers.location, depth + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }
          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on('finish', () => out.close(resolve));
          out.on('error', reject);
        })
        .on('error', reject);
    };
    get(url, 0);
  });
}

/** Locate rcedit: bundled copy → electron-builder's winCodeSign cache → download. */
async function ensureRcedit() {
  if (fs.existsSync(RCEDIT)) return RCEDIT;
  fs.mkdirSync(path.dirname(RCEDIT), { recursive: true });

  const cache = path.join(
    process.env.LOCALAPPDATA || '',
    'electron-builder',
    'Cache',
    'winCodeSign'
  );
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache)) {
      const candidate = path.join(cache, dir, 'rcedit-x64.exe');
      if (fs.existsSync(candidate)) {
        fs.copyFileSync(candidate, RCEDIT);
        console.log(`rcedit: copied from cache (${candidate})`);
        return RCEDIT;
      }
    }
  }

  console.log(`rcedit: downloading ${RCEDIT_URL}`);
  await download(RCEDIT_URL, RCEDIT);
  return RCEDIT;
}

function stampExe(rcedit) {
  const exe = path.join(UNPACKED, `${PRODUCT}.exe`);
  if (!fs.existsSync(exe)) throw new Error(`packed exe not found: ${exe}`);
  const productVersion = /^\d+\.\d+\.\d+\.\d+$/.test(VERSION) ? VERSION : `${VERSION}.0`;
  run(rcedit, [
    `"${exe}"`,
    '--set-icon', `"${ICON}"`,
    '--set-version-string', 'FileDescription', `"${PRODUCT}"`,
    '--set-version-string', 'ProductName', `"${PRODUCT}"`,
    '--set-version-string', 'CompanyName', `"${PRODUCT}"`,
    '--set-version-string', 'LegalCopyright', '"GPL-3.0"',
    '--set-file-version', VERSION,
    '--set-product-version', productVersion,
  ]);
  console.log(`stamped icon + version onto ${exe}`);
}

async function main() {
  // Icon must exist before we stamp it.
  if (!fs.existsSync(ICON)) run('node', ['build/make-icon.js']);

  const rcedit = await ensureRcedit();

  // 1) pack unpacked app (no signing / no rcedit inside electron-builder)
  run('npx', ['electron-builder', '--dir']);

  // 2) stamp our icon onto the packed exe
  stampExe(rcedit);

  // 3) build installers from the already-stamped app dir
  run('npx', ['electron-builder', '--prepackaged', `"${UNPACKED}"`]);

  console.log('\n✔ build complete — see dist/');
  for (const f of fs.readdirSync(path.join(ROOT, 'dist'))) {
    if (/\.(exe|msi|zip)$/i.test(f)) console.log('   dist/' + f);
  }
}

main().catch((err) => {
  console.error('\n✖ build failed:', err.message);
  process.exit(1);
});
