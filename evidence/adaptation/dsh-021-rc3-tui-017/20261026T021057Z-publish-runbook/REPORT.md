# T10 — publish runbook sync (staged publish, approval step, two stale statements)

UTC stamp: 2026-10-26T02:10Z. Branch `release/v0.15.5`. Sole writer for T10.

Truth source read BEFORE writing: `.github/workflows/publish.yml` (whole header + the mode resolution),
`schema` of the workflow inputs (`tag`, `stage_id`, `dist_tag`), the stage/approve steps and the npm ≥ 11.6
guard; `dist/mpd-package/package.json` (reads `0.15.5`).

## 1. `CONTRIBUTING.md` — "## Publishing to npm"

The two-line `npm publish --dry-run` / `npm publish --access public` block is gone; the local check is now
`npm pack --dry-run`, followed by the real ceremony. Final bytes (excerpt):

> ```bash
> npm pack --dry-run        # the whole tarball, minus the upload
> ```
>
> **Publishing is the workflow's job, never a local command.** `.github/workflows/publish.yml` is the one
> publish path: a `v*` tag push packs the tree and runs `npm stage publish --access public` — a STAGE, so
> the version is not public yet and `latest` has not moved — and a human then runs `npm stage approve
> <stage-id>`, which publishes it and applies the dist-tag. That approval is a SECOND
> `workflow_dispatch` of the same workflow with `stage_id` set to the id the run printed (`npm stage
> list`): the run's OIDC token can stage but cannot approve, because approval carries the 2FA
> proof-of-presence. Approve in ascending version order — approving an older stage last would move
> `latest` backward — then confirm the registry actually serves the version before announcing it.

Kept untouched: the `files`/`publishConfig` paragraph above and the `verify-plugin-manifest --pack`
sentence (its subject was `npm publish --dry-run` only by adjacency; the property is identical for
`npm pack --dry-run`, which is what the sentence now follows).

## 2. `CONTRIBUTING.zh-CN.md` — "## 发布到 npm"

Same three fixes in Chinese, same meaning, same block order: `npm pack --dry-run` replaces the
`npm publish --dry-run` line and the `npm publish --access public` line; the 摘要 paragraph now names
`npm pack --dry-run`; and the staged lane is stated in one paragraph (workflow path, STAGE vs APPROVE,
`workflow_dispatch` + `stage_id`, OIDC cannot approve, ascending order, verify propagation).

## 3. `AGENTS.md` §11 — ONE pointer step (MOVE-FIRST, per the amendment)

`git diff AGENTS.md` is exactly these three added lines, nothing else:

```
5. **Publish — a human step.** The `v*` tag push STAGES the release on npm; nothing is public and
   `latest` does not move until a human runs `npm stage approve <stage-id>`. Runbook:
   `agent-references/installer-and-profiles.md`, "Publishing to npm".
```

**Measured bytes (the amended budget question):**

| Measurement | Value |
|---|---|
| `wc -c AGENTS.md` before this task | 63902 |
| `wc -c AGENTS.md` after (observed) | **64158** |
| delta | **+256 bytes** |
| hard cut (`agent-instructions.config.maxBytes`) | 65536 → margin **1378 B** |
| repo's 2 KB-margin guidance target | 63536 → **over by 622 B** |

The guidance target was ALREADY unreachable before this task (63902 > 63536 by 366 B), so the +256 B made
an existing overrun larger, not a new one; the file stays 1378 B under the hard cut, which is what makes
it load untruncated. Per the amendment I did NOT trim unrelated sections. If the captain wants 63536, the
file needs ~622 B of same-section compression (candidates I did not touch: §11 step 2's duplicated gate
enumeration, which §4 already carries, or the §12 T-5x bullet list, which troubleshooting.md owns) — a
separate, explicit decision.

## 4. `agent-references/installer-and-profiles.md` — new "Publishing to npm (the staged lane)"

Appended after the legacy `install-profile.ts` flow (agent-facing, English-only — the docs gate does not
discover this tree). It carries the full detail: the `push: tags: ["v*"]` trigger; the tag/manifest guard
before anything is packed; `npm pack --pack-destination /tmp/npm-pack` then `npm stage publish --access
public --tag <dist_tag>`; the SECOND `workflow_dispatch` with `stage_id` running `npm stage approve
<stage_id>`; why the OIDC token cannot approve (2FA proof-of-presence; short-lived tokens may drive
`npm stage publish` / `npm publish` only); how to get the stage id (`npm stage list`, printed by the
run); ascending-version approval and the `dist_tag` backfill escape; the post-approval registry check
(`npm view @mpd-dsh/mpd version` + a fresh `dsh plugin add`) before announcing; and that a hand-run
`npm publish` has no valid credential (trusted publisher path = this workflow).

