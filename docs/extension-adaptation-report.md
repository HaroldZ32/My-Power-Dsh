# External-plugin adaptation — current-state report

**English** | [中文](./extension-adaptation-report.zh-CN.md)

Current-state audit of the `@mpd-dsh/mpd` bundle at HEAD `8777e43`, written from the four wave
inventories (t2–t5), the architecture assessment (t6) and the live-verification run (t7). Basis is
marked per section and per claim: **code-read** (a `path:line` that was read),
**evidence-on-disk** (an artifact under `evidence/`), **live-verified** (a real mounted `dsh` boot
whose tool calls were read from the harness session log, never from model prose).

## 1. Executive summary and verdict

**Verdict: yes — a third party can already join this deployment, through two sanctioned paths, and
the newer one (the extension interface) was live-verified end to end on this tree.** The remaining
gaps are not missing capability: they are (a) one latent defect that can degrade the interface
silently, (b) the absence of a single "which plane do I use?" rule for authors, and (c) documentation
of a security posture that the code already implements well.

What a decision-maker can rely on today (the extension-interface bullets are live-verified, §5; the
install-plane bullet is code-read, §2):

- a package carrying its own `dsh.bundle.patch` joins the loader as another bundle layer
  (`dsh plugin --profile <p> add <pkg>`) — the install plane (**code-read**; this wave's live run did
  not exercise it);
- a plain directory holding `mpd-ext.json` (plus its assets) is discovered from three roots, with no
  packaging and no reinstall — the extension interface;
- on a real mounted boot, an externally supplied extension is listed, its flow is served, its skill
  loads through the catalog, its role is resolved **per call** and really spawns, and a declared
  stdio MCP server publishes a tool that is called successfully (the call and its non-error result
  are read from the harness session log).

What is missing or fragile: the adapter-identity fallback is un-instrumented (P0, §7), there is no
one-page plane-selection rule (P1), the child-process environment allowlist and the accepted
residuals of the isolation posture are undocumented (P2), and the audit found documentation drift —
all of it corrected or repaired in this wave (§8).

Basis: code-read + evidence-on-disk + live-verified (t7).

**Honest strength-of-evidence note.** The live claims rest entirely on the verification task's
artifacts (`evidence/extensions/t7-verify/20260916T045829Z/` and the two lane directories it names);
its own anchor is HEAD `8777e43` **plus** the sha256 of the lane subject, because the repairs that
turned the last two red arms green live in the uncommitted working tree. `--dump-config` was not used
as load evidence anywhere (AGENTS.md §4).

## 2. The two planes, and who should use which

| | Install plane | Extension interface |
|---|---|---|
| Unit | an npm package with its own `dsh.bundle.patch` | a directory with `mpd-ext.json` |
| Joins via | `dsh plugin --profile <p> add <pkg>` (a second bundle layer) | filesystem discovery — no install step |
| Can contribute | new profile rows, including a `dsh-mcp-client` MCP row; dependency pinning; install-time code | skills, flows, mcp (stdio), roles — data only |
| Lifecycle | reinstall + restart | project plane **per call**; user/bundle planes at **apply** |
| Session scope | full (it owns rows) | none for tools/roles (process-global registration) |
| Guarantees per item | row presence, reconnection, pagination, schema rollback, disposal | per-item validated refusal; a bad item never aborts the rest |

Basis: code-read. Plane 1 is documented as first-class and non-replaced at `docs/extensions.md:24`;
plane 2 is the in-tree row `mpd-ext` (`packages/mpd-bundle/cordis.patch.yml:262-263`) providing the
service `mpdExtensions` (`packages/mpd-ext-plugin/src/index.ts:457`).

**Choose the install plane** when the contribution must add a profile row, needs installation-time
or dependency work, or ships to many users as a versioned package. **Choose the extension interface**
when a directory of declarations is enough: a per-project skill/flow set, or host-wide skills, flows,
MCP servers and roles without touching the bundle.

The important asymmetry: the *same* `mpd-ext.json` is legal in different planes with a different set
of permitted kinds — the project plane may contribute **skills + flows only**, while the user and
bundle planes may contribute all four. That restriction is deliberate and has a truthful reason
(`packages/mpd-ext-plugin/src/sdk.ts:144-145`, refusal implemented per item at
`packages/mpd-ext-plugin/src/registry.ts:673-680`): tool and provider registration in this harness is
process-global, so a per-session MCP server or roster role cannot be represented honestly.

## 3. Capability inventory of the extension interface

