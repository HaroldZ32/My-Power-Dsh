# mpd-verify-plugin
**English** | [中文](./README.zh-CN.md)

The **verification law**, as a plugin row. Code written by **A** is verified by a **different** agent
**B**, where B works from the frozen contract and the documentation — never from the implementation —
records its verdict **before** reading any implementation, and a **FAIL** bounces the work back to a
writer as a repair task.

The law is mechanical, not aspirational, and it is enforced in two places: a **tool guard** (defence in
depth, installed by the `mpd-roles` row) and a **record validator** (the actual guarantee, this package).

## What it is

| piece | where | what it does |
| --- | --- | --- |
| the ledger | `<workspace>/.mpd/verify/` | loops, records, evidence, seats, repairs and the append-only escape log |
| the runtime | the `mpdVerify` service | the observation log, the escape allowances and the counted diagnosis reads |
| the tools | this row | `mpd_verify_open` / `_escape` / `_seat` / `_evidence` / `_record` |
| the guard | `mpd-roles-plugin/src/verify-guard.ts` | refuses a top-level agent's code write, and confines a verifier seat |
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
  cites, at least one gate, and a provably blind basis; a **FAIL** needs findings, each with the
  `doc_source` that proves it, and it opens a repair task and unlocks diagnosis reading. **Blindness is
  judged from the observation log, not from the unlock flag**: a seat that has recorded a FAIL may still
  record the PASS when its log shows no ADMITTED implementation read, and is refused `blind-spent` —
  naming the path — when it does. Only an admitted read spends the basis; a read the envelope REFUSED
  does not, which is what keeps "prove the band refuses `src/**`" from spending the very basis the PASS
  needs.

## The two guards

The captain rule gates `write`, `edit`, `mpd_hashline_edit`, `mcp__ast_grep__rewrite` and
`mcp__ast_grep__scan` for the workspace's **top-level** mpd agent. A path is **always writable** without
any loop when it is `*.md`, `LICENSE*`, or under `.mpd/`, `docs/`, `evidence/` or `agent-references/` —
the manual, the PR body and the verification records must never be gated. Everything else is **code**
(fail-closed: an unrecognised extension is code, and so is an absolute path outside the workspace).

A code write is allowed only through an armed loop, a counted escape, or a delegation. A **child session**
(a member, a subagent, a workflow worker, a ralph round) is never the captain: that is where the writes
are supposed to go.

The SAME install also makes AGENTS.md §5's **one-git-writer rule** mechanical: a session that is not the
workspace's top-level captain may not run a git WRITE command (`commit`, `add`, `rm`, `mv`, `checkout`,
`switch`, `restore`, `reset`, `stash`, `merge`, `branch`, `rebase`, `tag`, `cherry-pick`, `revert`,
`clean`, `apply`, `am`, `update-index`, `worktree`, `init`, `clone`, `push`, `fetch`, `pull`, `reflog`).
Read-only git (`status`, `log`, `diff`, `show`, `grep`, `ls-files`, `rev-parse`, `merge-base`,
`describe`, `blame`, …) stays open to everyone, and a command that merely MENTIONS git — a commit-message
heredoc, an `echo "git commit"`, a `grep` for the string — is not denied. **Honest bound**: the matcher
reads a command STRING, so an obfuscated invocation (`g"it" commit`, `sh -c "$X"`) can evade it. It is a
speed bump that makes the rule real for ordinary use, never a sandbox.

The verifier envelope denies the shell, the source-returning tools and every board mutation outright,
confines writes to `.mpd/verify/**`, and confines `read`/`glob`/`grep` to the frozen docs, `.mpd/plans/`,
`docs/`, `agent-references/` and `.mpd/verify/` while the seat is blind. A recorded **FAIL** unlocks
implementation reading for diagnosis, **counted**.

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
not move for this row): `verify.mode` (`hard` default | `advisory` | `off`), `verify.escapeUses` (default
1), `verify.loopTtlMs` (default 24h), `verify.gateTimeoutMs` (default 15min), and `verify.dir`.

## Bounds (declared, not implied)

1. A composition without the harness's `tools.guard` seam degrades to **bookkeeping only**, and the boot
   line says `verifyGate=absent` rather than implying an enforcement that is not there.
2. A plugin that raises delegates through its own private path is not auto-armed — the captain's writes
   stay denied.
3. A gate's `tail` may print source frames: it is **controlled black-box evidence**, not a proof of
   reading nothing. Blindness is proven by the plugin's own observation log.
4. The captain may still write code through the counted escape or a self-writer loop. Both are logged and
   counted, which is the whole point of calling them counted.
5. `.mpd/**` is always writable, so code-shaped content could be hidden there — bounded because `.mpd/`
   is gitignored runtime state and cannot ship.
6. **The observation log is per-process.** It lives in memory, while a seat's `unlocked` flag is durable;
   so a read performed in an EARLIER process cannot bar a later PASS. The rule above is exactly
   process-scoped, and this bound is written into the law's own source text rather than implied.
7. **A bound verifier may read `evidence/**` and every `packages/*/README.md` (and its `.zh-CN` twin)**
   while it is blind — both were refused before, which left a verdict resting on artifact
   existence/size/sha256 instead of their content. The band still refuses `packages/*/src/**`,
   `packages/*/test/**` and any `..`-carrying spelling. An `evidence/**` artifact may EMBED source frames
   (a gate log tail), so reading one is **controlled black-box evidence**, which bound 3 already states.
