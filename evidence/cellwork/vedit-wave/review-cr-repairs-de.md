# T26 — re-review: CR repairs D (verify plugin, four items) and E (leaf rule)

**Seat:** R2 (`reviewer-planes`), board task **T26**.
**Reviewed:** T21 (CR repairs D: CR#14, CR#13, CR#11, CR#12) and T22 (CR repair E: CR#8 leaf rule +
verifier no-delegation), on the LANDED bytes, judged from the two task rows' acceptance, the frozen
contract (C2/C3/C5) and the captain's T26 message (the final landed shape).
**Instant:** 2026-10-31T06:48:20Z; reviewed hashes in `bde2/logs/source-hashes-at-review.txt`. I did not
rebuild dist and edited nothing outside `evidence/cellwork/vedit-wave/bde2/**` and this document.
**Verdict: APPROVE the D and E code/security repairs (verify-side probe 10/10, leaf/verifier probe 5/5;
all gates green). ONE documentation item remains OPEN and is owned by T24's in-flight docs task (F1):
at my review instant the `mpd-verify-plugin` README pair was still pre-CR#14; T24 landed the EN half
correctly DURING this review, while the zh twin is still stale. T24's own acceptance requires both
halves in one commit, so approving D/E is conditional on that pair landing complete — I name the exact
remaining gap below.**

## 1. Item by item (PASS/FAIL + probe + observed output)

| # | Item | Verdict | Probe / observed |
|---|---|---|---|
| 1 | **CR#14** log header + metadata name the PROGRAM and ARGV that ran; `cmd` is a separate label | **PASS (behaviour) / OPEN (docs, T24)** | `bde2/probe-verify-cr.ts`, arm `CR14/program-argv-header`, on a file with `cmd:"bun test packages"`, `argv:["true"]`: exit **0**, log first line exactly `# gate tests cmd: "bun test packages" program: "true" argv: []`, **2** log lines, metadata `cmd` = the LABEL, `gateFreeze:"frozen"`, `logSha256` matches the log bytes. Behaviour is right. On the docs half: at 06:48Z BOTH halves still said the first line is `# gate <id> cmd: <effective cmd>`; T24's in-flight edit then landed the EN correction (now: `# gate <id> cmd: <label JSON> program: <program JSON> argv: <args JSON>`, plus the spawn-error/escape/`gateFreeze` bullets), while `packages/mpd-verify-plugin/README.zh-CN.md` STILL reads `# gate <id> cmd: <生效命令>` with no program/argv/freeze (F1, open, T24's scope). |
| 2 | **CR#13** a missing program leaves the spawn error in the log (and the tail) | **PASS** | Same probe, arm `CR13/spawn-error-cause`: exit **-1**; log line 2 is `[spawn-error] Executable not found in $PATH: "definitely-no-such-program-t26-xyz"`; `tail` carries the same cause; metadata `exit:-1`. |
| 3 | **CR#11** a newline in `cmd` or an `argv` element cannot forge a log line | **PASS (on the captain's final criterion)** | Arms `CR11/control-chars-one-line`: (a) `cmd:"bun test\nFORGED-CMD"`, (b) `argv[3]:"\nFORGED-ARGV"`, (c) `cmd` with U+2028 + DEL. Each run is accepted and the log is exactly **2 lines** (header + child output), no line after the header starts with `FORGED-`, and the header carries NO raw control/line-separator (`\n` → `\\n`, `\u2028`, `\u007f` escaped). NOTE: the task row's R-D3 wording asked the entry to be REFUSED with no evidence; the landed design ESCAPES and accepts. I judge against the captain's final description ("must leave the log at exactly its expected line count") — PASS, with the closure-table wording flagged below. |
| 4 | **CR#12** per-loop freeze of the workspace `mpd-gates.json` | **PASS** | `CR12/d-unchanged`: file final before open → run exit 0, `gateFreeze:"frozen"`, one metadata row. `CR12/a-changed`: edit after open → refused `gate-freeze: mpd-gates.json changed after loop "…" was opened (frozen sha256 …, now sha256 …)`, **0** evidence rows. `CR12/b-deleted`: delete after open → refused (`… now absent`), 0 rows. `CR12/c-appeared`: loop opened with no file froze `{state:"absent"}`, file created later → refused, 0 rows. `CR12/e-unfrozen`: legacy TOOL loop with no `gateFile` → refused `gate-freeze: loop "…" carries NO frozen mpd-gates.json … open a NEW loop …`, 0 rows, while `kind:"probe"` and a FAIL `mpd_verify_record` under the same loop still work. `CR12/observer`: `armDelegateLoop` freezes at arm time (present), a post-arm edit is refused, a legacy observer loop re-armed with the SAME loop id ADOPTS the freeze and its next run is green/frozen. `CR12/unbound-bound` (the captain's Blocker check): an evidence run bound to an unknown loop (`waveloop-…`) resolves the live file and declares `gateFreeze:"unfrozen"`, and citing that evidence for a REAL loop is refused with `forged-evidence` — the declared bound holds. Refusal happens before `resolveGate` (zero rows, code order verified). |
| 5 | **CR#8** depth floor on both spawn surfaces; `cellwork_recon` excluded | **PASS** | `bde2/probe-leaf-cr.ts`: `consultDepthRefusal` (roles + workmate, byte-identical texts) is undefined at depth 0/1 and for `origin:"subagent"`, and refuses depth 2, depth 3 and subagent+depth 2 with the teaching sentence (`…LEAF…`, `…delegation depth 2…`, `…hand the question UP…`). Caps stay `depth + 1` (0→1, 1→2, 2→3) on both surfaces. `READONLY_DENY` is exactly 8 names (incl. `bash`) and identical in both packages; `LEAF_SPAWN_DENY` is exactly `["mpd_role_spawn","mpd_workmate_spawn"]` in both. `cellwork_recon` is NOT refused by the depth rule: the verifier/subcaptain/planner decisions all allow it, and `recon.ts` bounds it with `maxDepth: deps.config.depthMax` (no `consultDepthRefusal` exists in the cellwork package). |
| 6 | **CR#8 second half** the VERIFIER seat never delegates | **PASS** | Same probe, arm `CR8/verifier-no-delegation`: `mpd_role_spawn` and `mpd_workmate_spawn` are refused with the distinct `A VERIFIER NEVER DELEGATES … a FAIL bounces the work back to its writer` sentence (not the write refusal); `read`, `grep`, `glob`, `bash`, all five `mpd_verify_*` and `mpd_roles_list` / `mpd_workmate_list` / `mpd_workmate_match` stay allowed; a plain member is unaffected for both spawn tools. `VERIFIER_DENY_TOOLS` is 7 names and does NOT contain `bash`; `VERIFIER_NO_DELEGATION` is the two spawn names. |
| 7 | **CR#8 layer 1** the leaf deny is in every child's own scope (inspection) | **PASS (inspection + tests)** | `mpd-roles-plugin/src/index.ts`: `applyChildReadonlyDeny` applies `[...READONLY_DENY, ...LEAF_SPAWN_DENY]` in ONE `restrictAgentToolsRetained` call; `applyChildLeafDeny` applies `[...LEAF_SPAWN_DENY]` alone; the `agent/created` listener returns for an unresolvable/foreign label and for read-only roles (whose seam applier already carries the names) — so no child is double-restricted and another row's child is left alone. The same partition exists in `mpd-workmate-plugin/src/index.ts`. I could not drive the harness `agent/created` bus from a probe; the two packages' seam/leaf tests pass (below). |

