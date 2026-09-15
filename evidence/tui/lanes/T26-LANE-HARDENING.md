# t26 — lane hardening (digest recording, settings marker, no-model-echo)

Owner: `t26` (Lead). inScope: `skills/dsh-qa/`, `evidence/tui/lanes/`.
**Documented deviation: this lane revision landed AFTER t8 and t9 were terminal.** Their verification
of the previous revision stands as evidence for that revision; the results below are the revision that
carries t26's additions, and earlier lane results (the four annotated directories) belong to the
previous lane revision and are named as such in their `T26-DIGEST-ANNOTATION.md`.

## What changed (all strictness-only)

1. **Measured revision recorded per result.** Every lane writes a t8-shaped `REVISION.json` beside its
   result — `{path, sha256, bytes, mtime}` for `packages/mpd-tui-plugin/dist/index.js` — and embeds
   `revision`, `revisionDelta` and `manifestDigest` in `result.json`. A run before and after a package
   rebuild can no longer be indistinguishable.
   *Failure mode:* without this, two honest runs at different revisions read as a contradiction
   (exactly what happened this wave); with it, the revision is part of the result.
   *Cannot false-green because:* the digest is measured from bytes on disk, not asserted.
2. **Mid-run change fails loudly.** Each lane measures the artifact again at evidence-write time; a
   changed digest is a named FAIL (`revisionDelta.changed`), because a result whose subject moved
   under it describes neither revision.
   *Failure mode:* a rebuild between boot and evidence write; the lane would previously record a
   digest that no longer matches what it measured.
   *Cannot false-green because:* the comparison is a plain inequality on two measurements
   (two-sided self-test: unchanged ⇒ ok, changed ⇒ FAIL).
3. **`/settings` assertion now requires the unbridged marker**, not just the section title
   (`allPatterns = [/MPD 插件包|MPD bundle/, /not bridged: a save here does not rewrite/]`).
   *Failure mode:* a section that renders a title but loses the `UNBRIDGED_MARKER` hint would have
   passed the old title-only check; now it fails and names the missing pattern.
   *Cannot false-green because:* the negative control feeds a title-only pane and the assertion fails.
4. **`/mpd` never reaches the model** (`findModelEcho`): no `user/message` record may carry the
   command text; only `command/run` + `command/done` may exist.
   *Failure mode:* a harness that forwarded the slash command as chat input (the exact regression the
   surface exists to catch) leaves a `user/message` with `/mpd …`.
   *Cannot false-green because:* the predicate is two-sided in the self-test (a fixture message
   carrying `/mpd workmates` is reported as an offender).
5. **Gate rule (T8-F1) + reader fix.** `--install` now runs BEFORE the prerequisite gate; a skip is
   legitimate only when the caller did NOT ask for the missing thing (`--install` + still-unusable
   profile ⇒ FAIL with `reason=requested-absent-fixture` and the captured `install.log`).
   The session-header reader was made order-independent (`{projectKey}` filter + a cap that can no
   longer hide the run's own key) and the preset witness now prefers the NEWEST sandbox-keyed record,
   so a warm root cannot make the evidence read as "preset undefined".

## Re-runs on the then-current revision

| Lane | Revision | Result |
|---|---|---|
| `tui-mount` | `5dce2563…85e6f` (98883 B) | PASS — triple layer, zero crash signatures, status line + counters, preset `mpd` from the newest sandbox-keyed session; `REVISION.json` written |
| `tui-panels` | same | 6/7 surfaces render; `tuiSettingsSections` now passes WITH the marker; **no-model-echo checked=4 offenders=0**; `tuiRenderers` still the single host-side NOT-CLAIMED surface, negative control `ok=false` |
| `tui-admission` | same | PASS — host-pinned static admission + live `/plugins check` = `waiting_authorization`, forbidden `[]` |
| `tui-spec-conformance` | same | PASS — suite `d28c267`, blocker recorded, 7/7 requirement statuses |
| `tui-distribution` | same | PASS — protocol CLI install/build/check all exit 0, `fullyValidated=true` |

Every one of those results names the digest it measured in `result.json` + `REVISION.json`
(the one intermediate admission run that predates the live-path wiring is marked superseded in its own
directory, never rewritten).

## Skills corpus fingerprint for the captain's single re-pin

After t26's edits: **`fileCount: 307`, `treeSha:
ba0c3922889614225dfd3c30b97ed369ee9b5b0ae374635a5d52d561123816ef`** (supersedes the `e510d8c5…` value
reported after t7). `bun run test:qa` therefore still exits 1 on the VENDOR_LOCK skills-pairing gate
alone until that re-pin lands in the captain's commit — every other self-test passes. This is the
wave's second and final `skills/**` writer window.

