# mpd-qa-roles-probe

**English** | [中文](./README.zh-CN.md)

QA-only probe plugin (never shipped in the bundle): mounted by QA overlays
(`tests/overlays/roles-probe.yml`) to assert in a real boot that (1) the `mpd` preset
resolves without a broken mount and (2) the `mpdRoles` roster answers with the full 11-role
specialist roster. Exits non-zero on failure so the QA case catches regressions.

## What it does

It reads every harness seam through the bundle's shared adapter
(`createDshAdapter` / the mounted `mpdDsh`) and prints one greppable line per subject:
`PRESET_MPD=ok|broken|fail` + `PRESET_RESOLVE_POLLS` + `PRESET_PATH` + `ADAPTER_SEAMS` +
`ADAPTER_TOOL_CALL` + `ROSTER` / `ROSTER_NAMES` + the AgentTeams tool-registration
instrumentation + `TOOL_PARAM_SCHEMAS` + `SKILLS` / `SKILL_FIXTURE`, then a final
`PASS|FAIL` line that sets the process exit code.

**The preset resolve is a bounded POLL, not a single read (0.1.7-rc.2 row model).** The
deployment default is `agent-preset-registry`'s `config.default` and the preset itself is
the `@deepseek-ai/dsh-agent-preset` row whose `config.id` matches, so `resolve("mpd")` reads
the registry's LIVE definition map — and that map is populated when the `preset-mpd` ROW
APPLIES, which the loader does concurrently with this overlay-inserted probe row. A single
immediate read therefore races the row it asks about (measured 2026-09-27:
`PRESET_MPD=fail:Unknown agent preset: mpd` while every other boot assertion was green);
only the registry's `not-found` answer is retried, inside a short budget, and
`PRESET_RESOLVE_POLLS` reports how many attempts it took.

`PRESET_PATH` names the artifact that now SERVES the preset: the bundle patch that declares
the row (`<bundle>/presets/mpd.patch.yml`), derived from the probe's own installed location,
with `trust=bundle`. The retired directory model's `path`/`trust` fields no longer exist on
a preset record, so a resolver that returned them would be inventing them.

## Usage

Used by `skills/dsh-qa/scripts/bundle-lifecycle.ts` (the boot sub-assertions
`probePass` / `presetProbeOk`), `skills/dsh-qa/scripts/preset-register.ts` and
`skills/dsh-qa/scripts/relocate-smoke.ts`. Building:

```bash
bun build packages/mpd-qa-roles-probe/src/index.ts --target node --format esm --outfile packages/mpd-qa-roles-probe/dist/index.js
```
