// M10 ship gates (dev-only): load/boot budgets on the PRODUCTION build,
// PWA offline-after-first-visit, and the GitHub-Pages sub-path base build.
// Serves dist/ itself (vite preview equivalent + a /velocifist/ prefix
// server that mimics Pages). Run: node scripts/e2e-m10.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Static server: map GET /…root/… → distRoot/… (Pages-style sub-path). */
function serve(distRoot, prefix) {
  const server = createServer(async (req, res) => {
    try {
      let p = req.url.split('?')[0];
      if (prefix) {
        if (!p.startsWith(prefix)) {
          res.writeHead(404).end('not in site scope');
          return;
        }
        p = p.slice(prefix.length) || '/';
      }
      if (p.endsWith('/')) p += 'index.html';
      const file = join(distRoot, p);
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'content-length': body.length,
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('no such file');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

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
const errors = [];
const noteHttp = (page, tag) =>
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`http${r.status()}(${tag}): ${r.url()}`);
  });

// ================= leg 1: production build at root (PWA + budgets) ==========
const root = await serve('dist', '');
const base = `http://127.0.0.1:${root.address().port}/`;
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
noteHttp(page, 'root');

const t0 = Date.now();
await page.goto(base, { waitUntil: 'load' });
const loadMs = Date.now() - t0;
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const jsBytes = res.filter((r) => r.name.endsWith('.js')).reduce((a, r) => a + (r.transferSize || 0), 0);
  return { dcl: Math.round(n.domContentLoadedEventEnd), jsBytes };
});
console.log(`LOAD: ${loadMs} ms (gate ≤ 3000) · DCL ${nav.dcl} ms · initial JS ${(nav.jsBytes / 1024).toFixed(0)} KB`);
const overlayUp = await page.evaluate(() => !document.getElementById('overlay').classList.contains('hidden'));
console.log('OVERLAY interactive:', overlayUp);

// ---- boot → driving ≤ 15 s (the full human path) ----
const tBoot = Date.now();
await page.click('#overlay');
await page.waitForTimeout(150);
await page.click('#btnGarageGo');
await page.waitForTimeout(150);
await page.click('#btnKb');
let driving = false;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(250);
  const s = await page.evaluate(() => ({
    kmh: document.getElementById('hudKmh').textContent,
    hud: !document.getElementById('hud').classList.contains('hidden'),
  }));
  if (s.hud && s.kmh !== null) {
    driving = true;
    break;
  }
}
const bootMs = Date.now() - tBoot;
console.log(`BOOT→DRIVING: ${bootMs} ms (gate ≤ 15000) · driving=${driving}`);

// ---- PWA: manifest reachable, SW controls the page ----
const manifestOk = await page.evaluate(async () => {
  const r = await fetch('manifest.webmanifest');
  return r.ok ? (await r.json()).name : null;
});
const swReady = await page.evaluate(() =>
  navigator.serviceWorker.ready.then((r) => r.active?.state ?? 'none'),
);
const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
console.log('PWA manifest:', manifestOk, '· SW ready:', swReady, '· controlled:', controlled);

// wait for first-visit priming (page posts its resource list on activation)
let primed = 0;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  primed = await page.evaluate(async () => {
    const keys = await caches.keys();
    if (!keys.length) return 0;
    const c = await caches.open(keys[0]);
    return (await c.keys()).length;
  });
  if (primed >= 3) break;
}
console.log('SW cache primed entries:', primed, '(gate ≥ 3: index + app + vendor)');

// the camera path artifacts (wasm + model, ~20 MB) go through the SAME
// cacheFirst fetch handler — fetch them explicitly from the page and confirm
// they land in the cache (keyboard boot never touches them otherwise)
const { readdir } = await import('node:fs/promises');
const assets = await readdir('dist/assets');
const bigOnes = assets.filter((f) => f.endsWith('.wasm') || f.endsWith('.task'));
const bigCached = await page.evaluate(async (files) => {
  for (const f of files) {
    const r = await fetch(`assets/${f}`);
    if (!r.ok) return false;
  }
  const keys = await caches.keys();
  const c = await caches.open(keys[0]);
  const names = (await c.keys()).map((r) => r.url.split('/').pop());
  return files.every((f) => names.includes(f));
}, bigOnes);
console.log('camera artifacts cached through SW:', bigCached, `(${bigOnes.join(', ')})`);

// ---- offline: reload with the network cut — the SW must serve everything ----
await page.context().setOffline(true);
const offOk = await page
  .reload({ waitUntil: 'load' })
  .then(async () =>
    page.evaluate(
      () =>
        !document.getElementById('overlay').classList.contains('hidden') &&
        document.getElementById('overlay').textContent.includes('CLICK TO START'),
    ),
  )
  .catch(() => false);
await page.context().setOffline(false);
console.log('OFFLINE reload boots the game:', offOk);

await page.close();
root.close();

// ================= leg 2: Pages sub-path build (/velocifist/) ===============
execSync('npx vite build --base=/velocifist/ --emptyOutDir false --outDir dist-pages', { stdio: 'inherit' });
const sub = await serve('dist-pages', '/velocifist');
const subBase = `http://127.0.0.1:${sub.address().port}/velocifist/`;
const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page2.on('pageerror', (e) => errors.push('pageerror2: ' + e.message));
page2.on('console', (m) => {
  if (m.type() === 'error') errors.push('console2: ' + m.text());
});
noteHttp(page2, 'pages');
await page2.goto(subBase, { waitUntil: 'load' });
const subOk = await page2.evaluate(() => {
  const scripts = [...document.querySelectorAll('script[type=module]')].map((s) => s.getAttribute('src'));
  const manifest = document.querySelector('link[rel=manifest]')?.getAttribute('href');
  return {
    srcOk: scripts.every((s) => s.startsWith('/velocifist/')) && scripts.length > 0,
    manifest,
  };
});
const overlay2 = await page2.evaluate(() => !document.getElementById('overlay').classList.contains('hidden'));
// drive the sub-path build briefly to prove assets actually resolve
await page2.click('#overlay');
await page2.waitForTimeout(150);
await page2.click('#btnGarageGo');
await page2.waitForTimeout(150);
await page2.click('#btnKb');
await page2.waitForTimeout(1200);
const hud2 = await page2.evaluate(() => !document.getElementById('hud').classList.contains('hidden'));
console.log('PAGES base build: asset paths', subOk.srcOk, `· manifest ${subOk.manifest} · overlay ${overlay2} · drives ${hud2}`);
await page2.close();
sub.close();

console.log('ERRORS:', errors.length, errors.slice(0, 3));
await browser.close();

const pass =
  loadMs <= 3000 && overlayUp && driving && bootMs <= 15000 && manifestOk === 'VELOCIFIST' &&
  swReady === 'activated' && controlled && primed >= 3 && bigCached && offOk &&
  subOk.srcOk && overlay2 && hud2 && errors.length === 0;
console.log(pass ? 'E2E M10 OK' : 'E2E M10 FAILED');
process.exit(pass ? 0 : 1);
