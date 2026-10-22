# R1 — gate sensitivity + workspace scale (`team-gate-wave`, Lane R1)

Stamp: 2026-10-22. Lane scope: `packages/mpd-roles-plugin` (gate + tests + README pair),
`mpd_config_get`'s description (one sentence), and `skills/dsh-qa/scripts/session-start-team.ts`
(single-skills-writer for this wave). The R2 consult wording landed in this package too, by the
captain's instruction.

## What changed (by symbol)

`packages/mpd-roles-plugin/src/complexity-gate.ts`
- New: `GateSensitivity`, `GATE_SENSITIVITY_EASY|NORMAL|STRICT`, `SENSITIVITY_CONFIG_KEY`
  (`team.sensitivity`), `resolveSensitivity` (unknown/missing → `easy`, never throws),
  `SensitivityThresholds`, `SENSITIVITY_THRESHOLDS` (the ONE table), `ComplexityGateInput`.
- New signal F: `WORKSPACE_MANIFESTS`, `WORKSPACE_PROJECT_DIRS`, `WORKSPACE_VISIBLE_ENTRIES_MIN`,
  `WorkspaceScaleOptions`, `readWorkspaceScale` (ONE bounded root `readdir`, no recursion, never
  throws).
- Expanded `DELIVERABLE_VERB_PATTERN` (English asks + the CJK delivery verbs, deduped) and the CJK
  half of `ACTION_VERB_PATTERN` / `CLAUSE_ACTION_PATTERN` (so signal E reads them).
- `evaluateComplexityGate(text, { explicitFlag, activeBoulder, sensitivity, workspaceScale })`:
  every bound comes from the row; F is evaluated only when the row's `workspaceScale` is true.
- The historical constants `DELIVERABLE_VERB_MIN`, `ENUMERATED_LINE_MIN`, `ACTION_VERB_MIN`,
  `C_SUBSIGNAL_MIN`, `CJK_CHAR_MIN`, `CJK_ACTION_VERB_MIN` are now DERIVED from the `normal` row.

`packages/mpd-roles-plugin/src/session-gate.ts`
- `SessionGateInstall.sensitivity` (install snapshot, same transient-miss bound as `mode`).
- Per-fire: `team.sensitivity` re-resolved per call; signal F probed beside `readBoulderGate` and
  ONLY on a row that evaluates it; both values appended to the fire line
  (`… sensitivity=<row>`), never replacing an existing substring.

`packages/mpd-roles-plugin/src/index.ts`
- `Config.team.sensitivity`, the `configValue` branch, and the BOOT signature now reads
  `sessionGate=<mode> sensitivity=<row>` (suffix appended; `sessionGate=mechanical` and the whole
  guard token set are untouched).
- R2 wording: `mpd_role_spawn`'s description (one-shot consult) — the captain's exact text.

`packages/mpd-roles-plugin/src/delegation-gate.ts`
- R2 wording: `delegationRefusal` — one-shot consult sentence, two substrings preserved.

`packages/mpd-config-plugin/src/index.ts`
- `mpd_config_get` description names `team.sensitivity`.

`packages/mpd-roles-plugin/test/team-plane.test.ts`
- Threshold arms pinned to their rows; a new `team.sensitivity`/signal-F describe (resolver,
  table, the user's verbatim first message, the silent controls, F both ways, `readWorkspaceScale`
  fixtures + this repository's own root, and a WIRING arm proving F stages on the default row and
  stays silent on `normal`).
- `MECHANICAL_OPT_IN` pins `normal` so the pre-existing staging arms keep measuring what they were
  written for; a dedicated arm drives the eager default.

`skills/dsh-qa/scripts/session-start-team.ts`
- Restates the EASY bounds, keeps the NORMAL arm, pins the two-verb CJK negative to `normal` and
  pins its easy-B twin, adds the user's verbatim first message as a positive (B/E), signal F both
  ways, the reader arms and this repository's shape.
- Live arm: silent sides are ASSERTED to run in a tiny workspace; a new `large-workspace` side runs
  the SAME trivial greeting in a seeded large root and must stage with `signals=F`.
- `classifyNotices` now parses signal letters A–F.

`packages/mpd-roles-plugin/README.md` + `README.zh-CN.md`
- The six signals, the `team.sensitivity` table, the unknown→`easy` rule, and the one-shot consult
  wording (both languages).

## The table as implemented (single source of truth)

| sensitivity | B distinct verbs | C lines / verbs / clauses | E Han / verbs | F workspace scale |
|---|---|---|---|---|
| `easy` (DEFAULT) | ≥ 2 | ≥ 2 / ≥ 2 / ≥ 2 (2-of-3) | ≥ 24 / ≥ 2 | on |
| `normal` | ≥ 4 | ≥ 3 / ≥ 3 / ≥ 3 (2-of-3) | ≥ 60 / ≥ 2 | off |
| `strict` | ≥ 6 | ≥ 4 / ≥ 4 / ≥ 4 (3-of-3) | ≥ 80 / ≥ 3 | off |

Boot signature suffix: `sessionGate=<mode> sensitivity=<row>` on the `[mpd-roles] team plane:` line.
Fire-line suffix: `… staged=<0|1> [plan=<id>] sensitivity=<row>`.

## Measured results (files in this directory)

- `pre-change/baseline.md` — the untouched-tree self-test PASS, the user's verbatim first message
  reading `{trigger:false, signals:[]}` (77 Han chars), and the PARTIAL isolated live run whose
  positive side mounted the gate and fired `signals=E … staged=1` while two CJK negatives wrote no
  fire line. (The live run was timeboxed and killed; the last full live PASS is the 2026-10-20
  evidence dir.)
- `post-change/predicate-smoke.txt` — the same message now `{trigger:true, signals:["B","E"]}` at
  easy AND normal, silent at strict; `hello` silent in a tiny workspace and `signals:["F"]` in a
  large one (easy only); `验证一下`/empty silent; this repository's root reads large.
- `post-change/self-test.log` — the QA case's full offline contract, exit 0.
- `post-change/gates.log` — typecheck, package tests, comments, docs, self-test; one expected red
  (F1 dist freshness, integration rebuilds).

## Honest bounds

1. The POST-CHANGE live case was NOT run from this lane: it boots the BUILT `dist/`, and the dist
   rebuild is the integration step (T-88). The new live arms (`large-workspace` side, tiny-workspace
   assertions) are therefore UNVERIFIED LIVE until the captain rebuilds and runs the case.
2. `normal` reproduces the historical THRESHOLDS exactly, but the LEXICON expansion necessarily
   moves some verdicts at every row — by the captain's explicit instruction (the user's own message
   had to fire). The new English verbs are matched as SUBSTRINGS (the pattern's existing style), so
   a word like `latest` counts toward `test`; this is the eager direction the user asked for.
3. `easy` makes a two-verb CJK one-liner (`修复并验证`) fire B. That is the >= 2 bound's direct
   consequence and is pinned in BOTH directions (B on easy, silent on normal) rather than hidden.
4. The captain's message states the first message is 139 Han characters; the gate's own measure
   (`\p{Script=Han}`) reads **77**. The diagnosis is unchanged (77 > E's 60-char normal bound), but
   the number in the evidence is the measured one.
5. `strict` is silent on the user's message (77 < 80) by design; it is an opt-in row.
6. No git write commands were run. `dist/` was deliberately NOT rebuilt (integration owns it).
