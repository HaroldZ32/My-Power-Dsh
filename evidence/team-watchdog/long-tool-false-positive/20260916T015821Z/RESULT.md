# t84 (r6) — a long tool call must not look like silence

**What was wrong, in one line:** the heartbeat stamped on model steps and on tool **completion**
only, so a member running one long call (a build, a lane that boots a `dsh`, a slow test) was
indistinguishable from a wedged one — the tick WARNed three times and **paused a healthy team**. It
happened to us: `mpd-default` was held with `cause:{kind:"silence",ms:131049}` on an `in_progress`
task whose owner was running the real-boot lane.

**What landed:** an **observe-only** PRE hook in our adapter (`tools/pre-execute`), a per-member
**tool-in-flight** fact derived from the durable heartbeat store, a silence predicate that treats an
open call as *explained activity*, and a stated secondary bound that reports (never pauses) a call
that outlives it. No adopted code, no `skills/**`, no `.mpd/**`: `--check` is still 53 regions across
9 files.

---

## 1. The rule, its limit, and how it fails

| Question | Answer |
|---|---|
| What marks a call in flight? | the PRE hook's `tool-start` stamp: `{kind:'tool-start', at, tool, callId, teamId, taskId, attemptId, workspace}` |
| What clears it? | the POST stamp `{kind:'tool', …, callId}` of the **same callId** — i.e. the call returned, threw, or was cancelled after dispatch |
| What does NOT clear it? | a `deny` opens nothing (the call never dispatches); a process death, a pre-dispatch cancellation or a **pipeline** failure leaves no POST (the harness's own rule: “Tool and unknown-tool failures still receive post-execute; pipeline failures are already final”, `dsh-tools/lib/index.js:3203-3207`) |
| Does it survive a restart? | **Yes** — the fact lives in the same append-only JSONL heartbeat file, so a call that was open when the process died is still open for the new process. That is deliberate: the consequence is that the new process suppresses silence for the remainder of the bound and then reports it once, instead of losing the call entirely |
| The secondary bound | `watchdog.toolInFlightMaxMs`, default **900000 ms** (10× the frozen threshold). Past it the entry **stops suppressing** and produces **exactly one** `tool-expired` observation per task+attempt |
| What does `tool-expired` do? | records a durable incident (`cause:{kind:'tool-expired', ms, tool}`, `scene:null`, `hold:'not-requested'`) and a notice line. **Never** a scene, **never** a hold, **never** an escalate |
| The honest new limit | a member wedged **inside** a hanging tool is *reported*, not escalated or paused. A very long call and a hang are indistinguishable from the stamp stream; guessing is the defect this bound exists to fix, so the conservative action is the only defensible one |
| Kill switch / falsifier | `toolInFlightMaxMs: 0` disables the suppression entirely — the pre-r6 behaviour. The fixture uses exactly that to prove its own silence is earned |

## 2. The original scenario, measured before and after

The pre-fix dist was **byte-copied into `raw/dist-before/` before the rebuild**, so both halves run
the real plugin. Same record, same injected `step` stamp, same real command, same ticks; `driver:
raw/long-tool-before-after.mjs`, raw values in `raw/long-tool-before-after.json`:

| | BEFORE (`54f1f41c…`, 119753 B) | AFTER (`810e0fb3…`, 125754 B) |
|---|---|---|
| `tools/pre-execute` subscribed | **false** | **true** |
| stamp stream during the call | `["step"]` | `["step","tool-start"]` |
| real command | 1622 ms (exit 0) | 1620 ms (exit 0) |
| tick decisions | **warn, warn, escalate** | `[], [], []` |
| hold | **applied** (`cause: silence`) | **none** |

The four new fixture cases (`raw/run-new-cases.mjs`, `raw/new-cases.json`, all PASS):

* `long-tool-no-hold` — a **real** ~1.6 s child process inside ONE tool call; ticks 509/912/1313 ms
  after the call opened (the last past 3× the 300 ms window); 0 decisions, 0 scenes, 0 incidents,
  0 holds, `inFlightSuppressed: 3`; after the POST stamp closes the call the **next** tick past the
  threshold WARNs again (the member is watched again the moment the work ends).
* `long-tool-bound-disabled-control` — the **falsifier**: the same real command with
  `toolInFlightMaxMs: 0` gives `warn, warn, escalate` **and a hold**. (Conservative by construction:
  it still stamps `tool-start`, so its silence is measured from a *newer* stamp than the true pre-fix
  run — and it holds anyway.)
* `completed-tool-not-in-flight` — a `tool-start` **paired with its completion** is closed, so the
  wedge rule fires: `warn, warn, escalate` + hold. A finished tool buys no silence.
* `tool-inflight-expired` — inside the bound: nothing; past it: **exactly one** `tool-expired`
  incident (`scene:null`, `hold:'not-requested'`, `tool:'bash'`), no scene, no hold, no repeat on a
  later tick, no hold file.

## 3. The hook is observe-only (proven on a real call)

`raw/observe-only-real-call.mjs` dispatches the **same real tool call twice** through the **real
vendored cordis** waterfall — once without the hook, once with it:

```
WITHOUT hook: gate {"kind":"allow"} real result {"status":0,…} in 274 ms
WITH    hook: gate {"kind":"allow"} real result {"status":0,…} in 276 ms
the hook observed the call BEFORE the command started: true
same gate / same result / same post decision: true
```

The adapter owns `next()` and returns the downstream decision **verbatim**; the listener's own return
value is discarded and it observes a **frozen shallow copy** of the execution, so it cannot alter or veto
a call (nor mutate what will be dispatched), and a throwing listener is contained. The unit
suite carries the same proof plus a **negative control** that re-enacts the veto shape on the real
cordis waterfall (`packages/mpd-dsh-adapter-plugin/test/adapter.test.ts`). Soft-probe: no event bus →
no-op, no pre-hook method on the adapter → a warning and the pre-r6 behaviour, never a failed row.

## 4. Gates

| Gate | Result | Log |
|---|---|---|
| `bun test packages/mpd-team-watchdog-plugin packages/mpd-dsh-adapter-plugin` | **114 pass / 0 fail**, exit 0 | `raw/gates/1-package-suites.log` |
| `bun test packages` | 730 pass / **2 fail**, exit 1 — both failures are `mpd-config` tests reading **this workspace's** `.mpd/mpd.jsonc`; not caused by t84 (see below) | `raw/gates/2-full-suite.log` |
| the same 732 tests from a clean cwd (`bun test --root <repo>/packages`) | **732 pass / 0 fail**, exit 0 | `raw/gates/2b-full-suite-clean-cwd.log` |
| `bun run typecheck` | exit 0 | `raw/gates/3-typecheck.log` |
| `node scripts/patch-agent-teams-fixes.mjs --check` | exit 0 — **53 regions / 9 adopted files** (unchanged) | `raw/gates/4-adopted-check.log` |
| `bun run verify:docs` | PASS — pairs=34 failed=0 violations=0 | `raw/gates/5-docs-parity.log` |
| lane `team-watchdog-fault` (18 cases) | **PASS — 11 checks, 0 failed** | `raw/lane-fault.out`, `raw/lane-fault/result.json` |
| lane `team-watchdog-config` | **PASS — 10 checks, 0 failed** (the sixth knob leaves AC-11's five declared knobs untouched) | `raw/lane-config.out` |
| `bun run test:qa` (shipped form / individually) | shipped form stops at the first failure; individually **41 of 42 pass** — the one failure is `agent-teams-messaging.mjs --self-test` on a stale `VENDOR_LOCK` skills treeSha, caused by **another task's** `skills/**` edits (see below) | `raw/gates/6-qa-self-tests.log`, `raw/gates/6b-qa-self-tests-individual.log` |
| lane `team-watchdog-heartbeat` | 13 checks, **1 failed: H5 only** — its assertion is now factually obsolete (see handover) | `raw/lane-heartbeat.out` |

**The `test:qa` failure, attributed.** `agent-teams-messaging.mjs --self-test` refuses because the
`VENDOR_LOCK.json` skills corpus is stale (`lock=317/5aec4b643065 tree=317/3c0c2bdf5418`) — the
single-skills-writer re-pin (AGENTS.md §9/§11) owed for `M skills/dsh-qa/SKILL.md` and
`M skills/dsh-qa/scripts/team-watchdog-boot.mjs`, both edited by OTHER tasks in this wave. t84 touched
no `skills/**` and `VENDOR_LOCK.json` is outside its inScope; every other self-test passes.

**The 2 in-repo failures, attributed.** `packages/mpd-config-plugin/test/settings-wiring.test.ts`
asserts `existsSync(join(process.cwd(), ".mpd", "mpd.jsonc")) === false` and derives a zero-root base
from the same path. This workspace now **has** `.mpd/mpd.jsonc` (the captain's temporary
`warnSilenceMs: 900000` file, written to stop this very false positive), so both fail. Proof:
`raw/gates/2c-mpd-config-attribution.log` — the file alone is **21/2** run from the repo and **23/0**
run from a clean cwd, and the whole suite is **732/0** from a clean cwd. Neither the package nor the
test is touched by t84.

## 5. The defect is STILL LIVE in this process (read from the store, read-only)

The host process loaded the watchdog module at boot, and ESM caches it (AGENTS.md §12), so the
running process still runs the PRE-FIX bytes — and it reproduced the defect once more while this
repair was being written. Read-only from `.mpd/team/watchdog/incidents.jsonl` (the host's own writer,
not this task's):

```
{"id":"t85@a3483d21-…#1789525076037","teamId":"mpd-default","kind":"warn","cause":{"kind":"silence","ms":118050},"hold":"not-requested"}
{"id":"t85@a3483d21-…#1789525091037","teamId":"mpd-default","kind":"escalate","cause":{"kind":"silence","ms":133050},"hold":"applied","scene":"…/scene/mpd-default/20260916T021811Z-escalate.json"}
{"id":"t83@20370222-…#never-started#1789525136074","teamId":"mpd-default","kind":"never-started","scene":null,"hold":"not-requested"}
```

That is the second hold of this team today (the first is the one in the task brief), on a member that
was working, not wedged. **Consequence, stated plainly:** the fix takes effect on the NEXT `dsh`
restart, not before — no claim is made that the user's running host behaves differently until then.
The workspace's own knob override cannot help either: the settings bridge derived its base at mount
time, so the captain's temporary `warnSilenceMs: 900000` in `.mpd/mpd.jsonc` is not in that process's
namespace yet.

## 6. What the captain must record (outside this task's inScope)

1. `skills/dsh-qa/scripts/team-watchdog-heartbeat.mjs:124` — H5 still asserts
   `!dist.includes("tools/pre-execute")`. The watchdog dist **inlines** the adapter, so r6 makes that
   byte present by design. Replacement: `dist.includes("tools/pre-execute") && dist.includes("tools/post-execute")`,
   with the H5 detail text restated as “the built bytes expose an OBSERVE-ONLY pre hook **and** the POST
   hook” (the observe-only property is not a byte-scan property; it is proven by the adapter test and
   `raw/observe-only-real-call.mjs`).
2. The ledger `.mpd/plans/team-watchdog-report.md`: the AC-2 cell (“The pre-dispatch stamp is
   explicitly NOT claimed (W-9)”) and the NOT-CLAIMED bullet (line 102, “**No pre-dispatch tool
   stamp** …”) are now false; the exact replacement wording is in `harness.json →
   handover_out_of_scope`.
3. `AGENTS.md` — a troubleshooting row for this failure mode; the exact row text is in
   `harness.json → handover_out_of_scope`.
4. `packages/mpd-config-plugin` — `watchdog.toolInFlightMaxMs` is readable through the namespace and
   the row config but is **not** in `SETTINGS_KNOBS`/the Web card `FIELDS`, so the two front doors do
   not render it yet (same status the other five knobs had before that declaration landed). Another
   package's file.

## 7. Not claimed

* No live `dsh` host and no model turn: the long command is a genuine child process dispatched through
  the real cordis waterfall and the real adapter, but the surrounding **tool registry** is modelled on
  the dispatch order measured in `dsh-tools` (gate → body → post-execute).
* The THROW/CANCEL lifecycle rests on the installed harness **source** (`dsh-tools/lib/index.js:3203-3207`),
  not on a live host. The fixture proves the “POST clears it” half (including an `isError` result) and
  the “no POST” half (the bound).
* The 15-minute default is a chosen bound, not a measured optimum. `0` disables the rule.
* W-3 stands: no genuine provider wedge is reproduced anywhere in this evidence.
