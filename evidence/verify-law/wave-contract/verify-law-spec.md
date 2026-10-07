# Spec — the verification law (W4), frozen by the Architect in T2

Source: the Architect's T2 deliverable (wave `de-vendor-and-verify-law`), persisted verbatim in
substance by the captain. Read against `.mpd/plans/de-vendor-and-verify-law.md` (the frozen contract)
and AGENTS.md §5/§6/§7/§13.

**VERDICT OF THE SPEC:** five new tools in ONE new package `mpd-verify-plugin`, ONE extra `guardTool`
install at the roles plugin's existing site, an append-only ledger under `<ws>/.mpd/verify/`, and a
record validator that is the ACTUAL guarantee. The guard is defence in depth; the RECORD refusals are
what make A-writes/B-verifies mechanical. **No adapter change.**

## (a) The main-agent code-write guard

- **Hook**: `dsh.guardTool((exec: DshToolExec) => string | undefined)` — the same seam
  `installReadonlyGuard` uses (`packages/mpd-roles-plugin/src/team-guard.ts`). Installed ONCE from
  `packages/mpd-roles-plugin/src/index.ts`, beside `installReadonlyGuard`, by a new
  `installVerifyGuard(dsh, { law, warn })` in `packages/mpd-roles-plugin/src/verify-guard.ts`: same
  contract (returns `{ installed, reason? }`, NEVER throws, degrades with ONE warning).
- **Caller classification** (reuse, never re-derive): `sessionQualifies(agent, ["mpd"])` from
  `packages/mpd-roles-plugin/src/complexity-gate.ts` is the TOP-LEVEL test (session header present,
  `header.parentSession === undefined`, `header.agentPreset` in presets). A child/member session is
  never the captain.
- **Gated tool names**: `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite`,
  `mcp__ast_grep__scan`. The read-only roster list is NOT reused (it is keyed on member names — a
  different axis).
- **Path classification**, in this order, resolved with `dsh.workspaceRoot(exec)` exactly as
  `mpd-tools`' guard resolves it:
  1. ALWAYS WRITABLE (no loop, any caller): `<ws>/.mpd/**`, `<ws>/docs/**`, `<ws>/evidence/**`,
     `<ws>/agent-references/**`, and any basename matching `*.md` or `LICENSE*`.
  2. Otherwise CODE (gated): extension in `{.ts,.tsx,.mts,.cts,.js,.jsx,.mjs,.cjs,.json,.jsonc,
     .yml,.yaml,.toml,.sh,.bash,.zsh,.py,.rs,.go,.css,.html,.vue,.sql,.ps1,.cmd,.bat}`, basenames
     `Dockerfile`/`Makefile`, ANY unrecognised-or-absent extension, and ANY absolute path outside the
     workspace root.
  3. A non-string `file_path` on `write`, or an `edit` with no `file_path` → PASS (never guess).
- **Captain's allow rule**: a CODE write is ALLOWED iff there exists a loop `L` under
  `<ws>/.mpd/verify/loops/` with `L.status === "armed"`, `L.sessionId === <captain session id>`,
  `L.writer.kind === "self"`, `L.writer.id === <captain session id>`, `L.verifier.id !== L.writer.id`,
  the resolved path inside `L.scope` (empty scope = whole workspace), and `L.expiresAt > now`.
  Otherwise DENY, and the denial string names the three routes: delegate (a write-capable member /
  team task), open a self-writer loop (`mpd_verify_open`), or the counted escape (`mpd_verify_escape`).
- **"A delegation + verification loop is armed"** means exactly: an OPEN loop record whose VERIFIER
  seat is a different agent — so B is delegated even when A is the captain. `writer.kind: "self"` is
  the counted, visible path: `mpd_verify_open` REFUSES it without a non-empty `selfWriteReason` and
  counts it in the summary.
- **Counted escape**: `mpd_verify_escape { reason }` appends one JSONL row to
  `<ws>/.mpd/verify/escape.jsonl`, emits
  `rowLogLine("mpd-verify", "[mpd-verify] escape N/M reason=… path=…")`, and grants an in-memory,
  per-session allowance consumed by the NEXT allowed write (default 1 use).
