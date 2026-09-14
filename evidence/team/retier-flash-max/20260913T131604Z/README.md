# retier-flash-max — the 5 ex-pro MPD team members moved to flash + max effort

## Change

The members of the `mpd` team profile whose default route was the pro tier are retiered to
the flash tier with an explicit `reasoning_effort: max` (the highest effort this deployment
exposes: `off` / `low` / `high` / `max`):

| member | before | after |
|---|---|---|
| Architect | `deepseek-v4-pro` | `deepseek-v4-flash` + `reasoning_effort: max` |
| Planner | `deepseek-v4-pro` | `deepseek-v4-flash` + `reasoning_effort: max` |
| Reviewer | `deepseek-v4-pro` | `deepseek-v4-flash` + `reasoning_effort: max` |
| Lead | `deepseek-v4-pro` | `deepseek-v4-flash` + `reasoning_effort: max` |
| Senior Engineer | `deepseek-v4-pro` | `deepseek-v4-flash` + `reasoning_effort: max` |
| Plan Reviewer (fallback tier) | `deepseek-v4-pro` | `deepseek-v4-flash` |

The other six members already defaulted to the flash tier and keep their previous
(unspecified) effort, so the target model resolves its own default for them.

Two surfaces were retiered (the owner chose both):
- **A** `packages/mpd-bundle/cordis.patch.yml` — the `mpd` team profile members.
- **B** `packages/mpd-roles-plugin/src/roles.data.ts` — the one-shot roster chains
  (`mpd_role_spawn`). B deliberately carries **no** effort: a roster chain entry is
  `{provider, model}` only, and the probe route passes provider/model to the spawn seam.
  A one-shot spawn therefore inherits the captain's effort when the route matches and
  otherwise takes the target model's default (documented in `docs/user-guide.md`).

## Verified hashes

| file | sha256 |
|---|---|
| `packages/mpd-bundle/cordis.patch.yml` | `7dbedcc6b557dc75d0a3a080020d51331087435b72bebbd25a95ba7e18320b04` |
| `packages/mpd-roles-plugin/src/roles.data.ts` | `1bb3240476a7409cba83f20ea291bc1ec97a010b886091f7b4f9f6bac52cc53c` |

Both lanes below ran on these hashes; the hash was re-read after a 5 s settle window and was
unchanged (AGENTS.md §7 "verify on settled hashes").

## Lane 1 — row-config conformance against the real loader schema (`verify-profile.mjs`, bun)

Reads the agent-teams row config out of the real bundle patch and runs it through the real
plugin module: `Config(row.config)` is the function the loader runs for that row, and
`resolveTeamProfile(..., "mpd", maxMembers)` is what `agent_teams_create(profile:"mpd")`
runs. **26/26 checks pass**, including:
- the row is accepted by the loader schema (a wrong member key would abort the row at boot);
- all five ex-pro members resolve to `deepseek-v4-flash` + `reasoningEffort: max`;
- the six others keep `reasoningEffort` undefined;
- no member routes to the pro tier at all (primary or fallback);
- the roster (surface B) keeps exactly one pro reference — Plan Reviewer's fallback tier.

Negative control (must fail): the same schema **rejects** `reasoning_effort: 42`
(measured: `$.profiles.mpd.members[0].reasoning_effort expected string but got 42`).
RED control: re-run against `HEAD`'s pre-change patch → **15/26**, failing exactly on the five
"model flash" and five "reasoningEffort max" checks plus the pro-tier scan
(`raw/result.json`).

## Lane 2 — isolated MOUNT boot (`boot-verify.mjs`, bun)

Boots the real bundle in a sandbox (`DSH_HOME` + `HOME` + workspace all under `mktemp`;
the real `~/.dsh` is never touched) with the agent-teams row re-stated verbatim from the
patch, and mounts a probe row that resolves the member routes through the **real `llm`
service** — the same resolution the plugin performs right before creating a member.
- 11 profile members observed in the live boot, the five ex-pro ones with `effort=max`;
- `resolveCallConfig({provider:"deepseek-official", model:"deepseek-v4-flash",
  reasoningEffort:"max"})` → `ok … effort=max`;
- 0 apply-crash signatures (`invalid config` / `failed to apply loader entry` /
  `unsupported JSON schema` / `did not activate`);
- negative control rejects an illegal effort:
  `does not support reasoning effort "bogus-effort"`.

RED control: the same boot against `HEAD`'s pre-change patch reports the five members as
`model=deepseek-v4-pro effort=undefined` (`raw/boot.RED.log`, `raw/boot-result.RED.json`).

`--dump-config` was **not** used as load evidence: it composes rows without executing plugin
code (AGENTS.md §4).

## Gates run

| gate | result |
|---|---|
| `bun test packages` | 298 pass / 0 fail |
| `bun run typecheck` (tsgo) | clean |
| `bun run test:qa` (all `--self-test`) | all self-tests passed |
| `node scripts/verify-vendor.mjs` | PASS |
| `node skills/dsh-qa/scripts/preset-conformance.mjs --self-test` | ok: 30 harness rows conform, row parity 31/31 |

`bun test packages/mpd-roles-plugin` was red before this change's test update (two
assertions pinned `deepseek-v4-pro` as the oracle primary) and green after — the test
update rides in the same change, per the gate rule.

## Take-effect caveat

The running `dsh` process loaded the patch layer at session start, so this configuration
only takes effect **after the dsh process is restarted** (AGENTS.md §12: an edit on disk is
not hot-reloaded into a live session). An already-staged team plan also snapshots the routes
it was staged with.

## Files

- `verify-profile.mjs` / `verify-profile.log` — lane 1 driver + run log (run with **bun**).
- `boot-verify.mjs`, `probe.mjs`, `boot.log`, `boot-result.json` — lane 2 driver, mounted
  probe, boot log and structured result (run with **bun**).
- `raw/` — RED controls (`boot.RED.log`, `boot-result.RED.json`, `result.json`) and the
  migration script that applied the retier (`migration-script.mjs`).
