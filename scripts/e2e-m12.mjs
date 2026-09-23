// M12 (ADR-013) E2E: the REAL relay relays a phone's input into the real
// game — full-throttle from a phone frame, steering from a phone frame, and
// brake-at-standstill engaging reverse (gear R). Run: node scripts/e2e-m12.mjs
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const require2 = createRequire(import.meta.url);
const WebSocket = require2('ws');

const RELAY_PORT = 8090;

// ---- boot the real relay ----
// --https-port 0: ephemeral, so a long-running dev relay on 8443 can't collide
const relay = spawn('node', ['scripts/remote-relay.mjs', '--port', String(RELAY_PORT), '--https-port', '0'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  relay.stdout.on('data', (d) => (d.includes('relay on port') ? resolve() : undefined));
  relay.stderr.on('data', (d) => reject(new Error(String(d))));
  setTimeout(resolve, 3000);
});

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1280,800',
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  // ---- game with auto-connect to the relay via ?relay= ----
  await page.goto(`http://localhost:5173/?relay=localhost:${RELAY_PORT}`);
  await page.click('#overlay');
  await page.waitForTimeout(200);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(200);
  await page.click('#btnKb');
  await page.waitForTimeout(800);

  // ---- a fake PHONE connects through the relay ----
  const phone = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/phone-ws`);
  await new Promise((resolve, reject) => {
    phone.on('open', resolve);
    phone.on('error', reject);
  });
  const send = (o) => phone.send(JSON.stringify(o));

  // wait for the game side to be connected through the relay
  let remoteOpen = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    remoteOpen = await page.evaluate(
      () =>
        (
          document
            .getElementById('devhud')
            .textContent.split(String.fromCharCode(10))
            .find((l) => l.startsWith('in ')) ?? ''
        ).includes('phone'),
    );
    if (remoteOpen) break;
  }
  console.log('RELAY phone↔game bridged (dev HUD shows phone):', remoteOpen);

  // ---- phone: full throttle ----
  const t1 = setInterval(() => send({ t: 'i', s: 0, th: 1, br: 0 }), 16);
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const v = Number(await page.evaluate(() => document.getElementById('hudKmh').textContent));
    peak = Math.max(peak, v);
    if (peak > 60) break;
  }
  console.log('PHONE throttle drives:', peak, 'km/h (gate > 60)');
  clearInterval(t1);

  // ---- phone: brake to a stop, KEEP braking → REVERSE ----
  const t2 = setInterval(() => send({ t: 'i', s: 0, th: 0, br: 1 }), 16);
  let reversed = false;
  let gear = '';
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      v: Number(document.getElementById('hudKmh').textContent),
      g: document.getElementById('hudGear').textContent,
    }));
    gear = r.g;
    if (r.g === 'R') {
      reversed = true;
      break;
    }
  }
  console.log('PHONE brake→REVERSE: gear =', JSON.stringify(gear), reversed);
  clearInterval(t2);
  send({ t: 'i', s: 0, th: 0, br: 0 });

  // ---- phone: steering reaches the car (lat changes on the dev HUD) ----
  const t3 = setInterval(() => send({ t: 'i', s: 1, th: 1, br: 0 }), 16);
  await page.waitForTimeout(2500);
  const worldLine = await page.evaluate(() => {
    const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10));
    return L.find((l) => l.startsWith('wld')) ?? L.find((l) => l.startsWith('world')) ?? '';
  });
  clearInterval(t3);
  send({ t: 'i', s: 0, th: 0, br: 0 });
  console.log('PHONE steer world line:', worldLine.trim());

  // remote input decay: phone silent → car coasts (no stuck throttle)
  await page.waitForTimeout(1200);
  const afterSilence = await page.evaluate(
    () =>
      (
        document
          .getElementById('devhud')
          .textContent.split(String.fromCharCode(10))
          .find((l) => l.startsWith('in ')) ?? ''
      ).includes('t0.00'),
  );
  console.log('REMOTE decay (throttle releases when phone goes silent):', afterSilence);

  console.log('ERRORS:', errors.length, errors.slice(0, 3));
  const pass = remoteOpen && peak > 60 && reversed && errors.length === 0;
  console.log(pass ? 'E2E M12 OK' : 'E2E M12 FAILED');
  phone.close();
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
  relay.kill();
}
