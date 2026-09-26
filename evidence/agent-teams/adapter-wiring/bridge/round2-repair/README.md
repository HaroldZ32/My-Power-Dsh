# t23 — repair round 2 (bridge lane's share): evidence summary

Seat: Senior Engineer · attempt 1 · attempt_id 5049803a-d557-4e1a-9b85-db71fc5bae44
Read moments: item-1 gates 2026-09-19T16:00:47Z · verification sweep 2026-09-19T16:03:52Z

## What this lane actually changed (all inScope)

| Path | Change | sha256 (read 16:03Z) |
|---|---|---|
| `AGENTS.md` | items 4 + 5: both closure sentences qualified with the counted childCtx residual; the flags sentence reworded; the residual paragraph now names the two raw `childCtx.on` subscriptions | `d813c47c31e7497b277f2bddd307229871669801ebd62abbf124e93aa5579f54` |
| `packages/mpd-agent-teams-plugin/test/adapter-bypass-inventory.test.mjs` | item 3: four receiver-hiding rules (alias / destructure / bracket / `Reflect.get`), the childCtx skip narrowed to the five identity-matched lines, and a falsifiability arm | `7898fd03526a36c0ece5f76f2a573a39c8b93339c8bb703251feaab1fa1d9f84` |
| `evidence/agent-teams/adapter-wiring/bridge/round2-repair/item1-gates.log` | item 1 measurement (vendor + aggregate gates on the re-pinned tree) | — |
| `evidence/agent-teams/adapter-wiring/bridge/round2-repair/verification-sweep.log` | the four contract verify commands + `verify:docs` + `verify:gates` | — |

Nothing else was touched: no `skills/**` edit by this lane (t22 owns that), and no edit to the t8
verification result (item 6 was already satisfied there — quoted below).

## Item 1 — the re-pin + both gates (measured, green)

`VENDOR_LOCK.json` is modified in the working tree, so the wave's single sanctioned re-pin HAS landed
with the skills changes; the commit itself is the captain's step. On that tree (16:00:47Z):

- `node scripts/verify-vendor.mjs` → **exit 0**, `[verify-vendor] PASS` (all assets OK, incl. the
  `skills` treeSha that the uncommitted skills edit had reddened before the re-pin);
- `bun run verify:gates` → **exit 0**, `PASS - 5/5 member gate(s) green`;
- `bun run test:qa` → **exit 0**, `[test:qa] all self-tests passed`.

**OUT OF SCOPE, REPORTED (contract-owner action):** the second half of item 1 — "Reconcile the
contract's 'skills/** MUST NOT be touched' line (D7/§8) with the created t22" — targets
`evidence/agent-teams/adapter-wiring/requirements-contract.md`, which is NOT in this task's inScope.
Measured state: line 334 still reads "`skills/**` MUST NOT be touched in this wave (a skills edit
forces a corpus re-pin, §9)." with no t22 exception. Proposed amendment (owner to land): add
"— EXCEPT t22's single `skills/dsh-qa/scripts/lib/credentials.mjs` + `agent-teams-dispatch.mjs` V-1
repair, whose ONE re-pin landed in `VENDOR_LOCK.json` (`verify-vendor` PASS); no other skills edit is
permitted this wave." This lane did not edit that file (ownership rule).

## Item 2 — the fresh verification attempt (dispatch exists; anchoring is that lane's)

Measured in the task record (16:01Z): **t22 is [completed]** (Junior Engineer); the re-pin landed;
**t8 is [in_progress]** (Deep Worker) — the fresh verification attempt on the new hashes — and
**t24 review-round-2 is pending** (Reviewer). Dispatching is the captain's surface and it exists;
re-running AC12/AC13/AC16, the boot arms and anchoring the wave's evidence to the new hashes is t8's
in-flight deliverable at this moment (its stored result still carries the PRE-re-pin FAILED verdict).

## Item 3 — the scanner (falsifiable, not decorative)

Added rules: `facade.alias` (`const agents = ctx.agents`), `facade.destructure`
(`const { get } = ctx.agents`), `facade.bracket` (`ctx['agents']`, `ctx?.['tools']`) and
`facade.reflect` (`Reflect.get(ctx, 'subagents')`) — each with `facadeExempt: false`, so a
receiver-hiding spelling must sit inside an `mpd-delta` region. The negative lookahead keeps
`const x = ctx.tools.register(def)` (a call THROUGH the facade) clean.

The childCtx skip is now IDENTITY-based: the five known lines are matched by `file + trimmed text`
(T-55: no line numbers), still counted as the residual, and still SCANNED by the rule set — the map
`COUNTED_CHILD_CTX_ACCESSES` exempts exactly the one counted `on` access per subscription line, so any
ADDITIONAL seam on those lines, and any new line mentioning `childCtx`, is a finding
(`childCtx.unregistered-use`) rather than a silently grown residual.

New arm "t23 item 3: the receiver-hiding spellings are CAUGHT — the new rules are not dead code":
seven spellings each fire their rule; three negative controls stay clean (facade call, bare alias
call, `const captain = ctx.agents.get(...)`). Scanner file: 6 tests, 0 fail.

## Items 4 and 5 — AGENTS.md (docs lane's prose, reworded in place)

- §1: "…goes through the mounted `mpdDsh` service **except the counted `setup(childCtx, child)`
  residual that §6 names** (five lines in `lib/members.js`, asserted line-by-line) …"
- §6: "…it reaches every harness seam THROUGH `mpd-dsh-adapter` — except the counted
  `setup(childCtx, child)` residual named below: …"
- §6 flags: "…route through FOURTEEN adapter methods, each behind a `capabilities()` flag (one flag
  may cover two methods; `subagentRuntime` reuses the existing `subagents` flag): …"
- §6 residual paragraph now names all three uses of the host-handed ctx: the **two raw subscriptions
  `childCtx.on('agent/error')` and `childCtx.on('agent/request-error')`**, the
  `installModelSelection(childCtx, …)` hand-off into the vendored `_deps/dsh-agent` helper, and the
  legacy `hostChild ?? childCtx.agent` data read — with the legacy-Alpha.2 reason it is not routed.

## Item 6 — already stated in the verification result (no edit made)

Quoted from `evidence/agent-teams/adapter-wiring/verification/20260919T152119Z/result.json`
(`AC10_mounting_boot.boot_lines.ADAPTER_SEAMS`), read 16:02Z:

> carries toolsRegisterHost, subagentsProvider, subagentsContinuable, subagentsInterrupt,
> llmListModels, llmResolveCallConfig, systemPromptSection; the five agent-object flags (agentScope,
> agentTurnStart, agentTurnCancel, agentTurnSteer, agentTurnInject) are LIVE-REGISTRY probes and read
> FALSE in a session-less boot — exactly like the pre-existing turnSubmit, which is false in the same
> line

That is the required scope limitation, in the required artifact; this lane therefore did not touch
another lane's in-progress evidence file.

## Verification sweep (16:03:52Z) — every command green

| Command | Result |
|---|---|
| `bun test packages/mpd-agent-teams-plugin` | **361 pass / 0 fail** (5269 expect() calls) — +1 test from this lane |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — 151 regions / 13 files |
| `bun run typecheck` | exit 0 |
| `git status --porcelain -- …/test …/self-fix-tests` | only `??` entries (no ` M `) |
| `bun run verify:docs` | PASS — pairs=38 failed=0 violations=0 |
| `bun run verify:gates` | PASS — 5/5 member gates green |

The captain is the only git writer; this lane wrote files only.
