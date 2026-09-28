#!/usr/bin/env node
// verify-manual-paths — T-66: "the files the manual names must exist".
//
// WHY THIS EXISTS
//   `AGENTS.md` is the binding operating manual of this repository and it cites paths everywhere:
//   gate scripts, plugin sources, evidence directories, presets. Nothing checked them, so a path
//   that was renamed, moved or never existed stayed quoted as if it were live. This audit reads the
//   manual, extracts every path-shaped token it can HONESTLY audit, stats each one at the repo root,
//   and reports everything else in NAMED buckets instead of guessing.
//
// MATCHING RULE (deliberately conservative — precision over recall; the rule is echoed in every
// run's own header, so the counts are never read as more than they are):
//   candidate  only a path-shaped token is considered at all: it contains `/`, or it carries a
//              dotted file extension, or it names an entry at the repo root, or it is one of the
//              documented root files (KNOWN_ROOT_FILES). A command, a flag or an identifier
//              (`node`, `--self-test`, `ctx.tools`) is not a path mention in any reading and is not
//              counted anywhere — this census covers path-shaped tokens only.
//   position   a token is read from a code span (backticks) — or, in prose, ONLY when it literally
//              starts with `./` or `../`, i.e. it is written as a path. Any other prose mention is
//              not read at all.
//   shape      no `*`, no `~`, no `://`, no whitespace, no `<`/`>`/`$`/`{`/`}`, no elision mark,
//              and no trailing punctuation.
//   anchor     an explicit `./`/`../` spelling is taken literally. Any other token is a
//              root-relative claim only when its first segment is an entry at the repo root (or the
//              whole token is one of the documented root files). When the first segment does not
//              exist at the root the token is not a repo path — `code-yeongyu/oh-my-openagent` is a
//              GitHub slug, `src/index.ts` is package-relative, `session/create` is an API route —
//              so it is bucketed as over-report and never reddens the run.
//   existence  an audited token is stat'ed at `<root>/<token>`; missing means unresolved, and an
//              unresolved path exits non-zero WITH the path named.
//
// TWO MATCHER-ERROR DIRECTIONS, COUNTED SEPARATELY AND NEVER FOLDED INTO ONE NUMBER
//   OVER-REPORT  — a candidate this audit REJECTS: a naive matcher would report it as a broken path
//                  while it is not a repo path at all (`url`, `sentence-fragment`,
//                  `trailing-punctuation`, `npm-package-name`, `not-root-relative`, `bare-filename`).
//   UNDER-REPORT — a real path reference this audit CANNOT check: a naive matcher would miss a
//                  break here (`glob`, `home-relative`, `absolute`, `outside-root`, `placeholder`,
//                  `elided`, `prose-only-spelling`).
//   Each bucket prints its own direction, its own reason and its own count; the two families are
//   totalled per direction and are never merged with each other or with `unresolved`.
//
// Usage:
//   node ./scripts/verify-manual-paths.ts [--manual <path>] [--root <dir>]
//   node ./scripts/verify-manual-paths.ts --self-test
//   node ./scripts/verify-manual-paths.ts --help
//
// Exit codes: 0 = every audited path resolves. 1 = audit red: at least one named path is unresolved,
// or the run is DEGRADED because it found no auditable subject at all (zero subjects is never a
// silent pass). 2 = cannot run (missing or unreadable manual, missing root, unknown flag).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Prefix every audit line carries, so this run's output stays attributable in a mixed log. */
const TAG: string = "[verify-manual-paths]";
/** Absolute path of this script, used to spawn the self-test's child runs from the same `.ts` file. */
const SELF: string = fileURLToPath(import.meta.url);
/** Directory holding this script (`<root>/scripts`), the base for the default repo-root resolution. */
const HERE: string = dirname(SELF);

// An audited token is only ever a REPO-RELATIVE spelling; these reasons describe why a shape cannot
// be audited. Keys are stable (they are the second half of the bucket name and are parsed by the
// self-test), values are the human reason printed beside every bucket.
/** Rejection reasons for tokens that look like paths but are not repo paths at all (over-report side). */
const OVER_REASONS: Map<string, string> = new Map([
  ["url", "contains `://` — a URL, not a repo path"],
  ["fragment", "contains whitespace — a sentence or command fragment, not one path"],
  ["trailing", "ends with punctuation — a bound-token fragment, not a path target"],
  ["npm", "starts with `@` — an npm package name, not a repo path"],
  ["notRoot", "first segment is not an entry at the repo root — a slug, route, branch, tool name or package-relative spelling, not a repo path"],
  ["bare", "a bare file name with no directory component and not a root file this repo is expected to carry"],
]);
/** Reasons a real path reference cannot be checked by this audit (under-report side). */
const UNDER_REASONS: Map<string, string> = new Map([
  ["glob", "a glob pattern — there is no single file to stat"],
  ["home", "home-relative (`~`) — it resolves in the user's HOME, not in the repo"],
  ["absolute", "absolute (`/`) — it is outside the repo root"],
  ["outside", "escapes the repo root (`../`) — it is outside the repo root"],
  ["placeholder", "carries a placeholder (`<name>`, `$VAR`, `{a,b}`) — not a literal path"],
  ["elided", "contains an elision mark — the path is not written out, so no literal target exists"],
  ["prose", "a directory spelled in words rather than as a token — nothing to stat"],
]);

/** The four census directions; a family total is summed over exactly one of them. */
type Direction = "audited" | "declared" | "over-report" | "under-report";

/** One census bucket: its stable name, the direction it is counted in, and the reason it exists. */
interface Bucket {
  /** Stable bucket name, printed by every run and parsed by the self-test. */
  readonly name: string;
  /** The family this bucket's count rolls up into. */
  readonly direction: Direction;
  /** Human reason printed beside the bucket's count. */
  readonly reason: string;
}

