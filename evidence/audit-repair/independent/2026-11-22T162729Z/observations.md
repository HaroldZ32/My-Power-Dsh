# Independent pre-integration QA

The 16:18 UTC copy of `fix/team-and-audit-recovery` used `e86764c0e09b14ba172839bc9671a2c8f3352c81` plus the then-current repairs. Twenty-four input digests matched before and after copying. The copy still matched after testing. Six live automation and team files had moved by the end, so this record identifies a candidate snapshot. Bun 1.4.0, Node 24.21.0, Git 2.53.0 and Subversion 1.14.5 ran in disposable workspaces. The frozen acceptance criteria are in the repair plan. [Repair plan](../../../../.mpd/plans/repair-team-audit-124d4591.md)

## Observed checks

| Check | Exit and observations |
| --- | --- |
| `bun test ./packages/mpd-bootstrap-plugin ./packages/mpd-hashline-plugin ./packages/mpd-memory-plugin` with locally extracted real `svn` and `svnadmin` | 0. 67 passed, 554 assertions in 10 files. Stamped and unstamped preservation, overlapping replacements, actual Git staging/commit failure, Git/SVN history, and reflection retry passed. The injected partial dual-backend failure fixture used a fake SVN CLI and real Git. |
| Forced bootstrap exit after the first successful archival rename | SIGKILL, then retry exit 0. The stamp survived the interruption. All five edited/extra files, including a binary fixture, were byte-identical in three private backups after retry. A further boot kept the same backups. |
| `bun test` with the cellwork activation, autoproject engine and goal test files | 0. 49 passed in three files. A same-revision retry reuses the real board ID for dependencies and verification. The ambiguity control refuses. Auto hand-off checks the artifact and receiver reply. A later light or planned run leaves the first run's armed goal alone. |
| Two sequential successful planned autoproject runs through the registered tool | Two distinct persisted goal IDs, each completed by its owner, with two completed boulder rows. Used the actual goal bridge and boulder store and a deterministic host goal/consult fixture. |
| Bun default discovery, with and without the candidate `bunfig.toml` | Configured exit 0, two passing package/skill tests. Unconfigured exit 1, two failures from the evidence and dist trees. An extra failing test under a hidden `.qa-*` directory was excluded with the candidate config. |
| `node scripts/verify-docs-parity.ts` and `node scripts/verify-manual-paths.ts` | Both 0 with the full checkout available. 61 pairs, 606 resolved relative links, 165 audited manual paths. The manual is 61,750 bytes against a 65,536-byte budget. Git compared 39,577 tracked evidence paths to HEAD and reported zero changes. The preliminary snapshot intentionally omitted linked paths and produced copy-only diagnostics. |
| `node scripts/verify-gates.ts --list` | 0. 11 listed, zero spawned. |

## Findings on the first candidate

- **High — Hashline writes an insertion after an unaddressed line.** Read anchors for `A B C D E F`, then submit one batch with deletion of `B` through `D` and an append after original `B`. Both input orders returned success and left `A E INSERTED F`. Validate insertion anchors against consumed ranges, or map all operations to original boundaries before splicing. Acceptance criterion 2. [edits.ts, `detectOverlappingRanges` and `applyHashlineEditsWithReport`](../../../../packages/mpd-hashline-plugin/src/vendor/edits.ts)
- **High — A superseding cell split can duplicate already committed work.** Interrupt the first activation after the real board appends `T1` and before the cell records the ID. Update requirements, re-submit the same task keys, and activate revision 2. It reported success, mapped `alpha-core` to `T2`, and left both `T1` and `T2` pending. Reconcile outstanding append identities before computing kept and dropped rows for the newer revision. Acceptance criterion 4. [activate.ts, `materializeSplit`](../../../../packages/mpd-cellwork-plugin/src/activate.ts)
- **High — Autoproject completes its run and goal while boulder persistence has failed.** Make the disposable `.mpd/boulder.json` read-only immediately before its actual completion tool, then restore permissions. The tool and run state reported `complete`, the goal completed, and the boulder row remained `active`. Require a successful persisted boulder receipt before reporting completion or closing the run's goal. Acceptance criterion 4. [engine.ts, `boulderComplete` and `runAutoproject`](../../../../packages/mpd-autoproject-plugin/src/engine.ts)
- **Medium — Reflection reports complete with no readable journal record after a torn append.** Seed a reflection claim with real Git, append `{"kind":"reflection","file":` as the unfinished last line, then complete. The file was saved and the claim settled, and the journal had one malformed line and zero parseable reflection rows. Preserve and isolate the tail, then append and check a valid record before settlement. Acceptance criterion 2. [index.ts, `mpd_memory_reflect_complete`](../../../../packages/mpd-memory-plugin/src/index.ts) [store.ts, `appendJournalLine`](../../../../packages/mpd-memory-plugin/src/store.ts)

