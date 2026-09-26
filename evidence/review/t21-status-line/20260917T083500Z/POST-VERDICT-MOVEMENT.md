# POST-VERDICT MOVEMENT (nested beside the sealed t32 record) — one pinned file moved; the verdict's substance re-measured

**Task:** t32 (review of t21) · **Reviewer:** code-reviewer · **Written:** 2026-09-17 after lane A's count correction
`result.json` is NOT edited; verdict and acceptance results untouched.

## What moved

| t32 pinned subject | pinned | now | cause |
|---|---|---|---|
| `self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` | afb3233519db7fac | **1145f15bcc52765c** (mtime 09:02:41Z) | **t37** (completed, lane A) added the SEEDED NEGATIVE CONTROL lane (:460/:483) **and** a second case labelled `t41` (:394, contract-tool refusals) landed in the same window — neither was in my pinned revision |
| `lib/tools.js` | 6021bf6dfce594ed | 6021bf6dfce594ed | SAME |
| `lib/mpd-deltas.js` | 6dce6f1f3598c77b | 6dce6f1f3598c77b | SAME |
| `agent-references/agent-teams-deltas.md` | 8716eaf51b0e32b8 | 8716eaf51b0e32b8 | SAME |

## Re-verified on the CURRENT bytes (measured, not inherited)

* **My render driver re-run** (`my-render-REV2.json`): five states (held / not-held / absent / throwing / halt-only), **all four clause checks OK in every one** — the collapse still holds exactly.
* **The current pin file is green**: `bun test ./packages/mpd-agent-teams-plugin/self-fix-tests/tool-boundary-hold-and-contract-seat.test.mjs` → **8 pass / 0 fail, 79 expect() calls**, with BOTH T-19 cases my verdict relied on green AND t37's new seeded lane green ("T-19 SEEDED NEGATIVE CONTROL: the pin's matchers go RED on the restored wave-1 wording") — that lane is a SECOND, independent instrument for the same inverted guarantee my own revert proved (5 pass / 2 fail).
* **The frame-level assertion lane A pointed at is verified by me** in the current file, line 170: `expect(read.frame, \`hold read from an unexpected frame: ${read.frame}\`).toContain("scheduler.js")` over EVERY recorded `isHeld` read — so "the display read gates nothing; the dispatch reader stays in scheduler.js" is a shipped executed assertion, not only my source reading (it was inside the 7-test revision I ran too).
* **Counts, with UNIT and REVISION** (the discriminator lane A taught): self-fix dir **109 pass / 0 fail across 15 FILES**; plugin **266 / 0 across 39 FILES**; pin file **8 tests / 79 expects** now vs 7 / 67 at my pin. The FILE census is identical (15 / 39) in both revisions, so the test count is what distinguishes them — a number is only meaningful with its unit and the revision it was taken on.

## Consequence

The verdict's SUBSTANCE holds on the current revision (re-measured above), but **a file it pinned changed twice**. Per the captain's rule, the route to a verdict on the NEW revision is a NEW review task (new attempt) — this page is the movement record, not a re-review; the t32 pass remains the verdict for the revision it names.
