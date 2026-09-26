# t7 PREFLIGHT — read-only seat (Architect): what is already proved, and the two blockers that stop this seat from completing the integration

Task `t7` (integration) was dispatched to **Architect**, a READ-ONLY seat, and the scheduler reported
`t7 (deps: t6,t12)` while `t12` was still `pending` and `t11` was `in_progress` on the very file the task's
ledger must freeze. This file records everything a read-only seat CAN legitimately produce (so the captain's
takeover is one pass) and states exactly why the task cannot be completed from this seat.

Nothing in this file was produced by writing a shipped file: the sweep ran read-only, the injection ran on a
`/tmp` COPY, and every hash below was captured with the instant it was read.

## 0. Lane terminality at 2026-09-19T11:55Z (from `agent_teams_status`)

| task | kind | status |
|---|---|---|
| t1 requirements | completed (verdict pass) | t2 work | completed |
| t3 implementation | completed | t4 implementation | completed |
| t5 verification | completed (verdict pass) | t6 review | completed (verdict pass) |
| t8 repair | completed | t9 verification | completed (verdict pass) |
| t10 work | completed | **t11 work (O2 comment fix)** | **in_progress** |
| **t12 verification (re-verify after O2)** | **pending** | t7 integration | this attempt |

So the review gate returned pass (t6), but the wave is NOT frozen: `t11` is editing
`scripts/verify-docs-parity.mjs` and `t12` — t7's own declared dependency — has not started.

## 1. Artifact audit (every artifact named by t5 and t6, read on disk — not assumed)

All under `evidence/process-fixes/`, read by this attempt (headlines + the sections they are cited for):

| artifact | bytes | sha256 (moment 11:55:23.040Z == 11:55:46.034Z) |
|---|---|---|
| `fact-base.md` (t1) | 40020 | `cb79ef9f401025afb25a9730e5c3605f358590c7ec3c6c7365a746ff17fa2957` |
| `gate-links.md` (t3 + t8 addendum) | 31973 | `6fee762614b3cb5f65685bcae697bb658f54a15f7c8c7b95582b40b45506f5de` |
| `gitignore-and-manual.md` (t4) | 14149 | `5ec38cd1c73a2edc5824772c3702a758199cb3cc5a3b640b205b2153d28977d5` |
| `language-policy.md` (t10) | 9210 | `e71ae36dce3f8fab6bc52c8cfcaf1f2a7e6e189a519ef121261c1a52b8f71d45` |
| `review-round1.md` (t6, the primary review anchor) | 23553 | `f1a00c9838d80f3b5f8963c0d8b85821082f41bb02049028aff0c62ae4f9e114` |
| `troubleshooting-rows.md` (t2) | 18673 | `68f2d2c42568a50f16962b85078e5266d9f27a00ce6dfe049cc7a21a626127fa` |
| `verify-hardening.json` (t5) | 18167 | `300768b615bb6639e7db0bb6a8e20746cbd1f72888bd832fca934c35fbfc4762` |
| `verify-hardening.log` (t5) | 36006 | (log, not hashed in the ledger) |
| `verify-hardening-reverify.json` (t9) | 14383 | `067f24d61f586da3ba19f6d6557a3086941dd32ff26e3d24b3fdfa2b101ba263` |
| `verify-hardening-reverify.log` (t9) | 17872 | (log, not hashed in the ledger) |

`review-round1.md` headline, read verbatim: "Verdict: **PASS — no blocking findings.**" Its §5 carries FIVE
non-blocking observations; O2 is the reason `t11`/`t12` exist, and O1 explicitly asks the INTEGRATION task to
"re-run the released gates on the FINAL hashes and cite those".

## 2. Post-wave sweep on the CURRENT revision (this shell, read-only)

| # | command | exit | observed |
|---|---|---|---|
| 1 | `node scripts/verify-docs-parity.mjs` | **0** | `links=234 checked=217 resolved=210 dead=0 exemptProvenance=7 absentSite=0 ignoredExternal=13 ignoredAnchorOnly=4 files=92` · `pairs=38 failed=0 violations=0 exempt=19 derived=3 links=234 dead=0 — PASS` |
| 2 | `node scripts/verify-docs-parity.mjs --self-test` | **0** | `34/34 checks passed — PASS` |
| 3 | `node scripts/verify-gates.mjs` | **0** | `PASS - 5/5 member gate(s) green` (docs-parity exit=0, preset-conformance exit=0) |
| 4 | `bun run test:qa` | **0** | `[test:qa] all self-tests passed` |
| 5 | `bun run typecheck` | **0** | `$ tsgo --noEmit` — no diagnostics |

