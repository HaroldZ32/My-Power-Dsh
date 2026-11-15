# T23 — FINAL CONFIRM: both Docker modes on the re-cut pack

- **Loop**: `loop-20261114T025059-3f5ed1` (this seat also recorded T21's FAIL `rec-20261114T052929-98c81c`
  and its repair `rep-20261114T052929-ece303`; T23 is the confirmation pass after the re-cut).
- **Branch / HEAD**: `feature/dsh-022rc2-tui-020` @ `7c1680af` (uncommitted wave tree, same HEAD as T21).
- **Contract**: `.mpd/plans/adapt-dsh-022rc2-tui-020.md` (§6 gate table and its LAST-step Docker row,
  §7f A3, §7g A4, §7h A5, §7i A6).
- **Seat**: Reviewer (read-only verifier). Findings only; nothing here is a fix.
- **Verdict**: **PASS** — both Docker modes measured **GREEN** on the re-cut pack, both
  `failedNames: []`. The single T21 fact (`pack.staticCoherence=false`, finding T21-F1) is **CLEARED**
  in both modes, and the packed `VENDOR_LOCK.json` now carries the third re-pin `af807e03…`.

## 0. What T23 asked

Only the two Docker modes on the re-cut pack — `bun run verify:docker --require-docker --no-browser`
for `--mode source` AND `--mode oneclick` — confirming the failing-fact list is EMPTY (especially
`pack.staticCoherence`) and that the packed `VENDOR_LOCK.json` matches the tree's third re-pin.

## 1. Re-ran vs carried forward (stated explicitly)

