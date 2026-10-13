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
if (g(10, 10).grade !== "knew" || g(9.5, 10).grade !== "kinda" || g(5, 10).grade !== "didnt") fail("grade thresholds");

// Leitner: every learner profile should eventually see the whole deck, with no immediate repeats
const ORDER = DECK.map(c => c.id);
function simulate(label, skill, reviews) {
  let st = { v: 1, step: 0, cards: {} }, prev = null;
  for (let i = 0; i < reviews; i++) {
    const id = Core.pickNext(st, ORDER, prev);
    if (id === prev) fail("same card twice in a row", id);
    const k = skill(id, (st.cards[id] || {}).seen || 0, Math.random());
    st = Core.record(st, id, { grade: k, acc: k === "knew" ? 1 : k === "kinda" ? 0.8 : 0.3 });
    prev = id;
  }
  const boxes = [1, 2, 3, 4].map(b => Object.values(st.cards).filter(e => e.box === b).length);
  console.log(`${label.padEnd(24)} seen ${Object.keys(st.cards).length}/${ORDER.length}  boxes ${JSON.stringify(boxes)}`);
}
simulate("strong learner", (id, seen, r) => (r < 0.75 ? "knew" : r < 0.95 ? "kinda" : "didnt"), 150);
simulate("average learner", (id, seen, r) => (r < 0.35 ? "knew" : r < 0.75 ? "kinda" : "didnt"), 150);
simulate("slow learner", (id, seen, r) => (r < 0.1 + seen * 0.15 ? "knew" : r < 0.4 + seen * 0.1 ? "kinda" : "didnt"), 150);
console.log(problems ? `${problems} problems` : "all checks passed");
process.exit(problems ? 1 : 0);