Self-test arm count: **34** (the O2 comment fix changes a comment only; if `t11` adds no arm the count stays 34,
if it does the count must be re-read from the run — never copied from this line).

## 3. Injection re-demonstration (ON A COPY — the shipped file was never touched)

Copy: `tar` of the worktree excluding `.git/ node_modules/ evidence/ dist/ .qa-* .tmp-cache/ .codegraph/ .mpd/`
into `/tmp/t7c` → **11813 files**; the gate was driven with the copy as its root.

```
baseline     : exit 0  links=234 dead=0 — PASS            (copy docs/design.md sha256 62bd827a…)
injected     : [probe](./t7-injected-dead-link.md) appended to docs/design.md
               exit 1  links=235 dead=1
               FAIL link-missing:docs/design.md:./t7-injected-dead-link.md — docs/design.md:586 links
                    "./t7-injected-dead-link.md" but neither a file nor a directory exists at
                    /tmp/t7c/docs/t7-injected-dead-link.md — …
restored     : exit 0  links=234 dead=0 — PASS            (copy docs/design.md sha256 62bd827a…)
```

Shipped `docs/design.md` sha256 during and after: `62bd827a9449aa58900f0baf6df23ddf4fdfdc636641a4106b50f57d3c946228`
— the same hash the docs wave's ledger records, so the demonstration mutated nothing real.

## 4. Timestamped hash ledger — CURRENT revision (superseded the moment `t11` lands)

Settle sandwich: hash at `2026-09-19T11:55:23.040Z` and re-hash at `2026-09-19T11:55:46.034Z` — all four
values IDENTICAL across the window.

| changed file | sha256 | moment (UTC) |
|---|---|---|
| `scripts/verify-docs-parity.mjs` | `1cb83b1394df66e148c44d3c322bcbbf470ffdd0c959068b24af793ee5163f4e` | 11:55:23.040Z == 11:55:46.034Z |
| `AGENTS.md` | `62288be4a23c8ebb3fed267e2f6e6530ab6f3a279dff6721b734c43cf9146d68` | 11:55:23.040Z == 11:55:46.034Z |
| `.gitignore` | `9e86dd852cdf995a8e3ae1b43b7d373cb0e2145ecbc8668110fe1aba784a212f` | 11:55:23.040Z == 11:55:46.034Z |
| `agent-references/troubleshooting.md` | `af5ec159114e51a7a34d531bd1a8c62c02de7c306bbe1ee9ba55976ce9948de0` | 11:55:23.040Z == 11:55:46.034Z |

Base: HEAD `f7ed4dff5bfa43a8bb3014a6cf1a03615781375c` (`docs(evidence): add the independent second measurement of the
wave integration`, 2026-09-19 19:02:34 +0800). `git diff --stat HEAD`: 4 files, +378/-6.

WARNING for the ledger that ships: the `scripts/verify-docs-parity.mjs` value above is the PRE-`t11`
revision. `t11` is in flight on that file, so this row is superseded by construction — that is exactly why
the ledger must be written AFTER `t11`/`t12` are terminal.

## 5. `git check-ignore` evidence (the wave's own acceptance item)

```
$ git check-ignore -v evidence/web-card-catalog/20260918T073000Z/sandbox
  .gitignore:56:evidence/**/sandbox	evidence/web-card-catalog/20260918T073000Z/sandbox
$ echo $?
  0
```

The previously-untracked symlink is now IGNORED (before this wave the same command exited 1 with no output and
`git status --porcelain` listed `?? evidence/web-card-catalog/20260918T073000Z/sandbox`).

## 6. THE TWO BLOCKERS (why this seat must NOT complete t7)

**B1 — ownership/rule (blocker).** t7 is the captain's reserved integration:
- `AGENTS.md` §5 (binding): "ONE git writer per working tree … a teammate NEVER runs
  `commit`/`add`/`checkout`/…" and "the **captain alone** commits and branches";
