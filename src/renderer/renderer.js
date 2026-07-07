'use strict';

const logEl = document.getElementById('log');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const toggleBtn = document.getElementById('toggleBtn');
const canvas = document.getElementById('screen');
const placeholder = document.getElementById('videoPlaceholder');
const demoBtn = document.getElementById('demoBtn');
const topbar = document.querySelector('.topbar');
const sidebar = document.querySelector('.sidebar');

let running = true;
const MAX_LINES = 500;

function appendLog(msg) {
  const line = document.createElement('div');
  line.className = 'line';
  if (/>>>/.test(msg)) line.classList.add('req');
  if (/error|failed/i.test(msg)) line.classList.add('err');
  line.textContent = msg;
  logEl.appendChild(line);
  while (logEl.childElementCount > MAX_LINES) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(isOn, label) {
  running = isOn;
  statusDot.classList.toggle('on', isOn);
  statusText.textContent = label || (isOn ? 'discoverable' : 'stopped');
  toggleBtn.textContent = isOn ? 'Stop' : 'Start';
}

window.mirror.onLog(appendLog);
window.mirror.onStatus((status) => {
  if (status.running) {
    setRunning(true, `discoverable · port ${status.port}`);
    if (status.name) document.getElementById('deviceName').textContent = status.name;
  } else {
    setRunning(false);
  }
});

toggleBtn.addEventListener('click', async () => {
  if (running) {
    await window.mirror.stop();
  } else {
    await window.mirror.start();
  }
});

// --- Video: WebCodecs H.264 decode -> canvas -----------------------------
// Frames arrive from the main process as Annex-B H.264 (see mirrorStream.js):
//   kind:'config' = [00 00 00 01][SPS][00 00 00 01][PPS] (unencrypted params)
//   kind:'frame'  = one decrypted access unit; keyframe flag marks IDRs.
// We run the decoder in Annex-B mode (no `description`), configuring it from the
// SPS and prepending the SPS/PPS to every keyframe so an IDR is always
// self-sufficient — this survives a mid-stream decoder rebuild after an error.
const ctx = canvas.getContext('2d');
const FRAME_DUR_US = 33333; // synthetic ~30fps timestamps; iOS sends no PTS here
const MAX_QUEUE = 10; // drop delta frames when the decoder falls behind

let decoder = null;
let codec = null; // current avc1.* string
let configBytes = null; // latest SPS+PPS Annex-B, prepended to keyframes
let sawKey = false; // gate: cannot start decoding on a delta frame
let tsCounter = 0;
let sizedTo = ''; // 'WxH' the canvas is currently sized to
let curVW = 0; // current video pixel size, for window fitting
let curVH = 0;

const hex2 = (n) => n.toString(16).padStart(2, '0');

// Ask the main process to resize the window to the phone's aspect ratio so the
// screen fills it with no side gaps. In demo mode the chrome is hidden, so its
// measured size is 0 and the window matches the video exactly.
function fitWindow() {
  if (!curVW || !curVH) return;
  window.mirror.fit({
    vw: curVW,
    vh: curVH,
    extraW: sidebar.offsetWidth, // 0 when hidden (demo mode)
    extraH: topbar.offsetHeight,
  });
}

function resetDecoder() {
  if (decoder && decoder.state !== 'closed') {
    try {
      decoder.close();
    } catch (_) {
      /* already gone */
    }
  }
  decoder = null;
  codec = null;
  sawKey = false;
}

function onFrameDecoded(videoFrame) {
  const key = `${videoFrame.displayWidth}x${videoFrame.displayHeight}`;
  if (key !== sizedTo) {
    canvas.width = videoFrame.displayWidth;
    canvas.height = videoFrame.displayHeight;
    sizedTo = key;
    curVW = videoFrame.displayWidth;
    curVH = videoFrame.displayHeight;
    fitWindow(); // shrink the window to the phone's aspect ratio
  }
  ctx.drawImage(videoFrame, 0, 0, canvas.width, canvas.height);
  videoFrame.close();
  // Once real frames are painting, the "waiting…" prompt is never wanted.
  if (!placeholder.hidden) showCanvas(true);
}

function ensureDecoder(newCodec) {
  if (decoder && decoder.state !== 'closed' && codec === newCodec) return;
  resetDecoder();
  codec = newCodec;
  decoder = new VideoDecoder({
    output: onFrameDecoded,
    error: (e) => {
      appendLog(`[video] decoder error: ${e.message}`);
      // Force a rebuild on the next config so a glitch doesn't wedge playback.
      resetDecoder();
    },
  });
  decoder.configure({ codec, optimizeForLatency: true });
  appendLog(`[video] decoder configured (${codec})`);
}

function handleConfig(data) {
  configBytes = data;
  // SPS layout after the 4-byte Annex-B start code:
  //   [0]=0x67 nal header, [1]=profile_idc, [2]=constraint_flags, [3]=level_idc
  if (data.length < 8) return;
  const profile = data[5];
  const constraints = data[6];
  const level = data[7];
  ensureDecoder(`avc1.${hex2(profile)}${hex2(constraints)}${hex2(level)}`);
}

function handleFrame(frame) {
  if (!decoder || decoder.state !== 'configured') return; // wait for config

  let type;
  let chunkData;
  if (frame.keyframe) {
    // Prepend SPS/PPS so every IDR is decodable on its own.
    chunkData = configBytes ? concat(configBytes, frame.data) : frame.data;
    type = 'key';
    sawKey = true;
  } else {
    if (!sawKey) return; // can't begin on a delta frame
    if (decoder.decodeQueueSize > MAX_QUEUE) return; // shed load to stay live
    chunkData = frame.data;
    type = 'delta';
  }

  try {
    decoder.decode(
      new EncodedVideoChunk({ type, timestamp: tsCounter++ * FRAME_DUR_US, data: chunkData })
    );
  } catch (e) {
    appendLog(`[video] decode failed: ${e.message}`);
    resetDecoder();
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function showCanvas(on) {
  canvas.hidden = !on;
  placeholder.hidden = on;
}

window.mirror.onVideo((frame) => {
  if (frame.kind === 'config') handleConfig(frame.data);
  else handleFrame(frame);
});
window.mirror.onStreamStart(() => {
  tsCounter = 0;
  sizedTo = '';
  showCanvas(true);
});
window.mirror.onStreamStop(() => {
  resetDecoder();
  configBytes = null;
  curVW = 0;
  curVH = 0;
  showCanvas(false);
});

// --- Demo mode: show ONLY the phone screen, hide all chrome ----------------
function setDemo(on) {
  document.body.classList.toggle('demo', on);
  fitWindow(); // re-fit: chrome (sidebar/topbar) is now shown or hidden
}
demoBtn.addEventListener('click', () => setDemo(!document.body.classList.contains('demo')));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') setDemo(false);
});

appendLog('[ui] renderer ready');
