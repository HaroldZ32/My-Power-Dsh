// Vendored type vocabulary of the upstream comment-checker core (packages/comment-checker-core,
// base 8c57e46; SUL-1.0, inherited from upstream). The mpd adaptation imports three of these
// (CheckerEdit, ApplyPatchFileMetadata, ApplyPatchAccumulator) from apply-patch-edits; the rest is
// the upstream parser's own vocabulary, kept verbatim so the vendored code stays diffable.

/** One text substitution the checker attributes to a pending tool call. */
export type CheckerEdit = {
  /** Path of the file the substitution targets. */
  readonly filePath: string
  /** The exact region the substitution removes. */
  readonly before: string
  /** The text written in place of `before`. */
  readonly after: string
}

/** What one `apply_patch` file section declares, as the parser accumulates it. */
export type ApplyPatchFileMetadata = {
  /** Path of the file the section targets. */
  readonly filePath: string
  /** Destination of a `*** Move to:` line; absent when the section does not move the file. */
  readonly movePath?: string
  /** The section's `-`/context lines, i.e. the content the patch expects to replace. */
  readonly before: string
  /** The section's `+`/context lines, i.e. the content the patch leaves behind. */
  readonly after: string
  /** Operation the header named (add/update/delete); absent when the parser could not classify it. */
  readonly type?: string
}

/** Mutable buffer the `apply_patch` parser fills while walking one file section. */
export type ApplyPatchAccumulator = {
  /** The section's operation, taken from its `*** Add/Update/Delete File:` header. */
  operation: "add" | "update" | "delete"
  /** Path named by the section header. */
  filePath: string
  /** Destination named by a `*** Move to:` line, when the section carries one. */
  movePath?: string
  /** Buffered `-`/context lines of the section, in payload order. */
  oldLines: string[]
  /** Buffered `+`/context lines of the section, in payload order. */
  newLines: string[]
}

/** The three comment forms the detector distinguishes; a `docstring` is a doc-comment block. */
export type CommentType = "line" | "block" | "docstring"

/** One comment the detector found, with the location it must be reported against. */
export interface CommentInfo {
  /** The comment's own text, as the parser captured it (delimiters included). */
  readonly text: string
  /** 1-based line the comment starts on. */
  readonly lineNumber: number
  /** Path of the file the comment was found in. */
  readonly filePath: string
  /** Which of the three forms the comment is. */
  readonly commentType: CommentType
  /** Whether the comment is a doc comment; reported separately because a docstring is also a block. */
  readonly isDocstring: boolean
  /** Parser-supplied key/value annotations; absent when the parser attached none. */
  readonly metadata?: Record<string, string>
}

/** A tool call seen but not yet resolved into a file the detector can read. */
export interface PendingCall {
  /** Path the pending call targets. */
  readonly filePath: string
  /** Full file content, carried by a `write` call. */
  readonly content?: string
  /** Region a single `edit` call replaces. */
  readonly oldString?: string
  /** Replacement text of a single `edit` call. */
  readonly newString?: string
  /** Replacement pairs of a `multiedit` call, in call order. */
  readonly edits?: readonly { old_string: string; new_string: string }[]
  /** Which tool produced the call; it decides which payload field above is populated. */
  readonly tool: "write" | "edit" | "multiedit"
  /** Session the call belongs to, as the caller reported it. */
  readonly sessionID: string
  /** Milliseconds since the epoch when the call was observed. */
  readonly timestamp: number
}

/** The detector's per-file result: every comment found in one file. */
export interface FileComments {
  /** Path the comments were found in. */
  readonly filePath: string
  /** Comments found in that file, in the order the parser reported them. */
  readonly comments: readonly CommentInfo[]
}

/** Verdict of a comment filter: suppress this comment, or keep it. */
export interface FilterResult {
  /** Whether the filter suppresses the comment. */
  readonly shouldSkip: boolean
  /** Why it was suppressed; absent when it was kept. */
  readonly reason?: string
}

