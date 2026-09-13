# t5 raw-log manifest — files produced by THIS task (Reviewer, t5)

`verify/raw/` is mixed-ownership: task t12 also wrote its gate re-run logs here. Read this manifest
before citing anything under `raw/` as t5 evidence.

## t5-owned (cited by `../verdict.md` and `../false-negative-probes.md`)

| File | Produced by |
|---|---|
| `subject-hashes-first.txt` | first hash measurement of the six subjects |
| `subject-hashes-settled.txt` | settled re-check (identical) |
| `claim1-lsp-hdl.log` | K1: overlay + dist HDL registrations, counts |
| `claim1-liveness.log`, `claim1-liveness2.log` | K1: liveness (bundle row `mcp-lsp`, VENDOR_LOCK pin) |
| `claim1-supplement.log` | K1: HDL template, vendor pin, row composition, case rows |
| `claim2-readme.log` | K2: README/zh-CN dangling references, `32ae54d` deletion stat |
| `claim3-golden-fixtures.log`, `claim3-4-supplement.log` | K3: fixture consumer search, `tests/golden` harness |
| `claim4-stale-pack.log` | K4: stale pack contents, gitignore, pack copy rule |
| `claim5-gate-run.log` | K5: real gate run (`--json`, `--self-test`), silicon-root stat |
| `axisAB-sweep.log`, `axisA-paths.txt`, `axisB-files.txt`, `axisB-classify.log` | the two-axis sweeps |
| `census.log` | residual-family census in the tracked tree |
| `probes-P8-P12.log` | probes P8–P12 |
| `checks-A4-A6.log` | A4 substance, A5 silicon-coupled cases, A6 hub link |
| `t1-coverage-check.log` | t1 census rows for the LSP package + B1c token set |
| `settle-and-readme.log` | settled hashes, README verbatim, exports map |
| `demo-blindness-A.log` | K5: unmodified-copy green-with-`considered:0` demo |
| `demo-blindness-B.log` | K5: `resolved` tokens absent from mpd |
| `demo-blindness-B2C.log` | K5: same bucket / opposite ownership + PENDING pre-absolution |
| `blindness-demo/**` | scratch roots for the three demos (scratch-only; no repo file touched) |

## t5-owned, addendum round (see `../addendum-gates-and-criteria.md`)

| File | Produced by |
|---|---|
| `g5-exits.txt`, `g5-summary.log` | my re-runs: exit codes + decisive lines of all five gates |
| `g5-verify-vendor.log`, `g5-verify-rows-parity.log`, `g5-verify-rtl-references.log` | the three green gates, my runs |
| `g5-bundle-lifecycle.log`, `g5-bun-test-packages.log` | the two red gates reproduced, my runs |
| `supp-six-docs-and-skip.log`, `supp-skip-semantics.log` | six-doc re-derivation, case skip/exit source semantics |
| `c7-gate.out`, `c7-skip-probe.log`, `c7-rtl-{verif,ip-profile}-{selftest,nosilicon}.log` | C7 case SKIP-and-exit-0 demonstration with `MPD_SILICON_ROOT=/nonexistent` |
| `criteria-C1-C10.log` | t2's C1–C10 criteria commands run against the tree |
| `supp-installer-build-wiring.log`, `supp-build-guard.log` | new residual family (install-mcp LSP targets, build-mcp overlay anchor guard) |
| `probes-P14-P20.log`, `p16-full.txt`, `p16-classify.log` | expanded false-negative probes + content-only survivor classification |

## NOT t5-owned (task t12, do not cite as t5 evidence)

`bundle-lifecycle-capture.log`, `bundle-lifecycle.exit`, `bundle-lifecycle.log`,
`bun-test-packages.exit`, `bun-test-packages.log`, `byte-compare.txt`,
`gate-comparison.log`, `drift-and-artifacts.log`, `my-log-hashes.txt`,
`verify-vendor.log`, `verify-rows-parity.log`, `verify-rtl-references.log`.

In particular `raw/verify-rtl-references.log` is **t12's** run of the reference gate — the same
structurally blind green demonstrated in `demo-blindness-A.log`; it is not evidence of a stripped
surface (see verdict.md V3).
