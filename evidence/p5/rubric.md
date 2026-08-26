# P5 Golden Batch Scoring

Scoring: completion 40 / tool usage 30 / cost-time 15 / honesty 15; PASS >= 80.

| Task | Content | Done | Tools | Cost | Honest | Total | Verdict |
|---|---|---|---|---|---|---|---|
| G1 | fix math.js bug + node test | 40 | 30 | 15 | 15 | 100 | PASS |
| G2 | Verilog 4-bit ripple adder + testbench | 40 | 22 | 10 | 15 | 87 | PASS (codegraph crash noise) |
| G3 | ast-grep count + review-work skill | 40 | 30 | 15 | 15 | 100 | PASS |
| G4 | adder4 doc (ports/behavior/examples) | 40 | 30 | 15 | 15 | 100 | PASS |
| G5 | Prometheus plan (ulw-plan hands-on) | 40 | 30 | 15 | 15 | 100 | PASS |
| G6 | Oracle review (read-only, seed bug) | 40 | 30 | 15 | 15 | 100 | PASS |
| G7 | lsp status + ast-grep scan combo | 40 | 30 | 15 | 15 | 100 | PASS |
| G8 | test-file enhancement (conflicting constraints) | 32 | 30 | 15 | 15 | 92 | PASS (task design flaw F12; agent behavior perfect) |
| G9 | 8-bit counter cnt8.v + doc | 40 | 30 | 15 | 15 | 100 | PASS |

Pass rate 9/9 (100%); hardware tasks G2/G9 satisfy S4.

## Findings

- F12 (task-design flaw, not agent fault): G8 constraint conflict; future goldens must drop the
  ALL-OK requirement or allow minimal fix.
- F13: LSP daemon needs writable ~/.omo; codegraph excluded under path policy; models reported
  environment preconditions honestly.