The mixed hashline insertion also reproduced against the audit baseline distribution. The reflection and cellwork issues exercise the new recovery paths. The baseline autoproject engine also discarded a failed boulder completion; moving the call to the final phase left that fault untreated.

## Data repair retest

Five writer-frozen source and test digests matched both the checkout and a fresh copy before and after a private pinned Bun build. The private and checkout hashline and memory distributions were byte-identical. The same three-package suite exited 0 with 71 passes and 608 assertions, including both real SVN arms. The bootstrap distribution was unchanged from the crash probe. [Writer freeze](../../user-data-followup/source-sha256.txt)

- Hashline refused both orders of the conflicting batch with the original bytes intact. Prepend before `B` and append after `D` still work around the replacement of `B` through `D`. Distribution SHA-256 `55437a00d6a38b2a7958a57639cbe6dad1be0b805964988b131ddecfcc46771a`.
- The original torn journal bytes and preceding valid record survived. The same public reflection call and replay returned one file, one real Git commit, one parseable journal entry and one settlement. A separate real SVN pre-commit refusal in `both` mode reported the Git-only receipt and left the claim due. On remount, the real SVN commit succeeded even while Git was locked, with the original file at SVN revision 2. Distribution SHA-256 `b967326369327e56aef0343ace09ac905d3b5885ef4eeefa84d2939dfacc930b`.

## Real DSH memory schema reproduction

The script runs the candidate memory distribution using the checkout QA installer, a pinned headless DSH process and the existing loopback provider. It checks the harness's paired tool-call results and verifies persisted bytes through real Git. Three boots returned exit 0 and accepted eight results. Under a real Git index lock, both writes preserved their plaintext and reported a backend error. Removing the lock let the same reflection settle once, with one Git version and one valid journal record. The first distribution SHA-256 was `34b753baa1aaf5bfe6ba54935290ed352f091e75c03c1cb5e378b06878e5efdc`. The same eight paired results passed on the rebuilt memory distribution `b967326369327e56aef0343ace09ac905d3b5885ef4eeefa84d2939dfacc930b`.

```bash
qa_scratch=$(mktemp -d "$PWD/.qa-memory-schema.XXXXXXXX")
mkdir "$qa_scratch/home" "$qa_scratch/tmp"
env -i PATH="$PWD/.qa-tmp/dsh-022/bin:$PATH" \
  HOME="$qa_scratch/home" TMPDIR="$qa_scratch/tmp" \
  node evidence/audit-repair/independent/2026-11-22T162729Z/memory-schema-probe.ts "$PWD"
```

Use the absolute root of a candidate copy as the last argument to verify that copy. The script records its memory distribution hash and uses no provider account. [Probe](./memory-schema-probe.ts)

## Preflight and bounds

- `docker info --format '{{json .SecurityOptions}}'` exited 0 and included `name=rootless` on Docker 29.9.2. DSH 0.2.2-rc.5, tmux and a local Go kit checkout were available. The candidate headless profile ran successfully. `npm view @deepseek-harness-tui/dsh-tui@0.20.2 version --json` in an isolated npm environment exited 0 and returned 0.20.2. The packaging writer separately recorded an artifact smoke on that version. [Packaging record](../../packaging/tarball-settled-smoke.log)
- Docker build, run and released-tarball probes remain for the integrated bytes. Provider-account and live UI paths, older hosts, and full gates are outside this recorded run. No final verification loop was opened.
- The archive that landed just before SIGKILL was preserved under the documented backup prefix. The next boot only logged new moves. Durable re-announcement of a prior backup was set aside because acceptance here concerns preserving the bytes and retaining a discoverable recovery location.
- Concurrent activation across distinct harness processes and physical power-loss durability were set aside. The fault arms establish a lost checkpoint, a process kill, a torn tail and an actual write refusal.
