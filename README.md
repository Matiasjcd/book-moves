# Book Moves

Opening flashcards. Each card is one specific variation (for example *Ruy Lopez: Closed, Chigorin Defense*).
You play the moves from memory against a book opponent, and a four-box Leitner system decides when you
see the card again.

## Run it on localhost

```bash
cd ~/Downloads            # wherever book-moves.zip landed
unzip book-moves.zip
cd book-moves
python3 -m http.server 8000
```

Open <http://localhost:8000>. Stop the server with `Ctrl+C`.

There is no build step. chess.js is bundled in `vendor/`, so the app works offline; the fonts come from
Google Fonts when you're online and fall back to system fonts otherwise. Progress is stored in the
browser's localStorage for `http://localhost:8000` (`bookmoves.leitner.v1`). It is separate from the claude.ai version.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page markup |
| `style.css` | Styles (light and dark) |
| `app.js` | UI: board, move checking, card transitions |
| `core.js` | Rules with no DOM: move trees, what counts as book, where a line ends, scoring, Leitner schedule |
| `deck.js` | The 42 cards (generated; see below) |
| `pieces.js` | Piece images: the cburnett set (CC BY-SA 3.0, Colin M.L. Burnett) |
| `vendor/chess.js` | chess.js 0.10.3 (BSD-2-Clause) |
| `tools/` | Deck builder and tests |

## Rules

**Book moves.** Each card stores several book lines, merged into one tree keyed by position, so different move
orders that reach the same position count. Where theory has more than one good move, the opponent picks one at
random and any of them counts for you.

**Mistakes.** A wrong move snaps back. A second wrong move draws an arrow for the book move(s), and you play it to
continue. If the wrong move is a real move from a different line, the message says so.

**End of the opening.** Each card has `p`, the half-move (ply) of the move that names the variation, such as
9...Na5 in the Chigorin (ply 18). Every card climbs three line lengths:

- **Short** (where every card starts): ends with your first move at or after that ply.
- **Standard**: two more moves for each side (4 plies) after it.
- **Full**: the whole stored book line, about move 9–14.

A perfect run (every move right on the first try) moves the card up one length and sends it to the back of the
deck. Misses keep the card at its current length.

**Scoring.** A move found on the first try is worth 1, on the second try ½, and with the arrow 0.
Accuracy = points ÷ your moves. Each card gets one of five grades in 20% bands:

| Accuracy | Grade | Leitner box |
| --- | --- | --- |
| 80–100% | Nailed it (100% shows as *Perfect*) | up one |
| 60–79% | Solid | stays |
| 40–59% | Shaky | down one |
| 20–39% | Weak | down two |
| 0–19% | Didn't know | back to box 1 |

**Leitner (five boxes).** Box 1 holds new and missed cards; box 5 is mastered. A card comes due again
3 / 6 / 12 / 24 / 40 cards later for boxes 1–5. Missed cards come back first; otherwise new cards alternate with
due reviews, and new cards pause while six or more cards sit in box 1. A perfect run also moves the card up a line
length (see above) and sends it to the back of the deck.

## Rebuild or extend the deck

```bash
pip install chess                 # python-chess, used by the builder
cd tools
./fetch_data.sh                   # Lichess opening names + two polyglot opening books (~2 MB)
python3 build_deck.py             # validates every line and writes ../deck.js
cd .. && node tools/test_core.js  # random playthroughs in all three modes + Leitner simulation
```

- `tools/cards.json` defines each card: `pre` (the moves that define the variation; extra entries are other
  move orders), `t` (depth of the full line in plies), `p` (ply of the naming move), and optional `add`
  (hand-written lines) and `prune` (branches to drop).
- `tools/titles.json` holds each card's title.
- `tools/gen.py` grows each tree from the books. Your alternatives need at least 15% of the grandmaster-book games
  in that position (30% of the engine book where the GM book has no data). The opponent's alternatives need 25%
  (45%).
- `python3 tools/explore.py "e4 e5 Nf3" 6` prints the book tree from any position.

Data: [Lichess chess-openings](https://github.com/lichess-org/chess-openings) (CC0) for names,
`gm2001.bin` (grandmaster games) and `performance.bin` (engine book) for the move trees.
