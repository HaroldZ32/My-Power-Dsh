# Repair NOTES — ask-user-guard wave, CodeRabbit findings R1–R5

Contract: `.mpd/plans/ask-user-guard-repair.md`. Branch `feature/ask-user-question-guard` at `f684ec10`.
Every gate of the contract has its own `<slug>/output.log` + `<slug>/result.json` in this directory and
is indexed by the top-level `result.json`. This file carries the two decisions the contract asked to be
recorded rather than coded.

## R5 — SkillSpector PE3 (credential access) at "~86/~125": NOT in the audit script; justified, untouched

The contract located the two flags on the new audit script. They are not there: the CodeRabbit
SkillSpector block is anchored on **`skills/dsh-qa/SKILL.md:128`** (PR #34 review comment, PATH field
`skills/dsh-qa/SKILL.md`) and its two PE3 errors name **SKILL.md lines 86 and 125** — the case-table rows
`mcp-call` and `team-watchdog-notify`:

- SKILL.md:86 (`mcp-call`): "… sandboxed `DSH_HOME` **and HOME** (plugin state `~/.mpd` never touches the
  real home), `settings.yaml` copied alongside `.credentials.yaml` (AGENTS.md §7) …".
- SKILL.md:125 (`team-watchdog-notify`): "… Sandbox home receives BOTH `.credentials.yaml` and
  `settings.yaml` (AGENTS.md §7 …) …".

Neither is reworded, for four recorded reasons:

1. **Pre-existing prose, not this wave.** `git blame` puts SKILL.md:86 at commit `7d52a06b` and :125 at
   `e987c3ac`; this wave's whole SKILL.md change is ONE inserted line (`git diff --stat e9953ad7~1
   e9953ad7 -- skills/dsh-qa/SKILL.md` → `1 insertion(+)`) — the appended `ask-user-question-audit` case
   row at :128. The scanner ran over the skill directory, not over the PR's added lines.
2. **It is the QA runbook, not credential-access code.** AGENTS.md §7 REQUIRES the sandbox bootstrap to
   copy `settings.yaml` (the gateway route config) and `.credentials.yaml` (a throwaway key) into the
   ephemeral `DSH_HOME`; rewording the recipe to placeholder paths would make the runbook wrong — the
   operator would no longer know which files the isolation step must copy. A scanner cannot tell a
   sandbox recipe from an exfiltration path, and moving documentation out of the way of a false positive
   is not a repair.
3. **The audit script carries no credential-path token.** A grep for
   `credential|token|api[-_ ]?key|secret|auth|\.dsh|DSH_HOME|home|passwd|password|ssh|env\b` over
   `skills/dsh-qa/scripts/ask-user-question-audit.ts` matches only the `#!/usr/bin/env node` shebang.
4. **Out of write scope.** `skills/dsh-qa/SKILL.md` is not one of the three paths this repair may touch
   (`skills/dsh-qa/scripts/ask-user-question-audit.ts`, `presets/mpd.patch.yml`,
   `evidence/ask-user-guard/repair/**`), so it is left untouched by rule rather than by judgement.

The same SkillSpector block also carries AE1 at :112 and RA2 at :3 — pre-existing SKILL.md prose, outside
R5's stated subject (the credential wording); recorded here so a later reader does not re-triage them
blind. Fixing any of them belongs to a wave that owns `skills/dsh-qa/SKILL.md`, with its own re-pin.

## DECLINED — `pairAnswer` single-pass refactor (CodeRabbit 🔵 optional, script ~L433)

Not implemented, per the contract's DECLINED clause. Reason: **YAGNI**. `pairAnswer` walks the records
once per call and stops as soon as both closing records are found; the repository documents one
caller-supplied session log, holds no log-size bound, no measured slowdown (no timing evidence exists in
the wave's evidence or the finding itself) and no caller that audits many logs in one process, so the
quadratic worst case is theoretical. Minimal-diff doctrine (AGENTS.md §2.6) wins; revisit only with a
measured case — a large-log timing or a bulk-audit caller.

## R1–R4 — what changed (for the verifier's map; the diffs are the source of truth)

- R1 `presets/mpd.patch.yml` (the ASK_USER_QUESTION CONSTRUCTION RULE paragraph): the rendering
  guarantee is gone. It now says a boundary guard MAY deny a structurally broken call pre-dispatch, that
  the guard is only a BACKSTOP which can be ABSENT (degrade path) and that unreadable shapes pass
  through, so a broken call can still reach the panel; the schema-shape construction requirements and
  "fix the call and re-issue it" are kept.
- R2 `ask-user-question-audit.ts`: `textFieldDetail(raw)` replaces the pre-filtered `stringFieldOf`
  detail at the `question-id-missing`, `question-text-missing` and `option-label-missing` sites — a
  present-but-wrong-type field now names its shape (`number`, `null`, …), `absent` stays for a missing
  field and `'' (empty)` for an empty string.
- R3 same script, `parseRecords`: a JSONL line decoding to an array is counted in `undecodableLines`,
  never pushed as a record (`!Array.isArray(parsed)`).
- R4 same script, `parseArgs`: `--self-test` is accepted ONLY as the sole argument; every mixed or
  repeated spelling falls through to the usage error (exit 2, usage line + reason on stderr).
- Self-test arms added for each: wrong-type `id`/`question`/`option.label` details, absent-`id` and
  empty-string details preserved, a plain-JSONL fixture whose array line is undecodable, and the mixed
  (`--self-test <log>`), reversed and repeated CLI invocations. The mutant negative controls live in
  `capture.sh` and each MUST redden the self-test.
