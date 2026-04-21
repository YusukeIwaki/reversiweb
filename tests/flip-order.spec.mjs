// Unit tests for flip-order.js — pure grouping/ordering and sequential
// scheduling. Runs in Chromium (about:blank + addScriptTag) — no game DOM, no
// real timers. Run via `npx playwright test --project=flip-order`.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const flipOrderPath = path.resolve(here, '..', 'flip-order.js');

test.beforeEach(async ({ page }) => {
  await page.goto('about:blank');
  await page.addScriptTag({ path: flipOrderPath });
  await page.waitForFunction(() => typeof window.ReversiFlipOrder !== 'undefined');
});

test.describe('dirKind', () => {
  test('classifies each of the 8 directions', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { dirKind } = window.ReversiFlipOrder;
      return {
        up: dirKind(-1, 0), down: dirKind(1, 0),
        left: dirKind(0, -1), right: dirKind(0, 1),
        ul: dirKind(-1, -1), ur: dirKind(-1, 1),
        dl: dirKind(1, -1), dr: dirKind(1, 1),
      };
    });
    expect(r.up).toBe('v');
    expect(r.down).toBe('v');
    expect(r.left).toBe('h');
    expect(r.right).toBe('h');
    // \ axis: up-left and down-right share d1
    expect(r.ul).toBe('d1');
    expect(r.dr).toBe('d1');
    // / axis: up-right and down-left share d2
    expect(r.ur).toBe('d2');
    expect(r.dl).toBe('d2');
  });
});

test.describe('groupAndSortLines', () => {
  test('orders groups by total piece count desc (v=2, h=1, d2=3 → d2, v, h)', async ({ page }) => {
    const kinds = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [-1, 0], line: [[2,3],[1,3]] },
        { dir: [0, 1], line: [[4,5]] },
        { dir: [-1, 1], line: [[3,4],[2,5],[1,6]] },
      ]).map(g => g.kind);
    });
    expect(kinds).toEqual(['d2', 'v', 'h']);
  });

  test('breaks ties with vertical > horizontal > \\ > /', async ({ page }) => {
    const kinds = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [-1, 1], line: [[3,5]] },
        { dir: [0, 1], line: [[4,5]] },
        { dir: [1, 0], line: [[5,3]] },
        { dir: [1, 1], line: [[5,4]] },
      ]).map(g => g.kind);
    });
    expect(kinds).toEqual(['v', 'h', 'd1', 'd2']);
  });

  test('merges multiple lines of the same kind into one group', async ({ page }) => {
    const out = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [1, 0], line: [[5,3]] },
        { dir: [-1, 0], line: [[2,3],[1,3]] },
        { dir: [0, 1], line: [[4,5]] },
      ]);
    });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('v');
    expect(out[0].lines).toHaveLength(2);
    expect(out[1].kind).toBe('h');
    expect(out[1].lines).toHaveLength(1);
  });

  test('splits \\ and / diagonals into separate groups (issue #1)', async ({ page }) => {
    const out = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [-1, -1], line: [[3,3],[2,2]] },  // \ axis (up-left)
        { dir: [ 1,  1], line: [[5,5]] },         // \ axis (down-right)
        { dir: [-1,  1], line: [[3,5]] },         // / axis (up-right)
        { dir: [ 1, -1], line: [[5,3]] },         // / axis (down-left)
      ]).map(g => ({ kind: g.kind, lineCount: g.lines.length }));
    });
    // \ axis has 3 pieces total, / axis has 2 → d1 before d2 by count.
    expect(out).toEqual([
      { kind: 'd1', lineCount: 2 },
      { kind: 'd2', lineCount: 2 },
    ]);
  });

  test('empty input yields empty array', async ({ page }) => {
    const len = await page.evaluate(() => window.ReversiFlipOrder.groupAndSortLines([]).length);
    expect(len).toBe(0);
  });
});

test.describe('runFlipSchedule', () => {
  test('runs groups sequentially with a group-gap sleep between them', async ({ page }) => {
    const events = await page.evaluate(async () => {
      const { runFlipSchedule } = window.ReversiFlipOrder;
      const events = [];
      let now = 0;
      const sleep = (ms) => { now += ms; return Promise.resolve(); };
      const flip = (cell) => events.push({ t: now, cell });
      await runFlipSchedule(
        [
          { kind: 'v', lines: [[[4,5]]] },
          { kind: 'h', lines: [[[3,4]]] },
        ],
        { flip, sleep, interval: 200, groupGap: 750 },
      );
      return events;
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ t: 0, cell: [4, 5] });
    expect(events[1]).toEqual({ t: 750, cell: [3, 4] });
  });

  test('spaces pieces in a single line by interval', async ({ page }) => {
    const times = await page.evaluate(async () => {
      const { runFlipSchedule } = window.ReversiFlipOrder;
      const events = [];
      let now = 0;
      const sleep = (ms) => { now += ms; return Promise.resolve(); };
      const flip = (cell) => events.push({ t: now, cell });
      await runFlipSchedule(
        [{ kind: 'v', lines: [[[2,3],[1,3],[0,3]]] }],
        { flip, sleep, interval: 200, groupGap: 750 },
      );
      return events.map(e => e.t);
    });
    expect(times).toEqual([0, 200, 400]);
  });

  test('starts parallel single-piece lines at the same time', async ({ page }) => {
    const times = await page.evaluate(async () => {
      const { runFlipSchedule } = window.ReversiFlipOrder;
      const events = [];
      let now = 0;
      const sleep = (ms) => { now += ms; return Promise.resolve(); };
      const flip = (cell) => events.push({ t: now, cell });
      await runFlipSchedule(
        [{ kind: 'v', lines: [[[2,3]], [[5,3]]] }],
        { flip, sleep, interval: 200, groupGap: 750 },
      );
      return events.map(e => e.t);
    });
    expect(times).toEqual([0, 0]);
  });

  test('no-op when given an empty group list', async ({ page }) => {
    const counts = await page.evaluate(async () => {
      const { runFlipSchedule } = window.ReversiFlipOrder;
      let flips = 0, sleeps = 0;
      await runFlipSchedule([], {
        flip: () => flips++,
        sleep: () => { sleeps++; return Promise.resolve(); },
        interval: 200, groupGap: 750,
      });
      return { flips, sleeps };
    });
    expect(counts).toEqual({ flips: 0, sleeps: 0 });
  });

  test('single group does not sleep for the group gap', async ({ page }) => {
    const sleeps = await page.evaluate(async () => {
      const { runFlipSchedule } = window.ReversiFlipOrder;
      const sleepMs = [];
      await runFlipSchedule(
        [{ kind: 'v', lines: [[[4,5]]] }],
        {
          flip: () => {},
          sleep: (ms) => { sleepMs.push(ms); return Promise.resolve(); },
          interval: 200, groupGap: 750,
        },
      );
      return sleepMs;
    });
    expect(sleeps).toEqual([]);
  });
});
