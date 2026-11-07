# R1 repair — v0.18.0, finding H1 (+ M3, N2)

**Requirement R6:** `compat.hosts` names a band covering 0.18.0 and 0.19.0, **and a GATE asserts it**.
**Verdict this repair answers:** FAIL on R6 in `rec-20261107T082328-68b5c0` (finding H1) — the band was a
publication claim with no enforcement; deleting `0.18.0` left every gate green.

Everything here is EVIDENCE, not a plan. The files in this directory are the observed transcripts.

## 1 · What changed (code, not docs)

| File | Change |
|---|---|
| `scripts/verify-tui-admission.ts` | New **COMPAT lane** with four arms, running in the normal AND the `--static-only` modes; five new `--self-test` negative controls |
| `package.json` | `engines.dsh` floored `>=0.2.1-rc.2` → `>=0.2.1-rc.5` (M3). One leaf only |
| `packages/mpd-tui-adapter-plugin/src/index.ts` | Stale comment "`compat.hosts` (0.17.0 since v0.15.5)" corrected to the 0.18.0 + 0.19.0 band (N2) |
| `packages/{mpd-tui-adapter,mpd-tui}-plugin/dist/index.js` | Rebuilt with the pinned `.toolchain` bun 1.4.0; **byte-identical** (the N2 comment emits no dist bytes) |

`docs/**`, `scripts/verify-dshgo-standard.ts` and `specs/**` were NOT touched.

## 2 · The COMPAT lane

| Arm | Assertion | Status when it cannot be decided |
|---|---|---|
| `COMPAT.band:<label>` (a) | each manifest declares `compat.hosts` as a NON-EMPTY array of `@scope/name@x.y.z` coordinates | FAIL |
| `COMPAT.band-parity` (b) | the two manifests declare the SAME band (drift guard in the gate, not only a unit test) | BOUND when fewer than two manifests were read |
| `COMPAT.distribution-ref` (c) | the `host-tui` component ref in `dsh-distribution.json` is INSIDE the band | FAIL |
| `COMPAT.host-version` (d) | the DISCOVERED host's exact version is INSIDE the band | **BOUND with an explicit `NOT CHECKED — …` line**, never a silent pass |

The static arms (A/B/R*/D/E/F/G) and the host-negotiation arm are unchanged and still run; `--static-only`
still exits **3**, never green.

## 3 · Negative controls inside `--self-test` (18/18 arms, exit 0)

| Control | Fixture | Observed |
|---|---|---|
| `compat-empty-band` | `compat.hosts: []` | exit 1, `arm COMPAT.band:fixture FAIL` |
| `compat-band-parity` | bundle `[0.19.0]` vs package `[0.18.0, 0.19.0]` | exit 1, `arm COMPAT.band-parity FAIL` |
| `compat-distribution-ref` | `[0.18.0]` only (distribution ref is 0.19.0) | exit 1, `arm COMPAT.distribution-ref FAIL` |
| `compat-host-version` | `--host-dir` a synthetic host at `0.17.0` | exit 1, `arm COMPAT.host-version FAIL` |
| `compat-host-version-reported` | `--static-only` (no discovery) | exit 3, `arm COMPAT.host-version BOUND — NOT CHECKED …` |

## 4 · Live break-and-restore (a gate that cannot fail is not a gate)

Each case mutated the real manifests, ran the real gate, then restored from a backup; the restore is
proven **byte-exact by sha256** in every case (`break-restore-transcript.log`).

| Case | Break | Exit | Arm that reddened |
|---|---|---|---|
| A | both manifests → `[0.18.0]` (missing the distribution ref) | 1 | `COMPAT.distribution-ref` |
| B | **delete `0.18.0`** (the defect's measured consequence) | 1 | `COMPAT.host-version` — the discovered 0.18.0 host is outside `[0.19.0]` |
| C | package manifest → `[0.18.0]`, bundle untouched | 1 | `COMPAT.band-parity` |
| D | both manifests → `[]` | 1 | `COMPAT.band:bundle`, `COMPAT.band:package`, `COMPAT.distribution-ref`, `COMPAT.host-version` |
| E | both manifests → `[]` under `--static-only` | 1 | `COMPAT.band:*` + `COMPAT.distribution-ref`; `COMPAT.host-version` stays **BOUND** |

Post-restore gate: **exit 0**, `REPORT: PASS — 48 arms passed, 1 allowed deviation(s), 5 bound(s)`.

## 5 · Gate results (observed)

| Command | Exit | Observed |
|---|---|---|
| `node scripts/verify-tui-admission.ts` | 0 | 48 pass, 1 allowed deviation, 5 bound |
| `node scripts/verify-tui-admission.ts --self-test` | 0 | `self-test PASS: 18/18 arms` |
| `node scripts/verify-tui-admission.ts --static-only` | 3 | by design (D5) |
| `tsgo --noEmit` (repo `bun run typecheck`) | 0 | no diagnostics |
| `node scripts/verify-dist-fresh.ts` | 0 | 34/34 fresh |
| `node scripts/verify-comment-coverage.ts` | 0 | PASS |
| `node scripts/verify-plugin-manifest.ts --pack` | 0 | PASS |
| `bun test packages/mpd-tui-adapter-plugin` | 0 | 90 pass, 0 fail |
| `node ./scripts/verify-gates.ts` | 1 | **11 members**: 8 PASS, 3 FAIL — see below |

### The three failing `verify:gates` members are OUTSIDE this repair's scope

* **vendor (exit 1)** — `asset skills count drifted: 392 vs 391` + `skills treeSha mismatch`: 11
  uncommitted `skills/**` files from another writer. This repair touched no `skills` file.
* **preset-conformance (exit 1)** — `the mpd preset does not mount active row(s) the installed standard
  preset mounts: tool-subagent-list-agents`: installed-harness/preset drift; no file in this scope.
* **dshgo (exit 3)** — `MPD_DSHGO_KIT` is not set, so the official cross-check did not run: the declared
  NOT-PASSED environment bound. Its MANIFEST / VIEW / COMPAT / HOST lanes all PASS.

Detail: `verify-gates-failures.log`.

## 6 · Bounds — what this evidence does NOT prove

1. The host arm ran against the **ambient 0.18.0** host at `~/.dsh/profiles/dsh-tui`. CI installs
   **0.19.0** from `dsh-distribution.json`; arm (d) is proven for 0.18.0 here, and 0.19.0 is covered by
   arm (c) plus the synthetic-host negative control (which proves the arm can fail).
2. The lane does not assert that every member of the band was *measured against a host* — it asserts the
   band is well-formed, identical across the two manifests, contains the distribution coordinate, and
   contains whatever host this run actually discovered. That is exactly what R6 asked for.
3. No live TTY mount and no artifact digest: the gate's own declared bound is unchanged.
