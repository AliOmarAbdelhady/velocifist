import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function startKeyboard(url) {
  const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  page.on('pageerror', (e) => console.log('  PAGEERROR:', e.message));
  await page.goto(url);
  await page.waitForTimeout(700);
  await page.click('#overlay'); await page.waitForTimeout(250);
  await page.click('#btnGarageGo'); await page.waitForTimeout(150);
  await page.click('#btnKb'); await page.waitForTimeout(400);
  return page;
}
const kmh = (p) => p.evaluate(() => Number(document.getElementById('hudKmh').textContent) || 0);
const title = (p) => p.evaluate(() => document.getElementById('resultsTitle').textContent);

// C1: long idle 90 s, then gas
{
  const p = await startKeyboard('http://localhost:5173/');
  for (let t = 0; t < 9; t++) {
    await p.waitForTimeout(10000);
    process.stdout.write('  idle ' + ((t + 1) * 10) + 's: kmh=' + await kmh(p) + (t < 8 ? ' ·' : '\n'));
  }
  await p.keyboard.down('w');
  await p.waitForTimeout(5000);
  console.log('C1 gas after 90s idle: kmh =', await kmh(p), '| title =', await title(p));
  await p.keyboard.up('w');
  await p.context().close();
}

// C2: natural wreck (smash truck re-arms) -> R KEY retry -> drive
{
  const p = await startKeyboard('http://localhost:5173/?smash=1');
  await p.keyboard.down('w');
  let wrecked = false;
  for (let t = 0; t < 40 && !wrecked; t++) {
    await p.waitForTimeout(1000);
    wrecked = await p.evaluate(() => !document.getElementById('results').classList.contains('hidden'));
  }
  await p.keyboard.up('w');
  console.log('C2 wrecked after ~' + 40 + 's max: results =', wrecked, '| kmh =', await kmh(p));
  if (wrecked) {
    await p.keyboard.press('KeyR');
    await p.waitForTimeout(2500); // fresh run, before the next smash impact
    const hidden = await p.evaluate(() => document.getElementById('results').classList.contains('hidden'));
    await p.keyboard.down('w');
    await p.waitForTimeout(2500);
    console.log('C2 after R: results hidden =', hidden, '| kmh at 2.5s gas =', await kmh(p));
    await p.keyboard.up('w');
  }
  await p.context().close();
}
await browser.close();
