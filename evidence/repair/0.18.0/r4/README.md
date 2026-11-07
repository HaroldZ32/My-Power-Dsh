# R4 repair — v0.18.0, finding H1 (code half) + M1 (vendor re-pin transcript)

**Record this answers:** `rec-20261107T092205-376636` (verdict FAIL). **H1**, verbatim consequence:
with the `0.19.0` host installed — which is what CI installs — and `0.18.0` deleted from both
manifests' `compat.hosts`, the gate still answered `REPORT: PASS — 48 arms passed`, exit 0. The only
arm that could catch it, `COMPAT.host-version`, compares the DISCOVERED host, so the loss stayed
invisible in CI. **M1:** the wave re-pinned the vendor corpus twice (391/`87d34451`, then
392/`3133e6fb`) and the second write has no transcript; the release row cites only the first.

Everything in this directory is an observed transcript. Nothing here is a plan.

## 1 · What changed

| File | Change |
|---|---|
| `specs/tui-hosts.json` | **NEW.** The PUBLISHED HOST CLAIM as written data: `@deepseek-harness-tui/dsh-tui@0.18.0` and `@deepseek-harness-tui/dsh-tui@0.19.0`. Not a discovered fact, not prose |
| `scripts/verify-tui-admission.ts` | New host-free arm **`COMPAT.declared-hosts`**: every declared coordinate must lie INSIDE each manifest's `compat.hosts` band. Runs in the normal, `--static-only` and fixture modes. New `readDeclaredHosts()`. New `--self-test` control `compat-declared-hosts`. The header's COMPAT paragraph now names five sub-assertions |
| `docs/compatibility.md` §3 | Restated to what the gate NOW asserts: declared set covered by both bands (host-free), discovered host covered **when one exists**, `BOUND — NOT CHECKED` otherwise; explicitly not a live admission of both hosts in one run |
| `docs/compatibility.zh-CN.md` §3 | Same correction, in 简体中文, in the same change |
| `evidence/repair/0.18.0/fixes/README.md` | §6 bound 2 corrected (it claimed the lane was "exactly what R6 asked for"); §2 gains an R4 note naming the fifth arm and pointing here |
| `evidence/release/0.18.0/2026-11-07T06-55-08Z/49-repin-check.log` | **NEW numbered log.** `node scripts/repin-vendor.ts --check` transcript: the SHIPPED 392 / `3133e6fb…` pin is in sync with the tree (exit 0). No third re-pin was performed |

Not touched: both manifests, `dsh-distribution.json`, `VENDOR_LOCK.json`, the release `result.json`
(captain-owned), and every file outside this repair's write scope.

## 2 · Why the second vendor pin exists (M1)

`repin-vendor` enumerates each `treeSha` asset from the **git index** — its own line reads
`file list: git index (N shipped file(s))`. Pin #1 (`04-repin-write.log`) ran while
`skills/dsh-qa/scripts/dshgo-standard.ts` was **untracked**, so it pinned 391 files
(`7d1421d8… → 87d34451…`). Staging that file changed the index the pin enumerates to 392 entries,
which invalidated the 391 `treeSha` and forced the second write (`3133e6fb…`) — the one with no write
transcript. `42-vendor-after-repin.log` proves only the POST state, so `49-repin-check.log` is the
missing assertion: the shipped 392 pin is what the final tree computes.

## 3 · The new arm

| Arm | Assertion | When it cannot be decided |
|---|---|---|
| `COMPAT.declared-hosts` | every host in `specs/tui-hosts.json` lies INSIDE **each** manifest's `compat.hosts` band — never consults a discovered host | FAIL (a band that misses a declared host; an unreadable claim file), BOUND only when no readable manifest was supplied |

Shipped-tree run (`gate.log`): `arm COMPAT.declared-hosts PASS — every declared host
[@deepseek-harness-tui/dsh-tui@0.18.0, @deepseek-harness-tui/dsh-tui@0.19.0] (from
specs/tui-hosts.json) is inside each of the 2 manifest band(s)`, and the run reports
**PASS — 49 arms passed, 1 allowed deviation(s), 5 bound(s)**, exit 0.

`--self-test` control (`selftest.log`): `compat-declared-hosts` — a fixture band declaring only
`@…@0.19.0` while the published claim names 2 hosts exits 1 with `arm COMPAT.declared-hosts FAIL`,
**with no host discovered in that mode** (fixture mode never runs discovery).

## 4 · The red run that proves it (fixing what the verifier broke)

Setup, all inside the gitignored `.qa-tmp/r4-demo/` tree (`h1-scenario.log`):

* a copy of the tree carrying the gate, both manifests, the distribution descriptor, `specs/`,
  `packages/`, the two R5 docs, the E-residual matrix and the licence files;
* **both** manifests' `compat.hosts` cut to `["@deepseek-harness-tui/dsh-tui@0.19.0"]` — `0.18.0`
  DELETED, exactly the defect's scenario;
