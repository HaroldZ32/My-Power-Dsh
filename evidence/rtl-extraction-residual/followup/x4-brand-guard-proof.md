# X4 (t20) — the MCP rebuild's mechanical brand guard: proof

Task: `t20` (implementation r1) · assignee Senior Engineer · attempt 1 (`a8a43ec1-3aac-4c6f-8fa7-9abcbde905af`)
In scope: `scripts/build-mcp.mjs` (working tree only — NOT staged, NOT committed) + this directory.

> **Amendment (captain, adopted): the PRIMARY guard is now a byte comparison** of the scrubbed
> artifact against the committed dist (`assertRebuildMatchesCommitted`), with the token allowlist
> below kept as a LAYERED check on top. §6 records the design, the mode actually proven, both
> falsifiability directions and the consequence for today's git-bash bytes.

## 0. Correction applied (captain, after re-measuring X1)

- **PRIMARY SUBJECT — a bare `omo-git-bash`.** The git-bash scrub's replace list holds only
  `omo-git-bash-run-` and its residual list one entry, so `Usage: omo-git-bash` (any suffix, any
  embedding — usage strings, help text, error paths) passes through the scrub untouched and the loud
  residual check reports nothing. The guard must fail on exactly that, and lane 2b below proves it
  through the REAL scrub + guard pair.
- **RETRACTED — the `platformFromOptions` half of X1's letter.** Measured provenance: the pinned
  upstream checkout and the live upstream both carry `platformFromOptions`, our committed dist carries
  `platformFrmpdOptions` (5 ×, measured here; upstream spelling 0 ×), i.e. our older global `omo`→`mpd`
  rewrite corrupted an English identifier and a rebuild from upstream produces the CORRECT form. No
  guard may assert on the corrupted spelling; it contains no `omo` trigram, so this guard neither
  flags nor blesses it, and the dist repair is routed to t21 (X5). Both facts are now stated in the
  guard's own comment so the next reader cannot re-invent the wrong assertion.
- codegraph's harness-id list stays **out of scope** (class (b), outside the four governed files).

## 1. What the guard is, and what it deliberately is not

`applyMpdScrub()` is a **targeted key list** and asserts only the residuals it already knows, so a
rebuild could still ship an upstream OMO token the list has never seen. The new guard
(`BRAND_ALLOWLIST` + `brandTokens()` + `scanBrandTokens()` + `assertBrandClean()`, plus an exported
`applyMpdScrub` so a harness can drive the real scrub+guard pair) is the mechanical complement:

- it **scans and fails** — it never rewrites anything, so the transform stays the key list;
- a brand token is `omo` (optionally `_`-prefixed, optionally `-`/`_`-suffixed) starting at a
  **non-identifier boundary**: `/(?<![A-Za-z0-9])(_{0,2}omo(?:[-_][A-Za-z0-9]+)*)/gi`. The boundary is
  why `platformFromOpenCodeConfigPath` ("romO" across a morpheme boundary) and `platformFromOptions`
  cannot trip it; the hyphen continuation is why `omo-git-bash` is named in full, not truncated to `omo`;
- **subject counts are part of PASS**: the build prints
  `[build-mcp] brand guard: N artifact(s), I identifier(s) inspected, B allowlisted brand occurrence(s), 0 foreign`
  and fails loudly on a zero-artifact build ("an empty scan is not a pass");
- it runs on the **final scrubbed text** of every artifact the build writes.

**Failure message shape** (`console.error` + non-zero exit):

```
[build-mcp] FAIL - foreign brand token "omo-git-bash" in git-bash (not on the X1 allowlist; see evidence/rtl-extraction-residual/followup/x1-brand-contract.md)
[build-mcp] FAIL - foreign brand token "OMO_PROVISION_HINT" in git-bash (not on the X1 allowlist; …)
[build-mcp] FAIL - brand guard: 0 identifiers inspected in lsp (an empty scan is not a pass)
```

## 2. Allowlist (data, one entry per deliberately-kept foreign token, all classification (b))

