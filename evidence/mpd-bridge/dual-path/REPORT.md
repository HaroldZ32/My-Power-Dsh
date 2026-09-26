# t38 — dual-path independence and sharing (Reviewer, attempt 1)

**Verdict: PASS** — the user's requirement holds: ONE bundle installs and runs independently in a web
profile and in a TUI profile, and with both installed in ONE DSH_HOME they share configuration,
presets/agents, the skill corpus and the workspace state. Two low findings, both documentation-level.

Sandbox: `evidence/mpd-bridge/dual-path/sandbox/` — ONE `dshhome`, ONE `home`, ONE `ws`.
Artifacts: `raw/{install.log,dump-web.txt,dump-tui.txt,dual-path.result.json,web-default-preset.json,tui-1/,tui-2/,boot-web.log,boot-web-default.log}`.

## Acceptance, with the measurement behind each row

**1. One DSH_HOME, two profiles, independent install AND run — PASSED.**
Installed with the official one-command flow (`dsh plugin --profile <p> add <repo root>`, `--store-dir`
inside the sandbox):

| profile | `dsh.profile.bundles` |
|---|---|
| `w` (web) | `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","@mpd-dsh/mpd"]` |
| `dsh-tui` | `["@deepseek-ai/dsh-base","@deepseek-harness-tui/dsh-tui","@mpd-dsh/mpd"]` |

Both `--dump-config` runs exit 0. Boots: the TUI profile booted twice (tmux, pane captured) and the web
profile twice (HTTP), and **all four boots carry ZERO apply-crash signatures**; the web boot's own
bundle route answered `200` (`/plugins/mpd-workmate/list`), i.e. the bundle's web half is really alive.
Each profile boots without the other front door's host package installed in its own layer.

**2. Neither profile needs the other's host — PASSED, and non-fatal by boot result.** The two id-targets
land one per plane and the other is skipped with the documented line, quoted verbatim:

- web: `patch: entry "dsh-tui-agent-presets" not found`
- tui: `patch: entry "agent-presets" not found`

and both profile boots afterwards exit 0 with zero crash signatures — the skip is proven non-fatal by
the boot, not asserted from prose. The composed row sets confirm the split: the web dump has
`id: agent-presets` (1) and no `dsh-tui-agent-presets`; the TUI dump has exactly the inverse; **both**
carry `default: mpd` and the bundle `mpd/presets` root.

**3. Sharing, from both front doors — PASSED.**

| surface | evidence |
|---|---|
| (a) preset + roster bundle-served | both profiles list the bundle layer and both dumps show `default: mpd` + the `<bundle>/presets` root; no per-profile copy exists |
| (b) skill corpus served | both boots log `[mpd-bootstrap] skill corpus served from /root/dshProj/my-power-dsh/skills` |
| (c) one workspace file, two doors | seeded `<ws>/.mpd/mpd.jsonc` with `hashline.maxDiffChars: 35000` (non-default); the web plane's own `settings/mutate` response carried `base.hashline.maxDiffChars = 35000` — the namespace's inherited value IS the file value, not the schema default 20000 |
| (d) one settings document + cross-door edit | `settings.yaml` at `<sandbox>/dshhome/settings.yaml`, created by the web door's edit (sha256 `caa38c966f16e95f…`, content `mpd.hashline.maxDiffChars: 31415`). Then the **TUI** profile's next boot wrote that value through to the shared workspace file: it now reads `"maxDiffChars": 31415` (sha256 `38abf9690296c826…`) **with the human comment, key order and trailing comma intact**, where the fixture had 35000 |
| (e) HOME-scoped + workspace-scoped state | the TUI pane's status line reports `workmates 1` from the seeded `~/.mpd/workmate/t38-shared` in the SHARED HOME; `.mpd/memory.json` lives in the shared workspace |

**The (d) chain is the strongest single result**: a value written through the WEB door's
`settings/mutate` reached the TUI plane's write path and landed in the one workspace file both doors
read — one settings document, one durable file, two front doors, comment preserved.

**Preset resolution from REAL sessions (not config prose):** both TUI boots produced session records
with `agentPreset: "mpd"` (cwd = the shared workspace, one project key). For the web plane I created a
session **without** any `agentPreset` in the request; its record resolved to `agentPreset: "mpd"` — so
mpd is the web plane's default by the plane's own resolution, not by my request.

**4. Boundaries, by mechanism — PASSED (stated, not disclaimed).**

- **Workspace-scoped** (`<workspace>/.mpd/**`): `mpd.jsonc`, `memory.json`, team/plan/boulder state.
  Shared BY CONSTRUCTION whenever both doors run in the same workspace — and the durable projection of a
  settings edit. This is what makes the two doors converge.
- **HOME-scoped** (`~/.mpd/workmate`): the user's cross-project workmate library. Shared across profiles
  of ONE user (same `HOME`), distinct for two users.
- **DSH-HOME-scoped** (`$DSH_HOME/settings.yaml` and `$DSH_HOME/mpd.jsonc`): the host settings document.
  Shared only when both profiles live in the same DSH home — and they do in this measurement.
- **Bundle-scoped**: presets/roster and the skill corpus are served from `<bundle>/…`, so they are shared
  by both doors *because they are the same install*, independent of any home.

**5. Gaps — reported as findings, not absorbed.** See below.

**6. Scope — PASSED.** Every artifact of this task is under `evidence/mpd-bridge/dual-path/`; no
`skills/**` file was written by me (the modifications visible in `git status skills/` are other
members' wave edits, read-only from my side).

## Findings

| id | severity | problem | requiredFix |
|---|---|---|---|
| D1 | low | **Separate DSH homes do not share the settings document.** `settings.yaml` is DSH-HOME-scoped, so a user who installs the web plane in one home and the TUI plane in another has TWO settings documents; a settings edit in one is invisible as a settings value to the other. The DURABLE state still converges, because the write-back target is the WORKSPACE file and both doors write the same one (measured: the file is workspace-scoped and the value crossed doors in one home). | State this explicitly in the user-facing docs (bilingual pair, same commit): "same DSH home ⇒ the settings document is shared; separate homes ⇒ the settings values differ but the workspace `.mpd/mpd.jsonc` still converges". |
| D2 | low | **The skills corpus tree hash moved again** since t35: `308/930bda503aa1` → `308/b0fac3bdea44` → now `310/8ec53287296e` (lock side unchanged at `307/ba0c39228896`). The wave's single owed re-pin is still owed and the corpus is still being edited. | One skills writer, one re-pin in the same commit as the change that invalidated the `treeSha` (AGENTS §9/§11). Not a defect of this task. |

**Observation (not a finding), recorded so the next reviewer is not misled:** the web RPC envelope is
`{type, rpcId, result:{ok, value}}` — the payload lives at `result.value.*`, not `result.*`. My first
extraction read `result.*` and returned nulls; that was my own envelope-path mistake, NOT a product gap.

**Independent witnesses named (the acceptance's ask):** for the web plane,
`skills/dsh-qa/scripts/bundle-lifecycle.mjs` (bundle mounted, no home copy, layer durability, clean
uninstall) plus this task's own `--dump-config` + HTTP boot; for the TUI plane,
`skills/dsh-qa/scripts/tui-mount.mjs` (pane evidence) plus this task's own two tmux boots. Nothing here
rests on a single run.
