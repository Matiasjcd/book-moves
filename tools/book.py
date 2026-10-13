"""Opening-book helpers: polyglot lookups (GM games + engine book) and Lichess opening names.

Data files live in tools/data/ and are downloaded by fetch_data.sh.
"""
import csv
import os

import chess
import chess.polyglot

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
GM = chess.polyglot.open_reader(os.path.join(DATA, "gm2001.bin"))        # grandmaster games
PF = chess.polyglot.open_reader(os.path.join(DATA, "performance.bin"))   # engine performance book


def key(board):
    """Position key used everywhere (also by the app): placement, side to move, castling rights."""
    return " ".join(board.fen().split(" ")[:3])


# position key -> (eco, name), from the Lichess opening tables
NAMES = {}
for letter in "abcde":
    with open(os.path.join(DATA, letter + ".tsv")) as fh:
        for row in csv.DictReader(fh, delimiter="\t"):
            b = chess.Board()
            ok = True
            for tok in row["pgn"].split():
                if tok.endswith("."):
                    continue
                if tok[0].isdigit() and "." in tok:
                    tok = tok.split(".")[-1]
                    if not tok:
                        continue
                try:
                    b.push_san(tok)
                except ValueError:
                    ok = False
                    break
            if ok:
                NAMES[key(b)] = (row["eco"], row["name"])


def shares(reader, board):
    """{san: percent of the book weight} for a position."""
    entries = list(reader.find_all(board))
    total = sum(e.weight for e in entries)
    if not total:
        return {}
    return {board.san(e.move): round(100 * e.weight / total) for e in entries}


def deepest_name(moves):
    """The deepest named position along a list of SAN moves, and its ply."""
    b = chess.Board()
    best, best_ply = None, 0
    for i, m in enumerate(moves):
        b.push_san(m)
        if key(b) in NAMES:
            best, best_ply = NAMES[key(b)], i + 1
    return best, best_ply