## 2. Gates (quote, per package, R9 discipline)

| Gate | Command | Exit | Observed |
|---|---|---|---|
| verify tests | `.toolchain/node_modules/.bin/bun test packages/mpd-verify-plugin` | **0** | **82 pass / 0 fail** (4 files) |
| roles tests | `.toolchain/node_modules/.bin/bun test packages/mpd-roles-plugin` | **0** | **191 pass / 0 fail** (12 files) |
| workmate tests | `.toolchain/node_modules/.bin/bun test packages/mpd-workmate-plugin` | **0** | **62 pass / 0 fail** (6 files) |
| cellwork tests | `.toolchain/node_modules/.bin/bun test packages/mpd-cellwork-plugin` | **0** | **172 pass / 0 fail** |
| comments | `node scripts/verify-comment-coverage.ts` | **0** | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.` |
| docs (gate runs on the pair/links only; it cannot catch semantic drift — see F1) | `bun run verify:docs` | **0** | `pairs=52 failed=0 violations=0 exempt=24 derived=3 links=471 dead=0 — PASS` |
| acceptance files | verify `gates-project` + `open-writer-id`; roles `role-spawn-maxdepth` + `leaf-boundary`; workmate `workmate-spawn-maxdepth` + `leaf-boundary`; cellwork `verifier-no-delegation` + `planner-guard` + `band-parity` | **0** | 24/0, 18/0, 16/0 pass/fail respectively |
| dist (read-only check only; I did NOT rebuild) | `node scripts/verify-dist-fresh.ts` | **0** | `ok: 34/34 targets fresh` — the roles (14:41:37) and verify (14:42:27) dist were rebuilt around the dispatch, so the T26 message's "verify dist is stale on purpose" no longer describes the tree; not a finding (captain's surface). |

## 3. Findings (ranked)

**F1 — High, OPEN, owner T24 (documentation). The `mpd-verify-plugin` README PAIR is half-updated for
CR#14.** T21's acceptance included the pair's header description ("both halves, same commit"), yet at
06:48Z both halves still stated "Its first line is `# gate <id> cmd: <effective cmd>`" and listed only
`cmd/exit/logPath/logSha256`. During this review T24's docs edit (R-F3) landed the EN half correctly —
it now names `cmd: <label JSON> program: <program JSON> argv: <args JSON>`, the `[spawn-error]` cause,
the control-character escaping, the `gateFreeze` field and the per-loop freeze — but
`packages/mpd-verify-plugin/README.zh-CN.md` STILL carries the old line
(`# gate <id> cmd: <生效命令>`, no program/argv/freeze). `verify:docs` only checks pair existence, switch
links, headings and links, so it cannot catch this semantic drift. Why it matters: a zh reader auditing
a PASS is still told the wrong header, and T24's own acceptance says both halves move in the same
commit. *Direction:* land the same three bullets in the zh twin before the commit; the EN text is the
template already in the working tree. (If the captain prefers, T24's task note already owns this.)

**F2 — Nit (residual, not blocking). The freeze is checked by one read of `mpd-gates.json` and the run
then reads the file AGAIN.** `gateFreezeRefusal` → `projectGateIdentity` hashes the file, then
`resolveGate` → `loadProjectGates` re-reads and parses it before `runGate`; a concurrent writer landing a
change in that window would run bytes the freeze did not certify while the row still says `frozen`. The
log now names the program+argv that really ran, so the evidence stays honest about WHAT executed; only
the "frozen" guarantee can be stale for that one run. *Direction:* read the file once and run the frozen
bytes (or re-hash after the run and refuse/re-run on a change).

No Blocker, no other High/Medium.

## 4. Declined to judge (each with its reason on the same line)

1. **CR#11's task-row wording ("REFUSED, no evidence") vs the landed escape-and-accept design** — the
   captain's final T26 description sets the criterion as the log's line count, which the code satisfies;
   the security property (no forged lines in the hashed artefact) is met. Recommend T27's closure table
   say "escaped in the header", not "refused".
2. **The evidence metadata keeps `cmd` as the label only (no program/argv fields)** — R-D1's first
   wording said "the metadata names both", the captain's final description says the meta's `cmd` stays
   the label; the log is the hashed artefact that names the truth. Not counted as a defect.
3. **Observer re-arm ADOPTS the current file into a legacy observer loop** — the captain's description
   explicitly requires this so an old observer loop does not refuse its own evidence forever; the
   deliberate trade-off is on the record, not a defect.
4. **The verifier may still call `cellwork_recon`** — a read-only consult, explicitly outside the
   two-spawn-tool repair; the task's item 6 names only `mpd_role_spawn` / `mpd_workmate_spawn` — declined.
5. **`armDelegateLoop` reuses the first armed observer loop of a session whichever spawn tool it saw** —
   pre-existing behaviour, not introduced by CR#8 and not in its scope — declined.
6. **The `TOCTOU` window's practical exploitability** — see F2; reported as a Nit rather than a Blocker
   because the log names what ran and the window needs a same-instant concurrent edit — declined as a
   blocker.
7. **The two doc-caps Nits from T7 (`writer_reason` 1..200, project `cmd` 4096)** — outside this repair
   wave and unchanged — declined here.

## 5. Bounds

- No live harness: the verify tools were driven through `registerVerifyTools` with a captured registry;
  the observer path through the exported `armDelegateLoop`; the `agent/created` leaf-deny layer by
  inspection plus the packages' seam/leaf tests (a probe cannot drive the harness event bus).
- Red-first was not re-run: the CR repairs are uncommitted, so no pre-fix copy exists in git; I verified
  the LANDED behaviour plus the arms the lanes shipped. The lanes' own tests were run but never used as
  proof.
- Lane A/B/C/F/M repairs are T25's and the other seats' scope; I reviewed only D and E, plus the
  cellwork guard change CR#8 second half.
- I did not rebuild dist (`verify-dist-fresh` was run read-only for information), and did not edit src,
  test, docs or a gate.
- R9: every probe workspace is a `mktemp` directory; this evidence tree contains no `*.test.ts`; no
  `mpd-gates.json` was written inside the checkout.
