# Follow-up QA lane report — F1 (`tui-admission` static grant arms) + QA Nits

**Task:** T14 (follow-up wave, contract `.mpd/plans/vedit-p0-followup.md` §F1).
**Scope:** `skills/dsh-qa/scripts/tui-admission.ts` (the wave's ONLY skills write) + this evidence subtree.
**Verify loop:** `loop-20261103T054327-0c2506`. No git writes; `VENDOR_LOCK.json` untouched.

## 1. The defect (H1) and the fix

`--static-only` was red by construction: the static grant arms negotiated the **shipped** manifest, which
deliberately declares `"permissions": []` (commit `776ac355`), so `negotiate(manifest, …)` answered
`compatible` with and without a grant and the arm's `waiting_authorization` expectation could never hold.

The fix is the CLONE technique the self-test already used, applied to the static arm:

| symbol | change |
|---|---|
| `GRANT_ARM_PERMISSION`, `GRANT_ARM_SCOPE`, `GRANT_ARM_REASON` | NEW module constants: the ONE `session.input.intercept@tui/input` declaration the arms negotiate, shared by the static arm and the self-test (one declaration, not two copies). |
| `staticAdmission` — grant arms | builds `structuredClone(<shipped manifest>)` + that ONE row, then runs the **host's own** `parseManifest` → `validatePlugin` → `negotiate` on it three ways: no grant, that row granted, the same name at an undeclared scope. The shipped manifest's own decision is asserted separately and must stay `compatible`. |
| `StaticAdmissionRecord.grants` | `rows` is now the clone's one row; NEW `manifestDecision`; `ungranted`/`granted`/`wrongScope` are the CLONE's decisions; `ok` requires `manifestDecision === "compatible"` AND the three clone states. |
| header narrative | the stale "the manifest's own four rows → compatible" paragraph now describes the clone measurement (the file no longer claims something false). |

Measured on the REAL tree (`evidence/tui/lanes/2026-11-03T05-49-34.661Z/admission-static.json`):

```json
"grants": {
  "rows": [{ "name": "session.input.intercept", "scope": "tui/input" }],
  "manifestDecision": "compatible",
  "ungranted": "waiting_authorization",
  "granted": "compatible",
  "wrongScope": "waiting_authorization",
  "ok": true
}
```

`parse: "ok"`, `validatePlugin: "ok"` — the clone is a manifest the host would admit, so the granted arm
exercises the real admission path rather than a rejected document.

The shipped `dsh-plugin.json` and `packages/mpd-tui-plugin/dsh-plugin.json` are **untouched**
(`git status --porcelain` on both: empty), and the mpd-tui two-manifest hard gate is green
(`bun test packages/mpd-tui-plugin/test/manifest.test.ts` → 6 pass / 0 fail).

## 2. QA Nits

| nit | disposition |
|---|---|
| **N1** — the tautological `writerRows.every(scope.startsWith("tui/"))` | REPLACED. The self-test's clone now carries TWO declarations (the arm's real row + the rewind point), and the arm asserts a real round-trip: `grantsOfManifest(withIntercept)` must return BOTH rows with exactly the declared `name`/`scope`, in order (`cloneRows[0]`/`cloneRows[1]`). A projection that drops a row, swaps fields or rewrites the scope reddens here. |
| **N2** — the writer-shape control checked only "is an array" | REPLACED/EXTENDED. The written document is now decoded and its ROW CONTENT compared to the rows the writer was handed: same length, same order, `name` and `scope` verbatim, and exactly two keys per row (`Object.keys(row).length === 2`), so a writer that emitted `[{name}]`, reordered or padded reddens. The rows the writer writes are the PROJECTION'S own output (`writerRows = cloneRows`), so the literal fixture list is gone. |
| **N3** — the overstated vocabulary sentence in the T10 report | CORRECTED here (the historical report stays untouched, as instructed). **Quoted from `evidence/dsh-qa/tui-admission-fix-t10/2026-11-03T04-22-14Z/report.md` §2, "selfTest — writer fixture" row:** *"the grant-file writer's document shape and the `tui/<point>` scope vocabulary are now proven on declared FIXTURE rows (`writerRows`) instead of the manifest's (empty) set, because the old scope assertion became vacuous once the permissions were removed."* **Correction:** the DOCUMENT SHAPE was proven (that schema check ran); the *"`tui/<point>` scope vocabulary"* claim is WITHDRAWN — the check was a predicate over a literal array the arm itself had just written, so it could not fail for any state of the product. It proved nothing about the vocabulary and nothing about the writer. The follow-up replaces it with the N1 round-trip and the N2 content comparison, whose falsifiability is demonstrated by mutation cases m4/m5 below. |

## 3. Gates (real repo, quoted exits)

| command | observed | log |
|---|---|---|
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided` — **exit 0** | `self-test.log` |
| `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` | `static result ok=true` / `ok=true -> evidence/tui/lanes/2026-11-03T05-49-34.661Z` — **exit 0** (was exit 1, `ok=false`) | `static-only.log` |
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** (tui-admission line: `ok: structural rules…`) | `test-qa.log` |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** | report to Lead |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS` — **exit 0** | report to Lead |
| `bun test packages/mpd-tui-plugin/test/manifest.test.ts` | `6 pass / 0 fail` — **exit 0** (the two-manifest hard gate) | report to Lead |

