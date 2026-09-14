# Defect fix: the shipped adapter artifact could not serve the live-session plane

Reported as part of a health pass over `dev` (2026-09-14): the working tree was green on
`verify-vendor` / `typecheck` / `test:qa` / the isolated mount boot, yet the newest shipped
feature — team compaction — was **dead at runtime**. Nothing in the existing gates could see
it: every one of them exercises SOURCE (`bun test`), COMPOSITION (`--dump-config`) or the
PLUGIN's own dist, while the thing that was stale is the ADAPTER artifact that the plugin
resolves at call time.

## Measurement, before any change

| Measurement | Result |
|---|---|
| `git show HEAD:packages/mpd-dsh-adapter-plugin/dist/index.js \| grep -c liveAgent` | **0** |
| same file, `compactionEngineForAgent` / `onEvent` / `liveAgents` | **0** each |
| `packages/mpd-dsh-adapter-plugin/src/index.ts`, same symbols | 15 |
| last commit touching the adapter **dist** | `455d376` (2026-09-11 18:05) |
| last commit touching the adapter **src** | `7a8d245` (2026-09-14 10:59, `feat(team-compact)`) |
| fresh `bun build` of the committed src vs the committed dist | **87 diff lines** |
| dist-vs-src sweep over all 16 plugin packages | **13 of 16 differ** semantically |

The bundle patch loads the artifact, not the source:

```
packages/mpd-bundle/cordis.patch.yml:146
  name: '@mpd-dsh/mpd/packages/mpd-dsh-adapter-plugin/dist/index.js'
```

## Mechanism

1. `7a8d245` grew the adapter's surface with a live-session plane (`liveAgents`, `liveAgent`,
   `compactionEngineForAgent`, `onEvent`) and made `mpd-team-compact-plugin` reach it through
   `ctx.get("mpdDsh")` — the MOUNTED adapter row. Its own inlined copy of the adapter is only
   a fallback, so a fresh plugin dist cannot rescue a stale mounted artifact.
2. The adapter's `dist/index.js` was **never rebuilt**, so the artifact the row loads still
   carried the pre-`7a8d245` surface (11 capability keys; the source has 15).
3. `mpd-team-compact-plugin/src/index.ts:321` calls `dsh.liveAgent(member.id)` and line 384
   calls `dsh.compactionEngineForAgent(...)`. With the stale artifact both are `undefined`,
   so the tool did not degrade — it threw.

Every other plugin whose dist inlines the adapter (13 packages) carried the same stale copy:
`bun build` bundles `../mpd-dsh-adapter-plugin/src/index.ts` into each dist, so one changed
dependency invalidated 13 artifacts at once.

## RED / GREEN (executable, `raw/adapter-seam-repro.mjs`)

The driver boots the REAL plugin entry against a chosen adapter artifact, over a real team
fixture in a fresh temp workspace, and runs the registered `mpd_team_compact_run`:

| Verdict | Artifact | Measurement |
|---|---|---|
| **RED** | `raw/adapter.dist.stale.mjs` (the shipped dist, extracted from `HEAD`) | `capabilities` = 11 keys; `typeof dsh.liveAgent = undefined`; tool outcome `{"ok":false,"error":"dsh.liveAgent is not a function. (In 'dsh.liveAgent(member.id)', 'dsh.liveAgent' is undefined)"}` |
| **GREEN** | `packages/mpd-dsh-adapter-plugin/dist/index.js` (rebuilt) | `capabilities` = 15 keys; `typeof dsh.liveAgent = function`; tool outcome `{"ok":true,..."outcome":"not-live","refusedReason":"no live member Agents in this process..."}` |

Mount-level twin (`bundle-lifecycle`, isolated DSH_HOME + sandbox HOME + sandbox workspace,
installed layout): the boot's own probe line moves from an **11-key** capability surface to a
**15-key** one — `mount-before-after.json`. `TOOL_PARAM_SCHEMAS=52/52`,
`TEAM_COMPACT_TOOLS=2/2`, `roles-probe] PASS` in both.

## Fix

Rebuild every dist that inlines the adapter, with the canonical command run from the repo root
(the form that reproduces the committed banner and is byte-identical for an already-fresh
package — verified against `mpd-team-compact-plugin`):

```
bun build packages/<pkg>/src/index.ts --target node --format esm --outfile packages/<pkg>/dist/index.js
```

13 packages rebuilt: `mpd-bootstrap`, `mpd-boulder`, `mpd-codegraph`, `mpd-comment-checker`,
`mpd-config`, `mpd-dsh-adapter`, `mpd-hashline`, `mpd-memory`, `mpd-modelchain`, `mpd-roles`,
`mpd-tools`, `mpd-ulw`, `mpd-workmate`.

## Gate sweep (after the rebuild)

| Gate | Result |
|---|---|
| dist-vs-src sweep (all 16 plugin packages) | 16/16 MATCH |
| `bun test packages` | PASS (399 pass / 0 fail) |
| `bun run typecheck` | PASS |
| `bun run test:qa` | PASS (all self-tests) |
| `node scripts/verify-vendor.mjs` | PASS (no `skills/**` or vendored asset touched → no re-pin) |
| `bundle-lifecycle` (MOUNT, installed layout) | PASS — `roles-probe] PASS`, `TOOL_PARAM_SCHEMAS=52/52` |
| `preset-conformance` (MOUNT, real session create) | PASS — `sessionCreate` 200 with `agentPreset: mpd`, negative control RED |
| `preset-register` (MOUNT) | **PRE-EXISTING failure, unrelated** — `SKILLS=25 BUNDLED=19`: the case does not sandbox `HOME`, so the real `~/.agents/skills` (6 skills) leaks into its boot. The fix belongs to `skills/dsh-qa/**`, which invalidates the corpus `treeSha` in `VENDOR_LOCK.json` and therefore needs its own re-pin — deliberately NOT folded into this change. |

## Honest limits

* The mount boot's `compaction` / `compactionForAgent` flags stay `false` INSIDE the QA probe,
  because that probe's own ctx registers no compaction service. The artifact-level truth is the
  `typeof` measurement in the driver, which is why the driver exists rather than a probe line.
* No live provider round-trip was driven (the sandbox has no provider credential); the failure
  and its repair are measured at the seam the tool actually calls.
* The repo has no build-all script, and no gate compares a dist against its source: this defect
  class can recur on any adapter change. A `dist-vs-src` check is the missing gate; it is NOT
  added here (a QA-script change carries its own `VENDOR_LOCK` re-pin).
