// src/compile.ts
import { join as join3 } from "node:path";

// src/backends.ts
import { writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";

// src/env.ts
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
var BACKEND_IDS = ["iverilog", "verilator", "vcs"];
var BACKEND_BIN = {
  iverilog: "iverilog",
  verilator: "verilator",
  vcs: "vcs"
};
var BACKEND_ENV = {
  iverilog: "MPD_DSH_VERIF_IVERILOG",
  verilator: "MPD_DSH_VERIF_VERILATOR",
  vcs: "MPD_DSH_VERIF_VCS"
};
function workspaceRoot() {
  return resolve(process.env.DSH_WORKSPACE_ROOT ?? process.cwd());
}
function venvPath(override) {
  return resolve(override || process.env.MPD_DSH_VERIF_VENV || join(workspaceRoot(), ".venv-rtl"));
}
function workDir() {
  return resolve(process.env.MPD_DSH_VERIF_WORK || join(workspaceRoot(), ".mpd", "verif"));
}
function paths(overrideVenv) {
  return { workspace: workspaceRoot(), venv: venvPath(overrideVenv), work: workDir() };
}
function resolveBackendBinary(backend) {
  const envVal = process.env[BACKEND_ENV[backend]];
  if (envVal && envVal.trim().length > 0)
    return { binary: resolve(envVal.trim()), source: "env" };
  const bin = BACKEND_BIN[backend];
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0)
      continue;
    const f = join(dir, bin);
    if (existsSync(f))
      return { binary: f, source: "path" };
  }
  return null;
}
function runStamp(d = new Date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}
function dateSeedBase(now = new Date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return Number(`${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`);
}

// src/run.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
var DEFAULT_TIMEOUT_MS = 600000;
var MAX_BUFFER = 32 * 1024 * 1024;
function run(binary, args, opts = {}) {
  const res = spawnSync(binary, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER
  });
  const stderr = (res.stderr ?? "").trim();
  const stdout = (res.stdout ?? "").trim();
  const spawnError = res.error && !res.error.code ? String(res.error) : res.error ? res.error.code ?? String(res.error) : null;
  return {
    status: res.status,
    signal: res.signal ?? null,
    timedOut: Boolean(res.error && res.error.code === "ETIMEDOUT"),
    spawnError,
    stdout,
    stderr,
    combined: [stdout, stderr].filter((s) => s.length > 0).join(`
`)
  };
}
function writeLog(logPath, content) {
  if (logPath) {
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, content + `
`);
  }
  return logPath;
}

// src/errors.ts
class VerifError extends Error {
  code;
  hint;
  constructor(code, message, hint) {
    super(message);
    this.name = "VerifError";
    this.code = code;
    this.hint = hint;
  }
}
function refusal(code, message, hint) {
  return { ok: false, error: { code, message, hint: hint || "see the message" } };
}
function refusalOf(e) {
  if (e instanceof VerifError)
    return { ok: false, error: { code: e.code, message: e.message, hint: e.hint } };
  return refusal("VERIF_E_RUN", "unexpected internal error: " + String(e), "check the plugin log or retry with a narrower request");
}

// src/backends.ts
var LICENSE_ENV = {
  iverilog: [],
  verilator: [],
  vcs: ["VCS_HOME", "LM_LICENSE_FILE", "SNPSLMD_LICENSE_FILE"]
};
function versionProbeArgs(backend) {
  switch (backend) {
    case "iverilog":
      return ["-V"];
    case "verilator":
      return ["--version"];
    case "vcs":
      return ["-ID"];
  }
}
function probeBackend(backend) {
  const r = resolveBackendBinary(backend);
  if (!r) {
    return { backend, binary: null, source: null, present: false, version: null, licenseHint: absentHintLines(backend) };
  }
  const vr = run(r.binary, versionProbeArgs(backend), { timeoutMs: 20000 });
  const version = vr.timedOut ? null : firstVersionLine(vr.combined) ?? (vr.status === 0 ? "unknown" : null);
  const licenseHint = backend === "vcs" ? LICENSE_ENV.vcs.map((k) => `${k}=${process.env[k] ? "set" : "missing"}`) : undefined;
  return { backend, binary: r.binary, source: r.source, present: vr.spawnError === null, version, licenseHint };
}
function absentHintLines(backend) {
  switch (backend) {
    case "iverilog":
      return ["iverilog not found — install Icarus Verilog (e.g. apt install iverilog or oss-cad-suite) or set MPD_DSH_VERIF_IVERILOG"];
    case "verilator":
      return ["verilator not found — install Verilator (e.g. apt install verilator or oss-cad-suite) or set MPD_DSH_VERIF_VERILATOR"];
    case "vcs":
      return ["vcs not found — set MPD_DSH_VERIF_VCS, or add $VCS_HOME/bin to PATH; license vars: VCS_HOME, LM_LICENSE_FILE, SNPSLMD_LICENSE_FILE"];
  }
}
function firstVersionLine(combined) {
  for (const l of combined.split(`
`)) {
    const t = l.trim();
    if (t.length === 0)
      continue;
    return t.slice(0, 200);
  }
  return null;
}
function requireBackend(backend, extraHint) {
  const r = resolveBackendBinary(backend);
  if (!r) {
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${backend}' is not resolvable (env ${Object.values(BACKEND_IDS).length ? "override or PATH" : "PATH"})`, [absentHintLines(backend)[0] ?? "", extraHint].filter(Boolean).join(" "));
  }
  return r.binary;
}
function normalizeDefines(defs) {
  if (!defs)
    return {};
  if (Array.isArray(defs)) {
    const out = {};
    for (const d of defs) {
      const eq = d.indexOf("=");
      if (eq >= 0)
        out[d.slice(0, eq).trim()] = d.slice(eq + 1).trim();
      else
        out[d.trim()] = 1;
    }
    return out;
  }
  return defs;
}
function incArgs(includes) {
  return (includes ?? []).map((i) => "-I" + i);
}
function defineArgsForIvorTool(defs) {
  return Object.entries(defs).map(([k, v]) => v === 1 ? "-D" + k : `-D${k}=${v}`);
}
function writeVcsFilelist(path, sources, includes, defs) {
  mkdirSync2(dirname2(path), { recursive: true });
  const defines = normalizeDefines(defs);
  const lines = [
    ...(includes ?? []).map((i) => `+incdir+${i}`),
    ...Object.entries(defines).map(([k, v]) => v === 1 ? `+define+${k}` : `+define+${k}=${v}`),
    ...sources
  ];
  writeFileSync2(path, lines.join(`
`) + `
`);
  return path;
}
function lintPlan(backend, src, logRoot, stamp) {
  const binary = resolveBackendBinary(backend)?.binary ?? BACKEND_BIN[backend];
  const defs = normalizeDefines(src.defines);
  switch (backend) {
    case "iverilog": {
      const args = ["-g2012", "-tnull", "-Wall"];
      if (src.top)
        args.push("-s", src.top);
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, logPath: join2(logRoot, `lint-iverilog-${stamp}.log`) };
    }
    case "verilator": {
      const args = ["--lint-only", "-Wall"];
      if (src.top)
        args.push("--top-module", src.top);
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, logPath: join2(logRoot, `lint-verilator-${stamp}.log`) };
    }
    case "vcs": {
      const filelist = join2(logRoot, `vcs-filelist-${stamp}.f`);
      writeVcsFilelist(filelist, src.sources, src.includes, defs);
      const args = ["-lca", "-sverilog", "+lint=all", "-f", filelist];
      if (src.top)
        args.push("-top", src.top);
      const logPath = join2(logRoot, `lint-vcs-${stamp}.log`);
      args.push("-l", logPath);
      return { backend, binary, args, logPath, filelistPath: filelist };
    }
  }
}
function compilePlan(backend, src, workRoot, stamp) {
  const binary = resolveBackendBinary(backend)?.binary ?? BACKEND_BIN[backend];
  const defs = normalizeDefines(src.defines);
  const outDir = join2(workRoot, "build", stamp);
  mkdirSync2(outDir, { recursive: true });
  switch (backend) {
    case "iverilog": {
      const out = join2(outDir, "simv_iverilog");
      const args = ["-g2012", "-o", out];
      if (src.top)
        args.push("-s", src.top);
      args.push(...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, outBinary: out, logPath: join2(outDir, "compile.log") };
    }
    case "verilator": {
      const out = join2(outDir, "Vsim");
      const args = ["--binary"];
      if (src.top)
        args.push("--top-module", src.top);
      args.push("-o", out, ...incArgs(src.includes), ...defineArgsForIvorTool(defs), ...src.sources);
      return { backend, binary, args, outBinary: out, logPath: join2(outDir, "compile.log") };
    }
    case "vcs": {
      const filelist = join2(outDir, "filelist.f");
      writeVcsFilelist(filelist, src.sources, src.includes, defs);
      const out = join2(outDir, "simv");
      const logPath = join2(outDir, "vcs_compile.log");
      const args = ["-sverilog", "+v2k", "-f", filelist, "-o", out];
      if (src.top)
        args.push("-top", src.top);
      args.push("-l", logPath);
      return { backend, binary, args, outBinary: out, logPath, filelistPath: filelist };
    }
  }
}
function parseDiagnostics(backend, text) {
  const out = [];
  if (backend === "iverilog") {
    const re = /^(\S+?\.[a-zA-Z]+):(\d+):(?:\s*(error|warning))?:?\s*(.*)$/gm;
    for (const m of text.matchAll(re)) {
      const raw = m[4] ?? "";
      let severity = m[3] === "warning" ? "warning" : raw.toLowerCase().startsWith("syntax error") ? "error" : "error";
      if (!m[3] && raw.toLowerCase().startsWith("warning"))
        severity = "warning";
      out.push({ file: m[1], line: Number(m[2]), severity, code: raw.toLowerCase().startsWith("syntax error") ? "SYNTAX" : "IVL", message: raw.slice(0, 400) });
    }
  } else if (backend === "verilator") {
    const re = /%?(Error|Warning)(?:-([A-Za-z0-9_]+))?:?\s*(\S+?\.[a-zA-Z]+):(\d+):\d*:\s*(.*)$/gm;
    for (const m of text.matchAll(re)) {
      out.push({ file: m[3], line: Number(m[4]), severity: m[1] === "Error" ? "error" : "warning", code: m[2] ?? m[1], message: m[5]?.slice(0, 400) ?? "" });
    }
  } else {
    const warns = [...text.matchAll(/^(Error|Warning)-\[([^\]]+)\]\s*$/gm)];
    const locs = [...text.matchAll(/"([^"]+)"\s*,\s*(\d+)[:.]\s*(.*)$/gm)];
    let w = 0;
    for (const l of locs) {
      const wm = warns[w] ?? null;
      out.push({ file: l[1], line: Number(l[2]), severity: wm && wm[1] === "Warning" ? "warning" : "error", code: wm ? wm[2] : "VCS", message: (l[3] ?? "").slice(0, 400) });
      if (wm)
        w++;
    }
  }
  return out.slice(0, 500);
}
function probeAll() {
  return BACKEND_IDS.map((b) => probeBackend(b));
}
function runPlan(plan, timeoutMs) {
  return run(plan.binary, plan.args, { timeoutMs });
}

