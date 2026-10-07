#!/usr/bin/env node
// Repo gate: the bilingual documentation policy of AGENTS.md (Language policy section).
//
// WHY THIS EXISTS: the policy was previously unenforced — `scripts/pack-mpd.ts` COPIES each
// package's README pair without asserting anything, and the QA lanes only read single docs. This
// gate was promoted from the prototype written during the docs task
// (`evidence/tui/docs-completeness/20260915T153835Z/docs-parity.ts`, 87/87 on its five pairs).
//
// DISCOVERY (what a green run actually covers — stated so no reader over-reads it):
//   * the root `README.md` + `README.zh-CN.md`;
//   * EVERY `*.md` under `docs/` at ANY DEPTH (a recursive walk, so nesting cannot hide a pair),
//     with the AGENTS.md §3 process records exempted from the missing-twin rule;
//   * `extensions/**/README.md` at any depth, plus every `*.zh-CN.md` under `extensions/`; the other
//     `.md` files there (extension skills, personas) are ASSETS, not documentation, and are not
//     asked for a twin;
//   * `packages/*/README.md` + its zh twin. A package directory WITHOUT a README is a FAILURE unless
//     it is the one recorded exemption (`packages/mpd-mcp-shared`), so the census cannot stay green
//     while a package is undocumented.
//
// For every bilingual pair it asserts:
//   1. both files exist;
//   2. a switch link sits directly under the title and points at the twin;
//   3. the heading TREE (levels + order, fenced code excluded) is identical;
//   4. the zh-CN file actually carries CJK content (a copy-paste of the English file fails).
// It also runs the INVERSE scan: every `*.zh-CN.md` it discovers must have its non-zh twin; a
// zh-only document is reported as `zh-CN file has no EN twin` (an exempt path stays a reported
// exemption instead of a violation).
//
// It ALSO resolves the relative link TARGETS of the band it discovers (the class that hid the dead
// `architecture.md` links): `[x](./y.md)`, `![x](y.png)`, `../AGENTS.md`, a DIRECTORY target — each
// resolved from the LINKING file's own directory, and a ROOT-relative target (a leading `/`, e.g.
// `/docs/index.md`) resolved against the REPO ROOT with that leading slash stripped explicitly —
// never the filesystem root (t5-F1) — with a `#fragment` stripped, while external
// (`http(s):`, `mailto:`, `tel:`, `data:`, `//host`), in-page anchors, empty targets and text inside
// fenced blocks / inline code spans are IGNORED. Why this row exists: until it landed, the only link
// logic in this file was `switchLinkUnderTitle` — a SPELLING test against the twin's basename that
// never captured a path and never asserted a target — so two rounds of dead links to the retired
// `docs/architecture.md` passed this gate GREEN and were found only by hand-written per-lane sweeps
// (`evidence/docs-overhaul/SUMMARY.md`, "Problems found and fixed" row 3). Two bounds reuse existing
// machinery instead of a new mode flag: the T-75 discriminator (no `AGENTS.md` at the root = a
// packed/partial copy, where an unresolved target is a NOTE, never a failure) and `EXEMPT_PROVENANCE`
// (a file kept VERBATIM is never link-policed — an absent target there is reported as EXEMPT
// PROVENANCE, never as a pass and never as a violation, which is what keeps today's tree green: the
// adopted upstream README holds the band's only dead relative links, upstream repository paths that
// were deliberately not vendored).
//
// It ALSO checks the hand-carried DERIVED values (T-75): the delta-table pointer in the manual
// (`AGENTS.md`) AND in the on-demand index that repeats it (`agent-references/index.md`), plus the
// registry's own region/file count statement, are compared against the value the ARTIFACT derives
// — the transcription table for the range, the GENERATED
// `lib/mpd-deltas.ts` registry (corroborated by the live `//#region mpd-delta` markers) for the
// counts. The measured defect: `t39` moved the pointer `A1–D26 → A1–D38`, a later §6 rewrite
// restored the pre-`t39` text, and this gate was GREEN on both revisions — a stale snapshot
// silently reverted a delivered fix, and only reading the file caught it (wave-1 `L78`). The
// artifact wins, never the newer pointer; a site whose claim is GONE is a violation, not a
// silent pass.
//
// EXEMPTION BOOKKEEPING (why the count can exceed what is live here): of the entries in
// `EXEMPT_LONE_FILES`, THIRTEEN correspond to files that exist in this tree today; `docs/adder4.md`
// and `docs/cnt8.md` are ANTICIPATORY entries kept BY DESIGN (t39, 2026-09-17): the manual no longer
// names them as examples — it named two paths that do not exist in this tree, and that stale citation
// was removed from BOTH ends in one change. This list is now their single source: a future addition of
// either file is exempted by design rather than by accident, and the census is unchanged. The run prints every exemption with its reason, so the count is never
// read as "N live paths" without the reasons beside it.
//
// Usage:
//   node scripts/verify-docs-parity.ts [--root <dir>] [--json <path>]
//   node scripts/verify-docs-parity.ts --self-test
//
// Exit: 0 when every checked pair passes and no violation is reported (exemptions are printed,
// never silent), 1 otherwise.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This script's own directory (`<root>/scripts`), derived from its module URL. */
const HERE = dirname(fileURLToPath(import.meta.url));

// ── T-30: lone-file exemptions are DERIVED from the file itself ───────────────────────────────
// An exemption means ONLY that a missing zh twin is not a violation; it never suppresses the checks
// for a pair that exists (an exempt file that GAINS a zh-CN twin is checked like any other pair and
// must then satisfy all four rules). Two derived sources replaced the hand-maintained per-file map:
//   * the IN-FILE MARKER `<!-- docs-parity: exempt <reason> -->` — any `*.md` carrying it is
//     reported with the marker's OWN reason, so a new historical doc is exempted WITHOUT editing
//     this gate, and the same doc without the marker is a normal policed file (T-30's observable);
//   * a declared PATTERN table for the classes the AGENTS.md §3 policy names BY GLOB (the plan
//     files) — a policy shape, not a per-file list.
// The two ANTICIPATORY paths are kept by design and PRINTED as their own class: they do not exist
// in this tree, an anticipatory exemption can rot silently, and silence is the failure this row
// removes (t39 recorded them; retiring them is a captain decision, not a silent drop).
const EXEMPT_MARKER = /<!--\s*docs-parity:\s*exempt\s+([^>]*?)\s*-->/;

/** One declared exemption class: the path SHAPE the AGENTS.md §3 policy names by glob, and its reason. */
interface ExemptPattern {
  /** The repository-relative path shape this class exempts, anchored at both ends. */
  pattern: RegExp;
  /** The policy reason printed for every path the pattern matches, never a bare exemption. */
  reason: string;
}

/** The classes the AGENTS.md §3 policy names BY GLOB, so a policy shape is not a per-file list. */
const EXEMPT_PATTERNS: readonly ExemptPattern[] = [{ pattern: /^docs\/plan-[^/]+\.md$/, reason: "process record (AGENTS.md §3: plan-*.md)" }];
/** Paths exempted by DESIGN although they do not exist yet, each with the reason to print for it. */
const ANTICIPATORY_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  ["docs/adder4.md", "internal QA/golden reference — ANTICIPATORY by design: the file does not exist in this tree yet; t39 removed the stale citation from both ends and this list is the single source"],
  ["docs/cnt8.md", "internal QA/golden reference — ANTICIPATORY by design: the file does not exist in this tree yet; t39 removed the stale citation from both ends and this list is the single source"],
]);
/** Package directories allowed to ship without a README, each with its recorded policy reason. */
const EXEMPT_WITHOUT_README: ReadonlyMap<string, string> = new Map([
  ["packages/mpd-mcp-shared", "ships source and tests only; its README pair is a recorded follow-up"],
]);
// A third, deliberately tiny source: files whose BYTES must stay verbatim, so the in-file marker
// cannot be added without destroying the property that earns the exemption.
//
// VACUOUS AS OF THE DE-VENDOR WAVE, AND NAMED SO RATHER THAN QUIETLY KEPT ALIVE: this map used to
// carry exactly one entry, `packages/mpd-agent-teams-plugin/README.md`, the adopted upstream
// README kept byte-verbatim as provenance. That package is DELETED (the whole 768-file body), and
// the adopted agent-teams attribution now lives in `LICENSE-NOTICES.md` and in
// `packages/mpd-bundle-plugin/adopted/` — neither of which is a `.md` file inside this gate's
// discovery band, so no live file can earn this exemption. The MECHANISM is kept (the three call
// sites below are one lookup each, and a future verbatim third-party doc is a one-line re-entry),
// and the self-test asserts the two directions of the REMOVAL instead: a dead link in a file at
// the retired path now reddens like any other, exactly as it would for a file that never existed.
/** Files kept byte-verbatim as provenance, which therefore cannot carry an in-file marker. */
const EXEMPT_PROVENANCE: ReadonlyMap<string, string> = new Map<string, string>();
/** The reason carried by the file's in-file exemption marker, or `undefined` when it carries none. */
const markerExemption = (text: string | null): string | undefined => {
  /** The marker's captured reason group, or `null` when the text carries no marker at all. */
  const match = EXEMPT_MARKER.exec(text ?? "");
  return match === null ? undefined : match[1];
};
/** The reason of the first declared pattern `rel` matches, or `undefined` when no class covers it. */
const patternExemption = (rel: string): string | undefined => EXEMPT_PATTERNS.find((entry: ExemptPattern): boolean => entry.pattern.test(rel))?.reason;
/** Whether a missing zh twin is NOT a violation for `rel` — any one of the three derived sources. */
const isExemptLone = (rel: string, text: string | null): boolean => patternExemption(rel) !== undefined || markerExemption(text) !== undefined || EXEMPT_PROVENANCE.has(rel);
/** The reason to print for `rel`; every caller has established {@link isExemptLone} first. */
const exemptReason = (rel: string, text: string | null): string | undefined => patternExemption(rel) ?? markerExemption(text) ?? EXEMPT_PROVENANCE.get(rel);

// ── T-29: classification is DECLARED, never directory position alone ──────────────────────────
// Bands: `docs/**` (every *.md is a doc), `extensions/**` and `templates/**` (README.md files are
// docs, every other *.md is an ASSET — extension skills, personas, flow docs). The PROMOTION
// MARKER `<!-- docs-parity: doc -->` makes any *.md a doc wherever it lives, so a doc that lands in
// an asset band REDDENS instead of escaping (T-29's observable); the bands alone never promote.
// `templates/**` joined the discovery set with this row: the template README pair shipped UNPOLICED.
const DOC_MARKER = /<!--\s*docs-parity:\s*doc\s*-->/;
/** Whether `rel` is a document by its BAND: under `docs/`, or named `README.md` anywhere. */
const isDocByBand = (rel: string): boolean =>
  rel.startsWith("docs/") ||
  rel.split("/").at(-1) === "README.md";
/** Whether the file's text carries the promotion marker, which outranks the asset bands (T-29). */
const promotedByMarker = (text: string | null): boolean => DOC_MARKER.test(text ?? "");

