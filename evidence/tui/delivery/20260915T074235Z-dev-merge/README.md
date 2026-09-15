# The DSH-TUI edition lands on `dev`

| | |
|---|---|
| Branch | `dev` |
| Merge commit | `07f2846` — `merge: the DSH-TUI edition into dev` (`--no-ff`, per AGENTS.md §5) |
| Merged from | `feature/tui-edition` (`ef3e581`, containing `145dfde` + `ef3e581`) |
| Tree | `1d19bea8c10205a9644ffc88e6d3089b13cc7666` — **identical** to the feature tip's tree, so the merge changed no bytes |
| Pre-merge `dev` | `c582254` (= `origin/dev` at the time) |

## Gates on the merged branch (not inherited — re-run)

| Gate | Result | Raw |
|---|---|---|
| `node scripts/verify-vendor.mjs` | **PASS** — `asset OK: skills 307 files`, all six assets OK | `raw/merge-verification.log` |
| `bun run test:qa` | **all self-tests passed**, exit 0 | `raw/test-qa-on-dev.log` |

The pre-merge gate sweep (typecheck, `bun test packages` 547/0, R4/R5/R6/R7/R8/R11, installer dry-run,
citation check) is recorded at `evidence/tui/delivery/20260915T072355Z/README.md`; it was measured on the
same tree hash, which is why it is not repeated here.

## Push state

`git push origin dev` was attempted and **refused by the remote for lack of credentials**:

```
fatal: could not read Username for 'https://gitee.com': terminal prompts disabled
```

No credential helper is configured in this checkout, so the push is the user's to complete
(`git push origin dev`, or configure a helper/token). The merge itself is local and verified; nothing
else in this wave depends on the remote.
