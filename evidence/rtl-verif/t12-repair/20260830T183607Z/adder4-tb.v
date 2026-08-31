module tb;
  reg [3:0] a, b; reg cin;
  wire [3:0] sum; wire cout;
  adder4 dut(.a(a), .b(b), .cin(cin), .sum(sum), .cout(cout));
  initial begin
    a = 4'd3; b = 4'd4; cin = 1'b0; #1;
    $display("3+4+0 = %d, cout=%b", sum, cout);
    if (sum !== 4'd7 || cout !== 1'b0) $fatal(1, "semantic mismatch");
    a = 4'd15; b = 4'd1; cin = 1'b0; #1;
    $display("15+1+0 = %d, cout=%b", sum, cout);
    if (sum !== 4'd0 || cout !== 1'b1) $fatal(1, "carry mismatch");
    $finish;
  end
endmodule