| token | artifact | reason |
|---|---|---|
| `OMO_CODEX_GIT_BASH_PATH` | git-bash | X1 #1 (b): codex's env key (`GIT_BASH_ENV_KEY`); renaming it breaks the codex side's env reads |
| `OMO_CODEX_GIT_BASH_TIMEOUT_MS` | git-bash | X1 #2 (b): same codex env contract, timeout key |
| `OMO_CODEX_EXEC_COMMAND_TIMEOUT_MS` | git-bash | X1 #3 (b): same codex env contract, exec-timeout key |
| `_omo` | lsp | X1 #4 (b): the LSP daemon's auth-envelope wire key (`params._omo`, stripped before dispatch); renaming one side only breaks auth |

## 3. Proof run — five lanes, real exit codes

Harness `raw/x4-brand-guard-probe.mjs` drives the guard (and the scrub+guard pair) in **child
processes**, so every exit code is the real one. Result JSON: `raw/x4-brand-guard-result.json`.
Committed dists are only read; nothing under `packages/mpd-mcp-*/dist` was rebuilt or edited.

| lane | what ran | exit | observed |
|---|---|---|---|
| committed dists (must NOT be rejected) | `assertBrandClean(<name>, <committed cli.js>)` ×3 | **0 / 0 / 0** | ast-grep 8702 identifiers, 0 brand · git-bash 2195 identifiers, 3 brand (all allowlisted `OMO_CODEX_*`) · lsp 22364 identifiers, 1 unique brand token `_omo` (5 occurrences; allowlisted) |
| **2b PRIMARY SUBJECT** | real `applyMpdScrub("git-bash", 'const usage = "Usage: omo-git-bash [options]";')` then the guard | **1** | scrub passes it through; guard fails naming **`"omo-git-bash"`** and the artifact |
| 2 negative control (seeded) | committed git-bash + `const OMO_PROVISION_HINT = 1;` | **1** | fails naming `OMO_PROVISION_HINT` + git-bash |
| 3 false-positive control | `projectRootFromOpenCodeConfigPath`, `platformFromOptions`, `from` | **0** | no token reported — the guard does not fire on word-internal `omo` |
| 4 empty-subject control | empty text | **1** | `brand guard: 0 identifiers inspected … an empty scan is not a pass` |

Committed-byte acceptance matches the captain's re-measurement: git-bash **3 ×** `OMO_CODEX_*`,
lsp **5 ×** `_omo` (+ 2 × `projectRootFromOpenCodeConfigPath`, which produce **zero** brand hits),
ast-grep **0**.

## 4. Commands and exit codes (contract's `Verify:` block, re-run on these bytes)

```
$ node -e "import('./scripts/build-mcp.mjs').catch(e=>{})"                        # exit 0 (no build triggered)
$ node --check scripts/build-mcp.mjs && echo SYNTAX-OK                            # SYNTAX-OK, exit 0
$ node -e "const s=require('fs').readFileSync('scripts/build-mcp.mjs','utf8'); const i=s.indexOf('ALLOW'); console.log('allowlist-present:', i>0)"
allowlist-present: true                                                           # exit 0
$ git diff --stat -- packages/mpd-mcp-astgrep/dist packages/mpd-mcp-gitbash/dist packages/mpd-mcp-lsp/dist | tail -3
                                                                                  # empty: no dist artifact touched
$ node evidence/rtl-extraction-residual/followup/raw/x4-brand-guard-probe.mjs     # 5/5 PASS, exit 0
```

Importing stays side-effect-free by construction: the build body is wrapped in `main()`, invoked only
on direct execution (`import.meta.url === pathToFileURL(process.argv[1]).href`).

**Timing note on verify 4 (recorded so this lane is not blamed for another's edits):** the dist diff
was **empty when this task measured it** (18:5x) and the byte-comparison baseline is the `cli.js`
files, which this task never touched. At **19:02** the three `BUILD.lock` files and `bun.lock`
changed (`"source": "the upstream project"` → `"8c57e46"`) — that is t21/X5's lane (placeholder +
workspace-lock work), not t20. Re-running the same command now shows those locks, and the guard's
baseline (`packages/mpd-mcp-*/dist/cli.js`) is still byte-identical to what lane (1) compared.

### 5a. Prose brand case — measured in the shipped bytes (captain's final request)

The X3 attestation §6.1 names a PROSE case, `Start an OMO session`, which no residual check can see
(it is a sentence, not an identifier). The guard catches it (`brandTokens("Start an OMO session")` →
`["OMO"]` → not allowlisted → fail), and the question is whether the shipped bytes contain it.
Measured read-only (no dist edited), `grep -ac` per artifact:

