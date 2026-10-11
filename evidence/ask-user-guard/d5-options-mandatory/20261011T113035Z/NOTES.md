# D5 — `ask_user_question` options are mandatory (evidence)

Lane **D5** of wave `fix/sidebar-defects` (frozen contract `.mpd/plans/fix-sidebar-defects.md`).
Writer B. Write scopes: `presets/mpd.patch.yml`, `packages/mpd-roles-plugin/**`,
`evidence/ask-user-guard/**`.
User mandate (binding): *every* `ask_user_question` call must carry a non-empty `options` array on
*every* question item, with no exceptions.

## What changed

| Path | What changed |
|---|---|
| `presets/mpd.patch.yml` | the `ASK_USER_QUESTION CONSTRUCTION RULE` paragraph: the "whenever you offer a choice" qualifier is GONE — options are MANDATORY on every question item, no free-text form, no `options: []`. The JSON-shape / `id` / `label` parts of the rule are kept, and the paragraph now says the guard DOES deny a missing or empty list. |
| `packages/mpd-roles-plugin/src/ask-user-guard.ts` | RULE 4a flipped: a question item whose `options` is `undefined` (the field omitted) is now **denied exactly like `options: []`**. Header comment, the refusal sentence and the honest-bounds list were updated to match. Nothing else in the deny set moved. |
| `packages/mpd-roles-plugin/test/ask-user-guard.test.ts` | the D5 arms: missing key, `options: undefined`, a mixed call refused at the FIRST item that lacks it, the refusal text, and the same shape driven through the REAL installed seam callback. The `D1 — ` describe labels became `D5 — `. |
| `packages/mpd-roles-plugin/dist/index.js` | rebuilt with the PINNED toolchain from the repo root (`.toolchain/node_modules/.bin/bun`, `buildToolchain` bun@1.4.0). |
| `presets/mpd.patch.yml` row `- id: tool-ask-user` | **UNTOUCHED** — no `config.mode`. See "the `legacy` vs `timed` question" below. |

### The exact rule-text diff (`presets/mpd.patch.yml`)

```diff
-                ASK_USER_QUESTION CONSTRUCTION RULE: every question item you send MUST carry a
-                non-empty `id`, the question text under `question`, and - whenever you offer a choice -
-                a non-empty `options` array whose EVERY entry carries a non-empty `label`. Keep the JSON
-                structure exactly as the tool schema defines it: the fields at the level the schema puts
-                them, no mis-keyed option list, no empty option array. A boundary guard MAY deny a
-                structurally broken call before dispatch, but that guard is only a BACKSTOP: it can be
-                ABSENT (it degrades when the host exposes no guard seam) and unreadable shapes pass
-                through, so a broken call can still reach the panel. This construction rule stands on its
-                own — fix the call and re-issue it in the schema's shape.
+                ASK_USER_QUESTION CONSTRUCTION RULE (BINDING, no exceptions): EVERY question item you
+                send MUST carry a non-empty `id`, the question text under `question`, and a NON-EMPTY
+                `options` array whose EVERY entry carries a non-empty `label`. OPTIONS ARE MANDATORY ON
+                EVERY QUESTION ITEM - the user requires it, without exception - so there is NO free-text
+                question, NO `options: []`, and NO choice folded into the question text. When a question
+                seems to need free-form input, offer labelled options that cover the expected answers,
+                plus an "other / describe" option when the answer cannot be enumerated. Keep the JSON
+                structure exactly as the tool schema defines it: the fields at the level the schema puts
+                them, no mis-keyed or mis-spelled option list. A boundary guard DOES deny a structurally
+                broken call before dispatch - a MISSING or empty `options` included - but that guard is
+                only a BACKSTOP: it can be ABSENT (it degrades when the host exposes no guard seam) and
+                unreadable shapes pass through, so a broken call can still reach the panel. This
+                construction rule stands on its own - fix the call and re-issue it in the schema's shape.
```

### The guard diff (`packages/mpd-roles-plugin/src/ask-user-guard.ts`)

```diff
-      /** The item's optional choice list; `undefined` means a free-text question and is legal. */
+      /** The item's choice list, MANDATORY since D5; `undefined` means the field was omitted. */
       const options = item.options
-      // RULE 4a — `options` ABSENT stays legal: free-text questions are a designed use of the host tool.
-      if (options === undefined) continue
+      // RULE 4a — `options` MISSING is denied exactly like `options: []`: the user mandate makes a
+      // question without options a broken card, and the 2026-10-11 occurrence was precisely this shape.
+      if (options === undefined) {
+        return askUserQuestionRefusal(at + " carries no `options` array — every question item must offer at least one option")
+      }
       // RULE 4b — present but malformed: a non-array, an empty array, or an entry without a label.
```

