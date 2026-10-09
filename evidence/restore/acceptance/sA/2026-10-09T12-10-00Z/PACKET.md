# S-A evidence packet — the QA evidence reader (v3+v4) and the DeepSeek Messages SSE wire shape

Stream **S-A** of the wave `restore-wave-acceptance`, per `.mpd/plans/restore-acceptance-fix.md` §4 S-A
(the ten criteria) and §3 (the frozen interfaces). Writer: `qa-reader-writer` (Senior Engineer).
Wave's single `skills/**` writer and the wave's ONE `VENDOR_LOCK` re-pin.

## 0. Revision anchor — READ FIRST (settled-hash discipline, §6 + AGENTS §7)

**The FROZEN revision this packet is written against** (verbatim in `revision-anchor.final.txt`, read at
**2026-10-09T12:21:36Z**, AFTER the re-pin, which is the last write of this stream):

    UTC=2026-10-09T12:21:36Z
    HEAD=5ff70951c4211c766d3e0cfc6d63c9c1462363d3
    lane-sha256=cdf2a7f4a8cd22415db8303c845cc4fbaa2eb11916bf0fdd52398e5791c05965
      8c8ec7243a6bbfed  VENDOR_LOCK.json
      b2d1f9c7c25137a3  skills/dsh-qa/SKILL.md
      db70dec12ed4543f  skills/dsh-qa/scripts/extension-isolation.ts
      e5c4e83ce78f189b  skills/dsh-qa/scripts/lib/messages-sse.ts
      8ed4e2d22ea06dd4  skills/dsh-qa/scripts/lib/session-evidence.ts
      71a907fdb7ac2ef5  skills/dsh-qa/scripts/readonly-deny.ts
      f340027a321223ac  skills/dsh-qa/scripts/software-smoke.ts

Two cross-checks that the frozen bytes ARE the ones measured: the per-file hashes `e5c4e83ce78f189b`
(`messages-sse.ts`) and `8ed4e2d22ea06dd4` (`session-evidence.ts`) are byte-identical to the "pristine"
hashes the planted-regression runner printed before and after each mutation
(`planted-regressions.txt`) — so the tree the self-tests and the live lanes ran against is the tree the
restores reproduced.

The pre-run anchor, taken before the first live lane and kept verbatim as
`revision-anchor.pre-run.txt` in this directory (the digest moved after that because the first live run
exposed an apparatus flake — §3.4 records it):

    HEAD=5ff70951c4211c766d3e0cfc6d63c9c1462363d3
    UTC=2026-10-09T12:11:47Z
    skills-lane-sha256=8caef88fd6995977b02d38368671a997a9d92997087b38116cbf5c27abebac1b

Re-measure the anchor with:

    node -e 'const {createHash}=require("crypto"),fs=require("fs");const files=["skills/dsh-qa/SKILL.md","skills/dsh-qa/scripts/extension-isolation.ts","skills/dsh-qa/scripts/lib/messages-sse.ts","skills/dsh-qa/scripts/lib/session-evidence.ts","skills/dsh-qa/scripts/readonly-deny.ts","skills/dsh-qa/scripts/software-smoke.ts","VENDOR_LOCK.json"];const h=createHash("sha256");for(const f of files.slice().sort()){h.update(f+"\0");h.update(fs.readFileSync(f))}console.log("lane-sha256="+h.digest("hex"))'

Every quote below comes from a RAW LOG ON DISK in this directory (or from a case's own
`evidence/.../result.json` named next to it), never from a summary.

## 1. What changed (write scope only)

| File | Change |
|---|---|
| `skills/dsh-qa/scripts/lib/messages-sse.ts` | **NEW.** The one Messages SSE implementation: `messagesTextEvents`, `messagesToolUseEvents`, `writeMessagesSse`, `readWireRequest`, `MESSAGES_EVENT_TYPES`, plus its own `--self-test` |
| `skills/dsh-qa/scripts/lib/session-evidence.ts` | `recordedResultOf` reads BOTH result shapes (v3 block / v4 message); `findToolCall` honours `data.message.isError` and returns the v4 payload text; `writeStore` gained a container-name knob; self-test gained a v4 POSITIVE arm and a v4 `isError:true` NEGATIVE control |
| `skills/dsh-qa/scripts/readonly-deny.ts` | stub speaks Messages SSE; trace reads both request shapes; `spawnDriven` keys on the ADAPTER-PROBE `filterSent`; the control lane reads the refusal from the harness SESSION STORE (`refusalSeen`) with zero child requests; every note is a function of measured fields; two offline code-shape arms |
| `skills/dsh-qa/scripts/software-smoke.ts` | stub speaks Messages SSE via the shared helper; request read via `readWireRequest`; self-test gained a 3-step Messages protocol arm; the session step now records the recorded tool-result heads |
| `skills/dsh-qa/scripts/extension-isolation.ts` | the shared stub speaks Messages SSE; `toolResultsByCallId` reads BOTH result shapes (it returned an EMPTY map on every live v4 store); self-test drives Messages requests, a `tool_result` block, and a legacy OpenAI request |
| `skills/dsh-qa/SKILL.md` | the `readonly-deny` row's failure-mode claim re-derived from measurement; the retired "OpenAI-shaped stub" wording replaced by "DeepSeek Messages stub" in every row that carries it |
| `VENDOR_LOCK.json` | the wave's ONE re-pin (the corpus `treeSha`), same commit as the change that invalidated it |