// src/compile.ts
function verifCompile(a) {
  if (!a.sources || a.sources.length === 0) {
    throw new VerifError("VERIF_E_COMPILE", "no sources given", "pass sources[] (at least one .v/.sv file)");
  }
  const stamp = runStamp();
  const logRoot = join3(workDir(), "logs");
  const defines = a.defines ? Array.isArray(a.defines) ? normalizeDefines(a.defines) : a.defines : undefined;
  const src = { sources: a.sources, top: a.top, includes: a.includes, defines };
  const target = a.target === "compile" ? "compile" : "lint";
  requireBackend(a.backend, "install it or pin MPD_DSH_VERIF_" + a.backend.toUpperCase());
  const plan = target === "lint" ? lintPlan(a.backend, src, logRoot, stamp) : compilePlan(a.backend, src, workDir(), stamp);
  const r = runPlan(plan, (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000);
  writeLog(plan.logPath, r.combined);
  if (r.timedOut) {
    throw new VerifError("VERIF_E_TIMEOUT", `${target} '${a.backend}' timed out`, "increase timeoutSec, narrow the source set, or check the tool installation");
  }
  if (r.spawnError) {
    throw new VerifError("VERIF_E_NO_BACKEND", `${target} '${a.backend}' could not be executed: ${r.spawnError}`, "install the tool or set MPD_DSH_VERIF_" + a.backend.toUpperCase());
  }
  const diagnostics = parseDiagnostics(a.backend, r.combined);
  const ok = r.status === 0;
  return {
    ok,
    target,
    backend: a.backend,
    binary: plan.binary,
    args: plan.args,
    exitCode: r.status,
    timedOut: r.timedOut,
    diagnostics,
    logPath: plan.logPath,
    filelistPath: plan.filelistPath,
    outBinary: plan.outBinary,
    logLines: r.combined.split(`
`).filter((l) => l.trim().length > 0).slice(-50),
    ...ok ? {} : {
      error: {
        code: "VERIF_E_COMPILE",
        message: `${target} failed (exit ${r.status}, ${diagnostics.length} diagnostic(s) parsed)`,
        hint: `read the log at ${plan.logPath}; fix the first error and rerun`
      }
    }
  };
}

// src/coverage.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3 } from "node:fs";
import { join as join5 } from "node:path";

// src/eda-tools.ts
import { existsSync as existsSync2, readdirSync } from "node:fs";
import { join as join4 } from "node:path";
function resolveEdaTool(name) {
  const envKey = name === "urg" ? "MPD_DSH_VERIF_URG" : "MPD_DSH_VERIF_FSDBREPORT";
  const envVal = process.env[envKey];
  if (envVal && envVal.trim().length > 0)
    return { binary: envVal.trim(), source: "env:" + envKey };
  const homes = ["VCS_HOME", "VERDI_HOME", "NOVAS_HOME"];
  for (const h of homes) {
    const root = process.env[h];
    if (!root)
      continue;
    const f = join4(root, "bin", name);
    if (existsSync2(f))
      return { binary: f, source: h };
  }
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0)
      continue;
    const f = join4(dir, name);
    if (existsSync2(f))
      return { binary: f, source: "path" };
  }
  return null;
}
var FSDBREPORT_HINT = "install/point fsdbreport: MPD_DSH_VERIF_FSDBREPORT=<path>, or export VCS_HOME/VERDI_HOME/NOVAS_HOME so <home>/bin/fsdbreport resolves";
var URG_HINT = "install/point urg: MPD_DSH_VERIF_URG=<path>, or export VCS_HOME so <VCS_HOME>/bin/urg resolves";
function urgMergeArgv(covDirs, reportDir, format) {
  const argv = ["urg"];
  for (const d of covDirs)
    argv.push("-dir", d);
  argv.push("-report", reportDir);
  if (format)
    argv.push("-format", format);
  return argv;
}
function runFsdbreport(binary, fsdbPath, timeoutMs) {
  return run(binary, [fsdbPath], { timeoutMs });
}
function collectCovDirs(root, max = 50) {
  const roots = [];
  const fallback = [];
  const walk = (dir) => {
    if (roots.length >= max)
      return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory())
        continue;
      const p = join4(dir, e.name);
      if (/^(cov|coverage)$/.test(e.name)) {
        roots.push(p);
        continue;
      }
      if (e.name.startsWith("work_") || e.name.startsWith("sim_vdb")) {
        fallback.push(p);
      }
      walk(p);
    }
  };
  walk(root);
  return (roots.length > 0 ? roots : fallback).slice(0, max);
}
function collectDatFiles(root, max = 100) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync2(dir) || out.length >= max)
      return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join4(dir, e.name);
      if (e.isDirectory())
        walk(p);
      else if (e.name.endsWith(".dat"))
        out.push(p);
    }
  };
  walk(root);
  return out.slice(0, max);
}

// src/coverage.ts
var VERILATOR_COVERAGE_HINT = "verilator_coverage not found — it ships with Verilator (oss-cad-suite on PATH or MPD_DSH_VERIF_VERILATOR_COVERAGE)";
function resolveVerilatorCoverage() {
  const envVal = process.env.MPD_DSH_VERIF_VERILATOR_COVERAGE;
  if (envVal && envVal.trim().length > 0)
    return { binary: envVal.trim(), source: "env:MPD_DSH_VERIF_VERILATOR_COVERAGE" };
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir.length === 0)
      continue;
    const f = join5(dir, "verilator_coverage");
    if (existsSync3(f))
      return { binary: f, source: "path" };
  }
  throw new VerifError("VERIF_E_NO_BACKEND", "verilator_coverage not resolvable", VERILATOR_COVERAGE_HINT);
}
function verifCoverage(a) {
  const scanRoot = a.dir ?? workDir();
  const reportDir = a.reportDir ?? join5(workDir(), "cov_report");
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
  mkdirSync3(reportDir, { recursive: true });
  if (a.backend === "iverilog") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "iverilog has no native code coverage", "use the verilator lane (mpd_verif_sim coverage:true adds --coverage) or the VCS/urg lane; icarus coverage is deliberately refused");
  }
  if (a.backend === "vcs") {
    const urg = resolveEdaTool("urg");
    if (!urg)
      throw new VerifError("VERIF_E_NO_BACKEND", "urg not resolvable", URG_HINT);
    const covDirs = collectCovDirs(scanRoot);
    if (covDirs.length === 0) {
      throw new VerifError("VERIF_E_RUN", "no coverage data dirs under " + scanRoot, "enable coverage on the UVM lane (coverage:true on compile/run/regress writes -cm_dir payloads) then re-run coverage");
    }
    const argv2 = urgMergeArgv(covDirs, reportDir, "both");
    const logPath2 = join5(reportDir, "urg.log");
    const r2 = run(urg.binary, argv2.slice(1), { timeoutMs });
    writeLog(logPath2, r2.combined);
    return {
      ok: r2.status === 0,
      backend: "vcs",
      action: "merge",
      binary: urg.binary,
      args: argv2,
      exitCode: r2.status,
      datFiles: [],
      covDirs,
      reportDir,
      logPath: logPath2,
      messages: r2.status === 0 ? [`urg merged ${covDirs.length} coverage dir(s) into ${reportDir}`] : [],
      ...r2.status === 0 ? {} : { error: { code: "VERIF_E_ENV", message: "urg merge failed", hint: `read ${logPath2}; verify the license environment` } }
    };
  }
  const tool = resolveVerilatorCoverage();
  const dats = collectDatFiles(scanRoot);
  const logPath = join5(reportDir, "verilator_coverage.log");
  if (a.action === "report") {
    const merged = a.mergedDat ?? join5(reportDir, "merged.dat");
    if (!existsSync3(merged)) {
      throw new VerifError("VERIF_E_RUN", "no merged coverage dataset at " + merged, "run mpd_verif_coverage with action=merge first (verilator), or pass mergedDat");
    }
    const argv2 = [tool.binary, "--annotate", reportDir, merged];
    const r2 = run(argv2[0], argv2.slice(1), { timeoutMs });
    writeLog(logPath, r2.combined);
    return {
      ok: r2.status === 0,
      backend: "verilator",
      action: "merge",
      binary: tool.binary,
      args: argv2,
      exitCode: r2.status,
      datFiles: dats,
      covDirs: [],
      mergedDat: merged,
      reportDir,
      logPath,
      messages: r2.status === 0 ? [`annotated coverage report under ${reportDir}`] : [],
      ...r2.status === 0 ? {} : { error: { code: "VERIF_E_RUN", message: "verilator_coverage annotate failed", hint: `read ${logPath}; annotate needs the merged dataset` } }
    };
  }
  if (dats.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no Verilator coverage .dat files under " + scanRoot, "run mpd_verif_sim with coverage:true (COMPILE_ARGS += --coverage) on the verilator lane, then re-run coverage");
  }
  const mergeDat = join5(reportDir, "merged.dat");
  const argv = [tool.binary, "--write", mergeDat, ...dats];
  const r = run(argv[0], argv.slice(1), { timeoutMs });
  writeLog(logPath, r.combined);
  return {
    ok: r.status === 0,
    backend: "verilator",
    action: "merge",
    binary: tool.binary,
    args: argv,
    exitCode: r.status,
    datFiles: dats,
    covDirs: [],
    mergedDat: mergeDat,
    reportDir,
    logPath,
    messages: r.status === 0 ? [`merged ${dats.length} coverage file(s) into ${mergeDat}`] : [],
    ...r.status === 0 ? {} : { error: { code: "VERIF_E_RUN", message: "verilator_coverage merge failed", hint: `read ${logPath}` } }
  };
}

