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
//   node ./scripts/verify-manual-paths.mjs [--manual <path>] [--root <dir>]
//   node ./scripts/verify-manual-paths.mjs --self-test
//   node ./scripts/verify-manual-paths.mjs --help
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

const TAG = "[verify-manual-paths]";
const SELF = fileURLToPath(import.meta.url);
const HERE = dirname(SELF);

// An audited token is only ever a REPO-RELATIVE spelling; these reasons describe why a shape cannot
// be audited. Keys are stable (they are the second half of the bucket name and are parsed by the
// self-test), values are the human reason printed beside every bucket.
const OVER_REASONS = new Map([
  ["url", "contains `://` — a URL, not a repo path"],
  ["fragment", "contains whitespace — a sentence or command fragment, not one path"],
  ["trailing", "ends with punctuation — a bound-token fragment, not a path target"],
  ["npm", "starts with `@` — an npm package name, not a repo path"],
  ["notRoot", "first segment is not an entry at the repo root — a slug, route, branch, tool name or package-relative spelling, not a repo path"],
  ["bare", "a bare file name with no directory component and not a root file this repo is expected to carry"],
]);
const UNDER_REASONS = new Map([
  ["glob", "a glob pattern — there is no single file to stat"],
  ["home", "home-relative (`~`) — it resolves in the user's HOME, not in the repo"],
  ["absolute", "absolute (`/`) — it is outside the repo root"],
  ["outside", "escapes the repo root (`../`) — it is outside the repo root"],
  ["placeholder", "carries a placeholder (`<name>`, `$VAR`, `{a,b}`) — not a literal path"],
  ["elided", "contains an elision mark — the path is not written out, so no literal target exists"],
  ["prose", "a directory spelled in words rather than as a token — nothing to stat"],
]);

// Census order is fixed so every run prints every bucket, including the empty ones.
const BUCKETS = [
  { name: "resolved", direction: "audited", reason: "audited: the path exists at the repo root" },
  { name: "unresolved", direction: "audited", reason: "audited: the path does NOT exist at the repo root" },
  // The DECLARED anticipatory class and its rot guard (see ANTICIPATORY_PATHS above): a named, reasoned
  // class with its own `declared` direction, counted apart from the audited subjects and from unresolved
  // — the same shape the docs gate uses for its own anticipatory entries.
  { name: "anticipatory", direction: "declared", reason: "DECLARED anticipatory class: the manual names it, the repository keeps it by design and deliberately does NOT create it (AGENTS.md §3) — printed with its count so an exemption for a file that does not exist can never rot silently" },
  { name: "declared-unreferenced", direction: "declared", reason: "ROT GUARD: a declared anticipatory path this manual no longer names — reported here rather than dropped silently" },
  ...[...OVER_REASONS].map(([key, reason]) => ({ name: `over-report:${key}`, direction: "over-report", reason })),
  ...[...UNDER_REASONS].map(([key, reason]) => ({ name: `under-report:${key}`, direction: "under-report", reason })),
];
const BUCKET_NAMES = BUCKETS.map((b) => b.name);

// Root files the manual is EXPECTED to name. A bare file name (no directory component) is audited
// only when it is on this list or when it really exists at the root: the allowlist is what gives the
// audit teeth for a documented root file that disappeared, while a convention name that is merely
// mentioned (`AGENT.md` as the first-choice instruction file) stays a reported over-report instead of
// a false red.
const KNOWN_ROOT_FILES = new Set([
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
// for a file that does not exist can never rot silently." `scripts/verify-docs-parity.mjs` already
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
const ANTICIPATORY_PATHS = new Map([
  ["docs/adder4.md", "ANTICIPATORY — not a live path: kept by design (AGENTS.md §3), printed by `scripts/verify-docs-parity.mjs` as its own class, and deliberately not created yet"],
  ["docs/cnt8.md", "ANTICIPATORY — not a live path: kept by design (AGENTS.md §3), printed by `scripts/verify-docs-parity.mjs` as its own class, and deliberately not created yet"],
]);

const FILE_EXT_RE = /\.(?:md|markdown|mjs|cjs|js|jsx|json|jsonc|ya?ml|ts|tsx|mts|cts|sh|bash|py|txt|lock|css|html|toml)$/;
const PLACEHOLDER_RE = /[<>${}]/;
const NON_ASCII_RE = /[^\x20-\x7e]/;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}"']$/;
const CODE_SPAN_RE = /`([^`]+)`/g;
const PROSE_PATH_RE = /\.\.?\/[^\s"'`)\]}]+/g;
const PROSE_DIR_RE = /\b(?:the|a|an|this|that|every|any)\s+([A-Za-z][A-Za-z0-9._-]*)\s+(?:directory|dir|folder|tree)\b/g;

