# Persona provenance

Every text under `personas/<internal-key>.md` is this repository's own prose, written for the mpd-dsh
roster in its own voice. Each one states the role's duty, the read-only or write-capable discipline the
roster enforces for it, and what it must report — including that it must never claim a check it did not
run (AGENTS.md §4, the verification law in §5).

**Nine texts were modelled on permissively licensed public agent prompts.** "Modelled on" means the
seed supplied the shape of the discipline — what such a role checks, in what order, and what it hands
back; the wording here is new and no seed text is redistributed. The mechanical check is in
`evidence/de-omo/personas/20261008T163931Z/analysis/overlap-final.log`: the longest word run shared
between a persona and its seed is four generic words, and the longest run shared with the previous
(SUL-1.0) text is a role-name opening or a repository path.

**Two texts have no upstream model at all** — Vision Analyst and Junior Engineer were written here from
the role's declared duty.

| Role (addressed by NAME) | Persona file | Seed repository | Seed path at the pinned revision | Licence | Copyright |
|---|---|---|---|---|---|
| Architect | `oracle.md` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) | `plugins/code-modernization/agents/architecture-critic.md` @ `f713a7c59b729741282f9c2d9a04e28e2abbd20c` | Apache-2.0 | Apache-2.0 `LICENSE` fetched verbatim; the repository states no copyright line and carries no `NOTICE` file at that revision |
| Researcher | `librarian.md` | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | `categories/10-research-analysis/research-analyst.md` @ `721e9734670bfaf7283194e234ebb88e94c82dcd` | MIT | `Copyright (c) 2025 VoltAgent` |
| Planner | `prometheus.md` | [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2) | `src/resources/agents/planner.md` @ `33c00aaffa56e5d394bccce1c8df59fb842e84c5` | MIT | `Copyright (c) 2026 Lex Christopherson` |
| Deep Worker | `hephaestus.md` | [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2) | `src/resources/agents/worker.md` @ `33c00aaffa56e5d394bccce1c8df59fb842e84c5` | MIT | `Copyright (c) 2026 Lex Christopherson` |
| Senior Engineer | `sisyphus.md` | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | `categories/01-core-development/fullstack-developer.md` @ `721e9734670bfaf7283194e234ebb88e94c82dcd` | MIT | `Copyright (c) 2025 VoltAgent` |
| Lead | `atlas.md` | [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) | `categories/09-meta-orchestration/multi-agent-coordinator.md` @ `721e9734670bfaf7283194e234ebb88e94c82dcd` | MIT | `Copyright (c) 2025 VoltAgent` |
| Explorer | `explore.md` | [jayminwest/overstory](https://github.com/jayminwest/overstory) | `agents/scout.md` @ `ff38f3f76f084abcc34f519bcaa69580f6e53cf1` | MIT | `Copyright (c) 2026 Jaymin West` |
| Reviewer | `metis.md` | [obra/superpowers](https://github.com/obra/superpowers) | `skills/requesting-code-review/code-reviewer.md` @ `8ca22dba9a94f28898bbce59f2537ff4d87c747d` | MIT | `Copyright (c) 2025 Jesse Vincent` |
| Plan Reviewer | `momus.md` | [VeryGoodOpenSource/vgv-wingspan](https://github.com/VeryGoodOpenSource/vgv-wingspan) | `skills/shared/references/plan-review.md` @ `19e0695accb8b9db0be0235ecdfb7fcb23106820` | MIT | `Copyright (c) 2026 Very Good Ventures` |
| Vision Analyst | `multimodal-looker.md` | — none — | — | — | written here; no upstream model |
| Junior Engineer | `sisyphus-junior.md` | — none — | — | — | written here; no upstream model |

The licence files were fetched verbatim at those revisions; their sha256 values, the fetched seed files
and the fetch manifest are under `evidence/de-omo/personas/20261008T163931Z/`. Two further candidate
seed repositories were inspected and **not** used (their material appears in no persona):
`wesammustafa/opencode-primer` (MIT) and `davepoon/buildwithclaude` (MIT).

## What this replaces

Before wave D these eleven files carried prose adapted from
[`code-yeongyu/oh-my-openagent`](https://github.com/code-yeongyu/oh-my-openagent) (SUL-1.0, the base
recorded in `VENDOR_LOCK.json` as historical provenance). That prose is gone: the longest word run any
persona still shares with its pre-wave-D text is its own role-name opening and the `.mpd/plans/<slug>.md`
path convention. The mechanism did not move — same file names, same `readPersona` loader, same stable
ids, same roster contract (AGENTS.md §13).
