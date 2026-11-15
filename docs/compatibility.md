# Compatibility

**English** | [中文](./compatibility.zh-CN.md)

This page is the **three-plane compatibility matrix** of the `0.19.0` release: what each upstream plane
guarantees, what degrades on an older host, and what is **not available** there. Every line is traceable to
a gate run, a mounted boot in an isolated `DSH_HOME`, or a source of the upstream package named beside it —
never to a device, because this repository contains no Flutter host and no phone.

## 1. How to read this page

Three planes move independently, and the bundle adapts to each on its own terms:

| Plane | Minimum supported | Current target | Where the claim is asserted |
|---|---|---|---|
| DSH core (`@deepseek-ai/dsh`) | `0.2.1-rc.5` | `0.2.2-rc.2` | `package.json` `engines.dsh`, the isolated mount boot, `preset-conformance` |
| DSH-TUI (`@deepseek-harness-tui/dsh-tui`) | `0.18.0` | `0.20.0` | `dsh-plugin.json` `compat.hosts`, `verify:tui-admission`, the host's own negotiation |
| DSH-Go (`dsh-Go`, protocol v1) | view v1, always | view v2 where the app takes it | `dshGo` manifest, `verify:dshgo` |

Three words are used with one meaning each. **Guaranteed** means a check in this repository exercises it.
**Degrades** means a documented fallback takes over on a host that lacks the capability. **Not available**
means the capability is absent on that host and nothing here pretends otherwise.

The `engines.dsh` declaration spans both bands on purpose: `"dsh": ">=0.2.1-rc.5 <0.3.0-0"`. A release that
locked to the newer band would refuse the older host at install time, which is exactly what this wave's
backward-compatibility rule forbids.

## 2. DSH core: `0.2.1-rc.5`, `0.2.2-rc.1` and `0.2.2-rc.2`

| | `0.2.1-rc.5` | `0.2.2-rc.1` |
|---|---|---|
| Install | guaranteed — `dsh plugin --profile w add <repo root>`, exit 0 | guaranteed — same command, exit 0 |
| Mount and boot | guaranteed — `bundle-lifecycle` PASS, every boot check true, no home copy, clean uninstall | guaranteed — `bundle-lifecycle` PASS, same checks |
| `mpd` preset creation | guaranteed | guaranteed — row parity, measured on the current tree: on `0.2.2-rc.1` the `mpd` preset mounts **28 active rows of 29 declared** against the shipped `standard` preset's **27 of 28**, with `tool-office` reported as a GUARDED NOTE and `problems: []`; on `0.2.2-rc.2` it is an exact **28/29 vs 28/29** with no missing, extra or problem row; the self-test's **six** negative controls all redden as expected. The guarded-extra NOTE rule is a DECLARED GATE-SEMANTICS CHANGE under independent review, not a fact this page certifies. |
| Model routing (`agentOptions`) | works | works — see below |
| Tool calls through the adapter | works | works **after** the batch-API repair described below |
| `list_agents` | **not available** — declared capability delta | available — the root plugin registers it |

**What the install guarantee rests on.** Both rows above are a MEASURED exit 0 on both hosts
(`0.2.2-rc.2` and `0.2.2-rc.1`), taken with the harness install and the profile **outside this
checkout**. The precondition matters: a QA sandbox that sits INSIDE the repository resolves packages
through `createRequire` by walking up into the checkout's own `node_modules`, where both team
generations are present, so the harness's plugin-compatibility gate refuses the bundle and reports
"installation rejected" on either host. That rejection is a property of the ANCHOR, not of the bundle —
measured and recorded as a bound. Measured installs: rc.1 exit 0, rc.2 exit 0 (T8's clean-anchor run,
transcripts `.qa-tmp/r3/t11/install-dsh-022.log` and `install-dsh-022rc2.log`); the contaminated-anchor
rejection is the verifier's `evidence/verify-022rc2/2026-11-14T03-02-10Z/logs/`.