Basis: code-read (t2, t4, and this report's own re-reads).

- **Frozen contract v1** (`packages/mpd-ext-plugin/src/sdk.ts:113-146`): `apiVersion` must equal `1`
  or the whole descriptor is rejected; two id grammars exist — the descriptor id
  (`sdk.ts:29`) and the stricter skill-name grammar that a **flow id** must also satisfy
  (`sdk.ts:36`); unknown keys are rejected per item (`registry.ts:191-197`).
- **Four contribution kinds**, each with its own validation and defaults: `skills` (relative root,
  finite rank, default **300**), `flows` (JSON document keys; rendered into an in-memory skill
  document, because the harness has no flow seam), `mcp` (stdio only, with `args`/`env`/`cwd`/
  `toolCallTimeoutMs`/`connectTimeoutMs` defaults), `roles` (`description` defaults to `""`,
  `readonly` to `false`, and `provider`/`model` must be supplied together).
- **Three roots, two lifecycles** (`docs/extensions.md:208-212`): `<session workspace>/.mpd/extensions`
  is read **per call** and contributes skills + flows only; `~/.mpd/extensions` and
  `<bundle>/extensions` are read at **apply** and may contribute all four kinds. Equal-id precedence
  is project → user → bundle (first wins) and the shadowed entry is reported, never silently dropped.
- **Four read-only inspection tools**: `mpd_ext_list`, `mpd_ext_show`, `mpd_flow_list`,
  `mpd_flow_show`. `mpd_ext_show` redacts `env` values, and both list tools check every claimed skill
  name against the harness's own catalog, reporting `served` / `notServed` (or `checked: false` with
  the reason) instead of asserting.
- **Developer CLI** (`scripts/mpd-ext.ts`): `validate`, `scaffold`, `list` and an offline
  `--self-test` — an independent oracle over the same directories the runtime reads.
- **Shipped reference extension** (`extensions/mpd-ext-example/`, disabled by default): all four
  kinds, including a dependency-free stdio MCP server whose one raw tool becomes
  `mcp__lint-mcp__describe_extension`.
- **Declared v1 limits**: no reload (a restart is the reload, `docs/extensions.md`); stdio MCP
  only; JSON flows only; no MCP resources/prompts; no GUI panel, marketplace, remote download or
  version solving; an extension cannot contribute an agent preset, and extension roles never become
  teammates on their own (see `docs/extensions.md`).

## 4. Runtime behaviour and isolation posture

Basis: code-read.

**Runtime behaviour that matters.**

- The MCP bridge connects **at apply**, in parallel and time-boxed, never lazily
  (`packages/mpd-ext-plugin/src/index.ts:983-1001`; the comment at `:983` states the contract). The
  first tool generation is therefore published before `apply` resolves, and activation never rejects.
- Per-server state is a real state machine: `connecting` / `connected` / `unavailable` / `failed` /
  `disabled` (`packages/mpd-ext-plugin/src/mcp.ts:34`). A `pending` line survives only while the
  server is not `connected` (`mcp.ts:188-213`), and a failure records a bounded child-stderr tail
  (`mcp.ts:216-226`).
- Tool registration is **two-phase**: the whole next generation is built first, then swapped in, and
  a mid-list conflict rolls the partial generation back completely (`mcp.ts:266-305`). A foreign
  `outputSchema` costs the tool its **schema**, never the tool (`mcp.ts:354-375`, pinned by
  `packages/mpd-ext-plugin/test/mcp.test.ts:642`).
- Extension **roles are resolved per call** by `mpd-roles-plugin`
  (`packages/mpd-roles-plugin/src/index.ts:336`, via `extensionRoles` at `:225`), get a namespaced id
  `ext-<extension-id>-<slug>` (`:194`), and the base roster wins a name collision. Both surfaces
  agree: `mpd_ext_list` re-derives the same refusals into the extension's `errors` and lists only the
  usable names (`packages/mpd-ext-plugin/src/registry.ts:285-326`), pinned by the two-surface parity
  test (`packages/mpd-ext-plugin/test/core.test.ts:1085-1090`).

**Isolation posture.**

- The child environment is an **allowlist, not an inheritance**: six names on unix (`HOME`, `LOGNAME`,
  `PATH`, `SHELL`, `TERM`, `USER`; twelve on win32) plus the extension's declared values, and any
  credential-shaped name is dropped as defence in depth
  (`packages/mpd-ext-plugin/src/mcp-client.ts:69-116`). This is implemented well and until this wave
  it was **undocumented** (P2 recommendation).
- Asset references are extension-root-relative; absolute paths and `..` escapes are rejected per item
  (`docs/extensions.md:174`; the refusal ladder in `registry.ts`).
- Registration is process-global, which is exactly why the three-root split exists and why the
  project plane refuses `mcp`/`roles` per item.
