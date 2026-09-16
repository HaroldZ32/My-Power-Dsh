# t12 attempt 2 — independent verification of the repaired documentation set

Verifier: Lead. Task `t12` (verification), attempt 2, attempt_id `485548c3-7daf-4d73-8c14-b6fb05f34312`.
Evidence root: `evidence/extensions/verify-docs/20260916T070544Z/` (the only path this task wrote).

## Verdict

**PASS — 7/7 acceptance criteria, 0 findings.** All three findings from attempt 1 are verified fixed,
every citation now resolves to content that carries the cited symbol, and every other check is
unchanged and green. Four observations are recorded below; none requires an edit.

Fresh coverage, as required by the reassignment: attempt 1's terminal verdict was NOT reused. The docs
were repaired twice since (t21's symbol anchoring, t25's closure of t16's findings) and the whole
battery was re-run against the repaired text.

## Revision the verdict is anchored to

`git rev-parse --abbrev-ref HEAD` → **dev**; `git rev-parse HEAD` → **1f38e3c1b8149cecc68f54fae1979f56e1ff2b0f**.
Pinned 07:09:13Z, re-checked after 50 s with no hash movement (`raw/hashes-final.txt`, `raw/hashes-settle.txt`).

| Artifact | sha256 |
|---|---|
| `docs/extension-authoring-guide.md` | `f8f771e83790f17998e5ba39ba0e0070bca21e706e28a48c4df3b8bf297887ce` |
| `docs/extension-authoring-guide.zh-CN.md` | `07f7f9ff6b20739070beb9996222cf954614daa1cf2a0dd2c72fa470d457da68` |
| `EXTENSIONS-FOR-AGENTS.md` | `9a34622cc2843eddc10bcda810efbfa027f676dfa32108ff92d504e2985edf18` |
| `docs/extension-adaptation-report.md` | `ed903aaf42a39a189694f0cd14d9391040ccc528465a70c1b1c28e7d27dccb5f` |
| `docs/extension-adaptation-report.zh-CN.md` | `34daae0118897dbdbe4ae7455d8e6155863a92a8fcfc90f6ab8168e049a764e8` |
| `README.md` / `README.zh-CN.md` | `8367a10e8cb938ee8b689df2259a85c38992fb1b373f78985a32e86612fe3718` / `4cbda5db79aa17dfa74671604afc74878237d11870ed8517a2092d7f96807a03` |
| `docs/index.md` / `docs/index.zh-CN.md` | `f90ea958bf11b0532ff9efd5a7eb92a2647239b460e6e8c1520f614ec081df81` / `f8715202b4182f0e2ef8a30c3a3f29f83d036ccdb44adee9f3e91df366ea3b93` |
| `packages/mpd-ext-plugin/src/index.ts` (anchor target) | `dd3bdd00579d8d7aa56a70cb18af6a0bfd4ce3bae400c730d0f35bc40f662ec0` |
| `packages/mpd-roles-plugin/src/index.ts` (anchor target) | `9a54bf7d6620a2d437ebafd15bda5f7592e9e1cce2d997fe2c6170a71d6ab18c` |
| `VENDOR_LOCK.json` | `6b65176a935f573eaf4c9766c9a42d6ad3c48d3fc4d5e6a0797bade6992449ff` |
| `scripts/mpd-ext.mjs` | `60d7901245381d9874094604de4b05b9d8c07b14f766b8adb8a8a40eea2618af` |
| `skills/dsh-qa/scripts/extension-lifecycle.mjs` | `f8a4af525f4b86591b913390c2e008f9f6b32bef8e6193b6f70dca74407a0ac2` |
| `skills/dsh-qa/scripts/extension-mcp-bridge.mjs` | `42cfd27d731d14663e4cd65ba9c665241e2767700c5057bc6e1afbc408c89a87` |
| `skills/dsh-qa/scripts/extension-template.mjs` | `42a46bf16b766d2d909fb1fec989b9544722a868a6af991729f6afed2467336c` |
| `package.json` | `ea608ea2b39b2c9494a2d741bb2bcbf669a304830b6ba75713d8f8f3f719d723` |

The anchor-target sources are byte-identical to the revision attempt 1 measured
(`index.ts` `dd3bdd00…`, `roles/index.ts` `9a54bf7d…`), so the repair is a pure documentation change.

## Attempt-1 findings — all verified fixed

| Finding | Was | Now (settled revision, `index.ts` `dd3bdd00…`) | Check |
|---|---|---|---|
| F-t12-1 (medium) | `EXTENSIONS-FOR-AGENTS.md:22` cited `:701/:793/:916/:970`, four empty lines | path once + wrapper `:537` and all four `name:` lines `:715`, `:807`, `:930`, `:984`, plus the gated list `EXPECTED_TOOLS` `:548` | all six resolve to the exact declarations (`raw/anchor-sweep3.txt`) |
| F-t12-2 (low) | guide `:75`/zh `:66` cited `641-658`; guide `:104` cited `1041-1053` | `:659` (`redactedDescriptor`) and `:1062` (`connectExtensionMcpServers`) | 41/41 semantic samples pass |
| F-t12-3 (low) | report §12 F1 cited `59-95` for "note plus `resolveAdapter`" | note/anchor `:59` and `resolveAdapter` `:102`, separately | both samples pass |
| O-t12-1 (attempt 1) | `mcp.ts:34` cited for the state vocabulary, tail type at `:42` | guide and report now cite `mcp.ts:42` (`stderrTail`); the AI doc still cites `:34` for the vocabulary — both correct | samples pass |

## Method and results

1. **Doc-pair parity** — `node scripts/verify-docs-parity.mjs` exit 0, `pairs=36 failed=0 violations=0 exempt=16`,
   with the guide pair printed as `ok   docs/extension-authoring-guide.md` and **zero exemption lines
   mentioning it** (`raw/gate-docs-parity.txt`, `raw/parity-controls.txt`). Falsifiability controls via
   `--root <tmp>`: zh twin deleted → exit 1 `missing zh-CN file`; switch link deleted → exit 1
   `EN switch link missing/not under the title`; faithful copy → exit 0.
2. **Citations** — the author's checker (current revision, sha256 `471aec42…`) re-run by the verifier:
   **15/15 checks, 219 citations resolved, 0 pending**, including its t21 CONTENT claims and negative
   control (`raw/author-checker.txt`). On top of that, my independent re-implementation scanned every
   in-scope anchor and hand-checked a semantic sample of 41: `56 live line-anchor citations, 0 flagged`;
   `41 hand-picked anchors, 0 mismatches` (`raw/anchor-sweep3.txt`, `raw/independent-run.txt`,
   `independent-result.json`, `samples.json`). The scan handles cross-line continuation anchors and
   flags missing / out-of-range / blank anchors; it records quoted-historical tokens separately (O-1).
3. **Links + heading anchors** — 112 relative links across `README.md`, `README.zh-CN.md`,
   `docs/index.md`, `docs/index.zh-CN.md`, the guide pair and the AI doc; 6 with anchors; **0 unresolved**
   (README/index are byte-identical to attempt 1's revision, so the previously verified link set is
   unchanged and re-verified here).
4. **Report status vs reality** — every "fixed" row now resolves to a real artifact whose recorded
   facts match the row's wording:
   - F1/F5 → `evidence/extensions/f1-adapter-identity/20260916T061318Z/result.json`; anchors `:102`/`:59`.
   - F7 → `evidence/extensions/debranding-probe/20260916T061807Z/verify-debranding-full.mjs` exists.
   - F11 → `evidence/extensions/pack-closure-check/20260916T061527Z/result.json` + `scripts/verify-pack-closure.mjs`.
   - F8 → no `greenOwner` token remains in `extension-lifecycle.mjs` (the narration is gone).
   - F9 → `extension-lifecycle/2026-09-16T06-31-40.371Z/result.json`: `steps.packed.negativeControl`
     `falsifiable: true`, `packerExitGated: true`, the three broken fixture trees `ok: false`, the closed
     tree `ok: true` — exactly what the row claims.
   - F10 → `extension-mcp-bridge/2026-09-16T06-31-25.127Z/result.json`: `steps.stderr` `cap 2000`,
     `floodLength 3053`, `reportedTailLength 2000`, `headDropped true`, `tailKept true`, `vacuous false`.
   - The "all three lanes re-run and re-read by the wave's verification task" claim →
     `evidence/extensions/verify-skills/20260916T064350Z/` exists with `result.json` and six verifier scripts.
   - The template-lane claim → `extension-template/2026-09-16T06-31-12.171Z/result.json` `ok: true`, arms
     skill/flow/role/mcp/containment.
   - The VENDOR_LOCK paragraph now states the AFTER value and is true: `318` /
     `a8ba96b8108b2df3cce707e7b69d038f71514cea9e0c488683ba79012efc8d12`; `node scripts/verify-vendor.mjs` exit 0.
   - The new measured deviation is disclosed, not hidden: the pre-`c239407` dirs are still absent from
     the change set (F6 deferred), and the packed-tree CLI claim resolves to
     `evidence/extensions/template-scaffold/20260916T063710Z/raw/packed-tree-probe.json` (arms A/B,
     `validate` exit 1 as packed) and to `.mpd/TODO.md` **T-51** (line 268) — described as NOT fixed.
5. **Skeleton + walkthrough** — the AI doc's `for-agents-skeleton` block, extracted independently and
   materialized next to the template's four assets: `mpd-ext validate` exit 0, four kinds; NEGATIVE
   control (declared persona deleted) exit 1 `2 problem(s) — this extension would not load`. The guide's
   §5 walkthrough runs verbatim with a sandboxed `HOME`/cwd: default scaffold exit 0 (three kinds),
   `validate` exit 0 `loadable`, `list` exit 0, `cp -r` arm exit 0, `--with-mcp` arm exit 0 and the
   host-free server answers `tools/list`; the AI doc's §6 worked copy exits 0 in both planes. The one
   non-zero step is the server smoke against the DEFAULT copy, whose `server.mjs` §5 itself documents as
   dropped without `--with-mcp`. The two cheap gate commands also run: `bun scripts/mpd-ext.mjs --self-test`
   exit 0 (52 checks) and `bun test packages/mpd-ext-plugin` exit 0 (**74 pass / 0 fail**). The three
   LIVE lanes were not re-executed here because their case scripts write their own evidence outside this
   task's inScope; their recorded runs are verified by reading the result JSONs under §4.
6. **Structural split** — tested, not asserted: 20 machine headings vs 27 human headings, 0 shared;
   17 machine paragraphs (>= 80 normalised chars) vs 27 human, 0 duplicated. The comparator's
   falsifiability was proven in attempt 1 (`controls.mjs`: guide-vs-guide reports 25 shared paragraphs;
   an invented anchor is rejected; the four real anchors incl. the CJK slug resolve).
7. **Evidence record** — this directory; commands, exit codes and raw readings below.

## Observations (no edit required)

- **O-1 (quote-aware scanners).** `docs/extension-adaptation-report.md:381` and the zh twin `:185` quote
  the RETIRED citation form `exits 0 (`:385`)` when describing what `skills/dsh-qa/SKILL.md` no longer
  says. `SKILL.md` is 138 lines, so a naive scanner that attaches a bare `:NNN` to the preceding path
  reports it as out of range. The sentence explicitly frames it as the old wording ("instead of the
  old …" / "不再写旧的"), so it is a quotation, not a live citation; the current author checker does not
  extract it. Recorded so the classification is on the record; suggest leaving it as is.
- **O-2 (my own rule's false positives).** Four unattributed continuations: `:1` twice, from the JSON
  literal `"id":1` inside the fenced server-smoke command (guide EN:167 / ZH:148), and `:58` twice, from
  the labelled hint `(hint `:58-92`)` on the report's F1 row (EN:376 / ZH:180). The hint is correct: the
  canonical note spans index.ts 58-92. No doc change needed.
- **O-3 (continuation anchors wrap).** The AI doc's four tool anchors are written as one path plus
  wrapping continuations (`:715`, `:807` on line 23 and `:930`, `:984` on line 24). They are correct at
  the settled revision, but a scanner that only handles same-line continuations sees two of the four;
  the current t21 checker resolves them (219 citations, 15/15).
- **O-4 (§6 vs §12 register).** §6 still carries `F8 (low, WAIVED this wave)` / `F9 (low, same waiver
  family)` while §12 marks them fixed. §12's preamble states the §6 register "is left unchanged on
  purpose — it is this audit's own record of what it found". Intended, not drift (matches the t26 review
  note carried to t17 as an observation).
- **O-5 (author-checker side effect, handled).** The checker writes `result.json` / `output.log` /
  `raw/` next to itself. It was therefore COPIED to `evidence/extensions/verify-docs/author-check-citations2.mjs`
  before running, so `evidence/extensions/docs-claims/` was not rewritten by this task (its newest write,
  15:05:13, is another seat's; my run's outputs are at 15:08:01 inside this directory).

## Scope discipline

Only `evidence/extensions/verify-docs/` was written. No repo file was edited. The walkthrough ran with a
sandbox `HOME` and a sandbox cwd and did not create `<repo>/.mpd/extensions`. `git status --porcelain`
shows no new untracked path outside this evidence directory from t12.

## Evidence inventory

- `raw/`: `gate-docs-parity.txt`, `parity-controls.txt`, `gate-verify-vendor.txt`, `gate-bun-test-ext.txt`,
  `anchor-sweep3.txt`, `independent-run.txt`, `author-checker.txt`, `walkthrough.txt`,
  `status-f8f9f10.txt`, `status-rest.txt`, `hashes-final.txt`, `hashes-settle.txt`.
- Machine-readable: `independent-result.json` (hashes, links, citations, semantics, split, skeleton,
  checks), `anchor-sweep3.json`, `author-checker-result.json`.
- Scripts: `verify-docs-independent3.mjs`, `anchor-sweep3.mjs`, `samples.json`, `walkthrough.sh`,
  `controls.mjs` (carried from attempt 1, still the split/anchor control).