// src/venv.ts
import { existsSync as existsSync4 } from "node:fs";
import { join as join6 } from "node:path";
function venvPython(v) {
  return join6(v, "bin", "python");
}
function venvPip(v) {
  return join6(v, "bin", "pip");
}
var SETUP_COMMAND = `python3 -m venv .venv-rtl && .venv-rtl/bin/pip install "cocotb>=2.0"`;
function venvRefusal(v, cocotbVersion) {
  if (!existsSync4(venvPython(v))) {
    return {
      ok: false,
      error: {
        code: "VERIF_E_NO_VENV",
        message: `cocotb venv missing at ${v} (iron rule: project-local venv required, system python is never used)`,
        hint: `run: ${SETUP_COMMAND} — or call mpd_verif_venv with action "create", or set MPD_DSH_VERIF_VENV to an existing project venv`
      }
    };
  }
  return {
    ok: false,
    error: {
      code: "VERIF_E_COCOTB_ABSENT",
      message: `venv exists at ${v} but 'import cocotb' failed${cocotbVersion ? " (cocotb " + cocotbVersion + ")" : ""}`,
      hint: `install inside the venv only: ${v}/bin/pip install "cocotb>=2.0" (never --user, never system pip)`
    }
  };
}
function venvStatus(override) {
  const v = venvPath(override);
  const py = venvPython(v);
  const envOverride = process.env.MPD_DSH_VERIF_VENV ?? null;
  if (!existsSync4(py)) {
    return {
      ok: false,
      verdict: "missing",
      venv: v,
      python: py,
      pythonVersion: null,
      cocotbVersion: null,
      message: `venv missing at ${v} — run: ${SETUP_COMMAND} or mpd_verif_venv(action:"create")`,
      envOverride
    };
  }
  const pv = run(py, ["--version"], { timeoutMs: 30000 });
  const pythonVersion = pv.spawnError === null ? (pv.combined.split(`
`)[0] ?? "").trim().slice(0, 120) : null;
  const cv = run(py, ["-c", 'import cocotb, json; print(json.dumps({"v": cocotb.__version__, "ok": True}))'], { timeoutMs: 60000 });
  let cocotbVersion = null;
  if (cv.spawnError === null && cv.status === 0) {
    try {
      const parsed = JSON.parse(cv.combined.split(`
`).find((l) => l.trim().startsWith("{")) ?? "{}");
      cocotbVersion = parsed.v ?? null;
    } catch {
      cocotbVersion = null;
    }
  }
  const verdict = cocotbVersion ? "ok" : pythonVersion ? "setup-required" : "missing";
  return {
    ok: cocotbVersion !== null,
    verdict,
    venv: v,
    python: py,
    pythonVersion,
    cocotbVersion,
    envOverride,
    message: cocotbVersion ? `venv ready: python ${pythonVersion ?? "?"} with cocotb ${cocotbVersion}` : `venv incomplete: ${SETUP_COMMAND}`
  };
}
function venvCreate(override, _configureTimeoutMs = 600000) {
  const v = venvPath(override);
  const steps = [];
  const python3 = process.env.MPD_DSH_VERIF_PYTHON3_CMD ?? "python3";
  const r1 = run(python3, ["-m", "venv", v], { timeoutMs: 120000 });
  steps.push({ step: "venv", args: ["-m", "venv", v], status: r1.status, log: r1.combined });
  if (r1.status !== 0 || !existsSync4(venvPython(v))) {
    return {
      ok: false,
      venv: v,
      steps,
      message: `venv bootstrap via '${python3} -m venv ${v}' failed (status ${r1.status}): ${tailOf(r1.combined)} — hint: install python3-venv/ensurepip (Debian: apt install python3-venv) and rerun mpd_verif_venv(action:"create")`
    };
  }
  const pip = venvPip(v);
  if (!existsSync4(pip)) {
    return { ok: false, venv: v, steps, message: `venv created at ${v} but ${pip} is missing (ensurepip unavailable?) — hint: recreate with 'python3 -m venv ${v}' after installing python3-venv` };
  }
  const r2 = run(pip, ["install", "cocotb>=2.0"], { timeoutMs: _configureTimeoutMs });
  steps.push({ step: "pip-install-cocotb", args: ["install", "cocotb>=2.0"], status: r2.status, log: r2.combined });
  if (r2.status !== 0) {
    return { ok: false, venv: v, steps, message: `pip install inside ${v} failed (status ${r2.status}): ${tailOf(r2.combined)} — rerun mpd_verif_venv(action:"create") or check network/proxy` };
  }
  const st = venvStatus(override);
  return { ok: st.ok, venv: v, steps, message: `venv ready at ${v} — cocotb ${st.cocotbVersion ?? "unknown"}` };
}
function tailOf(s, n = 400) {
  const t = s.trim();
  return t.length <= n ? t : "..." + t.slice(t.length - n);
}
function requireCocotbVenv(override) {
  const st = venvStatus(override);
  if (!st.ok) {
    const r = venvRefusal(st.venv, st.cocotbVersion);
    throw new VerifError(r.error.code, r.error.message, r.error.hint);
  }
  return { venv: st.venv, cocotbVersion: st.cocotbVersion ?? "unknown" };
}

// src/sim.ts
import { existsSync as existsSync5, mkdirSync as mkdirSync4, readdirSync as readdirSync2, readFileSync, statSync, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname3, isAbsolute, join as join8 } from "node:path";

