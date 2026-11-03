# R-W4A4 — verdict on the admission strength ladder and its gate integration

Reviewer: reviewer-a (independent of the W4-A4 writer). Judged against the AMENDED contract
`.mpd/plans/autoproject-refactor.md` §10 item A4 and the W4-A4 task's own acceptance text — never against
the writer's narrative. Every claim below was re-measured.
Measurement instant: **2026-11-02T12:10Z** (20:10 Asia/Shanghai), tree `feature/autoproject-refactor`,
uncommitted, several lanes in one worktree.

## Assessment

**Risk level: LOW.** The ladder is the cheapest honest shape of the contract's idea: a new pure module
that adds a CLASSIFICATION and moves no live behaviour. The predicate's second half is byte-identical
(`input.explicitFlag === true || signals.length >= 1`) and my 64-combination sweep over eight texts and
eight input shapes found **zero drift** between the new `trigger` and the original predicate, plus **zero**
difference at all between an absent `source` and `source: "human"` (the backward-compatibility claim,
asserted over the WHOLE verdict). Both live callers are safe by construction: `session-gate` and
`mpd-autoproject-plugin` call the gate without `source`, so they stay on the human rung. The lexicon is
reused, not copied — `admission.ts` imports `consumeExplicitFlag` and `evaluateComplexityGate` and has no
signal list of its own — and the two-module import cycle is genuinely call-time only: plain `node` (not
bun) loads it in BOTH orders and answers correctly. The notice delta is exactly one 21-char clause inside
the first line (688→709 chars, 4→4 lines for the advisory text), and a caller that omits `strength` gets
byte-identical text — the builders default the parameter to `undefined` and emit `""`. Every touched
`toEqual({trigger,signals})` pin gained `strength` and kept its original `trigger`/`signals` byte-for-byte
(11 pairs, mechanically checked; no assertion was weakened to `toMatchObject` or a truthiness check). The
one cross-tree caller that consumed the verdict BY SHAPE — `skills/dsh-qa/scripts/session-start-team.ts`,
which stringified the whole object — has already been repaired to compare the fields its arm is about and
now prints the rung; its `--self-test` is green. The single red gate is the package's own T-62/F1
dist-freshness arm, which the lane declared and which C9/T-88 assign to the captain's rebuild. What I
found is one deliberate deviation from the AMENDED contract's wording (the gesture branch outranks the
producer, so producer prose naming the automation is still admitted) whose two justifying comments are
factually wrong, plus three nits.

## Ranked findings

### Blocker — none
### High — none

### Medium

**M1. The gesture branch outranks the producer filter — producer text that NAMES the automation is
admitted `explicit` and stages, and both comments that justify this are wrong.**
`packages/mpd-roles-plugin/src/admission.ts :: admissionOf` evaluates `evidence.explicitFlag`, then
`AUTOMATION_GESTURE_PATTERN`, and only THEN `source !== "human"`. Verified consequence: a model-authored
brief that matches five signals and additionally contains one gesture word stages —
`evaluateComplexityGate(五-signal brief + " orchestrate it", { source: "model", activeBoulder: true, workspaceScale: true })`
returns `{trigger: true, signals: ["B","C","D","E","F"], strength: "explicit"}`, while the same brief
without the word returns `{trigger: false, strength: "ignore"}`. So the rung's whole protective purpose —
producer text cannot self-admit — is defeatable by six tokens, and the most likely one in a Chinese task
description, `编排`, is ALSO listed in `complexity-gate.ts`'s `DELIVERABLE_VERB_PATTERN` / `ACTION_VERB_PATTERN`,
so it is simultaneously the word that fires a signal and the word that admits the text.
The contract's amended A4 makes the subject of "named the gesture" the USER and describes `ignore` as
"model-authored text, or no human turn"; the lane's test (c2) pins the OPPOSITE reading on purpose
("`ignore` is defined as 'no human turn AND no flag'") — and that stated definition omits the gesture
branch it is there to assert. The module header's safety argument is also false: "a false positive here
can only PROMOTE a text from `inferred` to `explicit` — both of which stage" — for producer text the
promotion is `ignore` → `explicit`, which is exactly what flips a non-staging verdict into a staging one
(the same test that documents the precedence proves the promotion).
Why it is not High: no live caller passes `source` today, so the deviation has zero runtime effect now;
it bites the FIRST future producer-text caller, which is the only reason the rung exists.
Direction (a decision, not a patch): either move the `source !== "human"` check ABOVE the gesture branch
and keep only the FLAG above it — the flag is a fact about the text the caller already consumed, while a
gesture word is the producer's own wording — and re-pin (c2); or amend A4 to say the gesture outranks the
producer and record that in the PR. Either way, rewrite the two comments: the header's "only promotes
inferred→explicit" claim and the test's "no human turn AND no flag" definition are both contradicted by
the code they describe. The captain owns the contract side of this.

