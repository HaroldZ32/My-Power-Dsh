# T5 — independent verification of the captain recon fence (wave 2)

**Reviewer seat:** 1f174ce8-26f0-48a6-a977-a6550d8b50ec (loop `loop-20261109T025106-3ccdf5`, verifier-3)
**Subject:** `.mpd/plans/captain-recon-fence.md` §3 C1/C2/C3, §4 B1–B6, §6 bounds, §7 amendments
**Reviewed tree:** HEAD `b956b213` + the wave's uncommitted changes (10 modified tracked files, `git status`).
**Wall-clock:** 2026-11-09 10:25–11:05 Asia/Shanghai.

## Assessment

The wave's mechanical core is real and reproduces: every contract R1 launcher spelling is refused, the
anti-false-positive list is allowed, the three new tool doors close, the boot line names only guards that
installed, and the wave's nine gates plus the live mount reproduce green from disk. The risk sits entirely
in C3's new shell read-route: it refuses two broad classes of ORDINARY captain shell use that wave 1
allowed (`grep` behind a pipe, and any alternation regex inside quotes), and it can be walked around with
a plain `cd`. Two acceptance texts are also not met as frozen (B3's `cat packages/x.ts`, and §3 C2's
"any non-string element is refused"). Risk level: **HIGH** for shell usability, MEDIUM for the enforcement
gap, LOW for the rest.

## Ranked findings

### F1 — HIGH — piped `grep`/`rg`/`ag`/`ack` is refused as reconnaissance (C3)
- **What:** a search segment with no EXISTING path candidate is refused even when it is not the first
  segment and reads the previous segment's stdout. `git log --oneline | grep fix`,
  `ls -la | grep md`, `cat docs/decisions.md | grep TODO` are all REFUSED; the refusal quotes the
  second half (`grep fix`) and tells the captain to delegate reconnaissance.
- **Where:** `packages/mpd-roles-plugin/src/captain-shell.ts`, `captainShellReadViolation` (the
  `existing.length === 0 && search` branch), reached from `captainShellDecision`.
- **Why it matters:** piping output into `grep` is ordinary bookkeeping, not reconnaissance, and wave 1
  allowed it. The contract's rationale ("a call with NO non-flag argument searches the whole workspace")
  is false for a pipeline member: a piped grep reads stdin and searches nothing. This is a user-visible
  regression on a common command family.
- **Direction:** make the read-route pipeline-aware — a search segment that follows a `|` (i.e. is not
  the first segment of the command) reads stdin and is ALLOWED; keep the fail-closed whole-workspace
  refusal for a LEADING search segment only. A contract §7 amendment should record the clarification.
- **Evidence:** `probe.log` (B3 false-positive hunt block).

### F2 — HIGH — quote-blind `|` splitting turns every alternation regex into a refusal (C3)
- **What:** `grep -E "fix|feat" docs/decisions.md` and `grep -E 'TODO|FIXME' docs/decisions.md` are
  REFUSED, and the refusal sentence quotes a truncated `grep -E "fix`. `awk '/TODO|FIXME/' docs/x` happens
  to survive only because the doc path lands in the second half — so the behaviour is also inconsistent.
- **Where:** `captainShellSegments` splits on `&&|\|\||;|\||\r?\n` BEFORE any quote handling; the
  read-route then sees a pattern-less first half. `stripSurroundingQuotes` runs too late to help.
- **Why it matters:** a `|` inside single or double quotes is not a shell separator; a quoted regex is
  ONE token (which is exactly what §6's token bound says the rule inspects). Searching the documentation
  band with an alternation is a legitimate, common captain command and it is now impossible.
- **Direction:** make the segment splitter quote-aware (split only at top-level separators), or detect an
  unbalanced quote and judge the whole unsplit string. This is a code fix, not a contract amendment.
- **Evidence:** `probe.log` (false-positive hunt block).

### F3 — HIGH — a plain `cd` walks around the read-route (C3)
- **What:** `cd packages/mpd-roles-plugin/src && cat captain-shell.ts` and
  `cd packages && cat mpd-roles-plugin/src/index.ts` are ALLOWED, because each segment's relative token
  is resolved against the WORKSPACE ROOT instead of the shell's current directory (`captain-shell.ts`,
  `captainShellPathExists`), and the token `captain-shell.ts` does not exist at the root — so it is
  ignored as a non-existent path and the reader is allowed.
