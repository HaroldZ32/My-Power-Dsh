# t28 (impl-B3/2) — the four `AGENTS.md` path spellings resolved by the checker's own reading

**Seat:** watchdog-engineer (lane C seat, free after wave-2b lane C went terminal). **Attempt 2**,
attempt_id `12b3f671-886a-4b13-9608-aadbfd575aae`. **Write set used:** `AGENTS.md` +
`evidence/docs/wave2b-laneB3-manual-paths/20260917T1455Z-t28/**` only.

**Instrument:** `node ./scripts/verify-manual-paths.mjs` (lane B's file, **READ-ONLY** — never edited).
Its own rule, quoted from the run: `candidate=path-shaped token | position=code span or ./|../-prefixed prose |
shape=no glob/tilde/url/whitespace/placeholder/trailing-punctuation | anchor=./|-literal else first segment must be
a repo-root entry | existence=stat <root>/<token>`. The checker has **no exemption-marker mechanism** (grepped:
none), so the only ways a spelling leaves the FAIL set are: the path exists, or the token lands in one of its
documented shape/position/anchor classes.

---

## 1. THE READING, BEFORE AND AFTER (both sides kept beside this record)

> **SUPERSEDED ON THE AFTER SIDE (contract revision 2).** The AFTER column below belongs to the intermediate manual
> sha `5dc5e600…` (53,411 B). The task was then amended — its stored acceptance is now SIX items, adding a red arm, a
> census-movement clause and a second deliverable at `AGENTS.md:194`. **`record-amendment.md` carries the authoritative
> readings and dispositions on the FINAL revision `32a29719…` (53,464 B) and wins wherever the two disagree.**

| | before | after |
|---|---|---|
| command | `node ./scripts/verify-manual-paths.mjs` | same |
| exit | **1** | **1** (see §3 — two DELIBERATE EXEMPTIONS remain) |
| manual sha256 | `b1f1a28372ef4c018541378850e7628433e4e3e7750ad66fbb4460e569a75ec0` | `5dc5e6000d692429e6b2fb88f67724411c0248ced9b8c9591f8f1f653ca29043` |
| manual bytes | 53,283 | 53,411 |
| subjects | audited=115 (resolved=108 **unresolved=7**) | audited=111 (resolved=109 **unresolved=2**) |
| unresolved names | `docs/adder4.md` :14 · `docs/cnt8.md` :14 · `dist/validator.js` :146 · `dist/index.js` :281 · `dist/index.js` :438 · `client` :474 · `node_modules/@mpd-dsh/mpd` :477 | `docs/adder4.md` :14 · `docs/cnt8.md` :14 |

- Raw captures (full, untruncated): `raw/verify-manual-paths-before.log`, `raw/verify-manual-paths-after.log`.
- **The before reading is corroborated by the lane's own capture**: `evidence/gates/wave2b-laneB/20260917T141936Z-laneB/reading-verify-manual-paths-live.log`
  carries the **same manual sha256 `b1f1a283…`, the same 115/108/7 census and the same seven names** (lane B's T-66 live
  red). Mine is the primary reading; theirs is the independent confirmation, read-only.
- **The "four" reconciled, because the count is not the criterion:** the checker named **seven mentions of six distinct
  spellings**. Four of those distinct spellings were resolvable and **all four are resolved** (§2 — each named
  individually). The remaining two are recorded as DELIBERATE EXEMPTIONS (§3). The task is *not* reported complete
  because the number moved: the two exemptions are named, with the checker's own reason, below.

---

## 2. THE FOUR RESOLVABLE SPELLINGS — each by the checker's own reading

| # | before (line) | after | how the checker reads it now |
|---|---|---|---|
| 1 | `dist/validator.js` :146 | `<bundle>/packages/mpd-ext-plugin/dist/validator.js` | `under-report:placeholder` (named in the after run) — truthful: the validator is **packer-generated and exists only inside the packed artifact** (the real instance was found at `dist/mpd-package/packages/mpd-ext-plugin/dist/validator.js`, i.e. the packed bundle root) |
| 2 | `dist/index.js` :281 | `packages/<pkg>/dist/index.js` | `under-report:placeholder` — this is §6's own `<pkg>` convention, used in the same section's Build line (`packages/<pkg>/src/index.ts` → `packages/<pkg>/dist/index.js`) |
| 3 | `dist/index.js` :438 | `packages/<pkg>/dist/index.js` | `under-report:placeholder` — the sentence describes a per-package built artifact named in a platform refusal, not a repo-root file |
| 4 | `./client` :474 | the `client` subpath + `packages/mpd-bundle-plugin/client.js` | two readings: the bare token `client` is **not a candidate** (no `/`, no extension, not a root entry, not a KNOWN_ROOT_FILE → counted nowhere), and `packages/mpd-bundle-plugin/client.js` is **STAT-RESOLVED** — it is the real target of `exports["./client"]` in `package.json` and the file exists |
| 5 | `node_modules/@mpd-dsh/mpd` :477 | `<profile>/node_modules/@mpd-dsh/mpd` | `under-report:placeholder` — the checkout-install layout lives in the **consumer profile**, not in this repo (`node_modules/@mpd-dsh/` here contains only `silicon`) |

Only one whitespace-only line re-wrap was made (§8's sentence) so the manual's wrapping stays consistent; it is not a
content change. Every edit is a path SPELLING: no sentence was re-worded, no claim removed.

---

## 3. THE TWO DELIBERATE EXEMPTIONS (the acceptance's item 2, not a hidden residue)

`docs/adder4.md` and `docs/cnt8.md` (both `AGENTS.md:14`) stay **named and unresolved**, and the checker still exits 1
on exactly those two. Reasons, in order of authority:

1. They are **ANTICIPATORY BY DESIGN**: §3's exemption paragraph says the two are kept by design and printed as their
   own class *"so an exemption for a file that does not exist can never rot silently"*. Lane B3's requirement artifact
   (`evidence/requirements/wave2b-laneB3/20260917T1413Z-wave2b-laneB3-acceptance.md`) states the same: the two
   anticipatory entries **must not silently vanish**.
2. The docs gate agrees with them in its own output: this task's docs-parity run prints
   `skip docs/cnt8.md — EXEMPT: … ANTICIPATORY by design: the file does not exist in this tree yet … [ANTICIPATORY — not a live path]`.
3. Resolving them by creating the two files is **out of this task's inScope** and against the design (the gate must be
   able to print them as anticipatory, which requires that they do not exist).

**The pre-written fix I deliberately did NOT take** (so a reviewer has it either way): the checker's documented
`position` rule reads a token from a code span, or in prose ONLY when it literally starts with `./`/`../`. Removing the
two backticks at `AGENTS.md:14` would move both names into the "not read" class and make the run exit 0 with the names
still present. I did not take it because it would **remove a true observation from the audit instead of resolving it**,
and the acceptance prefers a deliberate exemption over a weakened reading. Exact change, if the wave wants green:
`(`docs/adder4.md`, `docs/cnt8.md`)` → `(docs/adder4.md, docs/cnt8.md)` at that one site.

---

## 4. INSTRUCTION BUDGET — RE-TAKEN, NEVER INHERITED (item 3)

Instrument: the installed harness's own renderer via
`bun ./evidence/gates/agents-budget/20260917T011651Z/budget-check.mjs "agents-after=<abs>/AGENTS.md"`
(the same module that produced the live session's truncation notice), max `65536` bytes on the RENDERED form:

| | source bytes | rendered bytes | max | truncated | verdict |
|---|---|---|---|---|---|
| before (2026-09-17T22:37+08) | 53,283 | 53,587 | 65,536 | `[]` | GREEN (full content injected) |
| **after** (2026-09-17T22:41:16+08) | **53,411** | **53,715** | 65,536 | `[]` | **GREEN (full content injected)** |

Raw: `raw/budget-before.json`, `raw/budget-after.json`. The edit added 128 source bytes and stayed 11,821 bytes under
the cap.

---

## 5. NOTHING PACKED WAS TOUCHED (item 4) — a reading, with its instrument flaw recorded

- `bun run ./scripts/verify-docs-parity.mjs` → exit **0**, `root=/root/dshProj/my-power-dsh pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS`
  (`raw/docs-parity-after.log`); `bun run ./scripts/verify-docs-parity.mjs --self-test` → exit **0**,
  `27/27 checks passed — PASS` (`raw/docs-parity-selftest-after.log`). The run also confirms AGENTS.md's 2 derived
  `A1–D42` claims still check out.
- **Byte identity across this task:** 11 packed-surface paths (7 files under `templates/**` + the 4 root README files
  found at depth ≤2) compared **keyed by path**: `byte_identical: 11, changed: [], missing: []`.
- **Instrument flaw, recorded rather than hidden:** my first before-capture ran a redundant extra
  `sha256sum AGENTS.md templates/*.md templates/**/*.md README.md README.zh-CN.md` group alongside the two `find`
  groups, so four files appeared twice with un-prefixed paths (`templates/mpd-extension/README.md`,
  `…README.zh-CN.md`, `README.md`, `README.zh-CN.md`). A raw row diff therefore printed four phantom deletions
  (`1,4d0`) with **no hash mismatches**. The corrected comparison is keyed by path and is empty. The earlier raw files
  are kept as they were; this note is the correction beside them.
- No `packages/*/dist/**` or `dist/mpd-package/**` write from this task; no git command was run; scratch lived outside
  the workspace; every path-qualified command used the `./` form with full output kept under `raw/`.

---

## 6. VERIFY (both commands from the task's own list)

| command | exit | reading |
|---|---|---|
| `node ./scripts/verify-manual-paths.mjs` | **1** | unresolved **7 → 2**, both named as deliberate exemptions in §3; the four resolvable spellings resolved (§2) |
| `bun run ./scripts/verify-docs-parity.mjs` | **0** | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `bun run ./scripts/verify-docs-parity.mjs --self-test` | **0** | `27/27 checks passed — PASS` |

**The residual, stated plainly:** the path checker's exit code is still 1, on two anticipatory paths that the repository
deliberately keeps named and deliberately keeps non-existent. That is item 2's provision and §3's decision, not an
oversight; the checker's `unresolved` count is 2 of 111 audited subjects, and both names, their line, the policy that
keeps them and the one-line change that would green the run are all written down here.
