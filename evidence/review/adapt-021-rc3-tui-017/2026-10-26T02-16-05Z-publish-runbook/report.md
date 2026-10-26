# Blessing — publish-runbook sync (branch `docs/publish-runbook-0155`, uncommitted)

**BLESS**

Reviewer: reviewer (team M2, task T11). Subject: the eight-path doc-sync delta on
`docs/publish-runbook-0155` (HEAD `2007312e`). Basis: the real publish lane
`.github/workflows/publish.yml` and the repo's language policy. Findings only — no file edited.

**Delta:** `.github/workflows/publish.yml`, `AGENTS.md`, `CONTRIBUTING.md` + zh, `agent-references/installer-and-profiles.md`, `docs/development.md` + zh, `docs/plan-webui-tui-i18n.md` — +76/−14. No non-evidence untracked path, no code, no pin, no pack change.

## 1. CONTRIBUTING pair — factually the staged lane, languages in step

- No `npm publish` claim survives in either file (`grep -n 'npm publish' CONTRIBUTING.md CONTRIBUTING.zh-CN.md AGENTS.md` → empty). The command block is now `npm pack --dry-run` alone, and the paragraph describing it is corrected to "prints the tarball summary … and writes nothing" — which is what `npm pack --dry-run` does.
- The new paragraph matches the workflow one-for-one: `v*` tag push → pack + `npm stage publish --access public` = a STAGE (not public, `latest` unmoved); a human `npm stage approve <stage-id>` publishes it and applies the dist-tag; that approval is a SECOND `workflow_dispatch` with `stage_id` from `npm stage list`; the run's OIDC token can stage but cannot approve because approval carries the 2FA proof-of-presence; approve in ascending version order, then confirm the registry serves it. Every clause is backed by the workflow's own steps and header.
- The still-true sentences survived: the `publishConfig`/`files` allowlist paragraph (CONTRIBUTING.md line 216, zh 207) and the `node scripts/verify-plugin-manifest.ts --pack` sentence (line 227, zh 218) are unchanged.
- EN and zh carry the same facts, same order, same emphasis; the zh bold lead and the code-block comment are real translations, not copies.

## 2. AGENTS.md §11 new step 5 — right shape, but mind the manual's budget