// src/wave.ts
import { join as join7 } from "node:path";
var WAVE_MCP_PREPARE = "mcp__wave_mcp__prepare_session";
var TRACEWEAVE_GET_PATHS = "mcp__traceweave__get_sim_paths";
var WAVE_MCP_INSTALL_HINT = "install wave-mcp with pipx or any Python (NO venv required — pipx install wave-mcp, or pip install wave-mcp), then wire the dsh-mcp-client row (command: wave-mcp/<bin>, serverName: wave_mcp) or set MPD_DSH_WAVE_MCP_BIN";
var TRACEWEAVE_INSTALL_HINT = "install traceweave-mcp with pipx or any Python (NO venv required; pipx keeps each tool isolated if the MCP SDK versions ever conflict), export VERDI_HOME/NOVAS_HOME/VCS_HOME + license vars, then wire the dsh-mcp-client row (serverName: traceweave) or set MPD_DSH_TRACEWEAVE_BIN";
async function runWaveHooks(tools, req) {
  const out = [];
  const lane = req.lane ?? inferLane(req);
  if (lane === "vcs") {
    out.push(await traceweaveHook(tools, req));
    return out;
  }
  if (!req.wavefile) {
    out.push({ status: "unavailable", server: "wave_mcp", tool: WAVE_MCP_PREPARE, message: "no waveform file produced by the run (waves on?) — nothing to hand to wave-mcp" });
    return out;
  }
  out.push(await waveMcpHook(tools, req));
  return out;
}
function inferLane(req) {
  if (req.wavefile?.fmt === "fsdb")
    return "vcs";
  return "oss";
}
async function waveMcpHook(tools, req) {
  const tool = WAVE_MCP_PREPARE;
  if (!hasTool(tools, tool)) {
    return { status: "unavailable", server: "wave_mcp", tool, message: "wave-mcp MCP tool is not wired in this session — " + WAVE_MCP_INSTALL_HINT };
  }
  const args = {
    out_dir: req.sessionDir,
    wave_path: req.wavefile.file,
    top: req.top,
    mode: "speed"
  };
  const res = await invokeTool(tools, tool, args);
  if (res.error !== undefined)
    return { status: "failed", server: "wave_mcp", tool, message: `wave-mcp call failed: ${String(res.error)} — sessions degrade to manual inspection; ${WAVE_MCP_INSTALL_HINT}` };
  if (res.value === undefined)
    return { status: "failed", server: "wave_mcp", tool, message: "wave-mcp returned no structured value; check the MCP row config" };
  return { status: "ok", server: "wave_mcp", tool, message: "wave-mcp session opened for " + req.wavefile.file, session: safeObject(res.value) };
}
async function traceweaveHook(tools, req) {
  const tool = TRACEWEAVE_GET_PATHS;
  if (!hasTool(tools, tool)) {
    return { status: "unavailable", server: "traceweave", tool, message: "TraceWeave MCP tool is not wired in this session — " + TRACEWEAVE_INSTALL_HINT };
  }
  const args = { verif_root: req.verifRoot ?? req.caseDir };
  if (req.caseName)
    args.case_name = req.caseName;
  if (req.simLog)
    args.sim_log = req.simLog;
  if (req.wavefile)
    args.wave_file = req.wavefile.file;
  const res = await invokeTool(tools, tool, args);
  if (res.error !== undefined)
    return { status: "failed", server: "traceweave", tool, message: `TraceWeave call failed: ${String(res.error)}; ${TRACEWEAVE_INSTALL_HINT}` };
  if (res.value === undefined)
    return { status: "failed", server: "traceweave", tool, message: "TraceWeave returned no structured value; check the MCP row config" };
  return { status: "ok", server: "traceweave", tool, message: "TraceWeave path discovery completed", session: safeObject(res.value) };
}
function hasTool(tools, name) {
  try {
    return typeof tools.get === "function" && tools.get(name) !== undefined;
  } catch {
    return false;
  }
}
async function invokeTool(tools, name, args) {
  if (typeof tools.execute !== "function")
    return { error: "tool runtime has no execute()" };
  let signal;
  try {
    signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(120000) : new AbortController().signal;
  } catch {
    signal = new AbortController().signal;
  }
  try {
    const r = await tools.execute({ name, arguments: args, callId: "mpd-verif-wave-" + Date.now(), signal });
    if (r && typeof r === "object" && "isError" in r && r.isError === true) {
      return { error: r.error ?? "tool error" };
    }
    return { value: r?.value };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
function safeObject(v) {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v;
  return { summary: String(v) };
}
function waveSessionDir(caseDir) {
  const override = process.env.MPD_DSH_WAVE_MCP_SESSION;
  if (override && override.trim().length > 0)
    return override;
  const dshHome = process.env.DSH_HOME;
  if (dshHome && dshHome.trim().length > 0)
    return join7(dshHome, "wave-mcp");
  return join7(caseDir, "wave-mcp");
}

// src/sim.ts
function buildSimMakefile(a) {
  const lines = [
    "# Generated by mpd_verif_sim (cocotb Makefile flow). Regenerated on every run — do not edit.",
    ""
  ];
  lines.push("SIM := " + a.backend, "TOPLEVEL_LANG := verilog", "COCOTB_TOPLEVEL := " + a.top);
  lines.push("VERILOG_SOURCES =" + (a.sources.length > 0 ? " \\" : ""));
  for (const f of a.sources)
    lines.push("    " + f + (f !== a.sources[a.sources.length - 1] ? " \\" : ""));
  if (a.includes.length > 0) {
    lines.push("VERILOG_INCLUDE_DIRS =" + (a.includes.length > 0 ? " \\" : ""));
    for (const d of a.includes)
      lines.push("    " + d + (d !== a.includes[a.includes.length - 1] ? " \\" : ""));
  }
  for (const [k, v] of Object.entries(a.defines))
    lines.push("COMPILE_ARGS += +define+" + k + (v === 1 ? "" : "=" + v));
  if (a.backend === "verilator") {
    if (a.coverage)
      lines.push("COMPILE_ARGS += --coverage");
    if (a.waves) {
      lines.push(a.traceFst === false ? `COMPILE_ARGS += --trace --trace-structs
SIM_ARGS += --trace
` : "COMPILE_ARGS += --trace-fst --trace-structs");
    }
  } else {
    lines.push("COMPILE_ARGS += -g2012");
    if (a.waves)
      lines.push("WAVES := 1  # icarus FST via -fst + dump module");
  }
  lines.push("", "include $(shell cocotb-config --makefiles)/Makefile.sim", "");
  return lines.join(`
`);
}
function parseResultsXml(xml) {
  const cases = [];
  let tests = null;
  let failures = null;
  let errors = null;
  let skipped = null;
  for (const sm of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const attrs = sm[1] ?? "";
    const num = (k) => {
      const m = attrs.match(new RegExp(k + '="(\\d+)"'));
      return m ? Number(m[1]) : null;
    };
    tests ??= num("tests");
    failures ??= num("failures");
    errors ??= num("errors");
    skipped ??= num("skipped");
  }
  const caseRe = /<testcase\b([^>]*?)\/?>/g;
  const openTags = [];
  for (const m of xml.matchAll(caseRe)) {
    openTags.push({ index: m.index, end: m.index + m[0].length, attrs: m[1] ?? "" });
  }
  for (let i = 0;i < openTags.length; i++) {
    const tag = openTags[i];
    const nextIdx = i + 1 < openTags.length ? openTags[i + 1].index : xml.indexOf("</testsuite>", tag.end);
    const body = nextIdx >= 0 ? xml.slice(tag.end, nextIdx) : "";
    const get = (k) => {
      const m = tag.attrs.match(new RegExp(k + '="([^"]*)"'));
      return m ? m[1] : null;
    };
    const timeMs = Number(get("time") ?? "0") * 1000;
    const failFull = body.match(/<failure\b[^>]*>([\s\S]*?)<\/failure>/);
    const errFull = body.match(/<error\b[^>]*>([\s\S]*?)<\/error>/);
    const failSelf = body.match(/<failure\b([^>]*)\/>/);
    const errSelf = body.match(/<error\b([^>]*)\/>/);
    const selfMsg = (tagBody, tagName) => {
      const g = (k) => {
        const m = tagBody.match(new RegExp(k + '="([^"]*)"'));
        return m ? m[1] : null;
      };
      const msg = g("error_msg") ?? g("message");
      const type = g("error_type") ?? g("type");
      if (msg && type)
        return `${type}: ${msg}`;
      return msg ?? type ?? `${tagName} (no message)`;
    };
    const fail = failFull ?? failSelf;
    const err = errFull ?? errSelf;
    const skip = body.includes("<skipped");
    const status = skip ? "skip" : err ? "error" : fail ? "fail" : "pass";
    const fm = fail ? fail[1] && fail[1].includes("=") ? selfMsg(fail[1], "failure") : (fail[1] ?? "").trim() || null : err ? err[1] && err[1].includes("=") ? selfMsg(err[1], "error") : (err[1] ?? "").trim() || null : null;
    cases.push({ name: get("name") ?? "?", status, timeMs, failureMsg: fm ? fm.slice(0, 500) : null });
  }
  return { cases, summary: { tests, failures, errors, skipped } };
}
function collectWaves(caseDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync2(dir, { withFileTypes: true })) {
      const p = join8(dir, e.name);
      if (e.isDirectory())
        walk(p);
      else if (/\.(fst|vcd|fsdb)$/i.test(e.name) && statSync(p).size > 0) {
        out.push({ file: p, fmt: e.name.toLowerCase().endsWith(".fst") ? "fst" : e.name.toLowerCase().endsWith(".fsdb") ? "fsdb" : "vcd" });
      }
    }
  };
  walk(caseDir);
  return out.slice(0, 50);
}
async function verifSim(a, deps = {}) {
  if (a.backend === "vcs") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "mpd_verif_sim is the cocotb lane (iverilog|verilator); vcs is handled by mpd_verif_uvm", "call mpd_verif_uvm for the VCS/UVM flow");
  }
  if (!a.sources || a.sources.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no sources given", "pass sources[] (RTL files) for the simulation");
  }
  const gate = requireCocotbVenv();
  const probe = probeBackend(a.backend);
  if (!probe.present) {
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${a.backend}' not found on this machine`, `install it or set MPD_DSH_VERIF_${a.backend.toUpperCase()} to the tool path`);
  }
  const backend = a.backend;
  const waves = a.waves ?? true;
  const stamp = runStamp();
  const caseDir = join8(workDir(), "sim", `${a.top}-${stamp}`);
  mkdirSync4(caseDir, { recursive: true });
  const resultsXml = join8(caseDir, "results.xml");
  const tbModules = a.tbModules && a.tbModules.length > 0 ? a.tbModules : [a.top + "_tb"];
  const tbPathDirs = resolveTbPathDirs(tbModules, a.sources, wsResolved());
  const makePy = buildSimMakefile({
    backend,
    top: a.top,
    sources: a.sources.map((s) => isAbsolute(s) ? s : join8(process.env.DSH_WORKSPACE_ROOT ?? process.cwd(), s)),
    includes: (a.includes ?? []).map((i) => isAbsolute(i) ? i : join8(process.env.DSH_WORKSPACE_ROOT ?? process.cwd(), i)),
    defines: normalizeDefines(a.defines),
    waves,
    traceFst: a.traceFst,
    coverage: a.coverage
  });
  const makefilePath = join8(caseDir, "Makefile");
  writeFileSync3(makefilePath, makePy);
  const simLog = join8(caseDir, "sim.log");
  const venvBin = join8(gate.venv, "bin");
  const makeEnv = {
    PATH: venvBin + ":" + (process.env.PATH ?? ""),
    COCOTB_RESULTS_FILE: resultsXml,
    COCOTB_TEST_MODULES: tbModules.join(","),
    COCOTB_TOPLEVEL: a.top,
    PYTHONPATH: tbPathDirs.join(":"),
    ...a.testFilter ? { COCOTB_TESTCASE: a.testFilter } : {},
    ...a.seed !== undefined ? { COCOTB_RANDOM_SEED: String(a.seed) } : {}
  };
  const r = run("make", ["-f", makefilePath, "sim"], { cwd: caseDir, env: makeEnv, timeoutMs: (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000 });
  writeLog(simLog, "== argv: make -f " + makefilePath + " sim (PATH=" + makeEnv.PATH + `)
` + r.combined + `
EXIT: ` + String(r.status));
  if (r.timedOut) {
    throw new VerifError("VERIF_E_TIMEOUT", `simulation of '${a.top}' timed out`, `increase timeoutSec or narrow the test set; log: ${simLog}`);
  }
  if (r.spawnError) {
    throw new VerifError("VERIF_E_RUN", `make failed to start: ${r.spawnError}`, `ensure make is installed and the venv is healthy (mpd_verif_venv action:"status") — venv at ${gate.venv}`);
  }
  const xmlText = existsSync5(resultsXml) ? readFileSync(resultsXml, "utf8") : null;
  if (!xmlText) {
    throw new VerifError("VERIF_E_RUN", `sim exited (status ${r.status}) but no results.xml was produced by cocotb`, `read ${simLog}; typically a build-stage failure, or a TB import error in ${tbModules.join(", ")} (place the <tb>.py next to an RTL source, in the workspace root, or add it via PYTHONPATH)`);
  }
  const parsed = parseResultsXml(xmlText);
  const failed = parsed.cases.filter((c) => c.status !== "pass").length;
  const ok = r.status === 0 && failed === 0;
  const wavs = collectWaves(caseDir);
  const waveHooks = a.waveHook === false ? [] : await runWaveHooksSafe(deps.tools, wavs, a.top, caseDir);
  return {
    ok,
    backend,
    top: a.top,
    venv: gate.venv,
    cocotbVersion: gate.cocotbVersion,
    seed: a.seed !== undefined ? String(a.seed) : null,
    cases: parsed.cases,
    resultsXml,
    simLog,
    makefilePath,
    caseDir,
    wavesfiles: wavs,
    waveHooks,
    exitCode: r.status,
    ...ok ? {} : {
      error: {
        code: "VERIF_E_RUN",
        message: `simulation failed: ${parsed.cases.filter((c) => c.status !== "pass").length} of ${parsed.cases.length} case(s) not passing (exit ${r.status})`,
        hint: `read ${simLog} and the failure blocks in result.cases; fix the TB/DUT and rerun`
      }
    }
  };
}
function wsResolved() {
  return process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
}
function resolveTbPathDirs(tbModules, sources, wsRoot) {
  const dirs = new Set([wsRoot]);
  const candidates = new Set([wsRoot, join8(wsRoot, "tb")]);
  for (const src of sources) {
    const base = dirname3(isAbsolute(src) ? src : join8(wsRoot, src));
    candidates.add(base);
    candidates.add(join8(base, "tb"));
  }
  for (const tb of tbModules) {
    const flat = tb.split(".")[0];
    for (const d of candidates) {
      if (existsSync5(join8(d, flat + ".py"))) {
        dirs.add(d);
        break;
      }
    }
  }
  return [...dirs];
}
async function runWaveHooksSafe(tools, waves, top, caseDir) {
  try {
    return await runWaveHooks(tools ?? {}, { wavefile: waves[0] ?? null, top, sessionDir: waveSessionDir(caseDir), caseDir });
  } catch (e) {
    return [{ status: "failed", server: "wave_mcp", tool: null, message: "wave hook error: " + String(e) }];
  }
}

