/* ============================================================
   Chess AI — negamax with alpha-beta pruning, move ordering,
   iterative deepening and a simple time budget.
   ============================================================ */

(function (root, factory) {
  if (typeof module !== 'undefined') {
    module.exports = factory(require('./engine.js'));
  } else {
    root.ChessAI = factory(root.ChessEngine);
  }
}(typeof self !== 'undefined' ? self : this, function (Engine) {
  const { generateLegalMoves, makeMove, unmakeMove, isInCheck, colorOf, typeOf, opponent } = Engine;

  const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // Piece-square tables (from white's perspective, row 0 = rank 8).
  /* eslint-disable no-multi-spaces */
  const PST = {
    P: [
      0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0,
    ],
    N: [
      -50,-40,-30,-30,-30,-30,-40,-50,
      -40,-20,  0,  0,  0,  0,-20,-40,
      -30,  0, 10, 15, 15, 10,  0,-30,
      -30,  5, 15, 20, 20, 15,  5,-30,
      -30,  0, 15, 20, 20, 15,  0,-30,
      -30,  5, 10, 15, 15, 10,  5,-30,
      -40,-20,  0,  5,  5,  0,-20,-40,
      -50,-40,-30,-30,-30,-30,-40,-50,
    ],
    B: [
      -20,-10,-10,-10,-10,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5, 10, 10,  5,  0,-10,
      -10,  5,  5, 10, 10,  5,  5,-10,
      -10,  0, 10, 10, 10, 10,  0,-10,
      -10, 10, 10, 10, 10, 10, 10,-10,
      -10,  5,  0,  0,  0,  0,  5,-10,
      -20,-10,-10,-10,-10,-10,-10,-20,
    ],
    R: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
    ],
    Q: [
      -20,-10,-10, -5, -5,-10,-10,-20,
      -10,  0,  0,  0,  0,  0,  0,-10,
      -10,  0,  5,  5,  5,  5,  0,-10,
      -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
      -10,  5,  5,  5,  5,  5,  0,-10,
      -10,  0,  5,  0,  0,  0,  0,-10,
      -20,-10,-10, -5, -5,-10,-10,-20,
    ],
    K: [
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -30,-40,-40,-50,-50,-40,-40,-30,
      -20,-30,-30,-40,-40,-30,-30,-20,
      -10,-20,-20,-20,-20,-20,-20,-10,
      20, 20,  0,  0,  0,  0, 20, 20,
      20, 30, 10,  0,  0, 10, 30, 20,
    ],
  };
  /* eslint-enable no-multi-spaces */

  function evaluate(state) {
    const { board } = state;
    let score = 0;
    let material = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece) continue;
        const color = colorOf(piece);
        const type = typeOf(piece);
        const idx = color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
        const value = PIECE_VALUE[type] + PST[type][idx];
        score += color === 'w' ? value : -value;
        if (type !== 'K') material += PIECE_VALUE[type];
      }
    }
    // Small mobility bonus, skipped in endgame-heavy positions for speed.
    return score;
  }

  function orderMoves(moves) {
    // MVV-LVA-ish: captures and promotions first.
    return moves.slice().sort((a, b) => {
      const scoreOf = (m) => (m.capture ? 10 : 0) + (m.promotion ? 9 : 0) + (m.castle ? 3 : 0);
      return scoreOf(b) - scoreOf(a);
    });
  }

  function negamax(state, depth, alpha, beta, color, deadline, nodeCounter) {
    nodeCounter.n++;
    if (Date.now() > deadline) return { score: evaluate(state) * color, timedOut: true };

    const moves = generateLegalMoves(state);
    if (moves.length === 0) {
      if (isInCheck(state, state.turn)) return { score: -100000 - depth }; // checkmate: worse the sooner it's avoided
      return { score: 0 }; // stalemate
    }
    if (depth === 0) {
      return { score: evaluate(state) * color };
    }

    const ordered = orderMoves(moves);
    let best = -Infinity;
    for (const move of ordered) {
      const undo = makeMove(state, move);
      const result = negamax(state, depth - 1, -beta, -alpha, -color, deadline, nodeCounter);
      unmakeMove(state, undo);
      const score = -result.score;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // beta cutoff
      if (result.timedOut) return { score: best, timedOut: true };
    }
    return { score: best };
  }

  // Finds the best move for the side to move, using iterative deepening
  // within a time budget (ms). Falls back gracefully if time runs out mid-search.
  function findBestMove(state, options) {
    const opts = Object.assign({ maxDepth: 3, timeMs: 1200 }, options || {});
    const deadline = Date.now() + opts.timeMs;
    const color = state.turn === 'w' ? 1 : -1;
    const rootMoves = generateLegalMoves(state);
    if (rootMoves.length === 0) return null;
    if (rootMoves.length === 1) return rootMoves[0];

    let bestMove = rootMoves[0];
    const nodeCounter = { n: 0 };

    for (let depth = 1; depth <= opts.maxDepth; depth++) {
      const ordered = orderMoves(rootMoves);
      let alpha = -Infinity;
      const beta = Infinity;
      let currentBest = null;
      let currentBestScore = -Infinity;
      let timedOut = false;

      for (const move of ordered) {
        const undo = makeMove(state, move);
        const result = negamax(state, depth - 1, -beta, -alpha, -color, deadline, nodeCounter);
        unmakeMove(state, undo);
        const score = -result.score;
        if (score > currentBestScore) {
          currentBestScore = score;
          currentBest = move;
        }
        if (score > alpha) alpha = score;
        if (result.timedOut && Date.now() > deadline) { timedOut = true; break; }
      }

      if (currentBest) bestMove = currentBest;
      if (timedOut || Date.now() > deadline) break;
    }
    return bestMove;
  }

  return { findBestMove, evaluate, nodesSearched: () => 0 };
}));