/** The file's UTF-8 text, or `null` when it does not exist — callers branch on the `null`. */
const readIf = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);
/** Whether `text` carries, in its first eight lines under a title, a switch link to `twinBase`. */
const switchLinkUnderTitle = (text: string, twinBase: string): boolean => {
  /** The document head where the language switch must sit (the first eight lines). */
  const head = text.split("\n").slice(0, 8).join("\n");
  if (!/^#\s+\S/m.test(head)) return false;
  return new RegExp(`\\]\\((?:\\./)?${twinBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`).test(head);
};
/** The heading LEVELS of `text` in document order, with fenced code blocks excluded. */
const headingTree = (text: string): number[] => {
  /** The heading levels collected so far. */
  const out: number[] = [];
  /** Whether the scan currently sits inside a fenced code block. */
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    /** The ATX heading match of this line, when the line is a heading. */
    const match = /^(#{1,6})\s+\S/.exec(line);
    if (match !== null) out.push(match[1].length);
  }
  return out;
};
/** Whether `text` carries at least one CJK character — the copy-paste control for a zh file. */
const hasCjk = (text: string): boolean => /[\u3400-\u4dbf\u4e00-\u9fff]/.test(text);

// ── T-75: hand-carried DERIVED values must equal the artifact-derived ones ────────────────────
// Wave 1's measured instance: `t39` moved the manual's delta-table pointer `A1–D26 → A1–D38`
// (hash chain 1eac90f4… → 54b6f31e… → 24b4490e…); a LATER §6 rewrite restored the pre-`t39` text,
// and this gate was GREEN on both revisions — the revert was found only by reading the file
// (wave-1 journal row 223 / `L78`). The rules below make that class red again.
//
// DERIVATION SOURCES (which side is trusted, and how each is regenerated):
//   * the delta RANGE (`A1–D<n>`) — derived from the transcription table in
//     `agent-references/agent-teams-deltas.md`, the file the manual NAMES as "the authoritative …
//     adaptation table"; it grows by transcribing `evidence/wave2/adopted-tooling/result.json`
//     (`adaptation_list`) plus each wave's rows, never by copying another pointer.
//   * the region/file COUNTS — derived from `packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts`
//     (`MPD_DELTAS`), the registry GENERATED from the live `//#region mpd-delta` markers by
//     `node scripts/patch-agent-teams-fixes.ts --write-registry`, and CORROBORATED against those
//     markers as a printed READING. The registry is the AUTHORITY (the applier heals from it and
//     `--check` verifies it): a marker that is newer than the registry is a normal in-flight
//     state of an adopted-file edit, so registry-vs-file drift is REPORTED here and owned by the
//     applier's `--check`, never reddened by this gate.
// The artifact wins, never the newer pointer. An ABSENT site file (a packed-artifact root) is a
// reported note; a site whose claim is GONE is a violation, never a silent pass (zero-subject).
const MANUAL_REL = "AGENTS.md";
// The files that HAND-CARRY the delta-range pointer. `AGENTS.md` is the manual; the on-demand
// index repeats the claim in its table row, and it was the SECOND live instance of the class
// (`agent-references/index.md` still read `A1–D26` while the manual read the live `A1–D38` —
// wave-1 `L30`/D-5). A site file that is ABSENT from a root (the packed artifact ships no
// AGENTS.md) is a reported note; a site whose claim is gone is a violation.
/** Every file that hand-carries the delta-range pointer, checked independently of the others. */
const DELTA_RANGE_SITES: readonly string[] = ["AGENTS.md", "agent-references/index.md"];
/** The transcription table the delta range is DERIVED from (the artifact the pointer names). */
const DELTAS_DOC_REL = "agent-references/agent-teams-deltas.md";
/** The GENERATED registry the region/file counts are derived from; vendored JavaScript by design. */
const REGISTRY_REL = "packages/mpd-agent-teams-plugin/lib/mpd-deltas.ts";
/** Finds every hand-carried `A1–D<n>` pointer and captures its numeric tail. */
const DELTA_RANGE_LITERAL = /A1\s*[\u2013\u2014-]\s*D(\d+)/g;
/** Finds the hand-carried `The live registry is **N** regions across **M** adopted files` sentence. */
const REGION_COUNT_CLAIM = /The live registry is \*\*(\d+)\*\* regions across \*\*(\d+)\*\* adopted files/;
/** Normalizes every dash variant to an en dash, so pointer comparison ignores dash spelling. */
const normalizeDash = (text: string): string => text.replace(/[\u2013\u2014-]/g, "\u2013");
/** Sort key of one delta id: letter block first, then the numeric tail (`A1` sorts before `D38`). */
const idRank = (id: string): number => "ABCD".indexOf(id[0]) * 100000 + Number(id.slice(1));

/** The derived delta range, or the reason the transcription table could not be read. */
type DeltaRange =
  | {
      /** The range WAS derived from the artifact. */
      ok: true;
      /** Lowest delta id in the table. */
      first: string;
      /** Highest delta id in the table. */
      last: string;
      /** The normalized `first–last` spelling every hand-carried pointer must carry. */
      text: string;
      /** How many table ids were parsed — the zero-subject guard's subject count. */
      ids: number;
    }
  | {
      /** The artifact was absent, unreadable, or held no table rows. */
      ok: false;
      /** Why derivation failed, printed inside the violation detail. */
      reason: string;
    };

/** The delta-id span the registry's transcription table covers, e.g. `A1–D38`. */
export function deriveDeltaRange(root: string): DeltaRange {
  /** The transcription table's text, or `null` when this root does not ship it. */
  const doc = readIf(join(root, DELTAS_DOC_REL));
  if (doc === null) return { ok: false, reason: `${DELTAS_DOC_REL} is absent — the artifact the pointer NAMES cannot be read` };
  /** Every delta id named by a table row, including BOTH ends of a range row. */
  const ids: string[] = [];
  for (const match of doc.matchAll(/^\|\s*([A-D]\d+)(?:\s*[\u2013\u2014-]\s*([A-D]\d+))?\s*\|/gm)) {
    ids.push(match[1]);
    // The range end is an OPTIONAL capture group: the runtime value really is `undefined` for a
    // single-id row, so it is declared as such instead of trusting the `RegExpExecArray` typing.
    /** The row's range end, or `undefined` when the row names a single delta id. */
    const rangeEnd: string | undefined = match[2];
    if (rangeEnd !== undefined) ids.push(rangeEnd);
  }
  if (ids.length === 0) return { ok: false, reason: `no delta-table rows parsed from ${DELTAS_DOC_REL} (zero-subject: refusing to derive nothing)` };
  ids.sort((a: string, b: string): number => idRank(a) - idRank(b));
  return { ok: true, first: ids[0], last: ids[ids.length - 1], text: normalizeDash(`${ids[0]}\u2013${ids[ids.length - 1]}`), ids: ids.length };
}

/** One open `//#region mpd-delta` marker, held on the stack until its OWN end marker appears. */
interface OpenRegion {
  /** The region id the begin marker declared. */
  id: string;
  /** 1-based line of the begin marker, so a mismatch can name where it was opened. */
  line: number;
}

/** The region ids one file carries plus every structural problem seen while pairing them. */
interface RegionScan {
  /** Every begin marker's id in file order (a nested region counts as its own). */
  ids: string[];
  /** Mismatched, orphan and unclosed markers plus duplicate ids, as ready-to-print strings. */
  problems: string[];
}

/**
 * T-57: every region id ONE FILE carries, pairing each begin with ITS OWN end (a STACK), so a
 * region NESTED inside another region's span counts as its OWN region. The earlier walk took the
 * FIRST matching end marker as a region's end and skipped the whole span, so a file carrying three
 * markers counted as two and this corroboration printed a FALSE agreement while a real nested
 * region existed (t44-F1: the registry held 119 ids while this helper reported agreement).
 * A mismatched end, an orphan end, an unclosed begin or a duplicate in-file id is REPORTED, never
 * silently counted around.
 */
function liveRegionIds(rel: string, fileText: string): RegionScan {
  /** The file's lines, so every problem can name its own 1-based position. */
  const lines = fileText.split("\n");
  /** Every region id seen, in file order. */
  const ids: string[] = [];
  /** The begin markers whose end marker has not been seen yet. */
  const stack: OpenRegion[] = [];
  /** Structural problems, printed verbatim by the caller. */
  const problems: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    /** The begin marker of this line, when the line is one. */
    const begin = /^\s*\/\/#region (mpd-delta [A-Za-z0-9-]+) \(/.exec(lines[at]);
    if (begin !== null) {
      ids.push(begin[1]);
      stack.push({ id: begin[1], line: at + 1 });
      continue;
    }
    /** The end marker of this line, when the line is one. */
    const end = /^\s*\/\/#endregion (mpd-delta [A-Za-z0-9-]+)\s*$/.exec(lines[at]);
    if (end === null) continue;
    if (stack.length === 0) {
      problems.push(`${rel}:${at + 1} closes ${end[1]} with no open region`);
      continue;
    }
    // The `stack.length === 0` guard above proves the stack is non-empty, so `pop` cannot yield
    // `undefined` here; the assertion states that invariant instead of widening every use below.
    /** The innermost open region this end marker closes. */
    const open = stack.pop()!;
    if (open.id !== end[1]) problems.push(`${rel}:${at + 1} closes ${end[1]} while ${open.id} (opened at :${open.line}) is still open`);
  }
  for (const open of stack) problems.push(`${rel}:${open.line} opens ${open.id} with no matching end marker`);
  /** Ids that appear more than once, deduplicated in first-seen order. */
  const duplicates = [...new Set(ids.filter((id: string, index: number): boolean => ids.indexOf(id) !== index))];
  if (duplicates.length > 0) problems.push(`${rel} carries duplicate region id(s): ${duplicates.join(", ")}`);
  return { ids, problems };
}

/** One adopted file's corroboration: the registry ids, the live marker ids and the difference. */
interface FileRegionReading {
  /** Repository-relative path of the adopted file. */
  file: string;
  /** How many region ids the registry records for this file. */
  registered: number;
  /** How many live `//#region mpd-delta` markers the file carries. */
  markers: number;
  /** The registry ids recorded for this file, in registry order. */
  registeredIds: string[];
  /** The live marker ids, in file order (nesting-aware, T-57). */
  liveIds: string[];
  /** Registered ids with no live marker — a stale registry entry. */
  onlyInRegistry: string[];
  /** Live ids the registry does not carry — a normal in-flight adopted-file edit. */
  onlyOnTree: string[];
}

/** The registry-derived region/file counts, corroborated per file, or why they cannot be derived. */
type RegistryCounts =
  | {
      /** The registry was parsed and every file it names was corroborated. */
      ok: true;
      /** Total region entries in `MPD_DELTAS`. */
      regions: number;
      /** Distinct adopted files the registry names. */
      files: number;
      /** Total live markers across those files — the printed READING, not the authority. */
      markers: number;
      /** Files whose registry ids and live ids disagree. */
      mismatched: FileRegionReading[];
      /** The per-file reading behind every total above. */
      perFile: FileRegionReading[];
    }
  | {
      /** The registry was absent, unparsable, or named a file this root lacks. */
      ok: false;
      /** Why derivation failed, printed inside the violation detail. */
      reason: string;
    };

/** The generated registry's region/file ids, corroborated PER FILE (ids, not just counts). */
function deriveRegistryCounts(root: string): RegistryCounts {
  /** The generated registry's text, or `null` when it is absent from this root. */
  const registry = readIf(join(root, REGISTRY_REL));
  if (registry === null) return { ok: false, reason: `${REGISTRY_REL} is absent — regenerate with: node scripts/patch-agent-teams-fixes.ts --write-registry` };
  /** The `file:` value of every generated row, in registry order. */
  const entries = [...registry.matchAll(/^ {8}file: "([^"]+)",$/gm)].map((match: RegExpExecArray): string => match[1]);
  /** The `id:` value of every generated row, positionally paired with {@link entries}. */
  const registryIds = [...registry.matchAll(/^ {8}id: "([^"]+)",$/gm)].map((match: RegExpExecArray): string => match[1]);
  if (entries.length === 0 || registryIds.length !== entries.length) {
    return { ok: false, reason: `no MPD_DELTAS entries parsed from ${REGISTRY_REL} (zero-subject: refusing to derive nothing)` };
  }
  /** The distinct adopted file paths the registry names. */
  const files = [...new Set(entries)];
  /** One corroboration record per distinct file, in first-seen order. */
  const perFile: FileRegionReading[] = [];
  for (const file of files) {
    /** The adopted file's live text, or `null` when the registry names a file this root lacks. */
    const text = readIf(join(root, file));
    if (text === null) return { ok: false, reason: `${file} is named by the registry but absent from this root — registry and tree cannot be corroborated` };
    /** This file's live marker ids and any structural problems that block corroboration. */
    const { ids: liveIds, problems } = liveRegionIds(file, text);
    if (problems.length > 0) return { ok: false, reason: `${file} cannot be corroborated: ${problems.join("; ")}` };
    /** The registry ids recorded for THIS file, positionally aligned with {@link entries}. */
    const registeredIds = registryIds.filter((id: string, index: number): boolean => entries[index] === file);
    /** Registered ids with no live marker (a stale registry entry). */
    const onlyInRegistry = registeredIds.filter((id: string): boolean => !liveIds.includes(id));
    /** Live ids the registry does not carry (an in-flight edit of the adopted file). */
    const onlyOnTree = liveIds.filter((id: string): boolean => !registeredIds.includes(id));
    perFile.push({ file, registered: registeredIds.length, markers: liveIds.length, registeredIds, liveIds, onlyInRegistry, onlyOnTree });
  }
  return {
    ok: true,
    regions: entries.length,
    files: files.length,
    markers: perFile.reduce((total: number, item: FileRegionReading): number => total + item.markers, 0),
    mismatched: perFile.filter((item: FileRegionReading): boolean => item.onlyInRegistry.length > 0 || item.onlyOnTree.length > 0),
    perFile,
  };
}

