// Plays thousands of random games through every card in every line-length mode and simulates
// the Leitner schedule.  Run from the project root:  node tools/test_core.js
"use strict";
const path = require("path");
const root = path.join(__dirname, "..");
const { Chess } = require(path.join(root, "vendor", "chess.js"));
const Core = require(path.join(root, "core.js"));
const DECK = require(path.join(root, "deck.js"));

let problems = 0;
const fail = (...a) => { problems++; console.log("PROBLEM:", ...a); };
const pick = a => a[Math.floor(Math.random() * a.length)];

const avg = { short: [], standard: [], full: [] };
for (const card of DECK) {
  const G = Core.buildGraph(card, Chess);
  const row = [];
  for (const mode of Core.LENGTHS) {
    const planned = Core.plannedMoves(card, mode);
    let early = 0, total = 0;
    for (let n = 0; n < 120; n++) {
      const game = new Chess();
      let userMoves = 0, done = false;
      for (let ply = 0; ply < 60 && !done; ply++) {
        const opts = Core.options(G, game.fen());
        if (!opts.length) { fail("no book move", card.id, game.history().join(" ")); break; }
        const o = pick(opts), before = game.fen();
        game.move({ from: o.from, to: o.to, promotion: o.uci[4] || undefined });
        if (game.turn() !== card.s) {                         // you just moved
          userMoves++;
          if (!Core.accepts(G, before, o.uci, game.fen())) fail("book move rejected", card.id, o.san);
          done = Core.lineDone(G, game.fen(), ply + 1, card, mode);
        } else if (Core.isEnd(G, game.fen())) { fail("line ended on the opponent's move", card.id); done = true; }
      }
      if (!done) fail("line never ended", card.id, mode);
      if (mode !== "full" && userMoves < planned) early++;
      if (userMoves > planned) fail("longer than planned", card.id, mode, userMoves, planned);
      total += userMoves;
    }
    avg[mode].push(total / 120);
    row.push(`${mode} ${planned}${early ? ` (${early} shorter)` : ""}`);
  }
  // "real move, other line" hints must be legal moves in their positions
  for (const [k, sans] of Object.entries(card.x)) {
    const g = new Chess(k + " - 0 1");
    for (const san of sans) { if (!g.move(san)) fail("bad side-line move", card.id, san); else g.undo(); }
  }
  console.log(card.id.padEnd(18), row.join(" | "));
}
const mean = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log(`average moves you play: short ${mean(avg.short)} | standard ${mean(avg.standard)} | full ${mean(avg.full)}`);

// Scoring thresholds
const g = Core.grade;
const bands = [[10, "g5", true], [8, "g5", false], [7.5, "g4", false], [6, "g4", false], [5.5, "g3", false], [4, "g3", false], [2, "g2", false], [1.5, "g1", false], [0, "g1", false]];
for (const [pts, want, perf] of bands) { const r = g(pts, 10); if (r.grade !== want || r.perfect !== perf) fail("grade band", pts, r.grade); }

// Leitner: every learner profile should eventually see the whole deck, with no immediate repeats
const ORDER = DECK.map(c => c.id);
function simulate(label, skill, reviews) {
  let st = { v: 1, step: 0, cards: {} }, prev = null;
  for (let i = 0; i < reviews; i++) {
    const id = Core.pickNext(st, ORDER, prev);
    if (id === prev) fail("same card twice in a row", id);
    const k = skill(id, (st.cards[id] || {}).seen || 0, Math.random());
    const acc = { g5: 1, g4: 0.7, g3: 0.5, g2: 0.3, g1: 0.1 }[k];
    st = Core.record(st, id, Core.grade(acc * 10, 10), ORDER.length);
    prev = id;
  }
  const boxes = [1, 2, 3, 4, 5].map(b => Object.values(st.cards).filter(e => e.box === b).length);
  console.log(`${label.padEnd(24)} seen ${Object.keys(st.cards).length}/${ORDER.length}  boxes ${JSON.stringify(boxes)}`);
}
simulate("strong learner", (id, seen, r) => (r < 0.6 ? "g5" : r < 0.85 ? "g4" : r < 0.95 ? "g3" : "g2"), 150);
simulate("average learner", (id, seen, r) => (r < 0.3 ? "g5" : r < 0.55 ? "g4" : r < 0.75 ? "g3" : r < 0.9 ? "g2" : "g1"), 150);
simulate("slow learner", (id, seen, r) => (r < 0.1 + seen * 0.15 ? "g5" : r < 0.3 + seen * 0.1 ? "g4" : r < 0.5 + seen * 0.05 ? "g3" : r < 0.75 ? "g2" : "g1"), 150);
console.log(problems ? `${problems} problems` : "all checks passed");
process.exit(problems ? 1 : 0);