Nothing outside that list was written. `git status --porcelain -- skills/ VENDOR_LOCK.json` on the
frozen revision (§0):

    M VENDOR_LOCK.json
    M skills/dsh-qa/SKILL.md
    M skills/dsh-qa/scripts/extension-isolation.ts
    M skills/dsh-qa/scripts/lib/session-evidence.ts
    M skills/dsh-qa/scripts/readonly-deny.ts
    M skills/dsh-qa/scripts/software-smoke.ts
    ?? skills/dsh-qa/scripts/lib/messages-sse.ts

## 2. The ten acceptance criteria (§4 S-A)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | reads BOTH session shapes (v3 block / v4 message) | **PASS** | §3.1 self-test arms; §3.5 real-store check |
| 2 | v4 text non-empty; `isError:true` never `succeeded:true` | **PASS** | §3.1 (v4 positive + negative control); §3.5 real store: errored 673 chars / `succeeded:false`, ok 8191 chars |
| 3 | `--self-test` gains a v4 POSITIVE arm + an `isError:true` NEGATIVE control, both exit codes recorded | **PASS** | §3.1 (exit 0) and §3.6 (planted regression → exit 1) |
| 4 | stub emits Messages SSE and NEVER the retired chunk object; real case exits 0 with `childRequests >= 1` and `filterSent.deny` = the eight names | **PASS** | §3.2 (code shape: absence + positive emitters), §3.4 lane 1 |
| 4b | no assertion rests on a FIXED tool count (membership only) | **PASS** | §3.4 lane 1 `enforcement` (membership fields only); §3.3 `childToolCounts`/`parentToolCount` removed from the verdicts |
| 5 | control lane reports `refusalSeen: true` with ZERO child requests, read from the session store / tool result, never stderr alone | **PASS** | §3.4 lane 1: `refusalSeen=true`, `childRequestsUnderRestriction=0`, `refusalInStdout=false`, `recordedSpawnText` quoted |
| 6 | `spawnDriven` keys on the ADAPTER-PROBE `filterSent`, never `stub.calls() >= 2` | **PASS** | §3.2 (raw grep, both directions) |
| 7 | `software-smoke.ts` + `extension-isolation.ts` carry the corrected wire shape; real runs AND `--self-tests` recorded | **PASS (wire shape) + BOUND (green run)** | §3.1, §3.5, §4.1: both carry the helper (code shape in §3.2); `--self-tests` EXIT=0; real runs recorded — `extension-mcp-bridge` EXIT=0, `software-smoke` EXIT=1 with its cause measured as the verification law refusing the case's own `write` |
| 8 | `codegraph-smoke` re-run: the reader fix moves its recorded payload length off 0 — or the packet states why not | **PASS on the subject** | §3.5: `resultChars` 0 → **502**, `resultHasNorm=true`, `tool.succeeded=true`; the case's residual exit-1 is the stale `initOk` predicate (§5.3), not the reader |
| 9 | every `*.note` is a function of measured fields; the SKILL.md "SILENT UN-GUARDING" claim re-derived or deleted | **PASS** | §3.4 lane 1 notes; §1 SKILL.md row (re-derived, not deleted) |
| 10 | `repin-vendor --check` green after the ONE `--write`; `verify:vendor`, `test:qa`, `verify:docs` green | **PASS** | §3.8: re-pin applied once (`skills` 372→373, `cb6df509…`), `--check` GREEN drift=0, `verify:vendor` PASS, `test:qa` EXIT=0, `verify:docs` EXIT=0; plus `typecheck` and `verify:comments` EXIT=0 |

## 3. Raw commands and their observed results

### 3.1 The five `--self-test` runs (verbatim block: `self-tests.txt`)

    $ node skills/dsh-qa/scripts/lib/messages-sse.ts --self-test
    [messages-sse self-test] ok: both turn builders emit the six Messages events in order, the retired OpenAI shape and the `[DONE]` sentinel are absent (with the no-top-level-`type` control that proves that check is falsifiable), the tool arguments parse as a JSON object, and the request reader reads BOTH wire shapes
    EXIT=0
    $ node skills/dsh-qa/scripts/lib/session-evidence.ts --self-test
    [session-evidence self-test] ok: v3 + v4 result shapes (v4 payload text non-empty, v4 isError:true refused), multi-frame + plain stores, torn-frame reporting, call/result pairing, and every negative control verified
    EXIT=0
    $ node skills/dsh-qa/scripts/readonly-deny.ts --self-test
    [readonly-deny self-test] ok: 34 checks
    EXIT=0
    $ node skills/dsh-qa/scripts/software-smoke.ts --self-test
    [software-smoke self-test] ok: fixture semantics + deterministic self-play (winner P1, 11 plies) + 4 oracle probes green, mutation control RED (9 violation(s)) + 3-step Messages stub protocol
    EXIT=0
    $ node skills/dsh-qa/scripts/extension-isolation.ts --self-test
    [extension-isolation self-test] ok: stub protocol in DeepSeek Messages frames (tool call as input_json_delta, advance on a tool_result block, child marker, no-tools text, legacy OpenAI request still read) + descriptor contract + shipped example + boot recipe verified
    EXIT=0

