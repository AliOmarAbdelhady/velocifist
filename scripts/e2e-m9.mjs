// M9 live verification (dev-only): the options overlay opens mid-run (O key),
// PAUSES the sim, applies comfort/accessibility settings live, persists them
// to localStorage, survives close/reopen (controls synced), exports the save
// as a real download, and reset restores defaults. Run: node scripts/e2e-m9.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const launch = () =>
  chromium.launch({
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

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`http${r.status()}: ${r.url()}`);
});

const set = (id, value, evt) =>
  page.evaluate(
    ([sel, v, kind]) => {
      const el = document.getElementById(sel);
      if (kind === 'checkbox') el.checked = v === 'true';
      else el.value = v;
      el.dispatchEvent(new Event(kind === 'checkbox' || sel.startsWith('optReduced') || sel.startsWith('optQuality') ? 'change' : 'input', { bubbles: true }));
    },
    [id, String(value), evt],
  );

await page.goto('http://localhost:5173/');
await page.click('#overlay');
await page.waitForTimeout(200);
await page.click('#btnGarageGo');
await page.waitForTimeout(200);
await page.click('#btnKb');
await page.waitForTimeout(1200);

// ---- drive, then open options with O ----
await page.keyboard.down('w');
await page.waitForTimeout(2500);
const speedBefore = await page.evaluate(() => document.getElementById('hudKmh').textContent);
await page.keyboard.press('o');
await page.waitForTimeout(300);
const open = await page.evaluate(() => !document.getElementById('options').classList.contains('hidden'));
console.log('OPTIONS open (O key):', open);
if (!open) throw new Error('options did not open');

// ---- PAUSE: the frozen sim must hold the speed text still ----
await page.waitForTimeout(1400);
const speedPausedA = await page.evaluate(() => document.getElementById('hudKmh').textContent);
await page.waitForTimeout(1400);
const speedPausedB = await page.evaluate(() => document.getElementById('hudKmh').textContent);
console.log('PAUSE holds sim (kmh frozen):', speedPausedA, '==', speedPausedB, speedPausedA === speedPausedB);

// ---- change settings live ----
await set('optSens', 1.25);
await set('optVol', 0.5);
await set('optOneHanded', true, 'checkbox');
await set('optShake', false, 'checkbox');
await set('optLines', false, 'checkbox');
await set('optReduced', 'on');
await set('optQuality', 'low');
await page.click('#optTL');
await set('optPipScale', 1.3);
await page.waitForTimeout(200);

const store = await page.evaluate(() => JSON.parse(localStorage.getItem('vfc.settings')));
console.log('STORE:', JSON.stringify(store));
const okStore =
  store.sensitivity === 1.25 && store.volume === 0.5 && store.oneHanded === true &&
  store.shake === false && store.speedLines === false && store.reducedMotion === 'on' &&
  store.quality === 'low' && store.pipCorner === 'tl' && Math.abs(store.pipScale - 1.3) < 1e-9;
console.log('SETTINGS persisted:', okStore);
if (!okStore) throw new Error('settings did not persist');

const pipCls = await page.evaluate(() => document.getElementById('pipwrap').className);
const pipSize = await page.evaluate(() => document.getElementById('pip').style.width);
console.log('PIP layout class/size:', pipCls, pipSize);

const latencyTxt = await page.evaluate(() => document.getElementById('optLatency').textContent);
console.log('LATENCY readout:', latencyTxt);
const recalDisabled = await page.evaluate(() => document.getElementById('optRecal').disabled);
console.log('RECALIBRATE disabled in keyboard mode:', recalDisabled);

// ---- close with Escape, sim resumes and climbs under held W ----
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const closed = await page.evaluate(() => document.getElementById('options').classList.contains('hidden'));
console.log('OPTIONS closed (Escape):', closed);
await page.waitForTimeout(1800);
const speedAfter = await page.evaluate(() => document.getElementById('hudKmh').textContent);
console.log('RESUME climbs:', speedBefore, '→ (paused', speedPausedA, ') →', speedAfter, Number(speedAfter) > Number(speedPausedA));

// quality pin visible on the dev HUD
const devQuality = await page.evaluate(() => {
  const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10));
  return L.find((l) => l.startsWith('qly')) ?? '';
});
console.log('DEV quality line:', devQuality);

