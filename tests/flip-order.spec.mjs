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
  test('classifies each of the 8 directions uniquely', async ({ page }) => {
    const r = await page.evaluate(() => {
      const { dirKind } = window.ReversiFlipOrder;
      return {
        up: dirKind(-1, 0), down: dirKind(1, 0),
        left: dirKind(0, -1), right: dirKind(0, 1),
        ul: dirKind(-1, -1), ur: dirKind(-1, 1),
        dl: dirKind(1, -1), dr: dirKind(1, 1),
      };
    });
    expect(r.up).toBe('u');
    expect(r.down).toBe('d');
    expect(r.left).toBe('l');
    expect(r.right).toBe('r');
    expect(r.ul).toBe('ul');
    expect(r.ur).toBe('ur');
    expect(r.dl).toBe('dl');
    expect(r.dr).toBe('dr');
  });
});

test.describe('groupAndSortLines', () => {
  test('orders groups by total piece count desc (up=2, right=1, up-right=3 → ur, u, r)', async ({ page }) => {
    const kinds = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [-1, 0], line: [[2,3],[1,3]] },
        { dir: [0, 1], line: [[4,5]] },
        { dir: [-1, 1], line: [[3,4],[2,5],[1,6]] },
      ]).map(g => g.kind);
    });
    expect(kinds).toEqual(['ur', 'u', 'r']);
  });

  test('breaks ties with u,d,l,r,ul,dr,ur,dl priority order', async ({ page }) => {
    const kinds = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [1, -1], line: [[5,2]] }, // dl (/)
        { dir: [0, 1],  line: [[4,5]] }, // r
        { dir: [-1, 1], line: [[3,5]] }, // ur (/)
        { dir: [1, 0],  line: [[5,3]] }, // d
        { dir: [1, 1],  line: [[5,4]] }, // dr (\)
        { dir: [-1, -1], line: [[3,2]] },// ul (\)
        { dir: [0, -1], line: [[4,2]] }, // l
        { dir: [-1, 0], line: [[3,3]] }, // u
      ]).map(g => g.kind);
    });
    expect(kinds).toEqual(['u', 'd', 'l', 'r', 'ul', 'dr', 'ur', 'dl']);
  });

  test('places each direction into its own group (issue #1)', async ({ page }) => {
    // Even when two lines share a visual axis (up + down on the vertical axis,
    // or left + right on the horizontal axis), they must end up in separate
    // groups so they don't flip simultaneously.
    const out = await page.evaluate(() => {
      return window.ReversiFlipOrder.groupAndSortLines([
        { dir: [1, 0], line: [[5,3]] },
        { dir: [-1, 0], line: [[2,3],[1,3]] },
        { dir: [0, 1], line: [[4,5]] },
        { dir: [0, -1], line: [[4,1]] },
      ]).map(g => ({ kind: g.kind, pieces: g.lines.reduce((s, l) => s + l.length, 0) }));
    });
    expect(out).toEqual([
      { kind: 'u', pieces: 2 },
      { kind: 'd', pieces: 1 },
      { kind: 'l', pieces: 1 },
      { kind: 'r', pieces: 1 },
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
          { kind: 'u', lines: [[[4,5]]] },
          { kind: 'r', lines: [[[3,4]]] },
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
        [{ kind: 'u', lines: [[[2,3],[1,3],[0,3]]] }],
        { flip, sleep, interval: 200, groupGap: 750 },
      );
      return events.map(e => e.t);
    });
    expect(times).toEqual([0, 200, 400]);
  });

  test('starts parallel lines within a single group at the same time', async ({ page }) => {
    // runFlipSchedule still supports multiple lines per group; groupAndSortLines
    // just no longer produces that shape in practice (each direction is its
    // own group). The scheduler contract is unchanged and tested directly here.
    const times = await page.evaluate(async () => {
      const { runFlipSchedule } = window.ReversiFlipOrder;
      const events = [];
      let now = 0;
      const sleep = (ms) => { now += ms; return Promise.resolve(); };
      const flip = (cell) => events.push({ t: now, cell });
      await runFlipSchedule(
        [{ kind: 'u', lines: [[[2,3]], [[5,3]]] }],
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
        [{ kind: 'u', lines: [[[4,5]]] }],
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
