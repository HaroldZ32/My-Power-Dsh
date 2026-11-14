# T21 — FINAL verification (third pass): verdict, measurements, evidence

- **Loop**: `loop-20261114T025059-3f5ed1` (verifier seat bound in this session, 1 frozen doc).
- **Branch / HEAD**: `feature/dsh-022rc2-tui-020` @ `7c1680af` (uncommitted wave tree).
- **Contract**: `.mpd/plans/adapt-dsh-022rc2-tui-020.md` (§6 gate table, §7f A3, §7g A4, §7h A5, §7i A6).
- **Seat**: Reviewer (read-only verifier). Findings only; nothing here is a fix.
- **Verdict**: **FAIL** — one measured fact: the shipped `dist/mpd-package` artifact is stale relative
  to the third `VENDOR_LOCK.json` re-pin, so the required Docker lane exits 1 in BOTH modes
  (`--mode source` and `--mode oneclick`). Everything else measured below is green.

## 0. What this pass was asked to decide

1. `bun run verify:gates` = 11/11 with the pinned rc.2 harness and a discoverable 0.20.0 TUI host.
2. tests / typecheck / no-host-override / manual-paths / dshgo / vendor / dist-fresh, exit codes quoted.
3. BOTH Docker modes (`--require-docker --no-browser`), both stamps cited; a SKIP is never a pass.
4. Both mount arms still hold (rc.2 zero bundle team rows + host plane; rc.1 three rows, active-id set
   identical to 0.18.1) — re-ran vs carried forward stated explicitly.
5. The third re-pin's `treeSha` matches the shipped corpus and `VENDOR_LOCK.json` is consistent.

## 1. Tree delta since the T16 verdict (`2026-11-14T03-45-27Z`, RESULT.md mtime 12:23:49 +08:00)

Measured by mtime over every dirty path — **exactly the claimed five**, nothing else:

| mtime (+08:00) | path | owner |
|---|---|---|
| 12:26 | `docker/entrypoint.sh` | T17 (row arm) |
| 12:30 | `docs/compatibility.md`, `docs/compatibility.zh-CN.md` | T19 (parity numbers) |
| 13:02 | `skills/dsh-qa/scripts/readonly-deny.ts` | T20 (`decideEnforcement`) |
| 13:10 | `VENDOR_LOCK.json` | third re-pin |
| 13:02 | `dist/mpd-package/package.json` (gitignored re-pack) | pack |

No file under `packages/*/src`, no `packages/*/dist`, no `cordis.patch.yml` (mtime 11:38),
`presets/mpd.patch.yml` (11:30) or `package.json` (11:37) moved. The five delta files are also the
ONLY dirty paths newer than the T16 RESULT.

## 2. Static gates (all runs from the repo root)

Environment: fresh nested anchors **outside the checkout** at `/home/haroldzhao/.t21-verify/host-rc2`
(`npm i -g @deepseek-ai/dsh@0.2.2-rc.2` → `0.2.2-rc.2`) and `…/host-rc1` (`…@0.2.2-rc.1` →
`0.2.2-rc.1`); TUI host `.qa-tmp/tui-020/lib/node_modules/@deepseek-harness-tui/dsh-tui` (0.20.0),
exported as `MPD_DSH_TUI_HOST` and `DSH_TUI_ROOT`; `MPD_DSHGO_KIT=$PWD/.mpd/tmp-dshgo/kit`.

| Gate | Command | Exit | Measured |
|---|---|---|---|
| Aggregate | `bun run verify:gates` (nested rc.2 anchor) | **0** | **11/11 green** |
| Tests | `bun test packages` | **0** | 4164 pass / 6 skip / 0 fail, 268 files, 54373 expects |
| Types | `bun run typecheck` (`tsgo --noEmit`) | **0** | no output |
| No host override | `node scripts/verify-no-host-override.ts` | **0** | PASS, 0 of 0 id-targets collide with 220 host-declared ids |
| Manual paths | `node scripts/verify-manual-paths.ts` | **0** | PASS resolved=160 over-report=72 under-report=84 declared=2 |
| DSH-Go | `node scripts/verify-dshgo-standard.ts` | **0** | LEGAL — PIN 8/8, MANIFEST/VIEW/COMPAT/HOST PASS, CROSS-CHECK PASSED |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | **0** | 35/35 targets fresh (each rebuilt twice), 1 NOT COVERED (`mpd-mcp-codegraph/dist/serve.js`, documented prebuilt) |
| Vendor | `node scripts/verify-vendor.ts` | **0** | PASS — 8 shipped assets fingerprinted |
| Re-pin check | `node scripts/repin-vendor.ts --check` | **0** | GREEN — drift=0 problems=0 |

