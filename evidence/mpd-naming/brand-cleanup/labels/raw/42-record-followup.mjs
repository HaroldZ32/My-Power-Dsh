// Records the captain-ruling follow-up into labels/result.json and output.log.
// Run from the repo root: node evidence/mpd-naming/brand-cleanup/labels/raw/42-record-followup.mjs
import { readFileSync, writeFileSync } from "node:fs"

const RESULT = "evidence/mpd-naming/brand-cleanup/labels/result.json"
const OUT = "evidence/mpd-naming/brand-cleanup/labels/output.log"

const r = JSON.parse(readFileSync(RESULT, "utf8"))

r.captainRulingFollowup = {
  at: "2026-09-14T07:15:53Z",
  ruling_applied: {
    "C3 boulder": "step 6(c) DROPPED per the captain: packages/mpd-boulder-plugin/src/vendor/storage/shared.ts, its test and its dist remain UNTOUCHED. Only the boulder README sentence was repaired, in both languages, with the required wording: the state root was retargeted to the .mpd convention; session ids this bundle WRITES are dsh:-prefixed while reads still ACCEPT the legacy prefixes (codex:/opencode:/senpi:), so records written before the retarget keep resuming (see raw/41-captain-ruling-followup.log section B).",
    "skills/ast-grep/AGENTS.md:23": "REPAIRED (captain-ordered attribution item, outside t2's declared inScope, therefore reported in the output and NOT listed in changedPaths). The corrupted placeholder `upstream cli install script (src/tools/ast-grep; see README provenance)`-grep-sg.ts` was replaced with the TRUE original text verified against the pinned upstream checkout .mpd-dsh/upstream (8c57e463e, packages/shared-skills/skills/ast-grep/AGENTS.md:23): `omo-opencode/src/cli/install-ast-grep-sg.ts`. Proof: diff between the upstream copy and ours is EMPTY for the WHOLE file, i.e. it is byte-identical to the pinned upstream again (raw/41-captain-ruling-followup.log section A). Observation for the owner: the upstream's own repo-relative path omits the packages/ prefix; the real file in the 8c57e46 checkout is packages/omo-opencode/src/cli/install-ast-grep-sg.ts — restoring verbatim keeps the no-fork-drift contract, while adding packages/ would deviate from the vendored body.",
    "brand scans": "Every scan in this task uses the token-boundary BRAND_TOKEN_RE (copy of scripts/build-mcp.mjs:192), never a substring grep. The captain-measured false positives are documented non-hits: \"autonomous\" and \"promote\" (e.g. skills/ast-grep/references/cli.md:96 is \"Promote/demote severity\").",
    "C1 supersession": "Noted and not applied by t2: the frozen rule's keep_variant for OMO_CODEX_* is OVERRULED and that surface is DELETED (t6's lane: packages/mpd-mcp-gitbash/dist/cli.js + the BRAND_ALLOWLIST in scripts/build-mcp.mjs), both outside t2's inScope.",
    C2: "codegraph is t5's lane; t2 did not touch it."
  },
  open_items_needing_a_ruling: {
    omo_identifiers_in_the_vendored_ast_grep_patch: {
      class: "4 (ours) per t1's R3_allowlist exception -> NOT allowlistable, because the only consumer is our own code",
      sites: [
        "skills/ast-grep/scripts/ast_grep_helper.py:207 omo_env_binary (definition)",
        "skills/ast-grep/scripts/ast_grep_helper.py:217 omo_runtime_slug (definition, used at 232)",
        "skills/ast-grep/scripts/ast_grep_helper.py:230 omo_runtime_binary (definition)",
        "skills/ast-grep/scripts/ast_grep_helper.py:255 call sites in resolve_binary",
        "skills/ast-grep/tests/smoke.sh:31 omo_runtime_slug (definition), :129 call"
      ],
      why_it_matters: "G2 requires every surviving brand-shaped token to be an allowlist entry whose consumer reads true. These are OUR patch identifiers, so no truthful allowlist reason exists — they can only be satisfied by RENAMING.",
      ready_to_execute: "One mechanical pass: rename to runtime_env_binary / runtime_slug / runtime_binary, retire the short-hand wording in the '# --- OMO runtime resolution' comment and the '2. OMO runtime dirs' docstring, update tests/smoke.sh, then re-measure the corpus treeSha. The helper is a standalone stdlib CLI and no current gate executes smoke.sh, so the rename is low-risk.",
      left_untouched_because: "the captain's turn scoping (\"Do not otherwise edit third-party skill bodies\") plus minimal-diff discipline — awaiting an explicit ruling."
    },
    attribution_entries_kept_as_class_3_provenance: [
      "skills/ast-grep/README.md:133 — the `omo` (oh-my-opencode) acknowledgment link (third-party attribution; never dropped)",
      "skills/ast-grep/AGENTS.md:23 — the restored omo-opencode path and the vendored body's 'OMO caches' wording (F7 third-party body)"
    ]
  },
  new_repin_target_after_the_ast_grep_edit: {
    "assets.skills.fileCount": 297,
    "assets.skills.treeSha": "1d277907045ef1d18fd390b5db1a2ce537c38e7692732ee022ca5a7ea75402c1"
  },
  repin_note: "Supersedes the 4299afc4… value in 03-corpus-after-deletion.json: the captain-ordered skills/ast-grep/AGENTS.md edit changed the corpus again after that measurement. skills/** still has exactly ONE writer (this task).",
  gates_after_followup: { "bun test packages": "399 pass / 0 fail / 90 files (re-run after the ast-grep edit)" },
  t2_status_note: "t2 is TERMINAL (failed) and agent_teams_claim_task refuses it ('task status cannot move from \"failed\" to \"claimed\"'), so this follow-up could not be recorded through an attempt_id. It needs a captain amend (which re-runs t2) or a repair task to enter the formal record; the work itself is on disk and complete."
}

