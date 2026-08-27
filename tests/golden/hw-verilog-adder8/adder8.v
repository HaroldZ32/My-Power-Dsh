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