The refusal sentence also lost its "whenever a choice is offered" clause and now states: *"Every question
item must offer at least one option — a question without options is refused exactly like an empty list."*

## Red → green (DISCIPLINE 1 — the failing arm ran FIRST)

| Arm | Command | Observed |
|---|---|---|
| **RED** (`_red/`) | `.toolchain/node_modules/.bin/bun test ./packages/mpd-roles-plugin/test/ask-user-guard.test.ts` | **exit 1 — 5 fail / 20 pass**, every failure a new missing-`options` arm on the *shipped* validator (`Expected to contain: "ask_user_question is refused" / Received: "undefined"`). The new arms were written and run BEFORE the guard edit. |
| **GREEN** (`_green/`) | the same command after the minimal fix | **exit 0 — 25 pass / 0 fail / 75 expect() calls** |

One pre-existing arm needed its FIXTURE corrected, not its assertion: *"the denial names the OFFENDING
item, so a 4-item call points at item 4"* fed items 1-3 without `options`, so under the new rule the walk
correctly stopped at item 1 and the arm never reached its subject. Items 1-3 now carry a legal options
list and the arm asserts the same thing as before (positional naming). The missing-options denial has its
own separate arms, so nothing was weakened to obtain the pass.

## Gates (this directory — one `result.json` + `output.log` per gate; the top-level `result.json` indexes them)

