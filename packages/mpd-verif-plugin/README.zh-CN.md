# mpd-verif-plugin

[English](./README.md)

my-power-dsh 的统一 RTL 验证插件（Plan A 验证侧）。一个插件、三种后端 ——
**iverilog / verilator / vcs** —— 通过 `MPD_DSH_VERIF_*` 环境变量或 `PATH`
解析（永不捆绑二进制产物）：开源后端走** cocotb 通道**并严格执行项目本地
虚拟环境隔离铁律；**UVM 方法学通道仅限 VCS**；**波形读取钩子**在检测到用户
已接入的 wave-mcp / TraceWeave MCP 工具时调用它们，未接入时优雅降级并给出
一键安装命令。

## 工具

| 工具 | 用途 |
| --- | --- |
| `mpd_verif_venv` | 管理项目本地 cocotb 虚拟环境：`status`（默认）/ `create` / `info` |
| `mpd_verif_backends` | 探测 iverilog/verilator/vcs 可用性（env → PATH）、版本、vcs 许可证提示 |
| `mpd_verif_compile` | 全量编译出仿真二进制，从日志中尽力解析诊断 `{file,line,severity,code,message}` |
| `mpd_verif_lint` | 独立 lint 检查：iverilog `-g2012 -tnull -Wall` / verilator `--lint-only -Wall` / vcs `-lca -sverilog +lint=all` |
| `mpd_verif_sim` | iverilog/verilator 上的 cocotb 仿真，走 **cocotb Makefile 流**：生成 `Makefile`，以 `$VENV/bin` 前置 PATH 调用 `make`，解析 results.xml 得到逐用例状态、收集波形、可选转交 wave-mcp |
| `mpd_verif_coverage` | 独立覆盖率合并/报告：verilator `verilator_coverage`（.dat 合并 + 标注）/ vcs `urg -dir … -report …`；iverilog 明确拒绝（`VERIF_E_UNSUPPORTED`，无原生覆盖率） |
| `mpd_verif_uvm` | **仅限 VCS** 的 UVM 通道：模板布局契约校验 + compile/run/regress/wave/merge-cov/clean |
| `mpd_verif_regress` | 多用例回归（两个通道通用），确定性种子，输出 `results.json` + markdown 报告 |

## 铁律 —— cocotb 虚拟环境隔离

1. 虚拟环境位于 `<workspace>/.venv-rtl`（或 `MPD_DSH_VERIF_VENV`）—— **绝不**使用系统 Python。
2. **只能**通过 `python3 -m venv <path>` 创建（系统解释器唯一的合法用途）。
3. 每个 pip 安装都以 `<venv>/bin/pip install ...` 执行 —— **绝不**使用 `--user`、`--system`、pipx 或系统 pip。
4. 每次仿真都通过生成的 **Makefile** 以 `make` 执行，PATH 前置 `$VENV/bin`（DP-6），保证内部每个 cocotb python 都解析到虚拟环境内的解释器 —— 绝不裸调 `python`。
5. 虚拟环境不存在**或**其中无法 import cocotb 时，`mpd_verif_sim` 拒绝执行（`VERIF_E_NO_VENV` / `VERIF_E_COCOTB_ABSENT`），拒绝信息附带精确的初始化命令：

```sh
python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"
```

或直接调用 `mpd_verif_venv` 并传 `action: "create"`。

## 后端解析

| 后端 | 环境变量覆盖 | PATH 回退 |
| --- | --- | --- |
| iverilog | `MPD_DSH_VERIF_IVERILOG` | `iverilog` |
| verilator | `MPD_DSH_VERIF_VERILATOR` | `verilator` |
| vcs | `MPD_DSH_VERIF_VCS` | `vcs` |

工作状态落在 `<workspace>/.mpd/verif/`（或 `MPD_DSH_VERIF_WORK`）。插件绝不
触碰 `~/.dsh`。

## 错误分类

所有结构化拒绝都返回 `{ ok:false, error:{ code, message, hint } }`：
`VERIF_E_NO_BACKEND` · `VERIF_E_NO_VENV` · `VERIF_E_COCOTB_ABSENT` ·
`VERIF_E_UNSUPPORTED` · `VERIF_E_LICENSE` · `VERIF_E_ENV` · `VERIF_E_COMPILE` ·
`VERIF_E_RUN` · `VERIF_E_TIMEOUT` · `VERIF_E_TEMPLATE`。编译失败附带解析出的
诊断；UVM 编译失败有重试上限（3 次），耗尽后如实写出 `work/unresolved.md`。

