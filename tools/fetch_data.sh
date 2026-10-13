#!/usr/bin/env bash
# Downloads the data the deck builder needs into tools/data/ (about 2.5 MB).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p data
for f in a b c d e; do
  curl -fsSL -o "data/$f.tsv" "https://raw.githubusercontent.com/lichess-org/chess-openings/master/$f.tsv"
done
curl -fsSL -o data/gm2001.bin "https://raw.githubusercontent.com/gmcheems-org/free-opening-books/main/books/bin/gm2001.bin"
curl -fsSL -o data/performance.bin "https://raw.githubusercontent.com/niklasf/python-chess/master/data/polyglot/performance.bin"
ls -la data