- Residuals, stated honestly: the spawned child runs as the same OS user with the same filesystem
  access and an inherited `HOME`, so it can read `~/.dsh/.credentials.yaml` **from disk** — the
  allowlist bounds the blast radius, it does not sandbox the process; a manifest's declared `env` is
  authored, visible configuration, so an extension can deliberately be handed a secret; and discovery
  is filesystem-trust based, with no signature or review step.

## 5. What was live-verified on this tree

Basis: evidence-on-disk (t7 attempt 2, verdict PASS; repairs reviewed PASS by t14). Artifacts:
`evidence/extensions/t7-verify/20260916T045829Z/`, `evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/`,
`evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/`.

- **Runs, all `--no-skip`, exit 0**: `extension-lifecycle.ts` (arms install / main / failure /
  isolation / packed), `extension-mcp-bridge.ts` (arms install / live / dead / hang / schema / dup /
  stderr / containment), `extension-isolation.ts --self-test`. No `[mpd-qa] SKIP` marker was printed.
- **Mount, not composition**: the boot log prints
  `[mpd-ext] mpdExtensions provided (apiVersion 1) | tools: mpd_ext_list, mpd_ext_show, mpd_flow_list, mpd_flow_show | skill providers: …`
  (`output.log:40` lifecycle, `output.log:38` bridge), the harness's own `request/header` record
  offers those four tools plus `mpd_role_persona` / `mpd_role_spawn` among 99 tools
  (`raw/main.session.decoded.jsonl:13`), and zero apply-crash signatures appear in either log.
- **Extension end to end** (`raw/main.session.decoded.jsonl`, call → result): `mpd_ext_list` 18→20
  reports three extensions (`qa-ext-proj` project, `qa-ext-user` user, `mpd-ext-example` bundle,
  disabled) and rejects the project-plane `roles`/`mcp` per item with the reason; `mpd_ext_show`
  24→25; `mpd_flow_show` 34→35 returns `QA-MARKER-FLOW-PROJ`; the `skill` tool 39→40 returns
  `QA-MARKER-SKILL-PROJ` through the catalog; `mpd_role_persona` 44→45; `mpd_role_spawn` 49→51 starts
  a **real** child that answers `QA-CHILD-MARKER-ROLE-OK`.
- **The live MCP call**: `raw/mcp.session.decoded.jsonl:39` is a `tool/call` for
  `mcp__qa_mcp_live__status` and `:40` is its non-error `tool/result` carrying the repo's own stdio
  server output; the tool is offered in **both** readings (the stub request array and the harness
  header, 109 tools). Containment: dead → zero tools with the ENOENT reason, hang → "initialize
  timed out after 1500ms", duplicate name → zero tools; none of them appears in the header either.
- **Isolation asserted, not assumed**: every boot ran with sandbox `DSH_HOME`, sandbox `HOME` and a
  sandbox session cwd, `assertSessionsSandboxed` returned ok with only sandbox session keys
  (checked 4 / 1 / 1), and the multi-session decoy control was non-vacuous.
- **Anchoring**: HEAD `8777e43` plus the lane-subject sha256 pinned before, after and 1m47s after the
  run; the tracked-file list is identical pre/post, so the lanes wrote only their own evidence.

The two arms that were red before the repairs (the packer's closure arm and the bridge lane's schema
arm) are green here; the repairs themselves are the wave's single skills-writer change plus one packer
line and the wave's single `VENDOR_LOCK.json` re-pin (`evidence/extensions/t13-repair/20260916T045324Z/`,
`treeSha 9e643d07… → 7a48fdad…`), re-run independently and passed by the reviewer.

## 6. Risks and gaps

Basis: code-read + evidence-on-disk.

- **F1 (medium) — the adapter-identity fallback is silent.** Both `mpd-ext` and `mpd-roles` resolve
  the adapter as `ctx.get("mpdDsh") ?? createDshAdapter(ctx)`
  (`packages/mpd-ext-plugin/src/index.ts:207`, `packages/mpd-roles-plugin/src/index.ts:318`). If the
  mounted lookup ever misses, the row constructs its **own** adapter beside the tree's, breaking the
  one-contact-surface rule (AGENTS.md §6) with no warning. The identical swallowed-error class has
  already un-registered four tools once in this very file (`src/index.ts:44-51`), which is why the
  row now counts registrations (`:462-475`) — the fallback is the remaining un-instrumented branch.
- **F2 (medium, doc) — no single plane-selection rule.** The facts exist
  (`docs/extensions.md:24`, `:208-212`, `:216-223`) but no one place answers "which plane for my
  contribution?". The cost is wrong-plane authoring whose rejection only arrives at discovery time.
- **F3 (medium) — the isolation posture and its residuals are undocumented.** The child-env allowlist
  and credential-name drop are strong and undescribed; the accepted residuals (same-OS-user disk
  access, author-declared `env` secrets, filesystem trust) are unstated.