```
pattern                     astgrep  gitbash  lsp
Start an OMO session              0        0    0
OMO session                       0        0    0
Start an OMO                      0        0    0
an OMO session                    0        0    0
OMO Session                       0        0    0
oh-my-opencode                    0        0    0
omo session                       0        0    0
```

**Verdict: the prose case (and every casing variant above) is ABSENT from all three committed dists.**
It is therefore a **rebuild-drift class** item — exactly what this guard covers, since the guard fails
on a rebuild that introduces it — and **not** a (c2)-class dist defect for t21's lane. No dist was
edited by this measurement.

### 4a. Pin discipline for `scripts/build-mcp.mjs` (revision-drift note)

Any hash quoted for `scripts/build-mcp.mjs` here is a **point-in-time measurement of a moving file**:
it is `MM` in `git status --porcelain` (staged t8 edits plus unstaged guard/matcher work) and t21's
lane edits it concurrently. Measured here: `0f3d51d70704b125…` earlier in this sequence, then `c05dbdf83a364dbc…` **measured at 2026-09-13T11:10:24Z, 19327 B, revision working-tree-after-t25-matcher (NOT a freeze value)**; the Architect
measured `720eaafbf7ffc465…` (19 284 B) later. Both are recorded rather than one replacing the other,
and **the pin that binds is the one taken at freeze** after the last write to the file — never a live
tree hash quoted from mid-flight. (Same discipline as the X1 citation above, where six successive
values are recorded: 17 355 B / `5a4dec72…`, 19 874 B / `d458ff2a…`, 21 399 B / `a1bf6af4…`.)

## 5. Boundaries honoured

- No file written outside `scripts/build-mcp.mjs` and this directory.
- `scripts/build-mcp.mjs` is left **modified in the working tree, unstaged and uncommitted** (t21 owns
  the next edit and the placeholder/BUILD.lock/bun.lock changes).
- No `packages/mpd-mcp-*/dist` artifact was rebuilt or edited; `bun.lock` and
  `scripts/verify-vendor.mjs` were not touched.

## 6. Amendment: byte comparison as the PRIMARY guard (adopted), allowlist layered on top

`assertRebuildMatchesCommitted(artifact, builtText, committedPath)` (exported) compares the **scrubbed
artifact bytes against the committed dist** and fails loudly on any difference, naming the artifact,
the first differing character and both sizes plus the two differing lines. It runs in the build loop
right after the token scan, and a build that compares **0** artifacts fails
(`an empty byte comparison is not a pass`); each build prints
`[build-mcp] brand guard (primary): N artifact(s) byte-compared against the committed dists, B byte(s) verified equal`.
The token allowlist stays as the layered check, because the committed bytes would fail a bare shape
scan: measured census **lsp = exactly 7 hits (5 × `_omo` + 2 × `projectRootFromOpenCodeConfigPath`) ·
git-bash = exactly 3 (`OMO_CODEX_*`) · ast-grep = 0**, which matches the captain's re-measurement.

**Mode actually proven (stated, not hidden):** a real rebuild needs the upstream checkout at
`MPD_UPSTREAM_ROOT` plus `bun`, and running it here would rewrite `packages/mpd-mcp-*/dist` — which
this task's scope forbids — so the byte comparison is proven **as a pure function over artifact
bytes**: the committed files themselves (direction 1) and a seeded mutant (direction 2). The build
loop wiring is present and syntax-checked; a full-path rebuild is left to the gate that t21/t22 run
after the dist repair.

| direction | lane | exit | observed |
|---|---|---|---|
| (1) intact → PASS | `assertRebuildMatchesCommitted(name, <committed cli.js>, <same path>)` ×3 | **0 / 0 / 0** | `{"compared":1,"bytes":84651}` · `{"compared":1,"bytes":22656}` · `{"compared":1,"bytes":234827}` — non-zero subjects, so an empty comparison cannot pass |
| (2) seeded mutant → FAIL | committed git-bash + `const usage = "Usage: omo-git-bash [mcp]";` | **1** | `FAIL - git-bash rebuild differs from the committed dist at char 22656 (rebuilt 22751 B vs committed 22656 B) …` |