## 通道门禁（Owner 决策）

- `mpd_verif_sim` = cocotb 通道，**仅 iverilog | verilator**。传
  `backend: "vcs"` → `VERIF_E_UNSUPPORTED` 并指向 `mpd_verif_uvm`（双向硬门控，
  按 owner 决策）。
- `mpd_verif_uvm` = UVM 方法学通道，**仅 VCS**（无 backend 参数）。它校验模板
  布局契约（`<ip>/{rtl,script,tb,top,test,work}`、`tb/tb_api_primitives.svh`
  共享 BFM 单一事实源、`test/<case>_test.sv` 命名、必备 `sanity_test` +
  `reg_access_test`），并按 makefile 式契约编排：
  `-ntb_opts uvm-1.2`、逐用例 `work/work_<case>_/` 目录、
  覆盖率 `-cm line+cond+tgl` + `urg` 合并、fsdb 波形运行（受
  `VERDI_HOME`/`NOVAS_HOME` 门禁），并附 **fsdbreport 非 GUI 验证 hook**
  （波形运行后对 FSDB 做完整性/警告报告，经
  `MPD_DSH_VERIF_FSDBREPORT` / `VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` / PATH 解析）。
  插件本身**不携带任何模板内容** —— 丰富的 cocotb/UVM 骨架位于
  `skills/rtl-verif` 能力库。方法学仅参考 gen-tb-skill 的**结构**与
  raysalemi/uvmprimer 的**模式**；**不复用两者的任何代码**。

## 波形读取钩子

sim/regress/uvm 运行后，插件会把产出的波形交给已注册的用户 MCP 工具；
未注册则优雅降级并给出可执行的提示：

- OSS 通道（`.fst`/`.vcd`）→ `mcp__wave_mcp__prepare_session`（wave-mcp；
  传 `out_dir`、`wave_path`、`top`）。会话目录 = `$DSH_HOME/wave-mcp`
  （或 `MPD_DSH_WAVE_MCP_SESSION`），按团队决策 DP-8。
- VCS 通道（`.fsdb` + 日志）→ `mcp__traceweave__get_sim_paths`（TraceWeave；
  传 `verif_root`、`case_name`、`sim_log`、`wave_file`）。

建议接线（完整说明见团队文档）：

```sh
# wave-mcp（FST/VCD 通道）—— 专用虚拟环境
python3 -m venv ~/.venvs/wave-mcp && ~/.venvs/wave-mcp/bin/pip install wave-mcp
# TraceWeave（VCS/FSDB 通道）—— 独立虚拟环境（与 wave-mcp 的 MCP SDK 版本冲突）
python3 -m venv ~/.venvs/traceweave && ~/.venvs/traceweave/bin/pip install traceweave-mcp
```

## 环境备注（本机实测，2026-08）

- Verilator+cocotb 全链路实测通过（results.xml 解析成功，VCD 波形产出）。
- Verilator FST 是 owner 选定默认值（`traceFst` 默认 **true** →
  `--trace-fst --trace-structs`），但构建期需要 **liblz4 头文件**；没有的机器上
  请设 `traceFst: false` 改用 VCD（wave-mcp 读取时会自动转换 VCD）。缺 lz4 的
  FST 构建失败会以 `VERIF_E_COMPILE` 暴露并附日志路径。
- oss-cad-suite 自带的 Icarus 捆绑了较旧的 glibc；本机上 icarus+cocotb 的
  VPI 通道可能在 `vvp` 阶段因 `GLIBC_2.38` 链接错误失败（除非 python 与
  Icarus 来自同一 glibc 阵营，发行版 iverilog 可用）。在本机请使用 verilator
  通道或发行版 Icarus。
- `MPD_DSH_VERIF_PYTHON3_CMD` 可覆盖仅用于虚拟环境引导（`python3 -m venv`）的
  `python3`，例如默认 shim 指向某个 SDK python 时。
- 单元测试用**伪二进制（fake-vcs 参数捕获）**与伪项目虚拟环境覆盖全部通道；
  真实工具冒烟脚本位于包内 `evidence/smoke/`（用
  `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs` 重跑）。

## 开发

```sh
bun test packages/mpd-verif-plugin   # 单元测试（伪工具，无需真实 EDA）
bun run typecheck                    # 仓库门禁
bun build src/index.ts --target node --format esm --outfile dist/index.js
```

零运行时依赖；面向 Agent 的代码按仓库语言政策保持纯英文。