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
- [ ] **M1 — Handshake.** pair-setup/verify + FairPlay `fp-setup`; iPhone connects
      and starts pushing an (encrypted) stream.
- [ ] **M2 — Picture.** AES-CTR decrypt → H.264 → WebCodecs → canvas (MVP).
- [ ] **M3 — Audio + sync.** RAOP AAC audio, A/V sync.
- [ ] **M4 — Polish.** UI, reconnect, rotation/resolution, Windows packaging.

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
