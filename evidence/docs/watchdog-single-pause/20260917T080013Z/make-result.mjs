// Builds result.json for t20 (T-19 docs half). Kept beside the evidence so the record is reproducible.
import { writeFileSync } from "node:fs";

const out = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const result = {
  task: "t20 — B3/T-19: the watchdog README pair must document ONE pause mechanism (EN + zh-CN)",
  attempt_id: "42397927-f48b-4f83-b3ca-629dc08a6059",
  owner: "docs-parity-engineer (lane B3)",
  generated_at: new Date().toISOString(),
  head: "c826f16",
  user_ruling_quoted:
    "T-19 — `agent_teams_halt` becomes the SOLE external mechanism; the watchdog's PRESERVING hold is demoted to its internal implementation. Surface, tools and docs expose one mechanism.",
  before_after: {
    "packages/mpd-team-watchdog-plugin/README.md": {
      removed: [
        ":294-295 — the hold bullet's last sentence: `It is NOT \\`agent_teams_halt\\` (which cancels every non-terminal task).`",
        ":321-327 — the T-19 section body: `A team can be paused two ways: \\`agent_teams_halt\\` … this package's own **preserving** hold. \\`session-watchdog-status\\` prints the **union** and names which one is active — … vs \\`team-a: PAUSED — held (watchdog hold)\\` … No new resume verb is introduced: the two clears stay distinct …`",
      ],
      replacement:
        ":292-295 now states the hold is the **INTERNAL implementation** and `agent_teams_halt` is the ONE external pause; :321-327 now states ONE external pause (`agent_teams_halt`, cleared by `agent_teams_resume`), the preserving hold as its internal implementation, and `session-watchdog-status` reporting ONE pause state (`team-a: PAUSED — mechanism: agent_teams_halt (external) · watchdog preserving hold: internal implementation active` vs `team-a: not paused`) plus `pause: {paused, mechanism, implementation, halted, held}` in the JSON with `halted`/`held` as diagnostics",
      lines_before_after: "456 → 456 (no line shift; the heading tree and the T-19 heading are unchanged)",
    },
    "packages/mpd-team-watchdog-plugin/README.zh-CN.md": {
      removed: [
        ":247 — 它不是 `agent_teams_halt`（后者会取消所有未终结任务）。",
        ":268-273 — 团队可以被两种方式暂停：`agent_teams_halt`（会**取消**所有未终结任务）与本包自己的**保留式** hold。… 打印两者的**并集**并指明谁在生效 … 两种清除保持各自独立 …",
      ],
      replacement:
        ":245-247 now states 它是团队暂停的**内部实现**——唯一的外部暂停是 `agent_teams_halt`; :268-273 mirrors the EN paragraph (外部暂停只有一种 … 唯一外部机制 … `pause: {paused, mechanism, implementation, halted, held}`，其中 `halted`/`held` 只是诊断字段)",
      lines_before_after: "384 → 384 (no line shift)",
    },
  },
  wording_matches_the_LIVE_implementation_by_symbol: {
    "src/actions.ts · HOLD_TOOL description":
      "the INTERNAL implementation of a team pause, not a second pause mechanism: the external pause a user operates is `agent_teams_halt` …",
    "src/actions.ts · STATUS_TOOL render":
      "`<team>: PAUSED — mechanism: agent_teams_halt (external) · watchdog preserving hold: internal implementation active|none` / `<team>: not paused`",
    "src/actions.ts · status execute pause object":
      "pause = { paused, mechanism: 'agent_teams_halt', implementation: held ? 'watchdog-hold' : 'none', halted, held }",
    "src/index.ts header":
      "the preserving hold is the INTERNAL implementation; the external pause mechanism a user … (T-19: `agent_teams_halt` is the one)",
  },
  tools_still_registered: {
    claim: "no tool-schema change, and the prose claims no removal",
    proof: [
      "src/actions.ts: `dsh.registerTool` blocks for the hold, status and resume tools; the three names occur 7 times in the file",
      "dist/index.js: all three names present (session-watchdog-hold, session-watchdog-status, session-watchdog-resume)",
      "README tool table rows for `session-watchdog-hold` / `session-watchdog-resume` / `session-watchdog-status` are unchanged",
      "git: my only changes are the two README files; every other modified path under that package is lane C (t10) in-flight work",
    ],
  },
  gate: {
    command: "bun run verify:docs",
    exit: 0,
    reading:
      "pairs=37 failed=0 violations=0 exempt=17 derived=3 — PASS, with the pair line `ok   packages/mpd-team-watchdog-plugin/README.md` (switch link, heading tree, real CJK all checked by the gate)",
  },
  hashes: {
    "README.md before (git HEAD, == the pre-edit working tree)":
      "bd887558cdc833db0bae1e3c8a1a6a0ea130636c0d7dbb8447f01b9044d24793",
    "README.md after": "ffece49fd8820f9b26a07d14de41c325c51c45ebba79d307d85361426eed12a3",
    "README.zh-CN.md after": "e09a021bdaf52000f797dd574ff8148dee244995f81a7c168c76d63da695d7b2",
  },
  bounds: [
    "Affected pages only: no src/**, dist/**, test/** or package.json edit was made by t20 (the other modified paths in that package belong to lane C / t10, in flight).",
    "The packed artifact (dist/mpd-package/**) still carries the pre-edit README pair; t18's single re-pack absorbs it — the same named handoff as agent-references/index.md.",
    "T-19's other surfaces are separate tasks: the status line (t21) and this README pair (t20); this task is the docs half only, and it quotes the ruling rather than re-deriving it.",
  ],
  post_repack_acceptance: {
    hard: "ZERO `[verify-pack-closure] FAIL` lines on a PLAIN run — the verdict rule is PER COMMAND (exit code plus the command own success marker). CAVEAT: the closure own `--self-test` log carries FAIL lines BY DESIGN (`expectedFailLines = 16`), so a bare `grep FAIL` over a self-test log is a false red.",
    discriminating:
      "At the re-pack moment the `expected-after-pack` set contains NONE of the five files our lanes changed after the 05:19:48.265Z stamp — `EXTENSIONS-FOR-AGENTS.md` ABOVE ALL, whose absence is the durable signal under the standing no-post-re-pack-edit rule; the other four (`agent-references/index.md`, `agent-references/agent-teams-deltas.md`, `packages/mpd-team-watchdog-plugin/README.md`, `packages/mpd-team-watchdog-plugin/README.zh-CN.md`) may legitimately reappear later, when a declared writer lands after the pack.",
    informational:
      "Any surviving `CONTENT-DRIFT-EXPECTED` line must be NAMED with its writer mtime + the artifact stamp. The COUNT is not part of the pass condition.",
    measured_now:
      "2026-09-17T08:04Z — exit 0; 0 FAIL lines; 24 CONTENT-DRIFT-EXPECTED lines, every one carrying `source mtime … is AFTER the artifact stamp`; 0 unnamed; 0 other red/warn classes; all five names present (the pre-re-pack state this check must distinguish from).",
    superseded_first_revision:
      "`grep -c CONTENT-DRIFT-EXPECTED` → expect 0 — STRICTER than the invariant this wave froze: any declared post-pack writer legitimately produces such a line, so a count of 0 would redden on a compliant writer. Refined by lane B2 measurement; see corrections[0].",
  },
  corrections: [
    {
      what: "post_repack_acceptance CHECK, first revision",
      was: "`node scripts/verify-pack-closure.mjs | grep -c CONTENT-DRIFT-EXPECTED` → expect 0",
      corrected_to:
        "three tiers — HARD: zero FAIL lines on a plain run; DISCRIMINATING: the absorbed names absent at the re-pack moment (the root file durably); INFORMATIONAL: every surviving EXPECTED line named with writer + stamp, the COUNT explicitly not part of the condition",
      why: 'The expected class exists precisely because a legitimate writer can land after the pack. A count of 0 does not test the re-pack — it tests "no writer landed after the pack", which the wave cannot promise: a declared post-pack edit produces that line while the gate is still healthy, so judging t18 against a count of 0 would redden a healthy integration.',
      source:
        "refined by lane B2 measurement (citation-checker-engineer) against the wave frozen invariant; the captain confirmed the same form (plan §A8 addendum, t18 contract revision 8). Applied here as a NESTED CORRECTION: the superseded sentence is quoted verbatim in post_repack_acceptance.superseded_first_revision, and the 08:04Z readings were NOT re-run or regenerated.",
    },
  ],
};

writeFileSync(`${out}/result.json`, JSON.stringify(result, null, 2) + "\n");
console.log("result.json written:", `${out}/result.json`);
