# t28 — AMENDMENT record (contract revision 2): the six stored acceptance items, on the FINAL revision

**Why this file exists:** the first-pass `record.md` was written against contract revision 1 and its AFTER column
belongs to the intermediate manual sha `5dc5e600…`. The task was then **amended** (its stored acceptance is now SIX items,
including a red arm, a census-movement clause and a second deliverable at `AGENTS.md:194`). This file is the authoritative
record: **every reading below is taken on the FINAL revision** `AGENTS.md` sha256
`32a297191e12fdaba0021c35b732ab367d0828002564e426713a6a4cb8349d7a`, 53,464 bytes, mtime `2026-09-17T14:45:10.659Z`.
`record.md` stays as written (first pass); where the two disagree, **this file wins**.

---

## [0] ALL SEVEN REFUSALS DISPOSITIONED INDIVIDUALLY

Instrument: `node ./scripts/verify-manual-paths.mjs` (lane B's, **READ-ONLY**). The first-pass dispositions are in
`record.md` §2–§3 and are unchanged; this is the per-item table with each item's CLASS and the reading that settles it, at
the final revision.

| # | refusal (before) | class the checker now reads | the reading that settles it |
|---|---|---|---|
| 1 | `docs/adder4.md` :14 | **still `unresolved`** (deliberate exemption) | anticipatory by design: §3's own sentence keeps it named and printed as its own class; the docs gate prints it as `ANTICIPATORY — not a live path` |
| 2 | `docs/cnt8.md` :14 | **still `unresolved`** (deliberate exemption) | same as #1 — the two are one policy class |
| 3 | `dist/validator.js` :146 | `under-report:placeholder` | reworded to `<bundle>/packages/mpd-ext-plugin/dist/validator.js` — the resolution domain is the PACKED ARTIFACT (`dist/mpd-package/packages/mpd-ext-plugin/dist/validator.js` found on disk) |
| 4 | `dist/index.js` :281 | `under-report:placeholder` | reworded to `packages/<pkg>/dist/index.js` — §6's own `<pkg>` Build-line convention; the domain is PER PACKAGE |
| 5 | `dist/index.js` :438 | `under-report:placeholder` | same spelling as #4; the sentence names a per-package built artifact in a platform refusal |
| 6 | `client` :474 | **not a candidate at all** (counted nowhere, by the script's `candidate` rule) + the target path `packages/mpd-bundle-plugin/client.js` **STAT-RESOLVED** | the reference is an **exports-map KEY**; `package.json`'s `exports["./client"]` = `./packages/mpd-bundle-plugin/client.js`, which exists — so the row now states the domain (exports map) AND the resolved target |
| 7 | `node_modules/@mpd-dsh/mpd` :477 | `under-report:placeholder` | reworded to `<profile>/node_modules/@mpd-dsh/mpd` — the domain is the INSTALLED LAYOUT in a consumer profile (in this repo `node_modules/@mpd-dsh/` holds only `silicon`) |

Final reading: `unresolved=2` of 111 audited subjects, both = #1/#2. Nothing was deleted, no reference lost information,
and the matcher was not touched.

## [1] THE CHANNEL: REWORDING (4 of them) + WHY THE ALLOWLIST CANNOT CARRY THE OTHER TWO

- Four refusals are settled by **rewording that states the resolution domain** (#3–#7), which is the first branch the
  amendment names.
- The amendment's second branch — "a REASONED entry in the checker's OWN sanctioned channel — the allowlist the script's
  own comment at :93 describes" — was examined and is **measured inapplicable to #1/#2**: that allowlist is
  `KNOWN_ROOT_FILES` (`scripts/verify-manual-paths.mjs` :92–:111, thirteen BARE root filenames such as `AGENTS.md`,
  `README.md`, `VENDOR_LOCK.json`), and the code consults it only in the **bare-name branch** (`if (!body.includes("/"))`).
  Both anticipatory tokens carry a directory component (`docs/`), so they are classified in the directory branch and the
  allowlist is never reached. The only ways to seat them there would be (a) editing the instrument, or (b) adding a NEW
  exemption mechanism — both of which are the "matcher is loosened" case the amendment forbids, and neither would be a
  reasoned entry in the existing channel.
- Therefore the two are **RECORDED AS A CLASS**, exactly as the amendment's last clause requires: named individually
  (#1/#2), with the checker's own reason (`the manual names paths that do not exist at the repo root`), with the policy
  that keeps them (`AGENTS.md:14` + the docs gate's own `ANTICIPATORY` print), and never silently skipped.
- The alternative that WOULD make the run exit 0 — removing the two backticks at `:14` so the names fall into the
  checker's documented not-read prose class — is recorded in `record.md` §3 as a **pre-written fix deliberately not
  taken**, because it removes a true observation from the audit instead of resolving it. It is a two-character edit at one
  site if the wave prefers green.

## [2] THE RED ARM — EXECUTED, WITH ITS OWN REVERT CONTROL, AND THE CENSUS REPORTED

Scratch (derivation recorded, **outside the workspace**, deleted with its derivation): `cp AGENTS.md` twice into
`/tmp/t28-red/`, then ONE code span appended to the second copy naming a genuinely wrong path. The checker's own
`--manual <path>` flag is used (its `main()` parses `--root`/`--manual`), so the arm exercises the shipped matcher, not a copy
of it.

| arm | what it is | exit | unresolved | census (over / under) | named |
|---|---|---|---|---|---|
| R0 | **revert control**: a VERBATIM copy of the final manual, `--manual` | **1** | **2** | **65 / 6 · 79 / 7** | the two anticipatory paths only |
| R1 | the same copy **+ ONE injected wrong path** `` `docs/this-path-does-not-exist.md` `` | **1** | **3** | **65 / 6 · 79 / 7** | the two anticipatory paths **+ `docs/this-path-does-not-exist.md` (/tmp/t28-red/red-AGENTS.md:631)** |

Readings: a genuinely wrong, non-exempt path **still FAILS, with the same exit code (1) and the same census shape**
(6 over-report buckets, 7 under-report buckets, identical totals) — and it is NAMED in the `FAIL` line. R0 proves the
reddening is the injection and not the copy or the `--manual` path. Captures: `raw/red-arm-R0-verbatim-copy.log`,
`raw/red-arm-R1-injected-wrong-path.log`.

**Census movement, explained rather than absorbed** (before `b1f1a283…` → final `32a29719…`):

| family / bucket | before | final | movement, attributed |
|---|---|---|---|
| over-report (6 buckets) | 65 | **65** | unchanged: the `./client` token became a NON-candidate (no `/`, no extension, not a root file) and a non-candidate is counted nowhere by the script's `candidate` rule — it did not move into `over-report:bare` |
| under-report:placeholder | 19 | **23** | **+4** = the four re-spellings #3, #4, #5, #7 |
| under-report:glob | 37 | **39** | **+2** = the two `templates/**/README.md` mentions the `:194` row edit added (§5 below) |
| under-report (7 buckets) | 73 | **79** | **+6 = +4 +2, exactly** |
| audited | 115 (108 resolved + 7 unresolved) | **111 (109 resolved + 2 unresolved)** | −5 left the audited class (4 → placeholder, 1 → non-candidate), +1 entered resolved (`packages/mpd-bundle-plugin/client.js`), net −4 |

## [3] THE COUNT'S MOVEMENT EXPLAINED FROM THE MEASUREMENT (lane B's routed 4 vs the live 7)

Both readings are archived captures of the same instrument at two manual revisions — the routed one and the re-taken one:

| reading | manual sha256 | bytes | mtime | subjects | unresolved | over / under |
|---|---|---|---|---|---|---|
| A — **routed** (`…/wave2b-laneB/20260917T141936Z-laneB/verify-manual-paths-live.log`) | `8d0dd92980c353ada87ef0e7360ec4c185d47eb09295a8d06f40f109c3833fa8` | 48,641 | 09:02:41Z | 107 (103 resolved) | **4** | 61/6 · 61/7 |
| B — **live re-take** (`…/reading-verify-manual-paths-live.log`) | `b1f1a283…` | 53,283 | 14:25:41Z | 115 (108 resolved) | **7** | 65/6 · 73/7 |

**The difference is a revision difference, and the three additions are attributable.** Reading A's four refusals were
`dist/validator.js` :144, `dist/index.js` :269, `client` :440, `node_modules/@mpd-dsh/mpd` :443 — i.e. **exactly the four
this task resolved**. Reading B adds TWO refusals in the sentence this wave's own B3/T-29 edit added at the top
(`docs/adder4.md`, `docs/cnt8.md`, both at :14) and ONE more `dist/index.js` at :438 (the paragraph this wave's T-88
text added). So: 4 + 3 = 7, and the delta arrived with the wave's own `AGENTS.md` edits — which is precisely why a count is
**re-taken and never quoted across a revision**. The before reading used as this task's baseline is B; my own re-run
reproduced it byte-for-byte (same sha, same 115/108/7, same seven names).

## [4] BUDGET RE-TAKEN ON THE FINAL REVISION, DOCS GATE GREEN, NOTHING PACKED TOUCHED

| reading | value |
|---|---|
| instruction budget, BEFORE | 53,283 source / 53,587 rendered, `truncated: []`, GREEN (full content injected), 22:37+08 |
| **instruction budget, FINAL** | **53,464 source / 53,768 rendered**, `truncated: []`, **GREEN (full content injected)**, 22:45:10+08 — maxBytes 65,536 via the installed harness's own renderer (`raw/budget-before.json`, `raw/budget-after2.json`) |
| `bun run ./scripts/verify-docs-parity.mjs` | exit **0** — `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` (`raw/docs-parity-after2.log`) |
| `bun run ./scripts/verify-docs-parity.mjs --self-test` | exit **0** — `27/27 checks passed — PASS` (`raw/docs-parity-selftest-after2.log`) |
| packed surfaces | **11 paths compared (7 under `templates/**` + the 4 root README files at depth ≤2), 11 byte-identical, changed [], missing []** (`raw/hashes-before.txt` vs `raw/hashes-final.txt`; AGENTS.md is not a packed surface) |

## [5] SECOND DELIVERABLE — the §4 **Doc pairs** row now agrees with the gate and with the policy bullet

**Tiebreak = the gate's own source, not either prose.** `scripts/verify-docs-parity.mjs` :97–:101 carries the comment
*"Bands: `docs/**` (every *.md is a doc), `extensions/**` and `templates/**` (README.md files are …) … `templates/**`
joined the discovery set with this row: the template README pair shipped UNPOLICED"*, and :322 is the executable form:
`for (const band of ["extensions", "templates"])`. Its own self-test asserts it
(*"T-29: templates/**/README.md pairs enter the discovery set as POLICED pairs"*). `AGENTS.md:12`'s policy bullet already
lists `templates/**/README.md`; `:194` did not — the residue of T-29's closure.

| | before | after |
|---|---|---|
| parenthetical | `recursive under \`docs/\` and \`extensions/**/README.md\`` | `recursive under \`docs/\`, \`extensions/**/README.md\` and \`templates/**/README.md\`` |
| "When" cell | `any human-facing doc change (\`README*.md\`, \`docs/**\`, \`packages/*/README*.md\`, \`extensions/**\`)` | `… \`extensions/**\`, \`templates/**/README*.md\`)` |

Reading after the edit: the row now names the same three bands the gate walks, the bullet at `:12` and the row agree, and
the path checker reads both added mentions as `under-report:glob` (no new refusal — see [2]'s +2).

---

## VERIFY, FINAL REVISION

| command | exit | reading |
|---|---|---|
| `node ./scripts/verify-manual-paths.mjs` | **1** | `unresolved=2` of 111 (the two deliberate exemptions [1]); the four resolvable ones resolved; census 65/6 · 79/7 |
| `node ./scripts/verify-manual-paths.mjs --manual <verbatim copy>` | **1** | revert control: identical reading (2 / 65·79) |
| `node ./scripts/verify-manual-paths.mjs --manual <copy + 1 wrong path>` | **1** | red arm: `unresolved=3`, the wrong path NAMED, same census shape |
| `bun run ./scripts/verify-docs-parity.mjs` | **0** | `pairs=38 failed=0 violations=0 exempt=19 derived=3 — PASS` |
| `bun run ./scripts/verify-docs-parity.mjs --self-test` | **0** | `27/27 checks passed — PASS` |

**Residual, stated plainly:** the path checker exits 1 on the two anticipatory paths, by design, with the class recorded and
the one-line green alternative written down ([1]).