* `specs/tui-hosts.json` **NOT** cut: it still claims both hosts;
* a synthetic installed host whose `package.json` says `0.19.0` — a copy of the ambient payload with
  its version relabelled, so discovery sees ONLY `0.19.0` (CI's condition).

| Run | Gate | Exit | Observed |
|---|---|---|---|
| 1 | **NEW** gate, normal mode, `--host-dir` the synthetic `0.19.0` host | **1** | `arm COMPAT.declared-hosts FAIL` naming BOTH manifests; `COMPAT.host-version PASS` (0.19.0 is inside the cut band); `REPORT: FAIL — 1 finding(s) across 55 arms` — `h1-new-gate-normal-0.19.0-host.log` |
| 2 | **NEW** gate, `--static-only` (no discovery at all) | **1** | same single finding; `COMPAT.host-version BOUND — NOT CHECKED` — `h1-new-gate-static-only.log` |
| 3 | **HEAD** gate (sha256 `3a95a637…`, 108486 B — the exact probe the verifier recorded), same cut tree, same host | **0** | `REPORT: PASS — 47 arms passed, 1 allowed deviation(s), 6 bound(s)` — the defect reproduced — `h1-head-gate-normal-0.19.0-host.log` |

Run 1's only red arm is the new one: the discovered host (`0.19.0`) is inside the shortened band, so
nothing a discovered-host comparison can see reveals the loss. Run 3 shows the same tree passing under
the pre-fix gate. Run 2 shows the arm reddens with **no host discovered at all**, which is what makes
CI's 0.19.0-only machine able to see it.

## 5 · Gates (observed, shipped tree)

| Command | Exit | Observed |
|---|---|---|
| `node scripts/verify-tui-admission.ts` | 0 | `REPORT: PASS — 49 arms passed, 1 allowed deviation(s), 5 bound(s)` |
| `node scripts/verify-tui-admission.ts --self-test` | 0 | `self-test PASS: 19/19 arms`, including the new `compat-declared-hosts` control observed RED |
| `node scripts/verify-tui-admission.ts --static-only` | 3 | by design (D5); `COMPAT.declared-hosts PASS`, `COMPAT.host-version BOUND — NOT CHECKED` |
| `bun run typecheck` | 0 | `$ tsgo --noEmit`, no diagnostics (tsgo prints nothing on success; this log is non-empty because of its header/trailer) |
| `node scripts/verify-comment-coverage.ts` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` |
| `bun run verify:docs` | 0 | `pairs=59 failed=0 violations=0 links=626 dead=0 — PASS` |
| `PATH="$PWD/.qa-tmp/dsh-022/bin:$PATH" MPD_DSHGO_KIT="$PWD/.dsh-go-kit" node ./scripts/verify-gates.ts` | 0 | **11/11 members green** (vendor, dist freshness, row parity, doc pairs, preset conformance, plugin manifest, comment coverage, graph model, workflows, tui admission, dshgo) |
| `node scripts/repin-vendor.ts --check` | 0 | `CHECK : GREEN - lock matches the working tree (drift=0, problems=0)`; skills `392` files, `treeSha=3133e6fb…` in sync |

## 6 · Bounds — what this evidence does NOT prove

1. **Neither run admitted both hosts live.** The shipped-tree run discovered the ambient `0.18.0`
   host; the demonstration's `0.19.0` is a version STRING on a copy of the `0.18.0` payload. The new
   arm proves the CLAIM covers both hosts, not that this run exercised both.
2. **The demonstration ran in a copy of the tree.** The manifests are outside this repair's write
   scope and must not be mutated, so the cut bands live under the gitignored `.qa-tmp/r4-demo/`. The
   copy carries the files the gate reads but not `.git`, `node_modules`, `dist/` or the full
   `evidence/` tree — it is enough to run the gate, it is not the shipped tree.
3. **`dist/mpd-package/` (gitignored local artifact) predates `specs/tui-hosts.json`.** A later pack
   must be re-run for that artifact to carry the new data file; no pack gate is claimed here.
4. **M1 is an assertion, not a reconstruction.** No third re-pin was run (`--check` says in sync).
   The 391→392 cause is the pin's own git-index enumeration plus the verifier's recorded 16:42 staging
   of `skills/dsh-qa/scripts/dshgo-standard.ts`; the 16:42 index itself was not rebuilt.
5. **No live TTY mount and no artifact digest**: the gate's own declared bound is unchanged.

## 7 · Files here

`gate.log`, `selftest.log`, `static-only.log`, `typecheck.log`, `comments.log`, `docs.log`,
`verify-gates.log` — the shipped-tree runs above.
`h1-scenario.log` + `h1-new-gate-normal-0.19.0-host.log` + `h1-new-gate-static-only.log` +
`h1-head-gate-normal-0.19.0-host.log` — the cut-band demonstration.
`change.diff` — the tracked-file diff; `specs-tui-hosts.json` — the new data file verbatim;
`49-repin-check.log` — the M1 transcript (also filed in the release evidence dir).
