# t86 / w16 — closing r6's handover (the heartbeat lane's H5 + the `toolInFlightMaxMs` declaration)

Two items, both from `evidence/team-watchdog/long-tool-false-positive/20260916T015821Z/harness.json →
handover_out_of_scope` (read first): the heartbeat lane's H5 proxy became FALSE when r6 landed, and
`watchdog.toolInFlightMaxMs` was readable but NOT declared, so neither front door rendered it.

## Item 1 — `skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs`

| Before (retired) | After (r6/w16) |
|---|---|
| `H5 = !dist.includes("tools/pre-execute") && dist.includes("tools/post-execute")` — "the built bytes expose NO pre-dispatch hook" | `H5 = presence of BOTH waterfalls` (the dist INLINES the adapter, so `tools/pre-execute` is there BY DESIGN) `+ the row subscribed the PRE hook + the observe-only property measured on a REAL tool call` |

The observe-only half reuses r6's shape (`raw/observe-only-real-call.mjs`) instead of a byte scan: the
lane now runs the **same real tool call twice** — once on a plain vendored-cordis context, once with
the **real adapter dist**'s `onPreToolExecute` hook installed — with a genuine child-process tool body,
and compares the gate decision, the command result and the post-execute decision byte for byte. It
also proves the frozen copy (a listener write is rejected), that a **throwing** listener still leaves
the gate verbatim, and that the stamp happened BEFORE the body ran.

Negative controls (each reddens H5 on its own): `pre-hook-absent`, `pre-hook-not-subscribed`,
`observe-only-veto`, `observe-only-mutates`, `observe-only-write-lands`, `observe-only-throws`,
`observe-only-after-body`. The file header and the `notClaimed` list were rewritten (the old
"no pre-dispatch stamp exists or is claimed (W-9)" claim is gone; the POST stamp keeps its
completion-only semantics).

Results: `--self-test` **PASS (13 checks)**, real run **PASS — 13 checks, 0 failed**, mounted row
**6 disposers** including `tools/pre-execute`, observe-only proof all-true.

## Item 2 — the declaration

| Where | Change |
|---|---|
| `packages/mpd-config-plugin/src/settings-schema.ts` | `SettingsSchema.watchdog.toolInFlightMaxMs = z.number().default(900000)`; a 12th `SETTINGS_KNOBS` row `{ path: ["watchdog","toolInFlightMaxMs"], label: "Tool-in-flight bound (ms, 0 = no bound)", zh: "工具在飞上限（毫秒，0 表示不设上限）", kind: "number", hint: <the semantics sentence> }`; the `SettingsKnob` interface gained the optional `hint` |
| `packages/mpd-bundle-plugin/src/settings-card.js` | the card's own `FIELDS` row + a `semantics` string that `hintOf` appends to the row's hint (so the Web row states the semantics) |
| `packages/mpd-bundle-plugin/test/settings-card.test.mjs` | count `11 → 12`, and the parity loop now also asserts `hint: "<field.semantics>"` is the SAME sentence in the shared declaration (a drift guard ADDED, nothing loosened) |
| `packages/mpd-tui-plugin/test/plugin.test.ts` | count `11 → 12` |

**Where a user reads the semantics:** the shared declaration's `hint` — the sentence "how long ONE tool
call may run before it stops explaining a silent member: past this bound the call is reported ONCE as a
`tool-expired` incident (a warning — never a scene, never a hold, never an escalation), and `0` disables
the bound" — is rendered by the **Web card row**, and the label/zh rendered by BOTH front doors carry
the `0 = no bound` / `0 表示不设上限` clause. Honest limit: the TUI row's `hint` is built in
`packages/mpd-tui-plugin/src/settings.ts` (**outside this task's inScope**), so the long sentence is
Web-only today — reported as a follow-up, not silently claimed.

## Rebuilt artifacts (before → after)

| Artifact | Before | After |
|---|---|---|
| `packages/mpd-config-plugin/dist/index.js` | 100368 B / `15377543b30a…` | 100885 B / `86135267b301e678e1ddfc59a2765e77156d7d104cc6206df5fbac19997b64d8` |
| `packages/mpd-tui-plugin/dist/index.js` | 111398 B / `09935e228256…` | 112338 B / `99f743a9b05dbfce6efb162714ce90a6081742eaac84331054ce502b6a75214a` |
| `packages/mpd-bundle-plugin/client.js` | 298301 B / `34f1976ffef5…` | 298914 B / `9d62b69c431df8b3b0643d73e764ea89d60f59e5aec198bf33e1ac305fa7a928` |

The client build was run **twice → byte-identical** (`raw/artifacts-after.txt`).

## Gates

| Gate | Result |
|---|---|
| `bun test packages` | **732 pass / 0 fail / 5253 expect()** (138 files) |
| `bun run typecheck` | exit 0 |
| `bun run verify:docs` | `pairs=34 failed=0 violations=0 exempt=16 — PASS` |
| `node scripts/patch-agent-teams-fixes.mjs --check` | `already applied: 53 mpd delta region(s) across 9 adopted file(s)`, exit 0 |
| lane `--self-test` + real run | PASS (13 checks each) |
| `raw/knob-visibility.mjs` | `VISIBILITY-OK` |

## The skills corpus re-pin (the captain's, in the same commit)

`fileCount` **317** (unchanged) · new `treeSha`
**`9e643d07192fe8bd9cc2bc5e252bb5c031a2444fa958cd10a19c5043e8b6be89`**
(previous lock value `5aec4b643065891082c8c6b072f85e30488585a42b25a2184dead30221c40ce3`).
The replication was validated by recomputing the untouched `_deps` asset (635 files) and matching its
lock value, so the hash is the gate's own algorithm (text normalized to LF), not an approximation.

**Two EXPECTED reds, both caused by leaving `VENDOR_LOCK.json` untouched on purpose:**
`node scripts/verify-vendor.mjs` exits 1 with exactly `asset skills treeSha mismatch`, and
`bun run test:qa` exits 1 at `skills/dsh-qa/scripts/agent-teams-messaging.mjs`
(`lock=317/5aec4b643065 tree=317/9e643d07192f`). Every other `--self-test` in `test:qa` passed.

## Files in this directory

`result.json` (machine-readable record) · `raw/artifacts-before.txt`, `raw/artifacts-after.txt` ·
`raw/heartbeat-run.out` + `heartbeat/{result.json,output.log}` (the real lane run) ·
`raw/knob-visibility.result.json` + `.log` · `raw/bun-test-packages.txt` · `raw/gates.txt` ·
`raw/test-qa.txt` · `raw/verify-vendor.txt` · `raw/skills-corpus-figures.json` ·
`raw/source-and-test.diff`, `raw/heartbeat-lane.diff` · `raw/build-*.log`.
