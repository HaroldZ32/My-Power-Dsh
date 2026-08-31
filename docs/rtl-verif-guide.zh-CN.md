# RTL 验证指南（Phase 1）

[English](./rtl-verif-guide.md)

本指南覆盖 mpd-dsh bundle 交付的 RTL 开发 Phase-1 能力：HDL 语言服务器支持
（Verible + slang-server）、verilog-generator 风格的编码模板、内置 **mpd-verif**
插件（iverilog / Verilator / Synopsys VCS 统一验证流程，开源后端走 cocotb 通道，
UVM 通道仅限 VCS），以及**波形查看 MCP 接线**（wave-mcp + TraceWeave）。
文末是**工程流程建议**（owner 已确认，见 §6）与**延期待办清单**（§7）。

## 1. 交付内容

| 内容 | 形态 | 说明 |
| --- | --- | --- |
| Verilog LSP | 内置 `verible` 服务器（`.v`/`.vh`，运行 `verible-verilog-ls`） | 已打包进发布的 `mcp-lsp` CLI；二进制从 `PATH` 解析（预编译发布包：<https://github.com/chipsalliance/verible/releases>） |
| SystemVerilog LSP | 内置 `slang-server` 服务器（`.sv`/`.svh`，运行 `slang-server`） | 敲键即得真实 slang 浅层编译诊断；静态二进制：<https://github.com/hudson-trading/slang-server/releases> |
| 编码模板 | `skills/rtl-codestyle` | verilog-generator 风格：端口前缀 `i_/o_/io_`、参数前缀 `C_`、状态前缀 `ST_`、内部 `_o` + assign 桥接、ANSI 端口头、硬 3 段式状态机模板（`.vinc`） |
| 验证插件 | `mpd-verif` bundle 行 | 八个内置工具 `mpd_verif_venv/backends/compile/lint/sim/coverage/uvm/regress`（§2） |
| 验证脚手架 | `skills/rtl-verif` | cocotb TB/Makefile 模板 + 黄金 fixture + VCS-UVM 骨架树 |
| 波形 MCP 行 | `mcp-wave-mcp`（wave-mcp）+ `mcp-traceweave`（TraceWeave）—— **可选，默认不挂载**（示例行保持注释） | pipx 或任意 Python 安装 —— **不强制 venv**；venv 铁律仅属 cocotb（§3） |

二进制策略：**绝不随包分发（no vendoring）**。工具二进制优先用 `MPD_DSH_*`
环境变量覆盖解析，其次 `PATH`。QA 始终在隔离的 `DSH_HOME` 中启动。

## 2. 验证流程（三种后端、两条通道）

### 2.1 后端

| 后端 | 用途 | 解析顺序 |
| --- | --- | --- |
| `iverilog` | lint/编译 + cocotb 仿真 | `MPD_DSH_VERIF_IVERILOG` → `PATH` |
| `verilator` | lint/编译 + cocotb 仿真 | `MPD_DSH_VERIF_VERILATOR` → `PATH` |
| `vcs` | 仅 UVM 通道 | `MPD_DSH_VERIF_VCS` → `PATH`（license 经 shell 继承的 `VCS_HOME` / `LM_LICENSE_FILE` / `SNPSLMD_LICENSE_FILE`） |

通道门禁（owner 决策，硬拒绝并返回 `{code,message,hint}`）：

- `mpd_verif_sim`（cocotb 通道）：仅 `iverilog | verilator`。传 `backend: "vcs"`
  → `VERIF_E_UNSUPPORTED`，并指向 `mpd_verif_uvm`。
- `mpd_verif_uvm`（UVM 通道）：**仅 VCS**（无 backend 参数，通道固定）。
  任何开源后端 + UVM 请求 → `VERIF_E_UNSUPPORTED`。
- `mpd_verif_coverage`：verilator（`verilator_coverage` 合并 + 标注）或 vcs
  （`urg` 合并 + 报告）；iverilog → `VERIF_E_UNSUPPORTED`（无原生覆盖率）。

所有工作状态落在 `<workspace>/.mpd/verif/`（可用 `MPD_DSH_VERIF_WORK` 覆盖）；
插件绝不触碰 `~/.dsh`。

### 2.2 cocotb 虚拟环境铁律（VENV IRON RULE）