// src/uvm.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync5, readdirSync as readdirSync3, readFileSync as readFileSync2, rmSync, writeFileSync as writeFileSync4 } from "node:fs";
import { join as join9 } from "node:path";
var LAYOUT_DIRS = ["rtl", "script", "tb", "top", "test", "work"];
var LAYOUT_REQUIRED_FILES = ["tb_api_primitives.svh"];
var LAYOUT_MANDATORY_TESTS = ["sanity_test", "reg_access_test"];
var MAX_COMPILE_ATTEMPTS = 3;
var DEFAULT_VERBOSITY = "UVM_MEDIUM";
function layoutCheck(ipRoot) {
  const errors = [];
  if (!existsSync6(ipRoot)) {
    return { ok: false, errors: [`missing ip root: <ip> (${ipRoot})`], tests: [] };
  }
  for (const d of LAYOUT_DIRS) {
    if (!existsSync6(join9(ipRoot, d)))
      errors.push(`missing dir: ${d}/`);
  }
  for (const f of LAYOUT_REQUIRED_FILES) {
    if (!existsSync6(join9(ipRoot, "tb", f)) && !findFile(ipRoot, f))
      errors.push(`missing shared BFM source of truth: ${f} (expected under <ip>/tb/)`);
  }
  const testDir = join9(ipRoot, "test");
  const tests = [];
  if (existsSync6(testDir)) {
    for (const e of readdirSync3(testDir)) {
      if (e.endsWith("_test.sv"))
        tests.push(e.slice(0, -3));
    }
  }
  if (tests.length === 0)
    errors.push("no *_test.sv cases found in test/ (naming contract: <case>_test.sv)");
  for (const t of LAYOUT_MANDATORY_TESTS) {
    if (!tests.includes(t))
      errors.push(`mandatory test missing: ${t}_test.sv (sanity_test + reg_access_test are required by the UVM contract)`);
  }
  return { ok: errors.length === 0, errors, tests };
}
function findFile(dir, name) {
  for (const e of readdirSync3(dir, { withFileTypes: true })) {
    const p = join9(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith(".")) {
      if (findFile(p, name))
        return true;
    } else if (e.name === name)
      return true;
  }
  return false;
}
function defaultUvmSeed() {
  const base = Number(String(Date.now()).slice(0, 10));
  return base % 1e6;
}
function resolveVcsBinary() {
  const probe = probeBackend("vcs");
  if (!probe.present || !probe.binary) {
    throw new VerifError("VERIF_E_NO_BACKEND", "vcs is not resolvable on this machine", "set MPD_DSH_VERIF_VCS or add $VCS_HOME/bin to PATH; license vars: VCS_HOME, LM_LICENSE_FILE, SNPSLMD_LICENSE_FILE");
  }
  return probe.binary;
}
function envGate(needs, reason) {
  const missing = needs.filter((k) => !process.env[k] || process.env[k].trim().length === 0);
  if (missing.length > 0) {
    throw new VerifError("VERIF_E_ENV", `${reason} requires: ${needs.join(", ")} — missing: ${missing.join(", ")}`, "export the listed variables in the launching shell (VERDI_HOME/NOVAS_HOME/VCS_HOME + license vars), then retry");
  }
}
function resolveFilelist(args, ipRoot) {
  if (args.filelist && existsSync6(args.filelist))
    return args.filelist;
  const auto = join9(ipRoot, "script", "filelist.f");
  if (existsSync6(auto))
    return auto;
  throw new VerifError("VERIF_E_TEMPLATE", `no filelist: neither the filelist argument nor <ip>/script/filelist.f exists`, `create ${auto} (rtl files + tb_api_primitives.svh + testbench sources) or pass filelist=<path>`);
}
function compileArgs(vcs, args, ipRoot, wdir) {
  const uvmVer = args.uvmVer ?? "1.2";
  const filelist = resolveFilelist(args, ipRoot);
  const covDir = args.coverage ? join9(wdir, "cov", "compile") : null;
  const withDebug = args.action === "wave" || args.action === "regress" && args.coverage;
  const argv = [vcs, "-sverilog", "+v2k", "-ntb_opts", `uvm-${uvmVer}`];
  if (withDebug || args.action === "wave")
    argv.push("-debug_access+all");
  if (args.action === "wave")
    argv.push("-kdb");
  if (covDir)
    argv.push("-cm", "line+cond+tgl", "-cm_dir", covDir);
  for (const i of args.includes ?? [])
    argv.push("+incdir+" + i);
  for (const d of args.defines ?? [])
    argv.push("+define+" + d);
  argv.push("-f", filelist, "-l", join9(wdir, "vcs_compile.log"), "-o", join9(wdir, "simv"));
  return { args: argv, logPath: join9(wdir, "vcs_compile.log"), simv: join9(wdir, "simv"), covDir };
}
function runArgs(simv, args, test, caseDir, covDir) {
  const argv = [simv, "+UVM_TESTNAME=" + test, "+UVM_VERBOSITY=" + (args.verbosity ?? DEFAULT_VERBOSITY)];
  if (args.seed !== undefined)
    argv.push("+ntb_random_seed=" + String(args.seed));
  if (covDir)
    argv.push("-cm", "line+cond+tgl", "-cm_dir", covDir);
  argv.push("-l", join9(caseDir, "run.log"));
  return argv;
}
function countUvmErrors(logText) {
  const m = logText.match(/UVM_ERROR\s*:\s*(\d+)/);
  return m ? Number(m[1]) : logText.includes("UVM_ERROR") ? 1 : 0;
}
function runFsdbreportHooks(wavesfiles, reportDir) {
  const out = [];
  const tool = resolveEdaTool("fsdbreport");
  for (const w of wavesfiles.filter((f) => f.fmt === "fsdb")) {
    if (!tool) {
      out.push({ status: "unavailable", binary: null, args: [], exitCode: null, logPath: "", message: "fsdbreport not wired — " + FSDBREPORT_HINT });
      continue;
    }
    const logPath = join9(reportDir, "fsdbreport.log");
    const r = runFsdbreport(tool.binary, w.file, 120000);
    writeLog(logPath, r.combined);
    out.push(r.status === 0 ? { status: "ok", binary: tool.binary, args: [w.file], exitCode: r.status, logPath, message: "FSDB report clean for " + w.file } : { status: "failed", binary: tool.binary, args: [w.file], exitCode: r.status, logPath, message: "fsdbreport flagged issues in " + w.file + (r.combined ? ": " + r.combined.slice(0, 200) : "") });
  }
  return out;
}
function runCase(vcs, args, simv, test, caseDir, covBase, timeoutMs) {
  mkdirSync5(caseDir, { recursive: true });
  const seed = args.seed !== undefined ? String(args.seed) : String(defaultUvmSeed());
  const covDir = covBase ? join9(covBase, `work_${test}_`) : null;
  const argv = runArgs(simv, { ...args, seed }, test, caseDir, covDir);
  const logPath = join9(caseDir, "run.log");
  const r = run(argv[0], argv.slice(1), { cwd: caseDir, timeoutMs });
  if (r.combined.trim().length > 0)
    writeLog(logPath, r.combined);
  const logText = existsSync6(logPath) ? readFileSync2(logPath, "utf8") : "";
  const uvmErrors = countUvmErrors(logText.trim().length > 0 ? logText : r.combined);
  const waves = collectWaves(caseDir);
  return {
    test,
    seed,
    status: r.status === 0 && uvmErrors === 0 ? "pass" : "fail",
    exitCode: r.status,
    logPath,
    uvmErrors,
    wavefile: waves[0] ? { file: waves[0].file, fmt: waves[0].fmt } : null
  };
}
function readCompileState(wdir) {
  const p = join9(wdir, "compile-state.json");
  try {
    return { ...{ attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false }, ...JSON.parse(readFileSync2(p, "utf8")) };
  } catch {
    return { attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false };
  }
}
function writeCompileState(wdir, s) {
  try {
    writeFileSync4(join9(wdir, "compile-state.json"), JSON.stringify(s));
  } catch {}
}
async function verifUvm(a, tools) {
  const vcs = resolveVcsBinary();
  if (a.action === "wave")
    envGate(["VERDI_HOME", "NOVAS_HOME"].filter((k) => k && k.length > 0), "wave dumping (fsdb)");
  const ipRoot = a.top;
  const wdir = join9(ipRoot, "work");
  const timeoutMs = (a.timeoutSec ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
  if (a.action === "clean") {
    try {
      rmSync(wdir, { recursive: true, force: true });
    } catch {}
    return { ok: true, action: "clean", backend: "vcs", binary: vcs, verbosity: a.verbosity ?? DEFAULT_VERBOSITY, uvmVer: a.uvmVer ?? "1.2", args: ["rm", "-rf", wdir], exitCode: 0, logPath: "", simv: join9(wdir, "simv"), root: ipRoot, cases: [], wavesfiles: [], waveHooks: [], attempts: 0, maxAttempts: MAX_COMPILE_ATTEMPTS, unresolved: false, layoutErrors: [] };
  }
  const layout = a.action === "merge-cov" ? { ok: true, errors: [], tests: [] } : layoutCheck(ipRoot);
  if (!layout.ok) {
    throw new VerifError("VERIF_E_TEMPLATE", "UVM template layout contract violated under " + ipRoot, "expected tree <ip>/{rtl,script,tb,top,test,work/}, tb/tb_api_primitives.svh, test/<case>_test.sv with mandatory sanity_test + reg_access_test — missing: " + layout.errors.join("; "));
  }
  if (a.uvmVer && a.uvmVer !== "1.2" && a.uvmVer !== "1.1") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "unsupported UVM version " + a.uvmVer, "UVM contract targets uvmVer 1.2 (1.1 accepted for legacy benches)");
  }
  mkdirSync5(wdir, { recursive: true });
  const stamp = runStamp();
  if (a.action === "compile") {
    const plan = compileArgs(vcs, a, ipRoot, wdir);
    const r2 = run(plan.args[0], plan.args.slice(1), { timeoutMs });
    writeLog(plan.logPath, r2.combined);
    const state = readCompileState(wdir);
    if (r2.status !== 0) {
      state.attempts += 1;
      state.unresolved = state.attempts >= state.maxAttempts;
      writeCompileState(wdir, state);
      if (state.unresolved)
        writeLog(join9(wdir, "unresolved.md"), `# unresolved compile issues (attempts exhausted)

` + r2.combined.slice(-8000));
      return {
        ok: false,
        action: "compile",
        backend: "vcs",
        binary: vcs,
        verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
        uvmVer: a.uvmVer ?? "1.2",
        args: plan.args,
        exitCode: r2.status,
        logPath: plan.logPath,
        simv: plan.simv,
        root: ipRoot,
        cases: [],
        wavesfiles: [],
        waveHooks: [],
        attempts: state.attempts,
        maxAttempts: state.maxAttempts,
        unresolved: state.unresolved,
        layoutErrors: layout.errors,
        error: { code: "VERIF_E_COMPILE", message: `vcs compile failed (exit ${r2.status}); attempt ${state.attempts}/${state.maxAttempts}`, hint: state.unresolved ? `attempt cap reached — fix issues recorded in ${join9(wdir, "unresolved.md")}, then rerun` : `read ${plan.logPath}, fix the first error, then re-run compile (attempts are tracked)` }
      };
    }
    writeCompileState(wdir, { attempts: 0, maxAttempts: state.maxAttempts, unresolved: false });
    return {
      ok: true,
      action: "compile",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: plan.args,
      exitCode: r2.status,
      logPath: plan.logPath,
      simv: plan.simv,
      root: ipRoot,
      cases: [],
      wavesfiles: [],
      waveHooks: [],
      attempts: 0,
      maxAttempts: state.maxAttempts,
      unresolved: false,
      layoutErrors: layout.errors
    };
  }
  const simvExists = existsSync6(join9(wdir, "simv"));
  if (!simvExists && a.action !== "regress" && a.action !== "merge-cov") {
    throw new VerifError("VERIF_E_RUN", `no compiled simv under ${wdir}; run action:"compile" first`, "call mpd_verif_uvm with action compile, then retry");
  }
  const simv = join9(wdir, "simv");
  if (a.action === "run") {
    const test = a.test ?? "sanity_test";
    if (!layout.tests.includes(test) && !test.endsWith("_test")) {
      throw new VerifError("VERIF_E_TEMPLATE", `test '${test}' is not listed in test/ (*_test.sv contract)`, "pass test=<case> matching a *_test.sv file, or scaffold it under test/");
    }
    const caseDir = join9(wdir, `work_${test}_`);
    const c = runCase(vcs, a, simv, test, caseDir, a.coverage ? join9(wdir, "cov") : null, timeoutMs);
    const wavesfiles = collectWaves(caseDir);
    const waveHooks = a.waveHook === false ? [] : await safeHooks(tools, { wavefile: wavesfiles[0] ?? null, top: test, sessionDir: waveSessionDir(caseDir), caseDir, simLog: c.logPath, verifRoot: ipRoot, caseName: test, lane: "vcs" });
    return {
      ok: c.status === "pass",
      action: "run",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: runArgs(simv, a, test, caseDir, null),
      exitCode: c.exitCode,
      logPath: c.logPath,
      simv,
      root: ipRoot,
      cases: [c],
      wavesfiles,
      waveHooks,
      fsdbReports: runFsdbreportHooks(wavesfiles, caseDir),
      attempts: 0,
      maxAttempts: MAX_COMPILE_ATTEMPTS,
      unresolved: false,
      layoutErrors: layout.errors,
      ...c.status === "pass" ? {} : { error: { code: "VERIF_E_RUN", message: `UV M test '${test}' failed (uvm_errors=${c.uvmErrors ?? "?"})`, hint: `read ${c.logPath}; wave via wave-mcp/TraceWeave if wired` } }
    };
  }
  if (a.action === "wave") {
    const test = a.test ?? "sanity_test";
    const caseDir = join9(wdir, `work_${test}_wave`);
    const c = runCase(vcs, a, simv, test, caseDir, null, timeoutMs);
    const wavesfiles = collectWaves(caseDir);
    const waveHooks = a.waveHook === false ? [] : await safeHooks(tools, { wavefile: wavesfiles[0] ?? null, top: test, sessionDir: waveSessionDir(caseDir), caseDir, simLog: c.logPath, verifRoot: ipRoot, caseName: test, lane: "vcs" });
    return {
      ok: c.status === "pass",
      action: "wave",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: runArgs(simv, a, test, caseDir, null),
      exitCode: c.exitCode,
      logPath: c.logPath,
      simv,
      root: ipRoot,
      cases: [c],
      wavesfiles,
      waveHooks,
      fsdbReports: runFsdbreportHooks(wavesfiles, caseDir),
      attempts: 0,
      maxAttempts: MAX_COMPILE_ATTEMPTS,
      unresolved: false,
      layoutErrors: layout.errors,
      ...wavesfiles.length === 0 ? { error: { code: "VERIF_E_RUN", message: "wave run produced no fsdb/vcd", hint: "dump $fsdbDumpfile inside the TB (FSDB contract) and retry wave" } } : {}
    };
  }
  if (a.action === "regress") {
    const covSeed = a.coverage ? join9(wdir, "cov") : null;
    const cases = [];
    const simvNow = existsSync6(simv) ? simv : (() => {
      const plan = compileArgs(vcs, a, ipRoot, wdir);
      const rc = run(plan.args[0], plan.args.slice(1), { timeoutMs });
      writeLog(plan.logPath, rc.combined);
      if (rc.status !== 0)
        throw new VerifError("VERIF_E_COMPILE", `regress pre-compile failed (exit ${rc.status})`, `read ${plan.logPath} and rerun`);
      return plan.simv;
    })();
    for (const t of layout.tests) {
      const caseDir = join9(wdir, `work_${t}_`, stamp);
      cases.push(runCase(vcs, a, simvNow, t, caseDir, covSeed, timeoutMs));
    }
    const ok = cases.every((c) => c.status === "pass");
    const wavesfiles = cases.map((c) => c.wavefile).filter((w) => Boolean(w));
    const regHooks = [];
    if (a.waveHook !== false) {
      for (const c of cases) {
        if (!c.wavefile || regHooks.length >= 10)
          continue;
        regHooks.push(...await safeHooks(tools, { wavefile: { file: c.wavefile.file, fmt: c.wavefile.fmt }, top: c.test, sessionDir: waveSessionDir(wdir), caseDir: wdir, simLog: c.logPath, verifRoot: ipRoot, caseName: c.test, lane: "vcs" }));
      }
    }
    return {
      ok,
      action: "regress",
      backend: "vcs",
      binary: vcs,
      verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
      uvmVer: a.uvmVer ?? "1.2",
      args: [],
      exitCode: ok ? 0 : 1,
      logPath: join9(wdir, `regress-${stamp}.md`),
      simv: simvNow,
      root: ipRoot,
      cases,
      wavesfiles,
      waveHooks: regHooks,
      fsdbReports: runFsdbreportHooks(wavesfiles, wdir),
      attempts: 0,
      maxAttempts: MAX_COMPILE_ATTEMPTS,
      unresolved: false,
      layoutErrors: layout.errors,
      ...ok ? {} : { error: { code: "VERIF_E_RUN", message: `${cases.filter((c) => c.status !== "pass").length} of ${cases.length} UVM case(s) failed`, hint: "read the per-case run logs under work/work_<case>_/" } }
    };
  }
  const covRoot = join9(wdir, "cov");
  if (!existsSync6(covRoot)) {
    throw new VerifError("VERIF_E_RUN", "no coverage data: " + covRoot, "run compile/regress with coverage:true before merging");
  }
  const urg = process.env.MPD_DSH_VERIF_URG ?? join9(process.env.VCS_HOME ?? "/usr", "bin", "urg");
  const dirs = readdirSync3(covRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join9(covRoot, e.name));
  if (dirs.length === 0) {
    throw new VerifError("VERIF_E_RUN", "no coverage directory content under " + covRoot, "enable coverage on compile/run and re-run the regression");
  }
  const reportDir = join9(wdir, "cov_report");
  const argv = [urg, ...dirs.flatMap((d) => ["-dir", d]), "-report", reportDir, "-format", "both"];
  const r = run(argv[0], argv.slice(1), { timeoutMs });
  return {
    ok: r.status === 0,
    action: "merge-cov",
    backend: "vcs",
    binary: vcs,
    verbosity: a.verbosity ?? DEFAULT_VERBOSITY,
    uvmVer: a.uvmVer ?? "1.2",
    args: argv,
    exitCode: r.status,
    logPath: join9(wdir, "urg.log"),
    simv,
    root: ipRoot,
    cases: [],
    wavesfiles: [],
    waveHooks: [],
    attempts: 0,
    maxAttempts: MAX_COMPILE_ATTEMPTS,
    unresolved: false,
    layoutErrors: layout.errors,
    covReport: reportDir,
    ...r.status === 0 ? {} : { error: { code: "VERIF_E_ENV", message: "urg merge failed", hint: "ensure urg is available (VCS_HOME/bin or MPD_DSH_VERIF_URG)" } }
  };
}
async function safeHooks(tools, req) {
  try {
    return await runWaveHooks(tools ?? {}, req);
  } catch (e) {
    return [{ status: "failed", server: "traceweave", tool: null, message: "wave hook error: " + String(e) }];
  }
}

