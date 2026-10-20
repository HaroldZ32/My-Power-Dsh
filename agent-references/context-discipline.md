# context-discipline — how to work cheaply in this repository

Agent-facing, English-only, **on demand**: this file is deliberately NOT named
`AGENT.md`/`AGENTS.md`/`CLAUDE.md`, so no harness injects it. Open it when you are starting a wave,
about to edit `AGENTS.md`, or watching a session's context fill up.

It records the procedure behind the 2026-10-20 context diet (`.mpd/plans/context-diet-and-handoff.md`),
and it is the on-demand home for the output-hygiene and handoff rules. Nothing here is a new binding
rule about the CODE — the binding rules live in `AGENTS.md`; this file is about how a session SPENDS
its context and leaves a usable trace.

## 1. The fixed cost, measured

In an `mpd` preset session, two things are injected before the agent does anything:

1. **`AGENTS.md`** — through `presets/mpd.patch.yml`'s `agent-instructions` row
   (`maxBytes: 65536`, candidates `AGENT.md` → `AGENTS.md` → `CLAUDE.md`). This is the only route by
   which the manual reaches the model.
2. **The `mpd` preset persona** — the `prefix: >-` block of the `persona` row in the same file.

Both are paid on EVERY `mpd` preset session, so a byte added there is a byte paid forever. Two measured facts make
this sharper:

- **A longer manual is silently truncated.** Nothing exits non-zero when `AGENTS.md` passes 65536 B;
  the tail simply stops binding, and a reader cannot tell. Keep a margin above 2 KB.
- **Editing `AGENTS.md` mid-session re-injects the whole manual** (measured: a five-line §5 edit cost a
  full re-injection of the file, ~16 k tokens at 63 KB). Batch manual edits into their own short
  session; never sprinkle them through a long one.

Budget arithmetic, after the 2026-10-20 diet: manual 63,416 → 56,900 B, persona text
18,437 → 11,634 B raw.

## 2. Changing the manual or the persona (MOVE-FIRST)

1. **Measure first.** Get the byte count you are starting from (`wc -c AGENTS.md`; for the persona, the
   `prefix: >-` block only). Record it — an unmeasured edit cannot be reported honestly.
2. **MOVE-FIRST, never plain DELETE.** Before adding, move a LONG FORM of comparable size into
   `agent-references/` and leave a SHORT definition **plus an exact pointer**. Never drop a term that
   another file cites: `§1`–`§13` numbering is a prose promise, and code, scripts and docs cite it.
3. **Duplicate there, delete here.** A long form that already exists in `agent-references/**` may be
   cut back to its definition. A long form that exists NOWHERE must be MOVED first (write it into the
   right reference file in the same PR), or it is lost.
4. **Never delete a policy, a command or a scope qualifier.** The gates table keeps every gate, its
   exact command and its "when" — a reader in another harness must be able to run the gates from the
   manual alone. Measured detail, history and rationale are what move.
5. **Re-measure and report** the before/after numbers in the PR.
6. **Gates that matter:** `node scripts/verify-manual-paths.ts` (every root-anchored code-span path must
   resolve; zero audited subjects is a FAIL), `bun run verify:docs`, and — when the persona changed —
   `node skills/dsh-qa/scripts/preset-conformance.ts --self-test`, the live conformance, `bun run
   test:qa` and `bun test packages`.

**The persona has literal text pins.** These QA cases read `presets/mpd.patch.yml` and assert exact
strings; a "cleanup" that drops one reddens a gate:

