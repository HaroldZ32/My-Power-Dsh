#!/usr/bin/env node
// Repo wrapper around the harness's `--dump-config` flag (AGENTS.md §4, friction item T-31).
//
// WHY THIS EXISTS: `--dump-config` only COMPOSES rows and never executes plugin code, so a
// schema/apply abort that takes the whole plugin tree down is invisible to it. AGENTS.md §4
// records the measured incident: `dsh --profile mpd --dump-config` exited 0 with the
// `mpd-workmate` row present while the REAL boot of the same profile could not load the tree;
// the decisive check was a mounting boot with registration instrumentation (WORKMATE_TOOLS 7/7 ok,
// 0 apply-crash signatures). The harness flag is not ours to patch, so the warning has to come
// from here: this wrapper prints a delimited banner BEFORE the child's own output and a closing
// recap after it, in the same stdout the reader is already looking at.
//
// Usage:
//   node scripts/dump-config.mjs [--profile <name>] [--bin <path>] [--quiet] [--json] [--self-test] [-- <extra dsh args…>]
//
//   --profile <name>  profile to compose. OMITTED -> NO profile flag is passed at all and dsh
//                     falls back to its OWN default profile; the banner states which case ran.
//   --bin <path>      dsh executable to run (default: `dsh`, resolved through PATH). This is also
//                     the seam the --self-test drives, so the self-test needs no real dsh.
//   --quiet           keep ONE one-line warning on stdout instead of the full banner + closing
//                     recap. Deliberately not silent: a mode that dropped the rule entirely would
//                     resurrect T-31 for whoever scripts this wrapper.
//   --json            capture the child's stdio and print ONE JSON object on stdout
//                     ({bin, args, profile, exitCode, exitCodeSource, stdoutBytes, bannerEmitted,
//                     childSpawnError, stdout}); the banner and the recap move to STDERR so stdout
//                     stays parseable, and the child's captured stderr is forwarded to ours so no
//                     output is swallowed.
//   --self-test       six offline arms (see selfTest()) against fixture children in a temp dir.
//   -- <args…>        appended VERBATIM after --dump-config.
//
// Exit code = the CHILD's exit code, always (a child's 3 stays 3). When the child can never be
// spawned the wrapper exits 127 — the shell's "command not found" convention — and labels that
// origin in `exitCodeSource`, so a missing binary is never read as a child failure. A bad flag
// exits 1 with usage on stderr.
//
// The banner is English-only and claims nothing this repo cannot back: AGENTS.md §4 and the
// evidence paths it cites are its only sources. Nothing printed here is a health signal for
// plugin code.
//
// IMPLEMENTATION NOTE: the child is spawned from an argv ARRAY (`spawnSync(bin, args, …)`), never
// from a shell string, so no argument value can be injected into a shell. `process.exitCode` —
// not `process.exit()` — is how main() reports its code, because the banner and the JSON notice
// are written to a stdout that the --self-test captures through a pipe and process.exit() can
// truncate a still-buffered stream.

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF_PATH = fileURLToPath(import.meta.url);
const TAG = "[dump-config]";
const OPENING = `${TAG} COMPOSITION ONLY — rows composed, no plugin code executed.`;
const RECAP = `${TAG} COMPOSITION ONLY (recap) — rows above prove COMPOSITION, never a plugin load; for a load proof run a mounting boot (AGENTS.md §4).`;
const QUIET_LINE = `${OPENING} A green run is NOT a plugin load (AGENTS.md §4); for a load proof run a mounting boot.`;

const USAGE = [
  "usage: node scripts/dump-config.mjs [--profile <name>] [--bin <path>] [--quiet] [--json] [--self-test] [-- <extra dsh args…>]",
  "",
  "  --profile <name>  compose this profile; omitted -> no --profile flag is passed (dsh default).",
  "  --bin <path>      dsh executable (default: dsh from PATH).",
  "  --quiet           one one-line warning instead of the full banner + closing recap.",
  "  --json            one JSON object on stdout; banner/recap move to stderr.",
  "  --self-test       six offline arms against fixture children; needs no real dsh.",
  "  -- <args…>        appended verbatim after --dump-config.",
  "",
  "  --dump-config proves COMPOSITION ONLY, never a plugin load (AGENTS.md §4).",
].join("\n");

