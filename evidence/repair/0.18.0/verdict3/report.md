# v0.18.0 — THIRD verification (seat 3)

- Loop: `loop-20261107T055457-25618b` (frozen contract `.mpd/plans/v0.18.0-upstream-adaptation.md`, sha256 `6e61271b…`)
- Reviewed: branch `feature/upstream-0.18.0`, commit `860309a0` (previous `d65bc680`), PR #103 → `dev`
- Answered record: `rec-20261107T092205-376636` (FAIL; B1, H1, M1–M3, N1–N3)
- This record: `rec-20261107T095652-00f02e` — **FAIL** (repair task `rep-20261107T095652-b33f2f`)
- Scope: ONLY the delta on B1 and H1 plus the three mediums and the pack/AGENTS.md checks named by the task.

## Assessment (one paragraph)

Both blockers are genuinely repaired, and I reproduced each proof myself. **B1:** `gates.yml` and
`publish.yml` at `860309a0` check the pinned DSH-Go kit out at the workspace-relative `.dsh-go-kit` and
export `MPD_DSHGO_KIT=$GITHUB_WORKSPACE/.dsh-go-kit`; the real GitHub run **42360781672** is green on
`860309a0` (headSha confirmed, `event: pull_request`), its kit step, env step, aggregate, manifest and
comment steps all PASS, and the aggregate log reports **11/11 members green** with the 0.19.0 host
discovered and the dshgo cross-check `LEGAL`. The credential-free Docker acceptance run **42360781568**
also passed on the same SHA. **H1:** in a scratch tree with both manifests cut to
`["@deepseek-harness-tui/dsh-tui@0.19.0"]` and `specs/tui-hosts.json` still claiming both hosts, the
HEAD gate exits **1** naming `COMPAT.declared-hosts` and both manifests; `--static-only` on the same tree
also exits **1** with `COMPAT.host-version BOUND — NOT CHECKED`; restoring both manifests returns
**exit 0**; and the pre-fix gate (`d65bc680` script, same tree/host) exits **0**, so the delta is the new
arm, not an environmental accident. The re-pack is real: `dist/mpd-package/specs/tui-hosts.json` exists
and is byte-identical, and `verify-pack-closure` is green (668/668 identical, 0 drift) after a fresh
`pack-mpd` run. M1, M3, N1 and N3 are repaired as the task described. **However, the medium M2 is NOT
repaired:** PR #103's body (current, `updatedAt 09:41:43Z`, sha256 `e97b907f…`) still says "Model
selection runs through four `agentOptions` sites" in English and "模型选择走四处 `agentOptions`" in
Chinese, while `docs/compatibility.md` §2 now says ONE site was proven and three are a declared bound.
One new packaging gap was also found: the new `specs/tui-hosts.json` is absent from the root
`package.json` `files` allowlist, so the published npm/GitHub-install tarball ships
`scripts/verify-tui-admission.ts` without its input (the packed `dist/mpd-package` is fine). **Risk
level: Medium** — no runtime regression and both blockers cleared; a named documentation-honesty finding
and a packaging-completeness gap remain. **Verdict: FAIL — request changes.**

## B1 · PASS — the commit runs its CI gates

Evidence (`evidence/repair/0.18.0/verdict3/ci-static-gates-summary.log`):

- `gh run view 42360781672`: `headSha=860309a0f666d2388a006adaa0134e7d6ce2cfae`, `event=pull_request`,
  `conclusion=success`. Job "Static gates" steps 8 (`Check out the pinned DSH-Go kit`) and 9 (`Point the
  dshgo gate at the pinned kit`) both success; step 10 `Static gate aggregate` success; step 11
  `Plugin manifest` success; step 12 `Declaration comments` success.
- Log: `path: .dsh-go-kit`, `Working directory is '…/My-Power-Dsh/.dsh-go-kit'`,
  `MPD_DSHGO_KIT=/home/runner/work/My-Power-Dsh/My-Power-Dsh/.dsh-go-kit`; aggregate prints
  `[verify-gates] PASS - 11/11 member gate(s) green`; dshgo `RESULT: LEGAL`.
