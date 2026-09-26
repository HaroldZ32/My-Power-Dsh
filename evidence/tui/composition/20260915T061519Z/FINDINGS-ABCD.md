# t2 plan-review findings A–D — status on the current revision

Verification pass ordered by the captain's message of 2026-09-15 (findings from `t2`'s plan review).
**None of the four required new product work — all four are already landed**; this pass re-ran every
gate and closed the two evidence gaps the findings exposed (C.2's host-preset-resolution proof and
D's explicit spec-data assertion). Every claim below names a raw artifact in `raw/`.

| # | Finding | Status | Evidence |
|---|---|---|---|
| **A** | Row parity goes red when the `mpd-tui` insert lands | **LANDED, GREEN** | `raw/gate-rows-parity.log` — `[verify-rows-parity] ok: 24 row ids match the bundle patch insert list … mpd-tui …`, exit 0; the installer mirror is `scripts/install-profile.mjs:176`; `raw/gate-AB.log` |
| **B** | Packed tree silently drops the new package | **LANDED, GREEN** | `scripts/pack-mpd.mjs:51` lists `"mpd-tui-plugin"`; R11 gate exit 0 — `R11 ok: 16 patch rows present in pack-mpd PLUGIN_PKGS` (`raw/gate-AB.log`) |
| **C** | AC-11 / D10 ("TUI defaults to mpd") would fail; nothing owned the fix | **LANDED, MEASURED IN BOTH PROFILES** | TUI: `raw/preset-roster-top.pane.txt` + `raw/preset-roster-bottom.pane.txt`; Web: `raw/web-dump-config.txt` / `.err`, `raw/gate-preset-conformance.log`; `raw/tui-dump-config.txt` / `.err` |
| **D** | Admission spec-data root (empty recon clone → "profile unavailable") | **DONE, ASSERTED** | `raw/admission-static.json` → `inputDigests.specDataResolved: true`, `specDir: <installed payload>/dsh-ecosystem-spec`, `registry: sha256:c3090dd129aadb06…` |

## C in detail (the important one)

**Mechanism chosen: the captain's option 2 — a second column-0 id-target for the TUI layer's own
roster row id `dsh-tui-agent-presets`** (not a guarded insert). Rationale: an `insert` of id
`agent-presets` would be a duplicate loader entry id in the web profile (fatal), and the loader's
duplicate check runs before any `disabled` evaluation, so a guard-style insert cannot be made safe.
A second id-target is structurally safe because each target id exists in exactly one composition.

**C.1a — TUI profile measured.** The captured `/preset` roster (scrolled to the first entry) lists,
in one roster: `标准模式` (standard), `PTC 模式` (ptc), `极简模式` (minimal), `创造模式` (cordis) —
**the HOST's four shipped presets, all still resolving** — plus `梁神模式` (third-party) and
`↓ MPD (Main Working Agent)（默认）✓` — ours, marked by the host as the **active default**. Session
records agree: the three sessions created before the fix recorded `agentPreset: "standard"`, every
session created after it records `"mpd"` (`…/20260915T053445Z/raw/session-evidence.json`).

**C.1b — Web profile measured.** Fresh composition (`raw/web-dump-config.txt`): **exactly ONE**
`agent-presets` row, carrying our override `default: mpd`; **0 duplicate ids among 201** top-level
rows; the sole stderr line is the benign `patch: entry "dsh-tui-agent-presets" not found` (the TUI
target degrading in the web plane). Live proof that the web/host plane really runs mpd:
`raw/gate-preset-conformance.log` → `[preset-conformance] PASS`, `sessionCreate … "agentPreset":
"mpd"`, `sessionHeader "agentPreset": "mpd"`, `bootLog.signatures: []`, negative control red. The
TUI composition is equally clean: `raw/tui-dump-config.txt` lines 480-492 show the overridden roster
row (`default: mpd` + the bundle's `presets/` root, `disabled` expression untouched), the `mpd-tui`
row is present, and there are **0 duplicate ids among 125**.

**C.2 — the whole-config replacement risk is disproven, not waved away.** The id-target replaces the
targeted row's entire `config`, so the stock expression (which returns `{default:'standard'}` for
packages that ship `presets/`, or `{default:'standard', roots:[<dsh>/config/agent-presets]}` for
legacy ones) was replaced by `{default: mpd, roots:[<bundle>/presets]}`. The captured roster proves
the host's shipped presets still resolve: the package prepends its own bundled root, so
`standard/ptc/minimal/cordis` come from the host and `mpd` from our added root. The deliberately
dropped part is only the **rc.2 fallback branch**, dead in the validated pin
(`@deepseek-ai/dsh-agent-presets@0.1.5-rc.2` ships `presets/{standard,ptc,cordis,minimal}`), which
the patch comment states explicitly.

**C.3 — not needed.** Coexistence is possible and measured, so nothing is claimed NOT-CLAIMED here.

## D in detail

`raw/admission-static.mjs` resolves the spec data through the host's own `loadSpecData()`
(walk-up from the installed module), and now records the resolution explicitly:
`specDataResolved: true`, `specDir = <node_global>/@deepseek-harness-tui/dsh-tui/dsh-ecosystem-spec`,
`registry = sha256:c3090dd129aadb06f87b56ad148dfbcec2ce4eed2404dda5eed9cf1dbae51f54` — the digest the
captain cited. The script still exits 2 with a named reason if `loadSpecData()` returns `undefined`,
so the recon clone (`.mpd/recon/dsh-TUI/dsh-ecosystem-spec/`, empty) can never produce a silent
"profile unavailable" pass. The same driver also still yields `parse: ok`, `validatePlugin: ok`,
negotiation `waiting_authorization` on the current manifest digest
`sha256:7701c48c066c528046d361752ff72671cc1093340260e144f8390345248fe7a7`.

## Process note

`t5` (completed by the captain after the inScope amendment) and `t22` (completed by Deep Worker) are
both terminal, and no open task covers this verification pass. The work was landed under those
tasks; this directory is the fresh evidence. If the captain wants it tracked, reopen `t5`/create a
task and this evidence stands as its artifact set.
