# Lane B (t9) — T-63 / T-65 / T-67 / T-76

Owner: `packaging-engineer` (attempt 4, `dba6a84a-0dd0-458f-a478-f28c1759f683`). Evidence: this directory;
`result.json` is the machine-readable record, every log it cites sits beside it with a sha256 prefix in
`result.json.digests`. Re-run everything with `run-laneB-evidence.mjs`.

## 1. What changed

| Path | Change |
|---|---|
| `scripts/verify-pack-closure.mjs` | two new rules over the produced tree — CONTENT (bytes) and COMPLETENESS — plus the EXPECTED-drift class, `--pack-stamp`, an extended verdict line, and 11 new `--self-test` arms (22 → **33**) |
| `scripts/verify-dist-fresh.mjs` | new exported `buildFormFindings()`: a package's own `scripts.build` must be the runnable canonical form (cwd anchor + repo-root path-qualified args); wired into the gate and into `--self-test` (2 new arms) |
| `scripts/pack-mpd.mjs` | new `--out <dir>` (captain's PACKER ROUTE ruling), backward compatible: with no flag the target is the same expression as before and the output is byte-identical; `--out` with no value, or aimed at the repository root, is refused with exit 2 |
| `packages/mpd-ext-plugin/package.json` · `packages/mpd-team-watchdog-plugin/package.json` · `packages/mpd-tui-plugin/package.json` | `scripts.build` rewritten from the package-directory form to the canonical repo-root form **with the cwd anchor** (T-67's SCRIPT half) |

`dist/mpd-package` is never written by this lane: the read-only proof re-measures its stamp before and
after the whole step list (1190 files, newest mtime `2026-09-17T05:19:48.265Z`, **identical**).

## 2. Item → rule → falsifying control

- **T-63 (content staleness by bytes).** `checkContentHalf()` decides with the gate's EXISTING byte idiom
  (a buffer comparison; digests are for the report only) over every file present on BOTH sides of a
  verbatim copy: each `ROOT_ASSET_DIRS` tree and `packages/**` (1180 files). The three files the packer
  REWRITES are outside the sweep by construction (the packed `package.json`, `<packed>/cordis.patch.yml`,
  `packages/mpd-ext-plugin/dist/validator.js`). Controls: *artifact byte drift at unchanged presence*
  (fixture → exit 1, `CONTENT-DRIFT`, file named, `REFERENCES` absent); *one byte changed in a
  PRE-pack-mtime file of a byte-copy of the REAL artifact* (`docs/architecture.md` → hard `CONTENT-DRIFT`,
  exit 1, presence green); *byte-identical copy stays green*; **and the PACKER ROUTE arm**: a real scratch
  pack staged with `pack-mpd.mjs --out` is green, one byte changed inside it goes red (exit 1, exactly one
  violation), and the canonical artifact does not move across the pack.
- **T-65 (completeness).** Every `packages/<pkg>/dist/**` file in the tree must have an artifact
  counterpart; the ONE declared exemption (`packages/mpd-qa-roles-probe/`) is COUNTED in the verdict line
  (`exemption exercised: packages/mpd-qa-roles-probe/dist/index.js`) and can never become a silent skip.
  Measured: `completeness: 406 declared source file(s) compared, 405 present, 1 declared exemption(s),
  0 absent`. Controls: *ghost package dist in the source, no artifact counterpart* → exit 1, `COMPLETENESS`,
  path named; *the same shape for the exempt package* → exit 0 with the exemption printed.
- **T-67 (build form).** The three manifests carry the canonical repo-root command plus the cwd anchor, and
  the gate flags any package whose `scripts.build` is not that form, with the canonical string DERIVED from
  the offending segment. The 13-path-comment evidence is in `t67-build-form-diff.json`: repo-root form
  **13 comments / 11 distinct**, package-directory form **13 comments**, diff **26 lines (13 removed + 13
  added)**; the committed dist equals the repo-root form and NOT the package-directory form. AGENTS.md §6's
  "13 path comments / 11 distinct modules" reproduces exactly.
  **The acceptance's DECISIVE round trip is measured in `t67-round-trip.json`, and its premise had to be
  corrected first:** with the bare canonical command (no anchor) `(cd packages/<pkg> && bun run build)`
  exits 1 — `FileNotFound opening root directory "packages/<pkg>/src"`, because `bun run` executes a package
  script with the PACKAGE directory as cwd. The anchor fixes exactly that and changes no bytes (both forms
  build from the repository root). Measured for `mpd-ext-plugin` and `mpd-tui-plugin`: build exit 0, dist
  byte-identical before/after, then `verify-dist-fresh --only packages/<pkg> --quiet` → exit 0.
  `mpd-team-watchdog-plugin` is deliberately NOT round-tripped (see §4). Controls: `(g)` package-directory
  form → `BUILD_FORM` + derived canonical string + exit 1; `(g2)` canonical (anchored) form → no finding.
- **T-76 (agent-references by bytes).** `agent-references/` runs through the same CONTENT engine as every
  other declared tree. Control: a seeded mutation keeps the file PRESENT (every `REFERENCES` assertion stays
  satisfied — asserted with `!/REFERENCES/`) and reddens the byte rule naming
  `agent-references/troubleshooting.md`, on the fixture, on a real scratch pack, and on a byte-copy of the
  real artifact.

## 3. Readings (2026-09-17T07:5xZ, re-runnable via `run-laneB-evidence.mjs`)

- `node scripts/verify-pack-closure.mjs` → **exit 0**: `content bytes: 1180 compared, 1162 identical,
  0 drift, 18 expected-after-pack`; `completeness: 406 compared, 405 present, 1 exemption, 0 absent`;
  `pack stamp 2026-09-17T05:19:48.265Z (inferred)`; the 18 expected entries name the wave's post-pack
  writers row by row (lane A's `packages/mpd-agent-teams-plugin/lib/**`, lane B3's `agent-references/**`
  + `docs/**`, lane D's `skills/**`).
- `node scripts/verify-pack-closure.mjs --self-test` → **exit 0, 33/33 arms**. Reviewer note: that log
  contains ~20 `[verify-pack-closure] FAIL` lines BY DESIGN (the negative controls, each in its own child).
  Read the exit code and `self-test PASS: 33/33 arms`; never a bare `grep FAIL`.
- `node scripts/verify-dist-fresh.mjs --self-test` → **exit 0, 12/12 arms**.
- `node scripts/verify-dist-fresh.mjs --only mpd-ext-plugin` / `--only mpd-tui-plugin` → **exit 0, 2/2 and
  1/1 fresh** (the committed dists of the two packages this change touches).
- `t63-t76-seeded-mutation.json` → ALL READINGS BEHAVED AS SPECIFIED (real artifact: untouched copy green;
  one byte changed in a pre-pack-mtime file → hard `CONTENT-DRIFT` exit 1 with presence green; one byte
  changed in a post-pack-mtime file → the provenance-named EXPECTED class, exit 0; the same mutation with
  the stamp pinned → hard `CONTENT-DRIFT` exit 1).
- `t63-out-flag-equivalence.json` → ALL READINGS BEHAVED AS SPECIFIED: default invocation and `--out`
  stage **1190 files, set-equal, 0 differing**; the canonical artifact is untouched; a fresh pack differs
  from the canonical artifact in 18 files and **every one is explained by a post-pack writer** (0
  unexplained); `--out` without a value and `--out .` are refused with exit 2.
- `t67-round-trip.json` → BOTH ROUND TRIPS PASS AND REPRODUCE THE COMMITTED BYTES.
- `bun run verify:gates` → **exit 1, `[verify-vendor] FAIL - asset skills treeSha mismatch`** — expected and
  cross-lane (lane D edits `skills/**`; the single re-pin is the captain's t18 step). Reported as-is.

## 4. Two reds that are NOT this lane's (measured, causes named)

1. `node scripts/verify-dist-fresh.mjs` (repo-wide) is **exit 1**: `STALE
   packages/mpd-team-watchdog-plugin/dist/index.js` — committed `7b821135d24a9bdd` ≠ fresh
   `43fc1f52b781f776`. Cause, in `result.json.watchdog_stale_attribution`: t10 (lane C) is editing
   `src/engine.ts` (07:28:29Z), `src/machine.ts` (07:26:52Z), `src/actions.ts` while the committed dist is
   from 05:42:47Z. **Not a build-FORM artefact**: the path comments of the committed dist and of a
   canonical repo-root fresh build are IDENTICAL — only the bundled code moved. The dist is in t10's
   `inScope`; this lane's `inScope` is that package's `package.json`, and the wave runs one writer at a
   time, so the round trip and the rebuild are lane C's (message sent):
   `bun build packages/mpd-team-watchdog-plugin/src/index.ts --target node --format esm --outfile packages/mpd-team-watchdog-plugin/dist/index.js`.
2. `bun run verify:gates` — the vendor sub-gate, as above.

## 5. Bounds carried (stated where the claim lives, not hidden here)

1. **The EXPECTED class is a TIMESTAMP-ORDER discriminator, not content provenance.** The artifact carries no
   per-file digest manifest, so a mutation INSIDE an artifact whose source file also carries a post-pack
   mtime is classified expected (reported loudly, never silently). `--pack-stamp <iso>` is the escape hatch,
   and `t63-t76-seeded-mutation.json` demonstrates both classes on the real artifact.
2. **The inferred stamp is only valid for an artifact nobody wrote into since the pack.** Any write into the
   artifact — including the harness's own mutation — re-dates it; copies must preserve timestamps.
3. **The sweep covers `packages/**` and the six declared root trees.** The packer's other copies
   (`personas/`, `mpd-mcp-shared/`, `scripts/*.mjs`, `client.js`) are inline `cpSync` calls, not table
   entries, so covering them would duplicate literals the packer owns. Bounded OUT, deliberately.
4. **The cwd anchor needs git.** `cd "$(git rev-parse --show-toplevel)"` is what makes the canonical command
   runnable from a package directory; outside a git work tree it fails LOUDLY (measured: exit 1 with
   `FileNotFound`, never a silent wrong-cwd build). No CI path invokes these scripts (measured: no
   `bun run build` / `--filter` caller in the tree).
5. **`--out` is a redirection, nothing else.** With no flag the target is the same expression as before; the
   proof is the 1190-file set-equality above, plus guards on a missing value and on the repository root.
6. **AGENTS.md §6 still shows the un-anchored command and the "three packages still carry such a script"
   sentence**, which this change makes stale. `docs/**` and `AGENTS.md` are outside this lane's `inScope`
   (lane B3 owns docs parity) — flagged here rather than edited.