**Re-ran in T23** (everything below is this pass's own measurement):

| Item | This pass's evidence |
|---|---|
| Pack state after the re-cut | `sha256sum` both locks + `find` count + `probe` (§2) |
| Docker `--mode source` | `logs/docker-source.log`, exit `0`, stamp `evidence/docker/client-install/2026-11-14T05-48-13Z/` |
| Docker `--mode oneclick` | `logs/docker-oneclick.log`, exit `0`, stamp `evidence/docker/client-install-oneclick/2026-11-14T05-55-32Z/` |
| Both modes' complete fact lists | `facts.json` (both `summary.failedNames: []`) |

**Carried forward from T21** — NOT re-derived in T23 (no tree movement could invalidate them; the
five-file delta of T21 §1 is unchanged and the pack is the only changed artifact):

- `bun run verify:gates` **11/11** exit 0 on the nested rc.2 anchor (TUI host 0.20.0 discoverable;
  `tui-admission` 49 arms / 1 allowed deviation / 5 bounds, both manifests `compatible`).
- `bun test packages` 4164 pass / 6 skip / 0 fail (268 files); `bun run typecheck` exit 0.
- `node scripts/verify-no-host-override.ts` exit 0 (220 host ids, 0 collisions);
  `node scripts/verify-manual-paths.ts` exit 0 (resolved=160); `node scripts/verify-dshgo-standard.ts`
  exit 0 LEGAL (PIN 8/8, CROSS-CHECK PASSED); `node scripts/verify-dist-fresh.ts` exit 0 (35/35);
  `node scripts/verify-vendor.ts` exit 0 (8 assets); `node scripts/repin-vendor.ts --check` exit 0 GREEN
  (drift=0, problems=0).
- Both mount arms (T21 **re-ran** them, not carried): rc.2 fresh anchor 138 rows/28, three bundle team
  rows `disabled=true active=false`, host `agent-team`/`tool-agent-team` enabled, `generation=new`;
  rc.1 fresh anchor 136/29 with the three rows enabled, and the rc.1 `git archive HEAD` 0.18.1 export
  136/29 with an **identical active-id set** (`onlyInWork: []`, `onlyInHead: []`).
- Live preset conformance: rc.2 ours 29 declared/28 active vs reference 29/28 (`missing: [] extra: []`);
  rc.1 ours 29/28 vs reference 28/27 with `extra: ["tool-office"]` as a guarded NOTE; both controls red.

## 2. The re-cut pack (T22's repair) — the artifact now agrees with the tree

| Measurement | Value |
|---|---|
| `dist/mpd-package/VENDOR_LOCK.json` mtime (+08:00) | 13:30 (re-pin landed 13:10; T21 measured the PREVIOUS cut at 13:02) |
| packed `assets.skills.treeSha` / `fileCount` | `af807e03cfeed04cee2648445268bea6ef78634124da77d7deb62f336e038a33` / **393** |
| tree `VENDOR_LOCK.json` `assets.skills.treeSha` / `fileCount` | identical (`af807e03…` / 393) |
| `sha256(VENDOR_LOCK.json)` vs `sha256(dist/mpd-package/VENDOR_LOCK.json)` | **identical** — `95c77ab03a5fbf2d8cd7ed6bcf5ed912e8f9f3eb930cf92720f2a1aa0ac847e8` (was `b4afcab5…` packed vs `95c77ab0…` tree in T21) |
| packed file count / bytes | 687 files / 20 258 224 B (unchanged, i.e. the repair replaced only the lock's bytes for the re-pin) |

## 3. Docker `--mode source` — GREEN

```
.toolchain/node_modules/.bin/bun run verify:docker --mode source --require-docker --no-browser
[driver] docker mode: ROOTLESS (["name=seccomp,profile=builtin","name=rootless","name=cgroupns"])
```

- **Exit 0** (`logs/docker-source-exit.txt`), driver `2026-11-14T05:48:13.909Z → 05:55:17.461Z`.
- **Stamp**: `evidence/docker/client-install/2026-11-14T05-48-13Z/` (`result.json`, `driver.json`,
  `owed/`, `user-surface/`, `tui-logs/`, `ui-shots/`, `console.log`, `output.log`).
- Summary: `total 244, passed 163, failed 0, null 81, failedNames []`.
- The pack rows, verbatim from `result.json` (`facts.json` carries the same strings):

| Fact | ok | raw |
|---|---|---|
| `pack.present` | true | `artifact=/src/dist/mpd-package`, `files=687 bytes=20258224` |
| `pack.staticCoherence` | **true** | **`drifted=none untwinned=none`** |
| `pack.distFreshRebuild` | true | `drifted=none uncovered=none rebuildBunVersion=1.4.0 declaredBuildToolchain=bun@1.4.0 exactMatch=true` |
| `pack.rebuildToolchain` | true | rebuild ran under the declared `bun@1.4.0` |
| `pack.distFreshRebuildControl` | true | mutating one built entry flips the arm FALSE on the same rebuild → the green is a measurement |
| `pack.licenceCoherence` / `pack.declarationCoherence` | true / true | `27 files entries`, 2 patch layers, `29` row module paths, no host tree |
| `install.exit` | true | `exit=0 spec=.` |
| `boot.teamRowGenerationLive` | true | `generation=new … harness=0.2.2-rc.2@/usr/local/lib/node_modules/@deepseek-ai/dsh` |
| `compose.agentTeamRows` | true | `ids=mpd-agent-team,mpd-tool-agent-team,mpd-ui-agent-team predicateHits=6` |
| `qa.mcpCall` | null | declared bound (credential-free lane) |

- `user-surface`: `assertions=120 passed=85 failed=0 findings_or_bounds=35 problems=0` (the 35 rows are
  declared `NOT_PROVEN` composition bounds, not failures).
- The `pack.staticCoherence=false` / `pack.distFreshRebuild=false` lines that appear at
  `logs/docker-source.log:625,627` belong to **`STEP 08c2-pack-control`** — the deliberate mutation
  control run on `/work/pack-mutated`; the graded artifact rows are at `:611-617`.

## 4. Docker `--mode oneclick` — GREEN

```
.toolchain/node_modules/.bin/bun run verify:docker --mode oneclick --require-docker --no-browser
[driver] docker mode: ROOTLESS
```

- **Exit 0** (`logs/docker-oneclick-exit.txt`), driver `2026-11-14T05:55:32.978Z → 06:03:44.037Z`.
- **Stamp**: `evidence/docker/client-install-oneclick/2026-11-14T05-55-32Z/`.
- Summary: `total 244, passed 162, failed 0, null 82, failedNames []`.
- Pack rows: `pack.present=true` (`artifact=/src/dist/mpd-package`), **`pack.staticCoherence=true`
  `drifted=none untwinned=none`**, `pack.licenceCoherence=true`
  (`carried=LICENSE.md,LICENSE-NOTICES.md artifactLicense=MIT sourceLicense=MIT`),
  `pack.declarationCoherence=true` (`rowPathsChecked=29 files=687`).
- The published-install rows are the ones that make this mode's own claim:
  `install.exit=true exit=0 spec=git+file:///opt/oneclick.git`,
  `oneclick.scratchRepo=true commit=5181ed90308137726ea054a5f0f68b5f16c1898b repo=/opt/oneclick.git`,
  `oneclick.filesAllowlist=true absent: evidence/ .git/ docker/ .qa-tmp/`,
  `oneclick.distByteIdentical=true cmp -s on each entry`,
  `oneclick.requiredPaths=true checked: patch files, MCP launchers, web client, icon, locale, skills corpus`.
- `boot.teamRowGenerationLive=true` / `compose.agentTeamRows=true` with the same raw as source mode.
- `pack.distFreshRebuild`, `pack.rebuildToolchain` and `pack.distFreshRebuildControl` are **null in this
  mode by design** (`rebuild=<none passed>`): the from-source rebuild arm is a SOURCE-mode measurement,
  and the source lane above carries it green **plus** its falsifier. The nulls are declared in the
  driver's NULL list, so they are not skips-as-passes.

## 5. The closed fact and the falsifier

- T21's FAIL fact was `pack.staticCoherence=false — 1 differing file(s) … drifted=VENDOR_LOCK.json`
  caused by a pack cut at 13:02:47 before the 13:10:21 re-pin. After T22's `node scripts/pack-mpd.ts`
  re-cut, **both modes report `drifted=none untwinned=none`** on the same 687-file, 20 258 224 B artifact
  and the same three-re-pin lock.
- The arm remains falsifiable: `pack.distFreshRebuildControl=true` in the source lane, and the control
  step's own `pack.staticCoherence=false` on the mutated copy (§3 note).
- A SKIP is never a pass and neither lane skipped: `--require-docker` was passed, both runs report
  `docker mode: ROOTLESS`, and no `3` exit occurred. One declared transport bound exists inside the
  oneclick lane and is NOT a lane skip: `TARBALL=skipped reason=no-registry-knob` (the opt-in ranged
  tarball GET pays no network unless `MPD_E2E_NPM_REGISTRY` is named; the scoped metadata probe ran:
  `ROUTE=official-registry-ok probeMs=1156`).

## 6. Bounds (unchanged from T21, still NOT exercised)

1. Every `live.*` and `ui.*` fact is `null` in both modes — `--no-browser` is the credential-free
   spelling, and the live turns need a key.
2. `qa.mcpCall` is `null` in both modes (no MCP credential).
3. The TUI **live seam binding** (`write EIO` bound in T16) was not re-exercised; no TUI plugin source
   changed in the wave.
4. DSH `0.2.1-rc.5` was not exercised (the wave's support matrix measured rc.2 and rc.1).
5. A repo-root `bun test` was not run (it scans `evidence/**` fixtures; T21 ran `bun test packages`).
6. The §6-spelled FLAT prefix `.qa-tmp/dsh-022rc2/bin` still reddens `preset-conformance --self-test`
   with the pre-existing resolver defect the contract declares as §7f A3; the aggregate was measured on
   a fresh NESTED anchor (T21 §2).

## 7. Why this verdict is not recorded through `mpd_verify_record` (honest gap)

The verify plane resolves its workspace from the CALLING SESSION (`tools.ts` →
`deps.dsh.workspaceRoot(exec)`), and this seat's session workspace is `/home/haroldzhao`, not the
checkout. Measured consequences in this session:

- `mpd_verify_evidence {kind:"gate", gate:"vendor"}` minted `ev-20261114T054816-eb85d6` with **exit 1**
  and the log `/home/haroldzhao/.mpd/verify/evidence/ev-20261114T054816-eb85d6.log` reading
  `Error: Cannot find module '/home/haroldzhao/scripts/verify-vendor.ts'` — the gate spawns with
  `cwd: <workspace>` (`gates.ts:361-373`), so every gate id obtainable from this seat is a
  MODULE_NOT_FOUND, not a measurement.
- `mpd_verify_evidence {kind:"probe"}` minted `ev-20261114T054829-1b7757` and
  `ev-20261114T060430-3a60b4` with every path `bytes 0 / sha256 "" / mtime ""` for the same reason —
  even after `working_directory` pointed the session at the checkout, the plane stayed on `/home/haroldzhao`.
- A PASS record needs `sources` plus at least one gate evidence id (`record.ts:157-166`), and the only
  loop-produced ids are the red-vendor gate and the vacuous probes. Recording a PASS on either would
  misrepresent the evidence, so the verdict lives in THIS artifact (`RESULT.md`, `facts.json`, the two
  driver stamps, the two flat logs with their `exit=0` files) and must be recorded by a seat whose
  workspace is the checkout — or accepted from this artifact.

The measurement itself is unambiguous: **both modes exit 0 with `failedNames: []`**.

## 8. Verdict

**PASS.** Both Docker modes are green on the re-cut pack: `--mode source` exit 0
(`evidence/docker/client-install/2026-11-14T05-48-13Z/`, 163 passed / 0 failed / 81 null) and
`--mode oneclick` exit 0 (`evidence/docker/client-install-oneclick/2026-11-14T05-55-32Z/`, 162 passed /
0 failed / 82 null). `pack.staticCoherence=true (drifted=none untwinned=none)` in BOTH, the packed
`VENDOR_LOCK.json` is byte-identical to the tree's third re-pin (`95c77ab0…`, `af807e03…`, 393 files),
and the T21-F1 repair is confirmed by measurement and by its control.

## 9. Evidence index

| Path | What |
|---|---|
| `logs/docker-source.log`, `logs/docker-source-exit.txt` | full source-lane driver output, `exit=0` |
| `logs/docker-oneclick.log`, `logs/docker-oneclick-exit.txt` | full oneclick-lane driver output, `exit=0` |
| `facts.json` | both modes: stamps, start/finish, `summary` (with `failedNames`), 15 named pack/boot rows |
| `evidence/docker/client-install/2026-11-14T05-48-13Z/` | source-lane stamp (`result.json`, `driver.json`, `owed/`, `user-surface/`) |
| `evidence/docker/client-install-oneclick/2026-11-14T05-55-32Z/` | oneclick-lane stamp |
| `evidence/docker/client-install/2026-11-14T05-47-36Z/` | ABORTED invocation of mine (killed after ~40 s to relaunch under the pinned toolchain); it holds only `console.log`, no `result.json` — not a lane |
| `/home/haroldzhao/.mpd/verify/evidence/ev-20261114T054816-eb85d6.{json,log}` | the plane's wrong-workspace gate run (§7) |
