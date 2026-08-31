// COMPOSE EXAMPLE (t12 repair evidence): module_skeleton.vinc declarations
// with the aligned fsm_3process.vinc P1/P2/P3 blocks and the
// parameterized_counter.vinc counter block pasted per each fragment's
// insertion-point note. Composition protocol:
//   skeleton header + signal regions (declarations only)
//   -> P1 (next-state) + P2 (state register) in the state-machine region
//   -> counter always block in the counter signal region (single cnt_phase driver)
//   -> P3 (output/task block) in the output processing region
//   -> skeleton output assign bridges
`timescale 1ns / 1ps

module compose_example #(
    parameter C_DATA_WIDTH  = 8,
    parameter C_ADDR_WIDTH  = 8,
    parameter C_COUNT_WIDTH = 4,
    parameter C_RELOAD_VALUE = 128
) (
    input  wire i_clk,
    input  wire i_rstn,
    input  wire i_start,
    input  wire i_valid,
    input  wire [C_ADDR_WIDTH-1:0] i_addr,
    input  wire [C_DATA_WIDTH-1:0] i_wdata,
    output wire o_done,
    output wire o_valid,
    output wire [C_DATA_WIDTH-1:0] o_rdata
);

    localparam ST_IDLE   = 2'd0;
    localparam ST_ACTIVE = 2'd1;
    localparam ST_DONE   = 2'd2;

    reg [1:0] state_current;
    reg [1:0] state_next;
    reg [C_COUNT_WIDTH-1:0] cnt_phase;
    reg flag_busy;
    reg [C_DATA_WIDTH-1:0] reg_acc;
    reg [C_DATA_WIDTH-1:0] rdata_o;
    reg done_o;
    reg valid_o;

// ---- P1: combinational next-state (blocking assignments) ------------------
always @(*) begin
    state_next = state_current;
    case (state_current)
        // IDLE state transition branch
        ST_IDLE: begin
            if (i_start && !flag_busy) begin
                state_next = ST_ACTIVE;
            end else begin
                state_next = ST_IDLE;
            end
        end
        // ACTIVE state transition branch
        ST_ACTIVE: begin
            if (cnt_phase == {C_COUNT_WIDTH{1'b0}}) begin
                state_next = ST_DONE;
            end else begin
                state_next = ST_ACTIVE;
            end
        end
        // DONE state transition branch
        ST_DONE: begin
            state_next = ST_IDLE;
        end
        // Default state transition branch
        default: begin
            state_next = ST_IDLE;
        end
    endcase
end

// ---- P2: sequential state register (non-blocking) -------------------------
always @(posedge i_clk or negedge i_rstn) begin
    if (!i_rstn) begin
        state_current <= ST_IDLE;
    end else begin
        state_current <= state_next;
    end
end

// ---- counter processing (single driver of cnt_phase) -----------------------
always @(posedge i_clk or negedge i_rstn) begin
    if (!i_rstn) begin
        cnt_phase <= {C_COUNT_WIDTH{1'b0}};
    end else if (state_current != state_next) begin
        cnt_phase <= C_RELOAD_VALUE[C_COUNT_WIDTH-1:0];
    end else if (cnt_phase != {C_COUNT_WIDTH{1'b0}}) begin
        cnt_phase <= cnt_phase - 1'b1;
    end
end

// ---- P3: independent output/task processing -------------------------------
always @(posedge i_clk or negedge i_rstn) begin
    if (!i_rstn) begin
        flag_busy <= 1'b0;
        done_o    <= 1'b0;
        valid_o   <= 1'b0;
    end else begin
        case (state_current)
            // IDLE state task branch
            ST_IDLE: begin
                flag_busy <= 1'b0;
                done_o    <= 1'b0;
                valid_o   <= 1'b0;
            end
            // ACTIVE state task branch
            ST_ACTIVE: begin
                flag_busy <= 1'b1;
                reg_acc   <= reg_acc + i_wdata;
            end
            // DONE state task branch
            ST_DONE: begin
                flag_busy <= 1'b0;
                done_o    <= 1'b1;
                valid_o   <= 1'b1;
                rdata_o   <= reg_acc;
            end
            // Default state task branch
            default: begin
                done_o    <= 1'b0;
                valid_o   <= 1'b0;
            end
        endcase
    end
end

    assign o_done  = done_o;
    assign o_valid = valid_o;
    assign o_rdata = rdata_o;

endmodule
