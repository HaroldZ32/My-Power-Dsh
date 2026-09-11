# t15 — repair: new workmate agent tools rejected by the harness output validator

Task: t15 (repair, attempt 2) · findings source: t6's BLOCKER F1 · contract:
`.mpd/plans/workmate-rename-delete-contract.md` §C (tool surface) and §D (wire protocol).

## The defect

`mpd_workmate_rename` and `mpd_workmate_delete` returned `{ ok: true, … }` — the same shape as the
§D route bodies — while their declared `output.schema` listed every OTHER field and set
`additionalProperties: false` with `ok` absent. The harness tool runtime validates a tool's value
against its declared schema and throws `ToolOutputError` (`INVALID_TOOL_OUTPUT`) on any violation, so
every SUCCESSFUL call was rejected **after the mutation had already been applied**:

```
tool "mpd_workmate_rename" returned invalid output: "value.ok" is not a declared property (additionalProperties: false)
```

Archive delete and purge delete failed the same way. The HTTP routes bypass the tool runtime, which is
why the route matrix scored 59/59 while the agent surface was unusable.

## The fix (chosen: DECLARE `ok`)

Both schemas now declare `ok: { type: "boolean" }` and list it in `required`:

- `mpd_workmate_rename`:  `required: ["ok", "name", "from"]`
- `mpd_workmate_delete`:  `required: ["ok", "name", "archived", "purged"]`

Why declare rather than drop `ok` from the value:

1. `ok` already exists in the service results and in the §D route bodies — one shape across tool,
   service and wire means no consumer has to know which surface it is reading (`deleteWorkmate`
   returns `ok: true` on both paths, `renameWorkmate` likewise).
2. The package suite already asserts `out.ok === true` on the tool results, so dropping the field
   would contradict tests that describe the intended contract.
3. `required` keeps the success flag from silently disappearing in a future edit — the exact class of
   drift that produced this defect.
4. Nothing renders `ok` (each `render` reads the domain fields), so declaring it cannot change output
   text for the model.

## Why every earlier check missed it (the valuable part)

- **t3's package tests** drive a *fake* `ctx` (`tools: { register(d) { tools.push(d) } }`). The
  definitions never reach `@deepseek-ai/dsh-tools`, so no output validation runs — the assertions in
  the suite read the returned value directly and are all true.
- **t7's adversarial probe** called the shipped `dist` directly, without the harness runtime in the
  loop.
- **t12's mount proof** called `mpd_workmate_delete` with an INVALID name: the tool throws *before* a
  value exists, so the validator never runs (`JsonSchemaError`/`ToolOutputError` only fires on a
  produced value).
- **the route matrix** exercises the HTTP handler, which has its own bodies and never passes through
  the tool runtime.
- `--dump-config` only composes config; it never applies the plugin tree, so it cannot see it either.

Only one thing surfaces this class: a VALID tool call on a REAL boot, i.e. through the harness tool
runtime and its output validator. Both halves of that requirement are now institutionalised — a
package-level regression test against the real validator, and a real-boot probe that drives all three
calls.

## Follow-up: mounting a PRE-FIX module as the live row (t3's mounting lesson, answered)

t3 reported (evidence/workmate/rename-delete-core/t15-valid-call/NOTES-t3-author-measurement.txt) that two
attempts to mount a mutated copy through an id-target overlay left the marker ABSENT — the mutated copy was
never loaded, so that lane proved nothing. That conclusion is right about the mechanism, and this repair adds
the mechanism that DOES work, marker-proven:

- **What loads**: the row lives IN the profile's composed patch file (`$DSH_HOME/cordis.patch.yml`, written
  by `scripts/install-profile.mjs`), so rewriting the row TEXT there rebinds the module — but only if the
  copy sits at the SAME DEPTH the plugin was built for, because the built plugin imports the shared adapter
  by a relative path ("<root>/packages/mpd-dsh-adapter-plugin/dist/index.js"). `prefix-lane.mjs` copies the
  package to `.mpd/t15-outer/t15-inner/packages/mpd-workmate-plugin/`, adds an adapter shim two levels up,
  rewrites the row, and boots. Proof: `REBINDING-PROOF.txt` — the boot log names the COPY as the entry that
  applied (`failed to apply loader entry mpd-workmate (.mpd/t15-outer/.../dist/index.js)`), and the rejection
  it reports exists only in the copy. Note this is itself an independent harness-level check of the defect
  class: a schema whose `required` names a property `properties` omits is refused at REGISTRATION, before any
  credential is needed.
- **Exactly what the combined lane would add**: pointing the same lane at the true pre-t15 shape (property
  AND required entry both stripped) boots clean and reaches the probe, but the probe's tool calls need a model
  route the `mpd-headless` install-profile sandbox cannot authenticate in this environment
  (`MISSING_CREDENTIAL: llm-deepseek`; live profiles meet the route through `settings.yaml`, whose gateway
  providers are empty in a fresh home). That lane is NOT claimed as a pass.

