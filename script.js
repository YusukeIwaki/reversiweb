(() => {
  const ROWS = 8;
  const COLS = 8;
  const EMPTY = 0;
  const BLACK = 1;
  const WHITE = 2;
  const DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [ 0, -1],          [ 0, 1],
    [ 1, -1], [ 1, 0], [ 1, 1],
  ];
  const STAR_POINTS = new Set(['1,1', '1,5', '5,1', '5,5']); // bottom-right of (r,c) corresponds to inner star intersection

  const FLIP_DELAY_START_MS = 800;
  const FLIP_INTERVAL_MS = 200;
  const FLIP_ANIM_MS = 450; // keep in sync with @keyframes coin-flip duration
  const FLIP_GROUP_GAP_MS = 300;

  // Pure grouping / scheduling lives in flip-order.js so it can be unit-tested.
  const { groupAndSortLines, runFlipSchedule } = window.ReversiFlipOrder;

  const boardEl = document.getElementById('board');
  const overlayEl = document.getElementById('overlay');
  const handBlackEl = document.getElementById('hand-black');
  const handWhiteEl = document.getElementById('hand-white');
  const playerBlackEl = document.getElementById('player-black');
  const playerWhiteEl = document.getElementById('player-white');

  let state = null;
  let animating = false;
  let pendingPopstate = null;

  // ---------- State helpers ----------
  function initialState() {
    const board = Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
    board[3][3] = WHITE;
    board[3][4] = BLACK;
    board[4][3] = BLACK;
    board[4][4] = WHITE;
    return {
      board,
      turn: BLACK,
      handBlack: 30,
      handWhite: 30,
      gameOver: false,
    };
  }

  function clone(s) {
    return {
      board: s.board.map(row => row.slice()),
      turn: s.turn,
      handBlack: s.handBlack,
      handWhite: s.handWhite,
      gameOver: s.gameOver,
    };
  }

  function inside(r, c) { return r >= 0 && r < ROWS && c >= 0 && c < COLS; }

  function flipsForMove(board, r, c, color) {
    if (board[r][c] !== EMPTY) return [];
    const opp = color === BLACK ? WHITE : BLACK;
    const out = [];
    for (const [dr, dc] of DIRS) {
      const line = [];
      let nr = r + dr, nc = c + dc;
      while (inside(nr, nc) && board[nr][nc] === opp) {
        line.push([nr, nc]);
        nr += dr;
        nc += dc;
      }
      if (line.length > 0 && inside(nr, nc) && board[nr][nc] === color) {
        out.push({ dir: [dr, dc], line });
      }
    }
    return out;
  }

  function hasValidMove(board, color) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (flipsForMove(board, r, c, color).length > 0) return true;
      }
    }
    return false;
  }

  function countDiscs(board) {
    let b = 0, w = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (board[r][c] === BLACK) b++;
        else if (board[r][c] === WHITE) w++;
      }
    }
    return { b, w };
  }

  // ---------- DOM helpers ----------
  function buildBoard() {
    boardEl.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        if (STAR_POINTS.has(`${r},${c}`)) cell.classList.add('star');
        cell.addEventListener('click', onCellClick);
        boardEl.appendChild(cell);
      }
    }
  }

  function getCell(r, c) {
    return boardEl.children[r * COLS + c];
  }

  function createPieceEl(color, animateAppear) {
    const piece = document.createElement('div');
    piece.className = 'piece';
    piece.dataset.color = color === BLACK ? 'black' : 'white';
    if (animateAppear) {
      piece.classList.add('appear');
      piece.addEventListener('animationend', () => piece.classList.remove('appear'), { once: true });
    }
    return piece;
  }

  // Coin-flip animation: scaleX 1 -> 0 -> 1; swap color at mid-flip
  function flipPieceAnimated(r, c, newColor) {
    const cell = getCell(r, c);
    const piece = cell.querySelector('.piece');
    if (!piece) return;
    piece.classList.add('flipping');
    setTimeout(() => {
      piece.dataset.color = newColor === BLACK ? 'black' : 'white';
    }, 225); // half of 0.45s flip
    piece.addEventListener('animationend', () => piece.classList.remove('flipping'), { once: true });
  }

  function clearHints() {
    for (const cell of boardEl.children) cell.classList.remove('valid');
  }

  // Each stripe represents a single double-sided disc viewed edge-on: the
  // top half shows one face color and the bottom half shows the other.
  // That's baked into the .hand-piece CSS background, so renderHand just
  // syncs the DOM child count to the state count (no color alternation).
  function renderHand(handEl, _color, count) {
    while (handEl.children.length > count) handEl.lastElementChild.remove();
    while (handEl.children.length < count) {
      const m = document.createElement('div');
      m.className = 'hand-piece';
      handEl.appendChild(m);
    }
  }

  function animateRemoveHandPiece(handEl) {
    const last = handEl.lastElementChild;
    if (!last) return;
    const rect = last.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'hand-piece hand-piece-ghost';
    Object.assign(ghost.style, {
      position: 'fixed',
      left: rect.left + 'px',
      top: rect.top + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      margin: '0',
      maxHeight: 'none',
      pointerEvents: 'none',
    });
    const dy = handEl.closest('.player-black') ? -18 : 18;
    document.body.appendChild(ghost);
    last.remove();
    requestAnimationFrame(() => {
      ghost.style.opacity = '0';
      ghost.style.transform = `scale(0.3) translateY(${dy}px)`;
    });
    const done = () => { if (ghost.parentNode) ghost.remove(); };
    ghost.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 600);
  }

  function showHints() {
    clearHints();
    if (state.gameOver) return;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (state.board[r][c] === EMPTY &&
            flipsForMove(state.board, r, c, state.turn).length > 0) {
          getCell(r, c).classList.add('valid');
        }
      }
    }
  }

  function updateUIChrome() {
    const blackTurn = !state.gameOver && state.turn === BLACK;
    const whiteTurn = !state.gameOver && state.turn === WHITE;
    playerBlackEl.classList.toggle('active', blackTurn);
    playerWhiteEl.classList.toggle('active', whiteTurn);

    playerBlackEl.classList.remove('gameover', 'winner');
    playerWhiteEl.classList.remove('gameover', 'winner');
    overlayEl.classList.remove('visible');
    overlayEl.textContent = '';

    if (state.gameOver) {
      const { b, w } = countDiscs(state.board);
      playerBlackEl.classList.add('gameover');
      playerWhiteEl.classList.add('gameover');
      if (b > w) playerBlackEl.classList.add('winner');
      else if (w > b) playerWhiteEl.classList.add('winner');
      overlayEl.classList.add('visible');
      overlayEl.textContent = b > w ? 'BLACK WINS' : (w > b ? 'WHITE WINS' : 'DRAW');
    }
  }

  // Re-render the entire board to match state (used for popstate restoration)
  function snapRender() {
    document.body.classList.add('no-anim');
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const cell = getCell(r, c);
        const v = state.board[r][c];
        const existing = cell.querySelector('.piece');
        if (v === EMPTY) {
          if (existing) existing.remove();
        } else {
          if (existing) {
            existing.dataset.color = v === BLACK ? 'black' : 'white';
          } else {
            cell.appendChild(createPieceEl(v, false));
          }
        }
      }
    }
    renderHand(handBlackEl, BLACK, state.handBlack);
    renderHand(handWhiteEl, WHITE, state.handWhite);
    updateUIChrome();
    showHints();
    // Force reflow then re-enable animations
    void document.body.offsetHeight;
    document.body.classList.remove('no-anim');
  }

  // ---------- Move logic ----------
  function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

  async function onCellClick(e) {
    if (animating || state.gameOver) return;
    const r = +e.currentTarget.dataset.r;
    const c = +e.currentTarget.dataset.c;
    const lines = flipsForMove(state.board, r, c, state.turn);
    if (lines.length === 0) return;
    await performMove(r, c, lines);
  }

  async function performMove(r, c, lines) {
    animating = true;
    clearHints();
    const placed = state.turn;

    // 1) place piece (state + DOM)
    state.board[r][c] = placed;
    if (placed === BLACK) state.handBlack--;
    else state.handWhite--;
    const pieceEl = createPieceEl(placed, true);
    getCell(r, c).appendChild(pieceEl);
    animateRemoveHandPiece(placed === BLACK ? handBlackEl : handWhiteEl);

    // 2) wait, then flip by direction group. Groups run sequentially in order of
    //    total piece count desc (ties: vertical > horizontal > diagonal). Within a
    //    group, lines animate in parallel and pieces in a line are spaced by
    //    FLIP_INTERVAL_MS. Between groups we wait FLIP_ANIM_MS (last flip finishes)
    //    + FLIP_GROUP_GAP_MS. state.board is updated as each flip *starts*.
    const orderedGroups = groupAndSortLines(lines);
    await sleep(FLIP_DELAY_START_MS);
    await runFlipSchedule(orderedGroups, {
      flip: ([fr, fc]) => {
        state.board[fr][fc] = placed;
        flipPieceAnimated(fr, fc, placed);
      },
      sleep,
      interval: FLIP_INTERVAL_MS,
      groupGap: FLIP_ANIM_MS + FLIP_GROUP_GAP_MS,
    });

    // 3) determine next turn — switch as soon as the final flip has started.
    const opp = placed === BLACK ? WHITE : BLACK;
    if (hasValidMove(state.board, opp)) {
      state.turn = opp;
    } else if (hasValidMove(state.board, placed)) {
      state.turn = placed;
    } else {
      state.gameOver = true;
    }

    updateUIChrome();
    showHints();

    // 4) push history
    history.pushState({ state: clone(state) }, '');

    // 5) wait for the in-flight coin-flip to finish before unblocking input.
    await sleep(FLIP_ANIM_MS);
    animating = false;
    if (pendingPopstate) {
      const s = pendingPopstate;
      pendingPopstate = null;
      state = clone(s);
      snapRender();
    }
  }

  // ---------- History ----------
  window.addEventListener('popstate', (e) => {
    const s = e.state && e.state.state;
    if (!s) return;
    if (animating) {
      // URL already rolled; defer state swap until animation ends so we don't
      // desync from history. Last-one-wins if multiple popstates queue up.
      pendingPopstate = s;
      return;
    }
    state = clone(s);
    snapRender();
  });

  // ---------- Boot ----------
  function boot() {
    buildBoard();
    state = initialState();
    history.replaceState({ state: clone(state) }, '');
    snapRender();
  }

  boot();
})();
