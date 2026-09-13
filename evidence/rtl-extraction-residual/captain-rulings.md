# Captain rulings — RTL extraction audit (mpd-default-d92bc69a)

Authority: the captain of team "MPD Default", on the user's in-chat instruction
(2026-09-13): the confirmed residuals are to be **repaired directly**, and future
development test cases are **software-type** (e.g. a small game), not RTL/EDA cases.
These rulings are inputs to the repair task (t8) and its verification (t11). They do
NOT rewrite the audit: the audit's own evidence stands as recorded, and the lead's
verdict (t7) carries its own scope statement.

Baseline frozen by the captain before any repair: mpd `32ae54d` (branch `dev`),
silicon `bf3dae2`.

---

## R1 — `packages/mpd-mcp-lsp` stays in mpd; only its HDL template leaves (resolves t3 F2)

**Ruling:** `packages/mpd-mcp-lsp` is RETAINED as mpd-owned shared infrastructure. The
HDL-specific artifact inside it is moved out of the mpd surface.

Evidence this rests on (captain-verified, not inferred):
- `packages/mpd-mcp-lsp/README.md:1-30` — the package is the generic LSP MCP server
  (`mcp__lsp__*`: definitions, references, diagnostics, hover), wrapped by the bundle's
  `mcp-lsp` row.
- Consumers that make it infrastructure rather than an RTL asset:
  `scripts/pack-mpd.mjs:29` (`MCP_PKGS`), `packages/mpd-bundle/cordis.patch.yml:71`
  (the `mcp-lsp` row's `MPD_DSH_LSP_CLI` default), `scripts/install-profile.mjs:91`,
  `scripts/build-mcp.mjs:21,32,39`, `docs/index.md:34` + `docs/index.zh-CN.md:32`.
- The only HDL-specific contents are `templates/rtl-lsp-client.json` (263 B,
  sha256 `a9c98a865d12b374…`), the README section pointing at it
  (`README.md:52`, `README.zh-CN.md:51`), and the two RTL-guide references
  (`docs/rtl-verif-guide.md:132`, `docs/rtl-verif-guide.zh-CN.md:125`).

**Repair action (t8):**
1. Remove `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json` from mpd. Silicon
   already owns the equivalent template (it holds a byte-identical copy today), so
   nothing is lost; if silicon needs a machine-readable note that the mpd-side template
   is retired, that is a silicon-side follow-up outside this audit.
2. Drop the README pair's template section together (both languages in the same
   change) and the two RTL-guide references, which disappear with the four docs under R2.
3. Do NOT delete the package, its `overlay/`, `dist/cli.js`, or its build wiring:
   doing so would break the `mcp__lsp__*` tool surface mpd still ships.

**Why this is not "authority unresolved":** the split-brain F2 named was the HDL
overlay, not the LSP transport. mpd owns the transport and keeps shipping it; the HDL
configuration is silicon content.

### R1.1 — the HDL registrations go too, and that means regenerating the built server (extends R1)

Silicon's sync policy names "the LSP overlay" among the things mpd **must not keep**
(silicon `docs/sync-policy.md` §5), and t2 measured the overlay still carrying it. The
captain verified the live content at the pin:

- `packages/mpd-mcp-lsp/overlay/lsp/server-definitions.ts:13-15,68-69,173-174` —
  the `verible` (`.v/.vh`) and `slang-server` (`.sv/.svh`) builtin registrations;
- `packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts:13-15,186-189` — the matching
  extension map;
- `packages/mpd-mcp-lsp/dist/cli.js` — the built artifact carries the same metadata
  (4 `verible` + 4 `slang-server` hits), and it is the file the bundle's `mcp-lsp` row
  actually launches;
- `packages/mpd-mcp-lsp/README.md:34-52` + zh-CN — the section advertising RTL LSP, which
  points at `references/{verilog,systemverilog}/README.md` — paths **deleted** from mpd by
  `32ae54d`, so the shipped README advertises a setup path that does not exist;
- all four of those artifacts are byte-identical to the silicon copies today
  (`overlay/lsp/server-definitions.ts` `95ade5ae07c07b1f`, `language-mappings.ts`
  `2173ab02aefb9d92`, `dist/cli.js` `04b49f8c192d03b5`, template `a9c98a865d12b374`).

**Repair action (t8)** — this is a source-plus-artifact change, not a cosmetics pass:

