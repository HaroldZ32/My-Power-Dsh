<!-- docs-parity: exempt internal QA evidence record for the ask-user-question-guard wave (D1+D2) -->
# Evidence — ask_user_question boundary guard (D1) + preset prompt hardening (D2)

Wave contract (frozen): `.mpd/plans/ask-user-question-guard.md`.
Branch: `feature/ask-user-question-guard`. Writer: Senior Engineer (Writer A scope).
Captured: 2026-10-11, 09:12–09:13 UTC (machine local UTC+8).

## Files changed (Writer A scope only)

| Path | Change | sha256 |
|---|---|---|
| `packages/mpd-roles-plugin/src/ask-user-guard.ts` | NEW — pure validator `askUserQuestionDenial(args: unknown): string \| undefined`, name-matched decision, deny-only install | `2a139239664d2a6465dc1bb3d2c62c675403af68c1fa3ef3cdb89e700c6782c9` |
| `packages/mpd-roles-plugin/src/index.ts` | +20 — import + install at the existing guard site, boot token `askUserQuestion=installed\|absent` | `9c52407d7e5fe76b816b1a4db734aae14b30f7481b8718d90370bcfdfade8d91` |
| `packages/mpd-roles-plugin/test/ask-user-guard.test.ts` | NEW — 22 arms captured (5 allow / 11 deny / 3 name+robustness / 3 install) | `f338eaadcec19ba7676b0b12ffb1fe57316612a206ebb297cdd93b95438a0c7c` |
| `packages/mpd-roles-plugin/dist/index.js` | rebuilt with the PINNED toolchain, repo root, canonical command | `89bb6f94ebd368f90d8497798705e2780c9b5ff179f003d68fcaf280ef8d160b` |
| `presets/mpd.patch.yml` | +8 lines — `ASK_USER_QUESTION CONSTRUCTION RULE` paragraph in the persona `prefix` block, after the REQUIREMENTS CONFERENCE paragraph | `01813f729f888aa4cd36ffad4c2486b2d2b46768c0cf0c83170567d75cd857b2` |

Rebuild command actually run (repo root):
`.toolchain/node_modules/.bin/bun build packages/mpd-roles-plugin/src/index.ts --target node --format esm --outfile packages/mpd-roles-plugin/dist/index.js`
(`packages/mpd-roles-plugin` is a SINGLE-entry package: `dist/` holds only `index.js`, `package.json` declares no extra entry/exports.)

## Gates — every one exit 0

| Gate | Command | Exit | Log |
|---|---|---|---|
| Package tests | `.toolchain/node_modules/.bin/bun test packages/mpd-roles-plugin` | 0 (`144 pass / 0 fail`) | `bun-test/output.log` |
| Typecheck | `.toolchain/node_modules/.bin/bun run typecheck` | 0 | `typecheck/output.log` |
| Declaration comments | `.toolchain/node_modules/.bin/bun run verify:comments` | 0 (`VERDICT: PASS`, 384 files) | `verify-comments/output.log` |
| Row parity | `.toolchain/node_modules/.bin/bun run verify:rows` | 0 (`35 row ids`) | `verify-rows/output.log` |
| Preset conformance | `node skills/dsh-qa/scripts/preset-conformance.ts --self-test` | 0 (`persona prefix=true, mpd preset 28 child rows, negative controls 4/4 reddened`) | `preset-conformance/output.log` |
| Dist freshness | `node scripts/verify-dist-fresh.ts` | 0 (`bun 1.4.0 from the repository toolchain … 31/31 targets fresh`) | `verify-dist-fresh/output.log` |

`result.json` holds the index (command, cwd, exit, UTC window, log bytes + sha256) and every
`<gate>/result.json` holds that one row; `capture.sh` re-runs the whole set in one command.
`dist-wiring.txt` records the shipped-artifact check (refusal sentence, boot token, install symbol
present in `dist/index.js`).

## Interpretation notes (deliberate, stated so a verifier can rule on them)

1. **"non-empty string" is read LITERALLY** (`typeof v === "string" && v.length > 0`): a whitespace-only
   `question` or `label` is ALLOWED. The contract says everything its four deny rules do not name is
   allowed, so a trimming rule would be a silent widening of the deny set.
2. **`options: undefined` reads as ABSENT** (allowed). JSON cannot carry `undefined`, and the contract
   keeps a question without `options` legal.
3. **No config knob** was added: the contract asks for deny-only, and a broken question card is never a
   desired outcome, so the rule is always on wherever the row is mounted (same shape as the other three
   guard installs in this row).
4. The guard denies only the name `ask_user_question`; every other tool call passes through untouched.

## What this evidence does NOT prove (honest bounds)

- **No real mount was observed.** The install's wiring is proven at the unit level (the row asks the
  adapter for a guard and hands it the real callback, both directions) and the committed dist is the
  byte-identical product of a canonical pinned rebuild — but "the harness ACCEPTED the registration" is
  only observable in a mounting boot. The repo's live lane for that is
  `node skills/dsh-qa/scripts/preset-conformance.ts` (real run) / `skills/dsh-qa/scripts/bundle-lifecycle.ts`;
  the live run was NOT executed here because it writes its evidence to `evidence/dsh-qa/preset-conformance/<ts>/`,
  OUTSIDE this writer's scope (`evidence/ask-user-guard/guard/**`). The boot token to look for is
  `askUserQuestion=installed` in the `[mpd-roles] team plane:` line.
- **The host render layer is untouched** and remains host-owned; the guard only prevents the shapes it
  denies from dispatching.
- **Denial-reason relay is NOT guaranteed** (measured 2026-10-07, `skills/dsh-qa/scripts/verify-law.ts`):
  a pre-dispatch denial sentence may not reach the model verbatim. D2's prompt paragraph carries the
  construction rule independently of that relay.
- **Not covered by these gates** (other writers/lanes of the wave): `bun run verify:docs`,
  `bun run test:qa`, `node scripts/verify-vendor.ts` (needs the captain's single `skills/**` re-pin), the
  D3 audit script, and the final integration sweep.
