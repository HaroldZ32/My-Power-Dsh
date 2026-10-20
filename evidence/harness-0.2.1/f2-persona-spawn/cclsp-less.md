# The cclsp-less deny hole (CWE-284) — re-derived independently on `6e460bc1`

Tree verified: `git rev-parse HEAD` = `6e460bc1515b9d0c7b0538251f373268ea447372` (branch clean apart from
this lane's `evidence/**`). Instrument: `spawn-probe.ts --no-lsp`, which writes a QA overlay
(`- id: mcp-lsp` / `disabled: true`) into its own sandbox — a QA patch, never a shipped one — so the two
`mcp__lsp__*` names cannot resolve and the host's WHOLE-LIST validation is exercised. Children are found
by `subagent/descriptor`; header tools are read as `entry.name`; the persona is asserted on the child's
`system/message`.

## The condition (measured, not assumed)

The parent/control session's `request/header` on every run below: `lspTools: []` (no `mcp__lsp__*`
name is resolvable), 96 tools total. That is the exact condition under which the eight-name deny used to
be rejected whole.

## The measurements

| Arm (cclsp-less) | child first header | write-capable present | row-log line |
|---|---|---|---|
| roster **Explorer** (read-only) | **85 tools** | **none** | `[mpd-roles] read-only child: applied 6 denials to its own tool scope (pruned as unknown in this composition: mcp__lsp__rename_symbol, mcp__lsp__rename_symbol_strict)` |
| **workmate** Explorer (read-only) | **85 tools** | **none** | `[mpd-workmate] read-only workmate child: applied 6 denials to its own tool scope (pruned as unknown in this composition: mcp__lsp__rename_symbol, mcp__lsp__rename_symbol_strict)` |
| roster **Junior Engineer** (writable control) | **91 tools** | `write`, `edit`, `bash`, `mpd_hashline_edit` | no deny line |

**Arithmetic: 91 − 85 = 6** — exactly the six denials the host could apply (the eight minus the two
`mcp__lsp__*` names the host reported as unknown). Without the retry the child would sit at 91 with the
writers intact; with a broken retry it would sit at 85 with nothing denied. The count is what makes this
discriminating rather than "something got restricted".

## The fix's failure modes (checked, not the happy path)

Source: `restrictAgentToolsRetained` (`packages/mpd-dsh-adapter-plugin/src/index.ts`) — prunes ONLY the
names the host reports as unknown, exactly ONCE; THROWS for a non-unknown rejection, for a rejected retry,
and when pruning would empty the list; NEVER calls the returned disposer.

- **non-unknown rejection stays LOUD**: the throw reaches three call sites that log
  `… the deny could NOT be applied (<reason>) — this member may be able to write`
  (`mpd-roles` line 688, `mpd-workmate` line 886, adapter warn line 2419). Unit arm:
  `a NON-unknown rejection THROWS instead of passing quietly` (`/the host exploded/`). I did **not**
  produce this line live (no way to force a non-unknown rejection through the harness) — code path + arm.
- **prune-to-empty THROWS**: `every name in the read-only deny was rejected as unknown, so nothing would
  be denied`, with `released === false` — no no-op restriction is left standing. Unit arm:
  `PRUNING EVERYTHING is a failure, never a silent success`.
- **a rejected retry THROWS** after exactly two attempts (`a REJECTED RETRY throws — pruning gets exactly
  one chance`).
- **RETAINED**: no disposer is invoked anywhere on this path (`applyScopedRestriction`'s return is
  dropped), and the restriction is applied to the CHILD's OWN scoped context
  (`scopeContextOf(agent).tools.restrict`), so its lifetime is the child's scope, not the spawn call's.
  Five unit arms assert `released === false`, including the seam-level
  `the seam's read-only branch prunes the dead names and the child ends up DENIED` (two calls: the
  rejected eight, then the accepted six).
- Suite: `bun test packages` → **2020 pass, 3 skip, 0 fail**; the seam file alone → 25 pass.

## What I could NOT construct (stated, with what would settle it)

The "restriction silently released after the first turn" experiment. Blockers, measured:
`mpd_role_spawn`'s result schema (`packages/mpd-roles-plugin/src/index.ts`, the `role`/`status`/`summary`/
`recommendation`/`details`/`evidence`/`stopReason` object) carries **no child session id**, so no caller
can address the continuable child afterwards; and a harness session records ONE `request/header` per turn,
so the store shows only the first assembly. What would settle it: (a) surface the child's `sessionId` in
the spawn result (or a harness follow-up-by-session seam), then (b) send a "call the write tool" follow-up
and read the second turn's header/tool result. Until then, retention is proven at CODE + UNIT level and at
the first assembly LIVE — not across turns.

## Verdict

**PASS on the cclsp-less claim**, with the bounds above. The defect is real, the fix addresses the actual
mechanism (whole-list validation) rather than the symptom, and the discriminating arithmetic holds on my
own runs, not only the author's.
