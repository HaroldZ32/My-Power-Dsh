# adder4 — 4-bit 行波进位加法器（Ripple-Carry Adder）

源文件：`tests/golden/fixtures/verilog/modules/adder4.v`

`adder4` 是一个可综合、符合 Verilog-2001 的 4 位行波进位加法器。它由 4 个
全加器级联而成，低位级的进位输出逐位"行波"传递到高位级的进位输入，
不使用算术运算符实现加法本身，进位链结构显式可见。

**功能**：`{cout, sum} = a + b + cin`

## 端口表

| 端口 | 方向 | 位宽 | 说明 |
|---|---|---|---|
| `a` | input | 4 | 操作数 A（被加数） |
| `b` | input | 4 | 操作数 B（加数） |
| `cin` | input | 1 | 进位输入（用于级联扩展或初始进位） |
| `sum` | output | 4 | 4 位和结果（`a + b + cin` 的低 4 位） |
| `cout` | output | 1 | 进位输出（无符号加法时的溢出标志） |

## 行为说明

- 加法结果由内部 5 位进位链 `carry[4:0]` 与 4 位 `sum` 共同构成：
   `carry[0]` 绑定模块输入 `cin`，`carry[4]` 驱动模块输出 `cout`。
- 每个全加器级 `i`（0 为最低位 LSB，3 为最高位 MSB）满足：

  ```
  sum[i]     = a[i] ^ b[i] ^ carry[i]
  carry[i+1] = (a[i] & b[i]) | (a[i] & carry[i]) | (b[i] & carry[i])
  ```

- 各级以连续赋值（`assign`）描述，级间通过显式进位线相连，纯组合逻辑、
  无时序状态，可直接综合。

### 使用注意事项

- `cout` 仅表示无符号加法溢出（结果 ≥ 16）。
- 对补码（有符号）运算，`cout` 不能直接作为溢出标志；如需检测符号溢出，
  应比较最高位进位（`carry[3]` 与 `carry[4]`）是否一致。
- 级联扩展：将低模块的 `cout` 接到高模块的 `cin`，即可拼接成更宽的加法器。

## 简单用法示例

```verilog
module top (
    input  wire [3:0] a,
    input  wire [3:0] b,
    input  wire       cin,
    output wire [3:0] sum,
    output wire       cout
);

    // 例化 adder4 完成 4 位带进位加法
    adder4 u_adder4 (
        .a    (a),
        .b    (b),
        .cin  (cin),
        .sum  (sum),
        .cout (cout)
    );

endmodule
```

### 级联示例（8 位加法器）

```verilog
module adder8 (
    input  wire [7:0] a,
    input  wire [7:0] b,
    input  wire       cin,
    output wire [7:0] sum,
    output wire       cout
);

    wire carry_mid;

    adder4 u_low (
        .a    (a[3:0]),
        .b    (b[3:0]),
        .cin  (cin),
        .sum  (sum[3:0]),
        .cout (carry_mid)
    );

    adder4 u_high (
        .a    (a[7:4]),
        .b    (b[7:4]),
        .cin  (carry_mid),
        .sum  (sum[7:4]),
        .cout (cout)
    );

endmodule
```
