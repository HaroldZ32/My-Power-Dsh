# N1 — the LIVE `tui-admission` lane re-specified to the permission-less contract (and it is GREEN)

**Task:** T1 (follow-up wave 0.17.2; contract `.mpd/plans/vedit-p0-followup.md` §F1, the T14 finding).
**Scope:** `skills/dsh-qa/scripts/tui-admission.ts`; `skills/dsh-qa/scripts/surface-pin.ts` (added by captain
ruling in-session — a QA-suite ripple of the team-END verb, see §7); this evidence subtree.
No git writes; `VENDOR_LOCK.json` untouched (the captain runs the wave's single re-pin).
**Loop:** `loop-20261103T061032-70b5ca`.

## 1. The defect (T14's finding), reproduced RED with a real boot

The non-static lane drove the SHIPPED manifest — which declares `"permissions": []` by decision (commit
`776ac355`) — and then demanded states that only a DECLARING manifest can produce. Measured here with the
**pre-edit** file (`baseline-preedit-live.log`, evidence dir
`…/base-repo/evidence/tui/lanes/2026-11-03T06-35-34.839Z`, exit **1**):

```
[tui-admission] negctl /plugin check -> state=compatible ok=true
[tui-admission] arm2 admission-loader line admitted com.mpd-dsh.mpd-tui: true (…)
[tui-admission] arm3 attribution: attributed=0 decisionHandlerBinds(applied)=0 (ledger delta=20)
[tui-admission] arm6 revocation re-check -> state=compatible flipped=false
[tui-admission] FAIL: {"static":true,"staticGrants":true,"arm1":true,"arm2":true,"arm3":false,"arm4":true,"arm5":false,"revokedState":"compatible"}
```

- **arm5** demanded `waiting_authorization` from a manifest that requests nothing → the host answers
  `compatible`, so the negative control could never hold.
- **arm3** demanded an APPLIED decision-handler bind attributed to the component → with no permission
  declared there is no authorize operation at all (`attributed=0`), so no such bind is producible.
- arm1, arm2 and arm4 were green, and the revocation arm could not flip (nothing to revoke) — the red is
  exactly the permission-less construction, nothing else.

## 2. The re-specification — every moved assertion, by name (R2)

| old live assertion | new assertion | why |
|---|---|---|
| **arm1** — `/plugin check` + `/plugin list` `compatible` with the GRANTS FILE WRITTEN for the shipped manifest's own (now empty) rows | **arm1** — both panes `compatible` with **NO grants file at all** | The shipped posture is "nothing requested ⇒ nothing to authorize"; with an empty row set the old grant write was a no-op, and this form reddens if a permission is ever re-declared without a grant. |
| (none) | **arm1NoHint** — the shipped check window carries NO `extension-grants.json` hint | The inverse reading of the old arm5, kept on the shipped manifest, so "the host prints no grant hint for a permission-less component" is asserted rather than assumed. |
| **arm2** — the admission-loader line admits the component, read from the GRANTED boot's stderr | **arm2** — the SAME predicate, now read from the **SHIPPED** boot (`shipped/host-stderr.log`) | The MEASUREMENT moved, deliberately: only the shipped (permission-less) boot admits the Component, so the granted boot this arm used to read no longer exists — the pre-edit baseline shows that boot's loader admitted nothing (`admitted=0 refused=0`, `arm3 identity differential`). Same assertion, on the only boot that can satisfy it. |
| **arm3** — `attributed.length > 0 && applied decisionHandlerBinds > 0`, UNCONDITIONAL | **arm3** — the SAME assertion, gated by the new `attributionArmsApplicable(rows)` predicate, and recorded as the STRING `"inapplicable"` (never a folded `true`) when the shipped manifest declares nothing | The clause is about an authorize operation; with `permissions: []` there is none. **This is not a weakened assertion**: it is a conditional one, it re-arms automatically the moment a declaration returns, and the artifact a verifier reads says `"inapplicable"`, plus the reason in `grantArms.inapplicableReason`. The registration/attribution gap measured 2026-10-14 therefore stays UNMEASURED by this lane, stated as a BOUND. |
| **arm4** — documented as "a REAL `tui/input` decision fires with our handler live" | **arm4** — re-documented to what it asserts: the drive reached a REAL CHAT TURN (the submitted line renders) | With no permission declared our decision handler is NOT live, so the arm no longer claims an interception. The claim itself moved to the conditional arm3. |
| **arm5** — a NO-GRANT boot on the SHIPPED manifest → `waiting_authorization` + the host's grants hint | **arm5** — the **GRANT CLONE**'s no-grant check → `waiting_authorization` + the hint | The clone declares ONE `session.input.intercept@tui/input` row, so the host's own `/plugin check` produces the real three-way discriminator. |
| (none) | **arm5b** — the SAME clone with that ONE row granted → `compatible` | The grant is what flips the decision, not the declaration. |
| (none) | **arm5c** — the same NAME at an undeclared scope (`tui/not-a-declared-scope`) → STILL `waiting_authorization` | A grant cannot authorize a point nothing declares. |
| **arm6** — revocation of the shipped manifest's own grant rows mid-session | **arm6** — revocation of the CLONE's single grant file mid-session, re-checked and OBSERVED (never gated) | Same live re-read proof, on the file that can produce it. |

New helpers, each with its own self-test arm: `writeGrantClone()` (the clone document), `lastCheckWindow()`
(the NEWEST decision in a transcript that keeps older checks ABOVE it — the first measurement of the live
lane hit exactly this: the whole-pane classifier read the OLD ungranted decision above the granted one),
`attributionArmsApplicable()` (the conditional arm's predicate).

The static half (`staticAdmission`, the CLONE technique F1 landed, `--static-only`) is **untouched**.

## 3. Measured GREEN — the re-specified live lane, real TUI boots

`bun skills/dsh-qa/scripts/tui-admission.ts --sandbox-root <root>` → **exit 0** (`live-run.log`, artifact
copied as `run-artifacts/result.json`, host-own evidence dir
`evidence/tui/lanes/2026-11-03T06-33-55.528Z`):

```
[tui-admission] shipped /plugin check -> state=compatible; /plugin list -> state=compatible
[tui-admission] shipped /plugin check grants hint absent: true
[tui-admission] arm2 admission-loader line admitted com.mpd-dsh.mpd-tui: true (… 572091B)
[tui-admission] arm3 (ledger attribution) applicable=false attributed=0 decisionHandlerBinds(applied)=0 — INAPPLICABLE while the shipped manifest declares NO permission (no authorize operation exists): recorded as a BOUND, never a pass
[tui-admission] arm4 real input submit rendered the turn: true
[tui-admission] clone ungranted /plugin check -> state=waiting_authorization hint=true
[tui-admission] clone granted /plugin check -> state=compatible
[tui-admission] clone wrong-scope /plugin check -> state=waiting_authorization
[tui-admission] arm6 revocation re-check -> state=waiting_authorization flipped=true
[tui-admission] ok=true -> evidence/tui/lanes/2026-11-03T06-33-55.528Z
```

`result.json` (copied verbatim into `run-artifacts/`):

```json
"shipped": { "arms": { "compatible": true, "noGrantHint": true, "loaderAdmitted": true,
                       "ledgerAttribution": "inapplicable", "decisionTurn": true },
             "check": "compatible", "list": "compatible", "ledgerDelta": 20 },
"clone": { "arms": { "ungrantedWaiting": true, "grantedCompatible": true, "wrongScopeWaiting": true },
           "row": { "name": "session.input.intercept", "scope": "tui/input" },
           "ungranted": "waiting_authorization", "granted": "compatible",
           "wrongScope": "waiting_authorization",
           "revoked": { "state": "waiting_authorization", "flipped": true } }
```

The clone's own bytes are in `run-artifacts/dsh-plugin.grant-clone.json`; the SHIPPED `dsh-plugin.json` was
never written (`manifestDigest` in the run's `result.json`, and the new self-test arm asserts the writer
leaves the shipped file byte-identical). The host's `extension-grants.json` was written, rewritten at the
wrong scope, and revoked mid-session — all inside the sandbox.

## 4. The arm that can NOT be re-specified — declared loud, with its reason

Arm 3 (ledger attribution of an APPLIED decision-handler bind). With `permissions: []` the host performs no
authorize operation, so the state is unreachable by construction; and the 2026-10-14 measurement found NO
decision-handler record even WITH a declaration (a registration/attribution gap of ours). The lane therefore
records `"inapplicable"` + `grantArms.inapplicableReason`, and the arm is CONDITIONAL: it re-arms the moment
a permission returns. **This lane's PASS does not cover it** — that is the bound, not a pass.

## 5. Gates (real repo, quoted results)

| command | observed | log |
|---|---|---|
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided` — **exit 0** | `self-test-and-static.log` |
| `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` | `[tui-admission] ok=true -> evidence/tui/lanes/2026-11-03T06-36-50.728Z` — **exit 0** | `self-test-and-static.log` |
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** | `test-qa.log` |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** | T2's `lane-a/gates.log` (same tree, same run) |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS` — **exit 0** | T2's `lane-a/gates.log` |

## 6. How the live lane was run at all — and what that costs

The brief said the TUI sandbox/spec-data root is absent here. It is: the lane's DEFAULT root has no profile
and the host is a GLOBAL install, so `gateTuiPrereqs` SKIPs with `absent-fixture` (unchanged behaviour, exit
0, loud marker). The live run was obtained by provisioning a sandbox root the documented way:

1. copy `~/.dsh/profiles/dsh-tui` into `<root>/dshhome/profiles/` (a WARM profile that already carries
   `@deepseek-harness-tui/dsh-tui@0.18.0` + `@mpd-dsh/mpd`), then replace its
   `node_modules/@mpd-dsh/mpd` with a symlink to THIS checkout, so the boot loads the shipped manifest;
2. copy `~/.dsh/.credentials.yaml` into `<root>/dshhome/`, and write the two host preference fixtures
   (`<root>/home/.dsh-tui/onboarding.json`, `agent-preset.json` — `{preset:"mpd"}`);
3. pass `--sandbox-root <root>`.

**TWO environment bounds, both measured, neither hidden:**
- **The root path must stay SHORT**: `<root>/<lane>.sock` is a unix socket, and a root under
  `<repo>/.mpd/recon/qa/tui-lanes/tui-admission` on this long checkout path produced
  `tmux new-session failed: error connecting to … (File name too long)` — the lane then never boots and every
  pane arm reads `undefined`. The runs above used `<repo>/.mpd/sb/…` (78–94 chars total). This is a
  lane-environment fact, not a product defect, and it is the reason a naive `--sandbox-root` under the
  default tree fails on a deep checkout.
- The live lane needs a REAL model route for the arm4 chat turn (the sandbox carries `~/.dsh` credentials).
  No credential value is written anywhere in this evidence.

## 7. The `surface-pin.ts` ripple (captain-authorised addition)

`bun run test:qa` was red on ONE case after lane B added the team-END verb: `surface-pin.ts`'s negative
control mutated the OLD enum literal, so the replace became a no-op and the control could no longer redden.

- Old anchor (line 524): `text.replace('enum: ["halt", "resume", "fence", "unfence"]', 'enum: ["halt", "resume"]')`
- New anchor: `text.replace('enum: ["halt", "resume", "fence", "unfence", "end"]', 'enum: ["halt", "resume"]')`

No assertion is weakened — the control is restored to being falsifiable, and the pinned action set stays a
subset check (which is why the LIVE case had stayed green). Exits: `surface-pin.ts --self-test` **0**
(`ok: … EIGHT negative controls …`), `surface-pin.ts` **0** (`PASS — every surface …`), `bun run test:qa` **0**
(`all self-tests passed`) — all three in `surface-pin.log` / `test-qa.log`.

## 8. Bounds — what I could NOT prove

- **Arm 3 is not measured** (§4). The lane's green does not cover it.
- The live lane was measured on `dsh-tui 0.18.0` with a seeded warm profile; the gate's own `absent-fixture`
  SKIP path was NOT exercised by these runs (the root always had a profile).
- The `input-submit` arm proves the drive reached a chat TURN; it does not inspect the model's answer.
- The clone's `/plugin check` is the host's STATIC admission path (`pluginFootprintPaths` → `checkManifestLines`),
  so the three states are proven for admission, never for a live activation of the clone (which the lane does
  not raise).
- `SKILL.md`'s case-table row for `tui-admission` still describes the PRE-fix live arms ("a NO-GRANT
  negative-control boot (pane must say `waiting_authorization`)…"). It is a skills file OUTSIDE this row's
  frozen scope; **reporting it, not editing it** — the captain decides whether it rides the same re-pin.
- `VENDOR_LOCK.json` is deliberately untouched: this edit invalidates the corpus `treeSha`, so
  `node scripts/verify-vendor.ts` stays red until the wave's SINGLE re-pin lands in the same commit.

## 8b. Addendum (T18 / A4-F1) — the SHIPPED-with-grant claim is now MEASURED

Review A4 found one promise this row's arms did not carry: the SKILL.md sentence said the shipped manifest
must stay `compatible` "even WITH a grant", while the static arm negotiated `[]` only. T18 made it true at
BOTH levels instead of weakening the sentence:

- **STATIC**: `staticAdmission` now also negotiates the SHIPPED manifest with the clone's one
  `session.input.intercept@tui/input` row, records it as `grants.manifestGranted`, and includes it in
  `grants.ok` (measured `compatible` in `evidence/tui/lanes/2026-11-03T07-19-57.225Z`).
- **LIVE**: a THIRD boot (phase C, added after review A5 found the first form vacuous) stages the grants file
  with that row BEFORE the boot and drives ONE `/plugin check` of the SHIPPED manifest → `compatible` with
  **exactly one decision line** in the pane, recorded as `shipped.withGrant` and gated as `arm5d`. The fresh
  boot is what makes the arm non-vacuous: a swallowed step leaves ZERO decisions and reddens (inside a shared
  boot the expected `compatible` equalled the neighbour's verdict). Run: `ok=true`, exit **0**,
  `evidence/tui/lanes/2026-11-03T07-33-03.109Z` (`shipped-with-grant /plugin check -> state=compatible
  decisions=1`).

Disposition, evidence and the red-first proof for the companion `end`-verb pin:
`evidence/cellwork/vedit-p0/followup/review-fix2/report.md`.

## 9. Evidence paths

```
evidence/cellwork/vedit-p0/followup/qa-live/
  report.md (this file)  live-run.log  baseline-preedit-live.log
  self-test-and-static.log  surface-pin.log  test-qa.log
  run-artifacts/{result.json, REVISION.json, output.log, dsh-plugin.grant-clone.json}
evidence/tui/lanes/2026-11-03T06-33-55.528Z/          ← the lane's OWN host-side artifact (this run)
evidence/tui/lanes/2026-11-03T06-36-50.728Z/          ← --static-only run
```
