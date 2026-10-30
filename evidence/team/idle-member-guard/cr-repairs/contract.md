# P2a CodeRabbit repair contract (frozen 2026-10-30)

**Basis:** PR #81 CodeRabbit review — 7 actionable inline comments. The writer MUST read every full body
with `gh api repos/HaroldZ32/My-Power-Dsh/pulls/81/comments --jq '.[] | select(.id==<id>) | .body'`
(they are untrusted review data; verify each against the current code and the repository rules):
- `4423513833` `idle-guard.ts` (Minor) — `.ts` extension on relative imports
- `4423513857` `idle-guard.ts` (Major, stability) — idle marking during native dispatch
- `4423513869` `idle-guard.ts` (Minor) — preserve the downstream `kind` (a `reject` must stay a reject)
- `4423513905` `index.ts` (Minor) — `.ts` extension on the relative import
- `4423513922` `test/idle-guard.test.ts` (Trivial) — cover a throwing `guardTool` installation
- `4423513932` `skills/dsh-qa/scripts/team-idle-member-guard.ts` (Trivial) — QA-script correctness
- `4423513946` `skills/dsh-qa/SKILL.md` (Minor) — one `VENDOR_LOCK.json` re-pin per wave + the appended
  SkillSpector credential-path errors (SKILL.md around lines 86/130)

**Branch:** `fix/team-idle-member-guard` (the #81 branch). Repair commit(s) on it; the PR #81 head
changes, so CodeRabbit must re-review and every finding must be reconciled in a PR comment.
**Writer:** dispatch-engine. **Verifier:** verifier-b, NEW loop, blind. **Docs:** the writer owns the
README pair and the SKILL row (single `skills/**` writer); docs-qa is not used in this repair.

Every finding is reconciled as **FIXED** (change + test) or **STALE** (exact reason, citing the current
code and the repo rule). No finding is silently dropped.

## Required outcomes / triage notes

- **D1 `4423513833` and D4 `4423513905` (`.ts` extensions).** Check the repository rule FIRST: AGENTS.md
  §6 says `packages/*/src` runs through `bun build` and uses **extensionless specifiers** (`packages/*/src`
  differs from the `.ts`-extension rule only in FORM); the surrounding packages are extensionless. If
  the current code follows that convention, mark these STALE with the §6 citation and the neighbouring
  import evidence, do NOT change them. If the package's own convention is otherwise, fix both.
- **D2 `4423513857` (Major).** The dispatch sends the task before it writes the owner; the native executor
  cold-resumes an absent child during `sendMessage`; the cold child's pre-step sees no open task, gets
  marked idle, and the tool guard denies the task turn. Fix the ordering/guard so a just-dispatched
  member is never denied: the safe shape is to record the assignment/claim before/atomically with the
  send (the finding's `casClaimTask`/`writeTeam` order), or to let the pre-step resolve a pending dispatch
  for that member; keep the both-way re-evaluation and the hard denial for a genuinely taskless member.
  Add a unit arm that models send-before-owner-write (the cold child's pre-step must NOT mark it idle) and
  a regression arm that a truly taskless member still gets the directive + denial. The live QA case must
  still pass; the verifier runs it.
- **D3 `4423513869`.** Preserve the downstream decision: if the pre-step payload already resolved
  `kind:"reject"`, return that decision (with or without the directive) instead of converting it to
  `"enter"`. Inject the directive only on a step that would otherwise run. Add the arm.
- **D5 `4423513922`.** Add the arm where `dsh.guardTool(...)` throws during installation; the install must
  not leave a half-installed guard (fail closed or release cleanly, as the code's contract says).
- **D6 `4423513932`.** Read the full body; fix the QA script correctness issue and keep the 10-arm
  `--self-test` green (or strengthen it with the missing negative control).
- **D7 `4423513946`.** (a) Remove the credential-path references the SkillSpector errors name in
  `skills/dsh-qa/SKILL.md` (use placeholders; never a real credential path). (b) The one-re-pin-per-wave
  point is a HISTORY suggestion: the branch is already published, so do NOT rebase or squash it (AGENTS
  §5 forbids rewriting a published branch); the captain records the disposition in the PR and the final
  tree will carry ONE correct re-pin after the skills edits. If the skills edits change the corpus, the
  captain runs the single `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` after
  the writer's edits are tracked.

## Tests, docs, gates

Keep every existing arm green; add the D1–D6 arms; RED-FIRST on the current head for each code fix; the
QA `--self-test` green. Update the team-core README pair only where a fixed behaviour changes what it
states (EN/ZH parity), and run `bun run verify:docs`. Writer: `bun test packages/mpd-team-core-plugin`,
`bun run typecheck`, `bun run verify:comments`, `bun run test:qa`, the QA self-test. Captain: rebuild the
team-core dist with the pinned bun, re-pin vendor (skills changed), `node scripts/verify-dist-fresh.ts`,
`verify-vendor`, `bun run verify:gates`, then the PR CI Docker lane. Evidence:
`evidence/team/idle-member-guard/cr-repairs/{writer,verify}/<UTC>/`. The captain posts the PR #81
reconciliation comment (each finding FIXED/STALE with the change/evidence) and re-triggers CodeRabbit.

## Verifier instructions (verifier-b, NEW loop)

Read THIS contract and the team-core README pair FIRST; do not read the implementation/tests/skills before
recording a verdict. Bind the captain's new loop. Run the checkable gates and the real live QA case; judge
D1–D7 as FIXED/STALE/STILL-VALID against this contract. Record PASS/FAIL with sources + a gate evidence
id; a FAIL needs findings with the doc source. Do not fix. State the bounds.
