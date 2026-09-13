# Software-type QA case standard (mpd) — normative spec + worked example

**Task**: t9 (`work`, Planner, design-only) · **Author**: Planner (read-only) · **Date**: 2026-09-13
**Deliverables this file is half of**: `evidence/rtl-extraction-residual/qa-standard/{standard.md, inventory.md}`
(these two files are the input t8's contract names; `raw/` holds the prototype and its proven runs).
**Status**: DESIGN. `skills/**` is edited by the repair task (t8), never here. Nothing in this file has
been landed; §5.6 names the exact landing deltas.
**Audience**: the repair task (t8), its verifier (t11), the reviewer (t6) and the captain.
**Language**: English-only, like every agent-facing artifact. This is an evidence/process record
(AGENTS.md §3), so it is exempt from the bilingual doc rule; if any of it is copied into a
human-facing doc (`docs/**`, a package README), that doc's EN/ZH pair must be updated in the same
change.

---

## 0. Why this standard exists

The user's directive of 2026-09-13 (captain's record: `.mpd/memory/.../rtl-mtzhwu21.md`): *the
confirmed defects are fixed now, and future development test cases are SOFTWARE-type (e.g. a small
game), not RTL/EDA cases.* The RTL extraction (`12291a7`, `d50934e`) moved the RTL surface to
`@mpd-dsh/silicon`, but the mpd **test-case corpus still carries RTL/EDA cases and RTL golden
assets** (measured in `inventory.md` §2–§4). This standard defines:

1. what "software-type case" means as a **checkable property** (§1),
2. the **corpus rules** the mpd case corpus must satisfy afterwards (§2),
3. the **anatomy every case must have** (§3) — derived from this repo's own best cases, not invented,
4. how an RTL/EDA case **leaves** the corpus without leaving a vacuum or a stale reference (§4),
5. a **worked example that runs today** (§5) — the small-game case, proven green in both lanes,
6. the **ordered landing checklist** for t8 (§7).

Design principle taken from AGENTS.md §2: *evidence without evidence is incomplete.* Every rule below
therefore names the exact command that decides it, and §8 records the commands and outputs that
prove this document's own claims.

---

## 1. Definitions

| Term | Definition |
|---|---|
| **QA case** | One executable script under `skills/dsh-qa/scripts/<slug>.mjs` with exactly one `SKILL.md` case-table row, a `--self-test` lane and a real lane. |
| **Golden task** | A graded development fixture under `tests/golden/**` (fixture + `*.bench.mjs` runner), run explicitly, never auto-discovered by `bun test`. |
| **Software-type case** | A case whose **subject** is the harness/bundle software surface — plugin rows, tools, sessions, routes, files, processes — exercised through ordinary software artifacts (a program, a CLI, a small game, a config, a route). |
| **RTL/EDA-type case** | A case whose subject requires an HDL artifact or an EDA toolchain (Verilog/SystemVerilog/UVM sources, `iverilog`, `verilator`, `vcs`, `cocotb`, `verible`, `slang-server`, the `mpd_verif_*` tool family, an HDL LSP registry, a waveform tool). |
| **Bridge case** | A case allowed to *name* the silicon bundle but forbidden to carry RTL payload. The audit's own bucket model (t2's `scope/acceptance.md`: BRIDGE-BY-DESIGN) permits this shape; **this standard does not create one** — see §4.4. |

Classification is decided by the **subject of the assertion**, never by a word in a comment. Two
grep false positives measured on this tree and pre-empted in §2 (C2): `memory.vcs` (the git/svn
config key) collides with the EDA tool `VCS`; `workmate-library.mjs` uses "Verilog counter
specialist" as *sample task text* while its subject is the workmate library.

---

## 2. Corpus rules (normative)

### C1 — slug ↔ row bijection
`skills/dsh-qa/scripts/*.mjs` and the `SKILL.md` case-table rows are a **bijection**: every script
has exactly one row with the same slug, every row names an existing script.

```bash
cd /root/dshProj/my-power-dsh
diff <(ls skills/dsh-qa/scripts/*.mjs | xargs -n1 basename | sed 's/\.mjs$//' | sort) \
     <(grep -oP '^\|\s*\K[a-z0-9][a-z0-9-]*(?=\s*\|)' skills/dsh-qa/SKILL.md | grep -v '^slug$' | sort)
```
**Measured today: NON-EMPTY (2 defects).** `dual-track-smoke` (script) vs `llm-dual-track` (row),
and `rtl-verif` (script, no row). t8 must leave this command **empty** (§7 step 3).

