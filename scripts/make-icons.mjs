// M10 ship prep: render the PWA icon set from the game's chevron mark using
// headless Chrome (no image toolchain in the repo). Regenerate with:
//   node scripts/make-icons.mjs
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const globalRoot = execSync('npm root -g').toString().trim();
const { chromium } = createRequire(import.meta.url)(`${globalRoot}/playwright`);

const MARK = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0b0e1a"/>
  <path d="M96 336 L256 128 L416 336 L328 336 L256 232 L184 336 Z" fill="#ff5a3c"/>
  <path d="M168 392 L256 282 L344 392 L300 392 L256 334 L212 392 Z" fill="#ffb01f" opacity="0.9"/>
</svg>`;

const MASKABLE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0b0e1a"/>
  <g transform="translate(256 266) scale(0.72) translate(-256 -256)">
    <path d="M96 336 L256 128 L416 336 L328 336 L256 232 L184 336 Z" fill="#ff5a3c"/>
    <path d="M168 392 L256 282 L344 392 L300 392 L256 334 L212 392 Z" fill="#ffb01f" opacity="0.9"/>
  </g>
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
await browser.close();
console.log('icons done');