- **Config (row config)**: `verify.escapeUses` (default 1), `verify.mode` (`hard` default |
  `advisory`), `verify.codeExtensions`, `verify.docAllow` (extra prefixes), `verify.loopTtlMs`
  (default 24h), `verify.gateTimeoutMs`.
  **CAPTAIN RULING (2026-10-07)**: these knobs are read RAW through the config service, exactly like
  `team.gate` and `boulder.dir` — they are NOT added to `mpd-config-plugin`'s settings schema, so the
  pinned `SETTINGS_KNOBS` count (26) does not move and no other lane's file is touched. Surfacing them
  in the settings UI is a deliberate non-goal of this wave.
- **Degradation**: if `dsh.capabilities().toolsGuard !== true`, report
  `verifyGate=absent reason=no-guard-seam` on the boot line and install the tools + validator anyway
  (the bookkeeping still works). One loud warning; the boot never aborts.
- **This wave's own exemption is FREE and must NOT be coded as a flag**: the row does not exist in the
  running process (T-21 module caching), so the wave's writers are unaffected until the captain
  restarts. **Ship the default ON.**
- **Residual**: `<ws>/.mpd/**` is always writable, so code-shaped content could be hidden there —
  bounded because `.mpd/` is gitignored runtime state and cannot ship.

## (b) The verification record

- **Paths**: `<ws>/.mpd/verify/{loops/<loopId>.json, records/<recordId>.json,
  evidence/<evidenceId>.{json,log}, seats.json, repairs/<repairId>.json, escape.jsonl}`. Keyed
  session-scoped by `sessionIdOf(agent)` MIRRORED from `packages/mpd-team-core-plugin`'s `where()`
  chain — `agent.session.id ?? agent.sessionId ?? agent.id`, else the literal `"workspace"` (the `??`
  order and the fallback are the contract: mirror, do not import).
- **Record fields (exact, FROZEN)**:
  `{version:1, recordId, loopId, taskId|null, workspace, writerId, verifierId, basis:{kind:"blind"|"unproven",
  frozenContract:{path,sha256}, docs:[{path,sha256}], probe:[{path,bytes,sha256,mtime}]},
  sources:[{path,sha256}], gateEvidence:[{evidenceId, cmd, exit, logPath, logSha256}],
  verdict:"PASS"|"FAIL", findings:[{id, severity:"blocker"|"major"|"minor", symptom, expected, docSource}],
  unlockedReads:[{path, count, afterRecordId}], createdAt}`