Aggregate members (per-member lines in `logs/verify-gates-nested.log`): vendor 0, dist-fresh 0,
rows-parity 0, docs-parity 0, preset-conformance 0, plugin-manifest 0, comment-coverage 0, graph-model 0,
workflows 0, tui-admission 0, dshgo 0. Notable subjects:
`preset-conformance --self-test`: 33 harness rows conform (4 schema-free), persona prefix=true, mpd
preset 29 child rows, parity 28/28, **negative controls 6/6 reddened**;
`tui-admission`: REPORT PASS — 49 arms, 1 allowed deviation, 5 bounds, host `0.20.0` discovered and
inside the declared band, both manifests negotiated `compatible`.

**Same aggregate on the §6-spelled flat prefix** (`PATH="$PWD/.qa-tmp/dsh-022rc2/bin:$PATH"`) exits 1
because `preset-conformance` **self-test** reddens with `the installed @deepseek-ai/dsh-persona exposes
no config schema (unresolved)` — the hoisted-install resolver defect the contract itself declares
(§7f A3: "QA-script defect (separate, pre-existing, NOT wave-editable)"; the same file is unchanged
since 11:33). Alone on the ambient PATH the self-test passes (exit 0, 33 rows, parity 28/27, 6/6
controls). Logs: `logs/verify-gates.log` (flat) vs `logs/verify-gates-nested.log` (nested).

## 3. Docker real-machine lane (LAST in the §6 order)

Command (both runs, from the repo root, pinned toolchain, rootless daemon present — `docker info`
reports `rootless` in SecurityOptions):

```
.toolchain/node_modules/.bin/bun run verify:docker --mode <source|oneclick> --require-docker --no-browser
```

| Mode | Stamp (evidence root) | Driver exit | Facts |
|---|---|---|---|
| `--mode source` | `evidence/docker/client-install/2026-11-14T05-12-50Z/` | **1** | passed=162 failed=1 null=81, `FAILED=[pack.staticCoherence]` |
| `--mode oneclick` | `evidence/docker/client-install-oneclick/2026-11-14T05-20-08Z/` | **1** | passed=161 failed=1 null=82, `FAILED=[pack.staticCoherence]` |

Both runs were real runs (rootless daemon, `--require-docker`), never a skip: the driver's own
`[driver] evidence -> …` line names each stamp, and neither log contains an `UNMEASURED` line.

### 3.1 `--mode source` — one failing fact, and it is the stale pack

```
[report] FAIL pack.staticCoherence … 1 differing file(s) … | raw: drifted=VENDOR_LOCK.json untwinned=none
[owed-pack] pack.staticCoherence=false — the artifact does NOT agree with the tree it was cut from
```

Root cause, measured directly in the checkout (not inferred):

```
sha256 tree VENDOR_LOCK.json                      95c77ab03a5f…
sha256 dist/mpd-package/VENDOR_LOCK.json          b4afcab55f4d…
skills treeSha in dist/mpd-package/VENDOR_LOCK.json  ef2743be…   (the SECOND re-pin)
skills treeSha in VENDOR_LOCK.json                   af807e03…   (the THIRD re-pin)
mtime dist/mpd-package/package.json  13:02:47      mtime VENDOR_LOCK.json  13:10:21
```

The pack was cut eight minutes BEFORE the third re-pin landed, so the artifact carries the old lock.
The rest of the pack assertion is green and therefore isolates the fault: `pack.present=true`
(687 files, 20 258 224 B), `pack.licenceCoherence=true`, `pack.declarationCoherence=true` (27 `files`
entries, 2 bundle-patch layers, 29 row module paths resolve, no host tree travelled),
`pack.distFreshRebuild=true` (all 35 built entries byte-identical to the container's own rebuild under
bun 1.4.0), and the negative control reddens (`pack.distFreshRebuild=false` on a mutated copy, so the
freshness arm is falsifiable).

