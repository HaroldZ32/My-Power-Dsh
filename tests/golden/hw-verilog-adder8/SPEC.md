# Golden task: hw-verilog-adder8 (Verilog-2001, combinational)

Objective: implement `tests/golden/hw-verilog-adder8/adder8.v`:

```verilog
module adder8(
  input [7:0] a,
  input [7:0] b,
  input cin,
  output [7:0] sum,
  output cout
);
  wire [8:0] wide;
  assign wide = a + b + cin;
  assign sum = wide[7:0];
  assign cout = wide[8];
endmodule
```

Allowed subset (the verifier enforces it): exactly these module/port names and widths;
inputs a/b/cin, outputs sum/cout; one `wire [8:0] wide`; `assign` statements only
(no always, no hierarchy, no non-synth constructs). The expression `a + b + cin` may be
spelled with parentheses, e.g. `(a + b + cin)`.

Acceptance: `python3 tests/golden/hw-verilog-adder8/verify.py` passes (stdlib-Python
restricted combinational evaluator; no iverilog in this sandbox — see suite README).
