#!/usr/bin/env bash
# Census: prints each `## N. <Title>` heading of AGENTS.md with the byte size of its body.
# usage: bash census.sh [file]   (default AGENTS.md)
f="${1:-AGENTS.md}"
awk -v F="$f" '
  /^## / { if (h != "") printf "%-46s %7d B\n", h, n; h=$0; n=0; next }
  { if (h != "") n += length($0)+1 }
  END { if (h != "") printf "%-46s %7d B\n", h, n }
' "$f"
echo "-----"
awk '/^## /{h=$0} {n+=length($0)+1} END{printf "TOTAL(with-line-counted) %d B\n", n}' "$f"
