/* ============================================================
   Chess Engine
   Board: 8x8 array, row 0 = rank 8 (top/black back rank),
                     row 7 = rank 1 (bottom/white back rank)
          col 0 = file a, col 7 = file h
   Pieces: 'wP','wN','wB','wR','wQ','wK','bP',... or null
   ============================================================ */

const KNIGHT_OFFSETS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_OFFSETS   = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const BISHOP_DIRS    = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ROOK_DIRS      = [[-1,0],[1,0],[0,-1],[0,1]];
const QUEEN_DIRS     = BISHOP_DIRS.concat(ROOK_DIRS);

function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function colorOf(piece) { return piece ? piece[0] : null; }
function typeOf(piece) { return piece ? piece[1] : null; }
function opponent(color) { return color === 'w' ? 'b' : 'w'; }

function createInitialState() {
  const back = ['R','N','B','Q','K','B','N','R'];
  const board = new Array(8);
  board[0] = back.map(t => 'b' + t);
  board[1] = new Array(8).fill('bP');
  for (let r = 2; r <= 5; r++) board[r] = new Array(8).fill(null);
  board[6] = new Array(8).fill('wP');
  board[7] = back.map(t => 'w' + t);

  return {
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    epTarget: null,       // {r,c} square a pawn can capture en passant onto
    halfmove: 0,
    fullmove: 1,
  };
}

function cloneState(state) {
  return {
    board: state.board.map(row => row.slice()),
    turn: state.turn,
    castling: Object.assign({}, state.castling),
    epTarget: state.epTarget ? { r: state.epTarget.r, c: state.epTarget.c } : null,
    halfmove: state.halfmove,
    fullmove: state.fullmove,
  };
}

/* ---------- Attack detection ---------- */

function isSquareAttacked(board, row, col, byColor) {
  // Pawns
  const dir = byColor === 'w' ? 1 : -1; // white pawn attacks from row+1 towards row
  for (const dc of [-1, 1]) {
    const r = row + dir, c = col + dc;
    if (inBounds(r, c) && board[r][c] === byColor + 'P') return true;
  }
  // Knights
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const r = row + dr, c = col + dc;
    if (inBounds(r, c) && board[r][c] === byColor + 'N') return true;
  }
  // King
  for (const [dr, dc] of KING_OFFSETS) {
    const r = row + dr, c = col + dc;
    if (inBounds(r, c) && board[r][c] === byColor + 'K') return true;
  }
  // Sliding: bishop/queen
  for (const [dr, dc] of BISHOP_DIRS) {
    let r = row + dr, c = col + dc;
    while (inBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === 'B' || typeOf(p) === 'Q')) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  // Sliding: rook/queen
  for (const [dr, dc] of ROOK_DIRS) {
    let r = row + dr, c = col + dc;
    while (inBounds(r, c)) {
      const p = board[r][c];
      if (p) {
        if (colorOf(p) === byColor && (typeOf(p) === 'R' || typeOf(p) === 'Q')) return true;
        break;
      }
      r += dr; c += dc;
    }
  }
  return false;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === color + 'K') return { r, c };
  return null;
}

function isInCheck(state, color) {
  const k = findKing(state.board, color);
  if (!k) return false;
  return isSquareAttacked(state.board, k.r, k.c, opponent(color));
}

/* ---------- Pseudo-legal move generation ---------- */

function addSlidingMoves(board, r, c, dirs, color, moves) {
  for (const [dr, dc] of dirs) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const target = board[nr][nc];
      if (!target) {
        moves.push({ fr: r, fc: c, tr: nr, tc: nc });
      } else {
        if (colorOf(target) !== color) moves.push({ fr: r, fc: c, tr: nr, tc: nc, capture: true });
        break;
      }
      nr += dr; nc += dc;
    }
  }
}

function generatePseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece || colorOf(piece) !== turn) continue;
      const type = typeOf(piece);

      if (type === 'P') {
        const dir = turn === 'w' ? -1 : 1;
        const startRow = turn === 'w' ? 6 : 1;
        const promoRow = turn === 'w' ? 0 : 7;
        // single push
        if (inBounds(r + dir, c) && !board[r + dir][c]) {
          pushPawnMove(moves, r, c, r + dir, c, promoRow);
          // double push
          if (r === startRow && !board[r + 2 * dir][c]) {
            moves.push({ fr: r, fc: c, tr: r + 2 * dir, tc: c, doublePush: true });
          }
        }
        // captures
        for (const dc of [-1, 1]) {
          const nr = r + dir, nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (target && colorOf(target) !== turn) {
            pushPawnMove(moves, r, c, nr, nc, promoRow, true);
          } else if (state.epTarget && state.epTarget.r === nr && state.epTarget.c === nc) {
            moves.push({ fr: r, fc: c, tr: nr, tc: nc, capture: true, enPassant: true });
          }
        }
      } else if (type === 'N') {
        for (const [dr, dc] of KNIGHT_OFFSETS) {
          const nr = r + dr, nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target) moves.push({ fr: r, fc: c, tr: nr, tc: nc });
          else if (colorOf(target) !== turn) moves.push({ fr: r, fc: c, tr: nr, tc: nc, capture: true });
        }
      } else if (type === 'B') {
        addSlidingMoves(board, r, c, BISHOP_DIRS, turn, moves);
      } else if (type === 'R') {
        addSlidingMoves(board, r, c, ROOK_DIRS, turn, moves);
      } else if (type === 'Q') {
        addSlidingMoves(board, r, c, QUEEN_DIRS, turn, moves);
      } else if (type === 'K') {
        for (const [dr, dc] of KING_OFFSETS) {
          const nr = r + dr, nc = c + dc;
          if (!inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (!target) moves.push({ fr: r, fc: c, tr: nr, tc: nc });
          else if (colorOf(target) !== turn) moves.push({ fr: r, fc: c, tr: nr, tc: nc, capture: true });
        }
        // castling
        const rights = state.castling;
        const backRow = turn === 'w' ? 7 : 0;
        if (r === backRow && c === 4 && !isSquareAttacked(board, r, c, opponent(turn))) {
          const kSide = turn === 'w' ? rights.wK : rights.bK;
          const qSide = turn === 'w' ? rights.wQ : rights.bQ;
          if (kSide && !board[backRow][5] && !board[backRow][6] &&
              board[backRow][7] === turn + 'R' &&
              !isSquareAttacked(board, backRow, 5, opponent(turn)) &&
              !isSquareAttacked(board, backRow, 6, opponent(turn))) {
            moves.push({ fr: r, fc: c, tr: backRow, tc: 6, castle: 'K' });
          }
          if (qSide && !board[backRow][1] && !board[backRow][2] && !board[backRow][3] &&
              board[backRow][0] === turn + 'R' &&
              !isSquareAttacked(board, backRow, 3, opponent(turn)) &&
              !isSquareAttacked(board, backRow, 2, opponent(turn))) {
            moves.push({ fr: r, fc: c, tr: backRow, tc: 2, castle: 'Q' });
          }
        }
      }
    }
  }
  return moves;
}

function pushPawnMove(moves, fr, fc, tr, tc, promoRow, capture) {
  if (tr === promoRow) {
    for (const p of ['Q', 'R', 'B', 'N']) {
      moves.push({ fr, fc, tr, tc, capture: !!capture, promotion: p });
    }
  } else {
    moves.push({ fr, fc, tr, tc, capture: !!capture });
  }
}

/* ---------- Make / Unmake ---------- */