## 4. Falsifiability — mutation controls (every arm demonstrably reddens)

Each case runs in a `mktemp -d` copy of `skills/dsh-qa` + `dsh-plugin.json` + the tui dist entry, with ONE
mutation applied to the copy; nothing in the repo is mutated.

| case | mutation | expected | observed | log |
|---|---|---|---|---|
| baseline self-test | none | pass | **exit 0** | `mutations/baseline-self-test.log` |
| baseline static | none | pass | `ok=true`, **exit 0** | `mutations/baseline-static.log` |
| m1 | the SHIPPED manifest regrows ONE permission | static red | `ok=false`, **exit 1** | `mutations/m1-manifest-permission.log` |
| m2 | `cloneGranted` is handed the WRONG-SCOPE row | static red | `ok=false`, **exit 1** | `mutations/m2-granted-wrong-scope.log` |
| m3 | `cloneUngranted` is handed the grant | static red | `ok=false`, **exit 1** | `mutations/m3-ungranted-granted.log` |
| m4 | the grant-file writer emits `[{name}]` only | self-test red | `FAIL … the writer must round-trip every row's name and scope verbatim, in order, and nothing else`, **exit 1** | `mutations/m4-writer-name-only.log` |
| m5 | the projection rewrites every scope | self-test red | `FAIL … the projection must round-trip every declaration's name and scope in order`, **exit 1** | `mutations/m5-projection-rewrites-scope.log` |

m1 proves the arm is not "clone-only" (a real re-declaration on the shipped file still reddens); m2/m3 prove
the granted/denied pair discriminates scope and grant; m4/m5 prove N1/N2 are no longer tautologies.

## 5. Bounds and the finding I could NOT fix here

- **The non-static (live) TUI lane was NOT run.** It needs a warm sandbox profile (`tui-mount.ts --install`
  into `--sandbox-root`) plus a real TUI host, and this checkout has **no** such sandbox
  (`.mpd/recon/` carries no tui profile; `tmux 3.6` is present, the profile is not). Its results are
  therefore unmeasured by this lane, and none of my claims rest on them.
- **FINDING (report only, no fix — a captain ruling is needed): the LIVE lane is red by the SAME
  construction F1 fixed in the static arm.** `real()` asserts, on the SHIPPED (permission-less) manifest:
  `arm5` (`negativeVerdict.state === "waiting_authorization" && negativePane.includes("extension-grants.json")`)
  — with no permission requested the no-grant boot negotiates `compatible`, so `arm5` cannot be true;
  `arm3` requires `handlerBinds.length > 0` where `handlerBinds` counts decision-handler binds RECORDED
  `applied` — with the permission undeclared the host records `PERMISSION_NOT_GRANTED` instead, so no
  `applied` bind exists; and `arm4` requires our handler to be live on a real `tui/input` decision, which
  the same undeclared permission prevents. `ok` requires `arm1 && arm2 && arm3 && arm4 && arm5`, so the
  live lane exits 1 deterministically. Fixing it means re-specifying what the live lane MEASURES in a
  permission-less world (the no-grant posture is now `compatible` with no decision binds), which is a
  contract decision, not a test edit — and it cannot be verified in this environment.
- **`VENDOR_LOCK.json` is deliberately untouched** (contract §Lanes: the captain re-pins). This edit
  invalidates the corpus `treeSha`, so `node scripts/verify-vendor.ts` will stay red until the wave's
  SINGLE re-pin lands in the same commit. `git status --porcelain skills/` shows exactly one modified
  file (`skills/dsh-qa/scripts/tui-admission.ts`), so this lane is the wave's only skills writer.

## 6. Evidence paths

```
evidence/cellwork/vedit-p0/followup/qa/
  self-test.log  static-only.log  test-qa.log
  mutations/{baseline-self-test,baseline-static,m1-manifest-permission,m2-granted-wrong-scope,
             m3-ungranted-granted,m4-writer-name-only,m5-projection-rewrites-scope}.log
  report.md   (this file)
evidence/tui/lanes/2026-11-03T05-49-34.661Z/   ← the lane's own run artifact (admission-static.json, result.json)
```

---

# F5 — `dual-track-smoke` deepseek track (`NO_ADAPTER`) — FIXED

Added to T14 by captain ruling (the user rejected shipping with known issues; F5 is a FIX, not a bound).
Per the Explorer's diagnosis `evidence/dsh-qa/dual-track-deepseek/2026-10-29T01-30-11Z/diagnosis.md`.

## F5.1 The defect

The deepseek track's overlay (`tests/overlays/compat-track.yml`) id-targets `agent-default-model` with
`provider: deepseek`, but the `@deepseek-ai/dsh-base` patch mounts the `llm-pi-ai` row with **no config**:
it composes dormant, never calls `registerAdapter`, and provider `deepseek` is missing from the LLM runtime.
The boot therefore died `dsh: NO_ADAPTER: no adapter registered for provider "deepseek"` (exit 1) before any
credential was consulted. The module IS installed — this was a QA-CASE bug, not a product defect.

