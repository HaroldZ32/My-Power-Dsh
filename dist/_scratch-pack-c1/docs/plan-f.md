# plan-f — OMO agents as subagents + AGENT.md convention + mpdConfig wiring

Date: 2026-08-28. Branch: feature/plan-f-roles-subagent (dev). English.

## Motivation

The first-pass review (initialization audit, earlier session) flagged structural
issues that were left as findings. This plan resolves them and applies two
architecture decisions from the user:

1. **Every project must attempt to read AGENT.md.** `dsh-agent-instructions` is
   already mounted by dsh-base but disabled at profile level by dsh-web-app; the
   shipped presets mount their own instance with default candidates
   (AGENTS.md/CLAUDE.md). The bundle therefore ships a single main preset `mpd`
   whose agent-instructions row configures
   `instructionFileCandidates: [AGENT.md, AGENTS.md, CLAUDE.md]` and whose
   persona makes the convention explicit.
2. **The OMO-origin agents become subagents.** The 11 standalone presets
   (oracle/librarian/prometheus/explore/metis/momus/atlas/hephaestus/sisyphus/
   sisyphus-junior/multimodal-looker) are removed. Their personas + model chains
   are extracted into a subagent ROSTER (`mpd-roles-plugin`): `mpdRoles` service,
   `mpd_roles_list`, `mpd_role_spawn` (persona + route + read-only write-deny
   toolFilter), `mpd_role_persona` (text for surfaces like
   `agent_teams_add_member`). `mpd_team_spawn` members resolve roster roles;
   `mpd_modelchain_resolve` reads chains from the roster (DEFAULT_CHAINS kept as
   fallback). Team members can spawn specialists themselves.
3. **All previously reported design/doc issues get fixed** — see the change list.

## Changes

- `scripts/gen-roles.mjs` (new): one-time generator — preset personas →
  `packages/mpd-roles-plugin/personas/<id>.md`, metadata+chains →
  `src/roles.data.ts`. **[removed]**: the script was deleted (2026-08-28) —
  roster data is now static `roles.data.ts`; no regeneration step remains.
- `packages/mpd-roles-plugin` (new): roster plugin + tools + tests (7 pass).
- `packages/mpd-team-plugin`: roster-backed member roles (persona/model/toolFilter),
  stateDir via mpdConfig (`team.stateDir`).
- `packages/mpd-modelchain-plugin`: chains from mpdRoles service,
  mpd.jsonc overlay (`modelchain.<key>`), fallback preserved.
- `packages/mpd-bootstrap-plugin`: ships the `mpd` preset (copied from the
  shipped `standard` preset, adapted) under `presets/mpd/`; copies it (filter
  now accepts `mpd`) and the skill corpus to `$DSH_HOME`; comment drift fixed.
- Removed: `packages/omo-hephaestus` (naming violation, skeleton, unshipped),
  `packages/mpd-presets-plugin`, `packages/mpd-qa-preset-probe` (replaced by
  `packages/mpd-qa-roles-probe`).
- `packages/mpd-qa-roles-probe` (new, QA-only): asserts the mpd preset resolves
  and mpdRoles serves the 11-role roster.
- mpdConfig wiring (mpd.jsonc now actually consumed): mpd-memory
  (memory.vcs/dir/agentSlug/reflectionEvery), mpd-team (team.stateDir),
  mpd-hashline (hashline.*), mpd-comment-checker (commentChecker.*),
  mpd-ulw (ulw.*), mpd-boulder (boulder.dir), mpd-modelchain
  (modelchain.<chainKey>). mpd-config row moved first in the bundle patch.
- Bundle patch: mpd-roles row added; header/order updated.
- QA corpus: `preset-register.ts` rewritten (mpd preset + roster probe, runtime
  overlay substitution — no committed checkout-absolute paths); `team-route-rewire.mjs`
  and `relocate-smoke.ts` de-hardcoded (`MPD_DEV_ROOT` fallback = repoRoot,
  default preset `mpd`); `tests/overlays/*` templates path-free.
- Skill corpus: `persona="mpd-<role>"` tokens (25) replaced by the
  `mpd_role_persona`/`mpd_role_spawn` pattern; mechanism prose in ulw-plan /
  ulw-execute / ulw-research / review-work / refactor / debugging
  references updated to the roster surfaces.
- Cleanups: codegraph duplicate env candidate removed; verify-vendor switched
  from `find` to node-only enumeration + helpful `MPD_UPSTREAM_ROOT` error;
  pack-mpd dead mpd-skills-plugin replacement removed + personas/presets
  asset paths updated; all workspace package versions aligned to 0.2.3.
- Docs: AGENTS.md (layout tree, §1 subagent convention, §6 bootstrap exception,
  §8 vendored agent-teams + mpd preset, §12 AGENT.md/roster troubleshooting,
  §13 roster glossary), README.md, bundle README.

## Gates & evidence

- tests: bun test packages (31 pass incl. 7 roster tests) + tsgo typecheck clean
- QA self-tests: mount-assert + preset-register + team-route-rewire + relocate-smoke --self-test
- installer dry-run; boot check (isolated DSH_HOME, staged bundle dump-config
  asserts mpd-roles row; roles probe real boot)
- evidence: `evidence/plan-f/roles-subagent/<ts>/`, `evidence/dsh-qa/preset-register/<ts>/`

## Follow-ups

- Web-panel team members (adopted agent-teams) consume roster personas via
  `mpd_role_persona`; the docs/skills now say so.
- The OMO preset dirs are deleted; personas are assets under mpd-roles-plugin —
  regenerate with `node scripts/gen-roles.mjs` after a persona/chain change.
  **[superseded]**: `gen-roles.mjs` was removed (2026-08-28); personas/chains are
  maintained directly in `packages/mpd-roles-plugin` assets and `roles.data.ts`.