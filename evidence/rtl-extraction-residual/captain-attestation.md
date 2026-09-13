# Captain attestation — chain of custody for the audit artifacts

Captain-owned record, final revision for the audit's pre-repair stage. Its purpose is narrow and
practical: several audit artifacts were extended AFTER their owning task had reached terminal state,
and at least one was extended after a downstream document had already consumed it. "Immutable
evidence" then becomes a claim nobody can check. This file states which bytes exist, when they were
measured, and what a citer may rely on.

Nothing outside `evidence/rtl-extraction-residual/` is touched by this task, and nothing owned by
another member is edited — every correction here is a correction to the captain's own record.

## 0. The discipline this file exists to enforce

**Measured state, never remembered state.** Every hash below comes from a captain `sha256sum`/`stat`
pass, and the rules for citers are:

- a hash is valid only for the revision it names; "at the pin" means `git show 32ae54dd10d:<path>`,
  never the working tree, and post-repair measurements belong to the repair's own verification.
  For the two documents that moved repeatedly, cite by SECTION rather than by hash
  (`verify/addendum-manifest.md` §2/§3/§4, `review/review.md` §6/§8/§9, the verdict's §4/§6), because a
  section reference survives a revision while a hash does not — and the hashes recorded here were
  taken on a tree whose own producer was still editing (the verdict advanced 501 → 513 lines after
  the first freeze attempt, with my A1..A22 correction verified intact across it);
- a negative result is not evidence until the tool's semantics are proven (see §4);
- a hash nobody can reproduce from a frozen state is decoration — prefer citing a revision log.

## 1. Measured state (captain pass)

| Path | bytes | lines | hash | owner |
|---|---|---|---|---|
| `captain-rulings.md` | 30919 | 413 | md5 `c8996e9e7bd5556039c9ee56b331c56b` | captain — still editable by me |
| `captain-attestation.md` | 8532 | 101 | md5 `dd7b28a12949fccc8699be0fb92ffcd9` | captain — this file |
| `review/review.md` | 42475 | 395 | md5 `f3c69a63cf6f5275484a94867f73b533` | t6 — FROZEN (read-only); chain 225→326→333→338→395 |
| `review/CHANGELOG.md` | 6559 | 74 | md5 `07c413fd9ceebf5f0572f78b0216674f` | t6 — readable companion (per-revision trigger + classification) |
| `verify/verdict.md` | 21476 | 202 | md5 `fa23f45965324bc50b93a6b0a666a1b8` | t5 — immutable |
| `verify/false-negative-probes.md` | 7448 | 47 | md5 `cc3fea8b2356f83f6c060be2147aff8e` | t5 — immutable |
| `verify/addendum-gates-and-criteria.md` | 14897 | 181 | md5 `5f58fc37717b2db4de9fba11e3d4a0bd` | t5 — FROZEN (read-only) at r3 |
| `verify/addendum-manifest.md` | 45257 | 409 | md5 `bffb902199d396daa2b0e153773aaf9b` | t13/t14 — FROZEN (read-only); covers both addenda (§2 A1..A22, §3 A23..A34, §4 identity+hash discipline); NO outstanding residue in this revision — the addendum row labels r1 and defers to verify/raw/addendum-revision-log.txt, and the falsification check is scoped to the two protected t5 rows |
| `verify/raw/addendum-revision-log.txt` | 1188 | 21 | md5 `e7c5621ba995c7ad1b302e374b8bc274` | t5 — authoritative for the addendum's revisions |
| `verdict.md` | 67297 | 629 | md5 `f1bf781ae22e2a83737d9b2a19bdf3de` | t7 — FROZEN (read-only) at the on-disk revision; verify by FEATURES, not by a byte count (it moved repeatedly while this record was written): `A1..A22` ≥ 4, frozen-review pin ≥ 1, reconciliation wording present, `repair scope is R1.1` = 0, `^x$` = 0, `bytes below` = 0, one ANSWER token. Staged, not committed (HEAD `32ae54dd`) |
| `verdict.zh-CN.md` | 65838 | 545 | md5 `af89562c1d3f668eac88007a6baeecdc` | t7 — FROZEN (read-only), Chinese twin of the same revision; same feature checks, `答复：` token present |

**Stale-by-one-generation, named so nobody trusts it:** the `review.md` row here was first written as
333 lines / 36295 B (`7a346ab7…`) and the addendum row as 11766 B (`fada192f…`); both were superseded
within minutes, and the reviewer — not the captain — caught that this file's own write timestamp
(15:57:27) POST-DATED `review.md`'s last write (15:56:32), so a re-hash at write time would have
caught it. The miss is kept in the record rather than quietly fixed: a custody document that hides
its own drift is worse than none.

## 2. What actually moved

- `review/review.md`: 225 → 326 → 333 → 395 lines across post-terminal revisions, plus one
  hash-discipline-only tweak. The per-revision triggers and the BASELINE / NEW EVIDENCE / WORDING
  REFINEMENT ONLY / HASH DISCIPLINE ONLY classification live in `review/CHANGELOG.md`; in short, the
  frozen state differs from the 225-line baseline by exactly two evidence-bearing changes (§8 guard
  sweep + C9/C10; §9 addendum adjudication + C11 + C4/C5 widening). The verdict line `^verdict: pass`
  is unchanged throughout and is present at lines 13 and 395. The 225- and 326-line states are not
  provable by anyone: no pre-review checksum exists anywhere in the tree.
- `verify/addendum-gates-and-criteria.md`: r1 (144 lines, `fada192f…`) → r2 (the C7 "strict check"
  had been rendered in the same escaped form it was contrasted against — caught by t6 §9) → r3
  (181 lines, `596c26b0…`, header attribution + revision log). Findings, severities and the t5
  verdict are unchanged, and t6 re-verified that all five of its claims survive either state.
- `verify/addendum-manifest.md` pins r1 by construction. Do NOT "fix" it by rewriting: cite
  `verify/raw/addendum-revision-log.txt` (composed after the final edit, so it cannot go stale) or
  cite path + attribution.
- **Freeze and how it is enforced.** Both movers are frozen at the revisions in §1. The producing
  members have been told that anything further goes to the captain as a message, and that a change
  found necessary later becomes a NEW artefact with its own provenance rather than another revision
  of a document this record already pinned. The earlier pattern (four review.md revisions, three
  addendum revisions, each individually legitimate and labelled) was fixed by naming it, not by
  blaming it — the members reported every change themselves, which is why the drift is visible at
  all.

## 3. Consequences for the verdict, the repair and its verification

- The lead's verdict cites both extensions by path and carries C11; its appendix pins the `review.md`
  revision it consumed, which is the only sane way to cite a file that moved four times.
- The repair's verification must re-measure on the REPAIRED tree: the addendum's §1 gate exits
  (`bundle-lifecycle` 1, `bun test packages` 1) and every §2–§7 measurement are a pre-repair baseline
  for `32ae54dd` and must never be diffed against a post-repair run.
- Two specific checks the verification owes, because the repair's correctness depends on them: the
  `mpd-rtl-overlay-v1` anchor was kept or `BUILTIN_BUILD_ANCHOR` updated in the SAME change with the
  build still succeeding and its loud guard still tripping; and `install-mcp.mjs:32-35`/`:306`'s HDL
  language-server targets were reconciled rather than left provisioning verible/slang-server —
  including in the packed release artifact that ships that installer.
- **Logged event — the artifact-ordering trap (measured by the captain, 16:16 local).** The repair's
  own guard probe rewrote `packages/mpd-mcp-lsp/overlay/lsp/language-mappings.ts` at **16:14:57**,
  AFTER the regenerated `dist/cli.js` (**15:58:21**) and the repacked `dist/mpd-package/`
  (**16:12:13**) had been produced, and while a carrier mount proof was mid-run. Every one of those
  artifacts was therefore an artifact of an older overlay: shipping them would have re-packed the very
  HDL registrations the repair had removed. The captain issued the corrective order (rebuild → behaviour
  probe → VENDOR_LOCK re-pin → re-pack LAST → re-prove the anchor guard's failure side → re-run the
  mount proof if it predates the binary). This is the same class as the audit's other findings, one
  level up: **a produced artifact is only as new as its last input, and nothing in the pipeline was
  asserting that order.** The standing rule for the final record: publish the mtimes of the chain
  (`overlay → cli.js → pack`) together with the hashes, so a stale link is visible rather than assumed
  away.

## 4. What the "cannot fail" family amounts to

Three instances surfaced in this audit, with two distinct mechanisms — and the audit's own tools
produced two of them:

1. **Checks that cannot fail:** the acceptance criterion whose escaped alternation matched every line
   (reported 73 = file length; strict form 0); `verify-rows-parity.mjs` printing `ok: 0 row ids …`
   and exiting 0 with both parsers empty; `verify-vendor.mjs` PASSing with the asset table emptied
   7 → 0 and zero fingerprints checked. Remedy: assert a non-empty subject set and name the empty set
   in the failure message. All are in the repair's scope (R7.13/R7.15) and classified as pre-existing
   guard-quality defects, NOT extraction residuals.
2. **A searcher that cannot match:** the captain's `^verdict:` grep reporting 0 for a line that is
   literally present, because the pattern's `^` was an anchor rather than the literal circumflex.
   Remedy: prove the tool's semantics before trusting a negative, and use `grep -F` for text that
   begins with a regex metacharacter.

## 5. Staged, not committed — and what that changes

Measured at the end of the repair pass: `HEAD` is still `32ae54dd` with ~62 porcelain entries, i.e.
the whole repair is **staged in the working tree**, not committed. Consequences a citer must hold:

- "The tree is clean" and "I hashed the tree" are different claims. Every post-repair number in this
  record (my gate exits, the guard probes, the rebuild-compare, t8's report, t11's re-measurement)
  describes STAGED bytes. Re-running any of it after a commit, or after a further edit, is a NEW
  measurement, not a re-derivation of the old one.
- The rebuild-compare is the strongest freshness evidence available and it was run by the captain
  (t11 cannot: it writes `dist/`): rebuilding from the current overlay with
  `MPD_UPSTREAM_ROOT=<repo>/.mpd-dsh/upstream node scripts/build-mcp.mjs` (exit 0) produced
  `packages/mpd-mcp-lsp/dist/cli.js` = 234827 B / sha256 `9f41d4258c204aca…`, **byte-identical** to the
  artifact in the tree and to the `VENDOR_LOCK` pin. So the shipped dist is faithful to the current
  source, and the mtime inversion I first flagged (overlay 16:14:57 newer than dist 15:58:21) was a
  false alarm caused by the anchor-guard probe rewriting `overlay/lsp/language-mappings.ts` with
  IDENTICAL content. **Rule for the record: freshness is proven by rebuild-and-compare, never by
  ranking mtimes** — a probe that rewrites a file in place moves its mtime without a content change,
  and `git status` looks dirty either way.

## 6. Last substantive finding: a rebuild that reverts a fix (found and fixed by the captain)

`node scripts/build-mcp.mjs` rebuilds EVERY MCP server from the upstream checkout, not just the one
whose source changed. When the repair ran it for the LSP server, it also regenerated
`packages/mpd-mcp-astgrep/dist/cli.js` and `packages/mpd-mcp-gitbash/dist/cli.js` — and those two came
back **pre-rebrand**, silently reverting the MPD naming the shipped dists carry:

- `var MPD_PROVISION_HINT = "Start an MPD session …"` → `OMO_PROVISION_HINT` / "an OMO session";
- `platformFrmpdOptions(options)` → `platformFromOptions(options)` (6 sites);
- `Usage: mpd-git-bash` → `Usage: omo-git-bash`.

Measured: exactly 2 and 6 changed lines respectively, and `verify-vendor` went red with
`asset packages/mpd-mcp-astgrep/dist/cli.js sha256 mismatch` plus the gitbash equivalent, while the
LSP and codegraph pins stayed clean. So the pinned bytes ARE the rebranded ones: a rebuild there does
not just move a fingerprint, it ships pre-rebrand artifacts and fails the vendor gate.

Fix applied (a restore, not a re-pin): `git checkout HEAD --` the four files
(`mpd-mcp-astgrep/dist/{cli.js,BUILD.lock}`, `mpd-mcp-gitbash/dist/{cli.js,BUILD.lock}`). Verified
after: `verify-vendor` **PASS exit 0** (all six assets OK), `MPD_PROVISION_HINT|mpd-git-bash` = 2 hits /
`OMO_*|omo-git-bash` = 0 in both files, and neither file is listed by `git status` any more.

Recorded as a HAZARD rather than a closed item: nothing in the build path asserts that a produced dist
carries the rebrand — today only the vendor fingerprint protects it, and that is exactly what turned
red. Adding such a guard is deliberately NOT part of this pass (it would be a new change after the
freeze); it belongs in its own scoped change with its own evidence. t11 has been asked to assert both
the brand strings and the vendor gate on the settled bytes, and to check the packed copies, since t8's
pack run predates this restore.

### 6.1 Mechanism, as independently re-measured by the Reviewer (sharper than the captain's first write-up)

`scripts/build-mcp.mjs:168-203` builds every server and applies `applyMpdScrub(name, …)` at `:195`, a
**targeted key list** (`MPD_SCRUB` at `:104-136`) plus per-server `residual` asserts that exit 1 loudly
(`:140-152`). So the defect is a **list-coverage** defect, not a blanket "no rename at all":

- **git-bash is the silently-reverting one**: its only replace entry and its only residual mention the
  `omo-git-bash-run-` key (`:133-134`), so the upstream usage string `"Usage: omo-git-bash [mcp]"`
  (`git-bash-mcp/src/cli.ts:12`) and the `platformFromOptions` identifier (5 upstream lines) sit OUTSIDE
  both the replace list and the residual list — a rebuild reverts them and the residual check still
  passes.
- **ast-grep is the loud one**: its usage string IS covered (`["omo-ast-grep","mpd-ast-grep"]` at `:127`
  plus a residual at `:129`), so that revert fails the build instead of shipping.
- Attribution precision: `OMO_PROVISION_HINT` and the prose "Start an OMO session" have **0 hits** in the
  two upstream src dirs, so the revert is best attributed to the uncovered spellings above (usage string,
  `platformFromOptions`, and prose sourced from the CORE packages that the scrub reaches only through the
  same key list) — not to that identifier by name.
- Measured closure of the captain's restore (Reviewer, `verify/raw/t11-rebrand-hazard-assert.txt`):
  astgrep `f06bba310cad306b…` / gitbash `cb9ce8f3f1749d94…` = work = pack = `VENDOR_LOCK`, `OMO_*` = 0,
  MPD spellings = 2 each, those paths absent from `git status`, `verify-vendor` exit 0. The pack carries
  the restored bytes, so the "stale pack copy" concern is CLOSED rather than deferred.
- Follow-up (deliberately NOT taken now — it would be a new change after the freeze): widen the residuals
  to brand-shaped checks (`Usage: omo`, prose `OMO`) and add the missing list entries, in its own scoped
  pass with its own evidence.

## 7. The one obligation still open, with its failing evidence (deferred, never fabricated)

The carrier hook (R5.2/R5.3) owes a **session-level mount proof**: a boot in which a real session's
model step emits `agent_teams_create { profile: "rtl-ip" }`, run once with the silicon sibling present
and once without. That proof does NOT exist. What was proven instead, and what failed, per t8's §3:

- **Proven**: a real web-profile boot on a scratch `DSH_HOME` mounts the tree, and a probe's
  `agent_teams_create` call REACHES the real tool — it is refused only by the tool's own agent guard
  (`exec.agent was undefined`, i.e. the call had no calling agent). `patch-agent-teams-fixes --check`
  exit 0, 13 regions.
- **Failed designs, both reproducible**: a plugin-origin tool call cannot work (no calling agent), and
  capturing the session prompt produced two boots that exited 0 while writing NO transcript
  (`sessionBytes: 0`), so there is nothing to assert against.
- **Reproducible next step**: one real headless session whose model step emits
  `agent_teams_create { profile: "rtl-ip" }`, with and without the sibling planted.

Consequence to carry in the final answer: C6's hook half is implemented and behaviour-proven at the
function level (including the corrupt/unreadable semantics), but NOT proven end-to-end through a live
session that creates a team with the merged profile. A green function-level probe is not the same claim
as a green session, and the record says which one this is.

### 7.1 Chain ordering finally proven, and what it cost

The Senior Engineer re-ran the whole chain AFTER the last overlay write, in order, on the shipped
revision (`repair/report.md` §11; `raw/freshness.log`, `raw/freshness-final.log`): overlay sha before
and after identical; `build-mcp` exit 0; `dist/cli.js` mtime 16:31:34 > overlay 16:14:57 with sha256
`9f41d4258c204aca…` — IDENTICAL to the earlier build, which is the interesting part: the artifact was
never wrong, only unproven. Re-pin + `verify-vendor` exit 0; repack at 16:31:36; anchor guard probe
exit 1 with the expected message and the overlay restored byte-identically; final six-command sweep all
0. Captain's own re-measurement after that: overlay 16:31:36 → cli.js 16:31:34 → pack 16:32:58 (the
overlay mtime is the guard probe re-applying the file in place with identical bytes — the known
false-positive source), gates 0/0/0/0/0, brand check OMO = 0 in both MCP dists, pack carrying 0 RTL
cases, 0 HDL pages and 0 HDL install paths.

