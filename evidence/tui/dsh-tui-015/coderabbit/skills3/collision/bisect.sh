#!/usr/bin/env bash
# Binary-search the @deepseek-ai/* copy inside the npm-installed profile's node_modules for the package
# whose presence makes the headless boot collide on `send_message`. In-place: candidates are moved to
# `.<name>.off` for one boot and restored right after, so the tree is never left mutated.
set -u
REPO="/home/haroldzhao/MyProj/DshProj/My-Power-Dsh"
ROOT="$REPO/.qa-mcp-repro/inst"
N="$ROOT/profiles/headless/node_modules/@deepseek-ai"
restore() { for p in "$N"/.*.off; do [ -e "$p" ] || continue; b=$(basename "$p"); b=${b#.}; b=${b%.off}; mv "$p" "$N/$b"; done; }
mapfile -t CANDS < <(ls "$N")
echo "candidates(${#CANDS[@]}): ${CANDS[*]}"
round=0
while [ "${#CANDS[@]}" -gt 1 ]; do
  round=$((round+1))
  half=$(( ${#CANDS[@]} / 2 ))
  REMOVE=("${CANDS[@]:$half}")
  echo "== round $round: removing ${#REMOVE[@]} of ${#CANDS[@]}: ${REMOVE[*]}"
  for p in "${REMOVE[@]}"; do mv "$N/$p" "$N/.$p.off"; done
  bash "$REPO/.qa-mcp-repro/arm-probe.sh" "$ROOT" "bisect-r$round" > /dev/null 2>&1
  COL=$(grep -c "already registered" "$REPO/.qa-mcp-repro/bisect-r$round.log" 2>/dev/null); COL=${COL:-0}
  restore
  if [ "$COL" -eq 0 ]; then echo "   -> no collision: culprit IS in the removed half"; CANDS=("${REMOVE[@]}")
  else echo "   -> still collided: culprit is in the KEPT half"; KEEP=("${CANDS[@]:0:$half}"); CANDS=("${KEEP[@]}"); fi
done
echo "== final candidate: ${CANDS[0]}"
p="${CANDS[0]}"
mv "$N/$p" "$N/.$p.off"
bash "$REPO/.qa-mcp-repro/arm-probe.sh" "$ROOT" "bisect-final" > /dev/null 2>&1
FC=$(grep -c "already registered" "$REPO/.qa-mcp-repro/bisect-final.log" 2>/dev/null); FC=${FC:-0}
echo "final-removal collision-count=$FC exit-log:"; head -2 "$REPO/.qa-mcp-repro/bisect-final.log"
restore
echo "restored"
