// M16 E2E: the PRODUCTION phone-remote path — game page over HTTPS connecting
// its remote through WSS (secure websocket) to the relay, phone over ws.
// Mirrors the live-site flow (https page → wss relay) with a local https
// server + self-signed cert, headed Chrome ignores the cert like the user
// accepting the interstitial once. Run: node scripts/e2e-m16.mjs
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const require2 = createRequire(import.meta.url);
const WebSocket = require2('ws');

const relay = spawn(
  'node',
  ['scripts/remote-relay.mjs', '--serve', '--port', '8092', '--https-port', '8093'],
  { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
);
await new Promise((resolve) => {
  relay.stdout.on('data', (d) => (String(d).includes('relay on port') ? resolve() : undefined));
  setTimeout(resolve, 4000);
});

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--ignore-certificate-errors', // = the user accepting the cert once
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

  // game over HTTPS with auto-connect (relay-served → __VFC_RELAY → wss)
  await page.goto('https://127.0.0.1:8093/', { waitUntil: 'load' });
  await page.click('#overlay');
  await page.waitForTimeout(200);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(200);
  await page.click('#btnKb');
  await page.waitForTimeout(800);

  const phone = new WebSocket('ws://127.0.0.1:8092/phone-ws');
  await new Promise((resolve, reject) => {
    phone.on('open', resolve);
    phone.on('error', reject);
  });
  const send = (o) => phone.send(JSON.stringify(o));

  let remoteOpen = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    remoteOpen = await page.evaluate(() =>
      (document.getElementById('devhud').textContent.split(String.fromCharCode(10))
        .find((l) => l.startsWith('in ')) ?? '').includes('phone'));
    if (remoteOpen) break;
  }
  console.log('HTTPS game ↔ WSS relay ↔ phone bridged:', remoteOpen);

  const t1 = setInterval(() => send({ t: 'i', s: 0, th: 1, br: 0 }), 16);
  let peak = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    peak = Math.max(peak, Number(await page.evaluate(() => document.getElementById('hudKmh').textContent)));
    if (peak > 60) break;
  }
  clearInterval(t1);
  send({ t: 'i', s: 0, th: 0, br: 0 });
  console.log('phone drives the HTTPS game:', peak, 'km/h (gate > 60)');

  console.log('ERRORS:', errors.length, errors.slice(0, 3));
  const pass = remoteOpen && peak > 60 && errors.length === 0;
  console.log(pass ? 'E2E M16 OK' : 'E2E M16 FAILED');
  phone.close();
  process.exitCode = pass ? 0 : 1;
} finally {
  await browser.close();
  relay.kill();
}
