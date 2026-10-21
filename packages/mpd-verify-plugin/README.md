# mpd-verify-plugin
**English** | [中文](./README.zh-CN.md)

The **verification law**, as a plugin row. Code written by **A** is verified by a **different** agent
**B**, where B works from the frozen contract and the documentation — never from the implementation —
records its verdict **before** reading any implementation, and a **FAIL** bounces the work back to a
writer as a repair task.

The law's GUARANTEE is the **record validator** in this package (it refuses a PASS with no cited
documents, no gate evidence, a forged evidence id or a same-agent verifier — that never lived in a hook).
The **tool guard** that used to add defence in depth was **WITHDRAWN by the user's 2026-10-17 ruling**
(`.mpd/plans/harness-021-rollback.md`, R1): a top-level agent may write code again, and a bound verifier
seat keeps its envelope as PROSE rather than as a fence.

## What it is

| piece | where | what it does |
| --- | --- | --- |
| the ledger | `<workspace>/.mpd/verify/` | loops, records, evidence, seats, repairs and the append-only escape log |
| the runtime | the `mpdVerify` service | the escape allowances, the counted diagnosis reads and the delegation observer — its OBSERVATION LOG is written by the withdrawn guard, so no calls are observed any more (a bound seat therefore always reads `blind`) |
| the tools | this row | `mpd_verify_open` / `_escape` / `_seat` / `_evidence` / `_record` |
| the guard (WITHDRAWN 2026-10-17) | `mpd-roles-plugin/src/verify-guard.ts` | used to refuse a top-level agent's code write and confine a verifier seat; the module survives as a reference implementation and the `mpd-roles` row NO LONGER INSTALLS it |
| the boot marker | `<workspace>/.mpd/verify/boot.json` | closes the `pre-plugin` record exemption the moment the law is live |

## The five tools

- **`mpd_verify_open`** — open a delegation+verification loop. `writer:"self"` (the counted path, and it
  refuses without a `self_write_reason` plus a `verifier` that is a different agent) or
  `writer:"delegate"` (a member writes). An empty `scope` covers the whole workspace. An optional
  **`contract`** names the wave's own frozen contract (a workspace-relative path) and is RECORDED on the
  loop; when it is absent the loop keeps a declared default (`AGENTS.md`), never another wave's plan.
- **`mpd_verify_escape`** — the **counted** escape: one JSONL row, one boot-log line, one allowed write.
  It refuses an empty `reason`, and it grants nothing when the row cannot be written.
- **`mpd_verify_seat`** — bind the calling session as a loop's **verifier**. Idempotent; refused when the
  caller is the loop's writer. Its frozen documents are **the loop's own `contract`**, resolved by ONE
  function that the seat and the record both call, so a verdict's `docPaths` and its
  `basis.frozenContract` can never disagree about which document they verified against.
- **`mpd_verify_evidence`** — `kind:"gate"` runs ONE id from the fixed table (`gates`, `tests`,
  `typecheck`, `docs`, `manifest`, `comments`, `rows`, `vendor`, `dist`, `pack`) and writes its log;
  `kind:"probe"` reports `{path, exists, bytes, sha256, mtime}` per path and **never content**.
- **`mpd_verify_record`** — record the verdict through the validator. A **PASS** needs the documents it
  cites, at least one gate, and a basis that is not `unproven` — blindness is DECLARED, never observed,
  so an unproven basis is UNVERIFIED; the validator still refuses a PASS with no documents, a forged
  evidence id or a same-agent verifier. A **FAIL** needs findings, each with the `doc_source` that
  proves it, and it opens a repair task and unlocks diagnosis reading. `bind-unproven` still rejects a
  PASS whose basis is declared `unproven`, and `blind-spent` still names an admitted read, but no
  shipped composition writes the observation log, so `blind-spent` cannot be triggered by evidence —
  see the bounds for what that costs.

## The withdrawn guards (a record, not an install)

Both guards this package was designed around lived in ONE `tools.guard` install, and the user's
2026-10-17 ruling removed it (`.mpd/plans/harness-021-rollback.md`, R1). What follows is what they DID,
stated so that no line reads as enforced:

- **The captain's write gate** used to deny the top-level mpd agent's `write`, `edit`,
  `mpd_hashline_edit`, `mcp__ast_grep__rewrite` and `mcp__ast_grep__scan` on a CODE path, while `*.md`,
  `LICENSE*` and anything under `.mpd/`, `docs/`, `evidence/` or `agent-references/` stayed open so the
  manual, the PR body and the verification records could always be written. **Nothing refuses that write
  today** — the captain holds its whole pack, and the loop / counted-escape / delegation paths remain as
  BOOKKEEPING, not as the only way in.
