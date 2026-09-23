// Phone-remote relay (M12/ADR-013): turns your phone into a real controller
// over the local network. Zero-install for the phone — it just opens a page.
//
//   node scripts/remote-relay.mjs            # relay only (game runs anywhere)
//   node scripts/remote-relay.mjs --serve    # also host the built game from dist/
//
// With --serve: play on the laptop at http://<laptop-ip>:8080/ (auto-connects
// its remote), and open http://<laptop-ip>:8080/phone on the phone.
// Without --serve: open the game as usual and use Options → Controllers →
// connect to ws://<laptop-ip>:8080.
//
// Protocol: phone → relay → game JSON frames {t:'i',s,th,br} at ~60 Hz,
// pings for latency, rumble on crashes. One phone + one game per relay
// (personal use). Nothing leaves the local network.
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

const PORT = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8080);
const HTTPS_PORT = Number(
  process.argv.includes('--https-port') ? process.argv[process.argv.indexOf('--https-port') + 1] : 8443,
);
const SERVE = process.argv.includes('--serve');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const PHONE_PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>VELOCIFIST remote</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0e14; color: #e8ecf4;
    font-family: system-ui, sans-serif; touch-action: none; user-select: none; -webkit-user-select: none; }
  #app { position: fixed; inset: 0 0 50px 0; display: flex; }
  #wheelZone { flex: 1.2; position: relative; display: flex; align-items: center; justify-content: center; }
  #wheel { width: min(46vh, 42vw); height: min(46vh, 42vw); border-radius: 50%;
    border: 10px solid #2a3346; border-top-color: #ff5a3c; background: radial-gradient(circle, #141a26 60%, #0e131d);
    box-shadow: 0 8px 30px rgba(0,0,0,.5); position: relative; }
  #wheel::after { content: ''; position: absolute; left: 50%; top: 6px; width: 6px; height: 26%;
    margin-left: -3px; border-radius: 3px; background: #ff5a3c; }
  #pedals { width: 42%; display: flex; flex-direction: column; gap: 12px; padding: 12px; box-sizing: border-box; }
  .pedal { flex: 1; border-radius: 18px; border: 2px solid rgba(255,255,255,.12); display: flex;
    align-items: center; justify-content: center; font-weight: 800; letter-spacing: .12em; font-size: 20px; }
  #gas { background: linear-gradient(160deg, #1d5c2a, #123a1c); color: #b8ffc9; }
  #gas.on { background: linear-gradient(160deg, #35c455, #1d7a35); color: #06230e; }
  #brake { background: linear-gradient(160deg, #6c1f1f, #3a1212); color: #ffc9c9; }
  #brake.on { background: linear-gradient(160deg, #e04545, #8a2222); color: #2a0606; }
  #bar { position: fixed; top: 0; left: 0; right: 0; height: 34px; display: flex; align-items: center;
    justify-content: space-between; padding: 0 14px; font: 700 12px ui-monospace, monospace;
    background: rgba(0,0,0,.45); z-index: 5; }
  #status { color: #ffb01f; } #status.ok { color: #43d17a; }
  #rotate { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 8;
    background: #0b0e14; z-index: 9; text-align: center; padding: 30px; font-size: 17px; line-height: 1.6; }
  @media (orientation: portrait) { #rotate { display: flex; } }
</style></head>
<body>
<div id="bar"><span>VELOCIFIST REMOTE</span><span id="status">connecting…</span><span id="lat"></span></div>
<div id="app">
  <div id="wheelZone"><div id="wheel"></div></div>
  <div id="pedals">
    <div class="pedal" id="gas">GAS</div>
    <div class="pedal" id="brake">BRAKE</div>
  </div>
</div>
<div id="rotate">🔄 Turn your phone sideways (landscape) — hold it like a steering wheel.</div>
<script>
'use strict';
const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/phone-ws';
let ws = null, connected = false;
const status = document.getElementById('status'), lat = document.getElementById('lat');
function connect() {
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { connected = true; status.textContent = 'connected'; status.className = 'ok'; };
  ws.onclose = () => { connected = false; status.textContent = 'reconnecting…'; status.className = '';
    setTimeout(connect, 800); };
  ws.onerror = () => ws.close();
  ws.onmessage = (ev) => {
    try { const m = JSON.parse(ev.data);
      if (m.t === 'rumble' && navigator.vibrate) navigator.vibrate([90, 40, 120]);
      if (m.t === 'pong' && m.id === pingId) lat.textContent = Math.round(performance.now() - pingSent) + ' ms';
    } catch {}
  };
}
let pingId = 0, pingSent = 0;
setInterval(() => { if (ws && ws.readyState === 1) { pingId++; pingSent = performance.now();
  ws.send(JSON.stringify({ t: 'ping', id: pingId })); } }, 800);

// ---- virtual wheel: drag anywhere in the left zone; angle ∝ drag ----
const wheel = document.getElementById('wheel'), zone = document.getElementById('wheelZone');
let wheelAngle = 0; let wheelTouch = null; let lastX = 0;
zone.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0]; wheelTouch = t.identifier; lastX = t.clientX;
}, { passive: false });
zone.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) if (t.identifier === wheelTouch) {
    wheelAngle = Math.max(-150, Math.min(150, wheelAngle + (t.clientX - lastX) * 0.85));
    lastX = t.clientX;
  }
}, { passive: false });
const endWheel = (e) => { for (const t of e.changedTouches) if (t.identifier === wheelTouch) wheelTouch = null; };
zone.addEventListener('touchend', endWheel); zone.addEventListener('touchcancel', endWheel);