- The step is exactly what was asked: three lines, names the human approval and the fact that the tag push only STAGES (`latest` unmoved), and points at `agent-references/installer-and-profiles.md`, "Publishing to npm" — nothing restated. It sits after "4. Push master + tag" and before the `---`, so the list is now 1–5 with steps 1–4 untouched.
- **Byte budget, measured: the file is NOT truncated.** `wc -c AGENTS.md` = **64158** against the `agent-instructions.config.maxBytes` cut **65536** → **1378 B of headroom**. Not over the cut, so nothing is silently dropped.
- But it is **below the 2 KB-margin guidance**: 65536 − 2048 = 63488 (or 2000-byte reading 63536) → over the guidance by **670 B** (or 622 B); and it misses T10's own bar ("MUST stay under 63500") by **658 B**. The historical ≤ 63.5 KiB / 65024 target is met (866 B under).
- Context that matters for the decision: **the guidance was already unmet before this wave** — HEAD was 63902 B (1634 B headroom, over 63500 by 402). This wave added **+256 B** into an already-over-guidance file, which is the "add without MOVE-FIRST" shape AGENTS §3 forbids ("before adding to this file, move a LONG FORM … into `agent-references/` … then re-measure"). T10 disclosed every number correctly and attributes the no-trim to a captain amendment I did not see.
- **So this is a captain decision, not a truth defect:** either accept 1378 B of headroom explicitly and re-baseline the guidance in `agent-references/context-discipline.md`, or take ~650 B out before the next edit to this file (T10 named two candidates: §11 step 2's gate enumeration that §4 already carries, and the §12 T-5x bullets that `troubleshooting.md` owns). Nothing here is false and nothing is truncated, so it does not block this merge.

## 3. `agent-references/installer-and-profiles.md` — matches the workflow step for step, nothing invented

New "Publishing to npm (the staged lane)" section. I mapped it against the workflow source step by step: trigger (`on: push: tags: ["v*"]` or dispatch) ✓; modes chosen only by `stage_id` ✓; the `v<package.json version> == tag` + package-name assertion **before** anything is packed ✓ (step order in the file: Resolve → Checkout → Setup → **Assert** → npm≥11.6 → Stage); `npm pack --pack-destination /tmp/npm-pack` then `npm stage publish --access public --tag <dist_tag>` with `latest` on a tag push ✓; the SECOND dispatch with the same tag and the filled `stage_id` running `npm stage approve` ✓; why OIDC cannot approve (npm-stage(1): short-lived trust tokens cannot run `npm stage` subcommands; approve needs 2FA) ✓; `npm stage list` as the id source ✓; ascending approval order and the non-`latest` `dist_tag` backfill remedy ✓; the post-approval `npm view @mpd-dsh/mpd version` + fresh `dsh plugin add` check, framed as an operator step rather than a workflow step ✓ (the workflow's last steps are the always-list and the artifact upload, so calling it human is correct); the trusted-publisher/401/`NPM_TOKEN` facts ✓ match the header. I found no invented step.

## 4. `docs/development.md` §6 + zh — appended, nothing renumbered

Step **7** is added after step 6, and the diff proves steps 1–6 (and the zh twins) are byte-identical — only an insertion. No document points at a shifted step number: a repo-wide grep for `step 6` / `第 6 步` / `step 7` / `第 7 步` in `docs/**` and `CONTRIBUTING*.md` returns nothing, so no cross-reference broke. The zh step carries the same facts, in step.

## 5. The two stale statements

- **`publish.yml` header reframed as history.** The present-tense false claim is gone: it now reads "WHY THIS FILE EXISTS — npm LAGGED BEHIND GITHUB **WHEN THIS WORKFLOW WAS WRITTEN** … **At that time** … was public … at 0.12.0 ONLY" (past tense) and "This workflow is the ONE path that **closed** that gap". The rest of the header (OIDC/trusted publisher, staged publishing, ascending order, the resolve/guard rationale) is intact.
- **`docs/plan-webui-tui-i18n.md` packed-version literal** now reads `0.15.5`, "measured 2026-10-26" — verified against the artifact: `dist/mpd-package/package.json` version is `0.15.5` and the file's mtime is `2026-10-26 09:34:43.355`. Correct, and the doc is a `docs/plan-*.md` process record (no zh twin owed).

## Gates I re-ran myself (logs in `evidence/review/…/2026-10-26T02-16-05Z-publish-runbook/`)

| Gate | Exit | Observed |
|---|---|---|
| `verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `verify-manual-paths` | 0 | `PASS resolved=154 over-report=74 under-report=78 declared=2` (154 vs 153 before the wave — the new §11 pointer's path resolved) |
| `verify-workflows` | 0 | `audited 3 workflow file(s)`; `PASS - every workflow is loadable YAML with a sane job/step shape` |

## Findings

### 1. Medium (captain decision, not a truth defect) — the injected manual is 1378 B from the cut

See §2 above. Not truncated; below the 2 KB-margin guidance (it already was at HEAD) and below the task's own 63500 bar; the wave added +256 B without a MOVE-FIRST trim. Decide: accept and re-baseline, or trim ~650 B before the next edit to `AGENTS.md`.

### 2. Nit — the Reference Index still under-describes `installer-and-profiles.md`

Its row in `AGENTS.md` says only "the full §8 body …" / "you change `files`/`dsh.*`, a patch row or an install path". The file now also owns the publish runbook, so a reader browsing the on-demand register will not see publishing there — discoverability rests on the new §11 step 5 pointer. T10 left it deliberately to avoid a second injected-byte increase and disclosed it. A ~30-byte addition at the next trim would close it.

### 3. Nit — the workflow header gained a new present-tense registry claim

The reframing added "the registry serves 0.15.4 today (measured 2026-10-25)". It is true today and it carries its measurement date, but it is a present-tense registry claim of exactly the class the brief deferred to the captain's post-publish pass (the same sentence in AGENTS §8 was deliberately left alone for that reason). There are now TWO post-publish update sites instead of one; the history reframing does not need the clause, so dropping it is an option. Non-blocking.

## Declined to judge

- `docs/plan-d.md` still contains `npm publish` twice: it is a `docs/plan-*.md` process record (the docs gate's EXEMPT pattern), phrased as an "optional future" step, and untouched by this wave — not a contradiction of the publish lane.
- The runbook/CONTRIBUTING "a human runs `npm stage approve`" vs the workflow's approve mode executing that command in CI: the workflow itself documents both routes (approve locally, or give npm a credential and re-dispatch), and a human is required either way — not false.
- The runbook omits the workflow's npm≥11.6 precondition: an omission, not an invented step, and outside T11's checklist.
- `AGENTS.md` §8's "LIVE on the registry at 0.15.4 (measured 2026-10-25)": deliberately untouched per the brief (captain updates after publish).
- The 2000- vs 2048-byte reading of "2 KB": both readings put the file over the guidance; the exact number does not change the decision.
- Whether a captain amendment authorised the no-trim: I report the bytes and the rule state, not the intent — I did not see the amendment message.
- `docs/plan-webui-tui-i18n.md`'s date change 2026-10-25 → 2026-10-26: verified against the pack's real version and mtime, so it is a correction, not a rewrite.

## Bounds

- I did **not** run the workflow, stage or publish anything, and the npm registry is unreachable from this sandbox — so I verified the docs against the workflow SOURCE and its own measured comments, not against a live npm.
- I did not see the captain's amendment message referenced by T10's report.
- I did not re-run the wider release sweep (manifest/rows/dist/pack/tests): this delta is prose plus one workflow comment, and the three gates T11 named are the ones that cover it; the tree's other invariants were blessed in T7/T9 and this wave touches no pin, code or pack.
- No host boot, no Docker.

## Verdict

**BLESS the runbook sync.** All five items are factually correct, the bilingual pairs are in step, the workflow description matches the real lane step for step with nothing invented, and the three named gates are green. The one Medium is the manual's byte margin — a captain decision that predates this wave, with the file demonstrably untruncated at 1378 B of headroom.
