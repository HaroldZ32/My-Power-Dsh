# R-W0 — verdict on "move the HOME-scoped mutation guard into mpd-dsh-adapter"

Reviewer: reviewer-a (independent of the W0 writer). Reviewed against the frozen contract
`.mpd/plans/autoproject-refactor.md` (§4.7, §5 W0, C1, C9, R6) and the task's own acceptance text —
never against the writer's narrative.
Measurement instant: **2026-11-02T11:21Z** (19:21 Asia/Shanghai). Tree: `feature/autoproject-refactor`,
uncommitted, mid-wave (W1-A / W1-B in flight in the same worktree).

## Assessment

**Risk level: LOW.** W0 is a clean, narrow extraction, and I could not find a behavioural difference
between the shipped private guard and the new shared one: across a 7-arm environment matrix (normal
session, sandbox boot, real-home boot, HOME unset, override, sibling-prefix HOME, empty `DSH_HOME`) both
implementations agreed on allow/refuse, error `code`, `status` **and the refusal message byte for byte**
(probe below), and the one call site that consumes the thrown class was widened correctly from
`instanceof WorkmateError` to `instanceof HomeGuardRefusal` so no refusal silently degrades to a 500.
Only two source hunks exist in the adapter (an import line and one contiguous block) and the workmate
side deletes the private copy, its two now-dead imports and the duplicated error fields — no unrelated
behaviour was smuggled in, no dead helper is left, and the coupling inventory is untouched by this wave
(the sanctioned-adapter exemption means the workmate→adapter edge is not counted at all). The new test
does what it claims, is discriminating (proved, not asserted), and cannot touch the real `~/.mpd`
(the guard only compares paths). The two reds I measured are honest and belong elsewhere: the adapter
suite's single failure is W1-B's coupling entries, and `verify:dist-fresh` is red because no lane may
rebuild dist (C9). Both are integration work the captain owns.

## Ranked findings

### Blocker — none
### High — none

### Medium

**M1. The shared predicate's documented summary is narrower than its actual rule, and the first
`memory.globalDir` consumer (W3-D) will meet the difference.**
`packages/mpd-dsh-adapter-plugin/src/index.ts :: assertHomeMutationSandboxed` / `HomeMutationGuard`.
The doc opens with "refuse a home-scoped MUTATION that would land in the real user's home", but the
implemented rule is **containment in `$HOME`**: under an isolated boot it refuses unless
`$HOME` is set, is not the real home, AND `guard.root` is inside it. I verified the consequence: with
`HOME=<sandbox>` and `DSH_HOME=<sandbox>`, a root under a *different* temp directory is REFUSED even
though it is nowhere near the real home. That is inherited from the workmate-shaped predicate (whose root
is always under HOME) and is therefore **not a W0 regression** — but contract §4.7 gives memory a
`memory.globalDir` override, so a global dir outside `$HOME` will be refused in every isolated QA boot.
Why it matters: the row that motivated the move is the one whose root is not fixed under HOME.
Direction of a fix (described, not applied): before W3-D binds, decide the contract — either document
"root must be inside `$HOME`" as the shared rule and require rows to pass a sandbox-HOME-derived root,
or add an explicit "this root is provably not the real home" arm. Do **not** widen the predicate inside
W0; this is a decision for the next wave, not a defect of this one.

### Nit

**N1. The new test file is untracked.** `packages/mpd-dsh-adapter-plugin/test/home-guard.test.ts` shows
as `??` in `git status`. The captain is the single git writer, and a batched `git commit -a` would omit
the only pin this wave adds. Direction: add the file explicitly at integration.

**N2. The pin has a discriminating arm but no in-file falsifiability case, unlike this package's own
precedent.** `packages/mpd-workmate-plugin/test/sandbox-guard.test.ts` already carries the t67 shape —
a control table that reports a one-sided table as HIDING the defect, plus a `PRE_FIX_GUARD` arm that must
go red against the historical predicate. The new file relies on arm (a) alone (which I proved
discriminating) and on the writer's report for falsifiability. Direction: port the t67 falsifiability
case into the new file so the pin cannot rot into a tautology without a report.

**N3. The shared refusal class is a bundle-local identity, not a shared one.**
`HomeGuardRefusal` lives in the adapter's *source*, and `bun build` inlines every imported module into
each package's dist (AGENTS.md §6, C9). So the class a row throws and the class another row's bundled
copy tests with `instanceof` are different constructor objects. Today this is harmless — the throw and
the one `instanceof` (`packages/mpd-workmate-plugin/src/index.ts :: failure`) are in the same bundle —
but the point of W0 is cross-row sharing. Direction: document `code`/`status` as the wire contract and
treat `instanceof HomeGuardRefusal` as same-bundle convenience, so W3-D does not build on class identity
across rows.

**N4. Test-time coupling points the wrong way.** The adapter package's suite now imports
`packages/mpd-workmate-plugin/src/index.ts` (to prove reachability, as the task required). Consequence:
the adapter suite reddens if the workmate package is renamed, removed or broken, even when the adapter is
untouched — during a refactor wave that is exactly what happens. Direction: none required for W0 (the
task mandated the arm); when the rename wave settles, consider moving arm (c) into the workmate package.