/** A reported note: the path it names and the reason it is a note and not a failure. */
interface Note {
  /** Repository-relative file path (or package directory) the note names. */
  path: string;
  /** The reason printed verbatim after `DERIVED:` / `LINK:` / `EXEMPT:`. */
  reason: string;
}

/** A gate violation: a stable id plus the detail line the report prints. */
interface Violation {
  /** Greppable id a consumer can branch on, and the `--json` key of the finding. */
  id: string;
  /** One-line explanation naming the file/value and the remedy. */
  detail: string;
}

/** The derived-value rules' outcome: what disagrees with the artifact, plus the readings printed. */
interface DerivedCheck {
  /** Every hand-carried value that disagrees with the artifact-derived one. */
  violations: Violation[];
  /** What was actually compared, so a green run is not read as "nothing checked". */
  notes: Note[];
}

/** Compare every HAND-CARRIED derived value against the artifact-derived one. */
function checkDerivedValues(root: string): DerivedCheck {
  /** Hand-carried values that disagree with the artifact. */
  const violations: Violation[] = [];
  /** The comparison readings printed for a run that stays green. */
  const notes: Note[] = [];
  /** The artifact-derived delta range every hand-carried pointer must spell. */
  const range = deriveDeltaRange(root);
  for (const site of DELTA_RANGE_SITES) {
    /** The site file's text, or `null` when this root does not ship it (a packed artifact). */
    const text = readIf(join(root, site));
    if (text === null) {
      notes.push({ path: site, reason: "site file not present in this root (packed artifact / partial copy) — delta-range claims skipped" });
      continue;
    }
    /** Every `A1–D<n>` pointer this site hand-carries. */
    const carried = [...text.matchAll(DELTA_RANGE_LITERAL)];
    if (!range.ok) {
      // AN ABSENT ARTIFACT IS A NOTE, NOT A VIOLATION — the same rule the region-count half below
      // already applied, and the inconsistency between the two halves was the bug. MEASURED
      // 2026-10-07 (de-vendor wave): `agent-references/agent-teams-deltas.md` was deleted WITH the
      // adopted body it documented, and the two sites that hand-carried its `A1–D<n>` pointer
      // (AGENTS.md and agent-references/index.md) then each reddened this gate for a claim that no
      // longer has an artifact to adjudicate against. A root that does not ship the artifact cannot
      // adjudicate ANY of these claims, so it reports them and moves on; the zero-subject guard
      // still fires in the direction that matters — an artifact that IS present with a site that
      // DROPPED its claim (the `missing-claim` violation below), and a site whose claim disagrees.
      notes.push({ path: site, reason: `delta-range claims NOT adjudicated (${range.reason}) — this root does not ship the artifact the pointer names, so the claim is neither confirmed nor contradicted here` });
      continue
    }
    if (carried.length === 0) {
      violations.push({ id: `derived-value:delta-range:${site}:missing-claim`, detail: `${site} carries NO "A1–D<n>" registry pointer while ${DELTAS_DOC_REL} derives "${range.text}" (zero-subject run: refusing to report PASS with nothing compared). If the pointer was deliberately removed, update this rule in the same change.` });
      continue;
    }
    for (const match of carried) {
      /** 1-based line of this pointer, so the violation can name where it sits. */
      const line = text.slice(0, match.index).split("\n").length;
      /** The pointer's normalized spelling, compared against the artifact-derived range. */
      const value = normalizeDash(match[0].replace(/\s+/g, ""));
      if (value === range.text) continue;
      violations.push({ id: `derived-value:delta-range:${site}:${line}`, detail: `${site}:${line} carries "${value}" but the ARTIFACT derives "${range.text}" (${range.ids} table ids in ${DELTAS_DOC_REL}, first ${range.first}, last ${range.last}) — the artifact wins, never the newer pointer (wave-1 L78); regenerate the range by transcribing the table` });
    }
    notes.push({ path: site, reason: `${carried.length} delta-range claim(s) ${[...new Set(carried.map((m: RegExpExecArray): string => normalizeDash(m[0].replace(/\s+/g, ""))))].join(", ")} checked against "${range.text}" derived from ${DELTAS_DOC_REL}` });
  }
  /** The deltas doc's text, or `null` when this root does not ship it. */
  const doc = readIf(join(root, DELTAS_DOC_REL));
  if (doc === null) {
    // THE RETIRED-ARTIFACT ABSENCE PATH, reported rather than silently skipped: the artifact AND the
    // registry it derived from were deleted together with the adopted body (de-vendor wave), so
    // neither the region-count claim nor its registry corroboration has a subject in this tree. The
    // line is emitted on EVERY run, which is what keeps the vacuity visible in the gate's own output
    // instead of only in a pull-request note.
    notes.push({ path: DELTAS_DOC_REL, reason: `region-count claim skipped AND its registry (${REGISTRY_REL}) is equally absent — both were deleted with the adopted agent-teams body (de-vendor wave), so the derived-value rule is VACUOUS in this root: it is exercised only by this script's --self-test fixtures, never by the live tree` });
  } else {
    /** The hand-carried count sentence, or `null` when the doc no longer states it. */
    const claim = REGION_COUNT_CLAIM.exec(doc);
    /** The registry-derived counts the sentence must equal. */
    const counts = deriveRegistryCounts(root);
    if (!counts.ok) {
      violations.push({ id: `derived-value:region-count:${DELTAS_DOC_REL}`, detail: `cannot adjudicate the region-count claim in ${DELTAS_DOC_REL}: ${counts.reason}` });
    } else if (claim === null) {
      violations.push({ id: `derived-value:region-count:${DELTAS_DOC_REL}:missing-claim`, detail: `${DELTAS_DOC_REL} no longer states "The live registry is **N** regions across **M** adopted files" while ${REGISTRY_REL} derives ${counts.regions} regions across ${counts.files} files (zero-subject run: refusing to report PASS with nothing compared). If the sentence was deliberately reworded, update this rule in the same change.` });
    } else {
      /** 1-based line of the hand-carried count sentence. */
      const line = doc.slice(0, claim.index).split("\n").length;
      if (Number(claim[1]) !== counts.regions || Number(claim[2]) !== counts.files) {
        violations.push({ id: `derived-value:region-count:${DELTAS_DOC_REL}:${line}`, detail: `${DELTAS_DOC_REL}:${line} claims **${claim[1]}** regions across **${claim[2]}** adopted files but ${REGISTRY_REL} derives ${counts.regions} regions across ${counts.files} files — the registry is the AUTHORITY (it is what the applier heals from; regenerate it with: node scripts/patch-agent-teams-fixes.ts --write-registry), so UPDATE THIS SENTENCE to the derived pair in the same change that moves the registry` });
      }
      // T-57: the corroboration is printed PER FILE with the ids it counted, so a region nested
      // inside another span surfaces as a NAMED mismatch instead of a bare "markers agree".
      /** The per-file reading, naming the ids behind every count (nesting-aware, T-57). */
      const perFileReading = counts.perFile
        .map((item: FileRegionReading): string => `${item.file}: registry ${item.registered} id(s), live ${item.markers} id(s)` + (item.onlyInRegistry.length > 0 || item.onlyOnTree.length > 0
          ? ` — MISMATCH (registered but not on the tree: [${item.onlyInRegistry.join(", ")}]; on the tree but unregistered: [${item.onlyOnTree.join(", ")}])`
          : " — agree"))
        .join("; ");
      notes.push({ path: DELTAS_DOC_REL, reason: `region-count claim checked: carried **${claim[1]}**/${claim[2]} vs derived ${counts.regions}/${counts.files} from ${REGISTRY_REL}; PER FILE (nesting-aware: every begin paired with its OWN end, T-57): ${perFileReading}` + (counts.mismatched.length === 0
        ? ""
        : ` — the mismatch is the applier's \`--check\` territory, not this gate's: an in-flight region edit is expected to be unregistered until --write-registry runs`) });
    }
  }
  return { violations, notes };
}

// ── link TARGET resolution ────────────────────────────────────────────────────────────────────
// The class this closes: two rounds of dead links to the retired `docs/architecture.md` passed this
// gate GREEN, because the only link logic here was `switchLinkUnderTitle` — a spelling test against
// the twin's basename that discards the matched group and never `stat`s a target. The scanner below
// reads the target OUT of every inline link/image and resolves it against the linking file's own
// directory. Decisions, so they are not re-litigated per link:
//   * RESOLVED: `./x`, bare `x`, `../x`, nested `a/b.md`, a `#fragment` (stripped before resolution;
//     the fragment itself is never checked in v1), an optional link title and the `<...>` form.
//   * A target that ESCAPES the band resolves against the whole tree root (`../AGENTS.md` is live),
//     and a ROOT-relative target (a leading `/`, e.g. `/docs/index.md`) resolves against the REPO
//     ROOT too — the leading slash is stripped explicitly, because passing it through would escape to
//     the FILESYSTEM root and report a target that exists in the tree as dead (t5-F1).
//     A DIRECTORY target counts as existing (`statSync` follows symlinks, so a DANGLING symlink
//     is dead — the intended strictness).
//   * IGNORED (counted, never resolved): absolute URLs of any scheme, protocol-relative `//host`,
//     pure in-page anchors, empty targets, and text inside fenced blocks or INLINE code spans — docs
//     carry copy-paste markdown templates that only LOOK like links.
//   * A duplicate (source, target) pair collapses into ONE violation, so `./docs/usage.md` twice in
//     one file cannot redden twice; the COUNTERS count OCCURRENCES (the occurrence-based profile the
//     t1 census uses too — it agrees with this scanner PER FILE; its headline total is understated,
//     see `evidence/process-fixes/gate-links.md` §9).
const LINK_INLINE = /!?\[[^\]\n]*\]\(\s*([^)]*?)\s*\)/g;
/** Matches an absolute URL scheme (`http:`, `mailto:`, …); such a target is never resolved. */
const LINK_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** One inline link/image occurrence: the target it names and the line it sits on. */
interface LinkTarget {
  /** The raw target, trimmed and title-stripped (`""` for a target that carries no path). */
  target: string;
  /** 1-based line of the occurrence, so a violation points at the link a reader must fix. */
  line: number;
}

/** Inline link/image targets of `text` with their 1-based line, minus fenced blocks and code spans. */
function linkTargets(text: string): LinkTarget[] {
  /** Every target found, in document order. */
  const out: LinkTarget[] = [];
  /** Whether the scan currently sits inside a fenced code block. */
  let fenced = false;
  /** The document's lines, scanned one by one. */
  const lines = text.split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    // The same fence tracker `headingTree` uses, so a link inside a fenced block is not a link.
    if (/^\s*(```|~~~)/.test(lines[at])) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of lines[at].replace(/`[^`]*`/g, "").matchAll(LINK_INLINE)) {
      /** The captured target text, trimmed of surrounding whitespace. */
      const raw = match[1].trim();
      /** The target with the optional `<...>` wrapper removed (the angle-bracket link form). */
      const untitled = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1).trim() : raw;
      // A title-only target `[x]( "t")` carries no path; it is the EMPTY class (ignored, counted).
      /** The path part of the target, or `""` for the empty/title-only class. */
      const target = untitled.startsWith('"') || untitled.startsWith("'") ? "" : (untitled.split(/\s+/)[0] ?? "");
      out.push({ target, line: at + 1 });
    }
  }
  return out;
}

/** A bilingual document pair: the English path and the zh-CN twin discovered for it. */
interface DocPair {
  /** Repository-relative path of the English document. */
  en: string;
  /** Repository-relative path of its zh-CN twin (which may not exist on disk). */
  zh: string;
}

/**
 * The FILES whose relative targets are resolved: the doc band this gate ALREADY discovers — both
 * halves of every discovered pair, PLUS every existing `*.md` it reports as a lone-file exemption
 * (the process records and the verbatim-provenance README). No new discovery: `agent-references/**`
 * stays out of this gate (T-28), and the anticipatory exemption paths are filtered by existence.
 */
function linkBand(root: string, pairs: readonly DocPair[], exemptNotes: readonly Note[]): string[] {
  /** The band, deduplicated because one pair can contribute the same file twice. */
  const band = new Set<string>();
  for (const { en, zh } of pairs) for (const rel of [en, zh]) if (rel.endsWith(".md") && existsSync(join(root, rel))) band.add(rel);
  for (const note of exemptNotes) if (note.path.endsWith(".md") && existsSync(join(root, note.path))) band.add(note.path);
  return [...band].sort();
}

