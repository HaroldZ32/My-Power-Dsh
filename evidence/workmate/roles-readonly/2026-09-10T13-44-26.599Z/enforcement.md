# t13 — the case now asserts the child is RESTRICTED (t9 F1), F2 and F3

## F1 — enforcement asserted, measured, and falsifiable
The case no longer infers authority from adapter-side data. Every request in the stub trace is
classified by its own semantic signature, measured from raw request dumps:

    call#1  parent   87 tools  write-capable visible: all seven
    call#2  session-title side request, 0 tools (not the child)
    call#3  CHILD    81 tools  write-capable visible: NONE, and `structured_output` present

A child request is recognised as: has tools, exposes none of the seven write-capable names, and adds
the role's report schema as `structured_output`. That last marker is why the child is not simply a
subset of the parent (the child is the parent's set MINUS the six denied tools PLUS structured_output).

Assertions now shipped:
  * POSITIVE lane: at least one child request exists, the parent really shows all seven (otherwise "the
    child lacks them" would be vacuous), and EVERY child request exposes zero write-capable names.
    Raw: `enforcement: {"ok":true,"childRequests":1,"childToolCounts":[81],"parentToolCount":87,
    "childLeaksWriteCapable":[],"childHasStructuredOutput":true,"parentHasAllSeven":true}`
  * CONTROL lane (re-injected pre-fix names): the restriction SILENTLY stops applying — the child sees
    the full 87-tool set with no refusal — so ZERO requests match the restricted-child signature.
    Raw: `reinjectionControl: {"ok":true,"childRequestsUnderRestriction":0,"parentToolCount":87,
    "parentSeesWriteCapable":[all seven],"refusalSeen":false}`

Why this makes the positive assertion falsifiable rather than decorative: a restricted child is only
recognisable *because* it lacks the denied tools. Remove the restriction and the signature disappears,
which is precisely the silent-degradation route acceptance 4 exists to exclude. The control lane proves
that route on real data instead of hypothesising it.

Honest limit, stated so nobody over-reads it: the control lane demonstrates the degradation, and it
does so through the same signature the positive lane uses. A future edit that loosened the signature
would make the control lane find a match rather than pass silently, so the two lanes cannot both drift
green without the case failing.

## F2 — failure mode corrected in the case header
The header now states that the measured pre-fix mode in a fresh process is SILENT UN-GUARDING, not a
loud refusal, with both anchors: `@deepseek-ai/dsh-subagent` applies the filter only when
`composition.toolFilter` is defined (lib/index.js:711), and `@deepseek-ai/dsh-tools` throws only for
names outside `view(scope).restrictableNames` (lib/index.js:2804). A stale-but-known name overlaps that
set, so the restriction becomes partly inert with no error anywhere.

## F3 — canonical evidence path
All references to the superseded `evidence/fix/readonly-deny/` are gone from the case and its header;
the case writes to and cites `evidence/workmate/roles-readonly/<timestamp>/` (the declared path).

## Declared verify commands on the final bytes
| command | result |
|---|---|
| `bun test packages/mpd-roles-plugin/test` | 11 pass / 0 fail / 140 expect calls |
| `bun run test:qa` | `[test:qa] all self-tests passed` (exit 0) |
| `bun run typecheck` | exit 0 |

## Vendor gate — needs t10 (VENDOR_LOCK.json is outOfScope for t13)
Editing the case necessarily changes the vendored `skills` corpus, so `node scripts/verify-vendor.mjs`
is RED until the lock is refreshed. Correct values, computed with the gate's OWN helpers as the last
action (never hand-derived — the gate hashes under `f.slice(dir.length + 1)` with the absolute path):

    fileCount: 364   (unchanged)
    treeSha  : 2c11c7a9233182c9f22e74e013aef2a66b31fe1650852ac45f6c8c19c5fef280

This SUPERSEDES every earlier value cited in this delivery (including `ca9dfa77…` and the stale
`e51fb02a…` recorded in §Y2). t10 should apply this value, or re-run the gate and recompute if any
further `skills/` edit lands first.