Two costs worth naming, because they are the point rather than a footnote:
- the re-run rebuilt ALL MCP dists again, so the astgrep/git-bash churn had to be reverted a second
  time. That is the same hazard as §6 and it is now demonstrated twice: **any** `build-mcp` invocation
  silently reverts those two artifacts' rebrand unless the scrub list is widened.
- the freshness question took three rounds to settle (mtime ranking → rebuild-compare → ordered re-run),
  and the answer was the same each time. The lesson stands as written in §5: prove freshness by
  production ordering or byte comparison, never by ranking mtimes; and when a probe rewrites a file in
  place, expect the mtime to lie.

### 7.2 Status of C6's mount-proof half: OPEN, and that is the recorded answer

Two attempts, both honest, neither green:

- **t8's attempts** (report §3): a plugin-origin tool call cannot work (no calling agent, `exec.agent was
  undefined`), and two prompt-capture boots exited 0 while writing NO transcript (`sessionBytes: 0`).
- **t15** (`repair-verify/mount-proof.md`): the SANDBOX half succeeded — the packed bundle installs into
  a sandbox profile (`dsh plugin --profile mpd-headless add` exit 0, store/cache redirected out of the
  isolated HOME), `@mpd-dsh/silicon` is installed as a REAL package directory (not a symlink) with the
  planted `presets/rtl-ip.profile.json` = **10327 B / sha256 `1ff65b7c…` = the sibling's sha**, and
  `createRequire(<plugin lib>/index.js).resolve(…)` RESOLVES. But no live session reached the model
  step: boot #1 exited 1 on a malformed patch append (the profile template ships `[]`, so the stub row
  must REPLACE it), boot #2 received **0 model requests** and hit the harness timeout (**exit 124**).
  The reviewer explicitly did NOT substitute `--dump-config` and did NOT present the region probe as a
  session result.
- **t16** (in flight): a bounded retry carrying t15's PROVEN half forward and using its own written
  recipe (`software-smoke.mjs`'s `makeStub` verbatim, longer budget, session log streamed to a file).

**Rule for every downstream citation until t16 says otherwise: C6's merge evidence is REGION-PROBE
LEVEL ONLY.** What IS proven about the hook: the region is present in the staged bytes, the registry is
clean (13 regions), the semantics are verified in isolation (ENOENT → continue; other read error /
invalid JSON / non-object → one warning naming the path, then `{}` and STOP; valid → merge; all absent →
silent), and four real BOOTS exercised the warning/stop matrix (t8 §12, including the discriminator
"corrupt nearest + valid farther → exactly one warning naming the corrupt candidate"). What is NOT
proven: a live session whose agent-teams row demonstrably carries BOTH `mpd` and `rtl-ip`. A green
function-level or boot-level probe is not that claim, and this record will not let the two be conflated.

### 7.3 C6 mount proof — FINAL status: STILL OPEN, not constructible in this environment

Three attempts, all honest, none green, and the third one turned the question into a constructibility
proof rather than a failed attempt:

1. t8 (§3): plugin-origin tool call impossible (no calling agent); two prompt-capture boots exited 0 with
   `sessionBytes: 0`.
2. t15 + retry (`repair-verify/mount-proof.md` §1–§6): the SANDBOX half succeeded — packed bundle
   installs into a sandbox profile (exit 0, store/cache redirected), `@mpd-dsh/silicon` installed as a
   REAL package directory with the planted `presets/rtl-ip.profile.json` = **10327 B / sha256
   `1ff65b7c7aca8fde…` = the sibling's bytes**, and `createRequire(<plugin lib>/index.js).resolve(…)`
   RESOLVED. But with a FULL OpenAI-shaped SSE stub (multi-chunk `chat.completion.chunk` + tool-call
   branch, modelled on the QA case's `makeStub`), both lanes received **0 model requests** and were
   killed at their caps (present 420 s → exit null/SIGKILL; absent 300 s). The boot log shows rows really
   mount (`[mpd-dsh-adapter] mpdDsh provided`, `[mpd-bootstrap] skill corpus served from
   <sandbox>/mpd-package/skills`) and it is NOT a credential failure, but it stalls right after the MCP
   setup (`CodeGraph MCP skipped: codegraph binary not found` ×2) so no prompt is ever produced.
3. t16 (the bounded retry): the remaining route — planting the silicon package at walk-up level 6
   (`/root/dshProj/node_modules/…`), which is OUTSIDE the repository and needs no repo write — is
   **unavailable**: `/root/dshProj` is mounted read-only here (`mkdir` exit 1, `ln` exit 1) and sandbox
   escalation is disabled in this session, so that level cannot be populated. The packed-copy layout
   that CAN be built is the one that stalls.

**Answer to carry: C6's mount-proof half is STILL OPEN, and it is not constructible in this environment.**
To close it, a future session needs one of: a writable parent directory (so the outside-repo walk-up
level can hold a real package install), or a boot that reaches the model turn with the MCP rows disabled
or a codegraph binary present. The harness, the profile bytes and the recipe are all already on disk
(`repair-verify/mount-proof.md` §1–§7, `raw/mount-proof*-harness.mjs`), so the retry is bounded.

**What may NOT be claimed anywhere until then:** that a live session demonstrably carried BOTH `mpd` and
`rtl-ip` in the agent-teams profiles. The merge evidence is region-probe level (t11's six directions) plus
the resolution proof from the plugin's own lib directory. Boot-level evidence exists for the hook's
warning/stop semantics (t8 §12, four real boots) — that is a different claim and is not a substitute.

### 7.4 C6 mount proof — CLOSED (supersedes §7.3's OPEN verdict)

The last unexercised half is now proven, by the captain's own reading of t16's captured artifacts (not
by relay). The lane that stalled in §7.3 was a HARNESS defect, not a session one: with `MPD_CODEGRAPH_BIN`
pointed at the repo's `.toolchain` binary and the stub driven from `software-smoke.mjs`'s model, the
session reaches the model turn.

Measured, both lanes in the same harness (`repair-verify/raw/`):

| lane | result | requests | tools | applyCrash | warnCount | rtl-ip in the system prompt |
|---|---|---|---|---|---|---|
| `t16c` present | exit 0 | **3** | 86 | false | 0 | **true** |
| `t16b` absent | exit 0 | **3** | 86 | false | 0 | **false** |

The captured system prompt in the present lane carries BOTH profiles as the agent-teams consumer's own
listing — verbatim from `t16c-present-result.json`:
`Configured team profiles (pass profile= to agent_teams_create): - rtl-ip (7 members, captain planning):
RTL-IP SWIMLANE FLOW (skills/rtl-ip-flow is the binding execution contract) … - mpd (11 members, captain
planning): Read-only members (Architect, Researcher, Planner, Explorer, Plan Reviewer, Vision Analyst) …`.
That is C6's clause satisfied end-to-end: the merged set reached the consumer, and mpd's own entry is
intact.

**CAUSAL-CLAIM CORRECTION (see §7.5, verified by four control measurements).** The `MPD_CODEGRAPH_BIN`
attribution in the paragraph below is WRONG and is kept only as the narrative of how the lane was found: the
t16 completion payload repeated it too. The measured differentiator is ROW COMPOSITION — a profile built by
`dsh plugin add <pack>` alone composes **105** rows against **108** for the working headless profile, and the
three missing rows (`code-runtime`, `headless-runner`, `headless-startup`) are what drive the one-shot prompt,
so the process boots the plugin tree and waits forever. Control measurements: pack-only with pipes → 0 requests;
pack-only with file-redirected stdio AND `MPD_AST_GREP_SG_PATH`/`MPD_CODEGRAPH_BIN`/`MPD_DSH_GITBASH_CLI`/`MPD_DSH_LSP_CLI`
all pinned → still 0 requests, 180 s kill; install-profile layout with the same stub → 2 requests, exit 0 in 5.6 s;
and the working lane went green with `CodeGraph MCP skipped: codegraph binary not found` still in its log. The
`MPD_CODEGRAPH_BIN` step did not create those rows, so it is not the mechanism.

The absent lane is the falsification side: same harness, same 3 requests, **zero** `rtl-ip` in the listing
and zero warnings — the `{}` fallback is silent and does not disturb the mpd profile.

Roundness note on the team records: the session created teams under the DEFAULT `mpd` profile
(`ws/.mpd/team/mpd-default*/team.json`, `members = 11`), while the listing visible to the model offered
`rtl-ip` as a choice and the prompt told it to pass `profile rtl-ip`. The teams recorded are therefore
`mpd`-profiled — the merge is proven at the listing level, not by an `rtl-ip`-profiled team record. Stated
because the distinction matters and a future reader should not have to infer it.

Consequences: C6 is CLOSED; the merge evidence is no longer region-probe-only. §7.3's constructibility
finding keeps its own value (the outside-the-repo walk-up level is read-only here) but no longer blocks
anything, because the writable rebuilt-sandbox layout turned out to suffice once the MCP stall was fixed
with a real codegraph binary.

### 7.5 C6 closure strengthened, and the captain's root-cause hypothesis corrected

The Architect's t16 lane (`repair-verify/t16-mount-proof-retry.md`) went further than §7.4 recorded, and the
captain verified the stronger artifact directly on disk:

- `repair-verify/raw/t16-lane/ws/.mpd/team/t16-rtl-ip-team/team.json` — **`profile: "rtl-ip"`**, **7 members**
  named: Requirement Analyst, Spec Designer, RTL Code Engineer — Verilog/SV, RTL Code Engineer — SpinalHDL,
  Verification Engineer, Reviewer, Plan Reviewer. So the proof is no longer listing-level only: a REAL team
  under the `rtl-ip` profile was created inside the session (the round-trip: `agent_teams_create(rtl-ip)`
  refused by the auto-provisioned default team → `agent_teams_delete` → `Team "t16-rtl-ip-team" plan
  created … staged`). The `mpd`-profiled records alongside it (11 members) show the default roster intact.
- Present lane: exit 0, 3 requests (5 in the tool run), 86 tools including `agent_teams_create`, warnCount 0,
  and the captured system message carrying both `- rtl-ip (7 members, captain planning) …` and
  `- mpd (11 members, captain planning) …`. Absent lane: exit 0, 3 requests, listing carries only `mpd`,
  **zero warnings**, no `rtl-ip` on any request.

**Correction of the captain's hypothesis, recorded rather than dropped:** §7.4 and my message to the Reviewer
attributed the earlier 0-request stall to the MCP setup (`CodeGraph MCP skipped`) and to `MPD_CODEGRAPH_BIN`.
That was wrong as a root cause. The Architect measured the real one: a profile built by `dsh plugin add <pack>`
alone lacks the three headless driver rows — composed row sets **105 (pack-only) vs 108 (working headless)**,
the difference being `code-runtime`, `headless-runner`, `headless-startup`. Nothing drives the one-shot prompt,
so the process boots the plugin tree and waits forever. Proof: the identical stub in the working layout answered
2 requests with exit 0 in 5.6 s, while the packed layout still stalled with every MCP binary and CLI pinned.
`MPD_CODEGRAPH_BIN` may have helped the boot along, but it was not the mechanism.

**Reusable lane recipe (for any future bundle-level boot proof):** install-profile headless → `dsh plugin
--profile mpd-headless add <pack>` (dependency pointing at the packed copy) → reduce the home patch to the
PROVIDER ROW ONLY (the pack layer's ids otherwise collide: `duplicate loader entry id: mpd-web-compat`,
measured) → plant the sibling as a real package directory (10327 B / sha256 `1ff65b7c7aca8fde…`, `isFile: true`,
`createRequire(<pack plugin lib>/index.js).resolve(…)` RESOLVED) → boot twice with stdio to files and a cap.
Honest limits from that report: one extra absent-lane probe OOM-killed the stub (harness bug, not evidence
either way), the create refusal is session-start team policy rather than a profile error, and the hook's
file-level branch matrix remains the Reviewer's work.