1. Remove the HDL registrations from `overlay/lsp/server-definitions.ts` and
   `overlay/lsp/language-mappings.ts`, together with their comments and install hints.
2. Regenerate `packages/mpd-mcp-lsp/dist/cli.js` through the repo's own build path
   (`node scripts/build-mcp.mjs`), not by hand-editing the built file. The captain
   verified this path is available here: `.mpd-dsh/upstream/packages/lsp-daemon` exists and
   `scripts/build-mcp.mjs:39-62` applies the overlay to the upstream source.
3. Re-pin `VENDOR_LOCK.json` for the changed `cli.js` and prove it with
   `node scripts/verify-vendor.mjs`; also prove the binary still works — the regenerated
   `cli.js` must still initialize and answer `tools/list`, and the non-HDL builtin server
   count must be unchanged (only the HDL rows may disappear). A byte comparison is not a
   substitute for that behaviour check.
4. Update the README pair: delete the RTL/HDL section, or replace it with the pointer note
   required by R5. In both languages, in the same change.
5. If the regeneration cannot be completed honestly (upstream source missing, build fails,
   behaviour check red), do NOT hand-patch the built file — mark this item DEFERRED with
   the exact failing command, exit code and the reproducible build command for the next
   attempt, and leave the tree otherwise green. A deferred artifact change with evidence is
   acceptable; a hand-edited `cli.js` is not.

Consequence of this ruling to state in the report: after R1.1 the two repos' LSP overlays
are intentionally NOT identical — mpd ships the generic transport, silicon keeps the HDL
registrations. The byte-parity that t3 measured between them stops being a property of the
split, and that is the intended end state rather than drift.

## R2 — the six mpd-side RTL docs are deleted (confirms t3 F3)

**Ruling:** `docs/rtl-verif-guide.md`, `docs/rtl-verif-guide.zh-CN.md`,
`docs/rtl-ip-flow-guide.md`, `docs/rtl-ip-flow-guide.zh-CN.md`,
`docs/rtl-gap-assessment.md`, `docs/rtl-gap-assessment.zh-CN.md` are STRANDED copies
and are deleted from mpd, not retained.

Accepting t3's evidence: silicon's `docs/sync-policy.md` §1 ("the source project carries
no RTL capability at all … No RTL content is duplicated there") and §5 (normative zh
"不得保留 … RTL 指南"); four of the six have already diverged from the silicon
revisions; mpd's own removal record scheduled the delete (`.silicon-extraction/removal.log:114`,
`t5-closure-evidence/t5-closure.md:102-103`); and `scripts/verify-rtl-references.mjs:25,79`
reads those docs FROM silicon, so the mpd guard structurally cannot see the leftovers.

**Repair action (t8):** delete the six tracked files, then fix every inbound reference
in the same change (`docs/index.md:34` + `docs/index.zh-CN.md:32`,
`packages/mpd-bundle/README.md` + its zh-CN pair, `AGENTS.md`, and the `DOCS` array of
`scripts/verify-rtl-references.mjs:26`) so no gate or hub link dangles. The
`verify:rtl-refs` script stays green AND honest: with its doc subject gone it must either
be repointed at its remaining live subject or retired with its reason recorded — a gate
that still exits 0 while checking nothing is a defect, not a pass.

## R3 — the two RTL QA cases leave the mpd corpus; software-type cases replace them (resolves t3 F1)

**Ruling:** `skills/dsh-qa/scripts/rtl-verif.mjs` and `skills/dsh-qa/scripts/rtl-ip-profile.mjs`
are retired from the mpd corpus, together with their `skills/dsh-qa/SKILL.md` case-table
rows. The capability they exercised belongs to silicon, which must own its own case.

Reasoning: (a) t3 measured that both cases print SKIP and exit 0 when the silicon checkout
is absent, and `test:qa` has no silicon-presence requirement — the mpd CI can therefore
pass unverified (F1); (b) the user's standing policy for this repo is software-type test
cases, and mpd no longer carries RTL capability to test; (c) keeping a cross-repo case
would require mpd's gate to depend on a sibling checkout, which the isolation rules
forbid.

**Repair action (t8):** retire both cases and their SKILL.md rows; land the software-type
scaffold defined by task t9; keep `bun run test:qa` green and make `test:qa` vs
`test:qa:all` honest again (t3 found the two npm scripts identical — either differentiate
them by a real criterion or collapse them with a recorded reason).