// Census order is fixed so every run prints every bucket, including the empty ones.
/** Every bucket in print order: the audited pair, the declared pair, then one per reason key. */
const BUCKETS: readonly Bucket[] = [
  { name: "resolved", direction: "audited", reason: "audited: the path exists at the repo root" },
  { name: "unresolved", direction: "audited", reason: "audited: the path does NOT exist at the repo root" },
  // The DECLARED anticipatory class and its rot guard (see ANTICIPATORY_PATHS above): a named, reasoned
  // class with its own `declared` direction, counted apart from the audited subjects and from unresolved
  // — the same shape the docs gate uses for its own anticipatory entries.
  { name: "anticipatory", direction: "declared", reason: "DECLARED anticipatory class: the manual names it, the repository keeps it by design and deliberately does NOT create it (AGENTS.md §3) — printed with its count so an exemption for a file that does not exist can never rot silently" },
  { name: "declared-unreferenced", direction: "declared", reason: "ROT GUARD: a declared anticipatory path this manual no longer names — reported here rather than dropped silently" },
  ...[...OVER_REASONS].map(([key, reason]: [string, string]): Bucket => ({ name: `over-report:${key}`, direction: "over-report", reason })),
  ...[...UNDER_REASONS].map(([key, reason]: [string, string]): Bucket => ({ name: `under-report:${key}`, direction: "under-report", reason })),
];
/** Every bucket name in census order; the self-test asserts each one prints its own line. */
const BUCKET_NAMES: readonly string[] = BUCKETS.map((b: Bucket): string => b.name);

// Root files the manual is EXPECTED to name. A bare file name (no directory component) is audited
// only when it is on this list or when it really exists at the root: the allowlist is what gives the
// audit teeth for a documented root file that disappeared, while a convention name that is merely
// mentioned (`AGENT.md` as the first-choice instruction file) stays a reported over-report instead of
// a false red.
/** Documented root files a bare mention is stat'ed against, so a vanished one reddens. */
const KNOWN_ROOT_FILES: ReadonlySet<string> = new Set([
  "AGENTS.md",
  "README.md",
  "README.zh-CN.md",
  "LICENSE.md",
  "LICENSE-NOTICES.md",
  "VENDOR_LOCK.json",
  "PLAN.md",
  "package.json",
  "tsconfig.json",
  "EXTENSIONS-FOR-AGENTS.md",
  "bun.lock",
  "dsh-plugin.json",
  "dsh-distribution.json",
]);

// ── THE DECLARED ANTICIPATORY CLASS ──────────────────────────────────────────────────────────────
// AGENTS.md §3 declares these two in its OWN policy sentence: "the two ANTICIPATORY paths
// (`docs/adder4.md`, `docs/cnt8.md`) are kept by design and printed as their own class so an exemption
// for a file that does not exist can never rot silently." `scripts/verify-docs-parity.ts` already
// prints them as `ANTICIPATORY — not a live path`. This is that SAME declared-and-reasoned class,
// carried by THIS instrument, so the current tree can be green without weakening one refusal.
//
// It is NOT an ignore list. An entry suppresses a mention ONLY when (a) the manual spells that exact
// repo-relative path AND (b) the file really is absent. Every other missing path still fails (the
// `anticipatory-does-not-widen` arm), an entry the manual stops naming is still PRINTED by the
// `declared-unreferenced` rot guard (the `anticipatory-rot-guard` arm), and DELETING an entry makes its
// mention fail again (the `anticipatory-removed-fails` arm runs the checker with this class emptied by
// the test-only `--no-anticipatory` flag, which can only REMOVE an exemption). No candidate, shape,
// anchor or existence rule is touched: the matcher is exactly as it was.
/** Declared anticipatory path to the reason this repository keeps it without creating it. */
const ANTICIPATORY_PATHS: ReadonlyMap<string, string> = new Map([
  ["docs/adder4.md", "ANTICIPATORY — not a live path: kept by design (AGENTS.md §3), printed by `scripts/verify-docs-parity.ts` as its own class, and deliberately not created yet"],
  ["docs/cnt8.md", "ANTICIPATORY — not a live path: kept by design (AGENTS.md §3), printed by `scripts/verify-docs-parity.ts` as its own class, and deliberately not created yet"],
]);

/** Dotted extensions that make a bare token path-shaped even without a directory component. */
const FILE_EXT_RE: RegExp = /\.(?:md|markdown|mjs|cjs|js|jsx|json|jsonc|ya?ml|ts|tsx|mts|cts|sh|bash|py|txt|lock|css|html|toml)$/;
/** Characters that mark a `<name>` / `$VAR` / `{a,b}` placeholder rather than a literal path. */
const PLACEHOLDER_RE: RegExp = /[<>${}]/;
/** Non-printable-ASCII characters, which mark an elided or non-English spelling. */
const NON_ASCII_RE: RegExp = /[^\x20-\x7e]/;
/** Trailing punctuation that means the token is a fragment of a longer sentence. */
const TRAILING_PUNCT_RE: RegExp = /[.,;:!?)\]}"']$/;
/** Matches one whole backtick-delimited code span anywhere in a line. */
const CODE_SPAN_RE: RegExp = /`([^`]+)`/g;
/** Reads an explicitly `./`- or `../`-spelled path out of prose. */
const PROSE_PATH_RE: RegExp = /\.\.?\/[^\s"'`)\]}]+/g;
/** Reads a directory named in words (`the <word> directory`), the one prose class worth naming. */
const PROSE_DIR_RE: RegExp = /\b(?:the|a|an|this|that|every|any)\s+([A-Za-z][A-Za-z0-9._-]*)\s+(?:directory|dir|folder|tree)\b/g;

// Informational only (see tailMatches): the bases that host sub-projects whose files the manual
// often spells package-relatively.
/** Host bases searched for the resolving tail of an unresolved path; informational only. */
const HOST_BASES: readonly string[] = ["packages", "extensions", "skills", "presets", "templates", "tests"];

/** Print one whole audit line to stdout under the tag; every census line goes through here. */
const say = (...parts: string[]): void => console.log(`${TAG} ${parts.join(" ")}`);
/** Print one cannot-run diagnostic to stderr; only exit-2 paths use it. */
const oops = (...parts: string[]): void => console.error(`${TAG} ${parts.join(" ")}`);

/** Drop the one trailing `/` a directory-shaped token may carry, so it stats as the directory itself. */
const stripSlash = (token: string): string => (token.endsWith("/") ? token.slice(0, -1) : token);

/** SHA-256 of the manual text, printed so a verdict is anchored to the exact revision that was read. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Inputs every matcher helper needs: the repo root and the entry names found directly under it. */
interface AuditContext {
  /** Absolute repo root the audited tokens are stat'ed against. */
  readonly root: string;
  /** Names of the entries directly under `root`; membership is what makes a token root-relative. */
  readonly rootEntries: ReadonlySet<string>;
}

