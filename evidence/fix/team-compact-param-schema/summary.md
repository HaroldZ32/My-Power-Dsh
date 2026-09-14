# Defect fix: `mpd_team_compact_run` function schema rejected by the provider

Reported symptom (live mpd session):

```
Invalid schema for function 'mpd_team_compact_run': schema must be a JSON Schema of
'type: "object"', got 'type: null'
```

## Mechanism (measured)

1. `packages/mpd-team-compact-plugin/src/index.ts` declared BOTH tools' `parameters` as a
   **bare property map** — `parameters: { team_id: { type: "string", … } }` — instead of an
   object-rooted JSON Schema.
2. `packages/mpd-dsh-adapter-plugin/src/index.ts:433` forwards `parameters` **verbatim**
   (`parameters: definition.parameters ?? OBJECT_SCHEMA`): the object-rooted default applies
   only when the field is ABSENT, never as a repair of a supplied value.
3. The installed harness validates the **output** schema at registration
   (`@deepseek-ai/dsh-tools/lib/index.js:2777` → `assertSupportedJsonSchema(output.schema)`)
   but **not** `parameters`; only its `defineTool` compiles a property map into
   `type: "object"` (`lib/index.js:798-806`). Every mpd plugin registers through the raw
   `register()` path, and the adopted agent-teams plugin is safe only because it uses
   `defineTool`.
4. Consequence: the registered tool's model-facing schema carried no `type` at all, so the
   **provider rejected every model request** of any session mounting the row — the session
   could not run a single turn.

## Fix

Both tools now declare an object-rooted schema (`type` + `properties` + `additionalProperties`),
matching every sibling mpd plugin; the registration site carries the defect note.

| File | Change |
|---|---|
| `packages/mpd-team-compact-plugin/src/index.ts` | `parameters` wrapped for `mpd_team_compact_run` + `mpd_team_compact_status`; comment records the mechanism |
| `packages/mpd-team-compact-plugin/dist/index.js` | rebuilt (`bun build … --target node --format esm`) |
| `packages/mpd-team-compact-plugin/test/compaction.test.mjs` | new regression test: every registered tool's `parameters` must be object-rooted with the declared `team_id`, optional |
| `packages/mpd-qa-roles-probe/src/index.ts` (+ `dist`) | new `TOOL_PARAM_SCHEMAS` mount instrumentation: reads the LIVE registry's model-facing projection (`tools.schemas()`), requires an object root for every `mpd_*`/`agent_teams_*` tool, and joins the probe's PASS verdict |

## Evidence

Authoritative runs (driver: `raw/param-schema-repro.mjs`, a real mounted boot in an isolated
DSH_HOME + sandbox HOME + sandbox workspace through the dev-flavor bundle patch, with the QA
probe mounted as registration instrumentation):

| Verdict | Directory | Measurement |
|---|---|---|
| RED | `2026-09-14T05-19-49.411Z/` | `TOOL_PARAM_SCHEMAS=50/52 BAD=mpd_team_compact_run:type=null,mpd_team_compact_status:type=null`; the provider message composed from that measurement is byte-identical to the reported error; probe PASS withheld |
| GREEN | `2026-09-14T05-19-54.512Z/` | `TOOL_PARAM_SCHEMAS=52/52`, no BAD entry, `roles-probe] PASS` |

Unit-level RED/GREEN on the declaration itself (same regression test, two sources):

```
git show HEAD:packages/mpd-team-compact-plugin/src/index.ts > packages/mpd-team-compact-plugin/src/index.ts
cd packages/mpd-team-compact-plugin && bun test     # RED: 19 pass / 1 fail
                                                    #  expect({tool:'mpd_team_compact_run',type:'object'})
                                                    #  received type: undefined
# restore the fixed source, bun test               # GREEN: 20 pass / 0 fail
```

Mount gate on the SHIPPED install layout — `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs
--no-skip` → `evidence/dsh-qa/bundle-lifecycle/2026-09-14T05-19-18.104Z/` PASS, boot.log:
`[roles-probe] TOOL_PARAM_SCHEMAS=52/52` + `TEAM_COMPACT_TOOLS=2/2` + `roles-probe] PASS`.

Gate sweep for this change:

| Gate | Result |
|---|---|
| `bun test packages/mpd-team-compact-plugin` | PASS (20/20) |
| `bun run typecheck` | PASS |
| `bun run test:qa` | PASS (all self-tests) |
| `node scripts/verify-vendor.mjs` | PASS (no `skills/**` or vendored asset touched → no re-pin) |
| `bundle-lifecycle` (MOUNT, installed layout) | PASS |
| `bun test packages` (whole tree) | 398 pass / **1 fail — PRE-EXISTING, unrelated**: `mpd-dsh-adapter-plugin` › `capabilities > reports every seam of a full harness` fails because the test's `fakeHarness` mock lacks the `agents` / `compaction` services the adapter gained after that test was written (the adapter package is untouched by this change). |
| `preset-register` (MOUNT) | **PRE-EXISTING failure, unrelated**: `SKILLS=25 BUNDLED=19` → the probe's "every served skill is bundled" rule fails because that case does not sandbox `HOME`, so the real home's `~/.agents/skills` (6 skills) leaks into the boot. Re-measured with the PRE-change probe dist: same `SKILLS=25 BUNDLED=19` and the same `ok=false`. Fixing it is a `skills/dsh-qa/**` (hence VENDOR_LOCK re-pin) change of its own. |

## Reproduction

```
node evidence/fix/team-compact-param-schema/raw/param-schema-repro.mjs --expect-bad   # RED
node evidence/fix/team-compact-param-schema/raw/param-schema-repro.mjs               # GREEN
```

## Honest limits of this evidence

* This sandbox has no provider credential (`~/.dsh/.credentials.yaml` holds only the
  browser-session grant: a headless turn stops at `MISSING_CREDENTIAL`), so no live provider
  round-trip could be driven; the provider-side rejection is anchored on (a) the reported
  error text and (b) the live-registry measurement that composes it byte-for-byte.
* A local strict-gateway stub was attempted and abandoned: this sandbox blocks loopback
  connections **from spawned children** (measured: a parent HTTP listener is never reached by
  a child process, while same-process loopback and external egress work), so the booted dsh
  could not reach a stub.
* `--dump-config` cannot witness any of this — it composes rows and never executes plugin
  code (AGENTS.md §4); the decisive check is the mounted boot with registration
  instrumentation, which is what the runs above are.

## Superseded drafts (kept as iteration records)

`2026-09-14T05-02-20.778Z`, `05-09-16.265Z`, `05-14-44.722Z` — reproduction attempts from the
phase before the sandbox limits above were known (the first ran with the old probe build and
no schema line; the other two tried the stub). `05-16-54.367Z` / `05-17-42.794Z` are the same
RED/GREEN pair captured before the driver's sandbox path moved under the ignored `.qa-reloc/`;
their verdicts are unchanged.
