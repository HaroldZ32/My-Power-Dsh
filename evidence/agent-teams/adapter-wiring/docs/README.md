# Docs lane (team task t7 / contract lane t5) — the CLOSED §6 exception, stated bilingually

Seat: Lead (worker) · wave: w1 · team: `agent-teams-adapter-wiring`
Authority: `evidence/agent-teams/adapter-wiring/requirements-contract.md` §7 **AC9**, §9 residuals
R1–R5, §11 E1/E5, and the task contract's nine acceptance items.
Order honoured: run AFTER the bridge lane (team t5) and the guard lane (team t6) landed; every
number below was MEASURED at landing time, never copied from a sibling lane's message.

## What changed (six files, nothing else)

| File | Change |
|---|---|
| `AGENTS.md` | §6: "One documented exception" REPLACED by "The adopted-plugin exception is CLOSED (2026-09-19)" — the bridge `lib/mpd-adapter-ctx.js`, the six bridged files, the FOURTEEN adapter methods, the R1–R5 residuals, the counted `members.js` bypass, and the guard lane's create rule; the vendor-refresh risk paragraph is kept with the bridge-restore sentence added. §1: the adoption bullet gains the seam clause (the namespace exception is about plugin ids/tool names ONLY). |
| `docs/design.md` | §0b principle 2 and §6b: the "Boundary: … NOT routed through the adapter" bullet replaced by "Adopted-plugin seam routing (the former boundary — CLOSED 2026-09-19)". |
| `docs/design.zh-CN.md` | The same two places, in 简体中文 (bilingual rule). |
| `agent-references/agent-teams-deltas.md` | The count sentence's NUMBERS moved (123/10 → 151/13) with its wording untouched; a forward pointer; the adapter-wiring-wave paragraph (bridge, six files with region ids, measured marker/entry counts, the four `agentTurn*` methods, the R1–R5 pointer); the creation rule + RULE A; the bridge DEVIATIONS D1–D7; the counted `members.js` bypass. No A1–D42 table row added. |
| `packages/mpd-dsh-adapter-plugin/README.md` | Wrapped-seams table gains the FOURTEEN method rows; the capability-flag list (incl. `agentTurnSteer` / `agentTurnInject`); the former "Boundary:" paragraph becomes the closed-routing statement. |
| `packages/mpd-dsh-adapter-plugin/README.zh-CN.md` | The same, in sync (heading tree, switch link, CJK). |

Untouched on purpose: `packages/mpd-agent-teams-plugin/README.md` / `README_ZH.md` (VERBATIM
provenance) and every path under `skills/**` (a skills edit forces a corpus re-pin, AGENTS.md §9).

## The measurement the docs transcribe

Command (the contract's own verify command), repo root:

```
node -e "import('./packages/mpd-agent-teams-plugin/lib/mpd-deltas.js').then(m=>console.log(m.MPD_DELTAS.length, new Set(m.MPD_DELTAS.map(d=>d.file)).size))"
```

Output at 2026-09-19T15:10:19Z: `151 13` (raw: `registry-count.log`). The fuller derived reading —
the adapter-* marker scan, the per-file region ids, the fourteen methods, the thirteen flags and the
five `childCtx` residual lines — is `node evidence/agent-teams/adapter-wiring/docs/measure-counts.mjs`
(`measure-counts.log`):

- registry: **151** entries / **13** files, entry keys `file,id,beforeContext,afterContext,block`,
  ZERO `create` keys;
- the six bridged files carry **27** `adapter-*` markers / **26** distinct ids
  (`adapter-subagent-runtime-import` is carried in BOTH `harness-compat.js` and `tools.js`);
- with the bridge's own `adapter-ctx-bridge`: **28 markers / 27 distinct ids**;
- all FOURTEEN methods and all THIRTEEN flags are present in
  `packages/mpd-dsh-adapter-plugin/src/index.ts`;
- `lib/members.js` carries exactly **5** `childCtx` residual lines (the counted bypass).

## Gates

| Command | Exit | Reading |
|---|---|---|
| `bun run verify:docs` | 0 | `pairs=38 failed=0 violations=0 … — PASS`; the derived adjudication prints `region-count claim checked: carried **151**/13 vs derived 151/13 … PER FILE … — agree` for all 13 files (`verify-docs.log`). BEFORE the fix the same gate was RED with exactly one violation: `claims **123** regions across **10** adopted files but … derives 151 regions across 13 files`. |
| `bun run verify:gates` | 0 | `PASS - 5/5 member gate(s) green` (`verify-gates.log`); the docs member prints the same 151/13 agreement, and the delta-range derivation still reads `A1–D42` from the table (no row added). |
| the `node -e` count command above | 0 | `151 13` (`registry-count.log`). |

## Residuals this lane had to respect (not invent)

- **R5** — the count sentence is matched by a FIXED regex
  (`/The live registry is \*\*(\d+)\*\* regions across \*\*(\d+)\*\* adopted files/`,
  `scripts/verify-docs-parity.mjs`); only the numbers moved, and the prose immediately after it
  explains the mpd-owned bridge module and RULE A.
- The closure claim NAMES its bypasses rather than overstating: R1–R5 in AGENTS.md §6 plus the
  five counted `childCtx` lines in `lib/members.js` (asserted by
  `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs`).
