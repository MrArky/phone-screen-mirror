# Phone Screen Mirror

Receive an **iPhone's AirPlay screen mirroring** on your PC over the local network.
No app or jailbreak on the iPhone — it uses the built-in
**Control Center → Screen Mirroring** feature.

> Personal / self-use project. Derives protocol logic from the GPLv3 projects
> [RPiPlay](https://github.com/FDH2/UxPlay) / UxPlay, so this project is GPLv3.

## How it works

The PC pretends to be an AirPlay receiver:

```
Electron app
├─ main process  → AirPlay receiver (Node/TypeScript)
│   ├─ mDNS       advertise _airplay._tcp / _raop._tcp  (bonjour-service)
│   ├─ control    HTTP/RTSP server on :7000
│   ├─ pairing    pair-setup / pair-verify        (M1)
│   ├─ fairplay   fp-setup key unwrap             (M1)
│   └─ stream     AES-CTR decrypt → H.264 NALs     (M2)
└─ renderer      WebCodecs VideoDecoder → <canvas> (M2)
```

Design decision: the backend does **protocol + decryption only** and hands the
decrypted H.264 stream to the renderer, which decodes it with the browser's
hardware-accelerated `WebCodecs` API. Keeps the native side small and latency low.

## Status — Milestones

- [x] **M0 — Discoverable.** PC appears in the iPhone's Screen Mirroring list.
      mDNS advertising + correct `features` flags + control server verified via
      `dns-sd -B _airplay._tcp`.
- [x] **M1 — Handshake.** pair-setup/verify + FairPlay `fp-setup`; iPhone connects
      and starts pushing an (encrypted) stream.
- [x] **M2 — Picture.** AES-CTR decrypt → H.264 → WebCodecs → canvas (MVP).
- [x] **M3 — Render.** Live iPhone screen on `<canvas>`, verified on a real
      device (iOS 18.7.8). *(Audio + A/V sync still TODO — see ROADMAP.)*
- [x] **M4 — Packaging.** App icon + Windows installer / portable build via
      electron-builder. (UI polish — demo mode, aspect-fit — landed in M3;
      reconnect + rotation/resolution remain in ROADMAP.)

## Run

```bash
npm install            # installs electron + bonjour-service
npm start              # launches the Electron app (auto-starts the receiver)
```

Headless verification of the mDNS core (no GUI):

```bash
npm run mdns:test
# in another terminal:
dns-sd -B _airplay._tcp local      # should list "PC Screen Mirror"
dns-sd -L "PC Screen Mirror" _airplay._tcp local   # inspect the TXT/features
```

Then open **Control Center → Screen Mirroring** on an iPhone on the same LAN and
confirm the device appears. (Tapping it only works from M1 onward; until then
the control server just logs the requests iOS makes — useful recon for M1.)

## Build / Package (Windows)

```bash
npm run make-icon      # regenerate build/icon.* from build/make-icon.js (zero-dep)
npm run dist           # build dist/ : NSIS installer + portable .exe (icon embedded)
npm run pack           # just the unpacked app in dist/win-unpacked (fast, no installer)
```

`npm run dist` produces:

- `dist/Phone Screen Mirror Setup <ver>.exe` — NSIS installer (choose install dir).
- `dist/PhoneScreenMirror-<ver>-portable.exe` — single-file portable build.

**The app icon** is an iPhone with an app-grid screen, generated procedurally by
`build/make-icon.js` — pure Node (built-in `zlib` only, no native deps), so it
sidesteps the "no C++ toolchain" constraint. It draws an RGBA canvas with
signed-distance rounded rects and hand-writes `build/icon.ico` (multi-size) +
`build/icon.png`. Edit the palette/layout in that file and re-run `make-icon`.

**Why the build isn't a plain `electron-builder` call** (`build/dist.js`):
electron-builder stamps the exe icon with `rcedit`, which it runs out of its
`winCodeSign` vendor bundle. On a stock, non-admin Windows box that bundle can't
be extracted — its `.7z` contains macOS symlinks and 7-Zip fails with *"client
does not have the required privilege"* (would need Developer Mode or an elevated
shell). `build/dist.js` avoids it: it packs with `signAndEditExecutable:false`,
stamps the icon with a **standalone** `rcedit.exe`, then wraps the result into
the installers via `--prepackaged`. No admin, no Developer Mode required.

Persistent state (device identity / pairing) is stored under
`%APPDATA%/phone-screen-mirror/data/` in packaged builds and in the repo's
`data/` folder during development (`src/main/airplay/paths.js`).

## Layout

```
src/main/main.js               Electron main; spawns receiver, bridges IPC
src/main/airplay/identity.js   persistent deviceid + Ed25519 key pair
src/main/airplay/features.js   TXT records + features bitmask (tuning knobs)
src/main/airplay/mdns.js       Bonjour advertising
src/main/airplay/httpServer.js control server (M0: request logger + stub 200)
src/main/airplay/server.js     orchestrator
src/preload/preload.js         contextBridge API for the renderer
src/renderer/                  UI (status, log, video placeholder)
```

## Notes / gotchas

- **No C++ toolchain needed.** Everything is Node; mDNS is pure-JS so the Apple
  Bonjour **SDK** is not required (the Bonjour **runtime service** on Windows is
  fine and can coexist).
- `features`, `srcvers`, `model` in `features.js` are the primary knobs if iOS
  won't list or connect to the device.
- The device identity is persisted to `data/identity.json` (gitignored) so the
  iPhone remembers the pairing.
```
