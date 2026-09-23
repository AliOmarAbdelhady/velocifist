import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const peer = spawn('npx', ['peerjs', '--port', '9014', '--key', 'localtest'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no peer')), 15000); const ok = (d) => { if (String(d).includes('Started PeerServer')) { clearTimeout(t); res(); } }; peer.stdout.on('data', ok); peer.stderr.on('data', ok); });
const broker = 'broker=localhost:9014:localtest';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const mk = async () => (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const host = await mk(), guest = await mk();
host.on('console', (m) => { if (m.type() === 'error') console.log('HOST console:', m.text().slice(0, 120)); });
async function lobby(p, url) { await p.goto(url); await p.waitForTimeout(700); await p.click('#overlay'); await p.waitForTimeout(300); await p.click('#btnGarageVs'); await p.waitForTimeout(200); }
await lobby(host, 'http://localhost:5173/?' + broker + '&vstarget=400');
await host.click('#btnVsCreate');
await host.waitForFunction(() => /^[2-9A-HJ-NP-Z]{5}$/.test(document.getElementById('vsCode').textContent ?? ''), null, { timeout: 20000 });
const code = (await host.textContent('#vsCode')).trim();
console.log('code', code);
await lobby(guest, 'http://localhost:5173/?' + broker);
await guest.fill('#vsJoinInput', code);
await guest.click('#btnVsJoin');
await host.waitForFunction(() => !document.getElementById('countdown').classList.contains('hidden'), null, { timeout: 30000 });
console.log('both counting down; sampling 8 s...');
for (let i = 0; i < 8; i++) {
  await host.waitForTimeout(1000);
  const h = await host.evaluate(() => document.getElementById('countdown').textContent + '|' + (document.getElementById('devhud').textContent.split('\n')[0] || ''));
  const g = await guest.evaluate(() => document.getElementById('countdown').textContent + '|' + (document.getElementById('devhud').textContent.split('\n')[0] || ''));
  console.log('t+' + (i + 1) + 's HOST', h, '· GUEST', g);
}
await browser.close(); peer.kill();