- **F4 (low) — restart asymmetry.** A `skills`/`flows` contribution in the project plane is re-read
  per call, while an `mcp`/`roles` contribution on the user/bundle plane needs a restart; both facts
  are documented, never juxtaposed.
- **F5 (low, cosmetic) — one hazard, two half-comments.** The bundle patch warns about the
  second-adapter hazard (`packages/mpd-bundle/cordis.patch.yml:244-260`) while the row's own comment
  (`packages/mpd-ext-plugin/src/index.ts:44-54`) documents only the lazy resolution.
- **F6 (medium) — evidence freshness.** Eight evidence directories predate the current extension code
  (`c239407`): `mcp-bridge-framing`, `mcp-bridge-gates`, `registered-tool-schemas`,
  `sanitizer-crosscheck`, `roles-wiring` (×2), `v0.9.1-defect-fixes`, `extensions-repair/t16-pins-and-plane-guard`,
  `mpd-ext-repair/roles-report`. None of them supports a current-state claim without a re-run.
- **F7 (low) — an evidence checker over-claims.** `evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs:40-49`
  prints that quoted doc snippets match the shipped example while probing only the skill and flow
  fields, so it green-lit the bytes that carried the §5.3/§5.4 drift (D4/D5 below).
- **F8 (low, WAIVED this wave) — the lifecycle lane still narrates the pre-repair expectation.**
  `skills/dsh-qa/scripts/extension-lifecycle.ts:35-42` still says "This wave's expectation is a RED …
  THE FIX IS t11's", and its packed arm still returns `greenOwner: "t11"` (`:386`). Waived
  deliberately, not overlooked: the skill corpus has ONE writer per wave and a second `skills/**` edit
  would force a second `VENDOR_LOCK.json` re-pin, while this wave keeps exactly one (AGENTS.md
  §9/§11) — and this wave's single re-pin is already spent on the mcp-bridge schema-arm correction
  (`evidence/extensions/t13-repair/20260916T045324Z/`). It is recorded here so the next wave can fold
  it into its single re-pin.
- **F9 (low, same waiver family) — one row's citation is not what gates the arm.**
  `skills/dsh-qa/SKILL.md:77` cites `extension-lifecycle.ts:385` for "the case exits 0", but the arm's
  `ok` is `packRun.status === 0 && hasRow && (hasPlugin && hasExtensions ? true : red)`
  (`extension-lifecycle.ts:377`), which is TRUE in both the GREEN and the RED state — so exit 0 is
  not actually gated by the packed tree being GREEN. A one-file follow-up plus the wave's single
  re-pin.
- **F10 (low) — the child-stderr-tail clause has no lane arm.** No lane asserts the bounded
  child-stderr tail in the bridge's state reporting; the only `stderr` references in the lanes are the
  fixture's own error write (`extension-mcp-bridge.ts:121`) and the CLI probe's tail
  (`extension-lifecycle.ts:135`, `:335`). The clause is code- plus unit-test-backed only.
- **F11 (low) — the R11 class assertion has no test-suite home.** R11 (the `PLUGIN_PKGS` omission
  class check) exists as a documented one-liner command in `.mpd/plans/dsh-tui-edition.md:179-183`
  only; the guard that actually runs on every pack is the packer's own positive closure check
  (`scripts/pack-mpd.ts:260-269`, re-anchored 2026-09-17). See the P2 recommendation in §7.

## 7. Prioritized recommendations

Each item states rationale, effort and the paths it would touch. Nothing here is implemented in this
wave — this wave audits and documents.

- **P0 — instrument the adapter fallback** (warn once with the resolved adapter identity when the
  nullish branch is taken). Paths: `packages/mpd-ext-plugin/src/index.ts:207`,
  `packages/mpd-roles-plugin/src/index.ts:318`. Rationale: protects the binding one-contact-surface
  rule and converts a silent degradation into a visible one; the precedent for silent capability loss
  is in the same file. Effort: small.
- **P1 — add one plane-selection decision rule** to the guide. Paths: `docs/extensions.md` §4 + its
  zh-CN twin. Rationale: highest-frequency contributor error (F2); the pieces already exist and only
  need one place. Effort: small.
- **P1 — document the child-env isolation posture and its accepted residuals.** Paths:
  `docs/extensions.md` §5/§10 + zh-CN twin. Rationale: an implemented strength is invisible, and the
  residuals (`~/.dsh` readable from disk by the child, author-declared `env` secrets, filesystem
  trust) need an explicit accept/deny decision. Effort: small-medium.