## 5. `docs/development.md` §6 + `docs/development.zh-CN.md` §6 — new step 7

Existing steps 1-6 (and 1-6 in zh) are byte-identical; the approval step is appended as step **7**, so no
existing reference is invalidated. I grepped for references to that list's "step 6" first
(`development.md.*step 6`, `§6 step 6`, zh variants): none exist. EN excerpt:

> 7. Publish — a HUMAN step after the tag push: `.github/workflows/publish.yml` STAGES the release on
>    npm (`npm pack` then `npm stage publish --access public --tag latest`), so nothing is public yet;
>    `npm stage approve <stage-id>` is what publishes it and moves `latest`. The stage id comes from the
>    run's own `npm stage list` output, and the approval is a SECOND `workflow_dispatch` of that
>    workflow carrying `stage_id` — the run's OIDC token can stage but cannot approve (2FA
>    proof-of-presence). Approve in ascending version order, then verify the registry serves the
>    version before announcing.

The zh twin says the same in 6 lines.

## 6a. `.github/workflows/publish.yml` header — history, not present tense

Lines 3-7 reframed (the rest of the header untouched):

```
# WHY THIS FILE EXISTS — npm LAGGED BEHIND GITHUB WHEN THIS WORKFLOW WAS WRITTEN, SO TWO RELEASES WERE
# OWED. At that time `@mpd-dsh/mpd` was public on registry.npmjs.org at 0.12.0 ONLY, while GitHub had
# shipped v0.13.0 and v0.13.1 (master c6b86e03, annotated tags, Release pages): the registry was behind
# the repository, and `dsh plugin --profile web add @mpd-dsh/mpd` still resolved the old version. This
# workflow is the ONE path that closed that gap, and the path every later release uses too — the
# registry serves 0.15.4 today (measured 2026-10-25), and this workflow is how it gets there.
```

The `0.15.4 (measured 2026-10-25)` figure is the manual's own §8 measurement, not a re-measurement.

## 6b. `docs/plan-webui-tui-i18n.md` — packed-version literal

`dist/mpd-package/package.json` `0.15.4` → `0.15.5`, and the measurement date moves with it
(`measured 2026-10-25` → `2026-10-26`, the instant I read the file). File is a declared
English-only process record (`docs/plan-*.md`), so no zh twin.

## Gates — commands and OBSERVED results

| Command | Exit | Observed |
|---|---|---|
| `bun run verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `node scripts/verify-manual-paths.ts` | 0 | `PASS resolved=154 over-report=74 under-report=78 declared=2` |
| `node scripts/verify-workflows.ts` | 0 | `audited 3 workflow file(s)` · `PASS - every workflow is loadable YAML with a sane job/step shape` |
| `wc -c AGENTS.md` | — | `64158 AGENTS.md` |

Logs: `01-docs.log`, `02-manual-paths.log`, `03-workflows.log`, `04-agents-bytes.log` (the wc line),
`05-final-bytes.log` (status, diffstat, AGENTS diff, hashes).

Final hashes @2026-10-26T02:11:06Z: `CONTRIBUTING.md` `443f2e1b66f6692458011c784d8a015c` ·
`CONTRIBUTING.zh-CN.md` `f1085a02d9107b6708bbeb349e113905` · `AGENTS.md`
`7a81d7ac0554599990ebfae02df2379e` · `docs/development.md` `80e92e8197cf87349b95028fecba0bcd` ·
`docs/development.zh-CN.md` `015c6097c30c4c35bbee478a99991aaa` · `docs/plan-webui-tui-i18n.md`
`9ff1dbb8741531cf651f145b01e208c4` · `.github/workflows/publish.yml`
`86b88c31fe4431a3b124b2bdbbd9aec4` · `agent-references/installer-and-profiles.md`
`0884ff93bf67a83c81e5f0bb699401c5`.

## Bounds

- Touched exactly the eight files in the declared scope (plus this evidence directory). Nothing else moved:
  `git status --porcelain` over those paths lists exactly them.
- Deliberately NOT touched: `AGENTS.md` §8's `LIVE on the registry at 0.15.4 (measured 2026-10-25)` line
  (the captain updates it after the publish), the README version table and "current release" sentences,
  every CHANGELOG history entry, package versions, `dist/**`.
- NOT run: `verify:rows`, `verify:comments`, `verify-dist-fresh`, `verify:manifest`, `verify:pack-closure`,
  `typecheck`, `bun test`, the Docker lanes. The change is prose plus one workflow comment; the three gates
  T10 named are the ones that cover it.
- The AGENTS.md `Reference Index` row for `installer-and-profiles.md` still describes only "the full §8
  body"; it now also holds the publish runbook. I left it alone to avoid a second injected-byte increase —
  the §11 step 5 pointer names the file AND the section, so discoverability holds.
