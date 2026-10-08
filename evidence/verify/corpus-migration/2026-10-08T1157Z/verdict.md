# Corpus migration verdict — `skills/**` + `VENDOR_LOCK.json`

**VERDICT: PASS.** The corpus carries zero upstream-id-in-roster-tool-argument occurrences; the
substitution did not over-reach; the single re-pin is one field and moves with its cause. Two
non-blocking findings and the declared bounds are below — none of them blocks the wave.

- **Loop:** `loop-20261008T115413-cc1637` (verifier `4ee18be6-5798-4395-8b9b-8bbd53e1c873`; scope
  `skills/**` + `VENDOR_LOCK.json`).
- **Frozen contract:** `.mpd/plans/roster-id-gate-scope.md` (§5 is this lane; §3 is the accepted-name
  mapping, §7 the out-of-scope list).
- **Verification moment:** 2026-10-08T11:55–11:58Z. Subject revision = the WORKING TREE (unstaged; see
  bound 1).
- **Raw black-box log (durable anchor):** `evidence/verify/corpus-migration/2026-10-08T1157Z/scans.log`
  — every command quoted below was re-run into that file by this seat.

---

## 1. COMPLETENESS — confirmed: zero id-in-roster-tool-argument occurrences remain

**Scan A — an upstream id as the VALUE of a `role`/`base` assignment, whole corpus:**

```
$ grep -rnE "(role|base)[[:space:]]*[:=][[:space:]]*[\"']?(oracle|librarian|prometheus|hephaestus|sisyphus-junior|sisyphus|atlas|explore|metis|momus|multimodal-looker)[\"']?" skills/
NONE
```

**Scan B — multi-line-aware: any id within 300 chars AFTER a roster tool name** (`mpd_role_spawn`,
`mpd_role_persona`, `mpd_workmate_init`, `mpd_workmate_spawn`, `mpd_modelchain_resolve`), which is the
shape a line-based grep would miss: **7 hits, all 7 classified as NOT argument positions** —

| Hit | What the id actually is |
|---|---|
| `02-investigate.md:66` | the English word "explore/deep" in prose on the same window; the call reads `role="Architect"` |
| `refactor/SKILL.md:669`, `:701` | the backticked persona labels in prose ("the `hephaestus` role persona", "If the `oracle` role is unavailable"); the calls read `role=Architect` / `role="Plan Reviewer"` |
| `visual-qa/SKILL.md:107`, `:115`, `:166`, `:273` | `subagent(description="oracle", …)` — a harness LABEL; the roster call reads `role=Architect` |

Every modified call site now carries a NAME. The substitutions are exactly `role="<id>"` →
`role="<NAME>"`, visible in the diff (e.g. `02-investigate.md:48`
`mpd_role_persona(role="hephaestus")` → `role="Deep Worker"`, and the same pattern across
`visual-qa` ×5, `refactor` ×11).

**Occurrences the contract's itemised list does NOT name** (reported as required by this card; each is
classified and none is a roster argument):

1. `skills/visual-qa/SKILL.md:107,118,169,276` — `subagent(description="oracle", …)`. The contract
   declares this class (a subagent LABEL) only for `04-oracle-triple.md` / `partial-runtime-evidence.md`;
   the same class also lives here, unlisted.