- **P2 — juxtapose the two liveness modes in one sentence.** Paths: `docs/extensions.md:525` + zh-CN
  twin. Rationale: removes the surprise in F4. Effort: small.
- **P2 — cross-reference the adapter-mount hazard** between the bundle-patch comment and the row
  comment. Paths: `packages/mpd-bundle/cordis.patch.yml:244-260`,
  `packages/mpd-ext-plugin/src/index.ts:44-54`. Rationale: two comments currently hold two halves of
  one fact. Effort: trivial (a comment edit, so a code task).
- **P2 — retire or re-run the stale evidence directories** (F6) so the evidence index contains no
  pre-`c239407` claim. Paths: `evidence/extensions/**`. Rationale: a reader cannot tell a current
  claim from a superseded one. Effort: medium.
- **P2 — give R11 a test-suite home** (F11). Paths: `skills/dsh-qa/` (a new case or an arm inside an
  existing lane) + `.mpd/plans/dsh-tui-edition.md` (retire the prose command). Rationale: a class
  guard that only lives in a plan document is one edit away from being lost, and the class has already
  recurred four times (the packer's closure check catches the mounted-row half on every pack, but
  nothing runs the `PLUGIN_PKGS` equality check in CI). Effort: small — **but not free: a test-suite
  home means editing `skills/dsh-qa/**`, which forces a `VENDOR_LOCK.json` re-pin in the same change**
  (the same one-re-pin discipline F8/F9 invoke), so it must ride a wave's single re-pin.

## 8. Documentation drift found by this audit

Basis: code-read + evidence-on-disk. Every entry below names the stale line, the correction, and the
task that carries it. **Outcome: every drift entry this audit found is fixed or repaired in this
wave — none is deferred.** D1–D5 and the role-refusal item by t9 (reviewed PASS by t11); D6 by t15
(reviewed PASS by t16, wording follow-up closed by t19); the role-refusal item's own record is t17
(reviewed PASS by t18); the `skills/**` items by t13 as the wave's single skills writer (reviewed PASS
by t14).

- **Corrected in this wave (t9, reviewed PASS by t11)** — `packages/mpd-ext-plugin/README.md:26`,
  `:148-149`, `:168-170` and `README.zh-CN.md:16`, `:105`, `:112`: the MCP bridge and role resolution
  were described as "a later task" / "not yet connected" / "when the roster's per-call resolution
  function lands". They are live now (§4, §5).
- **Corrected in this wave (t9)** — `docs/extensions.md:314` (`serverName` `"example"` → `"lint-mcp"`)
  and `:344`, `:350`, `:353` (`Example Reviewer` / `example-reviewer.md` → `Code Reviewer` /
  `personas/code-reviewer.md`), with the zh-CN twin at `:267`, `:289`, `:295`, `:298`. The shipped
  `extensions/mpd-ext-example/mpd-ext.json` is the source of truth; both snippets are now
  JSON-equal to it.
- **Fixed in this wave (t17, reviewed PASS by t18)** — `docs/extensions.md:531-534` and
  `docs/extensions.zh-CN.md:423` claimed a refused role is reported only by the roster and that
  "making the two surfaces agree is a follow-up". The follow-up is closed: both surfaces report it
  (`registry.ts:285-326`, `test/core.test.ts:1085-1090`). The bullet was corrected at revision
  sha256 `541b86fe…` (EN) / `396eef30…` (zh-CN); t17 then extended the same subject to the §6
  refusal-table row (`docs/extensions.md:394`), and t18's PASS anchors to the resulting revision
  (`f860593a…` / `be0a8814…`). Not an open item.
- **Corrected in this wave (t15, reviewed PASS by t16; its T16-F1 wording follow-up closed by t19)** —
  `docs/development.md:112` and
  `docs/development.zh-CN.md:105` presented `extension-isolation` as a third case lane. It is the
  shared proof helper both real cases import and deliberately not a case row
  (`skills/dsh-qa/SKILL.md:92`); it has **no lane mode** — invoked without `--self-test` it does
  nothing and exits 0 — and its only offline proof is its own `--self-test`.
- **Repaired, not deferred (t13, reviewed PASS by t14)** — the two `skills/**` items, which no doc
  task could touch because the skill corpus has ONE writer per wave and its `VENDOR_LOCK.json`
  `treeSha` is a blocking gate (AGENTS.md §9/§11): the `skills/dsh-qa/SKILL.md` extension rows no
  longer promise a packed arm that must be red, and the bridge lane's `schema` arm now asserts the
  shipped keep-or-drop rule. The same change carries the wave's single re-pin
  (`9e643d07… → 7a48fdad…`).