**SUPERSEDED (2026-09-13):** the "git-bash byte comparison fails until X5/t21 lands the dist repair"
clause below is now **historical**. The repair landed in the t25/X4-repair lane (git-bash `cli.js`
`0484a8ff1714c949bc52a4fc0de89c756dcab975b0691a2823706f008475f38e` / 22 651 B, 0 ×
`platformFrmpdOptions` / 5 × `platformFromOptions`, both fingerprint records moved, `verify-vendor`
PASS), so the guard's git-bash byte tripwire is **GREEN** again and a faithful rebuild compares equal.
The clause is kept as the record of WHY the layer exists — no token list could see that divergence.

**Consequence for today's tree (the intended loud trigger, now historical):** the committed git-bash dist carries the
older global-rewrite corruption `platformFrmpdOptions`, while a rebuild from upstream source produces
the correct `platformFromOptions` — so a real git-bash rebuild will now FAIL the byte comparison until
t21/X5 lands the dist repair. That is the design working as intended (the rebuild can no longer
silently ship bytes that differ from the reviewed dist), and it is exactly why the primary check is
not a token list: no spelling enumeration would have caught it.

**X1 citation (measured here):** `evidence/rtl-extraction-residual/followup/x1-brand-contract.md` is
**19 874 bytes / sha256 `d458ff2a1a51f1ef…`** (later: 21 399 B / `a1bf6af4…`; then **24 854 B / `69fd79ea2c7058131290b4cb…`, 281 lines**; newest measured here: **25 169 B / sha256 `67e033f6be6a4a08f58b5dfc…`, 284 lines**; then **27394 B / sha256 `04d7ef85124e72562b36c612…`, 307 lines**) — SIX successive values recorded rather than one replacing another, per the revision-drift discipline at the time this guard was built. The captain's message
cites **17 355 bytes / sha256 `5a4dec72…`** — the two differ, so the contract was amended after that
measurement; both values are recorded here rather than one silently replacing the other. The allowlist
entries (the three `OMO_CODEX_*` keys, `_omo`) are X1 rows #1–#4, all classification (b).

**Status of this layer, in three parts (two teammates recorded it differently; this is the wording the
ledger carries — "deferred" never qualifies the CHECK, only one scenario):**

1. **IMPLEMENTED and WIRED.** `assertRebuildMatchesCommitted` is exported, CALLED in the build loop
   (right after the token scan, on the scrubbed text of every artifact), accumulates the compared
   count and byte total, and the build FAILS when zero artifacts were compared
   ("an empty byte comparison is not a pass"); the PASS line prints the compared artifact and byte
   counts. So every rebuild that regenerates an artifact compares it against the committed dist and
   fails loudly on any difference.
2. **PROVEN as a PURE FUNCTION over artifact bytes** — the seven-lane harness (both directions,
   child-process exit codes, committed files + seeded mutant), because a real rebuild needs
   `MPD_UPSTREAM_ROOT` + bun and would rewrite `dist/`, which this task's scope forbids.
3. **DEFERRED only as the REAL-REBUILD END-TO-END EXERCISE** — the scenario "run a full rebuild in a
   clean checkout with the upstream present, then compare" — which is exercised by the wave's gate
   runs (t21/t22), **not by this task**. The Architect's "deferred, not authorized" note refers to
   that scenario, NOT to the layer's presence or to the mechanism.

**The byte comparison is a TRIPWIRE FOR HUMAN ADJUDICATION, not an automatic verdict.** On a
mismatch the correct response is to diff the rebuilt artifact against the committed one and decide
whether the divergence is foreign branding (a defect) or an environment/legitimate-drift difference
(a rebuild in a different checkout, inlined absolute paths, the `builtAt` field in `BUILD.lock`).
The guard's job is to make that decision **impossible to miss** — not to make it automatically. A red
byte comparison is therefore "a human must look", not "this is a defect"; treating it as proof would
send a future reader off "fixing" legitimate builds.

**Seven lanes, all PASS** (`raw/x4-brand-guard-result.json`): committed dists 0/0/0 with non-zero
subjects · primary subject (`omo-git-bash` through the real scrub) 1 · seeded `OMO_PROVISION_HINT` 1 ·
byte comparison (1) 0/0/0 with byte counts · byte comparison (2) mutant 1 · false-positive control
(`projectRootFromOpenCodeConfigPath`, `platformFromOptions`) 0 · empty-subject control 1.