- **Why it matters:** the persona says "NEVER ROUTE AROUND THE GUARD: reading a source path through bash
  (`cat`, `sed`, `rg`) is the same act", and C3 is its mechanical form. A static `cd` prefix is not the
  declared "runtime-assembled path" bound (`cat "$F"`); it defeats every FILE READER with one cheap
  spelling, so B3's "cat packages/x.ts REFUSED" holds only until the caller changes directory.
- **Direction:** track the `cd` target within the command and resolve later segments against it, or fail
  closed on a relative reader token after a preceding `cd` segment. Owner: Senior Engineer (C3).
- **Evidence:** `probe.log` (false-positive hunt block, last five `observe` rows).

### F4 — MEDIUM — `rg --files docs/` refused; the pattern-first assumption ignores mode flags (C3)
- **What:** `rg --files docs/` is REFUSED as a whole-workspace search because `--files` is a flag and the
  first non-flag token (`docs/`) is consumed as the PATTERN; `rg --files -g '*.md' docs/` is ALLOWED
  because the glob value is then consumed as the pattern. Inconsistent and surprising.
- **Where:** `captainShellReadViolation` (`READ_VERB_PATTERN_FIRST` → `nonFlags.slice(1)`).
- **Direction:** teach the read-route the flag-only search modes (`--files`, and the no-pattern list
  spellings) or treat a non-flag token that EXISTS as a path as a candidate when no explicit pattern
  follows the verb.
- **Evidence:** `probe.log` (false-positive hunt block).

### F5 — MEDIUM — `ast_grep_search` non-string element is ignored, not refused (C2, contract deviation)
- **What:** `mcp__ast_grep__search {paths: ["docs/", 42]}` is ALLOWED. Frozen §3 C2: "A bare call, an
  empty array or any non-string element is refused". `astGrepSearchPaths` filters non-strings out, so
  only a list with NO usable string entry reaches the bare-call refusal.
- **Where:** `packages/mpd-roles-plugin/src/captain-investigation.ts`, `astGrepSearchPaths`.
- **Why it matters:** fail-closed posture; a shape the contract names as refused is admitted when it
  travels beside a permitted string. No live leak was observed (the MCP schema types `paths` as
  `string[]`, so the harness/server rejects a number before the guard sees it), which is why this is
  Medium and not High.
- **Direction:** treat a non-string entry as an offending path and refuse (or amend §3 C2 if the ignore
  is intended). Owner: Deep Worker (C2).

### F6 — MEDIUM — B3's literal arm is not met: `cat packages/x.ts` is ALLOWED
- **What:** `cat packages/x.ts` (and `cat docs/x.md`) are ALLOWED because neither path exists in this
  checkout and §3 C3 deliberately ignores non-existent tokens (that filter is what keeps
  `sed -n '1,10p' docs/x.md` allowed). The intended behaviour is proven with a REAL source path
  (`cat packages/mpd-roles-plugin/src/index.ts` → REFUSED), and the writer's own test asserts the
  allowance (`captain-shell.test.ts`, "bounded readings" arm).
- **Why it matters:** B3 is the frozen acceptance text a verifier must judge; as written it FAILS. The
  contradiction is in the contract (C3 says ignore non-existent tokens; B3 says a non-existent
  `packages/x.ts` must be refused), not in the code. A §7 amendment naming a real source path is the
  smallest correct remedy; do NOT change the existence filter.
- **Direction:** captain amends B3's example to an existing source path (e.g.
  `packages/mpd-roles-plugin/src/index.ts`). No writer code change required.
- **Evidence:** `probe.log` (B3 block).

### F7 — MEDIUM — the persona's READ DISCIPLINE line names only 6 of the 16 gated shell readers (B5)
- **What:** the line names `cat`, `sed`, `rg`, `head`, `tail`, `find` (and `grep` only earlier as the
  harness TOOL) but the guard also refuses `grep`, `awk`, `less`, `more`, `ag`, `ack`, `strings`, `xxd`,
  `od`, `nl` as shell verbs. `verification-flow.md` §5 rule 2 repeats the same six-name sample.
  `AGENTS.md` §5 rule 2 is generic ("shell read-verbs"), so it does not mislead.
- **Where:** `presets/mpd.patch.yml` (READ DISCIPLINE, SOURCE PATHS bullet);
  `agent-references/verification-flow.md` §5 rule 2.
- **Why it matters:** the persona is the model-facing steering text; an incomplete enumeration reads as
  complete, so a captain can expect `grep`/`awk` on a source path to be allowed and hit a refusal.
