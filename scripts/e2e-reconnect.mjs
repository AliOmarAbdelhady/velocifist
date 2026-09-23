// E2E reconnect (field report): the phone's socket dies mid-session (screen
// lock / background throttling / relay hiccup) and the PHONE redials — the
// game must accept the new bridge and the pedals must work WITHOUT a page
// reload. Regression for the RemoteInput auto-reconnect fix.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const req = createRequire(import.meta.url);
const { chromium } = req(`${globalRoot}/playwright`);
const WebSocket = req('ws');

const REPLAY_PORT = 8199;
const relay = spawn('node', ['scripts/remote-relay.mjs', '--port', String(REPLAY_PORT), '--https-port', '0'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('relay did not start')), 10000);
  relay.stdout.on('data', (d) => { if (String(d).includes('relay on port')) { clearTimeout(t); resolve(); } });
  relay.stderr.on('data', (d) => reject(new Error(String(d))));
});
console.log('relay on', REPLAY_PORT);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:5173/?relay=localhost:${REPLAY_PORT}`);
await page.waitForTimeout(600);
await page.click('#overlay'); await page.waitForTimeout(250);
await page.click('#btnGarageGo'); await page.waitForTimeout(150);
await page.click('#btnKb'); await page.waitForTimeout(400);

async function phoneDial() {
  const ws = new WebSocket(`ws://127.0.0.1:${REPLAY_PORT}/phone-ws`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return ws;
}
async function waitOpen() {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    const open = await page.evaluate(() => {
      const l = document.getElementById('devhud').textContent.split('\n');
      return (l.find((x) => x.startsWith('in ')) ?? '').includes('phone');
    });
    if (open) return true;
  }
  return false;
}
const kmh = () => page.evaluate(() => Number(document.getElementById('hudKmh').textContent) || 0);

// ---- phase 1: phone drives (STREAMING frames — the real phone page sends
// continuously; single frames decay away after 500 ms by design) ----
let phone = await phoneDial();
console.log('phase 1 open:', await waitOpen());
const gas = (ws) => setInterval(() => ws.send(JSON.stringify({ t: 'i', s: 0, th: 1, br: 0 })), 100);
const idle = (ws) => setInterval(() => ws.send(JSON.stringify({ t: 'i', s: 0, th: 0, br: 0 })), 100);
let stream = gas(phone);
await page.waitForTimeout(4000);
const speed1 = await kmh();
clearInterval(stream);
stream = idle(phone);
await page.waitForTimeout(1200);
clearInterval(stream);

// ---- phase 2: socket dies (screen lock), phone redials ----
phone.terminate(); // hard kill — no close frame, like a suspended phone
await page.waitForTimeout(1500);
phone = await phoneDial(); // the phone page redials every 0.8 s; we redial for it
console.log('phase 2 open again:', await waitOpen());
stream = gas(phone);
await page.waitForTimeout(4000);
const speed2 = await kmh();
clearInterval(stream); // socket + page still alive; no reload anywhere
console.log('ERRORS:', errors.length, errors.slice(0, 2));
await browser.close();
relay.kill();

const pass = speed1 >= 60 && speed2 >= 60 && errors.length === 0;
console.log(pass ? 'E2E RECONNECT OK' : 'E2E RECONNECT FAILED');
process.exit(pass ? 0 : 1);