- `gh pr checks 103`: **Static gates: pass**; **Docker real-machine acceptance: pass** (credential-free
  `--no-browser`, run 42360781568). `mergeable: MERGEABLE`, head still `860309a0`.
- `publish.yml` at HEAD carries the identical fix (`path: .dsh-go-kit`,
  `MPD_DSHGO_KIT="$GITHUB_WORKSPACE/.dsh-go-kit"`, and a `test -f` guard on the sparse checkout).
- `.gitignore` gains `.dsh-go-kit/`.

**Bound:** `publish.yml` itself was not executed (it needs a tag/dispatch and would stage a release);
its fix is statically identical to the proven `gates.yml` mechanism and obeys `actions/checkout`'s
under-workspace rule. `gates.yml`'s use of `$RUNNER_TEMP/tui-host` is an `npm install --prefix`, not a
checkout `path:`, so it is not the same defect.

## H1 · PASS — the published band is asserted from data, independent of discovery

Reproduction in a `/tmp`-equivalent scratch copy under the gitignored `.qa-tmp/verify3/` (repo untouched;
the copy lacked `evidence/**` because `.gitattributes` has `evidence/** export-ignore`, so I copied
`evidence/dshgo/` in to keep the E-residual arm honest):

- Both manifests cut to `["@deepseek-harness-tui/dsh-tui@0.19.0"]`; `specs/tui-hosts.json` unchanged
  (both hosts); host dir = the ambient 0.18.0 payload with `package.json` version relabelled `0.19.0`
  (the second seat's condition; discovery sees only 0.19.0).
- **Normal mode: exit 1** — `arm COMPAT.declared-hosts FAIL … dsh-plugin.json: the band [@…@0.19.0]
  does not cover the declared host @…@0.18.0; packages/mpd-tui-plugin/dsh-plugin.json: …`;
  `REPORT: FAIL — 1 finding(s) across 55 arms` (`h1-cut-normal.log`).
- **`--static-only`: exit 1** — same single finding, `COMPAT.host-version BOUND — NOT CHECKED —
  --static-only did not run host discovery` (`h1-cut-static-only.log`). Discovery-independence holds.
- **Restored manifests: exit 0** — `COMPAT.declared-hosts PASS … inside each of the 2 manifest band(s)`;
  `REPORT: PASS — 48 arms passed, 1 allowed deviation(s), 6 bound(s)` (`h1-restored.log`).
- **Pre-fix control:** the `d65bc680` gate script on the SAME cut tree/host exits **0** with
  `REPORT: PASS — 47 arms passed …` (`h1-prefix-control.log`) — the delta arm is what reddens.
- CI already shows the shipped form: `COMPAT.declared-hosts PASS` over both hosts while the discovered
  host is 0.19.0 (run 42360781672).

## Mediums / named checks

### M1 · FIXED (one record nit remains)

`evidence/release/0.18.0/2026-11-07T06-55-08Z/49-repin-check.log` (also under `r4/`) is a real
`repin-vendor --check` transcript: `file list: git index (392 shipped file(s))`, shipped
`treeSha=3133e6fb… fileCount=392`, `CHECK : GREEN - lock matches the working tree (drift=0,
problems=0)`. I re-ran `node scripts/repin-vendor.ts --check` here: **exit 0, GREEN**. `result.json`
bounds #7 states the 391→392 cause (git-index enumeration; the skills case was untracked at pin #1) and
that the shipped lock is the second pin. See Nit N-M1 for the row pointer.

### M2 · NOT FIXED — Medium (this is the verdict driver)

PR #103's current body still contains, in English: "Model selection runs through four `agentOptions`
sites, and this PR carries a run that shows which model actually served the turn", and in Chinese:
"模型选择走四处 `agentOptions`，本 PR 附一次真实运行…" (copy:
`evidence/repair/0.18.0/verdict3/pr-body.md`, lines by content; body sha256 `e97b907f…`, updated
09:41:43Z — the same edit that fixed M3). `docs/compatibility.md` §2 says "That is ONE site, not four …
they remain a **declared bound**, not a proven result." The human-facing contract still claims more than
the evidence carries — the exact M2 finding. **Fix direction:** rewrite the sentence in BOTH language
sections to name the one proven CONSULT-spawn site and list the other three as unexercised declared
bounds.

### M3 · FIXED

PR body (EN and zh) now says: "every row PASS; the ONE retained non-PASS row is the intermediate
oneclick run, kept on purpose so the stale-pack failure stays auditable; the credentialed Docker
`--live` runs are an OWED bounds entry, not a row; 1 declared skip" — no "1 owned-not-run". Minor
wording: "every row PASS" sits next to "ONE retained non-PASS row"; the row is correctly identified.

### N1 · FIXED

`evidence/repair/0.18.0/fixes/typecheck.log` is now 368 B of NOTE pointing at the authoritative
`39-typecheck-captain.log` and `r4/typecheck.log`; not 0 bytes, no claim of a silent run.

### N3 · FIXED

`result.json` bounds no longer declare the oneclick lane failed: bound #6 says it PASSED on the re-run
(08-59-18Z) after the re-pack, keeps the earlier failing run (08-45-55Z, `pack.staticCoherence`) for
audit, and keeps the credentialed `--live` runs OWED. The old "Re-pack and re-run before the tag" bound
is gone.

### NEW · Medium — `specs/tui-hosts.json` is not admitted by the published `files` allowlist

- **Packed artefact (the task's check) passes:** a fresh `node scripts/pack-mpd.ts` + 
  `node scripts/verify-pack-closure.ts` gives **exit 0**, 668/668 files byte-identical, 0 drift;
  `dist/mpd-package/specs/tui-hosts.json` exists (820 B) and is identical to the source.
- **Published/GitHub-install artefact does not:** root `package.json` `files` admits `specs/dsh-go/**`
  only — not `specs/tui-hosts.json` (nor `specs/**`). `publish.yml` packs at the repo root
  (`npm pack --pack-destination /tmp/npm-pack`), so the registry tarball ships `scripts/**`
  (including `scripts/verify-tui-admission.ts`) without the data file its new arm reads. I verified the
  gate's behaviour with the file absent in a scratch copy: **exit 1** — `arm COMPAT.declared-hosts FAIL
  — specs/tui-hosts.json: the file does not exist`. The same applies to a `github:` install, which packs
  through the same `files` allowlist. CI does not catch it: the aggregate's `plugin-manifest --pack`
  member is green (`0 required paths not admitted`) because the required-path list does not know about
  the new data file. **Fix direction:** add `specs/tui-hosts.json` (or `specs/**`) to the root `files`
  allowlist, then re-run `verify:manifest` (`--pack`) and the pack/pack-closure pair.
- **Bound:** `npm pack --dry-run` could not run in this sandbox (EROFS on `~/.npm/_cacache`); the
  allowlist semantics are conclusive and the release evidence's own `npm pack --dry-run` row predates
  the new file. No user runtime reads the file; the impact is a shipped QA gate that cannot run from an
  installed package.

### AGENTS.md budget · COMPLIES (Nit to widen)

`wc -c AGENTS.md` = **63483 B**; cap 65536; margin **2053 B**, exactly **5 B above** the 2 KB (2048 B)
floor. It complies, so it is acceptable for this wave; the Nit is to widen before the next edit
(MOVE-FIRST into `agent-references/`), as the prior record's N2 already said. This commit did not edit
`AGENTS.md`.

## Nits

- **N-M1 (Nit):** `evidence/release/0.18.0/2026-11-07T06-55-08Z/result.json`'s `verify-vendor` row still
  reads `"after the wave's single re-pin (04-repin-write.log)"` — the superseded 391-file transcript —
  while bounds #7 correctly says two re-pins and the shipped lock is the second. Point the row at
  `49-repin-check.log` / state the 392 pin (or say "second of two").
- **N-docs (Nit):** `docs/compatibility.md` §3 says "In this release's gate run the discovered host was
  0.18.0 … PASS — 49 arms passed, 1 allowed deviation, 5 bounds". CI on `860309a0` discovered **0.19.0**
  and reports **48 arms / 1 / 6 bounds**. The 49/5 figures are the local shipped-tree run; label them
  local or cite the CI numbers.
- **N-M3 (Nit):** "every row PASS; the ONE retained non-PASS row …" is internally contradictory; say
  "20 PASS + 1 retained non-PASS (intermediate oneclick) + 1 declared skip" to keep the arithmetic
  auditable.

## Declined to judge (kept on one line each)

1. **B1's publish.yml execution** — cannot run it without a tag/staging a release; statically verified,
   and the identical mechanism is proven in `gates.yml`.
2. **The credential-free Docker acceptance run** — CI ran it green on `860309a0`; I did not re-run it and
   did not run credentialed Docker (task bound).
3. **`E.residual` FAIL in my first scratch run** — artefact of `.gitattributes`' `evidence/** export-ignore`
   with `git archive`; fixed by copying `evidence/dshgo/`, not a repo finding.
4. **`--static-only` prints `mode: gate (static + host)` before reporting the host arm NOT CHECKED** —
   pre-existing at `d65bc680`, cosmetic, outside the delta.
5. **Frozen-table `gates` evidence id** — the frozen argv is the bare aggregate (red by design in this
   environment: needs the pinned harness on PATH and the kit); CI's env-carrying run is the proof, as the
   prior record already established.
6. **The intermediate oneclick run retained** — credited by the second record; M3's identification is
   correct and the evidence is committed.
7. **The relabelled 0.18.0 host** — the H1 demonstration uses a 0.19.0 version string on the 0.18.0
   payload (same bound the second seat declared); it proves the claim/band relation, not a live 0.19.0
   admission.
8. **CodeRabbit** — `gh pr checks 103` shows `skipping`; no in-progress review round to wait on (not my
   scope to reconcile).
9. **`verify:gates` as a whole** — not re-run by me; CI ran it 11/11 on the reviewed SHA, and I ran the
   pack/docs/vendor/typecheck members through the verify plane.
10. **The full 2694-line diff** — not re-read; this pass judges the two blockers, the named mediums and
    the named pack/budget checks only.

## Bounds of this review

- **Read:** the frozen contract and the second record; `AGENTS.md` §3–§5/§9/§11; both workflow files at
  HEAD; `specs/tui-hosts.json`; both TUI manifests; `package.json` (root and packed); `docs/compatibility.md`
  §2–§3 and its zh twin; `evidence/repair/0.18.0/{r4/README.md,fixes/typecheck.log}` and the release
  `result.json`/`49-repin-check.log`; PR #103's full body. I read two small passages of
  `scripts/verify-tui-admission.ts` (the E-residual input path and the `REPO` constant) to build the
  reproduction environment; the verdict does not rest on them.
- **Did not read:** the full `860309a0` diff; the packer implementation; the Docker scripts; the test
  suite; most zh-CN twins.
- **Did not run:** `bun test packages`, `bun run test:qa`, the Docker lanes (credentialed or not), any
  device/Flutter; `npm pack` (sandbox EROFS on `~/.npm`); no CI dispatch (read-only `gh`).
- **Did run:** `gh run view`/`gh pr checks`/`gh API` log fetch for runs 42360781672 and 42360781568; the
  H1 cut/static/restore/pre-fix controls in `.qa-tmp/verify3/`; `node scripts/repin-vendor.ts --check`;
  `node scripts/pack-mpd.ts`; `node scripts/verify-pack-closure.ts` (twice, green); the verify-plane gates
  `pack`, `docs`, `vendor`, `typecheck` (all exit 0: `ev-20261107T095338-ced4f4`, `-d92db7`, `-020c1b`,
  `-e8778b`); `wc -c AGENTS.md`. The repository's tracked files were not mutated; the re-pack only
  refreshed the gitignored `dist/mpd-package/`.

## Verdict

**FAIL — request changes.** The two blockers are genuinely fixed and CI on `860309a0` is green, but the
named medium M2 is not repaired (the PR body still claims four `agentOptions` sites), and the new data
file is missing from the published `files` allowlist; both must be corrected before merge.
