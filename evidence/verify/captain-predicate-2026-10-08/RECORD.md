# Verification record — the captain test keys on the delegation tree, not on a preset name

Agent-facing, English-only (AGENTS.md Language policy). This directory is the COMMITTED anchor for the
wave that closes `T-92`; the ledger under `.mpd/verify/**` is gitignored, so the artifacts it produced
are copied here verbatim and are the primary anchor (T-90: an artifact path, never a mailbox id).

## What was fixed

`packages/mpd-roles-plugin/src/complexity-gate.ts`'s `sessionQualifies()` decided "is this the
workspace's captain" as `header exists AND header.parentSession === undefined AND
presets.includes(header.agentPreset)` with `presets: ["mpd"]`. Every TOP-LEVEL session on this machine
records `agentPreset: "cordis"`, so the captain branch of AGENTS.md §5's ONE-git-writer rule was
UNREACHABLE: the user's own session was refused `git branch` / `git add` / `git commit` with a sentence
claiming a fact the code never tested. The manual's definition had always been the session's position in
the delegation tree, and the narrower preset test was an undocumented implementation of it.

The fix is the contract's F1–F6: one exported, PRESET-FREE predicate (`sessionIsTopLevel`, with
`sessionRank` reporting the class) that BOTH §5's git rule and the captain's write rule read; the guard's
`presets: ["mpd"]` knob deleted; `sessionQualifies` kept with its behaviour and a doc that says plainly
it is the SESSION-START GATE's scope and NOT the captain test; and both denial sentences rewritten to
state the class that was actually decided (member/child, or headerless fail-closed) and to name the one
legitimate route — the user's own shell.

## The loop

| Fact | Value |
|---|---|
| Contract (frozen, the verifier's basis) | `.mpd/plans/captain-test-fix.md` — a copy is `CONTRACT.md` beside this file |
| Verification loop | `loop-20261008T055942-e51e88` (writer `delegate`, scope: the two packages' `src`/`test`/`dist`) — `loop.json` |
| Writer | a Senior Engineer one-shot (a DELEGATED writer; the captain wrote no code) |
| Verifier | a DIFFERENT agent, bound as its seat BEFORE any read — a Reviewer one-shot |
| Verdict | **PASS**, `rec-20261008T061038-a66ee9`, basis `blind` — `record.json` |
| Gate evidence cited | `ev-20261008T060851-71fa11` (tests), `ev-20261008T060922-942fd5` (typecheck), `ev-20261008T060924-aa21cb` (comments), `ev-20261008T060930-b58511` (dist), `ev-20261008T061017-99405e` (rows), `ev-20261008T061018-7c7540` (gates) — all six under `gates/` |
| Documents cited | `CONTRACT.md`; `AGENTS.md` §5; `agent-references/troubleshooting.md` (`T-92`) |

## Clause-by-clause outcome (as the verifier recorded it)

- **F1 PASS**, **F2 PASS**, **F3 PASS**, **F4 PASS**, **F5 PASS** — each witnessed by passing falsifier
  arms inside the black-box gate logs, quoted in `record.json`.
- **F6 PARTIAL, then closed.** The verifier confirmed the MANUAL half directly and declared the
  code-comment half UNDECIDABLE inside its envelope (reading `packages/**` is exactly what blindness
  forbids; the green comments gate proves presence and precision, not content) — it recorded that as a
  bound instead of assuming it. The captain closed it by reading the comments AFTER the verdict: both
  `complexity-gate.ts` and `verify-guard.ts` state the manual's classification ("the workspace's
  TOP-LEVEL session — a header, no parent session, delegation depth 0 — and never a preset name
  (T-92)"). **That closure is INTEGRATION by the captain, not independent verification, and is declared
  as such.**

## Gates run on the landing revision

Full log: `final-sweep.log` (it sweeps the WHOLE branch, not only this wave).

| Gate | Observed |
|---|---|
| `bun run typecheck` | exit 0 |
| `bun test packages` | 1643 pass / 3 skip / **2 fail** — both reds pre-existing and environment-bound (see bounds) |
| `bun test packages/mpd-tui-plugin packages/mpd-tui-adapter-plugin` | 469 pass / 0 fail |
| `bun run verify:docs` | `pairs=47 failed=0 violations=0 exempt=22 derived=3 links=424 dead=0 — PASS` |
| `bun run verify:rows` / `verify:comments` / `verify:manifest` | exit 0; manifest `VERDICT: PASS` |
| `node scripts/verify-no-host-override.ts` | exit 0 (0 of 0 collide with 205 host-declared row ids) |
| `node scripts/verify-manual-paths.ts` | **PASS** (was FAIL before this branch — see bounds) |
| `node scripts/verify-vendor.ts` | PASS — 6 shipped assets fingerprinted |
| `node scripts/verify-dist-fresh.ts` | ok 30/30 targets fresh (pinned bun 1.4.0) |
| `node scripts/verify-pack-closure.ts` | 0 drift; 553 compared, 551 identical, 2 expected-after-pack |
| `node skills/dsh-qa/scripts/verify-law.ts --self-test` | exit 0 (registered copy byte-identical) |
| `bun run verify:gates` | PASS — 8/8 member gates green |

## Declared bounds

1. **The fix cannot take effect in a RUNNING host.** T-21: ESM caches a module at session start, so the
   guard the current process installed keeps the old classification until `dsh` restarts. No live
   end-to-end witness ("a top-level `cordis` session really runs `git commit`") exists in this record —
   the arms are unit-level, and the restart bound is the contract's own.
2. **The two suite reds are NOT this wave's, and neither is provable as pre-existing from inside a
   verifier envelope** (no shell/blame there). Outside it, both causes are readable in the tree:
   `packages/mpd-mcp-shared/log-sink.test.ts` asserts the inherited stderr is the LOWEST free descriptor
   and the sandbox reports `rebind=not-lowest` (an fd/launch-environment condition, no guard decision);
   `packages/mpd-roles-plugin/test/team-plane.test.ts` reads the repository's real `.mpd/boulder.json`,
   which has NEVER been tracked (`git log -- .mpd/boulder.json` is empty, `.mpd/` is gitignored line 21
   of `.gitignore`), so the arm ENOENTs on any fresh clone. The contract's binding clause set is
   narrower than the whole suite and neither red is reachable from the guard predicate.
3. **Where the red gate was repaired.** `node scripts/verify-manual-paths.ts` was RED at `HEAD`
   (independently of this branch): `AGENTS.md` spelled the boulder ledger as a ROOT-relative literal
   (`.mpd/boulder.json`), which the gate audits as a repo path — and that path is gitignored runtime
   state, absent in any fresh clone. The repair spells it `<workspace>/.mpd/boulder.json`, matching the
   manual's own convention for workspace-scoped paths, and the census moves it out of the audited
   class. **Bound stated rather than hidden: the gate cannot distinguish a gitignored state file from a
   shipped asset, so this class will recur for any future runtime path spelled root-relative.**
4. `packages/mpd-roles-plugin/test/team-plane.test.ts`'s dependency on machine-local state (bound 2) is
   NOT repaired here; it is a separate housekeeping item, recorded rather than silently skipped.