2. `skills/review-work/SKILL.md:12,14,140,331,407` — `subagent(description="oracle", …)` and the Codex
   `"agent_type":"librarian"` cell (that column belongs to a DIFFERENT harness's call shape).
3. `skills/debugging/references/methodology/02-investigate.md:73,76` — `subagent(description="explore", …)`.
4. `skills/ulw-plan/references/full-workflow.md:59,82,183,190,191` — a JSON plan-state SCHEMA
   (`"review": { "momus": {…} }`), `"independent_reviewer": "oracle"`, `lanes: ["momus","independent"]`.
   This file is NOT in the contract's 8-file table and was NOT modified.
5. `skills/refactor/SKILL.md:658,706,730` — backticked persona labels in prose ("Do not put verifier
   roles (`oracle` / `momus`) or `librarian` into the team roster").
6. `skills/dsh-qa/scripts/tui-panels.ts:467` — `base: "explorer"`: a lowercase functional-NAME spelling,
   **not** an id (the id is `explore`, the name is `Explorer`), and the README makes matching
   case/separator-insensitive.

## 2. NO OVER-REACH — confirmed: the deliberate non-changes are intact

| Deliberate non-change (contract §5) | State in the tree |
|---|---|
| `description="oracle"` labels in `04-oracle-triple.md` / `partial-runtime-evidence.md` | files NOT modified; `"oracle"` still at `04-oracle-triple.md:40,54,70` and `partial-runtime-evidence.md:161` |
| `preset-register.ts` reading the roster table's internal `"id"` VALUES | file NOT modified; `"oracle"`/`"multimodal-looker"` still at `:135` |
| narrative uses in `frontend` / `software-smoke` | neither file is in `git diff --name-only` |
| `librarian` / `explore` role words in `ulw-research`'s prose | still present at `ulw-research/SKILL.md:175` (`description="explore"`) and `:191` (`description="librarian"`) |

`git diff --numstat` shows line-paired replacements only (`7/7`, `11/11`, `5/5`, `3/3`, `2/2`, `1/1` …);
the single non-1:1 hunk is the declared doc-comment GENERALISATION in `workmate-library.ts` (4/3),
which removes the id from prose rather than re-pointing a call.

**Finding 1 (LOW, non-blocking) — the contract's status block under-counts its own edit.**
Measured: id occurrences in the 8 corpus files fell **105 → 61 across the 11 modified skills paths
(44 removed; 40 of them in the 8 corpus files)** — per file: refactor 11, ulw-plan 8, 02-investigate 7,
visual-qa 5, review-work 4, ulw-research 3, init-deep 1, remove-ai-slops 1. §5:103 declares
"31 tool-argument occurrences … then 7 prose mentions" (= 38). The DIRECTION is identical
(id → NAME) and the end state is stricter than declared, so this is a status-block imprecision, not a
defect: no change in the diff goes anywhere except from an id to a role name.

## 3. THE SINGLE RE-PIN — confirmed, one field, with a commit-time caveat

```
$ git diff VENDOR_LOCK.json
-      "treeSha": "73a7311adfe2240cb742a21f5d3a53400210a03a9672f106bf273953198d356d"
+      "treeSha": "7db998a5003ea819896ab016ec13360cae7db18641be298cdc13e33cac4d531f"
```

Exactly one line changed (`skills.treeSha`); `fileCount: 331` unchanged; `VENDOR_LOCK.json | 1 +1 -1`.

```
$ git diff --numstat -- skills/ VENDOR_LOCK.json
1  1  VENDOR_LOCK.json
7  7  skills/debugging/references/methodology/02-investigate.md
2  2  skills/dsh-qa/scripts/readonly-deny.ts
1  1  skills/dsh-qa/scripts/web-client-adapt.ts
4  3  skills/dsh-qa/scripts/workmate-library.ts
1  1  skills/init-deep/SKILL.md
11 11 skills/refactor/SKILL.md
1  1  skills/remove-ai-slops/SKILL.md
3  3  skills/review-work/SKILL.md
2  2  skills/ulw-plan/SKILL.md
2  2  skills/ulw-research/SKILL.md
5  5  skills/visual-qa/SKILL.md
```

The 11 skills paths are EXACTLY §5's list (8 corpus files + `readonly-deny.ts`, `web-client-adapt.ts`,
`workmate-library.ts`) — **no skills path outside the contract's list was touched.**

`mpd_verify_evidence {kind:"gate", gate:"vendor"}` → **exit 0**, evidence id
`ev-20261008T115556-b76b6a`: the re-pinned `treeSha` matches the corpus bytes on disk.

## 4. THE PRE-EXISTING FIX'S DIRECTION — TOWARD the product contract

The product's own contract (`packages/mpd-workmate-plugin/README.md:52-60`, "Base resolution and
auto-naming (functional NAME only)") states verbatim:

> `mpd_workmate_init`'s `base` is the specialist's **functional NAME** — the name `mpd_roles_list` /
> `mpd_role_persona` use, e.g. `Deep Worker`. … A roster **id** (`hephaestus`, `sisyphus-junior`, …)
> is INTERNAL provenance and is **not** a base key: it is refused like any other unknown key, and the
> refusal deliberately does not echo the rejected key.

The README names `hephaestus` itself as the refused-key example, so the direction is read off the
contract, not asserted: `skills/dsh-qa/scripts/web-client-adapt.ts:342` moved
`base:"hephaestus"` → `base:"Deep Worker"` — from a key the route refuses to the accepted functional
NAME. **The fix moved TOWARD the contract.** Its own lane asserts the response carries `"Deep Worker"`,
which is now also what it posts (before: posted one key, asserted another).

The companion doc-comment generalisation (`workmate-library.ts:76-83`) removes the literal
`base:"hephaestus"` from the instructions while keeping the measured refusal text and its evidence
pointer — consistent with the change's intent, since the comment was itself advertising the spelling
the product rejects.

## 5. THE CITED COMMANDS ARE REAL — re-run by this seat, all green, exact counts

| Command | Result |
|---|---|
| `node skills/dsh-qa/scripts/readonly-deny.ts --self-test` | `[readonly-deny self-test] ok: 23 checks`, exit 0 |
| `node skills/dsh-qa/scripts/web-client-adapt.ts --self-test` | `[web-client-adapt self-test] ok: 14 checks`, exit 0 |
| `node skills/dsh-qa/scripts/workmate-library.ts --self-test` | `[workmate-library self-test] ok: 19 checks`, exit 0 |

All three counts match §5 exactly (23 / 14 / 19). Raw output: `scans.log`, section "SCAN D".

## Findings

- **Finding 1 (LOW)** — §5:103's accounting (38 declared vs 40 measured in the corpus files); the
  change itself is in-scope and 1:1 id→NAME. *Change needed:* correct the count, or say "≥38".
- **Finding 2 (NOTE)** — the seven residual non-argument occurrences listed in §1 are not named by the
  contract's deliberate-non-change list. They are benign today; naming them stops a future sweep from
  re-litigating them (or from "fixing" a `description=` label that is not a roster argument).

No BLOCKER-class finding. Nothing in this lane is a false claim: the three cited self-tests, the
single re-pin and the completeness statement all reproduce.

## Declared bounds (honest)

1. **Uncommitted.** The re-pin and every corpus edit are UNSTAGED (` M`). `AGENTS.md` §11's
   same-commit pairing is satisfiable only at the integration commit (T8) and is **not yet
   demonstrated**. Until it lands, the pin matches today's bytes (proven by the `vendor` gate) but is
   unprotected: any further `skills/**` edit invalidates it and a SECOND re-pin is red.
2. **Moving tree.** Other cards were writing concurrently during my measurement window
   (`docker/tui-lane.sh`, `docs/development.md`, `packages/**` all show as modified). My measurements
   cover `skills/**` + `VENDOR_LOCK.json` only; the `vendor` gate covers the whole lock.
3. **Read discipline (not a strictly blind basis).** I read the corpus diff and `VENDOR_LOCK.json`'s
   diff (the SUBJECT artifacts — they are what §1/§2/§3 judge), `packages/mpd-workmate-plugin/README.md`
   plus a targeted grep over its `src/*.ts` refusal texts (the REFERENCE contract for §4), and I ran the
   three self-tests. I did NOT read any captain-authored report or evidence narrative. The verdict rests
   on commands anyone can re-run from `scans.log`, not on the author's prose.
4. **Gates NOT run (out of this subject's scope, named rather than implied):** `bun test`,
   `bun run typecheck`, `verify:comments`, `verify:dist-fresh`, and the roster/alias unit gates — those
   belong to the roster lane (T6) and the wave verification (T7), not to the corpus.
5. **The gate itself was not verified here.** My subject is the corpus, not the tool-level refusal
   (`mpd_role_spawn` / `mpd_role_persona` / `mpd_modelchain_resolve`); the input gate is T6/T7's.

## The one thing I would change first

**Commit the 11 skills paths together with `VENDOR_LOCK.json` as ONE commit now** — before any other
`skills/**` writer touches the corpus. The re-pin is correct as measured and is the wave's single
permitted one; the only way to keep it that way is to land it in the same commit as the change that
invalidated the old `treeSha`.
