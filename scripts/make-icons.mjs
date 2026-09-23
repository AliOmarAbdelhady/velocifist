// M18 RobEn rebrand (ADR-017): render the PWA icon set from the RobEn mark —
// the robot-head glyph from the club logo (roben.club), white-on-azure —
// using headless Chrome (no image toolchain in the repo). Regenerate with:
//   node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

// The robot head: ring + happy eyes + smile + antenna, over faint concentric
// rings, on the navy→azure radial tile (the roben.club favicon recipe).
const HEAD = `
  <defs>
    <radialGradient id="tile" cx="50%" cy="44%" r="75%">
      <stop offset="0%" stop-color="#0a76ab"/>
      <stop offset="55%" stop-color="#036d9f"/>
      <stop offset="100%" stop-color="#01375d"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="104" fill="url(#tile)"/>
  <circle cx="256" cy="276" r="150" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="8" stroke-dasharray="700 200"/>
  <circle cx="256" cy="276" r="180" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="6" stroke-dasharray="560 360"/>
  <g stroke="#ffffff" fill="none" stroke-linecap="round">
    <circle cx="256" cy="286" r="106" stroke-width="26"/>
    <path d="M198 280 Q221 254 244 280" stroke-width="18"/>
    <path d="M268 280 Q291 254 314 280" stroke-width="18"/>
    <path d="M232 336 Q256 354 280 336" stroke-width="14"/>
    <path d="M256 180 L256 128" stroke-width="18"/>
  </g>
  <circle cx="256" cy="112" r="17" fill="#ffffff"/>`;

const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${HEAD}</svg>`;

const MASKABLE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#01375d"/>
  <g transform="translate(256 266) scale(0.78) translate(-256 -270)">${HEAD}</g>
</svg>`;

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--window-size=800,800'],
});
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

async function shoot(svg, size, file, withBackground) {
  await page.setContent(
    `<!doctype html><meta charset=utf-8><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
  );
  const buf = await page.screenshot({ omitBackground: !withBackground, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(file, buf);
  console.log('wrote', file, buf.length, 'bytes');
}

mkdirSync('public/icons', { recursive: true });
await shoot(MARK, 192, 'public/icons/icon-192.png', true);
await shoot(MARK, 512, 'public/icons/icon-512.png', true);
await shoot(MASKABLE, 512, 'public/icons/maskable-512.png', true);
writeFileSync('public/roben.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${HEAD}</svg>`);
console.log('wrote public/roben.svg');
await browser.close();
console.log('icons done');
