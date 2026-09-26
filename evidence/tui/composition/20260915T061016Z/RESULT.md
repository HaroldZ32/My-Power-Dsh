# t22 — disclosure-only repair of `dsh-plugin.json` (result)

Task `t22` (repair, Deep Worker), source task `t5`, finding `T5-DISCLOSURE-1`.
Scope: the manifest's admission disclosure text only (`dsh-plugin.json`,
`evidence/tui/composition/`). **No declaration changed.**

Manifests: **before** `sha256:31587972f69568d8a54fc38b2fb269541676ae10264abc3609cac898733157d1`,
**after** `sha256:7701c48c066c528046d361752ff72671cc1093340260e144f8390345248fe7a7`
(`raw/dsh-plugin.json.{before,after}` + their `.sha256` files, `raw/dsh-plugin.diff`).

## Acceptance

1. **The measured chain replaces the softer sentence — PASS.** The
   `x-mpd-tui-surfaces.decisionEvents` text now states: all four declared `session.*.intercept`
   permissions are registry `default: deny`; a Community v0.15 permission object has **no**
   `optional` flag; `negotiate()` therefore returns `waiting_authorization`
   (PERMISSION_NOT_GRANTED); `admitInternal` accepts only `compatible`/`compatible_degraded` and
   throws otherwise (`src/dsh-adapter/plugin-host.js:391-395`), so **no component identity is
   bound** and the host's effect ledger keeps attributing the bundle as `undeclared`.
   Machine-checked field by field in `raw/t22-structure-check.json` →
   `disclosureContent.{statesDenyDefault,statesWaitingAuthorization,statesNoIdentityBound,statesLedgerUndeclared}`
   = true.
2. **The concrete unblock is named — PASS.** The text names
   `<DATA_DIR>/extension-grants.json` (the host's own `~/.dsh-tui/extension-grants.json`) and a
   `"grants"` row keyed `com.mpd-dsh.mpd-tui` granting the four permissions at scopes
   `tui/input`, `tui/rewind-prompt`, `tui/session-switch`, `tui/compact`; it also names the second
   path (a host policy decision to default-allow first-party TUI bundles).
   `disclosureContent.namesGrantFileAndId` / `namesAllFourScopes` = true. The live host output it
   mirrors: `raw/final-plugins-check.pane.txt` — `授权方法：在 ~/.dsh-tui/extension-grants.json 的
   "grants" 段加入 "com.mpd-dsh.mpd-tui": [{ "name": "<权限>", "scope": "<范围>" }]`.
3. **No functional change — PASS.** `declarationIdentity` in `raw/t22-structure-check.json`:
   `identicalOutsideDisclosure`, `permissionsUnchanged`, `contractsUnchanged`,
   `contributionsUnchanged`, `subscriptionsUnchanged`, `optionalFallbackUnchanged` = all true, and
   the **only** changed top-level key is `x-mpd-tui-surfaces`.
4. **Structure intact — PASS.** `structure.missingRequiredKeys: []`, `idMatchesNamespacedId: true`,
   `hostFacetEntry: packages/mpd-tui-plugin/dist/index.js`, `forbidden: {provides: false,
   requiresServices: false}`; the pinned `@dsh-std/manifest` parser still accepts and projects it
   (`parser.pinnedParserAccepted: true`), and the x- key remains schema-permitted.
5. **Evidence/commands recorded — PASS.** `raw/verify-structure.log` (the contract's own
   `node -e` check → `manifest structure ok`, exit 0), `raw/verify-typecheck.log` (`bun run
   typecheck`, exit 0), `raw/dsh-plugin.diff` (before/after unified diff), and
   `raw/t22-structure-check.json` (the semantic-identity proof: the manifest remains semantically
   identical apart from the disclosure text).

## Extra verification performed (beyond the contract's two commands)

- Static host admission path re-run on the revised manifest: `raw/admission-static.json` —
  `parse: ok`, `validatePlugin: ok`, negotiation `waiting_authorization` with the same four denied
  permissions, digest `sha256:7701c48c…` (the driver validates the manifest it is pointed at, so the
  digest line is the after-state).
- Live re-check on the revised manifest: `raw/final-plugins-check.pane.txt` +
  `raw/tui-final-pane.log` — the host's own `/plugins check` prints the same
  `waiting_authorization (PERMISSION_NOT_GRANTED: …)` and the grant hint naming our id, i.e. the
  disclosure text now matches verbatim what the host prints.
- Forbidden claim wording absent (`disclosureContent.forbiddenWordingAbsent: true`, checked against
  the vendor list in `UPSTREAM-RESEARCH.md` §2).

## Superseded digest

The `t5` evidence directory `evidence/tui/composition/20260915T053445Z/` records the pre-repair
digest (`manifestSha256: sha256:31587972…`) in `ledger.json.revision`; that value is honest for the
revision t5 measured. This task appends
`evidence/tui/composition/20260915T053445Z/raw/t22-manifest-addendum.json` recording that the
manifest has since moved to `sha256:7701c48c…` by disclosure-only change, without rewriting any t5
result.
