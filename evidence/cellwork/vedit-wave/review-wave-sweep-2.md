# T27 — FINAL SWEEP: gates on the final bytes, the 14-item CodeRabbit closure table, and the first-wave regression check

**Seat:** R2 (`reviewer-planes`), board task **T27** — the last independent pass before the branch is
re-pushed.
**Basis:** the repaired tree at 2026-10-31T07:02:13Z (hashes in `sweep2/logs/source-hashes-at-sweep.txt`),
the fourteen CodeRabbit findings as restated on the repair rows (T18–T24, T28, T29), the frozen wave
contract, and my earlier T7/T9/T26 reviews on byte-identical files where noted.
**Nothing edited** outside `evidence/cellwork/vedit-wave/sweep2/**` and this document; no dist rebuilt.
**VERDICT: APPROVE — all gates green on the final bytes, all 14 CodeRabbit items FIXED with evidence,
both documentation corrections landed in both language halves, and the first wave's four guarantees
still hold. No Blocker, no High, no NOT-FIXED item. One carried Nit (a TOCTOU window in the gate-file
freeze, reported in T26) and one filed follow-up (workmate suite process-isolation) are recorded, neither
a regression.**

## 1. Gate table (final bytes; every gate exit 0, no failing line)

| Gate | Command | Exit | Verdict (observed) |
|---|---|---|---|
| Dist freshness | `node scripts/verify-dist-fresh.ts` | **0** | `ok: 34/34 targets fresh (each rebuilt twice, byte-identical)`; 1 NOT COVERED listed |
| Typecheck | `.toolchain/node_modules/.bin/bun run typecheck` | **0** | `$ tsgo --noEmit`, no diagnostic |
| Tests — cellwork | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` | **0** | **172 pass / 0 fail** (18 files) |
| Tests — verify | `… packages/mpd-verify-plugin` | **0** | **82 pass / 0 fail** (4 files) |
| Tests — roles | `… packages/mpd-roles-plugin` | **0** | **191 pass / 0 fail** (12 files) |
| Tests — team-core | `… packages/mpd-team-core-plugin` | **0** | **407 pass / 0 fail** (27 files) |
| Tests — workmate | `… packages/mpd-workmate-plugin` | **0** | **62 pass / 0 fail** (6 files) |
| Doc pairs | `bun run verify:docs` | **0** | `pairs=52 failed=0 violations=0 exempt=24 derived=3 links=471 dead=0 — PASS` |
| Declaration comments | `bun run verify:comments` | **0** | 506 files / 45 457 declarations — `VERDICT: PASS` |
| Plugin manifest | `bun run verify:manifest` | **0** | packed-content 1114 files, 0 required absent — `VERDICT: PASS` |
| Row/parity | `bun run verify:rows` | **0** | `37 row ids match the 2-file bundle patch layer` |
| No host override | `node scripts/verify-no-host-override.ts` | **0** | `PASS: every id-target is bundle-owned (0 of 0 collide with the 214 host-declared row ids)` |
| Preset conformance (REQUIRED — the verify tool surface changed) | `node skills/dsh-qa/scripts/preset-conformance.ts` | **0** | real mount `agentPreset=mpd`, boot log read, negative control refused as designed — `PASS` |

**Authoritative totals (per package, run alone per R9):** 172 + 82 + 191 + 407 + 62 = **914 pass /
0 fail**; the CHANGELOG's "Verification" paragraph already carries exactly these figures (172/82/191/
407/62 → 914), so the T9 numeric finding is closed by the captain.

## 2. The ORIGINAL 14 CodeRabbit items — closure table

| CR | item (as restated on the repair row) | Fix | Evidence on the final tree | Verdict |
|---|---|---|---|---|
| **#1** | docs claimed each artifact is checkpointed "as it is created" (C8 changed that) | T24 | `docs/cellwork.md` "A failed activation resumes": compact `cell-activation-progress` row per artifact, the FULL `cell-activation-partial` ONLY once on failure, plus the corrected residual bound; `docs/cellwork.zh-CN.md`'s resume section and its artifact table carry the same; no "as it is created"/partial-per-artifact claim remains (grep over docs/cellwork{,.zh-CN}.md) | **FIXED** |
| **#2** | `applyReassignments` never checked the target member's STATUS | T18 | `dispatch.ts` refuses a `failed` target ("FAILED to start … pick a member that is running") and a `provisioning` target ("still being raised"); probe: both refused with a reported outcome, the healthy target claims+delivers, and the transport is not called for the refused pairs | **FIXED** |
| **#3** | requirements `update` preferred a CLOSED split ticket and never wrote a replacement id back | T20 | `flow.ts` prefers a LIVE ticket (`findSplitTicket(…, true) ?? … false`), appends at most one replacement, and writes its id back to `state.splitTaskId`; `split-task-owner.test.ts` green (33/0 file-run) | **FIXED** |
| **#4** | an empty-string `executorRef` did not fall through to the live roster handle | T18 | `dispatch.ts` `handleOrNull` used at BOTH call sites (`dispatchOwnerOnly`, `applyReassignments`); probe with `handleFor` returning `""` (and a whitespace cell ref): the dispatch and the reassignment both deliver through the live roster handle `h-live` | **FIXED** |
| **#5** | member identity differed between validation and activation (and an empty key merged names) | T19 + T28 | `split.ts` `roleKey` is now unicode-aware (`[^\p{L}\p{N}]+`, keeps letters/digits), imported by validation so both sides agree; probe: `"Seat A"`/`"seat-a"` → `self-review` (and `member-role-conflict` across roles), `"---"` → `member-invalid`, Chinese names accepted and DISTINCT (`工程师甲` ≠ `工程师乙`), same spelling still shares one seat | **FIXED** |
| **#6** | a failed owner repair discarded the split ticket id | T20 | `staging.ts` keeps `splitId` whenever known, returns/journals `ownerRepairError` alongside it, and the hard-error sentence still names the repair verb; `split-task-owner.test.ts` green | **FIXED** |
| **#7** | the N1 end-to-end arm depended on permission bits (root would make it pass wrongly) | T18 | `test/mail-order.test.ts` declares `rootRunner = process.getuid?.() === 0` and skips the chmod arm with a stated reason, keeping the seam-level arm; `mail-order.test.ts` green (in the 33/0 file-run and the 172/0 package run) | **FIXED** |
| **#8** | `maxDepth` was not a descendant cap — a consult could spawn forever, and a read-only child could delegate writes | T22 | T26 probes: depth 0/1 open, depth ≥2 refused on BOTH spawn surfaces with identical teaching text; `READONLY_DENY` exactly 8; `LEAF_SPAWN_DENY` in every child's scope (read-only = both lists in ONE retained call, write-capable = leaf list alone, foreign label untouched); verifier seat refuses both spawn tools; `cellwork_recon` exempt and bounded by `cellwork.depthMax` | **FIXED** |
| **#9** | an unknown explicit `member` fell back to the caller's own inbox | T23 | `mpd-team-core-plugin/src/index.ts` mail `unread` branch: `wanted === undefined` only when `args.member` was absent; an explicit unresolved member now returns the refusal naming the value and the roster, and the self path is used only when no `member` was supplied; team-core tests 48/0 (mail suite file-run) | **FIXED** |
| **#10** | the README said the frozen table applies "ONLY when the file is absent" | T24 | `packages/mpd-verify-plugin/README.md` + `.zh-CN.md` now state PER-ID precedence in three places (project-gates section, the §9 bound and the entries list): every id the file does not declare keeps its frozen entry, and with no file that is every id | **FIXED** |
| **#11** | control characters in `cmd`/`argv` could forge log lines | T21 | T26 probe: newline in `cmd`, newline in an `argv` element, and U+2028+DEL in `cmd` — each run leaves the log at exactly 2 lines, no forged line after the header, no raw control/line-separator in it (escaped `\n`/`\u2028`/`\u007f`); both README halves describe the escaped (not refused) behaviour, matching the captain's final criterion | **FIXED** |
| **#12** | a loop's writer could edit `mpd-gates.json` (no per-loop freeze) | T21 + T29 | T26 probe: changed / deleted / newly-appeared all REFUSED with one `gate-freeze:` sentence and ZERO evidence; unchanged runs green as `frozen`; a legacy loop with no snapshot REFUSES with its distinct reason and the "open a NEW loop" repair (T29), while probe/record still work; the observer freezes at arm and ADOPTS on re-arm (same id); unbound evidence declares `unfrozen` and is refused `forged-evidence` when cited for a real loop | **FIXED** |
| **#13** | a missing program produced a bare-header log with no cause | T21 | T26 probe: exit `-1`, log line 2 `[spawn-error] Executable not found in $PATH: "…"`, the same cause in `tail`, metadata `exit:-1` | **FIXED** |
| **#14** | the log header recorded the project's `cmd` label, not the program+argv that ran | T21 | T26 probe on `cmd:"bun test packages"` + `argv:["true"]`: header exactly `# gate tests cmd: "bun test packages" program: "true" argv: []`, evidence metadata keeps `cmd` as the label, `logSha256` hashes the header; T24 then landed the header description in BOTH README halves (EN + zh now name `cmd: <label JSON> program: <program JSON> argv: <args JSON>`, the spawn-error cause, the escaping, the freeze and `gateFreeze`) — closing T26's F1 | **FIXED** |