开源通道的 cocotb 只存在于**项目本地 venv** —— 绝不装进系统 Python。
插件强制执行；违规即拒绝，绝不只警告。

1. venv = `<workspace>/.venv-rtl`（或 `MPD_DSH_VERIF_VENV`）。
2. 创建**只能**用 `python3 -m venv <path>` —— 系统解释器唯一被允许的用途
   （`MPD_DSH_VERIF_PYTHON3_CMD` 可覆盖执行引导的 `python3`）。
3. **每次** pip 安装都执行 `<venv>/bin/pip install ...` —— 绝不使用
   `--user`、`--system`、pipx 或系统 pip。
4. **每次**仿真都通过生成的 `Makefile` 以 `make` 执行，`$VENV/bin`
   前置于 `PATH` —— 绝不裸跑 `python`。
5. `mpd_verif_sim` 在 venv 不存在 **或** cocotb 无法在其中导入时拒绝：
   `VERIF_E_NO_VENV` / `VERIF_E_COCOTB_ABSENT`，都附带精确的修复命令。
6. 一次性初始化，二选一：

   ```sh
   python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"
   # 或在 agent 会话中：
   mpd_verif_venv(action: "create")
   ```

7. venv 仅限工作区本地（绝不 `~/.dsh`，绝不全局）。
8. QA 验收：运行后系统 Python 必须仍然无法 `import cocotb`（零全局污染 ——
   由 `rtl-verif` dsh-qa case 断言）。

### 2.3 开源通道实操（cocotb）

1. 探测：`mpd_verif_backends(backend: "all")` —— 二进制存在性 + 版本，
   以及 vcs 的 license 检查清单。
2. Lint：`mpd_verif_compile(backend, sources[], target: "lint")`（或
   `mpd_verif_lint`）—— iverilog `-g2012 -tnull -Wall` / verilator
   `--lint-only -Wall`，诊断解析为 `{file,line,severity,code,message}`。
3. 仿真：`mpd_verif_sim(backend: "verilator", top, sources[], tbModules[],
   seed, waves: true, traceFst?)`：

   - 生成 `Makefile` + runner（cocotb ≥ 2.0，`cocotb.runner` API），
   - 解析 `results.xml` 得到逐 case 的 `pass/fail/error/skip` 与失败信息
     （自闭合 `<failure/>` 已正确处理），
   - 收集波形：默认 FST（`traceFst: true` → `--trace-fst --trace-structs`）；
     机器缺 liblz4 头文件时设 `traceFst: false` 改出 VCD。
4. 回归：`mpd_verif_regress(backend, cases, seedBase, ...)` —— 逐 case 工作
   目录、确定性种子（`seedBase + idx`）、写入 `<work>/results.json` +
   markdown 报告。

已知环境注意事项（见插件 README）：oss-cad-suite 的 Icarus 在某些发行版上
可能遇到 `GLIBC_2.38` VPI 链接不匹配 —— 优先 verilator 通道或发行版
Icarus；缺 lz4 的 FST 构建会以 `VERIF_E_COMPILE` 失败并附带日志路径。

### 2.4 VCS 上的 UVM 通道

`mpd_verif_uvm(action: compile|run|regress|wave|merge-cov|clean, top, filelist,
test, uvmVer: "1.2", seed, coverage, waveFmt, verbosity)` —— **仅 VCS**。

- **目录结构契约**（编译前校验；缺件 → `VERIF_E_TEMPLATE` 并列出期望文件）：
  `<ip>/{rtl,script,tb,top,test,work}`、`tb/tb_api_primitives.svh`（单一 BFM
  事实源）、`test/<case>_test.sv` 命名、必备 `sanity_test` +
  `reg_access_test`。骨架位于 `skills/rtl-verif/templates/uvm/` ——
  插件**不携带任何模板内容**。
- **Makefile 式契约**：`-ntb_opts uvm-1.2`；seed 默认 `date +%N`；逐 case 的
  `work/work_<case>_/` 目录；覆盖率 `-cm line+cond+tgl` + `urg` 合并；FSDB
  波形以 `VERDI_HOME`/`NOVAS_HOME` 为门槛（另附 `fsdbreport` 非 GUI 校验
  钩子，经 `MPD_DSH_VERIF_FSDBREPORT` / `VCS_HOME` / `VERDI_HOME` /
  `NOVAS_HOME` / `PATH` 解析）。
