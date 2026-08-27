module mux4(
  input logic [1:0] sel,
  input logic [3:0] a0,
  input logic [3:0] a1,
  input logic [3:0] a2,
  input logic [3:0] a3,
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