**What changed upstream.** `0.2.2-rc.1` moved cordis to `~4.1.0`, the loader/include packages to `~1.1.0`,
timer to `~1.2.0`, schemastery to `~3.19.0` and cosmokit to `~1.9.0`, and it added `engines.node >= 24.9.0`
to the CLI. The four headline breaking changes in its release notes (no `agent/request` listener, no
`tools.resolve`, no `executable` tool property, no Session Projection registration) do not touch this tree:
an inventory found no use of any of them.

**One breaking change is NOT in that list, and a mount found it.** `ToolsService.execute` changed from a
single `ToolExecutionInput` to a batch shape —
`ToolBatchInput { calls: [{ type: 'tool-call', id, name, arguments: <raw JSON string> }], … }` returning
`ToolBatchResult`. Our inventory (which searched for `tools.resolve` and `executable`) missed it; the
`bundle-lifecycle` mount caught it as `ADAPTER_TOOL_CALL=fail:Tool batch execution failed`. The adapter was
repaired to send the batch shape (and both hosts now pass the same mount), and the finding stands on the
record: a release note is not a complete breaking-change list.

**Model routing still works through `agentOptions` — at the one site this wave exercised.** On
`0.2.2-rc.1` a CONSULT spawn's request `agentOptions` still selects the model, proven by the child
session's own request header: the child ran the model configured for `agentRoutes."Junior Engineer"`
while the parent ran a different one. That is ONE site, not four. `TeamExecutor.spawn`,
`resolveRunRoute` and the roster provider's `applyRoute` share the same seam, but no run of this wave
exercised them separately: they remain a **declared bound**, not a proven result. The evidence is a live
run, not a code read.

**The declared capability delta on the older host: `list_agents`.** `0.2.2-rc.1` removed the `./list-agents`
subpath export from `@deepseek-ai/dsh-tool-subagent-control` (the root plugin now registers `list_agents`
itself, and the shipped `standard` preset dropped the row). A row whose module path no longer resolves cannot
be kept, so `presets/mpd.patch.yml` **deleted** its `tool-subagent-list-agents` row. The consequence, measured:
on `0.2.2-rc.1` the `mpd` preset mounts 28 active rows of 29 declared against `standard`'s 27 of 28, with `tool-office` reported as a GUARDED NOTE (`problems: []`), and the self-test's six negative controls all redden as expected;
on `0.2.1-rc.5` the same comparison reports *"the mpd preset does not mount active row(s) the installed
standard preset mounts: tool-subagent-list-agents"*.

**A user on the older host keeps a working bundle, and loses one capability.** The bundle still installs,
mounts and runs — `bundle-lifecycle` is exit 0 on `0.2.1-rc.5`, every boot check is true, there is no
residue — but `list_agents` is no longer provided by this bundle's preset on that harness. That is the
declared capability delta of this release, not "no impact".

**Why a conditional row is not a fix.** The loader resolves a row's module path before it honours
`disabled`, so keeping the row would break the boot on `0.2.2-rc.1`; there is no single preset that can
straddle the two hosts on this row. Deleting it was a hard choice, not laziness. The same wave mirrored one
more row guard from the shipped preset: `tool-plugin-manager`'s `disabled` became
`!ctx.get('profileContext')`, which on `0.2.2-rc.1` is active and on `0.2.1-rc.5` evaluates to disabled
because that harness has no `profileContext` service — the older host keeps its previous behaviour.

### 2.1 `0.2.2-rc.2`: the host owns the team plane, and the legacy rows carry the old generation (0.19.0)

`0.2.2-rc.2` renamed the three Agent Teams packages to `@deepseek-ai/dsh-agent-team`,
`@deepseek-ai/dsh-tool-agent-team` and `@deepseek-ai/dsh-client-ui-agent-team`, and it THROWS at
activation on the config keys the rc.1 rows ship (`maxMembers` / `maxMessageBytes` /
`disposalTimeoutMs` on the service row, `interrupt` / `freshProvider` / `forkProvider` on the tool row).

