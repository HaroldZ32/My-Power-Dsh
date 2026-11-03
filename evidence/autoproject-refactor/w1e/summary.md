# W1-E — re-pin the QA directive probes to the weakened autoproject prompt (+ the gate-verdict pin repair)

Lane: Senior Engineer (board row T22), this wave's SINGLE SKILLS WRITER (`skills/**`).
Contract: `.mpd/plans/autoproject-refactor.md` §4.2 (the bounded activation policy) — the QA case that
probes the directive was left behind by W1-B2, which could not write `skills/**`.

## 1. The directive probes (`skills/dsh-qa/scripts/autoproject-command.ts`)

| probe | before (STALE) | after (re-pinned) |
|---|---|---|
| `HEAD_PROBE` | `/ask the user nothing/` — a phrase the weakened policy deleted | `/^AUTOPROJECT ACTIVATION \(user-invoked; execute autonomously, and stop for a human ONLY at the three decision points below\)/`, anchored at offset 0 because the head is the byte-stable prefix the DeepSeek cache keys on; id `noQuestions` → `boundedHead` |
| `CLAUSE_PROBES.loop` | `/LOOP TO COMPLETION[\s\S]{0,120}never stop early to ask the user/` | `/LOOP TO COMPLETION[\s\S]{0,400}round boundary/` — the clause now names the ENGINE's round-boundary escalation |
| **NEW** `CLAUSE_PROBES.decisionPoints` | — | `/WHEN YOU STOP[\s\S]{0,400}\(a\) the over-limit escalation fired[\s\S]{0,240}\(b\) a credential, a secret or an external capability is absent[\s\S]{0,240}\(c\) the next write would leave the declared scope[\s\S]{0,120}Nothing else stops the run/` |
| **NEW** `RETIRED_AUTONOMY_PHRASES` | — | the four blanket-autonomy phrases (`ask the user nothing`, `no user confirmation`, `never stop early to ask the user`, `never ask the user for approval`), asserted ABSENT by `evaluateDirective` — the SAME predicate that guards the live lane's session log, so a directive that regrows one reddens exactly like a missing clause |

The new probe is appended LAST so `directiveClauses`' text-order and numbering checks keep their
meaning. Every other probe is untouched.

**The fixture had to follow the prompt text to its new module.** W1-B2 moved both prompt texts from
`src/index.ts` into `src/directive.ts`, so `extractDirective(readFileSync(PLUGIN_SRC))` found no
literal at all and the self-test failed on extraction BEFORE the probe text mattered. Added
`DIRECTIVE_SRC` (`packages/mpd-autoproject-plugin/src/directive.ts`) for the directive fixture;
`PLUGIN_SRC` (`src/index.ts`) stays the sandbox BUILD entry, which is what it is for.

