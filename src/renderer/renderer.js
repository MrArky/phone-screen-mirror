'use strict';

const logEl = document.getElementById('log');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const toggleBtn = document.getElementById('toggleBtn');

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

appendLog('[ui] renderer ready');
