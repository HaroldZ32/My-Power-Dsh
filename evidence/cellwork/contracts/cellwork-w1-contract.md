# Wave 1 frozen contract — adapter seams + compaction signal

Frozen: 2026-10-26T07:40:00Z · owner: captain · plan: `.mpd/plans/cellwork.md` (§4.1, §4.5, §5 Wave 1, F1/F3/F5/F8/F9)

This document is the acceptance basis a WAVE 1 VERIFIER works from. The verifier must NOT read the
implementation; it runs the gates named in §3, cites this contract plus the documentation band, and
records a verdict through the verify plane. A FAIL names the A-item violated and cites this document
as `doc_source`.

## 1. Required outcomes

### A1 — live context-pressure seam (adapter only)

One new adapter capability that reports, for one live agent, the OCCUPIED context of its session:

- Reads the harness `sessionProjections` unit `contextPressure` for that agent's `Session` (a Session
  OBJECT is required by the registry; the adapter may resolve it from a live agent or a session id).
- `usedTokens = projectedTokens ?? pressureTokens` (prefer the projection's projected value).
- `windowTokens = state.contextWindow` — the window the MODEL reported at runtime. It is READ, never
  defaulted, never configured.
- `ratio = usedTokens / windowTokens` only when both are numbers > 0; otherwise `null`.
- Provenance is explicit and machine-readable: `observed` (projection present with window),
  `no-window` (projection present, window absent), `unavailable` (no registry, no session, no state).
- Tolerates a missing service, a missing session or a missing projection WITHOUT throwing.
- Never returns a guessed window (no `1_000_000`, no `262_144`, no config value).

### A2 — the model's window in the catalog projection (adapter only)

The adapter's model-info projection carries the window the harness itself resolved:

- `contextWindow`: number | null, from the harness model info's context metadata (`context.contextWindow`).
- `maxOutputTokens`: number | null (the model's maximum output tokens when the harness exposes it;
  `defaultMaxTokens` on the resolved model info is the field to read).
- `null` when the harness resolves nothing — NEVER a hard-coded fallback.
- Existing projected fields (id, name, description, efforts, defaultEffort) keep their meaning.

**Amendment 1 (2026-10-26T07:55Z, captain; raised by adapter-engineer):** the shared TypeScript
interface declares both fields **OPTIONAL** (`contextWindow?: number | null`), because making them
required forces unrelated fixture literals in four consumer packages (`mpd-tui-plugin`,
`mpd-roster-provider-plugin`, `mpd-roles-plugin`) to change, which is outside this wave's scope. The
RUNTIME contract is unchanged and stricter: the adapter ALWAYS emits both keys, each `number | null`,
and a test pins key presence plus the null-when-unresolved case. A consumer must read `undefined` as
"this producer did not report" and `null` as "the harness resolved nothing". This amendment does not
relax A2's observable requirement; it fixes where the strictness lives (runtime + test, not the type).

### A3 — `maxDepth` on the team spawn request (adapter only)

- `DshTeamSpawnRequest` accepts an optional `maxDepth?: number`.
- The NATIVE executor forwards it into the activation request as `request.maxDepth` — exactly when the
  caller supplied it; absent (not `undefined`) when it did not.
- The OFFICIAL executor ignores it without throwing (documented in the README).
- This is the only route by which cellwork can raise a depth-2+ subcaptain (capability fact F1).

### A4 — real abort signal in `mpd-team-compact` (adjacent defect)

- Every `compactNow(...)` call in `packages/mpd-team-compact-plugin/src` passes a real `AbortSignal`
  created from an `AbortController`; `undefined` is never passed.
- The existing error classification is preserved: `busy | cancelled | changed | summary | commit |
  persistence` are classified as before, and an unrecognised error is still `unclassified`.
- An aborted signal must surface as an abort/cancel outcome, not as a raw TypeError.

### A5 — pre-existing host-drift compatibility in the TUI panel test (adjacent, declared)

Discovered while landing Wave 1 and NOT caused by it: `packages/mpd-tui-plugin/test/panel-visibility.test.ts`
calls `prefs.parseSidePanelIds(...)` in five arms (R13, R13b). The installed host
`@deepseek-harness-tui/dsh-tui@0.17.0` exports `resolveSidePanelIds`, `SIDE_PANEL_ID_PATTERN`,
`normalizeSidePanelPanels` and friends, but NOT `parseSidePanelIds`, so those five arms throw
`TypeError: prefs.parseSidePanelIds is not a function` and the repo-wide `tests` gate is red on this
machine independently of this wave (captain reproduced: 39 pass / 5 fail on the unmodified file;
`git diff` lists no file under `packages/mpd-tui-plugin`).

The file's DOCUMENTED premise (`docs/tui.md` §3.3 and CHANGELOG) is that it re-judges itself when
the installed host changes. Required outcome:

- Resolve the host's capability instead of naming one function: use the installed host's current
  export(s) and keep working where a host still provides `parseSidePanelIds`. A single compat resolver
  used by the five arms is the expected shape.
- Preserve every ARM and every assertion. An arm TITLE may be RE-JUDGED when the installed host
  changed the mechanism the old title names (Amendment 2): the new title must state the CURRENT
  behaviour, and the arm must pin the REMOVED mechanism as an explicit ABSENCE — never silently drop
  it. The old→new title mapping is recorded in the writer's report and in the PR description. Nothing
  may be skipped, deleted or weakened, and the total test count must not shrink. If no single
  replacement preserves an assertion, compose the closest equivalent from the host's own primitives
  (`SIDE_PANEL_ID_PATTERN`, `normalizeSidePanelPanels`, `resolveSidePanelIds`) and document the
  mapping in a comment.
- `bun test packages/mpd-tui-plugin` is green AND the aggregate `bun test packages` is green.
- Scope is the test file (plus a helper inside the same `test/` directory if needed). Production `src`
  is NOT touched; if the same call exists there, STOP and report it as a separate finding.

## 2. Explicit non-goals

- No cellwork logic in the adapter; no new plugin package in this wave.
- No change to the default `subagent` tool behaviour, the preset plane, or the team record format.
- No `dist/` edits by the work task: the captain rebuilds every dependent `dist` at integration.
- No configuration knob for a context window anywhere.

## 3. Gates the verifier MUST run and cite

| Evidence | Command / tool | Must show |
|---|---|---|
| typecheck | `mpd_verify_evidence {kind:"gate", gate:"typecheck"}` | exit 0 |
| adapter tests | `bun test packages/mpd-dsh-adapter-plugin` | all pass, 0 fail |
| compact tests | `bun test packages/mpd-team-compact-plugin` | all pass, 0 fail |
| comments | `mpd_verify_evidence {kind:"gate", gate:"comments"}` | exit 0 (every declaration documented, every named function typed) |
| tests aggregate | `mpd_verify_evidence {kind:"gate", gate:"tests"}` | exit 0 after A5; the pre-A5 red (`ev-20261026T074828-19c166`, 5 tui host-drift failures) is recorded as pre-existing and independently reproduced by the captain |
| tui package tests | `bun test packages/mpd-tui-plugin` | all pass (A5) |
| probe | `mpd_verify_evidence {kind:"probe"}` on the two source entry paths | files exist, non-zero size |

The citation list for a PASS follows §4's per-item rule (A1–A3 cite the adapter README; A4 cites the
compact README; A5 cites `docs/tui.md` §3.3 and the two test runs). A PASS with no documents or no
gate evidence is refused by the tool.

