# Release checklist — my-power-dsh v0.9.1 (known-defect fixes)

Prepared by the captain (the repository's only git writer for this wave). Every gate below was
executed; the logs are in this directory and the per-finding ledger is in
`evidence/extensions/v0.9.1-defect-fixes/20260915T011354Z/`.

## 1. What this release integrates

Nothing new — **every previously recorded finding, fixed**: the seven findings of the v0.9.0
adversarial review (F1–F7 in the extension interface), the t7 prose item, and the one defect recorded
as a known gap after that wave (a pooled write task handed to a read-only team member).

| Id | Where | Change |
|---|---|---|
| F1 | `packages/mpd-ext-plugin/src/mcp.ts` | an unsupported/lossy `outputSchema` drops only the SCHEMA: the tool registers without `structuredContent` and the reason is recorded |
| F2 | `src/mcp.ts`, `src/schema-sanitize.ts` | a non-object-rooted foreign `inputSchema` is normalized onto an object root (payload under a single `value`) instead of being passed through |
| F3 | `src/skills.ts` | a failed enumeration returns `{candidates: [], complete: false}` — never an ARRAY the harness would cache as a complete, empty catalog |
| F4 | `src/index.ts`, `src/registry.ts`, `src/skills.ts` | collisions are recorded (project-plane skips attributed per entry; extension-vs-extension collisions noted on the loser with the winner and ranks) and both list tools report every claim against the harness's own catalog as `served`/`notServed` |
| F5 | `src/index.ts` | no `process.cwd()` fallback anywhere: the project plane requires the caller's cwd, and the apply-time shadow guard is skipped when no workspace is named |
| F6 | `src/index.ts` | `mpd_ext_show` redacts author-declared MCP `env` VALUES (keys stay) |
| F7 | `src/registry.ts`, `src/index.ts` | the whole-view claim maps use the caller's EFFECTIVE enabled predicate, so a config-disabled extension claims nothing |
| POOL | `packages/mpd-agent-teams-plugin/lib/scheduler.js` (+ registry) | a pooled task a member cannot execute stays in the pool; the member's own task still dispatches, loudly. Registry 46 → 48 regions |

## 2. Artifact state produced by this release

| # | Artifact | Change |
|---|---|---|
| 1 | `package.json` | `version: 0.9.0 → 0.9.1` |
| 2 | `docs/upstream-parity-ledger.md` + `.zh-CN.md` | the plugin-tests row corrected in BOTH languages (213/58 → 220/60 files; the v0.9.1 guard + the region count named) |
| 3 | `dist/mpd-package/` (gitignored) | refreshed by `node scripts/pack-mpd.mjs`; the packed bytes are asserted to carry every fix (§4) |

No `skills/**` change in this wave, so `VENDOR_LOCK.json` is untouched and its single-re-pin rule
(§9/§11) is not engaged — `verify-vendor` PASSes on the settled tree.

## 3. Gates executed (logs in this directory)

| Gate | Command | Result |
|---|---|---|
| Vendor | `node scripts/verify-vendor.mjs` | exit 0 (`verify-vendor.log`) |
| Tests | `bun test packages` | 510 pass / 0 fail, 106 files (`bun-test-packages.log`) |
| Types | `bun run typecheck` | exit 0 (`typecheck.log`) |
| QA self-tests | `bun run test:qa` | all self-tests passed (`test-qa.log`) |
| Adopted-plugin registry | `node scripts/patch-agent-teams-fixes.mjs --check` | 48 regions / 9 files, clean (`delta-registry.log`) |
| Installer | `node scripts/install-profile.mjs --dry-run` | exit 0 (`install-profile-dryrun.log`) |
| MOUNT (real boot, isolated) | `bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip` | all four tools offered AND called; failure + isolation arms green; packed arm GREEN (`v0.9.1-defect-fixes/…/raw/mount-extension-lifecycle.log`) |
| Packed tree | `node evidence/release/v0.9.1/packed-tree-assertions.mjs` | 24/24 ok (`packed-tree-assertions.log`) |
| Relocation smoke | `node skills/dsh-qa/scripts/relocate-smoke.mjs --no-skip` | PASS, npm install path (`relocate-smoke.log`) |

## 4. Packed proof

`packed-tree-assertions.mjs` checks three classes: the packed manifest is `0.9.1` and still declares
the v0.9.0 assets; five shipped files are **byte-identical** to the repo (a stale dist would ship the
pre-fix behaviour while every source test stayed green); and each fix's own marker is present in the
packed bytes (`registered WITHOUT structuredContent`, the object-root wrap, `complete: false`,
`skillServing`/`notServed`, the `skill surface: ` prefix, `<redacted>`, `isEnabled:`,
`nextCapableTask` + both registered regions), plus the corrected docs in BOTH languages.

**Install not run on this host:** `dsh plugin add dist/mpd-package` still fails with the pnpm store
`[ERR_SQLITE_ERROR]` recorded in the v0.9.0 wave. That is a host limitation, stated rather than
worked around; the assertions above are the packed proof, and the npm-path relocation smoke (which
does install) passed.

## 5. Branch / commit / tag / push

```
release/v0.9.1  (from dev @ 2a72059)
  release: v0.9.1 — version bump + the parity-ledger correction (both languages)
  chore(evidence): the v0.9.1 release checklist, packed assertions and gate logs
master          <- merge --no-ff  +  annotated tag v0.9.1
push            dev, master, tag
```

## 6. Known limitations carried forward (unchanged by this release)

- `bun run test:qa:all` (the full real lane) and the Web-GUI arms are not runnable end-to-end on this
  host; the lanes that do run were executed above.
- Cross-platform paths (Windows drive letters, non-POSIX shells) remain unverified here.
- `packages/mpd-mcp-shared` ships no README — not a defect: no `package.json`, not a workspace
  member; it is the shared binary-resolver module documented by its consumers and `AGENTS.md` §12.