// CANDIDATE gate: is this token a path mention at all? Anything that fails here is not counted
// anywhere, by design (see the header's `candidate` clause).
/** Whether a token is path-shaped at all; a rejected candidate is counted in no bucket. */
function isCandidate(token: string, rootEntries: ReadonlySet<string>): boolean {
  /** The token without a trailing slash, which is the only form the shape tests read. */
  const body: string = stripSlash(token);
  if (body === "") return false;
  if (body.includes("/")) return true;
  if (FILE_EXT_RE.test(body)) return true;
  if (rootEntries.has(body)) return true;
  return KNOWN_ROOT_FILES.has(body);
}

/** The single verdict `classify` returns for one occurrence: audit target, rejection, or skip. */
type Verdict =
  | { readonly kind: "audit"; readonly rel: string }
  | { readonly kind: "over"; readonly reason: string; readonly detail: string }
  | { readonly kind: "under"; readonly reason: string; readonly detail: string }
  | { readonly kind: "skip" };

/** Which extraction rule produced an occurrence; the position decides the first classification. */
type OccurrenceSource = "code-span" | "span-fragment" | "prose" | "prose-dir";

/** One raw path-shaped mention read out of the manual, before classification. */
interface Occurrence {
  /** The token text exactly as the manual spells it. */
  readonly token: string;
  /** 1-based line number of the mention inside the manual. */
  readonly line: number;
  /** 0-based character offset inside the line, used only for stable ordering. */
  readonly at: number;
  /** The extraction rule that produced this occurrence. */
  readonly source: OccurrenceSource;
  /** Set only by `prose-dir`: the worded directory name the prose mention names. */
  readonly word?: string;
}

