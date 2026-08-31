# RTL IP Design Flow Guide

[中文](./rtl-ip-flow-guide.zh-CN.md)

The `rtl-ip` agent-teams roster profile wraps a four-stage, gated RTL IP design
workflow. This guide explains how to start it and what each stage delivers.

## Starting the flow

```
/agent-teams --profile rtl-ip <describe your IP with whatever you have: a sentence, a doc, a spec snapshot>
```

The captain will first ask you two opening questions (one batch):

1. **HDL language** — Verilog/SV (code engineer uses the `rtl-codestyle` contract)
   or SpinalHDL/Chisel (code engineer follows your project's Scala conventions).
2. **Verification backend** — open-source (cocotb + verilator coverage), VCS
   (UVM + urg/FSDB), or auto-adapt (probe the available lanes).

Answers are binding for the whole run. Both answers can be changed later only by
restarting the flow.

## The four stages

| Stage | Owner | Deliverables | Gate |
| --- | --- | --- | --- |
| 1. Requirements | Requirement Analyst | Socratic question list + answers + requirements summary (read-only) | user answers all questions |
| 2. Specification | Spec Designer | requirements spec + **user manual** (per `user-manual.md` template) | **Gate 1 — your manual review (halt)** |
| 3. Code design | RTL Code Engineer (chosen lane) + Verification Engineer (parallel) | RTL code + **detail design manual** (per `detail-design.md` template, one-to-one with code) + verification code + **verification plan** (per `verification-plan.md` template) | **Gate 2 — user + verification review (halt)**; spec-diff rollback |
| 4. Design verification | Verification Engineer | dual-track report (functional + coverage) with evidence | all cases PASS + coverage targets met |

## Gates and the rollback rule

- **Gate 1**: the user manual is delivered, the team halts, and nothing is coded
  until you confirm the manual. Revision loops repeat the manual, not the code.
- **Gate 2**: code + detail manual + verification code/plan are delivered for your
  and the verification review; the team halts again.
- **Consistency rule**: the detail design manual and the code must carry **no
  non-essential difference** from the user manual. On a real divergence the team
  stashes the stage-3 files, re-runs stage 2 to correct the user manual, gets it
  confirmed, then returns and redoes stage 3 — it never patches around a divergence.

## Dual-track verification

- **Track 1 — functional** (per user manual): every feature point and every
  software-config scenario from the manual gets test cases; all pass.
- **Track 2 — coverage** (per detail design manual): line/FSM/condition coverage
  targets from the verification plan are collected and reported
  (verilator coverage merge/report on the open-source lane, VCS `urg` + fsdbreport
  on the VCS lane).

## Template package

All four document templates ship inside the `rtl-ip-flow` skill:

- `templates/req-spec.md` — requirements specification
- `templates/user-manual.md` — user manual (structure from your sample format)
- `templates/detail-design.md` — detail design manual (structure from your sample format)
- `templates/verification-plan.md` — verification plan (functional + coverage targets)

## Notes

- Deliverables to humans are Chinese; agent-facing logs/commits stay English.
- The flow reuses the existing `rtl-codestyle` (Verilog style contract) and
  `rtl-verif` (cocotb/UVM scaffolding) skills and the `mpd_verif_*` tools.
- A previously confirmed manual is the source of truth; a changed decision means
  re-running stage 2 and then re-doing stage 3.
