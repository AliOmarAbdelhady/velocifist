import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 960, height: 540 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

async function startKeyboard(url) {
  await page.goto(url);
  await page.waitForTimeout(700);
  await page.click('#overlay');
  await page.waitForTimeout(300);
  await page.click('#btnGarageGo');
  await page.waitForTimeout(200);
  await page.click('#btnKb');
  await page.waitForTimeout(500);
}
const kmh = () => page.evaluate(() => Number(document.getElementById('hudKmh').textContent) || 0);
const inLine = () => page.evaluate(() => (document.getElementById('devhud').textContent.split('\n').find((l) => l.startsWith('in ')) || ''));

// ---- A: solo, start, idle 12 s, then gas ----
await startKeyboard('http://localhost:5173/');
await page.waitForTimeout(12000);
console.log('A idle 12s: kmh=', await kmh(), '|', await inLine());
await page.keyboard.down('w');
await page.waitForTimeout(6000);
console.log('A gas 6s:   kmh=', await kmh(), '|', await inLine());
await page.keyboard.up('w');

// ---- B: solo wreck -> results -> RETRY -> gas ----
await page.goto('http://localhost:5173/?instantwreck=1');
await page.waitForTimeout(500);
await page.click('#overlay');
await page.waitForTimeout(300);
await page.click('#btnGarageGo');
await page.waitForTimeout(150);
await page.click('#btnKb');
await page.waitForTimeout(4000); // wreck + 2.2s cinematic
await page.keyboard.down('w');
await page.waitForTimeout(2500);
console.log('B wrecked?:  title=', await page.textContent('#resultsTitle'), '| kmh=', await kmh());
await page.evaluate(() => document.getElementById('btnRetryRun').click());
await page.waitForTimeout(800);
await page.keyboard.down('w');
await page.waitForTimeout(5000);
console.log('B after retry+gas: title=', await page.textContent('#resultsTitle'), '| kmh=', await kmh());
await page.keyboard.up('w');
console.log('ERRORS:', errs.length, errs.slice(0, 3));
await browser.close();