- **Reported, not fixed** — `evidence/mpd-ext-debranding/20260915T074904Z/verify-debranding.mjs:40-49`
  (F7): its printed claim is broader than its probe. Extending it to the `mcp`/`role` snippet fields is
  a one-function change owned by the evidence owner.

## 9. Unverified / open questions

- F1 (the silent adapter fallback) is reasoned from code and from the documented precedent; it was not
  reproduced live in a boot that misses `mpdDsh`.
- The win32 branch of the child-env allowlist is code-read only; every live run in this wave was on
  linux.
- The residuals in §4 (disk-readable credentials, author-declared `env` secrets, filesystem trust)
  are posture assessments, not executed exploits.
- The eight stale evidence directories (F6) were inventoried, not re-run; their claims remain
  unverified against the current tree until someone re-runs them.
- The plugin-module hot-reload question is settled by design (no reload in v1 — restart), but no test
  asserts that a *changed* extension directory is re-read only per call in the project plane.
- Whether the packed layout keeps working for extensions is asserted by the packer's positive closure
  check (`scripts/pack-mpd.ts:260-269`) and by the lane's packed arm — not by a fresh install of
  `dist/mpd-package/` into a clean profile in this wave.

## 10. Appendix A — reproduction commands

```sh
# the two real lanes (real mounted dsh, sandboxed DSH_HOME + HOME + session cwd)
bun skills/dsh-qa/scripts/extension-lifecycle.ts --no-skip
bun skills/dsh-qa/scripts/extension-mcp-bridge.ts --no-skip
bun skills/dsh-qa/scripts/extension-template.ts --no-skip
# the shared proof helper's own offline guard (NOT a case lane)
bun skills/dsh-qa/scripts/extension-isolation.ts --self-test
# the interface's own test suite
bun test packages/mpd-ext-plugin
# the developer CLI as an independent oracle over the example
node scripts/mpd-ext.ts validate extensions/mpd-ext-example
node scripts/mpd-ext.ts --self-test
# packaging + vendor gates the repairs had to keep green
node scripts/pack-mpd.ts
node scripts/verify-vendor.ts
# the bilingual gate for this report pair
node scripts/verify-docs-parity.ts
```

## 11. Appendix B — evidence index

| Evidence path | Supports | Freshness |
|---|---|---|
| `evidence/extensions/t7-verify/20260916T045829Z/` | the wave's live verification: mount, extension E2E, the real MCP call, isolation, anchoring | current (HEAD `8777e43` + lane-subject sha256) |
| `evidence/extensions/extension-lifecycle/2026-09-16T04-58-41.378Z/` | lifecycle lane, all arms green | current |
| `evidence/extensions/extension-mcp-bridge/2026-09-16T04-59-18.173Z/` | bridge lane, all arms green incl. the corrected schema arm | current |
| `evidence/extensions/extension-lifecycle/2026-09-16T06-31-40.371Z/` | the skills pass: F8/F9 fixed, the packed predicate's negative control, and the wave's single re-pin record (`t8-skills-pass-summary.json`) | current |
| `evidence/extensions/extension-mcp-bridge/2026-09-16T06-31-25.127Z/` | the F10 stderr arm: a real bounded tail (cap 2000) from a failing child | current |
| `evidence/extensions/extension-template/2026-09-16T06-31-12.171Z/` | the template lane's GREEN: all four kinds of a scaffolded copy live, read from the session log (the two earlier stamps are noted above) | current |
| `evidence/extensions/t13-repair/20260916T045324Z/` | the two red-arm repairs, the re-pin script and its result | current |
| `evidence/extensions/extension-lifecycle/2026-09-16T04-43-51.532Z/`, `…04-54-42.210Z/`, `…04-58-47.578Z/`, `evidence/extensions/extension-mcp-bridge/2026-09-16T04-44-32.737Z/`, `…04-54-24.090Z/`, `…04-56-15.636Z/`, `…04-58-11.355Z/` | lane runs before and after the repairs (the pre-repair ones are red on one arm each) | superseded by the green runs above |
| `evidence/extensions/t7-verify/20260916T044344Z/` | attempt 1 of the verification (FAILED) | superseded |
| `evidence/mpd-ext-debranding/20260915T074904Z/` | debranding + doc-quote digests (narrow probe, see F7) | current but narrower than its wording |
| `evidence/extensions/{mcp-bridge-framing,mcp-bridge-gates,registered-tool-schemas,sanitizer-crosscheck,roles-wiring×2,v0.9.1-defect-fixes}`, `evidence/extensions-repair/t16-pins-and-plane-guard/`, `evidence/mpd-ext-repair/roles-report/` | earlier interface work | **stale** — all predate `c239407`; not usable for a current-state claim |

