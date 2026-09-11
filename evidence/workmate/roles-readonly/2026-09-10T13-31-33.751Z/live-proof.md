# t5 live proof + vendor-lock refresh (final)

## 1. Live read-only spawn, fresh process, no provider credential
`node skills/dsh-qa/scripts/readonly-deny.mjs` -> PASS (exit 0), evidence/workmate/roles-readonly/2026-09-10T13-31-33.751Z/case-result.json

Method: a local OpenAI-shaped stub answers the PARENT model step with exactly one `mpd_role_spawn`
call, so the child-composition path really runs in a FRESH dsh process (throwaway key, isolated
DSH_HOME, sandbox HOME). The shared adapter is instrumented in a sandbox copy, so the restriction
handed to the harness is recorded.

Raw result:
  filter sent to the harness: {"deny":["write","edit","mpd_hashline_edit","bash",
                              "mcp__ast_grep__rewrite","mcp__ast_grep__scan","mcp__lsp__rename"]}
  stub trace: call#1 hasTools=true (110690 B)  <- the parent's request, tools visible
              call#2 hasTools=false  (6942 B)   <- the CHILD's own model request
              call#3, call#4 hasTools=true      <- parent continues after the tool result
  child created and answered: true
  unknown-tool refusal: false
  exit code: 0

Why this settles the criterion WITHOUT any inference from an error class: the child's answering turn is
observed directly (its own request and the answer are in the raw output). A rejection inside
`tools.restrict()` happens during the child's setup and would leave NO child at all, so a created,
answering child cannot coexist with a refused list. No credential error is used as evidence anywhere in
this proof, and the credential error class proves nothing about the deny list (authentication precedes
composition; measured both ways).

The evidence dir predates no lock state: the case writes under `evidence/`, which is outside the
vendored `skills/` corpus, so running it cannot move the skills fingerprint.

## 2. Vendor gate: `skills` fingerprint refreshed with the gate's own algorithm
`node scripts/verify-vendor.mjs` -> PASS (commit/version/stats OK, all eight assets OK)

  fileCount: 364 (unchanged)
  treeSha  : ded0b340f2d898b862a5447cdb7edae22fe0d1acfbb975180279c20ec4367aab  (was 81620614...)

Cause, owned: my early refresh made the gate green, then I edited two tracked skills files
(`skills/dsh-qa/scripts/readonly-deny.mjs` case header, `skills/dsh-qa/SKILL.md` case-table row)
without re-fingerprinting. The tree currently carries 8 changed/untracked files under `skills/`, so the
old lock predated the whole current content of that tree.

METHOD NOTE, because my first two attempts produced WRONG hashes that the gate rejected:
the gate hashes each file under the relative path `f.slice(dir.length + 1)` where `dir` is the
ABSOLUTE `skills` path. Re-implementing the algorithm from memory and slicing by the literal length of
`"skills"` yields a different, wrong digest (81620614..., e51fb02a...). The value above was produced by
extracting `readBytes` and `listFiles` VERBATIM from `scripts/verify-vendor.mjs` and running them, so
there is no re-implementation gap, and the gate accepts it (PASS).

## 3. Declared verify commands on these bytes
  bun test packages/mpd-roles-plugin/test -> 11 pass / 0 fail / 140 expect calls
  bun run test:qa                        -> [test:qa] all self-tests passed (exit 0)
  bun run typecheck                      -> exit 0

## 4. Probe hardening in the same change
The case no longer strips the mpd-workmate row from the sandbox profile (that workaround existed while a
sibling defect aborted the plugin tree, and it would have let this probe pass while the boot was dying).
It now runs the profile UNMODIFIED and fails if the row is absent, so a tree-aborting regression in that
package cannot hide here again.