## F5.2 The change (`skills/dsh-qa/scripts/dual-track-smoke.ts`, +103/−? lines; exact `+/-` lines in
`dual-track-diff-lines.txt`)

| change | detail |
|---|---|
| `DEEPSEEK_ROUTE_SETTINGS` (NEW const) | the `llm-pi-ai:` block from the ruling — `providers.deepseek.apiKeyEnv: DEEPSEEK_API_KEY` **plus** `models: [{id: deepseek-v4-flash}]` (the installed catalog lacks that id, and the overlay names it). Declared ABOVE `TRACKS` so the table can reference it. |
| `Track.settings` (NEW field) | `null` for `official` (its boot is unchanged), `DEEPSEEK_ROUTE_SETTINGS` for `deepseek` — the track table stays the single source of what a track needs. |
| `runReal` — settings staging | AFTER the existing `~/.dsh/settings.yaml` copy, the track's block is **appended** to `<sandbox>/settings.yaml` (never substituted, so a machine with settings keeps every other provider; a pre-existing top-level `llm-pi-ai:` key is a documented last-wins duplicate). |
| `runReal` — env | `credentialEnv({ ...process.env, DSH_HOME: sandbox, HOME: sandbox })` (AGENTS.md §7 isolation arm b; the sibling `mcp-call.ts` pattern). Launcher resolution is PATH-based, so it is unaffected. |
| `toolEvidenceOf` (NEW fn) | reads the HARNESS session log: `readSessionEvents(sandbox, { workspace: ws })` + `findToolCall(records, "bash")`, returning `{succeeded, called, reason, resultText.slice(0,4000)}`. |
| `runReal` — `ok` | `run.status === 0 && toolEvidence.succeeded` — the `/bash\|tool/` stdout regex is GONE (AGENTS.md §7: the answer text is wrong evidence in both directions). |
| `result.json` | `hasToolEvidence` now means the SESSION-EVIDENCE verdict, and the new `toolEvidence` object records the called names, the reader's reason and a bounded slice of the tool result. |
| self-test | two new offline arms: the block must still carry the provider + the `deepseek-v4-flash` model + the key env (removal ⇒ `NO_ADAPTER` returns), and only the deepseek track may stage settings (the official boot must stay byte-identical). |

## F5.3 Measured (BOTH tracks green)

`bun skills/dsh-qa/scripts/dual-track-smoke.ts` → **exit 0**, `[llm-dual-track] PASS` (`dual-track-smoke.log`):

```
[llm-dual-track] official ok=true (10772ms, exit=0) -> evidence/dsh-qa/llm-dual-track/official/2026-11-03T05-54-57.129Z
[llm-dual-track] deepseek ok=true ( 9328ms, exit=0) -> evidence/dsh-qa/llm-dual-track/deepseek/2026-11-03T05-55-06.460Z
```

`evidence/dsh-qa/llm-dual-track/deepseek/2026-11-03T05-55-06.460Z/result.json`:

```json
{ "ok": true, "track": "deepseek", "provider": "deepseek", "exit": 0, "hasToolEvidence": true,
  "toolEvidence": { "succeeded": true, "called": ["bash"], "reason": "",
                    "resultText": "/tmp/mpd-dsh-qa-sBlXX7/ws\ntotal 4\n… .codegraph\n… .mpd\n… AGENT.md" } }
```

`bun skills/dsh-qa/scripts/dual-track-smoke.ts --self-test` → exit 0 (the two new arms included).
`bun run test:qa` → `[test:qa] all self-tests passed`, exit 0 (line 22–23: dual-track self-test ok).

Two facts the evidence settles that the old regex could not:
1. **Isolation holds** — the `ls` the model ran printed `/tmp/mpd-dsh-qa-*/ws`, i.e. the SANDBOX workspace,
   not this checkout (and `assertSessionsSandboxed` passed, so the session store is sandbox-keyed).
2. **The ok is real** — a `tool/call` for `bash` paired with a NON-ERROR `tool/result` is in the harness
   session log; the model's narration is no longer the evidence.

**Case-owned artifact rewritten by the run (reported, not hand-edited):**
`evidence/dsh-qa/llm-dual-track/dual-track.tsv` (TRACKED) now reads
`official deepseek-official true 10772 0` / `deepseek deepseek true 9328 0` — the case writes this summary
table on every run; the previous row recorded the red. Fresh per-run evidence dirs were also created under
`evidence/dsh-qa/llm-dual-track/{official,deepseek}/` (untracked).

## F5.4 Bounds

- The live run needs real credentials and network; on a host without `DEEPSEEK_API_KEY` the case reports the
  credential bound and exits 1 as before (unchanged behaviour).
- The `models` entry is REQUIRED by the ruling because the installed pi-ai catalog lacks
  `deepseek-v4-flash`; if a future host catalog ships it, the block still pins the id the overlay names.
- No `llm-pi-ai` row was added to `cordis.patch.yml` (policy + `verify-no-host-override`), and neither
  manifest was touched.