Everything the previous FAILs covered is now green in this lane:
`compose.agentTeamRows=true` (three mpd-owned rows with the ONE generation predicate, additive-only),
`boot.teamRowGenerationLive=true` ("the 0.2.2-rc.2 host DISABLES all three bundle team rows … while the
HOST plane is live"), `boot.agentTeamService=true`, `tui.laneExit=true` / `tui.sessionPreset=true`
(agentPreset=mpd), `qa.readonlyDeny=true`, mcp surface + naming, install closure (no build script),
`userSurface` arm step exit 0 (`assertions=120 passed=85 failed=0 … problems=0`, 35 NOT_PROVEN rows
declared as bounds with their own markers), and no UNMEASURED required arm (0 lines).

### 3.2 `--mode oneclick` — the same single fact

```
[report] FAIL pack.staticCoherence … 1 differing file(s) … | raw: drifted=VENDOR_LOCK.json untwinned=none
[driver] ok=false complete=false passed=161 failed=1 null=82 FAILED=[pack.staticCoherence]
```

This is the mode the earlier pass could not clear, and everything it grades about the PUBLISHED
artifact is green: `oneclick.scratchRepo=true` (a real git scratch remote, so the spec resolved through
the real git path), `oneclick.requiredPaths=true`, `oneclick.filesAllowlist=true` (no frozen evidence
tree, no git history, no lane scratch in the installed package), `oneclick.distByteIdentical=true`
(36 committed dist entries landed byte-identical — the install ran no build), `install.exit=true`,
`compose.agentTeamRows=true`, `boot.teamRowGenerationLive=true` (same host-plane reading as source),
`tui.laneExit=true`, `qa.readonlyDeny=true`, and the user-surface arm ran
(`assertions=120 passed=85 failed=0 … problems=0`, 35 declared bounds). The `null=82` rows are the
mode's honest `null`s (`build.*` / `pack.distFreshRebuild` / every `live.*` and `ui.*` arm) — a null is
reported, not a pass, and none of them is a required arm of this invocation (0 `UNMEASURED` lines).

**Conclusion:** the Docker lane is RED in BOTH required modes on ONE fact — the shipped pack carries the
previous `VENDOR_LOCK.json`. The repair is the release step the tree is missing, not a source change:
re-cut the artifact AFTER the final re-pin (`node scripts/pack-mpd.ts`), then re-run only these two
lanes.

## 4. Mount arms — what was RE-RUN vs CARRIED FORWARD

Re-ran, on fresh clean anchors (harness + DSH_HOME + profile + cwd all under
`/home/haroldzhao/.t21-verify`, i.e. outside the checkout, so `createRequire` cannot climb into the
repo's `node_modules`):

| Arm | install | dump | boot (25 s) | loader probe |
|---|---|---|---|---|
| rc.2 work (current tree) | exit 0 | exit 0 | exit 124 = the 25 s timeout BY DESIGN | 138 entries / 28 active |
| rc.1 work (current tree) | exit 0 | exit 0 | exit 124 = by design | 136 entries / 29 active |
| rc.1 HEAD (`git archive HEAD` = 0.18.1) | exit 0 | exit 0 | exit 124 = by design | 136 entries / 29 active |

- **rc.2**: guard line `generation=new source=argv1 argv1=…/.t21-verify/host-rc2/bin/dsh
  harness=0.2.2-rc.2@… oldRows=disabled newRows=enabled`; all three `mpd-*agent-team` rows
  `disabled=true, active=false`; host rows `agent-team` / `tool-agent-team` `disabled=false`;
  no `already registered`, no `has been registered`, no `team:policy`, no `Error:`. TOTAL=138 ACTIVE=28
  — identical to T16's rc.2 numbers.
- **rc.1**: guard line `generation=old … oldRows=enabled newRows=disabled`; all three `mpd-*agent-team`
  rows `disabled=false` (`mpd-ui-agent-team` `active=true`), host rows absent (rc.1's `dsh-base`
  declares none). TOTAL=136 ACTIVE=29.
- **0.18.1 identity**: the rc.1 work arm's active-id SET equals the `git archive HEAD` export's set —
  `onlyInWork: []`, `onlyInHead: []` (29 vs 29 ids).
- One boot warning in every arm: `preset-mpd (@deepseek-ai/dsh-agent-preset): pending (waiting for
  service: agentPresets)` — the same line T16 measured on HEAD, not a regression.

Live preset conformance (`node skills/dsh-qa/scripts/preset-conformance.ts`, no `--self-test`):

| host | exit | parity |
|---|---|---|
| rc.2 (`…/.t21-verify/host-rc2`) | 0 | ours 28/29 vs reference 28/29, `missing:[] extra:[]`, no problems, agentPreset=mpd (200), bootLog signatures [] |
| rc.1 (`…/.t21-verify/host-rc1`) | 0 | ours 28/29 vs reference 27/28, `extra:["tool-office"]` as a GUARDED NOTE, no problems, agentPreset=mpd (200), signatures [] |

Both negative controls reddened (`agent-preset/invalid`, persona prefix). The docs' new numbers
(§6 below) are exactly these.

**Carried forward from T16 (not re-run in this pass)**: the TUI 0.20.0 live seam arm (T16 bound: the
host's own Ink layer dies `write EIO` under a detached pty; no TUI plugin source has changed since),
the contaminated-anchor refusal reproduction, and the T16 `mount-rc1-head` comparison *mechanism*
(the comparison itself was re-executed above on this tree).

## 5. Third re-pin and `VENDOR_LOCK.json` consistency

- `VENDOR_LOCK.json` diff vs HEAD is **one line**: `assets.skills.treeSha`
  `2997619a…` → `af807e03cfeed04cee2648445268bea6ef78634124da77d7deb62f336e038a33`; `fileCount` 393
  unchanged; no other asset touched.
- `node scripts/repin-vendor.ts --check` recomputes the corpus from the git index: `computed (LF) :
  treeSha=af807e03… fileCount=393 (1 file LF-normalized)` == locked, **GREEN (drift=0, problems=0)**.
  (It also prints the raw-bytes hash `21ded817…` and labels it "NEVER write this one" — the LF form is
  the locked one.)
- `node scripts/verify-vendor.ts` exit 0: all 8 shipped assets OK.
- Consequence recorded in §3.1: the SHIPPED PACK still carries the previous corpus hash — the re-pin is
  correct in the tree and stale in the artifact.

## 6. Do the docs claim only what the tree carries?

`docs/compatibility.md` (and the zh twin) were re-checked against this pass's measurements:

| claim | measured | verdict |
|---|---|---|
| rc.1: mpd mounts "28 active rows of 29 declared against standard's 27 of 28", `tool-office` as GUARDED NOTE, `problems:[]` | oursDeclared 29 / oursActive 28 vs referenceDeclared 28 / referenceActive 27, `extra:["tool-office"]` note, no problems | matches |
| rc.2: "an exact 28/29 vs 28/29 with no missing, extra or problem row" | 29/28 vs 29/28, `missing:[] extra:[]` | matches |
| self-test "six negative controls all redden" | `negative controls: 6/6 reddened` | matches |
| core target `0.2.2-rc.2`, TUI target `0.20.0`, minimum `0.2.1-rc.5` / `0.18.0` | dsh-distribution coordinate `0.20.0`; aggregate dshgo/tui-admission green; engines span unchanged | matches |
| version statement "the `0.19.0` release" | `package.json`, `dsh-plugin.json` both `0.19.0` | matches |

`verify:docs` (member `docs-parity`) exit 0: pairs=61 failed=0 violations=0 links=636 dead=0.
The one wording bound is declared by the page itself: it says the guarded-extra NOTE rule is a
DECLARED gate-semantics change under independent review — which is §7 below, not a fact the page
certifies.

## 7. The two semantic changes (contract §7h) and the T20 enforcement split — verifier judgement

1. **Guarded extra ⇒ NOTE, unguarded extra still FAILS.** The rule is general: `isGuardedRow` tests for a
   `!!js` `disabled` payload, with no id whitelist. Self-test arm (iv) pins the NOTE direction and arm
   (v) pins the FAIL direction (`self-test-unguarded-extra` still reddens); the live rc.1 case shows
   `tool-office` as a NOTE with `problems:[]` while an unguarded extra would still be a problem at
   `preset-conformance.ts:519-520` / `:686`. **Sound.**
2. **Guarded + unresolvable ⇒ `hostOptional` (was `unchecked`).** The widening is compensated by the same
   gate's live `session/create` arm, which refuses any row the host could not activate, and `unchecked`
   still blocks an UNGUARDED unresolvable row. Self-test arms pin both directions. **Sound.**
3. **T20 `decideEnforcement` (readonly-deny).** The split separates UNPROVEN from LEAKED, and the four
   new controls pin both directions: (i) no child request + no carrier evidence ⇒ RED and the note says
   UNPROVEN, never LEAKED; (ii) no child request + the WHOLE carrier set ⇒ GREEN and NAMES the
   START-SPEC carrier; (iii) a real child leak ⇒ RED **even when** the carrier evidence is present
   (a leak always wins); (iv) child header clean ⇒ GREEN on `child-header`. `--self-test` = 57 checks,
   exit 0. The live Docker record proves it end to end: `qa.readonlyDeny=true` with
   `mutationLoaded=true`, `pruneRecorded=true`, `loggerProbeRecords=4`, `loggerProbeMountCheck=true`,
   `childScopeMechanism=false` / `startSpecMechanism=true` — i.e. the arm now says WHICH carrier proved
   the authority instead of failing on an empty spy, and it cannot pass on emptiness. **Sound, and it
   does not weaken the discipline.**

## 8. Bounds — what this pass did NOT check

- **live model arms**: `qa.mcpCall` and every `live.*` row are NULL (no credential staged; the lane ran
  in its credential-free `--no-browser` spelling). A SKIP is not a pass and nothing about the bundle is
  settled by those rows.
- **browser / UI arms**: `ui.*` NULL by `--no-browser`; the UI plane was not re-measured.
- **TUI 0.20.0 live seam binding**: not re-attempted (T16's `write EIO` bound; no TUI plugin source
  changed this wave). The in-container TUI lane DID run green (`tui.laneExit=true`).
- **0.2.1-rc.5**: out of this lane's reach; not measured.
- **repo-root `bun test`**: not run (AGENTS.md §11 notes it also scans `evidence/**` fixtures); the
  package-scoped run is the wave's gate.
- **The §6-spelled flat harness prefix** reddens `preset-conformance --self-test` (declared §7f bound
  for the next wave); the aggregate above is measured on the nested install shape CI uses.
- **`MPD_DSH_TUI_HOST` vs `DSH_TUI_ROOT`**: the contract spells the former, `tui-admission` reads the
  latter; both were exported, so the host was discovered either way. The naming gap is already a
  declared bound of the previous wave (`.mpd/cr/round2-trigger.md`).

## 9. Record

Verdict recorded on `loop-20261114T025059-3f5ed1` as **FAIL** — `rec-20261114T052929-98c81c`,
opening repair `rep-20261114T052929-ece303` with finding **T21-F1** (high). Sources: the wave contract,
`AGENTS.md`, `docs/compatibility.md` (+zh), and this RESULT. Probe basis: 14 artifact paths (this
RESULT, the gate/docker/repin/test logs, both lane result JSONs, `VENDOR_LOCK.json`, the packed
`dist/mpd-package/VENDOR_LOCK.json`).

No gate evidence id is attached: the evidence plane runs gates from `/home/haroldzhao` rather than this
checkout (`mpd_verify_evidence {kind:"gate"}` answers `Script not found "verify:gates"`), so the verdict
rests on the logs this seat produced. A FAIL needs no gate id; a PASS would not have been recordable
from this seat.

**Repair shape** (one command, no source change): re-cut `dist/mpd-package` from the FINAL tree with
`node scripts/pack-mpd.ts` and re-run only the two Docker modes; every other measured fact is invariant
because the artifact is gitignored and nothing in bundle source, the patch, presets or the manifest
moved since the T16 verdict.
