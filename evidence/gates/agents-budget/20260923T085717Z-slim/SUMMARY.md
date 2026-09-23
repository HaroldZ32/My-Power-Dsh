# AGENTS.md slim — evidence record

**Change**: `AGENTS.md` (the repository manual) compressed in place. No other tracked file's CONTENT was edited.
**Baseline**: the pre-slim manual — `git show 88e94083^1:AGENTS.md`, the first parent of the merge that landed
this work — copied to `AGENTS.md.before` in this directory (**64,424 B**, LF).
**After (final)**: **56,653 B — −7,771 B (−12.1 %)**, rendering to 56,957 B against the harness's 65,536 B cap.

> The first committed revision of this change measured 54,396 B (−15.6 %). Two later passes ADDED content back
> **on purpose** — six fidelity repairs in all, three found by a prose-level sweep and three by an independent
> reviewer (see "Re-verification pass" and "Independent review" below). The numbers here are the final,
> re-measured readings; the committed revision 8dc86a5e (merge 88e94083) holds the 54,396 B intermediate state.

## Why this was done

The manual is the ONE auto-injected workspace instruction file. The installed harness renders it under a
hard **65,536-byte** cap, and the baseline sat at **64,728 rendered bytes — 808 B of headroom (1.2 %)**:
one more paragraph and a live session would receive a **truncated** manual (the failure the T-22 split
measured at 78,283 B). After the change the same instrument reads **9,288 B of headroom**.

**EOL is part of that number, and it is measured, not assumed.** The cap counts the bytes the renderer is
HANDED, so a CRLF file is one byte per line larger. `.gitattributes` pins `*.md text eol=lf`, so the manual
is LF in every working tree; but a file NOT named `*.md` matches only `* text=auto` and IS checked out CRLF
on Windows. Measured: `AGENTS.md.before` reads **65,163 B / 739 CRLF** in a Windows working tree while its
committed BLOB is the same content at **64,424 B LF**. Read through the working copy without normalizing,
the baseline renders 65,467 B — **69 B of headroom** instead of 808, i.e. a hair from truncation. The
instrument therefore normalizes EOL and reports `rawSourceBytes` and `eolAsRead` beside `sourceBytes`.

## Instruments (all in this directory, all re-runnable)

| Instrument | What it proves | Verdict |
|---|---|---|
| `budget-check.mjs` | the INSTALLED harness's own workspace-instruction renderer, 65,536-byte cap, EOL-normalized, with an oversized RED control and a `post_eol_is_lf` check | **PASS** |
| `preservation-audit.mjs` | 34 machine contracts / binding rules survive verbatim (reflow-normalized); §1–§13 all present; every token that left the manual is accounted for | **PASS** |
| `prose-loss-sweep.mjs` | the gap `preservation-audit.mjs` cannot see: for every SENTENCE of the old manual, does any 6-word run survive anywhere in the new one? (a token check is blind to prose-only loss) | triage list, worked through below |
| `crossref-check.mjs` | every `§N` citation inside the manual, and every explicit `AGENTS.md §N` citation anywhere in the repo, still names a section that exists | **PASS** |
| `verify-manual-paths.mjs` (repo gate, T-66) | every path-shaped token the manual spells in a code span exists at the repo root | **PASS** |
| `verify-docs-parity.mjs` (repo gate) | the bilingual/doc policy is untouched, and the `A1–D42` derived-value claim still matches the registry table | **PASS** |
| `evidence/platform/harness-close/` QA case `agent-teams-adopt.mjs --self-test` | asserts the literal substring `Adopted plugins keep their plugin ids and tool names` exists in this manual | assertion **PASSES** (see the caveat) |

### Measured readings (harness renderer, `maxBytes=65536`, EOL-normalized to LF)

| target | source B | rendered B | headroom B | verdict |
|---|---|---|---|---|
| `AGENTS.md.before` (the pre-slim manual) | 64,424 | 64,728 | 808 | GREEN (full content injected) |
| `AGENTS.md` (final, with all six repairs) | 56,653 | 56,957 | 8,579 | GREEN (full content injected) |
| `oversized-control.md` (negative control) | 67,704 | 65,536 | 0 | RED (truncated) |

The control is the archived T-22 fixture, reused rather than recreated: the same instrument must still be
able to go RED, so a green post reading is a measurement and not an unconditional pass.

### Preservation audit readings

- numbered sections: **13 before / 13 after**, none missing.
- contract needles (34): **0 missing**. One (`delta-registry-derived`) matches only after
  whitespace-normalization, reported separately as `contractsPresentOnlyAfterReflow` — a rule that survives
  a reflow, with the wrap difference made visible instead of hidden.