// ---- pedals: hold ----
const state = { th: 0, br: 0 };
const gas = document.getElementById('gas'), brake = document.getElementById('brake');
function bindPedal(el, key) {
  const on = (e) => { e.preventDefault(); state[key] = 1; el.classList.add('on');
    if (navigator.vibrate) navigator.vibrate(12); };
  const off = (e) => { state[key] = 0; el.classList.remove('on'); };
  el.addEventListener('touchstart', on, { passive: false });
  el.addEventListener('touchend', off); el.addEventListener('touchcancel', off);
}
bindPedal(gas, 'th'); bindPedal(brake, 'br');

// ---- tilt steering (hold the phone like a wheel and TURN it) ----
// math mirrors src/input/tilt.ts exactly — keep them in sync
const RAD = Math.PI / 180;
function orientationToWheel(beta, gamma) {
  return Math.atan2(Math.sin(beta * RAD), Math.sin(gamma * RAD)) * 180 / Math.PI;
}
function wheelToSteer(wheelDeg, calibDeg, fullLockDeg) {
  var d = wheelDeg - calibDeg;
  d = d > 180 ? d - 360 : d < -180 ? d + 360 : d;
  return Math.max(-1, Math.min(1, d / fullLockDeg));
}
let tiltOn = false, tiltCalib = 0, tiltAngle = 0, tiltEvents = 0;
const btnTilt = document.getElementById('btnTilt'), btnCal = document.getElementById('btnCal');
function onOrient(ev) {
  tiltEvents++;
  if (ev.beta === null) return;
  tiltAngle = orientationToWheel(ev.beta, ev.gamma);
}
async function enableTilt() {
  // iOS 13+ requires an explicit permission grant from a user gesture
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p !== 'granted') { status.textContent = 'tilt blocked'; return; }
    }
  } catch (e) { /* non-iOS */ }
  window.addEventListener('deviceorientation', onOrient);
  tiltOn = true;
  btnTilt.textContent = 'TILT: on';
  btnTilt.style.background = '#35c455'; btnTilt.style.color = '#06230e';
  status.textContent = 'tilt ready — hold & turn like a wheel';
  // if no events arrive (insecure page / no sensor), say so clearly
  setTimeout(() => {
    if (tiltEvents === 0) status.textContent = 'no sensor — use the https:// link';
  }, 1500);
  calibrate();
}
function calibrate() {
  tiltCalib = tiltAngle;
  if (navigator.vibrate) navigator.vibrate(20);
}
btnTilt.addEventListener('click', () => { if (!tiltOn) enableTilt(); else {
  tiltOn = false; btnTilt.textContent = 'TILT: off';
  btnTilt.style.background = '#2a3346'; btnTilt.style.color = '#cfd6e4';
  window.removeEventListener('deviceorientation', onOrient);
} });
btnCal.addEventListener('click', calibrate);