The v4 arms of criterion 3 are inside the `session-evidence` block above; §3.7 shows them reddening
under a planted regression. The full `bun run test:qa` (every QA `--self-test`) is in `test-qa.log`,
final line `EXIT=0`.

### 3.2 Code-shape evidence (criteria 4 and 6) — `code-shape.txt`

Verbatim from `code-shape.txt`, captured 2026-10-09T12:11:58Z. **A `grep` exit of 1 below means NO MATCH
— that is the intended result of an absence check, not a failed command.**

    $ grep -rn "chat.completion.chunk" skills/dsh-qa/scripts/
    EXIT=1                       # the retired wire object is ABSENT from every case AND the helper

    $ grep -n "writeMessagesSse\|messagesToolUseEvents\|messagesTextEvents\|readWireRequest" skills/dsh-qa/scripts/{readonly-deny,software-smoke,extension-isolation}.ts
    readonly-deny.ts:60:  import { MESSAGES_EVENT_TYPES, messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse } from "./lib/messages-sse.ts"
    readonly-deny.ts:397: const toolFrames = messagesToolUseEvents("call_probe_1", "mpd_role_spawn", { role: "Architect", task: "Reply OK" })
    readonly-deny.ts:399: const textFrames = messagesTextEvents("probe-child-answered")
    readonly-deny.ts:507: const wire = readWireRequest(body)
    readonly-deny.ts:519: writeMessagesSse(res, messagesToolUseEvents("call_probe_1", "mpd_role_spawn", { role: "Architect", task: "Reply OK" }))
    readonly-deny.ts:522: writeMessagesSse(res, messagesTextEvents("probe-child-answered"))
    software-smoke.ts:39: import { MESSAGES_EVENT_TYPES, messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse } from "./lib/messages-sse.ts"
    software-smoke.ts:413: const wire = readWireRequest(body)
    software-smoke.ts:420:  if (toolNames.length === 0) return writeMessagesSse(res, messagesTextEvents("software-smoke"))
    software-smoke.ts:421:  if (stage === "idle") { stage = "write-issued"; return writeMessagesSse(res, messagesToolUseEvents("call_write_1", "write", { file_path: "nim.mjs", content: gameSource })) }
    software-smoke.ts:422:  if (stage === "write-issued" && toolResults.length > 0) { stage = "bash-issued"; return writeMessagesSse(res, messagesToolUseEvents("call_bash_1", "bash", { command: BASH, description: "…" })) }
    software-smoke.ts:423:  return writeMessagesSse(res, messagesTextEvents("software-smoke-done"))
    extension-isolation.ts:34: import { messagesTextEvents, messagesToolUseEvents, readWireRequest, writeMessagesSse } from "./lib/messages-sse.ts"
    extension-isolation.ts:406: const wire = readWireRequest(body)
    extension-isolation.ts:430:  if (decision.kind === "text") return writeMessagesSse(res, messagesTextEvents(decision.text))
    extension-isolation.ts:431:  return writeMessagesSse(res, messagesToolUseEvents("call_" + label + "_" + toolResults.length, decision.name, decision.args))
    EXIT=0

    $ sed -n "/export const MESSAGES_EVENT_TYPES/,/^]/p" skills/dsh-qa/scripts/lib/messages-sse.ts
    export const MESSAGES_EVENT_TYPES: readonly string[] = [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]
    EXIT=0

The retired wire object, spelled here so this packet names it once while the source does not:
`{"object":"chat.completion.chunk","choices":[{"delta":…}]}`. Its defining defect is that it carries NO
top-level `type`, which is exactly the field the pinned provider's `parseSse`
(`@deepseek-ai/dsh-llm-deepseek` `lib/types/sse.js`) requires — `messages-sse.ts --self-test` asserts
that no-`type` property as NEGATIVE CONTROL 1, so the absence check is falsifiable rather than vacuous.

Criterion 6, same file, both directions:

    $ grep -n "spawnDriven" skills/dsh-qa/scripts/readonly-deny.ts
    147:  readonly spawnDriven: boolean
    424:  checks.push(["spawnDriven keys on the ADAPTER-PROBE filterSent, never on the stub's call count", ownSource.includes("spawnDriven: filterSent !== null") && !ownSource.includes("stub.calls() >= " + "2")])
    698:        spawnDriven: filterSent !== null,
    774:        && steps.positive.spawnDriven
    EXIT=0

    $ grep -n "stub.calls() >= 2" skills/dsh-qa/scripts/readonly-deny.ts
    EXIT=1                       # the retired call-count predicate is GONE

    $ grep -n "ADAPTER-PROBE" skills/dsh-qa/scripts/readonly-deny.ts
    146:  /** Whether the parent was driven into the spawn: the ADAPTER-PROBE line was seen (never a call count). */
    610:          'console.error("[ADAPTER-PROBE] toolFilter=" + JSON.stringify(spec.toolFilter ?? null));\n      const run = await subagents.start(')
    665:        const m = /\[ADAPTER-PROBE\] toolFilter=([^\n]*)/.exec(out)
    EXIT=0