// `--`-terminated extra args are forwarded untouched; everything before it is ours. A value that
// looks like another flag is rejected rather than swallowed, so `--profile --json` cannot silently
// compose a profile literally named "--json".
function parseArgs(argv) {
  const opts = { profile: null, bin: "dsh", quiet: false, json: false, selfTest: false, help: false, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      opts.extra = argv.slice(i + 1);
      return { ok: true, opts };
    }
    if (arg === "--profile" || arg === "--bin") {
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("--")) return { ok: false, message: `${arg} needs a value` };
      i += 1;
      if (arg === "--profile") opts.profile = value;
      else opts.bin = value;
      continue;
    }
    if (arg === "--quiet") { opts.quiet = true; continue; }
    if (arg === "--json") { opts.json = true; continue; }
    if (arg === "--self-test") { opts.selfTest = true; continue; }
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    return { ok: false, message: `unknown flag: ${arg}` };
  }
  return { ok: true, opts };
}

// The exact argv handed to the child: no profile flag at all when none was requested.
const childArgs = (opts) => [...(opts.profile === null ? [] : ["--profile", opts.profile]), "--dump-config", ...opts.extra];

// Display-only quoting for the banner's `command:` line. Never executed: the child always gets the
// argv array above.
const quoteForDisplay = (arg) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

function bannerLines(opts, args) {
  return [
    OPENING,
    `${TAG} The flag COMPOSES rows (base / bundle / patch / preset layers) and NEVER executes plugin code,`,
    `${TAG} so it CANNOT witness a plugin load, an apply abort or a schema rejection.`,
    `${TAG} Measured (AGENTS.md §4): \`dsh --profile mpd --dump-config\` exited 0 with the mpd-workmate row`,
    `${TAG} present while the real boot of the same profile could not load the tree.`,
    `${TAG} profile: ${opts.profile === null ? "none given -> NO --profile flag is passed; dsh uses its OWN default profile" : opts.profile}`,
    `${TAG} command: ${[opts.bin, ...args].map(quoteForDisplay).join(" ")}`,
    `${TAG} For a LOAD proof run a mounting boot instead: \`bun skills/dsh-qa/scripts/bundle-lifecycle.mjs\`,`,
    `${TAG} \`node skills/dsh-qa/scripts/preset-conformance.mjs\`, or a boot with registration instrumentation.`,
    `${TAG} ---- the composed rows below are the child's own output ----`,
  ];
}

