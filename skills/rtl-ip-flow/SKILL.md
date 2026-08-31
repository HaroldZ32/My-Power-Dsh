---
name: rtl-ip-flow
description: "Four-stage RTL IP design workflow for the rtl-ip agent-teams roster profile: requirements analysis (Socratic clarification) → specification (user manual from templates/user-manual.md, manual review gate) → code design (RTL + detail design manual from templates/detail-design.md + verification code and verification plan from templates/verification-plan.md, consistency-gated with spec-diff rollback) → dual-track design verification (functional track per user manual, coverage track per design manual). Use whenever an agent-teams run starts with --profile rtl-ip, or any RTL IP work needs the staged manual-first flow with user-review gates."
metadata:
  short-description: four-stage RTL-IP flow with user-manual gates and dual-track verification
---

# rtl-ip-flow

Stage discipline for the `rtl-ip` agent-teams roster profile. This skill is the
agent-facing execution contract for the captain and every member; section 7 of
AGENTS.md (QA discipline) and the mpd-verif/mcp tools stay authoritative for tool
invocation.

## Profile

The `rtl-ip` profile (bundle patch, agent-teams row) instantiates these normal-named
members — pick per stage; reviewers needed only at gates:

| Member | Stage | Writes files |
| --- | --- | --- |
| Requirement Analyst | 1 requirements | no (question list + summary only) |
| Spec Designer | 1→2 handoff + 2 spec | yes (req spec + user manual) |
| RTL Code Engineer — Verilog/SV | 3 code | yes (RTL + detail design) |
| RTL Code Engineer — SpinalHDL | 3 code | yes (Scala RTL + detail design) |
| Verification Engineer | 3 (parallel) + 4 verify | yes (TB + verification plan) |
| Reviewer | gates + stage-4 review support | no (findings only) |
| Plan Reviewer | spec/detail consistency review | no |

## Stage 0 — opening questions (before any work)

Ask the user once, batch together:

1. HDL language: **Verilog/SV** (code goes to RTL Code Engineer — Verilog/SV; code style
   contract = `rtl-codestyle` skill) or **SpinalHDL/Chisel** (code goes to RTL Code
   Engineer — SpinalHDL; follow the SpinalHDL conventions the user project already uses,
   e.g. RDC patterns: no hardware-computed parameters, no precision-losing resize,
   split register fields, doc-sync-after-every-change).
2. Verification backend: **open-source** (cocotb + verilator coverage), **VCS**
   (UVM + urg/FSDB via `mpd_verif_uvm`), or **auto-adapt** (probe `mpd_verif_backends`
   and pick the available lane).

Record both answers in the requirements summary; they are binding for the whole run.

## Stage 1 — Requirements (Requirement Analyst)

- Read the user's request text and any input documents for the IP.
- Ask **Socratic** clarification questions (what problem, which features, interface and
  bus, register model, clock/reset, performance expectations, non-goals, acceptance
  criteria) until the intent is unambiguous. Route every question to the user through
  the captain in one consolidated batch.
- Output: question list + answers summary + the requirements summary the Spec Designer
  will formalize. Do not write files; do not start any design.

## Stage 2 — Specification (Spec Designer)

- First settle `templates/req-spec.md` (requirements spec) from the answers.
- Then write the **user manual** strictly per `templates/user-manual.md` (sections,
  register overview + per-register tables, access semantics, software-config scenarios
  without code, block diagram).
- **Gate 1 (manual, non-optional)**: deliver the manual to the user, halt, and wait for
  the user's review/confirmation. No code work may start before the user confirms. If
  the user requires changes, revise the manual and show it again; repeat until
  confirmed.

## Stage 3 — Code design (chosen code engineer + Verification Engineer in parallel)

- RTL code engineer: implement the IP per the user manual; keep the code style contract
  (`rtl-codestyle` for Verilog/SV; project SpinalHDL conventions for Scala). After the
  code is complete, write the **detail design manual** per
  `templates/detail-design.md`, mapping every module/interface/state machine/parameter
  to its code location (no code in the manual).
- Verification engineer (parallel): write the **verification code** and the
  **verification plan** (`templates/verification-plan.md`) deriving functional test
  points from the user manual.
- **Consistency rule**: the detail manual and the code must carry **no non-essential
  difference** versus the user manual. If a real divergence is found (feature,
  interface, register, or behavior): **stash the current work** (git stash / copy the
  stage-3 files aside), **re-run stage 2** to correct the user manual, get the updated
  manual confirmed, then return and redo stage 3. Never paper over the divergence.
- **Gate 2 (manual)**: deliver code + detail manual + verification code/plan to the
  user and the verification review; halt and wait for confirmation. The verification
  engineer reports the manual-vs-code consistency check results first.

## Stage 4 — Verification (Verification Engineer, dual-track)

- **Track 1 — functional track** (per user manual): run the functional verification per
  the verification plan (cocotb lane or UVM lane per backend choice), every scenario
  from the manual's software-config section covered; all cases PASS.
- **Track 2 — coverage track** (per detail design manual): collect and report coverage
  — open-source: `mpd_verif_coverage backend=verilator merge/report`; VCS:
  `mpd_verif_uvm merge-cov` (urg) + `fsdbreport` where available; the coverage plan
  targets in the verification plan must be met or justified.
- Report dual-track results (functional + coverage) with evidence paths; if the
  coverage misses reveal a document-code mismatch, go back per the stage-3 consistency
  rule instead of silently relaxing the target.

## Consistency checklist (every gate)

- User manual ↔ requirements spec: every Req has a manual section; no orphan sections.
- Detail manual ↔ code: interface list, module hierarchy, FSM states/transitions,
  parameters, clock/reset domains one-to-one.
- Verification plan ↔ user manual: every manual feature point and every config
  scenario has at least one test case id; every coverage item cites a design-manual
  section.
- All human-facing deliverables of the flow are Chinese; agent-facing logs/commit
  messages stay English.
