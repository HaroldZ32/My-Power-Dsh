#!/bin/sh
# Re-runnable residue gate. The identifier tokens are supplied at run time via $TOK
# (a pipe-separated ERE) so this artifact never re-embeds a withdrawn name.
# Usage: TOK='<tokens>' sh scan.sh
[ -n "$TOK" ] || { echo "set TOK to the identifier ERE"; exit 2; }
echo "== tracked =="; git grep -inE "$TOK" -- . | grep -viE 'apple silicon' | wc -l
echo "== non-ignored worktree =="; git ls-files --cached --others --exclude-standard | xargs -r grep -inE "$TOK" 2>/dev/null | grep -viE 'apple silicon' | wc -l
