// Pure flip-scheduling logic, shared between the browser IIFE (script.js) and
// the Node unit tests under tests/. No DOM, no real timers — the scheduler
// takes `flip` and `sleep` callbacks so tests can substitute mocks.
//
// UMD-style export: attaches `ReversiFlipOrder` to the global when loaded as a
// plain <script>, and assigns to `module.exports` when required from Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReversiFlipOrder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Tie-breaker priority: smaller wins, so vertical > horizontal > \ > /.
  // Diagonals split by axis so a move that flips along both \ and / runs them
  // one axis at a time rather than simultaneously (issue #1).
  const KIND_PRIORITY = { v: 0, h: 1, d1: 2, d2: 3 };

  function dirKind(dr, dc) {
    if (dc === 0) return 'v';
    if (dr === 0) return 'h';
    // dr*dc > 0 → \ axis (up-left/down-right); < 0 → / axis (up-right/down-left).
    return dr * dc > 0 ? 'd1' : 'd2';
  }

  // Input: flipsForMove output — [{dir:[dr,dc], line:[[r,c],...]}, ...]
  // Output: [{kind, lines:[[[r,c],...],...]}, ...] ordered by total piece
  //   count descending, ties broken by KIND_PRIORITY (v,h,d1,d2).
  function groupAndSortLines(lines) {
    const groups = { v: [], h: [], d1: [], d2: [] };
    for (const { dir, line } of lines) groups[dirKind(dir[0], dir[1])].push(line);
    const countOf = (ls) => ls.reduce((s, l) => s + l.length, 0);
    return Object.keys(groups)
      .filter(k => groups[k].length > 0)
      .sort((a, b) => {
        const diff = countOf(groups[b]) - countOf(groups[a]);
        return diff !== 0 ? diff : KIND_PRIORITY[a] - KIND_PRIORITY[b];
      })
      .map(k => ({ kind: k, lines: groups[k] }));
  }

  // Runs flips group-by-group. Within a group, lines run in parallel and
  // pieces in a line are spaced by `interval` ms. Between groups, waits
  // `groupGap` ms after the last kickoff of the previous group.
  async function runFlipSchedule(orderedGroups, { flip, sleep, interval, groupGap }) {
    for (let gi = 0; gi < orderedGroups.length; gi++) {
      const groupLines = orderedGroups[gi].lines;
      await Promise.all(groupLines.map(async (line) => {
        for (let i = 0; i < line.length; i++) {
          flip(line[i]);
          if (i < line.length - 1) await sleep(interval);
        }
      }));
      if (gi < orderedGroups.length - 1) await sleep(groupGap);
    }
  }

  return { dirKind, groupAndSortLines, runFlipSchedule };
});