- token census: 528 distinct tokens before; **33** left the manual; **6 are `moved`** (still carried by an
  on-demand reference) and **27 are `accepted` with a written reason**; **0 are un-triaged**. A token that is
  in neither the manual, nor the references, nor the triage ledger still fails the run.

**The audit caught two real defects on its first run, and they were repaired rather than accepted:**

1. `verify-manual-paths` was missing from the §4 gate table although it is the binding gate that audits
   this very file ⇒ the **Manual paths** row was added.
2. The `--dump-config` paragraph had lost its provenance anchors ⇒ the mounting-boot artifact paths
   (`evidence/workmate/rename-delete-core/20260910T131415Z-fullboot/full-boot.result.json` and
   `…/20260910T132303Z-mount/mount-proof.result.json`, plus the `WORKMATE_TOOLS` reading) were restored,
   as T-90 requires: a claim carries its artifact anchor. The second citation additionally replaced an
   ELIDED spelling with the full path, which is why it is ledgered as an improvement.

## Re-verification pass (why the final size is 1,548 B larger)

A second pass was run against the committed revision, with two instruments the first pass did not have.
It found and repaired **three real fidelity losses**, and it corrected one instrument defect:

1. **§3 had lost 17 of 26 package role comments**, leaving the map INCONSISTENT (6 annotated, 20 bare —
   worse than either extreme). `prose-loss-sweep.mjs` exposed it; every package now carries a terse role.
2. **§1's docs-gate clause "external URLs, in-page anchors and code spans are ignored" was dropped.**
   Restored.
3. **§1's emphatic roster correction "NOT presets"** (and the two env-key descriptors, "the sg resolver" /
   "codegraph serve") were dropped. Restored.
4. **Instrument defect: EOL.** `budget-check.mjs` read whatever EOL the working copy had; on a Windows
   checkout that inflated the baseline by 739 B and would have shown a re-runner `headroom=69` instead of
   `808`. It now normalizes EOL and asserts `post_eol_is_lf`.

## Independent review (third attempt) — verdict `needs_revision`, all three findings repaired

**Delegation history, recorded because it is part of the evidence:** the roster `Reviewer` path was
commissioned TWICE and returned an EMPTY final message both times (no verdict, no findings — useless
output). A third attempt through the plain subagent path returned a substantive report; THAT is the review
summarised here. The empty attempts prove nothing and are not counted as review.

**Verdict: `needs_revision` — and explicitly "NO binding rule lost".** The reviewer read both files
end-to-end, walked all 13 sections, re-ran the two repo gates, wrote its own scorer over every BEFORE
sentence containing `MUST/NEVER/binding/refuse/deny/do-not/exactly/only`, and opened the files the manual
names (`scripts/verify-gates.mjs`, `package.json`, the three package build scripts, three committed `dist`
artifacts, `scripts/verify-docs-parity.mjs`, `packages/mpd-dsh-adapter-plugin/src/index.ts`,
`agent-references/index.md`, the roles/workmate deny lists). It listed, as verified-present, the
ONE-git-writer rule, attribution-by-reflog-order, all three captain standing rules, the adapter binding rule
+ CLOSED exception + six bridged files + the 5 counted lines + R1–R5 + registry (a)/(b), the state-root
precedence (matching `mpd-dsh-adapter-plugin/src/index.ts`), the seven-name deny list (identical in both
packages), the do-NOT-re-add rules, T-88/T-90/T-91, all 12 pre-existing §4 gate rows with identical
commands, the single-skills-writer + exactly-one-re-pin rule, the installer/packer contracts, the seven
T-items and the whole of §7.

**The three findings — each verified by the author before repair, and each a real defect in the AFTER file:**

