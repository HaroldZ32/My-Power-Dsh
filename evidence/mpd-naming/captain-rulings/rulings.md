# Captain rulings — naming wave, requirements round 2 (t13)

Frozen input: `evidence/mpd-naming/final-allowlist/rule.json` (sha256
`d3a7403aa63df7390c4268d368e6b2b5d385582b2910736b6c0a25130fc15fda`), taken at dev
`3c1a850756e63b7338ca3a8287e7327b9571bdad` with the 27-file product dirty set recorded in that
artifact. These rulings are additive: they do not change the frozen lists, they close the open
items the freeze could not decide.

## R1 — KF-06, ast-grep's `CODEX_HOME` runtime tier: KEEP + allowlist (analogy acked)

Sites: `skills/ast-grep/scripts/ast_grep_helper.py:235`, `skills/ast-grep/tests/smoke.sh:136`,
`packages/mpd-mcp-astgrep/dist/cli.js:437-439`.

The tier is a runtime BINARY LOOKUP: `$CODEX_HOME/runtime/ast-grep/<slug>/sg`, tried before
`~/.mpd/runtime/ast-grep/<slug>/sg`. It is the foreign tool's own home variable, read for
interop — the same class as the keeps the owner already ruled on (codegraph `MIGRATION_ID` +
the `[senpi]` migration read, the lsp `.codex/lsp-client.json` discovery defaults), and NOT one
of this repository's own legacy brand tokens. The distinction the wave applies is therefore:

- **our legacy brand tokens** (`OMO_CODEX_*` env reads, `_omo` envelope, the `OMO` narrative
  labels, the `omo_*` identifiers) → RENAME or DELETE;
- **the foreign tool's own interface that we merely read** (its home variable, its config file
  paths, its migration marker) → KEEP, allowlisted with the interop reason.

Deleting it would change resolution behaviour for users who keep that binary layout, and buys
nothing: the string is not a claim about what this repository is.

## R2 — sk-08 (`skills/ulw-plan/scripts/scaffold-plan.mjs`): applied captain-side, before the re-pin

`omoRoot` / `omoReal` at :124/:127/:129/:132 → `mpdRoot` / `mpdReal` (rename list entry sk-08).
No lane's `inScope` covered this path, and the running process predates the `pending`-amend fix,
so the captain applied it before the wave's single lock re-pin rather than adding a task that
could not be ordered ahead of t17 (its dependency list is fixed once created).

Consequences recorded honestly:

- the wave's `skills/**` edits now have TWO writers (this captain-side rename plus t16's
  ast-grep identifiers) — but they are ordered BEFORE every pin, so the wave still carries
  exactly ONE `VENDOR_LOCK.json` recomputation (t17), which is the invariant §9/§11 checks;
- the corpus treeSha is therefore WRONG on the tree until t17 runs — `verify-vendor` FAILS by
  design at this moment, and t18 (which depends on t17) is the gate that must see it pass;
- t16 must not touch this file (it owns `skills/ast-grep/**` only), and t17 must not recompute
  the lock before t16 has completed.

## R3 — corrections relayed by t13, accepted

1. The `_omo` → `_mpd` skew failure is `AUTH_ERROR_CODE -32001` followed by
   `DaemonUnreachableError` after the ready timeout — NOT `protocolError`. The lane report must
   state the corrected caveat (restart, or clear the version-scoped daemon directory) and treat
   `rule.json` as authoritative over the round-1 acceptance parenthetical.
2. The codegraph foreign surface (`HARNESS_IDS` 'omo', `harness:"codex"`, the `[opencode]` /
   `[codex]` blocks, the `$schema` / `MPD_SCHEMA_URL` emission) is already deleted and committed
   (`3c1a850`), so round-1's C2 is resolved and the round-1 `$schema` non-goal is moot;
   `VENDOR_LOCK`'s codegraph sha256 `ab287cdc…` matches the current bytes.
3. Deleting the git-bash reader may leave `nonEmptyEnvValue` unused: leave it and disclose it,
   never silently delete a helper inside this wave.

## R4 — t14 disclosure D-1 (structural regexes instead of literal residuals): ACKED

