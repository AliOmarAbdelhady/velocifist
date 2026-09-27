// M20 full-flow regression (field reports: "retry after losing does nothing",
// "start game, wait, press gas — no response"): replays the player's exact
// sequences in a real browser and fails loudly on any dead end.
// Run: node scripts/e2e-m20.mjs   (dev server on :5173)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const OUT = '/tmp/vf-m20';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
mkdirSync(OUT, { recursive: true });

const launch = () =>
  chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader'],
  });

const read = (page) => page.evaluate(() => ({
  speed: parseFloat(document.getElementById('hudSpeed').textContent) || 0,
  results: !document.getElementById('results').classList.contains('hidden'),
  camlost: !document.getElementById('camlost').classList.contains('hidden'),
  garage: !document.getElementById('garage').classList.contains('hidden'),
  camchoice: !document.getElementById('camchoice').classList.contains('hidden'),
  overlay: !document.getElementById('overlay').classList.contains('hidden'),
  health: document.getElementById('hudHealthLabel').textContent,
}));

const waitSpeed = async (page, min, timeoutMs = 12000) => {
  const t0 = Date.now();
  let s = await read(page);
  while (s.speed < min) {
    if (Date.now() - t0 > timeoutMs) return { ok: false, s };
    await page.waitForTimeout(400);
    s = await read(page);
  }
  return { ok: true, s };
};

const fail = (msg) => { throw new Error(msg); };
let step = 0;
const ok = (name) => console.log(`  ✓ ${++step}. ${name}`);

{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  // ---- Phase 1: boot → garage → keyboard → drive; idle-then-gas ----
  await page.goto(BASE + "/");
  await page.click('#overlay');
  await page.waitForTimeout(250);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(250);
  await page.click('#btnKb');
  await page.waitForTimeout(400);
  (await read(page)).camchoice && fail('camchoice still open after Keyboard only');
  ok('boot → garage → keyboard-only → in game');

  await page.keyboard.down('w');
  const r1 = await waitSpeed(page, 60, 15000);
  await page.keyboard.up('w');
  r1.ok ? ok(`gas responds from standstill (${r1.s.speed} km/h)`) : fail(`no acceleration: ${r1.s.speed}`);
  let before = (await read(page)).speed;
  await page.waitForTimeout(3000);
  const coast = (await read(page)).speed;
  coast < before ? ok(`coast decays (${before} → ${coast} km/h)`) : fail('car did not coast down');

  // idle 12 s with NO input, then gas — the "waited a while, no response" report
  await page.waitForTimeout(12000);
  before = (await read(page)).speed;
  await page.keyboard.down('w');
  const r2 = await waitSpeed(page, before + 25, 12000);
  await page.keyboard.up('w');
  r2.ok ? ok(`gas responds after 12 s idle (${before} → ${r2.s.speed} km/h)`) : fail(`gas dead after idle: ${before} → ${r2.s.speed}`);

  // steering sanity (left/right heading change)
  const h0 = await page.evaluate(() => Math.round(window.__vfHeading * 1000));
  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.down('a');
  await page.waitForTimeout(700);
  await page.keyboard.up('a');
  const h1 = await page.evaluate(() => window.__vfHeading !== undefined ? Math.round(window.__vfHeading * 1000) : null);
  await page.keyboard.up('w');
  console.log(`  (steer probe h0=${h0} h1=${h1} — informational)`);

  // ---- Phase 2: deterministic wreck → hesitate → RETRY click → gas ----
  await page.goto(BASE + "/?smash=1");
  await page.click('#overlay');
  await page.waitForTimeout(250);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(250);
  await page.click('#btnKb');
  await page.waitForTimeout(400);
  await page.keyboard.down('w');
  let s = await read(page);
  const t0 = Date.now();
  while (!s.results) {
    if (Date.now() - t0 > 90000) fail(`wreck never happened (health ${s.health}, speed ${s.speed})`);
    await page.waitForTimeout(500);
    s = await read(page);
  }
  await page.keyboard.up('w');
  ok(`wrecked → results screen (health ${s.health})`);

  await page.waitForTimeout(8000); // player hesitation on the results screen
  await page.click('#btnRetryRun');
  await page.waitForTimeout(600);
  s = await read(page);
  s.results && fail('results still open after RETRY click');
  s.speed > 5 && fail('retry did not reset the run (still moving)');
  ok('RETRY click → fresh run (results hidden, speed reset)');

  await page.keyboard.down('w');
  const r3 = await waitSpeed(page, 60, 15000);
  await page.keyboard.up('w');
  r3.ok ? ok(`gas responds on the retried run (${r3.s.speed} km/h)`) : fail(`retried run gas dead: ${r3.s.speed}`);

  // ---- Phase 3: wreck again → R key retry; then wreck → G garage ----
  await page.keyboard.down('w');
  s = await read(page);
  const t1 = Date.now();
  while (!s.results) {
    if (Date.now() - t1 > 90000) fail('second wreck never happened');
    await page.waitForTimeout(500);
    s = await read(page);
  }
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  await page.keyboard.press('r');
  await page.waitForTimeout(600);
  s = await read(page);
  s.results && fail('results still open after R key');
  ok('R key retry works');

  await page.keyboard.down('w');
  s = await read(page);
  const t2 = Date.now();
  while (!s.results) {
    if (Date.now() - t2 > 90000) fail('third wreck never happened');
    await page.waitForTimeout(500);
    s = await read(page);
  }
  await page.keyboard.up('w');
  await page.keyboard.press('g');
  await page.waitForTimeout(500);
  s = await read(page);
  s.garage || fail('garage not shown after G');
  ok('G key → garage from results');

  // garage → DRIVE again works after the whole gauntlet
  await page.click('#btnGarageGo');
  await page.waitForTimeout(250);
  await page.click('#btnKb');
  await page.waitForTimeout(400);
  await page.keyboard.down('w');
  const r4 = await waitSpeed(page, 60, 15000);
  await page.keyboard.up('w');
  r4.ok ? ok(`drive again from garage (${r4.s.speed} km/h)`) : fail(`garage re-drive dead: ${r4.s.speed}`);

  await page.screenshot({ path: `${OUT}/final.png` });
  if (errors.length) fail('page errors: ' + errors.slice(0, 4).join(' | '));
  await browser.close();
}

{
  // ---- Phase 1.5: camera DENIED -> camlost -> "Keyboard only" must launch a
  // clean game (regression: camchoice used to stay up over the running game)
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(BASE + '/');
  await page.click('#overlay');
  await page.waitForTimeout(250);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(250);
  await page.click('#btnCam');
  let s = await read(page);
  const t0 = Date.now();
  while (!s.camlost) { // headless chrome denies getUserMedia without fake flags
    if (Date.now() - t0 > 30000) fail('CAMERA LOST dialog never appeared on denial');
    await page.waitForTimeout(500);
    s = await read(page);
  }
  ok('camera denied -> CAMERA LOST dialog with a reason');
  await page.click('#btnKb2');
  await page.waitForTimeout(700);
  s = await read(page);
  s.camchoice && fail('camchoice still open after Keyboard only from camlost');
  await page.keyboard.down('w');
  const r = await waitSpeed(page, 60, 15000);
  await page.keyboard.up('w');
  r.ok ? ok(`keyboard fallback drives clean (${r.s.speed} km/h)`) : fail(`keyboard fallback dead: ${r.s.speed}`);
  await browser.close();
}

console.log('E2E M20 OK');

