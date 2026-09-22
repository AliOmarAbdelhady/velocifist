// M7 live verification (dev-only): hands & AR pass.
// 1) ?pipdemo=1&smash=1 — synthetic hands DRIVE the real pipeline (no camera,
//    no keyboard): car accelerates on its own, statuses cycle through the
//    degradation script, the forward-collision assist engages on the ghost
//    truck, and the AR dashboard renders for screenshots.
// 2) fake-camera run — getUserMedia + worker under --use-fake-device… with
//    seeded calibration: pipeline READY, no hands → HANDS_LOST glow UX.
// Run: node scripts/e2e-m7.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const OUT = '/tmp/vf-m7';
mkdirSync(OUT, { recursive: true });

const CALIB = {
  anchorLx: 0.35, anchorLy: 0.6, anchorRx: 0.65, anchorRy: 0.6, shoulderRef: 0.3,
};

const launch = (args = []) =>
  chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      ...args,
    ],
  });

const wire = async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http${r.status()}: ${r.url()}`);
  });
  return errors;
};

// ---------------------------------------------------------------- run 1: demo
{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = await wire(page);
  await page.goto('http://localhost:5173/?pipdemo=1');
  await page.click('#overlay');
  await page.waitForTimeout(300);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(1500); // pipdemo launches straight from DRIVE

  const read = () => page.evaluate(() => ({
    hud: document.getElementById('devhud').textContent,
    speed: document.getElementById('hudSpeed').textContent.trim(),
    pip: !document.getElementById('pipwrap').classList.contains('hidden'),
    glow: document.getElementById('handGlow').className,
    assist: document.getElementById('hudAssist').classList.contains('on'),
  }));

  let s = await read();
  if (!s.pip) throw new Error('pip not visible in demo mode');
  console.log('BOOT glow=' + s.glow + ' input-line=' + s.hud.split('\n').find((l) => l.startsWith('in')));

  // demo hands drive WITHOUT any keyboard input
  await page.waitForTimeout(5000);
  s = await read();
  console.log('DEMO t+5s speed=' + s.speed + ' glow=' + s.glow);
  const kmh = parseFloat(s.speed) || 0;
  if (kmh < 40) throw new Error('synthetic hands did not accelerate the car: ' + s.speed);
  if (!s.hud.includes('HANDS')) throw new Error('arbiter not on hands source');
  await page.screenshot({ path: `${OUT}/01-pipdemo-drive.png` });

  // the demo sawtooth averages ~6 m/s — autonomous driving proof + AR cycle
  let sawLost = false;
  let sawAssist = false;
  let peakAssist = 0;
  let shotLost = false;
  let shotAssist = false;
  for (let i = 0; i < 70; i++) {
    await page.waitForTimeout(400);
    s = await read();
    const m = s.hud.match(/assist ([0-9.]+)/);
    const lvl = m ? parseFloat(m[1]) : 0;
    if (i % 5 === 0) {
      const st = await page.evaluate("(() => { const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10)); return { h: document.getElementById('hudHealthLabel').textContent, i: L.find((l) => l.startsWith('in')), w: L.find((l) => l.startsWith('wld')) }; })()");
      console.log('t+' + (i * 0.4).toFixed(1) + 's speed=' + s.speed + ' h=' + st.h + ' | ' + (st.i || '') + ' | ' + st.w);
    }
    if (lvl > peakAssist) peakAssist = lvl;
    if (s.glow.includes('glow-lost')) sawLost = true;
    if (lvl > 0.1) sawAssist = true;
    if (sawLost && !shotLost) { shotLost = true; await page.screenshot({ path: `${OUT}/02-lost.png` }); }
    if (lvl > 0.25 && !shotAssist) { shotAssist = true; await page.screenshot({ path: `${OUT}/03-assist.png` }); }
    if (i === 20) await page.screenshot({ path: `${OUT}/04-demo-mid.png` });
  }
  console.log('CYCLE sawLost=' + sawLost + ' peakAssist=' + peakAssist.toFixed(2) + ' finalSpeed=' + s.speed);
  if (!sawLost) throw new Error('hands-lost glow never appeared in the demo cycle');

  console.log('ERRORS run1 (' + errors.length + '):\n' + errors.slice(0, 6).join('\n'));
  await browser.close();
  if (errors.length > 0) process.exit(2);
}

// ------------------------------------------- run 1.5: assist chase (keyboard)
{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = await wire(page);
  await page.goto('http://localhost:5173/?smash=1');
  await page.click('#overlay');
  await page.waitForTimeout(200);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(200);
  await page.click('#btnKb');
  await page.waitForTimeout(1200);
  await page.keyboard.down('w');

  let peakAssist = 0;
  let chipSeen = false;
  let chipShot = false;
  let health = 'PRISTINE';
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(300);
    const st = await page.evaluate("(() => { const L = document.getElementById('devhud').textContent.split(String.fromCharCode(10)); return { i: L.find((l) => l.startsWith('in')), h: document.getElementById('hudHealthLabel').textContent, chip: document.getElementById('hudAssist').classList.contains('on'), v: document.getElementById('hudSpeed').textContent.trim() }; })()");
    const m = st.i && st.i.match(/assist ([0-9.]+)/);
    const lvl = m ? parseFloat(m[1]) : 0;
    if (lvl > peakAssist) peakAssist = lvl;
    if (st.chip) {
      chipSeen = true;
      if (!chipShot) {
        chipShot = true;
        await page.screenshot({ path: `${OUT}/03-assist.png` });
      }
    }
    health = st.h;
    if (health === 'WRECKED') break;
  }
  await page.keyboard.up('w');
  console.log('CHASE peakAssist=' + peakAssist.toFixed(2) + ' chip=' + chipSeen + ' health=' + health);
  if (peakAssist < 0.2) throw new Error('assist never crossed 0.2 on a full-throttle chase');
  if (!chipSeen) throw new Error('AUTO-BRAKE chip never lit');
  console.log('ERRORS run1.5 (' + errors.length + '):\n' + errors.slice(0, 6).join('\n'));
  await browser.close();
  if (errors.length > 0) process.exit(2);
}

// ------------------------------------------------------- run 2: fake camera
{
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = await wire(page);
  await page.goto('http://localhost:5173/');
  // seed calibration so the wizard is skipped; the fake video has no hands
  await page.evaluate((c) => localStorage.setItem('vfc.calib', JSON.stringify(c)), CALIB);
  await page.click('#overlay');
  await page.waitForTimeout(200);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(200);
  await page.click('#btnCam');
  await page.waitForTimeout(9000); // worker init (model load)

  const s = await page.evaluate(() => ({
    pip: !document.getElementById('pipwrap').classList.contains('hidden'),
    glow: document.getElementById('handGlow').className,
    hud: document.getElementById('devhud').textContent,
  }));
  console.log('FAKECAM pip=' + s.pip + ' glow=' + s.glow);
  console.log('FAKECAM in-line=' + s.hud.split('\n').find((l) => l.startsWith('in')));
  await page.screenshot({ path: `${OUT}/05-fakecam.png` });
  if (!s.pip) throw new Error('pip not visible on the camera path');
  console.log('ERRORS run2 (' + errors.length + '):\n' + errors.slice(0, 6).join('\n'));
  await browser.close();
  if (errors.length > 0) process.exit(2);
}

console.log('E2E M7 OK');
