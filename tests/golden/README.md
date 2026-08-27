# my-power-dsh golden suite (Plan F W3+)

Grade the leaf/team executor path with small, deterministic, multi-language tasks.
Each task directory has: SPEC.md (objective + acceptance + allowed subset), a verifier
(declared in task.json `verify`), and a solution written either by the agent under test
or by hand. Runner: `node tests/golden/run.mjs [--task <id>]` (exit 1 on any failure).
Status: COMPLETE — 5/5 PASS; soft-ts-tokenizer and hw-verilog-adder8 were implemented by the
real executor leaf (mpd_leaf_iterate, mpd-sisyphus base, gates bun-test/golden:<task>) in
Plan F golden QA; the rest are hand solutions. Evidence: evidence/plan-f/w3/golden-leaf/.

| id | domain | language | verifier |
|---|---|---|---|
| soft-ts-tokenizer | software | TypeScript (bun test) | bun test |
| soft-py-minijson | software | Python 3 (stdlib) | unittest |
| soft-c-ringbuf | software | C11 (gcc -Werror) | compile + run |
| hw-verilog-adder8 | hardware | Verilog-2001 | stdlib-Python RTL evaluator |
| hw-sv-mux4 | hardware | SystemVerilog | stdlib-Python RTL evaluator |

NOTE: no HDL simulator is installable in this sandbox (no root, no pip, no iverilog);
the two hardware verifiers evaluate a RESTRICTED combinational subset (assign /
always_comb + case, bitvector arith) with Python's stdlib only. Industrial simulation
is a follow-up.
