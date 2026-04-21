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
  // Each of the 8 directions is its own group, so a single move never fires
  // two directions in parallel (issue #1). Tie-breaker priority: smaller wins
  // — vertical (u,d) first, then horizontal (l,r), then \ axis (ul,dr),
  // then / axis (ur,dl).
  const KIND_PRIORITY = {
    u: 0, d: 1,
    l: 2, r: 3,
    ul: 4, dr: 5,
    ur: 6, dl: 7,
  };

  function dirKind(dr, dc) {
    if (dc === 0) return dr < 0 ? 'u' : 'd';
    if (dr === 0) return dc < 0 ? 'l' : 'r';
    if (dr < 0) return dc < 0 ? 'ul' : 'ur';
    return dc < 0 ? 'dl' : 'dr';
  }

  // Input: flipsForMove output — [{dir:[dr,dc], line:[[r,c],...]}, ...]
  // Output: [{kind, lines:[[[r,c],...],...]}, ...] ordered by total piece
  //   count descending, ties broken by KIND_PRIORITY.
  function groupAndSortLines(lines) {
    const groups = {};
    for (const k of Object.keys(KIND_PRIORITY)) groups[k] = [];
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