// Informational only (see tailMatches): the bases that host sub-projects whose files the manual
// often spells package-relatively.
const HOST_BASES = ["packages", "extensions", "skills", "presets", "templates", "tests"];

const say = (...parts) => console.log(`${TAG} ${parts.join(" ")}`);
const oops = (...parts) => console.error(`${TAG} ${parts.join(" ")}`);

const stripSlash = (token) => (token.endsWith("/") ? token.slice(0, -1) : token);

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

// CANDIDATE gate: is this token a path mention at all? Anything that fails here is not counted
// anywhere, by design (see the header's `candidate` clause).
function isCandidate(token, rootEntries) {
  const body = stripSlash(token);
  if (body === "") return false;
  if (body.includes("/")) return true;
  if (FILE_EXT_RE.test(body)) return true;
  if (rootEntries.has(body)) return true;
  return KNOWN_ROOT_FILES.has(body);
}

// One classification per occurrence. Returns exactly one of:
//   { kind: "audit", rel }            — stat <root>/<rel>
//   { kind: "over",  reason, detail } — rejected candidate (over-report side)
//   { kind: "under", reason, detail } — un-auditable path reference (under-report side)
//   { kind: "skip" }                  — not path-shaped (documented scope limit, counted nowhere)
function classify(occurrence, ctx) {
  const token = occurrence.token;
  const over = (reason, detail = "") => ({ kind: "over", reason, detail });
  const under = (reason, detail = "") => ({ kind: "under", reason, detail });

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

  const body = stripSlash(token);
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

  const rel = body.replace(/^\.\//, "");
  if (token.startsWith("./") || token.startsWith("../")) {
    const abs = resolve(ctx.root, rel);
    if (abs !== ctx.root && !abs.startsWith(ctx.root + sep)) return under("outside");
    return { kind: "audit", rel };
  }
  const first = body.split("/")[0];
  if (!ctx.rootEntries.has(first)) return over("notRoot", `first segment "${first}"`);
  return { kind: "audit", rel: body };
}

// Every occurrence this audit reads, deduplicated per (token, line) and ordered by manual position.
function extractOccurrences(text, ctx) {
  const found = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    for (const span of line.matchAll(CODE_SPAN_RE)) {
      const body = span[1];
      const at = span.index ?? 0;
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
    const prose = line.replace(CODE_SPAN_RE, " ");
    for (const hit of prose.matchAll(PROSE_PATH_RE)) {
      found.push({ token: hit[0], line: lineNo, at: hit.index ?? 0, source: "prose" });
    }
    for (const hit of prose.matchAll(PROSE_DIR_RE)) {
      const word = hit[1];
      if (ctx.rootEntries.has(word)) {
        found.push({ token: hit[0], line: lineNo, at: hit.index ?? 0, source: "prose-dir", word });
      }
    }
  }
  const seen = new Set();
  const unique = [];
  for (const occurrence of found) {
    const key = `${occurrence.token}\u0000${occurrence.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(occurrence);
  }
  unique.sort((a, b) => a.line - b.line || a.at - b.at);
  return unique;
}

// INFORMATIONAL ONLY — never changes a bucket and never changes the exit code. A root-relative
// spelling that misses at the root is often a package-relative one (`dist/index.js` for
// `packages/<pkg>/dist/index.js`); naming where the same tail DOES resolve is what turns the
// unresolved list into an actionable hand-off instead of a puzzle.
function tailMatches(root, rootEntries, rel) {
  try {
    const hits = [];
    for (const base of HOST_BASES) {
      if (!rootEntries.has(base)) continue;
      for (const child of readdirSync(join(root, base))) {
        if (child.startsWith(".")) continue;
        if (existsSync(join(root, base, child, rel))) hits.push(`${base}/${child}/${rel}`);
      }
    }
    if (hits.length === 0) return "";
    const head = hits.slice(0, 2).join(", ");
    return hits.length > 2 ? `${head}, +${hits.length - 2} more` : head;
  } catch {
    return "";
  }
}

function audit({ manualPath, root, anticipatory = ANTICIPATORY_PATHS }) {
  const text = readFileSync(manualPath, "utf8");
  const info = {
    manualPath,
    manualLabel: manualPath.startsWith(root + sep) ? manualPath.slice(root.length + 1) : manualPath,
    root,
    sha256: sha256(text),
    bytes: Buffer.byteLength(text),
    mtime: statSync(manualPath).mtime.toISOString(),
  };
  const rootEntries = new Set(readdirSync(root));
  const ctx = { root, rootEntries };
  const buckets = new Map(BUCKET_NAMES.map((name) => [name, []]));
  const referencedAnticipatory = new Set();
  for (const occurrence of extractOccurrences(text, ctx)) {
    const verdict = classify(occurrence, ctx);
    if (verdict.kind === "skip") continue;
    if (verdict.kind === "over") {
      buckets.get(`over-report:${verdict.reason}`).push({ ...occurrence, detail: verdict.detail });
      continue;
    }
    if (verdict.kind === "under") {
      buckets.get(`under-report:${verdict.reason}`).push({ ...occurrence, detail: verdict.detail });
      continue;
    }
    const exists = existsSync(join(root, verdict.rel));
    // The declared class is checked HERE — after the existence test, so it can only ever hold back a
    // mention of a path that really is absent, and only when the manual spells that exact rel path.
    if (!exists && anticipatory.has(verdict.rel)) {
      referencedAnticipatory.add(verdict.rel);
      buckets.get("anticipatory").push({ ...occurrence, rel: verdict.rel, detail: anticipatory.get(verdict.rel) });
      continue;
    }
    const detail = exists ? "" : tailMatches(root, rootEntries, verdict.rel);
    buckets.get(exists ? "resolved" : "unresolved").push({ ...occurrence, rel: verdict.rel, detail });
  }
  // ROT GUARD: a declared entry this manual no longer names is REPORTED, never dropped silently.
  for (const [rel] of anticipatory) {
    if (!referencedAnticipatory.has(rel)) {
      buckets.get("declared-unreferenced").push({ rel, line: "-", detail: "declared anticipatory, but this manual no longer names it — remove the declaration or restore the mention" });
    }
  }
  const count = (name) => buckets.get(name).length;
  const family = (direction) =>
    BUCKETS.filter((b) => b.direction === direction).reduce((sum, b) => sum + count(b.name), 0);
  return { info, buckets, count, family, subjects: count("resolved") + count("unresolved") };
}

function render(report) {
  const { info, buckets, count, family } = report;
  say(`manual ${info.manualPath}`);
  say(`root ${info.root}`);
  say(`manual-sha256 ${info.sha256} bytes=${info.bytes} mtime=${info.mtime}`);
  say("rule candidate=path-shaped token | position=code span or ./|../-prefixed prose | shape=no glob/tilde/url/whitespace/placeholder/trailing-punctuation | anchor=./|-literal else first segment must be a repo-root entry | existence=stat <root>/<token>");
  say(`subjects audited=${report.subjects} (resolved=${count("resolved")} unresolved=${count("unresolved")}); tokens that are not path-shaped are out of scope by the rule above and are counted nowhere`);
  for (const bucket of BUCKETS) {
    const entries = buckets.get(bucket.name);
    // One census line per bucket, always printed (empty buckets included): this is the block the
    // self-test parses, so the counts can never be folded together without the evidence noticing.
    say(`census bucket=${bucket.name} direction=${bucket.direction} count=${entries.length} reason="${bucket.reason}"`);
    for (const entry of entries) {
      const target = entry.rel ?? entry.token;
      const located = `${bucket.name} ${info.manualLabel}:${entry.line} -> ${target}`;
      say(entry.detail ? `${located} [${entry.detail}]` : located);
    }
  }
  say(`census family=over-report direction=over-report total=${family("over-report")} buckets=${[...OVER_REASONS].length} (counted apart from under-report and from unresolved)`);
  say(`census family=under-report direction=under-report total=${family("under-report")} buckets=${[...UNDER_REASONS].length} (counted apart from over-report and from unresolved)`);
  say(`census family=declared direction=declared total=${family("declared")} buckets=${BUCKETS.filter((b) => b.direction === "declared").length} (the DECLARED anticipatory class and its rot guard — counted apart from the audited subjects and from unresolved)`);
}

function reportExit(report) {
  const unresolved = report.buckets.get("unresolved");
  if (report.subjects === 0) {
    say(`DEGRADED zero auditable subjects: no path-shaped token was found in ${report.info.manualPath} — nothing was checked, so this run is NOT a pass`);
    say("FAIL degraded=zero-subjects");
    return 1;
  }
  if (unresolved.length > 0) {
    const named = unresolved.map((e) => `${e.rel} (${report.info.manualLabel}:${e.line})`).join(", ");
    say(`FAIL unresolved=${unresolved.length} — the manual names paths that do not exist at the repo root: ${named}`);
    return 1;
  }
  const unreferenced = report.count("declared-unreferenced");
  if (unreferenced > 0) {
    say(`NOTE declared-unreferenced=${unreferenced} — the repository DECLARES these anticipatory and this manual no longer names them: remove the declaration or restore the mention (a rot guard, deliberately not a failure)`);
  }
  say(`PASS resolved=${report.count("resolved")} over-report=${report.family("over-report")} under-report=${report.family("under-report")} declared=${report.count("anticipatory")} (every audited path exists; the DECLARED anticipatory class is named with its reason and counted apart; the two matcher-error directions above are reported, not merged)`);
  return 0;
}

// ── self-test: hermetic temp fixtures only, one child run per arm ────────────────────────────────

const ARMS = [
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

function parseCensus(output) {
  const counts = new Map();
  for (const line of output.split("\n")) {
    const hit = /census bucket=(\S+) direction=(\S+) count=(\d+)\b/.exec(line);
    if (hit) counts.set(hit[1], Number(hit[3]));
  }
  return counts;
}

function parseFamilies(output) {
  const totals = new Map();
  for (const line of output.split("\n")) {
    const hit = /census family=(\S+) direction=(\S+) total=(\d+)\b/.exec(line);
    if (hit) totals.set(hit[1], Number(hit[3]));
  }
  return totals;
}

function runArm(arm, fixtureDir) {
  const root = join(fixtureDir, arm.name);
  mkdirSync(root, { recursive: true });
  for (const dir of arm.dirs ?? []) mkdirSync(join(root, dir), { recursive: true });
  const manualPath = join(root, "AGENTS.md");
  writeFileSync(manualPath, arm.manual);
  for (const [rel, content] of Object.entries(arm.files ?? {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  const manualArg = arm.missingManual === true ? join(root, "does-not-exist.md") : manualPath;
  const child = spawnSync(process.execPath, [SELF, "--manual", manualArg, "--root", root, ...(arm.args ?? [])], { encoding: "utf8" });
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const problems = [];
  if (child.status !== arm.expect.exit) problems.push(`exit ${child.status}, want ${arm.expect.exit}`);
  const census = parseCensus(output);
  const families = parseFamilies(output);
  // A run that could not start (exit 2) produces no census by construction; every other arm must
  // print EVERY bucket separately, which is what proves the counts are never folded together.
  if (child.status !== 2) {
    for (const name of BUCKET_NAMES) {
      if (!census.has(name)) problems.push(`bucket ${name} was not printed separately`);
    }
    for (const [name, want] of Object.entries(arm.expect.buckets ?? {})) {
      const got = census.get(name);
      if (got !== want) problems.push(`bucket ${name}=${got ?? "missing"}, want ${want}`);
    }
    for (const [name, want] of Object.entries(arm.expect.family ?? {})) {
      const got = families.get(name);
      if (got !== want) problems.push(`family ${name}=${got ?? "missing"}, want ${want}`);
    }
  }
  for (const re of arm.mustContain ?? []) if (!re.test(output)) problems.push(`missing from output: ${re}`);
  for (const re of arm.mustNotContain ?? []) if (re.test(output)) problems.push(`unexpected in output: ${re}`);
  if (arm.missingManual !== true && !output.includes(manualArg)) {
    problems.push("the run did not audit the fixture manual");
  }
  const summary = [
    `exit=${child.status}/${arm.expect.exit}`,
    `resolved=${census.get("resolved") ?? "-"}`,
    `unresolved=${census.get("unresolved") ?? "-"}`,
    `over-report=${families.get("over-report") ?? "-"}`,
    `under-report=${families.get("under-report") ?? "-"}`,
    `declared=${census.get("anticipatory") ?? "-"}`,
  ].join(" ");
  return { problems, summary };
}

function selfTest() {
  const fixtureDir = mkdtempSync(join(tmpdir(), "verify-manual-paths-"));
  const repoRoot = resolve(HERE, "..");
  // The fixtures must never live inside the repo: an arm that did would write into the workspace and
  // stop being hermetic. This is reported as a FAILED self-test, never as a crash — the run must
  // always finish with the PASS/FAIL arm line below.
  const insideRepo = fixtureDir === repoRoot || fixtureDir.startsWith(repoRoot + sep);
  const results = [];
  try {
    if (insideRepo) say(`self-test fixtures must live outside the repo root, got ${fixtureDir}`);
    else say(`self-test fixtures ${fixtureDir} (temp only; nothing in the repo is written)`);
    ARMS.forEach((arm) => {
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
  results.forEach((result, index) => {
    say(`arm ${index + 1}/${ARMS.length} ${result.name}: ${result.summary} — ${result.problems.length === 0 ? "PASS" : `FAIL (${result.problems.join("; ")})`}`);
  });
  const failed = results.filter((result) => result.problems.length > 0).length;
  const ok = failed === 0;
  say(`self-test ${ok ? "PASS" : "FAIL"}: ${ok ? results.length : failed}/${ARMS.length} arms`);
  return ok ? 0 : 1;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function usage() {
  say("usage node ./scripts/verify-manual-paths.mjs [--manual <path>] [--root <dir>]");
  say("      node ./scripts/verify-manual-paths.mjs --self-test");
  say("      node ./scripts/verify-manual-paths.mjs --no-anticipatory   (test hook: runs with the DECLARED anticipatory class EMPTIED — it can only remove an exemption, never add one; proven by the anticipatory-removed-fails arm)");
  say("      node ./scripts/verify-manual-paths.mjs --help");
  say("exit  0 every audited path resolves | 1 any unresolved path or a DEGRADED zero-subject run | 2 cannot run");
}

function main(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
    return 0;
  }
  if (argv.includes("--self-test")) return selfTest();

  let root = resolve(HERE, "..");
  let manual = null;
  let anticipatory = ANTICIPATORY_PATHS;
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--no-anticipatory") {
      // Test hook only: EMPTIES the declared class so the removal arm proves a declared mention fails
      // again. It can only remove an exemption, so it cannot widen the matcher in any reading.
      anticipatory = new Map();
      continue;
    }
    if (flag === "--root" || flag === "--manual") {
      const value = argv[i + 1];
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
  const manualPath = manual ?? join(root, "AGENTS.md");
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    oops(`cannot-run root not found or not a directory: ${root}`);
    return 2;
  }
  if (!existsSync(manualPath)) {
    oops(`cannot-run manual not found: ${manualPath}`);
    return 2;
  }
  let report;
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
