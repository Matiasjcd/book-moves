"""Generate opening trees from defining prefixes using the two books."""
import chess, json, sys
from book import GM, PF, shares, key, NAMES

USER_GM, USER_PF = 15, 30     # alternatives accepted for the user
OPP_GM, OPP_PF = 25, 45       # alternatives the opponent may choose
ELSE_GM, ELSE_PF = 4, 8       # "real move, other variation" detection
MAX_USER, MAX_OPP = 4, 2

def ranked(b):
    g, p = shares(GM, b), shares(PF, b)
    allm = set(g) | set(p)
    # rank: gm share primarily (human practice), perf as tie-break / fallback
    if g:
        return sorted(allm, key=lambda s: (-(g.get(s, 0)), -(p.get(s, 0)))), g, p
    return sorted(allm, key=lambda s: -(p.get(s, 0))), g, p

def children(b, is_user, depth_left, budget):
    order, g, p = ranked(b)
    if not order: return []
    out = [order[0]]
    if budget["leaves"] < budget["cap"] and depth_left > 1:
        for s in order[1:]:
            lim = MAX_USER if is_user else MAX_OPP
            if len(out) >= lim: break
            if g:   # GM practice decides when it has data here
                ok = g.get(s, 0) >= (USER_GM if is_user else OPP_GM)
            else:
                ok = p.get(s, 0) >= (USER_PF if is_user else OPP_PF)
            if ok:
                out.append(s); budget["leaves"] += 1
    return [s for s in out if s not in budget["ban"]] or [out[0]]

def expand(b, moves, side, target, budget, lines):
    if len(moves) >= target or b.is_game_over():
        lines.append(list(moves)); return
    is_user = (b.turn == side)
    ch = children(b, is_user, target - len(moves), budget)
    if not ch:
        lines.append(list(moves)); return
    for s in ch:
        b.push_san(s); moves.append(s)
        expand(b, moves, side, target, budget, lines)
        moves.pop(); b.pop()

def trim(line, side):
    # last move must be the user's
    b = chess.Board()
    for m in line: b.push_san(m)
    while line and b.turn == side:  # side to move is user -> last move was opponent's
        b.pop(); line = line[:-1]
    return line

def generate(card):
    side = chess.WHITE if card["s"] == "w" else chess.BLACK
    out = []
    budget = {"leaves": 1, "cap": card.get("cap", 10), "ban": set(card.get("ban", []))}
    for pre in card["pre"]:
        b = chess.Board(); mv = pre.split()
        for m in mv: b.push_san(m)
        lines = []
        expand(b, list(mv), side, card["t"], budget, lines)
        for l in lines:
            l = trim(l, side)
            if len(l) > len(mv) - 1:
                out.append(" ".join(l))
    prune = card.get("prune", [])
    out = [l for l in out if not any(p in (" " + l + " ") for p in [" " + q + " " for q in prune])]
    for extra in card.get("add", []):
        out.append(extra)
    # dedupe preserving order
    seen = set(); res = []
    for l in out:
        if l not in seen: seen.add(l); res.append(l)
    return res

def elsewhere(card, lines):
    """For each user-to-move position in the tree: book moves that are not in the tree."""
    side = chess.WHITE if card["s"] == "w" else chess.BLACK
    graph = {}
    boards = {}
    for line in lines:
        b = chess.Board()
        for m in line.split():
            k = key(b)
            graph.setdefault(k, set()).add(m); boards[k] = b.copy()
            b.push_san(m)
    res = {}
    for k, sans in graph.items():
        b = boards[k]
        if b.turn != side: continue
        g, p = shares(GM, b), shares(PF, b)
        other = sorted(s for s in set(g) | set(p) if s not in sans and (g.get(s, 0) >= ELSE_GM or p.get(s, 0) >= ELSE_PF))
        if other: res[k] = other
    return res

def show(card, lines):
    side = chess.WHITE if card["s"] == "w" else chess.BLACK
    print(f"== {card['n']} [{card['s']}] lines={len(lines)}")
    # print as indented tree
    prev = []
    for l in lines:
        mv = l.split()
        i = 0
        while i < min(len(prev), len(mv)) and prev[i] == mv[i]: i += 1
        b = chess.Board()
        for m in mv[:i]: b.push_san(m)
        seg = []
        for j in range(i, len(mv)):
            num = f"{j//2+1}." if j % 2 == 0 else (f"{j//2+1}..." if j == i else "")
            seg.append(f"{num}{mv[j]}")
        print("   " + " " * min(i, 40) + " ".join(seg))
        prev = mv

if __name__ == "__main__":
    cards = json.load(open(sys.argv[1]))
    sel = sys.argv[2:]
    for c in cards:
        if sel and not any(s.lower() in c["n"].lower() for s in sel): continue
        lines = generate(c)
        show(c, lines)
