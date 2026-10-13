import sys, chess
from book import GM, PF, shares, key, NAMES
def tree(prefix, depth, width=3, gm_min=8, pf_min=15, indent=0):
    b = chess.Board()
    for m in prefix.split(): b.push_san(m)
    _walk(b, depth, width, gm_min, pf_min, indent)
def _walk(b, depth, width, gm_min, pf_min, indent):
    if depth == 0: return
    g, p = shares(GM, b), shares(PF, b)
    cand = sorted(set([s for s,v in g.items() if v>=gm_min]) | set([s for s,v in p.items() if v>=pf_min]), key=lambda s: -(g.get(s,0)*2+p.get(s,0)))[:width]
    for s in cand:
        num = f"{b.ply()//2+1}{'.' if b.turn else '...'}"
        b2 = b.copy(); b2.push_san(s)
        nm = NAMES.get(key(b2))
        print("  "*indent + f"{num}{s} ({g.get(s,'-')}/{p.get(s,'-')})" + (f"   [{nm[1]}]" if nm else ""))
        _walk(b2, depth-1, width if indent < 1 else 1, gm_min, pf_min, indent+1)
if __name__ == "__main__":
    tree(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]) if len(sys.argv)>3 else 3)