// One classification per occurrence. Returns exactly one of:
//   { kind: "audit", rel }            — stat <root>/<rel>
//   { kind: "over",  reason, detail } — rejected candidate (over-report side)
//   { kind: "under", reason, detail } — un-auditable path reference (under-report side)
//   { kind: "skip" }                  — not path-shaped (documented scope limit, counted nowhere)
/** Classify one occurrence, so it lands in exactly one bucket or is skipped. */
function classify(occurrence: Occurrence, ctx: AuditContext): Verdict {
  /** The token under test, as the manual spells it. */
  const token: string = occurrence.token;
  /** Rejection verdict for a candidate that is not a repo path (over-report side). */
  const over = (reason: string, detail: string = ""): Verdict => ({ kind: "over", reason, detail });
  /** Un-auditable-reference verdict (under-report side). */
  const under = (reason: string, detail: string = ""): Verdict => ({ kind: "under", reason, detail });

  // Position-derived classes first: they are already known not to be a single path token.
  if (occurrence.source === "span-fragment") {
    return over("fragment", "the whole code span, whitespace included");
  }
  if (occurrence.source === "prose-dir") {
    return under("prose", `"${occurrence.word}" is named in words, not as a token`);
  }
  if (!isCandidate(token, ctx.rootEntries)) return { kind: "skip" };

  if (token.includes("://")) return over("url");
  if (NON_ASCII_RE.test(token)) return under("elided", "non-ASCII/elision characters");
  if (/\s/.test(token)) return over("fragment");
  if (token.includes("*")) return under("glob");
  if (token.startsWith("~")) return under("home");
  if (token.startsWith("/")) return under("absolute");
  if (token.startsWith("../")) return under("outside");
  if (PLACEHOLDER_RE.test(token)) return under("placeholder");
  if (token.startsWith("@")) return over("npm");

  /** The token without a trailing slash, the form the anchor tests below read. */
  const body: string = stripSlash(token);
  if (TRAILING_PUNCT_RE.test(body)) {
    return over("trailing", `the token ends with "${body.slice(-1)}"`);
  }

  // A bare name has no directory component to hang off: audit it only when the repo really carries
  // it at the root, or when it is a documented root file (which is where a vanished file still reds).
  if (!body.includes("/")) {
    if (ctx.rootEntries.has(body)) return { kind: "audit", rel: body };
    if (KNOWN_ROOT_FILES.has(body)) return { kind: "audit", rel: body };
    return over("bare");
  }

  /** The repo-relative spelling the explicit `./` form and the audited form share. */
  const rel: string = body.replace(/^\.\//, "");
  if (token.startsWith("./") || token.startsWith("../")) {
    /** Where the explicit spelling resolves; it may leave the repo root. */
    const abs: string = resolve(ctx.root, rel);
    if (abs !== ctx.root && !abs.startsWith(ctx.root + sep)) return under("outside");
    return { kind: "audit", rel };
  }
  /** First path segment, which must be an entry at the repo root to count as a repo path. */
  const first: string = body.split("/")[0];
  if (!ctx.rootEntries.has(first)) return over("notRoot", `first segment "${first}"`);
  return { kind: "audit", rel: body };
}

// Every occurrence this audit reads, deduplicated per (token, line) and ordered by manual position.
/** Read every auditable mention out of the manual text, in manual order and deduplicated. */
function extractOccurrences(text: string, ctx: AuditContext): Occurrence[] {
  /** Occurrences in raw discovery order, before deduplication. */
  const found: Occurrence[] = [];
  /** The manual split into lines, so reported line numbers are the manual's own. */
  const lines: string[] = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    /** The manual line currently scanned by all three extraction rules. */
    const line: string = lines[i];
    /** 1-based number of `line` in the manual, printed with every bucket row. */
    const lineNo: number = i + 1;
    for (const span of line.matchAll(CODE_SPAN_RE)) {
      /** The text inside the backticks, the only position a bare token is read from. */
      const body: string = span[1];
      /** 0-based offset of the span inside the line, kept for stable ordering. */
      const at: number = span.index ?? 0;
      // The span AS A WHOLE is also a candidate when it carries a separator plus whitespace: that is
      // the "sentence/command fragment that looks like a path" trap a naive matcher falls into.
      if (/\s/.test(body) && (body.includes("/") || FILE_EXT_RE.test(body))) {
        found.push({ token: body, line: lineNo, at, source: "span-fragment" });
      }
      for (const piece of body.split(/\s+/)) {
        if (piece !== "") found.push({ token: piece, line: lineNo, at, source: "code-span" });
      }
    }
    // Prose: read only explicit relative spellings, plus the one worded class we can name.
    /** The line with every code span blanked, so prose scanning cannot re-read a span token. */
    const prose: string = line.replace(CODE_SPAN_RE, " ");
    for (const hit of prose.matchAll(PROSE_PATH_RE)) {
      found.push({ token: hit[0], line: lineNo, at: hit.index ?? 0, source: "prose" });
    }
    for (const hit of prose.matchAll(PROSE_DIR_RE)) {
      /** The worded name captured by PROSE_DIR_RE; audited only when it is a real root entry. */
      const word: string = hit[1];
      if (ctx.rootEntries.has(word)) {
        found.push({ token: hit[0], line: lineNo, at: hit.index ?? 0, source: "prose-dir", word });
      }
    }
  }
  /** `token\0line` keys already emitted, so a token repeated on one line is counted once. */
  const seen: Set<string> = new Set();
  /** Deduplicated occurrences, still in discovery order. */
  const unique: Occurrence[] = [];
  for (const occurrence of found) {
    /** Deduplication key: the same token on the same line is one subject. */
    const key: string = `${occurrence.token}\u0000${occurrence.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(occurrence);
  }
  unique.sort((a: Occurrence, b: Occurrence): number => a.line - b.line || a.at - b.at);
  return unique;
}

// INFORMATIONAL ONLY — never changes a bucket and never changes the exit code. A root-relative
// spelling that misses at the root is often a package-relative one (`dist/index.js` for
// `packages/<pkg>/dist/index.js`); naming where the same tail DOES resolve is what turns the
// unresolved list into an actionable hand-off instead of a puzzle.
/** Where the same tail resolves under a host base, or `""` when no directory carries it. */
function tailMatches(root: string, rootEntries: ReadonlySet<string>, rel: string): string {
  try {
    /** Candidate repo-relative paths whose tail equals `rel`. */
    const hits: string[] = [];
    for (const base of HOST_BASES) {
      if (!rootEntries.has(base)) continue;
      for (const child of readdirSync(join(root, base))) {
        if (child.startsWith(".")) continue;
        if (existsSync(join(root, base, child, rel))) hits.push(`${base}/${child}/${rel}`);
      }
    }
    if (hits.length === 0) return "";
    /** The first two candidates, which is the most one census line prints. */
    const head: string = hits.slice(0, 2).join(", ");
    return hits.length > 2 ? `${head}, +${hits.length - 2} more` : head;
  } catch {
    return "";
  }
}

/** Inputs of one audit run. */
interface AuditOptions {
  /** Absolute path of the manual to read. */
  readonly manualPath: string;
  /** Absolute repo root the manual's root-relative tokens are stat'ed against. */
  readonly root: string;
  /** Declared anticipatory class; an empty map means every missing path is unresolved. */
  readonly anticipatory?: ReadonlyMap<string, string>;
}

/** Identity of the audited manual, printed in the run header and carried by the report. */
interface ManualInfo {
  /** Absolute path of the manual that was read. */
  readonly manualPath: string;
  /** Repo-relative label when the manual sits under the root, else the absolute path. */
  readonly manualLabel: string;
  /** Absolute repo root the audited tokens are stat'ed against. */
  readonly root: string;
  /** SHA-256 of the manual bytes, so the reading is anchored to one revision. */
  readonly sha256: string;
  /** Size of the manual in bytes. */
  readonly bytes: number;
  /** Manual mtime as an ISO-8601 string. */
  readonly mtime: string;
}

/** One census row: the occurrence plus whatever detail its bucket adds. */
interface CensusEntry {
  /** Token as the manual spells it; absent only on the synthetic rot-guard row. */
  readonly token?: string;
  /** 1-based manual line, or `"-"` on the synthetic rot-guard row. */
  readonly line: number | string;
  /** 0-based offset inside the line; absent on the synthetic rot-guard row. */
  readonly at?: number;
  /** Extraction rule that produced the occurrence; absent on the synthetic rot-guard row. */
  readonly source?: OccurrenceSource;
  /** Set only for a worded prose-directory mention. */
  readonly word?: string;
  /** Repo-relative path the row is about; absent on the over/under-report rows. */
  readonly rel?: string;
  /** Bucket-specific note (matched tail, rejection detail, declaration reason); `""` when none. */
  readonly detail: string;
}

/** Everything one audit run produces, consumed by `render` and `reportExit`. */
interface AuditReport {
  /** Identity of the audited manual. */
  readonly info: ManualInfo;
  /** Every bucket name mapped to its rows; all names are present, empty buckets included. */
  readonly buckets: ReadonlyMap<string, CensusEntry[]>;
  /** Row count of one named bucket, in census order. */
  readonly count: (name: string) => number;
  /** Total rows across the buckets of one direction. */
  readonly family: (direction: Direction) => number;
  /** Audited subject count (resolved plus unresolved); zero makes the run DEGRADED. */
  readonly subjects: number;
}

/** Read the manual once and fill every census bucket; nothing is written. */
function audit({ manualPath, root, anticipatory = ANTICIPATORY_PATHS }: AuditOptions): AuditReport {
  /** The manual text, read once so every rule sees the same revision. */
  const text: string = readFileSync(manualPath, "utf8");
  /** Manual identity, printed in the run header and carried by the report. */
  const info: ManualInfo = {
    manualPath,
    manualLabel: manualPath.startsWith(root + sep) ? manualPath.slice(root.length + 1) : manualPath,
    root,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text),
    mtime: statSync(manualPath).mtime.toISOString(),
  };
  /** Entry names directly under the repo root; membership decides root-relativity. */
  const rootEntries: Set<string> = new Set(readdirSync(root));
  /** Matcher context shared by every classification call. */
  const ctx: AuditContext = { root, rootEntries };
  /** Census bucket name to its rows; all names are pre-created so every bucket prints a line. */
  const buckets: Map<string, CensusEntry[]> = new Map(BUCKET_NAMES.map((name: string): [string, CensusEntry[]] => [name, []]));
  /** Declared anticipatory paths this manual really names; the rot guard diffs it against the class. */
  const referencedAnticipatory: Set<string> = new Set();
  /** Rows of one bucket; every bucket name is pre-created above, so a lookup never misses. */
  const rowsOf = (name: string): CensusEntry[] => buckets.get(name)!;
  for (const occurrence of extractOccurrences(text, ctx)) {
    /** Verdict for this occurrence: an audit target, a rejection, or a skip. */
    const verdict: Verdict = classify(occurrence, ctx);
    if (verdict.kind === "skip") continue;
    if (verdict.kind === "over") {
      rowsOf(`over-report:${verdict.reason}`).push({ ...occurrence, detail: verdict.detail });
      continue;
    }
    if (verdict.kind === "under") {
      rowsOf(`under-report:${verdict.reason}`).push({ ...occurrence, detail: verdict.detail });
      continue;
    }
    /** Whether the audited path exists at the repo root. */
    const exists: boolean = existsSync(join(root, verdict.rel));
    // The declared class is checked HERE — after the existence test, so it can only ever hold back a
    // mention of a path that really is absent, and only when the manual spells that exact rel path.
    if (!exists && anticipatory.has(verdict.rel)) {
      referencedAnticipatory.add(verdict.rel);
      // The `has` test above proves the entry is present, so this lookup cannot be undefined here.
      /** The reason this repository declares for keeping that path without creating it. */
      const declaredReason: string = anticipatory.get(verdict.rel)!;
      rowsOf("anticipatory").push({ ...occurrence, rel: verdict.rel, detail: declaredReason });
      continue;
    }
    /** Matched tail elsewhere in the tree for an unresolved path, `""` for a resolved one. */
    const detail: string = exists ? "" : tailMatches(root, rootEntries, verdict.rel);
    rowsOf(exists ? "resolved" : "unresolved").push({ ...occurrence, rel: verdict.rel, detail });
  }
  // ROT GUARD: a declared entry this manual no longer names is REPORTED, never dropped silently.
  for (const [rel] of anticipatory) {
    if (!referencedAnticipatory.has(rel)) {
      rowsOf("declared-unreferenced").push({ rel, line: "-", detail: "declared anticipatory, but this manual no longer names it — remove the declaration or restore the mention" });
    }
  }
  /** Row count of one named bucket. */
  const count = (name: string): number => rowsOf(name).length;
  /** Total rows across the buckets of one direction (audited, declared, over-report, under-report). */
  const family = (direction: Direction): number =>
    BUCKETS.filter((b: Bucket): boolean => b.direction === direction).reduce((sum: number, b: Bucket): number => sum + count(b.name), 0);
  return { info, buckets, count, family, subjects: count("resolved") + count("unresolved") };
}

/** Print the header, the rule, the subject count and one census line per bucket and row. */
function render(report: AuditReport): void {
  /** The report parts printed here: manual identity, the census, and the two counting helpers. */
  const { info, buckets, count, family } = report;
  say(`manual ${info.manualPath}`);
  say(`root ${info.root}`);
  say(`manual-sha256 ${info.sha256} bytes=${info.bytes} mtime=${info.mtime}`);
  say("rule candidate=path-shaped token | position=code span or ./|../-prefixed prose | shape=no glob/tilde/url/whitespace/placeholder/trailing-punctuation | anchor=./|-literal else first segment must be a repo-root entry | existence=stat <root>/<token>");
  say(`subjects audited=${report.subjects} (resolved=${count("resolved")} unresolved=${count("unresolved")}); tokens that are not path-shaped are out of scope by the rule above and are counted nowhere`);
  for (const bucket of BUCKETS) {
    // Every bucket name in BUCKETS is pre-created by `audit`, so this lookup cannot miss.
    /** Rows of the bucket being printed. */
    const entries: CensusEntry[] = buckets.get(bucket.name)!;
    // One census line per bucket, always printed (empty buckets included): this is the block the
    // self-test parses, so the counts can never be folded together without the evidence noticing.
    say(`census bucket=${bucket.name} direction=${bucket.direction} count=${entries.length} reason="${bucket.reason}"`);
    for (const entry of entries) {
      /** The path the row is about: the resolved rel, else the raw token. */
      const target: string | undefined = entry.rel ?? entry.token;
      /** The `bucket label:line -> target` prefix every row line shares. */
      const located: string = `${bucket.name} ${info.manualLabel}:${entry.line} -> ${target}`;
      say(entry.detail ? `${located} [${entry.detail}]` : located);
    }
  }
  say(`census family=over-report direction=over-report total=${family("over-report")} buckets=${[...OVER_REASONS].length} (counted apart from under-report and from unresolved)`);
  say(`census family=under-report direction=under-report total=${family("under-report")} buckets=${[...UNDER_REASONS].length} (counted apart from over-report and from unresolved)`);
  say(`census family=declared direction=declared total=${family("declared")} buckets=${BUCKETS.filter((b: Bucket): boolean => b.direction === "declared").length} (the DECLARED anticipatory class and its rot guard — counted apart from the audited subjects and from unresolved)`);
}

/** Print the verdict line and return this run's exit code (0 green, 1 red or degraded). */
function reportExit(report: AuditReport): number {
  // Every bucket name in BUCKETS is pre-created by `audit`, so this lookup cannot miss.
  /** Rows of the `unresolved` bucket, the only bucket that reddens the run. */
  const unresolved: CensusEntry[] = report.buckets.get("unresolved")!;
  if (report.subjects === 0) {
    say(`DEGRADED zero auditable subjects: no path-shaped token was found in ${report.info.manualPath} — nothing was checked, so this run is NOT a pass`);
    say("FAIL degraded=zero-subjects");
    return 1;
  }
  if (unresolved.length > 0) {
    /** The unresolved paths with their manual positions, named in the FAIL line. */
    const named: string = unresolved.map((e: CensusEntry): string => `${e.rel} (${report.info.manualLabel}:${e.line})`).join(", ");
    say(`FAIL unresolved=${unresolved.length} — the manual names paths that do not exist at the repo root: ${named}`);
    return 1;
  }
  /** Declared-but-unreferenced rows the rot guard found; a NOTE, never a failure. */
  const unreferenced: number = report.count("declared-unreferenced");
  if (unreferenced > 0) {
    say(`NOTE declared-unreferenced=${unreferenced} — the repository DECLARES these anticipatory and this manual no longer names them: remove the declaration or restore the mention (a rot guard, deliberately not a failure)`);
  }
  say(`PASS resolved=${report.count("resolved")} over-report=${report.family("over-report")} under-report=${report.family("under-report")} declared=${report.count("anticipatory")} (every audited path exists; the DECLARED anticipatory class is named with its reason and counted apart; the two matcher-error directions above are reported, not merged)`);
  return 0;
}

// ── self-test: hermetic temp fixtures only, one child run per arm ────────────────────────────────

/** Expected exit status and expected census counts of one self-test arm. */
interface ArmExpectation {
  /** Exit status the fixture child run must report. */
  readonly exit: number;
  /** Expected count per bucket name; a bucket not listed here is not asserted. */
  readonly buckets?: Readonly<Record<string, number>>;
  /** Expected family total per direction; a family not listed here is not asserted. */
  readonly family?: Readonly<Record<string, number>>;
}

/** One self-test fixture arm: the fixture manual it writes, the paths it pre-creates, its expectations. */
interface Arm {
  /** Arm name, also the fixture sub-directory name and the label in the arm line. */
  readonly name: string;
  /** Extra CLI flags appended to the child run (e.g. `--no-anticipatory`). */
  readonly args?: readonly string[];
  /** Directories pre-created inside the fixture root, beyond the parents of `files`. */
  readonly dirs?: readonly string[];
  /** Files pre-created inside the fixture root, keyed by repo-relative path. */
  readonly files?: Readonly<Record<string, string>>;
  /** The manual body written to `<root>/AGENTS.md`; unused when `missingManual` is set. */
  readonly manual: string;
  /** When true the child is pointed at a path that does not exist (the exit-2 arm). */
  readonly missingManual?: boolean;
  /** The exit status and census counts this arm expects. */
  readonly expect: ArmExpectation;
  /** Regexes that MUST match the child output. */
  readonly mustContain?: readonly RegExp[];
  /** Regexes that must NOT match the child output. */
  readonly mustNotContain?: readonly RegExp[];
}

/** The fixture arms: the positive controls, the two matcher-error directions and the anticipatory class. */
const ARMS: readonly Arm[] = [
  {
    name: "all-exist-green",
    dirs: ["docs", "scripts"],
    files: { "docs/keep.md": "keep\n", "scripts/keep.mjs": "// keep\n" },
    manual: "# Fixture manual\n\nEvery path this fixture names exists: `AGENTS.md`, `docs/keep.md`, `scripts/keep.mjs`.\n",
    expect: { exit: 0, buckets: { resolved: 3, unresolved: 0 }, family: { "over-report": 0, "under-report": 0 } },
    mustContain: [/census bucket=resolved direction=audited count=3/, /PASS resolved=3/],
  },
  {
    name: "missing-path-red",
    dirs: ["docs"],
    files: { "docs/keep.md": "keep\n" },
    manual: "# Fixture manual\n\nThis one exists: `docs/keep.md`. This one does not: `./no/such/path.mjs`.\n",
    expect: { exit: 1, buckets: { resolved: 1, unresolved: 1 } },
    mustContain: [/census bucket=unresolved direction=audited count=1/, /unresolved AGENTS\.md:3 -> no\/such\/path\.mjs/, /FAIL unresolved=1/],
    mustNotContain: [/PASS resolved=/],
  },
  {
    name: "over-report-separate",
    dirs: ["docs"],
    files: { "docs/keep.md": "keep\n" },
    manual: [
      "# Fixture manual",
      "",
      "A real path: `docs/keep.md`.",
      "A URL that is not a path: `https://example.com/a/b.md`.",
      "A sentence fragment that merely looks like one: `read the docs/keep.md file now`.",
      "An npm name that is not a path: `@scope/pkg-name`.",
      "An owner/repo slug that is not a path: `owner/repo-name`.",
      "A bare file name this repo does not carry at the root: `AGENT.md`.",
      "",
    ].join("\n"),
    // resolved=2 because the fragment's own path token is still audited; the five rejected candidates
    // live in their own reason buckets and MUST NOT inflate unresolved (0) or the exit code (0).
    expect: {
      exit: 0,
      buckets: {
        resolved: 2,
        unresolved: 0,
        "over-report:url": 1,
        "over-report:fragment": 1,
        "over-report:npm": 1,
        "over-report:notRoot": 1,
        "over-report:bare": 1,
      },
      family: { "over-report": 5, "under-report": 0 },
    },
    mustContain: [/census family=over-report direction=over-report total=5/, /census bucket=unresolved direction=audited count=0/, /PASS resolved=2 over-report=5/],
  },
  {
    name: "under-report-separate",
    dirs: ["docs", "scripts"],
    files: { "docs/keep.md": "keep\n" },
    manual: [
      "# Fixture manual",
      "",
      "A real path: `docs/keep.md`.",
      "A glob this audit cannot check: `docs/*.md`.",
      "A home-relative spelling this audit cannot check: `~/.mpd/workmate`.",
      "Prose spelling this audit cannot check: see the scripts directory for the gates.",
      "",
    ].join("\n"),
    expect: {
      exit: 0,
      buckets: {
        resolved: 1,
        unresolved: 0,
        "under-report:glob": 1,
        "under-report:home": 1,
        "under-report:prose": 1,
      },
      family: { "over-report": 0, "under-report": 3 },
    },
    mustContain: [
      /census family=under-report direction=under-report total=3/,
      /census bucket=under-report:glob direction=under-report count=1/,
      /census bucket=under-report:home direction=under-report count=1/,
      /census bucket=under-report:prose direction=under-report count=1/,
      /census bucket=unresolved direction=audited count=0/,
    ],
  },
  {
    name: "zero-subjects-degraded",
    files: {},
    manual: "# Fixture manual\n\nThis fixture names nothing that can be audited.\n",
    expect: { exit: 1, buckets: { resolved: 0, unresolved: 0 }, family: { "over-report": 0, "under-report": 0 } },
    mustContain: [/DEGRADED zero auditable subjects/, /FAIL degraded=zero-subjects/],
    mustNotContain: [/PASS resolved=/],
  },
  {
    name: "missing-manual-cannot-run",
    files: {},
    manual: "# Fixture manual\n\n`docs/keep.md`\n",
    missingManual: true,
    expect: { exit: 2, buckets: {}, family: {} },
    mustContain: [/manual not found/],
  },
  {
    name: "anticipatory-class-green",
    dirs: ["docs"],
    files: { "docs/keep.md": "keep\n" },
    manual: "# Fixture manual\n\nA real path: `docs/keep.md`. The two DECLARED anticipatory paths the repository keeps by design: `docs/adder4.md`, `docs/cnt8.md`.\n",
    expect: { exit: 0, buckets: { resolved: 1, unresolved: 0, anticipatory: 2, "declared-unreferenced": 0 }, family: { "over-report": 0, "under-report": 0, declared: 2 } },
    mustContain: [
      /census bucket=anticipatory direction=declared count=2/,
      /census family=declared direction=declared total=2/,
      /anticipatory AGENTS\.md:3 -> docs\/adder4\.md \[ANTICIPATORY — not a live path/,
      /PASS resolved=1 .*declared=2/,
    ],
    mustNotContain: [/FAIL unresolved=/, /declared-unreferenced AGENTS\.md/],
  },
  {
    name: "anticipatory-does-not-widen",
    dirs: ["docs"],
    files: { "docs/keep.md": "keep\n" },
    manual: "# Fixture manual\n\nA real path: `docs/keep.md`. A declared one: `docs/adder4.md`. One that is NOT declared: `docs/not-declared.md`.\n",
    // declared family = 1 anticipatory + 1 ROT GUARD (this fixture never names `docs/cnt8.md`), and the
    // undeclared missing path still lands in `unresolved` and still fails the run — the class never widens.
    expect: { exit: 1, buckets: { resolved: 1, unresolved: 1, anticipatory: 1, "declared-unreferenced": 1 }, family: { declared: 2 } },
    mustContain: [/unresolved AGENTS\.md:3 -> docs\/not-declared\.md/, /declared-unreferenced AGENTS\.md:- -> docs\/cnt8\.md/, /FAIL unresolved=1/],
    mustNotContain: [/PASS resolved=/],
  },
  {
    name: "anticipatory-removed-fails",
    args: ["--no-anticipatory"],
    dirs: ["docs"],
    files: { "docs/keep.md": "keep\n" },
    manual: "# Fixture manual\n\nA real path: `docs/keep.md`. The two the class normally carries: `docs/adder4.md`, `docs/cnt8.md`.\n",
    expect: { exit: 1, buckets: { resolved: 1, unresolved: 2, anticipatory: 0 }, family: { declared: 0 } },
    mustContain: [/unresolved AGENTS\.md:3 -> docs\/adder4\.md/, /FAIL unresolved=2/],
    mustNotContain: [/PASS resolved=/],
  },
  {
    name: "anticipatory-rot-guard",
    dirs: ["docs"],
    files: { "docs/keep.md": "keep\n" },
    manual: "# Fixture manual\n\nA real path: `docs/keep.md`. Only ONE of the two declared: `docs/adder4.md`.\n",
    expect: { exit: 0, buckets: { resolved: 1, unresolved: 0, anticipatory: 1, "declared-unreferenced": 1 }, family: { declared: 2 } },
    mustContain: [/declared-unreferenced AGENTS\.md:- -> docs\/cnt8\.md/, /NOTE declared-unreferenced=1/, /PASS resolved=1 .*declared=1/],
  },
];

