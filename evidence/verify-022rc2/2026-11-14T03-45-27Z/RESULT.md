# T16 — RE-VERIFICATION of the repaired tree (loop `loop-20261114T025059-3f5ed1`)

Seat: Reviewer (verifier seat `963bd1f8-bb9e-46d1-8870-775694273871`).
Contract: `.mpd/plans/adapt-dsh-022rc2-tui-020.md` (§7f A3, §7g A4, §7h A5, §7i A6) + the shipped docs.
Every number below is a measurement taken in this evidence directory; no writer's report is a source.

## 0. What this pass re-measured, in one table

| Claim under test | Measurement | Result |
|---|---|---|
| Both hosts INSTALL (previous BLOCKER 1) | three arms at a CLEAN anchor outside the checkout: `mount-rc2-work`, `mount-rc1-work`, `mount-rc1-head` | **exit 0 / 0 / 0** |
| `bun test packages` (previous BLOCKER 2) | `.toolchain/node_modules/.bin/bun test packages` | **4164 pass, 6 skip, 0 fail**, exit 0 |
| §6 gate table | `verify:gates` with the pinned rc.2 harness | **11/11 members green** on a clean-anchor host; 10/11 on the flat `.qa-tmp/dsh-022rc2` prefix (host-shape, §2) |
| rc.2 mount arm | probe reads `ctx.loader.entries()` | three bundle team rows **disabled=true**, host `agent-team`/`tool-agent-team` **disabled=false**, no `already registered` |
| rc.1 mount arm | same probe | three bundle rows **disabled=false** |
| Capability set vs `0.18.1` | rc.1 work tree vs `git archive HEAD` export | **identical: 29 active ids each, 0 diff** |
| Guard composition | independent sha256 of the HEAD clause | `6f60ed8f…` / `90bd8547…` = the installer pins; each HEAD clause is byte-identical inside the composed scalar |
| Live preset conformance | real case, both hosts | **PASS both**: rc.1 29/28 declared vs ref 28/27, `extra:["tool-office"]` GUARDED NOTE, `problems:[]`; rc.2 29/28 vs 29/28 exact; both `agentPreset:"mpd"`, `bootLog.signatures:[]` |
| Gate semantics judged | self-test arms (iv)(v) + live notes + the residual `unchecked` branch | **sound** (§3) |
| Second re-pin | `VENDOR_LOCK.json` vs shipped corpus | skills `treeSha ef2743be…`, `fileCount 393`, `verify-vendor` 0 |
| CI harness derivation | the verbatim CI expression | prints **`0.2.2-rc.2`** (TUI: `0.20.0`); no tracked dsh team package |
| Docker real-machine lane | `bun run verify:docker --mode all --require-docker --no-browser` | see §5 (result appended when the lane returns) |

## 1. Clean-anchor discipline (the whole point of A6)

The anchor for every install/mount arm is `/home/haroldzhao/.t16-verify` — **outside**
`/home/haroldzhao/MyProj/DshProj/My-Power-Dsh`. Each arm's `env.log` records the anchor, the harness
realpath, the source realpath and the profile path; the profile resolves to
`/home/haroldzhao/.t16-verify/runs/<arm>/dsh-home/profiles/t16`, never inside the checkout.

The harnesses are FRESH `npm i -g --prefix … @deepseek-ai/dsh@0.2.2-rc.{1,2}` installs (npm 11.19.0).
On this npm a global install is NESTED: `…/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-persona`.
That is the shape the gates and the mounts ran against.

## 2. The gate table, and the one host-shape dependency it has

`verify:gates` against the clean-anchor rc.2 harness: **PASS — 11/11 members green** (`logs/verify-gates-cleananchor.log`).
Individually on the same host: typecheck 0, no-host-override 0 (226 host-declared ids), manual-paths 0,
preset-conformance `--self-test` 0 (33 harness rows conform, 4 schema-free, persona prefix=true, mpd preset
29 children, parity 28/28, negative controls 6/6 reddened), dshgo LEGAL (COMPAT PASS), vendor 0,
dist-fresh 0, install-profile `--self-test` 0, verify:rows 0, docs-parity 0, manifest 0, comments 0,
graph-model 0, workflows 0, tui-admission PASS (49 arms, 1 allowed deviation, 5 bounds,
`H.chain:bundle` + `H.chain:package` = `compatible` against dsh-tui 0.20.0).

