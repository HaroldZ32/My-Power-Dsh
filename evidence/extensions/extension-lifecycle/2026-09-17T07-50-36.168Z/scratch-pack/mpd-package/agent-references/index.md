# agent-references — on-demand reference material

Agent-facing, English-only reference files for the repository manual `AGENTS.md`. They live outside
the instruction-file discovery path (no `AGENT.md`/`AGENTS.md`/`CLAUDE.md` here), so they are never
auto-injected: an agent opens them when `AGENTS.md`'s "Reference Index (on-demand)" section, or a
pointer inside `AGENTS.md`, sends it here.

This tree is agent-facing, not human-facing: the bilingual rule does not apply, no `*.zh-CN.md`
twin is required, and `bun run verify:docs` does not discover these files.

In a packed artifact (`dist/mpd-package/`) there is no `AGENTS.md` and no Reference Index: the
pointers above do not resolve there, so each file in this tree stands alone — the two moved bodies
keep their `§N` provenance lines as historical citations of the repository manual, not links.

| File | Holds |
|---|---|
| `troubleshooting.md` | the full symptom → cause/fix table (former `AGENTS.md` §12 body) |
| `agent-teams-deltas.md` | the adopted agent-teams delta registry — the A1–D42 table, registry mechanics, live region count, wave-2 driver-script warning (former `AGENTS.md` §6 body) |
