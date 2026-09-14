# Release checklist — my-power-dsh v0.9.0 (extension interface)

Prepared by the integration owner (Lead, t11 attempt 9) for the captain, who is the repository's
**only git writer**. Nothing in this file was executed as a git command; every non-git gate below was.

## 1. What this release integrates

The v0.9.0 extension interface (`mpd-ext-plugin`) plus the wave's repairs: the roster's extension
roles, the documentation rewrite, the dispatch-stall hardening in the adopted agent-teams plugin,
and the ext reporting repair. The release candidate is complete in the working tree on branch
`feature/extension-interface`.

## 2. Artifact state produced by this task (the only artifacts it changed)

| # | Artifact | Change |
|---|---|---|
| 1 | `package.json` | `version: 0.3.2 -> 0.9.0`; `exports` gains `./extensions/*`; `test:qa` and `test:qa:all` now cover the extension QA cases and the dev CLI (`extension-isolation`, `extension-lifecycle`, `extension-mcp-bridge` added to the enumeration; `bun scripts/mpd-ext.mjs --self-test` + `validate extensions/mpd-ext-example` added as explicit statements to both lanes — the CLI was covered by NEITHER lane before) |
| 2 | `scripts/pack-mpd.mjs` | `mpd-ext-plugin` added to the hardcoded `PLUGIN_PKGS`; `cpAssets()` now copies `<bundle>/extensions/` (hard FAIL if absent) and `scripts/mpd-ext.mjs`; the packed manifest declares `files: ["extensions/**"]` and `exports: {"./extensions/*": "./extensions/*"}` |
| 3 | `VENDOR_LOCK.json` | skills asset re-pinned `fileCount 298 -> 301`, `treeSha 08e96f40… -> 0dd4a6ee68e0a11499f2b502873016d066cface6b59036147bca066433b4b576`, and the corpus `source` note now lists the three extension QA cases |
| 4 | `packages/mpd-ext-plugin/dist/{index.js,sdk.js}`, `packages/mpd-roles-plugin/dist/index.js` | rebuilt from `src/` so the shipped dist matches the source |
| 5 | `docs/upstream-parity-ledger.md` + `.zh-CN.md` | two statements this release invalidated are corrected in BOTH languages: the vendor row ("this lock is current" was false — the corpus drift is recorded and the v0.9.0 re-pin named) and the plugin-tests row (161 pass / 42 files -> 213 pass / 58 files) |
| 6 | `docs/feature-audit.md` + `.zh-CN.md` | **no change** — nothing this release invalidated (see §6) |

**The re-pin must be committed in the SAME commit as the `skills/**` change** (§9/§11: one skills
writer per wave, one re-pin; the pairing is what `verify-vendor` protects). This wave's skills change
and this re-pin are one atomic step — stage them together, never as two commits.

## 3. Branch / commit / tag / push sequence (AGENTS.md §11)

```bash
# 0) preconditions: working tree = the release candidate; all gates in §4 green at the stated hashes
git status --short                     # expected: the wave's files, nothing stray

# 1) feature branch -> dev   (the wave's integration point)
git checkout dev
git merge --no-ff feature/extension-interface -m "feat(extension-interface): v0.9.0 extension interface + wave repairs"

# 2) release prep
git checkout -b release/v0.9.0
#    version bump + docs are ALREADY in the tree (package.json:0.9.0, the two ledgers corrected,
#    VENDOR_LOCK.json re-pinned) — this branch is version/docs-only by construction.
git add package.json VENDOR_LOCK.json scripts/pack-mpd.mjs \
        packages/mpd-ext-plugin/dist packages/mpd-roles-plugin/dist \
        docs/upstream-parity-ledger.md docs/upstream-parity-ledger.zh-CN.md \
        skills/            # <- the skills change and its re-pin, ONE commit
git commit -m "release: v0.9.0 — extension interface, packaging allowlist, skills re-pin"

# 3) merge to master (annotated tag)
git checkout master
git merge --no-ff release/v0.9.0 -m "release: v0.9.0 — MPD extension interface"
git tag -a v0.9.0 -m "my-power-dsh v0.9.0 — extension interface (mpd-ext-plugin)"

# 4) push master + tag + dev  (see §5 for the credential shape)
#    NEVER put the token in a URL or in a log.
```

## 4. Gate list, with the evidence path each gate wrote

