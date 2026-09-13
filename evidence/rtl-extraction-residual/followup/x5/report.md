# t21 / X5 — placeholder corruption + stale workspace lock: repair report

Tree: `32ae54dd10db7ea46e1c1263143d56f266fd1f78` (`dev`). In-scope paths only:
`scripts/build-mcp.mjs`, `packages/mpd-mcp-{astgrep,gitbash,lsp,codegraph}/dist/BUILD.lock`,
`bun.lock`, `evidence/rtl-extraction-residual/followup/x5/`. No dist `cli.js`/`serve.js` was
written (verified: `git diff --stat` on the three `cli.js` is empty, and no build was run).

## 1. The corruption

A global OMO→mpd rewrite minted the literal placeholder string **`the upstream project`**:
it came from `<product name>.mpd-dsh`-shaped legacy prose and land at

| Location | Count | What it was |
|---|---|---|
| `scripts/build-mcp.mjs:14` | 1 | `… (e.g. /home/haroldzhao/dshProj/the upstream project).` — an invented path that does not exist (the only `haroldzhao` in the repo was this line) |
| `scripts/build-mcp.mjs:197` (HEAD) / `:313` (worktree) | 1 | `source: "the upstream project"` — the BUILD.lock `source` field the build stub writes |
| `packages/mpd-mcp-{astgrep,gitbash,lsp}/dist/BUILD.lock` | 1 each | the same placeholder frozen as data |

