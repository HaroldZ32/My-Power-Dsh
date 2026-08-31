# mpd-verif-plugin

[中文](./README.zh-CN.md)

Unified RTL verification plugin for my-power-dsh (Plan A, verification side).
One plugin, three backends — **iverilog / verilator / vcs** — resolved from
`MPD_DSH_VERIF_*` env overrides or `PATH` (no binary is ever vendored), with a
**cocotb lane for the open-source backends** under a strict project-local venv
isolation rule, a **UVM methodology lane gated to VCS**, and **waveform-read
hooks** that call user-wired wave-mcp / TraceWeave MCP tools when present and
degrade gracefully (with exact setup commands) when they are not.

## Tools

| Tool | Purpose |
| --- | --- |
| `mpd_verif_venv` | Manage the project-local cocotb venv: `status` (default) / `create` / `info` |
| `mpd_verif_backends` | Probe iverilog/verilator/vcs availability (env → PATH), versions, vcs license hints |
| `mpd_verif_compile` | Full compile to a sim binary with best-effort diagnostics parsing `{file,line,severity,code,message}` |
| `mpd_verif_lint` | Standalone lint pass: iverilog `-g2012 -tnull -Wall` / verilator `--lint-only -Wall` / vcs `-lca -sverilog +lint=all` |
| `mpd_verif_sim` | cocotb simulation on iverilog/verilator via the **cocotb Makefile flow**: generated `Makefile`, `make` invoked with `$VENV/bin` first on PATH, results.xml parsed into per-case statuses, waves collected, optional wave-mcp handoff |
| `mpd_verif_coverage` | Standalone coverage merge/report: verilator `verilator_coverage` (.dat merge + annotate) / vcs `urg -dir … -report …`; iverilog refused (`VERIF_E_UNSUPPORTED`, no native coverage) |
| `mpd_verif_uvm` | UVM lane **for VCS only**: layout contract validation + compile/run/regress/wave/merge-cov/clean |
| `mpd_verif_regress` | Multi-case regression (both lanes), deterministic seeds, `results.json` + markdown report |

## Iron rule — cocotb venv isolation

1. Venv lives at `<workspace>/.venv-rtl` (or `MPD_DSH_VERIF_VENV`) — **never** system python.
2. Created **only** via `python3 -m venv <path>` (the single sanctioned use of the system interpreter).
3. Every pip install runs as `<venv>/bin/pip install ...` — **never** `--user`, `--system`, pipx, or system pip.
4. Every simulation runs the generated **Makefile** via `make` with `$VENV/bin` **prepended to PATH** (DP-6), so every nested cocotb python resolves to the venv python — never a bare `python`.
5. `mpd_verif_sim` refuses (`VERIF_E_NO_VENV` / `VERIF_E_COCOTB_ABSENT`) unless the venv exists **and** cocotb imports inside it. The refusal message carries the exact setup command:

```sh
python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"
```

or just call `mpd_verif_venv` with `action: "create"`.

## Backend resolution

| Backend | Env override | PATH fallback |
| --- | --- | --- |
| iverilog | `MPD_DSH_VERIF_IVERILOG` | `iverilog` |
| verilator | `MPD_DSH_VERIF_VERILATOR` | `verilator` |
| vcs | `MPD_DSH_VERIF_VCS` | `vcs` |

Work state lands under `<workspace>/.mpd/verif/` (or `MPD_DSH_VERIF_WORK`). The
plugin never touches `~/.dsh`.

## Error taxonomy

All structured refusals return `{ ok:false, error:{ code, message, hint } }`:
`VERIF_E_NO_BACKEND` · `VERIF_E_NO_VENV` · `VERIF_E_COCOTB_ABSENT` ·
`VERIF_E_UNSUPPORTED` · `VERIF_E_LICENSE` · `VERIF_E_ENV` · `VERIF_E_COMPILE` ·
`VERIF_E_RUN` · `VERIF_E_TIMEOUT` · `VERIF_E_TEMPLATE`. Compile failures attach
parsed diagnostics; UVM compile failures are retry-capped (3 attempts) and
write an honest `work/unresolved.md` on exhaustion.

## Lane gating (owner decision)

- `mpd_verif_sim` = cocotb lane, **iverilog | verilator only**. `backend: "vcs"`
  → `VERIF_E_UNSUPPORTED` pointing at `mpd_verif_uvm` (hard gate both directions,
  per owner).
