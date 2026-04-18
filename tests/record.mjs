// Record a ~15 second iPad-portrait gameplay session as a webm video.
// Usage: node tests/record.mjs   (assumes server at http://localhost:5173/)

import { webkit, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_URL = process.env.URL || 'http://localhost:5173/';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, 'videos');
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ipad = devices['iPad Mini']; // 768x1024 portrait, webkit

const browser = await webkit.launch();
const context = await browser.newContext({
  ...ipad,
  recordVideo: { dir: OUT_DIR, size: { width: 768, height: 1024 } },
});
const page = await context.newPage();

await page.goto(TARGET_URL, { waitUntil: 'load' });
await page.waitForSelector('.cell .piece');
await sleep(800); // hold the opening

async function playFirstValid() {
  const valid = await page.locator('.cell.valid').all();
  if (valid.length === 0) return false;
  // Pick a deterministic interesting move: prefer middle of the available set.
  const target = valid[Math.floor(valid.length / 2)];
  await target.click();
  // Wait for the gate (0.8s) + main flip animation to settle.
  await sleep(1500);
  return true;
}

// Play 5 moves to show plenty of flips and counter decrements.
for (let i = 0; i < 5; i++) {
  const ok = await playFirstValid();
  if (!ok) break;
}

// Demonstrate undo via browser back, twice.
await sleep(400);
await page.goBack();
await sleep(700);
await page.goBack();
await sleep(900);

// Then redo via browser forward, twice.
await page.goForward();
await sleep(700);
await page.goForward();
await sleep(1200);

await context.close();
await browser.close();

// Find the produced video and rename it.
const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.webm'));
if (files.length === 0) {
  console.error('No video file produced.');
  process.exit(1);
}
const src = path.join(OUT_DIR, files[0]);
const dst = path.join(OUT_DIR, 'demo.webm');
if (src !== dst) fs.renameSync(src, dst);
console.log(dst);