Only the first four rows support the current text of this report: the third row (`t13-repair`) backs
the repair outcomes of §8, and the first three back every live claim of §5. The remaining rows are
listed for completeness only — the pre-repair run (`extension-mcp-bridge/2026-09-16T04-44-32.737Z/`,
`ok:false`), the verification's failed attempt 1 and the concurrent lane runs of other reviewers are
**superseded** and are cited as support nowhere in this guide or in the docs it reviews.

## 12. Status after the follow-up wave (2026-09-16)

Basis: the fix tasks' own artifacts on disk, read at the time of writing. Nothing below is inferred
from a task description, and no row claims a fix whose evidence does not exist. The register in §6 is
left unchanged on purpose — it is this audit's own record of what it found; this section is the
follow-up mapping on top of it.

| Item | Status | Where the fix lives | Evidence |
|---|---|---|---|
| F1 — the adapter-identity fallback is silent | **fixed** | the canonical note (hint `:59-100`) plus (`dshAdapterIdentity`, `packages/mpd-ext-plugin/src/index.ts:593`), carried into the rebuilt `packages/mpd-ext-plugin/dist/index.js`; `mpd-roles-plugin` cross-references it | `evidence/extensions/f1-adapter-identity/20260916T061318Z/` |
| F5 — one hazard, two half-comments | **fixed** | the single canonical note (`"CANONICAL NOTE"`, `packages/mpd-ext-plugin/src/index.ts:62`), which `packages/mpd-roles-plugin/src/index.ts` points at instead of restating | `evidence/extensions/f1-adapter-identity/20260916T061318Z/` |
| F7 — an evidence checker over-claims | **fixed** | the corrected prober `evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs` (a NEW directory; `evidence/mpd-ext-debranding/20260915T074904Z/` is left byte-untouched as the record of the narrow probe) | `evidence/extensions/debranding-probe/20260916T061807Z/` |
| F11 — the R11 class assertion has no test-suite home | **fixed** | `scripts/verify-pack-closure.ts` — it runs alone, parses the packer's real lists, and replays red on a temp fixture — wired into `package.json` `test:qa:all` | `evidence/extensions/pack-closure-check/20260916T061527Z/` |
| F8 — the lifecycle lane still narrates the pre-repair expectation | **fixed** | `skills/dsh-qa/scripts/extension-lifecycle.ts`: the packed-arm narration states the current invariant and `greenOwner: "t11"` is gone | `evidence/extensions/extension-lifecycle/2026-09-16T06-31-40.371Z/` (the real lane run: `result.json` + `output.log`), summarised in `…/t8-skills-pass-summary.json` |
| F9 — one row's citation is not what gates the arm | **fixed** | the arm's `ok` is now the pure predicate `packedStateOk()` in `skills/dsh-qa/scripts/extension-lifecycle.ts` (hints `:412`, used `:383`), with `packedNegativeDriver()` (`:435`) over four fixture packed trees; `skills/dsh-qa/SKILL.md` cites those anchors instead of the old "exits 0 (`:385`)" sentence | `evidence/extensions/extension-lifecycle/2026-09-16T06-31-40.371Z/` — `steps.packed.negativeControl`: `falsifiable: true`, `packerExitGated: true`, the three broken fixture trees `ok: false` |
| F10 — the child-stderr-tail clause has no lane arm | **fixed** | `skills/dsh-qa/scripts/extension-mcp-bridge.ts` gained a `stderr` arm: a fixture child floods 3053 marked stderr bytes and dies before the handshake; the arm asserts the reported tail keeps the tail markers, drops the head marker, and equals the cap read from `packages/mpd-ext-plugin/src/mcp-client.ts` | `evidence/extensions/extension-mcp-bridge/2026-09-16T06-31-25.127Z/` — `steps.stderr`: `cap 2000`, `reportedTailLength 2000`, `headDropped true`, `tailKept true`, `vacuous false` |
| F2 — no single plane-selection rule | **absorbed by the guides** | `docs/extension-authoring-guide.md` §2 carries the one rule, and the zh-CN twin carries the same one | this guide pair, linked from `docs/index.md` |
| F3 — the isolation posture and its residuals are undocumented | **absorbed by the guides** | `docs/extension-authoring-guide.md` §3 states the posture and names its four accepted residuals, anchored to (`INHERITED_ENV_VARS`, `packages/mpd-ext-plugin/src/mcp-client.ts:69-85`) and `:87-97` | this guide pair |
| F4 — restart asymmetry | **absorbed by the guides** | `docs/extension-authoring-guide.md` §4 is the lifecycle-and-restart matrix that juxtaposes the two modes | this guide pair |
| F6 — evidence freshness | **deferred, boundary-marked** | the pre-`c239407` directories are inventoried and neither re-run, edited nor deleted | `evidence/extensions/boundary-index/INDEX.md` |

