# fv5 field-exposure changelog (`gap-r2.json` / `gap-verdict-table-r2.md`)

Generated 2026-09-13T15:01:51.284Z · supersedes fv4 `gap.json` 82509 B / sha256 `cade32a6ae0346bf0e01aa96fd8b28d7ab8a0167ee6f94529e1511be971ce067`

## 1. What this revision adds (per (row, class) and per row)

- `rows[].fv5.classEvidence`: for every class in the frozen `upstreamHarnessCoupling` list, the matched fragments with line numbers and an `evidenceQuality` of `mechanism` or `prose`.
- `rows[].fv5.booleans`: `harnessSeamChange`, `binaryDependency`, `credentialDependency` as `{value, basis, evidence[], falsePositiveRisk}` (record-only).
- `derivationTable`: the full 10-row table (classes, seam/bin/cred, counted booleans, D3 under BOTH calibers).
- `waveGoalMapping`, `userApprovedOverrides`, `authoritativeRuleInput` (verbatim rule text + read-time hash) and `ruleConflict-D3`.
- Anchors for the affected rows refreshed to the settled tree: D1, D8, T3-01..T3-08.

## 2. Rule-text corrections adopted from this producer's findings

- **(A) no raw-less row**: the record for `skills-loader-core/security-research` exists (its `name` field is empty, so name-based lookups miss it — look it up by PATH). The on-disk text now states raw covers all ten rows and there is no unknown fallback.
- **(B) token sums are never used for D3** (boolean count instead): the on-disk text cites this producer's measurements (`git-master` count 0 vs sum 3; `mass-ulw` count 1 vs sum 36).
- **(C) prose exclusion made self-consistent**: `dev-browser` / `frontend` get `harnessSeamChange = false` with `evidenceQuality: prose` (positive finding: no mechanism hit), not `unknown`.
- **V4 tightened** to `(dagRunId ∧ mechanism) ∨ (envKeyOmo ∧ workflowTool ∧ mechanism)`, so the prose hits no longer produce a false veto.

## 3. Producer self-corrections (kept for later verifiers)

- **Self-correction 1 (raw lookup key)**: an earlier boolean preview looked records up with a key missing the `/SKILL.md` suffix; the lookup failed silently and three `.agents/skills/*` rows were falsely reported as false/false/false with "no hits". Corrected values carry matched fragments. This is why every boolean here cites a fragment + line.
- **Self-correction 2 (class-vocabulary mismatch)**: an earlier HARD/SOFT mapping (from a captain message) named six classes that do not exist in the data (`credential`, `binaryDependency`, `dagSdk`, `rpcOmoDag`, `tuiDag`, `skillsLoader`) and omitted four that do (`binaries`, `creds`, `omoDir`, `teamTools`). The mapping was rewritten against the real 11-class vocabulary.
- **Case-sensitivity note**: the frozen class derivation is case-sensitive for the seam/annotation classes, while `creds`/`binaries` were matched case-insensitively. Consequence: `skills-loader-core/git-master` contains uppercase "RESET WORKFLOW" / "Autosquash Workflow" that never entered the `workflowTool` class — that is the checkable reason git-master is not a V4 hit. Re-deriving with `/i` would produce a DIFFERENT class set and is non-compliant.

## 4. Data change: `replacement.status` (before → after)

- `skills-loader-core/frontend`: `equivalent` → `partial-equivalent`. Same-caliber numbers: local `skills/frontend` 151 lines / 28 files vs upstream shared-skills 29 files (incl. `+references/design/ambience-skill.md`); the builtin is a separate single-file packaging (154 lines / 1 file). Loss narrative: 0 → content-refresh increment. Action unchanged (skip).
- `skills-loader-core/git-master`: `equivalent` → `partial-equivalent`. Local 104 lines / 2 files vs upstream builtin 1107 lines / 1 file. Loss narrative: 0 → content-refresh increment. Action unchanged (skip).

## 5. Wording corrections

- Top dual-write wording replaced to match disk: both same-hash contract copies are retained; no directory is described as deleted.
- X4 rewritten: the terminal record points at the contract's old path, which is now occupied by the same-hash dual-write copy — not a deletion.