| Gate | Command | Exit | Observed tail |
|---|---|---|---|
| `bun-test` | `.toolchain/node_modules/.bin/bun test ./packages/mpd-roles-plugin` | 0 | `147 pass / 0 fail / 1217 expect() calls — Ran 147 tests across 8 files. [169.00ms]` |
| `typecheck` | `.toolchain/node_modules/.bin/bun run typecheck` | 0 | `$ tsgo --noEmit` |
| `verify-comments` | `.toolchain/node_modules/.bin/bun run verify:comments` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.` |
| `verify-rows` | `.toolchain/node_modules/.bin/bun run verify:rows` | 0 | `ok: 35 row ids match the 2-file bundle patch layer` |
| `preset-conformance-selftest` | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | 0 | `ok: 32 harness rows conform against the installed schemas (6 row(s) declare no schema), persona prefix=true, mpd preset 28 child rows, row parity 26/25 (negative controls: 4/4 reddened)` |
| `verify-dist-fresh` | `node scripts/verify-dist-fresh.ts` | 0 | `ok: 31/31 targets fresh (each rebuilt twice, byte-identical) — 1 NOT COVERED files listed` |
| `test-qa` | `.toolchain/node_modules/.bin/bun run test:qa` | 0 | `[test:qa] all self-tests passed` |
| `audit-selftest` | `node skills/dsh-qa/scripts/ask-user-question-audit.ts --self-test` | 0 | `ok: 4 concatenated zstd frame(s), 18 record(s), 11 occurrence(s), every rule of the local restatement, both answer pairings, the CLI exit codes and the repair arms … are verified offline` |
| `verify-docs` | `.toolchain/node_modules/.bin/bun run verify:docs` | 0 | `pairs=47 failed=0 violations=0 exempt=24 derived=3 links=436 dead=0 — PASS` |

**9 gates, 0 failed** (`result.json` → `summary.failed: []`). `PATH` starts with
`.toolchain/node_modules/.bin` inside `capture.sh`, so a nested `bun` is the pinned 1.4.0.

The single `NOT COVERED` line in `verify-dist-fresh` is pre-existing and self-explaining:
`packages/mpd-mcp-codegraph/dist/serve.js — sha-pinned prebuilt vendored at pack time … no local src/`.

## The `legacy` vs `timed` question — SETTLED, row UNTOUCHED

The contract allowed a row config ONLY if a sandboxed reproduction showed a well-formed call failing to
surface on the web plane under `legacy` AND `mode: timed` fixing it without breaking the TUI flow.
Neither half holds; the recon suspicion is **falsified by the shipped host bytes**.

`mode-probe/` (`probe.ts` + `output.log` + `result.json`, exit 0) executes the INSTALLED host and decodes
one REAL operator session (2026-10-11, 280 frames / 509 records / 0 undecodable):

1. **The projection really is timed-gated.** `@deepseek-ai/dsh-user-questions@0.2.0-rc.2`,
   `applyUserQuestionEvent`: `case "tool/call": if (!fold.timed || event.data.name !== "ask_user_question") return fold;`
   — and `fold.timed` is only ever set from a request header whose `ask_user_question` schema declares the
   `timeout` parameter. The probe measured exactly that flip by executing the installed module:
   `{}` → parameters `["questions"]`, `timeout` ABSENT, predicate **false**;
   `{mode:"timed"}` → parameters `["questions","timeout"]`, predicate **true**.
   The real session's recorded header also declared `["questions"]` only — i.e. that session ran `legacy`.
2. **But the projection is not what puts a card on the web.** `dsh-client-ui-user-questions@0.2.0-rc.2`
   says a card "is created by whichever source arrives first, the forwarded waterfall or the Session
   projection", its `answerQuestion` claims on `ctx.sessions.scopeOf(owner)` alone, and `PendingQuestion`
   explicitly documents the blocking case: *"Tool call identity; absent for a blocking request that
   carried no `wait`"* (such a card is `dismissal: "cancel"`). `dsh-user-questions`' `ask()` — the LEGACY
   path — always goes through `ctx.waterfall("user-questions/request", …)`, and `dsh-api-remotes`
   forwards exactly that event (`{event: "user-questions/request", mode: "waterfall"}`). So a legacy call
   has a render path on the web plane; it simply has no countdown and is not projection-durable.
3. **`timed` is not a free switch.** `Config` defaults `timeout: 120`; on expiry the tool returns
   `{pending: true, callId, message: pendingNotice}` and the model is told to continue — i.e. the
   default answer flow changes from "blocks until answered" to "waits at most 120 s, then continues".
   That is a user-facing behaviour change, and it was not needed to fix the reported defect.

**Verdict: the `- id: tool-ask-user` row keeps no `config` (host default `legacy`).** The preset file
DID change in this lane (the rule text above), so the `preset-conformance-selftest` row was run on the
preset exactly as it now stands — and the row's own shape is byte-identical to the one it has always had.

## Root cause, on a real store

`mode-probe/output.log` PART A: the operator's real 2026-10-11 session carried three
`ask_user_question` calls. The first had **5 items and `options` ABSENT on all five** — schema-legal,
accepted, and rendered with nothing to choose (the reported occurrence). The other two carried
`array(2)/array(2)/array(3)/array(2)` and `array(4)`. That is the shape the guard now denies.

## Findings OUTSIDE this lane's write scope (reported, not absorbed)

1. **The audit's restatement now under-reports.** `skills/dsh-qa/scripts/ask-user-question-audit.ts`
   classifies calls by a LOCAL restatement of the guard's deny list, whose options rules are
   `options-not-array`, `options-empty`, `option-label-missing` — there is **no missing-`options` rule**.
   After D5 the audit will therefore report a no-options call as `ok` while the guard denies it. The
   audit's own `--self-test` stays green (it is green above) because it exercises the OLD rule set; the
   divergence is a documentation/diagnostic gap, and `skills/**` is outside Writer B's scopes (and is a
   single-writer band this wave).
2. **One skill still advertises a free-text path.** `skills/ulw-research/SKILL.md` asks for questions
   "each with its default first, a free-text 'describe the format' path, and 'don't care, you decide'".
   If that free-text path is a *labelled option* it is fine; if it means a question item with no
   `options`, the guard now refuses it. Same out-of-scope band.

## Honest bounds

- The D5 rule change is **verified by unit arms and by a real recorded session**, not by a live
  end-to-end browser render: no headless browser was driven in this lane, so "the web plane renders a
  well-formed legacy call" is a conclusion from the shipped client/service/remotes bytes plus the
  probe's execution of the shipped module — not an observed card.
- The guard is a BACKSTOP and stays one: it degrades to `askUserQuestion=absent` when the host exposes no
  `tools.guard` seam, and the preset rule text remains the primary carrier.
- The guard denies a *structurally* missing/empty list. It cannot know whether the offered labels are
  meaningful, and a whitespace-only `label` is still accepted (the literal "non-empty" reading, unchanged
  from D1 and stated in the source).
- Denying omissions makes every `ask_user_question` call a multiple-choice call. That IS the mandate; a
  model that wants free-form input must offer a labelled option (the rule text now says so).
- The session store decoded here lives under the operator's `$HOME/.dsh` and may be GC'd; the probe takes
  the path as an argument so the reading is reproducible while the store lasts.