| # | Finding (cited by symbol/text, never by line — T-55) | Verification | Repair |
|---|---|---|---|
| F1 | The bypass-test pointer was spelled `test/adapter-bypass-inventory.test.mjs`, a path that does not exist: there is no root `test/` dir. `verify-manual-paths` bucketed it as `over-report:notRoot`, so it could NOT catch it — and the §4 row this same change added over-claimed that the gate audits "every path-shaped token this manual spells in a code span". Introduced BY THIS CHANGE. | CONFIRMED: the file is at `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs`; no root `test/`. | Pointer re-spelled with the package-relative path (now root-anchored, so the gate AUDITS it: `resolved AGENTS.md -> packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs`, audited 106 → 107), and the §4 row now states the gate's REAL rule (a token is audited only when its first segment is a root entry; a non-root-anchored or non-literal token is counted in its own bucket and never fails). |
| F2 | The Language-policy bullet ends `Process records exempt from the bilingual requirement (see §3)`, but §3's `docs/` line had been compressed to a bare description — the words `exempt`/`process record` no longer occurred in §3. Eight `docs/*.md` files carry `<!-- docs-parity: exempt … (AGENTS.md §3) -->` and the docs gate ITSELF prints "process record (AGENTS.md §3: plan-*.md)", so all of them pointed at an emptied target. | CONFIRMED: 8 docs + 6 gate-source citations; §3 no longer carried the policy. | The exemption sentence is restored in §3's `docs/` line (plan records + internal QA/golden docs, named as the §3 policy the docs and the gate cite). §3 now contains `EXEMPT`, so every citation resolves again — without touching a single gate script. |
| F3 | The Build bullet asserted a present-tense fact about three named files: "the form `mpd-ext-plugin`, `mpd-team-watchdog-plugin` and `mpd-tui-plugin` STILL CARRY in their own `build` scripts". All three scripts are already the canonical root-qualified form, and `dist/sdk.js` carries the root-relative comment `// packages/mpd-ext-plugin/src/sdk.ts`. | CONFIRMED: all three `build` scripts begin `cd "$(git rev-parse --show-toplevel)" && bun build packages/…`; the fix commit `39793669` IS an ancestor of the baseline `6e09910b`, so BEFORE's "until that script half lands" hedge was already stale and the compression turned it into a flat false claim. | The trap is now stated as a RULE (a build run from a PACKAGE directory is flagged STALE) with the three packages described as having USED that shape, moved to the canonical form by T-67. |

**Instrument blind spots — disclosed because the reviewer is right about them, and they bound what these
readings mean.** The four PASS instruments are STRING and SECTION checks. `crossref-check.mjs` proves only
that a `§N` exists, so an EMPTIED §3 body passes it (F2). `preservation-audit.mjs` checks needles that live
in the Language policy (`docs-parity: exempt`, `docs/plan-*.md`), so it could not see that the §3 POINTER
TARGET had been emptied (F2). NO instrument opens the files the manual NAMES, so a wrong path spelling that
the gate buckets as an over-report is invisible to all of them (F1) — the one instrument that does open them
is the path gate, and its own bucket rule is what hid it. And `prose-loss-sweep.mjs` DID list the T-67
sentence as unmatched (its entry 69) — it was trimmed rather than re-verified against the tree (F3). The
lesson recorded for the next pass: a needle must be checked at its TARGET, prose-sweep hits must be opened
against the tree, and an instrument that cannot see a class of defect must not be reported as if it covered
it.

**What the reviewer could NOT verify (host limits, unchanged from BEFORE):** `bun run verify:gates`,
`node scripts/verify-dist-fresh.mjs`, `node scripts/mpd-bg.mjs --self-test` and `bun test` are all blocked
in this sandbox by child-spawn `BUILD_FAILED … exit null` / `EPERM` on piped stdio — so F3 rests on the
build scripts plus the committed dist comments rather than on the gate. Also unverifiable from the tree:
the "`lib/client.js` is still the 0.1.14 client build" claim (that bundle carries no version string) and
the T-44 installed-harness-row claim — both unchanged from BEFORE. Confirmed good by the reviewer:
`agent-references/index.md` exists and lists both moved references, and `docs/adder4.md` / `docs/cnt8.md`
are correctly declared ANTICIPATORY by the manual and the gate alike.

**After the repairs (re-measured):** budget PASS (56,653 B source → 56,957 B rendered, 8,579 B headroom;
control RED; `post_eol_is_lf` holds) · preservation PASS (13/13 sections, 0 of 34 contracts missing, 33
tokens triaged: 6 moved + 27 accepted, 0 untriaged) · crossref PASS (24 in-manual + 180 repo-wide citations,
0 unresolved) · prose sweep 79 → 78 unmatched · `verify-manual-paths` PASS with the corrected path now
AUDITED (107 resolved) · `verify-docs-parity` PASS.

## What was compressed, and how

Verified against two inventories that already exist, so the manual stops paying for them twice:

- **§6 adapter/delta material (the largest block)** — the per-region/per-method enumeration was already
  documented in `agent-references/agent-teams-deltas.md` (the file the manual NAMES as authoritative):
  the SIX bridged files, the counted 5-line `setup(childCtx, child)` residual with its reason, the
  derived-registry rule and the REPLACEMENT-shaped refusal class all survive; the long enumerations
  became the rule + a pointer. The five NAMED residuals (R1–R5) stay inline, because the deltas doc
  points AT §6 for that reason.