## 6. Pointer (approved): t8's table also carries anchor drift

- `skills-gates/verdict-table.md` (t8) has 4 stale local anchors; 2 of its mappings were corrected by measurement (`presets/mpd/agent.cordis.yml:146-153 → :161-165`, `:349-355 → :365-366` verify; its `index.js:107 → :122` VERIFIES for the object it cites (the captain’s guidance item 5, now at `:122`; `:107` is the `autoRoute:` line and the schema block is `:105-113`, so the two objects must be recorded separately), and its `tools.js:1907 → :1924` was correct at its measurement time but the settled tree registers `agent_teams_resume` at `:2087` (t15 edited `tools.js` afterwards — re-anchor by SYMBOL, never by a remembered line)). Its refresh belongs to a t8 supplement task; **this revision does not edit t8's files**.

## 7. Rule conflict recorded and RESOLVED

- RESOLVED: the GO adopts the on-disk (b) formula (`D3 = 1 + counted`, clamp [0,3]); the earlier `count` wording is superseded. Both calibers remain in the derivation table, and the gate recomputes — no remembered total is quoted.

## 7a. Final D3 form and the git-master interpretation registration

- D3 final form: `D3 = 1 + (counted TRUE seam booleans)`, clamped [0,3] (baseline 1). It is NOT a plain TRUE-count and NOT `T + B`; those earlier wordings are superseded (ruleConflict-D3 = RESOLVED).
- git-master `binaryDependency`: REGISTERED INTERPRETATION. The contract's (b) parenthetical counts 0; the rule's literal definition read alone could count 1 (SKILL.md has `make` + 16 bash blocks). The rule's own worked values settle it FALSE — those blocks are teaching examples and nothing must be installed to PORT the skill — so this artifact lands `false` (with `topicallyExcluded: true`) and records the interpretive choice rather than presenting it as the only possible conclusion.

## 7b. Environment-prerequisite annotations added

Every `binaryDependency = true` row now carries `environmentPrerequisite` (e.g. remove-deadcode: needs bun; dev-browser: needs npm / needs npx-node / ships a script entrypoint; frontend: needs uv / needs python3). These are gate annotations only and never score.

## 8. Self-validation iterations (classifier defects caught by this producer's own post-build checks)

The boolean derivation was hardened across builds. Every defective intermediate is kept immutable under `revisions/` and is **not** citable as the delivered revision:

| build | defect | symptom in the data | fix |
|---|---|---|---|
| `fv5` | line-level mechanism classifier | a backticked filename elsewhere on the line promoted the prose word "workflow" to mechanism => `skills-loader-core/frontend` seam wrongly `true` | per-MATCH classification (inline code / fence / call / env / tool path) |
| `fv5.1` | executable-command detector too loose | module-path mentions (`sdk.js`, `errors/shopify_error.py`) and prose ("node prompt") counted => `dag-library`/`mass-ulw`/`git-master` bin wrongly `true` | command position + code context required |
| `fv5.2` | noun/runtime ambiguity for `node` | mass-ulw prose "node completions" matched the runtime | `node` requires a flag or path argument |
| `fv5.3` | wrapper-call regex allowed a bare segment start | mass-ulw bin still wrongly `true` | wrapper call requires an actual `(`/quote before the runtime |
| `fv5.4`-`fv5.6` | data correct; iteration bookkeeping / changelog layout only | none in the data | tag + status generated from one TAG constant |
| **`fv5.15`** | **delivered** | derivation matches the GO expectations: seam in {security-research, loader-core/security-research, dag-library, mass-ulw}; bin in {remove-deadcode, tech-debt-audit, dag-library, mass-ulw, dev-browser, frontend} (bin set per `gap-r2.json.derivationTable`; the 4-row form seen in fv5.1–fv5.13 was fixed in `fv5.14`); credentialDependency unknown x4 | — |

- Delivered artefact hashes are recorded in `REVISIONS.md` and in `revisions/fv5.15-<UTCstamp>/manifest.json`.