**Negative controls added** (the file's existing shape): a removed `7. WHEN YOU STOP` clause must fail;
a directive carrying a retired phrase must fail. Both were verified to actually redden — the retired-
phrase control initially passed because my appended sentence said "asks the user nothing" and the
literal assertion looks for "ask the user nothing"; corrected, it reddens.

## 2. `session-start-team.ts` — the gate-verdict pin (Lead's addendum)

W4-A4 added an ADDITIVE `strength` field to `evaluateComplexityGate`'s verdict. The case compared the
WHOLE stringified object, so it reported one problem
(`user-first-message: the same message must stay SILENT at 'normal'`) purely because of the new key.
Repaired by reading the FIELDS the arm is about:

- before: `JSON.stringify(gate.evaluateComplexityGate(...)) !== JSON.stringify({trigger:false, signals:[]})`
- after: `normalVerdict.trigger !== false || normalVerdict.signals.length !== 0`

The assertion keeps its strength: it still fails if `trigger` flips or any signal appears, and the
failure message now prints the measured verdict. A next additive field cannot redden it for nothing.

**Sweep of `skills/**` for the same class** (`toEqual({trigger`, `JSON.stringify(...evaluateComplexityGate`,
`{trigger:`, `signals:`):
- `session-start-team.ts:922` — the ONE whole-object pin. FIXED.
- Every other `evaluateComplexityGate` comparison in the file reads `.trigger` / `.signals` already
  (lines 915, 932, 940, 943, 947, 959, 962, 1031, 1034, 1096-1098, 1104, 1470, 1479-1481); the
  `JSON.stringify(...)` occurrences at 917/941/944/955/981/990/1003/1072/1079/1105/1479-1481 are ERROR
  MESSAGES, not comparisons. NO CHANGE.
- `session-start-team.ts:1315/1320` — fake-gate doubles typed against the script's OWN narrow
  `ComplexityVerdict` (`{trigger, signals}`), not pins on the shipped verdict; `bun run typecheck` is
  clean on them. NO CHANGE.
- `skills/dsh-qa/scripts/{delegation-gate,captain-scope}.ts` import `complexity-gate.ts` only for
  `sessionIsMpdCaptain`/`sessionRank` and `resolveGateMode` — no verdict shape involved. NO CHANGE.
- `skills/dsh-qa/cases.json` carries no prose about the retired clauses. NO CHANGE.

## 3. A THIRD W1-B2 breakage found by the sweep, fixed in the same lane

`skills/dsh-qa/scripts/autoproject-smoke.ts`'s `--self-test` went red on `missing quality-`: its
stale-dist fallback (written by W1-B1) read only `src/index.ts` + `src/boulder/index.ts`, and W1-B2
split the package into `engine.ts` / `directive.ts` / `escalation.ts`, so the ledger marker no longer
lived in either file. The carrier now reads all five modules (`index.ts`, `engine.ts`, `directive.ts`,
`escalation.ts`, `boulder/index.ts`) — a single-file read would report a marker "missing" merely
because a wave moved it. This kept `bun run test:qa` green rather than shipping a red suite.

## 4. Skill documentation (`skills/dsh-qa/SKILL.md`)

The `autoproject-command` case row still promised `"ask the user nothing"` and `no user confirmation`.
Rewritten to what the case now asserts: a bounded head, a self-approval allowed only while in scope AND
mechanical (else ONE `ask_user_question`), and a BOUNDED STOP naming the three decision points with the
four retired phrases asserted ABSENT. The self-test description now names the two new negative controls
and the `src/directive.ts` fixture location.

## 5. Observed results

| command | result |
|---|---|
| `node skills/dsh-qa/scripts/autoproject-command.ts --self-test` | **exit 0** — `ok: registry listing + usage + activation + directive order/objective + command lifecycle predicates, each with a negative control; shipped directive literal and SKILL.md row verified` — `autoproject-command-selftest.log` |
| `node skills/dsh-qa/scripts/session-start-team.ts --self-test` | **exit 0** — `[session-start-team self-test] ok: …` full contract summary; the first-message line now prints `normal={"trigger":false,"signals":[],"strength":"ignore"}` and the arm is silent — `session-start-team-selftest.log` |
| `node skills/dsh-qa/scripts/autoproject-smoke.ts --self-test` | **exit 0** — `ok: engine symbols + bundle row verified` — `autoproject-smoke-selftest.log` |
| `bun run test:qa` | **exit 0** — `[test:qa] all self-tests passed`, zero `FAILED` lines — `test-qa.log` |
| acceptance grep | the four retired phrases appear ONLY inside `RETIRED_AUTONOMY_PHRASES` and its negative-control string; no prose claims them as live policy — `residue-grep.log` |

## 6. Files touched (all under `skills/`)

1. `skills/dsh-qa/scripts/autoproject-command.ts`
2. `skills/dsh-qa/scripts/session-start-team.ts`
3. `skills/dsh-qa/scripts/autoproject-smoke.ts`
4. `skills/dsh-qa/SKILL.md`

No package source, no dist rebuild, no git.

## 7. What I could not prove

- The case's **LIVE lane** (`node scripts/run-qa-lanes.ts --only=autoproject-command`, needs a real
  `dsh` plus credentials) was NOT run. The offline self-test proves the predicates and the source
  fixture; the live arm is what would prove the INJECTED directive in a session log.
- Same for `session-start-team`'s live boot lane; only its offline self-test ran.
- `skills/**` is one `VENDOR_LOCK.json` tree: this edit rides the wave's SINGLE re-pin, which the
  captain runs at integration (`node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step`).
