#!/usr/bin/env bash
# Does the DELIVERED revision reproduce analysis/overlap-final.log?
# Selects the same 20 pairs (9 declared persona/seed + 11 persona/pre-wave-D) out of
# analysis/overlap-matrix.log — measured against the sha256 pinned in analysis/persona-hashes-start.tsv —
# and diffs them against the original log. An EMPTY diff is the binding: the final log's numbers belong
# to the bytes that are on disk now.
#
# Run from the REPOSITORY ROOT:  bash evidence/de-omo/personas/20261008T163931Z/analysis/reproduce-final-log.sh
set -uo pipefail

[ -f AGENTS.md ] || { echo "run from the repository root" >&2; exit 2; }

P=evidence/de-omo/personas/20261008T163931Z
DECLARED=(
  "oracle.md|anthropics__claude-plugins-official/plugins/code-modernization/agents/architecture-critic.md"
  "librarian.md|voltagent__awesome-claude-code-subagents/categories/10-research-analysis/research-analyst.md"
  "prometheus.md|gsd-build__gsd-2/src/resources/agents/planner.md"
  "hephaestus.md|gsd-build__gsd-2/src/resources/agents/worker.md"
  "sisyphus.md|voltagent__awesome-claude-code-subagents/categories/01-core-development/fullstack-developer.md"
  "atlas.md|voltagent__awesome-claude-code-subagents/categories/09-meta-orchestration/multi-agent-coordinator.md"
  "explore.md|jayminwest__overstory/agents/scout.md"
  "metis.md|obra__superpowers/skills/requesting-code-review/code-reviewer.md"
  "momus.md|VeryGoodOpenSource__vgv-wingspan/skills/shared/references/plan-review.md"
)

: > "$P/analysis/reproduced-final-pairs.txt"
for pair in "${DECLARED[@]}"; do
  per="${pair%%|*}"
  ref="${pair#*|}"
  grep -F "packages/mpd-roles-plugin/personas/$per vs $P/seeds/$ref: " "$P/analysis/overlap-matrix.log" \
    >> "$P/analysis/reproduced-final-pairs.txt"
done
grep -F "vs $P/analysis/old-" "$P/analysis/overlap-matrix.log" >> "$P/analysis/reproduced-final-pairs.txt"

diff -u <(grep 'longest shared word run' "$P/analysis/overlap-final.log" | sort) \
        <(sort "$P/analysis/reproduced-final-pairs.txt") \
        > "$P/analysis/overlap-final-vs-matrix.diff"

pairs=$(wc -l < "$P/analysis/reproduced-final-pairs.txt")
if [ -s "$P/analysis/overlap-final-vs-matrix.diff" ]; then
  echo "DIFFERS — the delivered revision does NOT reproduce overlap-final.log ($pairs pairs); see analysis/overlap-final-vs-matrix.diff"
  exit 1
fi
echo "IDENTICAL — all $pairs pairs in overlap-final.log reproduce byte-for-byte on the pinned hashes"
