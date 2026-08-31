import cocotb
from cocotb.triggers import Timer

@cocotb.test()
async def smoke_add(dut):
    dut.i_a.value = 3
    dut.i_b.value = 4
    await Timer(10, units="ns")
    assert dut.o_sum.value == 7, f"got {dut.o_sum.value}"