// spring the wheel back when released (drag mode only)
function frame() {
  if (!tiltOn && wheelTouch === null && wheelAngle !== 0) wheelAngle *= 0.82;
  if (tiltOn) wheelAngle = (wheelToSteer(tiltAngle, tiltCalib, 95)) * 150;
  wheel.style.transform = 'rotate(' + wheelAngle.toFixed(1) + 'deg)';
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- send at 60 Hz ----
setInterval(() => {
  if (ws && ws.readyState === 1) {
    var steer = tiltOn ? +(wheelToSteer(tiltAngle, tiltCalib, 95)).toFixed(3)
                       : +(wheelAngle / 150).toFixed(3);
    ws.send(JSON.stringify({ t: 'i', s: steer, th: state.th, br: state.br }));
  }
}, 16);
connect();
</script></body></html>`;

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    if (path === '/' || path === '/phone') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(
        path === '/phone' ? PHONE_PAGE : HOST_PAGE,
      );
      return;
    }
    if (!SERVE) {
      res.writeHead(404).end('relay only — run with --serve to host the game');
      return;
    }
    let p = path;
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, 'dist', p);
    if (!file.startsWith(join(ROOT, 'dist'))) throw new Error('outside dist');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

// the relay-hosted game page gets an auto-connect flag injected
const HOST_PAGE_PLACEHOLDER = '__HOST_PAGE__';
let HOST_PAGE = '';
if (SERVE) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('dist/ not found — run `npm run build` first (or drop --serve).');
    process.exit(1);
  }
  HOST_PAGE = (await readFile(join(ROOT, 'dist', 'index.html'), 'utf8')).replace(
    '<head>',
    '<head><script>window.__VFC_RELAY=1;</script>',
  );
}

// Tilt steering needs deviceorientation, which browsers only grant on
// SECURE pages — serve the same app over https with a cached self-signed
// cert (the phone accepts the warning once; after that sensors work).
function ensureCert() {
  const dir = join(ROOT, '.certs');
  const key = join(dir, 'relay-key.pem');
  const cert = join(dir, 'relay-cert.pem');
  try {
    readFileSync(cert);
    readFileSync(key);
    return { key: readFileSync(key), cert: readFileSync(cert) };
  } catch {
    mkdirSync(dir, { recursive: true });
    console.log('generating self-signed relay certificate (one time)…');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -days 3650 ` +
        `-keyout ${key} -out ${cert} -subj "/CN=velocifist-relay" ` +
        `-addext "subjectAltName=IP:192.168.1.3,DNS:localhost"`,
      { stdio: 'pipe' },
    );
    return { key: readFileSync(key), cert: readFileSync(cert) };
  }
}
let httpsServer = null;
try {
  httpsServer = createHttpsServer(ensureCert(), (req, res) => {
    server.emit('request', req, res);
  });
  httpsServer.listen(HTTPS_PORT, '0.0.0.0');
} catch (e) {
  console.warn('https listener unavailable (tilt steering needs it):', e.message);
}

const wss = new WebSocketServer({ server });
if (httpsServer) new WebSocketServer({ server: httpsServer });
let phone = null;
let game = null;
wss.on('connection', (ws, req) => {
  const isPhone = req.url === '/phone-ws';
  if (isPhone) {
    phone = ws;
    console.log('phone connected');
    ws.on('close', () => {
      if (phone === ws) {
        phone = null;
        console.log('phone disconnected');
      }
    });
    ws.on('message', (data) => {
      if (game && game.readyState === 1) game.send(String(data));
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.t === 'ping' && ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', id: m.id }));
    });
  } else {
    game = ws;
    console.log('game connected');
    ws.on('close', () => {
      if (game === ws) game = null;
    });
    ws.on('message', (data) => {
      if (phone && phone.readyState === 1) phone.send(String(data));
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.t === 'ping' && ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', id: m.id }));
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log(`VELOCIFIST remote relay on port ${PORT}`);
  for (const ip of ips) {
    console.log(`  phone (TILT steering): https://${ip}:${HTTPS_PORT}/phone`);
    console.log(`  phone (drag wheel):    http://${ip}:${PORT}/phone`);
    if (SERVE) console.log(`  game:   http://${ip}:${PORT}/`);
    else console.log(`  game:   connect via Options → Controllers → ws://${ip}:${PORT}`);
  }
  if (!ips.length) console.log('  (no LAN IP found — check your network)');
});