No item is NOT FIXED. (T26's only open item, the zh verify-README header, is closed by T24's completed
docs task and verified by grep + `verify:docs`.)

## 3. The two documentation corrections + pair completeness

- **No doc claims per-artifact checkpointing.** `docs/cellwork.md`'s "A failed activation resumes"
  section and its zh twin now state the compact-progress / one-full-partial-on-failure invariant (and
  the residual window), and a grep for the old "as it is created"-style claim finds nothing.
- **No doc claims an absent-only fallback.** `packages/mpd-verify-plugin/README.md` and the zh twin
  state PER-ID precedence in all three places; no "only when the file is absent" wording remains in the
  docs band.
- **Every pair complete with its switch link:** `verify:docs` **PASS** (52 pairs, 0 failed, 0 violations,
  471 links, 0 dead) — and the semantic drift T26 found is now resolved on both halves (the gate checks
  the pair structure; I checked the content with grep).

## 4. First-wave regression spot-check (`sweep2/probe-regressions.ts`, 6/6 PASS)

1. **Captain instruction-file band + planner delegation guard** — the probe re-derives the exact rows of
   `gates/user-asks.log` on the final predicates: absolute sibling `VEdit/AGENT.md` and
   `../VEdit/AGENTS.md` / `./AGENTS.md` readable, sibling `docs/x.md` and `src/main.rs` refused, own
   source refused, `docs/../packages/x/src/y.ts` refused; planner: sibling `CLAUDE.md`, `docs/cellwork.md`
   and the wave plan readable, own `activate.ts` refused with the teaching paragraph; a plain member
   seat still reads source. All match the recorded baseline.
