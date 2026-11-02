# W4-A5 — review-bot round cap (3 rounds per PR, a 4th needs the user) in `AGENTS.md` §5

Lane: Senior Engineer (board row T24). Contract: `.mpd/plans/autoproject-refactor.md` §10 item A5 — the
last of the six superagent adoptions, and deliberately PROSE, not code.

## 1. The rule added (read back from `AGENTS.md` §5, under the existing CodeRabbit bullet)

> - **Round cap — at most THREE rounds per pull request, binding (user-set, 2026-11-02).** Each
>   automated reviewer (CodeRabbit today, any future bot) gets at most three review rounds on ONE pull
>   request. A FOURTH round needs the USER's explicit decision, and the PR says that the cap was raised
>   and why; the wave also records how many rounds each automated reviewer took in the PR body. Inside a
>   round: a finding already fixed and verified is resolved SILENTLY (no reply needed), and a declined
>   one gets ONE sentence saying why. The cap is what stops a bot that always finds something new from
>   looping forever; it does NOT relax the wait rule above — a round still has to COMPLETE before merge,
>   and an unfinished round is still not a pass.

It EXTENDS the `Wait for CodeRabbit before merging` bullet rather than adding a sibling, so the wait
rule and its termination rule are read together; the last sentence states that the cap composes with the
wait rule instead of replacing it. No gate was added (A5 says prose only).

## 2. Instruction budget (binding, §3) — before / after

| measurement | bytes |
|---|---|
| before (`AGENTS.md` at task start, identical to `HEAD`) | **63,478** |
| after | **63,136** |
| cut (`agent-instructions.config.maxBytes`) | 65,536 |
| margin after | **2,400** (≥ 2,048 required ✓) |
| historical target ≤ 65,024 | ✓ |

The file was ALREADY only 2,058 bytes under the cut — 10 bytes above the 2 KB floor — so adding the
bullet without moving anything would have breached the margin. **MOVE-FIRST was therefore required, and
was performed BEFORE the addition:**

- §5 rule 5 ("The board has terminal verbs…") was shortened from **2,405 → 1,291 bytes (−1,114)** with
  a SHORT definition plus an exact pointer; every binding sentence stayed in the manual (the tool
  semantics, the owner-only pairing rule, "one git writer is PROSE since 2026-10-17 and still binding",
  and "the five official authoring verbs are REFUSED at the tool boundary").
- Its long form moved to a NEW `agent-references/git-model.md`: the withdrawn `installVerifyGuard`
  hook's command list (the RULE, not a matcher), how a session is classified child-vs-captain, where
  the tool-boundary closure STOPS (a row calling the team service directly is not gated), and the
  board's terminal-verb/declared-owner detail. Registered as a row in `agent-references/index.md`
  (agent-facing, English-only — no `*.zh-CN.md` twin, and `verify:docs` does not discover that band).

Net: −1,114 (moved) + 772 (the new bullet) = −342 bytes, so the manual ends SMALLER than it started
while gaining the rule.

## 3. The PR template (step 4)

`.github/PULL_REQUEST_TEMPLATE.md` EXISTS and is bilingual. It did not restate the merge rules, but it
is where a PR body's shape is pinned — and the new rule says the PR body RECORDS the round count — so
it gained one section in BOTH languages, in the same change:

- EN `### Automated reviewer rounds` — `- CodeRabbit rounds: \`<n>\` of 3 — <where the reconciliation lives; say so here if the cap was raised and why>.` with a comment citing §5.
- zh `### 自动评审轮次` — the same line in 简体中文.

No other template exists (`find .github -name '*PULL_REQUEST*'` → only this file).

## 4. Observed results

| command | result |
|---|---|
| `node scripts/verify-manual-paths.ts` | **exit 0** — `PASS resolved=153 over-report=73 under-report=83 declared=2 (every audited path exists; …)` — the new pointer `agent-references/git-model.md` resolves — `verify-manual-paths.log` |
| `node scripts/verify-docs-parity.ts` | **exit 0** — PASS (untouched by this change; `agent-references/**` is out of discovery and `.github/` is out of it too) — `verify-docs.log` |
| `wc -c AGENTS.md` | 63,478 → **63,136** — `budget.log` |

## 5. Files touched

1. `AGENTS.md` (the round-cap bullet in §5; rule 5 shortened with the pointer)
2. `agent-references/git-model.md` (NEW — the moved long form)
3. `agent-references/index.md` (register row for the new file)
4. `.github/PULL_REQUEST_TEMPLATE.md` (the round-count section, EN + zh)

No package source, no `skills/**`, no dist, no git.

## 6. What I deliberately did NOT add

- **No new GATE.** A5 says prose only, and a merge-workflow rule has no mechanical subject; a gate here
  would either be vacuous or start policing PR bodies it cannot see.
- **No zh twin for `AGENTS.md`/`agent-references/**`.** Both are agent-facing, English-only by the
  language policy; a `*.zh-CN.md` twin would be a policy violation, not a kindness.
- **No `.gitignore`/`.github` workflow change.** The cap is a human/agent decision rule, not something
  CI can enforce (the repo has no automated PR-body checker, and adding one is not in A5).
- **No restatement of the per-round reconciliation procedure** — the existing CodeRabbit bullet already
  owns it (FIXED / STALE / STILL-VALID with file:line evidence); the cap only adds the stopping rule.

## 7. What I could not prove

- No test exists or was added for this change by design (prose rule). The evidence is the byte
  measurement, the path gate and the read-back above.
- The PR-template edit is not gated by anything (`verify:docs` does not discover `.github/`), so it is
  verified by reading it.