| Case | Requires |
|---|---|
| `skills/dsh-qa/scripts/captain-scope.ts` | `READ DISCIPLINE`, `REFUSED`, `mpd_role_spawn`; and NOT `no reconnaissance guard, no delegation gate` |
| `skills/dsh-qa/scripts/session-start-team.ts` | `[AgentTeams] Session-start team rule`, `team.gate`, `spawn_teammate`, a `default…mechanical` pair within 60 raw chars; and NOT `MUST start inside a team` / `MUST begin inside a team` |
| `skills/dsh-qa/scripts/workmate-library.ts` | `WORKMATE LIBRARY`, `mpd_workmate_init`, `mpd_workmate_match`, `forcing a weak match` |
| `packages/mpd-roles-plugin/test/team-plane.test.ts` | `team.gate`, the startup marker, `agent_teams_plan`; and NOT `routed to team mode`, `the gate only ADVISES`, `it stages NOTHING` |
| `packages/mpd-bundle-plugin/test/preset-prompt-variables.test.ts` | `prefix` > 1000 chars, `You are MPD`, `{{model}}`, no `{{cwd}}`, template vars ⊆ {provider, model} |
| `skills/dsh-qa/scripts/preset-conformance.ts` | the literal `prefix: >-` block scalar |

## 3. Output hygiene

Anything an agent READS lands in its context and stays there. Prefer a number to a body.

- **Subagent reports**: cap at ~25 lines — `file:line`, the few decisive excerpts, the conclusion. No
  code dumps. Long tables go to `.mpd/reports/<slug>.md` and the report cites the path. The spawn
  surface returns BOTH a chat message and a structured result, so cap the structured `details` too
  (~1,500 chars): a report that is short in one channel and long in the other saves nothing.
- **Gates**: prefer `mpd_verify_evidence {kind:"gate"}` — a 4 KB tail plus an evidence id, with the full
  log on disk — over running the command in the captain and reading its output. Long commands go
  through `run_in_background` with a log file; then read `summary.tsv` or the driver's one-line verdict.
- **`gh api`**: always `--jq` a compact projection. A large body goes to a file and is grepped, never
  pasted into the captain.
- **Authored docs** (PR body, release report, screenshot pass): delegate from a compact spec; the
  captain reviews the file path and the key claims, not the full text.
- **Reconnaissance is delegated** on the `mpd` preset's TOP-LEVEL session only (AGENTS.md §5 rule 2):
  there the captain's `read`/`grep`/`glob` are refused on source paths, so it never carries a tree it
  needed once. Every other preset keeps its own reconnaissance behaviour — the restriction is scoped by
  `captain.investigation` and `delegation.gate`, not a repository-wide ban.

## 4. Session hygiene

- **One wave per session.** When the wave merges, end the session. A team that accumulates across waves
  is what inflates context and erases the wave boundary (measured: 86 tasks across four waves).
- **Load a skill only when the task needs it.** Skill texts are large; a docs/PR session does not need
  the QA skill.
- **Do not edit `AGENTS.md` outside a session that exists to edit it** (§1's re-injection cost).
- **The handoff is files, not conversation history**: the memory entry, `.mpd/plans/**` and the git
  state. Write them before the context runs out, not after.

## 5. Evidence and measurement

- **Measure, then edit, then re-measure.** Record both numbers in the PR; a claim of "smaller" without
  two figures is not evidence.
- Evidence lives at `evidence/<domain>/<slug>/<timestamp>/{result.json, output.log}` (AGENTS.md §7).
- **An artifact path is the anchor** (T-90): a mailbox id or a line number rots; copy the quoted bytes
  into your own artifact.
- **A gate's exit code is not always its meaning** — e.g. `verify-pack-closure` certifies completeness
  and byte identity, while freshness is read from `expected-after-pack` (AGENTS.md §4's T-91 bound).

## 6. Handoff protocol (fresh-session opener)

When you stop mid-wave, leave a handoff that a cold agent can execute:

1. A `.mpd/plans/<slug>.md` with the approved scope, the exact gates to run, and the acceptance
   criteria — plus a paste-ready opener sentence.
2. One memory entry (`mpd_memory_write`, kind `note`) naming the decision, the state and the file path.
3. A clean git state: the branch, the last commit, and what is still uncommitted.

The fresh session then reads `AGENTS.md`, the plan file and the memory entry — nothing else — and
starts measuring.

## Provenance

Derived from the 2026-10-20 context diet: the measured cost of the v0.15.0 audit session (manual
injected twice, large subagent reports, raw gate output). It supersedes the handoff file's section B,
which was itself the working note this file formalizes.
