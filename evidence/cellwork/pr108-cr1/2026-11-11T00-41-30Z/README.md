# PR #108 — CodeRabbit round 1, repair evidence

**Contract:** `.mpd/plans/pr-108-cr-round1.md` (FROZEN 2026-11-11 by the captain).
**Repaired verdict:** `rec-20261111T003404-c37d51` (FAIL: R1-01 evidence artifact, R1-02 frozen acceptance text,
R1-03 stale role warning, R1-04 missing unverified fallback).
**Captured:** 2026-11-11T00-41-30Z, branch `feature/cellwork-elastic-planning`, working tree.
**Scope:** evidence, prose and the two docs ONLY. No behaviour code was changed; every source revert below was
restored in the same loop and the seven touched source files hash back to their pre-round values (`sha256.txt`).

## Layout

| Path | Holds |
|---|---|
| `result.json` | machine-readable record: per finding `{site, revert, red_exit, red_snippet, sha_before, sha_after_restore, green_exit}` plus the gate table and the declared bounds |
| `reverts/<id>/` | the exact byte blocks of one revert: `before-N.txt` (fixed text removed), `after-N.txt` (pre-fix text restored), `spec.json`, `fixed.snapshot` (byte-exact copy taken before the first apply) |
| `reverts/apply.mjs` | the reproducible driver: `node apply.mjs reverts/<id> apply\|restore\|check` (exact-count replacement; restore asserts the baseline sha256) |
| `reverts/revert-hashes.jsonl` | fixed and reverted sha256 per finding, recomputed from the spec + snapshot |
| `diffs/<id>.revert.diff` | `diff -u` of the fixed snapshot against the reverted file — the literal thing that was reverted |
| `logs/<id>.red.log` / `logs/<id>.green.log` | the arm's output before and after the restore (`cr7-armA` / `cr7-armB` are the two CR7 arms; `cr1.probe.log` is the documentation probe) |
| `logs/EXITS.txt` | every arm's exact command with the exit code observed at the shell (red and green), plus the six gate exits |
| `gates/*.log` | the six gate runs quoted in `result.json` |
| `git-status-before.txt` / `git-status-after.txt` | the workspace status at the start and the end |
| `sha256.txt` | the seven source hashes (identical) and the two deliberately changed docs |

## Behavioural findings — RED then GREEN, with the restore's sha256

| Finding | Site | RED arm (exit 1) | Restore sha256 = baseline | GREEN |
|---|---|---|---|---|
| CR2 | `activate.ts` `materializeSplit` board resolution | `expect(result.ok).toBe(true)` → `Received: false` (`elastic-seats.test.ts:1017`) | `e4a13bb5…` | exit 0 |
| CR3 | `activate.ts` skipped cancel rows | `expect(closed.ok).toBe(true)` → `Received: false` (`elastic-seats.test.ts:1158`) | `e4a13bb5…` | exit 0 |
| CR5 | `flow.ts` `planningTeamId` write | `Expected: "team-planning"`, `Received: "team-dead"` (`flow.test.ts:928`) | `7d75e189…` | exit 0 |
| CR6 | `protocol.ts` unfence board resolution | `unfenced:false reason:"not-fenced"` instead of `unfenced:true plane:"unfenced"` (`elastic-seats.test.ts:442`) | `3c7c8554…` | exit 0 |
| CR7 arm A | `protocol.ts` growth merge | `members.Reviewer?.fenced` → `Received: undefined` (`elastic-seats.test.ts:482`) | `3c7c8554…` | exit 0 |
| CR7 arm B | `protocol.ts` unreadable record | `expect(answer.ok).toBe(false)` → `Received: true` (`elastic-seats.test.ts:494`) | `3c7c8554…` | exit 0 |
| CR11 | `team-core/index.ts` journal write | `EISDIR` at `team-journal.ts:100` reached from `src/index.ts:2140`; the member was never raised | `216fa5e2…` | exit 0 |

Each row's full revert is `diffs/<id>.revert.diff`, its output is `logs/<id>.red.log` / `logs/<id>.green.log`, and
the reverted-state hash is in `reverts/revert-hashes.jsonl`.

## Text / absence assertions — fail-before by construction

These four are not behaviour switches; the pre-fix bytes themselves are the falsifier. CR8/CR9/CR10 were still
driven through a real RED run by restoring the pre-fix text; CR1 has no repository test or gate (verify:docs checks
pairs, heading trees and links, never prose), so its executable probe is the contract's literal sentence.

| Finding | Site | Fail-before | RED → GREEN |
|---|---|---|---|
| CR1 | `docs/cellwork.md:358` | the missing conjunction ("a hazard **that** cell mode does not"); HEAD bytes lack the sentence | normalized exact-string grep: HEAD **0 matches, exit 1** → working tree **1 match, exit 0** (`logs/cr1.probe.log`) |
| CR8 | `staging.ts` `plannerPrompt` | the "ALREADY running" paragraph was unconditional at `analysts=0` | `expect(prompt).not.toContain("cell-analyst")` fails (`planning-fanout.test.ts:408`), exit 1 → exit 0 |
| CR9 | `team-core/index.ts:87` | the specifier was `"./team-journal"`; both spellings resolve, so only a source assertion can pin it | source `toContain` fails (`c74-midrun-and-binding.test.ts:350`), exit 1 → exit 0 |
| CR10 | `team-core/index.ts:2138` | the old sentence said "cannot match it by role"; the description head and member name also participate | `Expected to contain: "may not match a role route"` (`…:307`), exit 1 → exit 0 |

