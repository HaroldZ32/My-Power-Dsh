# R2 acceptance checklist — lanes B, D, E

Written from `.mpd/plans/cellwork-vedit-wave.md` §2 (C1-validation, C9, C10, C2-server, C3, C4, C5)
and §7 (R1, R2) BEFORE any diff was read, per the review method. Judged from the contract and from
observable behaviour; lane tests are the writer's claim, not proof.

Lane B (cellwork-graph) — `split.ts`, `requirements.ts`:

- [ ] B01 C1: split task input carries optional `member?: string`, one spelling only.
- [ ] B02 C1: absent `member` ⇒ resolved board member name is `ownerRole` (behaviour unchanged).
- [ ] B03 C1: present `member` ⇒ resolved member name is `member`; `ownerRole` still validated against
      roster/cell roles (role existence unchanged).
- [ ] B04 C1: `member-invalid` finding for empty name, >64 chars, a control character, or a path separator.
- [ ] B05 C1: `member-role-conflict` finding when two tasks name the same `member` with DIFFERENT
      `ownerRole`s.
- [ ] B06 C1: several tasks MAY share one `member`; several `member`s MAY share one `ownerRole`.
- [ ] B07 C1: `self-review` compares RESOLVED member names when both sides declare one, falls back to
      `ownerRole` otherwise.
- [ ] B08 C9: every refused submission writes `split/<revision>.refused.json` with `accepted:false` and the
      full finding list.
- [ ] B09 C9: an accepted verdict is never overwritten by a later refused submission (the two files coexist).
- [ ] B10 C9: the `split-refused` journal row carries the findings (not just counts).
- [ ] B11 C10: a section body runs until the next heading of the SAME OR HIGHER level; `###` and deeper stay
      inside the parent section.
- [ ] B12 C10: a section body that is only whitespace is still "missing or empty" (refusal kept).

Lane D (verify-planes) — `gates.ts`, `tools.ts`, `ledger.ts`, `index.ts`:

- [ ] D01 C2: `mpd_verify_open` accepts optional `writer_id` (trimmed, non-empty, ≤200 chars).
- [ ] D02 C2: `writer:"delegate"` + `writer_id` ⇒ loop's `writer.id` IS that value (no `delegate:pending`).
- [ ] D03 C2: `writer_id` absent ⇒ unchanged `delegate:pending`.
- [ ] D04 C2: `writer:"self"` + `writer_id` ⇒ refusal.
- [ ] D05 C2: optional `writer_reason` stored on `writer.reason`, delegated loops only.
- [ ] D06 C2 acceptance: loop opened with `writer_id: S`, verdict recorded by session S ⇒ refused with
      `same-agent`; the same loop recorded by a DIFFERENT session ⇒ accepted; loop file shows
      `writer.reason` naming the member.
- [ ] D07 C2: `mpd_verify_record` refuses when `record.writerId === record.verifierId`.
- [ ] D08 C3: project file `mpd-gates.json` at the WORKSPACE ROOT; absent ⇒ today's frozen table unchanged.
- [ ] D09 C3: shape `{"version":1,"gates":{"<id>":{"cmd"?:string,"argv":[string,…]}}}`; `cmd` defaults to
      `argv.join(" ")`.
- [ ] D10 C3: `version` optional, must be `1`.
- [ ] D11 C3: id matches `^[a-z][a-z0-9-]{0,31}$`.
- [ ] D12 C3: `argv` 1..32 non-empty strings of ≤4096 chars.
- [ ] D13 C3: unknown top-level keys, unknown entry keys, non-array `argv`, missing/empty `argv` ⇒ gate call
      REFUSES with ONE sentence naming the file and the problem; no silent fallback.
- [ ] D14 C3: ≤32 entries.
- [ ] D15 C3: project entry first, frozen table second; a project entry ADDS a new id or OVERRIDES an
      existing one.
- [ ] D16 C3: `argv[0]` is the program (PATH or absolute), spawned `shell:false`, `cwd` = workspace, the
      existing `gateTimeoutMs` timeout.
- [ ] D17 C3: the recorded evidence log header names the EFFECTIVE `cmd`.
- [ ] D18 C3: the project file is resolved per call from the CALLING SESSION's workspace (never module-level
      cached — AGENTS.md §6).

Lane E (roles-captain) — `captain-investigation.ts`, `roles index.ts`, cellwork `guard.ts`, `prompts.ts`:

- [ ] E01 C4: the captain may read any file whose BASENAME is `AGENT.md`, `AGENTS.md` or `CLAUDE.md`, at any
      depth inside the workspace AND outside the workspace root.
- [ ] E02 C4: everything else unchanged — source paths refused, `..` segments refused, only `read`/`grep`/
      `glob` intercepted.
- [ ] E03 C4: the refusal text advertises the TRUE band incl. `AGENT.md`/`CLAUDE.md` and that only
      `README.md` + `README.zh-CN.md` are admitted (no `README*` glob).
- [ ] E04 C5: `mpd_role_spawn` forwards explicit `maxDepth` = the caller's recorded delegation depth + 1; a
      top-level caller keeps `maxDepth` = 1.
- [ ] E05 C5: a cellwork seat in mode `member` named `cell-planner` has `read`/`grep`/`glob` refused on
      source paths; readable = the same documentation band prefixes, the three instruction-file basenames at
      any depth, and paths outside the workspace root for those basenames.
- [ ] E06 C5: the planner refusal TEACHES `cellwork_recon` (Explorer/Researcher) and `mpd_role_spawn` with a
      read-only roster role, and says why.
- [ ] E07 C5: the planner prompt tells it to delegate reconnaissance and not to read source itself
      (`PLANNER_RECON_LINES` exported from `prompts.ts`, spread into `plannerPrompt` in `staging.ts`).
- [ ] E08 C5: the cellwork band lists equal `mpd-roles`' exported `CAPTAIN_READABLE_PREFIXES` /
      `CAPTAIN_READABLE_ROOT_FILES` / `ROOT_LICENSE_PATTERN` semantics, pinned by a parity test that imports
      both modules (no runtime cross-package import).
- [ ] E09 R1: the `captain-investigation.test.ts` edit is limited to the pre-C4 "instruction files only at
      the root" lines — nested `AGENTS.md` flipped to allowed (plus its title/comment); (a) nested
      `README.md` refusal still asserted, (b) no other assertion moved, (c) remaining cases still fail for
      their original reasons.

Lane-wide §4 gates:

- [ ] G01 `bun test packages/mpd-verify-plugin packages/mpd-roles-plugin` green on the pinned toolchain.
- [ ] G02 `bun test packages/mpd-cellwork-plugin` green on the pinned toolchain.
- [ ] G03 `node scripts/verify-comment-coverage.ts` green.
- [ ] G04 new-test red-before-green claim is credible where the defect is unit-testable (checked from the
      lane's own evidence/logs, not taken as proof of the fix).
