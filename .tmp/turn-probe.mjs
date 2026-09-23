// Relay-only WebRTC probe: two pages connect with iceTransportPolicy:'relay'
// through OpenRelay TURN ONLY (no host/STUN candidates) — if data flows, the
// cross-network path is proven at the technology level.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const ICE = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];
const SETUP = ({ role, ice }) => {
  window.__pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: 'relay' });
  window.__cands = [];
  window.__pc.onicecandidate = (e) => { if (e.candidate) window.__cands.push(e.candidate); };
  if (role === 'a') {
    window.__dc = window.__pc.createDataChannel('t');
    window.__dc.onopen = () => { window.__open = true; };
    window.__dc.onmessage = (e) => { window.__echo = e.data; };
  } else {
    window.__pc.ondatachannel = (e) => {
      window.__dc = e.channel;
      window.__dc.onopen = () => {
        window.__open = true;
        window.__dc.send('relay-works');
      };
    };
  }
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const a = await (await browser.newContext()).newPage();
const b = await (await browser.newContext()).newPage();
await a.goto('about:blank'); await b.goto('about:blank');
await a.evaluate(SETUP, { role: 'a', ice: ICE }); await b.evaluate(SETUP, { role: 'b', ice: ICE });
const offer = await a.evaluate(() => window.__pc.createOffer());
await a.evaluate(async (o) => { await window.__pc.setLocalDescription(o); }, offer);
await b.evaluate(async (o) => { await window.__pc.setRemoteDescription(o); }, offer);
const answer = await b.evaluate(() => window.__pc.createAnswer());
await b.evaluate(async (ans) => { await window.__pc.setLocalDescription(ans); }, answer);
await a.evaluate(async (ans) => { await window.__pc.setRemoteDescription(ans); }, answer);
// trickle candidates both ways
for (let i = 0; i < 40 && !(await a.evaluate(() => window.__open)) ; i++) {
  const ca = await a.evaluate(() => window.__cands.splice(0));
  for (const c of ca) await b.evaluate((cc) => window.__pc.addIceCandidate(cc), c);
  const cb = await b.evaluate(() => window.__cands.splice(0));
  for (const c of cb) await a.evaluate((cc) => window.__pc.addIceCandidate(cc), c);
  await new Promise((r) => setTimeout(r, 250));
}
const open = await a.evaluate(() => !!window.__open);
await a.evaluate(() => window.__dc.send('ping'));
await new Promise((r) => setTimeout(r, 1000));
const echo = await b.evaluate(() => window.__echo ?? null);
const selected = await a.evaluate(async () => {
  const s = await window.__pc.getStats();
  let out = '';
  s.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded') out = (r.localCandidateId || '') + '|' + (r.remoteCandidateId || ''); });
  return out;
});
const candTypes = await a.evaluate(async () => {
  const s = await window.__pc.getStats();
  const types = [];
  s.forEach((r) => { if (r.type === 'local-candidate' && r.candidateType) types.push(r.candidateType); });
  return types.join(',');
});
console.log('channel open:', open, '| guest got message:', echo, '| local candidate types:', candTypes || '(none yet)');
await browser.close();
const pass = open && echo === 'relay-works';
console.log(pass ? 'TURN RELAY PATH OK (relay-only candidates, data flowed)' : 'TURN RELAY PATH FAILED');
process.exit(pass ? 0 : 1);
