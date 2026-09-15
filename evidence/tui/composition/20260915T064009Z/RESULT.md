# t24 — manifest identity pair made self-consistent (result)

Finding `T13-IDENTITY-1`, kind `repair`, Deep Worker attempt 2 (`9ebd0725-…`).
Digest **824b74f8a4f88e5b6e71200f9cc4b76183a91c446271cdc2122275503b7870db → 84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9**.
`raw/dsh-plugin.diff` is 29 lines and changes exactly **three fields**: `name`, the `x-mpd-tui-surfaces.note`, and `x-mpd-tui-surfaces.identityDeviation`.

## The fix

The manifest lives at the root of the **`@mpd-dsh/mpd`** package, and the admission path resolves a
row's specifier (`@mpd-dsh/mpd/packages/mpd-tui-plugin/dist/index.js`) to the package that carries
it — so the manifest's self-description must be that package:

| Field | before | after |
|---|---|---|
| `name` | `@mpd-dsh/mpd-tui` (a real package, but at **0.1.0**) | **`@mpd-dsh/mpd`** (the carrier package) |
| `version` | `0.9.1` | `0.9.1` (unchanged — it is the carrier's version) |
| `id` | `com.mpd-dsh.mpd-tui` | **unchanged** — the authorization key grant rows are keyed to |

Before: the pair reconstructed `@mpd-dsh/mpd-tui@0.9.1`, a version that exists nowhere.
After: `@mpd-dsh/mpd@0.9.1`, the package whose tree holds the file. The `x-` note now says the
manifest self-describes as the carrier *because the admission path resolves a row's specifier to the
package that carries it*, and names **`@mpd-dsh/mpd-tui` 0.1.0 (from its own `package.json`)** as the
package that implements the single host facet — so the user's naming decision (D4) stays visible.

## Acceptance

1. **Name + version describe the same package — PASS.** `manifest-check.json.identityPair`:
   `nameVersionEqualCarrier: true` (`@mpd-dsh/mpd@0.9.1` == the root `package.json`),
   `noPairReconstructsAMissingVersion: true`, and the diagnostic
   `nameVersionEqualImplementingPackage: false` (deliberate — the manifest must not name the
   implementer).
2. **`id` unchanged — PASS.** `idUnchanged: true`; `com.mpd-dsh.mpd-tui` still the key the grant-row
   text and the `x-` note cite.
3. **The disclosure names the implementing package — PASS.**
   `noteNamesImplementingPackage: true` (`@mpd-dsh/mpd-tui` + `0.1.0` both present) and
   `noteExplainsWhyTheCarrierIsNamed: true`; the deviation note keeps its full wording and now says
   "the TUI edition's own package identity is @mpd-dsh/mpd-tui (0.1.0)" next to the statement that
   the bundle-level manifest's own name/version describe the carrier package.
4. **No declaration changes — PASS.** `permissionsUnchanged`, `contractsUnchanged`,
   `contributionsUnchanged`, `subscriptionsUnchanged`, `optionalFallbackUnchanged` all true;
   `changedTopLevelKeys == ["name", "x-mpd-tui-surfaces"]` and
   `onlyIdentityAndDisclosureMoved: true`. The t22 disclosure content is re-asserted in the same run
   (`t22DisclosureStillHolds.measuredChain` + `.unblock` both true), so nothing regressed.
5. **New digest recorded; superseded-digest files ANNOTATED, never rewritten; static lane re-run —
   PASS.** New digest in `raw/dsh-plugin.json.after.sha256`; chain updated (4 links) in
   `evidence/tui/composition/20260915T053445Z/raw/manifest-digest-chain.json`; every evidence file in
   this wave's composition tree that cites `7701c48c…`/`824b74f8…` has an added
   `T24-DIGEST-ANNOTATION.md` beside it (8 directories) stating the revision it was measured at and
   pointing here. Static admission re-run on the new revision: `raw/admission-static.json` →
   `parse ok`, `validatePlugin ok`, negotiation `waiting_authorization` with the same four denied
   permissions, `specDataResolved: true`.
6. **Evidence: before/after diff + structure output + final digest — PASS.**
   `raw/dsh-plugin.diff`, `raw/verify.log` (both contract commands), `raw/manifest-check.{json,stdout}`,
   `raw/dsh-plugin.json.{before,after}` + `.after.sha256`. No `packages/`, `scripts/` or `skills/` path
   was touched.

## Verify commands (contract order)

| Command | Result |
|---|---|
| `bun run typecheck` | exit 0 (`raw/verify.log`) |
| `node -e "…console.log('manifest structure ok, name='+m.name+' version='+m.version+' id='+m.id)"` | exit 0 → `manifest structure ok, name=@mpd-dsh/mpd version=0.9.1 id=com.mpd-dsh.mpd-tui` |

## Caveats recorded (not silently omitted)

- `evidence/tui/lanes/**` (t7/t8/t9's lane output) records the superseded digest `824b74f8…` and is
  **outside this task's inScope**, so it was NOT annotated here. Those lanes are verification work
  that re-measures: t8 is in progress and t9 is claimed, so they should re-run against
  `84ed4a5d…`; if any of their recorded results are to stand, they need their own annotation.
- No live `/plugins check` run was made for this pass: `name` maps only to the projection's
  `displayName` (the Architect's measurement on the ticket), the static parse → project →
  `validatePlugin` → `negotiate` path is green on the new digest, and the live lanes belong to
  t8/t9. The manifest is otherwise frozen for them now.
- `packages/mpd-tui-plugin/**` was not touched (t21's file); the plugin's own `package.json`
  (`@mpd-dsh/mpd-tui` 0.1.0) was READ only, to name it in the disclosure.
