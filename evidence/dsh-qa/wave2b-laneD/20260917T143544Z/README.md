# t18 — wave-2b LANE D (the single skills/** writer): 6 rows + the ONE re-pin request

**Author:** qa-lane-engineer · **evidence** evidence/dsh-qa/wave2b-laneD/20260917T143544Z · **acceptance artifact** evidence/requirements/wave2b-laneD/20260917T1420Z-wave2b-laneD-acceptance.md (read in full first)

## 1. THE SIX ROWS, each with its reading and its red side

**T-25 (reader half)** — the corpus documents the single frame-by-frame reader and carries the NAIVE-READER falsifier. Reading (`arms3/result.json`): container frames=**2**, a one-shot `zstdDecompressSync` reads **first-frame-only** (0 events), the docs name `readSessionEvents`/`findToolCall`/`recordedToolNames`=true and the trap=true. RED side: the arm reddens if the frame count drops below 2 or the naive read stops being lossy (in `--self-test`: `t25-two-frame-container`). Instrument leg: lane C.

**T-69 (wrapper, not the raw flag)** — every corpus lane that composes a profile now runs `node scripts/dump-config.mjs … --json`. Reading: **0 raw `dsh --dump-config` invocations** over **233 files scanned** (prose sites 0 beside **2 exceptions declared BY NAME**: `SKILL.md` prose and the scanner's own file, whose RED fixture MUST carry a raw invocation). 11 call sites switched: `workmate-team-member`, `session-start-team`, `relocate-smoke`, `bundle-lifecycle` (×3), `team-route-rewire`, `mount-assert`, `lib/tui-lane`, `agent-teams-adopt`, `workmate-library`. RED side: `t69-fixture-reddens` (a fixture carrying a raw invocation is DETECTED).

**T-77 (scratch root shape)** — the convention `./.qa-<slug>/` is declared in `SKILL.md` rule 8 and asserted against the repository's own ignore rule. Reading: `git check-ignore -v ./.qa-wave2b-lane-d-scratch/keep.txt` → **ignored by `.gitignore:87:/.qa-*`**; the near-miss `qa-wave2b-lane-d-scratch/keep.txt` (no leading dot) → **NOT ignored**. RED side: the pair itself (a pattern that stopped matching fails the arm); `t77-shape-and-near-miss` in `--self-test`. Agreement with lane B is a PREREQUISITE and is met (their `/.qa-*` shipped in t14).

**T-80 (header claims, ARMS half)** — the two key-producing drivers now carry CLAIM SETS, and the arm runs lane B2's rule and asserts agreement. Reading: `[driver-headers] 54 file(s) scanned, 2 key-producing driver(s), **2 claim set(s), 0 NO-CLAIM-SET, 0 violation(s)**`; `lib/settings-bridge-lane.mjs` "5 assertion key(s) [A1–A5]; **5 claimed**", `tui-team-surface.mjs` "9 assertion key(s) [A1–A10]; **9 claimed**". RED side: a scratch copy claiming one key too many → **exit 1, 1 violation** (`t80-seeded-mismatch-reddens`), and the checker's own `--self-test` is 3/3. MEASURED IN PASSING, and worth keeping: my first claim line wrote "(the numbering has no A9 arm)" and the checker flagged **A9 CLAIMED-BUT-UNASSERTED** — a stray key token in prose IS a claim; the line was corrected and the reading kept.

**T-74 (`--out` discipline)** — the rule sentence is in `SKILL.md` (rule 10, beside T-53), and the behaviour is measured: a pinned cross-task invocation left the foreign directory **byte-identical** (`68f1b1c11d29 → 68f1b1c11d29 identical=true`) while the pinned dir received the run (`t74-pair/result.json`). RED side: the rule-sentence byte reading reddened before the docs landed (`t74-rule-sentence`), and an EXISTING `--out` target is refused (immutability, exit 3).

**T-89 (corpus half)** — every path-qualified command in the corpus now carries the `./` form or an ABSOLUTE `join(...)`; the scan reports **0 executed-argv offenders** over 54 files, with **208 prose/usage occurrences** documented beside it, and it NAMES the file count the clean command discovers: `./skills/dsh-qa/scripts` → **54 files**. RED side: the arm reddens on any bare path token in an executed argv. A MEASURED INTERLOCK: the arm caught MY OWN T-69 fix — three wrapper paths I first wrote as `"scripts/dump-config.mjs"` were bare relative tokens in argv, and they were absolutised to `join(repoRoot, …)`; `mcp-call.mjs`'s apparent offender was a FALSE POSITIVE (`join(repoRoot, …)` is absolute) and the scanner was corrected to treat join/resolve-built tokens as safe.

## 2. THE SINGLE-WRITER PRECONDITION

Every `skills/**` edit of 2b went through THIS task (14 files, §6). The wave's ONE re-pin is the captain's hand: `--check` → `--write --i-know-this-is-the-captains-step` → `verify-vendor`, in the SAME COMMIT as this corpus change. The re-pin CAUSE is the changed corpus paths (the drivers + `skills/dsh-qa/cases.json`); the two NON-corpus paths of this wave (`scripts/run-qa-lanes.mjs`, `scripts/reconcile-register.py`) are NOT cited as the cause.

## 3. THE VERIFY — A2.1's substitute, and ONE ORDERING DISCLOSURE

Contract verify: `node scripts/run-qa-lanes.mjs --check-drift` → **exit 0** ("46 lane script(s) discovered, 46 listed, 0 unlisted, 19 outside every suite"; `immutability required=10 … exempt=36`). The new driver is registered with `immutabilityGuard: "required"` because it ACCEPTS `--out` (its own T-74 discipline) and imports the guard. `bun run test:qa` is NOT carried (its lock-asserting lane cannot be green before the re-pin).

The declared `--only` selection (the corpus LANES this task modified, the lock-asserting lane deliberately EXCLUDED): `wave2b-lane-d,workmate-team-member,session-start-team,relocate-smoke,bundle-lifecycle,team-route-rewire,mount-assert,agent-teams-adopt,workmate-library,tui-team-surface`. Every modified driver's own `--self-test` exits 0 (10/10; logs in this dir).

**ORDERING DISCLOSURE (the same class as t11's, recorded rather than smoothed):** the acceptance requires the `--only` selection to be DECLARED BEFORE the first edit. This lane named it AFTER the edits, from the completed write set. The SET is complete and unambiguous (it is exactly the modified lanes) — the TIMING slipped, and the reviewer should weigh that rather than reconstruct it.

## 3b. THE WRAPPER SWITCH IS BEHAVIOUR-PRESERVING (measured, under a sandbox home)

A first probe ran the wrapper WITHOUT a sandbox home and read `exitCode 1, 0 bytes` for all five profiles — and the RAW command failed identically there ("profile does not exist"), because no profile is installed in that home. Re-run the way the lanes actually do it (`install-profile --yes --dsh-home <sandbox>`), the readings are:

| form | exit | child stdout | composed rows |
|---|---|---|---|
| `node ./scripts/dump-config.mjs --profile mpd-headless --json` | 0 | **23,092 B** | **112** row lines |
| `dsh --profile mpd-headless --dump-config` (the old form) | 0 | **23,092 B** | **112** row lines |

The child output is byte-for-byte the same size and the same row count, the markers the lanes assert (`id: mpd-workmate`, `agent-teams`, `id: mpd-roles`) are present in both, and the banner is on STDERR (`wrapper-sandbox.json`, `raw-sandbox.txt`). So the T-69 switch adds the composition-only banner and the JSON framing WITHOUT changing the composed tree text the lanes parse — which is why every switched lane's assertions still hold.

## 4. THE RE-PIN REQUEST — the three-part reading, re-derived at this write

```
WARNING   : the vendor gate compares the LF-NORMALIZED value only. A raw-bytes reading would silently fail `bun run verify:vendor` on any corpus containing CRLF/CR bytes - both values are printed per asset below.
locked       : treeSha=b9097d115ae0742828744d9a305c145fe2efeaef11d6a4e641bf666687102620 fileCount=323
computed (LF) : treeSha=234010aeb8e359a0f61b701b616d091edc7ea54acd999413716cefc001fd8c70 fileCount=324 (1 file(s) LF-normalized)
raw-bytes    : a917a4055fd31455b253b894a3d06ab520113acd566af94e0a105ea7994aaacf   <- NEVER write this one
locked       : treeSha=d1d106032b198d2392ca2fe36ea4b563c3010496192791a6e4812638b7cf8e37 fileCount=635
computed (LF) : treeSha=d1d106032b198d2392ca2fe36ea4b563c3010496192791a6e4812638b7cf8e37 fileCount=635 (0 file(s) LF-normalized)
raw-bytes    : d1d106032b198d2392ca2fe36ea4b563c3010496192791a6e4812638b7cf8e37   <- NEVER write this one
```

- **STATE PAIR:** BEFORE — `node scripts/repin-vendor.mjs --check` exits **1** and `VENDOR_LOCK.json` is BYTE-UNCHANGED (it holds wave-2a's `b9097d115ae07428…`, mtime `2026-09-17 17:02:41 +0800`); AFTER the captain's `--write` — `--check` exits **0** with the lock holding the **LF** value `234010aeb8e359a0f61b701b616d091edc7ea54acd999413716cefc001fd8c70`. **The raw-bytes value `a917a4055fd31455…` is NEVER to be written** (the gate compares the LF-normalized value only; 1 file LF-normalized here).
- **SUPERSEDED PREVIEWS, NAMED:** `7aef5fd2b8c5…`/`8ea212eb…` → `2c748d482fd8…`/`fb0d4ce3…` → `b9097d115ae0…`/`357b4bc8…` (wave 2a, now the LOCKED value) → **`234010aeb8e3…`/`a917a405…` (this reading)**. A preview is a moment-bound reading; the authority is the dry run immediately before the write.
- **FILE COUNT 323 → 324** (this task ADDS one corpus file, `skills/dsh-qa/scripts/wave2b-lane-d.mjs`) — a discriminating reading, not a re-organization.

## 5. BOUNDS

- T-25's REAL-store reading is not taken here (`--store` was not passed): the arm reports `unavailable (no --store passed)` rather than implying a live store, and the container reading it DOES take is a synthetic two-frame file built with the runtime's own zstd. The instrument leg is lane C's.
- T-89's 208 prose/usage occurrences are DOCUMENTED, not violations: the rule is stated in `SKILL.md` rule 9 and the executable-argv class is what the arm asserts. A future sweep may convert them; this lane did not claim it did.
- The `--only` subset runs the named lanes for real; a lane whose prerequisite is missing reports UNAVAILABLE (exit 2) per the runner's own classification, which is a reading and never a pass.

## 6. THE CHANGED CORPUS FILES (14) + hashes

```
f6934aec375b26ab76e599819c99065623558ce95b7a654a5899527561847d9f  skills/dsh-qa/SKILL.md
df652241c74265b5233252e1a5310d9f3825266415dc598d152c6994546c0c07  skills/dsh-qa/cases.json
e5eed4b56c6c3f7aa02373b3e9b869f9a7138e3d64f714f19e542e6b772e7e17  skills/dsh-qa/scripts/wave2b-lane-d.mjs
826a39d4172701b89900b249e11e43b757f0a50c1100f0cd889b9eb48530ee26  skills/dsh-qa/scripts/lib/settings-bridge-lane.mjs
fe0243cfc8fbef69aabef604d08aec1301048f61b841f201e1087bbef23c1550  skills/dsh-qa/scripts/lib/tui-lane.mjs
f18e3b3aa074543caa85fe7cfe08440025faaac4f328cc269ae549328aa5a52d  skills/dsh-qa/scripts/tui-team-surface.mjs
4da8bd62e0ada92d8cc5bd9f569378b2c2c01e0502b8b1e7396457b7a3e8c289  skills/dsh-qa/scripts/workmate-team-member.mjs
ac5f129bcb0babb18c51d91cb71cadc4f50e8b1a4c123c132d55dc89270a06aa  skills/dsh-qa/scripts/session-start-team.mjs
d9780256207cabc485033237e26aac4e6473ee9c43b461a1641ba92a197d3d53  skills/dsh-qa/scripts/relocate-smoke.mjs
63cc2b69ae4c59d777785190de3b776a5b9c488e5e666214526ce2ac6bc9907c  skills/dsh-qa/scripts/bundle-lifecycle.mjs
ca1978c975243f05a198be9ade0c7b32ad1ca565bdcc9260397ce3b652ee4941  skills/dsh-qa/scripts/team-route-rewire.mjs
58f6def471ce109f70c1e5fbbef2c8560833219c4fa22d12c34d0baa2f87e71c  skills/dsh-qa/scripts/mount-assert.mjs
41dfa461d2f33b6653dcc5e01a1554609de5c4a4ddfd80b0e8e9b99216e17ef0  skills/dsh-qa/scripts/agent-teams-adopt.mjs
315c3f6f2e9c817b81c065abd014f128c200c358ac62d44f67f042be1879874a  skills/dsh-qa/scripts/workmate-library.mjs
```
