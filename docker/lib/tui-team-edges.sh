#!/usr/bin/env bash
# Count connector arrowheads in the boxed graph, excluding the surrounding frame and legend.
team_graph_edges() {
  awk '
    /^[[:space:]]*│[[:space:]]*task dependency graph[[:space:]]*│[[:space:]]*$/ { graph=1; next }
    graph && /^[[:space:]]*│[[:space:]]*▼\/▸ blocker above/ { legend=1; exit }
    graph {
      row=$0
      sub(/^[[:space:]]*│/, "", row)
      sub(/│[[:space:]]*$/, "", row)
      if (row ~ /╭.*╮/) boxes=1
      if (boxes) pending += gsub(/▼/, "", row)
      if (row ~ /╰.*╯/) bounded=pending
    }
    END { print legend ? bounded+0 : 0 }
  ' "$1"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  [[ ${1:-} == --self-test ]] || exit 2
  set -euo pipefail
  positive='│ task dependency graph         │
│ ╭────────╮                    │
│ │ ● T1   │                    │
│ ╰──┬─────╯                    │
│    ▼                          │
│ ╭──┴─────╮                    │
│ │ ○ T2   │                    │
│ ╰────────╯                    │
│ ▼/▸ blocker above → dependent │'
  frame='┌───────────────────────────────┐
│ task dependency graph         │
│                               │
│                               │
│ ▼/▸ blocker above → dependent │
└───────────────────────────────┘'
  [[ $(team_graph_edges <(printf '%s\n' "$positive")) == 1 ]]
  [[ $(team_graph_edges <(printf '%s\n' "$frame")) == 0 ]]
  [[ $(team_graph_edges <(printf '%s\n' "${positive/    ▼/     }")) == 0 ]]
  echo 'PASS: connected nodes count one edge, frame-only and disconnected nodes both count zero'
fi