**The dependency is real and it is a LANE fact, not a tree fact.** Against the OLD flat prefix
`.qa-tmp/dsh-022rc2` (`<prefix>/lib/node_modules/@deepseek-ai/*` as siblings, no per-package
`node_modules`), two members go red:

- `preset-conformance` — `self-test: the installed @deepseek-ai/dsh-persona exposes no config schema (unresolved)`
  (`logs/preset-conformance-selftest.log`). This is the QA-script resolver defect the contract ALREADY
  declares in §7f ("resolves each row's schema from `<harnessRoot>/node_modules`, which does not exist in
  a hoisted harness install … the fix is a QA-script row for the NEXT wave and is recorded here as a
  declared bound").
- `verify-no-host-override` — `cannot resolve js-yaml from any anchor` (`logs/no-host-override.log`).
  NOT covered by that declaration, and not caused by this wave's rows: the same gate PASSES against the
  ambient nested harness and against the clean-anchor rc.2 harness.
  Both are green against the clean-anchor host and against a fresh `npm i -g` install, which is the
  shape CI produces; neither is a shipped-tree defect. The §6 line naming `.qa-tmp/dsh-022rc2` as the
  pinned harness is what makes them look red.

## 3. The two gate-semantics changes — independent judgement

Measured, not read from a writer:

- Self-test arm **(iv)**: `GUARDED host-optional extra row -> no parity problem, and a NOTE names it`.
- Self-test arm **(v)**: `UNGUARDED extra row still FAILS and the problem names it` — the
  `workflow-worker-thread`-shaped drift is still caught.
- Live rc.1 case: `extra:["tool-office"]` classified as a NOTE while `problems:[]`; the second note says
  in its own words that "an UNGUARDED extra row still fails".
- Live rc.2 case: the three guarded `dsh-experimental-*` rows appear as ONE `hostOptional` NOTE and the
  case is `ok:true` instead of red.

Judgement: **both are sound.**
1. `extra` + a `!!js` mount guard ⇒ NOTE: the guard is a load-time capability decision, the rule is
   general (no id whitelist — `isGuardedRow` tests the loader's `__jsExpr` marker, one predicate for
   every row), and the unguarded direction keeps its blocking power (arm (v) pins it).
2. guarded + unresolvable ⇒ `hostOptional` NOTE: the audit cannot resolve the package, and for a row the
   guard itself disables that is not an audit hole. The residual risk — a guarded row that WOULD be
   enabled on this host yet cannot resolve — is covered INSIDE the same gate by the live arm: the real
   case mounts the preset through `session/create`, which "refuses on any inactive row"; a genuinely
   enabled-but-unresolvable row reddens there. The widened class is therefore compensated, not lost.
3. The remaining `unchecked` rule still catches what it was for: `preset-conformance.ts:519-520` routes
   an **unguarded** unresolvable row to `unchecked` (a blocking problem, `:686`), and only a guarded one
   to `hostOptional` (a note, `:688`). No row of the shipped presets falls in `unchecked` on either host.

## 4. Both mount arms, from the loader's own entry table

Probe row inserted through a `--patch` overlay reads `ctx.loader.entries()` after settling
(`mount-*/probe-summary.json`, `mount-*/probe.settled.json`).

| entry | rc.2 (work) | rc.1 (work) | rc.1 (HEAD 0.18.1) |
|---|---|---|---|
| `mpd-agent-team` | disabled=true | disabled=false | disabled=false |
| `mpd-tool-agent-team` | disabled=true | disabled=false | disabled=false |
| `mpd-ui-agent-team` | disabled=true | disabled=false, **active=true** | disabled=false, **active=true** |
| `agent-team` (host) | present, disabled=false | absent | absent |
| `tool-agent-team` (host) | present, disabled=false | absent | absent |
| total entries / active | 138 / 28 | 136 / 29 | 136 / 29 |

- rc.2 boots with **zero bundle team rows mounted** and no `service "agentTeams" has been registered`,
  no `already registered`, no `team:policy` duplicate (`mount-rc2-work/boot.log`, 2 lines total).
- rc.1 boots with the three rows enabled; the active-id set is byte-identical to the `0.18.1` export
  (`logs/rc1-capability-diff.json`: `identical:true`, `onlyInWork:[]`, `onlyInHead:[]`).
- The generation guard's own line, recorded in both arms:
  rc.2 `generation=new source=argv1 … oldRows=disabled newRows=enabled`;
  rc.1 `generation=old source=argv1 … oldRows=enabled newRows=disabled`.
- The one entry that never activates in ANY of the three arms is `preset-mpd (@deepseek-ai/dsh-agent-preset):
  pending (waiting for service: agentPresets)` — identical on the 0.18.1 baseline, and the live
  conformance case proves the preset mounts when a session is created (`agentPreset:"mpd"`, HTTP 200).
  Not a regression; recorded as an observation.

## 5. Docker real-machine lane

**Command** (rootless daemon present, so a SKIP would not have been acceptable):
`bun run verify:docker --mode all --require-docker --no-browser` → **exit 1**. Transcript:
`logs/docker-e2e.log`; container evidence `evidence/docker/client-install/2026-11-14T04-05-41Z/` and
`evidence/docker/client-install-oneclick/2026-11-14T04-13-00Z/`.

| mode | passed | failed | null (skipped) | FAILED ids |
|---|---|---|---|---|
| `source` | 159 | **4** | 81 | `pack.staticCoherence`, `pack.distFreshRebuild`, `qa.readonlyDeny`, `compose.agentTeamRows` |
| `oneclick` | 159 | **3** | 82 | `pack.staticCoherence`, `qa.readonlyDeny`, `compose.agentTeamRows` |

What DID run green: the install (step `09-install` exit=0), the composition dump (`10-dump` exit=0),
the ast-grep engine, the MCP surface, and the TUI lane — `tui.laneExit=true — the TUI lane ran to
completion with every assertion green` — plus the `14b-user-surface` arm. The previous wave's Docker
runs (`evidence/docker/client-install/2026-11-10T11-39-59Z`, `…-oneclick/2026-11-10T11-47-52Z`) were
**239 rows / 0 fails**, so these are new reds. Analysis in §7.

## 6. Bounds declared in this pass (not green, not hidden)

- **TUI 0.20.0 seam binding could not be driven to the main shell.** The bundle installs into a fresh
  `dsh-tui` profile (host 0.20.0 install 0, bundle install 0, probe install 0), the profile composes
  158 entries with all ten host rows (`dsh-tui`, `panels`, `scenes`, `settings-sections`,
  `command-trees`, `plugin-host`, `extensions`, `oauth`, `workspaces`, `working-activity`) enabled and
  the three bundle team rows disabled, and a real TTY renders the TUI (tmux pane, 2812 bytes,
  onboarding screen). Reaching the main shell failed in the HOST's own Ink layer —
  `Error: write EIO` at `Ink.probeAltScreenHealth` / `onStdinResume` in
  `…/dsh-tui/lib/types/ink/ink.js` — so no `tui*` seam bound (`boundSeamCount:0`). This wave changes
  **no TUI plugin source** (`git diff --stat packages/mpd-tui-plugin/src packages/mpd-tui-adapter-plugin/src`
  is empty; only `dist/` and the `compat.hosts` band moved), so the seam behaviour is unchanged by
  construction; the 0.20.0 capability claim is carried by `tui-admission` (49 arms, 5 contracts
  advertised by the installed host). The runtime binding remains BOUNDED, not green.
- **Live TTY capture**: the pane above IS a live capture of dsh-tui 0.20.0 + this bundle, but it does
  not reach the workspace UI; `docs/tui.md` §11.15's "'no live TTY capture' claimed" bound therefore
  stays true for the workspace surface.
- **Docker**: exact command and outcome in §5.
- `0.2.1-rc.5` remains out of this lane's reach (unchanged from the previous pass).

## 7. Findings

**F1 — BLOCKER. The required Docker lane asserts the three `-rc2` rows this wave DELETED.**
`docker/entrypoint.sh:1206-1208` (edited by this wave, `git diff -U1 docker/entrypoint.sh`) now requires
the six-row shape: the `(-rc2)?` id regex, `TEAM_PREDICATE_HITS -ge 6` and the text "need >=6, one per
team row". After A3 deleted the three `@deepseek-ai/dsh-agent-team` rows, the assertion is
unsatisfiable — measured in BOTH modes: `FAIL compose.agentTeamRows — team-row composition incomplete
for a generation-neutral host: row ids missing=mpd-agent-team-rc2,mpd-tool-agent-team-rc2,mpd-ui-agent-team-rc2;
package names missing=none; generation-predicate hits=6 (need >=6)`. At HEAD the same assertion named
the THREE mpd-owned ids and the lane was green (239/0 on 2026-11-10), so this is a wave-introduced red
in a REQUIRED gate: `AGENTS.md` §4 makes the Docker real-machine lane mandatory for any
install/mount-path change and states a SKIP is never a pass. Repair: re-assert the three-row shape
(drop the `(-rc2)?` alternation and the `>=6` predicate count, or make the count derive from the rows
actually shipped).

**F2 — HIGH. The live read-only case is red on the pinned rc.2 host (mechanism mismatch, not a leak).**
Both modes: `FAIL qa.readonlyDeny — the live readonly-deny case … did NOT pass in this run (exit=1)`
(`…/owed/owed-logs/qa.readonlyDeny.log`): `positiveOk.ok=false` with
`childScopeApplied:false, childScopeSource:"none", childScopeSource:none` while
`childLeaksWriteCapable:[]` and `parentSeesAllDenyNames:true`; the case's own `mechanism` block records
`startSpecMechanism:true` and "this host still honours the START-SPEC filter … the child leaked
nothing". So the DISCIPLINE holds (no write-capable tool reached the child) but the case's
child-scope expectation no longer matches the pinned harness. It was green in the previous wave's
Docker run and the harness pin move is the only variable; `A1`/`A2` make the read-only discipline part
of this wave's contract, so the case must be re-calibrated (or the mechanism adapted) and the outcome
declared — a required QA case may not be left red.

**F3 — MEDIUM (environment-carried). `pack.staticCoherence` red: the packed artifact predates the wave.**
`dist/mpd-package/` is GITIGNORED (`git check-ignore` → `.gitignore:13`) and present on this machine
from the previous release; the lane deliberately ships it into the image as the pack assertions'
subject, so it reports `65 differing file(s)` — `drifted=AGENTS.md,CHANGELOG.md,README.md,…,
cordis.patch.yml,docs/compatibility.md,…`. A fresh checkout carries no such artifact, so this red is
not a property of the tree; it IS a release-step reminder (`node scripts/pack-mpd.ts`) and must not be
counted as a pass either way. `pack.distFreshRebuild` (source mode only) follows from the same stale
artifact: 24 differing dist entries under an identical bun 1.4.0.

**F4 — LOW. Docs carry pre-wave parity numbers.**
`docs/compatibility.md:34` ("row parity 27/27 … both negative controls red as expected") and `:75`
("row parity 27/27, negative controls 4/4 reddened"), with the zh-CN twins at `:31` and `:67`. Measured
on the pin: ours 29 declared / 28 active vs the shipped `standard`'s 28 declared / 27 active, with
`tool-office` a GUARDED NOTE and `problems:[]`; negative controls are 6/6 in the self-test. The numbers
are stale because this wave added `tool-office`; the counts should be re-measured or stated as the
guarded-note shape.

## 8. What was CLEARED (the previous verdict's items)

- **BLOCKER 1 (install rejected) — CLEARED, not reproduced.** Three clean-anchor installs exit 0. The
  previous refusal reproduces only with an anchor inside the checkout (A6), which I did not use.
- **BLOCKER 2 (4 test failures) — CLEARED.** `bun test packages`: 4164 pass, 0 fail.
- **HIGH (preset-conformance red) — CLEARED on a standard install.** 11/11 members green, both live
  cases PASS. The flat `.qa-tmp/dsh-022rc2` prefix still reddens it exactly as §7f declares.
- **The six-row guard polarity finding — CLEARED.** Three rows, correct polarity on both hosts,
  HEAD clauses byte-identical and sha256-pinned.
- **Dist re-staleness — CLEARED.** `verify-dist-fresh` 0 (35/35 fresh).

## 9. Record

Verdict recorded on `loop-20261114T025059-3f5ed1`: **FAIL** `rec-20261114T042343-d23ea0`, repair
`rep-20261114T042343-bf18b0`. Seat: verifier `963bd1f8-bb9e-46d1-8870-775694273871`.
