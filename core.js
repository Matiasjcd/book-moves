/* Book Moves: rules with no DOM. Move trees, what counts as book, where a line ends,
   scoring and the Leitner schedule. Runs in the browser (window.Core) and in Node (require). */
(function (root, factory) {
  const Core = factory();
  if (typeof module === "object" && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Position key: piece placement, side to move and castling rights (move counters ignored),
  // so different move orders that reach the same position share one node.
  const key = fen => fen.split(" ").slice(0, 3).join(" ");

  // Merge a card's book lines (space-separated UCI moves) into one position graph.
  function buildGraph(card, ChessCtor) {
    const g = new Map(), ends = new Set();
    for (const line of card.l) {
      const game = new ChessCtor();
      for (const u of line.split(" ")) {
        const k = key(game.fen());
        const mv = game.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });
        if (!mv) throw new Error("Bad move " + u + " in " + card.id);
        if (!g.has(k)) g.set(k, new Map());
        g.get(k).set(u, { san: mv.san, from: mv.from, to: mv.to, next: key(game.fen()) });
      }
      ends.add(key(game.fen()));
    }
    return { g, ends };
  }

  // Book moves available in a position (the opponent picks one of these at random).
  function options(graph, fen) {
    const n = graph.g.get(key(fen));
    return n ? [...n.entries()].map(([uci, v]) => Object.assign({ uci }, v)) : [];
  }

  function isEnd(graph, fen) {
    const n = graph.g.get(key(fen));
    return !n || n.size === 0;
  }

  // A move is book if it is in the tree here, or if it transposes into any position of the tree.
  function accepts(graph, fenBefore, uci, fenAfter) {
    const n = graph.g.get(key(fenBefore));
    if (n && n.has(uci)) return true;
    const k2 = key(fenAfter);
    return graph.g.has(k2) || graph.ends.has(k2);
  }

  /* Where a line ends.
     card.p is the ply (half-move, 1 = White's first move) of the move that names the variation,
     e.g. 18 for 9...Na5 in the Chigorin.
       short:    the line ends with your first move at or after that ply
       standard: two more moves for each side (4 plies) after it
       full:     the whole stored book line */
  const LENGTHS = ["short", "standard", "full"];
  function targetPly(card, mode) {
    if (mode === "short") return card.p;
    if (mode === "standard") return card.p + 4;
    return Infinity;
  }
  function lineDone(graph, fen, plyPlayed, card, mode) {
    return isEnd(graph, fen) || plyPlayed >= targetPly(card, mode);
  }
  const userMovesAt = (ply, side) => (side === "w" ? (ply + 1) / 2 : ply / 2);
  // How many moves you play in this card under a mode (deepest branch for "full").
  function plannedMoves(card, mode) {
    const longest = Math.max(...card.l.map(l => l.split(" ").length));
    let end = longest;
    const t = targetPly(card, mode);
    if (isFinite(t)) {
      const userParity = card.s === "w" ? 1 : 0;
      end = Math.min(longest, t % 2 === userParity ? t : t + 1);
    }
    return userMovesAt(end, card.s);
  }

  // Scoring: first try 1, second try ½, needed the arrow 0. Accuracy = points ÷ your moves.
  const movePoints = tries => (tries === 0 ? 1 : tries === 1 ? 0.5 : 0);
  // Five grades in 20% bands: g1 = 0–19%, g2 = 20–39%, g3 = 40–59%, g4 = 60–79%, g5 = 80–100%.
  const GRADES = ["g1", "g2", "g3", "g4", "g5"];
  function grade(movePts, moveCount) {
    const acc = moveCount ? movePts / moveCount : 0;
    const band = Math.min(4, Math.floor(acc * 5 + 1e-9));
    return { acc, grade: GRADES[band], perfect: acc >= 0.9999 };
  }

  // Five Leitner boxes. 80–100% moves the card up a box, 60–79% keeps it, 40–59% drops it one,
  // 20–39% drops it two, 0–19% sends it back to box 1.
  // GAP = how many cards later a box comes due again.
  const BOXES = 5;
  const GAP = { 1: 3, 2: 6, 3: 12, 4: 24, 5: 40 };
  const SHIFT = { g5: 1, g4: 0, g3: -1, g2: -2 };
  function nextBox(box, g) {
    if (g === "g1") return 1;
    return Math.max(1, Math.min(BOXES, box + SHIFT[g]));
  }

  /* Each card climbs three line lengths: it starts Short; a perfect run (100%) moves it up to Standard,
     then Full, and sends it to the back of the queue (after every other card). Misses keep the level.
     Leitner boxes work as usual on top of that. */
  function record(state, id, res, deckSize) {
    const prev = state.cards[id] || { box: 1, seen: 0, lvl: 0 };
    const step = (state.step || 0) + 1;
    const box = nextBox(prev.box, res.grade);
    const lvl0 = prev.lvl || 0;
    const levelUp = !!res.perfect && lvl0 < 2;
    const lvl = levelUp ? lvl0 + 1 : lvl0;
    const due = step + (levelUp ? Math.max(GAP[box], deckSize || 42) : GAP[box]);
    const entry = { box, lvl, seen: prev.seen + 1, due, grade: res.grade, acc: Math.round(res.acc * 100), at: Date.now() };
    return { v: 1, step, cards: Object.assign({}, state.cards, { [id]: entry }), levelUp };
  }
  const levelOf = (state, id) => LENGTHS[Math.min(2, (state.cards[id] && state.cards[id].lvl) || 0)];

  // Missed cards (box 1) come back first; otherwise new cards alternate with due reviews,
  // and new cards pause while six or more cards sit in box 1.
  function pickNext(state, order, avoid, family) {
    // Within whichever group is chosen, prefer a card from a different opening family than the last one.
    const fam = family || (() => "");
    const lastFam = avoid ? fam(avoid) : null;
    const prefer = list => list.find(id => fam(id) !== lastFam) || list[0];
    const step = state.step || 0, C = state.cards;
    const seen = order.filter(id => C[id]);
    const due = seen.filter(id => id !== avoid && C[id].due <= step)
      .sort((a, b) => C[a].box - C[b].box || C[a].due - C[b].due);
    const fresh = order.filter(id => !C[id] && id !== avoid);
    const dueLow = due.filter(id => C[id].box === 1), dueHigh = due.filter(id => C[id].box > 1);
    const last = avoid && C[avoid];
    const lastWasNew = !!(last && last.seen === 1);
    const lastWasMissedReview = !!(last && last.seen > 1 && last.box === 1);
    if (dueLow.length && !lastWasMissedReview) return prefer(dueLow);
    const learning = seen.filter(id => C[id].box === 1).length;
    if (fresh.length && learning < 6 && !(lastWasNew && dueHigh.length)) return prefer(fresh);
    if (dueHigh.length) return prefer(dueHigh);
    if (dueLow.length) return prefer(dueLow);
    if (fresh.length) return prefer(fresh);
    const rest = seen.filter(id => id !== avoid).sort((a, b) => C[a].due - C[b].due || C[a].box - C[b].box);
    return (rest.length && prefer(rest)) || order[0];
  }

  return { key, buildGraph, options, isEnd, accepts, LENGTHS, targetPly, lineDone, plannedMoves,
    movePoints, GRADES, grade, BOXES, GAP, nextBox, record, levelOf, pickNext };
});