### C2 — no RTL/EDA case remains
```bash
# C2a: no EDA-flavoured case slug
ls skills/dsh-qa/scripts | grep -Ei '^(rtl|verif|hdl|uvm)'            # must print nothing
# C2b: no RTL/EDA payload in the corpus (scripts + SKILL.md)
git grep -nEi 'iverilog|verilator|cocotb|verible|slang-server|mpd_verif_|systemverilog|verilog|rtl-ip|rtl-verif' \
  -- skills/dsh-qa                                                  # must print nothing
# C2c: the RTL golden fixture tree is gone from mpd
test ! -d tests/golden/fixtures/verilog && echo "no RTL golden tree"
```
The C2b lexicon is deliberately **case-insensitive and narrow**: `\bvcs\b` is excluded because
`memory.vcs` (a git/svn config key used by `plan-c-smoke.mjs:55,81-82` and
`tool-output-validation.mjs:23-24`) is not EDA, and a bare `verif` term collides with unrelated
prose. **Measured today C2b hits 5 files**: `SKILL.md:62` (the `rtl-ip-profile` row),
`scripts/rtl-ip-profile.mjs` (25 lines), `scripts/rtl-verif.mjs` (42 lines),
`scripts/dual-track-smoke.mjs:21` (**comment-only** mention of the retired case name), and
`scripts/workmate-library.mjs` (3 lines of **sample task text** — an explicit, reasoned exemption,
`inventory.md` §7).

### C3 — the corpus states its own rule
`skills/dsh-qa/SKILL.md` carries one sentence under `## Cases` making the software-type rule
explicit, so the next author cannot re-add an EDA case by accident. Required wording (verbatim):

> All cases in this corpus are **software-type**: they exercise the harness/bundle software surface
> (rows, tools, routes, sessions, files, processes) and never an EDA/RTL toolchain. The RTL/EDA
> corpus and its golden fixtures live in the silicon sub-bundle
> (`gitee.com/nop_chip/my-power-dsh-silicon`).

### C4 — the human-facing catalog stays in sync
`docs/development.md` §4 (QA case catalog) and its `docs/development.zh-CN.md` pair list the new
case in the same change (bilingual rule, AGENTS.md §2/§3):
```bash
grep -c 'software-smoke' docs/development.md docs/development.zh-CN.md   # both >= 1
```

### C5 — gate honesty (no green-by-vacuity)
Retiring the two RTL cases removes the **only mpd-side subjects** of
`scripts/verify-rtl-references.mjs` (its `CASES` list, `:26`). The gate must not stay green while
its output still claims to audit them:
```bash
node scripts/verify-rtl-references.mjs          # exit 0 AND the output discloses the narrowed scope
```
Required: `CASES = []`, the header/usage text updated, and the run line printing the mpd-side case
count with a reason (e.g. `mpd-side cases: 0 (retired by t8 — the corpus carries no RTL case)`).
The positive/negative/owner controls of its `--self-test` stay untouched.

### C6 — `test:qa` covers the whole corpus, self-tests only
`package.json`'s `test:qa` loop is glob-based, so no registry edit is needed for a new or retired
case; the rule is that after the repair:
```bash
bun run test:qa ; echo "exit=$?"     # exit=0, and the log lists software-smoke, not rtl-verif/rtl-ip-profile
```
`test:qa:all` differs from `test:qa` **only in its log label** (`[test:qa:all]`), so it no longer
serves its original "no-allowlist" auditability purpose. **Do not touch it in this repair** (minimal
diffs); record it in the report as a pre-existing redundancy.

### C7 — vendor fingerprint discipline
Every `skills/**` edit invalidates `VENDOR_LOCK.json`'s corpus `treeSha`/`fileCount`; the re-pin
rides in the **same commit** as the skills change, comes from `verify-vendor`'s own output (never
hand-written), and the whole wave has **exactly one** `skills/**` writer (AGENTS.md §9/§11):
```bash
node scripts/verify-vendor.mjs ; echo "exit=$?"    # exit=0 after exactly one re-pin
```

---

## 3. Case anatomy (normative — A1…A10)

Every case in the corpus satisfies all ten. (Each is already the house style; the list makes the
style checkable and gives the new case a template.)