// src/regress.ts
import { mkdirSync as mkdirSync6, writeFileSync as writeFileSync5, existsSync as existsSync7, readdirSync as readdirSync4 } from "node:fs";
import { join as join10 } from "node:path";
function expandCases(args) {
  if (args.cases && args.cases.length > 0)
    return { kind: "explicit", names: args.cases };
  if (args.glob) {
    const root = process.env.DSH_WORKSPACE_ROOT ?? process.cwd();
    return { kind: "explicit", names: globFiles(root, args.glob) };
  }
  return { kind: "explicit", names: ["all"] };
}
function globFiles(root, pattern) {
  const out = [];
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  const walk = (dir) => {
    if (!existsSync7(dir))
      return;
    for (const e of readdirSync4(dir, { withFileTypes: true })) {
      const p = join10(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith("."))
          walk(p);
        continue;
      }
      const rel = p.slice(root.length + 1);
      if (re.test(rel))
        out.push(rel);
    }
  };
  walk(root);
  return out.slice(0, 100);
}
async function verifRegress(args, tools) {
  const backend = args.backend;
  if (!["iverilog", "verilator", "vcs"].includes(backend) || backend === "") {
    throw new VerifError("VERIF_E_UNSUPPORTED", "unsupported regression backend: " + String(backend), "use iverilog | verilator (cocotb lane) or vcs (UVM lane)");
  }
  const seedBase = args.seedBase ?? dateSeedBase();
  const stamp = runStamp();
  const regressDir = join10(workDir(), "regress", stamp);
  mkdirSync6(regressDir, { recursive: true });
  if (backend === "vcs") {
    const top = args.sim?.top;
    if (!top)
      throw new VerifError("VERIF_E_RUN", "vcs regression needs sim.top (the <ip> root for the UVM layout)", "pass sim.top=<ip-root>");
    const probe2 = probeBackend("vcs");
    if (!probe2.present)
      throw new VerifError("VERIF_E_NO_BACKEND", "vcs not resolvable", "set MPD_DSH_VERIF_VCS or add $VCS_HOME/bin to PATH");
    const uvmRes = await verifUvm({
      action: "regress",
      top,
      coverage: true,
      test: undefined,
      timeoutSec: args.timeoutSec,
      waveHook: args.waveHook !== false
    }, tools);
    const cases2 = uvmRes.cases.map((c) => ({ backend: "vcs", test: c.test, seed: c.seed, status: c.status === "pass" ? "pass" : "fail", timeMs: 0, wave: c.wavefile ?? null, failureMsg: null }));
    const rep2 = buildReport("vcs", cases2, seedBase);
    const resultsJson2 = join10(regressDir, "results.json");
    writeFileSync5(resultsJson2, JSON.stringify({ backend, seedBase, total: cases2.length, passed: cases2.filter((c) => c.status === "pass").length, failed: cases2.filter((c) => c.status === "fail").length, skipped: 0, cases: cases2 }, null, 2));
    const reportPath2 = join10(regressDir, "results.md");
    writeFileSync5(reportPath2, rep2);
    return {
      ok: uvmRes.ok,
      backend,
      total: cases2.length,
      passed: cases2.filter((c) => c.status === "pass").length,
      failed: cases2.filter((c) => c.status === "fail").length,
      skipped: 0,
      seedBase,
      cases: cases2,
      resultsJson: resultsJson2,
      reportMarkdown: rep2,
      reportPath: reportPath2,
      waveHooks: uvmRes.waveHooks,
      ...uvmRes.ok ? {} : { error: uvmRes.error }
    };
  }
  const gate = requireCocotbVenv();
  const probe = probeBackend(backend);
  if (!probe.present)
    throw new VerifError("VERIF_E_NO_BACKEND", `backend '${backend}' not found`, `install it or set MPD_DSH_VERIF_${backend.toUpperCase()}`);
  const expanded = expandCases(args);
  if (expanded.names.length === 0)
    throw new VerifError("VERIF_E_RUN", "no regression cases matched", "pass cases[] or a glob that matches tb modules");
  if (!args.sim?.top)
    throw new VerifError("VERIF_E_RUN", "regression needs sim.top (hdl_toplevel)", "pass sim.top=<toplevel-module>");
  if (!args.sim?.sources || args.sim.sources.length === 0)
    throw new VerifError("VERIF_E_RUN", "regression needs sim.sources", "pass sim.sources=[RTL files]");
  const cases = [];
  const waveHooks = [];
  let stop = false;
  const maxFailures = args.maxFailures ?? 0;
  for (let idx = 0;idx < expanded.names.length && !stop; idx++) {
    const name = expanded.names[idx];
    const seed = String(seedBase + idx);
    try {
      const r = await verifSim({
        backend,
        top: args.sim.top,
        tbModules: args.sim.tbModules,
        sources: args.sim.sources,
        includes: args.sim.includes,
        defines: args.sim.defines,
        testFilter: name === "all" ? undefined : name,
        seed,
        waves: args.sim.waves ?? true,
        traceFst: args.sim.traceFst ?? true,
        coverage: args.sim.coverage ?? false,
        timeoutSec: args.timeoutSec,
        waveHook: false
      }, {});
      const status = r.ok && r.cases.length > 0 && r.cases.every((c) => c.status === "pass") ? "pass" : "fail";
      const wave = r.wavesfiles[0] ? { file: r.wavesfiles[0].file, fmt: r.wavesfiles[0].fmt } : null;
      cases.push({ backend, test: name, seed, status, timeMs: r.cases.reduce((s2, c) => s2 + c.timeMs, 0), wave, failureMsg: r.error?.message ?? null });
      if (args.waveHook !== false && wave) {
        waveHooks.push(...await runWaveHooks(tools ?? {}, { wavefile: { file: wave.file, fmt: wave.fmt }, top: args.sim.top, sessionDir: waveSessionDir(join10(workDir(), "sim")), caseDir: r.caseDir, lane: "oss" }));
      }
    } catch (e) {
      const re = refusalOfLike(e);
      cases.push({ backend, test: name, seed, status: "fail", timeMs: 0, wave: null, failureMsg: re.message });
      waveHooks.push({ status: "failed", server: "wave_mcp", tool: null, message: re.message });
    }
    const failed = cases.filter((c) => c.status === "fail").length;
    if (maxFailures > 0 && failed >= maxFailures)
      stop = true;
    if (args.stopOnError && failed > 0)
      stop = true;
  }
  const passed = cases.filter((c) => c.status === "pass").length;
  const failedN = cases.filter((c) => c.status === "fail").length;
  const skipped = cases.filter((c) => c.status === "skip").length;
  const rep = buildReport(backend, cases, seedBase);
  const resultsJson = join10(regressDir, "results.json");
  writeFileSync5(resultsJson, JSON.stringify({ backend, seedBase, total: cases.length, passed, failed: failedN, skipped, cases: cases.map(({ wave, ...rest }) => rest) }, null, 2));
  const reportPath = join10(regressDir, "results.md");
  writeFileSync5(reportPath, rep);
  return {
    ok: failedN === 0 && cases.length > 0,
    backend,
    total: cases.length,
    passed,
    failed: failedN,
    skipped,
    seedBase,
    cases,
    resultsJson,
    reportMarkdown: rep,
    reportPath,
    waveHooks,
    ...failedN === 0 ? {} : { error: { code: "VERIF_E_RUN", message: `${failedN} of ${cases.length} regression case(s) failed`, hint: `read ${reportPath} and the per-case logs under ${regressDir}/../sim` } }
  };
}
function refusalOfLike(e) {
  if (e instanceof VerifError)
    return { code: e.code, message: e.message, hint: e.hint };
  return { code: "VERIF_E_RUN", message: String(e), hint: "inspect the per-case log" };
}
function buildReport(backend, cases, seedBase) {
  const lines = [
    `# RTL regression report (${backend})`,
    "",
    `- seedBase: ${seedBase}`,
    `- cases: ${cases.length}, passed: ${cases.filter((c) => c.status === "pass").length}, failed: ${cases.filter((c) => c.status === "fail").length}, skipped: ${cases.filter((c) => c.status === "skip").length}`,
    "",
    "| case | seed | status | time(ms) | wave | notes |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const c of cases) {
    lines.push(`| ${c.test} | ${c.seed} | ${c.status} | ${Math.round(c.timeMs)} | ${c.wave ? c.wave.fmt : "-"} | ${esc(c.failureMsg ?? "")} |`);
  }
  return lines.join(`
`) + `
`;
}
function esc(s) {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}