## R1-03 — the role-omitted warning, both languages

`docs/cellwork.md` (end of "Members: staged, activated or adopted"):

> A mid-run `add_member` that carries NO `role` is legal but the answer WARNS (one sentence) that the seat may not
> match a role route — resolution also reads the description head and the member name, and neither is guaranteed —
> in which case it inherits the calling session's route; passing `role` is still recommended.

`docs/cellwork.zh-CN.md` (same section):

> 运行中的 `add_member` **不带 `role`** 是合法的，但答复会**警告**（一句话）：该座位**可能**匹配不到角色路由
> （路由解析还会读描述头与成员名，而两者都不保证匹配）——**届时**才继承调用会话的路由；仍建议传 `role`。

No `packages/*/README*.md` carries the sentence: a grep for `cannot be matched by role` / `无法按角色匹配路由`
across `docs/`, `packages/`, `skills/` and `AGENTS.md` (dist excluded) returns no hit.

## R1-04 — the fifth state of board resolution, both languages

`docs/cellwork.md` ("The board the cell is working on") gains:

> **The fifth state is an UNVERIFIED fallback, and only a RE-SPLIT takes it.** When all four steps resolve NOTHING
> and the record's `teamId` is non-empty, a re-split still continues on the RECORDED id — an old cell may name a
> board no seam can read any more, and refusing it would strand work that is otherwise resumable — but the id is
> TRUSTED, never verified: the answer carries `boardNote` saying so, the same fact is journaled
> (`boardResolution: "unverified"`), and the note prints the recorded id and, when the resolver saw another
> candidate, that id too — so both ids are visible. The note is ADVISORY, not a refusal: it says work is appended
> to that record only, it never tells the operator to run `cellwork_start` (a team id IS recorded), and an operator
> who sees it should not start a new cell. An INITIAL activation never takes this path (it has no minted ids to
> verify the record against), and a re-split with NO recorded id still refuses with the `cellwork_start`
> instruction.

`docs/cellwork.zh-CN.md` (「这个 cell 正在用哪块看板」) carries the same paragraph in 简体中文.

## Gates (all exit 0)

| Gate | Observed |
|---|---|
| `bun run typecheck` | `$ tsgo --noEmit`, exit 0 |
| `bun run verify:comments` | 632/632 TypeScript files; `VERDICT: PASS` |
| `bun run verify:docs` | `pairs=59 failed=0 violations=0 links=626 dead=0 — PASS` |
| `bun test packages/mpd-cellwork-plugin` | 369 pass / 0 fail / 3612 expect() / 33 files |
| `bun test packages/mpd-team-core-plugin` | 637 pass / 0 fail / 3130 expect() / 45 files |
| `node scripts/verify-dist-fresh.ts` | `ok: 34/34 targets fresh`, bun 1.4.0 from `.toolchain`, 1 NOT COVERED file listed |

## Integrity

`git status --porcelain` differs from the start of the round by exactly two entries: `M docs/cellwork.zh-CN.md`
(the second half of tasks 2 and 3) and `?? evidence/cellwork/pr108-cr1/` (this artifact). All seven source files
hash to their pre-round values (`sha256.txt`). No commit was made — the captain is the only git writer.

## Reproduce

```sh
# one finding: revert, observe, restore (restore asserts the baseline sha256 and exits 2 on drift)
node evidence/cellwork/pr108-cr1/<ts>/reverts/apply.mjs evidence/cellwork/pr108-cr1/<ts>/reverts/cr2 apply
bun test packages/mpd-cellwork-plugin/test/elastic-seats.test.ts -t "a re-split that resolves no team"
node evidence/cellwork/pr108-cr1/<ts>/reverts/apply.mjs evidence/cellwork/pr108-cr1/<ts>/reverts/cr2 restore
```

## Declared bounds

- **CR1 has no automated assertion.** No repository test or gate reads this prose; the evidence is the frozen
  contract's literal sentence probed against HEAD bytes and the working tree, plus the diff. `verify:docs` is green
  before and after the sentence (it checks structure, not wording), so it is not cited as CR1's proof.
- **The reverts are exact-string replacements, not whole-file checkouts,** because `activate.ts` (CR2+CR3),
  `protocol.ts` (CR6+CR7) and `team-core/index.ts` (CR9+CR10+CR11) each carry more than one finding. The CR6
  revert keeps `let current: CellState` (HEAD had `const`) so the CR7 fix still type-checks: it is a CR6-only revert,
  and the diff says so.
- **CR4 is DECLINED** by the frozen contract and untouched; no evidence exists for it by design.
- **Test runner:** the arms ran with `bun` 1.4.2 from `PATH` (the documented `bun test` command); the pinned
  `.toolchain` bun 1.4.0 is used only inside `verify-dist-fresh`'s rebuild, as that gate reports itself.
- **What this does not prove:** that PR #108 is mergeable. CodeRabbit round 1 still has to be reconciled in the PR
  as FIXED / STALE / STILL-VALID, and the independent verifier's PASS is a separate record.
