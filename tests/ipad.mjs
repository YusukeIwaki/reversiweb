import { webkit, devices } from 'playwright';
import fs from 'node:fs';

const TARGET_URL = process.env.URL || 'http://localhost:5173/';
const OUT = new URL('./screenshots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const failed = [];
const ok = (msg) => console.log(`  ok  ${msg}`);
const check = (cond, msg) => {
  if (cond) ok(msg);
  else { console.log(`  FAIL  ${msg}`); failed.push(msg); }
};

const ipad = devices['iPad Mini']; // 768x1024 portrait, webkit

const browser = await webkit.launch();
const context = await browser.newContext({ ...ipad });
const page = await context.newPage();

page.on('pageerror', (err) => {
  console.log(`  PAGEERROR  ${err.message}`);
  failed.push(`pageerror: ${err.message}`);
});
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`  CONSOLE.ERR  ${msg.text()}`);
});

console.log('# initial load');
await page.goto(TARGET_URL, { waitUntil: 'load' });
await page.waitForSelector('.cell .piece');

// Initial: 4 pieces on board, 30/30 hand, BLACK turn
const initialPieces = await page.locator('.piece').count();
check(initialPieces === 4, `initial piece count is 4 (got ${initialPieces})`);
const handBlack0 = await page.locator('#hand-black .hand-piece').count();
const handWhite0 = await page.locator('#hand-white .hand-piece').count();
check(handBlack0 === 30, `initial hand-black=30 (got ${handBlack0})`);
check(handWhite0 === 30, `initial hand-white=30 (got ${handWhite0})`);
const blackActive0 = await page.locator('#player-black.active').count();
check(blackActive0 === 1, 'BLACK is active on start');

// Valid move hints should be visible (4 for opening: (2,3),(3,2),(4,5),(5,4))
const hints0 = await page.locator('.cell.valid').count();
check(hints0 === 4, `4 hint cells on opening (got ${hints0})`);

await page.screenshot({ path: OUT + '01-initial.png', fullPage: false });

// Verify board is fully visible within viewport (no scroll required)
const boardBox = await page.locator('#board').boundingBox();
const vpH = page.viewportSize().height;
check(boardBox && boardBox.y >= 0 && boardBox.y + boardBox.height <= vpH,
  `board fits viewport vertically (top=${boardBox.y}, bottom=${boardBox.y + boardBox.height}, vpH=${vpH})`);

console.log('# move 1: BLACK plays (2,3) -> flips (3,3)');
const t0 = Date.now();
await page.locator('.cell[data-r="2"][data-c="3"]').click();

// Piece appears immediately
await page.waitForSelector('.cell[data-r="2"][data-c="3"] .piece');
const placedColor = await page.locator('.cell[data-r="2"][data-c="3"] .piece').getAttribute('data-color');
check(placedColor === 'black', `placed piece is black (got ${placedColor})`);

// Hand decremented immediately
const handBlack1 = await page.locator('#hand-black .hand-piece').count();
check(handBlack1 === 29, `hand-black decremented to 29 (got ${handBlack1})`);

// Before 0.8s, the (3,3) piece should still be WHITE
await sleep(400);
const midColor = await page.locator('.cell[data-r="3"][data-c="3"] .piece').getAttribute('data-color');
check(midColor === 'white', `(3,3) still white at 0.4s (got ${midColor})`);

// After ~900ms total, it should have flipped to black
await sleep(700); // total ~1100ms
const flippedColor = await page.locator('.cell[data-r="3"][data-c="3"] .piece').getAttribute('data-color');
check(flippedColor === 'black', `(3,3) flipped to black after ~1.1s (got ${flippedColor})`);

const elapsed = Date.now() - t0;
check(elapsed >= 800, `flip happened after >=800ms gate (elapsed ${elapsed}ms)`);

// Active player should now be WHITE
const whiteActive1 = await page.locator('#player-white.active').count();
check(whiteActive1 === 1, 'WHITE is active after BLACK move');

await page.screenshot({ path: OUT + '02-after-move1.png' });

console.log('# history: page back undoes');
await page.goBack();
await sleep(300);
const handBlack2 = await page.locator('#hand-black .hand-piece').count();
check(handBlack2 === 30, `hand-black restored to 30 after back (got ${handBlack2})`);
const restoredColor = await page.locator('.cell[data-r="3"][data-c="3"] .piece').getAttribute('data-color');
check(restoredColor === 'white', `(3,3) restored to white (got ${restoredColor})`);
const cell23pieces = await page.locator('.cell[data-r="2"][data-c="3"] .piece').count();
check(cell23pieces === 0, `(2,3) is empty after undo (got ${cell23pieces})`);
const blackActive2 = await page.locator('#player-black.active').count();
check(blackActive2 === 1, 'BLACK is active again after undo');

await page.screenshot({ path: OUT + '03-after-undo.png' });

console.log('# history: page forward redoes');
await page.goForward();
await sleep(300);
const handBlack3 = await page.locator('#hand-black .hand-piece').count();
check(handBlack3 === 29, `hand-black=29 after redo (got ${handBlack3})`);
const redoColor = await page.locator('.cell[data-r="3"][data-c="3"] .piece').getAttribute('data-color');
check(redoColor === 'black', `(3,3) is black after redo (got ${redoColor})`);
const cell23pieces2 = await page.locator('.cell[data-r="2"][data-c="3"] .piece').count();
check(cell23pieces2 === 1, `(2,3) has piece after redo (got ${cell23pieces2})`);

await page.screenshot({ path: OUT + '04-after-redo.png' });

console.log('# move 2: WHITE plays (2,2) -> flips (3,3) back to white');
await page.locator('.cell[data-r="2"][data-c="2"]').click();
await sleep(1200);
const c33after = await page.locator('.cell[data-r="3"][data-c="3"] .piece').getAttribute('data-color');
check(c33after === 'white', `(3,3) flipped to white after WHITE move (got ${c33after})`);
const handWhite3 = await page.locator('#hand-white .hand-piece').count();
check(handWhite3 === 29, `hand-white=29 (got ${handWhite3})`);

await page.screenshot({ path: OUT + '05-after-move2.png' });

console.log('# move 3: invalid click is ignored');
const before = await page.locator('.piece').count();
await page.locator('.cell[data-r="0"][data-c="0"]').click();
await sleep(200);
const after = await page.locator('.piece').count();
check(before === after, `invalid click did not place a piece (${before} -> ${after})`);

console.log('# board renders within viewport (iPad portrait)');
const finalBox = await page.locator('#board').boundingBox();
console.log(`  board: ${Math.round(finalBox.width)}x${Math.round(finalBox.height)} at (${Math.round(finalBox.x)},${Math.round(finalBox.y)})`);

await browser.close();

console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}: ${failed.length} failure(s)`);
if (failed.length) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exit(1);
}
