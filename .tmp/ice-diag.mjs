import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext()).newPage();
await page.goto('https://aliomarabdelhady.github.io/velocifist/', { waitUntil: 'domcontentloaded' });

async function gather(ice, policy) {
  return await page.evaluate(async ({ ice, policy }) => {
    const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: policy });
    pc.createDataChannel('t');
    const types = {};
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const m = e.candidate.candidate.match(/typ (\w+)/);
        if (m) types[m[1]] = (types[m[1]] || 0) + 1;
      }
    };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((r) => setTimeout(r, 8000));
    const gs = pc.iceGatheringState;
    pc.close();
    return { types, gs };
  }, { ice, policy });
}

const OR = (u) => ({ urls: u, username: 'openrelayproject', credential: 'openrelayproject' });
console.log('STUN only, policy all  :', JSON.stringify(await gather([{ urls: 'stun:stun.l.google.com:19302' }], 'all')));
console.log('TURN udp80, policy all :', JSON.stringify(await gather([OR('turn:openrelay.metered.ca:80')], 'all')));
console.log('TURN tcp443, policy all:', JSON.stringify(await gather([OR('turn:openrelay.metered.ca:443?transport=tcp')], 'all')));
console.log('TURN udp443, policy all:', JSON.stringify(await gather([OR('turn:openrelay.metered.ca:443')], 'all')));
await browser.close();
