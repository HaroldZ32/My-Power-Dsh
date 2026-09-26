
## Reference Index (on-demand)

The manual's bulk reference material lives in `agent-references/` — **agent-facing, English-only**
files (the bilingual rule above covers human-facing docs only; `bun run verify:docs` does not
discover this tree). They are deliberately NOT named `AGENT.md` / `AGENTS.md` / `CLAUDE.md`, so the
workspace instruction loader never injects them: **open them on demand** when a pointer here or in
a section sends you there. `§1`–`§13` of this manual stay in place, so every `§N` citation from
code, scripts and docs still resolves.

| File | Holds | Open it when |
|---|---|---|
| `agent-references/troubleshooting.md` | the full symptom → cause/fix table (the former body of §12, moved verbatim 2026-09-17 by the T-22 instruction-budget split) | a boot, gate, tool or team behaviour is wrong — look the symptom up before inventing a fix |
| `agent-references/agent-teams-deltas.md` | the adopted agent-teams delta registry: the A1–D26 adaptation table, the registry mechanics (context-pair addressing, `--write-registry`), the live region count and the two unpatched wave-2 driver scripts | you touch `packages/mpd-agent-teams-plugin/**`, `scripts/patch-agent-teams-fixes.mjs`, `scripts/vendor-agent-teams.mjs`, or an `mpd-delta` region |

