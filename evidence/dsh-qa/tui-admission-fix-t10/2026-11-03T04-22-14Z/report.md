# T10 — the stale `tui-admission` self-test expectation (pre-existing PR #91 red)

**Status:** fixed, verified red-first → green-after with a two-sided control. HEAD `d2032bf3` + working tree,
no git writes.

## 1. The red, and where it came from

`bun skills/dsh-qa/scripts/tui-admission.ts --self-test` exited **1** on the current tree:

```
FAIL: 1 check(s)
  - the shipped manifest must declare the four intercept permissions the grant arms feed: []
```

Provenance (no line number is a claim — these are the symbols and the commit):
- The check lived in `skills/dsh-qa/scripts/tui-admission.ts` → `selfTest()`, asserting
  `manifestGrantRows().length === 4`.
- `dsh-plugin.json` now declares **`"permissions": []`** — deliberately. Commit **`776ac355`**
  (`feat(tui): reach dsh-TUI admission - a real negotiation now returns compatible`) flipped it, and its
  own `x-mpd-tui.decisionEvents` note records the measurement: with the four `session.*.intercept`
  permissions the host answered `waiting_authorization / PERMISSION_NOT_GRANTED` and kept attributing the
  bundle as undeclared, while the minimal declaration answers `compatible`. The manifest is right; the
  self-test kept the PRE-decision expectation.
- `776ac355` is an ancestor of HEAD (2026-11-03 09:48 +0800), i.e. it arrived with PR #91 — hence a
  "pre-existing PR #91 red", not a regression from this wave.

## 2. The fix (one file, `skills/dsh-qa/scripts/tui-admission.ts`)

| symbol | change |
|---|---|
| `grantsOfManifest` | NEW: one projection of a decoded manifest's `permissions` block into `{name, scope}` rows. `manifestGrantRows` and the negative control now go through the SAME parser, so the control can prove the shipped read still sees a declaration. |
| `selfTest` — manifest arm | now pins the CURRENT decision: `grantRows.length === 0` ("the shipped manifest must declare NO intercept permission (the seam is inactive by design)"). |
| `selfTest` — negative control | a `structuredClone` of the manifest with ONE `session.input.intercept` row re-declared must reach the projection (`length === grantRows.length + 1`). Falsifiable in both directions: it reddens if the manifest regrows a permission AND if the projection goes deaf. |
| `selfTest` — writer fixture | the grant-file writer's document shape and the `tui/<point>` scope vocabulary are now proven on declared FIXTURE rows (`writerRows`) instead of the manifest's (empty) set, because the old scope assertion became vacuous once the permissions were removed. |

No other assertion moved; no other file was touched.

## 3. Verification

| command | observed | log |
|---|---|---|
| HEAD's script (extracted with `git show HEAD:…`, run in a `mktemp -d` copy against the CURRENT manifest) | `FAIL: 1 check(s) … the four intercept permissions …: []`, **exit 1** | `red-first.log` |
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided`, **exit 0** | `green-after.log` |
| the SAME fixed script + a scratch manifest with ONE permission re-declared | `FAIL … must declare NO intercept permission (the seam is inactive by design): [{"name":"session.input.intercept",…}]`, **exit 1** | `negative-control.log` |
| `bun run test:qa` (every QA self-test) | `[test:qa] all self-tests passed`, **exit 0** (line 201–202: tui-admission ok) | `test-qa.log` |
| `bun run typecheck` (`tsgo --noEmit`) | no output, **exit 0** | quoted in the report to the Lead |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS`, **exit 0** | quoted in the report to the Lead |

## 4. The captain's step this edit creates (reported, NOT taken)

`skills/**` is the vendored corpus: this edit invalidates the corpus `treeSha` in `VENDOR_LOCK.json`.
`node scripts/verify-vendor.ts` now prints `FAIL - asset skills treeSha mismatch` and exits 1 — every other
asset is OK (`vendor-pending-repin.log`). Per AGENTS.md §9 and contract R3 that file is the integration
lane's, so this lane did **not** edit it: the captain must run the wave's SINGLE
`node scripts/repin-vendor.ts --write --i-know-this-is-the-captain's-step` in the same commit as this
change. `git status --porcelain skills/` was clean before the edit, so this lane is the wave's only
`skills/**` writer.

## 5. Evidence paths

```
evidence/dsh-qa/tui-admission-fix-t10/2026-11-03T04-22-14Z/
  red-first.log  green-after.log  negative-control.log  test-qa.log  vendor-pending-repin.log
  report.md      (this file)
```