function makeMove(state, move) {
  const { board } = state;
  const piece = board[move.fr][move.fc];
  const color = colorOf(piece);
  const undo = {
    move,
    movedPiece: piece,
    capturedPiece: board[move.tr][move.tc],
    capturedSquare: { r: move.tr, c: move.tc },
    prevCastling: Object.assign({}, state.castling),
    prevEpTarget: state.epTarget ? { r: state.epTarget.r, c: state.epTarget.c } : null,
    prevHalfmove: state.halfmove,
    prevFullmove: state.fullmove,
    rookFrom: null,
    rookTo: null,
  };

  // En passant capture removes a pawn NOT on the destination square
  if (move.enPassant) {
    const capRow = color === 'w' ? move.tr + 1 : move.tr - 1;
    undo.capturedPiece = board[capRow][move.tc];
    undo.capturedSquare = { r: capRow, c: move.tc };
    board[capRow][move.tc] = null;
  }

  // Move the piece
  board[move.fr][move.fc] = null;
  board[move.tr][move.tc] = move.promotion ? color + move.promotion : piece;

  // Castling: move the rook too
  if (move.castle === 'K') {
    const row = move.fr;
    board[row][5] = board[row][7];
    board[row][7] = null;
    undo.rookFrom = { r: row, c: 7 };
    undo.rookTo = { r: row, c: 5 };
  } else if (move.castle === 'Q') {
    const row = move.fr;
    board[row][3] = board[row][0];
    board[row][0] = null;
    undo.rookFrom = { r: row, c: 0 };
    undo.rookTo = { r: row, c: 3 };
  }

  // Update castling rights
  const newCastling = Object.assign({}, state.castling);
  if (typeOf(piece) === 'K') {
    if (color === 'w') { newCastling.wK = false; newCastling.wQ = false; }
    else { newCastling.bK = false; newCastling.bQ = false; }
  }
  const clearIfRook = (r, c) => {
    if (r === 7 && c === 0) newCastling.wQ = false;
    if (r === 7 && c === 7) newCastling.wK = false;
    if (r === 0 && c === 0) newCastling.bQ = false;
    if (r === 0 && c === 7) newCastling.bK = false;
  };
  clearIfRook(move.fr, move.fc);
  clearIfRook(move.tr, move.tc);
  state.castling = newCastling;

  // En passant target for next move
  state.epTarget = move.doublePush
    ? { r: (move.fr + move.tr) / 2, c: move.fc }
    : null;

  // Halfmove clock
  if (typeOf(piece) === 'P' || move.capture) state.halfmove = 0;
  else state.halfmove++;

  if (state.turn === 'b') state.fullmove++;
  state.turn = opponent(state.turn);

  return undo;
}

function unmakeMove(state, undo) {
  const { move } = undo;
  const { board } = state;
  const color = colorOf(undo.movedPiece);

  board[move.fr][move.fc] = undo.movedPiece;
  board[move.tr][move.tc] = null;
  board[undo.capturedSquare.r][undo.capturedSquare.c] = undo.capturedPiece;

  if (move.castle) {
    board[undo.rookFrom.r][undo.rookFrom.c] = color + 'R';
    board[undo.rookTo.r][undo.rookTo.c] = null;
  }

  state.castling = undo.prevCastling;
  state.epTarget = undo.prevEpTarget;
  state.halfmove = undo.prevHalfmove;
  state.fullmove = undo.prevFullmove;
  state.turn = opponent(state.turn);
}

/* ---------- Legal move generation ---------- */

function generateLegalMoves(state) {
  const pseudo = generatePseudoMoves(state);
  const legal = [];
  const color = state.turn;
  for (const move of pseudo) {
    const undo = makeMove(state, move);
    if (!isInCheck(state, color)) legal.push(move);
    unmakeMove(state, undo);
  }
  return legal;
}

function legalMovesFrom(state, r, c) {
  return generateLegalMoves(state).filter(m => m.fr === r && m.fc === c);
}

function getGameStatus(state) {
  const moves = generateLegalMoves(state);
  const inCheck = isInCheck(state, state.turn);
  if (moves.length === 0) {
    return inCheck ? 'checkmate' : 'stalemate';
  }
  if (state.halfmove >= 100) return 'draw-50move';
  if (hasInsufficientMaterial(state.board)) return 'draw-material';
  return inCheck ? 'check' : 'ongoing';
}

function hasInsufficientMaterial(board) {
  const pieces = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c]) pieces.push(board[r][c]);
  if (pieces.length > 4) return false;
  const nonKings = pieces.filter(p => typeOf(p) !== 'K');
  if (nonKings.length === 0) return true; // K vs K
  if (nonKings.length === 1 && (typeOf(nonKings[0]) === 'B' || typeOf(nonKings[0]) === 'N')) return true; // K+minor vs K
  return false;
}

const ChessEngineExports = {
  createInitialState, cloneState, generateLegalMoves, legalMovesFrom,
  makeMove, unmakeMove, isInCheck, getGameStatus, colorOf, typeOf, opponent,
  findKing, isSquareAttacked,
};

if (typeof module !== 'undefined') {
  module.exports = ChessEngineExports;
}
if (typeof window !== 'undefined') {
  window.ChessEngine = ChessEngineExports;
}
