// ============================================================================
// adder4.v -- 4-bit ripple-carry adder (Verilog-2001)
// ----------------------------------------------------------------------------
// Golden task G2: implement a 4-bit ripple-carry adder with well-commented,
// synthesizable, Verilog-2001-compliant source.
//
// Function:  {cout, sum} = a + b + cin
//
// Structure: four chained full-adder stages. The carry-out of stage i feeds
// the carry-in of stage i+1, so the carry "ripples" from the LSB to the MSB.
// The full adder is described behaviorally with continuous assignments;
// no arithmetic operator is used for the addition itself, which keeps the
// ripple structure explicit and readable.
// ============================================================================

module adder4 (
    input  wire [3:0] a,     // operand A
    input  wire [3:0] b,     // operand B
    input  wire       cin,   // carry-in (for chaining or initial carry)
    output wire [3:0] sum,   // 4-bit sum result
    output wire       cout   // carry-out (overflow flag for unsigned add)
);

    // Internal carry chain. carry[0] is the module's carry-in; carry[4] is
    // the module's carry-out. Stage i receives carry[i] and produces
    // carry[i+1] together with sum[i].
    wire [4:0] carry;

    // ------------------------------------------------------------------------
    // Full adder stage i:
    //   sum[i]   = a[i] ^ b[i] ^ carry[i]
    //   carry[i+1] = (a[i] & b[i]) | (a[i] & carry[i]) | (b[i] & carry[i])
    // ------------------------------------------------------------------------
    assign carry[0] = cin;

    assign {carry[1], sum[0]} = a[0] + b[0] + carry[0]; // stage 0 (LSB)
    assign {carry[2], sum[1]} = a[1] + b[1] + carry[1]; // stage 1
    assign {carry[3], sum[2]} = a[2] + b[2] + carry[2]; // stage 2
    assign {carry[4], sum[3]} = a[3] + b[3] + carry[3]; // stage 3 (MSB)

    assign cout = carry[4];

endmodule