- **Direction:** say "any shell read verb (e.g. …)" or extend the list with `grep` and the rest.

### F8 — NIT — a redirect target is judged as a READ path (C3)
- **What:** `cat docs/decisions.md > package.json` is REFUSED because the EXISTING redirect target is
  collected as a non-flag argument and judged by the read-route; `> /tmp/out.md` is allowed because the
  target does not exist yet.
- **Why:** `>` is a write, not a read; refusing a legitimate output target with a reconnaissance message
  is a misread of the shell shape. Low impact; direction: skip tokens that follow a redirection operator.

### F9 — NIT — in-place `sed -i` on a source path is refused as reconnaissance (C3)
- **What:** `sed -i 's/…/…/' packages/mpd-roles-plugin/src/index.ts` is REFUSED, although the persona
  declares the write path ungated and `write`/`edit` stay direct. Docs-targeted `sed -i` is allowed.
- **Direction:** treat `sed -i`/`-i.bak` as a WRITE (not a read) and pass it through, or say in the
  refusal that in-place source edits go through `edit`.

### F10 — NIT — `law.ts`'s new `PATH_LIST_TOOLS` comment is stale for search
- **What:** the comment says the list is "judged by its FIRST entry", but for `mcp__ast_grep__search`
  the guard judges EVERY entry; `readTargetPath` reads the first entry only as the shared single-path
  shape.
- **Where:** `packages/mpd-verify-plugin/src/law.ts`, `PATH_LIST_TOOLS`.
- **Direction:** state the two-level truth in one sentence.