**The gap is NARROWER than first reported (corrected after t3's witness, see below).** Only ONE combination is
missing: *mount the old shape AND drive valid calls in that same boot*. Both levels it would combine are
already on disk separately:
  (a) the OLD SHAPE through the REAL validator, at the assertion level — `failing-first.test.ts`
      (`bun test <file>`, NOT `bun <file>`; the plain runner answers "Cannot use test outside of the test
      runner", which must not be mistaken for the control misbehaving);
  (b) a VALID-CALL REAL BOOT whose report is rejected at the value level, BEFORE the repair —
      `verify-before.console.log` / `verify-before.json` / `boot-before.log` on the shipped pre-repair dist:
      four rejections (`rename`, `rename-retry`, `delete-archive`, `delete-purge`) each reading
      `returned invalid output: "value.ok" is not a declared property (additionalProperties: false)`, with the
      mutation landing anyway (`state.after-rename: oldKey null / newKeyExists true`;
      `state.after-archive: get null / listContains false`);
  plus the mounting path a combined lane needs — `REBINDING-PROOF.txt`.
For t11 wording, cite these two levels explicitly rather than implying one lane demonstrated both.

## Non-author witness (t3 author, the defect's own author)

t3 re-ran MY artifacts on the frozen bytes (src `24cd41f4f83cca28`, dist `a7b558e9bc62ebcb…`) and reported in
`evidence/workmate/rename-delete-core/t15-valid-call/WITNESS-by-t3-author.txt`:
- failing half: `bun test <failing-first.test.ts>` → `OLD-SCHEMA VIOLATIONS: ["\"value.ok\" is not a
  declared property (additionalProperties: false)"]`, 0 pass / 1 fail, exit 1 — failing for the right reason,
  through the validator imported from the installed dsh-tools;
- passing half: `bun test packages/mpd-workmate-plugin/test` → 28 pass / 0 fail / 331 expect() calls;
- he reads `boot-before.log` as the value-level pre-fix REAL-BOOT rejection (my step 3b above) and calls the
  REBINDING proof the right artifact for his own mounting lesson;
- frozen-byte confirmation: the hashes match his earlier valid-input probe, whose `INVALID_OUTPUT_ERRORS=0`
  therefore still stands on the shipped bytes — that is the outside half of the mutation/report agreement.
His verdict: repair verified, defect class locked by a control that demonstrably fails on the old shape.
His one correction — the gap is one lane-combination, not an unproven failing half — is folded in above.

## Verification on this machine

| Evidence | What it shows |
|---|---|
| `verify-before.console.log` / `verify-before.json` / `boot-before.log` | Real boot, pre-repair dist (sha256 `82a015d86b7668ca…`): rename / archive / purge each answer `tool "…" returned invalid output: "value.ok" is not a declared property (additionalProperties: false)` while the mutation lands anyway (old key freed; archive + purge leave the library). Retrying the name the agent was told failed answers `no workmate named` — the first call had succeeded silently. |
| `verify-after.console.log` / `verify-after.json` / `boot-after.log` | Real boot, rebuilt dist (sha256 `a7b558e9bc62ebcb…`, the same artifact the gate sweep ships): 16/16 checks — all three calls answer `ok` with schema-conformant values, the library state agrees with each report, the archived instance is really under `.archive/`, the purged instance left no bytes, and the blind retry is now an explicit error. |
| `failing-first.test.ts` + `failing-first.log` | The regression case's assertion run against the OLD schema, verbatim: violations = `["\"value.ok\" is not a declared property (additionalProperties: false)"]`, so the case FAILS on the old shape. Proof the lock can actually fail. |
| `gate-sweep.sh` + `gate-sweep-result.json` (all_passed: true) | Rebuild → package suite 28 pass (26 before this task) → typecheck → route matrix unchanged → isolated-DSH_HOME install + dump-config resolving the workmate row at its dist → isolation. |
| `git-baseline-before.txt` / `git-baseline-after.txt` | HEAD `f697088` in both; the t15 delta is confined to `packages/mpd-workmate-plugin/{src/index.ts,dist/index.js,test/rename-delete.test.ts}` (the last one is t3's untracked test file, extended here). |

Isolation: every run used an isolated `DSH_HOME` and a sandbox `HOME` under `/tmp`; the real
`~/.mpd/workmate` was hashed before and after every boot and is unchanged
(`ce635a4d2d5b3f66…`, 5 files). HEAD `f697088` was never committed to, stashed or reverted; the 65
pre-existing porcelain entries are untouched and `README.md` (modified by another task) was not
touched here. `skills/**` and `VENDOR_LOCK.json` were left alone (out of scope, verify-vendor red for
an unrelated reason).

