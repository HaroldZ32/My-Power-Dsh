# T20 — the live `shipped.withGrant` arm can no longer pass vacuously (A5-F1)

**Task:** T20 (follow-up wave 0.17.2). **Source:** `evidence/cellwork/vedit-p0/followup/review-a5/REPORT.md`
§2 (A5-F1). **Loop:** `loop-20261103T073101-95530c`.
**Scope:** `skills/dsh-qa/scripts/tui-admission.ts`, `skills/dsh-qa/SKILL.md`, this evidence subtree.
No `src`, no `dist`, no git write; the captain re-pins once.

## 1. The defect A5 measured

`arm5d` asserted only `lastCheckWindow(shippedGrantedPane).verdict.state === "compatible"` — the SAME value the
immediately preceding step (`clone-granted`) produces. So a `shipped-granted` step that painted nothing
(swallowed keystroke, host slower than `waitMs`) left the PREVIOUS pane on screen, the helper returned the
neighbour's `compatible`, and the arm passed **without the shipped check ever running**. The reviewer proved
it on their own artifacts: `clone-granted.pane.txt` carries two decisions whose last is `compatible`.

## 2. The fix — a decision COUNT, and the measurement in its own boot

| change | detail |
|---|---|
| `lastCheckWindow` | now returns `{ window, verdict, decisions }`; `decisions` is the number of decision lines the pane carries (`0` when it carries none). Two new self-test arms make the counter two-sided (a 2-decision fixture reports `2`; a pane with no check reports `0`). |
| **PHASE C** (new boot) | the shipped-with-grant measurement moved OUT of the clone boot into a boot of its OWN: the clone's one row is staged in the grants file **before** the boot, the boot drives exactly ONE `/plugin check <shipped manifest>`. A fresh boot has no decision to inherit. |
| `arm5d` | `state === "compatible"` **AND** `decisions === 1`. The semantic half is unchanged; the freshness half is the new, additional term. A swallowed step paints ZERO decisions and reddens. |
| record | `shipped.withGrant = { check, decisions, arm, boot }` — the artifact now carries the count the verdict rests on. |
| docs | `SKILL.md` and the lane header describe the separate boot and the exactly-one-decision rule. |

No other arm was touched; `ok` keeps every prior term and `arm5d` only GAINED one. The STATIC plane
(`grants.manifestGranted`) is a direct `negotiate` with the grant and is therefore non-vacuous by
construction, as the reviewer noted — it is unchanged.

## 3. Red-first proof 1 — the SWALLOWED STEP, measured on a real live run

A throwaway copy of the tree (`.mpd/recon/qa/mut-live/`, its own sandbox root) in which the phase-C step sends
`Escape` instead of driving the check. `red-first-swallowed-step.log`:

```
[tui-admission] shipped-with-grant boot: the clone's one row staged in the grants file -> … rows=1
[tui-admission] shipped-with-grant /plugin check -> state=undefined decisions=0 (fresh boot, exactly one expected)
[tui-admission] ok=false -> …/evidence/tui/lanes/2026-11-03T07-33-22.188Z
[tui-admission] FAIL: {"static":true,"staticGrants":true,"arm1":true,"arm1NoHint":true,"arm2":true,"arm3":true,
                        "grantArmsApplicable":false,"arm4":true,"arm5":true,"arm5b":true,"arm5c":true,"arm5d":false,
                        "revokedState":"waiting_authorization"}
MUTANT-EXIT=1
```

**Only `arm5d` is false** — the arm reddens on a swallowed step while every other arm stays green, which is
exactly the vacuity A5 named.

## 4. Red-first proof 2 — the reviewer's own construction, against the recorded panes

`non-vacuity-demo.log`, produced with the lane's OWN exported predicate (`lastCheckWindow`, not a copy) over
two real captures:

```
the pane a SWALLOWED step would leave on screen (the previous step's capture, newest decision = compatible)
  -> {"state":"compatible","decisions":2,"arm":false}
  -> arm5d RED
the real phase-C pane (its own boot, one check driven)
  -> {"state":"compatible","decisions":1,"arm":true}
  -> arm5d PASS
```

The first line is the defect: under the PREVIOUS arm that pane was a PASS (state `compatible`); under the new
arm it is RED because the boot painted two decisions and the expected count is one.

## 5. The real live lane is GREEN (three boots)

`bun skills/dsh-qa/scripts/tui-admission.ts --sandbox-root .mpd/sb/tui-admission` → **exit 0** (`live-run.log`):

```
[tui-admission] shipped /plugin check -> state=compatible; /plugin list -> state=compatible
[tui-admission] shipped /plugin check grants hint absent: true
[tui-admission] arm2 admission-loader line admitted com.mpd-dsh.mpd-tui: true (…)
[tui-admission] arm3 (ledger attribution) applicable=false … INAPPLICABLE … recorded as a BOUND, never a pass
[tui-admission] arm4 real input submit rendered the turn: true
[tui-admission] clone ungranted /plugin check -> state=waiting_authorization hint=true
[tui-admission] clone granted /plugin check -> state=compatible
[tui-admission] clone wrong-scope /plugin check -> state=waiting_authorization
[tui-admission] arm6 revocation re-check -> state=waiting_authorization flipped=true
[tui-admission] shipped-with-grant /plugin check -> state=compatible decisions=1 (fresh boot, exactly one expected)
[tui-admission] ok=true -> evidence/tui/lanes/2026-11-03T07-33-03.109Z
```

`result.json` (copied into `run-artifacts/`) carries
`"withGrant": { "check": "compatible", "decisions": 1, "arm": true, "boot": "its OWN boot … (A5-F1)" }`.

## 6. Gates (quoted exits; full text in this directory)

| command | observed |
|---|---|
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` | `static result ok=true`, `ok=true -> evidence/tui/lanes/2026-11-03T07-33-03.053Z` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --sandbox-root .mpd/sb/tui-admission` | `ok=true` — **exit 0** |
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS` — **exit 0** |

## 7. Bounds

- The freshness half counts decision LINES in the CAPTURED PANE (the visible screen). In phase C the expected
  count is exactly one by construction; a host that painted a second, unprompted decision would redden the arm
  — a false RED rather than a false PASS, which is the safe direction.
- The arm is now a THIRD boot: the live lane takes one boot longer (~40–60 s). Cost accepted for non-vacuity.
- The static plane is unchanged and was never vacuous (a direct `negotiate` call with the grant row).
- The swallowed-step proof ran in a throwaway copy; the repository's own sources were not mutated for it.
- `VENDOR_LOCK.json` untouched — `skills/**` changed again, so the wave's single re-pin still owes
  `SKILL.md` + `tui-admission.ts` (+ the earlier `surface-pin.ts`); until then `verify-vendor` stays red on the
  corpus `treeSha` (expected).

## 8. Evidence in this directory

```
report.md  live-run.log  red-first-swallowed-step.log  non-vacuity-demo.log
tui-static-only.log  gates.log  test-qa-and-selftest.log
run-artifacts/{result.json, admission-static.json, shipped-granted-check.pane.txt}
```
