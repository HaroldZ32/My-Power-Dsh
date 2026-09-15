# t5 — bundle-level admission manifest + dsh-tui composition (result)

Task: `t5` (implementation, Deep Worker) — "Ship the bundle-level `dsh-plugin.json` admission
manifest and the dsh-tui profile composition".
Measured 2026-09-15 (UTC) against `@deepseek-harness-tui/dsh-tui@0.10.1` + the installed
`dsh 0.1.5-rc.1` CLI / `0.1.5-rc.2` packages, in an isolated sandbox
(`DSH_HOME` + `HOME` + pnpm/npm caches inside the workspace).

## Deliverables

| Deliverable | Path | State |
|---|---|---|
| ONE bundle-level admission manifest | `dsh-plugin.json` | new |
| TUI row in the bundle patch (`mpd-tui`) + the dsh-tui roster default | `packages/mpd-bundle/cordis.patch.yml` | edit |
| Row-parity coupling (see "Out-of-scope edit") | `scripts/install-profile.mjs` | edit (disclosed) |
| Per-package TUI compatibility ledger | `evidence/tui/composition/20260915T053445Z/ledger.json` + `ledger.md` | new |

## Acceptance status

1. **Manifest validates on the host's own admission path — PASS.**
   *Static*: `raw/admission-static.mjs` drives the vendored `@dsh-std/manifest` parser **and**
   dsh-TUI's own `createContractIndex` / `validatePlugin` / `negotiate` (pinned upstream modules,
   not a re-implementation) → `parse: ok`, `validatePlugin: ok`, negotiation
   `waiting_authorization (PERMISSION_NOT_GRANTED: session.input.intercept@tui/input,
   session.rewind.intercept@tui/rewind-prompt, session.switch.intercept@tui/session-switch,
   session.compact.intercept@tui/compact)` — one of the five documented admission states, not a
   parse error (`raw/admission-static.json`, input digests included).
   *Live*: `/plugins check /root/dshProj/my-power-dsh/dsh-plugin.json` inside the running TUI
   prints the same negotiation result **and** the grant hint naming **our** id
   (`"com.mpd-dsh.mpd-tui"`), which only the host's own parse+projection+validation path can
   produce (`raw/plugins-check.pane.txt`, `raw/tui-pane.log`), re-run on the FINAL manifest after the
   conventions-ruling edit (`raw/final-plugins-check.pane.txt`, `raw/tui-final-pane.log`).
   *Falsifiability*: the same live check run against `raw/control-no-decision-permissions.json`
   (manifest minus the four intercept permissions) prints `协商结果：compatible`, and against
   `raw/control-broken.json` prints `不是可解析的 JSON：… Expected double-quoted property name…`
   (`raw/control-*.pane.txt`). So `compatible`, the auth-pending state and the parse-error branch
   are all reachable and distinguishable; `waiting_authorization` is caused exactly by the four
   declared default-deny intercept permissions (no grant store exists, and host admission is
   unreachable for a profile-installed plugin — NOT CLAIMED W-1).
2. **Only implemented capabilities are declared — PASS.**
   `permissions: []`-equivalent claims: the four declared permissions are the decision-event
   intercept permissions, declared **only** under the optional `tui.dsh/v1alpha1#DecisionEvents`
   requirement whose `fallback` is a written TUI-visible degradation (the host enforces this:
   removing the fallback makes `validatePlugin` throw `optional protocol requires a TUI fallback`
   — `raw/admission-static.json` control). `contributes.commands` is `[]` and `subscriptions` is
   `[]` because the plugin registers no host Command and subscribes to no registry event (the
   seven UI surfaces bind through the host's runtime `tui*` service seams, which v0.15 does not
   mediate through a manifest contribution — written out in the manifest's `x-mpd-tui-surfaces`
   disclosure and in `ledger.json`). Structural assertions in `raw/admission-static.json`:
   `hasProvides: false`, `hasRequiresServices: false`, `facets: ["host"]`,
   `manifestVersionMatchesPackageJson: true`, `entryExists: true`.
3. **The bundle composes under the dsh-tui profile — PASS.**
   `dsh.profile.bundles = ["@deepseek-ai/dsh-base","@deepseek-harness-tui/dsh-tui","@mpd-dsh/mpd"]`
   (`raw/dsh-tui-profile.package.json`); the host's own composed config carries our 24 rows incl.
   `mpd-tui` (`raw/dsh-tui-dump-config.txt`, `raw/row-id-composition.json`); two live TUI boots and
   one live turn-log scan show **0** hits for every apply-crash signature and for
   `duplicate loader entry id` (`raw/boot-scan.json`); the web composition composes with 0 duplicate
   ids and our new TUI-side id-target skipped (one benign `patch: entry "dsh-tui-agent-presets" not
   found` warning) (`raw/web-dump-config.txt` / `.err`).
