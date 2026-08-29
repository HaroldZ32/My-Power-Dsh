# mpd-qa-roles-probe

**English** | [中文](./README.zh-CN.md)

QA-only probe plugin (never shipped in the bundle): mounted by QA overlays
(`tests/overlays/roles-probe.yml`) to assert in a real boot that (1) the `mpd` preset
resolves unmounted-broken and (2) the `mpdRoles` roster answers with the full 11-role
OMO roster. Exits non-zero on failure so the QA case catches regressions.

## What it does

`inject: ["agentPresets"]`; on apply it resolves the `mpd` preset and prints
`PRESET_MPD=ok|broken|fail` + `ROSTER=<ids…>`, then sets the process exit code.

## Usage

Only used by `skills/dsh-qa/scripts/preset-register.mjs`. Building:

```bash
bun build src/index.ts --target node --format esm --outfile dist/index.js
```