/** The counters the report and `--json` expose; every occurrence lands in exactly one bucket. */
interface LinkCounters {
  /** Files in the resolved band. */
  files: number;
  /** Every inline link/image occurrence seen, including the IGNORED classes. */
  links: number;
  /** Occurrences that landed in one of the four checked buckets. */
  checked: number;
  /** Targets that resolved to an existing file or directory. */
  resolved: number;
  /** Targets that resolved to nothing (a violation in a full checkout). */
  dead: number;
  /** Dead targets inside an EXEMPT_PROVENANCE file (reported, never a violation). */
  skippedProvenance: number;
  /** Dead targets in a packed copy with no `AGENTS.md` (reported as notes). */
  absentSite: number;
  /** Absolute-URL and protocol-relative targets (ignored, never resolved). */
  external: number;
  /** In-page anchors and empty targets (ignored, never resolved). */
  anchorOnly: number;
}

/** The link-target check's outcome: violations, notes and the counters behind the summary line. */
interface LinkCheck {
  /** Dead targets that are violations (a full checkout only). */
  violations: Violation[];
  /** Absent targets reported as notes, plus the EXEMPT_PROVENANCE readings. */
  notes: Note[];
  /** The counters printed by `printReport` and stored by `--json`. */
  counters: LinkCounters;
}

/** Resolve every relative link target of the band; violations in a full checkout, notes when packed. */
function checkLinkTargets(root: string, band: readonly string[]): LinkCheck {
  /** Dead targets that are violations. */
  const violations: Violation[] = [];
  /** Notes for packed-copy skips and EXEMPT_PROVENANCE readings. */
  const notes: Note[] = [];
  /** Every counter the printed summary and `--json` expose. */
  const counters: LinkCounters = { files: band.length, links: 0, checked: 0, resolved: 0, dead: 0, skippedProvenance: 0, absentSite: 0, external: 0, anchorOnly: 0 };
  // T-75's discriminator, reused verbatim: a root WITHOUT the manual is the packed artifact (it ships
  // no `AGENTS.md` while `docs/index.md` links `../AGENTS.md`), so an unresolved target there is a
  // reported NOTE. The run stays honest — it neither invents failures nor silently skips the check.
  /** Whether this root is a packed/partial copy, where an unresolved target is a note. */
  const packedCopy = !existsSync(join(root, MANUAL_REL));
  /** `statSync` results cached per absolute target, so one target is probed only once. */
  const probed = new Map<string, boolean>();
  /** `(source, target)` keys already reported as violations, so a duplicate cannot redden twice. */
  const seenViolation = new Set<string>();
  /** `(source, target)` keys already reported as packed-copy notes. */
  const seenNote = new Set<string>();
  /** Dead targets per EXEMPT_PROVENANCE file, folded into one note per file. */
  const exemptAbsent = new Map<string, string[]>();
  for (const rel of band) {
    /** The linking file's text, or `null` when it vanished between discovery and this check. */
    const text = readIf(join(root, rel));
    if (text === null) continue;
    for (const { target, line } of linkTargets(text)) {
      counters.links += 1;
      if (target.startsWith("#")) {
        counters.anchorOnly += 1;
        continue;
      }
      if (target.startsWith("//") || LINK_SCHEME.test(target)) {
        counters.external += 1;
        continue;
      }
      /** The target without its `#fragment`; `""` is the anchor-only/empty class. */
      const filePart = target.split("#")[0];
      if (filePart === "") {
        counters.anchorOnly += 1;
        continue;
      }
      // A ROOT-relative target (a leading `/`) resolves against the REPO ROOT, never the filesystem
      // root: `resolve(root, dirname(rel), "/x")` escapes to `/x` and reports a target that EXISTS in
      // this tree as dead (t5-F1 measured exactly that: `[x](/docs/index.md)`). The normalization is
      // EXPLICIT — the leading slash is stripped before the join — not an existsSync retry, which
      // would also silently accept a genuinely wrong path.
      /** Whether the target is ROOT-relative, hence resolved against the repo root. */
      const rootRelative = filePart.startsWith("/");
      /** The target with any leading slashes stripped, so the join cannot escape the root. */
      const cleaned = rootRelative ? filePart.replace(/^\/+/, "") : filePart;
      /** The directory the target resolves from: the repo root, or the linking file's own dir. */
      const base = rootRelative ? root : dirname(rel);
      /** The absolute target path probed on disk. */
      const abs = resolve(root, base, cleaned);
      /** The cached probe result, or `undefined` when this target was not probed yet. */
      let exists = probed.get(abs);
      if (exists === undefined) {
        try {
          /** The target's stat, when the target exists (`statSync` follows symlinks). */
          const stat = statSync(abs);
          exists = stat.isFile() || stat.isDirectory();
        } catch {
          exists = false;
        }
        probed.set(abs, exists);
      }
      if (exists) {
        counters.resolved += 1;
        continue;
      }
      if (EXEMPT_PROVENANCE.has(rel)) {
        counters.skippedProvenance += 1;
        if (!exemptAbsent.has(rel)) exemptAbsent.set(rel, []);
        // The line above guarantees the key exists, so the lookup cannot be `undefined` here.
        exemptAbsent.get(rel)!.push(target);
        continue;
      }
      if (packedCopy) {
        counters.absentSite += 1;
        /** The `(source, target)` key that deduplicates this class's notes. */
        const key = `${rel}\u0000${target}`;
        if (seenNote.has(key)) continue;
        seenNote.add(key);
        notes.push({ path: rel, reason: `link-absent-site:${rel}:${target} — target not present in this root (packed artifact / partial copy); link target not resolved` });
        continue;
      }
      counters.dead += 1;
      /** The `(source, target)` key that deduplicates this class's violations. */
      const key = `${rel}\u0000${target}`;
      if (seenViolation.has(key)) continue;
      seenViolation.add(key);
      violations.push({
        id: `link-missing:${rel}:${target}`,
        detail: `${rel}:${line} links "${target}" but neither a file nor a directory exists at ${abs} — this gate resolves relative link TARGETS (two rounds of dead links to the retired docs/architecture.md passed it green BEFORE this row); fix the link or retire the target in the same change`,
      });
    }
  }
  for (const [rel, targets] of exemptAbsent) {
    notes.push({
      path: rel,
      reason: `EXEMPT_PROVENANCE (${EXEMPT_PROVENANCE.get(rel)}): ${targets.length} relative target(s) reported as EXEMPT PROVENANCE — never a pass and never a violation, because these bytes cannot change; no target exists in this root for: ${targets.join(", ")}`,
    });
  }
  // Invariants, stated so the counters cannot drift: every probed occurrence lands in exactly ONE of
  // the four buckets (resolved / dead / skippedProvenance / absentSite), and `links` additionally
  // counts the IGNORED classes. `checked` is what the design spec's self-test arms assert.
  counters.checked = counters.resolved + counters.dead + counters.skippedProvenance + counters.absentSite;
  return { violations, notes, counters };
}