- `AGENTS.md` §5 standing rule 2 (user-set): the captain executes "the single git writer, contract amendments and
  plan/roster shaping, releasing a watchdog hold, and the final integration";
- the t7 contract itself says the demonstration must come "from the captain's own shell" and that the task must
  "land the commit".
This seat is `Architect` — read-only by profile. It may not write `SUMMARY.md` / `hash-ledger.md` as final
shipped deliverables and it must never stage or commit. (The same mis-dispatch was measured in the docs wave:
"Takeover returned to pool when captain idle → t11 got dispatched to Architect; I had to re-take", and the
register's T-107 records the read-only-dispatch class.)

**B2 — dependency/premature dispatch (blocker).** t7 declares `deps: t6,t12`; `t12` is `pending` and `t11` is
`in_progress` on `scripts/verify-docs-parity.mjs`. The task's deliverables are a SUMMARY and a FINAL hash ledger;
writing them now would freeze a revision that is about to move (the review's own O1 asks the integration to
re-run the gates on the FINAL hashes). Completing t7 now would also make `t12` a verification of an already-frozen
ledger — the ordering the DAG was built to avoid.

## 7. Takeover recipe for the captain (one pass)

1. `agent_teams_reassign_task(task_id="t7", assignee="captain")` after `t11` and `t12` are terminal (a takeover
   must be driven to a terminal status in the SAME turn — the register's F4).
2. Re-run the §2 sweep on the frozen bytes and re-read the self-test arm count.
3. Write `evidence/process-fixes/SUMMARY.md`: the six problems (this wave's P1–P6: gate gap, `.gitignore`
   symlink, `AGENTS.md` stale wave claim, missing timestamped-hash rule, six platform frictions, terminal
   re-dispatch pattern) → fix → instrument; the gate's new coverage; its TWO honest limits (VERBATIM-provenance
   targets are reported EXEMPT and never pass; a packed copy with no root `AGENTS.md` reports a NOTE, not a
   failure — and `dead` counts only non-exempt links); and a "deliberately NOT claimed" section
   (the review's O4/O5 bounds: reference-style definitions and HTML `href`/`src` are not scanned, a query-string
   target is treated as a path, and `evidence/**/sandbox` also matches a plain FILE of that name).
4. Write `evidence/process-fixes/hash-ledger.md` from the FINAL bytes, each sha256 carrying its UTC moment
   (re-hash after the settle window; start == end).
5. Demonstrate the catch once from the captain's own shell — §3 is the exact transcript to reproduce (inject on a
   COPY; exit 0 → 1 → 0; the shipped `docs/design.md` stays `62bd827a…`).
6. Commit by EXPLICIT path list (never `git add -A`):
   `scripts/verify-docs-parity.mjs`, `AGENTS.md`, `.gitignore`, `agent-references/troubleshooting.md`,
   and the evidence directory's files (`fact-base.md`, `gate-links.md`, `gitignore-and-manual.md`,
   `language-policy.md`, `review-round1.md`, `troubleshooting-rows.md`, `verify-hardening.json`,
   `verify-hardening.log`, `verify-hardening-reverify.json`, `verify-hardening-reverify.log`, plus this
   `t7-preflight.md` if kept). Captain's call, flagged not decided: the FIVE dot-prefixed scratch helpers in
   that directory (`.t5-covprobe.mjs`, `.t5-inject.mjs`, `.t5-mutants.mjs`, `.t9-mutants.mjs`, `.t9-reverify.mjs`)
   are reproducible runners, not deliverables.
   Commit message must name the six problems, the gate's new coverage, the review verdict (t6 PASS, 0 blocking)
   and the ANCHOR HASHES with their moments (after t11/t12, not the pre-t11 `1cb83b13…`).
7. Note for the register: the scheduler dispatched t7 while its dependency `t12` was `pending` — a new measured
   dispatch-shape (premature dispatch, distinct from the terminal re-offer) worth a row.

## 8. Bounds of this preflight

Read-only: no shipped file was written, no `git add`/`commit` was run, and every mutation happened in `/tmp` on
copies. The sweep covers ONE revision (the pre-`t11` bytes in §4) and must be re-run after `t11`/`t12`. This file
is evidence, not the wave's SUMMARY; it claims nothing about the post-`t11` revision.