// src/index.ts
var name = "mpd-verif";
var inject = ["tools"];
function textBlock(text) {
  return [{ type: "text", text }];
}
var scalar = (desc) => ({ type: "string", description: desc });
function apply(ctx) {
  ctx.tools.register({
    name: "mpd_verif_venv",
    description: "Manage the project-local cocotb venv (iron rule: default <workspace>/.venv-rtl or MPD_DSH_VERIF_VENV). action=status reports {ok, verdict, cocotbVersion}; action=create bootstraps via 'python3 -m venv' and installs cocotb>=2.0 with the venv's own pip (system python/pip are NEVER used).",
    parameters: {
      type: "object",
      properties: { action: { type: "string", enum: ["status", "create", "info"], description: "status (default) | create the venv + install cocotb | info about resolved paths/env" }, path: { type: "string", description: "optional venv path override" } }
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, verdict: { type: "string" }, venv: { type: "string" }, something: {} } },
      render: (_a, v) => textBlock("mpd_verif_venv: " + v.message + (v.error ? `
ERROR(` + v.error.code + "): " + v.error.hint : ""))
    },
    execute: async (args) => {
      try {
        const action = (args?.action ?? "status") === "create" ? "create" : (args?.action ?? "status") === "info" ? "info" : "status";
        if (action === "info") {
          const p = paths(args?.path ? String(args.path) : undefined);
          const envKeys = Object.fromEntries(BACKEND_IDS.map((b) => ["MPD_DSH_VERIF_" + b.toUpperCase(), process.env["MPD_DSH_VERIF_" + b.toUpperCase()] ?? null]));
          return {
            ok: true,
            action: "info",
            workspace: p.workspace,
            venv: p.venv,
            work: p.work,
            message: `verif env: workspace ${p.workspace}; venv ${p.venv}; work ${p.work}`,
            env: { ...envKeys, MPD_DSH_VERIF_VENV: process.env.MPD_DSH_VERIF_VENV ?? null, MPD_DSH_VERIF_WORK: process.env.MPD_DSH_VERIF_WORK ?? null }
          };
        }
        if (action === "create") {
          const res = venvCreate(args?.path ? String(args.path) : undefined);
          return { ...res, action: "create" };
        }
        const st = venvStatus(args?.path ? String(args.path) : undefined);
        return { ...st, action: "status" };
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_backends",
    description: "Probe RTL backend availability: for iverilog|verilator|vcs (or all) resolves the effective binary via PATH or MPD_DSH_VERIF_* env, reports presence/version and (vcs) license env hints.",
    parameters: {
      type: "object",
      properties: { backend: { type: "string", enum: [...BACKEND_IDS, "all"], description: "backend id or 'all' (default)" } }
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backends: { type: "array" } } },
      render: (_a, v) => textBlock("mpd_verif_backends: " + (v.backends ?? []).map((b) => `${b.backend}=${b.present ? "present(" + (b.version ?? "?") + ")" : "absent"} @${b.binary ?? "-"}`).join("; ") + (v.note ? `
` + v.note : ""))
    },
    execute: async (args) => {
      try {
        const want = String(args?.backend ?? "all");
        const list = want === "all" ? probeAll() : BACKEND_IDS.filter((b) => b === want).map((b) => probeAll().find((p) => p.backend === b)).filter(Boolean);
        const missing = list.filter((b) => !b.present).map((b) => b.backend);
        return {
          ok: list.some((b) => b.present),
          backends: list,
          note: missing.length > 0 ? `missing: ${missing.join(", ")} — install, or pin MPD_DSH_VERIF_<BACKEND> env paths` : "all requested backends present"
        };
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_compile",
    description: "Compile RTL to a sim binary with one backend: iverilog (-g2012 -o simv_iverilog) | verilator (--binary) | vcs (-sverilog +v2k -f filelist -o simv, auto-resolved via PATH/MPD_DSH_VERIF_*). Returns structured diagnostics {file,line,severity,code,message} parsed from the log on failure (VERIF_E_COMPILE).",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "backend to use" },
        sources: { type: "array", items: { type: "string" }, description: "RTL source files" },
        top: scalar("top module (optional)"),
        includes: { type: "array", items: { type: "string" }, description: "include dirs" },
        defines: { description: "macro defines: object {MACRO: value} or array ['MACRO', 'MACRO=value']" },
        timeoutSec: { type: "number" }
      },
      required: ["backend", "sources"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, diagnostics: { type: "array" }, something: {} } },
      render: (_a, v) => textBlock(v.ok ? `mpd_verif_compile OK — ${v.backend} → ${v.outBinary ?? "binary"}
log: ${v.logPath}` : `mpd_verif_compile FAILED (${v.backend}, exit ${v.exitCode}) — ${(v.diagnostics ?? []).length} diagnostics
log: ${v.logPath}
first errors:
` + (v.diagnostics ?? []).slice(0, 8).map((d) => `  ${d.file}:${d.line ?? "?"} [${d.severity}] ${d.message}`).join(`
`))
    },
    execute: async (args) => {
      try {
        return verifCompile({
          backend: String(args?.backend),
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          top: args?.top ? String(args.top) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          target: "compile",
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined
        });
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_lint",
    description: "Lint RTL with one backend (auto-resolved): iverilog -g2012 -tnull -Wall | verilator --lint-only -Wall | vcs -lca -sverilog +lint=all -f <filelist>. Returns structured diagnostics {file,line,severity,code,message} parsed from the log (VERIF_E_COMPILE on failure).",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "backend to use" },
        sources: { type: "array", items: { type: "string" }, description: "RTL source files" },
        top: scalar("top module (optional)"),
        includes: { type: "array", items: { type: "string" }, description: "include dirs" },
        defines: { description: "macro defines: object {MACRO: value} or array ['MACRO', 'MACRO=value']" },
        timeoutSec: { type: "number" }
      },
      required: ["backend", "sources"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, diagnostics: { type: "array" }, something: {} } },
      render: (_a, v) => textBlock(v.ok ? `mpd_verif_lint OK (${v.backend}) — log: ${v.logPath}` : `mpd_verif_lint FAILED (${v.backend}, exit ${v.exitCode}) — ${(v.diagnostics ?? []).length} diagnostics
log: ${v.logPath}
first errors:
` + (v.diagnostics ?? []).slice(0, 8).map((d) => `  ${d.file}:${d.line ?? "?"} [${d.severity}] ${d.message}`).join(`
`))
    },
    execute: async (args) => {
      try {
        return verifCompile({
          backend: String(args?.backend),
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          top: args?.top ? String(args.top) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          target: "lint",
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined
        });
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_coverage",
    description: "Merge/report code coverage across lanes (owner DP-4): verilator — merge Verilator coverage .dat files (verilator_coverage --write merged.dat) or annotate a report (--annotate --all <dir> <merged.dat>); vcs — urg merge+report over per-case -cm_dir payloads (urg -dir ... -report ...); iverilog regions refused (VERIF_E_UNSUPPORTED, no native coverage). Binaries resolve via MPD_DSH_VERIF_* / VCS_HOME / VERDI_HOME / NOVAS_HOME / PATH.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "coverage lane" },
        action: { type: "string", enum: ["merge", "report"], description: "merge datasets into <reportDir>/merged.dat (default) or annotate a report (verilator)" },
        dir: scalar("scan root for coverage payloads (default <work>/.mpd/verif)"),
        reportDir: scalar("report directory (default <work>/.mpd/verif/cov_report)"),
        mergedDat: scalar("existing merged dataset path (action=report)"),
        timeoutSec: { type: "number" }
      },
      required: ["backend"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, reportDir: { type: "string" }, something: {} } },
      render: (_a, v) => textBlock(v.error ? `mpd_verif_coverage FAILED: ${v.error.message}
hint: ${v.error.hint}` : `mpd_verif_coverage OK (${v.backend}) — ${(v.messages ?? []).join("; ") || "done"}
report: ${v.reportDir ?? "-"}`)
    },
    execute: async (args) => {
      try {
        return verifCoverage({
          backend: String(args?.backend),
          action: String(args?.action ?? "merge"),
          dir: args?.dir ? String(args.dir) : undefined,
          reportDir: args?.reportDir ? String(args.reportDir) : undefined,
          mergedDat: args?.mergedDat ? String(args.mergedDat) : undefined,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined
        });
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_sim",
    description: "Run a cocotb simulation on iverilog or verilator. IRON RULE: refuses (VERIF_E_NO_VENV) unless the project venv exists AND cocotb imports inside it — the refusal carries the exact setup command; every run uses <venv>/bin/python runner.py. Generates a cocotb.runner script, executes it, parses results.xml into per-case statuses, collects waves (.fst/.vcd), and optionally hands the waveform to the wired wave-mcp MCP tool.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: ["iverilog", "verilator", "vcs"], description: "backend (vcs refused: use mpd_verif_uvm)" },
        top: scalar("hdl_toplevel module"),
        tbModules: { type: "array", items: { type: "string" }, description: "python test modules (default: [top + '_tb'])" },
        sources: { type: "array", items: { type: "string" }, description: "RTL sources" },
        includes: { type: "array", items: { type: "string" } },
        defines: { description: "macro defines (object or array of MACRO[=value])" },
        testFilter: scalar("cocotb testcase filter (optional)"),
        seed: { description: "seed (number or string)" },
        waves: { type: "boolean", description: "dump waves (default true)" },
        traceFst: { type: "boolean", description: "verilator: use +--trace-fst for FST (owner DP-6 default; needs liblz4 headers; false → VCD)" },
        coverage: { type: "boolean", description: "verilator lane: compile with --coverage (payload for mpd_verif_coverage)" },
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean", description: "hand the wave to wave-mcp if wired (default true)" }
      },
      required: ["backend", "top", "sources"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, cases: { type: "array" } } },
      render: (_a, v) => {
        if (v.error)
          return textBlock(`mpd_verif_sim FAILED: ${v.error.message}
hint: ${v.error.hint}`);
        const cases = v.cases ?? [];
        const body = cases.map((c) => `  ${c.status.toUpperCase()} ${c.name} (${Math.round(c.timeMs)}ms)${c.failureMsg ? " — " + c.failureMsg.slice(0, 200) : ""}`).join(`
`);
        const waves = (v.wavesfiles ?? []).map((w) => `  ${w.file} (${w.fmt})`).join(`
`);
        const hook = (v.waveHooks ?? []).map((h) => `  [${h.status}] ${h.server}: ${h.message.slice(0, 160)}`).join(`
`);
        return textBlock(`mpd_verif_sim ${v.ok ? "PASS" : "FAIL"} (${v.backend}, ${v.top}, seed ${v.seed ?? "auto"}) — ${cases.length} case(s)
${body}${waves ? `
waves:
` + waves : ""}${hook ? `
wave hooks:
` + hook : ""}
log: ${v.simLog}`);
      }
    },
    execute: async (args) => {
      try {
        return await verifSim({
          backend: String(args?.backend),
          top: String(args?.top ?? ""),
          tbModules: Array.isArray(args?.tbModules) ? args.tbModules.map(String) : undefined,
          sources: Array.isArray(args?.sources) ? args.sources.map(String) : [],
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: args?.defines ?? undefined,
          testFilter: args?.testFilter ? String(args.testFilter) : undefined,
          seed: args?.seed ?? undefined,
          waves: args?.waves ?? true,
          traceFst: args?.traceFst ?? true,
          coverage: args?.coverage ?? false,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
          waveHook: args?.waveHook ?? true
        }, { tools: ctx.tools });
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_uvm",
    description: "UVM methodology lane FOR VCS ONLY (owner decision; cocotb owns the open-source backends). Orchestrates a user-scaffolded UVM tree (<ip>/{rtl,script,tb,top,test,work}) — the plugin ships no template content, it validates the layout contract (tb_api_primitives.svh shared BFM, *_test.sv naming, mandatory sanity_test + reg_access_test) and drives the makefile-style contract: uvm-1.2, seed control, per-case work dirs, coverage -cm line+cond+tgl with urg merge, capped compile-fix attempts with unresolved.md. Methodology grounded in gen-tb-skill (structure) + raysalemi/uvmprimer (patterns) — no code reused from either.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["compile", "run", "regress", "wave", "merge-cov", "clean"], description: "lane action" },
        top: scalar("<ip> project root holding the UVM tree"),
        filelist: scalar("explicit filelist (default <ip>/script/filelist.f)"),
        includes: { type: "array", items: { type: "string" } },
        defines: { type: "array", items: { type: "string" } },
        test: scalar("test case name (default sanity_test)"),
        uvmVer: scalar("UVM version (default 1.2)"),
        seed: { description: "seed (default: date-derived)" },
        coverage: { type: "boolean", description: "enable -cm line+cond+tgl" },
        waveFmt: { type: "string", enum: ["fsdb", "vcd"] },
        verbosity: scalar("UVM verbosity (default UVM_MEDIUM)"),
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean", description: "hand logs/waves to TraceWeave if wired (default true)" }
      },
      required: ["action", "top"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, action: { type: "string" }, cases: { type: "array" }, something: {} } },
      render: (_a, v) => {
        if (v.error)
          return textBlock(`mpd_verif_uvm ${v.action} FAILED: ${v.error.message}
hint: ${v.error.hint}`);
        const cases = (v.cases ?? []).map((c) => `  ${c.test}: ${c.status} (seed ${c.seed}, uvm_errors=${c.uvmErrors ?? "-"})`).join(`
`);
        const cov = v.covReport ? `
coverage report: ${v.covReport}` : "";
        const fsdb = (v.fsdbReports ?? []).map((h) => `  [${h.status}] fsdbreport: ${h.message.slice(0, 120)}`).join(`
`);
        const attempt = v.action === "compile" ? ` (attempt ${v.attempts}/${v.maxAttempts}${v.unresolved ? ", UNRESOLVED see work/unresolved.md" : ""})` : "";
        return textBlock(`mpd_verif_uvm ${v.action} ${v.ok ? "OK" : "FAILED"}${attempt}
${cases}${fsdb ? `
fsdb reports:
` + fsdb : ""}${cov}${v.logPath ? `
log: ` + v.logPath : ""}`);
      }
    },
    execute: async (args) => {
      try {
        return await verifUvm({
          action: String(args?.action ?? "compile"),
          top: String(args?.top ?? ""),
          filelist: args?.filelist ? String(args.filelist) : undefined,
          includes: Array.isArray(args?.includes) ? args.includes.map(String) : undefined,
          defines: Array.isArray(args?.defines) ? args.defines.map(String) : undefined,
          test: args?.test ? String(args.test) : undefined,
          uvmVer: args?.uvmVer ? String(args.uvmVer) : "1.2",
          seed: args?.seed ?? undefined,
          coverage: args?.coverage ?? false,
          waveFmt: args?.waveFmt === "vcd" ? "vcd" : "fsdb",
          verbosity: args?.verbosity ? String(args.verbosity) : undefined,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
          waveHook: args?.waveHook ?? true
        }, ctx.tools ?? {});
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
  ctx.tools.register({
    name: "mpd_verif_regress",
    description: "Run a regression across cases on one backend: cocotb lane (iverilog|verilator, per-case seed = seedBase+idx, results aggregated from results.xml) or the UVM lane (vcs, per-case work dirs). Writes <work>/regress/<stamp>/results.json + results.md report; waves can be handed to wave-mcp/TraceWeave when wired.",
    parameters: {
      type: "object",
      properties: {
        backend: { type: "string", enum: [...BACKEND_IDS], description: "regression backend" },
        cases: { type: "array", items: { type: "string" }, description: "case names (cocotb testcase filters; default: ['all']); vcs lane discovers test/*_test.sv" },
        glob: scalar("tb-file glob alternative to cases[]"),
        seedBase: { type: "number", description: "seed base (default: date-based)" },
        maxFailures: { type: "number", description: "stop after N failures (0 = unlimited)" },
        stopOnError: { type: "boolean" },
        timeoutSec: { type: "number" },
        waveHook: { type: "boolean" },
        sim: {
          type: "object",
          properties: {
            top: scalar("hdl_toplevel (cocotb lane) or <ip> root (vcs lane)"),
            sources: { type: "array", items: { type: "string" } },
            tbModules: { type: "array", items: { type: "string" } },
            includes: { type: "array", items: { type: "string" } },
            defines: { description: "macro defines" },
            waves: { type: "boolean", description: "dump waves per case (default true)" },
            traceFst: { type: "boolean", description: "verilator: +--trace-fst FST (default true; false → VCD)" },
            coverage: { type: "boolean", description: "verilator: compile with --coverage" }
          },
          description: "shared sim plan"
        }
      },
      required: ["backend"]
    },
    output: {
      schema: { type: "object", properties: { ok: { type: "boolean" }, backend: { type: "string" }, total: { type: "number" }, passed: { type: "number" }, failed: { type: "number" }, reportMarkdown: { type: "string" } } },
      render: (_a, v) => textBlock(v.error ? `mpd_verif_regress FAILED: ${v.error.message}
hint: ${v.error.hint}` : `mpd_verif_regress (${v.backend}): ${v.passed}/${v.total} passed, ${v.failed} failed, ${v.skipped} skipped (seedBase ${v.seedBase})
report: ${v.reportPath}
` + (v.cases ?? []).map((c) => `  ${c.test} [${c.status}] seed ${c.seed}${c.wave ? " wave:" + c.wave.fmt : ""}`).join(`
`))
    },
    execute: async (args) => {
      try {
        return await verifRegress({
          backend: String(args?.backend),
          cases: Array.isArray(args?.cases) ? args.cases.map(String) : undefined,
          glob: args?.glob ? String(args.glob) : undefined,
          seedBase: typeof args?.seedBase === "number" ? args.seedBase : undefined,
          maxFailures: typeof args?.maxFailures === "number" ? args.maxFailures : undefined,
          stopOnError: args?.stopOnError ?? false,
          timeoutSec: typeof args?.timeoutSec === "number" ? args.timeoutSec : undefined,
          waveHook: args?.waveHook ?? true,
          sim: args?.sim && typeof args.sim === "object" ? {
            top: args.sim.top ? String(args.sim.top) : undefined,
            sources: Array.isArray(args.sim.sources) ? args.sim.sources.map(String) : undefined,
            tbModules: Array.isArray(args.sim.tbModules) ? args.sim.tbModules.map(String) : undefined,
            includes: Array.isArray(args.sim.includes) ? args.sim.includes.map(String) : undefined,
            defines: args.sim.defines ?? undefined,
            waves: args.sim.waves ?? true,
            traceFst: args.sim.traceFst ?? true,
            coverage: args.sim.coverage ?? false
          } : undefined
        }, ctx.tools ?? {});
      } catch (e) {
        return refusalOf(e);
      }
    }
  });
}
export {
  workspaceRoot,
  workDir,
  verifUvm,
  verifSim,
  verifRegress,
  verifCoverage,
  verifCompile,
  venvStatus,
  venvPath,
  venvCreate,
  probeAll,
  name,
  inject,
  apply
};
