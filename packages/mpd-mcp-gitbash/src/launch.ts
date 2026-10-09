#!/usr/bin/env node
// mpd git-bash MCP launcher — two third-party servers behind ONE launcher (de-omo wave B2).
//
// WHAT REPLACED WHAT: this launcher used to start the vendored `git-bash-mcp` build that shipped beside
// it as `./cli.js` (SUL-1.0, built offline by the now-retired `scripts/build-mcp.ts` from
// `vendor/mcp-src/**`). That artifact, the build script and the whole snapshot are gone. The row's
// capability is re-sourced from two DECLARED npm dependencies:
//
//   argv[2] `git`   (the default) -> `@cyanheads/git-mcp-server` (Apache-2.0), 28 `git_*` tools.
//   argv[2] `shell`              -> `mcp-server-commands` (MIT licence FILE, no `license` field in its
//                                   package.json — see packages/mpd-mcp-gitbash/README.md), `run_process`.
//
// WHY ONE LAUNCHER AND NOT TWO PACKAGES: the two rows differ ONLY in which dependency they start, and
// the argv word already selects that. One launcher keeps the already-exempt terminal-silence file the
// single place fd 2 is taken away from the terminal, instead of duplicating that install (and its R5
// gate exemption) into a second file.
//
// The row's launch shape is unchanged: `command: node`, `args: [<bundle>/packages/mpd-mcp-gitbash/dist/launch.js, <word>]`.
// There is NO default server word any more: the old vendored server was a raw shell runner (`run`,
// `which_bash`, `diagnose`), so `git` is the closest thing to a NEW capability and `shell` is the one
// that replaces the old tools. Both rows ship `disabled: true`, exactly as the single old row did.
//
// CAPABILITY DELTAS are stated in `packages/mpd-mcp-gitbash/README.md`: what the old server exposed,
// which new tool covers it, and the two old tools that have no counterpart.
import { resolveDependencyEntry } from "../../mpd-mcp-shared/dependency-entry.ts"
import { installTerminalSilence } from "../../mpd-mcp-shared/log-sink.ts"
import type { LogSink } from "../../mpd-mcp-shared/log-sink.ts"
import { serveUnavailable } from "../../mpd-mcp-shared/unavailable-server.ts"

/** The two servers this launcher can start, keyed by the word the row passes as `argv[2]`. */
type ServerWord = "git" | "shell"

/** One startable server: the dependency, its `bin` key, and what the row loses without it. */
interface ServerSpec {
  /** The npm package name, exactly as the bundle's `optionalDependencies` declares it. */
  readonly dependency: string
  /** The dependency's `bin` key, which is the MCP server entry (not `main`). */
  readonly bin: string
  /** What the user loses when the dependency is absent, one line, for the log sink. */
  readonly capability: string
}

/** The server table: every word this launcher accepts, and the dependency behind it. */
const SERVERS: Readonly<Record<ServerWord, ServerSpec>> = {
  git: {
    dependency: "@cyanheads/git-mcp-server",
    bin: "git-mcp-server",
    capability: "the git_* tool family"
  },
  shell: {
    dependency: "mcp-server-commands",
    bin: "mcp-server-commands",
    capability: "run_process (raw shell execution)"
  }
}

// FIRST statement of the module body: this file's own imports are node builtins and chatter-free, and
// the dependency below is imported DYNAMICALLY on the last line — a static import would be hoisted
// above this call and defeat the whole point. The measured reason it matters here: `git-mcp-server`
// initializes a pino logger at module load and writes JSON records to stderr.
/** The terminal-silence sink: the launcher's log file, and the diagnostics channel of the fallback below. */
const sink: LogSink = installTerminalSilence("mpd-mcp-gitbash")

/** The server word the row selected; anything but `shell` means the git toolbox. */
const word: ServerWord = process.argv[2] === "shell" ? "shell" : "git"
/** The selected server's dependency and metadata. */
const spec: ServerSpec = SERVERS[word]
/** The located dependency, or null when the profile did not materialize it. */
const dependency = resolveDependencyEntry(import.meta.url, spec.dependency, spec.bin)

if (dependency === null) {
  // The declared dependency is absent. Stay alive with zero tools rather than killing the row's child;
  // the reason lands in the log sink above.
  await serveUnavailable(sink, {
    name: "mpd-mcp-gitbash:" + word,
    reason: "the declared dependency " + spec.dependency + " is not installed in this profile",
    hint: "install the bundle's dependency closure (npm/pnpm install) — without it this row loses " + spec.capability
  })
  process.exitCode = 0
} else {
  sink.write("[mpd-mcp-gitbash] starting " + spec.dependency + "@" + dependency.version + " (" + word + ") from " + dependency.entry)
  // The specifier is a RUNTIME VALUE on purpose: a literal one would make `bun build` inline the whole
  // third-party server into this launcher (measured on the ast-grep twin).
  /** The dependency's MCP server entry, resolved from the installed profile. */
  const entry: string = dependency.entry
  await import(entry)
}