- **§7 measured narratives** — the incidents stayed as one-line rules with their case/evidence names
  (e.g. `SKILLS=24 BUNDLED=18` → probe FAIL, the CONCATENATED-ZSTD-FRAME trap, T-88, T-90) instead of
  multi-sentence retellings.
- **§1** — the roster/workmate/slot detail was duplicated almost verbatim in §13; §1 now states the rule
  and points at §13, which stays the single definition (deny list, slot map, archive-first semantics all
  intact).
- **§12/§13** — reflowed; no rule removed. **§4/§5/§9/§11** — evidence prose tightened, every command and
  every binding rule kept.

## Triage of the prose sweep (the 79 unmatched sentences)

The sweep's unit is a sentence, so a fully REWRITTEN sentence lands in the list even when its rule survives;
that is the expected shape for a compression. Each entry was inspected. They fall into three classes:

- **Reworded, rule intact** (the large majority: e.g. "both versions must exist and stay in sync" → "A change
  to one updates BOTH in the same commit"; "§6 states the closure…" → the §6 pointer; the §6/§7 sentences
  rewrapped). No action.
- **Tree reflow** (§3's rewritten comments). The role losses above were repaired; the remaining difference
  is tighter wording, with the tree now complete and consistent.
- **Deliberate example trims**, each ledgered in `preservation-audit.mjs`'s triage ledger with its reason
  (the `/mcp__…/` illustration, `--root-dshProj-my-power-dsh--`, the elided evidence dir replaced by a
  case-family dir, and the adapter method NAMES — the manually-named `packages/mpd-dsh-adapter-plugin` is
  the source of the exact seam names).

## Caveats recorded (so the readings are not over-read)

1. **`agent-teams-adopt --self-test` is RED on this host, and the manual is not the cause.** Its
   AGENTS.md assertion passed when run directly (`phrase present = true`). The case then fails inside
   `install-profile.mjs --self-test`, which was red **directly** with
   `FAIL: sidebar guard drifted from the bundle patch` — an in-flight, uncommitted `mpd-bundle-plugin`
   sidebar change in this working tree at the time. Independently, that case spawns a child with piped
   stdio, which is `EPERM` under this sandbox (`spawnSync` probe: `error.code = EPERM`), so the red
   persists even on a clean tree. (The sidebar work has since been committed by the captain; the
   piped-spawn boundary remains.)
2. **The `.mpd/plans` reading moved and the reason matters.** The BASELINE run of
   `verify-manual-paths.mjs` was RED with `unresolved=1 — .mpd/plans`; it is green now because the manual
   no longer spells that gitignored runtime directory in a code span (T-88 keeps the rule, as a glob).
   That gate's verdict therefore depended on whether a plan had ever been created in the workspace — the
   T-22 evidence shows it green at a time when the directory existed. **Follow-up worth one line in the
   gate, NOT a manual spelling:** treat `.mpd/**` as runtime state so this gate is deterministic, rather
   than re-adding a claim that a transient directory exists.
3. **`bun run verify:gates` could not be used as the aggregate** on this host: every member fails with
   `spawn error: EPERM` (the same piped-stdio boundary), so each member was run directly instead.
4. The compressor is the `edit` tool, not `write`: `packages/mpd-tools-plugin`'s write guard denies a
   whole-file rewrite of an existing file by design.
5. **The independent review took three attempts.** The roster `Reviewer` path returned an EMPTY final
   message twice (no verdict, no findings — not a review); the third attempt through the plain subagent path
   produced a substantive report: verdict `needs_revision`, explicitly NO binding rule lost, and three real
   findings. All three were verified against the tree and repaired (see "Independent review" above). Two
   lessons are recorded rather than smoothed over: an empty delegation must never be counted as a review,
   and the author's own four PASS instruments could not see any of the three defects.
6. **EOL hygiene, observed while re-verifying.** The first commit of these evidence files stored LF blobs
   correctly, but on a Windows checkout every evidence file whose name is not `*.md`/`*.ts`/`*.yml` is
   re-materialized as CRLF by `* text=auto` (git warns: "LF will be replaced by CRLF the next time Git
   touches it"). The working copies were normalized back to LF — content-identical, and `git diff
   --numstat` shows no content change for them. **Recommended, one line:** add `evidence/** text eol=lf`
   to `.gitattributes` so a re-runner's baseline reading cannot be inflated by 1 B per line.
