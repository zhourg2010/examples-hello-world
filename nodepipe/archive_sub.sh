#!/bin/bash
# Archive the raw subscription content daily. Never deletes. For manual lookup of old nodes.
source ~/nodepipe/env
DIR="$HOME/nodepipe/archive"
mkdir -p "$DIR"
TS=$(date +%Y%m%d_%H%M)
OUT="$DIR/sub_${TS}.txt"
if curl -m 30 -s "$SUB_URL" -o "$OUT" && [ -s "$OUT" ]; then
  echo "$(date '+%F %T') archived: $OUT ($(wc -l < "$OUT") lines)" >> "$HOME/nodepipe/logs/archive.log"
else
  echo "$(date '+%F %T') archive FAILED" >> "$HOME/nodepipe/logs/archive.log"
  rm -f "$OUT"
fi