/** Bucket name to the count the child's census lines report for it. */
function parseCensus(output: string): Map<string, number> {
  /** Parsed count per bucket name, absent for a bucket the child never printed. */
  const counts: Map<string, number> = new Map();
  for (const line of output.split("\n")) {
    /** The census match on this line, or null when the line is not a bucket line. */
    const hit: RegExpExecArray | null = /census bucket=(\S+) direction=(\S+) count=(\d+)\b/.exec(line);
    if (hit) counts.set(hit[1], Number(hit[3]));
  }
  return counts;
}

/** Direction name to the family total the child's census lines report for it. */
function parseFamilies(output: string): Map<string, number> {
  /** Parsed total per direction, absent for a family the child never printed. */
  const totals: Map<string, number> = new Map();
  for (const line of output.split("\n")) {
    /** The family match on this line, or null when the line is not a family line. */
    const hit: RegExpExecArray | null = /census family=(\S+) direction=(\S+) total=(\d+)\b/.exec(line);
    if (hit) totals.set(hit[1], Number(hit[3]));
  }
  return totals;
}

/** Outcome of one executed arm: the problems found (empty means PASS) and its one-line summary. */
interface ArmResult {
  /** Human-readable problems; an empty array is the only PASS. */
  readonly problems: string[];
  /** One-line census summary printed beside the arm's PASS/FAIL. */
  readonly summary: string;
}