### F11 — NIT — the `dsh-qa` case-table row for `captain-scope` does not mention the shell guard
- **What:** `skills/dsh-qa/SKILL.md` (captain-scope row) describes the boot-line arms as
  `captainInvestigation` / `delegationGate` / `sessionGate` / `verifyGate` and never `captainShell`;
  the case itself asserts the shell install and passes (wave-1 carry, not this wave's B5 text).
- **Direction:** add the `captainShell=deny patterns=<N>` token to the row's discriminating sentence.

### F12 — NIT — the verification-flow boot-line sample elides three live tokens
- **What:** the sample at `agent-references/verification-flow.md` §5 rule 2 omits `questions=relay`,
  `routes=0` and `sensitivity=easy`, which the live line carries (my run:
  `evidence/roles/captain-scope/2026-11-09T02-59-34.610Z/result.json`). It is an elision, not a wrong
  count; a reader diffing a live log against the sample sees a mismatch.
- **Direction:** either include the three tokens or mark the line as elided.

## Verified as correct (evidence-backed)

- **B1 PASS.** All contract R1 spellings REFUSED in the shipped decision: `npm test`, `npm run typecheck`,
  `bun typecheck`, `bun run --silent typecheck`, `env FOO=1 bun run typecheck`, `/usr/local/bin/bun test`,
  `sudo -E bun test`, plus `sudo -u root bun test`, `FOO=1 bun test`, `command/nohup/time bun test`,
  `/usr/bin/env bun test`, `npm run verify:gates`, `npm run test:unit`, `pnpm`/`yarn`, `npx tsc|jest|vitest`,
  `bun test --timeout`, `cd … && bun test`, `; bun test`, `| bun test`. The anti-false-positive list is
  ALLOWED; child sessions (`topLevel=false`) and `captain.shell:"allow"` are unaffected (probe).
- **B2 PASS** on the §4 arms: `mpd_hashline_read` source REFUSED / docs ALLOWED; `codegraph_explore` bare
  REFUSED; `ast_grep_search` refuses an out-of-band entry in EITHER position (T8 repair works) and allows
  `docs/`; all NINE lsp readers refuse a source `file_path`; child sessions unaffected; `readTargetPath`
  keeps `paths[0]` precedence and its `file_path`→`path`→`filePath`→`target` order, and the law.ts diff is
  exactly the §7-authorised constant + two-line change.
- **B4 PASS.** My own live mount (headless, pinned 0.2.2-rc.1 harness) prints
  `readOnlyGuard=installed deny=10 captainInvestigation=deny captainShell=deny patterns=16
  delegationGate=deny verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)
  askUserQuestion=installed … sessionGate=mechanical`; the token is computed from the installed outcome
  and the deny-table length (16 = 10 v1 rows + 6 wave-2 rows), so no token claims a guard that did not
  install. The known bound stands: this proves INSTALL, not a live DENIAL (headless composes no preset);
  the denial rests on the shipped pure-decision arms, which I drove directly.
- **B5 PASS on the named docs:** AGENTS.md §5 rule 2, verification-flow §5 rule 2 and the persona all name
  the hashline reader, the MCP recon tools and the shell read-route; every QA-pinned literal survives
  (`captain-scope` PASS 8/8). F7 is the completeness finding, not a false statement.
- **B6 PASS.** I reproduced all nine gates plus the live mount: G1 `bun test packages/…` 479 pass / 0 fail
  (26 files), G2 typecheck exit 0, G3 dist 34/34 FRESH under the pinned bun 1.4.0, G4 comments PASS
  (618 files / 55469 declarations), G5 rows 36 ids, G6 preset-conformance PASS (33 rows, 28 children,
  `session/create` `agentPreset=mpd`, negative control red), G7 docs PASS (pairs=59, dead=0), G8 manual
  paths PASS, G9 vendor PASS (8 assets), G10 `captain-scope` PASS (8 rows) — all exit 0, matching the
  wave bundle's summaries. Verify-plane gate evidence: `tests`, `comments`, `rows` (ids below).

## Declined to judge

- **`bash -c 'bun test'` / `sh -c 'npm test'` ALLOWED** — outside C1's frozen wrapper list; C1 step 1 names
  `sudo, command, exec, time, nohup, builtin, env` only, and the module header declares the table is
  "command FAMILIES, not a taxonomy of every way a gate can be launched". Noted for a future wave, not a
  finding against this contract.
- **`env -u FOO bun test` ALLOWED** — the contract's env step covers `NAME=value` tokens only, not env's
  own options; outside the frozen list.
- **`npm --prefix . test` ALLOWED** — a flag between the launcher and the script is outside C1's enumerated
  spellings (step 4 covers flags only between `run` and the script).
- **`bun run --filter x test` ALLOWED** — explicitly declared in the module header (a run flag with a
  separate value is not collapsed).
- **`mcp__lsp__rename_symbol` ALLOWED for the captain** — a WRITE; the contract keeps it out and the
  member read-only deny list carries it.
- **`git show HEAD:file` / `git grep` ALLOWED** — declared residuals in §6.
- **Nested instruction files readable (`packages/x/AGENTS.md` → allowed)** — intended C4/D14 rule per the
  module header; the nearby `captainReadablePath` comment about root files is ambiguous but pre-existing.
- **The evidence bundle's parenthetical "wave 1 booted with patterns=9"** — verified true against wave 1's
  own boot log (`evidence/roles/captain-scope/2026-11-09T01-55-53.580Z/`, patterns=9); wave 1's repair
  run (`02-05-34.247Z`) shows 10. Historically accurate, not judged further.
- **The wave's `AGENTS.md` §13 glossary compression** — an instruction-budget MOVE, gated by
  `verify:manual-paths` (PASS) and `verify:docs` (PASS); content accuracy not re-judged here.

## Bounds of this review

- **Did not read:** the full 676-line shell test file (I read the anti-false-positive / B3 / scope arms and
  grepped the rest), the full 397-line investigation test file, the roles `index.ts` apply site beyond the
  boot-line lines, and the committed `dist` bytes (certified by `verify-dist-fresh`, not read).
- **Could not run:** a live DENIAL through an `agentPreset: mpd` session — a headless boot refuses to
  compose a preset, and I have no web-profile session lane. The denial claim therefore rests on the
  shipped decision functions driven directly at the real workspace root (and on the writer's own arms),
  never on a dispatch-level denial. No Docker lane (not in B6).
- **No reviewed code was edited.** The only files written are under
  `evidence/guard/captain-recon-fence/review-t5-2026-11-09T02-57-00Z/` and the QA case's own evidence dir
  produced by my re-run (`evidence/roles/captain-scope/2026-11-09T02-59-34.610Z/`).

## Verdict

**FAIL — request changes.** B3's literal acceptance arm is unmet and C3 introduces two HIGH false-positive
regressions (piped `grep`, quoted alternation) plus a cheap `cd` bypass; the gates, boot tokens and the
wave's evidence bundle otherwise reproduce exactly. F1/F2/F3 return to the C3 owner (Senior Engineer);
F5 to the C2 owner (Deep Worker); F7 to the B5 doc owner; F6 needs a captain contract amendment.