### Nit

**N1. The totality claim is broader than the code.** `admissionOf` says a non-string "reads as empty
(exactly what the gate does)"; measured, `String(text ?? "")` stringifies (`123` → `"123"`, `{}` →
`"[object Object]"`) and THROWS for `Object.create(null)` (`TypeError: Cannot convert object to primitive
value`) and for an object with a throwing `toString`. The lane's totality arm only proves `undefined`.
Direction: `typeof text === "string" ? text : ""` — which is what the comment already claims, is safe
(the gate always hands a string, so the visible behaviour does not move) — or narrow the comment. Not a
regression: `evaluateComplexityGate` carries the identical line from before this wave.

**N2. The acceptance's "`bun test packages/mpd-roles-plugin` green" is unmeetable by construction.**
Measured: 260 pass, 1 fail, and the single failure is the package's own T-62/F1 arm that delegates to
`verify-dist-fresh` — i.e. the dist the lane is FORBIDDEN to rebuild (C9/T-88). The lane declared the red
honestly, so this is a contract wording defect, not a lane defect: an acceptance that requires a green
suite while forbidding the rebuild cannot be satisfied. Direction: phrase it "260 pass, the declared
dist arm red until integration", or declare the derived path on the integration task and have the
integration re-run the package suite. (The same shape bit W1-B1.)

**N3. Both new files are untracked** (`?? packages/mpd-roles-plugin/src/admission.ts`,
`?? packages/mpd-roles-plugin/test/admission.test.ts`). The captain is the single git writer; a batched
`git commit -a` would ship the gate change WITHOUT the module it imports. Direction: add both explicitly.

