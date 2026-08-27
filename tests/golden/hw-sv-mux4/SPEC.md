# Golden task: hw-sv-mux4 (SystemVerilog, combinational)

Objective: implement `tests/golden/hw-sv-mux4/mux4.sv`:

```systemverilog
module mux4(
  input logic [1:0] sel,
  input logic [3:0] a0, a1, a2, a3,
  output logic [3:0] out
);
  always_comb begin
    case (sel)
      2'd0: out = a0;
      2'd1: out = a1;
      2'd2: out = a2;
      default: out = a3;
    endcase
  end
endmodule
```

Allowed subset (enforced by verifier): module mux4, ports as above, one `always_comb begin
case (sel) ... endcase end` block with exactly the 2'd0/2'd1/2'd2/default arms assigned
from a0/a1/a2/a3. No hierarchy, no sequential constructs.

Acceptance: `python3 tests/golden/hw-sv-mux4/verify.py` passes.
