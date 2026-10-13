/* Book Moves: the flashcard UI. Needs chess.js (Chess), deck.js (DECK) and core.js (Core). */
(function () {
  "use strict";

  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
  const VS = "︎";                 // text presentation, so pieces never render as emoji
  const FILES = "abcdefgh";
  const BOX_NAMES = { 1: "New & missed", 2: "Kinda knew", 3: "Growing confidence", 4: "Knew well" };
  const GRADE_TEXT = { knew: "Knew it", kinda: "Kinda knew", didnt: "Didn't know" };
  const LENGTH_TEXT = {
    short: { label: "Short", hint: "The card ends as soon as the variation is on the board." },
    standard: { label: "Standard", hint: "Two more moves for each side after the move that names the variation." },
    full: { label: "Full", hint: "The whole stored book line, to about move 9–14." }
  };
  const $ = id => document.getElementById(id);
  const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const byId = Object.fromEntries(DECK.map(c => [c.id, c]));
  const DISPLAY = DECK.map(c => c.id);              // fixed order for card numbers and the deck list
  const ORDER = shuffle(DISPLAY);                    // study order: reshuffled every visit (new cards and ties between due cards)
  const NUM = Object.fromEntries(DISPLAY.map((id, i) => [id, i + 1]));
  const family = id => byId[id].t.split(/[\s:]/)[0];   // "Ruy", "Sicilian", "French", "Queen's"…
  const graphs = {};

  const S = {
    state: { v: 1, step: 0, cards: {} }, len: "standard",
    card: null, graph: null, game: null, side: "w", phase: "idle",
    tries: 0, moveCount: 0, movePts: 0, log: [], sel: null, last: null, arrows: [],
    timers: [], lastResult: null
  };

  function later(fn, ms) { const t = setTimeout(fn, ms); S.timers.push(t); return t; }
  function clearTimers() { S.timers.forEach(clearTimeout); S.timers = []; }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function fmtPts(x) { return Number.isInteger(x) ? String(x) : (Math.floor(x) || "") + "½"; }
  function moveLabel(i) { const m = S.log[i]; return m ? (i % 2 === 0 ? `${i / 2 + 1}.` : `${(i + 1) / 2}…`) + m.san : ""; }

  /* ---------- persistence: browser copy for instant load; private per-user store when hosted on claude.ai ---------- */
  const LS_KEY = "bookmoves.leitner.v1";
  function sanitize(doc) {
    const out = { v: 1, step: 0, cards: {} };
    if (!doc || typeof doc !== "object") return out;
    out.step = Number.isFinite(doc.step) ? doc.step : 0;
    const C = doc.cards && typeof doc.cards === "object" ? doc.cards : {};
    for (const id of Object.keys(C)) {
      const e = C[id];
      if (!byId[id] || !e || typeof e !== "object") continue;
      out.cards[id] = {
        box: Math.min(4, Math.max(1, Math.round(e.box || 1))), seen: e.seen || 1, lvl: [0, 1, 2].includes(e.lvl) ? e.lvl : 0,
        due: Number.isFinite(e.due) ? e.due : 0,
        grade: ["knew", "kinda", "didnt"].includes(e.grade) ? e.grade : "didnt", acc: e.acc || 0, at: e.at || 0
      };
    }
    return out;
  }
  function loadLocal() { try { return sanitize(JSON.parse(localStorage.getItem(LS_KEY))); } catch (e) { return sanitize(null); } }
  function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(S.state)); } catch (e) {} }

  const remote = { ref: null, busy: false, again: false };
  async function saveRemote() {
    if (!remote.ref) return;
    if (remote.busy) { remote.again = true; return; }
    remote.busy = true;
    try { await remote.ref.set(JSON.parse(JSON.stringify(S.state))); }
    catch (e) {
      if (e && e.code === "unavailable") setTimeout(saveRemote, 1500 + Math.random() * 1500);
      else if (e && ["invalid_argument", "revoked", "not_granted"].includes(e.code)) { remote.ref = null; renderDeck(); }
    }
    remote.busy = false;
    if (remote.again) { remote.again = false; saveRemote(); }
  }
  function persist() { saveLocal(); saveRemote(); }
  async function connectRemote() {          // only on claude.ai; on localhost window.claude does not exist
    try {
      if (!window.claude || typeof window.claude.use !== "function") return;
      const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
      if (!db || !user) return;
      const uid = await user.id();
      if (!uid) return;
      const ref = db.doc("data/users/" + uid + "/bookmoves");
      const snap = await ref.get();
      remote.ref = ref;
      const doc = snap.exists ? sanitize(snap.data()) : null;
      if (doc && doc.step > S.state.step) {
        S.state = doc; saveLocal();
        const untouched = S.log.filter(m => m.who === "you").length === 0 && (S.phase === "play" || S.phase === "wait");
        if (untouched) startCard(Core.pickNext(S.state, ORDER, null, family)); else renderChrome();
      } else {
        if (S.state.step > ((doc && doc.step) || 0)) saveRemote();
        renderDeck();
      }
    } catch (e) { /* stay on the browser copy */ }
  }

  /* ---------- board ---------- */
  const flipped = () => S.side === "b";
  function sqName(r, c) { const f = flipped() ? 7 - c : c, rank = flipped() ? r + 1 : 8 - r; return FILES[f] + rank; }
  function sqRC(sq) { const f = FILES.indexOf(sq[0]), rank = +sq[1]; return flipped() ? [rank - 1, 7 - f] : [8 - rank, f]; }

  function renderBoard(anim) {
    const grid = $("grid"), game = S.game;
    const legal = S.sel ? game.moves({ square: S.sel, verbose: true }) : [];
    let checkSq = null;
    if (game.in_check()) {
      const t = game.turn();
      for (const f of FILES) for (let r = 1; r <= 8; r++) { const p = game.get(f + r); if (p && p.type === "k" && p.color === t) checkSq = f + r; }
    }
    const frag = document.createDocumentFragment();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const name = sqName(r, c), d = document.createElement("div");
      d.className = "sq " + ((r + c) % 2 ? "d" : "l");
      d.dataset.sq = name;
      if (S.last && (S.last.from === name || S.last.to === name)) d.classList.add("last");
      if (S.sel === name) d.classList.add("sel");
      if (checkSq === name) d.classList.add("chk");
      let html = "";
      if (c === 0) html += `<span class="coord r">${name[1]}</span>`;
      if (r === 7) html += `<span class="coord f">${name[0]}</span>`;
      const p = game.get(name);
      if (p) html += `<span class="pc ${p.color}">${GLYPH[p.type]}${VS}</span>`;
      if (legal.some(m => m.to === name)) html += `<span class="dotm${p ? " cap" : ""}"></span>`;
      d.innerHTML = html;
      frag.appendChild(d);
    }
    grid.innerHTML = "";
    grid.appendChild(frag);
    if (anim && !REDUCED) {                       // slide the moved piece from its old square
      const el = grid.querySelector(`[data-sq="${anim.to}"] .pc`);
      if (el) {
        const size = $("board").clientWidth / 8, [fr, fc] = sqRC(anim.from), [tr, tc] = sqRC(anim.to);
        el.style.transform = `translate(${(fc - tc) * size}px,${(fr - tr) * size}px)`;
        el.getBoundingClientRect();
        el.style.transition = "transform .24s cubic-bezier(.2,.7,.2,1)";
        el.style.transform = "";
      }
    }
  }
  function renderArrows() {
    $("arrowg").innerHTML = S.arrows.map(a => {
      const [r1, c1] = sqRC(a.from), [r2, c2] = sqRC(a.to);
      const x1 = c1 + .5, y1 = r1 + .5, x2 = c2 + .5, y2 = r2 + .5;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), k = (len - .32) / len;
      return `<line x1="${x1}" y1="${y1}" x2="${x1 + dx * k}" y2="${y1 + dy * k}" stroke="var(--hint)" stroke-width=".17" stroke-linecap="round" opacity=".92" marker-end="url(#ah)"></line>`;
    }).join("");
  }
  function flashSquare(sq) { const el = $("grid").querySelector(`[data-sq="${sq}"]`); if (el) el.classList.add("wrong"); }

  /* ---------- chrome ---------- */
  function setStatus(kind, tag, msg, action) {
    $("status").className = "status " + kind;
    $("stag").textContent = tag;
    $("smsg").textContent = msg;
    const b = $("sact");
    if (action) { b.hidden = false; b.textContent = action.label; b.onclick = action.fn; }
    else { b.hidden = true; b.onclick = null; }
  }
  function renderMoves() {
    const ol = $("moves");
    ol.innerHTML = S.log.length
      ? S.log.map((m, i) => (i % 2 === 0 ? `<li class="no">${i / 2 + 1}.</li>` : "") + `<li class="${m.who === "you" ? "you " + (m.st || "") : "opp"}">${esc(m.san)}</li>`).join("")
      : `<li class="empty">Moves appear here as you play.</li>`;
    if (!S.card) return;
    const done = S.log.filter(m => m.who === "you").length;
    const total = Core.plannedMoves(S.card, S.len);
    $("prog").textContent = S.len === "full" ? `${done} of up to ${total} moves` : `${done} of ${total} moves`;
  }
  function boxCounts() {
    const n = { 1: 0, 2: 0, 3: 0, 4: 0, fresh: 0 };
    for (const id of ORDER) { const e = S.state.cards[id]; if (e) n[e.box]++; else n.fresh++; }
    return n;
  }
  function renderChrome(bumpBox) {
    const n = boxCounts(), cur = S.card && S.state.cards[S.card.id];
    const curBox = cur ? cur.box : "new";
    $("boxes").innerHTML = [1, 2, 3, 4].map(b =>
      `<div class="bx${curBox === b ? " cur" : ""}${bumpBox === b ? " bump" : ""}" title="${BOX_NAMES[b]}"><small>Box ${b}</small><b>${n[b]}</b></div>`).join("") +
      `<div class="bx${curBox === "new" ? " cur" : ""}" title="Not studied yet"><small>New</small><b>${n.fresh}</b></div>`;
    if (bumpBox) setTimeout(() => { const el = $("boxes").querySelector(".bump"); if (el) el.classList.remove("bump"); }, 260);
    if (S.card) {
      $("boxtag").textContent = (cur ? `Box ${cur.box}` : "New card") + ` · ${LENGTH_TEXT[S.len].label} line`;
      $("cardno").textContent = `${String(NUM[S.card.id]).padStart(2, "0")} / ${ORDER.length}`;
    }
    const L = S.lastResult;
    $("lastline").innerHTML = L
      ? `Last card · <strong>${esc(byId[L.id].t)}</strong> · <span class="g-${L.grade}">${GRADE_TEXT[L.grade]} ${L.acc}%</span> · ${L.from} → Box ${L.to}`
      : "";
    renderDeck();
  }
  function renderDeck() {
    const step = S.state.step || 0, n = boxCounts();
    const due = ORDER.filter(id => S.state.cards[id] && S.state.cards[id].due <= step).length;
    $("decksum").textContent = `${ORDER.length} openings · ${due} due · ${n.fresh} new`;
    const settings = `<div class="settings"><p class="sethint">Every card starts with a Short line. Play it perfectly and it moves to the back of the deck with a Standard line, then a Full line.</p></div>`;
    const groups = [1, 2, 3, 4]
      .map(b => ({ title: `Box ${b}`, sub: BOX_NAMES[b], ids: DISPLAY.filter(id => S.state.cards[id] && S.state.cards[id].box === b) }))
      .concat([{ title: "New", sub: "Not studied yet", ids: DISPLAY.filter(id => !S.state.cards[id]) }])
      .filter(g => g.ids.length);
    const list = groups.map(g => `<div class="group"><h3>${g.title} <em>${g.sub}</em></h3>` +
      g.ids.map(id => {
        const c = byId[id], e = S.state.cards[id];
        const right = e ? `${LENGTH_TEXT[Core.levelOf(S.state, id)].label} · <span class="chip ${e.grade}">${e.acc}%</span>${e.due <= step ? "due" : "in " + (e.due - step)}` : "Short";
        return `<button type="button" class="row${S.card && S.card.id === id ? " cur" : ""}" data-id="${id}"><span class="n">${String(NUM[id]).padStart(2, "0")}</span><span class="dot ${c.s}"></span><span class="t">${esc(c.t)}</span><span class="r">${right}</span></button>`;
      }).join("") + `</div>`).join("");
    const where = remote.ref ? "Progress saves to your claude.ai account." : "Progress is saved in this browser.";
    $("deckbody").innerHTML = settings + list +
      `<div class="deckfoot"><span>${where}</span><button type="button" id="resetBtn">Reset progress</button></div>`;
  }

  /* ---------- a card ---------- */
  function startCard(id) {
    clearTimers();
    const card = byId[id];
    S.card = card;
    try { S.graph = graphs[id] || (graphs[id] = Core.buildGraph(card, Chess)); }
    catch (e) { setStatus("bad", "Error", "This opening's data failed to load. Pick another card from the deck."); return; }
    S.game = new Chess(); S.side = card.s; S.len = Core.levelOf(S.state, id);
    Object.assign(S, { tries: 0, moveCount: 0, movePts: 0, log: [], sel: null, last: null, arrows: [] });
    $("eco").textContent = card.e || "—";
    $("side").innerHTML = `<span class="dot ${card.s}"></span>You play ${card.s === "w" ? "White" : "Black"}`;
    $("title").textContent = card.t;
    $("stamp").hidden = true;
    renderBoard(); renderArrows(); renderMoves(); renderChrome();
    if (S.side === "b") {
      S.phase = "wait";
      setStatus("wait", "White", "You play Black. White is choosing a book move…");
      later(opponentMove, 750);
    } else {
      S.phase = "play";
      setStatus("turn", "Your move", "You play White. Play the opening from memory.");
    }
  }

  function opponentMove() {
    const opts = Core.options(S.graph, S.game.fen());
    if (!opts.length) return finishLine();
    const pick = opts[Math.floor(Math.random() * opts.length)];
    const mv = S.game.move({ from: pick.from, to: pick.to, promotion: pick.uci[4] || undefined });
    S.log.push({ san: mv.san, who: "opp" });
    S.last = { from: mv.from, to: mv.to };
    S.phase = "play"; S.tries = 0; S.arrows = [];
    renderBoard({ from: mv.from, to: mv.to }); renderArrows(); renderMoves();
    if (Core.isEnd(S.graph, S.game.fen())) return finishLine();
    const many = opts.length > 1 ? ` (one of ${opts.length} book replies)` : "";
    setStatus("turn", "Your move", `${S.side === "w" ? "Black" : "White"} played ${mv.san}${many}.`);
  }

  function tryMove(from, to, viaDrag) {
    if (S.phase !== "play" || S.game.turn() !== S.side) return false;
    const legal = S.game.moves({ square: from, verbose: true }).filter(m => m.to === to);
    if (!legal.length) return false;                       // not a legal move: just ignore it
    const promo = legal.some(m => m.promotion) ? "q" : undefined;
    const before = S.game.fen();
    const mv = S.game.move({ from, to, promotion: promo });
    const uci = from + to + (promo || "");
    if (Core.accepts(S.graph, before, uci, S.game.fen())) {
      S.movePts += Core.movePoints(S.tries); S.moveCount++;
      S.log.push({ san: mv.san, who: "you", st: S.tries === 0 ? "" : S.tries === 1 ? "half" : "miss" });
      S.last = { from, to }; S.sel = null; S.arrows = []; S.tries = 0;
      renderBoard(viaDrag ? null : { from, to }); renderArrows(); renderMoves();
      if (Core.lineDone(S.graph, S.game.fen(), S.game.history().length, S.card, S.len)) { finishLine(); return true; }
      S.phase = "wait";
      setStatus("wait", "Book", `${mv.san} is book.`);
      later(opponentMove, 420 + Math.random() * 280);
    } else {
      S.game.undo();
      S.tries++; S.sel = null;
      renderBoard(); flashSquare(to);
      const opts = Core.options(S.graph, before);
      if (S.tries >= 2) {
        S.arrows = opts.map(o => ({ from: o.from, to: o.to })); renderArrows();
        const names = opts.map(o => o.san);
        setStatus("hint", "Arrow", names.length > 1
          ? `Book moves here: ${names.join(" or ")}. Play one to continue.`
          : `The book move is ${names[0]}. Play it to continue.`);
      } else {
        const elsewhere = (S.card.x[Core.key(before)] || []).includes(mv.san);
        setStatus("bad", "Not book", elsewhere
          ? `${mv.san} is a real move, but it leaves this line. One more try.`
          : `${mv.san} isn't the book move here. One more try.`);
      }
    }
    return true;
  }

  function finishLine() {
    S.phase = "done";
    setStatus("done", "Middlegame", `End of the opening. Moves: ${fmtPts(S.movePts)} of ${S.moveCount}.`);
    setTimeout(() => {                                   // build the likely next card's tree meanwhile
      const guess = Core.pickNext(Core.record(S.state, S.card.id, { grade: "kinda", acc: 0.75 }, ORDER.length), ORDER, S.card.id, family);
      if (!graphs[guess]) { try { graphs[guess] = Core.buildGraph(byId[guess], Chess); } catch (e) {} }
    }, 60);
    later(finishCard, 900);
  }

  function finishCard() {
    S.phase = "transition";
    const id = S.card.id, prev = S.state.cards[id], from = prev ? "Box " + prev.box : "New";
    const res = Core.grade(S.movePts, S.moveCount);
    const rec = Core.record(S.state, id, res, ORDER.length);
    const levelUp = rec.levelUp; delete rec.levelUp;
    S.state = rec;
    const nextLen = LENGTH_TEXT[Core.levelOf(S.state, id)].label;
    const to = S.state.cards[id].box, acc = Math.round(res.acc * 100);
    S.lastResult = { id, grade: res.grade, acc, from, to };
    persist();
    const st = $("stamp");
    st.className = "stamp " + res.grade;
    st.innerHTML = `<b>${GRADE_TEXT[res.grade]}</b><small>${acc}% · ${from} → Box ${to}</small>` +
      (levelUp ? `<small class="lvlup">Next time: ${nextLen} line</small>` : "");
    st.hidden = false;
    setStatus("done", GRADE_TEXT[res.grade], `Moves ${fmtPts(S.movePts)} of ${S.moveCount}.` +
      (levelUp ? ` Back of the deck, next time with a ${nextLen} line.` : ""));
    renderChrome(to);
    const cardEl = $("card");
    later(() => {
      cardEl.classList.add("leaving");
      later(() => {
        cardEl.classList.remove("leaving");
        startCard(Core.pickNext(S.state, ORDER, id, family));
        cardEl.classList.add("entering");
        later(() => cardEl.classList.remove("entering"), 460);
      }, REDUCED ? 10 : 380);
    }, 1150);
  }

  /* ---------- input: tap-tap or drag ---------- */
  const boardEl = $("board");
  let drag = null;
  function sqAt(x, y) { const el = document.elementFromPoint(x, y), s = el && el.closest && el.closest(".sq"); return s && boardEl.contains(s) ? s.dataset.sq : null; }
  boardEl.addEventListener("pointerdown", e => {
    if (S.phase !== "play" || S.game.turn() !== S.side) return;
    const sq = sqAt(e.clientX, e.clientY); if (!sq) return;
    const p = S.game.get(sq);
    if (S.sel && S.sel !== sq && !(p && p.color === S.side)) {
      if (!tryMove(S.sel, sq, false)) { S.sel = null; renderBoard(); }
      return;
    }
    if (p && p.color === S.side) {
      S.sel = sq; renderBoard();
      const el = document.createElement("span");
      el.className = "drag pc " + p.color; el.textContent = GLYPH[p.type] + VS;
      el.style.fontSize = boardEl.clientWidth * 0.1 + "px";
      el.style.left = e.clientX + "px"; el.style.top = e.clientY + "px"; el.hidden = true;
      document.body.appendChild(el);
      drag = { from: sq, el, x: e.clientX, y: e.clientY, moved: false };
      try { boardEl.setPointerCapture(e.pointerId); } catch (err) {}
    } else { S.sel = null; renderBoard(); }
  });
  boardEl.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      drag.moved = true; drag.el.hidden = false;
      const pc = $("grid").querySelector(`[data-sq="${drag.from}"] .pc`); if (pc) pc.classList.add("ghost");
    }
    drag.el.style.left = e.clientX + "px"; drag.el.style.top = e.clientY + "px";
  });
  boardEl.addEventListener("pointerup", e => {
    if (!drag) return;
    const d = drag; drag = null; d.el.remove();
    if (!d.moved) return;                                  // a tap: keep the selection for tap-tap
    const to = sqAt(e.clientX, e.clientY);
    if (!to || to === d.from || !tryMove(d.from, to, true)) { if (S.phase === "play") renderBoard(); }
  });
  boardEl.addEventListener("pointercancel", () => { if (drag) { drag.el.remove(); drag = null; renderBoard(); } });

  $("deckbody").addEventListener("click", e => {
    const row = e.target.closest(".row");
    if (row) {
      if (S.phase === "transition") return;
      startCard(row.dataset.id);
      $("card").scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" });
      return;
    }
    const rb = e.target.closest("#resetBtn");
    if (rb) {
      if (rb.classList.contains("armed")) {
        S.state = { v: 1, step: 0, cards: {} }; S.lastResult = null; persist();
        startCard(ORDER[0]);
      } else {
        rb.classList.add("armed"); rb.textContent = "Click again to erase all boxes";
        setTimeout(() => { const b = $("resetBtn"); if (b) { b.classList.remove("armed"); b.textContent = "Reset progress"; } }, 3500);
      }
    }
  });

  /* ---------- boot ---------- */
  function boot(data) {
    if (typeof Chess !== "function") { setStatus("bad", "Offline", "The chess engine didn't load. Check your connection and reload."); return; }
    S.state = loadLocal();
    const want = data && data.cardId && byId[data.cardId] ? data.cardId : Core.pickNext(S.state, ORDER, null, family);
    startCard(want);
    connectRemote();
  }
  window.BookMoves = { S, startCard, finishLine };   // handy for debugging in the console
  const hot = window.claude && window.claude.hot;
  try { if (hot && hot.snapshot) hot.snapshot(() => ({ cardId: S.card && S.card.id })); } catch (e) {}
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
})();