**N4. The wiring arm is a whole-expression source pin.** `packages/mpd-roles-plugin/test/admission.test.ts`
:: `the live wiring` asserts the session-gate call site via `readFileSync` + `toContain` on the exact
one-line expression; a pure reformat (line break after `{`) reddens it while the wiring is still correct.
The file justifies it (a source pin, T-55-proof), and it does prove the two call sites cheaply — I only
note the brittleness. Direction: assert the two tokens that carry the contract
(`strength: verdict.strength` and the advisory builder's third argument) instead of the full expression.

## Declined to judge

- **`explicit` for producer text carrying the FLAG** (`admissionOf("model", "team: go")` → `explicit`): the `explicitFlag` fact describes the ORIGINAL text the caller already consumed (the gate is handed the marker-stripped text), so a caller saying "the flag was consumed" is reporting the user's marker, not the producer's wording. Defensible; only the GESTURE branch is in M1.
- **`AUTOMATION_GESTURE_PATTERN` being "a second lexicon"**: A4 requires a gesture vocabulary and no existing one covers it (`mpd-autoproject-plugin`'s `GESTURE_PATTERN` matches a LEADING slash command — a different grammar, and it is a plugin, not a predicate). It is not a copy of any existing list.
- **`session-gate` not passing `source`**: absent ≡ human, and that equality is asserted over the whole verdict across 64 combinations; passing it explicitly would add nothing.
- **The QA shape consumer**: the lane declared `skills/dsh-qa/scripts/session-start-team.ts` as a follow-up for the skills writer; it is ALREADY repaired in this tree (field-wise comparison + `strength` in the diagnostic line) and its `--self-test` is green — verified, not reported.
- **The dist rebuild / the T-62 F1 red**: C9 and T-88 assign dist to integration, and the lane touched no file under `packages/*/dist` (verified by status and mtime).
- **The roles README not documenting the verdict shape**: it documents neither the old shape nor the new one, so nothing went stale; the docs band is W5's.
- **`admissionOf`'s extra `evaluateComplexityGate` call** when evidence is absent: one pure, I/O-free call per fire, and the gate always supplies the count, so the fallback never runs in the live path — not a finding.
- **Every other package changed today** (`mpd-cellwork-plugin`, `mpd-memory-plugin`, `mpd-team-core-plugin`): other lanes' concurrent work, outside this review's subject.
- **The signal lexicons and thresholds themselves**: unchanged by this wave; I read the changed region and the two predicates, not the term lists.

## Verdict

**PASS** — the ladder is pure, total, lexicon-reusing and behaviour-neutral for every caller that exists
(64-combination zero-drift sweep, absent-source equality asserted, one 21-char notice clause with
byte-identical text for old callers, pins edited purely additively), the import cycle is proven safe under
plain `node` in both orders, and the declared dist red is the integration's; the one Medium is a
deliberate deviation from A4's wording that the captain must resolve by either flipping the gesture check
above the producer filter or amending the contract, and its two justifying comments must be corrected
either way.

## Evidence measured (commands and observed results)

| Check | Command | Observed |
|---|---|---|
| package suite | `bun test packages/mpd-roles-plugin` | **260 pass / 1 fail**; the fail is `F1 shipped artifact > the committed dist is the byte-identical product of a canonical build (T-62)`, which delegates to `verify-dist-fresh` (declared, integration-owned) |
| types | `bun run typecheck` | exit 0 |
| comments | `bun run verify:comments` | PASS — 550 files |
| truth table + totality + equivalence | `evidence/autoproject-refactor/w4a4/probe-admission.ts` (output in `probe.log`) | model+5 signals → `ignore`/no stage; human+1 → `inferred`/stage; flag → `explicit`/stage; **model+5 signals+gesture → `explicit`/STAGES** (M1); `123`/`null`/`{}` → `ignore`; `Object.create(null)` and a throwing `toString` → **THROW** (N1); unknown source → `ignore` |
| trigger equivalence | same probe, 8 texts × 8 input shapes | **64/64 zero drift** vs the original predicate, and absent-source verdict `===` human verdict for all 64 |
| notice delta | same probe + the lane's arm | advisory 688→709 chars (**+21**), 4→4 lines; mechanical +21; clause sits inside the first line; omitted `strength` → byte-identical |
| pins | `git diff -U0` on `team-plane.test.ts` | 11 pairs, each added line = removed line + `, strength: "<rung>"`; original `trigger`/`signals` unchanged; no `toMatchObject`/truthiness weakening |
| import cycle | plain `node`, both import orders | loads and answers correctly in both (`admission` first and `complexity-gate` first) — no initialisation-order break outside bun |
| lexicons | `grep` the imports of `admission.ts` | imports `consumeExplicitFlag` + `evaluateComplexityGate`; no signal list of its own; no ambient read (`process.env`/clock) in the gate |
| consumers by shape | `grep evaluateComplexityGate` / `ComplexityVerdict` tree-wide | only `mpd-autoproject-plugin` (reads `.trigger`/`.signals`, no `source`) and the QA script (already repaired; `--self-test` green) |
| scope | `git status` / mtimes | only `packages/mpd-roles-plugin/` (5 files, 19:56–20:01); both new files UNTRACKED (N3); no dist file touched |

## Bounds of this review

**Not read in full:** the ~1,700-line `complexity-gate.ts` — I read every changed hunk, both notice
builders, the two predicates' shapes, `consumeExplicitFlag`, `resolveSensitivity` and every consumer; the
signal lexicons and threshold tables themselves were not audited (unchanged by this wave). The lane's
`admission.test.ts` was read in full; `team-plane.test.ts` only through its diff.
**Not run:** the Docker lane, a real mount/session, the REAL `session-start-team` case (it needs a live
boot; I ran its offline `--self-test`), any `packages/*/dist` rebuild (C9 + reviewer discipline), and no
git write.
**Not verified:** the lane's "both falsified" claim by literally deleting code — instead I verified
discrimination from the probe: the model arm's `signals` are 5, so removing the `source` conjunct flips
`trigger` to `true` (red), and removing the clause makes the 21-char delta 0 (red).
