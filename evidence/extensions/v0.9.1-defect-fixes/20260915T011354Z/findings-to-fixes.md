# v0.9.1 — every previously recorded finding, fixed and re-measured

**Scope.** The seven findings the v0.9.0 adversarial review recorded with `file:line` (t6: F1–F7),
the one prose item t7 left in a terminal task record, and the single defect recorded as a *known gap*
after that wave: a pooled write task being handed to a read-only team member.

**Method.** Every fix carries a test that was run against the PRE-FIX tree first
(`red-before-run.sh`, a detached worktree at `d6a6f59` with only the post-fix test files copied in)
and then against the fixed tree. The measured reds and greens are in `raw/`; `result.json` is the
machine-readable ledger.

| Id | Defect (pre-fix) | Fix | Red → Green |
|---|---|---|---|
| **F3** | a failed skill enumeration returned an ARRAY; the harness reads that as `{candidates:[], complete:true}` and CACHES it per `(cwd, scope, revision)`, so one transient failure hid a provider's skills until a restart | `emit()`/`list()` return `{candidates: [], complete: false}` on an enumeration failure; a per-candidate data problem stays `complete:true` (it is permanent until the files change) | `red-ext-core.log` (expected complete:false, got `[]`) → `green-ext-plugin.log` |
| **F4** | skill-name collisions were never recorded: the project provider had no `onSkip`, the view had no cross-extension skill annotation, and a collision with a NON-extension provider (the corpus) was invisible — so `mpd_ext_list` claimed skills the harness does not serve | (a) the project provider records its skips keyed by `(workspace dir, candidate name)` and `snapshot()` attributes them to the owning entry; (b) `annotateSkillSurfaces` notes an extension-vs-extension collision on the LOSER with the winner and both ranks; (c) both tools read the harness's own catalog (`dsh.listSkills`) and report each claim as `served`/`notServed` inside a `checked`/`reason` envelope | 3 red tests in `red-ext-core.log` → green |
| **F1** | an unsupported or lossy `outputSchema` dropped the WHOLE TOOL, where the harness drops only the schema (`supportedOutputSchema`) | the tool is kept and registered WITHOUT `structuredContent`; the reason is recorded as a per-tool note and the server's line says `N downgraded`. Only an unprojectable `inputSchema` still skips its tool | `red-ext-mcp.log` (`["mcp__fixture__good"]`) → green |
| **F2** | a non-object-rooted foreign `inputSchema` was passed through as `parameters`, so the tool's arguments could not be described at all | `objectRootedSchema()` wraps a non-object root into an object carrying the payload under a single `value` property (the author's annotations stay on the payload), validates the result against the harness subset, and records the downgrade | `red-ext-mcp.log` → green |
| **F5** | `cwdOf(listOptions) ?? dsh.workspaceRoot()` reached `DSH_WORKSPACE_ROOT` and then `process.cwd()`: the project plane could serve another project's extensions, and the apply-time shadow guard could HIDE a host-wide extension because of a workspace the caller never named | the project plane requires the caller's cwd (no fallback: an unknown cwd means "this caller has no project plane"); the apply-time shadow guard is SKIPPED when no workspace is named, because a guess can only hide live content | 2 red tests in `red-ext-core.log` → green |
| **F6** | `mpd_ext_show` echoed the raw descriptor, including author-declared MCP `env` VALUES — where an API key lives — into the session log and the model's context | `redactedDescriptor()` masks every env value as `<redacted>`; the KEYS stay visible, because they are the interface | `red-ext-core.log` (the value appeared verbatim) → green |
| **F7** | the whole-view claim maps knew only the DESCRIPTOR `enabled` flag, so a CONFIG-disabled extension still claimed its role/skill names and a later claimant was reported refused although the roster exposes it | `registry.view()` takes the caller's EFFECTIVE enabled predicate and passes it to both annotations (`annotateRoleSurfaces`, `annotateSkillSurfaces`); the disabled note now names the kind of disable, and notes are re-derived by reason prefix so they cannot accumulate | `red-ext-core.log` → green |
| **POOL-TOOLDENY** | the scheduler's pool branch had no capability test, so a read-only member (the roster's read-only roles carry the seven write-capable names in `toolDeny`) received a pooled `implementation`/`repair` task it could not execute — measured twice, on the read-only Architect and Reviewer | new regions `mpd-delta pool-capability-guard` (ADDITIVE) + `mpd-delta pool-capability-select` (**REPLACEMENT-shaped**, like D13/D14): the member's OWN task still dispatches (loudly when its `toolDeny` blocks it), a pooled task it cannot run stays IN THE POOL, and the withholding is logged once per (team, member, reason) | `red-pool-capability.log` (0 pass / 7 fail: the function does not exist pre-fix) → green |
| **T7-F3** | a terminal task record's objective says "five tools" while the binding line, plan §1.5 and the frozen contract say four | recorded, not amended (the task is terminal and immutable); re-checked that NO human-facing doc claims five — `docs/extensions.md:400` and its zh pair already state four shipped and the fifth (`mpd_ext_reload`) cut | grep over `README.md`, `docs/*.md` (EN + zh) and `packages/*/README*.md` |

## What made the red measurement trustworthy

The first RED attempt was thrown away. Running `bun test <relative path>` from inside the worktree
resolved the same test file twice — once from the worktree (pre-fix) and once from the main checkout
(fixed) — and reported `Ran 90 tests across 2 files` for a single-file argument, mixing the two
trees into one verdict. The driver therefore passes an ABSOLUTE path together with
`bun test --cwd <worktree>`, which loads exactly one file from exactly one tree.

The same class of trap is worth remembering for any future red-before run in this repo.

## Gates after the fixes (all from this directory's `raw/`)

`bun test packages/mpd-ext-plugin` 66/0 · `bun test packages/mpd-agent-teams-plugin` 220/0 ·
`bun test packages` 510/0 (106 files) · `bun run typecheck` 0 · `verify-vendor` 0 ·
`bun run test:qa` 0 · `verify-rows-parity` 0 · `mpd-ext.mjs --self-test` 19 checks + `validate`
exit 0 · `patch-agent-teams-fixes --check` 48 regions / 9 files · `install-profile --dry-run` 0 ·
**mount gate** `extension-lifecycle.mjs --no-skip`: all four tools offered AND called on a real
mounted boot in isolation, failure + isolation arms green, packed arm GREEN (owner t11).

## Deliberately NOT changed

- `packages/mpd-mcp-shared` ships no README — not a defect: the directory has no `package.json` and
  is not a workspace member (it is the shared binary-resolver module, documented by the MCP packages
  that consume it and by `AGENTS.md` §12).
- The host-limited verifications carried over from v0.9.0 (pnpm-path packed install,
  `bun run test:qa:all`, Web GUI, cross-platform) remain unverified on this host; this wave does not
  change them.