- **The one-git-writer rule is PROSE now.** That same install used to DENY a non-captain session the git
  write commands; the matcher went with the hook, so the list below is the RULE this repository still
  binds itself to — `commit`, `add`, `rm`, `mv`, `checkout`, `switch`, `restore`, `reset`, `stash`,
  `merge`, `branch`, `rebase`, `tag`, `cherry-pick`, `revert`, `clean`, `apply`, `am`,
  `update-index`, `worktree`, `init`, `clone` (AGENTS.md §5 states the rule, its measured history and
  the withdrawal). Read-only git stays open to everyone. Its enforcement is the dispatch contract —
  members edit files and run gates, the captain commits — plus review, never a matcher.
- **The verifier envelope is PROSE too**: no shell, no source-returning tools and no board mutation (the
  `mpd_verify_*` tools excepted — those ARE the seat's job), reads scoped to the frozen docs and the
  documentation band while blind, writes confined to `.mpd/verify/**`, and a recorded FAIL unlocking
  implementation reading for DIAGNOSIS. `mpd_verify_seat` still RECORDS the seat and a verdict stays
  auditable, but nothing fences the seat and nothing OBSERVES its reads: the observation log was written
  by the withdrawn guard, so in every shipped composition the log is empty, every base reads `blind`, and
  the `blind-spent` refusal cannot be triggered by evidence. Treat an unproven basis as UNVERIFIED.

## The record

```jsonc
{ "version": 1, "recordId": "…", "loopId": "…", "taskId": null, "workspace": "…",
  "writerId": "…", "verifierId": "…",
  "basis": { "kind": "blind", "frozenContract": {"path":"…","sha256":"…"}, "docs": [], "probe": [] },
  "sources": [], "gateEvidence": [], "verdict": "PASS", "findings": [],
  "unlockedReads": [], "createdAt": "…" }
```

The validator's refusals each carry their own reason string: `same-agent`, `no-doc-sources`,
`no-gate-evidence`, `forged-evidence`, `bind-unproven`, `fail-without-findings`, `finding-without-basis`,
`blind-spent`, `unknown-loop`, `pre-plugin-unlocked`, `pre-plugin-unattested`, `post-install-claim`.

## Configuration

Read **raw** through the config service (never through the settings schema, whose pinned knob count must
not move for this row): `verify.mode` (`hard` default | `advisory` | `off` — INERT since the guard was
withdrawn: nothing denies a write any more, the value is only reported as `mode=` on the boot line),
`verify.escapeUses` (default 1), `verify.loopTtlMs` (default 24h), `verify.gateTimeoutMs` (default 15min),
and `verify.dir`.

## Bounds (declared, not implied)

1. In every shipped composition this row is **bookkeeping only**, because the guard is withdrawn: the
   `mpd-roles` boot line reports `verifyGate=absent reason=withdrawn:2026-10-17-user-ruling(verify.mode)`.
   A composition without the harness's `tools.guard` seam degrades the same way for its own reason.
   **THIS row's boot line reports the SEAM and says so on its face:** it prints
   `verifySeam=present|absent` plus the clause `(the harness tools.guard SEAM — NOT an installed gate: the
   write guard is WITHDRAWN; the mpd-roles row reports its own state)`, and it NEVER prints `verifyGate=`.
   The two rows measure two different things and print two different tokens on purpose — a mount lane that
   needs the guard's state reads `mpd-roles`, and a lane that reads only this line cannot mistake the seam
   for an install.
2. A plugin that raises delegates through its own private path gets no persona and no read-only deny
   applied by this bundle — that discipline is the plugin's own responsibility now. Nothing denies the
   CAPTAIN any write in either case.
3. A gate's `tail` may print source frames: it is **controlled black-box evidence**, not a proof of
   reading nothing. Blindness is NOT observed any more — the log that used to prove it was written by the
   withdrawn guard — so an unproven basis is UNVERIFIED, never established.
4. The captain may write a code path DIRECTLY (no loop, no escape): the counted escape and the
   self-writer loop remain available and stay logged and counted, which is the whole point of calling
   them counted — they are bookkeeping, not a gate.
5. `.mpd/**` is always writable, so code-shaped content could be hidden there — bounded because `.mpd/`
   is gitignored runtime state and cannot ship.
6. **The observation log is per-process, and now also inert.** It lived in memory while a seat's
   `unlocked` flag is durable, so a read in an EARLIER process could never bar a later PASS. With the
   guard withdrawn nothing writes the log at all, so this bound is history: every seat reads `blind` and
   no read is observed in any process.
7. **A bound verifier may read `evidence/**` and every `packages/*/README.md` (and its `.zh-CN` twin)**
   while it is blind — both were refused before, which left a verdict resting on artifact
   existence/size/sha256 instead of their content. The band still refuses `packages/*/src/**`,
   `packages/*/test/**` and any `..`-carrying spelling. An `evidence/**` artifact may EMBED source frames
   (a gate log tail), so reading one is **controlled black-box evidence**, which bound 3 already states.
