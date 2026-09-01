(function () {
  const Engine = window.ChessEngine;
  const AI = window.ChessAI;

  const PIECE_GLYPH = {
    wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
    bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
  };
  const PIECE_LETTER = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N' };
  const FILES = 'abcdefgh';
  const PIECE_VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

  const boardEl = document.getElementById('board');
  const turnDot = document.getElementById('turnDot');
  const turnLabel = document.getElementById('turnLabel');
  const statusMsg = document.getElementById('statusMsg');
  const capturedTop = document.getElementById('capturedTop');
  const capturedBottom = document.getElementById('capturedBottom');
  const materialDiffEl = document.getElementById('materialDiff');
  const moveListEl = document.getElementById('moveList');
  const modeSelect = document.getElementById('modeSelect');
  const difficultyRow = document.getElementById('difficultyRow');
  const difficultySelect = document.getElementById('difficultySelect');
  const newGameBtn = document.getElementById('newGameBtn');
  const undoBtn = document.getElementById('undoBtn');
  const flipBtn = document.getElementById('flipBtn');
  const promoOverlay = document.getElementById('promoOverlay');
  const promoButtons = document.querySelectorAll('.promo-options button');

  let state, undoStack, sanHistory, flipped, selected, legalTargets, lastMove, aiThinking;

  function newGame() {
    state = Engine.createInitialState();
    undoStack = [];
    sanHistory = [];
    selected = null;
    legalTargets = [];
    lastMove = null;
    aiThinking = false;
    render();
  }

  function squareCoords(row, col) {
    // Returns visual (r,c) accounting for board flip.
    return flipped ? { r: 7 - row, c: 7 - col } : { r: row, c: col };
  }

  function boardRowColFromVisual(vr, vc) {
    return flipped ? { r: 7 - vr, c: 7 - vc } : { r: vr, c: vc };
  }

  function buildBoardDom() {
    boardEl.innerHTML = '';
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const sq = document.createElement('div');
        const { r, c } = boardRowColFromVisual(vr, vc);
        const isLight = (r + c) % 2 === 0;
        sq.className = 'square ' + (isLight ? 'light' : 'dark');
        sq.dataset.r = r;
        sq.dataset.c = c;
        if (vc === 0) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'coord rank';
          rankLabel.textContent = 8 - r;
          sq.appendChild(rankLabel);
        }
        if (vr === 7) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'coord file';
          fileLabel.textContent = FILES[c];
          sq.appendChild(fileLabel);
        }
        sq.addEventListener('click', onSquareClick);
        boardEl.appendChild(sq);
      }
    }
  }

  function render() {
    if (boardEl.children.length !== 64) buildBoardDom();

    const status = Engine.getGameStatus(state);
    const kingPos = Engine.findKing(state.board, state.turn);

    for (const sqEl of boardEl.children) {
      const r = +sqEl.dataset.r, c = +sqEl.dataset.c;
      sqEl.classList.remove('selected', 'last-move', 'in-check');
      const existingPiece = sqEl.querySelector('.piece');
      if (existingPiece) existingPiece.remove();
      const existingDot = sqEl.querySelector('.move-dot');
      if (existingDot) existingDot.remove();
      const existingRing = sqEl.querySelector('.capture-ring');
      if (existingRing) existingRing.remove();

      const piece = state.board[r][c];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece ' + (piece[0] === 'w' ? 'white' : 'black');
        span.textContent = PIECE_GLYPH[piece];
        sqEl.appendChild(span);
      }

      if (selected && selected.r === r && selected.c === c) sqEl.classList.add('selected');
      if (lastMove && ((lastMove.fr === r && lastMove.fc === c) || (lastMove.tr === r && lastMove.tc === c))) {
        sqEl.classList.add('last-move');
      }
      if ((status === 'check' || status === 'checkmate') && kingPos && kingPos.r === r && kingPos.c === c) {
        sqEl.classList.add('in-check');
      }
      const target = legalTargets.find(m => m.tr === r && m.tc === c);
      if (target) {
        const marker = document.createElement('span');
        marker.className = target.capture || target.enPassant ? 'capture-ring' : 'move-dot';
        sqEl.appendChild(marker);
      }
    }

    turnDot.className = 'turn-dot' + (state.turn === 'b' ? ' black' : '');
    turnLabel.textContent = state.turn === 'w' ? 'White to move' : 'Black to move';

    if (status === 'checkmate') {
      const winner = state.turn === 'w' ? 'Black' : 'White';
      statusMsg.textContent = `Checkmate — ${winner} wins`;
      statusMsg.classList.remove('muted');
    } else if (status === 'stalemate') {
      statusMsg.textContent = 'Stalemate — draw';
      statusMsg.classList.remove('muted');
    } else if (status === 'draw-50move' || status === 'draw-material') {
      statusMsg.textContent = 'Draw';
      statusMsg.classList.remove('muted');
    } else if (status === 'check') {
      statusMsg.textContent = 'Check';
      statusMsg.classList.remove('muted');
    } else if (aiThinking) {
      statusMsg.textContent = 'Thinking…';
      statusMsg.classList.add('muted');
    } else {
      statusMsg.textContent = '';
      statusMsg.classList.add('muted');
    }

    renderCaptured();
    renderMoveList();
    undoBtn.disabled = undoStack.length === 0 || aiThinking;
  }

  function renderCaptured() {
    const captured = { w: [], b: [] }; // pieces captured BY each color
    for (const rec of undoStack) {
      if (rec.capturedPiece) {
        const capturedColor = rec.capturedPiece[0];
        const by = capturedColor === 'w' ? 'b' : 'w';
        captured[by].push(rec.capturedPiece);
      }
    }
    const order = { Q: 0, R: 1, B: 2, N: 3, P: 4 };
    const sortFn = (a, b) => order[a[1]] - order[b[1]];
    captured.w.sort(sortFn);
    captured.b.sort(sortFn);

    const whiteScore = captured.w.reduce((s, p) => s + PIECE_VALUE[p[1]], 0);
    const blackScore = captured.b.reduce((s, p) => s + PIECE_VALUE[p[1]], 0);
    const diff = whiteScore - blackScore;

    // Top row = captured by black (shown near top/black side), bottom = captured by white.
    capturedTop.textContent = captured.b.map(p => PIECE_GLYPH[p]).join(' ');
    capturedBottom.textContent = captured.w.map(p => PIECE_GLYPH[p]).join(' ');
    materialDiffEl.textContent = diff === 0 ? '' : (diff > 0 ? `White +${diff}` : `Black +${-diff}`);
  }

  function renderMoveList() {
    moveListEl.innerHTML = '';
    for (let i = 0; i < sanHistory.length; i += 2) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = (i / 2 + 1) + '.';
      const white = document.createElement('span');
      white.className = 'san';
      white.textContent = sanHistory[i] || '';
      const black = document.createElement('span');
      black.className = 'san';
      black.textContent = sanHistory[i + 1] || '';
      moveListEl.appendChild(num);
      moveListEl.appendChild(white);
      moveListEl.appendChild(black);
    }
    moveListEl.scrollTop = moveListEl.scrollHeight;
  }

  /* ---------- SAN notation ---------- */

  function toSquareName(r, c) { return FILES[c] + (8 - r); }

  // Must be called with `preMoveBoard` = a snapshot of the board BEFORE the
  // move was made (so piece types/positions of other pieces are correct),
  // and `state` = the state AFTER the move was made (for check/mate suffix).
  function computeSAN(preMoveBoard, legalMovesBeforeMove, move, postMoveState) {
    if (move.castle === 'K') return finishSAN('O-O', postMoveState);
    if (move.castle === 'Q') return finishSAN('O-O-O', postMoveState);

    const type = Engine.typeOf(preMoveBoard[move.fr][move.fc]);
    let san = '';

    if (type === 'P') {
      if (move.capture) san += FILES[move.fc] + 'x';
      san += toSquareName(move.tr, move.tc);
      if (move.promotion) san += '=' + move.promotion;
    } else {
      san += PIECE_LETTER[type];
      // Disambiguation: other same-type, same-color pieces that could also reach this square.
      const ambiguous = legalMovesBeforeMove.filter(m =>
        m.tr === move.tr && m.tc === move.tc &&
        !(m.fr === move.fr && m.fc === move.fc) &&
        Engine.typeOf(preMoveBoard[m.fr][m.fc]) === type);
      if (ambiguous.length > 0) {
        const sameFile = ambiguous.some(m => m.fc === move.fc);
        const sameRank = ambiguous.some(m => m.fr === move.fr);
        if (!sameFile) san += FILES[move.fc];
        else if (!sameRank) san += (8 - move.fr);
        else san += FILES[move.fc] + (8 - move.fr);
      }
      if (move.capture) san += 'x';
      san += toSquareName(move.tr, move.tc);
    }
    return finishSAN(san, postMoveState);
  }

  function finishSAN(base, postMoveState) {
    const status = Engine.getGameStatus(postMoveState);
    if (status === 'checkmate') return base + '#';
    if (status === 'check') return base + '+';
    return base;
  }

  /* ---------- Interaction ---------- */

  function onSquareClick(e) {
    if (aiThinking) return;
    const r = +e.currentTarget.dataset.r;
    const c = +e.currentTarget.dataset.c;
    const status = Engine.getGameStatus(state);
    if (status === 'checkmate' || status === 'stalemate' || status.startsWith('draw')) return;

    const piece = state.board[r][c];

    if (selected) {
      const target = legalTargets.find(m => m.tr === r && m.tc === c);
      if (target) {
        playMove(target);
        return;
      }
    }

    if (piece && Engine.colorOf(piece) === state.turn) {
      selected = { r, c };
      legalTargets = Engine.legalMovesFrom(state, r, c);
    } else {
      selected = null;
      legalTargets = [];
    }
    render();
  }

  function playMove(move) {
    if (move.promotion && move.promotion !== 'Q') {
      // Multiple promotion-option moves are generated per target square;
      // ask the user which one they want.
    }
    const promoChoices = legalTargets.filter(m => m.tr === move.tr && m.tc === move.tc && m.promotion);
    if (promoChoices.length > 1) {
      showPromotionModal(promoChoices);
      return;
    }
    commitMove(move);
  }

  function showPromotionModal(choices) {
    promoOverlay.classList.remove('hidden');
    promoButtons.forEach(btn => {
      btn.onclick = () => {
        promoOverlay.classList.add('hidden');
        const chosen = choices.find(m => m.promotion === btn.dataset.piece);
        commitMove(chosen);
      };
    });
  }

  function commitMove(move) {
    const legalBefore = Engine.generateLegalMoves(state);
    const preMoveBoard = state.board.map(row => row.slice());
    const undo = Engine.makeMove(state, move);
    const san = computeSAN(preMoveBoard, legalBefore, move, state);
    sanHistory.push(san);
    undoStack.push(undo);
    lastMove = move;
    selected = null;
    legalTargets = [];
    render();

    const status = Engine.getGameStatus(state);
    const gameOver = status === 'checkmate' || status === 'stalemate' || status.startsWith('draw');
    if (!gameOver && modeSelect.value === 'ai' && state.turn === 'b') {
      triggerAIMove();
    }
  }

  function triggerAIMove() {
    aiThinking = true;
    render();
    const depth = { easy: 2, medium: 3, hard: 4 }[difficultySelect.value] || 3;
    const timeMs = { easy: 500, medium: 900, hard: 1500 }[difficultySelect.value] || 900;
    setTimeout(() => {
      const legalBefore = Engine.generateLegalMoves(state);
      const preMoveBoard = state.board.map(row => row.slice());
      const move = AI.findBestMove(state, { maxDepth: depth, timeMs });
      aiThinking = false;
      if (!move) { render(); return; }
      const undo = Engine.makeMove(state, move);
      const san = computeSAN(preMoveBoard, legalBefore, move, state);
      sanHistory.push(san);
      undoStack.push(undo);
      lastMove = move;
      render();
    }, 60);
  }

  function undo() {
    if (undoStack.length === 0 || aiThinking) return;
    const rec = undoStack.pop();
    Engine.unmakeMove(state, rec);
    sanHistory.pop();
    // In AI mode, undo the human move too so it's the human's turn again.
    if (modeSelect.value === 'ai' && undoStack.length > 0 && state.turn === 'b') {
      const rec2 = undoStack.pop();
      Engine.unmakeMove(state, rec2);
      sanHistory.pop();
    }
    selected = null;
    legalTargets = [];
    lastMove = undoStack.length ? undoStack[undoStack.length - 1].move : null;
    render();
  }

  newGameBtn.addEventListener('click', newGame);
  undoBtn.addEventListener('click', undo);
  flipBtn.addEventListener('click', () => { flipped = !flipped; buildBoardDom(); render(); });
  modeSelect.addEventListener('change', () => {
    difficultyRow.classList.toggle('hidden', modeSelect.value !== 'ai');
    newGame();
  });

  flipped = false;
  difficultyRow.classList.toggle('hidden', modeSelect.value !== 'ai');
  newGame();
})();
