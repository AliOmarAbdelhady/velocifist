import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const MK = (urls) => urls.map((u) => ({ urls: u, username: 'openrelayproject', credential: 'openrelayproject' }));
const VARIANTS = {
  udp80: MK(['turn:openrelay.metered.ca:80']),
  udp443: MK(['turn:openrelay.metered.ca:443']),
  tcp443: MK(['turn:openrelay.metered.ca:443?transport=tcp']),
  all: MK(['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp']),
};
const SETUP = ({ role, ice }) => {
  window.__pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: 'relay' });
  window.__cands = [];
  window.__log = [];
  window.__pc.onicecandidate = (e) => { if (e.candidate) { window.__cands.push(e.candidate); window.__log.push('cand:' + e.candidate.type); } };
  window.__pc.oniceconnectionstatechange = () => { window.__log.push('ice:' + window.__pc.iceConnectionState); };
  if (role === 'a') {
    window.__dc = window.__pc.createDataChannel('t');
    window.__dc.onopen = () => { window.__open = true; window.__dc.send('ping'); };
    window.__dc.onmessage = (e) => { window.__echo = e.data; };
  } else {
    window.__pc.ondatachannel = (e) => {
      window.__dc = e.channel;
      window.__dc.onmessage = (e) => { window.__echo = e.data; window.__dc.send('relay-works'); };
    };
  }
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
async function tryVariant(name, ice) {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto('about:blank'); await b.goto('about:blank');
  await a.evaluate(SETUP, { role: 'a', ice });
  await b.evaluate(SETUP, { role: 'b', ice });
  const offer = await a.evaluate(() => window.__pc.createOffer());
  await a.evaluate((o) => window.__pc.setLocalDescription(o), offer);
  await b.evaluate((o) => window.__pc.setRemoteDescription(o), offer);
  const answer = await b.evaluate(() => window.__pc.createAnswer());
  await b.evaluate((ans) => window.__pc.setLocalDescription(ans), answer);
  await a.evaluate((ans) => window.__pc.setRemoteDescription(ans), answer);
  let open = false;
  for (let i = 0; i < 100 && !open; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ca = await a.evaluate(() => window.__cands.splice(0));
    for (const c of ca) await b.evaluate((cc) => window.__pc.addIceCandidate(cc), c);
    const cb = await b.evaluate(() => window.__cands.splice(0));
    for (const c of cb) await a.evaluate((cc) => window.__pc.addIceCandidate(cc), c);
    open = await a.evaluate(() => !!window.__open);
  }
  const echo = open ? await a.evaluate(() => window.__echo ?? null) : null;
  const logA = await a.evaluate(() => window.__log.join(','));
  console.log(name.padEnd(7), '| open:', open, '| echo:', echo, '|', logA || 'no events');
  await a.context().close(); await b.context().close();
  return !!open && echo === 'relay-works';
}
let any = false;
for (const [name, ice] of Object.entries(VARIANTS)) any = (await tryVariant(name, ice)) || any;
await browser.close();
console.log(any ? 'TURN RELAY OK (at least one variant)' : 'TURN RELAY FAILED ALL VARIANTS');
process.exit(any ? 0 : 1);