## 4. Verdict rule

PASS iff A1–A5 are each supported by the gate evidence and no gate in §3 is red. FAIL requires one
finding per violated A-item, each with `doc_source` = this contract (or the package README it
contradicts). A defect observed but not covered by A1–A5 is reported as a note, not a finding.

**Per-item citation (what a PASS for each item must cite):**

- **A1/A2/A3** → this contract + `packages/mpd-dsh-adapter-plugin/README.md` + the adapter package test
  run and the typecheck/comments gate evidence.
- **A4** → this contract + `packages/mpd-team-compact-plugin/README.md` + the compact package test run
  and the typecheck/comments gate evidence.
- **A5** → this contract + `docs/tui.md` §3.3 + `bun test packages/mpd-tui-plugin` AND the aggregate
  `tests` gate. The adapter README is NOT part of the A5 basis.

**A5 black-box evidence (blindness respected).** The post-fix run must report:

- the same 44 tests as the pre-fix reproduction (39 pass / 5 fail / 44 total), now 44 pass / 0 fail;
- the five R13/R13b arms present in the output (GROUP prefix and per-group count); titles may be
  re-judged under Amendment 2, in which case `expect() calls` must be >= 189 and the total test count
  >= 44, and each renamed arm must assert the current host rule POSITIVELY plus the removed mechanism
  as an absence;
- `expect() calls` >= 189 (the pre-fix count; growth is allowed, deletion is a finding);
- `git status --short -- packages/mpd-tui-plugin` listing ONLY the test file (plus a helper under that
  package's `test/` directory).

Assertion CONTENT beyond those counts and titles is a DECLARED BOUND of a blind verdict. The
"production src untouched" clause is confirmed by an independent read-only consult whose result the
captain relays into the record notes; the verifier does not read src.

**Amendment 2 (2026-10-26T08:15Z, captain; raised by wave1-verifier before T8):** A5's original
"preserve every arm TITLE" is replaced by "preserve every ARM and every assertion". Rationale: three
of the five R13/R13b titles name mechanisms that installed host 0.17.0 REMOVED (a registration-time
CSV append, the literal default CSV, the pre-0.15 rewrite). Keeping such a title while asserting the
opposite would make the arm lie; deleting the arm would weaken the file. A re-judged title must
therefore state the current rule, the arm must pin the removed mechanism as an explicit absence, and
the old→new mapping must be visible in the work report and the PR. The black-box guard is the arm
count (44), the five group prefixes, `expect() calls` >= 189 (measured 228), and the aggregate green.
This amendment does not reduce A5's observable requirement; it fixes what "re-judged, not weakened"
means when the HOST's mechanism changed.