Two further code-shape arms make both claims OFFLINE-falsifiable inside the case's own `--self-test`
(so a regression reddens without a 3.5-minute dsh boot): the case's source must carry no retired
streaming-object shape, and must not reintroduce the order-keyed `if (calls === 1)` predicate that
§0/§7 records as the measured flake.

### 3.3 Amendment 4b — no assertion rests on a fixed tool count

Verbatim from `amendment-4b.txt`, captured 2026-10-09T12:17:48Z:

    $ grep -n "childToolCounts\|parentToolCount\|parentHasAllSeven" skills/dsh-qa/scripts/readonly-deny.ts
    EXIT=1                       # the count-shaped verdict fields are GONE (removed by this stream)

    $ grep -n "parentSeesAllDenyNames\|writeCapableVisible: WRITE_CAPABLE.filter\|childLeaksWriteCapable" skills/dsh-qa/scripts/readonly-deny.ts
    520:        writeCapableVisible: WRITE_CAPABLE.filter((n) => wire.toolNames.includes(n)),
    775:      childLeaksWriteCapable: childSpy.flatMap((c) => c.writeCapableVisible),
    779:      parentSeesAllDenyNames: parentShowsAllDenied,
    802:        + ", childLeaksWriteCapable=" + JSON.stringify(childSpy.flatMap((c) => c.writeCapableVisible)),
    EXIT=0

The live run's own enforcement verdict carries MEMBERSHIP fields only — no count is asserted on:

    {
     "ok": true,
     "childRequests": 1,                 # a count of REQUESTS, which is the criterion's own subject
     "parentRequests": 3,
     "childLeaksWriteCapable": [],
     "childHasStructuredOutput": true,
     "parentSeesAllDenyNames": true,     # membership of the eight, not a registry size
     "note": "read-only authority is ENFORCED: the child's own requests cannot see any of the eight write-capable tools, while the parent's sees all of them"
    }

The registry size DOES vary on this host — the green runs measured `toolCount` 104 / 106 / 97 across
lanes — which is exactly why `childToolCounts` and `parentToolCount` were removed from the verdicts
instead of being asserted on.

### 3.4 Lane 1 — `readonly-deny` (real run, isolated homes): DETERMINISM 5/5

**The determinism record (verbatim: `determinism.txt`, per-run logs `determinism-run<N>.log`).** On the
FROZEN revision (§0), five consecutive runs of the same command:

    run 1  stamp 2026-10-09T12-17-34.323Z   EXIT=0   ok=true
    run 2  stamp 2026-10-09T12-18-06.541Z   EXIT=0   ok=true
    run 3  stamp 2026-10-09T12-18-32.905Z   EXIT=0   ok=true
    run 4  stamp 2026-10-09T12-19-35.044Z   EXIT=0   ok=true
    run 5  stamp 2026-10-09T12-20-10.831Z   EXIT=0   ok=true

**5/5 exits 0.** The run before the freeze (chain 2, stamp `2026-10-09T12-14-05.555Z`) was also green.

**The flake this stream found and fixed — recorded, not hidden (verbatim:
`readonly-deny.live.run1-order-flake.log`).** The first re-run of the wave went RED on the same tree:

    positive: {"exit":0, …, "stubCalls":2, "stubTrace":[
        {"call":1,"hasTools":false,"bytes":115496,"toolCount":0,"writeCapableVisible":[]},
        {"call":2,"hasTools":true,"bytes":209930,"toolCount":104, …}]}
    enforcement: {"ok":false,"childRequests":0,"parentRequests":1, …}
    EXIT=1

An earlier run of the SAME source was green with the tool-less session-title request at call#2
(`evidence/workmate/roles-readonly/2026-10-09T12-10-15.012Z`, `ok=true`). Root cause, measured: the stub
picked the step it would drive by ARRIVAL ORDER (`calls === 1`), and the tool-less title request lands at
NO FIXED POSITION — so on some runs the spawn call went to the title request and the parent's real model
step was answered with text, meaning no spawn was ever requested (`childRequests: 0`). The fix keys the
stub on the REQUEST'S SHAPE (tools offered AND no tool result yet), which is order-independent; the
case's own `--self-test` now asserts the shape-keying and the absence of the retired
`if (calls === 1)` predicate (§3.2), so the regression cannot come back silently. This is the same defect
class the recon's Lane A recorded for the case's `spawnDriven` predicate — the stub was its last
order-dependent site.