- `mpd_verif_uvm` = UVM methodology lane, **VCS only** (no backend parameter).
  It validates the template layout contract (`<ip>/{rtl,script,tb,top,test,work}`,
  `tb/tb_api_primitives.svh` shared-BFM source of truth, `test/<case>_test.sv`
  naming, mandatory `sanity_test` + `reg_access_test`) and orchestrates the
  makefile-style contract: `-ntb_opts uvm-1.2`, per-case `work/work_<case>_/`
  dirs, coverage `-cm line+cond+tgl` + `urg` merge, fsdb wave runs (gated on
  `VERDI_HOME`/`NOVAS_HOME`), plus the **fsdbreport non-GUI verification hook**
  (FSDB integrity/warning report after wave runs, resolved via
  `MPD_DSH_VERIF_FSDBREPORT` / `VCS_HOME`/`VERDI_HOME`/`NOVAS_HOME` / PATH).
  The plugin ships **no template content** — rich cocotb/UVM skeletons live in
  the `skills/rtl-verif` corpus. Methodology is grounded in gen-tb-skill
  **structure** and raysalemi/uvmprimer **patterns**; **no code is reused from
  either repository**.

## Waveform-read hooks

After a sim/regress/uvm run, the plugin hands produced waves to user-wired MCP
tools when their registrations exist, otherwise it degrades with an actionable
message:

- OSS lane (`.fst`/`.vcd`) → `mcp__wave_mcp__prepare_session` (wave-mcp;
  `out_dir`, `wave_path`, `top`). Session home = `$DSH_HOME/wave-mcp`
  (or `MPD_DSH_WAVE_MCP_SESSION`), per team decision DP-8.
- VCS lane (`.fsdb` + logs) → `mcp__traceweave__get_sim_paths` (TraceWeave;
  `verif_root`, `case_name`, `sim_log`, `wave_file`).

Suggested wiring (see the team docs for full notes; **no venv required** — the
venv iron rule belongs to cocotb only). The two MCPs pin CONFLICTING mcp SDK
versions (wave-mcp needs mcp>=2 → `mcp.server.mcpserver`; TraceWeave pins
mcp==1.27.0), so each gets its own isolated `pip --target` dir:

```sh
python3 -m pip install --target "$HOME/.mpd/mcp-servers/wave-mcp" "mcp>=2" wave-mcp
python3 -m pip install --target "$HOME/.mpd/mcp-servers/traceweave" "mcp==1.27.0" traceweave-mcp
# or one-shot: node scripts/install-mcp.mjs --with-wave --activate-wave
export MPD_DSH_WAVE_MCP_BIN="$HOME/.mpd/mcp-servers/wave-mcp/bin/wave-mcp"
export MPD_DSH_TRACEWEAVE_BIN="$HOME/.mpd/mcp-servers/traceweave/bin/traceweave-mcp"
```

## Environment notes (verified on this machine, 2026-08)

- Verilator+cocotb roundtrip passes end-to-end (results.xml parsed, VCD dumped).
- Verilator FST is the owner's default (`traceFst` defaults to **true** →
  `--trace-fst --trace-structs`) but needs **liblz4 headers** at build time;
  on machines without them set `traceFst: false` for VCD (wave-mcp converts VCD
  on read anyway). A missing-lz4 FST build surfaces as `VERIF_E_COMPILE` with
  the log path.
- The oss-cad-suite Icarus binary bundles an older glibc; on this box the
  icarus+cocotb VPI lane can fail at `vvp` with a `GLIBC_2.38` linker error
  unless python and Icarus share one glibc family (distro iverilog works).
  Use the verilator lane or a distro Icarus here.
- `MPD_DSH_VERIF_PYTHON3_CMD` overrides the `python3` used only for venv
  bootstrap (`python3 -m venv`), e.g. when the default shim is an SDK python.
- Unit tests exercise every lane with **fake binaries (fake-vcs argv capture)**
  and fake project venvs; the real-tooling smoke lives under
  `evidence/smoke/` in the package (rerun with
  `bun packages/mpd-verif-plugin/evidence/smoke/smoke.mjs`).

## Development

```sh
bun test packages/mpd-verif-plugin   # unit tests (fake tools, no real EDA needed)
bun run typecheck                    # repo gate
bun build src/index.ts --target node --format esm --outfile dist/index.js
```

Zero runtime dependencies; agent-facing code is English-only per the repo
language policy.