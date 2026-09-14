# t51 — the R1 QA case now asserts the SHIPPED path (F-1 root-cause fix)

## What was wrong

`skills/dsh-qa/scripts/agent-teams-messaging.mjs` (t36) imported `lib/state.js` and called
`appendMailboxDeduped` / `clearMailboxToWatermark` / `decideInterjection` **directly**. Every
assertion was green while the tool a user actually calls — `agent_teams_send_message` — still
appended a second durable record for a second identical send and woke the recipient again. The
library was correct and unreachable at the same time.

That class survived four layers of checks because every layer asked the same question ("does the
module behave?") and none asked the user-path question ("does anything ever CALL it?"):

| Layer | What it asked | Why F-1 passed |
|---|---|---|
| `r1-message-channel.test.mjs` | do the primitives behave? | yes — and the primitives were the subject |
| the t36 QA case | do the primitives behave in an isolated run? | same question, same answer |
| the plugin test suite | is the plugin green? | nothing exercised the send tool |
| the wave's gate list | do the commands exit 0? | a green primitive suite is a green command |

## What this change does

The case keeps the primitive lanes (cheap localisation of a regression) and adds **shipped-path
lanes** as the load-bearing evidence. They plant a real team record and drive the REAL tool
registrations against the REAL `installTeamScheduler`, counting deliveries on the member-queue seam
(`ctx.subagents.prompt`) that `deliverToMember` itself uses.

Measured on this revision (see `result.json` for every step, `output.log` for the run):

| Lane | Shipped path driven | Result |
|---|---|---|
| `shippedDedup` | `agent_teams_send_message` x3 identical → scheduler `kickMember` | **1** durable record, `dupCount=3`, `delivered: wake, duplicate, duplicate`, deliveries to the recipient ≤1 before/after the kick and still ≤1 after a second kick |
| `shippedDedupControl` | same content, **different sender** | NOT folded — 2 records (`dupCount` 3 and 1) |
| `preFixRedArm` | the SAME scenario against a **pre-fix** `tools.js` | **3** records, **3** deliveries to the recipient |
| `shippedInterjection` | `agent_teams_interject_request` → `interject_decide(list)` → pending silent → `decide(approved)` → `kickMember` | pending listed 1 / requester inbox 0 / deliveries 0; after approval exactly **1** delivery, to the REQUESTER (`session-t51-asker`) and **0** to the other member; the persisted queue row carries `summary`/`reason`/`location` |
| `shippedInterjectionRejectControl` | `interject_decide(rejected)` | status `rejected`, requester inbox 0, **0** deliveries |
| `shippedTtl` | aged request + `kickMember` | status `expired`; the EXPIRED notice is **really delivered** (1 delivery) and acknowledged (`readAt` set, unread 0); the still-inside-TTL request stays pending |
| `shippedClear` | `agent_teams_send_message` → `agent_teams_mailbox_clear` → `readUnreadMailbox` → `kickMember` | `unread_after: 0`, 2 tombstoned rows, 0 new deliveries, no record resurrects after the kick |
| `shippedClearAuthzControl` | a MEMBER clearing another mailbox | refused: `only the captain may clear another participant's mailbox` |

### The RED arm (proof the assertion is not tautological)

`preFixRedArm` reverts the three `mpd-delta` regions t49 added — back to the shape recorded in the
commit that introduced them — and runs the identical scenario. The pre-fix module is written to the
sandbox with the plugin's own runtime closure copied beside it, so it is a real module, not a
mock:

* pre-fix: **3 records / 3 deliveries to the recipient** (`raw/prefix-tools.js`, `raw/shipped-red-inbox/`)
* shipped: **1 record / `dupCount=3` / ≤1 delivery** (`raw/shipped-green-inbox/`)

The case's `--self-test` also fails if the shipped wiring regions disappear **or** if this script
stops referencing the tool surface, so neither half can silently regress.

## Isolation and load evidence

Isolated `DSH_HOME` + sandbox `HOME` + sandbox workspace; the `mpd-headless` profile and the
installed `mpd` preset are asserted, then the tree is really MOUNTED AND BOOTED in that home
(3/3 plugin boot lines, 0 apply/schema crash signatures) and `assertSessionsSandboxed` must see a
session key — a zero-key run would make it vacuous. `--dump-config` is never cited as load
evidence. The fixture imports the plugin modules from the checkout but points every state root at
the sandbox, so no real workspace state is touched.

## Gates

| Gate | Result |
|---|---|
| `node skills/dsh-qa/scripts/agent-teams-messaging.mjs --self-test` | exit 0 |
| `node skills/dsh-qa/scripts/agent-teams-messaging.mjs` | PASS — 18/18 steps |
| `node scripts/verify-vendor.mjs` | PASS (`skills` 331 files) |
| `bun run test:qa` | exit 0 (all self-tests, including this case) |

## VENDOR_LOCK re-pin (same commit)

`skills/**` changed, so the corpus pin moves with it (AGENTS.md §9/§11):

| | fileCount | treeSha |
|---|---|---|
| committed HEAD | 331 | `0a91194e36aca49c5cfad0c3274e59b3b390cff4642f03aa37da31f6ecea4baa` |
| this change | 331 | `c1f424fef1a283bcbfb1167fd05e18562bae50d4e0a897871596799642259e06` |

This is the wave's single `skills/**` writer and its single re-pin.

## Honest limits

* The scheduler is driven by calling `kickMember` directly — the same function the idle-edge
  listener calls. A genuine multi-member idle edge cannot be produced in isolated headless (the
  one-shot `dsh` disposes continuable members), so the idle-edge TRIGGER is not the subject here;
  the delivery path and its counting are.
* The pre-fix arm is a reverting reconstruction of the three recorded regions, not the historical
  file object — documented as such, with the specimens kept in `raw/prefix-tools.js`.
* The primitive lanes are still present and are still the weaker evidence; they are kept only
  because they localise a regression faster than the shipped lanes.
