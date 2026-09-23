// E2E M19 (ADR-018): a full versus match between two real browser pages over
// WebRTC against a LOCAL PeerServer (no internet broker in CI):
//   host creates → code shown → guest joins by code → auto-start → synced
//   countdown → both drive (host unimpeded, guest delayed) → host wins the
//   shortened race (?vstarget=400) → VICTORY/DEFEAT screens → rematch →
//   host leaves → guest wins by disconnect.
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const PEER_PORT = 9012;
const peer = spawn('npx', ['peerjs', '--port', String(PEER_PORT), '--key', 'localtest'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('peer server did not start')), 15000);
  const ok = (d) => {
    if (String(d).includes('Started PeerServer')) {
      clearTimeout(t);
      res();
    }
  };
  peer.stdout.on('data', ok);
  peer.stderr.on('data', ok);
});
console.log('local PeerServer on', PEER_PORT);

const broker = 'broker=localhost:' + PEER_PORT + ':localtest';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const errors = { host: [], guest: [] };
function watch(page, tag) {
  page.on('pageerror', (e) => errors[tag].push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors[tag].push('console: ' + m.text());
  });
}
const host = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const guest = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
watch(host, 'host');
watch(guest, 'guest');

async function openLobby(page, url) {
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.click('#overlay'); // → garage
  await page.waitForTimeout(350);
  await page.click('#btnGarageVs'); // → versus lobby
  await page.waitForTimeout(250);
}

// host lobby → create (vstarget shortens the race for CI)
await openLobby(host, 'http://localhost:5173/?' + broker + '&vstarget=400');
await host.click('#btnVsCreate');
await host.waitForFunction(
  () => /^([2-9A-HJ-NP-Z]{5})$/.test(document.getElementById('vsCode').textContent ?? ''),
  null,
  { timeout: 45000 },
);
const code = (await host.textContent('#vsCode'))?.trim();
console.log('HOST code:', code);

// guest lobby → join with that code
await openLobby(guest, 'http://localhost:5173/?' + broker);
await guest.fill('#vsJoinInput', code);
await guest.click('#btnVsJoin');

// both should auto-launch with a countdown (host auto-starts on guest hello)
await host.waitForFunction(
  () => !document.getElementById('countdown').classList.contains('hidden'),
  null,
  { timeout: 60000 },
);
await guest.waitForFunction(
  () => !document.getElementById('countdown').classList.contains('hidden'),
  null,
  { timeout: 60000 },
);
console.log('BOTH counting down');
await host.waitForFunction(
  () => document.getElementById('countdown').classList.contains('hidden'),
  null,
  { timeout: 45000 },
);

// GO: host pins gas; guest hesitates 2.5 s so the result is deterministic
await host.keyboard.down('w');
await guest.waitForTimeout(2500);
await guest.keyboard.down('w');

// versus HUD chip must show a live gap on both sides
await host.waitForFunction(
  () => (document.getElementById('hudVersus').textContent ?? '').includes(' m'),
  null,
  { timeout: 45000 },
);
console.log('HOST chip:', await host.textContent('#hudVersus'));

// race to 400 m: host finishes first → VICTORY host, DEFEAT guest
await host.waitForFunction(
  () => document.getElementById('resultsTitle').textContent === 'VICTORY',
  null,
  { timeout: 150000 },
);
console.log('HOST finished: VICTORY');
await guest.waitForFunction(
  () => document.getElementById('resultsTitle').textContent === 'DEFEAT',
  null,
  { timeout: 60000 },
);
console.log('GUEST finished: DEFEAT');
await host.keyboard.up('w');
await guest.keyboard.up('w');

// rematch: host reseeds — both return to countdown
await host.evaluate(() => document.getElementById('btnVsRematch').click());
await host.waitForFunction(
  () => !document.getElementById('countdown').classList.contains('hidden'),
  null,
  { timeout: 45000 },
);
await guest.waitForFunction(
  () => !document.getElementById('countdown').classList.contains('hidden'),
  null,
  { timeout: 45000 },
);
console.log('REMATCH: both counting down again');

// host leaves mid-countdown → guest wins by disconnect
await host.evaluate(() => document.getElementById('btnVsQuit').click());
await guest.waitForFunction(
  () => document.getElementById('resultsTitle').textContent === 'VICTORY',
  null,
  { timeout: 45000 },
);
console.log('GUEST wins by disconnect after host left');

console.log('ERRORS host:', errors.host.length, errors.host.slice(0, 3));
console.log('ERRORS guest:', errors.guest.length, errors.guest.slice(0, 3));
await browser.close();
peer.kill();

process.on('exit', () => { try { peer.kill(); } catch {} });
const pass = errors.host.length === 0 && errors.guest.length === 0 && !!code && code.length === 5;
console.log(pass ? 'E2E M19 OK' : 'E2E M19 FAILED');
process.exit(pass ? 0 : 1);