| Gate | Command | Result at this run | Evidence path |
|---|---|---|---|
| Vendor | `node scripts/verify-vendor.mjs` | **PASS, exit 0** (`asset OK: skills 301 files`) | `evidence/release/v0.9.0-integration/20260914T181346Z/verify-vendor.log` |
| Installer (composition) | `node scripts/install-profile.mjs --dry-run` | **exit 0**, 23 rows (id-target 0 / insert 23), **`mpd-ext` row present** | `…/install-profile-dryrun.log` |
| Pack | `node scripts/pack-mpd.mjs` | **exit 0**, 1107 files, `dist/mpd-package/` carries `packages/mpd-ext-plugin`, `extensions/mpd-ext-example`, `scripts/mpd-ext.mjs`, no dev-path leak | `…/pack-mpd.log` |
| Typecheck | `bun run typecheck` | **exit 0** | `…/typecheck.log` |
| Plugin + package tests | `bun test packages` | **493 pass / 0 fail**, 104 files | `…/bun-test-packages.log` |
| QA self-tests (now incl. the dev CLI) | `bun run test:qa` | **exit 0**, all self-tests passed + `[mpd-ext] ok` | `…/test-qa.log` |
| Preset/row conformance | `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | **exit 0** (30 rows conform, parity 31/31) | `…/preset-conformance.log` |
| Extension dev CLI | `bun scripts/mpd-ext.mjs --self-test` | **exit 0** (19 checks) | `…/mpd-ext-selftest.log` |
| Packed install + relocated boot | `bun skills/dsh-qa/scripts/relocate-smoke.mjs --no-skip` | **PASS** (install ok, dump no leak, live boot ok, 0 home copies, served from the relocated package) | `…/relocate-smoke.log` + `evidence/plan-d/relocate/2026-09-14T18-13-53.970Z/{result.json,output.log}` |
| Extension lifecycle (incl. the packed arm t5 left RED) | `bun skills/dsh-qa/scripts/extension-lifecycle.mjs --no-skip` | **exit 0; packed arm = GREEN, `greenOwner: t11`** (`packExit 0`, `mpdExtRowInPackedPatch true`, `pluginDist true`, `extensionsAsset true`); main/failure/isolation arms all ok | `…/extension-lifecycle.log` + `evidence/extensions/extension-lifecycle/2026-09-14T18-14-38.727Z/` |
| Sibling-lane evidence (referenced, not re-run here) | — | t5 QA cases `evidence/extensions/**`; t7 independent verification `evidence/extensions/t7-verify/20260914T174828Z/` (28/28 checks, 5 sandboxed boots); t10/t15 docs `evidence/agent-teams/t10-docs-verify/20260914T173105Z/` (round 2 PASS); t13 `evidence/agent-teams/dispatch-stall/` (mounted-boot proof) | as named |

Hashes at this run: `package.json` version `0.9.0`; skills corpus `fileCount 301` /
`treeSha 0dd4a6ee…`; branch `feature/extension-interface`, HEAD `6cbb126`.

## 5. Push command shape (Gitee token via GIT_ASKPASS)

The token lives in the file **`/root/giteeApi`** (32 hex chars). The remote is
`https://gitee.com/nop_chip/my-power-dsh`. There is no credential helper and no authorized SSH key on
this box, so HTTPS + askpass is the working shape — and it keeps the token out of every URL and log:

```bash
set -euo pipefail
ASKPASS="$(mktemp)"                     # 0600 by mktemp; removed at the end
cat > "$ASKPASS" <<'SH'
#!/bin/sh
case "$1" in
  *sername*) printf '%s\n' "oauth2" ;;          # Gitee accepts oauth2:<token>
  *)         tr -d '[:space:]' < /root/giteeApi ;;
esac
SH
chmod 700 "$ASKPASS"
export GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0

git push origin master                  # no token in argv, no token in the URL
git push origin v0.9.0
git push origin dev
rm -f "$ASKPASS"
```

Hygiene: never `git push "https://oauth2:<token>@…"` (the URL reaches `git push -v`, error output and
shell history) and never `echo "$T"`. If any diagnostic must be captured, pipe it through
`sed -E 's/[0-9a-f]{32}/<redacted>/g'` first, and afterwards confirm
`grep -rl "$(tr -d '[:space:]' < /root/giteeApi)" ~/.gitconfig .git/config` prints nothing.

**Caveat recorded from the repo's own measured recipe** (`.mpd/memory/.../pushing-my-power-dsh-to-gitee-token-in-root-gite-mtzsw9fb.md`):
pushing to an explicit URL leaves local remote-tracking refs stale; with the `origin` + askpass shape
above that does not arise. Network access to gitee.com was NOT exercised by this task.

## 6. Stale maintenance-doc statements: corrected vs knowingly left

Corrected in BOTH languages (this release invalidated them):
1. `docs/upstream-parity-ledger*.md` §8 vendor row — "the wave's corpus re-pin already landed, so this
   lock is current" was false for the current tree (`verify-vendor` exited 1: 301 vs 298 + treeSha
   mismatch). The row now records that the corpus drifted with this wave and was re-pinned to
   `301 / 0dd4a6ee…`.
2. `docs/upstream-parity-ledger*.md` §8 plugin-tests row — "161 pass / 42 files" is superseded by the
   current `213 pass / 58 files` (the dispatch-stall regression + region-pinning suites).

Knowingly left, with reasons (checked and NOT invalidated by this release):
- `docs/feature-audit*.md` "C6 (next): memory engine with git + svn versioning + reflection" — the
  "(next)" marker is stale from Plan C, but the same file's gap-closure section already records Plan C
  as complete; v0.9.0 neither changed nor invalidated it, and rewording an unrelated line is churn
  outside this release's scope.
- Neither `docs/feature-audit*.md` nor `docs/upstream-parity-ledger*.md` mentions the extension
  interface at all (0 occurrences in all four files, measured). That is a *coverage* gap in an
  upstream-parity/feature audit, not a false statement this release invalidated; adding the extension
  sections is new content (docs/extensions.md already documents the interface, bilingual).
- `docs/upstream-parity-ledger*.md` §2 `D_SKILLS_WRITER` ("Baseline: …, 328 files") and its other §8
  rows (typecheck, test:qa, runtime boot, gate case, preset rows, installer, trigger study) are
  anchored records of an earlier wave; those I re-ran (test:qa, preset rows, installer) still hold at
  their recorded values, so nothing there needed changing.

## 7. NOT verified in this environment (honest list)

1. **Every git action** — branch, merge, commit, tag, push. AGENTS.md §5: exactly one git writer, the
   captain. I ran no git command.
2. **The Gitee push itself** — no token was read and no network push was attempted (deliberate).
3. **`bun run test:qa:all`** — the real-lane enumeration that now includes the three extension cases
   plus the two live-provider smokes (`dual-track-smoke`, `mcp-call`, `software-smoke`,
   `vision-smoke`). Not run here: those cases drive real headless boots and a live provider, and the
   wave's own real boots are already evidenced by t5 (`evidence/extensions/**`) and t7
   (`evidence/extensions/t7-verify/20260914T174828Z/`, 28/28 checks). Its composition was verified
   instead: the enumeration now contains the three names and both CLI statements (inspected), and
   `test:qa` (which now includes the CLI gate) is green.
4. **`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs`** (the host-row mount gate) — not re-run in this
   task; the installer dry-run composition is reported in §4 and the wave's mounted boots are t5/t7
   evidence.
5. **`AGENTS.md` §6 region count** — still says "40 regions across 9 adopted files"; t13 raised the
   true count to 46. AGENTS.md is listed in **this task's `outOfScope`**, so I did NOT edit it (the
   captain's earlier note assigned it to me, which conflicts with the frozen contract). One-line fix
   if the captain wants it in this release: `40` -> `46` on the "live registry is **40** regions"
   line, and it must ride the same commit as any other AGENTS.md edit.
6. **Web GUI / browser surfaces** — no browser in this session; the sidebar/plugin-page cases stay
   with their own QA evidence.
7. **Cross-platform** — everything ran on this Linux box; macOS/Windows paths are unverified.

## 8. Artefacts a reviewer should open first

- `evidence/release/v0.9.0-integration/20260914T181346Z/result.json` — the structured record.
- `…/gates.log`, `…/verify-vendor.log`, `…/install-profile-dryrun.log`, `…/pack-mpd.log`,
  `…/relocate-smoke.log`, `…/extension-lifecycle.log`, `…/test-qa.log`, `…/bun-test-packages.log`.
- The re-pin diff: `VENDOR_LOCK.json` (skills asset) and the packaging diff in `scripts/pack-mpd.mjs`.
