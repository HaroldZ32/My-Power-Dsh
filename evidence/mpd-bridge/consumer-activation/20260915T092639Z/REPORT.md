# t42 — Consumer activation: the consumer really uses the bridged value after a restart (result)

Repair-free **verification**. inScope: `evidence/mpd-bridge/consumer-activation/`. Knob under test:
`hashline.maxDiffChars` (the design's most observable consumer knob); the consumer plugin is
`mpd-hashline-plugin`, whose effective value is captured **at apply time**
(`mergedConfig()` → the `maxDiffChars` closure constant in `apply()`), and is observable through the
`diff` the real `mpd_hashline_edit` tool returns (`generateUnifiedDiff(...).slice(0, maxDiffChars)`).

**Values.** `<workspace>/.mpd/mpd.jsonc` starts at **30** (small, so the truncation is visible and is
neither the code default 4000 nor the schema default 20000); the write through the host is **31415**.
A 40-line fixture is edited by replacing its first line, so every observation measures the truncation
of the same ~1 KB unified diff: **30 chars when the consumer holds 30**, the full **1032 chars** when
it holds 31415.

## The chain, step by step (raw artifacts in `raw/`, machine-readable in `result.json`)

| # | Step | Command / driver | Observed |
|---|---|---|---|
| 1 | Fixture | `lane.mjs` writes `<ws>/.mpd/mpd.jsonc` = `fixture(30)` + a 40-line target | `fileValue: 30` |
| 2 | **Real host boot** | `dsh --profile w --port <free> --no-open` (isolated `DSH_HOME`, sandbox `HOME`, `DSH_WORKSPACE_ROOT=<ws>`) | launch token + cookie, `raw/boot-main.log` |
| 3 | Live session | RPC `session/create { cwd: <ws>, agentPreset: "mpd" }` | `200`, `{"ok":true,"value":{"sessionId":"session-d89ca5f9-…","agentPreset":"mpd"}}` |
| 4 | **Consumer before the write** | `node consumer-probe.mjs --ws <ws> --hold <trigger>` (kept alive across the write) | `consumerDiffLength: 30`, `configLayerValue: 30`, `fileValue: 30` (pid 183) |
| 5 | **Write through the HOST's own settings service** | RPC `settings/mutate { ns:"mpd", ops:[{op:"set",path:["hashline","maxDiffChars"],value:31415}] }` | `200`, `ok:true`; descriptor `value.hashline.maxDiffChars = 31415`, **`base.hashline.maxDiffChars = 30`** (the file-derived base), `user.hashline.maxDiffChars = 31415`, `applies:"restart"`, `revision:1` |
| 6 | Bridge write-back | boot log `[mpd-config] settings bridge WROTE: {"writtenTo":["<ws>/.mpd/mpd.jsonc"],"results":[{"outcome":"written"}],"applies":"restart","source":"update","revision":1}` | file bytes now `"maxDiffChars": 31415` with **the human comment and the trailing comma intact** |
| 7 | **NEGATIVE CONTROL — same process, no restart** | trigger file written; the held probe re-reads the config layer and re-invokes the SAME instance | config layer **31415**, file **31415**, consumer diff **still 30** ⇒ the consumer keeps the OLD value while the namespace and the file already carry the new one |
| 8 | **RESTART** | host stopped; a fresh probe process (`--json raw/probe-after-restart.json`) | `consumerDiffLength: **1032**`, `configLayerValue: 31415` ⇒ the consumer carries the NEW value |
| 9 | **DURABLE CARRIER** | fresh `DSH_HOME` with no settings leaf (`sandbox/dshhome-fresh`, `raw/probe-fresh-home-file-only.json`) | `consumerDiffLength: **1032**`, `configLayerValue: 31415` ⇒ the value is resolved from `<ws>/.mpd/mpd.jsonc` alone |

`result.json → verdict` (all four gates true):

```json
{"fileLayerCarriesWrittenValue": true, "commentsAndTrailingCommaIntact": true,
 "consumerBeforeWrite": 30, "consumerSameProcessAfterWrite": 30,
 "consumerSameProcessConfigLayerAfterWrite": 31415, "consumerAfterRestart": 1032,
 "consumerFreshHomeFileOnly": 1032, "freshHomeConfigLayerValue": 31415,
 "consumerUsesNewValueAfterRestart": true, "restartIsGenuinelyRequired": true,
 "fileIsDurableCarrier": true}
```

## Known limit, recorded rather than papered over (acceptance 4)

This environment has **no model credential** — `/root/.dsh/.credentials.yaml` carries only a
`client-connection/browser-session` record and `settings.yaml` has no provider keys — so a
model-driven tool call inside the booted host is impossible here (measured earlier in this wave: a
sandboxed turn fails with `no API key for provider route "deepseek-official"`). The consumer side is
therefore observed by a **separate process that applies the REAL built modules the host loads**
(`packages/mpd-config-plugin/dist/index.js` then `packages/mpd-hashline-plugin/dist/index.js`, the
host's own row order) against the **REAL sandbox files**, and invokes the **REAL registered tool**
through the adapter's normalized registration shape. The host boot in steps 2/3/5/6 is real
(launch-token cookie, `session/create`, the host's own `settings/mutate`, the bridge's write-back and
its structured boot-log report). What is NOT witnessed: a model-driven `mpd_hashline_edit` call
inside that booted host — that is the same limit `web-settings-bridge` records for the rendered card,
and it is named here rather than substituted silently.

## Isolation and scope

`DSH_HOME`, `HOME`, the workspace and the profile all live under
`evidence/mpd-bridge/consumer-activation/<ts>/sandbox/`; the lane asserts `DSH_HOME` is not the real
home before booting. No real `.mpd` state and no real `~/.dsh` file was written by this lane (the real
home's `settings.yaml`/`.credentials.yaml` mtimes are unchanged), and **no source, docs, `skills/`,
`VENDOR_LOCK.json` or `package.json` was touched** — `consumer-probe.mjs`, `lane.mjs`, `result.json`
and `raw/**` are the only writes.

## Artifacts

| Path | sha256 |
|---|---|
| `consumer-probe.mjs` | `d79353163c3f586f62021f072085a504e588c953a67eb8096ffad3715e39e86e` |
| `lane.mjs` | `2d4026763e56cfaeb08c4b305090f1ebecdb2e4a35ffda348b26034bb2d7138b` |
| `result.json` | `52d894a273b377bb0f5bb5fe0df5f7623918bd93f4b687f6d368029572b98359` |
| `raw/boot-main.log` | `e590a05355c7a3fad97f8cd3ceffa76ffc46fe6e159ac9cf0a437569d7c763e7` |
| `raw/probe-held-before-write.json` | step 4 + step 7 (the same pid's two observations) |
| `raw/probe-after-restart.json` | step 8 |
| `raw/probe-fresh-home-file-only.json` | step 9 |

Re-run: `node evidence/mpd-bridge/consumer-activation/<ts>/lane.mjs --out <ts-dir>` (~3 min: one boot,
one held probe, two fresh probes). Boot/rpc/session mechanics are the measured pattern of
`skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs` (t35), unchanged; the consumer observation is
this task's addition.