2. **A fenced member is still never messaged** — `dispatchOwnerOnly` skipped the handoff-fenced owner
   with `… is FENCED (a handoff is already written and waiting for the compaction barrier) — a fenced
   member is never messaged; reassign …` and delivered nothing to it; the healthy owner was paired once.
3. **Mail is still durable-first with the separate wake record** — order `["send","attempt","record"]`; a
   refused `send` append leaves `["send"]` and wakes nothing.
4. **One activation pass still writes one whole-state partial** — inspection of `flow.ts`: one
   `cell-activation-progress` row per artifact through `deps.progress`, and the SINGLE call site of
   `persistPartial` sits in the `!activated.ok` branch (one instant `activatedAt` for every row of the
   pass); the 172/0 package run includes the C12 five-stage e2e test.

## 5. Findings and carried observations

- **No Blocker / High / Medium.** The 14 closures above are the evidence of record.
- **Carried Nit (from T26):** the freeze check hashes `mpd-gates.json` and `resolveGate` then reads it
  again before spawn, so a same-instant concurrent edit could run bytes the freeze did not certify while
  the evidence row still says `frozen`. The log names the program+argv that really ran, so the evidence
  stays honest about what executed; the guarantee window is the residual. Direction (unchanged): read the
  file once and run the frozen bytes, or re-hash after the run and refuse/re-run on a change.
- **Filed follow-up (not a wave regression):** `mpd-workmate-plugin`'s suite is not isolated from a
  shared process; it is green when run alone (62/0) and is always run per package in this sweep.
- **Dist state:** `verify-dist-fresh` reads 34/34 fresh on the final bytes (the dist was rebuilt around
  the repair dispatch); I did not rebuild anything.

## 6. Bounds

- No live harness: the verify tools were driven through `registerVerifyTools` (T26), the dispatch/mail/
  guard/predicates directly; `preset-conformance` is the real-mount evidence for the changed verify
  surface. CR#3/#6 (staging/team-service paths), CR#7 (test-only), CR#9's tool handler and the
  one-partial invariant are **inspection + the packages' tests**, named as such above — not probe-driven.
- CR#11's landed design ESCAPES control characters instead of refusing the file (the captain's final
  criterion); both docs say "escaped", so the closure table must keep that wording.
- The lanes' own tests were run but never used as proof of a rule; my probes/predicates are the proof,
  the tests the corroboration.
- R9: every probe workspace is a `mktemp` directory; no `*.test.ts` and no `mpd-gates.json` were written
  under `evidence/` or the checkout root.
