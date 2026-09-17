# NOT VERIFIED (nested beside the sealed t32 record) — what this review did NOT establish

**Task:** t32 (review of t21) · **Reviewer:** code-reviewer · **Written:** 2026-09-17 at the captain's request
The verdict and its 6 acceptance results are untouched; this page names the gaps explicitly, so that a reader of the report cannot mistake an unmeasured surface for a verified one.

## NOT verified by me, with the reason and what stands in for it

1. **NO mounted `dsh` boot.** Every t32 reading is in-process against the SHIPPED module (my render driver) or the shipped pin. The *registration* reading is the plugin-level tool map from my driver (20 `agent_teams_*` names) plus lane C's `holds-lifecycle` pin — **not** a harness session's own tool list. I judged a mounted tool-list reading NOT REQUIRED because the acceptance's clause is triggered by a REMOVAL and no tool was removed; that is a stated judgement, not a measured absence. (Instrument note from t14: the `team-watchdog-boot` lane records no tool list; the session log's `request/header.data.header.tools[]` would be the instrument if anyone wants it.)
2. **The PACKED artifact.** `dist/mpd-package` still carries the pre-edit README pair until the captain's single re-pack. I judged the SOURCE pair (inherited from t14) and did **not** verify the packed bytes.
3. **The real watchdog service's `isHeld` wiring.** My render used a STUB service (held / not-held / absent / throwing). Whether the real service returns the live-vs-durable view lane C describes is verified under t14, not here.
4. **The watchdog's OWN `session-watchdog-status` rendering.** Not re-measured by me in t32; lane C's arm 12 covers registration, and t14 measured that tool's one-mechanism reporting.
5. **The three surfaces t14 already verified** — the tool DESCRIPTIONS (arm 11), the exactly-three-tools pin (arm 12), and the doc pair. I re-measured only the tool LIST (fresh runtime dump); the others rest on t14's pin plus the unchanged file hashes, not on a fresh reading of mine.
6. **The author's exact fixture string.** t21's output quotes `hold hold-7f3a …`; I did not reproduce THEIR fixture. I reproduced the clauses with my own fixture (hold id `hold-review-1`, a different timestamp/reason), so their exact quoted string is unverified by me — the SHAPE and the clauses are verified, the bytes of their example are not.
7. **The `A1–D42` pointer range.** `bun run verify:docs` passes with the derived arm green (`carried 81/9 vs derived 81/9`), which covers the REGION-COUNT claim; I did **not** re-read the pointer range text in `AGENTS.md` / `agent-references/index.md` myself.
8. **Live end-to-end behaviour in a real session** (a real captain turn rendering the status line against a real team with a real watchdog hold): unverified. My readings are the shipped render path's output and the shipped execute's payload, driven in-process.

## What IS verified (one line each, for balance)

Rendered line and payload in five states (held / not-held / absent / throwing / halt-only), all four ruling clauses in each; the old two-peer wording and the deferral ABSENT everywhere; diagnostics present (id, ISO since, reason, release verb) and degraded states explicit; the pin REDDENS on my own revert (5 pass / 2 fail, both T-19 cases) with both readings kept; the tool lists measured at runtime and via the shipped pin; the schema declaration (`parameters: {}`, `output.schema additionalProperties: true`) and t21's three regions in registry AND source; `--check` exit 0 (81/9) and `verify:docs` exit 0 (derived=3); the shipped revision stable across PIN-1/PIN-2.