// ---- reopen: controls synced from the persisted settings ----
await page.keyboard.press('o');
await page.waitForTimeout(300);
const synced = await page.evaluate(() => ({
  sens: document.getElementById('optSens').value,
  one: document.getElementById('optOneHanded').checked,
  shake: document.getElementById('optShake').checked,
  red: document.getElementById('optReduced').value,
  q: document.getElementById('optQuality').value,
  tlSel: document.getElementById('optTL').classList.contains('sel'),
  scale: document.getElementById('optPipScale').value,
}));
const okSync =
  synced.sens === '1.25' && synced.one === true && synced.shake === false &&
  synced.red === 'on' && synced.q === 'low' && synced.tlSel === true && synced.scale === '1.3';
console.log('REOPEN synced:', okSync, JSON.stringify(synced));

// ---- export save: a real browser download ----
mkdirSync('/tmp/vf-m9', { recursive: true });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#optExport')]);
await dl.saveAs('/tmp/vf-m9/save.json');
const save = JSON.parse(readFileSync('/tmp/vf-m9/save.json', 'utf8'));
console.log('EXPORT download:', save.settings.sensitivity === 1.25 && Array.isArray(save.scores), '→ /tmp/vf-m9/save.json');

// ---- reset: two-click confirm restores defaults ----
await page.click('#optReset');
await page.click('#optReset');
await page.waitForTimeout(200);
const afterReset = await page.evaluate(() => JSON.parse(localStorage.getItem('vfc.settings')));
const okReset =
  afterReset.sensitivity === 1 && afterReset.oneHanded === false && afterReset.pipCorner === 'br';
console.log('RESET restores defaults:', okReset);

await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ---- leg 2: ?pipdemo=1 — one-handed enabled mid-run drives the real pipeline ----
const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message));
page2.on('console', (m) => {
  if (m.type() === 'error') errors.push('console2: ' + m.text());
});
await page2.goto('http://localhost:5173/?pipdemo=1');
await page2.click('#overlay');
await page2.waitForTimeout(200);
await page2.click('#btnGarageGo');
await page2.waitForTimeout(1500);
const pipVisible = await page2.evaluate(() => !document.getElementById('pipwrap').classList.contains('hidden'));
await page2.waitForTimeout(4000);
const demoSpeed1 = Number(await page2.evaluate(() => document.getElementById('hudKmh').textContent));
await page2.keyboard.press('o');
await page2.waitForTimeout(300);
await page2.evaluate(() => {
  const el = document.getElementById('optOneHanded');
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await page2.waitForTimeout(200);
const oneHandedSet = await page2.evaluate(() => document.getElementById('optOneHanded').checked);
await page2.keyboard.press('Escape');
// traffic RNG can legitimately wreck the demo car mid-window, which freezes
// the speed HUD — so prove the live-solver contract from the dev HUD input
// line instead (it keeps updating in every phase): with one-handed ON, the
// cycle still drives (HANDS TRACKING) and still degrades (HANDS HANDS_LOST)
const seen = new Set();
let demoMax = 0;
for (let i = 0; i < 44; i++) {
  await page2.waitForTimeout(500);
  const r = await page2.evaluate(() => ({
    line: (document.getElementById('devhud').textContent.split(String.fromCharCode(10)).find((l) => l.startsWith('in ')) ?? ''),
    kmh: document.getElementById('hudKmh').textContent,
  }));
  const m = r.line.match(/HANDS (TRACKING|PARTIAL|HANDS_LOST)/);
  if (m) seen.add(m[1]);
  if (Number(r.kmh) > demoMax) demoMax = Number(r.kmh);
}
const driveSeen = seen.has('TRACKING');
const degradeSeen = seen.has('HANDS_LOST');
console.log('PIP demo one-handed:', pipVisible, oneHandedSet, 'statuses', [...seen], 'peak', demoMax, driveSeen && degradeSeen);
await page2.close();

console.log('ERRORS:', errors.length, errors.slice(0, 3));
await browser.close();

const pass =
  open && speedPausedA === speedPausedB && okStore && closed && Number(speedAfter) > Number(speedPausedA) &&
  okSync && save.settings.sensitivity === 1.25 && okReset && devQuality.includes('pinned low') &&
  pipVisible && oneHandedSet && driveSeen && degradeSeen && errors.length === 0;
console.log(pass ? 'E2E M9 OK' : 'E2E M9 FAILED');
process.exit(pass ? 0 : 1);
