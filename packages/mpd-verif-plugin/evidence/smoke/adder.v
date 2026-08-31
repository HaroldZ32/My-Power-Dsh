module adder (
    input  logic [7:0] i_a,
    input  logic [7:0] i_b,
    output logic [8:0] o_sum
);
    assign o_sum = i_a + i_b;
endmodule