## Declined to judge

- **`verify:dist-fresh` red (25 of 34 targets stale)** — C9 makes dist the captain's integration step and the lane was forbidden to rebuild; W0 touched no dist file (`git status` clean under `packages/*/dist`), which is the property that *is* in scope. Judged as integration state, not a defect.
- **`bun test packages/mpd-dsh-adapter-plugin` not green (312 pass / 1 fail)** — the failing row is the cross-package coupling inventory, whose 4 entries are `mpd-autoproject-plugin` (new) and `mpd-ulw-plugin` / `mpd-boulder-plugin` (stale): all W1-B's rename/merge, none of them a file W0 touched. Judged as a red owned by another lane; W0's own acceptance is met modulo it.
- **`verify:dist-fresh`'s NOT COVERED row (`mpd-mcp-codegraph/dist/serve.js`)** — pre-existing declared exception, unrelated to this wave.
- **README / doc paragraphs for the new adapter exports** — the contract's wave table assigns `packages/*/README*.md` to W5; the adapter's file header lists *seams* only and the guard is not a seam, so nothing there is stale.
- **Whether `realUserHome` should be public adapter surface** — step 1 of the task explicitly ordered it exported; its implementation is a byte-for-byte port, so reviewing its Windows/`/etc/passwd` fallbacks would be judging pre-existing code.
- **The message template duplicated in the test** — deliberate: the contract demands a byte-identical refusal, so pinning the literal string is the correct assertion shape, not a copy-paste smell.
- **`memory.globalDir` design itself, and the memory archive hook (`onPostToolExecute`)** — W3-D scope per §4.7; only the *guard contract* it will bind to is judged in M1.
- **The pre-existing `mpd-workmate` dist-based arms** — they still exercise the shipped (unrebuilt) dist and pass; whether they keep passing after the captain's rebuild is integration's to observe, and I must not build.
- **Unused-looking `WORKMATE_ALLOW_REAL_HOME_ENV` export** — still referenced by the row's thin binding, so it is a preserved public surface, not dead code.

## Verdict

**PASS** — the guard move preserves the T-43 refusal byte-for-byte (verified by differential probe, not
by reading the writer's claim), leaves exactly one predicate in the tree, adds a genuinely discriminating
pin that cannot touch the real home, and smuggles in no unrelated behaviour; the Medium and the Nits are
forward notes that do not block the integration of W0.

## Evidence measured (commands and observed results)

| Check | Command | Observed |
|---|---|---|
| workmate suite | `bun test packages/mpd-workmate-plugin` | 62 pass / 0 fail (6 files) |
| adapter suite | `bun test packages/mpd-dsh-adapter-plugin` | 312 pass / 1 fail — the coupling inventory (W1-B's entries) |
| new pin alone | `bun test packages/mpd-dsh-adapter-plugin/test/home-guard.test.ts` | 6 pass / 0 fail |
| types | `bun run typecheck` | exit 0 |
| comments | `bun run verify:comments` | PASS — 533 files, and `--list` shows it inspects the new test |
| dist discipline | `git status --porcelain -- 'packages/*/dist'` | empty (no lane rebuild) |
| dist freshness | `node scripts/verify-dist-fresh.ts` | FAIL 25/34 stale — integration state (C9) |
| behaviour equivalence | `evidence/autoproject-refactor/w0/probe-equivalence.ts` — shipped `assertMutationSandboxed` vs new `assertHomeMutationSandboxed`, 7 env arms, identical root | **EQUIVALENT, 0 mismatches**; refusal message/code/status identical (raw output in `probe.log`) |
| pin discrimination | `evidence/autoproject-refactor/w0/probe-falsifiability.ts` — same arms against the faithful pre-fix predicate (`realHome = $HOME \|\| homedir()`) | arm (a) `REFUSED` pre-fix vs `ALLOWED` now → **DISCRIMINATES**; arm (b) is the non-discriminating control |
| duplicate copy / dead helper | repo grep for `realUserHome`, `assertHomeMutationSandboxed`, `real-home-refused` | exactly one definition (adapter) + one thin binding (workmate); old imports `userInfo`/`resolve`/`sep` gone and unused |
| class consumers | repo grep for `WorkmateError` outside the workmate package; for `ALLOW_REAL_HOME`/`real-home-refused` in `skills/`, `scripts/`, `docker/` | none — reparenting breaks no consumer |

## Bounds of this review

**Not read in full:** the two changed files end to end (they are ~3.5k lines each) — I read every hunk,
the guard region, all four `assertMutationSandboxed` call sites, the web `failure` handler and the module
header; the workmate tool-registration block beyond its error-propagation shape was not audited.
**Not run:** the Docker lane, `preset-conformance`, a real mount boot (none is named for W0 and none is
needed for a pure move with no tool-schema change), `verify:gate`-family sweeps owned by W1-B, any
rebuild of `dist/**` (forbidden by C9 to the lane, and I do not build as reviewer), and any git write.
**Not verified:** the writer's claim that "3 refusal arms go red with the throw removed" — I substituted
my own differential and discrimination probes, which test the same property from the outside.
