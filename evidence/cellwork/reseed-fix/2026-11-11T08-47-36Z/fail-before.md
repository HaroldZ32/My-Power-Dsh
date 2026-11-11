# Fail-before — what "before" means this round

## The honest starting point

Round 9's blind verdict FAIL was diagnosed as: **the code is correct, the arms are missing** (a pure test
gap plus two documentation/metadata items). This round changes no behaviour. Therefore a new arm has no
"pre-fix code" to go red against: the round-9 code already satisfies it, and the new arm is **GREEN on the
round-9 sources** — that is exactly the diagnosis, and it is recorded here as a positive result, not as a
fail-before.

- Round-9 sources are this round's sources: `protocol.ts 5cd5521d…`, `protocol-core.ts eda5a476…`,
  `index.ts 855ac943…` (`round9-baseline.sha256.txt`, checked in `round9-baseline-check.log`).
- `gate-tests-package.log` (45 arms in `reseed-binding.test.ts`, 414 in the package) shows the new arms
  passing on those bytes.

## The falsifiability proof: three mutations on a COPY

An arm that cannot fail is not an arm, so the "would it go red" question is answered by breaking exactly
the contract each arm pins — in a **copy** of the package under `.qa-tmp/reseed-mutation/` (gitignored),
never in the delivered tree. Each mutation is restored and hash-checked (`mutation-restore-*.sha256.txt`);
the restored copy runs the whole file green (`mutation-restored-green.log`, 45 pass / 0 fail).

| mutation | file | RED arm | observed failure |
|---|---|---|---|
| M1: drop the CELL-mirror gate from `unfenceWithheld` (`mirrorFailures.length === 0` removed) | `protocol.ts` | **A30** | `expect(result.unfenced).toBeUndefined()` → received `[{member:"Senior Engineer", unfenced:true, plane:"unfenced"}]` — the unfence RAN around an unmirrored seat |
| M2: the landed entry silently drops `cellRow` (return the outcomes unmapped) | `protocol.ts` | **A30** | `expect(String(outcome.cellRow).startsWith("failed: ")).toBe(true)` → `false` — a silent success |
| M3: quantify the withhold per entry instead of per call (only withhold when EVERY declared target failed) | `protocol.ts` | **A31** | `expect(result.unfenced).toBeUndefined()` → received BOTH members cleared (`unfenced:true`) although entry 2 never landed |

**Controls stay green under each mutation**, so each red is attributable to the rule it breaks, not to the
mutation's collateral:

| control | under M1 | under M3 |
|---|---|---|
| A28 (one entry, one failure) | green | green |
| A30 (mirror failure) | red (target) | green |
| A31 (two entries, one failure) | green | red (target) |

Logs: `mutation-a30-gate-red.log`, `mutation-a30-cellrow-red.log`, `mutation-a31-quantifier-red.log`,
`mutation-*-control-*.log`, `mutation-*.diff`, `mutation-source.sha256.txt`.

## Why the mutation is not a source change

- It was applied only to `.qa-tmp/reseed-mutation/packages/mpd-cellwork-plugin/src/protocol.ts`.
- The delivered source hash after the exercise is still `5cd5521d…` (`final-sources.sha256.txt`), and no
  `git` write was run.
- The lines mutated are quoted verbatim in `mutation-*.diff`, so a verifier can re-apply them.

## The A30 injection, explained

A30's own seed breaks the CELL write from the harness side, not from the source: the new
`verifyAfterHandle` hook fires inside the plane's READ-BACK of the rebind (the only point after the TEAM
write and before the CELL mirror), removes the cell directory's write bit, and heals it on the next
microtask. The rebind's real `writeCell` then fails for real (`EACCES` on the atomic temp file) and the
arm measures the DECISION — does the unfence run? — instead of dying on the read-only directory; that is
why the M1/M2 reds are assertion failures, not crashes.
