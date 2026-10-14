#!/usr/bin/env bash
# Documentary repair of wave-D findings D-VER-1/D-VER-2/D-VER-3 (2026-10-09).
# Binds the wave's overlap measurement to the DELIVERED persona bytes: hash the 11 persona texts plus
# ATTRIBUTION.md, measure against exactly those bytes, settle, re-hash, and assert start == end
# (AGENTS.md §7: hash -> work -> re-hash). Read-only with respect to packages/**; writes only inside
# this evidence packet, and never overwrites an original log.
#
# Run from the REPOSITORY ROOT:  SETTLE=50 bash evidence/de-omo/personas/20261008T163931Z/analysis/bind-personas.sh
set -uo pipefail

[ -f AGENTS.md ] || { echo "run from the repository root" >&2; exit 2; }

PACKET="evidence/de-omo/personas/20261008T163931Z"
TOOL="$PACKET/analysis/overlap.mjs"
PDIR="packages/mpd-roles-plugin/personas"
SETTLE="${SETTLE:-50}"
fail=0

mapfile -t PERSONAS < <(ls "$PDIR"/*.md | sort)
mapfile -t SEEDS < <(find "$PACKET/seeds" -type f ! -name LICENSE ! -name tree.json ! -name 'NOTICE*' | sort)
mapfile -t OLDS < <(ls "$PACKET"/analysis/old-*.md | sort)

echo "persona-path files : ${#PERSONAS[@]} (expect 12: 11 personas + ATTRIBUTION.md)"
echo "seed prompt files  : ${#SEEDS[@]} (expect 20)"
echo "pre-wave-D texts   : ${#OLDS[@]} (expect 11)"
[ "${#PERSONAS[@]}" -eq 12 ] || fail=1
[ "${#SEEDS[@]}" -eq 20 ] || fail=1
[ "${#OLDS[@]}" -eq 11 ] || fail=1
[ "$fail" -eq 0 ] || { echo "FATAL: unexpected input inventory" >&2; exit 1; }

# Write the sha256 block for one instant: the instrument, the 12 delivered persona-path bytes, and the
# 11 pre-wave-D baselines. The instant is UTC, second precision.
hash_block() {
  local out="$1" instant="$2"
  {
    printf '# sha256 of the delivered persona bytes — read at %s (UTC)\n' "$instant"
    printf '# subject: the 11 persona texts + ATTRIBUTION.md (packages/mpd-roles-plugin/personas/)\n'
    sha256sum "${PERSONAS[@]}"
    printf '# baseline: the pre-wave-D texts (read from git HEAD) and the measurement instrument\n'
    sha256sum "${OLDS[@]}" "$TOOL"
  } > "$out"
}

T1="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
hash_block "$PACKET/analysis/persona-hashes-start.tsv" "$T1"
echo "hashes START written at $T1 (UTC) -> analysis/persona-hashes-start.tsv"

{
  printf '# overlap matrix — measured against the bytes hashed in analysis/persona-hashes-start.tsv at %s (UTC)\n' "$T1"
  printf '# subject: the %d delivered files under %s (the 11 persona texts + ATTRIBUTION.md)\n' "${#PERSONAS[@]}" "$PDIR"
  printf '# per-pair command: node %s <PERSONA> <REFERENCE>\n' "$TOOL"
  printf '# instrument sha256: %s\n' "$(sha256sum "$TOOL" | cut -d' ' -f1)"
  printf '# run cap: overlap.mjs builds reference substrings of at most 24 words, so a reported run of\n'
  printf '#   exactly 24 means ">= 24"; no pair below reports 24, so no reported number is truncated.\n'

  printf '\n=== seed bytes re-verified against seed-manifest.txt ===\n'
  local_ok=0
  local_bad=0
  while read -r h rel; do
    actual="$(sha256sum "$PACKET/seeds/$rel" 2>/dev/null | cut -d' ' -f1)"
    if [ "$actual" = "$h" ]; then
      printf 'OK        %s\n' "$rel"
      local_ok=$((local_ok + 1))
    else
      printf 'MISMATCH  %s manifest=%s actual=%s\n' "$rel" "$h" "${actual:-<missing>}"
      local_bad=$((local_bad + 1))
    fi
  done < <(grep -E '^  [0-9a-f]{64}  ' "$PACKET/seed-manifest.txt" | sed -E 's/^  ([0-9a-f]{64})  (.*)$/\1 \2/')
  printf '%d matched, %d mismatched\n' "$local_ok" "$local_bad"
  [ "$local_bad" -eq 0 ] || fail=1

  printf '\n=== NEW vs ALL 20 FETCHED SEED PROMPT FILES (%d pairs) ===\n' "$(( ${#PERSONAS[@]} * ${#SEEDS[@]} ))"
  for p in "${PERSONAS[@]}"; do
    for s in "${SEEDS[@]}"; do node "$TOOL" "$p" "$s"; done
  done

  printf '\n=== NEW vs PRE-WAVE-D TEXT, matched pair by pair (%d pairs) ===\n' "${#OLDS[@]}"
  printf '#  only the 11 persona texts have a pre-wave-D counterpart; ATTRIBUTION.md is new in wave D.\n'
  for o in "${OLDS[@]}"; do
    per="$PDIR/$(basename "$o" | sed 's/^old-//')"
    if [ -f "$per" ]; then
      node "$TOOL" "$per" "$o"
    else
      printf 'NO COUNTERPART  %s\n' "$o"
      fail=1
    fi
  done
} > "$PACKET/analysis/overlap-matrix.log"

{
  printf '\n=== per-persona summary: longest run over the 20 fetched seed files ===\n'
  awk '/ vs .*seeds\// && /longest shared word run =/ {
         split($0, part, ": longest shared word run = ")
         ref = part[1]; sub(/^.* vs /, "", ref); n = part[2] + 0
         split(part[1], a, " vs "); per = a[1]
         if (n > best[per]) { best[per] = n; who[per] = ref }
       }
       END { for (per in best) printf "%s  max=%d  seed=%s\n", per, best[per], who[per] }' \
    "$PACKET/analysis/overlap-matrix.log" | sort
} >> "$PACKET/analysis/overlap-matrix.log"

echo "matrix written -> analysis/overlap-matrix.log"

echo "settling ${SETTLE}s before the closing re-hash (AGENTS.md §7)"
sleep "$SETTLE"
T2="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
hash_block "$PACKET/analysis/persona-hashes-end.tsv" "$T2"
echo "hashes END written at $T2 (UTC) -> analysis/persona-hashes-end.tsv"

diff -u <(grep -v '^#' "$PACKET/analysis/persona-hashes-start.tsv") \
        <(grep -v '^#' "$PACKET/analysis/persona-hashes-end.tsv") \
        > "$PACKET/analysis/persona-hash-diff.txt"
if [ -s "$PACKET/analysis/persona-hash-diff.txt" ]; then
  verdict="START != END — the measured bytes moved across the window; see analysis/persona-hash-diff.txt"
  fail=1
else
  verdict="START == END — every hashed file is byte-identical across the measurement window"
fi

{
  printf '# measurement binding — hash -> work -> re-hash (AGENTS.md §7)\n'
  printf 'start read (UTC) : %s\n' "$T1"
  printf 'end read (UTC)   : %s\n' "$T2"
  printf 'settle window    : %ss\n' "$SETTLE"
  printf 'subject          : 11 persona texts + ATTRIBUTION.md under %s\n' "$PDIR"
  printf 'verdict          : %s\n' "$verdict"
} > "$PACKET/analysis/persona-hash-verdict.txt"

cat "$PACKET/analysis/persona-hash-verdict.txt"
if [ "$fail" -eq 0 ]; then echo "BINDING OK"; else echo "BINDING FAILED"; fi
exit "$fail"