**On `0.2.2-rc.2` the bundle mounts NO team row at all.** That generation's own host layers already
declare the plane: `dsh-base/cordis.patch.yml` carries `- id: agent-team`
(`@deepseek-ai/dsh-agent-team`, config `{maxTasks: 256}`) and `- id: tool-agent-team`
(`@deepseek-ai/dsh-tool-agent-team`), and `dsh-web-app` carries `- id: ui-agent-team`
(`@deepseek-ai/dsh-client-ui-agent-team`); none of the three is disabled. A bundle row beside them is a
DUPLICATE registration — measured: the boot errored `service "agentTeams" has been registered at
<TeamService>` and `prompt section "team:policy" is already registered`, and two entries did not
activate. The three `-rc2` rows were therefore DELETED, not disabled, and `package.json` declares no
team package at all.

**On `0.2.2-rc.1` the bundle's three rows ARE the plane** (`mpd-agent-team`, `mpd-tool-agent-team`,
`mpd-ui-agent-team`, with their shipped configs unchanged), because that host's `dsh-base` declares no
team row. Their package is supplied by the HOST INSTALLATION's own nested copy: an empty profile against
an rc.1 host imports `@deepseek-ai/dsh-experimental-agent-team` fine, while the same empty profile
against an rc.2 host answers `Cannot find package '@deepseek-ai/dsh-experimental-agent-team'`. The
bundle therefore does not vendor it.

ONE guard decides, and it is a COMPOSITION rather than a rewrite:
`(<the shipped dsh-tui clause, byte-identical to HEAD>) || (<generation + resolvability clause>)`. The
TUI half keeps its shipped posture (rows 1-2 only, a throw there leaving the row enabled); the second
half resolves the generation from the nearest `@deepseek-ai/dsh/package.json` above `process.argv[1]`
(through its realpath), consults `baseUrl` through `createRequire` only when that is unreadable, and
finally asks whether the row's package resolves from the profile `node_modules` or from this dsh
installation. Unreadable or ambiguous disables the rows and writes ONE line to
`<root>/.mpd/logs/mpd-patch-guards.log`, honouring `MPD_DSH_TEAM_ROWS=old|new|off`; a throw is the
conservative disable. **The legacy body is not rewritten**: the installer self-test pins the shipped TUI
clause by sha256, and the guard disables AND logs when a future host stops shipping the package, instead
of silently dropping the plane.

**One preset row moved with it.** rc.2's `standard` preset mounts `tool-office`
(`@deepseek-ai/dsh-tool-office`, from the rc.2 office kit); rc.1's does not, and the package does not
exist there. The `mpd` preset declares `tool-office` with a MOUNT GUARD, so the row is ENABLED on rc.2
and DISABLED on rc.1. The gate now classifies a GUARDED extra row as a NOTE and an UNGUARDED one as a
FAIL; that is a declared gate-semantics change under independent review, not a fact this page certifies.

**The adapter's rule changed with it — presence is not servability.** `0.2.2-rc.2` keeps
`ctx.agentTeams` as a TASK-BOARD-ONLY service (`isEnabled`, `setEnabled`, `createTask`, `getTask`,
`listTasks`, `updateTask`); `membership`, `tryMembership`, `listMembers`, `spawnTeammate`,
`sendMessage`, `interrupt` and `waitForChange` are GONE, and the tool plugin registers four tools, not
nine. The adapter therefore tests EXECUTABILITY — `spawnTeammate` AND `sendMessage` AND `interrupt` AND
`waitForChange` all functions — instead of presence, falls through to the native executor with ONE log
line when the official service cannot execute, and reports the new `teamExecutorOfficial` capability
flag beside `teamExecutorNative`. `TEAM_TASK_METHODS` and the task-board paths are unchanged.

**Bound.** What is recorded above is what the patch, the preset and the adapter DO. The duplicate
registration is a MEASURED boot failure; a per-row activation measurement inside a full mount belongs to
the wave's own mount lane under `evidence/`, not to this page.

