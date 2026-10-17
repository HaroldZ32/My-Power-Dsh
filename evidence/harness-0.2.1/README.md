# evidence/harness-0.2.1 — lane G (wave verification) record

Wave: `.mpd/plans/harness-021-rollback.md` · Verdict: `VERDICT.md` (this directory).

## How to read this tree

Every run directory carries the UTC timestamp of the run in its name, and the verdict pass began after
the captain's integration commit `06b058148bcb5cac5149f03567fb3ebdce121282` (2026-10-17 ~14:13 UTC).
**Runs stamped earlier than that are PRE-WAVE BASELINES** — they were taken deliberately to make the
post-wave readings meaningful (a guard line that changes, a spawn that fails, a web boot with a
pending row). They are kept, not deleted, because the delta is the evidence:

| Slug | What it is |
|---|---|
| `f2-sandbox-boot/` | `f2-boot.ts` — boots `dsh` out of the 0.2.1 closure in three isolation layers, reads the roles row log + the `mpd-verify` row log + the registered tool list. **Pre-rebuild runs are baselines** (guards still installed); the `closure-2026-10-17T14-18-55.291Z` run is the verdict one. |
| `f2-persona-spawn/` | `spawn-probe.ts` — spawns ONE child and reads what ITS OWN log recorded. The CHILD is the session carrying `subagent/descriptor` (never a tool-list guess: `mpd_role_spawn` is visible to both sessions, which is how the first version mislabelled them); `request/header` tools are definition objects, so the name is `entry.name`; and the persona claim is asserted on the child's `system/message`, with `personaInPrompt` reported SEPARATELY (prompt text is what the old path did — a persona that only arrives there is a FAIL for the seam claim). Arms: `--arm roster` (read-only Explorer = deny expected; Junior Engineer = the writable control), `--arm workmate`, `--arm unlabelled` (the generic `subagent` tool). |
| `f2-live-guards/` | `probe.ts` — a headless top-level session reads a source path and writes a code path with no loop armed, from the harness session log. Also holds the `verify-law.ts` live run log. |
| `f3-gates/` | `run-gates.ts` — one evidence directory per gate under this slug's SIBLINGS (`<gate>/<stamp>/`), plus `summary.json` here. `bun-test-packages.log` and `test-qa-021.log` are the two 0.2.1-regime arms that the plain sweep cannot express with the installed 0.2.0 harness. |
| `f4-docker-source/` | `run-docker.ts` — runs the Docker lane with `MPD_E2E_DSH_VERSION=0.2.1-rc.2`, then quotes the CONTAINER's own `harness.installed/expected`, the `harness.version` raw, the resolved carrier versions and a cordis probe. |
| `lib/make-global-layout.ts` | The global-STYLE layout built from the closure (one copied `dsh` package + symlinks for the other 305 packages and the 245 non-harness deps). It exists because `preset-conformance`'s `harnessRoot`/`loadSchema` read `<harnessRoot>/node_modules/<pkg>/lib/index.js` — npm's global shape — which a hoisted install does not have (finding 5 in `VERDICT.md`). No network, no copy of the closure, machine global untouched. |
| `preset-conformance-selftest/`, `preset-conformance-live/` | The 0.2.1-regime conformance arms (self-test + the live web `session/create` on `agentPreset: "mpd"`). |
| `sandbox/` | Gitignored working area (`evidence/**/sandbox`). Holds the global-style layout and any `--keep`ed boot sandboxes; never part of a deliverable. |

## Regimes

The machine's global `dsh` is **0.2.0-rc.2** and was never touched (user ruling: no upgrade). Two
regimes therefore appear wherever a gate resolves the INSTALLED harness:

- **0.2.0 regime** (plain `bun run …` with the machine's PATH): the shipped harness is one release
  behind the wave, so `preset-conformance --self-test` legitimately reddens on the parity delta
  (`time-context`, `tool-schedule`, `tool-plugin-market`) and `bun run test:qa` reddens with it.
- **0.2.1 regime** (`PATH=evidence/harness-0.2.1/sandbox/global-layout-021/bin:$PATH`): both green.

`VERDICT.md` states which regime each row was observed in. A red in the 0.2.0 regime is not a wave
defect; it is the adaptation working as intended against a harness that has not moved.
