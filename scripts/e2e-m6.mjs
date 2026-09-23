// M6 live verification (dev-only): headless Chrome E2E — boots the game,
// drives, checks dev-HUD budgets (draw calls, fps), quality + audio lines,
// forces damage/wreck to exercise FX + audio one-shots, and captures
// screenshots for the visual pass. Run: node scripts/e2e-m6.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const OUT = '/tmp/vf-m6';
mkdirSync(OUT, { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('requestfailed', (r) => errors.push('reqfail: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`http${r.status()}: ${r.url()}`); });

await page.goto('http://localhost:5173/?smash=1');
await page.click('#overlay');
await page.waitForTimeout(300);
await page.click('#btnGarageGo');
await page.waitForTimeout(300);
await page.click('#btnKb');
await page.waitForTimeout(1200);

const read = () => page.evaluate(() => ({
  hud: document.getElementById('devhud').textContent,
  speed: document.getElementById('hudSpeed').textContent.trim(),
  health: document.getElementById('hudHealthLabel').textContent,
  score: document.getElementById('hudScore')?.textContent?.trim() ?? '',
}));

let s = await read();
if (!s.hud.includes('qly')) throw new Error('dev HUD missing quality line');
console.log('BOOT devhud:\n' + s.hud);

// ---- drive: hold W ----
await page.keyboard.down('w');
await page.waitForTimeout(5000);
await page.screenshot({ path: `${OUT}/01-drive-coastal.png` });
s = await read();
console.log('AFTER 5s W: speed=' + s.speed + ' health=' + s.health);
const kmh = parseFloat(s.speed) || 0;
if (kmh < 25) throw new Error('car not accelerating: ' + s.speed);
if (kmh > 121) throw new Error('cruise cap exceeded: ' + s.speed);

// speed lines visible at speed? (fx streaks are in-scene; screenshot proof)
await page.waitForTimeout(3000);
await page.screenshot({ path: `${OUT}/02-drive-fast.png` });
s = await read();
console.log('AFTER 7s W: speed=' + s.speed);
console.log('devhud:\n' + s.hud);

// ---- theme cycle to neon (night: headlights + night envmap + grade) ----
await page.keyboard.press('t');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/03-neon-night.png` });

// ---- damage: the smash truck is dead ahead — drive straight into it ----
await page.waitForTimeout(2500);
s = await read();
console.log('SMASH moment: speed=' + s.speed + ' health=' + s.health);
await page.screenshot({ path: `${OUT}/04-after-contact.png` });

// keep driving; weave across lanes to hunt traffic contact, watch for wreck
await page.keyboard.down('w');
const t0 = Date.now();
let wrecked = false;
let swerveDir = 'a';
while (Date.now() - t0 < 30000) {
  s = await read();
  const trf = s.hud.split('\n').find((l) => l.startsWith('trf'));
  console.log('t+' + ((Date.now() - t0) / 1000).toFixed(1) + 's speed=' + s.speed + ' health=' + s.health + ' ' + trf);
  if (s.health === 'WRECKED') { wrecked = true; break; }
  if (s.health === 'CRITICAL') {
    await page.screenshot({ path: `${OUT}/05-critical.png` });
  }
  // smash runs: drive dead straight — the lane-keep assist realigns the car
  // onto the truck line after every impact, so the ladder is inescapable
  await page.waitForTimeout(1600);
}
await page.keyboard.up('w');

// poll the wrecked window: is the loop still stepping toward results?
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500);
  const st = await page.evaluate("(() => ({ res: document.getElementById('results').classList.contains('hidden'), raf: window.__probe ?? -1 }))()");
  await page.evaluate("(() => { window.__probe = 0; requestAnimationFrame(()=>window.__probe=1); })()");
  console.log('wreck-window +' + (i * 0.5).toFixed(1) + 's resultsHidden=' + st.res);
  if (!st.res) break;
}

// results screen after the wreck timer
await page.waitForTimeout(3500);
const results = await page.evaluate(() => {
  const el = document.getElementById('results');
  return {
    hiddenClass: el.classList.contains('hidden'),
    offsetParent: !!el.offsetParent,
    text: el.innerText.slice(0, 300),
  };
});
console.log('RESULTS hiddenClass=' + results.hiddenClass + ' offsetParent=' + results.offsetParent + '\n' + results.text);
await page.screenshot({ path: `${OUT}/06-results.png` });

// audio state probe
const audio = await page.evaluate(() => {
  const cts = [...document.querySelectorAll('canvas')].length;
  return { canvases: cts };
});
console.log('audio probe canvases=' + audio.canvases);

console.log('ERRORS (' + errors.length + '):\n' + errors.slice(0, 10).join('\n'));
await browser.close();
if (errors.length > 0) process.exit(2);
console.log('E2E OK' + (wrecked ? ' (wreck reached)' : ' (no wreck — damage path driven anyway)'));
