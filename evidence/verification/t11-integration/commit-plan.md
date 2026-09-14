# t11 — atomic commit plan (B1–B6 delivery) — NOT executed, nothing pushed, no tag, no release branch

Base: `dev` @ `98680b1fb2bbf5c10c28cfbe44419e91595e1cb7`
Recommended branch: **`fix/bline-b1-b6`** (created from `dev`)

Why one branch instead of the strict "one branch per defect": two couplings make per-defect branches
individually RED. (1) `VENDOR_LOCK.json` is one file whose final content covers both B2's skills count
re-pin and the re-pin forced by B1/t7's `skills/dsh-qa/scripts/workmate-library.mjs` edit, and the
vendor gate hashes the whole `skills/**` tree — so the skills edit and the lock must land together.
(2) `packages/mpd-verif-plugin/dist/index.js` bundles both B1's exec threading and B3's lossless change,
so those two defects cannot be split without hunk surgery on a generated file. Everything else is
atomic per defect. If the captain insists on per-defect branches, commits 5 + 2 (+3) must still share
one branch; the others can be split, at the cost of an intermediate red vendor gate.

| # | Commit message | Files |
|---|---|---|
| 1 | `fix(adapter): resolve the workspace root from the calling session` | `packages/mpd-dsh-adapter-plugin/src/index.ts`, `packages/mpd-dsh-adapter-plugin/dist/index.js` |
| 2 | `fix(bline): follow the session workspace in boulder, config, comment-checker, memory, modelchain, ulw and workmate` | `packages/mpd-boulder-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-config-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-comment-checker-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-memory-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-modelchain-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-ulw-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-workmate-plugin/{src/index.ts,dist/index.js}`, `packages/mpd-bootstrap-plugin/dist/index.js`, `packages/mpd-roles-plugin/dist/index.js`, `packages/mpd-tools-plugin/dist/index.js`, `packages/mpd-qa-roles-probe/dist/index.js` (the last four are dependent dist rebuilds that inline the adapter), `evidence/session-workspace-root/b1-resolution/**`, `evidence/session-workspace-root/t8-verify/**` (incl. `attempt-2/` and `attempt-2/repair-t13/**`), `evidence/session-workspace-root/dist-repair/**` |
| 3 | `fix(verif): session-scoped roots and lossless backend JSON` (B1 verif threading + B3) | `packages/mpd-verif-plugin/src/{backends,compile,coverage,env,index,regress,sim,uvm,venv}.ts`, `packages/mpd-verif-plugin/test/{helpers.ts,index.test.ts,lossless.test.ts}`, `packages/mpd-verif-plugin/dist/index.js`, `evidence/fix/verif-tool-lossless/**` |
| 4 | `fix(hashline): session-scoped paths and a oneOf lines schema` (B1 hashline + B4) | `packages/mpd-hashline-plugin/src/index.ts`, `packages/mpd-hashline-plugin/dist/index.js`, `packages/mpd-hashline-plugin/test/tool-schema.test.ts`, `evidence/hashline/**` |
| 5 | `fix(vendor): derive the skills re-pin and stop reporting a failing asset as OK` (B2 + the skills edit's own re-pin, one commit) | `scripts/verify-vendor.mjs`, `VENDOR_LOCK.json`, `skills/dsh-qa/scripts/workmate-library.mjs`, `evidence/verification/t9-b2-b6/**` (carries the vendor-gate falsifiability logs `b2-verify-vendor.log`, `b2-mutation-fresh.log`, `b2-mutation-raw.log` and the B5 control `b5-preprovision-skip.log`) |
| 6 | `docs(comment-checker): document the sanctioned .toolchain provisioning` (B5) | `packages/mpd-comment-checker-plugin/README.md`, `packages/mpd-comment-checker-plugin/README.zh-CN.md` |
| 7 | `docs(agent-teams): pin the adopted provenance version and document the session-root rule` (B6 + t13 docs) | `AGENTS.md` |
| 8 | `test(qa): record the B1-B6 verification and integration evidence` | `evidence/verification/t10-review/**`, `evidence/verification/t14-review/**`, `evidence/verification/t11-integration/**`, `evidence/dsh-qa/preset-conformance/**`, `evidence/dsh-qa/bundle-lifecycle/**`, `evidence/agent-teams/provenance-version-align/**` |

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. Every commit after 4 is independently green; 1–2 are green as a
pair (1 alone leaves the four dependent dists stale, which the repo convention forbids — if a single
commit is preferred for the adapter wave, merge 1 and 2).

## Hard rules encoded in this plan

1. **`VENDOR_LOCK.json` + `skills/dsh-qa/scripts/workmate-library.mjs` are in the SAME commit** (commit 5),
   as are `scripts/verify-vendor.mjs` + `VENDOR_LOCK.json` (B2). Splitting them makes the repo red in
   between (`asset skills treeSha mismatch`, exit 1) — a failure that has already reproduced twice.
2. **Release-checklist item (new, from this class):** any edit under `skills/**` must carry its own
   `VENDOR_LOCK.json` re-pin AND its gate evidence in the same commit (derive the `treeSha` with the
   script's own algorithm — `node scripts/verify-vendor.mjs` is the gate).
3. **Release-checklist item (B5):** the `.toolchain` comment-checker binary is gitignored, so a fresh
   clone silently **skips** the three `mpd-comment-checker-plugin` tests instead of failing. Call it out
   in the release notes; run `bun test packages` on a machine with `.toolchain` provisioned for the
   real count (309 pass vs 306 pass + 3 skip).
4. Evidence lands in the same commits as the change it proves (per §4/§5); cross-cutting verification
   evidence lands in commit 8.
5. No push, no tag, no `release/*` branch. The `dev` merge is a normal `git merge --no-ff fix/bline-b1-b6`.

## Known local artifacts deliberately NOT committed

| Artifact | Why |
|---|---|
| `dist/mpd-package/` | gitignored (`.gitignore:12`). **Current**: t13 re-ran `npm run pack` as part of its acceptance and t14 verified the packed code (`workspaceRootOf` + `requireCocotbBenv(undefined, exec)` in the verif dist, `sessionPath(fp, dsh, exec)` in hashline); Lead's 8/8 spot-check shows packed dists byte-identical to the committed ones. No pack re-run was needed during integration (no dist changed); re-run `npm run pack` only if a dist changes afterwards. |
| `.toolchain/` | gitignored (`.gitignore:6`); it is the B5 environment provisioning (comment-checker 0.8.0 + ast-grep + codegraph), not source. |
| `.qa-tmp/`, `.qa-reloc/` | gitignored (`.gitignore:3`) QA scratch and relocation-test trees. |
| `evidence/scan/**`, `evidence/p0..p5`, `evidence/plan-*` | pre-existing historical evidence from earlier phases, untouched by this delivery. |
| `packages/mpd-qa-roles-probe/dist/index.js` | committed (it is a real bundle row used by `bundle-lifecycle`), but intentionally absent from `dist/mpd-package/` and from the bundle patch — the packed tree excludes the QA-only probe by design. |
