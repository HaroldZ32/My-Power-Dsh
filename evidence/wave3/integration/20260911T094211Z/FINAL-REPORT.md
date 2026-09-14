# Wave-3 final report (t8 integration) — for a human reader

**Bottom line:** wave 3 is complete on a green, frozen tree. All 22 wave-2 carry-forward items are
accounted for: 20 closed (17 in code, 3 as process/documentation notes), 2 remain as **user
actions** that no agent may perform. Nothing is committed, pushed, tagged or released — the
three-wave work sits in ONE reconciled commit plan awaiting a human.

## What changed (three waves, uncommitted)

- **Wave 1 + 2** — session-workspace rooting across the plugin set, the verif lossless-JSON/gate-order
  fixes, the hashline schema fix, QA workspace isolation, B8 binary resolution in the MCP launchers,
  B9 installer row parity, and the first cut of the adopted agent-teams deltas.
- **Wave 3** — (A/B) the adopted-tooling registry redesign: regions are now addressed by a context
  PAIR measured on the region-stripped skeleton, so a strip-heal is exact under any insertion
  history (`tools.js` was 60 diff lines in wave 2, now 0); whole-line marker comparison kills the
  prefix-ambiguity misdiagnosis; the `agent_teams_update_task` diagnostics (missing `attempt_id` says
  REQUIRED, `status` is a REQUIRED parameter) — (C) the QA harness no longer manufactures its own
  pass (devPatch operand, its duplicate, the deprecated `.bin/sg` pins, real-HOME spawn, tight boot
  deadline, inert dual-track boot) with exactly ONE `skills/**` re-pin — (D/E) codegraph degrades
  instead of crashing on an unwritable `$HOME/.mpd`, and its project root no longer resolves at apply
  time from `process.cwd()`.

## What was verified, and by whom (all on disk under `evidence/`)

| Area | Verified by | Decisive evidence |
|---|---|---|
| Registry redesign, marker fix, diagnostics, F3 | **t5 (Lead, independent)** | strip BOTH adopted files from the same state → ONE heal → `tools.js` and `quality-gates.js` both 0 diff lines, sha-identical (3 rounds + CLI + partial history + a refusing negative control); marker fixtures 12/12; installed-harness boundary repro; mounted boot 14/14 tools / 0 crash signatures |
| QA-harness fidelity | t6 (independent verification) | `evidence/wave3/t6-verify/`, incl. the vendor re-pin audit |
| Codegraph degradation + O-1 | t6 | `evidence/wave3/codegraph-degrade-and-applytime/` |
| Adopted tooling + diagnostics | t7 review round 1 → t9 repair → **t10 review round 2 = PASS**, no regressions | `evidence/wave3/t7-review/20260911T092206Z/REVIEW-round2.md` |
| Everything above, re-checked independently | captain spot checks | `evidence/wave3/{t2,t9}-captain-independent-verification/` |

## Green snapshot (frozen tree, quoted raw in `raw/gate-*.log`)

```
repo dev @ 98680b1fb2bbf5c10c28cfbe44419e91595e1cb7   (nothing committed this session)
verify-vendor           exit 0   PASS (all assets OK)
bun run typecheck       exit 0
bun test packages       exit 0   376 pass / 0 fail / 2519 expect() calls / 82 files
bun run test:qa         exit 0   all self-tests passed
preset-conformance      exit 0   PASS + negative control (agent-preset/invalid: $.prefix missing)
dist sweep --clean-room exit 0   16 packages: 16 FRESH / 0 STALE, pass1==pass2 16/16, committed==pass2 16/16
npm run pack            exit 0   modes normalized: 1160 files (644: 1148, 755: 12), 0 non-conforming
                                 packed tree byte-identical to the working tree except the two BY-DESIGN
                                 packed-form rewrites (package.json manifest, relocated cordis.patch.yml)
                                 — 1158/1160 identical, incl. every launcher + skills/dsh-qa script
```

## What a human must do next (user-side actions)

0. **⚠ HEAD is currently BROKEN from a fresh clone** for the MCP rows and the vendor path: the
   tracked `packages/mpd-bundle/cordis.patch.yml` (lines ~50/~90) points at
   `packages/mpd-mcp-{astgrep,codegraph}/launch.mjs`, and the tracked `scripts/vendor-agent-teams.mjs:23`
   imports `./patch-agent-teams-fixes.mjs`, while those files (plus `mpd-mcp-shared/bin-resolve.mjs`,
   `lib/mpd-deltas.js`, `skills/dsh-qa/scripts/lib/workspace-isolation.mjs`, `scripts/verify-rows-parity.mjs`
   and the wave-3 tests) are UNTRACKED. Verify with
   `git cat-file -e HEAD:packages/mpd-mcp-astgrep/launch.mjs`. The commit plan stages every one of
   them; nothing works from a clean clone until it is executed.

1. **Restart `dsh`.** A live session keeps the plugin module it loaded at session start; the new
   `update_task` diagnostics and every adopted-plugin change act only after a restart (wave 3
   measured the stale-live-session case).
2. **Archive two isolation-control team records** in the AgentTeams tab:
   `mpd-default-0bc1738e` (captain `session-13638987-…`) and `mpd-default-587132ea` (captain
   `session-8954c880-…`) — both 11-member, 0-task staged records kept on purpose as negative controls.
3. **Fix `~/.mpd/mcp.env` if you source it.** It still pins
   `MPD_AST_GREP_SG_PATH=/root/dshProj/my-power-dsh/.toolchain/node_modules/.bin/sg`; that wrapper
   fails `--version` (exit 1 — measured), and the launcher's caller-pin-wins rule means B8's own
   resolution chain is skipped. Point it at `…/.bin/ast-grep` (exits 0, prints `ast-grep 0.45.3`) or
   delete the line.
4. **Execute the commit plan** (`commit-plan.md`): one branch from `dev`, ten atomic commits, the
   VENDOR_LOCK pairing rule honoured in commit 5 (exactly one re-pin), no push/tag/release. The plan
   is machine-checked: every one of the 1114 git-status paths is assigned or explicitly justified as
   non-committable.

## Honest notes

- **Live-LLM lanes are an EVIDENCE GAP, never a green.** This box has no LLM credential
  (`llm-deepseek: {}`, no env var, the credentials file holds only a browser-session record), so the
  live lanes of `dual-track-smoke`, `mcp-call` and `codegraph-smoke` could not run here; only their
  offline `--self-test` legs ran inside `bun run test:qa`. Re-run the live lanes on a credentialed
  machine before release.
- The `agent_teams_update_task` trailing-key loss is **model-side** and remains structurally
  unfixable inside the plugin; the REQUIRED `status` parameter makes it loud, and splitting a large
  payload avoids it. Stated, not hidden.
- Two wave-2 items were deliberately left open (low severity, outside the wave-3 groups):
  `agent_teams_setup` onboarding/roster provenance and the vendored `_deps/**` `.gitignore`.
- Later-measured defects that need their own scoped changes: R2 (legacy installer bypasses B8 and
  re-pins the deprecated `.bin/sg` wrapper), R5 (`dsh.hasTool` false for a working MCP tool at apply
  time), the `mpd-comment-checker` false-clean on a nonexistent path, and the
  `agent_teams_create_task` refusal of a legitimate repair. See `carry-forward.md` §3.
- A mounted boot, not `--dump-config`, is what proved plugin behaviour everywhere in this wave.
