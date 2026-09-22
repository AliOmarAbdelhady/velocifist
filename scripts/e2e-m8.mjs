// M8 live verification (dev-only): variety events fire during a real run
// (dev HUD counter + agent census + toast if caught), and the results
// screen exports run telemetry. Run: node scripts/e2e-m8.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

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

await page.goto('http://localhost:5173/');
await page.click('#overlay');
await page.waitForTimeout(200);
await page.click('#btnGarageGo');
await page.waitForTimeout(200);
await page.click('#btnKb');
await page.waitForTimeout(1000);

const probe = () => page.evaluate(() => {
  const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10));
  return {
    trf: L.find((l) => l.startsWith('trf')) ?? '',
    speed: document.getElementById('hudSpeed').textContent.trim(),
    toasts: [...document.getElementById('hudToasts').children].map((c) => c.textContent),
    health: document.getElementById('hudHealthLabel').textContent,
  };
});

// ---- drive: events inject from ~18 s; survive via assist + weaves ----
await page.keyboard.down('w');
let sawEvent = false;
let sawToast = false;
let lastTrf = '';
for (let i = 0; i < 180; i++) {
  await page.waitForTimeout(500);
  const s = await probe();
  lastTrf = s.trf;
  if (/events [1-9]/.test(s.trf)) sawEvent = true;
  if (s.toasts.some((t) => /CONVOY|ROADBLOCK|CUTTER|WEAVER|ROAD TRAIN|RUBBERNECK/i.test(t))) {
    sawToast = true;
  }
  if (s.health === 'WRECKED') break;
}
await page.keyboard.up('w');
console.log('EVENTS counter=' + (sawEvent ? 'seen' : 'MISSING') + ' toast=' + sawToast);
console.log('trf: ' + lastTrf);
if (!sawEvent) throw new Error('no event injected within 90 s');

// ---- results + export: scripted wreck (assist makes chases survivable) ----
await page.goto('http://localhost:5173/?instantwreck=1');
await page.click('#overlay');
await page.waitForTimeout(200);
await page.click('#btnGarageGo');
await page.waitForTimeout(200);
await page.click('#btnKb');
await page.waitForTimeout(1000);
for (let i = 0; i < 30; i++) {
  await page.waitForTimeout(500);
  const s = await probe();
  const st = await page.evaluate("(() => ({ res: document.getElementById('results').classList.contains('hidden'), hud: document.getElementById('hud').classList.contains('hidden') }))()");
  console.log('wreck-window +' + (i * 0.5).toFixed(1) + 's health=' + s.health + ' resultsHidden=' + st.res + ' hudHidden=' + st.hud);
  if (!st.res) break;
}

const results = await page.evaluate(() => ({
  visible: !document.getElementById('results').classList.contains('hidden'),
  exportVisible: !document.getElementById('btnExportRun').classList.contains('hidden'),
  text: document.getElementById('results').innerText.slice(0, 160),
}));
console.log('RESULTS visible=' + results.visible + ' exportBtn=' + results.exportVisible);
console.log(results.text.replace(/\n/g, ' | '));
if (!results.visible) {
  console.log('ERRORS at failure:\n' + errors.slice(0, 8).join('\n'));
  throw new Error('results never appeared');
}
if (!results.exportVisible) throw new Error('export button missing on results');

// click export: blob download may or may not surface as a Playwright
// download in headless; the button MUST at least flip to "saved ✓"
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 4000 }).catch(() => null),
  page.click('#btnExportRun'),
]);
if (dl) {
  const path = '/tmp/vf-m8/telemetry.json';
  await dl.saveAs(path);
  console.log('DOWNLOAD saved to ' + path);
}
await page.waitForTimeout(300);
const btn = await page.evaluate(() => document.getElementById('btnExportRun').textContent);
console.log('EXPORT button → ' + JSON.stringify(btn));
if (!btn.includes('saved')) throw new Error('export click did not succeed');

console.log('ERRORS (' + errors.length + '):\n' + errors.slice(0, 6).join('\n'));
await browser.close();
if (errors.length > 0) process.exit(2);
console.log('E2E M8 OK');