## 3. dsh-TUI: `0.18.0`, `0.19.0` and `0.20.0` are all admitted

`dsh-plugin.json` and `packages/mpd-tui-plugin/dsh-plugin.json` both declare
`compat.hosts: ["@deepseek-harness-tui/dsh-tui@0.18.0", "@deepseek-harness-tui/dsh-tui@0.19.0",
"@deepseek-harness-tui/dsh-tui@0.20.0"]`, and `dsh-distribution.json`'s `host-tui` ref names `0.20.0`. `verify:tui-admission` asserts that published
band instead of trusting the field. The set of hosts this bundle CLAIMS is written data, not a
discovered fact: `specs/tui-hosts.json` names all three hosts, and the gate's COMPAT lane carries five arms —
four that run host-free in every static pass, plus one that can only run when a host is discoverable:

- `COMPAT.band:<label>` — each manifest's `compat.hosts` is a non-empty array of `@scope/name@x.y.z`
  coordinates (one arm per manifest).
- `COMPAT.band-parity` — the two manifests declare the SAME band, so the pair cannot drift apart.
- `COMPAT.distribution-ref` — `dsh-distribution.json`'s `host-tui` ref lies INSIDE that band.
- `COMPAT.declared-hosts` — EVERY host named in `specs/tui-hosts.json` lies INSIDE each manifest's band.
  This arm reads written data and never consults a discovered host, so deleting a claimed host from
  either band reddens a CI run that installs only the other host: the loss cannot hide behind whatever
  host happens to be installed.
- `COMPAT.host-version` — the DISCOVERED host's exact version lies inside the band. With no discoverable
  host this arm reports `BOUND — NOT CHECKED — <reason>` instead of passing silently; `--static-only`
  reports it that way by construction and itself exits 3, because a static pass is never an admission
  verdict.

The declared-set arm and the discovered-host arm answer different questions and neither substitutes for
the other: the first proves the CLAIM covers both hosts, the second proves THIS machine's host is one the
claim admits. Neither is a live admission of BOTH hosts in one run. In this release's gate run the
discovered host was `0.18.0`, so `COMPAT.host-version` PASSED against `0.18.0` and the run reported
**PASS — 49 arms passed, 1 allowed deviation, 5 bounds** (the LOCAL shipped-tree run, which discovered the ambient 0.18.0 host; CI on the same commit installs 0.19.0 and reports 48 arms / 1 deviation / 6 bounds — both are the same gate). The `0.19.0` result is the earlier measurement
below:

- The host's own admission chain was run against **`0.19.0`**: `validateHost: ok`, both manifests negotiate
  `compatible` (that earlier run reported 43 arms, before this wave added the five COMPAT arms).
- The `0.18.0` result stands as measured earlier: both manifests answer `validatePlugin: ok` and
  `negotiate: compatible`.

**The admission guide and the admission chain are byte-identical at the two tags**, so the second result is
not a coincidence of sampling: the guide's blob is `6b9dfd3…` (99,723 B) at both tags, the
`permissions-0.1.json` registry is `f36cb6e…` at both, and all eleven admission-decision source files are
unchanged. `0.19.0` itself changed only its DSH peer line (it adds `0.2.2-rc.1` while keeping
`0.2.1-rc.5`), its `/update` orchestration, a subagent-channel notice and one first-party feed re-pin.
There was no admission rework to do, and none was invented.

What degrades on the older TUI host: **nothing this bundle declares**. The seven runtime-bound surfaces and
the optional `DecisionEvents` contract behave identically; the contract was already declared optional with a
written fallback, and no intercept permission is requested.

## 4. DSH-Go: view v1 always, view v2 by opt-in

The native surface is the one plane where "older" means an older **app**, not an older harness:

- **Guaranteed:** every panel names a hand-written static view under `dsh-go/views/`, and those are view
  **v1** — the shape any protocol-1 app can draw.
