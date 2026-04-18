// iPad Mini (WebKit) end-to-end scenario: initial layout, 0.8s flip gate,
// hand decrement, turn swap, browser back/forward undo/redo, invalid-click
// ignore, and board vertical fit. Run via `npx playwright test --project=ipad`.
import { test, expect } from '@playwright/test';

test('iPad portrait: initial layout + moves + history undo/redo', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.cell .piece');

  // --- Initial: 4 pieces, hand 30/30, BLACK active, 4 hints ---
  await expect(page.locator('.piece')).toHaveCount(4);
  await expect(page.locator('#hand-black .hand-piece')).toHaveCount(30);
  await expect(page.locator('#hand-white .hand-piece')).toHaveCount(30);
  await expect(page.locator('#player-black.active')).toHaveCount(1);
  await expect(page.locator('.cell.valid')).toHaveCount(4);

  // Board fits viewport vertically
  const boardBox = await page.locator('#board').boundingBox();
  const vpH = page.viewportSize().height;
  expect(boardBox).not.toBeNull();
  expect(boardBox.y).toBeGreaterThanOrEqual(0);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(vpH);

  // --- Move 1: BLACK plays (2,3) → flips (3,3) after 0.8s gate ---
  const t0 = Date.now();
  await page.locator('.cell[data-r="2"][data-c="3"]').click();
  await expect(page.locator('.cell[data-r="2"][data-c="3"] .piece')).toHaveAttribute('data-color', 'black');
  await expect(page.locator('#hand-black .hand-piece')).toHaveCount(29);

  // Before 0.8s: (3,3) still WHITE
  await page.waitForTimeout(400);
  await expect(page.locator('.cell[data-r="3"][data-c="3"] .piece')).toHaveAttribute('data-color', 'white');

  // After ~1.1s: (3,3) flipped to BLACK
  await page.waitForTimeout(700);
  await expect(page.locator('.cell[data-r="3"][data-c="3"] .piece')).toHaveAttribute('data-color', 'black');
  expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
  await expect(page.locator('#player-white.active')).toHaveCount(1);

  // --- History: page back undoes ---
  await page.goBack();
  await page.waitForTimeout(300);
  await expect(page.locator('#hand-black .hand-piece')).toHaveCount(30);
  await expect(page.locator('.cell[data-r="3"][data-c="3"] .piece')).toHaveAttribute('data-color', 'white');
  await expect(page.locator('.cell[data-r="2"][data-c="3"] .piece')).toHaveCount(0);
  await expect(page.locator('#player-black.active')).toHaveCount(1);

  // --- History: page forward redoes ---
  await page.goForward();
  await page.waitForTimeout(300);
  await expect(page.locator('#hand-black .hand-piece')).toHaveCount(29);
  await expect(page.locator('.cell[data-r="3"][data-c="3"] .piece')).toHaveAttribute('data-color', 'black');
  await expect(page.locator('.cell[data-r="2"][data-c="3"] .piece')).toHaveCount(1);

  // --- Move 2: WHITE plays (2,2) → flips (3,3) back to white ---
  await page.locator('.cell[data-r="2"][data-c="2"]').click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.cell[data-r="3"][data-c="3"] .piece')).toHaveAttribute('data-color', 'white');
  await expect(page.locator('#hand-white .hand-piece')).toHaveCount(29);

  // --- Move 3: invalid click (corner) is ignored ---
  const before = await page.locator('.piece').count();
  await page.locator('.cell[data-r="0"][data-c="0"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('.piece')).toHaveCount(before);
});