t13's `sc-gb` asked for the retired env-key literal inside the git-bash residual table, while the
wave's own greps forbid that literal in a shipped file (G5 = 0 lines). t14 expressed the two
deletions as structural RegExps and kept only the artifact's own name literal, which is the
correct resolution: the acceptance greps ARE the contract, and a residual table may name the
pattern it strips structurally. Independently re-checked by the captain on the real code path:

- `BRAND_ALLOWLIST = []` is asserted, not assumed (`assertBrandClean` fails when the scan inspects
  0 identifiers, so an empty scan cannot pass);
- the real `node scripts/build-mcp.mjs` run reports `brand guard (primary): 3 artifact(s)
  byte-compared ... 341615 byte(s) verified equal` and `33215 identifier(s) inspected, 0
  allowlisted brand occurrence(s), 0 foreign`, exit 0;
- the three artifacts reproduce byte-for-byte through the build script's own scrub path (captain
  re-run of `raw/build-repro.mjs --apply-scrub --compare`: 84651 / 22137 / 234827 bytes, all
  "byte-identical to committed ... true").

## R5 — t14 disclosure D-4 (`BUILD.lock` stale) + the build-script environment trap: CLOSED by the captain

`packages/mpd-mcp-{astgrep,gitbash,lsp}/dist/BUILD.lock` are tracked and nothing gates on them, but
round-1's amended acceptance required them to match the rebuilt artifact. The captain refreshed them
with `MPD_UPSTREAM_ROOT=<repo>/.mpd-dsh/upstream node scripts/build-mcp.mjs` (exit 0); the three
`cli.js` hashes are unchanged (f06bba31…, 6458a82e…, a7cebcf9…), so the wave's single re-pin (t17)
still sees the same dist bytes.

Measured environment trap, now recorded in AGENTS.md §3: the script resolves the pinned upstream as
`MPD_UPSTREAM_ROOT ?? <repo>/../../..` (the legacy checkout layout), which on a normal clone is `/`
and dies with `ENOENT: lstat '/packages/mcp-stdio-core'`. The plain documented command therefore
needs `MPD_UPSTREAM_ROOT` on this machine. A pre-run backup of the three dist trees was taken and
verified byte-identical afterwards, so no lane artifact was at risk.

## R6 — wave state after t14 (for t18/t19)

