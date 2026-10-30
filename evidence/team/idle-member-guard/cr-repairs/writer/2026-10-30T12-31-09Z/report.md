# P2a CodeRabbit repair (PR #81) — writer report

**Row:** T12 (repair). **Contract:** `.mpd/plans/team-idle-member-guard-cr-repairs.md` (FROZEN
2026-10-30). **Branch:** `fix/team-idle-member-guard`. No commit, no dist rebuild, no re-pin (all three
are the captain's per the contract).

## 1. FIXED / STALE table (every finding reconciled)

| # | Comment | Path | Triage | Change / reason |
|---|---|---|---|---|
| D1 | 4423513833 | `idle-guard.ts` imports | **STALE** | AGENTS.md §6: `packages/*/src` is built by `bun build` and uses **extensionless specifiers** ("differs in FORM only"); every neighbour in the package does the same (`index.ts` imports `./team-store`, `./dispatch`, `../../mpd-dsh-adapter-plugin/src/index`). Changing these would break the convention the package is built under, not fix a defect. |
| D2 | 4423513857 (Major) | `idle-guard.ts` / `index.ts` dispatch | **FIXED** | A counted DISPATCH WINDOW: `IdleGuard.beginDispatch(sessionId)` opens before the executor send (which cold-resumes the child), and `agent_teams_dispatch` holds it around the WHOLE pairing (send → re-read → compare-and-set), releasing in `finally`. Inside a window the pre-step neither marks nor injects, and the tool guard does not deny; a genuinely taskless member never enters one and keeps the hard denial. Both-way re-evaluation is unchanged. |
| D3 | 4423513869 | `idle-guard.ts` pre-step return | **FIXED** | The listener now preserves the downstream decision: `kind:"reject"` is returned UNCHANGED (no directive injected into a step that will not run), a kind-less decision defaults to `enter`, and the directive is appended only on an `enter`. |
| D4 | 4423513905 | `index.ts` import | **STALE** | Same §6 citation as D1. |
| D5 | 4423513922 (Trivial) | `test/idle-guard.test.ts` | **FIXED** (coverage) | New focused arm: `dsh.guardTool` throws → `installIdleGuard` does not throw, the row log carries "could not install its tool guard", and the guard stays usable. The catch pre-dates this repair, so this arm is GREEN before and after — stated honestly (it is a falsifier, not a red-first fix). |
| D6 | 4423513932 (Trivial) | `skills/dsh-qa/scripts/team-idle-member-guard.ts` | **FIXED** | The live stub's main script now issues a `read` attempt BEFORE its text step, and `evaluateIdle` asserts the harness-recorded RESULT is an ERROR carrying the guard's one-line denial (the "zero tool/call rows" requirement is gone — it passed even with the guard removed). Exactly-one-directive stays. The `--self-test` gained three negatives (no attempt / attempt succeeded / wrong denial text) and is **12 arms green**. |
| D7a | 4423513946 (Minor) | `skills/dsh-qa/SKILL.md` | **FIXED** | The two credential-path references SkillSpector named (lines 86 and 130 of the reviewed tree) now read `<credentials-file>` with an explicit "placeholder — never a real credential file" note. |
| D7b | 4423513946 (b) | history | **STALE** | "Squash the second re-pin" is a HISTORY suggestion: the branch is published, and AGENTS.md §5 forbids rewriting a published branch. The captain records the disposition in the PR; this repair edits `skills/**` again, so the captain's single `repin-vendor --write --i-know-this-is-the-captains-step` after these edits are tracked is the one correct final re-pin. |

## 2. Changed paths + symbols

| Path | Change |
|---|---|
| `packages/mpd-team-core-plugin/src/idle-guard.ts` | `IdleGuard.beginDispatch` (counted window), `dispatching` map, window check in the pre-step listener + in the tool guard, D3 kind preservation |
| `packages/mpd-team-core-plugin/src/index.ts` | `agent_teams_dispatch`'s pair loop: `idleGuard.beginDispatch(pair.memberId)` around `send` → re-read → `casClaimTask`, released in `finally` |
| `packages/mpd-team-core-plugin/test/idle-guard.test.ts` | 6 new arms: 3 × D2 window (basic / overlapping counts / pre-marked cleared), 2 × D3 (reject preserved, kind-less → enter), 1 × D5 (throwing `guardTool`) |
| `packages/mpd-team-core-plugin/test/dispatch-idle-order.test.ts` **NEW** | 3 row-level D2 arms: the cold-resumed child's pre-step inside `send` is not marked/denied; a genuinely taskless member still gets the directive + denial; after the pass the member's own next step is clear. The seeded task is UNOWNED on purpose — a plan-time owner would already be open at send time (§6.4) and the arm would pass against the broken code. |
| `packages/mpd-team-core-plugin/README.md` + `README.zh-CN.md` | one bullet in the idle-guard section: a member being dispatched is never marked (the window, and why) — EN/ZH parity |
| `skills/dsh-qa/scripts/team-idle-member-guard.ts` | D6 as above (stub script, `evaluateIdle`, 12-arm self-test) |
| `skills/dsh-qa/SKILL.md` | D7a placeholders |

D1/D4: no change (STALE, §6).

## 3. Commands and observed results (`gates.log` in this directory)

| Command | Result |
|---|---|
| `bun test packages/mpd-team-core-plugin` | **393 pass / 0 fail** (27 files; +6 idle-guard arms, +3 new file) |
| `bun run typecheck` | **clean** |
| `bun run verify:comments` | **PASS** |
| `bun skills/dsh-qa/scripts/team-idle-member-guard.ts --self-test` | **PASS — 12 arms** incl. negative controls, exit 0 |
| `bun run test:qa` | **exit 0**, `[test:qa] all self-tests passed`, the case is discovered and its self-test runs |
| `bun run verify:docs` | **PASS** — pairs=52 failed=0 violations=0 |

## 4. RED-FIRST (the contract requires it per code fix)

Run against the COMMITTED HEAD tree (`git archive HEAD packages`, the pre-repair source) with the NEW
test files copied in:
`25 pass / 5 fail` — the row-level D2 arm, all three D2 window arms, and the D3 reject arm FAIL there;
they pass on the repaired tree. The D5 arm passes on both sides (coverage finding — the catch already
existed). The D6 falsifier is its new negative control ("no tool attempt → the denial is unproven"),
which the offline self-test exercises.

## 5. Bounds (what I could not prove)

1. **The live QA case was not run by me** (the contract assigns it to verifier-b after the captain
   rebuilds dist). The D2 fix's REAL-HARNESS behaviour — a genuinely cold-resumed child's first step —
   is modelled by the row-level arm (the executor double fires the pre-step and the guard inside `send`
   before returning), not observed live by the writer.
2. **`verify-dist-fresh` and `verify-vendor` remain RED by design** until the captain rebuilds
   `packages/mpd-team-core-plugin/dist/index.js` and runs the single re-pin (`skills/**` changed again
   here). I ran neither.
3. **D1/D4 are STALE by the repository's own convention**, not by judgement: if the maintainers ever
   change §6 to require `.ts` in `packages/*/src`, both files need the extension.
4. **D5 is a coverage arm**, green before and after; it does not prove a behaviour change.
5. **The dispatch window is process-local**: it bridges the send→owner-write gap of THIS row's
   `agent_teams_dispatch`. A dispatch delivered by another process cannot open it — the cellwork path
   relies on the both-way re-evaluation (unchanged) for its own deliveries, and both shipped executors
   resume children in-process.
6. **D7b is not executed here**: no rebase/squash was attempted (forbidden on a published branch); the
   captain's PR disposition + single final re-pin are the resolution.

## 6. Evidence index

- This report: `evidence/team/idle-member-guard/cr-repairs/writer/2026-10-30T12-31-09Z/report.md`
- Gate log incl. the RED-FIRST run and the `test:qa` verdict: `.../gates.log`
- Machine-readable summary: `.../result.json`