- **诚实规则**：UVM 编译最多重试 3 次；耗尽后插件写入如实的
  `work/unresolved.md`，绝不谎报成功。
- 方法论仅取自 `gokeshenzhen/gen-tb-skill` 的**结构**与
  `raysalemi/uvmprimer` 的**模式** —— 不复用两者的任何代码。真实 VCS 运行
  由 owner 侧完成（QA 机无 VCS）；QA 覆盖拒绝路径 + 精确 argv 构造
  （fake-vcs 捕获）。

## 3. 编码侧速查

- 二进制在 `PATH` 上之后，打开 `.v`/`.vh`（Verible）或 `.sv`/`.svh`
  （slang-server）即自动解析内置 LSP；安装提示由 LSP 工具链自行给出
  （§1 中的发布包链接）。项目内细节见
  `skills/lsp-setup/references/{verilog,systemverilog}/README.md`。
- **手工构建二进制的逃生通道**：示例用户配置
  `packages/mpd-mcp-lsp/templates/rtl-lsp-client.json`（合并/复制进
  `~/.codex/lsp-client.json`）。注意：loader 会**丢弃 project-config 里
  非内置 id 的条目**，因此自定义命令应写在 *user* 配置里；bundle 刻意
  **不**自动锁定 `LSP_TOOLS_MCP_USER_CONFIG`（否则会遮蔽已有的应用级
  LSP 配置）。
- 新代码遵循 `skills/rtl-codestyle`（verilog-generator 风格）。拼接脚手架：
  `skills/rtl-codestyle/templates/{module_skeleton,fsm_3process,
  parameterized_counter}.vinc`；黄金 fixture
  （`skills/rtl-verif/fixtures/{adder4,cnt8}`）展示逐字阶梯 RTL + cocotb
  testbench。

## 4. 波形查看 MCP 接线

**bundle 默认不挂载这两行**——它们包装外部 Python MCP 服务（wave-mcp /
TraceWeave）。安装方式随你——**不强制 venv**（venv 铁律仅属于 cocotb，见 §3）；
最省事的是 `pipx`（它自带每工具隔离，仅当两者 `mcp` SDK 版本冲突时才需要）。
启动 python 上缺少或版本不匹配的 `mcp` SDK 会在 boot 时令 MCP client 崩溃
（`ModuleNotFoundError: mcp.server.mcpserver`），因此这两行以**注释示例**形态
随包提供（boot 安全）。按以下顺序启用：

1. 安装两个工具（见下方安装块）。
2. 在启动 dsh 的 shell 中导出 `MPD_DSH_WAVE_MCP_BIN` /
   `MPD_DSH_TRACEWEAVE_BIN`。
3. 取消 `cordis.patch.yml` 中两个示例行（`mcp-wave-mcp` /
   `mcp-traceweave`）的注释，然后重装 bundle profile 并重启 dsh。

`mpd_verif_*` 仅在这些工具接好后才会调用；否则波形 hook 静默降级。带波形的
运行（`.fst`/`.vcd`，VCS 通道为 `.fsdb` + 日志）结束后，插件交接：

- OSS 通道 → `mcp__wave_mcp__prepare_session`（`out_dir`、`wave_path`、`top`）；
  session 目录 = `$DSH_HOME/wave-mcp`（覆盖 `MPD_DSH_WAVE_MCP_SESSION`）。
- VCS 通道 → `mcp__traceweave__get_sim_paths`（`verif_root`、`case_name`、
  `sim_log`、`wave_file`）。

行解析（环境变量优先、`PATH` 兜底 —— 绝不随包分发）：

| 行 | 命令 | 附加 |
| --- | --- | --- |
| `mcp-wave-mcp` | `MPD_DSH_WAVE_MCP_BIN` 或 `wave-mcp` | `--session` 参数如上；`toolCallTimeoutMs: 120000` |
| `mcp-traceweave` | `MPD_DSH_TRACEWEAVE_BIN` 或 `traceweave-mcp` | 无 `env` 块：`VERDI_HOME`/`NOVAS_HOME`/`VCS_HOME` + license 变量从启动 dsh 的 shell 继承 |

**安装策略**（以文档为准；bundle 绝不代为安装 —— **不强制 venv**；pipx 自动隔离两个工具）：