| Id | Requirement | How it is checked |
|---|---|---|
| A1 | **Identity**: `skills/dsh-qa/scripts/<slug>.mjs`, slug `[a-z0-9-]+`, one `SKILL.md` row, same slug. | C1 command |
| A2 | **Header states the contract**: what carries the proof, what does NOT, the isolation model, the evidence path. | read the first 40 lines |
| A3 | **`--self-test` is offline and dependency-free**: no network, no model, no `dsh`, no credentials; exits 0. | `node <case>.mjs --self-test` on a box without `dsh` |
| A4 | **The real lane proves a REAL result**: a mounted row, a real tool call result, or a real program output — never "it ran". | `result.json` carries the raw result AND the verdict booleans |
| A5 | **Isolation**: sandbox `DSH_HOME` + `HOME` + workspace, and every dsh-booting lane calls `assertSessionsSandboxed` from `scripts/lib/workspace-isolation.mjs` (`sandboxWorkspace` supplies the cwd). | grep the case for the helper; the assertion is in `result.json` |
| A6 | **No provider credential required**: the model step is answered by a local OpenAI-shaped stub with a throwaway key (the `readonly-deny.mjs` pattern). A genuinely live-model lane is opt-in, named (`--live`), and never on the `--self-test` path. | run the real lane with no `DEEPSEEK_API_KEY` from the machine |
| A7 | **Evidence**: `evidence/<domain>/<slug>/<timestamp>/result.json` + `output.log`; historical evidence is never rewritten. | the path in the case's own output |
| A8 | **English-only** strings, logs, comments. | review |
| A9 | **Determinism**: fixed seeds/inputs, bounded timeouts, no wall-clock or ordering dependence in the assertions. | two consecutive runs agree |
| A10 | **Falsifiability**: every load-bearing assertion has a control that must go RED (a mutated fixture / a negative lane), and the RED is asserted. | the control's failure is in the `--self-test`/control lane output |

