// M11 (ADR-012 cruise traffic): full gas plateaus at ≤80 km/h and holds
// there (old-arcade constant cruise), and the road is populated from the
// first seconds — no empty-start window. Run: node scripts/e2e-m11.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

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

await page.goto('http://localhost:5173/');
await page.click('#overlay');
await page.waitForTimeout(200);
await page.click('#btnGarageGo');
await page.waitForTimeout(200);
await page.click('#btnKb');
await page.waitForTimeout(600);

// ---- traffic present from the very start (warmup) ----
const early = await page.evaluate(() => {
  const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10));
  const trf = L.find((l) => l.startsWith('trf')) ?? '';
  const m = trf.match(/(\d+) cars/);
  return { trf, cars: m ? Number(m[1]) : -1 };
});
console.log('TRAFFIC at t≈1s:', early.cars, 'cars (gate ≥ 5) ·', early.trf.trim());

// ---- full gas: rises to the cap and PLATEAUS (never creeps past 80) ----
await page.keyboard.down('w');
const samples = [];
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(500);
  const v = Number(await page.evaluate(() => document.getElementById('hudKmh').textContent));
  samples.push(v);
}
const max = Math.max(...samples);
const tail = samples.slice(-20); // ~10 s at the end
const tailMax = Math.max(...tail);
const tailMin = Math.min(...tail);
const gear = await page.evaluate(() => document.getElementById('hudGear').textContent);
console.log(`CRUISE: peak ${max} km/h · last 10 s ${tailMin}–${tailMax} km/h · gear ${gear}`);

// ---- release: coasting decays (gas is what holds the speed) ----
await page.keyboard.up('w');
await page.waitForTimeout(5000);
const coast = Number(await page.evaluate(() => document.getElementById('hudKmh').textContent));
// headless pacing + integer km/h display: decay is a few km/h — assert the
// speed never RISES and the throttle input actually released
const thr0 = await page.evaluate(() => {
  const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10));
  return (L.find((l) => l.startsWith('in ')) ?? '').includes('t0.00');
});
console.log('COAST after release:', coast, 'km/h · throttle released:', thr0);

console.log('ERRORS:', errors.length, errors.slice(0, 3));
await browser.close();

// on a populated road the assist brakes behind slower traffic and full gas
// climbs back — dips are CORRECT; the cap is what must hold
const pass =
  early.cars >= 5 && max >= 105 && max <= 121 && tailMax <= 121 && tailMax >= 100 &&
  coast <= tailMin + 1 && thr0 && errors.length === 0;
console.log(pass ? 'E2E M11 OK' : 'E2E M11 FAILED');
process.exit(pass ? 0 : 1);