## R4 — partial-copy evidence loss (t3 F4): record, do not fabricate a restore

**Ruling:** the seven evidence files that did not land in silicon
(`mpd-verif-plugin/evidence/smoke/*`) are recorded as a partial-copy loss. mpd must not
re-add RTL payload to close it, and the files are NOT to be re-created from memory here:
the record belongs in the repair report and, if the owner wants it, in a silicon-side
follow-up. The two ephemeral losses (`.pyc`, `.mpd/verif/logs/*.log`) are acceptable and
need no action.

## R5 — the required carrier hook + pointer note are delivered as a pointer, with an explicit decision recorded (resolves the bridge gap t2 raised)

**Ruling:** the absence of the `rtl-ip` carrier hook in mpd is a confirmed bridge gap, not
a residual, and it is closed in this audit as follows:

1. mpd gains the **pointer note** the split's own policy requires: the root `README.md`
   (and its `README.zh-CN.md` twin) states that the RTL capability — the `rtl-*` skills,
   the verif plugin, the HDL LSP configuration, the RTL guides and the Verilog golden
   fixtures — now lives in the silicon bundle (`@mpd-dsh/silicon`), with the sibling
   checkout named. That is the "you are here" pointer an agent needs after the split.
2. mpd **DOES** carry the `rtl-ip` carrier hook, reversing the first version of this
   ruling. The reversal is on the record with its reason: I first declined the hook to
   avoid re-introducing silicon capability into an mpd team, and the Plan Reviewer's
   adversarial pass showed that reading contradicts both authorities — silicon's
   `docs/sync-policy.md` §1 states that after the strip mpd "keeps exactly two things:
   the `rtl-ip` *carrier hook* that reads `presets/rtl-ip.profile.json` and merges it into
   the `agent-teams` row, and a short pointer naming this repository", and this audit's own
   accepted contract (t2's `acceptance.md` C6) requires exactly those two things with a
   mounting-boot proof. The duplication worry does not hold: the hook carries no RTL
   payload — it *reads* silicon's profile at apply time and merges it — while ALL profile
   data stays silicon-owned (`presets/rtl-ip.profile.json` exists only there).
   **Implementation contract (verbatim from silicon `presets/README.md` §"The t15 hook
   contract", do not re-derive it):** read at **apply() time**, never at import time;
   resolve the path bundle-relatively (walk up to
   `node_modules/@mpd-dsh/silicon/presets/rtl-ip.profile.json`) or via
   `require.resolve('@mpd-dsh/silicon/presets/rtl-ip.profile.json')` when available;
   **missing file is NORMAL** (mpd installed without silicon) → fall back to `{}`, boot
   unchanged, no per-boot warning (a single debug line at most); **corrupt/non-object JSON
   must not abort the boot** → catch, fall back to `{}`, log once; merge as
   `profiles: { ...fromSilicon, mpd: <mpd's own> }` so a future colliding key lets mpd's
   own profile win; keep `MAX_TEAM_PROFILES = 16` in mind (2 here); do NOT pre-validate
   member shape — `resolveTeamProfile` already rejects unknown names, empty/duplicate keys
   and >16 profiles at create time.
   **Proof required (this is C6's clause):** a real mounting boot on a scratch `DSH_HOME`,
   not `--dump-config`, showing the `agent-teams` row carrying **both** `mpd` and `rtl-ip`
   under `config.profiles` while `profiles.mpd` still contains the full mpd roster (the
   carrier must not regress mpd), PLUS the absent-silicon case proving the `{}` fallback
   still boots. The mount-proof pattern in AGENTS.md §4 is the shape to use; a
   `--dump-config` result is NOT load evidence and must not be cited as the proof.
3. The §5 deviation is now closed rather than recorded as a gap: with R2 deleting the six
   RTL guides and R1.1 removing the HDL overlay, the pointer note is the only RTL-adjacent
   text mpd keeps, which is exactly §1's "no RTL content is duplicated there". No
   silicon-side governance note is needed for the hook — mpd is implementing the policy,
   not deviating from it. Where mpd DOES deviate from a literal reading of §5 is R1.1
   (the LSP *transport* stays while the HDL registrations leave) and R6 (the two internal
   QA reference docs stay); both are interpretations and are recorded as such below.

This also removes the stale case-table row: `skills/dsh-qa/SKILL.md` keeps no row asserting
that the mpd bundle ships the `rtl-ip` profile (its current row describes a layout that no
longer exists — see R3, which retires the case).

## R6 — the Verilog golden fixtures and the stale pack are deleted

**Ruling:** `tests/golden/fixtures/verilog/**` (3 files + `README.md`) is deleted from mpd,
and the stale `dist/mpd-package/` pack (which would install the two removed HDL
`lsp-setup` reference pages) is repacked or removed rather than shipped as-is.

Evidence: silicon's policy forbids mpd keeping "the golden fixtures"
(`docs/sync-policy.md` §5); t2 measured the fixtures byte-identical to silicon's copies
with **zero live mpd consumer** (captain re-verified: no `fixtures/verilog` reference in
`tests/`, `scripts/`, `skills/`, `packages/`), and silicon already holds them, so deletion
cannot lose content.

**Repair action (t8):** delete the fixture tree; then handle its inbound citations honestly
— `docs/adder4.md:7` and `docs/cnt8.md:7` carry `Source file: tests/golden/fixtures/verilog/...`
pointers, and `docs/adder4.md` / `docs/cnt8.md` are retired process records whose technical
content now lives in silicon. Update them the minimal honest way (repoint the source line at
the silicon path, with a one-line note that the fixture moved to the silicon bundle) instead
of deleting the documents; if a doc pair exists, both languages change together, and neither
is promoted to a bilingual public doc by this touch. For the pack: `dist/mpd-package/` is a
release artifact, not source — after the source deletions, re-run `node scripts/pack-mpd.mjs`
or remove the stale directory, and record which was done (`dist/` is gitignored, so this is
distribution hygiene, not a repo-content fix).

## R7 — resolutions of the contradictions the adversarial review raised (binding on the verdict and the repair)

These four points come from the Plan Reviewer's falsification pass against the audit's own
accepted contract. They are rulings on how the conflict is recorded, not retreats from R1–R6.

1. **R5 ↔ C6 (rule change, hook now in scope).** Resolved by reversing R5.2: the carrier
   hook IS implemented (see R5.2's contract + mount proof). C6 becomes satisfiable as
   written and must NOT be marked superseded. Its proof obligation is the mounting boot
   described there.
2. **R3 ↔ C7 (contract clause superseded by the user's instruction).** C7 requires the two
   RTL cases to stay registered and SKIP cleanly; R3 retires them on the user's standing
   instruction that development test cases are software-type from now on. The verdict MUST
   mark C7's case-registration clause SUPERSEDED BY R3 with that reason, and must not
   report C7 as passed.
3. **M1 — the cross-repo rule, stated so both halves are consistent.** The rule is not "no
   repo-level guard may touch a sibling"; it is "a QA CASE must not be green while
   verifying nothing, and a repo-level guard must not silently pass without its subject."
   mpd therefore retires the two cases (R3) AND keeps `scripts/verify-rtl-references.mjs`
   with its silicon-side resolution explicitly SKIPPED-and-disclosed when the sibling is
   absent, plus the local negative forbidden-path invariant so it always has a subject of
   its own. This distinction is the wording to use in the repair report and the verdict.
4. **M2 — the two internal QA reference docs stay, with the exemption on the record.**
   `docs/adder4.md` and `docs/cnt8.md` are golden-fixture reference material, which
   AGENTS.md §3 exempts from the public/bilingual doc set; silicon's §5 "no RTL content"
   rule is a product-capability rule and these two are internal QA records whose technical
   content already lives in silicon. The exemption is recorded explicitly (path, the §3
   basis, why §5 does not bite) together with the residual risk that §5 read literally
   would delete them. Their `Source file:` lines still get repointed at the silicon fixture
   path with the moved-note, so the pointer is honest when a sibling checkout exists and
   carries the note when it does not.
5. **L1 + ordering.** The `test:qa` vs `test:qa:all` item is labelled as a repair-scope
   decision beyond the extraction (it fixes a pre-existing dishonesty t3 measured, not an
   extraction residual). **Ordering is mandatory:** R1.1's `cli.js` regeneration and R3's
   `skills/**` retirement are two invalidations of one fingerprint, so they land in ONE
   change with ONE `VENDOR_LOCK` re-pin, and the regenerated `cli.js` precedes R6's repack
   of `dist/mpd-package`. Two re-pins (or a repack of the pre-repair cli.js) would ship a
   stale pack and red-line anyone committing in between.
6. **Two qualifiers the verdict must carry** (from the adversarial pass, both accepted):
   F1's red is *expectation drift* — the same boot log shows install/composed/http/preset/
   adapter-tool-call/roster/no-home-copy/uninstall all green, so writing "the MOUNT gate is
   red" without that qualifier misreads as "the mount is broken"; and F2 is NOT
   extraction-caused (pre-existing since `d510a16`), proven by ancestry
   (`git merge-base --is-ancestor d510a16 3d99718`) and byte-identity, NOT by the
   `raw/bun-test-baseline-3d99718.log` log, whose two artefacts (duplicate suite paths,
   6-vs-3 failure counts for byte-identical files) make it unfit as the proof.

7. **V1 — the classification conflict is decided (who wins when a census disagrees with a
   ruling).** t1's census labelled the LIVE HDL registrations (`dist/cli.js`,
   `overlay/lsp/language-mappings.ts`, `overlay/lsp/server-definitions.ts`) as
   `BRIDGE-BY-DESIGN / ACCEPTABLE / none`, citing an R1 that R1.1 then superseded. Ruling:
   **R1.1 governs.** t1's census is a *discovery input* — an exhaustive inventory whose
   bucketing is provisional; the captain's rulings are the *contract*. Where they disagree,
   the ruling wins, and a repair list must never be derived from the census buckets alone.
   This is the one place where inheriting t1's 16-defect list verbatim would have omitted the
   only live RTL capability in the tree. The accurate rule for t8's scope is therefore
   **reconciliation, not either/or**: t8 reconciles the census's coverage (so nothing that was
   found is dropped, including findings no ruling covers — the J1/J2 class, the keep-with-record
   string hits) with the rulings' dispositions (which decide what happens to each path). Where
   the two disagree, the ruling wins. The disagreement is kept on the record as a finding rather
   than quietly overwritten: the verdict must state that the census's B2 judgement on those
   three paths was superseded by R1.1 and that the reason is the ruling's liveness evidence
   (bundle row `mcp-lsp` launches exactly that `dist/cli.js`; `VENDOR_LOCK.json:39-43` sha-pins
   it), i.e. the HDL service is MOUNTED, not dormant source.
8. **V2 — the Verilog fixtures and the two reference docs get ONE answer each.** Resolved
   against the three-way conflict (t1: BRIDGE/ACCEPTABLE; t9: RETIRE; t2 §1+§5: "must not
   keep"):
   - the **four tracked fixtures** `tests/golden/fixtures/verilog/**` are deleted (R6 stands);
     silicon holds them, no live mpd consumer exists, and §5 names "the golden fixtures" as
     something mpd must not keep;
   - the **two documents** `docs/adder4.md` and `docs/cnt8.md` stay, as internal QA/golden
     reference records under the AGENTS.md §3 exemption, with their `Source file:` lines
     repointed at the silicon fixture path plus the moved-note (R6/R7.4 stand).
   Rationale, stated so a future literal re-read of §5 does not have to guess: §5 governs
   *RTL product capability* — skills, plugin, LSP configuration, guides, fixtures, profile
   data. A document that describes a golden reference design is internal QA provenance, not
   a capability, and its content already lives in silicon. If the owner later wants §5 read
   literally, the two docs are named here as the deliberate exception.
9. **V3 — the retained reference gate is not strip evidence.** `scripts/verify-rtl-references.mjs`
   must never be cited in the verdict as proof that the mpd surface is stripped: t5 proved
   its failure channel is structurally unreachable for every audited residual family
   (either-root resolution, silicon-owned `DOCS`, a `PENDING` list that pre-absolves the very
   paths at issue, and `considered: 0` treated as PASS in the standing run). t12's closure
   counts it among "three gates green" as a *current health fact*, and the verdict may repeat
   it only as that — never as coherence for the strip. The gate earns its place back only
   AFTER t8 re-points it (local negative forbidden-path invariant + `CASES = []` +
   `considered > 0`-style disclosure), and t11 re-measures it in that state.
10. **Evidence attribution (V9).** Task t12 wrote ten raw logs into t5's `inScope` directory;
   the verdict and the lead's report attribute files per `verify/raw/t5-raw-manifest.md` and
   never read a t12 log as t5 evidence. No rewriting of another task's evidence for hygiene.

11. **R5.3 — where the hook merge lands (mechanism ruling).** Chosen: the carrier hook is
   implemented as **one ADDITIVE `mpd-delta` region at the top of `apply(ctx, config)` in
   `packages/mpd-agent-teams-plugin/lib/index.js`**, re-binding the config before any
   consumer sees it:
   `config = { ...config, profiles: { ...loadSilicon(), ...(config.profiles ?? {}) } }`.
   Why this and not the alternatives, recorded so a future reader does not re-open it:
   - the adopted plugin reads the profile set in FOUR places (`lib/index.js:125` the resolved
     profiles, `:151` the captain prompt, `:169` the slash command, `:171` the gesture
     boundary), so a merge that lands anywhere else leaves some consumers on the stale set;
   - a YAML sibling file is unreachable from the row's `!!js` expression (it sees only
     `baseUrl`/`process`), and `config.profilesFrom` would be a SILENT no-op because
     schemastery keeps unknown keys — the exact silent-loss class AGENTS.md §12 warns about;
   - moving the mpd roster out of the patch (the alternative considered) trades a governed,
     documented divergence for a new shipped data file, a larger exports/pack surface, and a
     roster that is no longer reviewable in the patch;
   - the merge is additive, so the mpd roster stays single-sourced in the patch and mpd's own
     profile still wins a future key collision (contract requirement).
   Conditions attached to this ruling (all mandatory): the region carries a comment stating
   what it does and why it must run first; the registry is regenerated with
   `node scripts/patch-agent-teams-fixes.mjs --write-registry` and never hand-edited, with
   `--check` clean afterwards; the full regression (`bun test packages`,
   `bun skills/dsh-qa/scripts/agent-teams-dispatch.mjs --self-test`,
   `bun skills/dsh-qa/scripts/agent-teams-sidebar.mjs`) stays green; the ABSENT-silicon case
   must still boot with the `{}` fallback and an intact mpd roster; and the report presents
   this as a governed AGENTS.md §6 change to the adopted tree (the adaptation table there
   needs an entry for it, since the table is transcribed from the authoritative
   enumeration). Rejected alternative recorded for provenance: embedding the roster inside the
   `!!js` expression (duplication, unreadable patch).
12. **R7.12 — the installer/build family (t5 addendum — evidence/
   `evidence/rtl-extraction-residual/verify/addendum-gates-and-criteria.md`; indexed by
   `verify/addendum-manifest.md` §2, claims A1–A22 — extends R1.1).** t5's post-completion
   extension found an mpd-owned HDL installation path that a name-based sweep could not see:
   - `scripts/install-mcp.mjs:32-35` downloads and installs `verible-verilog-ls` and
     `slang-server` into the toolchain, and `:306` makes the script's self-test require both.
     Ruling: **mpd stops provisioning the HDL language servers** — the entries come out and the
     self-test stops requiring them; the already-installed local binaries go as workspace
     artifacts under R6's local-artifact clause. Consequence to state in the report and the
     verdict: mpd no longer installs HDL language servers at all, so silicon must own that
     provisioning if its LSP path is to work from a clean machine. That is the intended
     direction, and this note is what keeps it from becoming a silent capability loss.
   - `scripts/build-mcp.mjs:37-44` pins `BUILTIN_BUILD_ANCHOR = "mpd-rtl-overlay-v1"` and
     `applyLspOverlay` FAILS LOUDLY if the anchor is absent from the upstream source. This is a
     build constraint on R1.1, not an RTL residual: the anchor is renamed to a non-RTL name in
     the SAME change while the guard stays functional. The build's own success is one half of
     the proof; the other half is showing the guard still trips when it should. A loud guard
     that stops firing after a rename is another member of the "cannot fail" family.
   - Content-only mentions with no capability behind them (`scripts/pack-mpd.mjs:75`,
     `package.json:33` the `verify:rtl-refs` row for the re-pointed gate, `.gitignore:23-34`,
     where `simv_iverilog` is the only RTL-specific pattern) are corrected where a rename is
     honest and otherwise recorded in the keep-with-record class, with the choice stated.
13. **R7.13 — t2's criterion defects are corrected, not inherited.** The reviewer's extension
   measured three defects inside the audit's own acceptance criteria:
   - C7's row check `grep -c '^\| rtl-verif '` is VACUOUS (the `^` branch matches every line,
     returning 73 = the file's line count). Correct it to a strict row test in the corpus probe
     the repair lands — the same "guard that cannot fail" family as R7.9, this time inside the
     AUDIT's own contract, named twice on purpose.
   - C7's requirement that the two RTL cases exist and SKIP cleanly cannot survive its own
     repair (R3 retires them): stays SUPERSEDED (R7.2), never passed.
   - C6's two remnants are red today (mpd's root README has zero silicon pointer lines;
     `git grep rtl-ip.profile.json -- packages scripts presets` is empty) and are reported as
     bridge gaps until R5.2/R5.3's hook and mount proof exist; never reported as passed in the
     pre-repair baseline.
14. **R7.14 — the retained gate's failure channel, measured precisely (narrows R7.9).** t5's
   extension claimed the channel is "structurally unreachable"; the Plan Reviewer measured the
   opposite in one environment (`MPD_SILICON_ROOT=/nonexistent node scripts/verify-rtl-references.mjs`
   → exit 1, 3 unresolved). Both are right about different cases, and the surviving fact is
   narrower: **with the sibling present** the run resolves silicon-owned paths that are
   MPD-ABSENT and pre-absolves every audited residual family through `PENDING`, so the channel
   is unreachable exactly where it matters; **with the sibling absent** it does fail.
   Binding consequence for R7.3's rewrite: the re-pointed gate keeps a POSITIVE mpd-side subject
   (the local negative forbidden-path invariant), still FAILS when the silicon side is absent
   (never converting today's exit 1 into an exit 0 with a SKIP line), prints `considered` in the
   STANDING run, and makes `considered: 0` read as a degraded run rather than a silent PASS — so
   the rewrite ends up strictly stronger than today's behaviour, not weaker.
15. **R7.15 — the two guard blind spots are IN SCOPE for the repair, over the reviewer's
   recommendation to defer them.** The guard sweep found two standing guards that print PASS with
   ZERO subjects, and the captain rules they are fixed in the same pass rather than parked:
   - **Guard-1 (medium) `scripts/verify-rows-parity.mjs`:** with a byte-copy patched so that the
     bundle patch carries no `- insert:` block and the installer prints nothing, it prints
     `[verify-rows-parity] ok: 0 row ids match the bundle patch insert list ()` and **exits 0**.
     The count is printed but never asserted, so every exit-code consumer (CI, agents, the audit's
     own "gates green" lists) reads PASS. Silicon's sync policy names this very gate as the one to
     update with a corpus deletion, so it sits directly on the repair path.
   - **Guard-2 (low-medium) `scripts/verify-vendor.mjs`:** with the real lock truncated so that
     `assets` is empty (`7 → 0`), it prints `commit OK / version OK / stats OK / PASS` and **exits 0
     with zero fingerprints checked**; stats drift is warning-only.
   **Ruling and reasoning:** the reviewer recommended a follow-up with its own evidence on
   scope-discipline grounds. That is overruled here, and the reason must be stated wherever this
   is reported: these two gates are the very instruments the repair uses to prove correctness, so
   a green from a zero-subject run is exactly the class this audit exists to expose. A minimal
   subject-count assertion in each (fail when the enumerated subject set is empty, and say which
   set was empty) restores the meaning of their exit codes. Both edits are a few lines inside
   existing gates, carry a falsifiability probe (empty-subject copy → exit 1, non-empty → exit 0),
   and do NOT need a new task: t8 lands them, t11 re-measures them, and the reviewer's own
   recorded recommendation to defer stays in `review.md` §8 as the dissent.
   Their classification is fixed too: they are named in the report as **pre-existing guard-quality
   defects, explicitly NOT extraction residuals** (t6's §6 C9), so the strip verdict is not
   inflated by them.

Non-rulings (deliberately left as findings):

- t3 F5 (the guard resolves a token against EITHER root, so a stale mpd copy can mask a
  silicon-owned path) is accepted as a guard-quality observation; it needs no separate
  action once R2 removes the stale copies, but the repair report must state that it was
  neutralized by R2 rather than fixed.
- t3 F6/F7 (silicon has no `.venv-rtl`; `presets/rtl-ip.profile.json` exists only in
  silicon; the mpd bundle declares zero `silicon-` rows) are informational and consistent
  with the split; no action.