Two things this table deliberately does not say. It does not claim F8/F9/F10 as verified from a task
description: each of the three rows above names the lane run that delivered it, none of them is
inferred, and all three lanes were independently re-run and re-read by the wave's verification task
(`evidence/extensions/verify-skills/20260916T064350Z/`). The wave's new template lane `skills/dsh-qa/scripts/extension-template.ts` (case row
`extension-template`) is the fourth entry in the extension gate list, and it recorded a green real
mount under `evidence/extensions/extension-template/2026-09-16T06-31-12.171Z/` (skill, flow, role and
the template's own MCP tool, every claim read from the harness session log). And the wave's single
skills re-pin has LANDED: `VENDOR_LOCK.json` now reads `fileCount 318` /
`treeSha a8ba96b8108b2df3cce707e7b69d038f71514cea9e0c488683ba79012efc8d12`, replacing the before value
(`fileCount 317` / `treeSha 7a48fdad90cc30f9c1e71009be216aeb8b2a1de797eb2bb1897032c41f6b51aa`) — one
re-pin, in the same change set as the F8/F9/F10 edits (AGENTS.md §9/§11), verified by
`node scripts/verify-vendor.ts` (PASS). The packed-tree CLI deviation below is disclosed, measured and
**not** fixed in this wave.

### One measured deviation: the developer CLI is RED inside a packed artifact

**Not fixed in this wave** (tracked as T-51 in the wave ledger, since removed from the tree). The packer copies only
`packages/<pkg>/dist` (`cpDist`, `scripts/pack-mpd.ts`) and never `src`, while the developer CLI
imports its validator from `src` (`"../packages/mpd-ext-plugin/src/registry.ts"`, `scripts/mpd-ext.ts:45`; the source table spans
`SOURCE_VALIDATOR`, `scripts/mpd-ext.ts:48-56` and the compiled fallback sits at `:60`).
Inside a packed tree every CLI entry point therefore exits 1 with
`Cannot find module '<packed>/packages/mpd-ext-plugin/src/registry.ts'`. Measured on a probe tree built
from the packer's own output (`evidence/extensions/template-scaffold/20260916T063710Z/raw/packed-tree-probe.json`,
arms A and B): as packed, `validate`, `scaffold` and `--self-test` are all exit 1; with `packages/*/src`
restored, `validate` returns 0 while `scaffold` and `--self-test` still fail, because no `templates/`
entry is packed either. AGENTS.md §4's Extension-CLI gate therefore holds in a CHECKOUT (where both
`src` and `templates/` exist) and is RED in a packed artifact until the packer ships them. The agent
contract's own copy of this limit is in `EXTENSIONS-FOR-AGENTS.md` §9.

**FIXED 2026-09-17 (friction wave, lane E — T-35/T-36/T-45/T-51).** The packer now
ships `templates/` and the `docs/` set (user decision: a packed install is author-facing), and it <!-- citation-check: illustrative: a pack-time artifact emitted by the packer into the artifact, not a repo path -->
emits a compiled validator entry `packages/mpd-ext-plugin/dist/validator.js` — the shipped bundle
plus ONE `export { … }` line, so the plugin module itself is untouched — which `scripts/mpd-ext.ts`
falls back to when `src` is absent. Measured on a freshly packed `dist/mpd-package/`: `validate`
(the example AND the template), `scaffold` (into a temp dir) and `--self-test` are all exit 0 under
bun and under plain `node`, and `node scripts/verify-pack-closure.ts` fails loudly when an asset is
seeded missing. Evidence: `evidence/pack-closure/impl/20260917T011849Z/result.json`. The paragraph
above stays as the measurement of the wave that wrote it — the limit it records is closed.


### Evidence note: the template lane's three stamps

`evidence/extensions/extension-template/` holds three runs from one hour — `2026-09-16T06-30-30.275Z/`
(RED), `2026-09-16T06-31-12.171Z/` (GREEN) and the independent verifier's GREEN later that hour in a
different sandbox. The lane was EDITED between the first two runs and it is an untracked file, so its
pre-fix expectation is **not reconstructible from the repository alone**: a third party cannot re-derive
why the first stamp was red. What the reviewer established from the recorded artifacts is precise — the
first run's MCP `tool/result` ALREADY carried the copy's id, its own root, `enabled:true` and all four
kind strings, and the `server process exited (code=0)` teardown line is identical in all three runs — so
the RED was the CASE's own expectation (its `mcp` step read `ok:false` and that step lacked the
`servedOwnRoot` / `servedFourKinds` keys), **not** a product defect, and there is no flakiness signal.
The expectation was corrected in the next stamp; the product result was already correct.
