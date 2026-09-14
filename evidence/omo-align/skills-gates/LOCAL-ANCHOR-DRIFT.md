# Local-anchor drift note — t4 revision fv4 vs the landed session-start gate

Status: **additive note. Nothing in the fv4 deliverable was modified.**
Purpose: record that the LOCAL `file:line` anchors inside the frozen t4 revision **fv4** describe the
**pre-implementation** tree, because t5's implementation (`mpd-delta session-start-gate`) has since
landed in the working tree. A verifier re-reading fv4 against today's tree would find the cited line
numbers pointing at different constructs.

Author: Researcher (read-only). Authored as a new artifact precisely because the t4 rule added after
the fv1 overwrite is: **a scored/held revision is never refreshed in place** — renewed evidence gets a
NEW revision tag (fv5), never an edit of fv4
(`evidence/omo-align/skills-gates/REVISIONS.md`).

## 1. Measured state (as of this note; hashes are the anchor)

| file | sha256 (16) | bytes | mtime |
|---|---|---|---|
| `packages/mpd-agent-teams-plugin/lib/session-start.js` | `d20fe0f055218e83` | 24 079 | 21:58:27 |
| `packages/mpd-agent-teams-plugin/lib/index.js` | `c1b170e8c9e92dcc` | 37 783 | 21:59:05 |
| `packages/mpd-bundle/cordis.patch.yml` | `9ee189972b2b8706` | 21 008 | 21:59:55 |
| `presets/mpd/agent.cordis.yml` | `125312b54b2c20e6` | 23 437 | 22:00:28 |
| `skills/dsh-qa/scripts/session-start-team.mjs` | `eff65edf4297a027` | 11 844 | 22:01:46 |
| `scripts/install-profile.mjs` | `37e9c291930d0c07` | 21 977 | 22:00:06 |

The four implementation files were still being edited while this note was written (mtimes 21:58–22:01,
QA case changed **between two reads inside a single verification pass**). Any verdict that needs these
anchors must be taken on a SETTLED revision hash (AGENTS.md §7), not on a single read — this note is a
drift record, **not** a verification verdict.

## 2. Anchor mapping: fv4 citation → current construct

| fv4 cited anchor (pre-implementation) | today (post-gate) |
|---|---|
| `session-start.js:1-40` (module contract) | unchanged concept; module doc now describes the gate (`:8` "agent/pre-step waterfall") |
| `session-start.js:47-48` `DEFAULT_TEAM_NAME` | `session-start.js:68` |
| `session-start.js:50` `STARTUP_NOTICE_MARKER` | `session-start.js:70` |
| — (no gate) | `session-start.js:72-93` gate constants (`DELIVERABLE_VERB_PATTERN`, `ACTION_VERB_PATTERN`, `ENUMERATED_LINE_PATTERN`, `CLAUSE_*`, `DELIVERABLE_VERB_MIN=4`, `ENUMERATED_LINE_MIN=3`, `ACTION_VERB_MIN=3`, `MATCHED_SIGNAL_MIN=2`, `PLANS_DIR`) |
| — (no gate) | `session-start.js:139` `consumeExplicitFlag`, `:156` `evaluateComplexityGate`, `:213` `consumeFlagFromMessage` (the `team:` prefix is consumed) |
| `session-start.js:62-64` `policyEnabled` | `session-start.js:235` |
| — (no `autoRoute`) | `session-start.js:241` `autoRouteEnabled` |
| `session-start.js:71-84` `policyQualifies` | `session-start.js:250` |
| `session-start.js:123-168` `provisionSessionTeam` | now later in the file; provisioning description `:313` ("Auto-routed by the complexity gate") |
| `session-start.js:174-187` `provisionedNotice` | `session-start.js:355` (now takes `signals`) |
| `session-start.js:194-203` `instructNotice` | `session-start.js:376` |
| `session-start.js:212-218` `spliceNotice` | `session-start.js:394` |
| `session-start.js:229-269` `installSessionTeamPolicy` | `session-start.js:436`; the gate call site is `:416-419` |
| `index.js:87-98` `sessionTeamPolicy` schema (mode default off) | `index.js:105`; resolved defaults `:225-230` (now incl. `autoRoute ?? true`) |
| `cordis.patch.yml:218-224` row `sessionTeamPolicy` (mode: auto) | `cordis.patch.yml:242-249` (**`mode: off`** + **`autoRoute: true`**); `stateDir: .mpd/team` at `:205` |
| `presets/mpd/agent.cordis.yml:80-102` "every session MUST start inside a team" + sizing | `presets/mpd/agent.cordis.yml:80` ff. — the startup text is now gate-worded |
| `skills/dsh-qa/scripts/session-start-team.mjs:85,87,129,133` (assert `mode auto`) | assertions now pin the opposite: `:86` gate presence, `:88` `mode: off` + `autoRoute: true`, `:142` home patch; SKILL.md case row is two-sided (SIMPLE ⇒ no team/no notice; COMPLEX/`team:` ⇒ exactly one staged team + notice) |
| `scripts/install-profile.mjs:177,261-262` (assert `mode === "auto"`) | `scripts/install-profile.mjs:183` writes `{mode:"off", autoRoute:true, …}`; `:269-270` asserts `mode === "off"` + `autoRoute === true` |

Unaffected by this drift: **all upstream citations** (the beta.62 checkout at `d1557a4b4` is unchanged)
and the **10 Table B skill rows** (t5 writes no `skills/**`; per `D_SKILLS_WRITER` only the two QA
anchors move in this wave).

## 3. Consequence for each fv4 row

- Rows whose LOCAL side cites `session-start.js` are anchor-stale: `D1-activation`, `D8-routing-doctrine`,
  `T3-01-default-state`, `T3-02-enable-surface`, `T3-03-tool-availability`, `T3-04-activation-trigger`,
  `T3-05-auto-routing`, `T3-06-notice-surface`, `T3-08-closure` (and `T3-07` where it cites the roster row).
- Their **"gap" reading is still historically accurate** (it described the pre-gate tree, which is what
  t2/t3 enumerated), so the row set and verdicts do not need to change; only the anchor strings are stale.
- Where fv4 said "no mechanical trigger / unconditional provisioning", the current tree now implements the
  frozen gate — that is a **state change**, and the two rows `T3-04-activation-trigger` and
  `T3-05-auto-routing` (and `T3-01-default-state`) are the rows whose *current-state* answer has moved
  from "gap" toward "implemented". Confirming that is t6/t7's job on settled hashes; this note only
  records the anchors and the observation.

## 4. What must NOT happen

- Do not edit `gap.json` / `gap-verdict-table.md` (fv4) in place to "freshen" the line numbers — that is
  exactly the fv1 defect this wave already suffered (see `REVISIONS.md`).
- If a refreshed revision is wanted, cut **fv5** with a new immutable snapshot
  (`revisions/fv5-<UTCstamp>/`) and say so explicitly; keep the rolling LIVE copies under the captain's
  dual-write ruling untouched until then.
