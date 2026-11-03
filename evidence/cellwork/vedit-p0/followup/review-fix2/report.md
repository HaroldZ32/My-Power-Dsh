# T18 — the shipped-with-grant claim is now MEASURED, and the `end` verb is PINNED

**Task:** T18 (follow-up wave 0.17.2). **Source:** `evidence/cellwork/vedit-p0/followup/review-a4/REPORT.md`
(A4-F1, A4-F2). **Loop:** `loop-20261103T071704-813e2a`.
**Scope:** `skills/dsh-qa/scripts/tui-admission.ts`, `skills/dsh-qa/SKILL.md`,
`skills/dsh-qa/scripts/surface-pin.ts`, this evidence subtree. No `src`, no `dist`, no git write; the captain
re-pins once.

## 1. A4-F1 — I MADE THE CLAIM TRUE instead of weakening the wording

The review offered two directions: say "with NO grant", or measure the shipped manifest WITH the clone's one
row. **I measured it, on BOTH planes**, because the property is real ("a stray grant cannot flip a
permission-less manifest") and a documented-but-unmeasured promise is the same defect class the SKILL.md row
was rewritten to remove.

| plane | what was added | recorded field |
|---|---|---|
| STATIC (`staticAdmission`) | one more `host.negotiate` of the SHIPPED manifest with the clone's single `session.input.intercept@tui/input` row, and that decision is now part of `grants.ok` | `grants.manifestGranted` |
| LIVE (`real()`, phase B) | a NEW step `shipped-granted`, driven INSIDE the clone boot while the grants file holds that row: `/plugin check <shipped manifest>` must answer `compatible` | `shipped.withGrant.{check,arm}` + `arm5d` in `ok` |

Measured, on the real host:

```
[tui-admission] shipped /plugin check -> state=compatible; /plugin list -> state=compatible
[tui-admission] shipped-with-grant /plugin check -> state=compatible          ← NEW (arm5d)
[tui-admission] clone ungranted /plugin check -> state=waiting_authorization hint=true
[tui-admission] clone granted /plugin check -> state=compatible
[tui-admission] clone wrong-scope /plugin check -> state=waiting_authorization
[tui-admission] arm6 revocation re-check -> state=waiting_authorization flipped=true
[tui-admission] ok=true -> evidence/tui/lanes/2026-11-03T07-20-03.994Z
PASS … the SHIPPED posture is compatible with NO grant AND with one in place …   (exit 0)
```

The static record (run `2026-11-03T07-19-57.225Z`, copied as `run-artifacts/admission-static.json`):

```json
"grants": {
  "rows": [{ "name": "session.input.intercept", "scope": "tui/input" }],
  "manifestDecision": "compatible",
  "manifestGranted": "compatible",     ← NEW (A4-F1)
  "ungranted": "waiting_authorization", "granted": "compatible",
  "wrongScope": "waiting_authorization",
  "ok": true
}
```

**No permission-less arm was weakened:** `manifestDecision` (no grant), `ungranted`, `granted`, `wrongScope`
and their three expectations are untouched; `ok` only GAINED a term. SKILL.md's sentence now states the
measured pair explicitly ("with NO grant AND with that row granted — measured twice …"), so the row claims
exactly what the artifacts carry.

## 2. A4-F2 — the `end` verb is pinned, and the pin is falsifiable

`skills/dsh-qa/scripts/surface-pin.ts`: the pinned control surface for `agent_teams_control` is now
`["halt", "resume", "fence", "unfence", "end"]` (one array literal; the comment states WHY a subset check
needed the verb named). The premise A3 recorded — "land when lane B's END verb is FROZEN" — is satisfied
(lane B's verb landed; the live enum at `packages/mpd-team-core-plugin/src/index.ts` reads
`enum: ["halt", "resume", "fence", "unfence", "end"]`).

Red-first proof (`pin-end-mutation.log`), in a throwaway copy of the tree the case reads, repository untouched:

```
baseline live:      PASS   [surface-pin] PASS — every surface …      exit 0
baseline self-test: PASS   [surface-pin self-test] ok: … EIGHT negative controls …   exit 0
m6 (end removed) live:      RED as expected  → "[surface-pin] FAIL: 1 surface problem(s)",
                                              "  - tool agent_teams_control no longer offers action 'end'"
m6 (end removed) self-test: RED → "the SHIPPED tree must satisfy every pin: tool agent_teams_control no longer offers action 'end'"
A4-F2 pin falsifiable: true
```

Real-tree runs after the pin (`surface-pin.log`): live **PASS**, exit 0; `--self-test` **exit 0**.

## 3. Gates (quoted exits; full text in this directory)

| command | observed |
|---|---|
| `bun skills/dsh-qa/scripts/surface-pin.ts` | `PASS — every surface …` — **exit 0** |
| `bun skills/dsh-qa/scripts/surface-pin.ts --self-test` | `ok: … EIGHT negative controls …` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --self-test` | `ok: structural rules, pane classification and spec-root resolution are two-sided` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --static-only` | `static result ok=true`, `ok=true -> evidence/tui/lanes/2026-11-03T07-19-57.225Z` — **exit 0** |
| `bun skills/dsh-qa/scripts/tui-admission.ts --sandbox-root .mpd/sb/tui-admission` | `ok=true`, `PASS …` — **exit 0** |
| `bun test packages/mpd-cellwork-plugin` | `198 pass / 0 fail` — **exit 0** |
| `bun run typecheck` (`tsgo --noEmit`) | no output — **exit 0** |
| `node scripts/verify-comment-coverage.ts` | `VERDICT: PASS` — **exit 0** |
| `bun run test:qa` | `[test:qa] all self-tests passed` — **exit 0** |

## 4. Bounds

- The live arm is measured on `dsh-tui 0.18.0` with the seeded warm sandbox root (`.mpd/sb/tui-admission`);
  the `absent-fixture` SKIP path was not exercised by this run (the root has a profile).
- The `end` pin is a SUBSET assertion: it now reddens when `end` is REMOVED (proved by m6), and it still
  tolerates a FUTURE added verb — that is the pin family's deliberate shape.
- `VENDOR_LOCK.json` is untouched: `skills/**` changed again (SKILL.md + surface-pin.ts + tui-admission.ts),
  so the wave's SINGLE re-pin must land in the same commit; until then `verify-vendor` stays red on
  `asset skills treeSha mismatch` (expected, recorded by the reviewer as an expected red).
- No dist rebuild is needed: no `packages/*/src` change.

## 5. Evidence in this directory

```
report.md  live-run.log  tui-self-test.log  tui-static-only.log  surface-pin.log
pin-end-mutation.log  gates.log  package-tests.log  test-qa.log
run-artifacts/{result.json, REVISION.json, admission-static.json, extension-grants.json}
```