4. **TUI sessions default to the `mpd` preset — PASS (measured, not read).**
   Session records in the sandbox store (13 at the last rebuild): the three sessions created
   **before** this change recorded `agentPreset: "standard"` (03:54:25Z / 03:58:36Z / 03:59:52Z — the
   state the captain's recon already flagged in §6); **every** session created after it records
   `agentPreset: "mpd"` (05:40Z onward) — `raw/session-evidence.json` + the durable bounded excerpt
   `raw/session-record-excerpt.json` (path, sha256 and decoded header line per session record).
   **Captured TUI screen** (the strongest form): the host's own `/preset` picker, driven in the final
   live boot, renders `❯ MPD (Main Working Agent)（默认） ✓` — the host itself marks mpd as the active
   default (`raw/final-preset.pane.txt`; the marked line is extracted machine-readably into
   `raw/boot-scan.json` → `presetScreen.activeDefaultLine`). The fix is in this task's scope: the `agent-presets` id-target
   could never land in a dsh-tui composition (no layer inserts that id; only dsh-web-app does), so
   the TUI's own roster row `dsh-tui-agent-presets` (stock `default: standard`) is now id-targeted
   with the same two keys (`default: mpd` + the bundle's own `presets/` root), with its `disabled`
   expression untouched. Cross-check: the gate `preset-conformance` independently created a live
   session and recorded `agentPreset: "mpd"` with `bootLog.signatures: []`.
5. **Ledger lists all ~25 packages with usable/inert/web-only + the proving observation — PASS.**
   `ledger.json` (25 packages: usable 22, inert 2, web-only 1) with an explicit `observationKinds`
   taxonomy; each package carries the observation that proves it — live tool-list attribution from a
   recorded `request/header.tools[]` (96 tools; 39 `mpd_*`, 17 `agent_teams_*`, 14 `mcp__*`), the
   package's own apply-time log line, the host's composed-config row, or a source read for the
   web-only face. `ledger.md` is the readable table. **F7 (t15 review) — observe, do not infer:** the
   ledger declares its classification semantics and marks **19 of 25 packages exercised**; the six it
   could NOT exercise are listed with the plain reason (`ledger.json.notExercised`, `ledger.md`
   "NOT exercised in this lane (and why)"): the composition layer itself, mpd-tools-plugin (needs a
   write-tool call to witness its guard), mpd-mcp-gitbash (row `disabled: true`, so nothing ran),
   mpd-qa-roles-probe (never composed outside a QA overlay), mpd-mcp-shared (library, witnessed only
   through the MCP children that import it), and mpd-bundle-plugin, whose web-only classification is a
   recorded NEGATIVE observation (0 hits for `better-sidebar` / `registerTab` / `floater` in the live
   TUI logs, and no tool or skill from it in the live counters).

## Host reservations checked against `TUI-CONVENTIONS.md` §(e)

| Reservation | What this task's artifacts do | Evidence |
|---|---|---|
| No `DSH_TUI_*` variable claimed | the manifest claims none; the only reads under that namespace are the host's own (the plugin's debug gate reuses the host's `DSH_TUI_DEBUG`, which the host source itself reads 4x) | grep over `dsh-plugin.json` + the evidence tree; `raw/boot-scan.json` → `hostReservationCrossCheck.dshTuiEnvClaims` |
| No built-in command name | `contributes.commands: []` — no command is claimed, so no refused registration is possible | `raw/admission-static.json` (`commands: []`); live counters 93 tools / 18 skills, no refusal attributable to the bundle |
| ONE `/settings` owner per namespace | this manifest claims NO settings namespace (NAMESPACE_CONFLICT is impossible from it); the plugin's own section namespace is `mpd`, never the host's `dsh-tui` | `raw/boot-scan.json` → `hostReservationCrossCheck.settingsNamespace`; `packages/mpd-tui-plugin/src/settings.ts` (`SETTINGS_NS = "mpd"`) |
| No reserved theme name | the plugin's theme asset is `mpd-tui`, not `auto`/`light`/`dark`/`dark-ansi`/`status` | `raw/boot-scan.json` → `hostReservationCrossCheck.themeName`; `packages/mpd-tui-plugin/themes/mpd-tui.json` |
| Optional services soft-probed | every seam is a `ctx.get(id, false)` probe that degrades with a message | four live boots with 0 apply-crash signatures and all seven seams present |
| Ecosystem identity convention | **deliberately deviated** (D4/D5/D6) and now encoded in the manifest itself: `@mpd-dsh/mpd-tui` (not `@dsh-tui-ecosystem/*`), licence SUL-1.0 (not MIT), ONE bundle-level manifest at the repo root (not one per package) | `dsh-plugin.json` → `x-mpd-tui-surfaces.identityDeviation` |

§(e) status-key note (informational, t4's surface, reported not edited): the plugin's status key
constant is `mpd` (the host key regex is satisfied); the conventions checklist words it `mpd-tui`.

## Verify commands (all run on the current revision; logs in `raw/`)

| Command | Result |
|---|---|
| `bun run typecheck` | exit 0 (`raw/verify-typecheck.log`) |
| `node scripts/verify-rows-parity.mjs` | exit 0 — 24 row ids match the patch insert list, `mpd-tui` included (`raw/verify-rows-parity.log`) |
| `node skills/dsh-qa/scripts/preset-conformance.mjs` | PASS — conformance ok, parity 31/31, live session `agentPreset: "mpd"`, `bootLog.signatures: []`, negative control red (`raw/verify-preset-conformance.log`; the gate wrote its own evidence under `evidence/dsh-qa/preset-conformance/2026-09-15T05-50-49.514Z/`) |
| `R11` (added to the plan after this task started; the row this task added is the row under test) | exit 0 — `R11 ok: 16 patch rows present in pack-mpd PLUGIN_PKGS` (`raw/verify-R11.log`). `scripts/pack-mpd.mjs` was edited by **another writer** (the plan-amendment task), never by t5. |

## Out-of-scope edit (disclosed)

`scripts/install-profile.mjs` gained the matching `mpd-tui` row. Reason: the plan's AC-3 assigns
"row parity holds" to **t5**, and `scripts/verify-rows-parity.mjs` (one of this task's three verify
commands) compares the bundle patch's `- insert:` id set against the installer's row list — adding
the row to the patch alone turns that gate red (`MISSING from scripts/install-profile.mjs: mpd-tui`).
The edit is one mechanical row, identical to the patch row, and both gates are green with it. The
captain may amend `t5`'s `inScope` to include it, or move the row to another task.

## Disclosed limits of this measurement

- `packages/mpd-tui-plugin` was **still being written by t4** while this task measured (the package
  went from a 15-line stub to a 13.5 kB source / 93 kB dist during the run). The composition,
  manifest, roster and ledger facts do not depend on the plugin's internals; the measured hashes are
  pinned in `ledger.json.revision`, and the **rendering** verification of the seven seams belongs to
  the panels lane (AC-4 / t8) and the seam audit (t10).
- The live lane's model call failed with `no API key for provider route "deepseek-official"` (the
  sandbox carries no route key; credentials were copied in for the attempt). The tool-list evidence
  comes from the recorded `request/header`, which the harness writes before the request — never from
  model prose.
- In this sandbox the CodeGraph project is excluded (the workspace path contains `.mpd`), so
  `mpd-mcp-codegraph` contributed 0 tools here while its row and server stayed alive.
- The TUI's own state in the sandbox pins the session workspace to the repo path, so the live lane
  wrote session/usage state into the sandbox `DSH_HOME` but the *workspace* was the checkout (the
  same condition the captain's recon boots had); no source file outside the changed paths was
  touched.

## Evidence index

| Artifact | What it shows |
|---|---|
| `raw/admission-static.json` / `.mjs` | host parser + projection + validatePlugin + negotiate on the manifest, with input digests and four falsifiability controls |
| `raw/plugins-check.pane.txt`, `raw/plugins-descriptor.pane.txt`, `raw/final-plugins-check.pane.txt` | live `/plugins check` (first capture, host descriptor, final-manifest re-run) |
| `raw/final-preset.pane.txt`, `raw/final-preset-closed.pane.txt`, `raw/final-boot.pane.txt` | the host's own `/preset` picker showing mpd as the active default, plus the final boot pane |
| `raw/tui-final-pane.log`, `raw/tui-boot-final.sh` | raw log + the self-contained final live lane script |
| `raw/control-*.json`, `raw/control-*.pane.txt` | live controls: `compatible` without the intercept permissions; parse error on broken JSON |
| `raw/tui-boot.sh`, `raw/tui-boot-controls.sh`, `raw/tui-boot-turn.sh` | the three self-contained tmux lanes (one process each, never a pipe) |
| `raw/tui-pane.log`, `raw/tui-turn-pane.log`, `raw/tui-controls-pane.log` | raw ANSI logs of the live lanes |
| `raw/boot-scan.json` | crash-signature counts, per-package apply lines, live counters (93 tools / 18 skills) |
| `raw/tool-list.json` | the recorded live session's tool list, grouped by tool family |
| `raw/session-evidence.json` | every sandbox session with its `agentPreset` (the before/after preset proof) |
| `raw/session-record-excerpt.json` | durable bounded excerpt of each session record (path + sha256 + decoded header line) |
| `raw/dsh-tui-dump-config.{txt,err}`, `raw/web-dump-config.{txt,err}`, `raw/row-id-composition.json` | host-composed rows + duplicate-id accounting for both profiles |
| `raw/dsh-tui-profile.package.json`, `raw/dsh-tui-profile.cordis.patch.yml` | the installed profile that produced the live evidence |
| `raw/dsh-plugin.json.snapshot`, `raw/bundle-cordis.patch.yml.snapshot` | the exact sources measured |
| `ledger.json`, `ledger.md` | AC-12 deliverable (all 25 packages) |
| `raw/verify-*.log` | the three contract gates |
