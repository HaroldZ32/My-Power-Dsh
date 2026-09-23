# AGENTS.md slim — evidence record

**Change**: `AGENTS.md` (the repository manual) compressed in place. No other tracked file was edited.
**Baseline**: `git show HEAD:AGENTS.md` → `AGENTS.md.before` in this directory (64,424 B).
**After**: 54,396 B — **-10,028 B (-15.6 %)**.

## Why this was done

The manual is the ONE auto-injected workspace instruction file. The installed harness renders it under a
hard **65,536-byte** cap, and the baseline sat at **64,728 rendered bytes — 808 B of headroom (1.2 %)**:
one more paragraph and a live session would receive a **truncated** manual (the failure the T-22 split
measured at 78,283 B). After the change the same instrument reads **10,836 B of headroom**.

## Instruments (all in this directory, all re-runnable)

| Instrument | What it proves | Verdict |
|---|---|---|
| `budget-check.mjs` | the INSTALLED harness's own workspace-instruction renderer, 65,536-byte cap: the slimmed manual renders with `truncated: []`, and an oversized control renders RED | **PASS** |
| `preservation-audit.mjs` | 34 machine contracts / binding rules survive verbatim (reflow-normalized); §1–§13 all present; every token that left the manual is accounted for | **PASS** |
| `verify-manual-paths.mjs` (repo gate, T-66) | every path-shaped token the manual spells in a code span exists at the repo root | **PASS** |
| `verify-docs-parity.mjs` (repo gate) | the bilingual/doc policy is untouched, and the `A1–D42` derived-value claim still matches the registry table | **PASS** |
| `evidence/platform/harness-close/` QA case `agent-teams-adopt.mjs --self-test` | asserts the literal substring `Adopted plugins keep their plugin ids and tool names` exists in this manual | assertion **PASSES** (see the caveat) |

### Measured readings (harness renderer, `maxBytes=65536`)

| target | source B | rendered B | headroom B | verdict |
|---|---|---|---|---|
| `AGENTS.md.before` (HEAD) | 64,424 | 64,728 | 808 | GREEN (full content injected) |
| `AGENTS.md` (after) | 54,396 | 54,700 | 10,836 | GREEN (full content injected) |
| `oversized-control.md` (negative control) | 67,704 | 65,536 | 0 | RED (truncated) |

The control is the archived T-22 fixture, reused rather than recreated: the same instrument must still be
able to go RED, so a green post reading is a measurement and not an unconditional pass.

### Preservation audit readings

- numbered sections: **13 before / 13 after**, none missing.
- contract needles (34): **0 missing**. One (`delta-registry-derived`) matches only after
  whitespace-normalization, which is reported separately as `contractsPresentOnlyAfterReflow` — a rule
  that survives a reflow, with the wrap difference made visible instead of hidden.
- token census: 528 distinct tokens before; **35** left the manual; of those, **6 are `moved`** (still
  carried by an on-demand reference) and **29 are `accepted` with a written reason**; **0 are un-triaged**.
  A token that is in neither the manual, nor the references, nor the triage ledger still fails the run.

**The audit caught two real defects on its first run, and they were repaired rather than accepted:**

1. `verify-manual-paths` was missing from the §4 gate table although it is the binding gate that audits
   this very file ⇒ the **Manual paths** row was added.
2. The `--dump-config` paragraph had lost its provenance anchors ⇒ the mounting-boot artifact paths
   (`evidence/workmate/rename-delete-core/20260910T131415Z-fullboot/full-boot.result.json` and
   `…/20260910T132303Z-mount/mount-proof.result.json`, plus the `WORKMATE_TOOLS` reading) were restored,
   as T-90 requires: a claim carries its artifact anchor. The second citation additionally replaced an
   ELIDED spelling with the full path, which is why it is ledgered as an improvement.

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
- **§3** — the long per-package comments became a complete one-line inventory, with the tree's own
  closing line now stating explicitly that each `packages/<pkg>/README.md` holds that plugin's contract.
- **§12/§13** — reflowed; no rule removed. **§4/§5/§9/§11** — evidence prose tightened, every command and
  every binding rule kept.

## Caveats recorded (so the readings are not over-read)

1. **`agent-teams-adopt --self-test` is RED on this host, and the manual is not the cause.** Its
   AGENTS.md assertion passed when run directly (`phrase present = true`). The case then fails inside
   `install-profile.mjs --self-test`, which is red **directly** with
   `FAIL: sidebar guard drifted from the bundle patch` — an in-flight, uncommitted `mpd-bundle-plugin`
   sidebar change in this working tree (`git status` lists six modified files plus
   `evidence/fix/sidebar-web-route-race/`). Independently, that case spawns a child with piped stdio,
   which is `EPERM` under this sandbox (`spawnSync` probe: `error.code = EPERM`), so the red would
   persist even on a clean tree.
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
