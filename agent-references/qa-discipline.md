# QA discipline (the full former §7 body)

Agent-facing reference (English-only by the bundle's language policy; `bun run verify:docs` does not
discover this tree). **On demand — never auto-injected**: this file is deliberately not named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so the workspace instruction loader never reads it. `§N` citations
below refer to `AGENTS.md` sections, whose numbering is stable.

Provenance: moved from `AGENTS.md` §7 ("QA Discipline (mirrors upstream, adapted)") on 2026-10-06 by the instruction-budget split (the
manual must stay under the harness's 65,536-byte workspace-instruction budget, and it was already
over at the previous HEAD). The block below is reproduced VERBATIM — its byte count and sha256 are
recorded in `evidence/gates/agents-budget/20261006T085805Z/result.json`. `AGENTS.md` §7 carries the BINDING rules and points
here for the full body; where the two differ, the manual wins.

## The former §7 body (verbatim)

## 7. QA Discipline (mirrors upstream, adapted)

- Skill: `skills/dsh-qa` (SKILL.md + case scripts + references). Every script ships `--self-test`.
- **Isolation is THREE things, not one.** (a) `DSH_HOME=<mktemp>`: credentials copied ONCE into the
  sandbox, the sandbox path asserted, the real `~/.dsh` never read or written; env prereqs (sg/codegraph)
  copied only when present. (b) `HOME=<sandbox>` — skill roots leak through HOME (the provider's user
  roots are `<DSH_HOME>/skills` and `<agentsHome>/skills`, `agentsHome = $DSH_AGENTS_HOME ?? ~/.agents`;
  measured 2026-09-14: `SKILLS=24 BUNDLED=18` → FAIL). (c) A SANDBOXED WORKSPACE: `DSH_HOME`/`HOME` do
  NOT isolate workspace state, because every workspace root resolves from the session workspace
  (`dsh.workspaceRoot(exec)`; `agent.session.header.cwd ?? process.cwd()` in the adopted plugin), so
  every dsh spawn and `session/create` payload carries an explicit sandbox cwd
  (`sandboxWorkspace(sandbox)` from `skills/dsh-qa/scripts/lib/workspace-isolation.ts`) and each live
  case asserts no `<DSH_HOME>/sessions/<projectKey(realCwd)>` key exists (`assertSessionsSandboxed`).
  Without it an "isolated" boot writes real `<repo>/.mpd/team/mpd-default-*` records (exactly what the
  `mpd_workmate_rename/delete` in-use gate scans) plus `.mpd/{memory,boulder.json,hashline-files.json,
  verif,plans,ulw}` and `.codegraph`.
- Live-LLM cases must ALSO copy `settings.yaml` when present: homes whose keys come from gateway
  providers (`llm-pi-ai` providers — opencode-go/scnet) configure the chain there, and without it
  headless falls back to the base `deepseek-official` route → `MISSING_CREDENTIAL`.
- **Provability: assert a REAL tool result, never just "it ran".** For composition-only questions the
  subject is `--dump-config` rows — but that proves COMPOSITION ONLY and never a plugin load (§4): it
  does not execute plugin code, so it cannot witness an apply/schema abort. Anything about plugin
  BEHAVIOUR (a tool registered, a route answering, a schema accepted) needs a boot that MOUNTS the rows
  in an isolated `DSH_HOME` with registration instrumentation, or a real tool call.
- **A live case proves a tool call from the HARNESS's session log, never from the model's prose**
  (`skills/dsh-qa/scripts/lib/session-evidence.ts`: `readSessionEvents` / `findToolCall` /
  `recordedToolNames`). The store is `<DSH_HOME>/sessions/<projectKey(cwd)>/<sessionId>/` and — the trap
  — a CONCATENATED-ZSTD-FRAME container: one `zstdDecompressSync` returns the header frame ONLY, so a
  naive reader sees zero events and reports "no tool call" (a real artifact: 10 frames, 1 vs 25
  records). Decode frame by frame with the harness's own structure-only scan. `tool/call.data.name` + a
  non-error `tool/result` is tool evidence; `request/header.data.header.tools[]` is tool-list evidence.
  Asserting a tool NAME against the model's ANSWER is wrong in BOTH directions — both measured
  (`codegraph-smoke`, `evidence/dsh-qa/codegraph/`).
- Evidence path: `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}`.
- **Durable anchors (T-90): an ARTIFACT PATH is the anchor — a mailbox id is not a link.** A citation
  must survive the policy that owns its target: a line pointer rots by an EDIT (T-55), and a mailbox id
  rots by a MAILBOX CLEARING — archive-first, so nothing is hard-deleted, but no member-facing surface
  serves a cleared record any more, so the citation resolves to nothing. The artifact is the primary
  anchor, the relay is secondary, and the id is provenance, not an anchor — cite it as "read while
  present"; a seat that must cite an EXCHANGE copies the quoted bytes into its own artifact the moment
  it identifies them. This is a CLASS rule, not a pattern hunt: an `attemptId`/session id is DATA, and a
  shape scan is only a discovery heuristic with a measured calibration bound (31 of 31 hits were false
  positives on one scan).
- **Derived surfaces are declared at PLAN time (T-88): `packages/*/dist/**`, `dist/mpd-package/**`,
  `VENDOR_LOCK.json` and `.mpd/plans/**` belong to the INTEGRATION task's `inScope` at CREATION.**
  Measured: a lane edited a package's `src/**`, its own `verify-dist-fresh` reddened on a built
  `packages/<pkg>/dist/index.js` that belonged to NO lane's scope, and the platform refused the
  completion (`1 changed path(s) not covered by inScope`). Two halves: pre-declare the derived path on
  the task whose edits redden it — the hop rule applied BEFORE the refusal — and treat the mid-wave
  escape as a HOP requested with the exact amendment text in ONE message and no work attached; a LANE
  must not declare a `dist/**` pattern for itself (the platform's `inScope overlaps` validator refused
  exactly that, measured), because the declaration belongs at plan time.
- **Preset/row conformance against the INSTALLED harness** (`preset-conformance`, required for any
  preset/patch/overlay change): a row config is validated with the installed plugin's own schemastery
  `Config`, because that is what the loader runs. Two failure modes, only one loud: a MISSING REQUIRED
  key fails the row and `dsh-agent-presets` then refuses the whole preset (`agent-preset/invalid …
  row(s) did not activate`), while an UNKNOWN key is silently KEPT — the row applies and quietly loses
  that setting. It also pins the `mpd` preset's row set against the installed `standard` preset, because
  the harness moves rows between the host and preset planes between releases, so a missing row is a
  capability every mpd session loses. `--dump-config`, `agentPresets.list`/`resolve` and every
  `--self-test` that never creates a session are blind to this class — only a real mount is not.
- New case checklist: add row to SKILL.md case table; script + `--self-test`; real run; evidence dir.
- **Verify on SETTLED hashes, and quote a hash WITH its measurement moment.** An edit or revert still
  landing is measurable — a verification pass once measured a half-reverted tree, reporting a failure
  that no longer existed minutes later. Pin the revision by hash, re-check it after a short settle
  window (wave 2 used 50 s), then run the contract, anchoring every verdict to the hashes you measured;
  and state the UTC instant each hash was read (second precision), sandwiching a verifier's read —
  hash → work → re-hash, with start == end after the settle window — so "settled" is distinguishable
  from "another lane edited the file while I sampled".
- Shell caveat: long-lived MCP children hold inherited fds — run dsh with stdio to FILES (`spawnSync`
  with `stdio: ['ignore', fd, fd]`) or background + log-file redirection, never pipes.