/** Predicate deciding whether one detected comment is reported; it returns a verdict, never throws. */
export type CommentFilter = (comment: CommentInfo) => FilterResult

/** The PostToolUse-shaped payload the detector binary reads on stdin. */
export interface HookInput {
  /** Session id the payload names; this plugin substitutes its own tag for it. */
  readonly session_id: string
  /** Name of the tool whose result is being checked. */
  readonly tool_name: string
  /** Path of the session transcript; the caller may pass an empty string. */
  readonly transcript_path: string
  /** Working directory the payload reports; this plugin passes the calling session's workspace. */
  readonly cwd: string
  /** Hook event the payload represents; this plugin always sends `PostToolUse`. */
  readonly hook_event_name: string
  /** The tool's own arguments: the target path plus either content or a replacement pair. */
  readonly tool_input: {
    readonly file_path?: string
    readonly content?: string
    readonly old_string?: string
    readonly new_string?: string
    readonly edits?: readonly { old_string: string; new_string: string }[]
  }
  /** The tool's result as the hook protocol shapes it; unused by the detector. */
  readonly tool_response?: unknown
}

/** Outcome of one detector run. */
export interface CheckResult {
  /** Whether the run reported comments (the binary's exit status 2). */
  readonly hasComments: boolean
  /** The binary's own output, empty when the run was clean. */
  readonly message: string
}

/** The two termination signals the runner sends to a detector child. */
export type SpawnSignal = "SIGTERM" | "SIGKILL"

/** The child-process surface one run needs, narrow enough for a test to fake. */
export type SpawnProcess = {
  /** The child's stdin, which carries the hook payload. */
  readonly stdin: {
    /** Hands one chunk of the payload to the child. */
    write(input: string): void
    /** Closes stdin, which is what makes the binary begin. */
    end(): void
  }
  /** Byte stream of the child's standard output. */
  readonly stdout: ReadableStream<Uint8Array>
  /** Byte stream of the child's standard error. */
  readonly stderr: ReadableStream<Uint8Array>
  /** Resolves with the child's exit code. */
  readonly exited: Promise<number>
  /** Terminates the child with the given signal. */
  kill(signal: SpawnSignal): void
}

/** Starts a detector child for the given argv. */
export type SpawnFn = (args: readonly string[]) => SpawnProcess

/** Inputs of the packaged binary resolver, injected so it can run without a real filesystem. */
export interface ResolveCommentCheckerBinaryInput {
  /** File name of the platform binary inside the package's `vendor/<platform>/` directory. */
  readonly binaryName: string
  /** Path an earlier call already resolved, reused verbatim; `null` when nothing is cached. */
  readonly cachedBinaryPath: string | null
  /** Existence probe for a candidate path. */
  readonly existsSync: (path: string) => boolean
  /** The caller's `import.meta.url`, the base for package-relative resolution. */
  readonly importMetaUrl?: string
  /** Package whose `vendor/` directory holds the binary. */
  readonly packageName?: string
}

/** Everything one detector run needs besides the injected process factory. */
export interface RunCommentCheckerInput {
  /** The PostToolUse payload handed to the binary on stdin. */
  readonly hookInput: HookInput
  /** Resolved binary path, or `null` when no binary was found. */
  readonly binaryPath: string | null
  /** Caller-supplied instruction appended to the runner's message. */
  readonly customPrompt?: string
}

/** Injected collaborators and time bounds of one detector run. */
export interface RunCommentCheckerOptions {
  /** Factory that starts the detector child. */
  readonly spawn: SpawnFn
  /** Existence probe used to accept or reject a candidate binary. */
  readonly existsSync: (path: string) => boolean
  /** Wall-clock bound for the run, in milliseconds. */
  readonly timeoutMs?: number
  /** Delay between the terminate signal and the kill, in milliseconds. */
  readonly killGraceMs?: number
  /** Timer scheduler, injected so a test can drive the timeout deterministically. */
  readonly setTimeoutFn?: typeof setTimeout
  /** Matching canceller for the injected scheduler. */
  readonly clearTimeoutFn?: typeof clearTimeout
}