// 128 + signal number is the shell convention for a signal-killed child; fall back to 1 when the
// platform does not name the signal.
function signalExitCode(signal) {
  const number = signal === null ? undefined : osConstants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

function runDumpConfig(opts) {
  const args = childArgs(opts);
  // stdout carries exactly one contract: the banner + child output, or the JSON object. In --json
  // mode the human-facing lines move to stderr so a parser never sees a non-JSON stdout.
  const notice = opts.json ? process.stderr : process.stdout;
  notice.write((opts.quiet ? QUIET_LINE : bannerLines(opts, args).join("\n")) + "\n");

  const result = spawnSync(opts.bin, args, opts.json ? { encoding: "utf8" } : { stdio: "inherit" });
  const displayBin = quoteForDisplay(opts.bin);
  const jsonNotice = (exitCode, exitCodeSource, childSpawnError, stdout) => {
    process.stdout.write(
      JSON.stringify(
        {
          bin: opts.bin,
          args,
          profile: opts.profile,
          exitCode,
          exitCodeSource,
          stdoutBytes: Buffer.byteLength(stdout, "utf8"),
          bannerEmitted: true,
          childSpawnError,
          stdout,
        },
        null,
        2,
      ) + "\n",
    );
  };

  if (result.error !== undefined && result.error !== null) {
    const message = `${TAG} ERROR: cannot run ${displayBin} — ${result.error.message}`;
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${TAG} ERROR: the wrapper exits 127 (the "command not found" convention), NOT the child's exit code.\n`);
    if (opts.json) jsonNotice(127, "wrapper-missing-binary", result.error.message, "");
    else if (!opts.quiet) process.stdout.write(RECAP + "\n");
    return 127;
  }

  if (result.status === null) {
    const code = signalExitCode(result.signal);
    process.stderr.write(`${TAG} ERROR: the child was killed by signal ${String(result.signal)}; the wrapper exits ${code} (128 + signal number).\n`);
    if (opts.json) jsonNotice(code, "child-signal", null, String(result.stdout ?? ""));
    else if (!opts.quiet) process.stdout.write(RECAP + "\n");
    return code;
  }

  if (opts.json) {
    if (result.stderr) process.stderr.write(String(result.stderr));
    jsonNotice(result.status, "child", null, String(result.stdout ?? ""));
    if (!opts.quiet) process.stderr.write(RECAP + "\n");
  } else if (!opts.quiet) {
    process.stdout.write(RECAP + "\n");
  }
  return result.status;
}

const MARKER_OK = "FIXTURE-CHILD-OK";
const MARKER_FAIL = "FIXTURE-CHILD-FAIL";
const MISSING_BIN = "dump-config-no-such-binary-for-self-test";

// A dependency-free fixture child: prints its marker, then exits with the code the arm wants.
const fixtureSource = (marker, code) =>
  `#!/usr/bin/env node\n// Fixture child for scripts/dump-config.mjs --self-test (offline; no real dsh involved).\nconsole.log(${JSON.stringify(marker)});\nprocess.exit(${code});\n`;

function selfTest() {
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-dump-config-"));
  const arms = [];
  const record = (name, ok, detail) => arms.push({ name, ok, detail });
  try {
    const okFixture = join(sandbox, "child-ok.mjs");
    const failFixture = join(sandbox, "child-exit-3.mjs");
    const missingFixture = join(sandbox, "child-absent.mjs");
    writeFileSync(okFixture, fixtureSource(MARKER_OK, 0), "utf8");
    writeFileSync(failFixture, fixtureSource(MARKER_FAIL, 3), "utf8");
    chmodSync(okFixture, 0o755);
    chmodSync(failFixture, 0o755);

    const wrapper = (...args) => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: "utf8" });
    const outOf = (r) => String(r.stdout ?? "");
    const errOf = (r) => String(r.stderr ?? "");

    // (a) success child: banner BEFORE the marker, recap AFTER it, wrapper exits 0, and the banner
    // actually states every clause the rule needs (never a green from a banner that says nothing).
    const a = wrapper("--bin", okFixture);
    const aOut = outOf(a);
    const clauseChecks = [
      ["never-executes clause", aOut.includes("NEVER executes plugin code")],
      ["cannot-witness clause", aOut.includes("CANNOT witness a plugin load")],
      ["mounting-boot remedy", aOut.includes("bundle-lifecycle.mjs") && aOut.includes("preset-conformance.mjs")],
      ["AGENTS.md §4 citation", aOut.includes("AGENTS.md §4")],
      ["exact command line", aOut.includes(`command: ${okFixture} --dump-config`)],
      ["no-profile case stated", aOut.includes("dsh uses its OWN default profile")],
    ];
    const openAt = aOut.indexOf(OPENING);
    const markerAt = aOut.indexOf(MARKER_OK);
    const recapAt = aOut.indexOf(RECAP);
    record(
      "(a) success child -> banner first, recap last, exit 0",
      a.status === 0 && openAt === 0 && markerAt > openAt && recapAt > markerAt && clauseChecks.every((c) => c[1]),
      `exit=${a.status} open@${openAt} marker@${markerAt} recap@${recapAt} clauses=${clauseChecks.filter((c) => c[1]).length}/${clauseChecks.length}` +
        (clauseChecks.every((c) => c[1]) ? "" : ` missing=${clauseChecks.filter((c) => !c[1]).map((c) => c[0]).join(",")}`),
    );

    // (b) failing child: the exit code is the CHILD's (3), and the banner is still printed.
    const b = wrapper("--bin", failFixture);
    const bOut = outOf(b);
    record(
      "(b) failing child (exit 3) -> banner + recap still printed, wrapper exits 3",
      b.status === 3 && bOut.includes(OPENING) && bOut.includes(MARKER_FAIL) && bOut.includes(RECAP),
      `exit=${b.status} banner=${bOut.includes(OPENING)} marker=${bOut.includes(MARKER_FAIL)} recap=${bOut.includes(RECAP)}`,
    );

    // (c) missing binary: banner + a loud error, exit 127 (NOT a child code).
    const c = wrapper("--bin", missingFixture);
    const cErr = errOf(c);
    record(
      "(c) missing binary -> banner printed, exit 127 command-not-found",
      c.status === 127 && outOf(c).includes(OPENING) && cErr.includes("cannot run") && cErr.includes("127"),
      `exit=${c.status} banner=${outOf(c).includes(OPENING)} error=${cErr.includes("cannot run")}`,
    );

    // (d) --json: parseable JSON on stdout, exitCode == the child's, banner excluded from stdout.
    const d = wrapper("--json", "--bin", failFixture);
    let parsed = null;
    try {
      parsed = JSON.parse(outOf(d));
    } catch {
      parsed = null;
    }
    record(
      "(d) --json -> parseable JSON, exitCode == child's, banner on stderr only",
      d.status === 3 &&
        parsed !== null &&
        parsed.exitCode === 3 &&
        parsed.exitCodeSource === "child" &&
        parsed.bannerEmitted === true &&
        parsed.stdoutBytes > 0 &&
        parsed.profile === null &&
        !outOf(d).includes(OPENING) &&
        errOf(d).includes(OPENING),
      parsed === null ? `stdout was not JSON: ${outOf(d).slice(0, 80)}` : `exit=${d.status} json.exitCode=${parsed.exitCode} stdoutBytes=${parsed.stdoutBytes} bannerOnStderr=${errOf(d).includes(OPENING)}`,
    );

    // (e) --quiet: exactly one warning line (the rule is never silenced), recap suppressed, exit code
    // still the child's.
    const e = wrapper("--quiet", "--bin", failFixture);
    const eOut = outOf(e);
    const eTagLines = eOut.split("\n").filter((line) => line.startsWith(TAG));
    record(
      "(e) --quiet -> exactly one warning line kept, no recap, exit code still propagated",
      e.status === 3 && eTagLines.length === 1 && eTagLines[0].startsWith(OPENING) && !eOut.includes(RECAP) && eOut.includes(MARKER_FAIL),
      `exit=${e.status} tagLines=${eTagLines.length} recap=${eOut.includes(RECAP)} marker=${eOut.includes(MARKER_FAIL)}`,
    );

    // (f) bad flag: usage on stderr, exit 1.
    const f = wrapper("--bogus-flag");
    record(
      "(f) bad flag -> usage on stderr, exit 1",
      f.status === 1 && errOf(f).includes("unknown flag: --bogus-flag") && errOf(f).includes("usage:"),
      `exit=${f.status} usage=${errOf(f).includes("usage:")}`,
    );
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  for (const arm of arms) console.log(`${arm.ok ? "ok  " : "FAIL"} ${arm.name}${arm.detail ? ` — ${arm.detail}` : ""}`);
  const passed = arms.filter((arm) => arm.ok).length;
  const allOk = passed === arms.length;
  console.log(`\n[dump-config self-test] ${passed}/${arms.length} arms passed — ${allOk ? "PASS" : "FAIL"}`);
  return allOk ? 0 : 1;
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${TAG} ${parsed.message}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.opts.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (parsed.opts.selfTest) return selfTest();
  return runDumpConfig(parsed.opts);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main();
