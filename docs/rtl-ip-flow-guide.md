# RTL IP Design Flow Guide

[中文](./rtl-ip-flow-guide.zh-CN.md)

The `rtl-ip` agent-teams roster profile wraps a four-stage, gated RTL IP design
workflow. This guide explains how to start it and what each stage delivers.

## The flow (four swimlanes × milestone gates)

Aligned with the four-swimlane product flow — 产品市场 / 系统设计 / 数字设计 / 数字验证 —
with milestone tags 规格设计 IP01 → 代码设计 IP05 → 设计验证 IP08 → IP 发布 IP10.

| Milestone | Digital design lane | Digital verification lane | Review gates (halt) |
| --- | --- | --- | --- |
| 需求阶段 (no milestone) | 需求制定 (user) + 需求分析 (Requirement Analyst): 需求说明书/应用场景/可行性报告/需求追踪表 | — | 🔶 需求评审 (user + Reviewers) |
| 规格设计 IP01 | 内部用户手册 + DFMEA 初版 (Spec Designer) | 验证计划 + 验证方案 (Verification Engineer) | 🔶 规格评审 + 🔶 验证评审 |
| 代码设计 IP05 | RTL 代码 + 详细设计 (RTL Code Engineer, chosen lane) | 环境开发 → 用例开发 → 验证调试 (验证报告 + 验证手册) | 🔶 设计评审 + 🔶 验证评审 |
| 设计验证 IP08 | 缺陷解决 (fix defects) | 回归验证 (dual-track: functional + coverage) | — |
| IP 发布 IP10 | 设计发布 (内部/外部用户手册) + 缺陷分析 (缺陷报告 + Buglist) | — | 🔶 发布评审 + 🔶 缺陷评审 |

All diamond gates are manual: the team halts and waits for your confirmation
(and the verification review at the design/validation gates) before continuing.

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

## Gates and the rollback rule

- **Every 🔶 diamond is a manual gate**: the team halts and waits for your
  confirmation (plus the verification review at the design/validation gates).
  Revision loops repeat the documents — never the code.
- **Consistency rule**: the detail design manual and the code must carry **no
  non-essential difference** from the internal user manual. On a real divergence
  the team stashes the stage-3 files, re-runs the specification stage to correct
  the manual, gets it confirmed, then returns and redoes stage 3 — it never
  patches around a divergence.

## Dual-track verification

- **Track 1 — functional** (per user manual): every feature point and every
  software-config scenario from the manual gets test cases; all pass.
- **Track 2 — coverage** (per detail design manual): line/FSM/condition coverage
  targets from the verification plan are collected and reported
  (verilator coverage merge/report on the open-source lane, VCS `urg` + fsdbreport
  on the VCS lane).

## Template package

All eight document templates ship inside the `rtl-ip-flow` skill:

- `templates/req-spec.md` — requirements spec pack (需求说明书/应用场景/可行性报告/需求追踪表)
- `templates/user-manual.md` — internal + external user manual (product-manual granularity)
- `templates/dfmea.md` — DFMEA initial
- `templates/detail-design.md` — detail design manual (one-to-one with code)
- `templates/verification-plan.md` — verification plan + scheme
- `templates/validation-report.md` — validation report (dual-track results)
- `templates/validation-manual.md` — validation manual (how to rerun)
- `templates/defect-report.md` — defect report + Buglist

## Notes

- Deliverables to humans are Chinese; agent-facing logs/commits stay English.
- The flow reuses the existing `rtl-codestyle` (Verilog style contract) and
  `rtl-verif` (cocotb/UVM scaffolding) skills and the `mpd_verif_*` tools.
- A previously confirmed manual is the source of truth; a changed decision means
  re-running stage 2 and then re-doing stage 3.