Both script occurrences were **at HEAD `32ae54dd`** — `git show HEAD:scripts/build-mcp.mjs | grep -n`
returns exactly L14 (the comment) and L197 (the `source:` value), i.e. the captain's "2 times, the only
producer of it" measurement is confirmed on the committed revision. At the moment this task was
resumed the worktree was **already at 0** (the edit had landed in the working tree before the
captain's re-measure, which is why the closing grep is green now); this section anchors the count to
the committed revision so the attribution is unambiguous.

## 2. What was fixed

### 2.1 `scripts/build-mcp.mjs` — real intent, no invented path

- **L2** `copy source from the the upstream checkout` → `copy source from the OMO upstream checkout`
  (the doubled article was itself placeholder pollution; `OMO` is provenance, not branding —
  AGENTS.md §1 says upstream product names stay upstream's).
- **L13-16** replaced the fabricated example with the real layout actually used here:
  the default legacy layout `<upstream checkout>/.mpd/port/mpd-dsh`, the `MPD_UPSTREAM_ROOT`
  override (kept exactly, it is an intentional de-OMO identifier), and the real checkout in this
  repo: `<repo>/.mpd-dsh/upstream` (gitignored, `git check-ignore` confirms), whose `packages/` hold
  `ast-grep-mcp / git-bash-mcp / lsp-daemon / lsp-core / mcp-stdio-core / utils / omo-config-core`
  (verified on disk; `omo-config-core` is **preserved** — the upstream dir name is never renamed,
  AGENTS.md §6 hotfix note). The build's own read-only subject is `MPD_UPSTREAM_ROOT=<repo>/.mpd-dsh/upstream`.
- **L270** the stub now writes a real stable provenance value:
  `source: "8c57e46"` — the upstream OMO commit pinned by `VENDOR_LOCK.json`
  (`upstream: code-yeongyu/oh-my-openagent`, base commit `8c57e46`, v5.0.0-beta.20), with a two-line
  comment saying what the field means (provenance, not prose).

### 2.2 the three committed `BUILD.lock` files

Each now carries `"source": "8c57e46"` — **recorded identically for the three MCP packages** — and
`packages/mpd-mcp-codegraph/dist/BUILD.lock` **does not exist**: `codegraph` ships a vendored
prebuilt (`dist/serve.js`, tracked; `VENDOR_LOCK` labels it "vendored prebuilt from the upstream
codegraph dist", and the only `BUILD.lock` writers are the three `SERVERS` entries in
`build-mcp.mjs`). So there is no fourth lock to fix and its absence is by design, recorded rather
than papered over.

Same edit, a **second defect the acceptance criterion forces into the open**: the astgrep/gitbash
locks carried a *stale, wrong* `artifact.sha256`, and the lsp lock carried a char-count in `bytes`
(a scrub-era artifact). All three were re-pointed at the real committed artifact, so
`artifact.sha256`/`artifact.bytes` now equal the committed `cli.js` byte-for-byte
(`before/` vs `after/` + `raw/build-lock-update.json`):

| lock | source before → after | sha256 before → after | bytes before → after |
|---|---|---|---|
| astgrep | `the upstream project` → `8c57e46` | `5a9ae80a…` → `f06bba31…` (real) | 84651 → 84651 |
| gitbash | `the upstream project` → `8c57e46` | `c8a2336d…` → `cb9ce8f3…` (**SUPERSEDED, never re-asserted** — see below) | 22651 → **22656** (superseded) |
| lsp | `the upstream project` → `8c57e46` | `9f41d425…` (unchanged, already real) | 234821 → **234827** |

The real hashes are independently corroborated by `VENDOR_LOCK.json`, which pins exactly
`f06bba31…` (astgrep) and `cb9ce8f3…` (gitbash) for the committed `cli.js` — i.e. the old lock
values were the drift, not the artifacts. The three `cli.js` stayed **byte-identical** to their
committed bytes at the time of this edit: no rebuild was run, and `git diff --stat` on them was
empty then.

**Superseded for gitbash (external lane, after this edit):** another lane's dist repair
(mtime 19:07) rebuilt `packages/mpd-mcp-gitbash/dist/cli.js` — the five `platformFrmpdOptions`
occurrences became the correct `platformFromOptions` — and updated that BUILD.lock plus
`VENDOR_LOCK.json` in the same pass. So the gitbash row above is historical: the lock now records
`0484a8ff… / 22651`, which still equals both the artifact on disk and the current VENDOR_LOCK entry
(`lock_match=true`, `vendor_match=true`), and `git diff --stat` on the three cli.js is non-empty for
gitbash only. astgrep/lsp are unchanged. Details and the re-measurement command:
`raw/verify-post-completion-remeasurement.md`. The equivalence rule ("lock hash/bytes == on-disk
artifact") therefore still holds for all three; the literal "three cli.js byte-identical" line no
longer does — for gitbash, and not because of this task (`cli.js` is out of t21's scope and the
captain's boundary note assigns the dist repair to t25).

### 2.3 `bun.lock` — regenerated, not hand-edited

Command: `TMPDIR=<repo>/.mpd/tmp-bun-tmp BUN_INSTALL_CACHE_DIR=<repo>/.mpd/tmp-bun-cache bun install`
(exit 0, `Saved lockfile`, `12 packages installed`, `Removed: 2`; log
`raw/bun-install-regenerate.log`). The workspace-scoped `TMPDIR`/cache is required in this sandbox
— see §4. Result:

- `workspaces` gained the **seven missing real dirs**: `mpd-agent-teams-plugin`, `mpd-bundle-plugin`,
  `mpd-dsh-adapter-plugin`, `mpd-modelchain-plugin`, `mpd-qa-roles-probe`, `mpd-roles-plugin`,
  `mpd-workmate-plugin` (with their true names/versions, e.g. `@mpd-dsh/agent-teams@0.1.16-rc.3-mpd`).
- the **two ghosts are gone**: `packages/omo-hephaestus` (`@mpd-dsh/hephaestus`) and
  `packages/mpd-presets-plugin` (`@mpd-dsh/presets`).
- every one of the 19 real `packages/*/package.json` dirs is present and its `name`/`version`
  match the manifest (0 problems across 19), and the `packages` map now resolves
  `@mpd-dsh/{agent-teams,bootstrap,boulder,bundle,comment-checker,config,dsh-adapter,dsh-bundle,
  hashline,mcp-astgrep,mcp-gitbash,mcp-lsp,memory,modelchain,qa-roles-probe,roles,tools,ulw,workmate}`
  plus the root's three `optionalDependencies` (which the stale lock was missing entirely).
- `bun.lock` sha256 before `9a2978e6…` → after `a8bfa5b0…` (before-copy kept at `raw/bun.lock.before`).

`bun install --frozen-lockfile` now exits 0: `Checked 31 installs across 48 packages (no changes)`
(§4). The regenerated lock is what made that possible; on the old lock the ghost workspaces made the
install state inconsistent.

## 3. Boundaries

Written: `scripts/build-mcp.mjs`, the three `BUILD.lock`, `bun.lock`, and this evidence tree.
Not written: any `dist/cli.js` or `dist/serve.js`, `scripts/verify-vendor.mjs`, `scripts/pack-mpd.mjs`,
`package.json`, `README.md`, `AGENTS.md`, `VENDOR_LOCK.json` (the vendor gate still passes — all four
pinned dist assets hash exactly as recorded). `git status` for the touched paths:

```
 M bun.lock
 M packages/mpd-mcp-astgrep/dist/BUILD.lock
 M packages/mpd-mcp-gitbash/dist/BUILD.lock
MM packages/mpd-mcp-lsp/dist/BUILD.lock     (M staged by the prior lane; my edit is the worktree M)
MM scripts/build-mcp.mjs                    (idem)
```

The lsp `dist/cli.js` and the staged BUILD.lock/manifest changes of the prior lane are **not mine**
(observed pre-existing at the start of this task); nothing was committed or staged by t21.

## 4. Sandbox limitation (recorded, not silently skipped)

`bun install` without a writable tempdir dies in this sandbox:

```
$ bun install --dry-run
bun install v1.3.14 (0d9b296a)
error: bun is unable to write files to tempdir: ReadOnlyFileSystem        # exit 1
```

(`/tmp` and `/root/.local/share` are read-only here; `mkdir /root/.local/share/tmp-mpd` →
`ReadOnly file system`.) The workspace-scoped workaround
`TMPDIR=<repo>/.mpd/tmp-bun-tmp BUN_INSTALL_CACHE_DIR=<repo>/.mpd/tmp-bun-cache` makes both the
dry-run (exit 0) and the real regeneration (exit 0) work. The literal contract command then succeeds
once the lock is regenerated: `bun install --frozen-lockfile` → exit 0,
`Checked 31 installs across 48 packages (no changes)` (`raw/frozen-lockfile-literal.log`; the
workspace-env variant `raw/frozen-lockfile-ws-tmpdir.log` is identical). The earlier failure text is
kept at `raw/frozen-lockfile-first-attempt*.log`. The temporary dirs were deleted after use.

## 5. Raw evidence index (`x5/raw/`)

| file | what |
|---|---|
| `bun.lock.before`, `bun.lock.before.sha256` | pre-regeneration lock + hash |
| `bun-dryrun-ws.log` | `bun install --dry-run` (workspace tmp) |
| `bun-install-regenerate.log` | the real regeneration, exit 0 |
| `frozen-lockfile-first-attempt*.log` | the read-only-tempdir failures |
| `frozen-lockfile-literal.log`, `frozen-lockfile-ws-tmpdir.log` | `--frozen-lockfile` after the fix, exit 0 |
| `build-lock-update.json` | per-lock before/after source+sha256+bytes, codegraph absence |
| `verify-sweep.txt` | the four contract verify commands, verbatim |
| `verify-vendor.log` | vendor gate after the edits (PASS) |
| `../before/BUILD.lock.*`, `../after/BUILD.lock.sha256` | byte snapshots + hashes of the three locks |

## 6. Captain scope addition (t21 attempt 2) — what it changed and what it did not

The captain's follow-up added `scripts/build-mcp.mjs` to this task's scope and asked for three
things, all satisfied:

1. **Both occurrences fixed** — the comment (L13-17) and the `source:` value (L313). Neither the
   comment nor the stub invents a path any more; `grep -c 'the upstream project'` is 0.
2. **The t20/t25 brand guard is preserved**, not restructured. Verified present in the same file
   after the edit: `export function applyMpdScrub` (L142), `export const BRAND_ALLOWLIST` (L182),
   `export function assertBrandClean` (L208), `export function assertRebuildMatchesCommitted` (L245),
   the `function main()` wrapping (L258) and the direct-execution guard at the file tail. The only
   lines this task touched are the two placeholder sites (plus the L2 doubled article). A
   `node --check` after the edit exits 0, so a hand edit did not clobber the guard.
3. **Same value in all three locks** — `"source": "8c57e46"` in astgrep, gitbash and lsp; codegraph
   has no BUILD.lock at all (checked; see §2.2).

### 6.1 The `source` value: what was chosen and why

`source: "8c57e46"` — the short form of the recorded upstream OMO commit
`8c57e463e62ddc8d2c7b4a6770dcd2927e91ef29`, which is the value `VENDOR_LOCK.json` pins as this
project's base revision (upstream repo `code-yeongyu/oh-my-openagent`, v5.0.0-beta.20; the same
commit `scripts/verify-vendor.mjs` reports as `commit OK`). Reasons for this exact form:

- It is the value the acceptance criterion names first, and it is **stable**: it changes only when
  the deliberate baseline bump changes, not on every build (the previous field was prose, and the
  sibling `builtAt` already carries the per-build timestamp).
- **Short vs full SHA**: `8c57e46` is the identifier other repo surfaces already print
  (`verify-vendor` "commit OK: 8c57e46…", AGENTS.md §1 "base commit `8c57e46`"), so the lock stays
  greppable against them; the full 40-hex id is available through `VENDOR_LOCK.json` for anything
  that needs an unambiguous pin. It is deliberately **not** a sentence ("built from the upstream
  project") and not a path-shaped string pretending to be a location.
- It is recorded **identically in all four places** that can produce it: the stub literal in
  `scripts/build-mcp.mjs` and the three committed `BUILD.lock` files.

## 7. Staging state (captain instruction honoured)

The captain asked that t21's files be left unstaged so the per-fix-branch staging cannot blur the
commit boundary. `git restore --staged` was applied to exactly this task's five paths
(`scripts/build-mcp.mjs`, the three `BUILD.lock`, `bun.lock`); the index for them is back at HEAD
and every working-tree byte is preserved:

```
$ git status --porcelain -- bun.lock scripts/build-mcp.mjs packages/mpd-mcp-{astgrep,gitbash,lsp}/dist/BUILD.lock
 M bun.lock
 M scripts/build-mcp.mjs
 M packages/mpd-mcp-astgrep/dist/BUILD.lock
 M packages/mpd-mcp-gitbash/dist/BUILD.lock
 M packages/mpd-mcp-lsp/dist/BUILD.lock
```

Note for the captain: the two paths that previously showed a staged side (`MM`) had been staged
before this task started (the t20 guard code in `scripts/build-mcp.mjs`, the lsp `dist/cli.js` +
lock from the RTL repair lane). Restoring the index to HEAD un-staged those pre-existing staged
blobs too; their content is untouched in the working tree, so they need a deliberate `git add` when
their own fix branch is built. Nothing was committed, and no file outside this task's scope was
touched by the restore.

## 8. t27 re-measurement against the CURRENT pins (2026-09-13T11:15Z, HEAD `32ae54d`)

The X5 deliverable was re-measured one final time on the settled tree, after t26's declaration lane
and the x4-repair lane's git-bash rebuild had landed. Raw log: `raw/t27-verify-sweep.txt`.

| check | result |
|---|---|
| `scripts/build-mcp.mjs` placeholder | **0** |
| three `BUILD.lock` placeholder / `source` | **0** / `"source": "8c57e46"` each |
| `node --check scripts/build-mcp.mjs` | exit **0** |
| codegraph `BUILD.lock` | **absent** (only the three MCP locks exist; `dist/serve.js` is the vendored prebuilt) |
| artifact equality | astgrep `f06bba31…/84651`, gitbash `0484a8ff…/22651`, lsp `9f41d425…/234827` — for each, on-disk `cli.js` == `BUILD.lock` `artifact.sha256`/`bytes` == `VENDOR_LOCK.json` entry (`ALL_AGREE=true`) |
| `bun install --frozen-lockfile` | exit **0**, `Checked 31 installs across 48 packages (no changes)` |
| `node scripts/verify-vendor.mjs` | exit **0**, `[verify-vendor] PASS` |
| `bun.lock` | both ghosts gone; all 19 real `packages/*` dirs present; 19/19 lock entries match their manifests' names; every workspace package name resolves in the `packages` map |
| guard probe (`raw/x4-brand-guard-probe.mjs`, 7 lanes) | **7/7 PASS**, `brand guard proof ok=true` — rerun on the CURRENT git-bash bytes; the probe is idempotent (before/after `cli.js` sha256 identical, `raw/t27-cli-{before,after}-probe.sha256`) |

**gitbash — current vs superseded (never re-asserted):** the row that matters is the CURRENT
`0484a8ff1714c949bc52a4fc0de89c756dcab975b0691a2823706f008475f38e / 22651 B`, set by the x4-repair
lane's rebuild (`platformFrmpdOptions` → `platformFromOptions`, 5 sites) together with its
`BUILD.lock` and `VENDOR_LOCK.json` entry. My own earlier value `cb9ce8f3… / 22656 B` is recorded in
§2.2 only as **superseded**; it must not be quoted as current. The literal "three cli.js
byte-identical" line therefore no longer holds for gitbash — the substantive equality rule holds for
all three.

**Sandbox limitation (verbatim, re-confirmed):** the literal `bun install --frozen-lockfile` now
exits 0 on the regenerated lock, while an un-scoped `bun install` in this sandbox dies
`error: bun is unable to write files to tempdir: ReadOnlyFileSystem` (exit 1; `/tmp`, `/root/.bun`
and `/root/.local/share` are read-only here — `mkdir /root/.local/share/tmp-mpd` returns
`ReadOnly file system`). The regeneration itself was made possible by the workspace-scoped
`TMPDIR=<repo>/.mpd/tmp-bun-tmp BUN_INSTALL_CACHE_DIR=<repo>/.mpd/tmp-bun-cache`, and the contract
form `TMPDIR=$PWD/.tmp-cache BUN_INSTALL_CACHE_DIR=$PWD/.tmp-cache` is what the sweep used. Logs:
`raw/bun-install-regenerate.log`, `raw/frozen-lockfile-first-attempt*.log`, `raw/frozen-lockfile-literal.log`.
