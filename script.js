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
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.innerHTML = '';

    if (state.gameOver) {
      const { b, w } = countDiscs(state.board);
      playerBlackEl.classList.add('gameover');
      playerWhiteEl.classList.add('gameover');
      let outcome;
      if (b > w) { playerBlackEl.classList.add('winner'); outcome = 'black'; }
      else if (w > b) { playerWhiteEl.classList.add('winner'); outcome = 'white'; }
      else { outcome = 'draw'; }
      overlayEl.classList.add('visible');
      overlayEl.setAttribute('aria-hidden', 'false');
      overlayEl.innerHTML = renderOutcomeCard(outcome);
      const resetBtn = overlayEl.querySelector('.overlay-reset');
      if (resetBtn) resetBtn.addEventListener('click', resetGame);
    }
  }

  // Reset from the game-over overlay. We *cannot* simply `location.reload()`:
  // the finished game's pushState entries would still be reachable via the
  // browser's back button, letting the user "undo" past the reset (#2).
  // Instead, navigate back to the boot entry and then pushState a fresh
  // entry — pushState prunes the old forward entries, so the just-played
  // game is no longer in the history stack.
  function resetGame() {
    const idx = history.state?.idx ?? 0;
    if (idx === 0) {
      state = initialState();
      history.replaceState({ state: clone(state), idx: 0 }, '');
      snapRender();
      return;
    }
    const onPop = () => {
      window.removeEventListener('popstate', onPop);
      state = initialState();
      const nextIdx = (history.state?.idx ?? 0) + 1;
      history.pushState({ state: clone(state), idx: nextIdx }, '');
      snapRender();
    };
    window.addEventListener('popstate', onPop);
    history.go(-idx);
  }

  // ---------- End-of-game illustration ----------
  // Flat, Irasutoya-ish cartoon built from simple SVG primitives.
  // Cheering boy (winner): both fists up + speech bubble with the result text.
  // Handshake (draw): boy + girl with hands clasped and a banner above.
  function renderOutcomeCard(outcome) {
    const svg = outcome === 'draw' ? drawSvg() : cheerSvg(outcome);
    const caption = outcome === 'black' ? '黒の勝ち!'
                 : outcome === 'white' ? '白の勝ち!'
                 : '引き分け';
    return `
      <div class="overlay-card">
        <div class="overlay-illust" aria-label="${caption}">${svg}</div>
        <button type="button" class="overlay-reset">リセット</button>
      </div>
    `;
  }

  function cheerSvg(color) {
    const bubbleText = color === 'black' ? '黒の勝ち!' : '白の勝ち!';
    const bubbleFill = '#ffffff';
    const textColor = '#1a1a1a';
    const discFace = color === 'black' ? '#111' : '#f2f2f2';
    const discShade = color === 'black' ? '#3a3a3a' : '#c8c8c8';
    return `
<svg viewBox="0 0 520 520" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    <radialGradient id="disc-${color}" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="${discShade}"/>
      <stop offset="100%" stop-color="${discFace}"/>
    </radialGradient>
    <radialGradient id="sunburst" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffe27a" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#ffe27a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- sunburst halo -->
  <circle cx="260" cy="260" r="240" fill="url(#sunburst)"/>
  <g stroke="#1a1a1a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- Big winning disc -->
    <circle cx="125" cy="200" r="70" fill="url(#disc-${color})"/>
    <!-- Speech bubble -->
    <g>
      <path d="M 235 95 Q 235 50 305 50 L 470 50 Q 500 50 500 90 L 500 150 Q 500 185 470 185 L 315 185 L 285 220 L 295 185 L 265 185 Q 235 185 235 150 Z"
            fill="${bubbleFill}"/>
      <text x="370" y="135" font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="48" font-weight="900" text-anchor="middle" fill="${textColor}" stroke="none">${bubbleText}</text>
    </g>
    <!-- Left arm + fist raised -->
    <path d="M 210 310 Q 170 240 150 185" fill="none" stroke-width="28" stroke-linecap="round"/>
    <path d="M 210 310 Q 170 240 150 185" fill="none" stroke="#ffd8ac" stroke-width="22" stroke-linecap="round"/>
    <circle cx="148" cy="178" r="26" fill="#ffd8ac"/>
    <!-- Right arm + fist raised -->
    <path d="M 320 310 Q 360 240 380 180" fill="none" stroke-width="28" stroke-linecap="round"/>
    <path d="M 320 310 Q 360 240 380 180" fill="none" stroke="#ffd8ac" stroke-width="22" stroke-linecap="round"/>
    <circle cx="382" cy="173" r="26" fill="#ffd8ac"/>
    <!-- Body (T-shirt) -->
    <path d="M 200 295 Q 195 285 205 280 L 325 280 Q 335 285 330 295 L 345 455 L 185 455 Z" fill="#3aa9f0"/>
    <!-- Neck -->
    <rect x="250" y="265" width="30" height="22" fill="#ffd8ac"/>
    <!-- Head -->
    <circle cx="265" cy="230" r="60" fill="#ffd8ac"/>
    <!-- Hair -->
    <path d="M 208 230 Q 205 170 265 160 Q 325 170 322 230 Q 318 200 290 192 Q 280 210 260 200 Q 240 215 225 198 Q 212 210 208 230 Z" fill="#1a1a1a" stroke-width="3"/>
    <!-- Eyes (closed, happy arcs) -->
    <path d="M 238 232 Q 248 224 258 232" fill="none" stroke-width="4"/>
    <path d="M 272 232 Q 282 224 292 232" fill="none" stroke-width="4"/>
    <!-- Open-mouth smile -->
    <path d="M 246 258 Q 265 282 284 258 Q 265 268 246 258 Z" fill="#b83a2a" stroke-width="3"/>
    <!-- Blush -->
    <ellipse cx="228" cy="255" rx="10" ry="5" fill="#ffb1a8" stroke="none" opacity="0.85"/>
    <ellipse cx="302" cy="255" rx="10" ry="5" fill="#ffb1a8" stroke="none" opacity="0.85"/>
    <!-- Sparkles -->
    <g stroke-width="3" fill="#ffe27a">
      <path d="M 80 90 L 86 108 L 104 114 L 86 120 L 80 138 L 74 120 L 56 114 L 74 108 Z"/>
      <path d="M 440 310 L 445 322 L 457 326 L 445 330 L 440 342 L 435 330 L 423 326 L 435 322 Z"/>
    </g>
  </g>
</svg>`;
  }

  function drawSvg() {
    return `
<svg viewBox="0 0 620 520" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    <radialGradient id="halo-draw" cx="50%" cy="50%" r="55%">
      <stop offset="0%" stop-color="#b7f0c7" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#b7f0c7" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="310" cy="280" r="270" fill="url(#halo-draw)"/>
  <g stroke="#1a1a1a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <!-- Banner (引き分け) -->
    <g>
      <rect x="190" y="40" width="240" height="82" rx="42" fill="#ffffff"/>
      <text x="310" y="99" font-family="'Hiragino Sans','Yu Gothic',sans-serif" font-size="48" font-weight="900" text-anchor="middle" fill="#1a1a1a" stroke="none">引き分け</text>
    </g>

    <!-- Boy (left) -->
    <!-- body -->
    <path d="M 150 330 Q 145 320 155 315 L 235 315 Q 245 320 240 330 L 250 470 L 140 470 Z" fill="#3aa9f0"/>
    <!-- neck -->
    <rect x="180" y="302" width="26" height="20" fill="#ffd8ac"/>
    <!-- head -->
    <circle cx="193" cy="260" r="52" fill="#ffd8ac"/>
    <!-- hair -->
    <path d="M 142 260 Q 140 205 193 197 Q 246 205 244 260 Q 240 230 215 222 Q 205 238 188 230 Q 172 243 160 228 Q 148 240 142 260 Z" fill="#1a1a1a" stroke-width="3"/>
    <!-- eyes -->
    <circle cx="177" cy="262" r="4" fill="#1a1a1a" stroke="none"/>
    <circle cx="209" cy="262" r="4" fill="#1a1a1a" stroke="none"/>
    <!-- smile -->
    <path d="M 178 283 Q 193 295 208 283" fill="none" stroke-width="3"/>
    <!-- blush -->
    <ellipse cx="168" cy="278" rx="8" ry="4" fill="#ffb1a8" stroke="none" opacity="0.85"/>
    <ellipse cx="218" cy="278" rx="8" ry="4" fill="#ffb1a8" stroke="none" opacity="0.85"/>
    <!-- arm reaching out (right arm to the middle) -->
    <path d="M 235 340 Q 275 330 295 355" fill="none" stroke-width="30" stroke-linecap="round"/>
    <path d="M 235 340 Q 275 330 295 355" fill="none" stroke="#3aa9f0" stroke-width="24" stroke-linecap="round"/>

    <!-- Girl (right) -->
    <!-- dress body -->
    <path d="M 470 330 Q 465 320 475 315 L 390 315 Q 380 320 385 330 L 370 470 L 480 470 Z" fill="#ff88b4"/>
    <!-- neck -->
    <rect x="415" y="302" width="26" height="20" fill="#ffd8ac"/>
    <!-- head -->
    <circle cx="428" cy="260" r="52" fill="#ffd8ac"/>
    <!-- hair base -->
    <path d="M 377 260 Q 375 205 428 197 Q 481 205 479 260 Q 475 230 450 222 Q 440 238 423 230 Q 407 243 395 228 Q 383 240 377 260 Z" fill="#6b3a1a" stroke-width="3"/>
    <!-- hair side bangs long -->
    <path d="M 377 260 Q 372 300 382 320 L 395 315 Q 386 292 388 270 Z" fill="#6b3a1a" stroke-width="3"/>
    <path d="M 479 260 Q 484 300 474 320 L 461 315 Q 470 292 468 270 Z" fill="#6b3a1a" stroke-width="3"/>
    <!-- twin-tail bows -->
    <circle cx="378" cy="240" r="12" fill="#ff5d8f" stroke-width="3"/>
    <circle cx="478" cy="240" r="12" fill="#ff5d8f" stroke-width="3"/>
    <!-- eyes -->
    <circle cx="412" cy="262" r="4" fill="#1a1a1a" stroke="none"/>
    <circle cx="444" cy="262" r="4" fill="#1a1a1a" stroke="none"/>
    <!-- smile -->
    <path d="M 413 283 Q 428 295 443 283" fill="none" stroke-width="3"/>
    <!-- blush -->
    <ellipse cx="403" cy="278" rx="8" ry="4" fill="#ffb1a8" stroke="none" opacity="0.85"/>
    <ellipse cx="453" cy="278" rx="8" ry="4" fill="#ffb1a8" stroke="none" opacity="0.85"/>
    <!-- arm reaching out (left arm to the middle) -->
    <path d="M 385 340 Q 345 330 325 355" fill="none" stroke-width="30" stroke-linecap="round"/>
    <path d="M 385 340 Q 345 330 325 355" fill="none" stroke="#ff88b4" stroke-width="24" stroke-linecap="round"/>

    <!-- Clasped hands in the middle -->
    <ellipse cx="310" cy="358" rx="40" ry="24" fill="#ffd8ac"/>
    <path d="M 310 336 L 310 380" stroke="#b68666" stroke-width="2" opacity="0.8"/>
    <path d="M 280 355 Q 310 362 340 355" fill="none" stroke="#b68666" stroke-width="2" opacity="0.6"/>

    <!-- Hearts / sparkles -->
    <g stroke="none">
      <path d="M 100 130 q -12 -18 -24 -6 q -12 12 24 30 q 36 -18 24 -30 q -12 -12 -24 6 Z" fill="#ff5d8f" opacity="0.85"/>
      <path d="M 535 145 q -10 -14 -20 -4 q -10 10 20 26 q 30 -16 20 -26 q -10 -10 -20 4 Z" fill="#ff5d8f" opacity="0.85"/>
    </g>
  </g>
</svg>`;
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
    const nextIdx = (history.state?.idx ?? 0) + 1;
    history.pushState({ state: clone(state), idx: nextIdx }, '');

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
    history.replaceState({ state: clone(state), idx: 0 }, '');
    snapRender();
  }

  boot();
})();