**The green run's measurements** (`evidence/workmate/roles-readonly/2026-10-09T12-17-34.323Z/result.json`,
i.e. run 1 of the five):

    positive.filterSent.deny = ["write","edit","mpd_hashline_edit","bash","mcp__ast_grep__rewrite",
                                "mcp__ast_grep__scan","mcp__lsp__rename_symbol","mcp__lsp__rename_symbol_strict"]   # the eight, in order
    positive.spawnCalled=true  positive.spawnErrored=false  spawnDriven=true
    enforcement = {"ok":true,"childRequests":1,"parentRequests":3,"childLeaksWriteCapable":[],
                   "childHasStructuredOutput":true,"parentSeesAllDenyNames":true}
    positiveOk  = {"ok":true,"note":"positive lane: exit=0, denyListMatchesTheEight=true, spawnDriven=true,
                   restrictError=false, missingCredential=false, childRequests=1, childLeaksWriteCapable=[]"}
    isolation   = {"ok":true,"realWorkmateUntouched":true,"realWm":"/home/haroldzhao/.mpd/workmate"}

Criterion 4's `childRequests >= 1` and `filterSent.deny` equal to the eight names are both satisfied, and
`denyListMatchesTheEight` is computed, not asserted by eye.

**The control lane (criterion 5), same stamp:**

    reinjectionControl = {
      "ok": true,
      "mutationLoaded": true,
      "injectedNamesSeenByAdapter": ["str_replace_editor","apply_patch"],
      "childRequestsUnderRestriction": 0,
      "refusalSeen": true,
      "refusalReadFrom": "the harness session store: the mpd_role_spawn tool result with isError:true",
      "recordedSpawnCalled": true,
      "recordedSpawnErrored": true,
      "refusalInStdout": false }
    recordedSpawnText = "Error: tools.restrict() names unknown global tools \"str_replace_editor\",
      \"apply_patch\"; known global tools: agent_teams_control, agent_teams_dispatch, …, bash, …"

Two things this measures that prose could not: the refusal is real and is read from the HARNESS'S OWN
SESSION STORE (the `tool result` carrying `isError: true`), and **stdout does NOT carry it**
(`refusalInStdout: false`) — which is exactly why the previous control lane, reading stderr alone, was
green while proving nothing.

**Hermeticity (the captain's hypothesis, measured — verbatim `hermeticity-check.txt`).** From the same
green run's stub trace: call#1 = parent (104 tools, all eight visible), call#2 = the tool-less title
request, **call#3 = the CHILD's request (97 tools, 0 write-capable, `structured_output` present)**, call#4
= the parent's follow-up. Every one of them was answered BY THE STUB — the trace IS the stub's own record
of serving them — so the child's model step reached the case's loopback endpoint, not a real provider;
`missingCredential=false` and `authFailed=false` agree. The real-provider hypothesis is therefore
FALSIFIED by measurement. (The child's tool COUNT is quoted here as a description of the trace, never as
an assertion — amendment 4b.)

### 3.5 Lane 2 — `software-smoke`, lane 3 — `extension-mcp-bridge`, lane 4 — `codegraph-smoke`

**`software-smoke` — EXIT=1, and the cause is now ON THE RECORD (it was not before this stream).**
`software-smoke.live.log` (run 2, revision frozen at §0) and its own
`evidence/dsh-qa/software-smoke/2026-10-09T12-15-13.934Z/result.json`:

    session: {"ok":false,"exit":0,"stubCalls":4,"writeToolOffered":true,"bashToolOffered":true,
              "writeResultOk":false,"writeResultHead":"","toolResultHeads":[
                "Error: verification law: `write` on the CODE path \"nim.mjs\" is refused for this session, which the law gates directly. Code written here must be verified by a DIFFERENT agent working from the docs, so take one of the three routes: (1) DELEGATE the write — give the scope to a write-capable member (a ",
                "Error: verification law: `write` on the CODE path \"nim.mjs\" is refused for this session, so …",
                "DETERMINISTIC\n--- play ---\nnode:internal/modules/cjs/loader:1568\n  throw err;\n  ^\n\nError: Cannot find module '/tmp/mpd-software-smoke-kqsExV/ws/nim.mjs'"]}

Reading: the WIRE FIX WORKED — the conversation now runs the full four steps with `write` and `bash`
offered (`stubCalls: 4`, matching the case's last GREEN stamps of 2026-09-16/17), where run-1-of-the-
wave died at the first model step. The remaining red has a cause that has nothing to do with the
protocol: **the verification law refuses the case's own `write` step**, because the QA session is the
TOP-LEVEL agent of its own sandbox workspace and writes a `.mjs` CODE path. The bash step then reports
`Cannot find module`. That is a FINDING (§5.4), not something this stream may "fix" by editing the
fixture: the refusal is a bundle FEATURE working as designed, and changing the case to dodge it would be
editing a test to obtain a pass.

**`extension-mcp-bridge` — EXIT=0, GREEN.** `extension-mcp-bridge.live.log`, stamp
`evidence/extensions/extension-mcp-bridge/2026-10-09T12-12-43.292Z/result.json`:

    [extension-mcp-bridge] ok=true -> …/2026-10-09T12-12-43.292Z
    EXIT=0
    steps: install ok=true · live ok=true · dead ok=true · hang ok=true · schema ok=true · dup ok=true · stderr ok=true · containment ok=true

This is the shared-stub real run for criterion 7's second file: the lane imports `makeStubModel` from
`extension-isolation.ts` and drives eight real boots through it, so the Messages stub is exercised
end-to-end. It is ALSO independent evidence for the `toolResultsByCallId` half of the reader fix: that
case pairs `mpd_ext_show` results per `callId` through the function, and on a v4 store the pre-fix code
returned an EMPTY map (every `showTexts[id]` would be `""`, so `dead`/`hang`/`schema`/`dup`/`stderr`
would all have gone red).

**`codegraph-smoke` — EXIT=1, but criterion 8's SUBJECT IS MEASURED AND SATISFIED.** Run 1 of this
stream shows the environment precondition (`missing toolchain codegraph; run npm install --prefix
.toolchain first`, quoted in `codegraph-smoke.live.run1-no-toolchain.log`). Run 2, after provisioning
(§5.2), produced `evidence/dsh-qa/codegraph/2026-10-09T12-16-02.197Z/result.json`:

    exit=0  tool: {"name":"mcp__codegraph__codegraph_explore","called":true,"succeeded":true,
                   "arguments":"{\"query\": \"norm src/util.ts\", \"projectPath\": \"…/.cg-qa\"}",
                   "resultChars":502,"reason":null}
    resultHasNorm=true   outHasToolName=true   initOk=false   sessionError=null

**`resultChars` moved off 0 → 502 characters, and the returned text carries the indexed source** — which
is exactly what criterion 8 asks the reader fix to move. The case still exits 1, and the reason is a
SEPARATE, out-of-scope apparatus defect: `initOk` greps the boot's stdio for `init status=ok|marker`,
while the marker is emitted through `openLogSink` — the library's own header calls it "the
NON-capturing half of the log-sink pair: it never touches `process.stderr`", and `tryOpenRoot` writes it
to `<root>/.mpd/logs/<name>.log`. So the predicate cannot see the marker it asserts on. `codegraph-smoke.ts`
is NOT in this stream's write scope → FINDING §5.3.

### 3.6 The real-store reader check (criteria 1, 2 and 8's subject) — `real-store-reader-check.txt`

Verbatim from `real-store-reader-check.txt`, captured 2026-10-09T12:12:18Z against the LIVE harness
session store (v4), decoded read-only:

    store=/home/haroldzhao/.dsh/sessions/--home-haroldzhao-MyProj-DshProj-My-Power-Dsh--/f990e8e7-b48c-4a96-93b7-fe99a0ea0178/session.v4.jsonl.zstd
    records=962 frames=617 calls=171 results=170
    --- REAL ERRORED CALL paired through the fixed reader ---
    {"tool":"bash","called":true,"succeeded":false,"resultChars":673,"reason":"the harness recorded 1 call(s) to bash but every recorded result is an ERROR"}
    --- REAL SUCCESSFUL CALL paired through the fixed reader ---
    {"tool":"read","called":true,"succeeded":true,"resultChars":8191,"reason":""}

### 3.7 Planted regressions (the falsifier each offline arm is worth)

Verbatim from `planted-regressions.txt` (runner: `planted-regression.mjs`). Each mutation asserts its
needle is UNIQUE, runs the affected `--self-test`s, then RESTORES the bytes from a backup and proves the
restore by sha256.

    ## P1 — the reader ignores the v4 message-level `isError`
    pristine sha256=8ed4e2d22ea06dd4ac51dece758762cf26146a386536a6f17b1403bff1a47007
    mutated  sha256=616c91bf62b0c7428a13b1bef42635099c4aadf657b6b28a62607077c4b1644d
    MUTATED  skills/dsh-qa/scripts/lib/session-evidence.ts --self-test -> EXIT=1
             [session-evidence self-test] FAIL: a v4 result flagged isError:true must report succeeded=false
    restored sha256=8ed4e2d22ea06dd4ac51dece758762cf26146a386536a6f17b1403bff1a47007
    RESTORE PROVEN (sha256 identical)
    RESTORED skills/dsh-qa/scripts/lib/session-evidence.ts --self-test -> EXIT=0

    ## P2 — the tool-call frame loses its top-level `type` (the retired wire object's defining defect)
    pristine sha256=e5c4e83ce78f189bc26c4584cb848cfbb40419da042bf674367f23a279e8775d
    mutated  sha256=d604af2b825092bc83525abad5e02a59432031e9fa61dafa65a516a76f896900
    MUTATED  skills/dsh-qa/scripts/lib/messages-sse.ts --self-test -> EXIT=1
             [messages-sse self-test] FAIL: a tool-call turn must emit the six Messages events in order,
             saw ["message_start",null,"content_block_delta","content_block_stop","message_delta","message_stop"]
    MUTATED  skills/dsh-qa/scripts/readonly-deny.ts --self-test -> EXIT=1
             [readonly-deny] FAIL: self-test: the tool-call frames are the six Messages events, in order |
             no OpenAI streaming-object frame crosses the wire
    MUTATED  skills/dsh-qa/scripts/software-smoke.ts --self-test -> EXIT=1
             [software-smoke self-test] FAIL: the stub answered with an OpenAI streaming-object frame
    restored sha256=e5c4e83ce78f189bc26c4584cb848cfbb40419da042bf674367f23a279e8775d
    RESTORE PROVEN (sha256 identical)
    RESTORED skills/dsh-qa/scripts/lib/messages-sse.ts --self-test -> EXIT=0
    RESTORED skills/dsh-qa/scripts/readonly-deny.ts --self-test -> EXIT=0
    RESTORED skills/dsh-qa/scripts/software-smoke.ts --self-test -> EXIT=0

So: criterion 3's v4 NEGATIVE control is FALSIFIABLE (it is the arm that reddens when the flag is
ignored), and one planted frame mutation reddens THREE offline arms at once — the two code-shape claims
and the wire-shape claim are all backed by an experiment, not by inspection.

### 3.8 Gates (criterion 10 and the standing gates)

| Command | Observed | Log |
|---|---|---|
| `node scripts/repin-vendor.ts --write --i-know-this-is-the-captains-step` | `skills` `treeSha cd156171… → cb6df509…`, `fileCount 372 → 373`; applied to `VENDOR_LOCK.json` (2 lines changed, `git diff --stat`). **SUPERSEDED by the captain's amendment — read §6 before quoting this row** | `repin-vendor.txt` |
| `node scripts/repin-vendor.ts --check` | `CHECK : GREEN - lock matches the working tree (drift=0, problems=0)` — **EXIT=0** | `repin-vendor.txt` |
| `bun run verify:vendor` | `PASS - 7 shipped asset(s) fingerprinted` — **EXIT=0** | `repin-vendor.txt` |
| `bun run test:qa` (every QA `--self-test`) | **EXIT=0** | `test-qa.log` |
| `bun run typecheck` | **EXIT=0** (`tsgo --noEmit`, no diagnostics) | §3.1 note + run below |
| `bun run verify:comments` | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` — **EXIT=0** | console |
| `bun run verify:docs` | `pairs=47 failed=0 violations=0 … PASS` — **EXIT=0** | console |

The last three were re-run on the frozen revision, after the re-pin:

    $ bun run typecheck
    $ tsgo --noEmit
    TYPECHECK_EXIT=0
    $ bun run verify:comments
    VERDICT: PASS — every declaration in the family carries a precise comment and a full signature.
    CM_EXIT=0
    $ bun run verify:docs
    [verify-docs-parity] root=… pairs=47 failed=0 violations=0 exempt=24 derived=3 links=430 dead=0 — PASS
    DOCS_EXIT=0

The re-pin is the wave's ONE re-pin and the LAST write of this stream (`VENDOR_LOCK.json` alone appears
in `git status` next to the five `skills/**` files and the one new file, §1).

## 4. Declared bounds — what this packet does NOT prove

1. **`software-smoke`'s real run is RED, with its cause measured and routed** (§3.5, §5.4). The wire
   shape it was asked to carry IS corrected and IS exercised (four-step conversation, `write`+`bash`
   offered); the case cannot exit 0 while the verification law refuses its own `write` step. Criterion 7
   is therefore **PASS for the wire shape and BOUND for a green real run**.
2. **`codegraph-smoke`'s real run is RED while its criterion-8 subject IS measured green** (§3.5): the
   reader returns 502 characters carrying the indexed source, and the terminal red is the stale `initOk`
   predicate, which is not in this stream's write scope.
3. **`extension-isolation.ts` has no live lane of its own.** It is the shared module four extension cases
   import, so its "real run" is a downstream lane: this packet records `extension-mcp-bridge` (EXIT=0,
   §3.5) and records `extension-isolation --self-test` (EXIT=0, §3.1). A reviewer who wants coverage of
   the other three importers (`extension-lifecycle`, `extension-template`, `ulw-command`) is asking for
   runs this stream did not perform — named here rather than implied.
4. **The planted regressions in §3.7 prove the OFFLINE arms discriminate; they do not re-run the live
   lanes on the mutated bytes.** The live lanes' own falsifier is the run-to-run record in §3.4.
5. **The full Docker acceptance lane was NOT run by this stream** — it is §7's step, owned by the captain
   after the last write and the re-pack.

## 5. Findings routed to the captain (outside this lane's write scope)

1. **`AGENTS.md` §13 still carries the retired "silent un-guarding" wording** for the read-only deny
   discipline (recon Lane A finding 5 names both this file and the SKILL.md row). `AGENTS.md` is **S-C's**
   write scope, so this stream did NOT touch it: the sentence to re-derive or delete is the one that
   reads the ABSENCE of a refusal as the measured failure mode. The measurement that replaces it is in
   §3.4.
2. **`codegraph-smoke` has an environment precondition this checkout does not satisfy**:
   `.toolchain/node_modules/.bin/codegraph` is absent (the recon's Lane B recorded the same fact for the
   ast-grep engine: `.toolchain/node_modules/.bin/` holds only `bun`). Run 1 exits 1 with
   `missing toolchain codegraph; run npm install --prefix .toolchain first` — quoted in
   `codegraph-smoke.live.run1-no-toolchain.log`. For run 2 this stream provisioned it with a SYMLINK to
   the identical 1.5.0 binary already installed at `node_modules/.bin/codegraph` (`--version` → `1.5.0`;
   `.toolchain/` is gitignored, `.gitignore:6`, so nothing entered the tree). **That is an environment
   step, not a code change, and it is declared here on purpose:** it is what let the case exercise a real
   binary and return criterion 8's 502-character payload. A reviewer who wants the toolchain installed
   the documented way can run `npm install --prefix .toolchain`.
3. **`codegraph-smoke`'s `initOk` predicate is stale** — see §3.5. It asserts a marker that
   `openLogSink` writes to `<root>/.mpd/logs/mpd-codegraph.log`, never to the boot stdio the case reads.
   `codegraph-smoke.ts` is NOT in this stream's write scope, so this is a finding, with the exact
   producer (`packages/mpd-codegraph-plugin/src/index.ts`, the `logLine(... "init status=" + status …)`
   call) named for whoever owns it.
4. **`software-smoke` cannot pass on a bundle carrying the verification law** — see §3.5. Its scripted
   conversation writes `nim.mjs`, a CODE path, from a session that IS the top-level agent of its own
   sandbox workspace, so the law refuses it (verbatim refusal in §3.5). Two candidate routes, both the
   captain's call and neither taken here: drive the QA boot with the law's own supported mode (the
   `verify.mode=off` control whose falsifier lives in `skills/dsh-qa/scripts/verify-law.ts --self-test`),
   or change the fixture so the artifact under test is not a code path. **This stream deliberately did
   NOT apply either**: editing the case until it goes green is the "manufactured pass" this wave's own
   contract forbids.
5. **`dist/mpd-package/skills/dsh-qa/**` still carries the retired wire shape** (it is a PACK artifact,
   not source): the §7 acceptance gate re-packs it with the pinned toolchain after the last write, which
   is the captain's step. Until that re-pack, `pack.staticCoherence` grades a stale copy — expected, and
   named here so it is not mistaken for a miss by this stream.
6. **An UNATTRIBUTED stray file `./0` sits in the repo root** (20 bytes, `username present: 9`, mtime
   `2026-10-09T12:18:49Z`). It is NOT in this stream's write scope, none of this stream's commands
   redirects to a bare `0`, and the string appears nowhere in the repo or the harness install — so it is
   reported rather than deleted: guessing at authorship and removing somebody else's artifact is exactly
   the absorption this lane is told not to do. It is named here so it is not silently committed.
   **CLOSED (2026-10-09, captain):** the file was the captain's own — an `awk` quoting bug in a credential
   probe (`print … > 0`). The captain verified the resolved path, read its bytes and removed it. Left in
   this packet as the record of a finding that was correctly routed rather than absorbed.

## 6. ERRATUM — appended 2026-10-09T12:25Z, after T1 was completed

Two facts were measured after this packet was frozen. Neither changes any S-A code claim; both change how
ONE row of §3.8 must be read, so they are recorded rather than left for a verifier to discover.

**(a) The `skills` fingerprint rule was wrong, and the wave's re-pin has been superseded.** The re-pin in
§3.8 was computed over the WORKING TREE, which contains two files the repository deliberately ignores.
Measured here, read-only:

    $ git ls-files skills/ | wc -l          -> 371      # what a clean checkout has
    $ find skills -type f | wc -l           -> 373      # what the working-tree rule counted
    $ git check-ignore -v skills/frontend/references/design/ambience-skill.md
    skills/frontend/.gitignore:7:references/design/*.md   skills/frontend/references/design/ambience-skill.md
    $ git check-ignore -v skills/frontend/references/design/component-catalogs.md
    skills/frontend/.gitignore:7:references/design/*.md   skills/frontend/references/design/component-catalogs.md

So my `373 / cb6df509…` passed `verify:vendor` LOCALLY and could never pass in CI — the gate and the
re-pin shared the same working-tree assumption. **The captain owns the fix** (one rule, tracked files,
shared by the gate and the re-pin) and re-pinned once as a deliberate amendment; the lock now reads:

    skills: fileCount=371  treeSha=7b697057ec9dda6897d479bfb2a9a90a388bcd64e9e7f5fea329c11fe3ef7195
    lockedAt=2026-10-07T10:30:31Z
    $ bun run verify:vendor   -> PASS - 7 shipped asset(s) fingerprinted   EXIT=0

Read §3.8's re-pin row as "the S-A-triggered re-pin, superseded by the captain's amendment", and criterion
10's `verify:vendor` claim as holding against the AMENDED lock (re-measured EXIT=0 above), not against the
373-entry one.

**(b) `skills/**` is nonetheless byte-identical to the §0 anchor.** Re-measured per file at the same
moment, so the S-A evidence still describes the exact bytes it was produced from:

    MATCH b2d1f9c7c25137a3  skills/dsh-qa/SKILL.md
    MATCH db70dec12ed4543f  skills/dsh-qa/scripts/extension-isolation.ts
    MATCH e5c4e83ce78f189b  skills/dsh-qa/scripts/lib/messages-sse.ts
    MATCH 8ed4e2d22ea06dd4  skills/dsh-qa/scripts/lib/session-evidence.ts
    MATCH 71a907fdb7ac2ef5  skills/dsh-qa/scripts/readonly-deny.ts
    MATCH f340027a321223ac  skills/dsh-qa/scripts/software-smoke.ts

The composite `lane-sha256` in §0 therefore no longer reproduces, **because its `VENDOR_LOCK.json`
component moved** (the captain's amendment), not because any `skills/**` byte changed. A reviewer checking
the anchor should compare the six file hashes above; §0's composite digest is bound to the pre-amendment
lock and is kept verbatim as the historical measurement it was.

No file under `skills/**` was read-modified or written by this stream after the re-pin, and no re-pin was
run again here.
