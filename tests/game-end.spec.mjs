// Regression tests for the game-end overlay.
//
// The original bug: `#overlay` lived inside `.board-wrapper` with no z-index,
// while `.piece` has `z-index: 2`. Pieces rendered on top of the overlay and
// the result text ("BLACK WINS" etc.) was hidden behind the discs. These
// tests inject a terminal state via popstate (the same code path `snapRender`
// already exercises) and verify the overlay is actually the topmost layer.
//
// Note on hit-testing + `pointer-events: none`: both `.piece` and `.overlay`
// set `pointer-events: none`, so `document.elementFromPoint` would skip them
// both and the test could not tell which layer is visually on top. We inject
// a temporary stylesheet that forces `pointer-events: auto` on every piece
// and on the overlay, then use `elementsFromPoint` (which returns the full
// stack, topmost first) to verify the overlay precedes the piece.
import { test, expect } from '@playwright/test';

const OUTCOMES = [
  { name: 'black-wins', caption: '黒の勝ち!', build: buildBlackWinsBoard },
  { name: 'white-wins', caption: '白の勝ち!', build: buildWhiteWinsBoard },
  { name: 'draw',       caption: '引き分け',   build: buildDrawBoard },
];

function buildBlackWinsBoard() {
  const b = checker(1, 2);
  b[0][0] = 1; b[0][7] = 1; b[7][0] = 1; b[7][7] = 1;
  for (let i = 0; i < 4; i++) b[3][i] = 1;
  return b;
}
function buildWhiteWinsBoard() {
  const b = checker(2, 1);
  b[0][0] = 2; b[0][7] = 2; b[7][0] = 2; b[7][7] = 2;
  for (let i = 0; i < 4; i++) b[3][i] = 2;
  return b;
}
function buildDrawBoard() {
  return checker(1, 2); // 32 vs 32
}
function checker(even, odd) {
  return Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => ((r + c) % 2 === 0 ? even : odd)));
}

async function injectGameOver(page, board) {
  await page.evaluate((board) => {
    const fake = { state: { board, turn: 1, handBlack: 0, handWhite: 0, gameOver: true } };
    history.replaceState(fake, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: fake }));
  }, board);
}

test.describe('game-end overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.cell .piece');
  });

  for (const { name, caption, build } of OUTCOMES) {
    test(`${name}: overlay is above pieces and shows the correct caption`, async ({ page }) => {
      await injectGameOver(page, build());

      const overlay = page.locator('#overlay');
      await expect(overlay).toHaveClass(/\bvisible\b/);
      await expect(overlay).toContainText(caption);

      // Overlay must cover the board so no disc pokes past its edges.
      const rects = await page.evaluate(() => ({
        overlay: document.getElementById('overlay').getBoundingClientRect().toJSON(),
        board:   document.getElementById('board').getBoundingClientRect().toJSON(),
      }));
      expect(rects.overlay.left).toBeLessThanOrEqual(rects.board.left);
      expect(rects.overlay.top).toBeLessThanOrEqual(rects.board.top);
      expect(rects.overlay.right).toBeGreaterThanOrEqual(rects.board.right);
      expect(rects.overlay.bottom).toBeGreaterThanOrEqual(rects.board.bottom);

      // Hit test over four interior cells — each holds a piece in the
      // injected state. We ask for the full z-order stack at each point and
      // require the overlay to come before the piece (topmost = index 0).
      const probes = [[3,3],[3,4],[4,3],[4,4]];
      const hits = await page.evaluate((probes) => {
        // Force pointer-events: auto so hit-testing reports the actual
        // paint order, not the click target. Both `.piece` and `.overlay`
        // opt out of pointer events by default.
        const styleTag = document.createElement('style');
        styleTag.textContent =
          '.piece, #overlay, #overlay * { pointer-events: auto !important; }';
        document.head.appendChild(styleTag);
        try {
          return probes.map(([r, c]) => {
            const piece = document.querySelector(`.cell[data-r="${r}"][data-c="${c}"] .piece`);
            const rect = piece.getBoundingClientRect();
            const x = Math.round(rect.left + rect.width / 2);
            const y = Math.round(rect.top + rect.height / 2);
            const stack = document.elementsFromPoint(x, y);
            const overlayIdx = stack.findIndex(el => el.id === 'overlay' || (el.closest && el.closest('#overlay')));
            const pieceIdx = stack.findIndex(el => el.classList && el.classList.contains('piece'));
            return {
              cell: `${r},${c}`,
              overlayIdx,
              pieceIdx,
              top: stack.slice(0, 4).map(el => el.tagName + (el.id ? '#' + el.id : '')),
            };
          });
        } finally {
          styleTag.remove();
        }
      }, probes);

      for (const h of hits) {
        expect(h.overlayIdx, `overlay not found in stack at cell ${h.cell} (top: ${h.top.join(',')})`)
          .toBeGreaterThanOrEqual(0);
        expect(h.pieceIdx, `piece not found in stack at cell ${h.cell} (top: ${h.top.join(',')})`)
          .toBeGreaterThanOrEqual(0);
        expect(
          h.overlayIdx,
          `overlay is below piece at cell ${h.cell}: overlayIdx=${h.overlayIdx} pieceIdx=${h.pieceIdx} (top: ${h.top.join(',')})`,
        ).toBeLessThan(h.pieceIdx);
      }
    });
  }

  test('reset button reloads the page to the initial state', async ({ page }) => {
    await injectGameOver(page, buildBlackWinsBoard());
    await expect(page.locator('#overlay')).toHaveClass(/\bvisible\b/);

    const resetBtn = page.locator('.overlay-reset');
    await expect(resetBtn).toBeVisible();
    await expect(resetBtn).toHaveText('リセット');

    // The overlay backdrop has pointer-events: none; the button must opt in
    // so the click actually lands on it. Verify by capturing the reload
    // navigation and re-checking the initial board.
    await Promise.all([
      page.waitForEvent('load'),
      resetBtn.click(),
    ]);

    await page.waitForSelector('.cell .piece');
    await expect(page.locator('.piece')).toHaveCount(4);
    await expect(page.locator('#hand-black .hand-piece')).toHaveCount(30);
    await expect(page.locator('#hand-white .hand-piece')).toHaveCount(30);
    await expect(page.locator('#overlay')).not.toHaveClass(/\bvisible\b/);
    await expect(page.locator('#player-black.active')).toHaveCount(1);
  });

  test('overlay hides again once the state is no longer gameOver', async ({ page }) => {
    await injectGameOver(page, buildDrawBoard());
    await expect(page.locator('#overlay')).toHaveClass(/\bvisible\b/);

    // Restore an in-progress state; overlay must retract so it doesn't
    // float above the live board during normal play.
    await page.evaluate(() => {
      const board = Array.from({ length: 8 }, () => Array(8).fill(0));
      board[3][3] = 2; board[3][4] = 1; board[4][3] = 1; board[4][4] = 2;
      const fake = { state: { board, turn: 1, handBlack: 30, handWhite: 30, gameOver: false } };
      history.replaceState(fake, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state: fake }));
    });
    await expect(page.locator('#overlay')).not.toHaveClass(/\bvisible\b/);
    await expect(page.locator('#overlay')).toBeEmpty();
  });
});