- **Validator refusals** in `mpd_verify_record` (each a distinct reason string; REFUSE = nothing
  written, nothing mutated):
  1. `verifierId === writerId` → `same-agent`
  2. `verdict:"PASS"` with empty `sources[]` → `no-doc-sources`; with empty `gateEvidence[]` →
     `no-gate-evidence`; citing an `evidenceId` not produced through `mpd_verify_evidence` for this
     loop → `forged-evidence`
  3. `basis.kind === "unproven"` with `verdict:"PASS"` → `bind-unproven` (blindness must be provable
     from the plugin's own observation log)
  4. `verdict:"FAIL"` with empty `findings[]` → `fail-without-findings`; any finding without
     `docSource` → `finding-without-basis`
  5. any record from a seat whose `unlockedReads` is already non-empty → `blind-spent` (that seat may
     only FAIL; a PASS must come from a FRESH verifier B′)
- **Two-way ratchet**: the verdict is written BEFORE any implementation read. Only a recorded FAIL sets
  `seat.unlockedReads = true`; the guard then ALLOWS code reads for that seat and counts them
  in-memory; the count lands in the next record's `unlockedReads[]`. A PASS never unlocks, and a PASS
  by an unlocked seat is refused (5).
- **FAIL bounce**: on a FAIL the tool creates a `kind:"repair"` task — through
  `mpdTeams.createTeamTask` with `sourceTaskId`/`sourceFindingIds` when the loop names a teamId
  (`packages/mpd-team-core-plugin/src/team-store.ts` already carries
  `kind|verdict|attempt|round|sourceTaskId|sourceFindingIds|coverageOf`), else a standalone
  `<ws>/.mpd/verify/repairs/<repairId>.json` echoed in the tool result. Never a silent fix.

## (c) The verifier's tool envelope

- **Seat identity**: `mpd_verify_seat { loopId, role:"verifier" }` binds the CALLING session id to the
  loop; authoritative and idempotent. Team members are additionally identifiable through
  `dsh.teamMembership(agent)` (`{teamId, role, name}`), and mpd-team-core records the seat at dispatch.
- **Envelope**, by tool:
  - DENIED outright: `bash` (and `powershell`/`pwsh` when present), `mcp__ast_grep__rewrite`,
    `mcp__ast_grep__scan`, `mcp__lsp__rename`, `mcp__codegraph__codegraph_explore` (returns verbatim
    source), `mcp__lsp__{diagnostics,goto_definition,find_references,symbols,prepare_rename,rename}`,
    and every `agent_teams_*` / `mpd_*` MUTATION tool (staging a team is not verification).
  - PATH-SCOPED while blind: `read`/`glob`/`grep` allowed ONLY under the loop's `basis.docs[]` +
    `<ws>/.mpd/plans/**` + `<ws>/docs/**` + `<ws>/agent-references/**` + `<ws>/.mpd/verify/**`; a
    bare/absent path argument is DENIED (it must name an allowed dir). After a FAIL unlock the same
    tools pass, counted.
  - WRITE: `write`/`edit` allowed ONLY under `<ws>/.mpd/verify/**`; everything else DENIED. The record
    itself is written by the tool, so a read-only-recipe verifier needs no raw write.
- **Whitelisted gate runner**: `mpd_verify_evidence { kind:"gate", gate:<id> }` runs a FIXED table
  (id → exact argv, cwd = workspace root): `gates`→`bun run verify:gates`, `tests`→`bun test packages`,
  `typecheck`→`bun run typecheck`, `docs`→`bun run verify:docs`, `manifest`→`bun run verify:manifest`,
  `comments`→`bun run verify:comments`, `rows`→`bun run verify:rows`, `dist`→
  `node scripts/verify-dist-fresh.ts`, `pack`→`node scripts/pack-mpd.ts`. No free-form command is
  accepted. It writes `<ws>/.mpd/verify/evidence/<evidenceId>.{json,log}` and returns
  `{evidenceId, exit, logPath, logSha256, tail:<last 4096 chars>}`. No match → REFUSE `unknown-gate`.
- **Content-free artifact probe**: `mpd_verify_evidence { kind:"probe", paths:[…] }` → per path
  `{path, exists, kind, bytes, sha256, mtime}` and NEVER content. Paths inside the workspace; ≤64/call.
- **Residual bound (state it verbatim in the record and the PR)**: the gate runner's `tail` may print
  source frames — controlled black-box evidence, not implementation reading. The envelope is defence
  in depth; blindness is PROVEN by the plugin's own observation log (`guardTool` sees every call before
  dispatch, so `blindStart` is computed from observed code-path reads since session creation).

## (d) Binding every mode

- **Process-level**: the guard + the observation cover every caller in the process, so the law holds
  identically in solo, one-shot `mpd_role_spawn`, official team, ULW, ralph, workflow and headless.
- **Arming per mode**: solo → the captain calls `mpd_verify_open`, else DENIED. One-shot → the plugin's
  `dsh.onPostToolExecute` observer (the documented observe-only sibling) sees the captain's
  `mpd_role_spawn`/`mpd_workmate_spawn`/`subagent`/`spawn_teammate`/`workflow`/`ralph`/`mpd_ultrawork`/
  `mpd_ulw` calls and auto-opens a `writer.kind:"delegate"` loop — which never permits captain writes,
  so there is no loophole. Team → `mpd-team-core`'s dispatch records the writer seat (`work` task
  owner) and the verifier seat (`review` task owner); a FAIL flows through the same validator.
- **Honest bounds**: (1) a harness without the `tools.guard` seam → boot line `verifyGate=absent`, the
  law is bookkeeping only; (2) a plugin that spawns delegates through its own private path is not
  auto-armed — the captain's writes stay denied; (3) an unbound member is not under the envelope — its
  record is refused if the observation log shows a pre-verdict code read (`bind-unproven`); (4)
  pre-verdict code reads by an unbound child are visible in the ledger but not blocked; (5) the captain
  may still write code through the counted escape or a self-writer loop — both counted, logged,
  reported.

## (e) Files and the QA case