A10 is the rule this repo already paid for twice (`readonly-deny`'s re-injection control, the
RTL-reference gate's negative control). A case whose assertions cannot be shown to fail is
decoration.

---

## 4. Retirement rules (normative — R1…R6)

| Id | Rule |
|---|---|
| R1 | A retired case loses **both** its script and its `SKILL.md` row in the same change (C1 stays a bijection). |
| R2 | **Every inbound reference is updated in the same change** — other cases' comments, `scripts/**`, `docs/**` (+ `*.zh-CN.md`), package README pairs, `AGENTS.md`, `package.json` scripts. The sweep is enumerated per path in `inventory.md` §6. |
| R3 | **No silent coverage loss**: the report states where the retired coverage went (silicon repo QA) or names the gap and its owner. |
| R4 | **Gate coherence**: a gate whose subject the retirement removes is re-pointed, or retired with the reason printed in its own output (C5). A gate that silently loses its subject is a defect, not a cleanup. |
| R5 | `skills/**` has one writer and one `VENDOR_LOCK` re-pin per wave (C7). |
| R6 | **History is not rewritten**: `.silicon-extraction/removal.log`, `t5-closure-evidence/**`, `evidence/dsh-qa/rtl-*/**` and every other record of the strip stay byte-untouched. |

### 4.4 Ruling: no bridge case in this repair
The audit's bucket model allows a BRIDGE-BY-DESIGN case (a bare reference, no RTL payload). This
standard **declines to add one**: (a) the user's directive is about the corpus's future cases and an
RTL bridge would immediately contradict C2's spirit; (b) the mpd-side carrier the old
`rtl-ip-profile` case asserted (`rtl-ip` in the bundle patch) no longer exists — its skip path
`skipped-rtl-ip-carrier` proves the assertion is already inert; (c) silicon owns its own QA. The
gap is named and owned in `inventory.md` §8, not hidden.

---

## 5. Worked example — `software-smoke`

### 5.1 What it proves
The mpd bundle's **software development loop end-to-end on a tiny deterministic game**: a real
`dsh` session, in a fully sandboxed home/workspace, creates a small game with the **`write`** tool
and runs it with the **`bash`** tool; the case then replays the program's **real transcript**
through its **own oracle** — legality, optimality, winner, determinism — and requires a **mutation
control** to go RED. Where the retired `rtl-verif` case proved the EDA toolchain path, this proves
the write → execute → observe path with **no EDA/RTL toolchain in the loop**.

### 5.2 The fixture (the "small game")
A 3-pile take-away game (Nim; take 1–3 from one pile; last stone wins), 60 lines of plain
JavaScript, two commands:

```
node nim.mjs move --piles 3,4,5 --seed 7   -> "move <pileIndex> <count>" | "move none"
node nim.mjs play --seed 7                 -> "ply <n> P<1|2> takes <k> from pile <i> -> a,b,c" lines + "winner P<1|2>"
```

The policy is optimal (a move from a winning position — nim-sum ≠ 0 — must leave nim-sum 0; from a
losing position it takes the documented fallback, 1 from the first non-empty pile) and the
tie-break among equally-optimal moves is seed-driven, so determinism is a real assertion rather
than a tautology. The **mutation point** is one line:

```js
const win = optimalMoves(p) // MUTATION POINT: optimality policy
```
replaced in the control fixture by `const win = [] // MUTATION: optimality policy removed`.

### 5.3 The oracle (independent)
The case never imports the fixture. It re-implements the rules from the *documented output format*
and asserts:

| # | Assertion | Independence |
|---|---|---|
| O1 | every ply is legal (pile in range, 1 ≤ take ≤ 3, ≤ pile size) | rules, not policy |
| O2 | the declared state equals the state the oracle replayed | transcript ↔ rules |
| O3 | **every move from a winning position leaves a losing position** (nim-sum 0) | game theory, not the program |
| O4 | in a losing position the move is the documented fallback | documented contract |
| O5 | the declared winner is the player who took the last stone, and a terminal state always has one | rules |
| O6 | ply count is plausible (1…15) and the game is decided | rules |
| O7 | the winning position `3,4,5` is won by P1 under optimal play | game theory |
| O8 | two runs in the same session print byte-identical transcripts (`cmp`) | determinism |
| O9 | the file the session wrote equals the fixture bytes (content match) | the `write` tool really wrote it |

### 5.4 Lanes

| Lane | Needs | What it does |
|---|---|---|
| `--self-test` (offline) | `node` only | fixture semantics; the oracle GREEN on the fixture (O1–O7 on a local run, O8 by two runs); the oracle **RED** on the mutated fixture (both the `play` and the `move` lanes) — the falsifiability proof |
| real lane (default) | `dsh` + `node`; **no credential** | `scripts/install-profile.mjs --yes --dsh-home <sandbox> --profile mpd-headless --skip-toolchain`; a local OpenAI-shaped stub answers the model step (throwaway key) with a real `write` call, then a real `bash` call that runs the game twice, checks `cmp`, prints the transcript and four position probes; the case replays the **bash tool's real result** through the oracle, asserts the sandbox session store (`assertSessionsSandboxed`) and writes evidence |

The stub is state-driven (it issues `write` when no tool result is present, `bash` once a write
result is present, a final message afterwards) — not call-index-driven, because this harness also
issues zero-tool side requests (measured: 4 stub calls in the run below; the session-title request
carries 0 tools).

### 5.5 Proven (this is the point of the worked example)
The prototype at `raw/software-smoke.prototype.mjs` was **run on this tree** (`HEAD 32ae54d`):

```bash
node evidence/rtl-extraction-residual/qa-standard/raw/software-smoke.prototype.mjs --self-test
# -> [software-smoke self-test] ok: fixture semantics + deterministic self-play (winner P1, 11 plies)
#    + 4 oracle probes green, mutation control RED (9 violation(s))          exit 0

MPD_SMOKE_OUT=<raw>/prototype-evidence \
  node evidence/rtl-extraction-residual/qa-standard/raw/software-smoke.prototype.mjs
# -> [software-smoke] ok=true    exit 0
#    install:   exit 0
#    session:   exit 0 · stubCalls 4 · write+bash tool calls really ran · no MISSING_CREDENTIAL
#    artifact:  exists=true · contentMatches=true · deterministic=true · optimal=true
#               oracle: winner P1, 11 plies, 0 problems; probes 3,4,5 -> move 0 2 / 1,2,3 -> move 0 1
#                       / 7,5,3 -> move 0 1 / 2,2,0 -> move 0 1, 0 problems each
#    isolation: checked=1, keys=["--tmp-mpd-software-smoke-OySbH3-ws--"]   (no repo-keyed store)
```
Raw evidence: `raw/software-smoke-selftest.log`, `raw/software-smoke-real.log`,
`raw/prototype-evidence/{result.json,output.log}`. Reproduced twice (two independent real-lane
runs, identical verdicts, different sandbox paths).

### 5.6 Landing deltas (exactly two)
```bash
cp evidence/rtl-extraction-residual/qa-standard/raw/software-smoke.prototype.mjs \
   skills/dsh-qa/scripts/software-smoke.mjs
```
1. replace the prototype's repo-root resolution with the house form
   `const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))`
   (the prototype keeps a `MPD_REPO_ROOT` override only because it lives under `evidence/`; the
   landed case must not);
2. replace the import with `import { sandboxWorkspace, assertSessionsSandboxed } from "./lib/workspace-isolation.mjs"`.
   (The evidence-dir default and the `MPD_SMOKE_OUT` override become dead code: point the evidence
   path at `evidence/dsh-qa/software-smoke/<timestamp>/` and drop the override.)

Then: `node skills/dsh-qa/scripts/software-smoke.mjs --self-test` (green), then the real lane once
(`node skills/dsh-qa/scripts/software-smoke.mjs` → `ok=true`, evidence written), then `bun run
test:qa` (the glob picks the case up automatically).

### 5.7 The `SKILL.md` row (verbatim, one line, no `|` inside cells)
```
| software-smoke | software dev flow | a REAL headless mpd session (local OpenAI-shaped stub, throwaway key — no provider credential) writes a tiny deterministic game with the `write` tool and runs it with the `bash` tool in a SANDBOX workspace; the case replays the program's REAL transcript through its OWN oracle (legality, optimality, winner, determinism) and requires the mutation control to go RED | RTL-extraction follow-up (t8) |
```

---

## 6. Recommended follow-up (NOT in this repair): a new golden software benchmark

The user's directive is about **development** test cases; the QA corpus is the bundle's own gate.
The development-case home in this repo is `tests/golden/fixtures/**` (`math.js` + `math.bench.mjs`
is the existing software-type precedent: a fixture with a **seeded bug**, run explicitly, RED by
design). **Retiring the RTL golden counterparts is in t8's scope (§7 step 4); *adding* a new
benchmark is the follow-up below (owner: the next wave).**

- `tests/golden/fixtures/nim/{nim.mjs, nim.bench.mjs}` — the §5.2 game plus a runner that grades a
  model's fix; seed one defect (e.g. delete the optimality policy, exactly the §5.2 mutation),
  document it RED-by-design like `math.bench.mjs`, and keep it out of `bun test` (name it
  `*.bench.mjs`).
- Why not in t8: t8's contract is a **repair with minimal diffs**; adding a graded benchmark is new
  capability, and the QA scaffold (§5) already satisfies "the software-type case exists with a
  passing `--self-test` and its SKILL.md row".

---

## 7. Ordered landing checklist (for t8 — atomic, with the proof after each step)

1. **Land the worked example** (§5.6) — `software-smoke.mjs` + its `SKILL.md` row (§5.7).
   *Proof*: `--self-test` green; one real-lane run `ok=true`; `bun run test:qa` still exit 0.
2. **State the corpus rule** (C3 sentence in `SKILL.md`).
3. **Retire the two RTL cases** (R1/R2): delete `skills/dsh-qa/scripts/rtl-{verif,ip-profile}.mjs`,
   delete the `rtl-ip-profile` row (`SKILL.md:62`), reword the comment mention
   (`dual-track-smoke.mjs:21`), and fix the `llm-dual-track` ↔ `dual-track-smoke` row/slug mismatch
   in the same pass so C1's command prints nothing.
4. **Retire the RTL golden assets and their references** (`inventory.md` §4, §6): delete the four
   `tests/golden/fixtures/verilog/**` files and `docs/adder4.md`/`docs/cnt8.md` (both
   sha256-identical to silicon); update `AGENTS.md:18-19,144`, the two
   `docs/rtl-gap-assessment*.md` bullet rows that cite them, and the `verify-rtl-references.mjs`
   `PENDING` entries.
5. **Keep the RTL-reference gate honest** (C5/R4): `CASES = []`, header/usage text updated, the
   mpd-side case count + reason printed in the run output, controls untouched.
   *Proof*: `node scripts/verify-rtl-references.mjs` exit 0 with the disclosure line.
6. **Fan out the remaining references** (`inventory.md` §6): `docs/development.md` (+ zh-CN) gains
   the `software-smoke` catalog row; `packages/mpd-bundle/README.md` (+ zh-CN) drops the stale
   `verif` row and the RTL-guide pointer; any doc that names a deleted path is re-pointed or the
   pointer removed.
7. **One `VENDOR_LOCK.json` re-pin** in the same commit as the skills change (C7), the value taken
   from `node scripts/verify-vendor.mjs` output.
8. **Run the six gates** (`bun run typecheck`, `bun test packages`, `node scripts/verify-vendor.mjs`,
   `node scripts/verify-rtl-references.mjs`, `node scripts/verify-rows-parity.mjs`,
   `bun run test:qa`) and paste exit codes + `git status --short` in `repair/report.md`.

**Do not touch** (R6 / t8's own non-goals): `.silicon-extraction/removal.log`,
`t5-closure-evidence/**`, `evidence/dsh-qa/rtl-*/**`, the sibling silicon repo, the RTL docs beyond
the specific references named in `inventory.md` §6.

---

## 8. Provenance of this document's own claims

| Claim | Command (all run at `HEAD 32ae54d`, 2026-09-13) | Result |
|---|---|---|
| Corpus baseline is green before the repair | `bun run test:qa` | exit 0, 25 scripts, all self-tests pass (`raw/test-qa-baseline.log`) |
| C1 is violated today | the C1 `diff` | 2 mismatches (printed above) |
| C2 is violated today | C2a/C2b/C2c probes | 2 RTL cases + 1 `SKILL.md` row + 1 comment-only mention + 1 sample-text exemption (`inventory.md` §7), RTL golden tree present |
| The mpd RTL golden assets are duplicates | `sha256sum` vs `my-power-dsh-silicon` | 4/4 fixture files + `adder4.md` + `cnt8.md` IDENTICAL |
| Four RTL docs have diverged | `sha256sum` vs silicon | `rtl-verif-guide{,.zh-CN}.md`, `rtl-gap-assessment{,.zh-CN}.md` DIFFER (§5 of `inventory.md`) |
| The worked example passes | §5.5 commands | self-test + real lane both exit 0, `ok=true` |
| The control is falsifiable | `--self-test` mutation lane | RED with 9 oracle violations |
| Anchors (settled hashes) | `raw/settled-hashes-*.txt` | `HEAD 32ae54dd…`, `SKILL.md e174a178…`, `rtl-verif.mjs c5d2414c…`, `rtl-ip-profile.mjs 74f1cee9…`, `dual-track-smoke.mjs 6cff9b97…`, `verify-rtl-references.mjs 34a1c8d6…`, `development.md 0ed75394…`, `development.zh-CN.md aea3b35f…`, `adder4.md 169c9e26…`, `cnt8.md 150cfdc8…`, `AGENTS.md 0c7e543e…` |

---

## 9. Open decisions for the captain (nothing silently dropped)

1. **The six RTL docs** (`docs/rtl-{verif,ip-flow}-guide{,.zh-CN}.md`, `docs/rtl-gap-assessment{,.zh-CN}.md`)
   — owned by the previous wave's t20 (migration), not by t8. Two of them reference the retired case
   path (`rtl-verif-guide.md:255`, `rtl-verif-guide.zh-CN.md:241`; the silicon copies say the same at
   `:256-257/:74`). Options: (a) leave them to t20 and record the dangling reference as DEFERRED with
   the owner (recommended — they are silicon-bound and their deletion is already planned);
   (b) have t8 repoint those two lines in the mpd copies (EN+ZH pair, same commit) and still leave
   deletion to t20. Either way: the dangling reference is *recorded*, not silently dropped.
2. **`workmate-library.mjs`'s "Verilog counter specialist" sample text** (`:19,23,129`) — subject is
   the workmate library, not HDL. Recommended: keep as an explicit, reasoned exemption
   (`inventory.md` §7) rather than spend a live-model re-run on wording. If the captain wants zero
   HDL tokens in the corpus, the edit is 3 lines plus the `note.includes(...)` assertion, and the
   case's live lane must be re-run for fresh evidence.
3. **`test:qa:all` is now byte-identical to `test:qa`** — its original auditability role (the
   no-allowlist lane) is obsolete; collapsing it is a follow-up, not part of the minimal repair.
4. **The silicon side owns RTL QA** — the retired coverage has no mpd-side replacement by design
   (R3). If the captain wants the silicon repo's own QA corpus created, that is a new task in the
   silicon repo, not a repairable defect here.