```sh
# wave-mcp（FST/VCD 通道）—— pipx（自带隔离）或直接 pip，随你
pipx install wave-mcp          # 或: pip install wave-mcp
# TraceWeave（VCS/FSDB 通道）—— 同款；若两者装进同一 Python 且 mcp SDK 版本打架，
# pipx 已自动隔离 —— 无需手工 venv
pipx install traceweave-mcp    # 或: pip install traceweave-mcp
# 把行指向二进制（PATH 可解析；或在启动 dsh 前 export）：
export MPD_DSH_WAVE_MCP_BIN="$(command -v wave-mcp)"
export MPD_DSH_TRACEWEAVE_BIN="$(command -v traceweave-mcp)"
# TraceWeave 还需在同一 shell 里导出 EDA 环境：
#   export VERDI_HOME=... NOVAS_HOME=... VCS_HOME=...（另加 license 变量）
```

## 5. 验证流程速查（how-to 汇总）

1. `mpd_verif_backends` —— 摸清本机二进制。
2. 每个工作区一次性：`mpd_verif_venv(action: "create")`（铁律）。
3. 迭代：lint → VCD/FST 仿真（`mpd_verif_sim`）→ 打开波形（wave-mcp）→
   修 RTL → 重复。
4. 批量：`mpd_verif_regress` —— 种子、逐 case 目录、`results.json` + 报告。
5. VCS IP：从 `skills/rtl-verif/templates/uvm/` 搭骨架，用
   `mpd_verif_uvm(compile)` 校验目录契约，跑 `sanity_test` +
   `reg_access_test`，合并覆盖率，用 TraceWeave 复查波形。

## 6. 工程流程建议 —— **owner 已确认（2026-08-30）**

> ✅ **owner 已确认。** 以下七条已与 owner 逐条评审并确认可行，作为本阶段
> RTL 工作的定稿工程流程建议。

1. **Lint 进循环** —— LSP 诊断加 `mpd_verif_compile(..., lint)` 作为
   pre-commit 门禁。
2. **开源测试台 cocotb 优先** —— 每个 case 一个 `@cocotb.test()`；
   `results.xml` 对接 CI。
3. **UVM 仅用于 VCS，并设升级判据** —— 从 cocotb/OSS 起步；仅当满足明确
   判据（寄存器模型、约束随机覆盖率收敛、跨语言复用）时才把某模块升级到
   VCS 上的 UVM。
4. **波形评审门禁** —— 每次回归后 FST/经 wave-mcp 复查波形；先讨论修复再
   合并，而不是掩盖问题。
5. **黄金 RTL 流程** —— C 模型 → verilog-generator 风格模板 → lint → 仿真 →
   回归 → 波形评审 → 合并。
6. **环境卫生** —— `MPD_DSH_*` 覆盖、每项目 `.venv-rtl`、VCS license 环境
   只在启动 dsh 的 shell 中导出。
7. **回归卫生** —— 确定性种子规则（`seedBase + idx`）、逐 case 工作目录、
   归档 `results.json`。

另有延期到后续阶段的 P1 积压（本阶段不交付）：VCS 覆盖率合并自动化打磨、
TraceWeave EDA 深度接线、`verible.filelist` 自动生成、`.slang/server.json`
模板生成、回归并行化、lsp-setup 参考文档的中文翻译。

## 7. 延期待办（DEFERRED TO-DO —— 仅记录，暂无实施计划）

- **ast-grep 的 Verilog 支持** —— 为采纳的 ast-grep MCP 增加
  Verilog/SystemVerilog 语言支持（面向 RTL 的结构化搜索/改写）。
- **SpinalHDL / Chisel 编码支持** —— 基于 Scala 的 HDL 前端
  （超出 Phase-1 范围；为后续阶段留档）。

## 8. QA 证据

Phase-1 交付物由 dsh-qa case `rtl-verif`
（`skills/dsh-qa/scripts/rtl-verif.mjs`）把关：隔离启动挂载 `mpd-verif` +
`mcp-wave-mcp` + `mcp-traceweave` + `mcp-lsp` 行、发布 CLI 内置双 HDL LSP
注册表，以及在真实 verilator/cocotb 上跑黄金加法器流程，同时断言 venv 铁律
与系统 Python 零污染。证据位于 `evidence/dsh-qa/rtl-verif/`；插件冒烟证据在
`packages/mpd-verif-plugin/evidence/smoke/`。