/** One arm's outcome with the arm name attached, as reported at the end of the self-test. */
interface NamedArmResult extends ArmResult {
  /** The arm this result belongs to. */
  readonly name: string;
}

/** Run one fixture arm in its own child process and compare its census against the expectations. */
function runArm(arm: Arm, fixtureDir: string): ArmResult {
  /** Fixture repo root for this arm; the child is pointed at it with `--root`. */
  const root: string = join(fixtureDir, arm.name);
  mkdirSync(root, { recursive: true });
  for (const dir of arm.dirs ?? []) mkdirSync(join(root, dir), { recursive: true });
  /** The manual the arm writes; the child audits this file. */
  const manualPath: string = join(root, "AGENTS.md");
  writeFileSync(manualPath, arm.manual);
  for (const [rel, content] of Object.entries(arm.files ?? {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  /** Manual argument handed to the child: the fixture manual, or a path that does not exist. */
  const manualArg: string = arm.missingManual === true ? join(root, "does-not-exist.md") : manualPath;
  /** The child run with both streams captured as text. */
  const child = spawnSync(process.execPath, [SELF, "--manual", manualArg, "--root", root, ...(arm.args ?? [])], { encoding: "utf8" });
  /** Child stdout and stderr concatenated; every assertion below reads only this text. */
  const output: string = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  /** Every problem this arm found; empty means PASS. */
  const problems: string[] = [];
  if (child.status !== arm.expect.exit) problems.push(`exit ${child.status}, want ${arm.expect.exit}`);
  /** Bucket counts the child's census lines reported. */
  const census: Map<string, number> = parseCensus(output);
  /** Family totals the child's census lines reported. */
  const families: Map<string, number> = parseFamilies(output);
  // A run that could not start (exit 2) produces no census by construction; every other arm must
  // print EVERY bucket separately, which is what proves the counts are never folded together.
  if (child.status !== 2) {
    for (const name of BUCKET_NAMES) {
      if (!census.has(name)) problems.push(`bucket ${name} was not printed separately`);
    }
    for (const [name, want] of Object.entries(arm.expect.buckets ?? {})) {
      /** Count this run reported for `name`, or undefined when the bucket line was missing. */
      const got: number | undefined = census.get(name);
      if (got !== want) problems.push(`bucket ${name}=${got ?? "missing"}, want ${want}`);
    }
    for (const [name, want] of Object.entries(arm.expect.family ?? {})) {
      /** Total this run reported for `name`, or undefined when the family line was missing. */
      const got: number | undefined = families.get(name);
      if (got !== want) problems.push(`family ${name}=${got ?? "missing"}, want ${want}`);
    }
  }
  for (const re of arm.mustContain ?? []) if (!re.test(output)) problems.push(`missing from output: ${re}`);
  for (const re of arm.mustNotContain ?? []) if (re.test(output)) problems.push(`unexpected in output: ${re}`);
  if (arm.missingManual !== true && !output.includes(manualArg)) {
    problems.push("the run did not audit the fixture manual");
  }
  /** One-line census summary printed beside the arm's PASS/FAIL. */
  const summary: string = [
    `exit=${child.status}/${arm.expect.exit}`,
    `resolved=${census.get("resolved") ?? "-"}`,
    `unresolved=${census.get("unresolved") ?? "-"}`,
    `over-report=${families.get("over-report") ?? "-"}`,
    `under-report=${families.get("under-report") ?? "-"}`,
    `declared=${census.get("anticipatory") ?? "-"}`,
  ].join(" ");
  return { problems, summary };
}

/** Run every fixture arm in a temp directory outside the repo and return the self-test exit code. */
function selfTest(): number {
  /** Temp directory holding every arm's fixture repo; removed in the `finally` below. */
  const fixtureDir: string = mkdtempSync(join(tmpdir(), "verify-manual-paths-"));
  /** Repository root, derived from this script's own location. */
  const repoRoot: string = resolve(HERE, "..");
  // The fixtures must never live inside the repo: an arm that did would write into the workspace and
  // stop being hermetic. This is reported as a FAILED self-test, never as a crash — the run must
  // always finish with the PASS/FAIL arm line below.
  /** Whether the temp fixtures unexpectedly landed inside the repository. */
  const insideRepo: boolean = fixtureDir === repoRoot || fixtureDir.startsWith(repoRoot + sep);
  /** One result per arm, in ARMS order. */
  const results: NamedArmResult[] = [];
  try {
    if (insideRepo) say(`self-test fixtures must live outside the repo root, got ${fixtureDir}`);
    else say(`self-test fixtures ${fixtureDir} (temp only; nothing in the repo is written)`);
    ARMS.forEach((arm: Arm): void => {
      if (insideRepo) {
        results.push({ name: arm.name, summary: "not-run", problems: [`fixtures inside the repo root (${fixtureDir})`] });
        return;
      }
      try {
        results.push({ name: arm.name, ...runArm(arm, fixtureDir) });
      } catch (error) {
        results.push({ name: arm.name, summary: "crashed", problems: [`arm threw: ${error instanceof Error ? error.message : String(error)}`] });
      }
    });
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
  results.forEach((result: NamedArmResult, index: number): void => {
    say(`arm ${index + 1}/${ARMS.length} ${result.name}: ${result.summary} — ${result.problems.length === 0 ? "PASS" : `FAIL (${result.problems.join("; ")})`}`);
  });
  /** Number of arms that reported at least one problem. */
  const failed: number = results.filter((result: NamedArmResult): boolean => result.problems.length > 0).length;
  /** Whether every arm passed; the only condition for exit 0. */
  const ok: boolean = failed === 0;
  say(`self-test ${ok ? "PASS" : "FAIL"}: ${ok ? results.length : failed}/${ARMS.length} arms`);
  return ok ? 0 : 1;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

/** Print the usage block and the exit-code contract. */
function usage(): void {
  say("usage node ./scripts/verify-manual-paths.ts [--manual <path>] [--root <dir>]");
  say("      node ./scripts/verify-manual-paths.ts --self-test");
  say("      node ./scripts/verify-manual-paths.ts --no-anticipatory   (test hook: runs with the DECLARED anticipatory class EMPTIED — it can only remove an exemption, never add one; proven by the anticipatory-removed-fails arm)");
  say("      node ./scripts/verify-manual-paths.ts --help");
  say("exit  0 every audited path resolves | 1 any unresolved path or a DEGRADED zero-subject run | 2 cannot run");
}

/** CLI entry point: parse flags, run the audit and return the process exit code. */
function main(argv: string[]): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return 0;
  }
  if (argv.includes("--self-test")) return selfTest();

  /** Root under audit; `--root` overrides the repo root derived from this script. */
  let root: string = resolve(HERE, "..");
  /** Manual given by `--manual`, or null to default to `<root>/AGENTS.md`. */
  let manual: string | null = null;
  /** Declared anticipatory class for this run; `--no-anticipatory` empties it. */
  let anticipatory: ReadonlyMap<string, string> = ANTICIPATORY_PATHS;
  for (let i = 0; i < argv.length; i += 1) {
    /** The flag being parsed at position `i`. */
    const flag: string = argv[i];
    if (flag === "--no-anticipatory") {
      // Test hook only: EMPTIES the declared class so the removal arm proves a declared mention fails
      // again. It can only remove an exemption, so it cannot widen the matcher in any reading.
      anticipatory = new Map<string, string>();
      continue;
    }
    if (flag === "--root" || flag === "--manual") {
      /** The value the flag expects at the next position. */
      const value: string | undefined = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        oops(`cannot-run ${flag} needs a value`);
        return 2;
      }
      if (flag === "--root") root = resolve(value);
      else manual = resolve(value);
      i += 1;
      continue;
    }
    oops(`cannot-run unknown flag ${flag}`);
    return 2;
  }
  /** The manual this run audits: the explicit `--manual`, else `<root>/AGENTS.md`. */
  const manualPath: string = manual ?? join(root, "AGENTS.md");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    oops(`cannot-run root not found or not a directory: ${root}`);
    return 2;
  }
  if (!existsSync(manualPath)) {
    oops(`cannot-run manual not found: ${manualPath}`);
    return 2;
  }
  /** The completed audit report; the catch below returns before this is read. */
  let report: AuditReport;
  try {
    report = audit({ manualPath, root, anticipatory });
  } catch (error) {
    oops(`cannot-run the manual could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  render(report);
  return reportExit(report);
}

process.exitCode = main(process.argv.slice(2));