- **IN SCOPE (Lane D)**: NEW `packages/mpd-verify-plugin/{package.json, README.md, README.zh-CN.md,
  src/{index,law,ledger,tools,gates,observe}.ts, test/*.test.ts}` (the bilingual README PAIR is
  mandatory — `verify:docs` discovers `packages/*/README.md`); NEW
  `packages/mpd-roles-plugin/src/verify-guard.ts`; `packages/mpd-roles-plugin/src/index.ts` (install +
  extend the `[mpd-roles] team plane: …` boot line with `verifyGate=…`);
  `packages/mpd-team-core-plugin/src/{dispatch.ts,team-store.ts}` (seats + repair links; ALSO the
  terminal verbs `agent_teams_task {action:"complete"|"fail"}` — captain amendment 2026-10-07);
  `presets/mpd.patch.yml` (the `persona` row states the law); `AGENTS.md` (§1 gate paragraph, §3
  package list, §6/§13 law + tool surface). Integration task (T-88): `packages/*/dist/**`,
  `dist/mpd-package/**`.
- **HOPS (granted by the captain)**: `cordis.patch.yml` — one row `mpd-verify` after `mpd-roles`
  (granted; run `node scripts/verify-no-host-override.ts` after the edit);
  `skills/dsh-qa/scripts/verify-law.ts` + the `skills/dsh-qa/SKILL.md` case row — written by Lane C
  from Lane D's text (single skills writer).
- **Boot line for the mount lane**: `[mpd-verify] verifyGate=installed loops=<n> installedAt=<iso>`
  (mirrors `[mpd-roles] team plane: readOnlyGuard=installed …`).
- **QA case `verify-law.ts`** — offline `--self-test` arms: the classifier table (code/docs/
  `.mpd/verify`/unknown-ext/outside-workspace); the guard decision table (captain+code+no loop → DENY;
  +armed self-loop → ALLOW; +escape → exactly ONE allow then DENY; child session → PASS; non-mpd preset
  → PASS; verifier+bash → DENY; verifier+`read` of `packages/**` while blind → DENY; after FAIL →
  ALLOW and count); the validator arms for EVERY refusal in (b) plus `forged-evidence`; the escape
  counter/log row; `blindStart` derivation; the mirrored session-key chain. ONE live arm under §7's
  three-way isolation (isolated `DSH_HOME` + sandbox `HOME` + sandbox workspace,
  `assertSessionsSandboxed`): the row MOUNTS (boot line — never `--dump-config`), the captain's `write`
  on a `.ts` path is DENIED, `mpd_verify_escape` then allows exactly one write and logs a row, and a
  verifier seat's `bash` is DENIED while `mpd_verify_evidence {gate:"tests"}` succeeds. Assertions come
  from `tool/call` + non-error `tool/result` records in the harness session log, never from model prose.
- **Post-integration gates**: `bun test packages`, `bun run typecheck`, `bun run test:qa`,
  `bun run verify:docs` (the new README pair), `bun run verify:manifest`, `bun run verify:comments`,
  `bun run verify:rows`, `preset-conformance` + a MOUNT boot (tool-schema change), then the wave's
  Docker lane LAST with `--require-docker`.

## Captain's cross-lane rulings recorded with this spec (2026-10-07)

1. **Record format FROZEN** as (b) above: Lane E (Reviewer) writes its per-lane records BY HAND in
   exactly that shape, so they stay validatable when the `mpd_verify_record` validator lands.
2. **Committed evidence required**: `.mpd/` is gitignored, so every Lane E record pair must also land
   at `evidence/verify-law/<lane-slug>/<UTC>/{result.json,output.log}` with its `recordId` and the
   artifact hashes inside — acceptance criterion 6 needs a committable artifact.
3. **`verify.*` knobs are read raw** — no settings-schema change, no `SETTINGS_KNOBS` churn.
4. **The signal-letter restatement A–D → A–E is a PAIR**: Lane C owns `skills/dsh-qa/scripts/
   ulw-command.ts` AND (granted) `packages/mpd-ulw-plugin/src/index.ts` +
   `packages/mpd-ulw-plugin/test/commands.test.ts`; both halves move together.
5. **Lane C is granted `packages/mpd-roles-plugin/dist/**`** for the live boot arm only, with the
   canonical root-relative build command quoted in its evidence.

## Captain's amendments, second set (2026-10-07) — the chicken-and-egg rulings