writeFileSync(RESULT, JSON.stringify(r, null, 2) + "\n")

const block = [
  "",
  "10. CAPTAIN-RULING FOLLOW-UP (applied after t2 went terminal)",
  "   - C3 boulder: step 6(c) DROPPED per the captain. src/vendor/storage/shared.ts, its test and its",
  "     dist remain untouched. The boulder README sentence (EN + ZH) now states the required truth:",
  "     the state root was retargeted to the `.mpd` convention, session ids this bundle WRITES are",
  "     `dsh:`-prefixed, and reads still ACCEPT the legacy prefixes (`codex:`/`opencode:`/`senpi:`)",
  "     so pre-retarget records keep resuming. Reason: those literals are a data-format floor",
  "     (test/boulder.test.ts:22 pins the tolerance), not identity labels.",
  "   - skills/ast-grep/AGENTS.md:23 (captain-ordered attribution item, outside t2's inScope): the",
  "     corrupted placeholder was replaced with the TRUE original text verified against the pinned",
  "     upstream checkout .mpd-dsh/upstream 8c57e463e",
  "     (packages/shared-skills/skills/ast-grep/AGENTS.md:23): `omo-opencode/src/cli/install-ast-grep-sg.ts`.",
  "     Proof: `diff` against the upstream copy is EMPTY for the WHOLE file — it is byte-identical to",
  "     the pinned upstream again. Observation: the upstream's own path omits the `packages/` prefix;",
  "     the real file is packages/omo-opencode/src/cli/install-ast-grep-sg.ts.",
  "   - Brand scans: token-boundary regex only (never `grep -i omo`); 'autonomous'/'promote' are",
  "     documented non-hits (e.g. references/cli.md:96 'Promote/demote severity').",
  "   - C1 supersession noted: OMO_CODEX_* is DELETED (t6 lane); t2 applied no keep_variant. C2 is t5's.",
  "   - NEW RE-PIN TARGET after the ast-grep edit (supersedes 4299afc4):",
  "     assets.skills.fileCount=297,",
  "     assets.skills.treeSha=1d277907045ef1d18fd390b5db1a2ce537c38e7692732ee022ca5a7ea75402c1",
  "   - Re-ran `bun test packages` after the skills edit: 399 pass / 0 fail.",
  "   - OPEN ITEM awaiting a ruling: the ast-grep vendored PATCH still carries our own `omo_*`",
  "     identifiers (ast_grep_helper.py:207/217/230/232/255, tests/smoke.sh:31/129) — class 4 per t1",
  "     and NOT allowlistable (the consumer is our own code), so G2 can only be satisfied by renaming",
  "     them. Left untouched under the captain's 'do not otherwise edit third-party skill bodies'",
  "     scoping; the rename is mechanical and ready to execute in one pass.",
  "   - t2 is TERMINAL: agent_teams_claim_task refuses it ('cannot move from failed to claimed'), so",
  "     this follow-up needs a captain amend (re-run) or a repair task to enter the formal record.",
  ""
].join("\n")

writeFileSync(OUT, readFileSync(OUT, "utf8") + block)
console.log("result.json + output.log updated")