- **Degrades:** the live trees the panels build are v2, and the adapter's `adaptView` rewrites them for an
  app that cannot take v2 (tabs become a stack of titled sections, a grid becomes a list, badges become text,
  `divider`/`spacer` disappear, `style`/`accent` are stripped, metric labels and values survive).
- **Not available:** the v2-only visual language on a v1-only app — by design, and the same tree is served
  downgraded rather than withheld.
- **No bridge at all:** nothing is registered, ONE `dshGo=absent` line is logged, and there are zero timers
  and zero polling.

The details, the seven slots, the per-locale limits and the gate are in
[`dsh-go-standard.md`](dsh-go-standard.md).

## 5. Display metadata: the icon, the `meta` wrapper and `meta.detail`

`0.2.2-rc.1` changed the WEB plugin-manager surface: the session list renders plugin icons, the
plugin-management page gained rich-text details and improved layout/navigation behaviour, and — quoting the
release note — *"Stop reading separate package.json files for subpath plugins; display text and icons must use
the corresponding subpath exports."*

**The icon contract did not change.** The icon is a top-level `package.json` field,
`DshPackageManifest.icon?: string`: *"SVG, PNG, JPEG, or WebP file relative to this manifest's directory, at
most 256 KiB and contained there after realpath resolution."* The wording is identical at `0.2.1-rc.5` and
`0.2.2-rc.1`, it is optional, and it has been stable across the band. This repository already declares
`"icon": "./icon.svg"`, ships the file through `files`, and exports `"./package.json"`, `"./icon.svg"`,
`"./locale/*.json"` — so it was already compliant and needs no change.

**One real, pre-existing gap was fixed by this wave, and it is a good finding rather than a defect the
upgrade introduced.** Our `locale/*.json` files were FLAT (`{title, description}`) while the host reads
`{"meta": {title, description}}`. Both files now carry the `meta` wrapper. With the wrapper, the host also
accepts `meta.detail` — a path to a markdown document rendered as the plugin's rich-text detail page. This
bundle points `locale/en.json` at [`plugin-details.md`](plugin-details.md) and `locale/zh.json` at
[`plugin-details.zh-CN.md`](plugin-details.zh-CN.md); those two files are created in the same wave, and the
packed artifact must contain them (they ride `docs/**` in `files`).

None of this is rendered-and-verified inside a plugin manager during this wave: it is stated from the
manifest fields and the release text, with the locale shape checked against the host's reader. The honest
bound is that the *page* is a markdown file the host renders, and its content is the user-facing summary in
[`plugin-details.md`](plugin-details.md).

## 6. Declared bounds

- **No device, no Flutter host.** The DSH-Go half is proven against the published standard, pinned spec data
  and service doubles; the pixels are the reader's check.
- **Mounts, not every path.** `bundle-lifecycle` proves install, composition, boot, tool-call, preset and
  uninstall on both harnesses; the Docker real-machine lane is the LAST step and may skip without a rootless
  daemon — and a skip is never a pass.
- **`0.2.1-rc.5` is proven at mount level**, with the one declared capability delta above. No claim is made
  that every `0.2.2-rc.1` behaviour exists on it.
- **The official DSH-Go checker is not vendored**; without `MPD_DSHGO_KIT` its lane is NOT-PASSED (exit 3),
  which is a declared bound, not a green.
- **A pending CodeRabbit review or a skipped gate is never a pass** — the release sweep records what actually
  ran.

## 7. Where the detail lives

The release narrative is in [`../CHANGELOG.md`](../CHANGELOG.md) `## 0.19.0`. The two upstream adaptation
sources this page rests on are the measured evidence bundle under
`evidence/upstream/0.2.2/2026-11-07T05-45Z/` (mount, routing, row parity, the `0.19.0` negotiation probe and
the batch-API finding) and the gate transcripts beside it. The DSH-Go standard is
[`dsh-go-standard.md`](dsh-go-standard.md); the TUI lane is [`tui.md`](tui.md) and
[`tui-admission.md`](tui-admission.md); the binding rules are [`../AGENTS.md`](../AGENTS.md) §2 and §4.