`verify-vendor` currently FAILS on exactly three assets and all three are expected mid-wave:
`skills` treeSha (captain sk-08 rename + t16's pending ast-grep rename) and the two dist sha256s
(`packages/mpd-mcp-{gitbash,lsp}/dist/cli.js`, t14's work). Frozen-grep status measured by the
captain after t14: G1 0, G4 0, G5 0, G17 0 (green); G6 11 lines and G7 6 lines are RED and are
exactly t16's and t15's pending work; G10-G13 (keeps) present; G14 `LOCK-RECOMPUTE=DRIFT`, to be
resolved by t17.

## R7 — cancelled lane t5 is closed, not re-opened (answer to Junior Engineer)

`t5` (codegraph lane) stays CANCELLED and captain-owned: its substance is already in the tree and
committed — the codegraph foreign surface (`HARNESS_IDS` 'omo', `harness:"codex"`, the
`[opencode]`/`[codex]` blocks, the `$schema`/`MPD_SCHEMA_URL` emission) is deleted in `3c1a850`,
and the surviving `MIGRATION_ID` + `[senpi]` migration reads are owner-ruled KEEPs, allowlisted by
t13 (keep-allowlist functional class). Nothing in it may be resurrected: reviving a cancelled task
would re-open a lane whose files are final, and a cancelled dependency cancels its downstream.

## R8 — sk-07 applied by the captain (skills lane, ahead of the single re-pin)

`skills/ast-grep/AGENTS.md:23` "across PATH, Homebrew, npm, and OMO caches" -> "across PATH, Homebrew,
npm, and MPD caches". The line carries two independent spans and the freeze was consistent: sk-07's
object is the resolution-tier clause, KP-03's object is the upstream repository path
`omo-opencode/src/cli/install-ast-grep-sg.ts`, which stays (upstream paths stay upstream's). The
entry was outside every lane's inScope (t16 owns the helper + smoke script only), so the captain
applied it BEFORE t17 — the wave still carries exactly one lock recomputation. Third skills writer
this wave, all ordered ahead of the pin; disclosed like sk-08.

## R9 — t7-06 applied by the captain (legacy overlay filename)

`tests/overlays/omo-bline.yml` -> `tests/overlays/bline.yml` (git records a rename). Verified before
the move that nothing in the repository referenced the old name, and the content is unchanged (an
empty placeholder whose own comment already points at the bundle patch rows). Not a
`VENDOR_LOCK`-fingerprinted asset, so no pin interaction.

## R10 — labels handed to the in-flight lane instead of edited by the captain

`skills/ast-grep/scripts/ast_grep_helper.py:205` (`# --- OMO runtime resolution (vendored patch) ---`)
and `:250` (`2. OMO runtime dirs`) plus `skills/ast-grep/tests/smoke.sh:126` (a comment) are branded
LABELS inside the two files t16 owns. The captain did NOT edit them (a file in flight has one
writer) and instead steered Deep Worker to rename the labels to mpd wording, re-stating that the
`$CODEX_HOME` runtime TIER itself is a KEPT, allowlisted lookup (R1/KF-06) — label only, never the
detection. Tracked here so t18/t19 can check the three lines.

## R11 — F1 fixed at the ROOT (the corpus gate no longer counts bytecode caches)

Deep Worker's HIGH finding: the ast-grep helper's documented verify command
`python3 -m py_compile <path>` writes `skills/ast-grep/scripts/__pycache__/*.pyc`, which the gate
counted as corpus content — corpus 297 -> 298, `verify-vendor` failing with "asset skills count
drifted: 298 vs 297", and the `.pyc` was NOT gitignored, so it could have been committed as corpus
content. Instead of only documenting the workaround, the captain hardened the gate:
`listFiles()` in `scripts/verify-vendor.mjs` now skips `__pycache__` directories and
`*.pyc` / `*.pyo` files the same way it already skipped `node_modules`, and `.gitignore` covers
them. The pin is unaffected (no bytecode in the corpus, so fileCount/treeSha are unchanged).

Two-sided proof on the REAL gate, run in an isolated worktree of the pre-fix revision with one
bytecode file present: RED (HEAD walker) exit 1 with "count drifted: 298 vs 297"; GREEN (hardened
walker, SAME file still present) exit 0 with "asset OK: skills 297 files" + PASS. Logs:
`evidence/mpd-naming/corpus-gate-bytecode/{red.log,green.log,result.json}`. Landed as `0cbf505`
and pushed; `cfile=` is no longer mandatory, deleting a stray `.pyc` stays good hygiene.

## R12 — staging-boundary incident: `git mv` stages the move (captain error, corrected in minutes)

While committing the F1 fix the captain staged three explicit paths, but `git mv` — used earlier by
the docs lane and by the captain for the overlay — had ALREADY staged those moves, so `0cbf505`
also carried `docs/omo-parity-ledger{,.zh-CN}.md` -> `docs/upstream-parity-ledger{,.zh-CN}.md` as
PURE renames (content edits unstaged) plus `tests/overlays/bline.yml`. Effect on that one pushed
revision: the renamed pair was still branded and the docs hub still pointed at the old filenames —
internally inconsistent, though nothing was lost.

Remedy, landed immediately and pushed as `53d617e`: the docs lane completed in one commit (debranded
titles + second-language sentences + internal self-references + reciprocal switch links + both hub
rows). `git grep -n "omo-parity-ledger" HEAD -- docs/` now returns nothing, so HEAD is consistent
again. No history was rewritten (the branch is published; §5 forbids rebasing it).

Lesson for future lanes (kept here rather than in AGENTS.md because the manual is at its injection
budget): `git mv` STAGES the move, so a lane that renames AND edits must `git add` the file again
after editing, and the captain must read `git diff --cached` — not just the paths he intended —
before committing on a shared, concurrently-edited tree.

## R13 — t16's terminal-immutability refusal is the designed guard

The steered label sweep could not be appended to t16 because `update_task` answered "terminal task
t16 is immutable: output would change" — that is our own wave-4 guard (D17) working as intended: a
finished verdict is not rewritten post hoc. The addendum in
`evidence/mpd-naming/skills-lane/result-addendum.json` (+ `raw/40-label-sweep-verify.log`) IS the
record, and t18/t19 read it. No re-run: re-running t16 would also re-run t17 and cost the wave its
single pin.

## R14 — the corrected criterion for t18/t19: FOUR skills writers, ONE re-pin (the premise clause is void)

t17's acceptance contained a clause asking the report to state that t16 was the wave's ONLY
`skills/**` write. Measured false, and the captain owns the discrepancy: the wave has FOUR skills
writers, three of them outside t16 —
`skills/ast-grep/AGENTS.md:23` (captain, sk-07), `skills/ulw-plan/scripts/scaffold-plan.mjs`
(captain, sk-08) and t16's own three ast-grep files (`scripts/ast_grep_helper.py`, `tests/smoke.sh`,
plus the same `AGENTS.md`). The Lead refused to assert the false clause, reported the drift, and
pinned only what it could prove — the correct behaviour.

The operative invariant, which IS proven and is what t18/t19 must judge:
- exactly ONE `VENDOR_LOCK.json` recomputation for the wave (`lockedAt` 2026-09-14T10:15:51.000Z),
  computed on the SETTLED bytes (two >=50 s recomputations byte-identical, after an earlier read had
  straddled t16's tail — e6c1be39 -> a0f1febb at the same 297 count, and the lead refused to write
  from the unsettled read);
- values: skills 297 / a0f1febb…, gitbash dist 6458a82e…, lsp dist a7cebcf9…, and `_deps` /
  astgrep / codegraph recomputed-unchanged rather than assumed;
- `node scripts/verify-vendor.mjs` exits 0 with no FAIL line (captain re-verified independently);
- every `skills/**` change of the wave plus `VENDOR_LOCK.json` are still UNCOMMITTED together, so the
  single re-pin can ride in the same commit as all four skills edits (§9/§11) — that is the clause a
  reviewer checks, not a writer count.

The verification lane must therefore NOT fail the wave for "four skills files", and must NOT let the
voided premise hide a REAL defect: the substantive checks are the frozen acceptance greps at the
pinned revision, the allowlist conformance, the bilingual pairing, and the single-re-pin invariant
above.

## R15 — no formal re-pin task for the audit record (the fresh re-derivation IS the record)

The Lead offered to open a NEW task and re-pin formally "for the audit record". Declined, and the
reason is recorded here so t19 can judge it rather than guess: t17 is terminal `completed` and its
values were re-derived independently after my go-ahead — twice, >=50 s apart, at the unchanged HEAD
`53d617e6`, by an inline verify-vendor walk plus raw-byte sha256 of every dist plus the real gate:
`297 / a0f1febb…` both times, lock drift NONE over all six assets, `verify-vendor` exit 0 / PASS.
A new task would recompute the same bytes into the same values and produce no new information, while
adding a second lock-touching lane to a wave whose invariant is exactly ONE re-pin. The evidence for
the audit is `evidence/mpd-naming/re-pin/{result.json (postCompletionGoAheadReDerivation),
output.log Appendix 2, raw/A5..A9, B0}`.

Also recorded: the captain's earlier check text was imprecise — the one provenance mention in the
ast-grep tree is spelled lower-case (`omo` in `README.md:133`), so a case-sensitive `"OMO"` grep
correctly returns zero lines there; the substantive check holds (four case-insensitive hits: two
provenance mentions plus two substring false positives "Promote" / "pscustomobject", and no `omo_`
identifier anywhere).

The LSP envelope skew caveat is recorded next to the lsp pin from the frozen `rule.json`, not from
the round-1 parenthetical: an already-running version-scoped daemon started by the pre-rename
artifact fails LOUDLY (`AUTH_ERROR_CODE -32001` when the envelope key is absent, then
`DaemonUnreachableError` after the ready timeout); remedy = restart or clear
`~/.mpd/lsp-daemon/v<version>`.

## R16 — t18's four non-blocking residuals: ACCEPTED as disclosed, no repair before the landing

The captain re-verified the wave's green state independently before accepting them: `verify-vendor`
exit 0 / PASS at the settled revision, the frozen grep driver shows G1/G4/G5/G6/G7 = 0, the KEEP
greps present, and `git diff -U0 -- VENDOR_LOCK.json` = exactly 8 changed value lines (one re-pin).

- R1 (low) KH-02 stale LOCATION: the frozen check expected `omo-parity-align` in `docs/index.md`;
  t15 retargeted that row, so the wave-id banner now lives in `docs/upstream-parity-ledger{,.zh-CN}.md:4`
  and the literal is byte-present there. Not a vanished KEEP; the expectation was location-bound.
  No repair (editing a frozen artifact to match a moved site would rewrite the freeze). Future freezes
  should phrase KEEPs location-independently.
- R2 (low) G9's untracked-evidence count grew 3 -> 9 because five downstream lanes plus the
  verification itself wrote evidence after the freeze — all untracked-new, no historical file
  modified, so "history stays byte-identical" holds. Recorded, not repaired.
- R3 (low) `nonEmptyEnvValue` is now a dead helper in `packages/mpd-mcp-gitbash/dist/cli.js` (t14's
  own O4 disclosure). Inert, carries no brand token; leaving it keeps the bundle diff minimal.
- R4 (medium, user-visible) the `_omo` -> `_mpd` lsp envelope rename breaks an ALREADY-RUNNING
  version-scoped daemon: loud `AUTH_ERROR_CODE -32001` then `DaemonUnreachableError` after the ready
  timeout; remedy = stop the stale daemon once (`kill $(cat ~/.mpd/lsp-daemon/v<version>/daemon.pid)`
  or delete that version dir), which a dsh restart alone does not cover while the old process lives.
  Accepted as a deliberate, documented, loud breaking change with a stated remedy.

## R17 — t19's two medium findings dispositioned before the landing

**F1 (the lock is not yet committed) — CONFIRMED, and it is the landing plan.** t19 caught a false
parenthetical inside t18's verification record: HEAD moved `3c1a850 -> 4d8a130 -> 0cbf505 ->
53d617e` because the CAPTAIN committed the overlap-relation fix, the corpus-gate hardening and the
docs lane — NOT because t17's re-pin landed. `git status --porcelain VENDOR_LOCK.json` is ` M` and
`git diff --numstat 3c1a850..HEAD -- VENDOR_LOCK.json` is empty. The landing commit therefore carries
`VENDOR_LOCK.json` together with the four `skills/**` files (§9/§11); t18's terminal record stays as
written (evidence is immutable), and this ruling is the correction of record.

**F2 (frozen rename target vs landed name) — the landed name STANDS; the freeze is not edited.** The
freeze's shape (`docs/parity-ledger{,.zh-CN}.md`) was written for the older t7 lane; the captain's
t15 task specified `docs/upstream-parity-ledger{,.zh-CN}.md` because it describes the document's
subject (specialist parity against the pinned upstream baseline) and the OMO-free requirement is met
either way. `rule.json` is a hashed evidence artifact cited by t17/t18/t19, so editing it to match the
landed name would falsify those hashes — the discrepancy is dispositioned here instead, and the
KH-02 FAIL is recorded as a location/shape staleness in the freeze, exactly as t18 classified it. The
artifact is not defective; the expectation was bound to a superseded name.

**G2's entry-level closure — supplied here rather than by editing the freeze.** The third-party skill
bodies that still carry the trigram, enumerated at the pinned revision (all KEEP-class provenance of
skills ported from those projects, none of them touched by this wave):
`skills/lsp-setup/references/*/README.md` (21 files), `skills/lsp-setup/SKILL.md:86`,
`skills/review-work/SKILL.md:30`. This enumeration is the missing entry-level evidence; the freeze's
KP-05/F7 class statement remains correct.

**t16's F3 is superseded** (labels now read MPD at `ast_grep_helper.py:205/:250` and
`AGENTS.md:23`; `git grep -n omo_ -- skills/ast-grep` is empty) and **G9's count staleness** (3 -> 9
untracked evidence entries, by design) is recorded, not repaired.
