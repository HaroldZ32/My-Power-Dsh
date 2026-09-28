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
//   node scripts/dump-config.ts [--profile <name>] [--bin <path>] [--quiet] [--json] [--self-test] [-- <extra dsh args…>]
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

import { spawnSync, type SpawnSyncOptionsWithBufferEncoding, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { constants as osConstants, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** This script's own path, used by the self-test to spawn the wrapper again as a child. */
const SELF_PATH = fileURLToPath(import.meta.url);
/** Line prefix every diagnostic and banner clause of this wrapper carries. */
const TAG = "[dump-config]";
/** Opening banner clause: the single sentence that states what the flag can and cannot prove. */
const OPENING = `${TAG} COMPOSITION ONLY — rows composed, no plugin code executed.`;
/** Closing recap printed after the child's output, repeating the composition-only bound. */
const RECAP = `${TAG} COMPOSITION ONLY (recap) — rows above prove COMPOSITION, never a plugin load; for a load proof run a mounting boot (AGENTS.md §4).`;
/** One-line replacement for banner + recap under `--quiet`; the rule is never silenced. */
const QUIET_LINE = `${OPENING} A green run is NOT a plugin load (AGENTS.md §4); for a load proof run a mounting boot.`;

/** The full usage text, printed on `--help` (stdout) and on a bad flag (stderr). */
const USAGE = [
  "usage: node scripts/dump-config.ts [--profile <name>] [--bin <path>] [--quiet] [--json] [--self-test] [-- <extra dsh args…>]",
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

/** Options this wrapper accepts on its own command line, plus the verbatim `--` tail. */
interface WrapperOptions {
  /** Profile to compose, or `null` when no `--profile` flag is passed at all (dsh default). */
  profile: string | null;
  /** The executable to run; `dsh` (PATH lookup) unless `--bin` overrides it. */
  bin: string;
  /** Whether the one-line warning replaces the full banner and the closing recap. */
  quiet: boolean;
  /** Whether stdout carries one JSON object instead of banner + child stdio. */
  json: boolean;
  /** Whether to run the six offline arms instead of spawning a child. */
  selfTest: boolean;
  /** Whether the caller asked for the usage text (`--help` / `-h`). */
  help: boolean;
  /** Extra dsh arguments forwarded verbatim after `--dump-config`. */
  extra: string[];
}

/** Accepted argv: the wrapper's own options plus the verbatim `--` tail. */
interface ParsedOk {
  /** Discriminant: the argv was accepted. */
  readonly ok: true;
  /** The parsed options. */
  readonly opts: WrapperOptions;
}

/** Rejected argv: the reason is printed with the usage text, never the usage alone. */
interface ParsedError {
  /** Discriminant: the argv was rejected. */
  readonly ok: false;
  /** One-line reason naming the offending flag. */
  readonly message: string;
}

/** Result of parsing the wrapper's own argv, discriminated by `ok`. */
type ParseResult = ParsedOk | ParsedError;

/** Spawn options used by this wrapper: captured UTF-8 stdio in `--json` mode, inherited stdio otherwise. */
type ChildSpawnOptions = SpawnSyncOptionsWithStringEncoding | SpawnSyncOptionsWithBufferEncoding;

/** One self-test arm's outcome, kept for the printed summary. */
interface SelfTestArm {
  /** Arm name, printed exactly as declared. */
  readonly name: string;
  /** Whether every assertion of the arm held. */
  readonly ok: boolean;
  /** Measured detail appended to the printed line. */
  readonly detail: string;
}

/** The `--json` document as the self-test reads it back from the wrapper's stdout. */
interface JsonNotice {
  /** Exit code the wrapper reported (the child's, or 127 for a binary that could not be spawned). */
  readonly exitCode: number;
  /** Origin of that code: `child`, `child-signal` or `wrapper-missing-binary`. */
  readonly exitCodeSource: string;
  /** Whether the composition-only banner was emitted; always true on a completed run. */
  readonly bannerEmitted: boolean;
  /** Size in bytes of the captured `stdout` field. */
  readonly stdoutBytes: number;
  /** The composed profile name, or `null` when no `--profile` flag was passed. */
  readonly profile: string | null;
}

// `--`-terminated extra args are forwarded untouched; everything before it is ours. A value that
// looks like another flag is rejected rather than swallowed, so `--profile --json` cannot silently
// compose a profile literally named "--json".
/**
 * Parse the wrapper's own argv.
 * @param argv - the arguments after the node executable and this script's path.
 * @returns the accepted options, or the rejection message for the first bad token.
 */
function parseArgs(argv: string[]): ParseResult {
  /** Accumulated options; the defaults mirror the flag table in the header. */
  const opts: WrapperOptions = { profile: null, bin: "dsh", quiet: false, json: false, selfTest: false, help: false, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    /** The token at the current position. */
    const arg: string = argv[i];
    if (arg === "--") {
      opts.extra = argv.slice(i + 1);
      return { ok: true, opts };
    }
    if (arg === "--profile" || arg === "--bin") {
      /** The value token this flag needs; `undefined` when the flag is the last token. */
      const value: string | undefined = argv[i + 1];
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
/**
 * Build the child's argv.
 * @param opts - the parsed wrapper options.
 * @returns `[--profile <name>?] --dump-config <extra…>`, with the profile flag omitted when none was given.
 */
const childArgs = (opts: WrapperOptions): string[] => [...(opts.profile === null ? [] : ["--profile", opts.profile]), "--dump-config", ...opts.extra];

/**
 * Node's PATH resolution on win32, which does NOT apply `PATHEXT` for a bare command name
 * (`spawnSync("dsh")` answers ENOENT while `dsh.cmd` sits on PATH); `undefined` = nothing to run.
 * @param bin - the command name or path the caller asked for.
 * @returns on win32 the first `bin + PATHEXT` candidate that exists (or `bin` itself when it carries a separator); `bin` unchanged on every other platform.
 */
function resolveOnPath(bin: string): string | undefined {
  if (process.platform !== "win32") return bin;
  if (bin.includes("/") || bin.includes("\\")) return existsSync(bin) ? bin : undefined;
  /** Extensions `PATHEXT` offers for a bare name; the Windows default when the variable is unset. */
  const extensions: string[] = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((extension: string): boolean => extension.length > 0);
  for (const dir of (process.env.PATH ?? "").split(";")) {
    if (dir === "") continue;
    for (const extension of extensions) {
      /** Candidate `dir\name.ext` for this extension. */
      const candidate = join(dir, bin + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Spawn the child so the SAME argv array works on every platform.
 *
 * Windows cannot CreateProcess a `.cmd`/`.bat` shim (`EINVAL`; measured with the npm-installed
 * `dsh`) and does not resolve a bare name through `PATHEXT` (`ENOENT`), so `node scripts/dump-config.ts`
 * answered 127 / `wrapper-missing-binary` on a host where the harness IS installed. Two shapes cover
 * every child this wrapper has, and both still hand the child an argv ARRAY — never a shell string,
 * so no argument value can be injected:
 *   * a `.js`/`.mjs` file (the self-test's fixtures, and the QA lanes' fixture children) is not an
 *     executable there at all (`EFTYPE`) — node runs it, exactly as the POSIX shebang would;
 *   * anything else is a program shim, so `cmd.exe /c` runs it natively.
 * POSIX is untouched: the child is spawned directly, shebang and all.
 * @param bin - the executable or fixture script of the child.
 * @param args - the child's argv, forwarded as an array so no value can reach a shell.
 * @param opts - captured UTF-8 stdio in `--json` mode, inherited stdio otherwise.
 * @returns the child's synchronous result; `error` is set when it could never be spawned.
 */
function spawnChild(bin: string, args: string[], opts: ChildSpawnOptions): SpawnSyncReturns<string | Buffer> {
  if (process.platform !== "win32") return spawnSync(bin, args, opts);
  // `existsSync` matters: an ABSENT fixture must still take the plain-spawn path below, so the
  // ENOENT -> 127 contract stays observable instead of turning into node's own "cannot find module".
  if (/\.m?js$/i.test(bin) && existsSync(bin)) return spawnSync(process.execPath, [bin, ...args], opts);
  /** The bin resolved through PATH with `PATHEXT` applied, or `undefined` when nothing matches. */
  const resolved: string | undefined = resolveOnPath(bin);
  // Nothing to run: keep the plain spawn so the ENOENT -> 127 "command not found" contract (and
  // the self-test arm that pins it) is preserved verbatim.
  if (resolved === undefined) return spawnSync(bin, args, opts);
  if (/\.(cmd|bat)$/i.test(resolved)) return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/c", resolved, ...args], opts);
  return spawnSync(resolved, args, opts);
}

// Display-only quoting for the banner's `command:` line. Never executed: the child always gets the
// argv array above.
/** Quote one argv token for the banner: bare when it is shell-safe, single-quoted otherwise. */
const quoteForDisplay = (arg: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`);

/**
 * Build the composition-only banner printed before the child's output.
 * @param opts - the parsed wrapper options (its `profile` and `bin` are named in the banner).
 * @param args - the exact argv handed to the child, quoted for display on the `command:` line.
 * @returns the banner's lines, in print order.
 */
function bannerLines(opts: WrapperOptions, args: string[]): string[] {
  return [
    OPENING,
    `${TAG} The flag COMPOSES rows (base / bundle / patch / preset layers) and NEVER executes plugin code,`,
    `${TAG} so it CANNOT witness a plugin load, an apply abort or a schema rejection.`,
    `${TAG} Measured (AGENTS.md §4): \`dsh --profile mpd --dump-config\` exited 0 with the mpd-workmate row`,
    `${TAG} present while the real boot of the same profile could not load the tree.`,
    `${TAG} profile: ${opts.profile === null ? "none given -> NO --profile flag is passed; dsh uses its OWN default profile" : opts.profile}`,
    `${TAG} command: ${[opts.bin, ...args].map(quoteForDisplay).join(" ")}`,
    `${TAG} For a LOAD proof run a mounting boot instead: \`bun skills/dsh-qa/scripts/bundle-lifecycle.ts\`,`,
    `${TAG} \`node skills/dsh-qa/scripts/preset-conformance.ts\`, or a boot with registration instrumentation.`,
    `${TAG} ---- the composed rows below are the child's own output ----`,
  ];
}

// 128 + signal number is the shell convention for a signal-killed child; fall back to 1 when the
// platform does not name the signal.
/**
 * Translate a killing signal into the wrapper's exit code.
 * @param signal - the signal that killed the child, or `null` when it exited on its own.
 * @returns `128 + signal number`, or 1 when the platform does not name that signal.
 */
function signalExitCode(signal: NodeJS.Signals | null): number {
  /** The signal's number, or `undefined` when this platform does not name it. */
  const number = signal === null ? undefined : osConstants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

/**
 * Run one composition-only dump and report the child's own exit code.
 * @param opts - the parsed wrapper options.
 * @returns the child's exit code, 127 when it could never be spawned, or `128 + signal` when a signal killed it.
 */
function runDumpConfig(opts: WrapperOptions): number {
  /** The exact argv handed to the child. */
  const args: string[] = childArgs(opts);
  // stdout carries exactly one contract: the banner + child output, or the JSON object. In --json
  // mode the human-facing lines move to stderr so a parser never sees a non-JSON stdout.
  /** Where the human-facing lines go: stderr in `--json` mode, stdout otherwise. */
  const notice: NodeJS.WriteStream = opts.json ? process.stderr : process.stdout;
  notice.write((opts.quiet ? QUIET_LINE : bannerLines(opts, args).join("\n")) + "\n");

  /** The child's result: stdio captured as UTF-8 in `--json` mode, inherited otherwise. */
  const result: SpawnSyncReturns<string | Buffer> = spawnChild(opts.bin, args, opts.json ? { encoding: "utf8" } : { stdio: "inherit" });
  /** The bin as named in error messages (quoted for display only, never executed). */
  const displayBin: string = quoteForDisplay(opts.bin);
  /** Print the single-line JSON notice for this run. */
  const jsonNotice = (exitCode: number, exitCodeSource: string, childSpawnError: string | null, stdout: string): void => {
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
    /** The wrapper's own error line for a child that could never be spawned. */
    const message: string = `${TAG} ERROR: cannot run ${displayBin} — ${result.error.message}`;
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${TAG} ERROR: the wrapper exits 127 (the "command not found" convention), NOT the child's exit code.\n`);
    if (opts.json) jsonNotice(127, "wrapper-missing-binary", result.error.message, "");
    else if (!opts.quiet) process.stdout.write(RECAP + "\n");
    return 127;
  }

  if (result.status === null) {
    /** The exit code implied by the killing signal. */
    const code: number = signalExitCode(result.signal);
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

/** Marker the OK fixture child prints, asserted by arm (a). */
const MARKER_OK = "FIXTURE-CHILD-OK";
/** Marker the failing fixture child prints, asserted by arm (b). */
const MARKER_FAIL = "FIXTURE-CHILD-FAIL";
/** Path suffix of the fixture that is deliberately never created, driving the missing-binary arm (c). */
const MISSING_BIN = "dump-config-no-such-binary-for-self-test";

// A dependency-free fixture child: prints its marker, then exits with the code the arm wants.
/**
 * Build the source of one fixture child.
 * @param marker - the marker the child prints on stdout.
 * @param code - the exit code the child terminates with.
 * @returns a complete `node` script (shebang included) that prints the marker and exits with `code`.
 */
const fixtureSource = (marker: string, code: number): string =>
  `#!/usr/bin/env node\n// Fixture child for scripts/dump-config.ts --self-test (offline; no real dsh involved).\nconsole.log(${JSON.stringify(marker)});\nprocess.exit(${code});\n`;

/**
 * Run the six offline arms against fixture children in a fresh temp dir (no real dsh involved).
 * @returns 0 when every arm passed, 1 otherwise.
 */
function selfTest(): number {
  /** Fresh temp directory holding the fixture children; removed in the `finally` below. */
  const sandbox: string = mkdtempSync(join(tmpdir(), "mpd-dump-config-"));
  /** Collected arm outcomes, printed in declaration order at the end. */
  const arms: SelfTestArm[] = [];
  /** Record one arm's outcome; the length `arms.push` returns is deliberately discarded. */
  const record = (name: string, ok: boolean, detail: string): void => { arms.push({ name, ok, detail }); };
  try {
    /** Fixture child that exits 0 after printing the OK marker. */
    const okFixture: string = join(sandbox, "child-ok.mjs");
    /** Fixture child that exits 3 after printing the FAIL marker. */
    const failFixture: string = join(sandbox, "child-exit-3.mjs");
    /** Fixture path that is deliberately never written, so the spawn fails with ENOENT. */
    const missingFixture: string = join(sandbox, "child-absent.mjs");
    writeFileSync(okFixture, fixtureSource(MARKER_OK, 0), "utf8");
    writeFileSync(failFixture, fixtureSource(MARKER_FAIL, 3), "utf8");
    chmodSync(okFixture, 0o755);
    chmodSync(failFixture, 0o755);

    /** Spawn this same wrapper with the given argv and captured UTF-8 stdio. */
    const wrapper = (...args: string[]): SpawnSyncReturns<string> => spawnSync(process.execPath, [SELF_PATH, ...args], { encoding: "utf8" });
    /** The child run's captured stdout. */
    const outOf = (r: SpawnSyncReturns<string>): string => String(r.stdout ?? "");
    /** The child run's captured stderr. */
    const errOf = (r: SpawnSyncReturns<string>): string => String(r.stderr ?? "");

    // (a) success child: banner BEFORE the marker, recap AFTER it, wrapper exits 0, and the banner
    // actually states every clause the rule needs (never a green from a banner that says nothing).
    /** Arm (a): the wrapper run against the exit-0 fixture. */
    const a = wrapper("--bin", okFixture);
    /** Arm (a)'s captured stdout. */
    const aOut = outOf(a);
    /** The banner clauses arm (a) requires, paired with whether each was found. */
    const clauseChecks: ReadonlyArray<readonly [string, boolean]> = [
      ["never-executes clause", aOut.includes("NEVER executes plugin code")],
      ["cannot-witness clause", aOut.includes("CANNOT witness a plugin load")],
      ["mounting-boot remedy", aOut.includes("bundle-lifecycle.ts") && aOut.includes("preset-conformance.ts")],
      ["AGENTS.md §4 citation", aOut.includes("AGENTS.md §4")],
      // The banner QUOTES a display-unsafe argument (a Windows temp path carries `~`, which the
      // display-quoting rule escapes), so the clause reads the LINE: it must name the exact bin and
      // end with the child's own argv — never the presenter's quoting, which is a separate concern.
      ["exact command line", aOut.split("\n").some((line: string): boolean => line.startsWith(`${TAG} command: `) && line.includes(okFixture) && line.trimEnd().endsWith("--dump-config"))],
      ["no-profile case stated", aOut.includes("dsh uses its OWN default profile")],
    ];
    /** Offset of the opening banner clause in arm (a)'s stdout. */
    const openAt = aOut.indexOf(OPENING);
    /** Offset of the fixture's marker in arm (a)'s stdout. */
    const markerAt = aOut.indexOf(MARKER_OK);
    /** Offset of the closing recap in arm (a)'s stdout. */
    const recapAt = aOut.indexOf(RECAP);
    record(
      "(a) success child -> banner first, recap last, exit 0",
      a.status === 0 && openAt === 0 && markerAt > openAt && recapAt > markerAt && clauseChecks.every((c: readonly [string, boolean]): boolean => c[1]),
      `exit=${a.status} open@${openAt} marker@${markerAt} recap@${recapAt} clauses=${clauseChecks.filter((c: readonly [string, boolean]): boolean => c[1]).length}/${clauseChecks.length}` +
        (clauseChecks.every((c: readonly [string, boolean]): boolean => c[1]) ? "" : ` missing=${clauseChecks.filter((c: readonly [string, boolean]): boolean => !c[1]).map((c: readonly [string, boolean]): string => c[0]).join(",")}`),
    );

    // (b) failing child: the exit code is the CHILD's (3), and the banner is still printed.
    /** Arm (b): the wrapper run against the exit-3 fixture. */
    const b = wrapper("--bin", failFixture);
    /** Arm (b)'s captured stdout. */
    const bOut = outOf(b);
    record(
      "(b) failing child (exit 3) -> banner + recap still printed, wrapper exits 3",
      b.status === 3 && bOut.includes(OPENING) && bOut.includes(MARKER_FAIL) && bOut.includes(RECAP),
      `exit=${b.status} banner=${bOut.includes(OPENING)} marker=${bOut.includes(MARKER_FAIL)} recap=${bOut.includes(RECAP)}`,
    );

    // (c) missing binary: banner + a loud error, exit 127 (NOT a child code).
    /** Arm (c): the wrapper run against a fixture path that does not exist. */
    const c = wrapper("--bin", missingFixture);
    /** Arm (c)'s captured stderr. */
    const cErr = errOf(c);
    record(
      "(c) missing binary -> banner printed, exit 127 command-not-found",
      c.status === 127 && outOf(c).includes(OPENING) && cErr.includes("cannot run") && cErr.includes("127"),
      `exit=${c.status} banner=${outOf(c).includes(OPENING)} error=${cErr.includes("cannot run")}`,
    );

    // (d) --json: parseable JSON on stdout, exitCode == the child's, banner excluded from stdout.
    /** Arm (d): the wrapper run in `--json` mode against the exit-3 fixture. */
    const d = wrapper("--json", "--bin", failFixture);
    /** Arm (d)'s stdout parsed back into the documented JSON notice, `null` when it is not JSON. */
    let parsed: JsonNotice | null = null;
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
    /** Arm (e): the wrapper run with `--quiet` against the exit-3 fixture. */
    const e = wrapper("--quiet", "--bin", failFixture);
    /** Arm (e)'s captured stdout. */
    const eOut = outOf(e);
    /** Arm (e)'s stdout lines that carry the wrapper tag. */
    const eTagLines: string[] = eOut.split("\n").filter((line: string): boolean => line.startsWith(TAG));
    record(
      "(e) --quiet -> exactly one warning line kept, no recap, exit code still propagated",
      e.status === 3 && eTagLines.length === 1 && eTagLines[0].startsWith(OPENING) && !eOut.includes(RECAP) && eOut.includes(MARKER_FAIL),
      `exit=${e.status} tagLines=${eTagLines.length} recap=${eOut.includes(RECAP)} marker=${eOut.includes(MARKER_FAIL)}`,
    );

    // (f) bad flag: usage on stderr, exit 1.
    /** Arm (f): the wrapper run with an unknown flag. */
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
  /** Number of arms that passed. */
  const passed: number = arms.filter((arm: SelfTestArm): boolean => arm.ok).length;
  /** Whether every arm passed. */
  const allOk: boolean = passed === arms.length;
  console.log(`\n[dump-config self-test] ${passed}/${arms.length} arms passed — ${allOk ? "PASS" : "FAIL"}`);
  return allOk ? 0 : 1;
}

/**
 * Dispatch on the parsed argv.
 * @returns the process's exit code: 1 for a bad flag, 0 for `--help`, the self-test's verdict for `--self-test`, else the child's own code.
 */
function main(): number {
  /** The parsed wrapper argv. */
  const parsed: ParseResult = parseArgs(process.argv.slice(2));
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
