# Health pass over `dev` — 2026-09-14

Scope: is the bundle in a runnable, shippable state, and what is not yet on `dev`? Run from the
repository root in a workspace-write sandbox; every boot below happened in an isolated
`DSH_HOME` + sandbox `HOME` + sandbox workspace, never against the real `~/.dsh`.

Subject revision at the start of the pass: `dev` = `2b26b5b` (`merge(test/interjection-delivery-address)`),
with one unmerged local branch `fix/team-compact-param-schema` (`8d2edb1`) and a dirty tree of
evidence directories only.

## Verdict

**Healthy, after two repairs.** The product boots and mounts cleanly, every gate except one
pre-existing QA-case failure passes, and two defects found by this pass were fixed and are
committed with their evidence (see below). The two defects shared one root cause: commit
`7a8d245` grew the adapter's surface and left its own artifacts behind.

## Gates

| Gate | Command | Result |
|---|---|---|
| Vendor | `node scripts/verify-vendor.mjs` | PASS (commit/version/stats + all asset fingerprints) |
| Tests | `bun test packages` | PASS — 399 pass / 0 fail (was 398 / 1 before the mock repair) |
| Types | `bun run typecheck` | PASS |
| QA self-tests | `bun run test:qa` | PASS — all self-tests |
| Boot (MOUNT) | `bun skills/dsh-qa/scripts/bundle-lifecycle.mjs --no-skip` | PASS — install -> compose -> boot with HTTP + served corpus + served preset -> layer durability -> uninstall with no residue |
| Preset conformance (MOUNT) | `node skills/dsh-qa/scripts/preset-conformance.mjs` | PASS — 30 rows conform, row parity 31/31, `sessionCreate` 200 with `agentPreset: mpd`, negative control RED |
| Preset register (MOUNT) | `bun skills/dsh-qa/scripts/preset-register.mjs --no-skip` | **FAIL — pre-existing, unrelated** (below) |
| dist-vs-src sweep | fresh `bun build` of every package, diffed against its committed dist | 16/16 MATCH (13 of 16 differed before this pass) |

## Findings

### F1 — the shipped adapter artifact could not serve the live-session plane (BLOCKER, fixed)

`mpd_team_compact_run` — the newest shipped feature — threw
`dsh.liveAgent is not a function` in every session mounting the row, because the bundle patch
loads `packages/mpd-dsh-adapter-plugin/dist/index.js` and that artifact was never rebuilt after
`7a8d245` added `liveAgents` / `liveAgent` / `compactionEngineForAgent` / `onEvent` to its
source. `bun build` inlines the adapter source into every plugin dist, so 13 artifacts were
stale. Fixed by rebuilding all 13; RED/GREEN driver, mount before/after and the full gate sweep
are in `evidence/fix/adapter-livesession-rebuild/2026-09-14T05-38-01.791Z/`.

Why no gate caught it: `bun test` exercises SOURCE, `--dump-config` exercises COMPOSITION, and
the mount gate exercises the PLUGIN's own dist — the stale object was the ADAPTER artifact that
the plugin resolves at call time. This repository has **no gate that compares a dist against its
source**, so the class can recur.

### F2 — the adapter's full-harness unit mock was stale (suite red, fixed)

`mpd-dsh-adapter-plugin` › `capabilities` › `"reports every seam of a full harness"` failed
because `fakeHarness()` never gained the `agents` / `compaction` seams the adapter added. Test-only
repair; evidence in `evidence/fix/adapter-capabilities-mock/2026-09-14T05-35-42.527Z/`.

### F3 — `preset-register` fails, and it is the CASE that is wrong (open, pre-existing)

`SKILLS=25 BUNDLED=19` -> the probe's "every served skill is bundled" rule fails. The case does
not sandbox `HOME`, so the real `~/.agents/skills` (6 skills: `agent-native-design`, `drawio-skill`,
`find-skills`, `imagencn`, `plantuml-skill`, `tldraw-skill`) leaks into its boot. Re-measured with
the pre-change probe build: same numbers, same verdict — not caused by this pass. The remedy lives
in `skills/dsh-qa/**`, which invalidates the corpus `treeSha` in `VENDOR_LOCK.json` and therefore
needs its own re-pin under the single-skills-writer rule; it is deliberately left open rather than
folded into an unrelated change.

## Environment

`dsh 0.1.5-rc.1`, node `v24.16.0`, bun `1.3.14`. The live Web profile links the checkout
(`"@mpd-dsh/mpd": "link:/root/dshProj/my-power-dsh"`) and the GUI answers on `127.0.0.1:3080`
(HTTP 401 = the auth gate, i.e. the host is up). `dsh --profile web --dump-config` cannot be run
from this sandbox (the real `~/.dsh` is read-only here: `EROFS`), which is why every composition
claim above comes from a real mounting boot instead.

## Not verified here

* No live provider round-trip: the sandbox carries no provider credential, so no LLM turn was
  driven (`MISSING_CREDENTIAL`). The tool-level repair is anchored on the seam the tool calls.
* The running GUI process still holds the pre-repair modules in memory: ESM caches what a session
  loaded at start (AGENTS.md §12), so the adapter repair takes effect for a **new** `dsh` process
  / a restarted session, not for the session that was already running.