Raised as F9/F10/F11 by the independent verifier. The wave BUILDS the law, so at the moment it
verifies its own lanes the law is not in the process (T-21 module caching): `guardTool` observes
nothing, `mpd_verify_open` does not exist, and `mpd_verify_evidence` produces no ids. The three
rulings below keep this wave's records honest AND validatable, without weakening the law.

**A. `basis.kind` gains a THIRD value: `"pre-plugin"`.** Do NOT overload `"blind"` — a record that
claims observed blindness it cannot observe is precisely the dishonesty this wave exists to remove. A
`pre-plugin` record is admissible only when ALL FOUR hold, and each is a validator rule added to (b):

1. `unlockedReads` is EMPTY → else `pre-plugin-unlocked`.
2. `basis.attestation === "no-guard-in-process"` AND `basis.frozenContract.sha256` matches the wave's
   plan file on disk → else `pre-plugin-unattested`.
3. `createdAt` PRECEDES the law's first boot marker — `<ws>/.mpd/verify/boot.json`'s `installedAt`,
   written by the row when the guard installs successfully. If the marker exists and PREDATES the
   record → `post-install-claim`, REFUSED. The exemption therefore closes itself the moment the law is
   live: mechanically, not by good intentions.
4. Under `pre-plugin`, a `gateEvidence[]` entry may carry NO `evidenceId`; the on-disk
   `{cmd, exit, logPath, logSha256}` pair is then its provenance. An `evidenceId` that IS present must
   still have been produced through `mpd_verify_evidence` → otherwise `forged-evidence` stands exactly
   as frozen.

**B. `loopId` convention for wave-authored records: `waveloop-<lane-slug>`** (e.g. `waveloop-lane-a`).
The validator must NOT demand a matching loop file under `pre-plugin`; for every OTHER basis kind a
missing loop file is the new refusal `unknown-loop`.

**C. The fixed gate table gains `vendor` → `node scripts/verify-vendor.ts`** (AC1's acceptance command
had no id, so a conforming verifier seat could not produce AC1's evidence at all).

**D. The Docker lane's evidence comes from the INTEGRATION task and is declared in the PR body.** A
verifier seat is NOT expected to run it — it cannot, by design (the envelope denies `bash`). This is a
DECLARED BOUND, stated in the record and the PR, never a hole.

**E. The frozen format gains ONE OPTIONAL field: `notes?: string[]`.** The §(c) residual bound is
carried BOTH there and in the companion `output.log` (the verifier's current approach stands; the field
simply gives the declaration a slot instead of relying on prose alone).

## Captain's amendments, third set (2026-10-07) — the boot marker's second-order hazard

**F. The `pre-plugin` exemption vs §7's mis-isolation trap.** Amendment A.3 closes the exemption at the
law's first boot marker, and Lane D's LIVE MOUNT ARM is exactly what writes `.mpd/verify/boot.json`. If
that boot runs in the REAL workspace instead of a `sandboxWorkspace()`, the marker lands at
`<ws>/.mpd/verify/boot.json` and mechanically refuses every later `pre-plugin` record as
`post-install-claim` — silently invalidating AC6 AFTER the fact. This is the specific failure §7 warns
about, so it is bounded by four rules:

1. The live mount arm MUST run with a sandbox workspace, and its evidence MUST show the sandbox cwd
   (never the repository root).
2. The INTEGRATION task MUST assert that `<ws>/.mpd/verify/boot.json` does NOT exist in the real
   workspace before the captain's post-wave restart. If it does exist, STOP and report — never delete
   it silently.
3. The verifier MUST re-probe the marker inside EVERY record and FAIL with `post-install-claim`
   evidence rather than write an inadmissible record.
4. The PR body declares this bound, so a reader sees it rather than rediscovering it.

**G. The scope of `forged-evidence`.** The validator's subject is the LANE records
(`evidence/verify-law/lane-*/`). The published pre-flight pair is a PRE-PLUGIN artifact: its
`evidenceId`s are opaque labels naming on-disk log files whose sha256 the record itself carries, so it
is admissible AS PUBLISHED, is out of the validator's subject set, and is NEVER rewritten (re-issuing it
would destroy the hash discipline this wave is built on). From T12 onward, lane records omit
`evidenceId` entirely, per amendment A.4.