/** Every FILE under `<root>/<dir>`, recursively (symlinks and dot/node_modules dirs skipped). */
function walkFiles(root: string, dir: string, out: string[] = []): string[] {
  /** The directory's entries; the catch returns immediately when it cannot be read. */
  let entries: Dirent[];
  try {
    entries = readdirSync(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    /** The entry's repository-relative path. */
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

/** What discovery produced: the policed pairs, the reported exemptions and discovery violations. */
interface Discovery {
  /** Every policed pair, in discovery order. */
  pairs: DocPair[];
  /** Every lone-file/package exemption reported with its reason. */
  exemptNotes: Note[];
  /** Violations discovery itself detected (an undocumented package, an inverse orphan). */
  violations: Violation[];
}

/** Discover the policed band: the root README pair, `docs/**`, the declared bands and each package. */
function discoverPairs(root: string): Discovery {
  /** The policed pairs. */
  const pairs: DocPair[] = [];
  /** The exemptions reported with their reasons. */
  const exemptNotes: Note[] = [];
  /** Violations found while discovering, before any pair is checked. */
  const violations: Violation[] = [];
  /** Every `*.zh-CN.md` seen, for the INVERSE scan at the end. */
  const inverse: string[] = [];
  /** Record one pair: the English path plus its zh-CN twin path (which may not exist yet). */
  const push = (en: string, zh: string): void => {
    pairs.push({ en, zh });
  };

  if (existsSync(join(root, "README.md"))) push("README.md", "README.zh-CN.md");
  if (existsSync(join(root, "README.zh-CN.md"))) inverse.push("README.zh-CN.md");

  // docs/**: every *.md is documentation, at any depth.
  for (const rel of walkFiles(root, "docs")) {
    if (!rel.endsWith(".md")) continue;
    if (rel.endsWith(".zh-CN.md")) {
      inverse.push(rel);
      continue;
    }
    /** The document's text, used for the in-file exemption marker. */
    const text = readIf(join(root, rel));
    /** The zh-CN path this document's twin would live at. */
    const twin = rel.replace(/\.md$/, ".zh-CN.md");
    if (!existsSync(join(root, twin)) && isExemptLone(rel, text)) {
      // The `isExemptLone` guard above guarantees one of the three sources yields a reason.
      exemptNotes.push({ path: rel, reason: exemptReason(rel, text)! });
      continue;
    }
    push(rel, twin);
  }

  // The declared bands: README.md files are docs, every other *.md is an ASSET (extension skills,
  // personas, flow docs) — UNLESS the file carries the promotion marker, which makes it a doc
  // wherever it lives (T-29: a misplaced doc reddens instead of escaping).
  for (const band of ["extensions", "templates"]) {
    for (const rel of walkFiles(root, band)) {
      if (!rel.endsWith(".md")) continue;
      if (rel.endsWith(".zh-CN.md")) {
        inverse.push(rel);
        continue;
      }
      /** The file's text, used for the promotion marker and the in-file exemption marker. */
      const text = readIf(join(root, rel));
      if (!isDocByBand(rel) && !promotedByMarker(text)) continue;
      /** The zh-CN path this document's twin would live at. */
      const twin = rel.replace(/\.md$/, ".zh-CN.md");
      if (!existsSync(join(root, twin)) && isExemptLone(rel, text)) {
        // The `isExemptLone` guard above guarantees one of the three sources yields a reason.
        exemptNotes.push({ path: rel, reason: exemptReason(rel, text)! });
        continue;
      }
      push(rel, twin);
    }
  }

  /** The package directory that holds one README pair per plugin. */
  const pkgs = join(root, "packages");
  if (existsSync(pkgs)) {
    for (const entry of readdirSync(pkgs, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      /** The package's README path inside the tree. */
      const rel = `packages/${entry.name}/README.md`;
      if (!existsSync(join(root, rel))) {
        if (EXEMPT_WITHOUT_README.has(`packages/${entry.name}`)) {
          // The `has` check above guarantees the map holds the key, so the lookup is defined.
          exemptNotes.push({ path: `packages/${entry.name}`, reason: EXEMPT_WITHOUT_README.get(`packages/${entry.name}`)! });
          continue;
        }
        // An undocumented package is a FAILURE, not a note: silence here is the class this gate closes.
        violations.push({ id: `package-no-readme:packages/${entry.name}`, detail: `package directory ${entry.name} has no README (not an exempt package)` });
        continue;
      }
      /** The README's text, used for the in-file exemption marker. */
      const text = readIf(join(root, rel));
      if (!existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`)) && isExemptLone(rel, text)) {
        // The `isExemptLone` guard above guarantees one of the three sources yields a reason.
        exemptNotes.push({ path: rel, reason: exemptReason(rel, text)! });
        continue;
      }
      push(rel, `packages/${entry.name}/README.zh-CN.md`);
      if (existsSync(join(root, `packages/${entry.name}/README.zh-CN.md`))) inverse.push(`packages/${entry.name}/README.zh-CN.md`);
    }
  }

  // The INVERSE scan: a zh-CN document whose EN twin does not exist.
  for (const zh of inverse) {
    /** The EN path this zh-CN document's twin would live at. */
    const en = zh.replace(/\.zh-CN\.md$/, ".md");
    if (existsSync(join(root, en))) continue;
    /** The (possibly absent) EN file's text, used for the in-file exemption marker. */
    const enText = readIf(join(root, en));
    if (isExemptLone(en, enText)) {
      exemptNotes.push({ path: en, reason: `${exemptReason(en, enText)} — its zh file exists, but an exempt record requires no EN twin` });
      continue;
    }
    violations.push({ id: `inverse:${zh}`, detail: `zh-CN file has no EN twin (${en} is missing)` });
  }

  // The ANTICIPATORY class is reported on its own: an exemption for a file that does not exist yet
  // can rot silently, so it is printed (and never counted as a live path).
  for (const [rel, reason] of ANTICIPATORY_EXEMPTIONS) {
    if (existsSync(join(root, rel))) continue;
    exemptNotes.push({ path: rel, reason: `${reason} [ANTICIPATORY — not a live path]` });
  }

  return { pairs, exemptNotes, violations };
}

/** One pair's verdict: the failure list a reader can act on, empty when the pair is conformant. */
interface PairSummary {
  /** Repository-relative English path of the pair (the pair's printed identity). */
  pair: string;
  /** Whether every rule passed for this pair. */
  ok: boolean;
  /** The rules this pair failed, in check order. */
  problems: string[];
}

/** One printed check line: a pair result or a violation, on the ONE report surface. */
interface Check {
  /** The pair path (or the violation id) the line is about. */
  pair: string;
  /** The check's own id, stable for a consumer that keys on it. */
  id: string;
  /** Whether the check passed; violations are recorded as `false`. */
  ok: boolean;
  /** The failure text, or `"ok"` for a passing pair. */
  detail: string;
}

/** The gate's full result: what `--json` stores and `printReport` renders. */
interface DocsParityResult {
  /** One summary per discovered pair. */
  pairs: PairSummary[];
  /** Every violation, from discovery, the derived-value rules and the link check. */
  violations: Violation[];
  /** Every printed check line. */
  checks: Check[];
  /** The reported lone-file/package exemptions. */
  exemptNotes: Note[];
  /** The derived-value readings. */
  derivedNotes: Note[];
  /** The link-check notes. */
  linkNotes: Note[];
  /** The link-check counters. */
  linkChecks: LinkCounters;
  /** Whether every pair passed and no violation was reported. */
  ok: boolean;
}

/** Check the bilingual pairs, the derived values and the link targets of `<root>`. */
export function verifyDocsParity(root: string): DocsParityResult {
  /** The discovered pairs, exemptions and discovery-time violations. */
  const { pairs, exemptNotes, violations } = discoverPairs(root);
  // T-75: the derived-value rules run AFTER discovery, so a mismatch lands in the SAME
  // `violations` surface the pair checks use (one red gate, one report).
  /** The derived-value findings, folded into the shared violation surface below. */
  const derived = checkDerivedValues(root);
  for (const violation of derived.violations) violations.push(violation);
  // The link-target check runs over the SAME band discovery produced, so a violation lands in the
  // one `violations` surface the pair checks and the derived-value rules use.
  /** The link-target findings, folded into the shared violation surface below. */
  const links = checkLinkTargets(root, linkBand(root, pairs, exemptNotes));
  for (const violation of links.violations) violations.push(violation);
  /** Every printed check line. */
  const checks: Check[] = [];
  /** Record one check line (a pair result or a violation) on the shared report surface. */
  const add = (pair: string, id: string, ok: boolean, detail: string): void => {
    checks.push({ pair, id, ok: Boolean(ok), detail: String(detail) });
  };
  /** One summary per pair, carrying its failure list. */
  const summaries: PairSummary[] = [];
  for (const { en, zh } of pairs) {
    /** The English file's text, or `null` when the file is missing. */
    const enText = readIf(join(root, en));
    /** The zh-CN file's text, or `null` when the file is missing. */
    const zhText = readIf(join(root, zh));
    /** The rules this pair failed, in check order. */
    const failed: string[] = [];
    if (enText === null) failed.push("missing EN file");
    if (zhText === null) failed.push("missing zh-CN file");
    if (enText !== null && zhText !== null) {
      // A discovered pair path always carries a basename, so `.at(-1)` is defined for both halves.
      /** The zh-CN basename, which the EN switch link must spell. */
      const zhBase = zh.split("/").at(-1)!;
      /** The English basename, which the zh switch link must spell. */
      const enBase = en.split("/").at(-1)!;
      if (!switchLinkUnderTitle(enText, zhBase)) failed.push("EN switch link missing/not under the title");
      if (!switchLinkUnderTitle(zhText, enBase)) failed.push("zh-CN switch link missing/not under the title");
      /** The English heading levels, in document order. */
      const a = headingTree(enText);
      /** The zh-CN heading levels, compared position by position against the English ones. */
      const b = headingTree(zhText);
      if (a.length !== b.length || a.some((level: number, index: number): boolean => level !== b[index]))
        failed.push(`heading tree differs: EN [${a.join(",")}] vs zh [${b.join(",")}]`);
      if (!hasCjk(zhText)) failed.push("zh-CN file carries no CJK content (copy-paste of the EN file?)");
    }
    add(en, `pair:${en}`, failed.length === 0, failed.length === 0 ? "ok" : failed.join("; "));
    summaries.push({ pair: en, ok: failed.length === 0, problems: failed });
  }
  for (const violation of violations) add(violation.id, violation.id, false, violation.detail);
  return {
    pairs: summaries,
    violations,
    checks,
    exemptNotes,
    derivedNotes: derived.notes,
    linkNotes: links.notes,
    linkChecks: links.counters,
    ok: summaries.every((s: PairSummary): boolean => s.ok) && violations.length === 0,
  };
}

/** Print the human report: pair lines, violations, exemptions, notes and the two summary lines. */
function printReport(result: DocsParityResult, root: string): void {
  for (const summary of result.pairs)
    console.log(`${summary.ok ? "ok  " : "FAIL"} ${summary.pair}${summary.ok ? "" : " — " + summary.problems.join("; ")}`);
  for (const violation of result.violations) console.log(`FAIL ${violation.id} — ${violation.detail}`);
  for (const note of result.exemptNotes) console.log(`skip ${note.path} — EXEMPT: ${note.reason}`);
  for (const note of result.derivedNotes ?? []) console.log(`note ${note.path} — DERIVED: ${note.reason}`);
  for (const note of result.linkNotes ?? []) console.log(`note ${note.path} — LINK: ${note.reason}`);
  /** The number of discovered pairs. */
  const pairs = result.pairs.length;
  /** Pairs that failed plus every violation: the headline failure count. */
  const failed = result.pairs.filter((s: PairSummary): boolean => !s.ok).length + result.violations.length;
  /** The link counters as printed; every field falls back to 0 so a missing counter prints `0`. */
  const links: Partial<LinkCounters> = result.linkChecks ?? {};
  console.log(
    `[verify-docs-parity] links=${links.links ?? 0} checked=${links.checked ?? 0} resolved=${links.resolved ?? 0} dead=${links.dead ?? 0} exemptProvenance=${links.skippedProvenance ?? 0} absentSite=${links.absentSite ?? 0} ignoredExternal=${links.external ?? 0} ignoredAnchorOnly=${links.anchorOnly ?? 0} files=${links.files ?? 0}`,
  );
  console.log(
    `\n[verify-docs-parity] root=${root} pairs=${pairs} failed=${failed} violations=${result.violations.length} exempt=${result.exemptNotes.length} derived=${(result.derivedNotes ?? []).length} links=${links.links ?? 0} dead=${links.dead ?? 0} — ${result.ok ? "PASS" : "FAIL"}`,
  );
}

/** One self-test arm: its printed name, its verdict and an optional reading. */
interface SelfTestCase {
  /** The arm's description, printed verbatim after `ok  ` / `FAIL`. */
  case: string;
  /** Whether the arm behaved as specified. */
  ok: boolean;
  /** The optional reading printed after the name (a counter dump, a violation id, …). */
  detail?: string;
}

/** One negative-control mutant: the arm name, the fixture file and the mutation to apply to it. */
type Mutant = readonly [name: string, rel: string, mutate: (text: string) => string];

/** The pair/exemption/link fixtures, each mutant restored after its own arm; the `--self-test` entry. */
function selfTest(): void {
  /** The throwaway root every fixture file is written under. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-docs-parity-selftest-"));
  /** Every arm's outcome, printed and counted at the end. */
  const cases: SelfTestCase[] = [];
  /** Write one fixture file under the sandbox, creating its parent directories. */
  const write = (rel: string, text: string): void => {
    /** The fixture file's absolute path. */
    const abs = join(sandbox, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  /** A conformant English fixture with the given title plus one extra marker line. */
  const good = (title: string, marker: string): string =>
    `# ${title}\n\n**English** | [中文](./X.zh-CN.md)\n\n${marker}\n\n## One\n\ntext\n\n### Deep\n\nmore\n\n## Two\n\nend\n`;
  /** A conformant zh-CN fixture with the given title; the caller patches its switch link target. */
  const zhGood = (title: string): string => `# ${title}\n\n[English](./X.md)\n\n正文\n\n## 一\n\n文本\n\n### 深\n\n更多\n\n## 二\n\n结束\n`;
  try {
    // 1. a clean fixture tree passes, including nested pairs and one non-doc asset.
    write("README.md", good("Root", "Hello").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("README.zh-CN.md", zhGood("根").replace("./X.md", "./README.md"));
    write("docs/guide.md", good("Guide", "Body").replace("./X.zh-CN.md", "./guide.zh-CN.md"));
    write("docs/guide.zh-CN.md", zhGood("指南").replace("./X.md", "./guide.md"));
    write("docs/guides/nested.md", good("Nested", "Body").replace("./X.zh-CN.md", "./nested.zh-CN.md"));
    write("docs/guides/nested.zh-CN.md", zhGood("嵌套").replace("./X.md", "./nested.md"));
    write("extensions/README.md", good("Ext", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/README.zh-CN.md", zhGood("扩展").replace("./X.md", "./README.md"));
    write("extensions/deep/README.md", good("DeepExt", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("extensions/deep/README.zh-CN.md", zhGood("深层扩展").replace("./X.md", "./README.md"));
    write("extensions/deep/skills/thing/SKILL.md", "# thing\n\nan asset, not a doc\n");
    write("packages/alpha/README.md", good("Alpha", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("packages/alpha/README.zh-CN.md", zhGood("甲").replace("./X.md", "./README.md"));
    // T-30 fixtures: the process records carry their OWN marker; the two ANTICIPATORY paths are
    // deliberately NOT created, because their exemption is for files that do not exist yet.
    write("docs/decisions.md", "<!-- docs-parity: exempt process record (AGENTS.md §3) -->\n# Decisions\n\nno twin needed\n");
    for (const rel of [
      "docs/plan-c.md", "docs/plan-d.md", "docs/plan-e.md", "docs/plan-f.md", "docs/plan-tui-edition.md",
    ])
      write(rel, `# ${rel}\n\nprocess record, no twin by policy (covered by the DECLARED plan-*.md pattern)\n`);
    for (const rel of [
      "docs/bline-report.md", "docs/omo-parity-gap.md", "docs/review-p0-p3.md", "docs/track-a-report.md",
      "docs/ulw-deepseek-optimization.md", "docs/tui-edition-report.md",
    ])
      write(rel, `<!-- docs-parity: exempt prior-phase report (AGENTS.md §3) -->\n# ${rel}\n\nprocess record, no twin by policy (IN-FILE marker)\n`);
    // T-29 fixtures: a POLICED template pair, a promoted misplaced doc, and an unmarked asset.
    write("templates/tpl/README.md", good("Tpl", "Body").replace("./X.zh-CN.md", "./README.zh-CN.md"));
    write("templates/tpl/README.zh-CN.md", zhGood("模板").replace("./X.md", "./README.md"));
    write("templates/tpl/notes/asset.md", "# Asset\n\nan asset, no twin demanded\n");
    write("packages/mpd-mcp-shared/src/index.ts", "export {}\n");
    // The retired provenance README is deliberately NOT written here any more: the de-vendor wave
    // deleted the file AND its exemption, and a clean fixture must not demonstrate a rule that no
    // longer exists. Arm 5 writes the path deliberately (in its own root) to prove it is policed.
    /** The clean-fixture verdict every later arm compares against. */
    const clean = verifyDocsParity(sandbox);
    cases.push({ case: "clean tree passes", ok: clean.ok, detail: `pairs=${clean.pairs.length} exempt=${clean.exemptNotes.length} violations=${clean.violations.length}` });

    // 1a. the RECURSIVE walk finds nested docs/ pairs and nested extensions/README pairs.
    /** The nested pair paths the recursive walk must have discovered. */
    const recursive = ["docs/guides/nested.md", "extensions/deep/README.md"].filter((rel: string): boolean => clean.pairs.some((p: PairSummary): boolean => p.pair === rel));
    cases.push({
      case: "recursive discovery: nested docs/ and extensions/ pairs are checked (nesting cannot hide a pair)",
      ok: recursive.length === 2,
      detail: `found: ${recursive.join(", ") || "(none)"}`,
    });
    // 1b. a non-README .md under extensions/ is an ASSET: no twin is demanded, so it is not a failure.
    cases.push({
      case: "an extensions ASSET (.md that is not a README) is not demanded a twin",
      ok: clean.ok && !clean.pairs.some((p: PairSummary): boolean => p.pair === "extensions/deep/skills/thing/SKILL.md"),
      detail: "extensions/deep/skills/thing/SKILL.md left out of the pair set",
    });

    /** The exemption paths every clean run must report with their reasons. */
    const expectedExempt = [
      ...["docs/plan-c.md", "docs/plan-d.md", "docs/plan-e.md", "docs/plan-f.md", "docs/plan-tui-edition.md",
        "docs/bline-report.md", "docs/omo-parity-gap.md", "docs/review-p0-p3.md", "docs/track-a-report.md",
        "docs/ulw-deepseek-optimization.md", "docs/adder4.md", "docs/cnt8.md", "docs/tui-edition-report.md",
        "docs/decisions.md", "packages/mpd-mcp-shared"],
    ];
    /** Declared exemption paths the clean run did NOT report; it must stay empty. */
    const missingExempt = expectedExempt.filter((rel: string): boolean => !clean.exemptNotes.some((n: Note): boolean => n.path === rel));
    cases.push({
      case: "EVERY documented exemption is asserted (reported with its reason, never a silent skip)",
      ok: missingExempt.length === 0,
      detail: missingExempt.length === 0 ? `${expectedExempt.length} exemption paths reported` : `missing: ${missingExempt.join(", ")}`,
    });

    // ── T-30 arms: the exemption is derived from the FILE ─────────────────────────────────────
    write("docs/from-1999.md", "<!-- docs-parity: exempt historical note (AGENTS.md §3) -->\n# From 1999\n\nold\n");
    /** The verdict with the in-file marker present. */
    const marked = verifyDocsParity(sandbox);
    cases.push({
      case: "T-30: a doc carrying the IN-FILE marker is exempt WITHOUT editing the gate",
      ok: marked.ok && marked.exemptNotes.some((n: Note): boolean => n.path === "docs/from-1999.md"),
      detail: JSON.stringify(marked.exemptNotes.find((n: Note): boolean => n.path === "docs/from-1999.md") ?? null),
    });
    write("docs/from-1999.md", "# From 1999\n\nold, and now WITHOUT the marker\n");
    /** The verdict for the SAME file without the marker (the negative control). */
    const unmarked = verifyDocsParity(sandbox);
    cases.push({
      case: "T-30 NEGATIVE: the SAME doc without the marker is a VIOLATION",
      ok: unmarked.ok === false && unmarked.pairs.some((p: PairSummary): boolean => p.pair === "docs/from-1999.md" && !p.ok),
      detail: JSON.stringify(unmarked.pairs.find((p: PairSummary): boolean => p.pair === "docs/from-1999.md") ?? null),
    });
    rmSync(join(sandbox, "docs/from-1999.md"), { force: true });
    /** The two anticipatory exemptions as the clean run reports them. */
    const anticipatory = clean.exemptNotes.filter((n: Note): boolean => n.path === "docs/adder4.md" || n.path === "docs/cnt8.md");
    cases.push({
      case: "T-30: the TWO ANTICIPATORY paths are reported as their OWN class (never silently dropped)",
      ok: anticipatory.length === 2 && anticipatory.every((n: Note): boolean => n.reason.includes("ANTICIPATORY")),
      detail: JSON.stringify(anticipatory),
    });

    // ── T-29 arms: classification is DECLARED, and a misplaced doc reddens ────────────────────
    cases.push({
      case: "T-29: templates/**/README.md pairs enter the discovery set as POLICED pairs",
      ok: clean.ok && clean.pairs.some((p: PairSummary): boolean => p.pair === "templates/tpl/README.md"),
      detail: `pairs=${clean.pairs.length}, template pair present=${clean.pairs.some((p: PairSummary): boolean => p.pair === "templates/tpl/README.md")}`,
    });
    cases.push({
      case: "T-29 NEG CONTROL: an UNMARKED non-README *.md under templates/ stays an ASSET",
      ok: clean.ok && !clean.pairs.some((p: PairSummary): boolean => p.pair === "templates/tpl/notes/asset.md"),
      detail: "templates/tpl/notes/asset.md left out of the pair set",
    });
    write("templates/tpl/notes/promoted.md", "<!-- docs-parity: doc -->\n# Promoted\n\na doc that landed in an ASSET band\n");
    /** The verdict with the promoted misplaced doc present. */
    const promoted = verifyDocsParity(sandbox);
    cases.push({
      case: "T-29 NEGATIVE: a misplaced doc carrying the PROMOTION marker REDDENS instead of escaping",
      ok: promoted.ok === false && promoted.pairs.some((p: PairSummary): boolean => p.pair === "templates/tpl/notes/promoted.md" && !p.ok),
      detail: JSON.stringify(promoted.pairs.find((p: PairSummary): boolean => p.pair === "templates/tpl/notes/promoted.md") ?? null),
    });
    rmSync(join(sandbox, "templates/tpl/notes/promoted.md"), { force: true });

    // 2. NEGATIVE CONTROLS — each mutant must fail the gate.
    /** The four mutants, each applied to one fixture and undone right after its arm. */
    const mutants: Mutant[] = [
      ["negative: missing switch link", "docs/guide.md", (t: string): string => t.replace("[中文](./guide.zh-CN.md)", "no link here")],
      ["negative: re-levelled heading", "docs/guide.zh-CN.md", (t: string): string => t.replace("## 二", "# 二")],
      ["negative: pure-ASCII zh file", "README.zh-CN.md", (): string => "# Root\n\n[English](./README.md)\n\nHello there\n\n## One\n\ntext\n\n### Deep\n\nmore\n\n## Two\n\nend\n"],
      ["negative: nested pair with a mis-pointed switch link", "docs/guides/nested.md", (t: string): string => t.replace("[中文](./nested.zh-CN.md)", "no link here")],
    ];
    for (const [name, rel, mutate] of mutants) {
      /** The fixture's bytes before mutation, restored after the arm. */
      const original = readFileSync(join(sandbox, rel), "utf8");
      writeFileSync(join(sandbox, rel), mutate(original));
      /** The gate's verdict on the mutant. */
      const result = verifyDocsParity(sandbox);
      cases.push({ case: name, ok: result.ok === false, detail: result.ok ? "gate still passed (WRONG)" : result.pairs.filter((p: PairSummary): boolean => !p.ok).map((p: PairSummary): string => `${p.pair}: ${p.problems.join("; ")}`).join(" | ") });
      writeFileSync(join(sandbox, rel), original);
    }

    // 3. an exempt file that GAINS a zh twin is checked like any other pair.
    write("docs/decisions.zh-CN.md", "# 决定\n\n[English](./decisions.md)\n\n正文\n\n## 一\n\ntext\n");
    /** The verdict where the newly twinned exempt file has a non-conformant twin. */
    const twins = verifyDocsParity(sandbox);
    cases.push({
      case: "exempt file gaining a zh twin is checked (its missing heading parity fails)",
      ok: twins.pairs.some((p: PairSummary): boolean => p.pair === "docs/decisions.md" && !p.ok),
      detail: JSON.stringify(twins.pairs.find((p: PairSummary): boolean => p.pair === "docs/decisions.md") ?? null),
    });
    /** The zh twin text that is conformant with the English fixture rewritten just below. */
    const withGoodTwin = `# 决定\n\n[English](./decisions.md)\n\n正文\n\n## 二\n\ntext\n`;
    write("docs/decisions.md", `# Decisions\n\n**English** | [中文](./decisions.zh-CN.md)\n\nBody\n\n## Two\n\ntext\n`);
    write("docs/decisions.zh-CN.md", withGoodTwin);
    /** The verdict where both halves of that pair are conformant. */
    const twins2 = verifyDocsParity(sandbox);
    cases.push({ case: "exempt file with a CONFORMANT twin passes", ok: twins2.pairs.some((p: PairSummary): boolean => p.pair === "docs/decisions.md" && p.ok) });

    // 4. the INVERSE scan: a zh-CN document with no EN twin is a violation.
    write("docs/orphan.zh-CN.md", "# 孤儿\n\n正文\n");
    /** The verdict with a zh-only orphan present. */
    const inverseBad = verifyDocsParity(sandbox);
    cases.push({
      case: "negative: a zh-CN file with no EN twin is a VIOLATION (inverse scan)",
      ok: inverseBad.ok === false && inverseBad.violations.some((v: Violation): boolean => v.id === "inverse:docs/orphan.zh-CN.md"),
      detail: JSON.stringify(inverseBad.violations),
    });
    // ...and the same path is a reported EXEMPTION when the missing EN twin is an exempt record.
    write("docs/plan-orphan.zh-CN.md", "# 计划\n\n正文\n");
    /** The verdict where the inverse orphan's EN path is an exempt record. */
    const inverseExempt = verifyDocsParity(sandbox);
    cases.push({
      case: "an inverse orphan whose EN path is an exempt record is reported as an exemption, not a violation",
      ok: inverseExempt.violations.every((v: Violation): boolean => v.id !== "inverse:docs/plan-orphan.zh-CN.md") && inverseExempt.exemptNotes.some((n: Note): boolean => n.path === "docs/plan-orphan.md"),
      detail: JSON.stringify(inverseExempt.exemptNotes.filter((n: Note): boolean => n.path === "docs/plan-orphan.md")),
    });

    // 5. a NON-exempt package without a README is a FAILURE; the exempt package stays a note.
    write("packages/silent/src/index.ts", "export {}\n");
    /** The verdict with an undocumented package in the tree. */
    const silent = verifyDocsParity(sandbox);
    cases.push({
      case: "negative: a non-exempt package directory without a README is a FAILURE",
      ok: silent.ok === false && silent.violations.some((v: Violation): boolean => v.id === "package-no-readme:packages/silent"),
      detail: JSON.stringify(silent.violations),
    });
    cases.push({
      case: "the exempt package (mpd-mcp-shared) is a reported note, not a violation",
      ok: silent.violations.every((v: Violation): boolean => !v.id.includes("mpd-mcp-shared")) && silent.exemptNotes.some((n: Note): boolean => n.path === "packages/mpd-mcp-shared"),
      detail: "packages/mpd-mcp-shared stays on the exemption list",
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  cases.push(...selfTestDerivedValues());
  cases.push(...selfTestLinks());
  for (const item of cases) console.log(`${item.ok ? "ok  " : "FAIL"} ${item.case}${item.detail ? " — " + item.detail : ""}`);
  /** Whether every arm passed; the exit code and the summary line both read it. */
  const ok = cases.every((c: SelfTestCase): boolean => c.ok);
  console.log(`\n[verify-docs-parity self-test] ${cases.filter((c: SelfTestCase): boolean => c.ok).length}/${cases.length} checks passed — ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

/**
 * T-75 arms: the POSITIVE arm (correct carried values pass and are reported) and the NEGATIVE
 * CONTROLS (the pre-`t39` pointer `A1–D26` and a stale region count each redden and NAME the
 * file/value), plus the zero-subject guard, the registry-vs-markers drift arm and the
 * absent-site (packed artifact) bound.
 */
function selfTestDerivedValues(): SelfTestCase[] {
  /** Every arm's outcome, returned to the caller for the shared summary line. */
  const cases: SelfTestCase[] = [];
  /** The throwaway root all fixture trees are written under. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-derived-values-selftest-"));
  /** Write one fixture file under a root, creating its parent directories. */
  const write = (root: string, rel: string, text: string): void => {
    /** The fixture file's absolute path. */
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  /** `count` live `//#region mpd-delta` marker blocks, in the VENDORED marker spelling. */
  const markers = (count: number): string =>
    Array.from(
      { length: count },
      (_: unknown, index: number): string =>
        `//#region mpd-delta fixture-${index} (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const fixture${index} = ${index};\n//#endregion mpd-delta fixture-${index}`,
    ).join("\n\n") + "\n";
  /** A generated-registry fixture naming one file per entry, with a matching `id:` per entry. */
  const registryText = (files: readonly string[]): string =>
    `export const MPD_DELTAS = [\n${files
      .map(
        (file: string, index: number): string =>
          `    {\n        file: "${file}",\n        id: "mpd-delta fixture-${index}",\n        beforeContext: [],\n        afterContext: [],\n        block: "",\n    },`,
      )
      .join("\n")}\n];\n`;
  /** A deltas-doc fixture with a two-row table and the hand-carried region/file count sentence. */
  const deltasDoc = (regions: number, files: number): string =>
    `# Adopted agent-teams delta registry\n\n| Id | File | Marker | Purpose |\n|---|---|---|---|\n| A1 | \`adopted/a.js\` | none | first |\n| D2 | \`adopted/a.js\` | \`mpd-delta fixture-0\` | second |\n| D7 | \`adopted/b.js\` | \`mpd-delta fixture-2\` | third |\n\nThe live registry is **${regions}** regions across **${files}** adopted files — the count MEASURED at this edit.\n`;
  /** Write the provenance README pair the registry's own path makes mandatory in a fixture. */
  const packageReadme = (root: string): void => {
    write(root, "packages/mpd-agent-teams-plugin/README.md", "# Fixture\n\n**English** | [中文](./README.zh-CN.md)\n\nBody\n\n## One\n\ntext\n");
    write(root, "packages/mpd-agent-teams-plugin/README.zh-CN.md", "# 夹具\n\n[English](./README.md)\n\n正文\n\n## 一\n\n文本\n");
  };
  /** The on-demand index fixture whose table row repeats the hand-carried delta-range pointer. */
  const indexDoc = (range: string): string =>
    `# agent-references — on-demand reference material\n\n| File | Holds |\n|---|---|\n| \`agent-teams-deltas.md\` | the adopted agent-teams delta registry — the ${range} table, registry mechanics |\n`;
  /** Rebuild a fixture tree from scratch: markers, registry, deltas doc, manual, index, README. */
  const seed = (root: string): void => {
    rmSync(root, { recursive: true, force: true });
    write(root, "adopted/a.js", markers(2));
    write(root, "adopted/b.js", markers(1));
    write(root, REGISTRY_REL, registryText(["adopted/a.js", "adopted/a.js", "adopted/b.js"]));
    write(root, DELTAS_DOC_REL, deltasDoc(3, 2));
    write(root, MANUAL_REL, "# Manual\n\nPointer: the authoritative A1–D7 adaptation table.\n");
    write(root, "agent-references/index.md", indexDoc("A1–D7"));
    packageReadme(root);
  };
  try {
    /** The fixture tree the arms mutate; `seed` rebuilds it between arms. */
    const tree = join(sandbox, "tree");
    seed(tree);
    /** The verdict on the correctly carried values. */
    const good = verifyDocsParity(tree);
    cases.push({
      case: "T-75 arm 1 (positive): the artifact-derived range and counts PASS and are REPORTED",
      ok:
        good.ok === true &&
        good.derivedNotes.length === 3 &&
        good.derivedNotes.some((note: Note): boolean => note.path === MANUAL_REL && note.reason.includes("A1\u2013D7")) &&
        good.derivedNotes.some((note: Note): boolean => note.path === "agent-references/index.md" && note.reason.includes("A1\u2013D7")) &&
        good.derivedNotes.some((note: Note): boolean => note.path === DELTAS_DOC_REL && note.reason.includes("3/2")),
      detail: JSON.stringify(good.derivedNotes),
    });

    write(tree, MANUAL_REL, "# Manual\n\nPointer: the authoritative A1–D26 adaptation table.\n");
    /** The verdict on the pre-`t39` pointer (the negative control). */
    const stalePointer = verifyDocsParity(tree);
    /** The delta-range violation the stale manual must produce. */
    const pointerFinding = stalePointer.violations.find((v: Violation): boolean => v.id.startsWith(`derived-value:delta-range:${MANUAL_REL}:`));
    cases.push({
      case: "T-75 arm 2 (NEGATIVE CONTROL): the pre-t39 pointer A1–D26 REDDENS and NAMES the file/value",
      ok:
        stalePointer.ok === false &&
        pointerFinding !== undefined &&
        pointerFinding.id === `derived-value:delta-range:${MANUAL_REL}:3` &&
        pointerFinding.detail.includes("A1\u2013D26") &&
        pointerFinding.detail.includes("A1\u2013D7"),
      detail: pointerFinding === undefined ? JSON.stringify(stalePointer.violations) : `${pointerFinding.id} — ${pointerFinding.detail}`,
    });

    seed(tree);
    write(tree, "agent-references/index.md", indexDoc("A1–D26"));
    /** The verdict on the stale INDEX pointer (the class's second live instance). */
    const staleIndex = verifyDocsParity(tree);
    /** The delta-range violation the stale index must produce. */
    const indexFinding = staleIndex.violations.find((v: Violation): boolean => v.id.startsWith("derived-value:delta-range:agent-references/index.md:"));
    cases.push({
      case: "T-75 arm 2b (NEGATIVE CONTROL, SECOND instance): the stale index pointer A1–D26 REDDENS and NAMES agent-references/index.md:5",
      ok:
        staleIndex.ok === false &&
        indexFinding !== undefined &&
        indexFinding.id === "derived-value:delta-range:agent-references/index.md:5" &&
        indexFinding.detail.includes("A1\u2013D26") &&
        indexFinding.detail.includes("A1\u2013D7"),
      detail: indexFinding === undefined ? JSON.stringify(staleIndex.violations) : `${indexFinding.id} — ${indexFinding.detail}`,
    });

    seed(tree);
    write(tree, DELTAS_DOC_REL, deltasDoc(65, 9));
    /** The verdict on the stale region/file count. */
    const staleCount = verifyDocsParity(tree);
    /** The region-count violation the stale sentence must produce. */
    const countFinding = staleCount.violations.find((v: Violation): boolean => v.id.startsWith(`derived-value:region-count:${DELTAS_DOC_REL}:`));
    cases.push({
      case: "T-75 arm 3 (NEGATIVE CONTROL): a stale region count REDDENS and NAMES the deltas doc",
      ok: staleCount.ok === false && countFinding !== undefined && countFinding.detail.includes("**65**") && countFinding.detail.includes("3 regions across 2 files"),
      detail: countFinding === undefined ? JSON.stringify(staleCount.violations) : `${countFinding.id} — ${countFinding.detail}`,
    });

    seed(tree);
    write(tree, MANUAL_REL, "# Manual\n\nno derived claim here\n");
    /** The verdict when a site's claim was removed altogether. */
    const noClaim = verifyDocsParity(tree);
    cases.push({
      case: "T-75 zero-subject guard: a site whose claim is GONE is a VIOLATION, not a silent pass",
      ok: noClaim.ok === false && noClaim.violations.some((v: Violation): boolean => v.id === `derived-value:delta-range:${MANUAL_REL}:missing-claim`),
      detail: JSON.stringify(noClaim.violations),
    });

    seed(tree);
    write(tree, "adopted/b.js", markers(2));
    /** The verdict when a live file carries more markers than the registry records. */
    const drift = verifyDocsParity(tree);
    cases.push({
      case: "T-75 bound: registry-vs-LIVE-marker drift is REPORTED (note, naming the file AND the ids), never a violation — the applier's --check owns it",
      ok: drift.ok === true && drift.derivedNotes.some((note: Note): boolean => note.reason.includes("adopted/b.js") && note.reason.includes("registry 1 id(s), live 2 id(s)") && note.reason.includes("MISMATCH")),
      detail: JSON.stringify(drift.derivedNotes),
    });
    // T-57 arm: a region NESTED inside another region's span is its OWN region, and an unregistered
    // child surfaces as a NAMED mismatch instead of the old false "markers agree".
    seed(tree);
    write(tree, "adopted/a.js", "//#region mpd-delta fixture-0 (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const outer = 0;\n//#region mpd-delta fixture-extra (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const child = 1;\n//#endregion mpd-delta fixture-extra\n//#endregion mpd-delta fixture-0\n//#region mpd-delta fixture-1 (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const sibling = 2;\n//#endregion mpd-delta fixture-1\n");
    /** The verdict on a file with a nested region. */
    const nested = verifyDocsParity(tree);
    cases.push({
      case: "T-57: a region NESTED inside another span counts as its OWN region and surfaces as a NAMED mismatch (the old walk counted 2, this counts 3)",
      ok: nested.ok === true && nested.derivedNotes.some((note: Note): boolean => note.reason.includes("adopted/a.js") && note.reason.includes("registry 2 id(s), live 3 id(s)") && note.reason.includes("MISMATCH") && note.reason.includes("mpd-delta fixture-extra")),
      detail: JSON.stringify(nested.derivedNotes),
    });
    seed(tree);

    /** The packed-copy fixture: same artifacts but NO manual, which is the T-75 discriminator. */
    const packed = join(sandbox, "packed");
    write(packed, DELTAS_DOC_REL, deltasDoc(3, 2));
    write(packed, REGISTRY_REL, registryText(["adopted/a.js", "adopted/a.js", "adopted/b.js"]));
    write(packed, "adopted/a.js", markers(2));
    write(packed, "adopted/b.js", markers(1));
    write(packed, "agent-references/index.md", indexDoc("A1–D7"));
    packageReadme(packed);
    /** The verdict on the packed root with one absent site file. */
    const packedResult = verifyDocsParity(packed);
    cases.push({
      case: "T-75 bound: an ABSENT site file (packed artifact, no AGENTS.md) is a NOTE while the PRESENT index site is still checked",
      ok:
        packedResult.ok === true &&
        packedResult.derivedNotes.some((note: Note): boolean => note.path === MANUAL_REL && note.reason.includes("not present")) &&
        packedResult.derivedNotes.some((note: Note): boolean => note.path === "agent-references/index.md" && note.reason.includes("checked against")),
      detail: JSON.stringify(packedResult.derivedNotes),
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  return cases;
}

/** The one switch the link fixtures vary: whether the manual (the packed discriminator) is present. */
interface ManualPresence {
  /** Whether the fixture carries `AGENTS.md`, which also disarms the packed-copy bound. */
  manual: boolean;
}

/**
 * LINK-TARGET arms: the POSITIVE control (an existing relative target resolves AND the checker is
 * proven to RUN), the IGNORED-classes arm, the mandatory NEGATIVE control (a missing target REDDENS,
 * naming source + target), the T-75 packed-copy arm (an absent site file turns an unresolved target
 * into a NOTE while a present target is still checked) and the EXEMPT_PROVENANCE arm (a dead link in
 * the verbatim file stays green and is REPORTED, while the SAME dead link in a non-exempt README
 * reddens — the control that stops the skip from becoming "ignore every package README").
 *
 * Every arm runs on a FIXTURE root, never on `--root dist/mpd-package`: a real packed root would
 * also have to satisfy every OTHER rule (pairs, exemptions, the T-75 sites) and its outcome would no
 * longer isolate the property under test. The full-checkout half needs `AGENTS.md` PRESENT — that is
 * the packed discriminator — which also arms the T-75 derived-value rules, so the fixture carries a
 * MINIMAL valid manual + delta artifact; without it an unrelated derived-value violation would
 * satisfy `ok === false` and hide a link checker that never ran (the vacuity these arms exist to
 * prevent).
 */
function selfTestLinks(): SelfTestCase[] {
  /** Every arm's outcome, returned to the caller for the shared summary line. */
  const cases: SelfTestCase[] = [];
  /** The throwaway root the full/packed fixture trees are written under. */
  const sandbox = mkdtempSync(join(tmpdir(), "mpd-docs-links-selftest-"));
  /** Write one fixture file under a root, creating its parent directories. */
  const write = (root: string, rel: string, text: string): void => {
    /** The fixture file's absolute path. */
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  /** Write the delta artifacts + provenance README every link fixture needs to stay focused. */
  const skeleton = (root: string, { manual }: ManualPresence): void => {
    if (manual) write(root, MANUAL_REL, "# Manual\n\nPointer: the authoritative A1–D2 adaptation table.\n");
    write(root, "agent-references/index.md", "# agent-references\n\n| File | Holds |\n|---|---|\n| `agent-teams-deltas.md` | the adopted agent-teams delta registry — the A1–D2 table, registry mechanics |\n");
    write(root, DELTAS_DOC_REL, "# Deltas\n\n| Id | File | Marker | Purpose |\n|---|---|---|---|\n| A1 | `adopted/a.js` | none | first |\n| D2 | `adopted/a.js` | `mpd-delta fixture-0` | second |\n\nThe live registry is **1** regions across **1** adopted files — the count MEASURED at this edit.\n");
    write(root, REGISTRY_REL, `export const MPD_DELTAS = [\n    {\n        file: "adopted/a.js",\n        id: "mpd-delta fixture-0",\n        beforeContext: [],\n        afterContext: [],\n        block: "",\n    },\n];\n`);
    write(root, "adopted/a.js", "//#region mpd-delta fixture-0 (mpd LOCAL ADAPTATION; re-applied by scripts/patch-agent-teams-fixes.mjs)\nexport const fixture0 = 0;\n//#endregion mpd-delta fixture-0\n");
    // The registry path above puts a PACKAGE directory in the fixture, and an undocumented package is
    // a violation in its own right — so the fixture also carries that package's README. It is now a
    // NORMAL POLICED PAIR, not an exempt verbatim file: the de-vendor wave deleted the package this
    // path belonged to, so no exemption covers it any more and the arm below proves that by putting a
    // dead link where the exemption used to be.
    write(root, "packages/mpd-agent-teams-plugin/README.md", "# Fixture package\n\n**English** | [中文](./README.zh-CN.md)\n\n## One\n\nlink-free on purpose: the shared fixture stays free of dead links so the link COUNTER arms are stable\n");
    write(root, "packages/mpd-agent-teams-plugin/README.zh-CN.md", "# 夹具包\n\n[English](./README.md)\n\n## 一\n\n正文\n");
  };
  /** Rebuild one fixture root from scratch: the skeleton plus the linked pair and one marked doc. */
  const fixture = (root: string, { manual }: ManualPresence): void => {
    rmSync(root, { recursive: true, force: true });
    skeleton(root, { manual });
    write(root, "README.md", "# Root\n\n**English** | [中文](./README.zh-CN.md)\n\n## One\n\n- [guide](docs/guide.md)\n\n```\n[fenced decoy](./decoy.md)\n```\n");
    write(root, "README.zh-CN.md", "# 根\n\n[English](./README.md)\n\n## 一\n\n文本\n");
    write(root, "docs/guide.md", "# Guide\n\n**English** | [中文](./guide.zh-CN.md)\n\n## One\n\n- [manual](../AGENTS.md)\n- [titled](../AGENTS.md \"the manual\")\n- [angled](<../AGENTS.md>)\n- [index](../agent-references/index.md)\n- [directory](../agent-references)\n- [external](https://example.invalid/x)\n- [mail](mailto:someone@example.invalid)\n- [anchor](#one)\n- an inline-code decoy: `[decoy](./decoy.md)`\n");
    write(root, "docs/guide.zh-CN.md", "# 指南\n\n[English](./guide.md)\n\n## 一\n\n正文\n");
    write(root, "docs/marked.md", "<!-- docs-parity: exempt fixture process record -->\n# Marked\n\nno twin demanded\n");
  };
  try {
    /** The full-checkout fixture root (manual PRESENT). */
    const full = join(sandbox, "full");
    /** The packed-copy fixture root (manual ABSENT, which is the discriminator). */
    const packed = join(sandbox, "packed");
    fixture(full, { manual: true });
    fixture(packed, { manual: false });

    // Arm 1 — POSITIVE control. `checked >= 1` is load-bearing: a checker that is not wired in
    // leaves the counters absent/zero and FAILS this arm even though `ok` is true.
    /** The verdict on the clean full-checkout fixture. */
    const clean = verifyDocsParity(full);
    cases.push({
      case: "links POSITIVE: an existing relative target resolves and the checker RAN",
      ok:
        clean.ok === true &&
        clean.linkChecks.checked >= 1 &&
        clean.linkChecks.dead === 0 &&
        clean.linkChecks.resolved >= 5 &&
        clean.linkChecks.external >= 2 &&
        clean.linkChecks.anchorOnly >= 1,
      detail: JSON.stringify(clean.linkChecks),
    });

    // Arm 2 — the IGNORED classes: counted, never resolved (a scanner that resolved them would
    // report `./code-span.md` / `./fenced.md` as dead and redden this arm).
    write(full, "docs/ignores.md", "<!-- docs-parity: exempt fixture ignore classes -->\n# Ignores\n\n- [external](https://example.invalid/a)\n- [protocol relative](//example.invalid/b)\n- [mail](mailto:x@example.invalid)\n- [anchor](#one)\n- [empty]()\n- inline `[code span](./code-span.md)` decoy\n\n```\n[fenced](./fenced.md)\n```\n");
    /** The verdict on the fixture that carries every IGNORED class. */
    const ignored = verifyDocsParity(full);
    cases.push({
      case: "links IGNORED: external, protocol-relative, mailto, anchor, empty, code-span and fenced targets are counted but never resolved",
      ok: ignored.ok === true && ignored.violations.every((v: Violation): boolean => !v.id.startsWith("link-missing:")) && ignored.linkChecks.external >= 3 && ignored.linkChecks.anchorOnly >= 3,
      detail: JSON.stringify(ignored.linkChecks),
    });

    // Arm 3 — NEGATIVE control (mandatory). It asserts a NEGATIVE gate result AND the specific
    // violation id AND a non-zero `dead` counter; a checker that is not wired in produces a PASSING
    // gate, no `link-missing:*` violation and a zero counter — all three clauses fail. The restore
    // matters: the arms share one fixture, so a leaked dead link would redden every later arm.
    /** The guide file the negative control appends a dead link to. */
    const guideRel = "docs/guide.md";
    /** The guide's bytes before mutation, restored right after the arm. */
    const before = readFileSync(join(full, guideRel), "utf8");
    writeFileSync(join(full, guideRel), `${before}\n[missing](./does-not-exist.md)\n`);
    /** The verdict with the dead link present. */
    const bad = verifyDocsParity(full);
    /** The `link-missing` violation the dead link must produce. */
    const badFinding = bad.violations.find((v: Violation): boolean => v.id === `link-missing:${guideRel}:./does-not-exist.md`);
    cases.push({
      case: "links NEGATIVE: a link to a missing file REDDENS and NAMES source + target",
      ok: bad.ok === false && badFinding !== undefined && bad.linkChecks.checked >= 1 && bad.linkChecks.dead >= 1,
      detail: badFinding === undefined ? JSON.stringify(bad.violations) : `FAIL ${badFinding.id} — ${badFinding.detail}`,
    });
    writeFileSync(join(full, guideRel), before);

    // Arm 4 — T-75 packed copy. `ok === true` alone is satisfiable by a dead scanner, so the arm
    // ALSO requires the note (naming the absent target) and `resolved >= 1`, which proves packed
    // mode did not disable resolution wholesale.
    /** The verdict on the packed-copy fixture. */
    const packedResult = verifyDocsParity(packed);
    cases.push({
      case: "links PACKED: no AGENTS.md -> an absent target is a LINK NOTE (not a failure) while a present target is still checked",
      ok:
        packedResult.ok === true &&
        packedResult.violations.every((v: Violation): boolean => !v.id.startsWith("link-missing:")) &&
        packedResult.linkNotes.some((n: Note): boolean => n.path === "docs/guide.md" && n.reason.includes("link-absent-site") && n.reason.includes("AGENTS.md")) &&
        packedResult.linkChecks.resolved >= 1 &&
        packedResult.linkChecks.absentSite >= 1 &&
        packedResult.linkChecks.dead === 0,
      detail: JSON.stringify({ counters: packedResult.linkChecks, notes: packedResult.linkNotes }),
    });

    // Arm 5 — the RETIRED EXEMPT_PROVENANCE, file-scoped, asserted in BOTH directions after the
    // de-vendor wave deleted its only subject (`packages/mpd-agent-teams-plugin/README.md`, the
    // adopted upstream README kept byte-verbatim). The fixture still writes a file at that exact
    // path — that is what makes the removal falsifiable rather than merely declared — but the file
    // is now an ORDINARY policed package README pair, so a dead link in it REDDENS like any other.
    // The second half keeps the original control: the SAME dead link in an unrelated package README
    // reddens too, so the arm cannot be satisfied by "ignore every packages/*/README.md".
    write(full, "packages/mpd-agent-teams-plugin/README.md", "# Fixture package\n\n**English** | [中文](./README.zh-CN.md)\n\n## One\n\n[dead](./docs/usage.md)\n");
    write(full, "packages/mpd-fixture-pkg/README.md", "# Pkg\n\n**English** | [中文](./README.zh-CN.md)\n\n## One\n\n[dead](./dead.md)\n");
    write(full, "packages/mpd-fixture-pkg/README.zh-CN.md", "# 包\n\n[English](./README.md)\n\n## 一\n\n正文\n");
    /** The verdict on the two dead links, one at the retired path and one in a fresh package. */
    const prov = verifyDocsParity(full);
    /** The link violations of that arm; both dead links must be reported, with no exemption left. */
    const provLinkViolations = prov.violations.filter((v: Violation): boolean => v.id.startsWith("link-missing:"));
    cases.push({
      case: "links PROVENANCE: the retired verbatim exemption is GONE — a dead link at its old path reddens like any other package README, and the skip counter stays at zero",
      ok:
        prov.ok === false &&
        provLinkViolations.length === 2 &&
        provLinkViolations.map((v: Violation): string => v.id).sort().join(",") === [
          "link-missing:packages/mpd-agent-teams-plugin/README.md:./docs/usage.md",
          "link-missing:packages/mpd-fixture-pkg/README.md:./dead.md",
        ].sort().join(",") &&
        prov.linkChecks.skippedProvenance === 0 &&
        !prov.linkNotes.some((n: Note): boolean => n.reason.includes("EXEMPT_PROVENANCE")),
      detail: JSON.stringify({ violations: prov.violations.map((v: Violation): string => v.id), counters: prov.linkChecks, provenanceNotes: prov.linkNotes.filter((n: Note): boolean => n.reason.includes("EXEMPT_PROVENANCE")) }),
    });

    // Arm 6 — ROOT-relative targets (t5-F1): a `/`-prefixed target resolves against the REPO ROOT, so
    // one that EXISTS in this tree must not be reported dead, while one that does NOT exist must still
    // redden (the normalization is not "ignore anything starting with /"). The counts are compared
    // against a baseline taken on the spot, so the arm cannot be satisfied by other arms' state.
    /** The link counters before this arm writes anything, used as the on-the-spot baseline. */
    const beforeRootRel = verifyDocsParity(full).linkChecks;
    /** A root-relative fixture document carrying one bullet per target handed to it. */
    const rootRelDoc = (targets: readonly string[]): string => `<!-- docs-parity: exempt fixture root-relative class -->\n# Root relative\n\n${targets.map((t: string): string => `- [target](${t})`).join("\n")}\n`;
    write(full, "docs/root-relative.md", rootRelDoc(["/docs/guide.md", "/packages"]));
    /** The verdict where both root-relative targets exist in this tree. */
    const rootRelOk = verifyDocsParity(full);
    write(full, "docs/root-relative.md", rootRelDoc(["/docs/guide.md", "/nowhere/absent.md"]));
    /** The verdict where one root-relative target is missing. */
    const rootRelBad = verifyDocsParity(full);
    /** The `link-missing` violation the missing root-relative target must produce. */
    const rootRelFinding = rootRelBad.violations.find((v: Violation): boolean => v.id === "link-missing:docs/root-relative.md:/nowhere/absent.md");
    cases.push({
      case: "links ROOT-RELATIVE: a `/`-prefixed target resolves against the REPO ROOT (existing file + directory count as RESOLVED), while a missing one still REDDENS with its id",
      ok:
        rootRelOk.linkChecks.resolved === beforeRootRel.resolved + 2 &&
        rootRelOk.linkChecks.dead === beforeRootRel.dead &&
        rootRelBad.linkChecks.dead === beforeRootRel.dead + 1 &&
        rootRelFinding !== undefined,
      detail: JSON.stringify({ resolvedBefore: beforeRootRel.resolved, resolvedWithTwoLiveTargets: rootRelOk.linkChecks.resolved, deadBefore: beforeRootRel.dead, deadWithMissingTarget: rootRelBad.linkChecks.dead, finding: rootRelFinding === undefined ? null : rootRelFinding.id }),
    });
    rmSync(join(full, "docs/root-relative.md"), { force: true });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  return cases;
}

/** The CLI entry point: parse `--root`/`--json`, run the gate, print it and set the exit code. */
function main(): void {
  /** The command-line arguments after the script path. */
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  /** Position of `--root` in the argument list, or -1. */
  const rootIndex = argv.indexOf("--root");
  /** The tree to check: `--root <dir>`, or the repository this script lives in. */
  const root = rootIndex === -1 ? join(HERE, "..") : argv[rootIndex + 1];
  /** Position of `--json` in the argument list, or -1. */
  const jsonIndex = argv.indexOf("--json");
  /** The `--json` report path, or `null` when no JSON report was asked for. */
  const jsonPath = jsonIndex === -1 ? null : argv[jsonIndex + 1];
  /** The gate's result, printed and (optionally) stored. */
  const result = verifyDocsParity(root);
  if (jsonPath !== null) {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), root, ...result }, null, 2) + "\n");
  }
  printReport(result, root);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) main();
